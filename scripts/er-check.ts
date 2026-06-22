/**
 * Verify the MagicBlock ER RPC is wired correctly through our stack:
 * load .env -> build CreditsClient with ephemeralRpcUrl -> hit the ER connection.
 * Run: pnpm --filter @slop/server exec tsx <abs path>/scripts/er-check.ts
 */
import { config as loadDotenv } from "dotenv";
loadDotenv({ path: "C:/Users/TGF/Downloads/aiSlop/.env" });

import { readFileSync } from "node:fs";
import { Connection, Keypair } from "@solana/web3.js";
import { CreditsClient } from "@slop/program-client";

async function main() {
  const erUrl = process.env.MAGICBLOCK_RPC_URL;
  const baseUrl = process.env.SOLANA_RPC_URL!;
  const kpPath = process.env.SERVER_KEYPAIR_PATH!;
  if (!erUrl) throw new Error("MAGICBLOCK_RPC_URL not set in .env");

  const server = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(kpPath, "utf8")) as number[]),
  );
  const client = new CreditsClient(new Connection(baseUrl, "confirmed"), server, {
    commitment: "confirmed",
    ephemeralRpcUrl: erUrl,
  });

  console.log("base RPC :", baseUrl);
  console.log("ER   RPC :", erUrl);

  const er = client.ephemeral(); // throws if ephemeralRpcUrl was not provided
  const version = await er.getVersion();
  console.log("ER getVersion:", JSON.stringify(version));
  const slot = await er.getSlot();
  console.log("ER getSlot   :", slot);

  console.log("\n✅ ER RPC reachable through CreditsClient.ephemeral()");
}

main().catch((e) => {
  console.error("\n❌ ER CHECK FAILED:", e?.message || e);
  process.exit(1);
});
