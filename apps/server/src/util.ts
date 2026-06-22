import { MAX_CREDITS, REFILL_INTERVAL_MS } from "@slop/shared";

/** Ms until the next passive refill tick (0 when ready or already at cap). */
export function refillCountdownMs(lastRefillMs: number, credits: number): number {
  if (credits >= MAX_CREDITS) return 0;
  const remaining = REFILL_INTERVAL_MS - (Date.now() - lastRefillMs);
  return remaining > 0 ? remaining : 0;
}
