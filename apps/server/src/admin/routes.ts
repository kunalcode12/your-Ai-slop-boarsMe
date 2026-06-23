/**
 * Protected moderation REST surface. Lets a human moderator review open reports
 * and action them (dismiss / hide the content / hide + ban the author).
 *
 * AUTH: a single static bearer token (`ADMIN_TOKEN`). If unset, every /admin
 * route returns 503 (disabled) — safe for local dev. This is intentionally
 * minimal; production would use real auth + an audit log (see MODERATION.md).
 *
 * Nothing here ever touches the chain — moderation is entirely off-chain.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Services } from "../types";

type ActionBody = { action?: "dismiss" | "hide" | "ban" };

export function registerAdminRoutes(
  app: FastifyInstance,
  services: Services,
  adminToken: string,
): void {
  const { db, log } = services;

  // Bearer-token guard. Returns true if the request may proceed.
  const allow = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (!adminToken) {
      reply.code(503).send({ error: "admin disabled: set ADMIN_TOKEN to enable moderation" });
      return false;
    }
    if (req.headers.authorization !== `Bearer ${adminToken}`) {
      reply.code(401).send({ error: "unauthorized" });
      return false;
    }
    return true;
  };

  /** GET /admin/reports?status=open|actioned|dismissed|all — list reports + target preview. */
  app.get("/admin/reports", async (req, reply) => {
    if (!allow(req, reply)) return reply;
    const status = ((req.query as { status?: string })?.status ?? "open") as
      | "open"
      | "actioned"
      | "dismissed"
      | "all";
    const reports = await db.listReports(status);
    const enriched = await Promise.all(
      reports.map(async (r) => {
        let preview: string | null = null;
        let authorPubkey: string | null = null;
        let hidden = false;
        if (r.target_type === "prompt") {
          const p = await db.getPromptById(r.target_id);
          preview = p?.body?.slice(0, 280) ?? "[deleted]";
          hidden = p?.status === "flagged";
          if (p) authorPubkey = (await db.getPlayerById(p.requester_id))?.wallet_pubkey ?? null;
        } else {
          const a = await db.getAnswerById(r.target_id);
          preview = a?.body_text?.slice(0, 280) ?? (a?.image_url ? "[drawing]" : "[deleted]");
          hidden = a?.flagged ?? false;
          if (a) authorPubkey = (await db.getPlayerById(a.answerer_id))?.wallet_pubkey ?? null;
        }
        return {
          id: r.id,
          targetType: r.target_type,
          targetId: r.target_id,
          reason: r.reason,
          status: r.status,
          createdAt: r.created_at,
          preview,
          authorPubkey,
          hidden,
        };
      }),
    );
    return { count: enriched.length, reports: enriched };
  });

  /** POST /admin/reports/:id/action  body { action: "dismiss"|"hide"|"ban" }. */
  app.post("/admin/reports/:id/action", async (req, reply) => {
    if (!allow(req, reply)) return reply;
    const { id } = req.params as { id: string };
    const { action } = (req.body as ActionBody) ?? {};
    const report = await db.getReportById(id);
    if (!report) return reply.code(404).send({ error: "report not found" });

    if (action === "dismiss") {
      await db.setReportStatus(id, "dismissed");
      log.info({ reportId: id }, "report dismissed by mod");
      return { ok: true, action };
    }

    if (action === "hide" || action === "ban") {
      await db.hideTarget(report.target_type, report.target_id);
      if (action === "ban") {
        const authorId =
          report.target_type === "prompt"
            ? (await db.getPromptById(report.target_id))?.requester_id
            : (await db.getAnswerById(report.target_id))?.answerer_id;
        if (authorId) await db.banPlayer(authorId);
      }
      await db.setReportStatus(id, "actioned");
      log.info({ reportId: id, action }, "report actioned by mod");
      return { ok: true, action };
    }

    return reply.code(400).send({ error: "action must be one of: dismiss, hide, ban" });
  });
}
