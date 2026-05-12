/**
 * @fileoverview
 * Canonical collapsed spec types for Seqlok.
 *
 * These types represent the flat, validated runtime contract.
 * Owned by @seqlok/schema.
 */

import type { MeterDef, ParamDef, SpecAstInput, SpecNamespace } from "./ast";

/**
 * Canonical collapsed spec.
 * - id is REQUIRED
 * - params and meters are flat dot-key maps
 */
export type CanonicalSpec = Readonly<{
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
 * Derive the canonical spec type from an authored AST type.
 */
export type CanonicalSpecFromAst<S extends SpecAstInput> = Readonly<
  { readonly id: S["id"] extends string ? S["id"] : string } & WithParams<S> &
    WithMeters<S>
>;
