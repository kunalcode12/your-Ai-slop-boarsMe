/** Tiny structured logger (JSON lines). Swap for pino later if needed. */

import type { Logger } from "./types";

function emit(level: string, args: unknown[]): void {
  const [first, ...rest] = args;
  const base =
    typeof first === "object" && first !== null
      ? { ...(first as Record<string, unknown>), msg: rest.join(" ") }
      : { msg: args.join(" ") };
  const line = JSON.stringify({ t: new Date().toISOString(), level, ...base });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export function createLogger(): Logger {
  return {
    info: (...a: unknown[]) => emit("info", a),
    warn: (...a: unknown[]) => emit("warn", a),
    error: (...a: unknown[]) => emit("error", a),
    debug: (...a: unknown[]) => {
      if (process.env.DEBUG) emit("debug", a);
    },
  };
}
