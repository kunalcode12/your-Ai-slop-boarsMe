"use client";

import { useSocket } from "@/hooks/useSocket";

/**
 * Live presence bar: total online, split into humans (on the "ask" tab) and ais
 * (people currently larping as the ai). Counts come from the server's
 * `presence:update` broadcast; online === humans + larpers.
 */
export function OnlineCounter() {
  const { presence, status } = useSocket();
  const { online, humans, larpers } = presence;

  if (status !== "connected") return null;

  return (
    <div
      className="flex items-center justify-center gap-3 text-xs text-paper-dim"
      aria-live="polite"
      title={`${online} online · ${humans} asking · ${larpers} pretending to be the ai`}
    >
      <span>
        <span className="font-bold text-paper">{online}</span> online
      </span>
      <span aria-hidden>·</span>
      <span>🧑 {humans} human{humans === 1 ? "" : "s"}</span>
      <span aria-hidden>·</span>
      <span>🤖 {larpers} ai{larpers === 1 ? "" : "s"}</span>
    </div>
  );
}
