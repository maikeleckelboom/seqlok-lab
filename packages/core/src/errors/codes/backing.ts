/**
 * @fileoverview
 * Error codes and detail types for backing/memory operations.
 *
 * @remarks
 * - Covers allocation, attachment, and buffer/plane shape validation.
 * - Used by shared/partitioned/Wasm backing allocators and helpers.
 * - Registered into the global error registry as the `backing.*` domain.
 */

import type { AssertTrue, IsExact } from "../../internal/type-assert";
import type { BufferDetails } from "../details";
import type { ErrorDetails, ErrorMeta } from "../registry";

export interface BackingPlaneDetails extends ErrorDetails {
  readonly plane: string;
  readonly requestedBytes: number;
  readonly allocatedBytes: number;
}

export interface BackingWasmMemoryDetails extends ErrorDetails {
  readonly plane: "wasm";
  readonly shared: boolean;
  readonly detail?: string;
}

export type BackingIntoDetails = BufferDetails;

export type BackingErrorCode =
  | "backing.allocFailed"
  | "backing.allocUndersized"
  | "backing.wasmMemoryNotShared"
  | "backing.intoTypeMismatch"
  | "backing.intoLengthMismatch";

export type BackingErrorKey =
  | "allocFailed"
  | "allocUndersized"
  | "wasmMemoryNotShared"
  | "intoTypeMismatch"
  | "intoLengthMismatch";

export interface ErrorDescriptor<C extends BackingErrorCode> {
  readonly code: C;
  readonly message: string;
  readonly meta: ErrorMeta;
}

interface BackingErrorsMap {
  allocFailed: ErrorDescriptor<"backing.allocFailed">;
  allocUndersized: ErrorDescriptor<"backing.allocUndersized">;
  wasmMemoryNotShared: ErrorDescriptor<"backing.wasmMemoryNotShared">;
  intoTypeMismatch: ErrorDescriptor<"backing.intoTypeMismatch">;
  intoLengthMismatch: ErrorDescriptor<"backing.intoLengthMismatch">;
}

/**
 * Domain-local descriptors used for IDE navigation and as a single
 * source of truth for code, message, and metadata.
 */
export const BACKING_ERRORS: BackingErrorsMap = {
  allocFailed: {
    code: "backing.allocFailed",
    message: "Backing allocation failed",
    meta: {
      severity: "fatal",
      recoverable: true,
      boundarySafe: true,
    },
  },
  allocUndersized: {
    code: "backing.allocUndersized",
    message: "Backing undersized for requested plan",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
  wasmMemoryNotShared: {
    code: "backing.wasmMemoryNotShared",
    message: "WebAssembly.Memory is not shared",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
  intoTypeMismatch: {
    code: "backing.intoTypeMismatch",
    message: "Into buffer typed array constructor mismatch",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
  intoLengthMismatch: {
    code: "backing.intoLengthMismatch",
    message: "Into buffer length mismatch",
    meta: {
      severity: "error",
      recoverable: true,
      boundarySafe: true,
    },
  },
} as const;

type BackingCodesFromDescriptors = BackingErrorsMap[BackingErrorKey]["code"];
type BackingCodesEqual = IsExact<BackingErrorCode, BackingCodesFromDescriptors>;

/** @internal */
export type _BackingCodesMatch = AssertTrue<BackingCodesEqual>;
