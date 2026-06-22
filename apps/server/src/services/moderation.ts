/**
 * Basic content moderation + minimum-effort checks.
 *
 * This is a deliberately simple wordlist filter + heuristics — enough to hard-
 * block the obvious stuff and reject zero-effort spam. Swap `checkText` for a
 * real moderation API later; the interface stays the same. Reporting +
 * auto-hide (PROMPT-2 RPCs) is the second line of defence.
 */

import { MAX_DRAWING_BYTES } from "@slop/shared";
import type { ModerationService } from "../types";

// Minimal hard-block list (slurs / explicit terms). Word-boundary matched.
// Intentionally short; replace with a maintained list / external service.
const BLOCKLIST = [
  "nigger",
  "faggot",
  "kike",
  "chink",
  "rape",
  "childporn",
  "cp",
];

const MIN_EFFORT_TEXT_CHARS = 2;
// A blank/near-empty PNG is tiny; require a little real ink. Heuristic only.
const MIN_DRAWING_BYTES = 512;

export class BasicModeration implements ModerationService {
  checkText(text: string): { blocked: boolean; reason?: string } {
    const lower = text.toLowerCase();
    for (const word of BLOCKLIST) {
      const re = new RegExp(`\\b${word}\\b`, "i");
      if (re.test(lower)) return { blocked: true, reason: "blocked term" };
    }
    return { blocked: false };
  }

  hasMinEffortText(text: string): boolean {
    const t = text.trim();
    if (t.length < MIN_EFFORT_TEXT_CHARS) return false;
    // reject pure punctuation/whitespace
    return /[\p{L}\p{N}]/u.test(t);
  }

  hasMinEffortDrawing(png: Buffer): boolean {
    return png.length >= MIN_DRAWING_BYTES;
  }

  decodeImageDataUrl(dataUrl: string): { ok: boolean; buffer?: Buffer; reason?: string } {
    const m = /^data:image\/png;base64,(.+)$/s.exec(dataUrl);
    if (!m || !m[1]) return { ok: false, reason: "not a png data url" };
    let buffer: Buffer;
    try {
      buffer = Buffer.from(m[1], "base64");
    } catch {
      return { ok: false, reason: "bad base64" };
    }
    if (buffer.length === 0) return { ok: false, reason: "empty image" };
    if (buffer.length > MAX_DRAWING_BYTES) return { ok: false, reason: "image too large" };
    return { ok: true, buffer };
  }
}
