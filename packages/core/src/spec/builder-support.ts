import { createSpecError } from "../errors/spec";

type LenLike = number | Readonly<{ length: number }>;

export function parseArrayLen(length: LenLike, key: string): number {
  const raw = typeof length === "number" ? length : length.length;

  if (!Number.isFinite(raw) || Number.isNaN(raw)) {
    throw createSpecError("arrayInvalid", {
      key,
      length: raw,
      reason: "fractional",
    });
  }

  if (raw <= 0) {
    throw createSpecError("arrayInvalid", {
      key,
      length: raw,
      reason: "nonPositive",
    });
  }

  const int = Math.trunc(raw);
  if (int !== raw) {
    throw createSpecError("arrayInvalid", {
      key,
      length: raw,
      reason: "fractional",
    });
  }

  return int;
}

/**
 * Used for enum values (and any other string list where emptiness is invalid).
 *
 * Important: `builderInvalid` does not support "emptyValues" as a reason.
 * So we use `enumInvalid`, whose details shape is `{ key, values }`.
 *
 * Type note:
 * - This MUST preserve tuple literals (e.g. readonly ["sine", "square"]).
 * - So we return the input type `V` unchanged.
 */
export function asNonEmpty<const V extends readonly string[]>(
  values: V,
  key: string,
): V {
  if (values.length === 0) {
    throw createSpecError("enumInvalid", { key, values });
  }

  // Defensive: runtime validation (even though V is string[] at type-level)
  for (const v of values) {
    if (typeof v !== "string") {
      throw createSpecError("builderInvalid", { key, reason: "invalidKind" });
    }
    if (v.length === 0) {
      throw createSpecError("enumInvalid", { key, values });
    }
  }

  return values;
}
