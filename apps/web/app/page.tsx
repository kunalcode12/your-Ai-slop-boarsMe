"use client";

import { useEffect, useState } from "react";
import { useSocket } from "@/hooks/useSocket";
import { useSound } from "@/lib/sound";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Footer } from "@/components/Footer";
import { Tabs, type Tab } from "@/components/Tabs";
import { CreditCounter } from "@/components/CreditCounter";
import { IdentityChip } from "@/components/IdentityChip";
import { ConnectWalletButton } from "@/components/ConnectWalletButton";
import { DisconnectBanner } from "@/components/DisconnectBanner";
import { ErrorToaster } from "@/components/Toasts";
import { HumanView } from "@/components/HumanView";
import { LarpView } from "@/components/LarpView";

const TAB_KEY = "slop-tab";

export default function Page() {
  const { ready } = useSocket();
  const { muted, toggle } = useSound();
  const [tab, setTab] = useState<Tab>("human");

  useEffect(() => {
    const saved = localStorage.getItem(TAB_KEY);
    if (saved === "human" || saved === "larp") setTab(saved);
  }, []);

  const changeTab = (t: Tab) => {
    setTab(t);
    localStorage.setItem(TAB_KEY, t);
  };

  if (!ready) return <LoadingScreen />;

  return (
    <div className="flex min-h-dvh flex-col">
      <ErrorToaster />
      <DisconnectBanner />

      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4 px-4 pt-4">
        {/* header */}
        <header className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold leading-none">your ai slop bores me 💀</h1>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <IdentityChip />
              <ConnectWalletButton />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CreditCounter />
            <button
              onClick={toggle}
              aria-label={muted ? "unmute" : "mute"}
              className="rounded-lg border border-ink-line px-1.5 text-sm"
            >
              {muted ? "🔇" : "🔊"}
            </button>
          </div>
        </header>

        <Tabs tab={tab} onChange={changeTab} />

        <section className="pb-8">{tab === "human" ? <HumanView /> : <LarpView />}</section>
      </main>

      <Footer />
    </div>
  );
}
