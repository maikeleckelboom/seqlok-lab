import type { Backing } from "../backing/types";
import type { Plan } from "../plan/types";
import type { CanonicalSpec } from "@seqlok/schema";

/**
 * The authoritative bundle of resources required to bind a Controller or Host-side Observer.
 *
 * @typeParam S - Spec produced by {@link defineSpec}.
 * @remarks
 * Maintains the invariant that the Plan and Backing were derived from the Spec.
 */
export interface SharedContext<S extends CanonicalSpec> {
  readonly spec: S;
  readonly plan: Plan<S>;
  readonly backing: Backing;
}
