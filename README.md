# your ai slop bores me 💀

a real-time, browser-based, multiplayer parody of ai chatbots where the "ai" is
actually a random human. two modes:

- **human** — type a prompt; a real human answers within 60s pretending to be an
  ai. costs credits (text = 1, image = 2). one-shot, no follow-up.
- **larp as ai** — get a random prompt from the queue, answer it within 60s
  (type or draw). each accepted answer earns 1 credit.

closed credit economy: you must *be* the ai to earn the right to *use* the ai.
credits also slowly refill so new users aren't stuck. no signup, no paywall.

> the credit economy is **on-chain** (Solana devnet); everything real-time and
> content-heavy (queue, timers, prompts, drawings, moderation) is **off-chain**.
> the credit "token" is devnet-only and has **no real value** — no cash-out, no
> mainnet, no tradeable token.

## structure

```
slop/
  apps/
    web/                 # Next.js frontend (the cartoon UI)
    server/              # Fastify + Socket.IO game server (only DB/chain writer)
  programs/
    credits/             # Anchor program (Rust) — credit balances + ops
  packages/
    shared/              # types, zod schemas, socket event names, constants
    program-client/      # typed client + IDL for the Anchor program
  supabase/
    migrations/          # SQL migrations (Supabase CLI)
  .env.example
  pnpm-workspace.yaml
  turbo.json
  package.json
```

`packages/shared` is the single source of truth for cross-cutting contracts
(credit costs, the 60s timer, cooldowns/caps, wire schemas, and socket event
names). both `web` and `server` import it; they never duplicate these numbers.

the **server** is the only process that talks to Supabase (service role) and to
the chain. clients never hit the database directly.

## prerequisites

- **Node** >= 20 (tested on 24)
- **pnpm** 9 (`corepack enable` then `corepack prepare pnpm@9.15.0 --activate`)
- **Rust** + **Solana CLI** + **Anchor** (for `programs/credits`, later step) —
  versions pinned against current docs at build time
- **Supabase CLI** (for `supabase/migrations`, later step)

## getting started

```bash
corepack enable
pnpm install        # install + link the workspace
pnpm build          # build shared + program-client (apps are stubs for now)
```

copy `.env.example` to `.env` and fill it in before running the server/web apps
(added in later steps).

## run commands (intended)

| command          | what it does                                              |
| ---------------- | -------------------------------------------------------- |
| `pnpm dev`       | run all dev tasks (web + server) via Turborepo           |
| `pnpm build`     | build every workspace package                            |
| `pnpm lint`      | lint every workspace package                             |
| `pnpm typecheck` | typecheck every workspace package                        |
| `pnpm test`      | run tests across the workspace                           |

> apps (`web`, `server`) are scaffolding stubs at this step — their scripts are
> no-ops until their build steps land. `shared` and `program-client` build for
> real.

## build order

1. **scaffold + shared contracts** ← you are here
2. supabase schema + migrations
3. game server (Fastify + Socket.IO): queue, timers, lifecycle, moderation
4. Solana credits program (Anchor) + program-client + chain bridge
5. MagicBlock ephemeral rollup + session keys (degradable; never blocks the app)
6. Next.js frontend (the cartoon UI)

## the off-chain / on-chain line

- **off-chain** (server + Supabase + storage): matchmaking queue, 60s timer, all
  prompt text, all drawings, player records, moderation. real-time + deletable.
- **on-chain** (Solana devnet, Anchor): per-player credit balance and the
  spend/earn/refill/refund operations. source of truth for credits.
- **content is never on-chain** — moderation requires deletability.

humans make mistakes because that's what makes us human.
