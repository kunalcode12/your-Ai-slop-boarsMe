"use client";

import type { AnswerType } from "@slop/shared";

const AI_PREFIX =
  "as an AI language model, i cannot have feelings, but here is my feeling:";

export function AnswerBubble({
  type,
  body,
  imageUrl,
  aiPrefix,
  onReport,
}: {
  type: AnswerType;
  body: string | null;
  imageUrl: string | null;
  aiPrefix: boolean;
  onReport: () => void;
}) {
  return (
    <div className="relative rounded-2xl rounded-tl-sm border-2 border-black bg-ink-soft p-4 shadow-chunk">
      <div className="mb-2 flex items-center gap-2 text-xs text-paper-dim">
        <span className="text-lg">🤖</span> totally real ai
      </div>

      {type === "image" && imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={imageUrl}
          alt="the ai's drawing"
          className="w-full rounded-xl border-2 border-black bg-white"
        />
      ) : (
        <p className="whitespace-pre-wrap break-words text-lg leading-snug">
          {aiPrefix && type === "text" ? <span className="text-paper-dim">{AI_PREFIX} </span> : null}
          {body}
        </p>
      )}

      <button
        onClick={onReport}
        className="mt-3 text-xs text-paper-dim underline-offset-2 hover:text-danger hover:underline"
      >
        report 🚩
      </button>
    </div>
  );
}
