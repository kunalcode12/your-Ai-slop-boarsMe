/**
 * OPTIONAL wallet connect. Lightweight integration with injected providers
 * (Phantom / Solflare / Backpack) via their window globals — no heavy adapter
 * lib, and NOT required to play. The burner remains the identity/session signer;
 * connecting a wallet here is purely cosmetic for v1 (shows a real address).
 */

"use client";

import { useCallback, useEffect, useState } from "react";

interface InjectedProvider {
  isPhantom?: boolean;
  isBackpack?: boolean;
  publicKey?: { toString(): string } | null;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toString(): string } }>;
  disconnect?: () => Promise<void>;
}

interface SolWindow extends Window {
  solana?: InjectedProvider;
  solflare?: InjectedProvider;
  backpack?: InjectedProvider;
}

function pickProvider(): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as SolWindow;
  return w.solana ?? w.solflare ?? w.backpack ?? null;
}

export function useWallet() {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const p = pickProvider();
    setAvailable(!!p);
    // silently resume a previously trusted connection
    if (p?.publicKey) setAddress(p.publicKey.toString());
  }, []);

  const connect = useCallback(async () => {
    const p = pickProvider();
    if (!p) {
      window.open("https://phantom.app/", "_blank");
      return;
    }
    setConnecting(true);
    try {
      const res = await p.connect();
      setAddress(res.publicKey.toString());
    } catch {
      // user rejected — ignore
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    await pickProvider()?.disconnect?.();
    setAddress(null);
  }, []);

  return { address, connecting, available, connect, disconnect };
}
