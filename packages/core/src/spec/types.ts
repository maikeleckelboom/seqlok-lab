/**
 * Spec type system.
 *
 * Canonical contract types (CanonicalSpec, CanonicalSpecFromAst) are
 * owned by @seqlok/schema. This module imports them for internal use but
 * does NOT re-export them. Import canonical contract types directly from
 * @seqlok/schema.
 *
 * This module owns runtime-specific projections over the canonical spec:
 * SpecHash, ParamsOf<S>, MetersOf<S>, ParamKeys<S>, MeterKeys<S>,
 * and scalar/array key unions.
 */

import type {
  CanonicalSpec,
  MeterDef,
  ParamDef,
  ScalarMeterDef,
  ScalarParamDef,
} from "@seqlok/schema";

// Opaque hash brand
declare const __spec_hash_brand: unique symbol;
export type SpecHash = string & { readonly [__spec_hash_brand]: "SpecHash" };

/**
 * Extract params object from spec (returns empty record if absent).
 * CRITICAL: Must return Record<string, never>, NOT never, for exactOptionalPropertyTypes.
 */
export type ParamsOf<S extends CanonicalSpec> =
  S["params"] extends Readonly<Record<string, ParamDef>>
    ? S["params"]
    : Readonly<Record<string, never>>;

/**
 * Extract meters object from spec (returns empty record if absent).
 */
export type MetersOf<S extends CanonicalSpec> =
  S["meters"] extends Readonly<Record<string, MeterDef>>
    ? S["meters"]
    : Readonly<Record<string, never>>;

/**
 * All param keys as string union.
 */
export type ParamKeys<S extends CanonicalSpec> = Extract<
  keyof ParamsOf<S>,
  string
>;

/**
 * All meter keys as string union.
 */
export type MeterKeys<S extends CanonicalSpec> = Extract<
  keyof MetersOf<S>,
  string
>;

/**
 * Scalar param keys (f32, i32, u32, bool, enum).
 */
export type ScalarParamKeys<S extends CanonicalSpec> = {
  [K in ParamKeys<S>]: ParamsOf<S>[K] extends ScalarParamDef ? K : never;
}[ParamKeys<S>];

/**
 * Array param keys (*.array).
 */
export type ArrayParamKeys<S extends CanonicalSpec> = {
  [K in ParamKeys<S>]: ParamsOf<S>[K] extends { readonly length: number }
    ? K
    : never;
}[ParamKeys<S>];

/**
 * Scalar meter keys.
 */
export type ScalarMeterKeys<S extends CanonicalSpec> = {
  [K in MeterKeys<S>]: MetersOf<S>[K] extends ScalarMeterDef ? K : never;
}[MeterKeys<S>];

/**
 * Array meter keys.
 */
export type ArrayMeterKeys<S extends CanonicalSpec> = {
  [K in MeterKeys<S>]: MetersOf<S>[K] extends { readonly length: number }
    ? K
    : never;
}[MeterKeys<S>];
