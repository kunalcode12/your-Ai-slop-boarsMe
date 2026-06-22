/**
 * Per-(player, action) token bucket. Shadow-throttled (low-reputation) players
 * get half the capacity. Capacity = per-minute limit; tokens refill linearly.
 */

import {
  RATE_LIMIT_PROMPTS_PER_MIN,
  RATE_LIMIT_CLAIMS_PER_MIN,
  RATE_LIMIT_REPORTS_PER_MIN,
} from "@slop/shared";
import type { RateLimiter, RateAction } from "../types";

const PER_MIN: Record<RateAction, number> = {
  prompt: RATE_LIMIT_PROMPTS_PER_MIN,
  claim: RATE_LIMIT_CLAIMS_PER_MIN,
  report: RATE_LIMIT_REPORTS_PER_MIN,
};

const WINDOW_MS = 60_000;

interface Bucket {
  tokens: number;
  last: number;
  capacity: number;
}

export class TokenBucketLimiter implements RateLimiter {
  private buckets = new Map<string, Bucket>();

  private capacityFor(action: RateAction, shadow: boolean): number {
    const base = PER_MIN[action];
    return shadow ? Math.max(1, Math.floor(base / 2)) : base;
  }

  private bucket(pubkey: string, action: RateAction, shadow: boolean): Bucket {
    const key = `${pubkey}:${action}`;
    const capacity = this.capacityFor(action, shadow);
    let b = this.buckets.get(key);
    const now = Date.now();
    if (!b) {
      b = { tokens: capacity, last: now, capacity };
      this.buckets.set(key, b);
      return b;
    }
    // linear refill, and react if capacity changed (rep crossed threshold)
    const refill = ((now - b.last) / WINDOW_MS) * capacity;
    b.tokens = Math.min(capacity, b.tokens + refill);
    b.capacity = capacity;
    b.last = now;
    return b;
  }

  take(pubkey: string, action: RateAction, shadow: boolean): boolean {
    const b = this.bucket(pubkey, action, shadow);
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return true;
    }
    return false;
  }

  retryAfterMs(pubkey: string, action: RateAction): number {
    const b = this.buckets.get(`${pubkey}:${action}`);
    if (!b || b.tokens >= 1) return 0;
    const needed = 1 - b.tokens;
    return Math.ceil((needed / b.capacity) * WINDOW_MS);
  }
}
