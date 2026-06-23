/** Online-state + per-player in-memory session registry. */

import type { ClientMode, PresenceUpdatePayload } from "@slop/shared";
import type { Presence, PlayerSession } from "../types";

export class PresenceService implements Presence {
  private counts = new Map<string, number>();
  private sessions = new Map<string, PlayerSession>();
  /** socketId -> current mode. One entry per connected client; drives live counts. */
  private socketModes = new Map<string, ClientMode>();

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

  setSocketMode(socketId: string, mode: ClientMode): void {
    this.socketModes.set(socketId, mode);
  }

  dropSocket(socketId: string): void {
    this.socketModes.delete(socketId);
  }

  liveCounts(): PresenceUpdatePayload {
    let humans = 0;
    let larpers = 0;
    for (const mode of this.socketModes.values()) {
      if (mode === "larp") larpers += 1;
      else humans += 1;
    }
    return { online: humans + larpers, humans, larpers };
  }
}
