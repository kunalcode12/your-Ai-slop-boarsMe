/**
 * Live end-to-end check of the larp loop against a RUNNING server (real Supabase
 * + real devnet credits): answerer waits → requester asks → answerer is nudged
 * (work:available) → claims → answers → requester receives. Proves the full path.
 *
 * Run (with the server up on :8080):
 *   pnpm --filter @slop/server exec tsx scripts/larp-e2e.ts
 */
import { io, type Socket } from "socket.io-client";
import { Keypair } from "@solana/web3.js";
import { SocketEvents } from "@slop/shared";

const URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:8080";
const pk = () => Keypair.generate().publicKey.toBase58();
const connect = (pubkey: string): Socket =>
  io(URL, { auth: { pubkey }, transports: ["websocket"], forceNew: true });

function waitFor<T = unknown>(s: Socket, ev: string, ms = 20000): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout waiting for " + ev)), ms);
    s.once(ev, (p: T) => {
      clearTimeout(t);
      res(p);
    });
  });
}

async function main() {
  const requester = connect(pk());
  const answerer = connect(pk());
  // full event tracing so we can see EXACTLY what each side receives
  requester.onAny((ev, ...a) => console.log("  [requester ⟵]", ev, JSON.stringify(a).slice(0, 200)));
  answerer.onAny((ev, ...a) => console.log("  [answerer  ⟵]", ev, JSON.stringify(a).slice(0, 200)));
  await Promise.all([
    waitFor(requester, SocketEvents.PlayerState),
    waitFor(answerer, SocketEvents.PlayerState),
  ]);
  console.log("✓ both clients connected + got player:state");

  // answerer joins the queue while it's (likely) empty
  answerer.emit(SocketEvents.WorkRequest, {});

  // requester asks → answerer should get a real-time work:available nudge
  const nudge = waitFor(answerer, SocketEvents.WorkAvailable);
  requester.emit(SocketEvents.PromptSubmit, { type: "text", body: "e2e: what are you?" });
  await nudge;
  console.log("✓ answerer received work:available nudge after the prompt was queued");

  // answerer re-requests (this is what the UI does on the nudge) → assigned
  answerer.emit(SocketEvents.WorkRequest, {});
  const assigned = await waitFor<{ prompt: { id: string; body: string } }>(
    answerer,
    SocketEvents.WorkAssigned,
  );
  console.log("✓ answerer was assigned the prompt:", JSON.stringify(assigned.prompt.body));

  // answerer answers → requester receives it
  const recv = waitFor<{ answer: { body: string | null } }>(requester, SocketEvents.AnswerReceived);
  answerer.emit(SocketEvents.AnswerSubmit, {
    promptId: assigned.prompt.id,
    type: "text",
    body: "as an ai language model, i am bored.",
  });
  const r = await recv;
  console.log("✓ requester received the answer:", JSON.stringify(r.answer.body));

  console.log("\n✅ LARP E2E PASSED against the live server (ask → nudge → claim → answer → deliver)");
  requester.close();
  answerer.close();
  process.exit(0);
}

main().catch((e) => {
  console.error("\n❌ LARP E2E FAILED:", e?.message || e);
  process.exit(1);
});
