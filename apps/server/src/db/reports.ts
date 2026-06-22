/** Moderation reports + auto-hide. */

import { getDb } from "./client";
import type { ReportRow, ReportTargetType } from "./types";

export interface CreateReportInput {
  targetType: ReportTargetType;
  targetId: string;
  reporterId: string;
  reason?: string | null;
}

/**
 * File a report. A unique (reporter, target) index means a single user can't
 * inflate the count; a duplicate is swallowed (idempotent) and the existing row
 * returned.
 */
export async function createReport(
  input: CreateReportInput,
): Promise<ReportRow> {
  const { data, error } = await getDb()
    .from("reports")
    .upsert(
      {
        target_type: input.targetType,
        target_id: input.targetId,
        reporter_id: input.reporterId,
        reason: input.reason ?? null,
      },
      { onConflict: "reporter_id,target_type,target_id", ignoreDuplicates: false },
    )
    .select()
    .single();
  if (error) throw new Error(`createReport: ${error.message}`);
  return data;
}

export async function countReportsForTarget(
  targetType: ReportTargetType,
  targetId: string,
): Promise<number> {
  const { count, error } = await getDb()
    .from("reports")
    .select("*", { count: "exact", head: true })
    .eq("target_type", targetType)
    .eq("target_id", targetId);
  if (error) throw new Error(`countReportsForTarget: ${error.message}`);
  return count ?? 0;
}

/**
 * Hide the target if its report count is at/over the threshold
 * (AUTO_HIDE_REPORT_COUNT). Answers get flagged=true; prompts get status='flagged'.
 * Returns whether it hid the target.
 */
export async function hideTargetIfOverThreshold(
  targetType: ReportTargetType,
  targetId: string,
  threshold: number,
): Promise<boolean> {
  const { data, error } = await getDb().rpc("hide_target_if_over_threshold", {
    p_target_type: targetType,
    p_target_id: targetId,
    p_threshold: threshold,
  });
  if (error) throw new Error(`hideTargetIfOverThreshold: ${error.message}`);
  return data;
}
