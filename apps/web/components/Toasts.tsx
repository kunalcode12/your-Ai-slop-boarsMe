"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";
import { SocketEvents, type ErrorPayload, type CreditsUpdatedPayload } from "@slop/shared";
import { useSocket } from "@/hooks/useSocket";

type ToastKind = "error" | "info" | "good";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastCtx {
  toast: (message: string, kind?: ToastKind) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, kind: ToastKind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  return (
    <Ctx.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-3 z-50 flex flex-col items-center gap-2 px-3"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={clsx(
              "pointer-events-auto max-w-sm rounded-xl border-2 border-black px-4 py-2 text-sm font-bold shadow-chunk-sm animate-pop",
              t.kind === "error" && "bg-danger text-black",
              t.kind === "good" && "bg-slime text-black",
              t.kind === "info" && "bg-ink-soft text-paper",
            )}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

/** Bridges server `error` events into toasts. Mount inside both providers. */
export function ErrorToaster() {
  const { subscribe } = useSocket();
  const { toast } = useToast();
  useEffect(() => {
    return subscribe(SocketEvents.Error, (e: ErrorPayload) => {
      const extra =
        e.code === "insufficient_credits" ? " — go larp as an ai to earn some" : "";
      toast(e.message + extra, "error");
    });
  }, [subscribe, toast]);
  return null;
}

/**
 * Notifies whenever a credit change was executed on the MagicBlock ephemeral
 * rollup (via === "er") — i.e. asking (−1) or answering (+1) settled gaslessly on
 * the ER. Mount inside both providers.
 */
export function MagicBlockToaster() {
  const { subscribe } = useSocket();
  const { toast } = useToast();
  useEffect(() => {
    return subscribe(SocketEvents.CreditsUpdated, (c: CreditsUpdatedPayload) => {
      if (c.via !== "er") return; // only announce rollup-executed changes
      const what =
        c.reason === "spend"
          ? "−1 credit (spent)"
          : c.reason === "earn"
            ? "+1 credit (earned)"
            : c.reason === "refund"
              ? "credit refunded"
              : "credit refilled";
      toast(`⚡ MagicBlock · ${what} on the rollup`, c.reason === "spend" ? "info" : "good");
    });
  }, [subscribe, toast]);
  return null;
}
