"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getOrCreateBurner } from "@/lib/identity";
import { SocketProvider } from "@/hooks/useSocket";
import { ToastProvider } from "@/components/Toasts";
import { LoadingScreen } from "@/components/LoadingScreen";

export function Providers({ children }: { children: ReactNode }) {
  const [pubkey, setPubkey] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getOrCreateBurner()
      .then((b) => alive && setPubkey(b.publicKey))
      .catch(() => alive && setPubkey(null));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <ToastProvider>
      {pubkey ? <SocketProvider pubkey={pubkey}>{children}</SocketProvider> : <LoadingScreen />}
    </ToastProvider>
  );
}
