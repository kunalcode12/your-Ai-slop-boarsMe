/** Answers: guarded creation, delivery tracking, reconnect backfill. */

import type { AnswerType } from "@slop/shared";
import { getDb } from "./client";
import type { AnswerRow } from "./types";

export interface CreateAnswerInput {
  promptId: string;
  answererId: string;
  type: AnswerType;
  bodyText: string | null;
  imageUrl: string | null;
  timeTakenMs: number;
  /** Answer window in ms (ANSWER_TIME_LIMIT_MS) — the RPC rejects late answers. */
  timeLimitMs: number;
}

/**
 * Create an answer via the guarded `submit_answer` RPC: it only succeeds if the
 * answerer still holds a valid, in-time claim on the prompt, and it also marks
 * the prompt 'answered' and bumps answers_given atomically. Returns null when
 * the claim is invalid/expired (caller maps that to deadline_passed/not_your_work).
 * The +1 credit EARN is on-chain + applyCreditDelta, done AFTER this succeeds.
 */
export async function createAnswer(
  input: CreateAnswerInput,
): Promise<AnswerRow | null> {
  const { data, error } = await getDb().rpc("submit_answer", {
    p_prompt_id: input.promptId,
    p_answerer_id: input.answererId,
    p_type: input.type,
    p_body_text: input.bodyText,
    p_image_url: input.imageUrl,
    p_time_taken_ms: input.timeTakenMs,
    p_time_limit_ms: input.timeLimitMs,
  });
  if (error) throw new Error(`createAnswer: ${error.message}`);
  return data[0] ?? null;
}

export async function markAnswerDelivered(answerId: string): Promise<void> {
  const { error } = await getDb()
    .from("answers")
    .update({ delivered: true })
    .eq("id", answerId);
  if (error) throw new Error(`markAnswerDelivered: ${error.message}`);
}

/** Answers that arrived while the requester was offline (excludes hidden). */
export async function getUndeliveredAnswersForRequester(
  requesterId: string,
): Promise<AnswerRow[]> {
  const { data, error } = await getDb().rpc(
    "get_undelivered_answers_for_requester",
    { p_requester_id: requesterId },
  );
  if (error) throw new Error(`getUndeliveredAnswersForRequester: ${error.message}`);
  return data;
}
