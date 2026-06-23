/** Unit tests for the moderation primitives (hard-block, effort, image decode). */

import { describe, expect, it } from "vitest";
import { MAX_DRAWING_BYTES } from "@slop/shared";
import { BasicModeration } from "../src/services/moderation";

const mod = new BasicModeration();
const pngDataUrl = (buf: Buffer) => `data:image/png;base64,${buf.toString("base64")}`;

describe("moderation", () => {
  it("hard-blocks slurs / banned terms, allows normal text", () => {
    expect(mod.checkText("make a rape joke").blocked).toBe(true);
    expect(mod.checkText("explain recursion to a dog").blocked).toBe(false);
  });

  it("min-effort text rejects empty / punctuation-only", () => {
    expect(mod.hasMinEffortText("")).toBe(false);
    expect(mod.hasMinEffortText("...")).toBe(false);
    expect(mod.hasMinEffortText("woof")).toBe(true);
  });

  it("decodeImageDataUrl rejects non-png and oversized, accepts a small png", () => {
    expect(mod.decodeImageDataUrl("data:text/plain;base64,aGVsbG8=").ok).toBe(false);
    const oversized = pngDataUrl(Buffer.alloc(MAX_DRAWING_BYTES + 100));
    const big = mod.decodeImageDataUrl(oversized);
    expect(big.ok).toBe(false);
    expect(big.reason).toMatch(/large/);
    const ok = mod.decodeImageDataUrl(pngDataUrl(Buffer.from([1, 2, 3, 4, 5])));
    expect(ok.ok).toBe(true);
    expect(ok.buffer?.length).toBe(5);
  });

  it("min-effort drawing rejects a near-blank png", () => {
    expect(mod.hasMinEffortDrawing(Buffer.alloc(10))).toBe(false);
    expect(mod.hasMinEffortDrawing(Buffer.alloc(2000))).toBe(true);
  });
});
