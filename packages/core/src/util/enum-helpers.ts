import { createError } from '../errors';

import type { SpecEnumDetails } from '../errors';
import type { SpecInput } from '../spec/types';

/**
 * Keys that can meaningfully refer to params or meters.
 */
export type EnumKeyOf<S extends SpecInput> =
  | Extract<keyof S['params'], string>
  | Extract<keyof S['meters'], string>;

/**
 * Infer the enum label union for a given spec + key.
 *
 * Works for both params and meters, and for both scalar `enum` and `enum.array`.
 * We explicitly constrain labels to `string` so they are compatible with
 * SpecEnumDetails.values (readonly string[]).
 */
export type EnumLabel<
  S extends SpecInput,
  K extends EnumKeyOf<S>,
> = K extends keyof S['params'] // params
  ? S['params'][K] extends {
      values: readonly (infer L)[];
    }
    ? L extends string
      ? L
      : never
    : never // meters
  : K extends keyof S['meters']
    ? S['meters'][K] extends {
        values: readonly (infer L)[];
      }
      ? L extends string
        ? L
        : never
      : never
    : never;

/**
 * Internal structural shape we expect for enum / enum.array defs.
 */
interface EnumDefLike {
  readonly kind?: string;
  readonly values?: readonly string[];
}

/**
 * Locate the enum (or enum.array) definition for a given key.
 *
 * @remarks
 * - We do a very light structural check and throw if the key is not an enum-ish
 *   definition. This is not on the hot path; it’s intended for tools, tests,
 *   and controller-side ergonomics.
 */
function getEnumDef(spec: SpecInput, key: string): EnumDefLike {
  const fromParams = spec.params as Record<string, unknown>;
  const fromMeters = spec.meters as Record<string, unknown>;

  const def = (fromParams[key] ?? fromMeters[key]) as EnumDefLike | undefined;

  if (!def || !Array.isArray(def.values)) {
    // Programmer error: wrong key for these helpers.
    // We keep this as a plain Error instead of a SeqlokError.
    throw new Error(`Key ${key} is not an enum / enum.array in this spec`);
  }

  // If you want, you can tighten this to check kind === 'enum' | 'enum.array'
  return def;
}

/**
 * Get the enum vocabulary (`values`) for a given key.
 *
 * @example
 * ```ts
 * type Spec = typeof spec;
 * const values = enumValues<Spec, 'padStates'>(spec, 'padStates');
 * //    ^? readonly ('off' | 'dim' | 'full')[]
 * ```
 *
 * @remarks
 * - Not for RT hot paths; intended for UI/tools/tests.
 */
export function enumValues<S extends SpecInput, K extends EnumKeyOf<S>>(
  spec: S,
  key: K,
): readonly EnumLabel<S, K>[] {
  const def = getEnumDef(spec, key);
  // `EnumLabel<S, K>` is always `string`, so this cast is safe.
  return def.values as readonly EnumLabel<S, K>[];
}

/**
 * Map a label to its index for a given enum key.
 *
 * @returns
 * - `0..N-1` when the label exists
 * - `-1` when the label is not part of the vocabulary
 *
 * @remarks
 * - Mirrors the non-throwing semantics of EnumCodec.tryIndex.
 * - Not for RT hot paths; intended for controller/tools/tests.
 */
export function enumIndexFromLabel<S extends SpecInput, K extends EnumKeyOf<S>>(
  spec: S,
  key: K,
  label: EnumLabel<S, K>,
): number {
  const values = enumValues<S, K>(spec, key);
  return values.indexOf(label);
}

/**
 * Map an index back to its label for a given enum key.
 *
 * @returns
 * - the label when `0 ≤ index < values.length`
 * - `undefined` otherwise
 *
 * @remarks
 * - Not for RT hot paths; intended for controller/tools/tests.
 */
export function enumLabelFromIndex<S extends SpecInput, K extends EnumKeyOf<S>>(
  spec: S,
  key: K,
  index: number,
): EnumLabel<S, K> | undefined {
  const values = enumValues<S, K>(spec, key);
  return values[index];
}

/**
 * Convert an `Int32Array` of enum indices into labels, with bounds checking.
 *
 * @remarks
 * - Perfect for tests, debug tools, and inspectors.
 * - If you hit an out-of-range index, we throw a typed `spec.enumInvalid`
 *   error — that's either a spec/codec bug or memory corruption.
 */
export function enumArrayToLabels<S extends SpecInput, K extends EnumKeyOf<S>>(
  spec: S,
  key: K,
  indices: Int32Array,
): EnumLabel<S, K>[] {
  const values = enumValues<S, K>(spec, key);
  const out: EnumLabel<S, K>[] = [];

  // let i = 0;
  for (const idx of indices) {
    const label = values[idx];
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (label === undefined) {
      throw createError('spec.enumInvalid', `Enum index invalid for "${key}"`, {
        key: key,
        values, // inferred as readonly string[] thanks to EnumLabel <: string
        invalidIndex: idx,
      } satisfies SpecEnumDetails);
    }

    out.push(label);
    // i += 1;
  }

  return out;
}

/**
 * Convert an array of enum labels into an `Int32Array` of indices.
 *
 * @remarks
 * - Intended for fixtures, tests, tools, and occasional controller usage.
 * - If you hit an unknown label, we throw a typed `spec.enumInvalid` error.
 */
export function enumLabelsToArray<S extends SpecInput, K extends EnumKeyOf<S>>(
  spec: S,
  key: K,
  labels: readonly EnumLabel<S, K>[],
): Int32Array {
  const values = enumValues<S, K>(spec, key);
  const out = new Int32Array(labels.length);

  let i = 0;
  for (const label of labels) {
    const idx = values.indexOf(label);
    if (idx === -1) {
      throw createError('spec.enumInvalid', `Enum label invalid for "${key}"`, {
        key: key,
        values,
        received: label,
      } satisfies SpecEnumDetails);
    }

    out[i] = idx;
    i += 1;
  }

  return out;
}

/**
 * Build a tiny "palette" helper for a single enum key.
 *
 * @example
 * ```ts
 * const padStates = enumPaletteFor<Spec, 'padStates'>(spec, 'padStates');
 *
 * padStates.values;               // readonly ('off'|'dim'|'full')[]
 * padStates.indexFrom('dim');     // 1
 * padStates.labelFrom(2);         // 'full' | undefined
 * ```
 *
 * @remarks
 * - Not for RT hot paths; intended for UI/tools/tests.
 */
export function enumPaletteFor<S extends SpecInput, K extends EnumKeyOf<S>>(
  spec: S,
  key: K,
): {
  values: readonly EnumLabel<S, K>[];
  indexFrom(label: EnumLabel<S, K>): number;
  labelFrom(index: number): EnumLabel<S, K> | undefined;
} {
  const values = enumValues<S, K>(spec, key);

  return {
    values,
    indexFrom(label: EnumLabel<S, K>): number {
      return values.indexOf(label);
    },
    labelFrom(index: number): EnumLabel<S, K> | undefined {
      return values[index];
    },
  };
}
