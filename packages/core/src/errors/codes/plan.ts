/**
 * @fileoverview
 * Error codes and detail types for planning shared memory layouts.
 *
 * @remarks
 * - Covers plan failures and soft-limit overflow risk for `planLayout`.
 * - Used by planners and allocators before backing memory is committed.
 * - Registered into the global error registry as the `plan.*` domain.
 */

import type { AssertTrue, IsExact } from "../../internal/type-assert";
import type { ErrorDetails, ErrorMeta } from "../registry";

/**
 * String union of all plan-layer error codes.
 *
 * @remarks
 * These codes are stable and safe to persist in logs and diagnostics.
 */
export type PlanErrorCode = "plan.failed" | "plan.overflowRisk";

/**
 * Detail payload for a generic planning failure.
 */
export interface PlanFailedDetails extends ErrorDetails {
  /**
   * Optional human-readable detail about the failure.
   *
   * @example "negative plane byte length"
   */
  readonly detail?: string;
}

/**
 * Detail payload for a soft-limit overflow in planning.
 *
 * @remarks
 * - `estimatedBytes` is the total planned footprint.
 * - `softLimitBytes` is the configured soft cap that was exceeded.
 */
export interface PlanOverflowRiskDetails extends ErrorDetails {
  readonly estimatedBytes: number;
  readonly softLimitBytes: number;
}

/**
 * Descriptor for a single plan-layer error.
 */
interface PlanErrorDescriptor<C extends PlanErrorCode> {
  readonly code: C;
  readonly message: string;
  readonly meta: ErrorMeta;
}

/**
 * Keys of the plan error descriptor map.
 */
export type PlanErrorKey = "failed" | "overflowRisk";

/**
 * Map of all plan-layer error descriptors.
 */
interface PlanErrorsMap {
  failed: PlanErrorDescriptor<"plan.failed">;
  overflowRisk: PlanErrorDescriptor<"plan.overflowRisk">;
}

/**
 * Canonical plan-layer error descriptors.
 *
 * @remarks
 * - `plan.failed` is a hard failure during planning.
 * - `plan.overflowRisk` indicates the plan exceeds a soft memory limit.
 */
export const PLAN_ERRORS: PlanErrorsMap = {
  failed: {
    code: "plan.failed",
    message: "Failed to compute memory layout plan",
    meta: {
      severity: "error",
      recoverable: false,
      boundarySafe: true,
    },
  },
  overflowRisk: {
    code: "plan.overflowRisk",
    message: "Planned memory exceeds soft limit",
    meta: {
      severity: "warning",
      recoverable: true,
      boundarySafe: true,
    },
  },
};

type PlanCodesFromDescriptors = PlanErrorsMap[PlanErrorKey]["code"];
type PlanCodesEqual = IsExact<PlanErrorCode, PlanCodesFromDescriptors>;

/** @internal */
export type _PlanCodesMatch = AssertTrue<PlanCodesEqual>;
