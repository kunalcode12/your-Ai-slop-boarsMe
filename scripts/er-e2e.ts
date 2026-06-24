/**
 * Live e2e with ER ENABLED: two different identities, full ask→answer→deliver,
 * asserting the credit changes report via="er" (executed on the MagicBlock rollup).
 * Run (server up with MAGICBLOCK_ER_ENABLED=true):
 *   pnpm --filter @slop/server exec tsx C:\Users\TGF\Downloads\aiSlop\scripts\er-e2e.ts
 */
import { io, type Socket } from "socket.io-client";
import { Keypair } from "@solana/web3.js";
import { SocketEvents } from "@slop/shared";

const URL = process.env.NEXT_PUBLIC_SERVER_URL || "http://localhost:8080";
const pk = () => Keypair.generate().publicKey.toBase58();
const connect = (pubkey: string, tag: string): Socket => {
  const s = io(URL, { auth: { pubkey }, transports: ["websocket"], forceNew: true });
  s.onAny((ev, ...a) => console.log(`  [${tag} ⟵]`, ev, JSON.stringify(a).slice(0, 150)));
  return s;
};
function waitFor<T = any>(s: Socket, ev: string, ms = 30000): Promise<T> {
  return new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error("timeout waiting for " + ev)), ms);
    s.once(ev, (p: T) => {
      clearTimeout(t);
      res(p);
    });
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const requester = connect(pk(), "human");
  const answerer = connect(pk(), "larp ");
  await Promise.all([
    waitFor(requester, SocketEvents.PlayerState),
    waitFor(answerer, SocketEvents.PlayerState),
  ]);
  console.log("✓ connected; waiting ~12s for background delegation + ER pickup…");
  await sleep(12000); // let ensureDelegated (delegate on devnet) + ER surface the account

  // requester asks → spend should execute on the ER
  const spent = waitFor<{ reason: string; via?: string }>(requester, SocketEvents.CreditsUpdated);
  const submitted = waitFor<{ promptId: string }>(requester, SocketEvents.PromptSubmitted);
  requester.emit(SocketEvents.PromptSubmit, { type: "text", body: "er e2e: what are you?" });
  const sp = await spent;
  console.log(`\n➜ spend via="${sp.via}" (expect "er")`);
  const sub = await submitted;

  // answerer answers → earn should execute on the ER
  answerer.emit(SocketEvents.WorkRequest, {});
  const assigned = await waitFor<{ prompt: { id: string; body: string } }>(answerer, SocketEvents.WorkAssigned);
  console.log("✓ answerer assigned:", JSON.stringify(assigned.prompt.body));
  const earned = waitFor<{ reason: string; via?: string }>(answerer, SocketEvents.CreditsUpdated);
  const recv = waitFor<{ answer: { body: string | null } }>(requester, SocketEvents.AnswerReceived);
  answerer.emit(SocketEvents.AnswerSubmit, { promptId: sub.promptId, type: "text", body: "as an ai, i am on a rollup." });
  const ea = await earned;
  console.log(`➜ earn via="${ea.via}" (expect "er")`);
  await recv;
  console.log("✓ requester received the answer");

  const ok = sp.via === "er" && ea.via === "er";
  console.log(`\n${ok ? "✅ ER E2E PASSED — credits executed on MagicBlock" : "⚠️ ran, but via was not 'er' (see above)"}`);
  requester.close();
  answerer.close();
  process.exit(ok ? 0 : 2);
}
main().catch((e) => {
  console.error("\n❌ ER E2E FAILED:", e?.message || e);
  process.exit(1);
});
