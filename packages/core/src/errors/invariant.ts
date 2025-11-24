/**
 * @fileoverview
 * Runtime assertion utilities for Seqlok.
 *
 * @remarks
 * - Provides type-safe invariant checks for runtime validation.
 * - Throws standardized SeqlokError with proper error codes and details.
 * - Used for internal assertions and preconditions throughout the codebase.
 */

import { createError } from "./error";

import type { ErrorCode, ErrorPayload } from "./types";

export function invariant<C extends ErrorCode>(
  condition: unknown,
  code: C,
  message: string,
  details: ErrorPayload<C> = {} as ErrorPayload<C>,
): asserts condition {
  if (!condition) {
    throw createError(code, message, details);
  }
}
