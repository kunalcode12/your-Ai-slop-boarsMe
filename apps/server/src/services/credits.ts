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
  type CreditVia,
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
  // ER (MagicBlock) state — pubkeys whose Player PDA is delegated to the rollup,
  // and those mid-delegation (so we don't double-delegate). Empty unless erEnabled.
  private delegated = new Set<string>();
  private delegating = new Set<string>();

  constructor(
    private readonly client: CreditsClient,
    private readonly db: Db,
    private readonly presence: Presence,
    private readonly io: TypedServer,
    private readonly log: Logger,
    private readonly erEnabled = false,
  ) {
    this.retryTimer = setInterval(() => void this.processCreditRetries(), CREDIT_RETRY_INTERVAL_MS);
  }

  stop(): void {
    if (this.retryTimer) clearInterval(this.retryTimer);
  }

  /** Should this player's credit ops run on the ER right now? */
  private useEr(pubkey: string): boolean {
    return this.erEnabled && this.delegated.has(pubkey);
  }

  /**
   * Run an ER op with a few quick retries. Right after delegation the rollup can
   * take ~1s to surface the account, so a transaction landing in that window would
   * otherwise fail; retrying covers it. Insufficient-credits is real — fail fast.
   */
  private async erRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < 4; i++) {
      try {
        return await fn();
      } catch (e) {
        if (isInsufficientCreditsChainError(e)) throw e;
        lastErr = e;
        this.log.debug({ err: String(e), label, attempt: i }, "ER op retry");
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    throw lastErr;
  }

  /** True if any ER routing is active (for the public `isErActive` view). */
  get erActive(): boolean {
    return this.erEnabled;
  }

  /**
   * Delegate this player's PDA to the ER (non-blocking; safe to call repeatedly).
   * Called right after a player connects. On failure they simply stay on devnet.
   */
  async ensureDelegated(session: PlayerSession): Promise<void> {
    if (!this.erEnabled) return;
    const pk = session.pubkey;
    if (this.delegated.has(pk) || this.delegating.has(pk)) return;
    this.delegating.add(pk);
    try {
      if (await this.client.isDelegatedOnChain(session.authority)) {
        this.delegated.add(pk); // already delegated (e.g. prior session) — adopt it
        return;
      }
      await this.client.delegatePlayer(session.authority);
      this.delegated.add(pk);
      this.log.info({ pubkey: pk }, "player delegated to MagicBlock ER");
    } catch (e) {
      this.log.warn({ err: String(e), pubkey: pk }, "ER delegate failed; staying on devnet");
    } finally {
      this.delegating.delete(pk);
    }
  }

  /** Commit + undelegate (settle ER state to devnet). Called when a player leaves. */
  async undelegateIfNeeded(target: CreditTarget): Promise<void> {
    if (!this.erEnabled || !this.delegated.has(target.pubkey)) return;
    try {
      await this.client.undelegatePlayerOnEr(target.authority);
      this.delegated.delete(target.pubkey);
      this.log.info({ pubkey: target.pubkey }, "player undelegated (settled to devnet)");
    } catch (e) {
      this.log.error({ err: String(e), pubkey: target.pubkey }, "ER undelegate failed");
    }
  }

  /** Mirror an applied on-chain delta to the ledger/cache and emit. */
  private async mirror(
    target: CreditTarget,
    delta: number,
    reason: CreditChangeReason,
    sig: string,
    via: CreditVia = "devnet",
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
      via,
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
    // If the PDA is already delegated (e.g. a prior session / server restart left
    // it on the ER), the devnet copy is stale — read the live ER state and adopt
    // the delegation so subsequent ops keep using the rollup.
    if (this.erEnabled && (await this.client.isDelegatedOnChain(session.authority))) {
      this.delegated.add(session.pubkey);
      const er = await this.client.getPlayer(session.authority, { er: true });
      if (er) {
        session.credits = er.balance;
        session.lastRefillMs = er.lastRefill * 1000;
        await this.db.syncCachedCredits(session.playerId, er.balance).catch((e) =>
          this.log.error({ err: String(e) }, "syncCachedCredits failed (er)"),
        );
      }
      return;
    }

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
      const er = this.useEr(session.pubkey);
      const sig = er
        ? await this.client.refillOnEr(session.authority)
        : await this.client.refill(session.authority);
      session.lastRefillMs = Date.now();
      await this.mirror(session, REFILL_AMOUNT, "refill", sig, er ? "er" : "devnet");
    } catch (e) {
      // RefillNotReady / MaxCreditsReached are expected races — ignore.
      this.log.debug({ err: String(e) }, "refill skipped");
    }
  }

  async spend(session: PlayerSession, amount: number): Promise<number> {
    // When delegated, the devnet copy is owned by the ER — a devnet spend would
    // fail — so the ER is the ONLY venue (no fallback); errors propagate.
    const er = this.useEr(session.pubkey);
    let sig: string;
    try {
      sig = er
        ? await this.erRetry(() => this.client.spendOnEr(session.authority, amount), "spend")
        : await this.client.spend(session.authority, amount);
    } catch (e) {
      if (isInsufficientCreditsChainError(e)) {
        throw new AppError("insufficient_credits", "you're out of credits 💀");
      }
      this.log.error({ err: String(e), pubkey: session.pubkey, er }, "on-chain spend failed");
      throw new AppError("chain_error", "the chain ate your request, try again");
    }
    return this.mirror(session, -amount, "spend", sig, er ? "er" : "devnet");
  }

  async earn(target: CreditTarget): Promise<void> {
    const er = this.useEr(target.pubkey);
    try {
      const sig = er
        ? await this.erRetry(() => this.client.earnOnEr(target.authority), "earn")
        : await this.client.earn(target.authority);
      await this.mirror(target, CREDIT_REWARD_ANSWER, "earn", sig, er ? "er" : "devnet");
    } catch (e) {
      // Keep the answer; queue the earn for retry so the answerer isn't cheated.
      this.log.warn({ err: String(e), pubkey: target.pubkey }, "earn failed; queued for retry");
      this.creditRetries.push({ target, kind: "earn", amount: CREDIT_REWARD_ANSWER, attempts: 0 });
    }
  }

  async refund(target: CreditTarget, amount: number): Promise<void> {
    const er = this.useEr(target.pubkey);
    try {
      const sig = er
        ? await this.erRetry(() => this.client.refundOnEr(target.authority, amount), "refund")
        : await this.client.refund(target.authority, amount);
      await this.mirror(target, amount, "refund", sig, er ? "er" : "devnet");
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
        const er = this.useEr(item.target.pubkey);
        const sig =
          item.kind === "earn"
            ? er
              ? await this.client.earnOnEr(item.target.authority)
              : await this.client.earn(item.target.authority)
            : er
              ? await this.client.refundOnEr(item.target.authority, item.amount)
              : await this.client.refund(item.target.authority, item.amount);
        await this.mirror(item.target, item.amount, item.kind, sig, er ? "er" : "devnet");
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
