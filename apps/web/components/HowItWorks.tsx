"use client";

import { useEffect } from "react";
import {
  STARTING_CREDITS,
  MAX_CREDITS,
  CREDIT_COST_TEXT,
  CREDIT_COST_IMAGE,
  CREDIT_REWARD_ANSWER,
  REFILL_AMOUNT,
  REFILL_INTERVAL_MS,
  ANSWER_TIME_LIMIT_MS,
} from "@slop/shared";

const REFILL_MIN = Math.round(REFILL_INTERVAL_MS / 60_000);
const ANSWER_SEC = Math.round(ANSWER_TIME_LIMIT_MS / 1_000);

/**
 * "How it works" onboarding. Hand-drawn cartoon dialog explaining the premise,
 * the two modes, and the credit economy. Shown once automatically on first visit
 * (the parent persists that) and re-openable from the header button.
 */
export function HowItWorks({ open, onClose }: { open: boolean; onClose: () => void }) {
  // close on Escape + lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="how it works"
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="handdrawn handdrawn-double animate-pop relative flex max-h-[90vh] w-full max-w-md flex-col bg-paper text-ink shadow-chunk"
      >
        {/* close */}
        <button
          onClick={onClose}
          aria-label="close"
          className="handdrawn-2 absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center bg-slop text-lg font-bold text-black"
        >
          ✕
        </button>

        {/* scrolling lives on this inner wrapper (no pseudo-element), so the wobbly
            doubled outline on the panel never triggers a scrollbar */}
        <div className="overflow-y-auto overflow-x-hidden px-5 py-6">
        <h2 className="mb-1 pr-8 text-2xl font-bold leading-tight">how this works 💀</h2>
        <p className="mb-4 text-sm font-bold text-ink/70">
          spoiler: the “ai” is just some random human. that&apos;s the whole joke.
        </p>

        <div className="flex flex-col gap-3 text-sm">
          {/* human mode */}
          <section className="handdrawn-2 bg-slop2/20 px-4 py-3">
            <div className="mb-1 text-base font-bold">🧑 → 🤖 ask the “ai” (human mode)</div>
            <p>
              type a question (or ask for a drawing). a real human has{" "}
              <b>{ANSWER_SEC} seconds</b> to answer it while pretending to be the ai. you pay
              credits to ask: <b>{CREDIT_COST_TEXT}⚡ text</b> · <b>{CREDIT_COST_IMAGE}⚡ image</b>.
            </p>
          </section>

          {/* larp mode */}
          <section className="handdrawn-3 bg-slime/20 px-4 py-3">
            <div className="mb-1 text-base font-bold">🤖 be the “ai” (larp as ai)</div>
            <p>
              a human&apos;s prompt lands on your screen — you have <b>{ANSWER_SEC}s</b> to answer
              convincingly (or draw it) and earn <b>+{CREDIT_REWARD_ANSWER}⚡</b>. too slow? sam
              altman burns your H100 💀.
            </p>
          </section>

          {/* credits */}
          <section className="handdrawn-2 bg-slop/15 px-4 py-3">
            <div className="mb-1 text-base font-bold">⚡ the credit economy</div>
            <ul className="ml-4 list-disc space-y-0.5">
              <li>
                you start with <b>{STARTING_CREDITS}⚡</b>, capped at <b>{MAX_CREDITS}⚡</b>.
              </li>
              <li>
                asking <b>spends</b> credits · answering <b>earns</b> them. it&apos;s a closed loop —
                run low? go be the ai for a bit.
              </li>
              <li>
                broke? you passively refill <b>+{REFILL_AMOUNT}⚡ every {REFILL_MIN} min</b>.
              </li>
            </ul>
          </section>

          {/* chain note */}
          <section className="handdrawn-3 bg-ink/5 px-4 py-3">
            <div className="mb-1 text-base font-bold">⛓️ it&apos;s actually on-chain</div>
            <p>
              credits are real on <b>Solana devnet</b> and run gasless on a{" "}
              <b>MagicBlock ⚡ rollup</b> — no wallet popups, no gas. (devnet credits have zero real
              value, it&apos;s a bit.)
            </p>
          </section>

          <p className="text-center text-xs font-bold text-ink/60">
            wanna test both sides solo? open the other tab in an <b>incognito window</b> so it&apos;s
            a different player.
          </p>
        </div>

        <button
          onClick={onClose}
          className="handdrawn-2 mt-5 w-full bg-slime py-3 text-lg font-bold text-black shadow-chunk-sm"
        >
          got it, let me cook 💀
        </button>
        </div>
      </div>
    </div>
  );
}
