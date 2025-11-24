/**
 * @fileoverview
 * Error codes and detail types for spec-time validation.
 *
 * @remarks
 * - Covers invalid spec shapes, enums, ranges, and DSL misuse.
 * - Emitted by `defineSpec` / spec validators before any plan is built.
 * - Registered into the global error registry as the `spec.*` domain.
 */

import type { AssertTrue, IsExact } from "../../internal/type-assert";
import type { EnumDetails, RangeDetails } from "../details";
import type { ErrorDetails, ErrorMeta } from "../registry";

export type SpecErrorCode =
  | "spec.rangeInvalid"
  | "spec.enumInvalid"
  | "spec.arrayInvalid"
  | "spec.duplicateKey"
  | "spec.builderInvalid";

export type SpecErrorKey =
  | "rangeInvalid"
  | "enumInvalid"
  | "arrayInvalid"
  | "duplicateKey"
  | "builderInvalid";

export interface SpecRangeDetails extends RangeDetails {
  readonly reason: "inverted" | "nan" | "infinite";
}

export type SpecEnumDetails = EnumDetails;

export interface SpecArrayDetails extends ErrorDetails {
  readonly key: string;
  readonly length: number;
  readonly reason: "nonPositive" | "fractional";
}

export interface SpecDuplicateKeyDetails extends ErrorDetails {
  readonly key: string;
  readonly section: "params" | "meters";
}

export interface SpecBuilderDetails extends ErrorDetails {
  readonly key?: string;
  readonly reason?:
    | "invalidKind"
    | "missingId"
    | "emptyParams"
    | "planFailed"
    | "alignmentFailed"
    | "overflowRisk";
  readonly totalBytes?: number;
  readonly maxSafeBytes?: number;
}

interface ErrorDescriptor<C extends string> {
  readonly code: C;
  readonly message: string;
  readonly meta: ErrorMeta;
}

interface SpecErrorsMap {
  rangeInvalid: ErrorDescriptor<"spec.rangeInvalid">;
  enumInvalid: ErrorDescriptor<"spec.enumInvalid">;
  arrayInvalid: ErrorDescriptor<"spec.arrayInvalid">;
  duplicateKey: ErrorDescriptor<"spec.duplicateKey">;
  builderInvalid: ErrorDescriptor<"spec.builderInvalid">;
}

const SPEC_ERRORS_DEF = {
  rangeInvalid: {
    code: "spec.rangeInvalid",
    message: "Parameter range invalid",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  enumInvalid: {
    code: "spec.enumInvalid",
    message: "Enum validation failed",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  arrayInvalid: {
    code: "spec.arrayInvalid",
    message: "Array definition invalid",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  duplicateKey: {
    code: "spec.duplicateKey",
    message: "Duplicate key in params or meters",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  builderInvalid: {
    code: "spec.builderInvalid",
    message: "Spec builder validation failed",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: false,
    },
  },
} as const satisfies SpecErrorsMap;

export const SPEC_ERRORS: SpecErrorsMap = SPEC_ERRORS_DEF;

type SpecCodesFromDescriptors = SpecErrorsMap[SpecErrorKey]["code"];
type SpecCodesEqual = IsExact<SpecErrorCode, SpecCodesFromDescriptors>;

/** @internal */
export type _SpecCodesMatch = AssertTrue<SpecCodesEqual>;
