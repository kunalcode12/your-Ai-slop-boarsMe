"use client";

import { useSocket } from "@/hooks/useSocket";
import { useCountdown } from "@/hooks/useCountdown";
import { mmss } from "@/lib/format";

export function CreditCounter() {
  const { credits, maxCredits, refillTargetAt } = useSocket();
  const remaining = useCountdown(refillTargetAt);

  const atCap = credits >= maxCredits;
  const refillLabel = atCap
    ? "credits full 💀"
    : refillTargetAt == null
      ? "earn more by being the ai"
      : remaining > 0
        ? `next credit in ${mmss(remaining)}`
        : "refill ready — reconnect 💀";

  return (
    <div className="flex flex-col items-end leading-tight">
      <div className="flex items-center gap-1 text-lg font-bold" aria-label={`${credits} credits`}>
        <span className="text-slop">⚡</span>
        <span className="tabular-nums">
          {credits}
          <span className="text-paper-dim">/{maxCredits}</span>
        </span>
      </div>
      <span className="text-[11px] text-paper-dim">{refillLabel}</span>
    </div>
  );
}
