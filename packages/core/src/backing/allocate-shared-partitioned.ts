/**
 * @fileoverview
 * Allocates partitioned SharedArrayBuffer backings for a plan.
 *
 * @remarks
 * - Creates one SAB per plane based on planner byte lengths.
 * - Validates SharedArrayBuffer support and throws structured errors on failure.
 * - Used when planes must be isolated instead of stored contiguously.
 *
 * @internal
 */

import { createError } from "../errors/error";
import { throwEnvUnsupported } from "../errors/helpers";
import { ALL_PLANES, type PlaneKey } from "../primitives/planes";

import type { SharedPartitionedBacking } from "./types";
import type { Plan } from "../plan/types";
import type { SpecInput } from "../spec/types";

/**
 * Allocates separate SharedArrayBuffers for each plane in the layout.
 *
 * @typeParam S - Layout spec type
 * @param plan - Memory layout specification
 * @returns Backing with independent SAB per plane
 *
 * @throws {Error}
 * - If SharedArrayBuffer is unsupported in the environment
 * - If any plane allocation fails
 *
 * @example
 * ```typescript
 * const backing = allocateSharedPartitioned(plan);
 * // backing.planes contains separate SABs for each plane
 * ```
 */
export function allocateSharedPartitioned<S extends SpecInput>(
  plan: Plan<S>,
): SharedPartitionedBacking {
  if (typeof SharedArrayBuffer === "undefined") {
    throwEnvUnsupported(
      "SharedArrayBuffer",
      "missing SharedArrayBuffer (check COOP/COEP for browsers)",
    );
  }

  // Create null prototype to avoid accidental property access
  const sabByPlane = Object.create(null) as Record<PlaneKey, SharedArrayBuffer>;

  // Allocate each plane's buffer independently
  for (const plane of ALL_PLANES) {
    const bytes = plan.planes[plane];

    try {
      sabByPlane[plane] = new SharedArrayBuffer(bytes);
    } catch (cause) {
      // On failure, include which plane failed and its requested size
      throw createError(
        "backing.allocFailed",
        `Failed to allocate ${String(bytes)} bytes for plane ${plane}`,
        {
          plane,
          requestedBytes: bytes,
          allocatedBytes: 0,
          where: "allocateSharedPartitioned",
        },
        cause,
      );
    }
  }

  return {
    kind: "shared-partitioned",
    planes: sabByPlane,
  };
}
