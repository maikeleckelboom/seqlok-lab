import { getSharedBuffer } from './buffer';
import { createError } from '../errors/error';
import { BYTES_PER_ELEM } from '../primitives/planes';

import type { Backing, SharedBacking, WasmSharedBacking } from './types';
import type { Plan, PlaneByteLengths } from '../plan/types';
import type { PlaneKey } from '../primitives/planes';
import type { SpecInput } from '../spec/types';

export const PACK_ORDER_V1: readonly PlaneKey[] = [
  'MF64',
  'PF32',
  'PI32',
  'PU',
  'MF32',
  'MU32',
  'MU',
  'PB',
] as const;

export type PlaneBases = Readonly<Record<PlaneKey, number>>;

export interface ParamPlaneViews {
  readonly PF32: Float32Array;
  readonly PI32: Int32Array;
  readonly PB: Uint8Array;
  readonly PU: Uint32Array;
}

export interface MeterPlaneViews {
  readonly MF32: Float32Array;
  readonly MF64: Float64Array;
  readonly MU32: Uint32Array;
  readonly MU: Uint32Array;
}

export interface MappedViews {
  readonly bases: PlaneBases;
  readonly params: ParamPlaneViews;
  readonly meters: MeterPlaneViews;
  readonly locks: {
    readonly PU: Uint32Array;
    readonly MU: Uint32Array;
  };
}

export function computePlaneBases(planes: PlaneByteLengths): PlaneBases {
  const bases: Record<PlaneKey, number> = {
    PF32: 0,
    PI32: 0,
    PB: 0,
    PU: 0,
    MF32: 0,
    MF64: 0,
    MU32: 0,
    MU: 0,
  };
  let cursor = 0;
  for (const k of PACK_ORDER_V1) {
    bases[k] = cursor;
    cursor += planes[k];
  }
  return bases;
}

function mapContiguousOrWasm<S extends SpecInput>(
  plan: Plan<S>,
  backing: SharedBacking | WasmSharedBacking,
): MappedViews {
  const buf = getSharedBuffer(backing);
  const actual = buf.byteLength;
  const required = plan.bytesTotal;

  if (actual < required) {
    throw createError('backing.allocUndersized', `Buffer smaller than required`, {
      plane: backing.kind === 'shared' ? 'shared' : 'wasm',
      requestedBytes: required,
      allocatedBytes: actual,
      detail: `buffer=${String(actual)} < required=${String(required)}`,
    });
  }

  const bases = computePlaneBases(plan.planes);

  const PF32 = new Float32Array(
    buf,
    bases.PF32,
    Math.trunc(plan.planes.PF32 / BYTES_PER_ELEM.PF32),
  );
  const PI32 = new Int32Array(
    buf,
    bases.PI32,
    Math.trunc(plan.planes.PI32 / BYTES_PER_ELEM.PI32),
  );
  const PB = new Uint8Array(buf, bases.PB, plan.planes.PB);
  const PU = new Uint32Array(
    buf,
    bases.PU,
    Math.trunc(plan.planes.PU / BYTES_PER_ELEM.PU),
  );

  const MF32 = new Float32Array(
    buf,
    bases.MF32,
    Math.trunc(plan.planes.MF32 / BYTES_PER_ELEM.MF32),
  );
  const MF64 = new Float64Array(
    buf,
    bases.MF64,
    Math.trunc(plan.planes.MF64 / BYTES_PER_ELEM.MF64),
  );
  const MU32 = new Uint32Array(
    buf,
    bases.MU32,
    Math.trunc(plan.planes.MU32 / BYTES_PER_ELEM.MU32),
  );
  const MU = new Uint32Array(
    buf,
    bases.MU,
    Math.trunc(plan.planes.MU / BYTES_PER_ELEM.MU),
  );

  return {
    bases,
    params: { PF32, PI32, PB, PU },
    meters: { MF32, MF64, MU32, MU },
    locks: { PU, MU },
  };
}

function mapPartitioned<S extends SpecInput>(
  plan: Plan<S>,
  partitionedBacking: Extract<
    Backing,
    {
      kind: 'shared-partitioned';
    }
  >,
): MappedViews {
  const base0: PlaneBases = {
    PF32: 0,
    PI32: 0,
    PB: 0,
    PU: 0,
    MF32: 0,
    MF64: 0,
    MU32: 0,
    MU: 0,
  };

  const ensure = (plane: PlaneKey): SharedArrayBuffer => {
    const sab = partitionedBacking.planes[plane];
    const requiredByteLength = plan.planes[plane];
    if (sab.byteLength < requiredByteLength) {
      throw createError('backing.allocUndersized', `Plane ${plane} SAB too small`, {
        plane,
        requestedBytes: requiredByteLength,
        allocatedBytes: sab.byteLength,
        detail: `requires ${String(requiredByteLength)} bytes, has ${String(sab.byteLength)} bytes`,
      });
    }
    return sab;
  };

  const PF32 = new Float32Array(
    ensure('PF32'),
    0,
    Math.trunc(plan.planes.PF32 / BYTES_PER_ELEM.PF32),
  );
  const PI32 = new Int32Array(
    ensure('PI32'),
    0,
    Math.trunc(plan.planes.PI32 / BYTES_PER_ELEM.PI32),
  );
  const PB = new Uint8Array(ensure('PB'), 0, plan.planes.PB);
  const PU = new Uint32Array(
    ensure('PU'),
    0,
    Math.trunc(plan.planes.PU / BYTES_PER_ELEM.PU),
  );

  const MF32 = new Float32Array(
    ensure('MF32'),
    0,
    Math.trunc(plan.planes.MF32 / BYTES_PER_ELEM.MF32),
  );
  const MF64 = new Float64Array(
    ensure('MF64'),
    0,
    Math.trunc(plan.planes.MF64 / BYTES_PER_ELEM.MF64),
  );
  const MU32 = new Uint32Array(
    ensure('MU32'),
    0,
    Math.trunc(plan.planes.MU32 / BYTES_PER_ELEM.MU32),
  );
  const MU = new Uint32Array(
    ensure('MU'),
    0,
    Math.trunc(plan.planes.MU / BYTES_PER_ELEM.MU),
  );

  return {
    bases: base0,
    params: { PF32, PI32, PB, PU },
    meters: { MF32, MF64, MU32, MU },
    locks: { PU, MU },
  };
}

export function mapViews<S extends SpecInput>(
  plan: Plan<S>,
  backing: Backing,
): MappedViews {
  switch (backing.kind) {
    case 'shared-partitioned':
      return mapPartitioned(plan, backing);
    case 'shared':
    case 'wasm-shared':
      return mapContiguousOrWasm(plan, backing);
  }
}
