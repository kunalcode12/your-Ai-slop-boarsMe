/**
 * Domain enums/unions and the core records shared between client and server.
 *
 * Unions are paired with a runtime `*_TYPES` tuple so zod (and any UI dropdown)
 * can iterate the allowed values without drifting from the type.
 */

// ---------------------------------------------------------------------------
// Enums / union types
// ---------------------------------------------------------------------------

export const PROMPT_TYPES = ["text", "image"] as const;
export type PromptType = (typeof PROMPT_TYPES)[number];

export const ANSWER_TYPES = ["text", "image"] as const;
export type AnswerType = (typeof ANSWER_TYPES)[number];

export const PROMPT_STATUSES = [
  "queued", // waiting in the queue, unclaimed
  "claimed", // an answerer has it; 60s timer running
  "answered", // answered (delivered or pending delivery)
  "expired", // sat unclaimed past expiry; requester refunded
  "flagged", // hidden by moderation (reports / auto-hide)
] as const;
export type PromptStatus = (typeof PROMPT_STATUSES)[number];

// ---------------------------------------------------------------------------
// Domain records
// ---------------------------------------------------------------------------

/**
 * A player, keyed by their burner pubkey. `credits`/`reputation` here are the
 * OFF-CHAIN cache; the on-chain program is the source of truth for credits and
 * is reconciled on read. Timestamps are epoch milliseconds.
 */
export interface Player {
  pubkey: string;
  credits: number;
  reputation: number;
  /** Epoch ms of the last refill tick applied — used to compute the countdown. */
  lastRefillAt: number;
  createdAt: number;
  /** True when reputation is at/below the shadow-throttle threshold. */
  shadowThrottled: boolean;
}

/** Full prompt record as stored server-side (includes requester identity). */
export interface Prompt {
  id: string;
  type: PromptType;
  /** Prompt text, or the textual description of an image request. */
  body: string;
  requesterPubkey: string;
  status: PromptStatus;
  createdAt: number;
  /** When an UNCLAIMED prompt expires (and the requester is refunded). */
  expiresAt: number;
  claimedBy: string | null;
  claimedAt: number | null;
  answerId: string | null;
}

/** An answer to a prompt. Drawings live in object storage; we keep the URL. */
export interface Answer {
  id: string;
  promptId: string;
  type: AnswerType;
  /** Text answer body (null for image answers). */
  body: string | null;
  /** URL of the uploaded drawing PNG (null for text answers). */
  imageUrl: string | null;
  answererPubkey: string;
  createdAt: number;
  /** Whether the answer has reached the requester yet. */
  delivered: boolean;
  /** Hidden by moderation (manual or auto-hide threshold). */
  hidden: boolean;
  reportCount: number;
}

/**
 * The version of a prompt that is safe to hand to an ANSWERER.
 * Deliberately omits `requesterPubkey` and anything that could deanonymise the
 * person who asked.
 */
export interface PublicPrompt {
  id: string;
  type: PromptType;
  body: string;
  createdAt: number;
  expiresAt: number;
}
