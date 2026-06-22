/** Player records, credit cache, reputation, moderation flags. */

import type { CreditChangeReason } from "@slop/shared";
import { getDb } from "./client";
import type { PlayerRow } from "./types";

/** Create the player on first sight, or return the existing one. */
export async function upsertPlayerByPubkey(pubkey: string): Promise<PlayerRow> {
  const { data, error } = await getDb()
    .from("players")
    .upsert({ wallet_pubkey: pubkey }, { onConflict: "wallet_pubkey" })
    .select()
    .single();
  if (error) throw new Error(`upsertPlayerByPubkey: ${error.message}`);
  return data;
}

export async function getPlayer(pubkey: string): Promise<PlayerRow | null> {
  const { data, error } = await getDb()
    .from("players")
    .select("*")
    .eq("wallet_pubkey", pubkey)
    .maybeSingle();
  if (error) throw new Error(`getPlayer: ${error.message}`);
  return data;
}

export async function getPlayerById(id: string): Promise<PlayerRow | null> {
  const { data, error } = await getDb()
    .from("players")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getPlayerById: ${error.message}`);
  return data;
}

/**
 * Apply a credit change to the OFF-CHAIN cache and append a ledger row, in one
 * transaction. Returns the new cached balance. The chain (PROMPT 3) is the real
 * source of truth; pass `onchainSig` once the settling tx is known so the ledger
 * can be reconciled.
 */
export async function applyCreditDelta(
  playerId: string,
  delta: number,
  reason: CreditChangeReason,
  onchainSig: string | null = null,
): Promise<number> {
  const { data, error } = await getDb().rpc("apply_credit_delta", {
    p_player_id: playerId,
    p_delta: delta,
    p_reason: reason,
    p_onchain_sig: onchainSig,
  });
  if (error) throw new Error(`applyCreditDelta: ${error.message}`);
  return data;
}

/**
 * Force the cached balance to a known value (e.g. after reconciling against the
 * on-chain truth). Writes NO ledger row — this is a cache sync, not a movement.
 */
export async function syncCachedCredits(playerId: string, credits: number): Promise<void> {
  const { error } = await getDb()
    .from("players")
    .update({ credits_cached: credits })
    .eq("id", playerId);
  if (error) throw new Error(`syncCachedCredits: ${error.message}`);
}

/** Set (or clear, with null) the cooldown that blocks claiming new work. */
export async function setClaimCooldown(
  playerId: string,
  until: Date | null,
): Promise<void> {
  const { error } = await getDb()
    .from("players")
    .update({ claim_cooldown_until: until ? until.toISOString() : null })
    .eq("id", playerId);
  if (error) throw new Error(`setClaimCooldown: ${error.message}`);
}

/** Relative reputation change (negative for penalties). Returns new reputation. */
export async function adjustReputation(
  playerId: string,
  delta: number,
): Promise<number> {
  const { data, error } = await getDb().rpc("adjust_reputation", {
    p_player_id: playerId,
    p_delta: delta,
  });
  if (error) throw new Error(`adjustReputation: ${error.message}`);
  return data;
}

export async function banPlayer(playerId: string): Promise<void> {
  const { error } = await getDb()
    .from("players")
    .update({ banned: true })
    .eq("id", playerId);
  if (error) throw new Error(`banPlayer: ${error.message}`);
}
