/**
 * @fileoverview
 * Shared, cross-domain error detail types for Seqlok.
 *
 * @remarks
 * - This module defines only structural detail interfaces that are reused
 *   across multiple error domains (spec, binding, backing, diagnostics, etc.).
 * - It must not introduce domain-specific error codes or env/backing/plan
 *   special cases; those belong in the corresponding `errors/codes/*` modules.
 * - Types here are extended by concrete detail shapes and used for both
 *   runtime error reporting and compile-time type checking.
 */

import type { ErrorDetails } from "./registry";
import type { TypedArrayName } from "./types";

/**
 * Shared shape for numeric range validations.
 *
 * Used by both spec-time (SpecRangeDetails) and binding-time
 * (BindingParamRangeDetails) range checks.
 */
export interface RangeDetails extends ErrorDetails {
  readonly key: string;
  readonly min?: number;
  readonly max?: number;
  readonly received?: number;
}

/**
 * Shared shape for "into" / snapshot buffer mismatches.
 *
 * Used by backing.into* and binding.snapshotInto* errors.
 */
export interface BufferDetails extends ErrorDetails {
  readonly key: string;
  readonly expectedType: TypedArrayName;
  readonly receivedType: string;
  readonly expectedLength: number;
  readonly receivedLength: number;
}

/**
 * Enum validation details.
 *
 * Used for spec-time enum checking and binding-time value validation.
 */
export interface EnumDetails extends ErrorDetails {
  readonly key: string;
  readonly values: readonly string[];
  readonly received?: string | number;
  readonly duplicate?: string;
  readonly invalidIndex?: number;
}

/**
 * Unknown key in a given logical scope (params/meters/etc).
 */
export interface UnknownKeyDetails extends ErrorDetails {
  readonly scope: "params" | "meters";
  readonly key: string;
  readonly known?: readonly string[];
}

/**
 * Allocation details (bytes requested/allocated).
 */
export interface AllocationDetails extends ErrorDetails {
  readonly requestedBytes?: number;
  readonly allocatedBytes?: number;
}

/**
 * Plane operation details (which plane, optional extra context).
 */
export interface PlaneDetails extends ErrorDetails {
  readonly plane: string;
}

/**
 * Coherent read / retry details.
 */
export interface CoherentDetails extends ErrorDetails {
  readonly retries?: number;
  readonly spins?: number;
}

/**
 * Coherent snapshot retry details.
 */
export interface SnapshotRetryDetails extends CoherentDetails {
  readonly section: "params" | "meters";
}
