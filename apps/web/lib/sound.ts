/** tiny early-internet blips via WebAudio (no asset files). respects a mute flag. */

"use client";

import { useCallback, useEffect, useState } from "react";

const MUTE_KEY = "slop-muted";

export type Blip = "submit" | "plus" | "timeout" | "ping";

let ctx: AudioContext | null = null;

function tone(freq: number, durMs: number, type: OscillatorType = "square"): void {
  try {
    ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + durMs / 1000);
  } catch {
    /* audio not available — ignore */
  }
}

function playRaw(blip: Blip): void {
  switch (blip) {
    case "submit":
      tone(440, 90);
      break;
    case "plus":
      tone(660, 80);
      setTimeout(() => tone(880, 100), 80);
      break;
    case "timeout":
      tone(200, 220, "sawtooth");
      break;
    case "ping":
      tone(560, 60);
      break;
  }
}

export function useSound() {
  const [muted, setMuted] = useState(true); // default muted; user opts in

  useEffect(() => {
    const v = localStorage.getItem(MUTE_KEY);
    if (v !== null) setMuted(v === "1");
  }, []);

  const toggle = useCallback(() => {
    setMuted((m) => {
      const next = !m;
      localStorage.setItem(MUTE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const play = useCallback(
    (blip: Blip) => {
      if (!muted) playRaw(blip);
    },
    [muted],
  );

  return { muted, toggle, play };
}
