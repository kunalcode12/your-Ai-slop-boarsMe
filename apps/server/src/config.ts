/** Env loading + validation. Fails fast if anything required is missing. */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
// .env lives at the repo root (three levels up from apps/server/src).
loadDotenv({ path: resolve(here, "../../../.env") });

const envSchema = z.object({
  SOLANA_RPC_URL: z.string().url(),
  MAGICBLOCK_RPC_URL: z.string().optional().default(""),
  // Activate MagicBlock ER: when "true" (and MAGICBLOCK_RPC_URL is set) the bridge
  // delegates each connected player's PDA to the ephemeral rollup and runs
  // spend/earn/refund/refill there (gasless/real-time), settling on disconnect.
  // Defaults OFF so the plain-devnet path is the safe default everywhere.
  MAGICBLOCK_ER_ENABLED: z.string().optional().default("false"),
  PROGRAM_ID: z.string().min(32),
  SERVER_KEYPAIR_PATH: z.string().optional(),
  SERVER_KEYPAIR_SECRET: z.string().optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  SUPABASE_STORAGE_BUCKET: z.string().default("slop-drawings"),
  PORT: z.coerce.number().int().positive().default(8080),
  CLIENT_ORIGIN: z.string().default("http://localhost:3000"),
  // Bearer token guarding the /admin moderation endpoints. If unset, /admin is
  // disabled (returns 503) — safe default for local dev.
  ADMIN_TOKEN: z.string().optional().default(""),
});

export interface AppConfig {
  solanaRpcUrl: string;
  magicblockRpcUrl: string;
  erEnabled: boolean;
  programId: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  storageBucket: string;
  port: number;
  /** Raw CLIENT_ORIGIN value (for logging). */
  clientOrigin: string;
  /** Allowed browser origins for CORS + Socket.IO (CLIENT_ORIGIN may be a
   *  comma-separated list, e.g. prod domain + Vercel preview URLs). */
  clientOrigins: string[];
  adminToken: string;
  serverKeypair: Keypair;
}

function loadKeypair(env: z.infer<typeof envSchema>): Keypair {
  if (env.SERVER_KEYPAIR_SECRET && env.SERVER_KEYPAIR_SECRET.trim() !== "") {
    return Keypair.fromSecretKey(bs58.decode(env.SERVER_KEYPAIR_SECRET.trim()));
  }
  if (env.SERVER_KEYPAIR_PATH) {
    const raw = JSON.parse(readFileSync(env.SERVER_KEYPAIR_PATH, "utf8")) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  throw new Error("config: SERVER_KEYPAIR_PATH or SERVER_KEYPAIR_SECRET is required");
}

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("✗ invalid environment:", parsed.error.flatten().fieldErrors);
    throw new Error("config: invalid environment (see above)");
  }
  const env = parsed.data;
  const serverKeypair = loadKeypair(env);

  return {
    solanaRpcUrl: env.SOLANA_RPC_URL,
    magicblockRpcUrl: env.MAGICBLOCK_RPC_URL,
    erEnabled: env.MAGICBLOCK_ER_ENABLED.toLowerCase() === "true" && env.MAGICBLOCK_RPC_URL !== "",
    programId: env.PROGRAM_ID,
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    storageBucket: env.SUPABASE_STORAGE_BUCKET,
    port: env.PORT,
    clientOrigin: env.CLIENT_ORIGIN,
    clientOrigins: env.CLIENT_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean),
    adminToken: env.ADMIN_TOKEN,
    serverKeypair,
  };
}
