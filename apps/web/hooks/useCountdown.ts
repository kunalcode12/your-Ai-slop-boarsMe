/** Server-deadline-driven countdown. Computes remaining = target - now FRESH on
 *  every render (no stale state) and just forces a re-render every tick. Pass a
 *  new target whenever the server re-syncs.
 *
 *  Why render-time compute: a state-backed `remaining` lags one render behind when
 *  `targetAt` flips from null → a deadline, so consumers briefly see 0. That made
 *  the larp view fire its "too slow" timeout the instant a prompt was assigned
 *  (remaining read as 0 before the countdown's effect could update it). Deriving
 *  the value during render means the very first render already sees ~60s. */

"use client";

import { useEffect, useState } from "react";

export function useCountdown(targetAt: number | null, tickMs = 250): number {
  const [, force] = useState(0);

  useEffect(() => {
    if (targetAt == null) return;
    const id = setInterval(() => force((n) => n + 1), tickMs);
    return () => clearInterval(id);
  }, [targetAt, tickMs]);

  return targetAt == null ? 0 : Math.max(0, targetAt - Date.now());
}
