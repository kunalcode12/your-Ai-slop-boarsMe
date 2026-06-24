/** Server-internal types + the dependency-injection interfaces. */

import type { Server, Socket } from "socket.io";
import type { PublicKey } from "@solana/web3.js";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
  CreditChangeReason,
  ClientMode,
  PresenceUpdatePayload,
} from "@slop/shared";
import type {
  PlayerRow,
  PromptRow,
  AnswerRow,
  ReportRow,
  ReportTargetType,
  ReportStatus,
  CreatePromptInput,
  CreateAnswerInput,
  CreateReportInput,
} from "./db";

export type TypedServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;
export type TypedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

/** Per-connected-player in-memory state (the fast path; chain is the truth). */
export interface PlayerSession {
  playerId: string; // players.id (uuid)
  pubkey: string; // burner/wallet pubkey (base58)
  authority: PublicKey;
  credits: number; // cached, kept in sync with chain
  lastRefillMs: number; // epoch ms of on-chain last_refill
  reputation: number;
  shadowThrottled: boolean;
}

/** Minimal identity needed to move credits (works offline too). */
export interface CreditTarget {
  playerId: string;
  pubkey: string;
  authority: PublicKey;
}

/**
 * The PROMPT-2 data layer surface the server uses. The real implementation is
 * the `@slop/server/db` module; tests provide an in-memory fake.
 */
export interface Db {
  upsertPlayerByPubkey(pubkey: string): Promise<PlayerRow>;
  getPlayer(pubkey: string): Promise<PlayerRow | null>;
  getPlayerById(id: string): Promise<PlayerRow | null>;
  applyCreditDelta(
    playerId: string,
    delta: number,
    reason: CreditChangeReason,
    onchainSig?: string | null,
  ): Promise<number>;
  syncCachedCredits(playerId: string, credits: number): Promise<void>;
  setClaimCooldown(playerId: string, until: Date | null): Promise<void>;
  adjustReputation(playerId: string, delta: number): Promise<number>;
  banPlayer(playerId: string): Promise<void>;
  createPrompt(input: CreatePromptInput): Promise<PromptRow>;
  claimNextPromptForAnswerer(answererId: string): Promise<PromptRow | null>;
  hasOwnQueuedPrompt(playerId: string): Promise<boolean>;
  cancelQueuedPrompt(promptId: string, requesterId: string): Promise<PromptRow | null>;
  cancelQueuedPromptsForRequester(requesterId: string): Promise<PromptRow[]>;
  expireStalePrompts(): Promise<PromptRow[]>;
  markPromptAnswered(promptId: string): Promise<void>;
  releasePromptToQueue(promptId: string, newExpiresAt: Date): Promise<void>;
  getPromptById(id: string): Promise<PromptRow | null>;
  listQueuedPrompts(): Promise<PromptRow[]>;
  listClaimedPrompts(): Promise<PromptRow[]>;
  createAnswer(input: CreateAnswerInput): Promise<AnswerRow | null>;
  getAnswerById(id: string): Promise<AnswerRow | null>;
  markAnswerDelivered(answerId: string): Promise<void>;
  getUndeliveredAnswersForRequester(requesterId: string): Promise<AnswerRow[]>;
  createReport(input: CreateReportInput): Promise<ReportRow>;
  countReportsForTarget(targetType: ReportTargetType, targetId: string): Promise<number>;
  hideTargetIfOverThreshold(
    targetType: ReportTargetType,
    targetId: string,
    threshold: number,
  ): Promise<boolean>;
  // admin / mod-review surface
  listReports(status?: ReportStatus | "all", limit?: number): Promise<ReportRow[]>;
  getReportById(id: string): Promise<ReportRow | null>;
  setReportStatus(id: string, status: ReportStatus): Promise<void>;
  hideTarget(targetType: ReportTargetType, targetId: string): Promise<void>;
}

/**
 * The chain bridge. ALL credit changes go through this; it does the on-chain op
 * FIRST, then mirrors to the ledger/cache and emits credits:updated. Throws
 * AppError("insufficient_credits"|"chain_error") from spend on failure.
 */
export interface CreditsBridge {
  ensurePlayer(target: CreditTarget): Promise<void>;
  reconcile(session: PlayerSession): Promise<void>;
  applyDueRefill(session: PlayerSession): Promise<void>;
  spend(session: PlayerSession, amount: number): Promise<number>;
  earn(target: CreditTarget): Promise<void>;
  refund(target: CreditTarget, amount: number): Promise<void>;
  /** MagicBlock ER: delegate a connected player's PDA to the rollup (no-op unless
   *  ER is enabled). Safe to call repeatedly; runs in the background. */
  ensureDelegated(session: PlayerSession): Promise<void>;
  /** MagicBlock ER: commit + undelegate (settle to devnet) when a player leaves. */
  undelegateIfNeeded(target: CreditTarget): Promise<void>;
  /** Whether ER routing is enabled on this server (for UI/status). */
  readonly erActive: boolean;
}

export interface StorageService {
  /** Upload a PNG buffer, returns the storage object path (not a URL). */
  uploadDrawing(promptId: string, png: Buffer): Promise<string>;
  /** Mint a short-lived signed URL for a stored object path. */
  signedUrl(path: string): Promise<string>;
}

export interface ModerationService {
  /** Hard content check. blocked=true means: never persist. */
  checkText(text: string): { blocked: boolean; reason?: string };
  hasMinEffortText(text: string): boolean;
  hasMinEffortDrawing(png: Buffer): boolean;
  decodeImageDataUrl(dataUrl: string): { ok: boolean; buffer?: Buffer; reason?: string };
}

export type RateAction = "prompt" | "claim" | "report";

export interface RateLimiter {
  /** Consume a token; false if over the limit. `shadow` tightens the limit. */
  take(pubkey: string, action: RateAction, shadow: boolean): boolean;
  retryAfterMs(pubkey: string, action: RateAction): number;
}

export interface QueueService {
  rebuild(db: Db): Promise<void>;
  push(promptId: string): void;
  remove(promptId: string): void;
  size(): number;
}

export interface ClaimInfo {
  promptId: string;
  answererId: string;
  answererPubkey: string;
  socketId: string;
  startedAt: number;
  deadlineAt: number;
  processing: boolean; // idempotency guard against double answer:submit
}

export interface TimerService {
  startClaim(info: ClaimInfo, onTimeout: (info: ClaimInfo) => void): void;
  get(promptId: string): ClaimInfo | undefined;
  getBySocket(socketId: string): ClaimInfo[];
  clear(promptId: string): void;
  clearAll(): void;
  /** Synchronous per-socket lock so concurrent work:request can't double-claim. */
  lock(socketId: string): boolean;
  unlock(socketId: string): void;
}

export interface Presence {
  bind(pubkey: string): void;
  unbind(pubkey: string): void;
  isOnline(pubkey: string): boolean;
  setSession(pubkey: string, session: PlayerSession): void;
  getSession(pubkey: string): PlayerSession | undefined;
  clearSession(pubkey: string): void;
  // live online counts (per-socket mode tracking, drives presence:update)
  setSocketMode(socketId: string, mode: ClientMode): void;
  dropSocket(socketId: string): void;
  liveCounts(): PresenceUpdatePayload;
}

/** Timing knobs (overridable in tests so the 60s timer can be shortened). */
export interface Timings {
  answerTimeLimitMs: number;
  promptExpiryMs: number;
  claimCooldownMs: number;
}

/** The full service container handed to socket handlers. */
export interface Services {
  io: TypedServer;
  db: Db;
  credits: CreditsBridge;
  storage: StorageService;
  moderation: ModerationService;
  rateLimits: RateLimiter;
  queue: QueueService;
  timers: TimerService;
  presence: Presence;
  timings: Timings;
  log: Logger;
}
