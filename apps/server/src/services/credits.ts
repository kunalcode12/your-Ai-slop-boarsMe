/**
 * The chain bridge. EVERY credit change goes through here. Pattern:
 *   1. perform the on-chain op FIRST (spend/earn/refund/refill) — chain is truth,
 *   2. mirror to credit_ledger + credits_cached (best-effort; logged if it fails),
 *   3. emit credits:updated to the player's room.
 * If the on-chain op fails, NO off-chain effect is applied (the caller aborts).
 *
 * Uses the plain-devnet path: the CreditsClient signs as server_authority, so
 * users never see a wallet popup. The program + client now also support session
 * keys (spend/earn) and ER delegate/commit/undelegate; to route ops through a
 * MagicBlock ER, set MAGICBLOCK_RPC_URL and call the client's ER helpers here.
 * This bridge interface does not change either way — plain devnet stays the
 * default so the app is never blocked on ER.
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

const MAX_CREDIT_RETRIES = 5;
const CREDIT_RETRY_INTERVAL_MS = 15_000;

/** A credit op (earn/refund) that failed on-chain and must be retried so the
 *  player is never short-changed. (spend needs no retry: it's chain-first and the
 *  caller aborts on failure, so nothing off-chain happened.) */
interface CreditRetry {
  target: CreditTarget;
  kind: "earn" | "refund";
  amount: number;
  attempts: number;
}

export class ChainCreditsBridge implements CreditsBridge {
  private creditRetries: CreditRetry[] = [];
  private retryTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly client: CreditsClient,
    private readonly db: Db,
    private readonly presence: Presence,
    private readonly io: TypedServer,
    private readonly log: Logger,
  ) {
    this.retryTimer = setInterval(() => void this.processCreditRetries(), CREDIT_RETRY_INTERVAL_MS);
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
      this.creditRetries.push({ target, kind: "earn", amount: CREDIT_REWARD_ANSWER, attempts: 0 });
    }
  }

  async refund(target: CreditTarget, amount: number): Promise<void> {
    try {
      const sig = await this.client.refund(target.authority, amount);
      await this.mirror(target, amount, "refund", sig);
    } catch (e) {
      // Never strand the requester's credit on a transient chain failure: queue it
      // for retry (same guarantee as earn). The chain remains the source of truth.
      this.log.warn({ err: String(e), pubkey: target.pubkey }, "refund failed; queued for retry");
      this.creditRetries.push({ target, kind: "refund", amount, attempts: 0 });
    }
  }

  private async processCreditRetries(): Promise<void> {
    const pending = this.creditRetries;
    this.creditRetries = [];
    for (const item of pending) {
      try {
        const sig =
          item.kind === "earn"
            ? await this.client.earn(item.target.authority)
            : await this.client.refund(item.target.authority, item.amount);
        await this.mirror(item.target, item.amount, item.kind, sig);
        this.log.info({ pubkey: item.target.pubkey, kind: item.kind }, "credit retry succeeded");
      } catch (e) {
        item.attempts += 1;
        if (item.attempts < MAX_CREDIT_RETRIES) {
          this.creditRetries.push(item);
        } else {
          this.log.error(
            { err: String(e), pubkey: item.target.pubkey, kind: item.kind },
            "credit op permanently failed after retries",
          );
        }
      }
    }
  }
}
