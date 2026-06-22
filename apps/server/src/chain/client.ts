/** Build the CreditsClient from config. Plain-devnet path by default; passes the
 * MagicBlock ER RPC through so the client's ER helpers are usable when set. */

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
