/** 60-second claim timers, keyed by prompt id. */

import type { TimerService, ClaimInfo } from "../types";

interface Entry {
  info: ClaimInfo;
  handle: ReturnType<typeof setTimeout>;
}

export class ClaimTimers implements TimerService {
  private entries = new Map<string, Entry>();
  private locks = new Set<string>();

  lock(socketId: string): boolean {
    if (this.locks.has(socketId)) return false;
    this.locks.add(socketId);
    return true;
  }

  unlock(socketId: string): void {
    this.locks.delete(socketId);
  }

  startClaim(info: ClaimInfo, onTimeout: (info: ClaimInfo) => void): void {
    // never double-arm the same prompt
    this.clear(info.promptId);
    const ms = Math.max(0, info.deadlineAt - Date.now());
    const handle = setTimeout(() => {
      this.entries.delete(info.promptId);
      onTimeout(info);
    }, ms);
    this.entries.set(info.promptId, { info, handle });
  }

  get(promptId: string): ClaimInfo | undefined {
    return this.entries.get(promptId)?.info;
  }

  getBySocket(socketId: string): ClaimInfo[] {
    const out: ClaimInfo[] = [];
    for (const { info } of this.entries.values()) {
      if (info.socketId === socketId) out.push(info);
    }
    return out;
  }

  clear(promptId: string): void {
    const e = this.entries.get(promptId);
    if (e) {
      clearTimeout(e.handle);
      this.entries.delete(promptId);
    }
  }

  clearAll(): void {
    for (const e of this.entries.values()) clearTimeout(e.handle);
    this.entries.clear();
  }
}
