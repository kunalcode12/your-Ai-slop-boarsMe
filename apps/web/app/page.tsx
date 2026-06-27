"use client";

import { useEffect, useState } from "react";
import { SocketEvents } from "@slop/shared";
import { useSocket } from "@/hooks/useSocket";
import { useSound } from "@/lib/sound";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Footer } from "@/components/Footer";
import { Tabs, type Tab } from "@/components/Tabs";
import { CreditCounter } from "@/components/CreditCounter";
import { IdentityChip } from "@/components/IdentityChip";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { DisconnectBanner } from "@/components/DisconnectBanner";
import { ErrorToaster, MagicBlockToaster } from "@/components/Toasts";
import { OnlineCounter } from "@/components/OnlineCounter";
import { HowItWorks } from "@/components/HowItWorks";
import { HumanView } from "@/components/HumanView";
import { LarpView } from "@/components/LarpView";

const TAB_KEY = "slop-tab";
const INTRO_KEY = "slop-intro-v1"; // bump the suffix to re-show the intro after edits

export default function Page() {
  const { ready, emit, epoch, erActive } = useSocket();
  const { muted, toggle } = useSound();
  const [tab, setTab] = useState<Tab>("human");
  // id of a question still waiting for an answer (so we can warn before leaving)
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [showIntro, setShowIntro] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(TAB_KEY);
    if (saved === "human" || saved === "larp") setTab(saved);
    // first-ever visit → show the how-it-works dialog once, then remember.
    if (!localStorage.getItem(INTRO_KEY)) {
      setShowIntro(true);
      localStorage.setItem(INTRO_KEY, "1");
    }
  }, []);

  // tell the server which tab we're on so it can publish live online counts
  // (also re-sent on every reconnect via `epoch`).
  useEffect(() => {
    if (ready) emit(SocketEvents.PresenceMode, { mode: tab });
  }, [ready, tab, emit, epoch]);

  const changeTab = (t: Tab) => {
    // leaving the human tab while a question is still queued → warn, and on
    // confirm pull it from the queue (refunded if no ai has claimed it yet).
    if (t !== tab && tab === "human" && pendingPrompt) {
      const ok = window.confirm(
        "you've got a question waiting for an ai. switching to 'larp as ai' gives up its spot in the queue — if no ai has picked it up yet, your credit is refunded. switch anyway?",
      );
      if (!ok) return;
      emit(SocketEvents.PromptCancel, { promptId: pendingPrompt });
      setPendingPrompt(null);
    }
    setTab(t);
    localStorage.setItem(TAB_KEY, t);
  };

  if (!ready) return <LoadingScreen />;

  return (
    <div className="flex min-h-dvh flex-col">
      <ErrorToaster />
      <MagicBlockToaster />
      <HowItWorks open={showIntro} onClose={() => setShowIntro(false)} />
      <DisconnectBanner />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-4">
        {/* header */}
        <header className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold leading-none">your ai slop bores me 💀</h1>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <IdentityChip />
              <ConnectWalletButton />
              {erActive && (
                <span
                  className="rounded-full border border-slime/60 bg-slime/10 px-2 py-0.5 text-[11px] font-bold text-slime"
                  title="credits run on the MagicBlock ephemeral rollup — gasless + real-time, settled to devnet"
                >
                  ⚡ MagicBlock ER
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CreditCounter />
            <button
              onClick={() => setShowIntro(true)}
              aria-label="how it works"
              title="how it works"
              className="rounded-lg border border-ink-line px-1.5 text-sm"
            >
              ❓
            </button>
            <button
              onClick={toggle}
              aria-label={muted ? "unmute" : "mute"}
              className="rounded-lg border border-ink-line px-1.5 text-sm"
            >
              {muted ? "🔇" : "🔊"}
            </button>
          </div>
        </header>

        <OnlineCounter />

        <Tabs tab={tab} onChange={changeTab} />

        <section className="pb-8">
          {tab === "human" ? <HumanView onPending={setPendingPrompt} /> : <LarpView />}
        </section>
      </main>

      <Footer />
    </div>
  );
}
