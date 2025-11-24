/**
 * @fileoverview
 * Error codes and detail types for diagnostics and introspection.
 *
 * @remarks
 * - Covers invalid counters/metrics and unknown diagnostics features.
 * - Intended for debug/observability paths, not normal API misuse.
 * - Registered into the global error registry as the `diagnostics.*` domain.
 */

import type { AssertTrue, IsExact } from "../../internal/type-assert";
import type { ErrorDetails, ErrorMeta } from "../registry";

/**
 * Diagnostics error codes.
 *
 * @remarks
 * This domain is intentionally narrow and focused on the introspection layer:
 *
 * - Counters / metrics that should never contain NaN, Infinity, or
 *   out-of-range values.
 * - Diagnostics / debug feature flags that are unknown or invalid in
 *   the current runtime.
 *
 * These errors are not for normal user or API misuse; those belong in
 * `spec.*`, `binding.*`, `backing.*`, etc.
 *
 * Typical call sites:
 * - Debug HUD adapters
 * - Metrics exporters (Prometheus, logging, dev overlays)
 * - Dev / CLI feature toggles for diagnostics
 *
 * All diagnostics errors are modeled as recoverable warnings and are
 * generally not safe to expose across trust boundaries.
 */
export type DiagnosticsErrorCode =
  | "diagnostics.counterInvalid"
  | "diagnostics.featureInvalid";

/**
 * Symbolic keys for diagnostics error descriptors.
 */
export type DiagnosticsErrorKey = "counterInvalid" | "featureInvalid";

/**
 * Details for diagnostics counters that contain invalid values.
 *
 * @remarks
 * Intended for soft invariants around introspection metrics:
 * - "this should have been a non-negative, finite integer"
 * - "this counter exceeded an internal safety bound"
 *
 * This is a signal that the diagnostics subsystem is misbehaving,
 * not that the core engine state is corrupt.
 */
export interface DiagnosticsCounterDetails extends ErrorDetails {
  /**
   * Logical counter name, e.g. "degradedSnapshots" or "swapFailures".
   */
  readonly name: string;

  /**
   * Offending value observed for the counter.
   */
  readonly value: number;
}

/**
 * Details for diagnostics / debug feature toggles that are invalid.
 *
 * @remarks
 * This is used when a diagnostics feature flag is:
 * - unknown, or
 * - not supported in the current runtime / build.
 *
 * Examples:
 * - Enabling "seqlockTrace" in an environment where it was not compiled in.
 * - Typo / misconfiguration in a CLI flag or environment variable.
 */
export interface DiagnosticsFeatureDetails extends ErrorDetails {
  /**
   * Feature / toggle identifier, e.g. "seqlockTrace" or "swapTimeline".
   */
  readonly feature: string;

  /**
   * Optional extra detail about why the feature is invalid
   * (e.g. "not compiled in", "unsupported in this runtime").
   */
  readonly detail?: string;
}

/**
 * Descriptor shape for diagnostics errors.
 */
interface DiagnosticsErrorDescriptor<C extends DiagnosticsErrorCode> {
  readonly code: C;
  readonly message: string;
  readonly meta: ErrorMeta;
}

/**
 * Domain-local descriptor map for diagnostics errors.
 *
 * @remarks
 * - This is the single source of truth for code + message + metadata.
 * - The central registry consumes this map and enforces alignment with
 *   `DiagnosticsErrorCode` via the compile-time check below.
 * - Both diagnostics errors are modeled as `warning` + `recoverable: true`
 *   to reflect that they degrade observability, not core engine safety.
 */
interface DiagnosticsErrorsMap {
  readonly counterInvalid: DiagnosticsErrorDescriptor<"diagnostics.counterInvalid">;
  readonly featureInvalid: DiagnosticsErrorDescriptor<"diagnostics.featureInvalid">;
}

/**
 * Domain-local descriptors used for IDE navigation and as a single source of
 * truth for diagnostics error metadata.
 */
const DIAGNOSTICS_ERRORS_DEF = {
  counterInvalid: {
    code: "diagnostics.counterInvalid",
    message: "Diagnostics counter invalid",
    meta: {
      severity: "warning",
      recoverable: true,
      boundarySafe: false,
    },
  },
  featureInvalid: {
    code: "diagnostics.featureInvalid",
    message: "Diagnostics feature invalid",
    meta: {
      severity: "warning",
      recoverable: true,
      boundarySafe: false,
    },
  },
} as const satisfies DiagnosticsErrorsMap;

/**
 * Exported descriptor map with an explicit type for isolatedDeclarations.
 */
export const DIAGNOSTICS_ERRORS: DiagnosticsErrorsMap = DIAGNOSTICS_ERRORS_DEF;

type DiagnosticsCodesFromDescriptors =
  DiagnosticsErrorsMap[DiagnosticsErrorKey]["code"];

type DiagnosticsCodesEqual = IsExact<
  DiagnosticsErrorCode,
  DiagnosticsCodesFromDescriptors
>;

/** @internal */
export type _DiagnosticsCodesMatch = AssertTrue<DiagnosticsCodesEqual>;
