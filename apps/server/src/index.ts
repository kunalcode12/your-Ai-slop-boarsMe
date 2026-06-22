/** Server bootstrap: Fastify + Socket.IO, /health, sweeper, graceful shutdown. */

import Fastify from "fastify";
import cors from "@fastify/cors";
import { Server } from "socket.io";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
} from "@slop/shared";
import { loadConfig } from "./config";
import { createLogger } from "./log";
import { createServices } from "./services";
import { registerSocket } from "./socket";
import { bootRecovery, expirySweep } from "./socket/lifecycle";

const EXPIRY_SWEEP_INTERVAL_MS = 30_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger();

  const app = Fastify({ logger: false });
  await app.register(cors, { origin: config.clientOrigin });
  app.get("/health", async () => ({ ok: true, ts: Date.now() }));

  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(app.server, { cors: { origin: config.clientOrigin } });

  const { services, shutdown } = createServices(config, io, log);

  await bootRecovery(services);
  registerSocket(services);
  const sweep = setInterval(() => void expirySweep(services), EXPIRY_SWEEP_INTERVAL_MS);

  await app.listen({ port: config.port, host: "0.0.0.0" });
  log.info({ port: config.port, origin: config.clientOrigin }, "slop server up 💀");

  let closing = false;
  const close = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    log.info({ signal }, "shutting down");
    clearInterval(sweep);
    shutdown();
    io.close();
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void close("SIGINT"));
  process.on("SIGTERM", () => void close("SIGTERM"));
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
