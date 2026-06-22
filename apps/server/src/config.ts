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
  PROGRAM_ID: z.string().min(32),
  SERVER_KEYPAIR_PATH: z.string().optional(),
  SERVER_KEYPAIR_SECRET: z.string().optional(),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(10),
  SUPABASE_STORAGE_BUCKET: z.string().default("slop-drawings"),
  PORT: z.coerce.number().int().positive().default(8080),
  CLIENT_ORIGIN: z.string().default("http://localhost:3000"),
});

export interface AppConfig {
  solanaRpcUrl: string;
  magicblockRpcUrl: string;
  programId: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  storageBucket: string;
  port: number;
  clientOrigin: string;
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
    programId: env.PROGRAM_ID,
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    storageBucket: env.SUPABASE_STORAGE_BUCKET,
    port: env.PORT,
    clientOrigin: env.CLIENT_ORIGIN,
    serverKeypair,
  };
}
