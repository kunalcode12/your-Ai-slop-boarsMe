/** In-memory fakes for hermetic integration tests (no devnet, no Supabase). */

import { randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  REPUTATION_START,
  STARTING_CREDITS,
  type CreditChangeReason,
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
} from "../src/db";
import type { Db, StorageService } from "../src/types";

const nowIso = () => new Date().toISOString();

/** In-memory data layer implementing the exact PROMPT-2 surface. */
export class FakeDb implements Db {
  players = new Map<string, PlayerRow>();
  prompts = new Map<string, PromptRow>();
  answers = new Map<string, AnswerRow>();
  reports: ReportRow[] = [];
  ledger: { playerId: string; delta: number; reason: string }[] = [];

  private byPubkey(pubkey: string): PlayerRow | undefined {
    for (const p of this.players.values()) if (p.wallet_pubkey === pubkey) return p;
    return undefined;
  }

  async upsertPlayerByPubkey(pubkey: string): Promise<PlayerRow> {
    const existing = this.byPubkey(pubkey);
    if (existing) return existing;
    const row: PlayerRow = {
      id: randomUUID(),
      wallet_pubkey: pubkey,
      credits_cached: STARTING_CREDITS,
      last_refill_at: nowIso(),
      answers_given: 0,
      prompts_sent: 0,
      reputation: REPUTATION_START,
      claim_cooldown_until: null,
      banned: false,
      created_at: nowIso(),
    };
    this.players.set(row.id, row);
    return row;
  }

  async getPlayer(pubkey: string): Promise<PlayerRow | null> {
    return this.byPubkey(pubkey) ?? null;
  }
  async getPlayerById(id: string): Promise<PlayerRow | null> {
    return this.players.get(id) ?? null;
  }

  async applyCreditDelta(
    playerId: string,
    delta: number,
    reason: CreditChangeReason,
  ): Promise<number> {
    const p = this.players.get(playerId);
    if (!p) throw new Error("player not found");
    p.credits_cached = Math.max(0, p.credits_cached + delta);
    this.ledger.push({ playerId, delta, reason });
    return p.credits_cached;
  }
  async syncCachedCredits(playerId: string, credits: number): Promise<void> {
    const p = this.players.get(playerId);
    if (p) p.credits_cached = credits;
  }
  async setClaimCooldown(playerId: string, until: Date | null): Promise<void> {
    const p = this.players.get(playerId);
    if (p) p.claim_cooldown_until = until ? until.toISOString() : null;
  }
  async adjustReputation(playerId: string, delta: number): Promise<number> {
    const p = this.players.get(playerId);
    if (!p) throw new Error("player not found");
    p.reputation = Math.max(0, p.reputation + delta);
    return p.reputation;
  }
  async banPlayer(playerId: string): Promise<void> {
    const p = this.players.get(playerId);
    if (p) p.banned = true;
  }

  async createPrompt(input: CreatePromptInput): Promise<PromptRow> {
    const p = this.players.get(input.requesterId);
    if (p) p.prompts_sent += 1;
    const row: PromptRow = {
      id: randomUUID(),
      requester_id: input.requesterId,
      type: input.type,
      body: input.body,
      status: "queued",
      credits_cost: input.creditsCost,
      claimed_by: null,
      claimed_at: null,
      expires_at: input.expiresAt.toISOString(),
      created_at: nowIso(),
    };
    this.prompts.set(row.id, row);
    return row;
  }

  async claimNextPromptForAnswerer(answererId: string): Promise<PromptRow | null> {
    const candidates = [...this.prompts.values()]
      .filter(
        (p) =>
          p.status === "queued" &&
          p.requester_id !== answererId &&
          new Date(p.expires_at) > new Date(),
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const next = candidates[0];
    if (!next) return null;
    next.status = "claimed";
    next.claimed_by = answererId;
    next.claimed_at = nowIso();
    return next;
  }

  async expireStalePrompts(): Promise<PromptRow[]> {
    const expired: PromptRow[] = [];
    for (const p of this.prompts.values()) {
      if (p.status === "queued" && new Date(p.expires_at) <= new Date()) {
        p.status = "expired";
        expired.push(p);
      }
    }
    return expired;
  }
  async markPromptAnswered(promptId: string): Promise<void> {
    const p = this.prompts.get(promptId);
    if (p) p.status = "answered";
  }
  async releasePromptToQueue(promptId: string, newExpiresAt: Date): Promise<void> {
    const p = this.prompts.get(promptId);
    if (p) {
      p.status = "queued";
      p.claimed_by = null;
      p.claimed_at = null;
      p.expires_at = newExpiresAt.toISOString();
    }
  }
  async listQueuedPrompts(): Promise<PromptRow[]> {
    return [...this.prompts.values()]
      .filter((p) => p.status === "queued")
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
  }
  async listClaimedPrompts(): Promise<PromptRow[]> {
    return [...this.prompts.values()].filter((p) => p.status === "claimed");
  }
  async getPromptById(id: string): Promise<PromptRow | null> {
    return this.prompts.get(id) ?? null;
  }

  async createAnswer(input: CreateAnswerInput): Promise<AnswerRow | null> {
    const prompt = this.prompts.get(input.promptId);
    if (!prompt || prompt.status !== "claimed" || prompt.claimed_by !== input.answererId) {
      return null; // mirrors the guarded submit_answer RPC
    }
    const claimedAt = prompt.claimed_at ? new Date(prompt.claimed_at).getTime() : 0;
    if (Date.now() > claimedAt + input.timeLimitMs) return null; // deadline passed
    const row: AnswerRow = {
      id: randomUUID(),
      prompt_id: input.promptId,
      answerer_id: input.answererId,
      type: input.type,
      body_text: input.bodyText,
      image_url: input.imageUrl,
      time_taken_ms: input.timeTakenMs,
      delivered: false,
      flagged: false,
      created_at: nowIso(),
    };
    this.answers.set(row.id, row);
    prompt.status = "answered";
    const p = this.players.get(input.answererId);
    if (p) p.answers_given += 1;
    return row;
  }
  async getAnswerById(id: string): Promise<AnswerRow | null> {
    return this.answers.get(id) ?? null;
  }
  async markAnswerDelivered(answerId: string): Promise<void> {
    const a = this.answers.get(answerId);
    if (a) a.delivered = true;
  }
  async getUndeliveredAnswersForRequester(requesterId: string): Promise<AnswerRow[]> {
    return [...this.answers.values()].filter((a) => {
      const prompt = this.prompts.get(a.prompt_id);
      return prompt?.requester_id === requesterId && !a.delivered && !a.flagged;
    });
  }

  async createReport(input: CreateReportInput): Promise<ReportRow> {
    const row: ReportRow = {
      id: randomUUID(),
      target_type: input.targetType,
      target_id: input.targetId,
      reporter_id: input.reporterId,
      reason: input.reason ?? null,
      status: "open",
      created_at: nowIso(),
    };
    this.reports.push(row);
    return row;
  }
  async countReportsForTarget(targetType: ReportTargetType, targetId: string): Promise<number> {
    return this.reports.filter((r) => r.target_type === targetType && r.target_id === targetId)
      .length;
  }
  async hideTargetIfOverThreshold(
    targetType: ReportTargetType,
    targetId: string,
    threshold: number,
  ): Promise<boolean> {
    const n = await this.countReportsForTarget(targetType, targetId);
    if (n < threshold) return false;
    await this.hideTarget(targetType, targetId);
    return true;
  }

  async listReports(status: ReportStatus | "all" = "open", limit = 100): Promise<ReportRow[]> {
    return this.reports
      .filter((r) => status === "all" || r.status === status)
      .slice(-limit)
      .reverse();
  }
  async getReportById(id: string): Promise<ReportRow | null> {
    return this.reports.find((r) => r.id === id) ?? null;
  }
  async setReportStatus(id: string, status: ReportStatus): Promise<void> {
    const r = this.reports.find((x) => x.id === id);
    if (r) r.status = status;
  }
  async hideTarget(targetType: ReportTargetType, targetId: string): Promise<void> {
    if (targetType === "answer") {
      const a = this.answers.get(targetId);
      if (a) a.flagged = true;
    } else {
      const p = this.prompts.get(targetId);
      if (p) p.status = "flagged";
    }
  }
}

/**
 * Fake CreditsClient (only the methods the chain bridge calls). Cast to
 * CreditsClient when constructing the REAL ChainCreditsBridge so the bridge's
 * own logic (ledger mirror, emit, retry) is exercised.
 */
export class FakeCreditsClient {
  balances = new Map<string, number>();
  constructor(private startingBalance = STARTING_CREDITS) {}

  private key(authority: PublicKey): string {
    return authority.toBase58();
  }

  async getPlayer(authority: PublicKey) {
    const k = this.key(authority);
    if (!this.balances.has(k)) return null;
    return {
      authority,
      balance: this.balances.get(k) ?? 0,
      lastRefill: Math.floor(Date.now() / 1000),
      answersGiven: 0,
      promptsSent: 0,
      bump: 0,
    };
  }
  async initPlayer(authority: PublicKey): Promise<string> {
    this.balances.set(this.key(authority), this.startingBalance);
    return "sig-init";
  }
  async spend(authority: PublicKey, amount: number): Promise<string> {
    const k = this.key(authority);
    const bal = this.balances.get(k) ?? 0;
    if (bal < amount) {
      throw { error: { errorCode: { code: "InsufficientCredits" } } };
    }
    this.balances.set(k, bal - amount);
    return "sig-spend";
  }
  async earn(authority: PublicKey): Promise<string> {
    const k = this.key(authority);
    this.balances.set(k, (this.balances.get(k) ?? 0) + 1);
    return "sig-earn";
  }
  async refund(authority: PublicKey, amount: number): Promise<string> {
    const k = this.key(authority);
    this.balances.set(k, (this.balances.get(k) ?? 0) + amount);
    return "sig-refund";
  }
  async refill(_authority: PublicKey): Promise<string> {
    // never "due" in tests
    throw { error: { errorCode: { code: "RefillNotReady" } } };
  }
}

/** Fake storage — no network; returns a fake path/URL. */
export class FakeStorage implements StorageService {
  uploads: { promptId: string; bytes: number }[] = [];
  async uploadDrawing(promptId: string, png: Buffer): Promise<string> {
    this.uploads.push({ promptId, bytes: png.length });
    return `${promptId}/fake.png`;
  }
  async signedUrl(path: string): Promise<string> {
    return `https://fake.storage/${path}?token=test`;
  }
}
