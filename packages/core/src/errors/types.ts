/**
 * @fileoverview
 * Centralized error type exports for Seqlok.
 *
 * @remarks
 * - Re-exports all error types from their respective modules.
 * - Serves as a single import point for error-related types.
 * - Organizes types by domain (primitives, env, plan, etc.).
 * - Maintains type safety across the error handling system.
 */

import type { CodeToPayload, ErrorCode } from "./registry";
import type { AssertTrue, IsExact } from "../internal/type-assert";

export {
  ERROR_META,
  type ErrorCode,
  type ErrorPayload,
  type ErrorDetails,
  type ErrorMeta,
  type TypedArrayName,
} from "./registry";

export { interpretHealth, type HealthInterpretation } from "./health";

export type * from "./codes/primitives";
export type * from "./codes/env";
export type * from "./codes/plan";
export type * from "./codes/backing";
export type * from "./codes/handoff";
export type * from "./codes/binding";
export type * from "./codes/diagnostics";
export type * from "./codes/internal";
export type * from "./codes/spec";

/**
 * Compile-time guard: keep ErrorCode and CodeToPayload in perfect lockstep.
 *
 * @remarks
 * - Ensures every ErrorCode has a payload entry.
 * - Ensures CodeToPayload does not define unknown codes.
 * - Causes a compile error if either side drifts silently.
 */
type CodesFromPayloads = keyof CodeToPayload;
type ErrorCodeMatchesPayloads = IsExact<ErrorCode, CodesFromPayloads>;

/** @internal */
export type _ErrorCodeMatchesCodeToPayload =
  AssertTrue<ErrorCodeMatchesPayloads>;
