/**
 * In-memory FIFO of queued prompt ids. The DB is the durable truth (the atomic
 * claim happens there); this is the fast "is there work / ordering" hint. Always
 * mutated alongside the data-layer calls so the two don't drift, and rebuilt
 * from the DB on boot.
 */

import type { QueueService, Db } from "../types";

export class InMemoryQueue implements QueueService {
  private ids: string[] = [];

  async rebuild(db: Db): Promise<void> {
    const rows = await db.listQueuedPrompts();
    this.ids = rows.map((r) => r.id);
  }

  push(promptId: string): void {
    if (!this.ids.includes(promptId)) this.ids.push(promptId);
  }

  remove(promptId: string): void {
    const i = this.ids.indexOf(promptId);
    if (i >= 0) this.ids.splice(i, 1);
  }

  size(): number {
    return this.ids.length;
  }
}
