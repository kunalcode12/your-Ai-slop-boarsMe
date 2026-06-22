/**
 * Map DB rows (snake_case, ISO timestamps, player UUID FKs) to the @slop/shared
 * domain/wire types (camelCase, epoch-ms timestamps, pubkeys).
 *
 * Note the FK gap: shared `Prompt`/`Answer` identify players by pubkey, but rows
 * carry player UUIDs. Mappers that need a pubkey take it as an argument so the
 * caller (which already knows it) supplies it — we don't hide a join in here.
 * `PublicPrompt` carries no identity, so it maps cleanly with no extra input.
 */

import type { Player, PublicPrompt } from "@slop/shared";
import { REPUTATION_SHADOW_THROTTLE_THRESHOLD } from "@slop/shared";
import type { PlayerRow, PromptRow } from "./types";

export function toEpochMs(iso: string): number {
  return new Date(iso).getTime();
}

export function rowToPlayer(row: PlayerRow): Player {
  return {
    pubkey: row.wallet_pubkey,
    credits: row.credits_cached,
    reputation: row.reputation,
    lastRefillAt: toEpochMs(row.last_refill_at),
    createdAt: toEpochMs(row.created_at),
    shadowThrottled: row.reputation <= REPUTATION_SHADOW_THROTTLE_THRESHOLD,
  };
}

/** The answerer-safe view of a prompt: no requester identity. */
export function rowToPublicPrompt(row: PromptRow): PublicPrompt {
  return {
    id: row.id,
    type: row.type,
    body: row.body,
    createdAt: toEpochMs(row.created_at),
    expiresAt: toEpochMs(row.expires_at),
  };
}
