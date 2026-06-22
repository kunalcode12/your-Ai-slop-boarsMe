/** Online-state + per-player in-memory session registry. */

import type { Presence, PlayerSession } from "../types";

export class PresenceService implements Presence {
  private counts = new Map<string, number>();
  private sessions = new Map<string, PlayerSession>();

  bind(pubkey: string): void {
    this.counts.set(pubkey, (this.counts.get(pubkey) ?? 0) + 1);
  }

  unbind(pubkey: string): void {
    const n = (this.counts.get(pubkey) ?? 0) - 1;
    if (n <= 0) {
      this.counts.delete(pubkey);
      this.sessions.delete(pubkey);
    } else {
      this.counts.set(pubkey, n);
    }
  }

  isOnline(pubkey: string): boolean {
    return (this.counts.get(pubkey) ?? 0) > 0;
  }

  setSession(pubkey: string, session: PlayerSession): void {
    this.sessions.set(pubkey, session);
  }

  getSession(pubkey: string): PlayerSession | undefined {
    return this.sessions.get(pubkey);
  }

  clearSession(pubkey: string): void {
    this.sessions.delete(pubkey);
  }
}
