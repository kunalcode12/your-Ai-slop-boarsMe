// One-time on-chain bootstrap: initialize the singleton Config PDA.
//   admin / payer   = the deploy wallet (~/.config/solana/id.json)
//   server_authority= the backend referee keypair (repo-root server-keypair.json)
// Idempotent: if Config already exists, it reports and exits.
//
// Run from this package dir:  node scripts/init-config.mjs

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair } from "@solana/web3.js";
import { CreditsClient, defaultConfigParams } from "../dist/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..", "..");

const loadKp = (p) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));

const rpc = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const deployer = loadKp(join(homedir(), ".config", "solana", "id.json"));
const server = loadKp(join(repoRoot, "server-keypair.json"));

const conn = new Connection(rpc, "confirmed");
// constructor keypair becomes admin + payer for init_config
const client = new CreditsClient(conn, deployer);

console.log("RPC:        ", rpc);
console.log("admin/payer:", deployer.publicKey.toBase58());
console.log("server_auth:", server.publicKey.toBase58());
console.log("config PDA: ", client.configPda().toBase58());

const existing = await client.getConfig();
if (existing) {
  console.log("\n✓ Config already initialized:");
  console.log({
    admin: existing.admin.toBase58(),
    serverAuthority: existing.serverAuthority.toBase58(),
    creditCostText: existing.creditCostText.toNumber(),
    creditCostImage: existing.creditCostImage.toNumber(),
    refillAmount: existing.refillAmount.toNumber(),
    refillIntervalSecs: existing.refillInterval.toNumber(),
    maxCredits: existing.maxCredits.toNumber(),
    startingBalance: existing.startingBalance.toNumber(),
  });
  process.exit(0);
}

const params = defaultConfigParams(server.publicKey);
console.log("\nInitializing with @slop/shared params:", {
  text: params.creditCostText,
  image: params.creditCostImage,
  refillSecs: params.refillIntervalSecs,
  max: params.maxCredits,
  start: params.startingBalance,
});

const sig = await client.initConfig(params);
console.log("init_config tx:", sig);

const cfg = await client.getConfig();
console.log("\n✓ Config initialized:");
console.log({
  admin: cfg.admin.toBase58(),
  serverAuthority: cfg.serverAuthority.toBase58(),
  maxCredits: cfg.maxCredits.toNumber(),
  startingBalance: cfg.startingBalance.toNumber(),
});
