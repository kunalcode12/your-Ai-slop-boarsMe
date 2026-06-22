/** Typed, client-facing errors. Messages are lowercase + meme-y per the spec. */

import type { ErrorCode } from "@slop/shared";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Detect the on-chain InsufficientCredits error coming back from Anchor. */
export function isInsufficientCreditsChainError(e: unknown): boolean {
  const anchorCode = (e as { error?: { errorCode?: { code?: string } } })?.error?.errorCode?.code;
  if (anchorCode === "InsufficientCredits") return true;
  return /InsufficientCredits/i.test(String((e as { message?: string })?.message ?? ""));
}
