/**
 * @fileoverview
 * Error codes and detail types for spec-time validation.
 *
 * @remarks
 * - Covers invalid spec shapes, enums, ranges, and DSL misuse.
 * - Emitted by `defineSpec` / spec validators before any plan is built.
 * - Registered into the global error registry as the `spec.*` domain.
 */

import {
  buildErrorDomain,
  DOMAIN_IDS,
  type BuiltErrorDomain,
  type DomainRegistry,
  type ErrorCodeOf,
  type ErrorDetails,
  type ErrorKeyOf,
  type KeyedErrorFactoryOf,
  type SeqlokError,
} from "@seqlok/base";

/**
 * Details for invalid parameter ranges.
 */
export interface SpecRangeDetails extends ErrorDetails {
  readonly key: string;
  readonly min?: number;
  readonly max?: number;
  readonly received?: number;
}

/**
 * Details for invalid enum specifications.
 */
export interface SpecEnumDetails extends ErrorDetails {
  readonly key: string;
  readonly values: readonly string[];
  readonly received?: string | number;
  readonly duplicate?: string;
  readonly invalidIndex?: number;
}

/**
 * Details for invalid array specifications.
 */
export interface SpecArrayDetails extends ErrorDetails {
  readonly key: string;
  readonly length: number;
  readonly reason: "nonPositive" | "fractional";
}

/**
 * Details for duplicate keys in params or meters sections.
 */
export interface SpecDuplicateKeyDetails extends ErrorDetails {
  readonly key: string;
  readonly section: "params" | "meters";
}

/**
 * Details for builder overflow-risk failures.
 *
 * @remarks
 * Used when an array length (or future size check) exceeds safety caps.
 * This carries additional structured fields so logs/UIs can explain the limit.
 */
export interface SpecBuilderOverflowRiskDetails extends ErrorDetails {
  readonly reason: "overflowRisk";
  readonly key: string;

  readonly maxArrayLength: number;
  readonly receivedLength: number;

  /**
   * Conservative worst-case byte estimates (assumes 8 bytes/element).
   * We report worst-case because the checker may not know the element kind.
   */
  readonly bytesWorstCaseMax: number;
  readonly bytesWorstCaseReceived: number;

  /**
   * Human guidance for the fix (e.g. "use a ring/stream, not a giant spec array").
   */
  readonly hint: string;
}

/**
 * Details for other high-level builder failures.
 *
 * @remarks
 * Kept intentionally small; the specific "builderInvalid" reasons are used
 * across spec validation and planning entrypoints.
 */
export interface SpecBuilderGeneralDetails extends ErrorDetails {
  readonly key?: string;
  readonly reason?:
    | "invalidKind"
    | "missingId"
    | "emptyParams"
    | "missingMinMax"
    | "planFailed"
    | "alignmentFailed";
  readonly totalBytes?: number;
  readonly maxSafeBytes?: number;
}

/**
 * Details for high-level builder failures.
 *
 * @remarks
 * Discriminated by `reason` so specific failure modes can demand richer fields
 * without weakening typing for all builderInvalid errors.
 */
export type SpecBuilderDetails =
  | SpecBuilderOverflowRiskDetails
  | SpecBuilderGeneralDetails;

interface SpecDetailsByKey {
  readonly rangeInvalid: SpecRangeDetails;
  readonly enumInvalid: SpecEnumDetails;
  readonly arrayInvalid: SpecArrayDetails;
  readonly duplicateKey: SpecDuplicateKeyDetails;
  readonly builderInvalid: SpecBuilderDetails;
}

const SPEC_DEFS = {
  rangeInvalid: {
    message: "Parameter range invalid",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  enumInvalid: {
    message: "Enum validation failed",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  arrayInvalid: {
    message: "Array definition invalid",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  duplicateKey: {
    message: "Duplicate key in params or meters",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  builderInvalid: {
    message: "Spec builder validation failed",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: false,
    },
  },
} as const;

type SpecDefs = typeof SPEC_DEFS;

export const SPEC: BuiltErrorDomain<"spec", SpecDefs> = buildErrorDomain(
  "spec",
  DOMAIN_IDS.spec,
  SPEC_DEFS,
);

export type SpecErrorCode = ErrorCodeOf<typeof SPEC>;
export type SpecErrorKey = ErrorKeyOf<typeof SPEC>;
export type SpecError = SeqlokError<SpecErrorCode>;

export const SPEC_ERRORS: DomainRegistry<"spec", SpecDefs> = SPEC.registry;

export const createSpecError: KeyedErrorFactoryOf<
  BuiltErrorDomain<"spec", SpecDefs>,
  SpecDetailsByKey
> = SPEC.createError;

export type SpecErrorFactory = typeof createSpecError;
