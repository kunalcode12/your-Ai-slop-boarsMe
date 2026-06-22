import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Server } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { Keypair } from "@solana/web3.js";
import { SocketEvents } from "@slop/shared";
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
});
