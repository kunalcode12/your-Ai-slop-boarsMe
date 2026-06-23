"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ANSWER_TIME_LIMIT_MS,
  MAX_ANSWER_LENGTH,
  MAX_DRAWING_BYTES,
  SocketEvents,
  type CreditsUpdatedPayload,
  type ErrorPayload,
  type PublicPrompt,
  type WorkAssignedPayload,
  type WorkNonePayload,
} from "@slop/shared";
import { useSocket } from "@/hooks/useSocket";
import { useToast } from "@/components/Toasts";
import { useCountdown } from "@/hooks/useCountdown";
import { useSound } from "@/lib/sound";
import { CountdownRing } from "@/components/CountdownRing";
import { DrawingCanvas, type DrawingCanvasHandle } from "@/components/DrawingCanvas";
import { Spinner } from "@/components/Spinner";

/**
 * Larp flow (opt-in):
 *   idle   → you clicked into the tab; press "i'm ready" to join the queue
 *   waiting→ in the queue; auto-claims work as soon as a human asks (work:available
 *            push + an 8s safety poll). Never a dead end.
 *   working→ you hold a prompt + a 60s timer; answer it
 *   submitting/accepted → answer sent / +1 credit, then back to waiting
 *   timeout→ ran out of time; auto-returns to waiting (kept in the queue)
 */
type Phase = "idle" | "waiting" | "working" | "submitting" | "accepted" | "timeout";

const ACCEPTED_HOLD_MS = 1100;
const TIMEOUT_HOLD_MS = 1800;
const IDLE_POLL_MS = 8000; // safety re-check while waiting (under the claims rate limit)

function base64Bytes(dataUrl: string): number {
  const b64 = dataUrl.split(",")[1] ?? "";
  return Math.floor((b64.length * 3) / 4);
}

export function LarpView() {
  const { emit, subscribe, status, epoch } = useSocket();
  const { toast } = useToast();
  const { play } = useSound();

  const [phase, setPhase] = useState<Phase>("idle");
  const [assignment, setAssignment] = useState<{ prompt: PublicPrompt; deadlineAt: number } | null>(
    null,
  );
  const [text, setText] = useState("");
  // shown while waiting when the only queued prompt is our own (can't self-answer)
  const [waitHint, setWaitHint] = useState<string | null>(null);
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const phaseRef = useRef<Phase>("idle");
  // absolute timestamps so the heartbeat below can drive transitions without
  // depending on fragile per-phase effect timers.
  const lastReqAt = useRef(0);
  const transAt = useRef(0);

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  /** Join (or re-check) the queue: ask the server for a prompt to answer. */
  const requestWork = useCallback(() => {
    setAssignment(null);
    setText("");
    setPhaseBoth("waiting");
    lastReqAt.current = Date.now();
    emit(SocketEvents.WorkRequest, {});
  }, [emit, setPhaseBoth]);

  /** Leave the queue, back to the ready gate. */
  const stop = useCallback(() => {
    setAssignment(null);
    setText("");
    setWaitHint(null);
    setPhaseBoth("idle");
  }, [setPhaseBoth]);

  // subscriptions (mount once; uses phaseRef so it never needs re-binding)
  useEffect(() => {
    const offAssigned = subscribe(SocketEvents.WorkAssigned, (p: WorkAssignedPayload) => {
      if (phaseRef.current === "idle") return; // we left the queue; ignore
      setAssignment({ prompt: p.prompt, deadlineAt: p.deadlineAt });
      setText("");
      setPhaseBoth("working");
      play("ping");
    });
    // No work right now: stay in "waiting". If we're cooling down / rate-limited,
    // line up the next heartbeat re-request for ~when the wait ends (so we don't
    // poll uselessly meanwhile, and we retry crisply the moment it clears).
    const offNone = subscribe(SocketEvents.WorkNone, (p: WorkNonePayload) => {
      if (phaseRef.current !== "waiting") return;
      if (p.retryAfterMs && p.retryAfterMs > 0) {
        lastReqAt.current = Date.now() + p.retryAfterMs - IDLE_POLL_MS;
      }
      // the only thing queued is our OWN prompt — you can't be the ai for your own
      // question. Tell the user how to actually test it (separate identity).
      setWaitHint(
        p.reason === "only_own"
          ? "the only question waiting is your own — you can't be the ai for your own prompt. open this in a second browser or an incognito window to play both sides 💀"
          : null,
      );
    });
    const offCredits = subscribe(SocketEvents.CreditsUpdated, (c: CreditsUpdatedPayload) => {
      if (c.reason === "earn" && phaseRef.current === "submitting") {
        transAt.current = Date.now();
        setPhaseBoth("accepted");
        play("plus");
      }
    });
    const offError = subscribe(SocketEvents.Error, (_e: ErrorPayload) => {
      // global toaster shows the message; here we just recover the larp flow
      if (phaseRef.current === "submitting") setPhaseBoth("working");
    });
    // new work hit the queue → if we're waiting, grab it (server's atomic claim
    // resolves races between multiple larpers).
    const offAvailable = subscribe(SocketEvents.WorkAvailable, () => {
      if (phaseRef.current === "waiting") requestWork();
    });
    return () => {
      offAssigned();
      offNone();
      offCredits();
      offError();
      offAvailable();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remaining = useCountdown(phase === "working" ? (assignment?.deadlineAt ?? null) : null);

  // timer hit zero while working → too slow (just flip phase + stamp the time).
  useEffect(() => {
    if (phase === "working" && assignment && remaining <= 0) {
      transAt.current = Date.now();
      setPhaseBoth("timeout");
      play("timeout");
    }
  }, [phase, remaining, assignment, play, setPhaseBoth]);

  // ONE robust driver for the whole "active" lifetime (everything except idle).
  // It reads phaseRef + absolute timestamps, so re-renders/phase changes can never
  // strand it (this is what previously left the larper stuck on "too slow"):
  //  - waiting  → re-poll for work every IDLE_POLL_MS (also covers a missed nudge)
  //  - timeout  → after TIMEOUT_HOLD_MS, rejoin the queue
  //  - accepted → after ACCEPTED_HOLD_MS, rejoin the queue
  useEffect(() => {
    if (phase === "idle") return;
    const id = setInterval(() => {
      const now = Date.now();
      const p = phaseRef.current;
      if (p === "waiting") {
        if (now - lastReqAt.current >= IDLE_POLL_MS) requestWork();
      } else if (p === "timeout" && now - transAt.current >= TIMEOUT_HOLD_MS) {
        requestWork();
      } else if (p === "accepted" && now - transAt.current >= ACCEPTED_HOLD_MS) {
        requestWork();
      }
    }, 500);
    return () => clearInterval(id);
  }, [phase, requestWork]);

  // on (re)connect, re-sync: a reconnect gives us a brand-new server socket, so
  // any in-flight claim/request from the old one is gone — rejoin the queue.
  useEffect(() => {
    if (epoch > 0 && phaseRef.current !== "idle") requestWork();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [epoch]);

  const submit = () => {
    if (!assignment || phase !== "working") return;
    const { prompt } = assignment;
    if (prompt.type === "text") {
      const t = text.trim();
      if (!t) return toast("type something 💀", "error");
      emit(SocketEvents.AnswerSubmit, { promptId: prompt.id, type: "text", body: t });
    } else {
      const dataUrl = canvasRef.current?.toPngDataUrl();
      if (!dataUrl) return toast("draw something first 💀", "error");
      if (base64Bytes(dataUrl) > MAX_DRAWING_BYTES) return toast("drawing too big 💀", "error");
      emit(SocketEvents.AnswerSubmit, { promptId: prompt.id, type: "image", imageDataUrl: dataUrl });
    }
    setPhaseBoth("submitting");
    play("submit");
  };

  // ---- render states ----
  if (status !== "connected") {
    return <p className="text-center text-paper-dim">connecting…</p>;
  }

  if (phase === "idle") {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <div className="text-5xl">🤖</div>
        <p className="text-lg text-paper">
          be the “ai”. a human will send a prompt — you have 60s to answer (or draw) it
          convincingly and earn <span className="font-bold text-slime">+1⚡</span>.
        </p>
        <button
          onClick={requestWork}
          className="rounded-xl border-2 border-black bg-slime px-6 py-3 text-lg font-bold text-black shadow-chunk"
        >
          i&apos;m ready to be the ai
        </button>
        <p className="text-xs text-paper-dim">
          you&apos;ll join the queue and get the next question automatically 💀
        </p>
      </div>
    );
  }

  if (phase === "waiting") {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <div className="flex items-center justify-center gap-3 text-paper-dim">
          <Spinner /> waiting for a human to need an ai… 💀
        </div>
        {waitHint ? (
          <p className="max-w-xs rounded-xl border-2 border-black bg-slop px-3 py-2 text-xs font-bold text-black">
            {waitHint}
          </p>
        ) : (
          <p className="text-xs text-paper-dim">you&apos;re in the queue — the next prompt lands here automatically</p>
        )}
        <button
          onClick={stop}
          className="rounded-lg border-2 border-black bg-ink-soft px-3 py-1 text-sm font-bold text-paper-dim hover:text-paper"
        >
          stop
        </button>
      </div>
    );
  }

  if (phase === "timeout") {
    return (
      <div className="py-12 text-center text-xl text-danger">
        too slow! sam altman burned your H100 💀
        <div className="mt-2 text-sm text-paper-dim">back in the queue…</div>
      </div>
    );
  }

  if (phase === "accepted") {
    return (
      <div className="relative py-12 text-center">
        <div className="text-2xl font-bold text-slime">accepted 💀</div>
        <div className="pointer-events-none absolute inset-x-0 top-6 animate-floatup text-3xl font-bold text-slime">
          +1 ⚡
        </div>
      </div>
    );
  }

  // working / submitting
  const prompt = assignment?.prompt;
  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-xl border-2 border-black bg-slop px-3 py-2 text-center text-sm font-bold text-black">
        you have 60 seconds to fulfill a request before sam altman burns your H100.
      </p>

      <div className="flex items-center justify-center">
        <CountdownRing remainingMs={remaining} totalMs={ANSWER_TIME_LIMIT_MS} />
      </div>

      <div className="rounded-2xl border-2 border-black bg-ink-soft p-4 shadow-chunk">
        <div className="mb-1 text-xs text-paper-dim">a human asked the “ai”:</div>
        <p className="break-words text-lg">{prompt?.body}</p>
        <div className="mt-1 text-xs text-paper-dim">
          {prompt?.type === "image" ? "draw it 🎨" : "answer it ✍️"}
        </div>
      </div>

      {prompt?.type === "image" ? (
        <DrawingCanvas ref={canvasRef} />
      ) : (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_ANSWER_LENGTH))}
          placeholder="answer as the ai…"
          rows={4}
          className="w-full resize-none rounded-xl border-2 border-black bg-ink p-3 text-paper placeholder:text-paper-dim focus:outline-none"
        />
      )}

      <button
        onClick={submit}
        disabled={phase === "submitting"}
        className="rounded-xl border-2 border-black bg-slime px-4 py-3 text-lg font-bold text-black shadow-chunk disabled:opacity-50"
      >
        {phase === "submitting" ? "sending…" : "submit answer · +1⚡"}
      </button>
    </div>
  );
}
