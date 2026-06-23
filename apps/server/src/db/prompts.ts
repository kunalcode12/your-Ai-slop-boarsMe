/** Prompts: creation, the atomic claim, expiry sweep, lifecycle transitions. */

import type { PromptType } from "@slop/shared";
import { getDb } from "./client";
import type { PromptRow } from "./types";

export interface CreatePromptInput {
  requesterId: string;
  type: PromptType;
  body: string;
  creditsCost: number;
  /** Unclaimed-expiry deadline (compute from PROMPT_EXPIRY_MS in the caller). */
  expiresAt: Date;
}

/** Insert a queued prompt + bump the requester's prompts_sent (atomic). */
export async function createPrompt(input: CreatePromptInput): Promise<PromptRow> {
  const { data, error } = await getDb().rpc("create_prompt", {
    p_requester_id: input.requesterId,
    p_type: input.type,
    p_body: input.body,
    p_credits_cost: input.creditsCost,
    p_expires_at: input.expiresAt.toISOString(),
  });
  if (error) throw new Error(`createPrompt: ${error.message}`);
  const row = data[0];
  if (!row) throw new Error("createPrompt: insert returned no row");
  return row;
}

/**
 * Atomically claim the oldest queued prompt the answerer didn't write. Returns
 * the claimed prompt, or null when nothing is eligible. Concurrency-safe via the
 * SELECT ... FOR UPDATE SKIP LOCKED inside the RPC — no two answerers can get
 * the same prompt. Callers should check ban/cooldown/rate-limits BEFORE this.
 */
export async function claimNextPromptForAnswerer(
  answererId: string,
): Promise<PromptRow | null> {
  const { data, error } = await getDb().rpc("claim_next_prompt", {
    p_answerer_id: answererId,
  });
  if (error) throw new Error(`claimNextPromptForAnswerer: ${error.message}`);
  return data[0] ?? null;
}

/**
 * Does this player have a queued prompt they wrote themselves? Used only to give
 * a helpful "you can't answer your own prompt" hint when a claim comes back empty
 * (common while testing both roles in one browser — same burner identity).
 */
export async function hasOwnQueuedPrompt(playerId: string): Promise<boolean> {
  const { data, error } = await getDb()
    .from("prompts")
    .select("id")
    .eq("status", "queued")
    .eq("requester_id", playerId)
    .limit(1);
  if (error) throw new Error(`hasOwnQueuedPrompt: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/**
 * Flip queued+overdue prompts to 'expired' and return them so the caller can
 * refund each requester (the refund is on-chain + applyCreditDelta).
 */
export async function expireStalePrompts(): Promise<PromptRow[]> {
  const { data, error } = await getDb().rpc("expire_stale_prompts", {});
  if (error) throw new Error(`expireStalePrompts: ${error.message}`);
  return data;
}

export async function markPromptAnswered(promptId: string): Promise<void> {
  const { error } = await getDb()
    .from("prompts")
    .update({ status: "answered" })
    .eq("id", promptId);
  if (error) throw new Error(`markPromptAnswered: ${error.message}`);
}

/**
 * Return a claimed prompt to the queue (answerer ghosted / timed out). Resets
 * claim fields and gives it a fresh expiry window (compute from PROMPT_EXPIRY_MS).
 */
export async function releasePromptToQueue(
  promptId: string,
  newExpiresAt: Date,
): Promise<void> {
  const { error } = await getDb()
    .from("prompts")
    .update({
      status: "queued",
      claimed_by: null,
      claimed_at: null,
      expires_at: newExpiresAt.toISOString(),
    })
    .eq("id", promptId);
  if (error) throw new Error(`releasePromptToQueue: ${error.message}`);
}

/** All queued prompts, oldest first — used to rebuild the in-memory queue on boot. */
export async function listQueuedPrompts(): Promise<PromptRow[]> {
  const { data, error } = await getDb()
    .from("prompts")
    .select("*")
    .eq("status", "queued")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listQueuedPrompts: ${error.message}`);
  return data;
}

/** All currently-claimed prompts — used on boot to re-queue orphaned claims. */
export async function listClaimedPrompts(): Promise<PromptRow[]> {
  const { data, error } = await getDb()
    .from("prompts")
    .select("*")
    .eq("status", "claimed");
  if (error) throw new Error(`listClaimedPrompts: ${error.message}`);
  return data;
}

export async function getPromptById(id: string): Promise<PromptRow | null> {
  const { data, error } = await getDb()
    .from("prompts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getPromptById: ${error.message}`);
  return data;
}
