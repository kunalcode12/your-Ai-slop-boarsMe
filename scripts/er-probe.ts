/**
 * Read-only ER readiness probe. Confirms, against the LIVE setup:
 *   - the client's loaded IDL exposes the ER instructions (erEnabled)
 *   - the MagicBlock ER RPC is reachable (version/slot)
 *   - the deployed program account exists on devnet
 *   - the server keypair's devnet SOL balance (delegation costs rent/fees)
 *   - whether a sample Player PDA is already delegated (owner = delegation program)
 *
 * Run: pnpm --filter @slop/server exec tsx C:\Users\TGF\Downloads\aiSlop\scripts\er-probe.ts
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: "C:/Users/TGF/Downloads/aiSlop/.env" });

import { readFileSync } from "node:fs";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { CreditsClient } from "@slop/program-client";

const DELEGATION_PROGRAM = "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh";

function loadServer(): Keypair {
  const secret = process.env.SERVER_KEYPAIR_SECRET?.trim();
  if (secret) {
    // base58
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bs58 = require("bs58");
    return Keypair.fromSecretKey(bs58.default ? bs58.default.decode(secret) : bs58.decode(secret));
  }
  const p = process.env.SERVER_KEYPAIR_PATH!;
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8")) as number[]));
}

async function main() {
  const baseUrl = process.env.SOLANA_RPC_URL!;
  const erUrl = process.env.MAGICBLOCK_RPC_URL;
  const server = loadServer();
  const base = new Connection(baseUrl, "confirmed");

  console.log("base RPC :", baseUrl);
  console.log("ER   RPC :", erUrl || "(unset)");
  console.log("server   :", server.publicKey.toBase58());

  const client = new CreditsClient(base, server, {
    commitment: "confirmed",
    ephemeralRpcUrl: erUrl || undefined,
  });

  console.log("\nerEnabled (IDL has ER ix):", client.erEnabled);
  console.log("programId               :", client.programId.toBase58());

  const progAcc = await base.getAccountInfo(client.programId);
  console.log("program deployed        :", !!progAcc, progAcc ? `(executable=${progAcc.executable})` : "");

  const bal = await base.getBalance(server.publicKey);
  console.log("server SOL (devnet)     :", (bal / 1e9).toFixed(4), "SOL");

  if (erUrl) {
    try {
      const er = client.ephemeral();
      console.log("ER getVersion           :", JSON.stringify(await er.getVersion()));
      console.log("ER getSlot              :", await er.getSlot());
    } catch (e) {
      console.log("ER RPC error            :", (e as Error).message);
    }
  }

  // is the server's own player PDA already delegated? (owner flips to delegation prog)
  const samplePda = client.playerPda(server.publicKey);
  const pdaAcc = await base.getAccountInfo(samplePda);
  console.log("\nsample Player PDA       :", samplePda.toBase58());
  if (pdaAcc) {
    const owner = pdaAcc.owner.toBase58();
    console.log("  owner                 :", owner);
    console.log("  delegated to ER?      :", owner === DELEGATION_PROGRAM);
  } else {
    console.log("  (no player PDA for the server key yet — that's fine)");
  }

  console.log("\n✅ probe complete");
  process.exit(0);
}
main().catch((e) => {
  console.error("\n❌ probe failed:", e?.message || e);
  process.exit(1);
});
