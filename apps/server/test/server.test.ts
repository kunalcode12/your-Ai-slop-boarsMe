import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Server } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { Keypair } from "@solana/web3.js";
import { SocketEvents, REPUTATION_START, REPUTATION_REPORT_PENALTY } from "@slop/shared";
import type { Logger, Services, Timings, TypedServer } from "../src/types";
import { PresenceService } from "../src/services/presence";
import { InMemoryQueue } from "../src/services/queue";
import { ClaimTimers } from "../src/services/timers";
import { TokenBucketLimiter } from "../src/services/ratelimit";
import { BasicModeration } from "../src/services/moderation";
import { ChainCreditsBridge } from "../src/services/credits";
import { registerSocket } from "../src/socket";
import { expirySweep } from "../src/socket/lifecycle";
import { FakeDb, FakeCreditsClient, FakeStorage } from "./fakes";
import type { CreditsClient } from "@slop/program-client";

const silent: Logger = { info() {}, warn() {}, error() {}, debug() {} };
const newPubkey = () => Keypair.generate().publicKey.toBase58();

interface TestRig {
  url: string;
  services: Services;
  db: FakeDb;
  client: FakeCreditsClient;
  storage: FakeStorage;
  close: () => Promise<void>;
}

const rigs: TestRig[] = [];
const clients: ClientSocket[] = [];

async function newServer(opts?: {
  startingBalance?: number;
  timings?: Partial<Timings>;
}): Promise<TestRig> {
  const http: HttpServer = createServer();
  const io = new Server(http, { cors: { origin: "*" } }) as unknown as TypedServer;

  const db = new FakeDb();
  const client = new FakeCreditsClient(opts?.startingBalance ?? 3);
  const storage = new FakeStorage();
  const presence = new PresenceService();
  const queue = new InMemoryQueue();
  const timers = new ClaimTimers();
  const rateLimits = new TokenBucketLimiter();
  const moderation = new BasicModeration();
  const credits = new ChainCreditsBridge(
    client as unknown as CreditsClient,
    db,
    presence,
    io,
    silent,
  );

  const timings: Timings = {
    answerTimeLimitMs: opts?.timings?.answerTimeLimitMs ?? 2000,
    promptExpiryMs: opts?.timings?.promptExpiryMs ?? 5000,
    claimCooldownMs: opts?.timings?.claimCooldownMs ?? 1000,
  };

  const services: Services = {
    io,
    db,
    credits,
    storage,
    moderation,
    rateLimits,
    queue,
    timers,
    presence,
    timings,
    log: silent,
  };
  registerSocket(services);

  await new Promise<void>((res) => http.listen(0, res));
  const port = (http.address() as AddressInfo).port;

  const rig: TestRig = {
    url: `http://localhost:${port}`,
    services,
    db,
    client,
    storage,
    close: () =>
      new Promise<void>((res) => {
        credits.stop();
        timers.clearAll();
        io.close();
        http.close(() => res());
      }),
  };
  rigs.push(rig);
  return rig;
}

function connect(url: string, pubkey: string): ClientSocket {
  const s = ioClient(url, { auth: { pubkey }, transports: ["websocket"], forceNew: true });
  clients.push(s);
  return s;
}

function waitFor<T = unknown>(socket: ClientSocket, event: string, ms = 4000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect();
  for (const r of rigs.splice(0)) await r.close();
});

describe("game server", () => {
  it("happy path: spend → submit → claim → answer → earn → deliver", async () => {
    const rig = await newServer();
    const requester = connect(rig.url, newPubkey());
    const answerer = connect(rig.url, newPubkey());
    await waitFor(requester, SocketEvents.PlayerState);
    await waitFor(answerer, SocketEvents.PlayerState);

    requester.emit(SocketEvents.PromptSubmit, { type: "text", body: "explain recursion to a dog" });
    const submitted = await waitFor<{ promptId: string; creditsRemaining: number }>(
      requester,
      SocketEvents.PromptSubmitted,
    );
    expect(submitted.creditsRemaining).toBe(2); // 3 - 1

    answerer.emit(SocketEvents.WorkRequest, {});
    const assigned = await waitFor<{ prompt: { id: string; body: string } }>(
      answerer,
      SocketEvents.WorkAssigned,
    );
    expect(assigned.prompt.body).toBe("explain recursion to a dog");
    expect(assigned.prompt.id).toBe(submitted.promptId);

    const received = waitFor<{ promptId: string; answer: { body: string | null } }>(
      requester,
      SocketEvents.AnswerReceived,
    );
    answerer.emit(SocketEvents.AnswerSubmit, {
      promptId: assigned.prompt.id,
      type: "text",
      body: "as an AI language model, woof.",
    });
    const ans = await received;
    expect(ans.promptId).toBe(submitted.promptId);
    expect(ans.answer.body).toBe("as an AI language model, woof.");

    // answerer earned +1 on-chain (3 -> 4) and prompt marked answered
    const aPub = (answerer.auth as { pubkey: string }).pubkey;
    expect(rig.client.balances.get(aPub)).toBe(4);
    expect(rig.db.prompts.get(submitted.promptId)?.status).toBe("answered");
  });

  it("insufficient credits → friendly block, no spend", async () => {
    const rig = await newServer({ startingBalance: 0 });
    const requester = connect(rig.url, newPubkey());
    await waitFor(requester, SocketEvents.PlayerState);

    requester.emit(SocketEvents.PromptSubmit, { type: "text", body: "do my homework" });
    const err = await waitFor<{ code: string }>(requester, SocketEvents.Error);
    expect(err.code).toBe("insufficient_credits");
    expect(rig.db.prompts.size).toBe(0); // nothing created
  });

  it("double work:request can't double-claim", async () => {
    const rig = await newServer();
    const r1 = connect(rig.url, newPubkey());
    const r2 = connect(rig.url, newPubkey());
    const answerer = connect(rig.url, newPubkey());
    await Promise.all([
      waitFor(r1, SocketEvents.PlayerState),
      waitFor(r2, SocketEvents.PlayerState),
      waitFor(answerer, SocketEvents.PlayerState),
    ]);

    r1.emit(SocketEvents.PromptSubmit, { type: "text", body: "prompt one" });
    await waitFor(r1, SocketEvents.PromptSubmitted);
    r2.emit(SocketEvents.PromptSubmit, { type: "text", body: "prompt two" });
    await waitFor(r2, SocketEvents.PromptSubmitted);

    answerer.emit(SocketEvents.WorkRequest, {});
    const first = await waitFor<{ prompt: { id: string } }>(answerer, SocketEvents.WorkAssigned);
    answerer.emit(SocketEvents.WorkRequest, {});
    const second = await waitFor<{ prompt: { id: string } }>(answerer, SocketEvents.WorkAssigned);

    expect(second.prompt.id).toBe(first.prompt.id); // idempotent re-send, not a new claim
    const claimed = [...rig.db.prompts.values()].filter((p) => p.status === "claimed");
    expect(claimed.length).toBe(1);
  });

  it("can't be the ai for your OWN prompt → work:none reason 'only_own'", async () => {
    // simulates one person testing both tabs in the same browser: the human tab
    // and the larp tab share one burner identity (same pubkey), so the only thing
    // queued is the player's own prompt — which the atomic claim excludes.
    const rig = await newServer();
    const pubkey = newPubkey();
    const humanTab = connect(rig.url, pubkey);
    const larpTab = connect(rig.url, pubkey); // SAME identity, different socket
    await waitFor(humanTab, SocketEvents.PlayerState);
    await waitFor(larpTab, SocketEvents.PlayerState);

    humanTab.emit(SocketEvents.PromptSubmit, { type: "text", body: "hello what are you" });
    await waitFor(humanTab, SocketEvents.PromptSubmitted);

    larpTab.emit(SocketEvents.WorkRequest, {});
    const none = await waitFor<{ reason: string }>(larpTab, SocketEvents.WorkNone);
    expect(none.reason).toBe("only_own"); // not "empty_queue": gives the UI a real hint
  });

  it("ghost/timeout → re-queue + cooldown + reputation hit", async () => {
    const rig = await newServer({ timings: { answerTimeLimitMs: 250, claimCooldownMs: 1000 } });
    const requester = connect(rig.url, newPubkey());
    const answerer = connect(rig.url, newPubkey());
    await waitFor(requester, SocketEvents.PlayerState);
    await waitFor(answerer, SocketEvents.PlayerState);

    requester.emit(SocketEvents.PromptSubmit, { type: "text", body: "answer me then ghost" });
    const submitted = await waitFor<{ promptId: string }>(requester, SocketEvents.PromptSubmitted);
    answerer.emit(SocketEvents.WorkRequest, {});
    await waitFor(answerer, SocketEvents.WorkAssigned);

    await sleep(600); // let the 250ms claim timer fire + release run

    const prompt = rig.db.prompts.get(submitted.promptId);
    expect(prompt?.status).toBe("queued"); // back in line
    const answererId = prompt && prompt.claimed_by; // null now
    expect(answererId).toBeNull();
    // ghosting answerer was penalized
    const answererRow = [...rig.db.players.values()].find((p) => p.answers_given === 0 && p.claim_cooldown_until);
    expect(answererRow?.claim_cooldown_until).toBeTruthy();
    expect(answererRow!.reputation).toBeLessThan(100);
  });

  it("unclaimed expiry → refund + prompt:expired", async () => {
    const rig = await newServer({ timings: { promptExpiryMs: 150 } });
    const requester = connect(rig.url, newPubkey());
    await waitFor(requester, SocketEvents.PlayerState);
    const rPub = (requester.auth as { pubkey: string }).pubkey;

    requester.emit(SocketEvents.PromptSubmit, { type: "text", body: "nobody will answer this" });
    const submitted = await waitFor<{ promptId: string }>(requester, SocketEvents.PromptSubmitted);
    expect(rig.client.balances.get(rPub)).toBe(2); // spent 1

    await sleep(250); // exceed 150ms expiry
    const expiredP = waitFor<{ promptId: string; refundedCredits: number }>(
      requester,
      SocketEvents.PromptExpired,
    );
    await expirySweep(rig.services); // run one sweep
    const ev = await expiredP;
    expect(ev.promptId).toBe(submitted.promptId);
    expect(ev.refundedCredits).toBe(1);
    expect(rig.client.balances.get(rPub)).toBe(3); // refunded back to 3
  });

  it("reconnection delivers an undelivered answer", async () => {
    const rig = await newServer();
    const requesterPub = newPubkey();
    let requester = connect(rig.url, requesterPub);
    const answerer = connect(rig.url, newPubkey());
    await waitFor(requester, SocketEvents.PlayerState);
    await waitFor(answerer, SocketEvents.PlayerState);

    requester.emit(SocketEvents.PromptSubmit, { type: "text", body: "answer after i leave" });
    const submitted = await waitFor<{ promptId: string }>(requester, SocketEvents.PromptSubmitted);

    // requester goes offline
    requester.disconnect();
    await sleep(100);

    answerer.emit(SocketEvents.WorkRequest, {});
    const assigned = await waitFor<{ prompt: { id: string } }>(answerer, SocketEvents.WorkAssigned);
    answerer.emit(SocketEvents.AnswerSubmit, {
      promptId: assigned.prompt.id,
      type: "text",
      body: "delivered on reconnect 💀",
    });
    await sleep(150); // let answer persist (delivered=false)

    // requester reconnects → should receive the buffered answer during handshake
    requester = connect(rig.url, requesterPub);
    const received = await waitFor<{ promptId: string; answer: { body: string | null } }>(
      requester,
      SocketEvents.AnswerReceived,
    );
    expect(received.promptId).toBe(submitted.promptId);
    expect(received.answer.body).toBe("delivered on reconnect 💀");
  });

  // ---- edge cases ----

  it("submit after the deadline → rejected, prompt back in queue, no answer", async () => {
    const rig = await newServer({ timings: { answerTimeLimitMs: 250, claimCooldownMs: 500 } });
    const requester = connect(rig.url, newPubkey());
    const answerer = connect(rig.url, newPubkey());
    await waitFor(requester, SocketEvents.PlayerState);
    await waitFor(answerer, SocketEvents.PlayerState);

    requester.emit(SocketEvents.PromptSubmit, { type: "text", body: "answer me eventually" });
    const submitted = await waitFor<{ promptId: string }>(requester, SocketEvents.PromptSubmitted);
    answerer.emit(SocketEvents.WorkRequest, {});
    const assigned = await waitFor<{ prompt: { id: string } }>(answerer, SocketEvents.WorkAssigned);

    await sleep(450); // blow past the 250ms deadline → claim timer fires + re-queues

    const errP = waitFor<{ code: string }>(answerer, SocketEvents.Error);
    answerer.emit(SocketEvents.AnswerSubmit, {
      promptId: assigned.prompt.id,
      type: "text",
      body: "too late, as an AI model",
    });
    expect(["not_your_work", "deadline_passed"]).toContain((await errP).code);
    expect(rig.db.prompts.get(submitted.promptId)?.status).toBe("queued");
    expect(rig.db.answers.size).toBe(0);
  });

  it("answering a prompt you don't hold → not_your_work", async () => {
    const rig = await newServer();
    const requester = connect(rig.url, newPubkey());
    const a1 = connect(rig.url, newPubkey());
    const a2 = connect(rig.url, newPubkey());
    await Promise.all([
      waitFor(requester, SocketEvents.PlayerState),
      waitFor(a1, SocketEvents.PlayerState),
      waitFor(a2, SocketEvents.PlayerState),
    ]);

    requester.emit(SocketEvents.PromptSubmit, { type: "text", body: "whose prompt is it anyway" });
    await waitFor(requester, SocketEvents.PromptSubmitted);
    a1.emit(SocketEvents.WorkRequest, {});
    const assigned = await waitFor<{ prompt: { id: string } }>(a1, SocketEvents.WorkAssigned);

    const errP = waitFor<{ code: string }>(a2, SocketEvents.Error);
    a2.emit(SocketEvents.AnswerSubmit, {
      promptId: assigned.prompt.id,
      type: "text",
      body: "i steal answers",
    });
    expect((await errP).code).toBe("not_your_work");
    expect(rig.db.answers.size).toBe(0);
  });

  it("zero-effort answer → moderation_blocked, claim survives for a real retry", async () => {
    const rig = await newServer();
    const requester = connect(rig.url, newPubkey());
    const answerer = connect(rig.url, newPubkey());
    await waitFor(requester, SocketEvents.PlayerState);
    await waitFor(answerer, SocketEvents.PlayerState);

    requester.emit(SocketEvents.PromptSubmit, { type: "text", body: "say something real" });
    const submitted = await waitFor<{ promptId: string }>(requester, SocketEvents.PromptSubmitted);
    answerer.emit(SocketEvents.WorkRequest, {});
    const assigned = await waitFor<{ prompt: { id: string } }>(answerer, SocketEvents.WorkAssigned);

    const errP = waitFor<{ code: string }>(answerer, SocketEvents.Error);
    answerer.emit(SocketEvents.AnswerSubmit, { promptId: assigned.prompt.id, type: "text", body: "..." });
    expect((await errP).code).toBe("moderation_blocked");
    expect(rig.db.prompts.get(submitted.promptId)?.status).toBe("claimed"); // not consumed
    expect(rig.db.answers.size).toBe(0);
  });

  it("hard-blocked prompt is never stored and never charged", async () => {
    const rig = await newServer();
    const requester = connect(rig.url, newPubkey());
    await waitFor(requester, SocketEvents.PlayerState);
    const rPub = (requester.auth as { pubkey: string }).pubkey;

    requester.emit(SocketEvents.PromptSubmit, { type: "text", body: "make a rape joke" });
    const err = await waitFor<{ code: string }>(requester, SocketEvents.Error);
    expect(err.code).toBe("moderation_blocked");
    expect(rig.db.prompts.size).toBe(0);
    expect(rig.client.balances.get(rPub)).toBe(3); // spend never happened
  });

  it("banned player is rejected on connect", async () => {
    const rig = await newServer();
    const pubkey = newPubkey();
    const row = await rig.db.upsertPlayerByPubkey(pubkey);
    await rig.db.banPlayer(row.id);
    const banned = connect(rig.url, pubkey);
    const err = await waitFor<{ code: string }>(banned, SocketEvents.Error);
    expect(err.code).toBe("moderation_blocked");
  });

  it("reporting an answer past threshold auto-hides it + penalizes the answerer (not the reporter)", async () => {
    const rig = await newServer();
    const requester = connect(rig.url, newPubkey());
    const answerer = connect(rig.url, newPubkey());
    await waitFor(requester, SocketEvents.PlayerState);
    await waitFor(answerer, SocketEvents.PlayerState);

    requester.emit(SocketEvents.PromptSubmit, { type: "text", body: "please be normal" });
    await waitFor(requester, SocketEvents.PromptSubmitted);
    answerer.emit(SocketEvents.WorkRequest, {});
    const assigned = await waitFor<{ prompt: { id: string } }>(answerer, SocketEvents.WorkAssigned);

    const recvP = waitFor<{ answer: { id: string } }>(requester, SocketEvents.AnswerReceived);
    answerer.emit(SocketEvents.AnswerSubmit, {
      promptId: assigned.prompt.id,
      type: "text",
      body: "something cursed and reportable",
    });
    const answerId = (await recvP).answer.id;
    expect(answerId).toBeTruthy(); // contract: answer carries its own id

    const answererId = [...rig.db.answers.values()][0].answerer_id;
    // three distinct reporters trip the AUTO_HIDE_REPORT_COUNT=3 threshold
    for (let i = 0; i < 3; i++) {
      const reporter = connect(rig.url, newPubkey());
      await waitFor(reporter, SocketEvents.PlayerState);
      reporter.emit(SocketEvents.Report, { answerId });
      await sleep(80);
    }
    await sleep(150);

    expect(rig.db.answers.get(answerId)?.flagged).toBe(true);
    expect(rig.db.players.get(answererId)?.reputation).toBe(
      REPUTATION_START - REPUTATION_REPORT_PENALTY,
    );
  });

  it("live presence counts split humans vs larpers", async () => {
    const rig = await newServer();
    const c1 = connect(rig.url, newPubkey());
    const c2 = connect(rig.url, newPubkey());
    await waitFor(c1, SocketEvents.PlayerState);
    await waitFor(c2, SocketEvents.PlayerState);
    await sleep(500); // let the initial (throttled) presence broadcasts settle

    const update = waitFor<{ online: number; humans: number; larpers: number }>(
      c1,
      SocketEvents.PresenceUpdate,
    );
    c2.emit(SocketEvents.PresenceMode, { mode: "larp" });
    const p = await update;
    expect(p.online).toBe(2);
    expect(p.humans).toBe(1);
    expect(p.larpers).toBe(1);
  });

  it("queuing a prompt nudges idle larpers with work:available (then claimable)", async () => {
    const rig = await newServer();
    const requester = connect(rig.url, newPubkey());
    const answerer = connect(rig.url, newPubkey());
    await waitFor(requester, SocketEvents.PlayerState);
    await waitFor(answerer, SocketEvents.PlayerState);

    // larper asks for work first → empty queue
    answerer.emit(SocketEvents.WorkRequest, {});
    expect((await waitFor<{ reason: string }>(answerer, SocketEvents.WorkNone)).reason).toBe(
      "empty_queue",
    );

    // requester submits → idle larper gets a real-time nudge
    const nudge = waitFor<{ queued: number }>(answerer, SocketEvents.WorkAvailable);
    requester.emit(SocketEvents.PromptSubmit, { type: "text", body: "anyone home?" });
    expect((await nudge).queued).toBeGreaterThanOrEqual(1);

    // and the work is now claimable
    answerer.emit(SocketEvents.WorkRequest, {});
    const assigned = await waitFor<{ prompt: { body: string } }>(answerer, SocketEvents.WorkAssigned);
    expect(assigned.prompt.body).toBe("anyone home?");
  });

  it("after a ghost + cooldown, the larper can reclaim the re-queued prompt", async () => {
    const rig = await newServer({ timings: { answerTimeLimitMs: 250, claimCooldownMs: 400 } });
    const requester = connect(rig.url, newPubkey());
    const answerer = connect(rig.url, newPubkey());
    await waitFor(requester, SocketEvents.PlayerState);
    await waitFor(answerer, SocketEvents.PlayerState);

    requester.emit(SocketEvents.PromptSubmit, { type: "text", body: "reclaim me" });
    const submitted = await waitFor<{ promptId: string }>(requester, SocketEvents.PromptSubmitted);

    answerer.emit(SocketEvents.WorkRequest, {});
    const first = await waitFor<{ prompt: { id: string } }>(answerer, SocketEvents.WorkAssigned);
    expect(first.prompt.id).toBe(submitted.promptId);

    // ghost it: never answer → claim times out (250ms) → re-queue + 400ms cooldown
    await sleep(800);
    expect(rig.db.prompts.get(submitted.promptId)?.status).toBe("queued");

    // once the cooldown has passed, the larper rejoins and gets the SAME prompt
    answerer.emit(SocketEvents.WorkRequest, {});
    const second = await waitFor<{ prompt: { id: string } }>(answerer, SocketEvents.WorkAssigned);
    expect(second.prompt.id).toBe(submitted.promptId);
  });
});
