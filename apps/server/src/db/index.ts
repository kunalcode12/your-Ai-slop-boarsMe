/**
 * Data-access layer. The game logic (PROMPT 4) imports from here, never the
 * Supabase client directly.
 *
 * Functions return DB Row types (fully typed, snake_case). Use the mappers to
 * convert to @slop/shared domain/wire types where needed. Credit reads are
 * advisory — the on-chain program is the source of truth (PROMPT 3/4 reconcile).
 */

export { getDb, setDb, unwrap, type SlopDb } from "./client";

export type {
  Database,
  PlayerRow,
  PromptRow,
  AnswerRow,
  CreditLedgerRow,
  ReportRow,
  SessionRow,
  ReportTargetType,
  ReportStatus,
} from "./types";

export { toEpochMs, rowToPlayer, rowToPublicPrompt } from "./mappers";

export {
  upsertPlayerByPubkey,
  getPlayer,
  getPlayerById,
  applyCreditDelta,
  syncCachedCredits,
  setClaimCooldown,
  adjustReputation,
  banPlayer,
} from "./players";

export {
  createPrompt,
  claimNextPromptForAnswerer,
  expireStalePrompts,
  markPromptAnswered,
  releasePromptToQueue,
  listQueuedPrompts,
  listClaimedPrompts,
  getPromptById,
  type CreatePromptInput,
} from "./prompts";

export {
  createAnswer,
  getAnswerById,
  markAnswerDelivered,
  getUndeliveredAnswersForRequester,
  type CreateAnswerInput,
} from "./answers";

export {
  createReport,
  countReportsForTarget,
  hideTargetIfOverThreshold,
  listReports,
  getReportById,
  setReportStatus,
  hideTarget,
  type CreateReportInput,
} from "./reports";
