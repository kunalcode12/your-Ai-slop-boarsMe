"use client";

import { useSocket } from "@/hooks/useSocket";
import { truncateKey } from "@/lib/format";

export function IdentityChip() {
  const { pubkey } = useSocket();
  return (
    <span
      className="rounded-full border border-ink-line bg-ink-soft px-2 py-0.5 text-[11px] text-paper-dim"
      title={`auto guest wallet (stored in this browser) — this is your identity and holds your credits: ${pubkey}`}
    >
      guest {truncateKey(pubkey)}
    </span>
  );
}
