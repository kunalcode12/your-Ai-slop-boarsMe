/** Socket.IO wiring: handshake, per-connection handler registration, errors. */

import { ZodError } from "zod";
import { pubkeySchema, presenceModeSchema, SocketEvents } from "@slop/shared";
import { isAppError } from "../errors";
import type { Services, TypedSocket } from "../types";
import { submitPrompt, requestWork, submitAnswer, report } from "./handlers";
import { doHandshake, releaseClaim, deliverAnswer } from "./lifecycle";

function emitError(services: Services, socket: TypedSocket, e: unknown): void {
  if (e instanceof ZodError) {
    socket.emit(SocketEvents.Error, { code: "invalid_payload", message: "that input looked wrong 💀" });
  } else if (isAppError(e)) {
    socket.emit(SocketEvents.Error, { code: e.code, message: e.message });
  } else {
    services.log.error({ err: String(e) }, "unhandled handler error");
    socket.emit(SocketEvents.Error, { code: "internal_error", message: "something broke on our end 💀" });
  }
}

export function registerSocket(services: Services): void {
  const { io, log, presence } = services;

  // Throttled live-counts broadcast — coalesces connect/mode/disconnect storms so
  // a reconnect flood can't spam every client (at most one emit per ~400ms).
  let presenceTimer: ReturnType<typeof setTimeout> | null = null;
  const broadcastPresence = (): void => {
    if (presenceTimer) return;
    presenceTimer = setTimeout(() => {
      presenceTimer = null;
      try {
        io.emit(SocketEvents.PresenceUpdate, presence.liveCounts());
      } catch {
        /* presence is non-critical; ignore (e.g. server shutting down) */
      }
    }, 400);
  };

  io.on("connection", (socket: TypedSocket) => {
    void (async () => {
      // --- identity / handshake ---
      let pubkey: string;
      try {
        pubkey = pubkeySchema.parse(socket.handshake.auth?.pubkey);
      } catch {
        socket.emit(SocketEvents.Error, { code: "invalid_payload", message: "missing or bad pubkey" });
        socket.disconnect(true);
        return;
      }
      // (optional ownership signature can be verified here later)
      socket.data.pubkey = pubkey;
      await socket.join(pubkey);
      presence.bind(pubkey);

      socket.on("disconnect", () => {
        presence.unbind(pubkey);
        presence.dropSocket(socket.id);
        // any prompt this socket was answering goes back to the queue (ghost)
        for (const claim of services.timers.getBySocket(socket.id)) {
          void releaseClaim(services, claim, { penalize: true });
        }
        broadcastPresence();
      });

      let hs;
      try {
        hs = await doHandshake(services, socket, pubkey);
      } catch (e) {
        log.error({ err: String(e), pubkey }, "handshake failed");
        socket.emit(SocketEvents.Error, { code: "internal_error", message: "couldn't load your account 💀" });
        return;
      }
      if (!hs) return; // rejected (banned) + already disconnected
      const { session, statePayload } = hs;

      // count this client (default to the "human" tab)
      presence.setSocketMode(socket.id, "human");

      // --- register handlers FIRST, so the client can safely act the instant it
      // receives player:state (otherwise a fast prompt:submit / work:request can
      // land before the listeners exist and get silently dropped) ---
      const run = (fn: () => Promise<void>): void => {
        fn().catch((e) => emitError(services, socket, e));
      };

      socket.on(SocketEvents.PromptSubmit, (p) => run(() => submitPrompt(services, socket, session, p)));
      socket.on(SocketEvents.WorkRequest, (p) => run(() => requestWork(services, socket, session, p)));
      socket.on(SocketEvents.AnswerSubmit, (p) => run(() => submitAnswer(services, socket, session, p)));
      socket.on(SocketEvents.Report, (p) => run(() => report(services, socket, session, p)));
      socket.on(SocketEvents.PresenceMode, (p) => {
        try {
          const { mode } = presenceModeSchema.parse(p);
          presence.setSocketMode(socket.id, mode);
          broadcastPresence();
        } catch {
          /* ignore malformed presence pings — they're non-critical */
        }
      });

      // --- NOW signal readiness + live counts (handlers are live) ---
      socket.emit(SocketEvents.PlayerState, statePayload);
      socket.emit(SocketEvents.PresenceUpdate, presence.liveCounts());
      broadcastPresence();

      // deliver anything that arrived while the player was offline
      try {
        const undelivered = await services.db.getUndeliveredAnswersForRequester(session.playerId);
        for (const a of undelivered) await deliverAnswer(services, a, pubkey);
      } catch (e) {
        log.error({ err: String(e), pubkey }, "undelivered backfill failed");
      }
    })();
  });
}
