# credits — on-chain credit economy (Anchor)

Source of truth for player **credit balances** and the **spend / earn / refill /
refund** operations. No content is ever stored on-chain. Targets Solana
**devnet**. MagicBlock ephemeral-rollup support is behind a Cargo feature;
**session keys are always on**.

- Program ID: `2Eiw45DD1dd39ZQ5eRcMnY9zj4Qd5uYnKVxnjfEe9B1U`
- anchor-cli **1.0.2** · Agave solana-cli **3.1.10** · rustc 1.96
- Deps: `session-keys` 3.1.1 (always on) · `ephemeral-rollups-sdk` 0.15.5 (feature `er`)
- Layout: Anchor project root here; Rust crate at `programs/credits/`.

> History: the first pass deployed a plain-devnet program at
> `FunwpPA4fah5czxHfhbDD6iQE9L3wPUvuEzUkd5gL6Fv` on Anchor 0.32 / Solana 2.x. The
> ER + session-key upgrade requires Anchor 1.0 / Solana 3.x; since the old
> program's upgrade authority key is not available, the upgraded program ships
> under the **new** id above. On devnet (no value) this is a clean re-deploy.

## trust model

`Config.server_authority` is the backend keypair — the trusted referee.

- `init_player` is signed **only** by `server_authority` (anti-sybil: stops
  anyone minting free starting credits into keypairs they generate).
- `refill` / `refund` accept **either** the player's own authority **or**
  `server_authority`.
- `spend` / `earn` accept the player authority, `server_authority`, **or** a
  valid **session key** registered for the player (see below). In plain MVP mode
  the backend signs for the player, so users never see a wallet popup.

Costs / interval / cap / starting balance are seeded at `init_config` from
**@slop/shared** (the canonical reference). Note: the program stores the refill
interval in **seconds**; shared expresses it in **ms**.

## session keys (always on)

`Mutate` derives `Session` (MagicBlock `session-keys` 3.1.1) and carries an
optional `session_token`. `spend`/`earn` are wrapped in
`#[session_auth_or(player == signer || server == signer, Unauthorized)]`:

- if a `session_token` is supplied, it is validated (PDA + expiry + matching
  authority) and authorizes the action;
- otherwise the fallback expression (player or server authority) is required.

A player registers a session key once via the session program
`KeyspM2ssCJbqUhQ4k7sveSiY4WjnYsrXkC8oDbwde5` (deployed on devnet by MagicBlock)
and can then sign many spend/earn txs with an ephemeral keypair — no popups. The
server path simply passes `session_token = None`.

## instructions

| ix                  | args     | feature | signer                                         |
| ------------------- | -------- | ------- | ---------------------------------------------- |
| `init_config`       | params   | core    | admin (becomes `Config.admin`)                 |
| `init_player`       | —        | core    | `server_authority`                             |
| `refill`            | —        | core    | player OR server authority                     |
| `spend`             | `amount` | core    | session key OR player OR server authority      |
| `earn`              | —        | core    | session key OR player OR server authority      |
| `refund`            | `amount` | core    | player OR server authority                     |
| `delegate_player`   | —        | `er`    | payer (delegates Player PDA to the ER)         |
| `commit_player`     | —        | `er`    | payer (commit ER state → devnet)               |
| `undelegate_player` | —        | `er`    | payer (commit + return PDA to this program)    |
| `process_undelegation` | (auto) | `er`   | injected by `#[ephemeral]` (undelegate callback) |

PDAs: Config = `["config"]`; Player = `["player", authority]`.
Errors: `InsufficientCredits, RefillNotReady, Unauthorized, MaxCreditsReached, MathOverflow, InvalidConfig`.

## build

```bash
cd programs/credits
anchor build                     # core: spend/earn/refill/refund + session keys
anchor build -- --features er    # the above PLUS the ER delegate/commit/undelegate ixs

# the IDL + types regenerate at target/{idl,types}. after any change re-copy them
# into the client (the `er` build's IDL is a superset, so prefer it):
cp target/idl/credits.json   ../../packages/program-client/idl/credits.json
cp target/types/credits.ts   ../../packages/program-client/src/credits.ts
```

## test

```bash
anchor test                  # boots a local validator, deploys, runs tests/credits.ts
```

> NOTE: `solana-test-validator` does **not** run on native Windows (OS error 1314,
> symlink privilege). Run `anchor test` on Linux/macOS or **WSL** (this repo's
> tests were run under WSL/Ubuntu). The ER delegate→spend→commit/undelegate test
> is gated behind `RUN_ER_TESTS=1` (needs the MagicBlock delegation program + an
> ER validator, which a bare localnet lacks).

Covered: init config/player, refill interval gate (error + success), spend
success + `InsufficientCredits`, earn, refund, max-credits cap
(`MaxCreditsReached`), unauthorized signer rejected (session-token = None path).

## deploy to devnet

```bash
# 1. point the CLI at devnet; the deployer wallet also becomes the upgrade authority.
solana config set --url https://api.devnet.solana.com
solana balance -k ../../server-keypair.json     # needs ~5.6 SOL for the ~351KB er program

# 2. build the deployable (with ER) — declare_id! + Anchor.toml already match the keypair
anchor build -- --features er

# 3. deploy with the server keypair as payer/upgrade-authority
anchor deploy --provider.cluster devnet --provider.wallet ../../server-keypair.json
#   (equivalently: solana program deploy target/deploy/credits.so \
#      --program-id target/deploy/credits-keypair.json \
#      --upgrade-authority ../../server-keypair.json --url devnet)

# 4. the program keypair is target/deploy/credits-keypair.json
#    (also backed up at repo root: credits-program-keypair.backup.json — keep it!)
```

After deploy the backend calls `init_config` once via the typed client
(`CreditsClient.initConfig`, admin = server keypair).

## ER (`er` feature)

Default build is **plain devnet + session keys** — no MagicBlock delegation. The
`er` feature adds delegation so spend/earn can run on a MagicBlock ephemeral
rollup (gasless, ~real-time) and settle back to devnet:

- `delegate_player` — hand the Player PDA to the delegation program
  (`DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh`); optional ER validator passed
  as the first remaining account.
- `commit_player` / `undelegate_player` — via `ephem::MagicIntentBundleBuilder`
  (`.commit(..)` / `.commit_and_undelegate(..)`), using the magic program
  + magic context injected by `#[commit]`.
- `#[ephemeral]` injects `process_undelegation`, the callback the delegation
  program invokes when settling state back to devnet.

To route credit ops through the ER at runtime, set `MAGICBLOCK_RPC_URL`; the
`CreditsClient` then exposes `delegatePlayer` / `commitPlayer` /
`undelegatePlayer` and an ephemeral connection. **The app is never blocked on
ER**: with it off, the credit economy runs entirely on plain devnet.
```
