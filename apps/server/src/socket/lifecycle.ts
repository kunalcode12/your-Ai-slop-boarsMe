/** Shared lifecycle helpers used by the connection flow + handlers. */

import { PublicKey } from "@solana/web3.js";
import {
  REPUTATION_GHOST_PENALTY,
  REPUTATION_SHADOW_THROTTLE_THRESHOLD,
  SocketEvents,
  type Player,
  type PlayerStatePayload,
} from "@slop/shared";
import { rowToPublicPrompt } from "../db";
import type { AnswerRow, PlayerRow } from "../db";
import { refillCountdownMs } from "../util";
import type { ClaimInfo, PlayerSession, Services, TypedSocket } from "../types";

export function toPlayer(row: PlayerRow, session: PlayerSession): Player {
  return {
    pubkey: session.pubkey,
    credits: session.credits,
    reputation: session.reputation,
    lastRefillAt: session.lastRefillMs,
    createdAt: Date.parse(row.created_at),
    shadowThrottled: session.shadowThrottled,
  };
}

/**
 * Full connect sequence. Returns the session + the player:state payload to send,
 * or null if the socket was rejected (banned). The caller emits player:state
 * AFTER registering the event handlers, so the client can't fire an event into a
 * window where the server isn't listening yet.
 */
export async function doHandshake(
  services: Services,
  socket: TypedSocket,
  pubkey: string,
): Promise<{ session: PlayerSession; statePayload: PlayerStatePayload } | null> {
  const { db, credits, presence } = services;

  const row = await db.upsertPlayerByPubkey(pubkey);
  if (row.banned) {
    socket.emit(SocketEvents.Error, { code: "moderation_blocked", message: "you're banned 💀" });
    socket.disconnect(true);
    return null;
  }

  const session: PlayerSession = {
    playerId: row.id,
    pubkey,
    authority: new PublicKey(pubkey),
    credits: row.credits_cached,
    lastRefillMs: Date.parse(row.last_refill_at),
    reputation: row.reputation,
    shadowThrottled: row.reputation <= REPUTATION_SHADOW_THROTTLE_THRESHOLD,
  };
  presence.setSession(pubkey, session);

  // ensure on-chain account, reconcile cache against chain truth, apply due refill
  await credits.ensurePlayer(session);
  await credits.reconcile(session);
  await credits.applyDueRefill(session);
  session.shadowThrottled = session.reputation <= REPUTATION_SHADOW_THROTTLE_THRESHOLD;

  const statePayload: PlayerStatePayload = {
    player: toPlayer(row, session),
    refillCountdownMs: refillCountdownMs(session.lastRefillMs, session.credits),
    activePrompt: null,
    activeDeadlineAt: null,
    erActive: credits.erActive,
  };

  // NOTE: player:state is emitted by the caller AFTER handlers are registered;
  // buffered-answer delivery also happens there (see registerSocket).
  return { session, statePayload };
}

/** Deliver an answer to the requester (mints a signed URL for drawings). */
export async function deliverAnswer(
  services: Services,
  answer: AnswerRow,
  requesterPubkey: string,
): Promise<void> {
  try {
    let imageUrl: string | null = null;
    if (answer.type === "image" && answer.image_url) {
      imageUrl = await services.storage.signedUrl(answer.image_url);
    }
    services.io.to(requesterPubkey).emit(SocketEvents.AnswerReceived, {
      promptId: answer.prompt_id,
      answer: {
        id: answer.id,
        type: answer.type,
        body: answer.body_text,
        imageUrl,
        createdAt: Date.parse(answer.created_at),
      },
    });
    await services.db.markAnswerDelivered(answer.id);
  } catch (e) {
    services.log.error({ err: String(e), answerId: answer.id }, "deliverAnswer failed");
  }
}

/**
 * Drop every still-queued prompt this requester wrote and refund each — used when
 * they go fully offline (their last socket left). A prompt a larper has already
 * CLAIMED is left alone (still 'claimed', not 'queued'), so the larper can finish
 * and earn even though the human is gone (the answer just won't be delivered).
 */
export async function cancelRequesterQueuedPrompts(
  services: Services,
  target: { playerId: string; pubkey: string; authority: PublicKey },
): Promise<void> {
  const { db, queue, credits, io, log } = services;
  let cancelled;
  try {
    cancelled = await db.cancelQueuedPromptsForRequester(target.playerId);
  } catch (e) {
    log.error({ err: String(e), pubkey: target.pubkey }, "cancelRequesterQueuedPrompts failed");
    return;
  }
  for (const p of cancelled) {
    queue.remove(p.id);
    try {
      await credits.refund(target, p.credits_cost);
    } catch (e) {
      log.error({ err: String(e), promptId: p.id }, "leave-cleanup refund failed");
    }
    io.to(target.pubkey).emit(SocketEvents.PromptExpired, {
      promptId: p.id,
      refundedCredits: p.credits_cost,
    });
  }
}

/** Return a claimed prompt to the queue. `penalize` for ghost/timeout/disconnect. */
export async function releaseClaim(
  services: Services,
  info: ClaimInfo,
  opts: { penalize: boolean },
): Promise<void> {
  const { db, queue, timers, timings, log, io } = services;
  timers.clear(info.promptId);
  try {
    await db.releasePromptToQueue(info.promptId, new Date(Date.now() + timings.promptExpiryMs));
    queue.push(info.promptId);
    // a re-queued prompt is available again — nudge idle larpers
    io.emit(SocketEvents.WorkAvailable, { queued: queue.size() });
    if (opts.penalize) {
      await db.setClaimCooldown(info.answererId, new Date(Date.now() + timings.claimCooldownMs));
      await db.adjustReputation(info.answererId, -REPUTATION_GHOST_PENALTY);
    }
  } catch (e) {
    log.error({ err: String(e), promptId: info.promptId }, "releaseClaim failed");
  }
}

/** One pass of the unclaimed-expiry sweeper: expire + refund + notify. */
export async function expirySweep(services: Services): Promise<void> {
  const { db, queue, credits, io, log } = services;
  let expired;
  try {
    expired = await db.expireStalePrompts();
  } catch (e) {
    log.error({ err: String(e) }, "expireStalePrompts failed");
    return;
  }
  for (const p of expired) {
    queue.remove(p.id);
    const requester = await db.getPlayerById(p.requester_id);
    if (!requester) continue;
    const target = {
      playerId: requester.id,
      pubkey: requester.wallet_pubkey,
      authority: new PublicKey(requester.wallet_pubkey),
    };
    try {
      await credits.refund(target, p.credits_cost);
    } catch (e) {
      log.error({ err: String(e), promptId: p.id }, "expiry refund failed");
    }
    io.to(requester.wallet_pubkey).emit(SocketEvents.PromptExpired, {
      promptId: p.id,
      refundedCredits: p.credits_cost,
    });
  }
}

/** On boot: re-queue any orphaned claims (timers were lost) + rebuild the queue. */
export async function bootRecovery(services: Services): Promise<void> {
  const { db, queue, timings, log } = services;
  try {
    const claimed = await db.listClaimedPrompts();
    for (const p of claimed) {
      await db.releasePromptToQueue(p.id, new Date(Date.now() + timings.promptExpiryMs));
    }
    await queue.rebuild(db);
    log.info({ requeued: claimed.length, queued: queue.size() }, "boot recovery complete");
  } catch (e) {
    log.error({ err: String(e) }, "boot recovery failed");
  }
}

export { rowToPublicPrompt };
