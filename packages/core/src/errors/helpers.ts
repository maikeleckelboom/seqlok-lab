/**
 * @fileoverview
 * Convenience helpers for constructing and throwing SeqlokError instances.
 *
 * @remarks
 * - Wraps {@link createError} for foundation, cross-cutting error patterns.
 * - Keeps domain-specific error construction (env/backing/etc.) out of hot paths.
 * - Intended for helpers that may be used across multiple modules or layers.
 */

import { createError } from "./error";

import type { EnvUnsupportedDetails } from "./codes/env";

export function throwEnvUnsupported(
  feature: EnvUnsupportedDetails["feature"] & (string & {}),
  reason: string,
  cause?: unknown,
): never {
  throw createError(
    "env.unsupported",
    `${feature} unavailable`,
    {
      feature,
      reason,
    } satisfies EnvUnsupportedDetails,
    cause,
  );
}
