/** Build the PROMPT-3 CreditsClient from config (plain-devnet path). */

import { Connection } from "@solana/web3.js";
import { CreditsClient } from "@slop/program-client";
import type { AppConfig } from "../config";

export function createCreditsClient(config: AppConfig): CreditsClient {
  const connection = new Connection(config.solanaRpcUrl, "confirmed");
  return new CreditsClient(connection, config.serverKeypair, {
    commitment: "confirmed",
    // present but unused until ER mode lands (PROMPT 3 deferred)
    ephemeralRpcUrl: config.magicblockRpcUrl || undefined,
  });
}
