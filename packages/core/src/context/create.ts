/**
 * @fileoverview
 * Host-side resource bundle for bindings.
 *
 * Groups the spec, its planned layout, and the backing into a single
 * strongly-typed value. This prevents "mismatched triple" bugs at the API
 * boundary and enables overloads for controller/observer/handoff helpers.
 */

import { allocateShared } from "../backing/allocate-shared";
import { planLayout } from "../plan/layout";

import type { SharedContext } from "./types";
import type { Backing } from "../backing/types";
import type { Plan } from "../plan/types";
import type { SpecInput } from "../spec/types";

/**
 * Helper to create a context from a spec (allocates immediately).
 *
 * @remarks
 * Uses `allocateShared` (contiguous) by default.
 * Pass a custom allocator if you need partitioned or Wasm memory.
 *
 * @example
 * ```ts
 * const ctx = createSharedContext(spec);
 * const ctl = bindController(ctx);
 * ```
 */
export function createSharedContext<S extends SpecInput>(
  spec: S,
  allocator: (plan: Plan<S>) => Backing = allocateShared,
): SharedContext<S> {
  const plan = planLayout(spec);
  const backing = allocator(plan);
  return { spec, plan, backing };
}
