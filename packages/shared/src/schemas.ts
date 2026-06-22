/**
 * Zod schemas for every payload that crosses the wire. The game server MUST
 * validate inbound client payloads against these at the socket boundary; the
 * inferred TS types are reused as the typed Socket.IO client->server payloads.
 */

import { z } from "zod";
import { PROMPT_TYPES, ANSWER_TYPES } from "./types";
import { MAX_PROMPT_LENGTH, MAX_ANSWER_LENGTH } from "./constants";

/** Base58 Solana pubkey (32 bytes -> 43-44 chars; allow a small range). */
export const pubkeySchema = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "invalid base58 pubkey");

// ---------------------------------------------------------------------------
// client -> server payloads
// ---------------------------------------------------------------------------

/** human mode: submit a prompt to the "AI". */
export const submitPromptSchema = z.object({
  type: z.enum(PROMPT_TYPES),
  body: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
});
export type SubmitPromptInput = z.infer<typeof submitPromptSchema>;

/** larp mode: ask for a prompt to answer. No fields today; kept for forward-compat. */
export const requestWorkSchema = z.object({}).strict();
export type RequestWorkInput = z.infer<typeof requestWorkSchema>;

/**
 * larp mode: submit an answer to a claimed prompt.
 * Text answers carry `body`; image answers carry `imageDataUrl` (a base64 PNG
 * data URL exported from the canvas). Exactly one must be present, matching
 * `type`.
 */
export const submitAnswerSchema = z
  .object({
    promptId: z.string().uuid(),
    type: z.enum(ANSWER_TYPES),
    body: z.string().trim().min(1).max(MAX_ANSWER_LENGTH).nullable().optional(),
    imageDataUrl: z
      .string()
      .regex(/^data:image\/png;base64,/, "must be a base64 PNG data URL")
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === "text" && !val.body) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "text answers require a body",
        path: ["body"],
      });
    }
    if (val.type === "image" && !val.imageDataUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "image answers require an imageDataUrl",
        path: ["imageDataUrl"],
      });
    }
  });
export type SubmitAnswerInput = z.infer<typeof submitAnswerSchema>;

/** Report a prompt or an answer for moderation. At least one target required. */
export const reportSchema = z
  .object({
    promptId: z.string().uuid().optional(),
    answerId: z.string().uuid().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((d) => Boolean(d.promptId) || Boolean(d.answerId), {
    message: "a report must target a promptId or an answerId",
  });
export type ReportInput = z.infer<typeof reportSchema>;
