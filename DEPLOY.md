# Deploying "your ai slop bores me" (Solana devnet)

Production topology:

| Piece | Host | Why |
|---|---|---|
| `apps/server` (Fastify + Socket.IO + chain bridge) | **Render** (always-on web service) | Needs a persistent process + WebSockets. Serverless won't hold Socket.IO. |
| `apps/web` (Next.js) | **Vercel** | First-class Next.js. |
| Postgres + storage + RPCs | **Supabase** (already hosted) | Same project you used in dev. |
| `credits` Anchor program | **Solana devnet** (already deployed `2Eiw45…`) | Source of truth for credits. |
| MagicBlock ER | **shared devnet ER** (`devnet.magicblock.app`) | Gasless credit ops; works as-is. |

Everything stays on **devnet**. Credits have no real value.

---

## 0. Security (do this FIRST)

1. **Rotate the Supabase service-role key.** A real one is committed in `.env.example` — anyone with the repo has full DB access. Supabase dashboard → Project Settings → API → "Reset"/roll the `service_role` key. Use the new value everywhere below, and scrub it from `.env.example` (replace with a placeholder).
2. Confirm secrets are **git-ignored**: `.env`, `server-keypair.json`, `*keypair*.json`. Never commit them.
3. Pick a strong `ADMIN_TOKEN` (or leave unset to disable `/admin`).

---

## 1. Prerequisites

- **Repo on GitHub** (Render + Vercel deploy from it).
- **Dedicated devnet RPC** (strongly recommended). The public `api.devnet.solana.com` rate-limits hard and will throttle a live deployment. Get a free devnet endpoint from Helius/Triton/QuickNode and use it for `SOLANA_RPC_URL`.
- **Server keypair as base58.** Render can't read a JSON file, so convert `server-keypair.json` to a base58 secret (run locally; never paste the output anywhere public):
  ```bash
  node -e "const bs58=require('bs58');const fs=require('fs');const k=JSON.parse(fs.readFileSync('./server-keypair.json'));console.log((bs58.default||bs58).encode(Uint8Array.from(k)))"
  ```
  ⚠️ You MUST use the **existing** server keypair (`7aWiUSfU…`) — it's hard-coded on-chain as `Config.server_authority`/`admin`. A different key will fail every credit op.
- **Fund the server keypair on devnet** (it pays fees + delegation rent). Check/top up:
  ```bash
  solana balance 7aWiUSfU2V3tzZtVufEbvAc4ecFqA7PCx98sbPfsUyk2 --url devnet
  solana airdrop 2 7aWiUSfU2V3tzZtVufEbvAc4ecFqA7PCx98sbPfsUyk2 --url devnet
  ```
  Keep it ≥ ~1 SOL. (Or `pnpm --filter @slop/server exec tsx scripts/er-probe.ts` to print the balance + ER health.)
- **Supabase is already provisioned** (the app runs against it in dev), so the schema/RPCs/bucket already exist — no migration step. If unsure: `pnpm db:verify` and `pnpm storage:setup`.

---

## 2. Deploy the backend (Render)

This repo ships a **`render.yaml` Blueprint**.

1. Render → **New +** → **Blueprint** → pick this repo → it reads `render.yaml`.
2. Set the secret env vars (marked `sync: false`) in the dashboard:
   - `SOLANA_RPC_URL` = your dedicated devnet RPC URL
   - `SERVER_KEYPAIR_SECRET` = the base58 from step 1
   - `SUPABASE_URL` = `https://<project>.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` = the **rotated** key
   - `CLIENT_ORIGIN` = leave as a placeholder for now (you'll set the real Vercel URL in step 4)
   - `ADMIN_TOKEN` = your random string (or delete the var)
   - (already defaulted in the blueprint: `MAGICBLOCK_RPC_URL`, `MAGICBLOCK_ER_ENABLED=true`, `PROGRAM_ID`, `SUPABASE_STORAGE_BUCKET`)
3. Deploy. When live you get `https://slop-server.onrender.com`.
4. Verify: open `https://slop-server.onrender.com/health` → `{"ok":true,...}`. Logs should show **"MagicBlock ER mode ENABLED"** and **"slop server up 💀"**.

Notes baked into `render.yaml`:
- **`plan: starter`** (always-on). The **free plan spins down on idle and kills every websocket** — don't use it for this.
- **`numInstances: 1`** — the queue + 60s claim timers are in-memory and there's no Redis adapter yet. Do **not** scale horizontally.
- Build installs devDeps (`--prod=false`) so `tsc` is available; the server runs via `tsx` (now a runtime dependency).

Don't want the Blueprint? Create a **Web Service** manually with:
- Build: `corepack enable && pnpm install --frozen-lockfile --prod=false && pnpm --filter @slop/shared build && pnpm --filter @slop/program-client build`
- Start: `pnpm --filter @slop/server start`
- Health check path: `/health`, instances: 1, plan: Starter+.

---

## 3. Deploy the frontend (Vercel)

1. Vercel → **Add New… → Project** → import this repo.
2. **Root Directory:** `apps/web` (this repo includes `apps/web/vercel.json` which sets the monorepo-aware build/install commands automatically).
3. **Environment Variables** (Production + Preview):
   - `NEXT_PUBLIC_SERVER_URL` = `https://slop-server.onrender.com` (your Render URL, no trailing slash)
   - That's the only one the app reads at runtime.
4. Deploy. You get `https://<your-app>.vercel.app`.

---

## 4. Connect them (CORS)

The backend only accepts browser origins listed in `CLIENT_ORIGIN`.

1. In Render, set `CLIENT_ORIGIN` to your Vercel URL(s), **comma-separated, no trailing slash**, e.g.:
   ```
   https://your-app.vercel.app
   ```
   To also allow Vercel preview deploys or a custom domain, add them:
   ```
   https://your-app.vercel.app,https://yourdomain.com
   ```
   (Multi-origin support was added to the server config for exactly this.)
2. Save → Render redeploys. Done.

---

## 5. Verify production

Open your Vercel URL and confirm:
- Header shows the **⚡ MagicBlock ER** badge (server is in ER mode).
- Two different identities (normal window + **incognito**): ask in one, answer in the other.
- You see the **⚡ MagicBlock** toast on −1 (asking) and +1 (answering); the credit counter updates.
- Browser console has no CORS / WebSocket errors.

---

## Operational notes

- **Server SOL:** each session does a delegate + undelegate (devnet txs) plus per-op ER fees. Monitor `7aWiUSfU…` and top up from the faucet. To turn ER off instantly (back to plain devnet), set `MAGICBLOCK_ER_ENABLED=false` and redeploy.
- **One instance only** until a Redis Socket.IO adapter is added (in-memory queue/timers). Restarts are safe — boot recovery rebuilds the queue and reconcile re-reads on-chain/ER state.
- **RPC:** use a dedicated devnet RPC; the public one throttles at real traffic.
- **Admin moderation:** `GET/POST https://slop-server.onrender.com/admin/...` with `Authorization: Bearer $ADMIN_TOKEN` (503 if `ADMIN_TOKEN` unset). See `MODERATION.md`.
- **Queue maintenance** (rarely needed — auto-cleanup handles it): `pnpm --filter @slop/server purge-queue`.

## Env var reference

**Render (backend)**

| Var | Example / value |
|---|---|
| `SOLANA_RPC_URL` | your dedicated devnet RPC |
| `MAGICBLOCK_RPC_URL` | `https://devnet.magicblock.app` |
| `MAGICBLOCK_ER_ENABLED` | `true` |
| `PROGRAM_ID` | `2Eiw45DD1dd39ZQ5eRcMnY9zj4Qd5uYnKVxnjfEe9B1U` |
| `SERVER_KEYPAIR_SECRET` | base58 of `server-keypair.json` |
| `SUPABASE_URL` | `https://<project>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | rotated service-role key |
| `SUPABASE_STORAGE_BUCKET` | `slop-drawings` |
| `CLIENT_ORIGIN` | `https://your-app.vercel.app` (comma-sep for more) |
| `ADMIN_TOKEN` | long random string (optional) |
| `NODE_VERSION` | `20` |
| `PORT` | set automatically by Render — don't override |

**Vercel (frontend)**

| Var | Value |
|---|---|
| `NEXT_PUBLIC_SERVER_URL` | `https://slop-server.onrender.com` |
