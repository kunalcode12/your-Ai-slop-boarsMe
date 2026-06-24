/** Dependency-injection factory: builds the real Services container. */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ANSWER_TIME_LIMIT_MS,
  PROMPT_EXPIRY_MS,
  CLAIM_COOLDOWN_MS,
} from "@slop/shared";
import type { AppConfig } from "../config";
import {
  getDb,
  upsertPlayerByPubkey,
  getPlayer,
  getPlayerById,
  applyCreditDelta,
  syncCachedCredits,
  setClaimCooldown,
  adjustReputation,
  banPlayer,
  createPrompt,
  claimNextPromptForAnswerer,
  hasOwnQueuedPrompt,
  cancelQueuedPrompt,
  cancelQueuedPromptsForRequester,
  expireStalePrompts,
  markPromptAnswered,
  releasePromptToQueue,
  listQueuedPrompts,
  listClaimedPrompts,
  getPromptById,
  createAnswer,
  getAnswerById,
  markAnswerDelivered,
  getUndeliveredAnswersForRequester,
  createReport,
  countReportsForTarget,
  hideTargetIfOverThreshold,
  listReports,
  getReportById,
  setReportStatus,
  hideTarget,
} from "../db";
import { createCreditsClient } from "../chain/client";
import { PresenceService } from "./presence";
import { InMemoryQueue } from "./queue";
import { ClaimTimers } from "./timers";
import { TokenBucketLimiter } from "./ratelimit";
import { BasicModeration } from "./moderation";
import { SupabaseStorage } from "./storage";
import { ChainCreditsBridge } from "./credits";
import type { Db, Logger, Services, TypedServer } from "../types";

/** The data layer assembled into the injectable `Db` shape. */
const realDb: Db = {
  upsertPlayerByPubkey,
  getPlayer,
  getPlayerById,
  applyCreditDelta,
  syncCachedCredits,
  setClaimCooldown,
  adjustReputation,
  banPlayer,
  createPrompt,
  claimNextPromptForAnswerer,
  hasOwnQueuedPrompt,
  cancelQueuedPrompt,
  cancelQueuedPromptsForRequester,
  expireStalePrompts,
  markPromptAnswered,
  releasePromptToQueue,
  listQueuedPrompts,
  listClaimedPrompts,
  getPromptById,
  createAnswer,
  getAnswerById,
  markAnswerDelivered,
  getUndeliveredAnswersForRequester,
  createReport,
  countReportsForTarget,
  hideTargetIfOverThreshold,
  listReports,
  getReportById,
  setReportStatus,
  hideTarget,
};

export interface BuiltServer {
  services: Services;
  shutdown(): void;
}

export function createServices(config: AppConfig, io: TypedServer, log: Logger): BuiltServer {
  const client = createCreditsClient(config);
  const presence = new PresenceService();
  const queue = new InMemoryQueue();
  const timers = new ClaimTimers();
  const rateLimits = new TokenBucketLimiter();
  const moderation = new BasicModeration();
  const storage = new SupabaseStorage(getDb() as unknown as SupabaseClient, config.storageBucket);
  const credits = new ChainCreditsBridge(client, realDb, presence, io, log);

  const services: Services = {
    io,
    db: realDb,
    credits,
    storage,
    moderation,
    rateLimits,
    queue,
    timers,
    presence,
    timings: {
      answerTimeLimitMs: ANSWER_TIME_LIMIT_MS,
      promptExpiryMs: PROMPT_EXPIRY_MS,
      claimCooldownMs: CLAIM_COOLDOWN_MS,
    },
    log,
  };

  return {
    services,
    shutdown: () => {
      credits.stop();
      timers.clearAll();
    },
  };
}
