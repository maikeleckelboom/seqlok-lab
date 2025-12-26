// File: packages/core/src/spec/types.ts
/**
 * Spec type system (single source of truth).
 */

// Opaque hash brand
declare const __spec_hash_brand: unique symbol;
export type SpecHash = string & { readonly [__spec_hash_brand]: "SpecHash" };

/**
 * Recursive namespace for author-time specs.
 * Must be interface (not type alias) to avoid TS2456 circular errors.
 */
export interface SpecNamespace<T> {
  readonly [key: string]: T | SpecNamespace<T>;
}

/**
 * Author-time numeric range (optional min/max for ergonomics).
 */
export interface ScalarRange {
  readonly min?: number;
  readonly max?: number;
}

export type F32ParamDef = Readonly<{ kind: "f32" } & ScalarRange>;
export type I32ParamDef = Readonly<{ kind: "i32" } & ScalarRange>;
export type U32ParamDef = Readonly<{ kind: "u32" } & ScalarRange>;

export type BoolParamDef = Readonly<{ kind: "bool" }>;
export type EnumParamDef<Values extends readonly string[] = readonly string[]> =
  Readonly<{ kind: "enum"; values: Values }>;

export type F32ArrayParamDef<Len extends number = number> = Readonly<{
  kind: "f32.array";
  length: Len;
}>;
export type I32ArrayParamDef<Len extends number = number> = Readonly<{
  kind: "i32.array";
  length: Len;
}>;
export type U32ArrayParamDef<Len extends number = number> = Readonly<{
  kind: "u32.array";
  length: Len;
}>;

export type U8ArrayParamDef<Len extends number = number> = Readonly<{
  kind: "u8.array";
  length: Len;
}>;
export type I8ArrayParamDef<Len extends number = number> = Readonly<{
  kind: "i8.array";
  length: Len;
}>;
export type I16ArrayParamDef<Len extends number = number> = Readonly<{
  kind: "i16.array";
  length: Len;
}>;
export type U16ArrayParamDef<Len extends number = number> = Readonly<{
  kind: "u16.array";
  length: Len;
}>;

export type BoolArrayParamDef<Len extends number = number> = Readonly<{
  kind: "bool.array";
  length: Len;
}>;
export type EnumArrayParamDef<
  Values extends readonly string[] = readonly string[],
  Len extends number = number,
> = Readonly<{
  kind: "enum.array";
  values: Values;
  length: Len;
}>;

export type ParamDef =
  | F32ParamDef
  | I32ParamDef
  | U32ParamDef
  | BoolParamDef
  | EnumParamDef
  | F32ArrayParamDef
  | I32ArrayParamDef
  | U32ArrayParamDef
  | U8ArrayParamDef
  | I8ArrayParamDef
  | I16ArrayParamDef
  | U16ArrayParamDef
  | BoolArrayParamDef
  | EnumArrayParamDef;

export type F32MeterDef = Readonly<{ kind: "f32" }>;
export type F64MeterDef = Readonly<{ kind: "f64" }>;
export type I32MeterDef = Readonly<{ kind: "i32" }>;
export type U32MeterDef = Readonly<{ kind: "u32" }>;
export type BoolMeterDef = Readonly<{ kind: "bool" }>;
export type EnumMeterDef<Values extends readonly string[] = readonly string[]> =
  Readonly<{ kind: "enum"; values: Values }>;

export type F32ArrayMeterDef<Len extends number = number> = Readonly<{
  kind: "f32.array";
  length: Len;
}>;
export type F64ArrayMeterDef<Len extends number = number> = Readonly<{
  kind: "f64.array";
  length: Len;
}>;
export type U32ArrayMeterDef<Len extends number = number> = Readonly<{
  kind: "u32.array";
  length: Len;
}>;
export type I32ArrayMeterDef<Len extends number = number> = Readonly<{
  kind: "i32.array";
  length: Len;
}>;

export type U8ArrayMeterDef<Len extends number = number> = Readonly<{
  kind: "u8.array";
  length: Len;
}>;
export type I8ArrayMeterDef<Len extends number = number> = Readonly<{
  kind: "i8.array";
  length: Len;
}>;
export type I16ArrayMeterDef<Len extends number = number> = Readonly<{
  kind: "i16.array";
  length: Len;
}>;
export type U16ArrayMeterDef<Len extends number = number> = Readonly<{
  kind: "u16.array";
  length: Len;
}>;

export type BoolArrayMeterDef<Len extends number = number> = Readonly<{
  kind: "bool.array";
  length: Len;
}>;
export type EnumArrayMeterDef<
  Values extends readonly string[] = readonly string[],
  Len extends number = number,
> = Readonly<{
  kind: "enum.array";
  values: Values;
  length: Len;
}>;

export type MeterDef =
  | F32MeterDef
  | F64MeterDef
  | I32MeterDef
  | U32MeterDef
  | BoolMeterDef
  | EnumMeterDef
  | F32ArrayMeterDef
  | F64ArrayMeterDef
  | U32ArrayMeterDef
  | I32ArrayMeterDef
  | U8ArrayMeterDef
  | I8ArrayMeterDef
  | I16ArrayMeterDef
  | U16ArrayMeterDef
  | BoolArrayMeterDef
  | EnumArrayMeterDef;

export type ScalarParamDef = Exclude<ParamDef, { kind: `${string}.array` }>;
export type ScalarMeterDef = Exclude<MeterDef, { kind: `${string}.array` }>;

/**
 * Author-time spec (AST form).
 * - id is OPTIONAL for authoring (will be auto-generated if omitted)
 * - Nested namespaces allowed
 */
export type SpecAstInput = Readonly<{
  readonly id?: string;
  readonly params?: SpecNamespace<ParamDef>;
  readonly meters?: SpecNamespace<MeterDef>;
}>;

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
