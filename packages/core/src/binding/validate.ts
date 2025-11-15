/**
 * Strongly-typed "into" buffer validation for params/meters.
 * No lazy imports. No legacy error codes. Zero `any`.
 */

import { throwIntoLength, throwIntoType } from '../errors';

/** Internal Param planes (data) — binding-local union. */
export type ParamPlane = 'PF32' | 'PI32' | 'PB';
/** Internal Meter planes (data) — binding-local union. */
export type MeterPlane = 'MF32' | 'MF64' | 'MU32';

type ParamDst = Float32Array | Int32Array | Uint8Array;
type MeterDst = Float32Array | Float64Array | Uint32Array;

/** Constructor shape for typed arrays (length → instance). */
interface TA<T extends ArrayBufferView & { length: number }> {
  readonly name: string;
  new (len: number): T;
}

/**
 * Shared validator for both params/meters "into" targets.
 * - Enforces constructor type (e.g., Float32Array)
 * - Enforces exact length
 */
export function validateIntoBuffer<
  T extends ArrayBufferView & {
    length: number;
  },
>(
  key: string,
  expectedCtor: TA<T>,
  expectedLength: number,
  dst: ArrayBufferView & { length: number },
): void {
  const expectedName = expectedCtor.name;
  const receivedName = (dst.constructor as { name?: string }).name ?? 'Unknown';

  // Constructor/type mismatch
  if (!(dst instanceof expectedCtor)) {
    const receivedLen = dst.length;
    throwIntoType(key, expectedName, receivedName, expectedLength, receivedLen);
  }

  // Length mismatch
  if (dst.length !== expectedLength) {
    throwIntoLength(key, expectedName, expectedLength, dst.length);
  }
}

/** into validation (params). */
export function assertParamInto(
  key: string,
  plane: ParamPlane,
  dst: ParamDst,
  expectedLength: number,
): void {
  switch (plane) {
    case 'PF32':
      validateIntoBuffer(key, Float32Array, expectedLength, dst);
      return;
    case 'PI32':
      validateIntoBuffer(key, Int32Array, expectedLength, dst);
      return;
    case 'PB':
      validateIntoBuffer(key, Uint8Array, expectedLength, dst);
      return;
  }
}

/** into validation (meters). */
export function assertMeterInto(
  key: string,
  plane: MeterPlane,
  dst: MeterDst,
  expectedLength: number,
): void {
  switch (plane) {
    case 'MF32':
      validateIntoBuffer(key, Float32Array, expectedLength, dst);
      return;
    case 'MF64':
      validateIntoBuffer(key, Float64Array, expectedLength, dst);
      return;
    case 'MU32':
      validateIntoBuffer(key, Uint32Array, expectedLength, dst);
      return;
  }
}
