/**
 * Burner identity. A keypair is generated on first visit and persisted in
 * IndexedDB; the SECRET KEY never leaves the browser and is never sent to the
 * server. Only the public key is used (socket handshake). The keypair is kept in
 * module memory for optional future signing (the PROMPT-4 challenge is reserved).
 */

import "./polyfill"; // must run before web3.js (Buffer global)
import { Keypair } from "@solana/web3.js";
import { idbGet, idbSet } from "./idb";

const KEY = "burner-secret"; // stores number[] of the 64-byte secret key

let cached: Keypair | null = null;

export interface Burner {
  publicKey: string;
}

export async function getOrCreateBurner(): Promise<Burner> {
  if (cached) return { publicKey: cached.publicKey.toBase58() };

  const stored = await idbGet<number[]>(KEY);
  if (stored && stored.length === 64) {
    cached = Keypair.fromSecretKey(Uint8Array.from(stored));
  } else {
    cached = Keypair.generate();
    await idbSet(KEY, Array.from(cached.secretKey));
  }
  return { publicKey: cached.publicKey.toBase58() };
}

/** In-memory keypair accessor (for future challenge signing). Never serialize. */
export function currentKeypair(): Keypair | null {
  return cached;
}
