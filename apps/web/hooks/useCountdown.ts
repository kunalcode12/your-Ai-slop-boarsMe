/** Server-deadline-driven countdown. Computes remaining = target - now and
 *  re-ticks locally; pass a fresh target whenever the server re-syncs. */

"use client";

import { useEffect, useState } from "react";

export function useCountdown(targetAt: number | null, tickMs = 250): number {
  const [remaining, setRemaining] = useState(() =>
    targetAt == null ? 0 : Math.max(0, targetAt - Date.now()),
  );

  useEffect(() => {
    if (targetAt == null) {
      setRemaining(0);
      return;
    }
    setRemaining(Math.max(0, targetAt - Date.now()));
    const id = setInterval(() => {
      setRemaining(Math.max(0, targetAt - Date.now()));
    }, tickMs);
    return () => clearInterval(id);
  }, [targetAt, tickMs]);

  return remaining;
}
