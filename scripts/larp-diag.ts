/**
 * DIAGNOSTIC: localizes the "larper never sees the question" bug against a RUNNING
 * server (:8080). Tests two scenarios back-to-back with full event tracing:
 *
 *   A) SAME identity (two tabs, one browser)   → expect work:none reason "only_own"
 *   B) DIFFERENT identities (incognito / 2 PCs) → expect work:assigned (the question)
 *
 * Run (server up):  pnpm --filter @slop/server exec tsx scripts/larp-diag.ts
 */
import { io, type Socket } from "socket.io-client";
import { Keypair } from "@solana/web3.js";
import { SocketEvents } from "@slop/shared";

const URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:8080";
const pk = () => Keypair.generate().publicKey.toBase58();
const short = (k: string) => k.slice(0, 6) + "…";
const connect = (pubkey: string, tag: string): Socket => {
  const s = io(URL, { auth: { pubkey }, transports: ["websocket"], forceNew: true });
  s.onAny((ev, ...a) => console.log(`    [${tag} ⟵]`, ev, JSON.stringify(a).slice(0, 160)));
  return s;
};

function waitForAny<T = unknown>(
  s: Socket,
  events: string[],
  ms = 15000,
): Promise<{ ev: string; payload: T }> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout waiting for " + events.join("|"))), ms);
    for (const ev of events) {
      s.once(ev, (payload: T) => {
        clearTimeout(t);
        res({ ev, payload });
      });
    }
  });
}
const waitFor = <T = unknown>(s: Socket, ev: string, ms = 15000) =>
  waitForAny<T>(s, [ev], ms).then((r) => r.payload);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function scenario(sameIdentity: boolean): Promise<void> {
  const humanKey = pk();
  const larpKey = sameIdentity ? humanKey : pk();
  console.log(
    `\n=== Scenario ${sameIdentity ? "A: SAME identity" : "B: DIFFERENT identities"} ===\n` +
      `    human=${short(humanKey)}  larp=${short(larpKey)}  (${sameIdentity ? "same" : "different"})`,
  );

  const human = connect(humanKey, "human");
  const larp = connect(larpKey, "larp ");
  await Promise.all([
    waitFor(human, SocketEvents.PlayerState),
    waitFor(larp, SocketEvents.PlayerState),
  ]);

  // larper joins the queue first (mirrors clicking "i'm ready")
  larp.emit(SocketEvents.WorkRequest, {});
  await sleep(500);

  // human asks → larper should be nudged, then we re-request like the UI does
  human.emit(SocketEvents.PromptSubmit, { type: "text", body: "diag: what are you?" });
  await waitFor(human, SocketEvents.PromptSubmitted).catch(() => {});
  await sleep(800);
  larp.emit(SocketEvents.WorkRequest, {});

  const result = await waitForAny<{ reason?: string; prompt?: { body: string } }>(
    larp,
    [SocketEvents.WorkAssigned, SocketEvents.WorkNone],
  );

  if (result.ev === SocketEvents.WorkAssigned) {
    console.log(`    ➜ RESULT: work:assigned — larper SEES "${result.payload.prompt?.body}"`);
    console.log(`    ${sameIdentity ? "❌ UNEXPECTED (same id should NOT self-claim)" : "✅ EXPECTED"}`);
  } else {
    console.log(`    ➜ RESULT: work:none reason="${result.payload.reason}"`);
    const ok = sameIdentity ? result.payload.reason === "only_own" : false;
    console.log(
      `    ${ok ? "✅ EXPECTED (same id, told 'only_own')" : "❌ larper got NO question"}`,
    );
  }

  human.close();
  larp.close();
  await sleep(300);
}

async function main() {
  console.log("server:", URL);
  await scenario(true); // two tabs, one browser
  await scenario(false); // incognito / different identities
  console.log("\ndone.");
  process.exit(0);
}
main().catch((e) => {
  console.error("\n❌ DIAG ERROR:", e?.message || e);
  process.exit(1);
});
