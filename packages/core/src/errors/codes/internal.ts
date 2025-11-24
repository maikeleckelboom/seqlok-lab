/**
 * @fileoverview
 * Error codes and detail types for internal invariants.
 *
 * @remarks
 * - Models `internal.*` failures surfaced via `invariant(...)`.
 * - Reserved for "this should never happen" situations in core code.
 * - Registered into the global error registry as the `internal.*` domain.
 */

import type { AssertTrue, IsExact } from "../../internal/type-assert";
import type { ErrorDetails, ErrorMeta } from "../registry";

export type InternalErrorCode =
  | "internal.assertionFailed"
  | "internal.unreachable"
  | "internal.exhaustiveness";

export interface InternalAssertionDetails extends ErrorDetails {
  readonly detail?: string;
}

interface InternalErrorDescriptor<C extends InternalErrorCode> {
  readonly code: C;
  readonly message: string;
  readonly meta: ErrorMeta;
}

export type InternalErrorKey =
  | "assertionFailed"
  | "unreachable"
  | "exhaustiveness";

interface InternalErrorsMap {
  assertionFailed: InternalErrorDescriptor<"internal.assertionFailed">;
  unreachable: InternalErrorDescriptor<"internal.unreachable">;
  exhaustiveness: InternalErrorDescriptor<"internal.exhaustiveness">;
}

export const INTERNAL_ERRORS: InternalErrorsMap = {
  assertionFailed: {
    code: "internal.assertionFailed",
    message: "Internal assertion failed",
    meta: {
      severity: "fatal",
      recoverable: false,
      boundarySafe: false,
    },
  },
  unreachable: {
    code: "internal.unreachable",
    message: "Unreachable code executed",
    meta: {
      severity: "fatal",
      recoverable: false,
      boundarySafe: false,
    },
  },
  exhaustiveness: {
    code: "internal.exhaustiveness",
    message: "Non-exhaustive branch",
    meta: {
      severity: "fatal",
      recoverable: false,
      boundarySafe: false,
    },
  },
} as const;

type InternalCodesFromDescriptors = InternalErrorsMap[InternalErrorKey]["code"];
type InternalCodesEqual = IsExact<
  InternalErrorCode,
  InternalCodesFromDescriptors
>;

/** @internal */
export type _InternalCodesMatch = AssertTrue<InternalCodesEqual>;
