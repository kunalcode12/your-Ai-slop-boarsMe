"use client";

import clsx from "clsx";

export type Tab = "human" | "larp";

export function Tabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2" role="tablist" aria-label="mode">
      {(["human", "larp"] as const).map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={tab === t}
          onClick={() => onChange(t)}
          className={clsx(
            "rounded-xl border-2 border-black px-3 py-2 text-base font-bold lowercase transition-transform",
            tab === t
              ? "translate-y-0 bg-slop text-black shadow-chunk"
              : "bg-ink-soft text-paper-dim shadow-chunk-sm hover:text-paper",
          )}
        >
          {t === "human" ? "human" : "larp as ai"}
        </button>
      ))}
    </div>
  );
}
