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

type Phase = "requesting" | "working" | "none" | "submitting" | "accepted" | "timeout";

function base64Bytes(dataUrl: string): number {
  const b64 = dataUrl.split(",")[1] ?? "";
  return Math.floor((b64.length * 3) / 4);
}

export function LarpView() {
  const { emit, subscribe, status } = useSocket();
  const { toast } = useToast();
  const { play } = useSound();

  const [phase, setPhase] = useState<Phase>("requesting");
  const [assignment, setAssignment] = useState<{ prompt: PublicPrompt; deadlineAt: number } | null>(
    null,
  );
  const [text, setText] = useState("");
  const canvasRef = useRef<DrawingCanvasHandle>(null);
  const phaseRef = useRef<Phase>("requesting");

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const requestWork = useCallback(() => {
    setAssignment(null);
    setText("");
    setPhaseBoth("requesting");
    emit(SocketEvents.WorkRequest, {});
  }, [emit, setPhaseBoth]);

  // initial + subscriptions
  useEffect(() => {
    requestWork();
    const offAssigned = subscribe(SocketEvents.WorkAssigned, (p: WorkAssignedPayload) => {
      setAssignment({ prompt: p.prompt, deadlineAt: p.deadlineAt });
      setText("");
      setPhaseBoth("working");
      play("ping");
    });
    const offNone = subscribe(SocketEvents.WorkNone, (_p: WorkNonePayload) => {
      if (phaseRef.current === "requesting") setPhaseBoth("none");
    });
    const offCredits = subscribe(SocketEvents.CreditsUpdated, (c: CreditsUpdatedPayload) => {
      if (c.reason === "earn" && phaseRef.current === "submitting") {
        setPhaseBoth("accepted");
        play("plus");
        setTimeout(requestWork, 1100);
      }
    });
    const offError = subscribe(SocketEvents.Error, (_e: ErrorPayload) => {
      // global toaster shows the message; here we just recover the larp flow
      if (phaseRef.current === "submitting") setPhaseBoth("working");
    });
    // new work hit the queue → if we're idle, grab it (server's atomic claim
    // resolves races between multiple larpers).
    const offAvailable = subscribe(SocketEvents.WorkAvailable, () => {
      if (phaseRef.current === "none") requestWork();
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

  // fallback while idle: re-check every 8s in case a work:available nudge was
  // missed (e.g. it arrived mid-request). Comfortably under the claims rate limit.
  useEffect(() => {
    if (phase !== "none") return;
    const id = setInterval(requestWork, 8000);
    return () => clearInterval(id);
  }, [phase, requestWork]);

  const remaining = useCountdown(phase === "working" ? (assignment?.deadlineAt ?? null) : null);

  // timer hit zero while working → too slow
  useEffect(() => {
    if (phase === "working" && assignment && remaining <= 0) {
      setPhaseBoth("timeout");
      play("timeout");
      const id = setTimeout(requestWork, 1900);
      return () => clearTimeout(id);
    }
  }, [phase, remaining, assignment, play, requestWork, setPhaseBoth]);

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

  if (phase === "none") {
    return (
      <div className="flex flex-col items-center gap-4 py-10 text-center">
        <p className="text-xl text-paper-dim">no work yet — too many ais, not enough humans 💀</p>
        <button
          onClick={requestWork}
          className="rounded-xl border-2 border-black bg-slop px-4 py-2 font-bold text-black shadow-chunk-sm"
        >
          check again
        </button>
      </div>
    );
  }

  if (phase === "requesting") {
    return (
      <div className="flex items-center justify-center gap-3 py-12 text-paper-dim">
        <Spinner /> finding you a human to impersonate an ai for…
      </div>
    );
  }

  if (phase === "timeout") {
    return (
      <div className="py-12 text-center text-xl text-danger">
        too slow! sam altman burned your H100 💀
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
