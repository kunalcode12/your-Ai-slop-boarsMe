/**
 * Economy, timing, rate-limit and moderation constants.
 *
 * This file is the SINGLE source of truth for these numbers. The frontend, the
 * game server, and (where relevant) the on-chain program all derive their
 * behaviour from here. Changing a number here changes it everywhere.
 */

// ---------------------------------------------------------------------------
// Credit economy
// ---------------------------------------------------------------------------

/** Cost to submit a text prompt to the "AI". */
export const CREDIT_COST_TEXT = 1;

/** Cost to submit an image request to the "AI". */
export const CREDIT_COST_IMAGE = 2;

/** Credits awarded to an answerer for each accepted answer. */
export const CREDIT_REWARD_ANSWER = 1;

/** Maximum credits a player can hold (refill cap). */
export const MAX_CREDITS = 5;

/** Credits a brand-new player starts with so the site is usable immediately. */
export const STARTING_CREDITS = 3;

// ---------------------------------------------------------------------------
// Refill (passive top-up so new users aren't stuck)
// ---------------------------------------------------------------------------

/** How often a passive refill tick happens. */
export const REFILL_INTERVAL_MS = 3 * 60_000; // 3 minutes

/** Credits granted per refill tick (capped at MAX_CREDITS). */
export const REFILL_AMOUNT = 1;

// ---------------------------------------------------------------------------
// Timers / lifecycle
// ---------------------------------------------------------------------------

/** Hard server-side limit an answerer has to fulfil a claimed prompt. */
export const ANSWER_TIME_LIMIT_MS = 60_000; // 60 seconds

/** How long an UNCLAIMED prompt waits in the queue before it expires + refunds. */
export const PROMPT_EXPIRY_MS = 5 * 60_000; // 5 minutes

/**
 * Cooldown applied to an answerer who claimed work then ghosted (disconnect /
 * let the timer run out). Deters claim-and-ghost griefing while still letting a
 * genuine (just-too-slow) answerer rejoin quickly.
 */
export const CLAIM_COOLDOWN_MS = 10_000; // 10 seconds

// ---------------------------------------------------------------------------
// Rate limits (per player) — basic anti-bot / anti-spam
// ---------------------------------------------------------------------------

export const RATE_LIMIT_PROMPTS_PER_MIN = 5;
export const RATE_LIMIT_CLAIMS_PER_MIN = 10;
export const RATE_LIMIT_REPORTS_PER_MIN = 10;

// ---------------------------------------------------------------------------
// Reputation / moderation
// ---------------------------------------------------------------------------

/** Reputation every player starts with. */
export const REPUTATION_START = 100;

/** Reputation lost for claiming work then ghosting. */
export const REPUTATION_GHOST_PENALTY = 5;

/** Reputation lost when one of your answers is upheld as abusive. */
export const REPUTATION_REPORT_PENALTY = 10;

/**
 * At/below this reputation a player is "shadow-throttled": still playable, but
 * their prompts/answers are de-prioritised and rate limits tightened.
 */
export const REPUTATION_SHADOW_THROTTLE_THRESHOLD = 50;

/** Reports against a single answer that trigger an automatic hide. */
export const AUTO_HIDE_REPORT_COUNT = 3;

// ---------------------------------------------------------------------------
// Content size limits (anti-abuse + storage sanity)
// ---------------------------------------------------------------------------

/** Max characters in a submitted prompt. */
export const MAX_PROMPT_LENGTH = 1_000;

/** Max characters in a text answer. */
export const MAX_ANSWER_LENGTH = 4_000;

/** Max bytes for an uploaded drawing PNG. */
export const MAX_DRAWING_BYTES = 2 * 1024 * 1024; // 2 MB
