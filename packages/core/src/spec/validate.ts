import { createSpecError } from "../errors/spec";

export interface ScalarRangeInput {
  readonly min: number;
  readonly max: number;
}

export interface ScalarRangeOptions {
  /**
   * Enforce integer endpoints.
   */
  readonly integer?: boolean;

  /**
   * Enforce unsigned range (min/max >= 0).
   */
  readonly unsigned?: boolean;

  /**
   * Inclusive lower bound for `min`.
   */
  readonly minBound?: number;

  /**
   * Inclusive upper bound for `max`.
   */
  readonly maxBound?: number;
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Helper used by vNext spec normalization to require a finite number.
 *
 * Note: our spec error shapes don't include arbitrary `detail` strings,
 * so we encode only `key` + `reason`.
 */
export function asFiniteNumber(key: string, value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Number.isNaN(value)
  ) {
    throw createSpecError("builderInvalid", {
      key,
      reason: value === undefined ? "missingMinMax" : "invalidKind",
    });
  }
  return value;
}

/**
 * Range validator.
 *
 * `spec.rangeInvalid` details shape does not include a reason, so this throws
 * the same error key for all range failures and provides min/max (and optionally received).
 */
export function assertValidateScalarRange(
  key: string,
  range: ScalarRangeInput,
  opts: ScalarRangeOptions = {},
): void {
  const { min, max } = range;

  // Basic sanity
  if (
    !Number.isFinite(min) ||
    !Number.isFinite(max) ||
    Number.isNaN(min) ||
    Number.isNaN(max)
  ) {
    throw createSpecError("rangeInvalid", { key, min, max });
  }

  if (!(min < max)) {
    throw createSpecError("rangeInvalid", { key, min, max });
  }

  // Optional constraints
  if (opts.integer) {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw createSpecError("rangeInvalid", { key, min, max });
    }
  }

  if (opts.unsigned) {
    if (min < 0 || max < 0) {
      throw createSpecError("rangeInvalid", { key, min, max });
    }
  }

  if (opts.minBound !== undefined && min < opts.minBound) {
    // Use `received` as a hint: the violating endpoint.
    throw createSpecError("rangeInvalid", { key, min, max, received: min });
  }

  if (opts.maxBound !== undefined && max > opts.maxBound) {
    throw createSpecError("rangeInvalid", { key, min, max, received: max });
  }
}

type LenLike = number | Readonly<{ length: number }>;

export function parseArrayLen(length: LenLike, key: string): number {
  const raw = typeof length === "number" ? length : length.length;

  // SpecArrayDetails requires { key, length, reason: "nonPositive" | "fractional" }
  // We'll classify:
  // - <= 0         -> nonPositive
  // - non-integer  -> fractional
  // - NaN/Inf      -> fractional
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

/**
 * Legacy helper (harmless to keep, but no longer needed by vNext `define.ts`).
 */
export function createRangeInput(min?: number, max?: number): ScalarRangeInput;
export function createRangeInput(range: ScalarRangeInput): ScalarRangeInput;
export function createRangeInput(
  a?: number | ScalarRangeInput,
  b?: number,
): ScalarRangeInput {
  if (typeof a === "object") {
    return createRangeInput(a.min, a.max);
  }
  return {
    min: a ?? Number.NEGATIVE_INFINITY,
    max: b ?? Number.POSITIVE_INFINITY,
  };
}
