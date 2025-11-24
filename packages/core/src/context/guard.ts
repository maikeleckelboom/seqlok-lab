import type { SharedContext } from "./types";
import type { SpecInput } from "../spec/types";

/**
 * @internal
 * Runtime type guard used by binding overloads.
 *
 * Note: structural only; does not verify plan/backing invariants.
 */
export function isSharedContext<S extends SpecInput>(
  value: unknown,
): value is SharedContext<S> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value satisfies {
    spec?: unknown;
    plan?: unknown;
    backing?: unknown;
  };

  return (
    Object.prototype.hasOwnProperty.call(candidate, "spec") &&
    Object.prototype.hasOwnProperty.call(candidate, "plan") &&
    Object.prototype.hasOwnProperty.call(candidate, "backing")
  );
}
