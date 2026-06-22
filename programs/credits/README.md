# credits — on-chain credit economy (Anchor)

Source of truth for player **credit balances** and the **spend / earn / refill /
refund** operations. No content is ever stored on-chain. Targets Solana
**devnet**; MagicBlock ephemeral-rollup support is behind a Cargo feature.

- Program ID: `FunwpPA4fah5czxHfhbDD6iQE9L3wPUvuEzUkd5gL6Fv`
- anchor-cli 0.32.1 · Agave solana-cli 4.x
- Layout: Anchor project root here; Rust crate at `programs/credits/`.

## trust model (MVP / plain devnet)

`Config.server_authority` is the backend keypair — the trusted referee.

- `init_player` is signed **only** by `server_authority` (anti-sybil: stops
  anyone minting free starting credits into keypairs they generate).
- `refill` / `spend` / `earn` / `refund` accept **either** the player's own
  authority (or, in ER mode, its session key) **or** `server_authority`. In plain
  MVP mode the backend signs these for the player, so users never see a wallet
  popup. As we move to ER + session keys, players can sign directly.

Costs / interval / cap / starting balance are seeded at `init_config` from
**@slop/shared** (the canonical reference). Note: the program stores the refill
interval in **seconds**; shared expresses it in **ms**.

## instructions

| ix            | args     | signer                              |
| ------------- | -------- | ----------------------------------- |
| `init_config` | params   | admin (becomes `Config.admin`)      |
| `init_player` | —        | `server_authority`                  |
| `refill`      | —        | player authority OR server_authority |
| `spend`       | `amount` | player authority OR server_authority |
| `earn`        | —        | player authority OR server_authority |
| `refund`      | `amount` | player authority OR server_authority |

PDAs: Config = `["config"]`; Player = `["player", authority]`.
Errors: `InsufficientCredits, RefillNotReady, Unauthorized, MaxCreditsReached, MathOverflow, InvalidConfig`.

## build

```bash
cd programs/credits
anchor build                 # compiles to SBF + generates target/idl/credits.json + target/types/credits.ts
# after any change to instructions/accounts, re-copy the artifacts into the client:
cp target/idl/credits.json   ../../packages/program-client/idl/credits.json
cp target/types/credits.ts   ../../packages/program-client/src/credits.ts
```

## test

```bash
anchor test                  # boots a local validator, deploys, runs tests/credits.ts
```

> NOTE: `solana-test-validator` does **not** run on native Windows (OS error 1314,
> symlink privilege). Run `anchor test` on Linux/macOS or WSL, or point the tests
> at devnet. The program **builds** and the **IDL generates** fine on Windows.

Covered: init config/player, refill interval gate (both error + success), spend
success + `InsufficientCredits`, earn, refund, max-credits cap (`MaxCreditsReached`),
unauthorized signer rejected. The ER delegate→spend→commit/undelegate test is
gated behind `RUN_ER_TESTS=1` (needs ER tooling).

## deploy to devnet

```bash
# 1. point the CLI at devnet and fund the deployer
solana config set --url https://api.devnet.solana.com
solana airdrop 2                                  # repeat if needed (rate-limited)
solana balance

# 2. make the declared program id match the deploy keypair
anchor keys sync                                  # syncs declare_id! + Anchor.toml to target/deploy/credits-keypair.json
anchor build

# 3. deploy
anchor deploy --provider.cluster devnet
#   (equivalently: solana program deploy target/deploy/credits.so --program-id target/deploy/credits-keypair.json)

# 4. record the program id everywhere
solana-keygen pubkey target/deploy/credits-keypair.json
#   -> set PROGRAM_ID and NEXT_PUBLIC_PROGRAM_ID in .env, and confirm declare_id! matches
```

The deploy keypair lives at `target/deploy/credits-keypair.json` (gitignored —
back it up; it controls program upgrades). After first deploy, the backend
(PROMPT 4) calls `init_config` once via the typed client.

## ER fallback switch

The default build is **plain devnet** — zero MagicBlock deps, no delegation. ER
delegation/commit/undelegate live behind the `er` feature:

```bash
anchor build -- --features er    # adds delegate_player / commit_player / undelegate_player + injects #[ephemeral]
```

Enabling `er` may require aligning `anchor-lang` with the
`ephemeral-rollups-sdk` (0.15.5) release's target version — confirm against
docs.magicblock.gg before relying on it. Session keys (`session-keys` 1.0.0) are
documented + scaffolded in `lib.rs` but intentionally not wired into core
instructions yet (they change the spend/earn account layout). **The app is never
blocked on ER**: PROMPT 4 runs plain mode first.
