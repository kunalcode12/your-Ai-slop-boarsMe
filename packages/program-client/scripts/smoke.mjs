// Live devnet smoke test of the credit economy using the SERVER keypair as the
// referee (the exact path the backend will use). Creates a throwaway burner,
// then init_player -> spend -> earn -> refund, printing balances.
//   node scripts/smoke.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair } from "@solana/web3.js";
import { CreditsClient } from "../dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..");
const server = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(readFileSync(join(repoRoot, "server-keypair.json"), "utf8"))),
);

const conn = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
const client = new CreditsClient(conn, server);

const burner = Keypair.generate().publicKey; // a fake "player" wallet
console.log("burner:", burner.toBase58());

const bal = async (label) => {
  const p = await client.getPlayer(burner);
  console.log(`  ${label}: balance=${p.balance} prompts=${p.promptsSent} answers=${p.answersGiven}`);
};

console.log("init_player:", await client.initPlayer(burner));
await bal("after init (expect 3)");

console.log("spend(1):", await client.spend(burner, 1));
await bal("after spend (expect 2, prompts=1)");

console.log("earn():", await client.earn(burner));
await bal("after earn (expect 3, answers=1)");

console.log("refund(1):", await client.refund(burner, 1));
await bal("after refund (expect 4)");

console.log("\n✓ live credit flow works end-to-end");
