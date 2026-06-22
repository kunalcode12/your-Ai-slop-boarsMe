/**
 * The chain bridge. EVERY credit change goes through here. Pattern:
 *   1. perform the on-chain op FIRST (spend/earn/refund/refill) — chain is truth,
 *   2. mirror to credit_ledger + credits_cached (best-effort; logged if it fails),
 *   3. emit credits:updated to the player's room.
 * If the on-chain op fails, NO off-chain effect is applied (the caller aborts).
 *
 * Uses the plain-devnet path (PROMPT 3's CreditsClient signs as server_authority).
 * ER/session-key path is deferred (PROMPT 3) — swap the CreditsClient ops here
 * when it lands; this interface doesn't change.
 */

import {
  CREDIT_REWARD_ANSWER,
  MAX_CREDITS,
  REFILL_AMOUNT,
  REFILL_INTERVAL_MS,
  SocketEvents,
  type CreditChangeReason,
} from "@slop/shared";
import type { CreditsClient } from "@slop/program-client";
import { AppError, isInsufficientCreditsChainError } from "../errors";
import { refillCountdownMs } from "../util";
import type {
  CreditsBridge,
  CreditTarget,
  Db,
  Logger,
  Presence,
  PlayerSession,
  TypedServer,
} from "../types";

const MAX_EARN_RETRIES = 5;
const EARN_RETRY_INTERVAL_MS = 15_000;

export class ChainCreditsBridge implements CreditsBridge {
  private earnRetries: { target: CreditTarget; attempts: number }[] = [];
  private retryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly client: CreditsClient,
    private readonly db: Db,
    private readonly presence: Presence,
    private readonly io: TypedServer,
    private readonly log: Logger,
  ) {
    this.retryTimer = setInterval(() => void this.processEarnRetries(), EARN_RETRY_INTERVAL_MS);
  }

  stop(): void {
    if (this.retryTimer) clearInterval(this.retryTimer);
  }

  /** Mirror an applied on-chain delta to the ledger/cache and emit. */
  private async mirror(
    target: CreditTarget,
    delta: number,
    reason: CreditChangeReason,
    sig: string,
  ): Promise<number> {
    let credits: number;
    try {
      credits = await this.db.applyCreditDelta(target.playerId, delta, reason, sig);
    } catch (e) {
      // On-chain already committed (source of truth); cache will reconcile on next read.
      this.log.error({ err: String(e), sig, reason }, "ledger mirror failed after on-chain success");
      const s = this.presence.getSession(target.pubkey);
      credits = Math.max(0, (s?.credits ?? 0) + delta);
    }
    const s = this.presence.getSession(target.pubkey);
    if (s) s.credits = credits;
    const countdown = s ? refillCountdownMs(s.lastRefillMs, credits) : 0;
    this.io.to(target.pubkey).emit(SocketEvents.CreditsUpdated, {
      credits,
      reason,
      refillCountdownMs: countdown,
    });
    return credits;
  }

  async ensurePlayer(target: CreditTarget): Promise<void> {
    const existing = await this.client.getPlayer(target.authority);
    if (existing) return;
    try {
      await this.client.initPlayer(target.authority);
    } catch (e) {
      // tolerate a concurrent create
      if (!/already in use|exists/i.test(String((e as Error)?.message))) {
        this.log.error({ err: String(e), pubkey: target.pubkey }, "initPlayer failed");
        throw new AppError("chain_error", "couldn't set up your account on-chain 💀");
      }
    }
  }

  async reconcile(session: PlayerSession): Promise<void> {
    let oc = await this.client.getPlayer(session.authority);
    if (!oc) {
      await this.ensurePlayer(session);
      oc = await this.client.getPlayer(session.authority);
    }
    if (!oc) return;
    session.credits = oc.balance;
    session.lastRefillMs = oc.lastRefill * 1000;
    await this.db.syncCachedCredits(session.playerId, oc.balance).catch((e) =>
      this.log.error({ err: String(e) }, "syncCachedCredits failed"),
    );
  }

  async applyDueRefill(session: PlayerSession): Promise<void> {
    const eligible =
      session.credits < MAX_CREDITS &&
      Date.now() - session.lastRefillMs >= REFILL_INTERVAL_MS;
    if (!eligible) return;
    try {
      const sig = await this.client.refill(session.authority);
      session.lastRefillMs = Date.now();
      await this.mirror(session, REFILL_AMOUNT, "refill", sig);
    } catch (e) {
      // RefillNotReady / MaxCreditsReached are expected races — ignore.
      this.log.debug({ err: String(e) }, "refill skipped");
    }
  }

  async spend(session: PlayerSession, amount: number): Promise<number> {
    let sig: string;
    try {
      sig = await this.client.spend(session.authority, amount);
    } catch (e) {
      if (isInsufficientCreditsChainError(e)) {
        throw new AppError("insufficient_credits", "you're out of credits 💀");
      }
      this.log.error({ err: String(e), pubkey: session.pubkey }, "on-chain spend failed");
      throw new AppError("chain_error", "the chain ate your request, try again");
    }
    return this.mirror(session, -amount, "spend", sig);
  }

  async earn(target: CreditTarget): Promise<void> {
    try {
      const sig = await this.client.earn(target.authority);
      await this.mirror(target, CREDIT_REWARD_ANSWER, "earn", sig);
    } catch (e) {
      // Keep the answer; queue the earn for retry so the answerer isn't cheated.
      this.log.warn({ err: String(e), pubkey: target.pubkey }, "earn failed; queued for retry");
      this.earnRetries.push({ target, attempts: 0 });
    }
  }

  async refund(target: CreditTarget, amount: number): Promise<void> {
    let sig: string;
    try {
      sig = await this.client.refund(target.authority, amount);
    } catch (e) {
      this.log.error({ err: String(e), pubkey: target.pubkey }, "on-chain refund failed");
      throw new AppError("chain_error", "refund failed");
    }
    await this.mirror(target, amount, "refund", sig);
  }

  private async processEarnRetries(): Promise<void> {
    const pending = this.earnRetries;
    this.earnRetries = [];
    for (const item of pending) {
      try {
        const sig = await this.client.earn(item.target.authority);
        await this.mirror(item.target, CREDIT_REWARD_ANSWER, "earn", sig);
        this.log.info({ pubkey: item.target.pubkey }, "earn retry succeeded");
      } catch (e) {
        item.attempts += 1;
        if (item.attempts < MAX_EARN_RETRIES) {
          this.earnRetries.push(item);
        } else {
          this.log.error(
            { err: String(e), pubkey: item.target.pubkey },
            "earn permanently failed after retries",
          );
        }
      }
    }
  }
}
