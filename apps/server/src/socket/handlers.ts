/** Socket event handlers. Each is wrapped in try/catch → typed error emit. */

import {
  CREDIT_COST_IMAGE,
  CREDIT_COST_TEXT,
  AUTO_HIDE_REPORT_COUNT,
  REPUTATION_REPORT_PENALTY,
  SocketEvents,
  submitPromptSchema,
  cancelPromptSchema,
  requestWorkSchema,
  submitAnswerSchema,
  reportSchema,
} from "@slop/shared";
import { rowToPublicPrompt } from "../db";
import { AppError } from "../errors";
import type { ClaimInfo, PlayerSession, Services, TypedSocket } from "../types";
import { deliverAnswer, releaseClaim } from "./lifecycle";

// ---------------------------------------------------------------------------
// human flow — submit a prompt to the "AI"
// ---------------------------------------------------------------------------
export async function submitPrompt(
  services: Services,
  socket: TypedSocket,
  session: PlayerSession,
  raw: unknown,
): Promise<void> {
  const input = submitPromptSchema.parse(raw);
  const { db, credits, queue, moderation, rateLimits, timings } = services;

  if (!rateLimits.take(session.pubkey, "prompt", session.shadowThrottled)) {
    throw new AppError("rate_limited", "slow down, you're not an enterprise customer 💀");
  }
  if (moderation.checkText(input.body).blocked) {
    throw new AppError("moderation_blocked", "that prompt got blocked 💀");
  }

  const cost = input.type === "image" ? CREDIT_COST_IMAGE : CREDIT_COST_TEXT;
  if (session.credits < cost) {
    throw new AppError("insufficient_credits", "you need more credits — go be an ai for a bit 💀");
  }

  // spend on-chain FIRST; only create the prompt if it succeeds
  const creditsRemaining = await credits.spend(session, cost);

  const prompt = await db.createPrompt({
    requesterId: session.playerId,
    type: input.type,
    body: input.body,
    creditsCost: cost,
    expiresAt: new Date(Date.now() + timings.promptExpiryMs),
  });
  queue.push(prompt.id);

  // nudge idle larpers in real time so they pick up the new prompt without
  // having to manually re-request work.
  services.io.emit(SocketEvents.WorkAvailable, { queued: queue.size() });

  socket.emit(SocketEvents.PromptSubmitted, {
    promptId: prompt.id,
    status: "queued",
    creditsRemaining,
  });
}

// ---------------------------------------------------------------------------
// human flow — cancel your own still-queued prompt (leaving / switching tab)
// ---------------------------------------------------------------------------
export async function cancelPrompt(
  services: Services,
  socket: TypedSocket,
  session: PlayerSession,
  raw: unknown,
): Promise<void> {
  const { promptId } = cancelPromptSchema.parse(raw);
  const { db, credits, queue } = services;

  // Only succeeds if it's still queued AND owned by this player. If a larper has
  // already claimed it, this is a no-op (they get to finish + earn).
  const cancelled = await db.cancelQueuedPrompt(promptId, session.playerId);
  if (!cancelled) return;

  queue.remove(cancelled.id);
  // give the credit back (chain-first refund; auto-retried if the chain hiccups)
  await credits.refund(session, cancelled.credits_cost);
  socket.emit(SocketEvents.PromptExpired, {
    promptId: cancelled.id,
    refundedCredits: cancelled.credits_cost,
  });
}

// ---------------------------------------------------------------------------
// larp flow — request a prompt to answer
// ---------------------------------------------------------------------------
export async function requestWork(
  services: Services,
  socket: TypedSocket,
  session: PlayerSession,
  raw: unknown,
): Promise<void> {
  requestWorkSchema.parse(raw);
  const { db, queue, timers, rateLimits, timings } = services;

  // synchronous lock: concurrent work:request from the same socket can't double-claim
  if (!timers.lock(socket.id)) return;
  try {
    // idempotency: already holding a claim → re-send it, never double-claim
    const existing = timers.getBySocket(socket.id)[0];
    if (existing) {
      const prompt = await db.getPromptById(existing.promptId);
      if (prompt) {
        socket.emit(SocketEvents.WorkAssigned, {
          prompt: rowToPublicPrompt(prompt),
          deadlineAt: existing.deadlineAt,
        });
      }
      return;
    }

    const playerRow = await db.getPlayerById(session.playerId);
    if (!playerRow || playerRow.banned) {
      throw new AppError("moderation_blocked", "you're banned 💀");
    }
    if (playerRow.claim_cooldown_until && new Date(playerRow.claim_cooldown_until) > new Date()) {
      const retryAfterMs = new Date(playerRow.claim_cooldown_until).getTime() - Date.now();
      socket.emit(SocketEvents.WorkNone, { reason: "cooldown", retryAfterMs });
      return;
    }
    if (!rateLimits.take(session.pubkey, "claim", session.shadowThrottled)) {
      socket.emit(SocketEvents.WorkNone, {
        reason: "rate_limited",
        retryAfterMs: rateLimits.retryAfterMs(session.pubkey, "claim"),
      });
      return;
    }

    // atomic claim (excludes own prompts, already-claimed, expired)
    const claimed = await db.claimNextPromptForAnswerer(session.playerId);
    if (!claimed) {
      // distinguish "nothing waiting" from "the only thing waiting is YOUR own
      // prompt" — you can't be the ai for your own question. The latter is common
      // when one person tests both tabs in the same browser (same burner identity).
      const onlyOwn = await db.hasOwnQueuedPrompt(session.playerId);
      socket.emit(SocketEvents.WorkNone, { reason: onlyOwn ? "only_own" : "empty_queue" });
      return;
    }
    queue.remove(claimed.id);

    const startedAt = Date.now();
    const deadlineAt = startedAt + timings.answerTimeLimitMs;
    const info: ClaimInfo = {
      promptId: claimed.id,
      answererId: session.playerId,
      answererPubkey: session.pubkey,
      socketId: socket.id,
      startedAt,
      deadlineAt,
      processing: false,
    };
    timers.startClaim(info, (i) => void releaseClaim(services, i, { penalize: true }));

    socket.emit(SocketEvents.WorkAssigned, {
      prompt: rowToPublicPrompt(claimed),
      deadlineAt,
    });
  } finally {
    timers.unlock(socket.id);
  }
}

// ---------------------------------------------------------------------------
// answer flow — submit an answer to a claimed prompt
// ---------------------------------------------------------------------------
export async function submitAnswer(
  services: Services,
  socket: TypedSocket,
  session: PlayerSession,
  raw: unknown,
): Promise<void> {
  const input = submitAnswerSchema.parse(raw);
  const { db, credits, storage, moderation, timers, timings } = services;

  const claim = timers.get(input.promptId);
  if (!claim || claim.socketId !== socket.id || claim.answererId !== session.playerId) {
    throw new AppError("not_your_work", "that's not your prompt to answer 💀");
  }
  if (claim.processing) return; // a submit is already in flight (idempotency)
  if (Date.now() > claim.deadlineAt) {
    throw new AppError("deadline_passed", "too slow — sam altman burned your H100 🔥");
  }

  claim.processing = true;
  try {
    let bodyText: string | null = null;
    let imagePath: string | null = null;

    if (input.type === "text") {
      const text = (input.body ?? "").trim();
      if (!moderation.hasMinEffortText(text)) {
        throw new AppError("moderation_blocked", "put in a little effort 💀");
      }
      if (moderation.checkText(text).blocked) {
        throw new AppError("moderation_blocked", "that answer got blocked 💀");
      }
      bodyText = text;
    } else {
      const dec = moderation.decodeImageDataUrl(input.imageDataUrl ?? "");
      if (!dec.ok || !dec.buffer) {
        throw new AppError("invalid_payload", dec.reason ?? "bad image");
      }
      if (!moderation.hasMinEffortDrawing(dec.buffer)) {
        throw new AppError("moderation_blocked", "draw something real 💀");
      }
      imagePath = await storage.uploadDrawing(input.promptId, dec.buffer);
    }

    // guarded write: the RPC also re-checks the claim is valid + in-time
    const answer = await db.createAnswer({
      promptId: input.promptId,
      answererId: session.playerId,
      type: input.type,
      bodyText,
      imageUrl: imagePath,
      timeTakenMs: Date.now() - claim.startedAt,
      timeLimitMs: timings.answerTimeLimitMs,
    });
    if (!answer) {
      throw new AppError("deadline_passed", "that claim is no longer valid 💀");
    }

    await db.markPromptAnswered(input.promptId);
    timers.clear(input.promptId); // success → claim consumed

    // award the answerer (+1). Never blocks: keeps the answer even if earn fails (queued retry)
    await credits.earn(session);

    // deliver to the requester (or leave for their reconnect)
    const prompt = await db.getPromptById(input.promptId);
    if (prompt) {
      const requester = await db.getPlayerById(prompt.requester_id);
      if (requester && services.presence.isOnline(requester.wallet_pubkey)) {
        await deliverAnswer(services, answer, requester.wallet_pubkey);
      }
    }
  } catch (e) {
    claim.processing = false; // allow a genuine retry
    throw e;
  }
}

// ---------------------------------------------------------------------------
// moderation — report a prompt or answer
// ---------------------------------------------------------------------------
export async function report(
  services: Services,
  _socket: TypedSocket,
  session: PlayerSession,
  raw: unknown,
): Promise<void> {
  const input = reportSchema.parse(raw);
  const { db, rateLimits, log } = services;

  if (!rateLimits.take(session.pubkey, "report", session.shadowThrottled)) {
    throw new AppError("rate_limited", "too many reports, slow down 💀");
  }

  const targetType = input.answerId ? "answer" : "prompt";
  const targetId = (input.answerId ?? input.promptId) as string;

  await db.createReport({
    targetType,
    targetId,
    reporterId: session.playerId,
    reason: input.reason ?? null,
  });

  const hidden = await db.hideTargetIfOverThreshold(targetType, targetId, AUTO_HIDE_REPORT_COUNT);
  if (hidden) {
    log.info({ targetType, targetId }, "auto-hid target over report threshold");
    // penalize the AUTHOR of the hidden content: the requester for a prompt, the
    // answerer for an answer (never the reporter).
    const authorId =
      targetType === "prompt"
        ? (await db.getPromptById(targetId))?.requester_id
        : (await db.getAnswerById(targetId))?.answerer_id;
    if (authorId) {
      await db.adjustReputation(authorId, -REPUTATION_REPORT_PENALTY).catch(() => {});
    }
  }
  // report is fire-and-forget; no ack event in the shared contract
}
