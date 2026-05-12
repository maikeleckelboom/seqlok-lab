import type { SharedContext } from "./types";
import type { CanonicalSpec } from "@seqlok/schema";

type ObjectRecord = Record<string, unknown>;

function isObjectRecord(value: unknown): value is ObjectRecord {
  return typeof value === "object" && value !== null;
}

function hasOwn(obj: ObjectRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * @internal
 * Runtime type guard used by binding overloads.
 *
 * @remarks
 * Structural only; does not verify plan/backing invariants.
 */
export function isSharedContext<S extends CanonicalSpec>(
  value: unknown,
): value is SharedContext<S> {
  if (!isObjectRecord(value)) {
    return false;
  }

  return (
    hasOwn(value, "spec") && hasOwn(value, "plan") && hasOwn(value, "backing")
  );
}
