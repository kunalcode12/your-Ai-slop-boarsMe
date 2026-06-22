/**
 * Live devnet smoke test for the deployed credits program (PROMPT 3 verification).
 * Exercises the real on-chain path the server uses: init_config (once),
 * init_player, spend, earn, refund — asserting balances move correctly.
 *
 * Run from repo root:  pnpm exec tsx scripts/devnet-smoke.ts
 * Requires: program deployed at the IDL's address, server-keypair.json funded.
 */
import { readFileSync } from "node:fs";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { CreditsClient, defaultConfigParams } from "@slop/program-client";
import { STARTING_CREDITS } from "@slop/shared";

const RPC = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

function loadServerKeypair(): Keypair {
  const path =
    process.env.SERVER_KEYPAIR_PATH ||
    "C:/Users/TGF/Downloads/aiSlop/server-keypair.json";
  const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

const assert = (cond: boolean, msg: string) => {
  if (!cond) throw new Error("ASSERT FAILED: " + msg);
  console.log("  ✓ " + msg);
};

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const server = loadServerKeypair();
  const client = new CreditsClient(connection, server, { commitment: "confirmed" });

  console.log("program:", client.programId.toBase58());
  console.log("server :", server.publicKey.toBase58());
  const bal = await connection.getBalance(server.publicKey);
  console.log("balance:", (bal / LAMPORTS_PER_SOL).toFixed(4), "SOL");
  console.log("ER instrs in client IDL:", client.erEnabled ? "present" : "MISSING");

  // 1. init_config (singleton) — tolerate "already initialized"
  console.log("\n[init_config]");
  const existing = await client.getConfig();
  if (existing) {
    console.log("  config already exists (admin/server_authority set) — skipping init");
  } else {
    const sig = await client.initConfig(defaultConfigParams(server.publicKey));
    console.log("  init_config sig:", sig);
  }
  const cfg = await client.getConfig();
  assert(!!cfg, "config exists on-chain");

  // 2. fresh burner player
  const burner = Keypair.generate();
  console.log("\n[init_player] burner:", burner.publicKey.toBase58());
  await client.initPlayer(burner.publicKey);
  let p = await client.getPlayer(burner.publicKey);
  assert(!!p, "player created");
  const start = p!.balance;
  console.log("  starting balance:", start);
  assert(start === STARTING_CREDITS, `starting balance == ${STARTING_CREDITS}`);

  // 3. spend 1
  console.log("\n[spend 1]");
  await client.spend(burner.publicKey, 1);
  p = await client.getPlayer(burner.publicKey);
  assert(p!.balance === start - 1, `balance ${start} -> ${start - 1}`);
  assert(p!.promptsSent === 1, "prompts_sent == 1");

  // 4. earn 1
  console.log("\n[earn]");
  await client.earn(burner.publicKey);
  p = await client.getPlayer(burner.publicKey);
  assert(p!.balance === start, `balance back to ${start}`);
  assert(p!.answersGiven === 1, "answers_given == 1");

  // 5. refund 1
  console.log("\n[refund 1]");
  await client.refund(burner.publicKey, 1);
  p = await client.getPlayer(burner.publicKey);
  assert(p!.balance === start + 1, `balance ${start} -> ${start + 1}`);

  console.log("\n✅ DEVNET SMOKE PASSED — live credit flow works on the new program");
}

main().catch((e) => {
  console.error("\n❌ SMOKE FAILED:", e?.message || e);
  process.exit(1);
});
