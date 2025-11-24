/**
 * @fileoverview
 * Error codes and detail types for binding-level failures.
 *
 * @remarks
 * - Covers controller/processor param validation and range violations.
 * - Includes snapshot/hydrate/stage and snapshotInto buffer mismatches.
 * - Registered into the global error registry as the `binding.*` domain.
 */

import type { AssertTrue, IsExact } from "../../internal/type-assert";
import type {
  BufferDetails,
  RangeDetails,
  UnknownKeyDetails,
} from "../details";
import type { ErrorDetails, ErrorMeta } from "../registry";

/**
 * Binding error codes.
 */
export type BindingErrorCode =
  | "binding.unknownKey"
  | "binding.paramRange"
  | "binding.paramInvalidValue"
  | "binding.shapeInvalid"
  | "binding.snapshotIntoTypeMismatch"
  | "binding.snapshotIntoLengthMismatch"
  | "binding.snapshotRetryExhausted"
  | "binding.coherentRetryExhausted";

/**
 * Unknown key in params/meters.
 *
 * We tighten the shared UnknownKeyDetails by requiring `known`.
 */
export interface BindingUnknownKeyDetails extends UnknownKeyDetails {
  readonly known: readonly string[];
}

/**
 * Param range details at the binding layer.
 *
 * Reuses shared RangeDetails vocabulary; for binding we typically do
 * have a concrete received value, but the field stays optional to
 * align with RangeDetails.
 */
export type BindingParamRangeDetails = RangeDetails;

/**
 * Invalid parameter value (type/shape/etc).
 */
export interface BindingInvalidValueDetails extends ErrorDetails {
  readonly key: string;
  readonly expected?: unknown;
  readonly received?: unknown;
}

/**
 * Invalid shape for a binding (e.g. wrong array rank / element count).
 */
export interface BindingShapeDetails extends ErrorDetails {
  readonly key: string;
  readonly detail?: string;
}

/**
 * Snapshot → typed array mismatches reuse the shared BufferDetails shape.
 */
export type BindingSnapshotIntoTypeMismatchDetails = BufferDetails;
export type BindingSnapshotIntoLengthMismatchDetails = BufferDetails;

/**
 * Descriptor shape for binding errors.
 */
interface BindingErrorDescriptor<C extends BindingErrorCode> {
  readonly code: C;
  readonly message: string;
  readonly meta: ErrorMeta;
}

/**
 * Key space for binding descriptors.
 */
export type BindingErrorKey =
  | "unknownKey"
  | "paramRange"
  | "paramInvalidValue"
  | "shapeInvalid"
  | "snapshotIntoTypeMismatch"
  | "snapshotIntoLengthMismatch"
  | "snapshotRetryExhausted"
  | "coherentRetryExhausted";

/**
 * Domain-local descriptors used for IDE navigation and as a single
 * source of truth for code, message, and metadata.
 *
 * NOTE:
 * - Explicit `BindingErrorsMap` type keeps `_TypeChecks` meaningful.
 * - Exported `BINDING_ERRORS` has an explicit annotation for
 *   `--isolatedDeclarations`.
 */
interface BindingErrorsMap {
  unknownKey: BindingErrorDescriptor<"binding.unknownKey">;
  paramRange: BindingErrorDescriptor<"binding.paramRange">;
  paramInvalidValue: BindingErrorDescriptor<"binding.paramInvalidValue">;
  shapeInvalid: BindingErrorDescriptor<"binding.shapeInvalid">;
  snapshotIntoTypeMismatch: BindingErrorDescriptor<"binding.snapshotIntoTypeMismatch">;
  snapshotIntoLengthMismatch: BindingErrorDescriptor<"binding.snapshotIntoLengthMismatch">;
  snapshotRetryExhausted: BindingErrorDescriptor<"binding.snapshotRetryExhausted">;
  coherentRetryExhausted: BindingErrorDescriptor<"binding.coherentRetryExhausted">;
}

export const BINDING_ERRORS: BindingErrorsMap = {
  unknownKey: {
    code: "binding.unknownKey",
    message: "Unknown binding key",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
  paramRange: {
    code: "binding.paramRange",
    message: "Param out of range",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
  paramInvalidValue: {
    code: "binding.paramInvalidValue",
    message: "Param invalid value",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
  shapeInvalid: {
    code: "binding.shapeInvalid",
    message: "Invalid shape",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
  snapshotIntoTypeMismatch: {
    code: "binding.snapshotIntoTypeMismatch",
    message: "Snapshot into: typed array mismatch",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: false,
    },
  },
  snapshotIntoLengthMismatch: {
    code: "binding.snapshotIntoLengthMismatch",
    message: "Snapshot into: length mismatch",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: false,
    },
  },
  snapshotRetryExhausted: {
    code: "binding.snapshotRetryExhausted",
    message: "Snapshot retries exhausted",
    meta: {
      severity: "warning",
      recoverable: true,
      boundarySafe: false,
    },
  },
  coherentRetryExhausted: {
    code: "binding.coherentRetryExhausted",
    message: "Coherent retries exhausted",
    meta: {
      severity: "warning",
      recoverable: true,
      boundarySafe: false,
    },
  },
} as const;

type BindingCodesFromDescriptors = BindingErrorsMap[BindingErrorKey]["code"];
type BindingCodesEqual = IsExact<BindingErrorCode, BindingCodesFromDescriptors>;

/** @internal */
export type _BindingCodesMatch = AssertTrue<BindingCodesEqual>;
