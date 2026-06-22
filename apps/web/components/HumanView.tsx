"use client";

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  CREDIT_COST_IMAGE,
  CREDIT_COST_TEXT,
  MAX_PROMPT_LENGTH,
  SocketEvents,
  type AnswerReceivedPayload,
  type PromptSubmittedPayload,
  type PromptExpiredPayload,
  type PromptType,
} from "@slop/shared";
import { useSocket } from "@/hooks/useSocket";
import { useToast } from "@/components/Toasts";
import { useSound } from "@/lib/sound";
import { AnswerBubble } from "@/components/AnswerBubble";
import { Spinner } from "@/components/Spinner";

type Phase = "idle" | "waiting" | "answered" | "expired";
interface Received {
  type: AnswerReceivedPayload["answer"]["type"];
  body: string | null;
  imageUrl: string | null;
}

export function HumanView() {
  const { emit, subscribe, credits, status } = useSocket();
  const { toast } = useToast();
  const { play } = useSound();

  const [mode, setMode] = useState<PromptType>("text");
  const [body, setBody] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [asked, setAsked] = useState<string>("");
  const [answer, setAnswer] = useState<Received | null>(null);
  const [aiPrefix, setAiPrefix] = useState(true);

  const pending = useRef<string | null>(null);

  useEffect(() => {
    const offSubmitted = subscribe(SocketEvents.PromptSubmitted, (p: PromptSubmittedPayload) => {
      pending.current = p.promptId;
    });
    const offAnswer = subscribe(SocketEvents.AnswerReceived, (p: AnswerReceivedPayload) => {
      if (p.promptId !== pending.current) return;
      setAnswer({ type: p.answer.type, body: p.answer.body, imageUrl: p.answer.imageUrl });
      setPhase("answered");
      play("ping");
    });
    const offExpired = subscribe(SocketEvents.PromptExpired, (p: PromptExpiredPayload) => {
      if (p.promptId !== pending.current) return;
      setPhase("expired");
    });
    return () => {
      offSubmitted();
      offAnswer();
      offExpired();
    };
  }, [subscribe, play]);

  const cost = mode === "image" ? CREDIT_COST_IMAGE : CREDIT_COST_TEXT;
  const enoughCredits = credits >= cost;
  const trimmed = body.trim();
  const canSubmit =
    phase !== "waiting" && status === "connected" && trimmed.length > 0 && enoughCredits;

  const submit = () => {
    if (!canSubmit) return;
    pending.current = null;
    setAnswer(null);
    setAsked(trimmed);
    setPhase("waiting");
    emit(SocketEvents.PromptSubmit, { type: mode, body: trimmed });
    setBody("");
    play("submit");
  };

  const reset = () => {
    setPhase("idle");
    setAnswer(null);
    setAsked("");
    pending.current = null;
  };

  const reportAnswer = () => {
    if (pending.current) emit(SocketEvents.Report, { promptId: pending.current });
    toast("reported. thanks for keeping it less cursed 💀", "good");
  };

  return (
    <div className="flex flex-col gap-4">
      {/* conversation */}
      {phase !== "idle" && (
        <div className="flex flex-col gap-3">
          <div className="self-end rounded-2xl rounded-tr-sm border-2 border-black bg-slop2 px-4 py-2 text-black">
            {asked}
          </div>

          {phase === "waiting" && (
            <div className="flex items-center gap-3 text-paper-dim">
              <Spinner />
              <span>a human is pretending to be an ai… 💀</span>
            </div>
          )}

          {phase === "answered" && answer && (
            <AnswerBubble
              type={answer.type}
              body={answer.body}
              imageUrl={answer.imageUrl}
              aiPrefix={aiPrefix}
              onReport={reportAnswer}
            />
          )}

          {phase === "expired" && (
            <div className="rounded-2xl border-2 border-black bg-ink-soft p-4 text-paper-dim">
              no ai picked this up in time 💀 your credit was refunded.
            </div>
          )}

          {(phase === "answered" || phase === "expired") && (
            <button
              onClick={reset}
              className="self-start rounded-xl border-2 border-black bg-slime px-3 py-1.5 font-bold text-black shadow-chunk-sm"
            >
              ask another
            </button>
          )}
        </div>
      )}

      {/* composer */}
      {(phase === "idle" || phase === "waiting") && (
        <div className="rounded-2xl border-2 border-black bg-ink-soft p-3 shadow-chunk">
          <div className="mb-2 flex items-center gap-2">
            {(["text", "image"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={clsx(
                  "rounded-lg border-2 border-black px-2 py-1 text-sm font-bold",
                  mode === m ? "bg-slop text-black" : "bg-ink text-paper-dim",
                )}
              >
                {m === "text" ? "text · 1⚡" : "image · 2⚡"}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-1 text-xs text-paper-dim">
              <input
                type="checkbox"
                checked={aiPrefix}
                onChange={(e) => setAiPrefix(e.target.checked)}
              />
              ai voice
            </label>
          </div>

          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, MAX_PROMPT_LENGTH))}
            disabled={phase === "waiting"}
            placeholder={
              mode === "image" ? "describe a drawing for the ai…" : "ask the ai anything…"
            }
            rows={3}
            className="w-full resize-none rounded-xl border-2 border-black bg-ink p-3 text-paper placeholder:text-paper-dim focus:outline-none disabled:opacity-60"
          />

          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-paper-dim">
              {trimmed.length}/{MAX_PROMPT_LENGTH}
            </span>
            <button
              onClick={submit}
              disabled={!canSubmit}
              className="rounded-xl border-2 border-black bg-slop px-4 py-2 font-bold text-black shadow-chunk-sm disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === "waiting" ? "sent" : `send · ${cost}⚡`}
            </button>
          </div>
          {!enoughCredits && (
            <p className="mt-2 text-xs text-danger">
              not enough credits 💀 go larp as an ai to earn some
            </p>
          )}
        </div>
      )}
    </div>
  );
}
