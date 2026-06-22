"use client";

import { useSocket } from "@/hooks/useSocket";
import { truncateKey } from "@/lib/format";

export function IdentityChip() {
  const { pubkey } = useSocket();
  return (
    <span
      className="rounded-full border border-ink-line bg-ink-soft px-2 py-0.5 text-[11px] text-paper-dim"
      title={pubkey}
    >
      connected as {truncateKey(pubkey)}
    </span>
  );
}
