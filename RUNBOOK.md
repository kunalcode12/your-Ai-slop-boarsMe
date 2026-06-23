# RUNBOOK — stand up "your ai slop bores me" on devnet

End-to-end, ordered steps to run the whole stack on Solana **devnet** from scratch:
the Anchor credit program, the Supabase database + storage, the Node game server, and
the Next.js frontend. Everything off-chain is real-time; the **only** on-chain thing
is the credit economy.

There is already a working program deployed at
`2Eiw45DD1dd39ZQ5eRcMnY9zj4Qd5uYnKVxnjfEe9B1U` (upgrade authority = the server
keypair). You can **reuse it** (skip §3) or **deploy your own** (§3).

---

## 0. Prerequisites & versions

| Tool | Version (verified) | Notes |
|------|--------------------|-------|
| Node | ≥ 20 | repo `engines` requires ≥20 |
| pnpm | 9.15.0 | `corepack enable && corepack prepare pnpm@9.15.0 --activate` |
| Rust | 1.96 | `rustup` |
| Solana CLI (Agave) | 3.1.10 | `agave-install init 3.1.10` |
| Anchor CLI | 1.0.2 | via `avm`: `avm install 1.0.2 && avm use 1.0.2` |
| Supabase | hosted project | (optional) Supabase CLI for local types |

> **Windows:** the Rust/Anchor/Solana toolchain does **not** run well natively
> (`solana-test-validator` fails on the symlink privilege). Do all `anchor`/`solana`
> steps inside **WSL/Ubuntu**. The Node/pnpm steps run fine in Windows PowerShell.
> Helper scripts in [`scripts/`](scripts/) assume the repo is at
> `/mnt/c/Users/<you>/.../aiSlop` from WSL — adjust paths to your checkout.

---

## 1. Clone & install

```bash
git clone <repo> aiSlop && cd aiSlop
pnpm install
```

---

## 2. Solana CLI → devnet, and the two keypairs

This project uses **one** keypair, the **server keypair**, as: the deploy fee-payer,
the program **upgrade authority**, the Config **admin**, and `Config.server_authority`
(the backend signs every credit op as it, so users never see a wallet popup).

```bash
# in WSL
solana config set --url https://api.devnet.solana.com

# create the server keypair at the repo root (gitignored)
solana-keygen new --no-bip39-passphrase -o server-keypair.json
solana-keygen pubkey server-keypair.json        # note this pubkey

# fund it (a program deploy needs ~3 SOL; airdrops are rate-limited — see Troubleshooting)
solana airdrop 2 $(solana-keygen pubkey server-keypair.json) --url devnet
solana airdrop 2 $(solana-keygen pubkey server-keypair.json) --url devnet
solana balance  $(solana-keygen pubkey server-keypair.json) --url devnet   # want ≥ ~3 SOL
```

If airdrops are throttled, use the web faucet at https://faucet.solana.com (paste the
pubkey, pick **devnet**), or `solana transfer <pubkey> 4 --url devnet --allow-unfunded-recipient`
from another funded wallet.

---

## 3. Build & deploy the Anchor program (skip to reuse `2Eiw45…`)

```bash
cd programs/credits

# (only if deploying a brand-new program id) generate + sync a fresh program keypair:
#   solana-keygen new -o target/deploy/credits-keypair.json
#   anchor keys sync          # writes the new id into lib.rs + Anchor.toml
#   cp target/deploy/credits-keypair.json ../../credits-program-keypair.backup.json  # BACK IT UP

# build WITH the ER feature (also bundles session keys, which are always on):
anchor build -- --features er          # or: bash ../../scripts/build-er.sh

# deploy with the server keypair as payer + upgrade authority:
solana program deploy target/deploy/credits.so \
  --program-id target/deploy/credits-keypair.json \
  -k ../../server-keypair.json --upgrade-authority ../../server-keypair.json \
  --url devnet
#   (or: bash ../../scripts/deploy-devnet.sh)

solana-keygen pubkey target/deploy/credits-keypair.json   # <-- this is your PROGRAM_ID
```

After deploy, the IDL + types are regenerated at `target/{idl,types}`. **Copy them into
the client** (the `--features er` IDL is a superset, prefer it):

```bash
cp target/idl/credits.json ../../packages/program-client/idl/credits.json
cp target/types/credits.ts ../../packages/program-client/src/credits.ts
#   (or: bash ../../scripts/copy-idl.sh)
```

> Keep `target/deploy/credits-keypair.json` (and the repo-root backup) **safe** — it's
> the only way to re-create that program address, and the **upgrade authority**
> (`server-keypair.json`) is the only way to upgrade it. Lose the upgrade authority and
> the program can never change (this is exactly why the original `FunwpPA4…` program
> was abandoned).

---

## 4. Supabase: project, migrations, storage bucket

1. Create a project at https://supabase.com → **Project Settings**:
   - **API** → `Project URL` (`SUPABASE_URL`) and the **`service_role`** key
     (`SUPABASE_SERVICE_ROLE_KEY`) — server-side secret, never shipped to the browser.
   - **Database** → connection strings + the DB **password** (for migrations).
2. Apply the SQL migrations and create the private storage bucket:

```bash
# from repo root, with DATABASE_URL/DIRECT_URL filled in .env (see §5)
pnpm db:push          # runs supabase/migrations/*.sql (schema, RPCs, RLS, storage)
pnpm db:verify        # sanity-check tables/functions exist
pnpm storage:setup    # creates the private 'slop-drawings' bucket
```

RLS is **on** with no policies = service-role-only access; clients never touch the DB
directly (the game server is the only DB client).

---

## 5. Fill `.env` (from `.env.example`)

```bash
cp .env.example .env
```

| Variable | Where it comes from |
|----------|---------------------|
| `SOLANA_RPC_URL` | `https://api.devnet.solana.com` (devnet base layer) |
| `MAGICBLOCK_RPC_URL` | ER endpoint — `https://devnet.magicblock.app` (verified), or **blank** to run plain devnet |
| `PROGRAM_ID` / `NEXT_PUBLIC_PROGRAM_ID` | from §3 (`2Eiw45…` if reusing) |
| `SERVER_KEYPAIR_PATH` | path to `server-keypair.json` (or use `SERVER_KEYPAIR_SECRET` = bs58 key) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | §4, Supabase API settings |
| `SUPABASE_STORAGE_BUCKET` | `slop-drawings` |
| `DATABASE_URL` / `DIRECT_URL` | Supabase DB connection strings (fill the password) |
| `PORT` / `CLIENT_ORIGIN` | `8080` / `http://localhost:3000` |
| `ADMIN_TOKEN` | long random string to enable `/admin` (blank = admin disabled) |
| `NEXT_PUBLIC_SERVER_URL` | `http://localhost:8080` |

`apps/web/.env.local` mirrors the `NEXT_PUBLIC_*` values for the frontend.

---

## 6. Build & initialise on-chain config

```bash
pnpm install && pnpm build       # builds shared → program-client → server → web

# initialise the singleton Config once + run a live credit smoke test
# (init_config is idempotent here — it skips if Config already exists):
pnpm --filter @slop/server exec tsx scripts/devnet-smoke.ts
```

A green run prints `✅ DEVNET SMOKE PASSED` after exercising
`init_config → init_player → spend → earn → refund` against the deployed program.

---

## 7. Run the server + web

```bash
pnpm dev
# or per-app in two terminals:
#   pnpm --filter @slop/server dev     # game server on :8080  (GET /health → {ok:true})
#   pnpm --filter @slop/web dev        # UI on :3000
```

---

## 8. Manual smoke test (watch a credit move on-chain)

1. Open **two** browser profiles/tabs at http://localhost:3000 (each gets its own
   burner wallet in IndexedDB → two different players).
2. Tab A → **human** tab → ask the "ai" something (spends 1⚡, text).
3. Tab B → **larp** tab → it's handed A's prompt with a 60s timer → answer it.
4. Tab A receives the answer; Tab B sees **+1⚡**.
5. Copy a player's pubkey (the identity chip), find its **Player PDA**, and view the
   transaction on the **Solana Explorer (devnet)**:
   `https://explorer.solana.com/address/2Eiw45DD1dd39ZQ5eRcMnY9zj4Qd5uYnKVxnjfEe9B1U?cluster=devnet`
   → **Transactions** shows the `spend`/`earn` instructions you just triggered.
6. (optional) With `ADMIN_TOKEN` set, report an answer and review it:
   `curl -H "Authorization: Bearer $ADMIN_TOKEN" http://localhost:8080/admin/reports`

---

## 9. Tests

```bash
pnpm test                                   # Turborepo → backend integration + admin (vitest)
# Anchor program tests (run in WSL with a local validator):
cd programs/credits && anchor test --validator legacy
#   (native Windows can't run a validator; see scripts/localnet-up.sh for a WSL+Windows split)
```

---

## Troubleshooting

- **Airdrop rate limits.** `airdrop request failed ... rate limit` is the public
  faucet being stingy. Use https://faucet.solana.com, or `solana transfer` from a
  wallet you already funded. A ~351 KB program needs ~2.5 SOL rent + buffer/fees.
- **ER endpoint issues → fall back to plain devnet.** If `MAGICBLOCK_RPC_URL` is down
  or flaky, set it **blank**. The app never blocks on ER: the credit economy runs
  entirely on plain devnet; ER (delegate/commit/undelegate) is additive. Verify an ER
  endpoint with: `curl -s -X POST https://devnet.magicblock.app -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'`.
- **CORS / socket won't connect.** `CLIENT_ORIGIN` (server) must equal the web origin
  (`http://localhost:3000`), and `NEXT_PUBLIC_SERVER_URL` must point at the server
  (`http://localhost:8080`). Mismatch → blocked Socket.IO handshake.
- **Supabase RLS / "permission denied".** The server must use the **service_role** key
  (not anon). RLS is service-role-only by design. DDL (`pnpm db:push`) needs
  `DIRECT_URL`/`DATABASE_URL` with the DB password, not the service-role key.
- **IDL / program-ID mismatch.** `DeclaredProgramIdMismatch` or "Account does not
  exist" → the deployed program, `declare_id!`, `Anchor.toml`, the client IDL
  `address`, and `PROGRAM_ID` must all be the same id. Fix: `anchor keys sync` +
  rebuild, re-`cp` the IDL into `packages/program-client`, and update `.env`.
- **`tsx not found` running scripts.** Run them through the server package which has
  it: `pnpm --filter @slop/server exec tsx scripts/<file>.ts`.
- **`/admin` returns 503.** `ADMIN_TOKEN` is unset (admin disabled). Set it and pass
  `Authorization: Bearer <token>`.
- **Drawings 404 / won't load.** The bucket is private; images are delivered as
  short-lived signed URLs. A 404 usually means the answer was hidden (URLs stop being
  minted) or the URL expired (re-fetch via reconnect).
