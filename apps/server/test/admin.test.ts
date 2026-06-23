/** Admin moderation REST surface — tested in-process via Fastify inject. */

import { describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAdminRoutes } from "../src/admin/routes";
import { FakeDb } from "./fakes";
import type { Logger, Services } from "../src/types";

const silent: Logger = { info() {}, warn() {}, error() {}, debug() {} };

function adminApp(db: FakeDb, token: string): FastifyInstance {
  const app = Fastify();
  const services = { db, log: silent } as unknown as Services;
  registerAdminRoutes(app, services, token);
  return app;
}

async function seedReportedAnswer(db: FakeDb) {
  const author = await db.upsertPlayerByPubkey("Author1111111111111111111111111111111111111");
  const reporter = await db.upsertPlayerByPubkey("Reporter111111111111111111111111111111111111");
  const prompt = await db.createPrompt({
    requesterId: reporter.id,
    type: "text",
    body: "a normal prompt",
    creditsCost: 1,
    expiresAt: new Date(Date.now() + 60_000),
  });
  await db.claimNextPromptForAnswerer(author.id); // author claims reporter's prompt
  const answer = await db.createAnswer({
    promptId: prompt.id,
    answererId: author.id,
    type: "text",
    bodyText: "a cursed answer",
    imageUrl: null,
    timeTakenMs: 10,
    timeLimitMs: 60_000,
  });
  const report = await db.createReport({
    targetType: "answer",
    targetId: answer!.id,
    reporterId: reporter.id,
  });
  return { author, reporter, answer: answer!, report };
}

describe("admin moderation API", () => {
  it("503 when ADMIN_TOKEN is unset (admin disabled)", async () => {
    const app = adminApp(new FakeDb(), "");
    const res = await app.inject({ method: "GET", url: "/admin/reports" });
    expect(res.statusCode).toBe(503);
  });

  it("401 without a valid bearer token", async () => {
    const app = adminApp(new FakeDb(), "secret");
    const res = await app.inject({ method: "GET", url: "/admin/reports" });
    expect(res.statusCode).toBe(401);
    const res2 = await app.inject({
      method: "GET",
      url: "/admin/reports",
      headers: { authorization: "Bearer wrong" },
    });
    expect(res2.statusCode).toBe(401);
  });

  it("lists open reports with a target preview", async () => {
    const db = new FakeDb();
    const { answer } = await seedReportedAnswer(db);
    const app = adminApp(db, "secret");
    const res = await app.inject({
      method: "GET",
      url: "/admin/reports",
      headers: { authorization: "Bearer secret" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.count).toBe(1);
    expect(body.reports[0].targetId).toBe(answer.id);
    expect(body.reports[0].targetType).toBe("answer");
    expect(body.reports[0].preview).toContain("cursed answer");
    expect(body.reports[0].status).toBe("open");
  });

  it("'ban' hides the answer, bans the author, and marks the report actioned", async () => {
    const db = new FakeDb();
    const { author, answer, report } = await seedReportedAnswer(db);
    const app = adminApp(db, "secret");
    const res = await app.inject({
      method: "POST",
      url: `/admin/reports/${report.id}/action`,
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      payload: { action: "ban" },
    });
    expect(res.statusCode).toBe(200);
    expect(db.answers.get(answer.id)?.flagged).toBe(true);
    expect(db.players.get(author.id)?.banned).toBe(true);
    expect(db.reports.find((r) => r.id === report.id)?.status).toBe("actioned");
  });

  it("'dismiss' closes the report without hiding the content", async () => {
    const db = new FakeDb();
    const { answer, report } = await seedReportedAnswer(db);
    const app = adminApp(db, "secret");
    const res = await app.inject({
      method: "POST",
      url: `/admin/reports/${report.id}/action`,
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      payload: { action: "dismiss" },
    });
    expect(res.statusCode).toBe(200);
    expect(db.answers.get(answer.id)?.flagged).toBe(false); // content untouched
    expect(db.reports.find((r) => r.id === report.id)?.status).toBe("dismissed");
  });
});
