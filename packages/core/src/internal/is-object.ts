/**
 * @fileoverview
 * Shared object type guard used across internal modules.
 *
 * @remarks
 * - Narrowing helper for structural "plain object" checks.
 * - Intentionally minimal and side-effect free.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
