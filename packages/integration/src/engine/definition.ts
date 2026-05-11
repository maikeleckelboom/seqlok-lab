/**
 * @fileoverview
 * Engine definition factory with type-safe spec resolution.
 *
 * @remarks
 * - Uses `SpecAstInput` for author-time builder output (nested namespaces, optional id).
 * - Uses `ResolvedSpec<S>` for runtime normalized form (flat dot-keys, required id).
 * - The `defineSpec()` call transforms AST → Resolved, and this is explicit in the types.
 */

import {
  defineSpec,
  type ParamBuilders,
  type MeterBuilders,
  type ResolvedSpec,
} from "@seqlok/core";


import type { EngineInstance } from "../lane/engine-bank";
import type { RingDefinition } from "@seqlok/commands";
import type { SpecAstInput } from "@seqlok/schema";

/**
 * Builders exposed to engine spec authors.
 */
export interface EngineSpecBuilders {
  readonly param: ParamBuilders;
  readonly meter: MeterBuilders;
}

/**
 * Spec builder function.
 *
 * @typeParam S - The AST form returned by the builder (pre-normalization).
 */
export type EngineSpecBuilder<S extends SpecAstInput> = (
  builders: EngineSpecBuilders,
) => S;

/**
 * Options passed to engine constructors.
 *
 * @typeParam S - The AST form (used for type parameter threading).
 * @typeParam TConfig - Engine-specific configuration shape.
 *
 * @remarks
 * The `spec` field is the *resolved* form — flat dot-keys, validated ranges.
 */
export interface EngineConstructorOptions<S extends SpecAstInput, TConfig> {
  readonly spec: ResolvedSpec<S>;
  readonly config: TConfig;
}

/**
 * Host-side engine constructor signature.
 *
 * @typeParam S - Spec AST type (result of builder, pre-normalization).
 * @typeParam TConfig - Structural/configuration type for this engine family.
 * @typeParam EngineKindEnum - Numeric enum representing engine kinds.
 * @typeParam TInstance - Concrete engine instance type.
 */
export type EngineConstructor<
  S extends SpecAstInput,
  TConfig,
  EngineKindEnum extends number,
  TInstance extends EngineInstance<EngineKindEnum>,
> = (
  kind: EngineKindEnum,
  options: EngineConstructorOptions<S, TConfig>,
) => TInstance;

/**
 * Configuration for defining an engine family.
 *
 * @typeParam S - Spec AST type.
 * @typeParam TConfig - Engine configuration shape.
 * @typeParam EngineKindEnum - Numeric enum for engine variants.
 * @typeParam Command - Command ring payload type.
 * @typeParam EventPayload - Event ring payload type.
 * @typeParam TInstance - Concrete engine instance type.
 */
export interface DefineEngineConfig<
  S extends SpecAstInput,
  TConfig,
  EngineKindEnum extends number,
  Command,
  EventPayload,
  TInstance extends EngineInstance<EngineKindEnum>,
> {
  readonly id: string;
  readonly kinds: readonly EngineKindEnum[];
  readonly defaultKind: EngineKindEnum;

  /**
   * Spec builder — invoked lazily via `toSpecInput()`.
   *
   * @remarks
   * The builder returns the AST form. `defineSpec()` normalizes it to the
   * resolved form with flat dot-keys and validated ranges.
   */
  readonly buildSpec: EngineSpecBuilder<S>;

  /**
   * Host-side constructor that wraps the low-level DSP factory.
   */
  readonly createInstance: EngineConstructor<
    S,
    TConfig,
    EngineKindEnum,
    TInstance
  >;

  /**
   * Optional command ring definition for host → processor messaging.
   */
  readonly commandRing?: RingDefinition<Command>;

  /**
   * Optional event ring definition for processor → host messaging.
   */
  readonly eventRing?: RingDefinition<EventPayload>;
}

/**
 * Materialized engine definition.
 *
 * @typeParam S - Spec AST type.
 * @typeParam TConfig - Engine configuration shape.
 * @typeParam EngineKindEnum - Numeric enum for engine variants.
 * @typeParam Command - Command ring payload type.
 * @typeParam EventPayload - Event ring payload type.
 * @typeParam TInstance - Concrete engine instance type.
 */
export interface EngineDefinition<
  S extends SpecAstInput,
  TConfig,
  EngineKindEnum extends number,
  Command,
  EventPayload,
  TInstance extends EngineInstance<EngineKindEnum>,
> {
  readonly id: string;
  readonly kinds: readonly EngineKindEnum[];
  readonly defaultKind: EngineKindEnum;

  /**
   * Returns the resolved spec for this engine family.
   *
   * @remarks
   * Lazily calls `defineSpec(buildSpec)` on first access and caches the result.
   * Returns `ResolvedSpec<S>` — the normalized, flat, validated form.
   */
  readonly toSpecInput: () => ResolvedSpec<S>;

  /**
   * Host-side engine constructor.
   */
  readonly createInstance: EngineConstructor<
    S,
    TConfig,
    EngineKindEnum,
    TInstance
  >;

  /**
   * Command ring definition, or undefined if unused.
   */
  readonly commandRing: RingDefinition<Command> | undefined;

  /**
   * Event ring definition, or undefined if unused.
   */
  readonly eventRing: RingDefinition<EventPayload> | undefined;
}

/**
 * Define a host-side engine family.
 *
 * @typeParam S - Spec AST type (what the builder returns).
 * @typeParam TConfig - Configuration shape for this engine family.
 * @typeParam EngineKindEnum - Numeric enum representing engine kinds.
 * @typeParam Command - Command ring payload type.
 * @typeParam EventPayload - Event ring payload type.
 * @typeParam TInstance - Concrete engine instance type.
 *
 * @param config - Engine family configuration.
 * @returns Materialized engine definition with lazy spec resolution.
 *
 * @example
 * ```typescript
 * const stretchEngine = defineEngine({
 *   id: "stretch",
 *   kinds: [StretchKind.Signalsmith, StretchKind.Rubberband],
 *   defaultKind: StretchKind.Signalsmith,
 *   buildSpec: ({ param, meter }) => ({
 *     id: "stretch-engine",
 *     params: {
 *       rate: param.f32({ min: 0.25, max: 4 }),
 *       pitch: param.f32({ min: -12, max: 12 }),
 *     },
 *     meters: {
 *       latency: meter.f32(),
 *     },
 *   }),
 *   createInstance: (kind, { spec, config }) => {
 *     // Factory logic here
 *   },
 * });
 *
 * // Later: get the resolved spec
 * const spec = stretchEngine.toSpecInput();
 * // spec.params.rate → { kind: "f32", min: 0.25, max: 4 }
 * ```
 */
export function defineEngine<
  S extends SpecAstInput,
  TConfig,
  EngineKindEnum extends number,
  Command,
  EventPayload,
  TInstance extends EngineInstance<EngineKindEnum>,
>(
  config: DefineEngineConfig<
    S,
    TConfig,
    EngineKindEnum,
    Command,
    EventPayload,
    TInstance
  >,
): EngineDefinition<
  S,
  TConfig,
  EngineKindEnum,
  Command,
  EventPayload,
  TInstance
> {
  const {
    id,
    kinds,
    defaultKind,
    buildSpec,
    createInstance,
    commandRing,
    eventRing,
  } = config;

  // Lazy-initialized cache for the resolved spec
  let cachedSpec: ResolvedSpec<S> | undefined;

  const toSpecInput = (): ResolvedSpec<S> => {
    if (cachedSpec !== undefined) {
      return cachedSpec;
    }

    // Transform AST → Resolved via defineSpec
    const spec = defineSpec(buildSpec);
    cachedSpec = spec;
    return spec;
  };

  return {
    id,
    kinds,
    defaultKind,
    toSpecInput,
    createInstance,
    commandRing,
    eventRing,
  };
}
