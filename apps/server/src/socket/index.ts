/** Socket.IO wiring: handshake, per-connection handler registration, errors. */

import { ZodError } from "zod";
import { pubkeySchema, SocketEvents } from "@slop/shared";
import { isAppError } from "../errors";
import type { Services, TypedSocket } from "../types";
import { submitPrompt, requestWork, submitAnswer, report } from "./handlers";
import { doHandshake, releaseClaim } from "./lifecycle";

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

function onDisconnect(services: Services, socket: TypedSocket, pubkey: string): void {
  services.presence.unbind(pubkey);
  // any prompt this socket was answering goes back to the queue (treated as a ghost)
  for (const claim of services.timers.getBySocket(socket.id)) {
    void releaseClaim(services, claim, { penalize: true });
  }
}

export function registerSocket(services: Services): void {
  const { io, log } = services;

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
      services.presence.bind(pubkey);
      socket.on("disconnect", () => onDisconnect(services, socket, pubkey));

      let session;
      try {
        session = await doHandshake(services, socket, pubkey);
      } catch (e) {
        log.error({ err: String(e), pubkey }, "handshake failed");
        socket.emit(SocketEvents.Error, { code: "internal_error", message: "couldn't load your account 💀" });
        return;
      }
      if (!session) return; // rejected (banned) + already disconnected

      // --- per-connection handler registration (each wrapped) ---
      const run = (fn: () => Promise<void>): void => {
        fn().catch((e) => emitError(services, socket, e));
      };

      socket.on(SocketEvents.PromptSubmit, (p) => run(() => submitPrompt(services, socket, session, p)));
      socket.on(SocketEvents.WorkRequest, (p) => run(() => requestWork(services, socket, session, p)));
      socket.on(SocketEvents.AnswerSubmit, (p) => run(() => submitAnswer(services, socket, session, p)));
      socket.on(SocketEvents.Report, (p) => run(() => report(services, socket, session, p)));
    })();
  });
}
