/** tiny early-internet blips via WebAudio (no asset files). shared mute flag. */

"use client";

import { useCallback, useEffect, useState } from "react";

const MUTE_KEY = "slop-muted";

export type Blip = "submit" | "plus" | "timeout" | "ping";

let ctx: AudioContext | null = null;
let muted = true; // module-level so every useSound instance agrees
const subscribers = new Set<() => void>();

function setMutedGlobal(v: boolean): void {
  muted = v;
  try {
    localStorage.setItem(MUTE_KEY, v ? "1" : "0");
  } catch {
    /* ignore */
  }
  subscribers.forEach((f) => f());
}

function tone(freq: number, durMs: number, type: OscillatorType = "square"): void {
  try {
    ctx ??= new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
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
  const [m, setM] = useState(muted);

  useEffect(() => {
    const stored = localStorage.getItem(MUTE_KEY);
    if (stored !== null) {
      muted = stored === "1";
    }
    setM(muted);
    const onChange = () => setM(muted);
    subscribers.add(onChange);
    return () => {
      subscribers.delete(onChange);
    };
  }, []);

  const toggle = useCallback(() => setMutedGlobal(!muted), []);
  const play = useCallback((blip: Blip) => {
    if (!muted) playRaw(blip);
  }, []);

  return { muted: m, toggle, play };
}
