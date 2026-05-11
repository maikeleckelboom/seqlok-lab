/**
 * Spec type system.
 *
 * Authored contract types (SpecNamespace, ParamDef, MeterDef, etc.) are
 * owned by @seqlok/schema. This module imports them for internal use but
 * does NOT re-export them. Import authored contract types directly from
 * @seqlok/schema.
 *
 * This module owns runtime-specific projections: SpecHash, SpecInput,
 * FlattenNamespace, SpecFromAst/ResolvedSpec, and key-extraction types.
 */

import type {
  MeterDef,
  ParamDef,
  ScalarMeterDef,
  ScalarParamDef,
  SpecAstInput,
  SpecNamespace,
} from "@seqlok/schema";

// Opaque hash brand
declare const __spec_hash_brand: unique symbol;
export type SpecHash = string & { readonly [__spec_hash_brand]: "SpecHash" };

/**
 * Runtime/normalized spec (flat dot-key maps).
 * - id is REQUIRED in normalized output
 */
export type SpecInput = Readonly<{
  readonly id: string;
  readonly params?: Readonly<Record<string, ParamDef>>;
  readonly meters?: Readonly<Record<string, MeterDef>>;
}>;

type DotJoin<Prefix extends string, Key extends string> = Prefix extends ""
  ? Key
  : `${Prefix}.${Key}`;

type UnionToIntersection<U> = (
  U extends unknown ? (x: U) => void : never
) extends (x: infer I) => void
  ? I
  : never;

type FlattenNamespaceImpl<
  NS extends SpecNamespace<Leaf>,
  Leaf,
  Prefix extends string,
> = UnionToIntersection<
  {
    [K in Extract<keyof NS, string>]: NS[K] extends Leaf
      ? { readonly [P in DotJoin<Prefix, K>]: NS[K] }
      : NS[K] extends SpecNamespace<Leaf>
        ? FlattenNamespaceImpl<NS[K], Leaf, DotJoin<Prefix, K>>
        : unknown;
  }[Extract<keyof NS, string>]
>;

export type FlattenNamespace<
  NS extends SpecNamespace<Leaf>,
  Leaf = never,
> = FlattenNamespaceImpl<NS, Leaf, "">;

type WithParams<S extends SpecAstInput> = S extends {
  readonly params?: infer P;
}
  ? NonNullable<P> extends SpecNamespace<ParamDef>
    ? { readonly params: Readonly<FlattenNamespace<NonNullable<P>, ParamDef>> }
    : object
  : object;

type WithMeters<S extends SpecAstInput> = S extends {
  readonly meters?: infer M;
}
  ? NonNullable<M> extends SpecNamespace<MeterDef>
    ? { readonly meters: Readonly<FlattenNamespace<NonNullable<M>, MeterDef>> }
    : object
  : object;

/**
 * Resolved compile-time shape of a spec defined via defineSpec.
 * - Preserves literal id if provided, otherwise defaults to string
 * - Flattens nested namespaces to dot-key maps
 */
export type SpecFromAst<S extends SpecAstInput> = Readonly<
  { readonly id: S["id"] extends string ? S["id"] : string } & WithParams<S> &
    WithMeters<S>
>;

export type ResolvedSpec<S extends SpecAstInput> = SpecFromAst<S>;

/**
 * Extract params object from spec (returns empty record if absent).
 * CRITICAL: Must return Record<string, never>, NOT never, for exactOptionalPropertyTypes.
 */
export type ParamsOf<S extends SpecInput> =
  S["params"] extends Readonly<Record<string, ParamDef>>
    ? S["params"]
    : Readonly<Record<string, never>>;

/**
 * Extract meters object from spec (returns empty record if absent).
 */
export type MetersOf<S extends SpecInput> =
  S["meters"] extends Readonly<Record<string, MeterDef>>
    ? S["meters"]
    : Readonly<Record<string, never>>;

/**
 * All param keys as string union.
 */
export type ParamKeys<S extends SpecInput> = Extract<keyof ParamsOf<S>, string>;

/**
 * All meter keys as string union.
 */
export type MeterKeys<S extends SpecInput> = Extract<keyof MetersOf<S>, string>;

/**
 * Scalar param keys (f32, i32, u32, bool, enum).
 */
export type ScalarParamKeys<S extends SpecInput> = {
  [K in ParamKeys<S>]: ParamsOf<S>[K] extends ScalarParamDef ? K : never;
}[ParamKeys<S>];

/**
 * Array param keys (*.array).
 */
export type ArrayParamKeys<S extends SpecInput> = {
  [K in ParamKeys<S>]: ParamsOf<S>[K] extends { readonly length: number }
    ? K
    : never;
}[ParamKeys<S>];

/**
 * Scalar meter keys.
 */
export type ScalarMeterKeys<S extends SpecInput> = {
  [K in MeterKeys<S>]: MetersOf<S>[K] extends ScalarMeterDef ? K : never;
}[MeterKeys<S>];

/**
 * Array meter keys.
 */
export type ArrayMeterKeys<S extends SpecInput> = {
  [K in MeterKeys<S>]: MetersOf<S>[K] extends { readonly length: number }
    ? K
    : never;
}[MeterKeys<S>];
