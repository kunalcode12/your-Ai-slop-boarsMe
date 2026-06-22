"use client";

import clsx from "clsx";
import { mmss } from "@/lib/format";

const SIZE = 96;
const STROKE = 10;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

export function CountdownRing({ remainingMs, totalMs }: { remainingMs: number; totalMs: number }) {
  const frac = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
  const danger = remainingMs <= 10_000;
  const seconds = Math.ceil(remainingMs / 1000);

  return (
    <div className="relative" style={{ width: SIZE, height: SIZE }}>
      <svg width={SIZE} height={SIZE} className="-rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="#3a3a44" strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={danger ? "#ff5252" : "#5cc8ff"}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - frac)}
          className="transition-[stroke-dashoffset] duration-200 ease-linear"
        />
      </svg>
      <div
        className={clsx(
          "absolute inset-0 flex items-center justify-center text-2xl font-bold tabular-nums",
          danger ? "text-danger animate-bob" : "text-paper",
        )}
        aria-label={`${seconds} seconds left`}
      >
        {mmss(remainingMs)}
      </div>
    </div>
  );
}
