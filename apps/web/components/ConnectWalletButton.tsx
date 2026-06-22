"use client";

import { useWallet } from "@/lib/wallet";
import { truncateKey } from "@/lib/format";

export function ConnectWalletButton() {
  const { address, connecting, connect, disconnect } = useWallet();

  if (address) {
    return (
      <button
        onClick={() => void disconnect()}
        className="rounded-full border border-ink-line bg-ink-soft px-2 py-0.5 text-[11px] text-paper-dim hover:text-paper"
        title={address}
      >
        wallet {truncateKey(address)} ✕
      </button>
    );
  }

  return (
    <button
      onClick={() => void connect()}
      disabled={connecting}
      className="rounded-full border border-ink-line px-2 py-0.5 text-[11px] text-paper-dim hover:text-paper disabled:opacity-50"
    >
      {connecting ? "connecting…" : "connect wallet"}
    </button>
  );
}
