/**
 * Socket.IO event names + typed payloads for the full game lifecycle.
 *
 * `SocketEvents` holds the runtime string constants used when emitting/handling.
 * `ServerToClientEvents` / `ClientToServerEvents` are the typed maps fed to the
 * Socket.IO generics on both ends. The string KEYS of those interfaces must
 * stay in sync with the values in `SocketEvents` (kept side-by-side on purpose).
 */

import type {
  Player,
  PublicPrompt,
  PromptStatus,
  AnswerType,
} from "./types";
import type {
  SubmitPromptInput,
  CancelPromptInput,
  RequestWorkInput,
  SubmitAnswerInput,
  ReportInput,
  PresenceModeInput,
} from "./schemas";

// ---------------------------------------------------------------------------
// Event-name constants
// ---------------------------------------------------------------------------

export const SocketEvents = {
  /** server -> client: full player snapshot (credits, refill countdown, state). */
  PlayerState: "player:state",

  /** client -> server: submit a prompt (human mode). */
  PromptSubmit: "prompt:submit",
  /** server -> client: ack that a prompt was queued (credits spent). */
  PromptSubmitted: "prompt:submitted",
  /** client -> server: cancel your own still-queued prompt (leaving / switching tab). */
  PromptCancel: "prompt:cancel",

  /** client -> server: request a prompt to answer (larp mode). */
  WorkRequest: "work:request",
  /** server -> client: a prompt was assigned to answer (timer started). */
  WorkAssigned: "work:assigned",
  /** server -> client: no work available (empty queue / throttled). */
  WorkNone: "work:none",
  /** server -> client: new work just hit the queue — idle larpers should re-request. */
  WorkAvailable: "work:available",

  /** client -> server: submit an answer to a claimed prompt. */
  AnswerSubmit: "answer:submit",
  /** server -> client (requester): an answer arrived for your prompt. */
  AnswerReceived: "answer:received",

  /** server -> client (requester): your unclaimed prompt expired (+ refund). */
  PromptExpired: "prompt:expired",

  /** server -> client: a credit balance change (spend/earn/refill/refund). */
  CreditsUpdated: "credits:updated",

  /** client -> server: report a prompt or answer for moderation. */
  Report: "report",

  /** client -> server: tell the server which mode (tab) you're in, for live counts. */
  PresenceMode: "presence:mode",
  /** server -> client: live online counts (everyone online, split human vs larp). */
  PresenceUpdate: "presence:update",

  /** server -> client: a friendly, client-facing error. */
  Error: "error",
} as const;

export type SocketEventName = (typeof SocketEvents)[keyof typeof SocketEvents];

// ---------------------------------------------------------------------------
// Payload shapes
// ---------------------------------------------------------------------------

export interface PlayerStatePayload {
  player: Player;
  /** Ms until the next refill tick (0 when already at cap). */
  refillCountdownMs: number;
  /** Work the player currently has claimed and must answer, if any. */
  activePrompt: PublicPrompt | null;
  /** Deadline (epoch ms) for `activePrompt`, if any. */
  activeDeadlineAt: number | null;
}

export interface PromptSubmittedPayload {
  promptId: string;
  status: PromptStatus;
  creditsRemaining: number;
}

export interface WorkAssignedPayload {
  prompt: PublicPrompt;
  /** Epoch ms when the 60s answer window closes. */
  deadlineAt: number;
}

export type WorkNoneReason = "empty_queue" | "rate_limited" | "cooldown" | "only_own";

export interface WorkNonePayload {
  reason: WorkNoneReason;
  /** When relevant (rate limit / cooldown), ms until the player may retry. */
  retryAfterMs?: number;
}

/** Pushed when a prompt enters the queue, so idle larpers re-request immediately. */
export interface WorkAvailablePayload {
  /** current number of prompts waiting in the queue. */
  queued: number;
}

export interface AnswerReceivedPayload {
  promptId: string;
  answer: {
    /** Answer id — lets the requester report THIS answer (not the prompt). */
    id: string;
    type: AnswerType;
    body: string | null;
    imageUrl: string | null;
    createdAt: number;
  };
}

export interface PromptExpiredPayload {
  promptId: string;
  refundedCredits: number;
}

/** Live presence counts. `online` == `humans` + `larpers` (one mode per client). */
export interface PresenceUpdatePayload {
  /** total connected clients (open sessions). */
  online: number;
  /** clients currently on the "human" (ask the ai) tab. */
  humans: number;
  /** clients currently on the "larp" (be the ai) tab. */
  larpers: number;
}

export type CreditChangeReason = "spend" | "earn" | "refill" | "refund";

export interface CreditsUpdatedPayload {
  credits: number;
  reason: CreditChangeReason;
  refillCountdownMs: number;
}

/** Stable, client-displayable error codes. Messages are lowercase + meme-y. */
export type ErrorCode =
  | "insufficient_credits"
  | "rate_limited"
  | "invalid_payload"
  | "prompt_not_found"
  | "not_your_work"
  | "deadline_passed"
  | "claim_cooldown"
  | "moderation_blocked"
  | "chain_error"
  | "internal_error";

export interface ErrorPayload {
  code: ErrorCode;
  message: string;
}

// ---------------------------------------------------------------------------
// Typed Socket.IO event maps
// (keys mirror SocketEvents values — keep in sync)
// ---------------------------------------------------------------------------

export interface ServerToClientEvents {
  "player:state": (payload: PlayerStatePayload) => void;
  "prompt:submitted": (payload: PromptSubmittedPayload) => void;
  "work:assigned": (payload: WorkAssignedPayload) => void;
  "work:none": (payload: WorkNonePayload) => void;
  "work:available": (payload: WorkAvailablePayload) => void;
  "answer:received": (payload: AnswerReceivedPayload) => void;
  "prompt:expired": (payload: PromptExpiredPayload) => void;
  "credits:updated": (payload: CreditsUpdatedPayload) => void;
  "presence:update": (payload: PresenceUpdatePayload) => void;
  "error": (payload: ErrorPayload) => void;
}

export interface ClientToServerEvents {
  "prompt:submit": (payload: SubmitPromptInput) => void;
  "prompt:cancel": (payload: CancelPromptInput) => void;
  "work:request": (payload: RequestWorkInput) => void;
  "answer:submit": (payload: SubmitAnswerInput) => void;
  "report": (payload: ReportInput) => void;
  "presence:mode": (payload: PresenceModeInput) => void;
}

/** Per-socket data the server attaches after the handshake. */
export interface SocketData {
  pubkey: string;
}

/** Inter-server events (unused today; reserved for horizontal scaling). */
export interface InterServerEvents {
  ping: () => void;
}
