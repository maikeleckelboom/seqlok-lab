/**
 * @fileoverview
 * Maps backing memory into typed views for all planes and lock arrays.
 *
 * @remarks
 * - Interprets a Plan's layout over SharedArrayBuffer or WASM backings.
 * - Produces strongly typed views for param, meter and lock planes.
 * - Validates offsets, alignment and sizes with structured introspect.
 *
 * @internal
 */

import { invariant } from "@seqlok/base";
import {
  ALL_PLANES,
  BYTES_PER_ELEM,
  PLANE_PACK_ORDER,
  type PlaneKey,
} from "@seqlok/primitives";

import { getBackingBuffer } from "./buffers";
import { createBackingError } from "../errors/backing";

import type { Backing, SharedBacking, WasmSharedBacking } from "./types";
import type { Plan, PlaneByteLengths } from "../plan/types";
import type { CanonicalSpec } from "@seqlok/schema";

/** Maps each plane to its byte offset in a packed backing. */
export type PlaneBases = Readonly<Record<PlaneKey, number>>;

/** Mutable variant of {@link PlaneBases} for construction. */
type MutablePlaneBases = Record<PlaneKey, number>;

/** Typed array views for parameter planes. */
export interface ParamPlaneViews {
  /** 32-bit float parameters */
  readonly PF32: Float32Array;
  /** 32-bit integer parameters */
  readonly PI32: Int32Array;
  /** Boolean parameters (packed 8-bit) */
  readonly PB: Uint8Array;
  /** Param update counters (seqlock) */
  readonly PU: Uint32Array;
}

/** Typed array views for meter planes. */
export interface MeterPlaneViews {
  /** 32-bit float meters */
  readonly MF32: Float32Array;
  /** 64-bit float meters */
  readonly MF64: Float64Array;
  /** 32-bit unsigned integer meters */
  readonly MU32: Uint32Array;
  /** Meter update counters (seqlock) */
  readonly MU: Uint32Array;
}

/** Complete set of mapped views for a backing. */
export interface MappedViews {
  /** Byte offsets for each plane */
  readonly bases: PlaneBases;
  /** Parameter plane views */
  readonly params: ParamPlaneViews;
  /** Meter plane views */
  readonly meters: MeterPlaneViews;
  /** Locking primitives */
  readonly locks: {
    /** Parameter update lock */
    readonly PU: Uint32Array;
    /** Meter update lock */
    readonly MU: Uint32Array;
  };
}

/**
 * Creates a zero-initialized plane bases record.
 *
 * @remarks
 * Uses `ALL_PLANES` to ensure all planes are included.
 */
function createZeroPlaneBases(): MutablePlaneBases {
  const bases: MutablePlaneBases = {} as MutablePlaneBases;
  for (const plane of ALL_PLANES) {
    bases[plane] = 0;
  }
  return bases;
}

/**
 * Calculates byte offsets for planes in a packed backing.
 *
 * @remarks
 * - Offsets are in bytes, not elements.
 * - `packOrder` defaults to `PLANE_PACK_ORDER` (the canonical packed backing ABI).
 * - Passing an explicit order is primarily for tests and specialized tooling.
 *
 * @param planes - Byte lengths for each plane
 * @param startByteOffset - Base offset (e.g. WASM memory base)
 * @param packOrder - Plane iteration order (defaults to canonical)
 * @returns Record mapping planes to their byte offsets
 */
export function computeBackingPlaneBases(
  planes: PlaneByteLengths,
  startByteOffset = 0,
  packOrder: readonly PlaneKey[] = PLANE_PACK_ORDER,
): PlaneBases {
  const bases = createZeroPlaneBases();
  let cursor = startByteOffset;

  for (const plane of packOrder) {
    bases[plane] = cursor;
    cursor += planes[plane];
  }

  return bases;
}

function assertValidBaseOffsetBytes(baseOffsetBytes: number): void {
  if (!Number.isSafeInteger(baseOffsetBytes) || baseOffsetBytes < 0) {
    throw createBackingError("invalidBaseOffset", {
      baseOffsetBytes,
      alignmentBytes: BYTES_PER_ELEM.MF64,
      where: "backing.mapPackedBacking",
    });
  }
  // Packed mapping uses Float64Array, so we require 8-byte alignment.
  if (baseOffsetBytes % BYTES_PER_ELEM.MF64 !== 0) {
    throw createBackingError("invalidBaseOffset", {
      baseOffsetBytes,
      alignmentBytes: BYTES_PER_ELEM.MF64,
      where: "backing.mapPackedBacking",
    });
  }
}

/**
 * Creates typed array views for a packed backing (contiguous or WASM).
 *
 * @typeParam S - Layout spec type
 * @param plan - Memory layout specification
 * @param backing - Backing storage (SharedArrayBuffer or WebAssembly.Memory)
 * @returns Mapped views for all planes and locks
 * @throws SeqlokError<'backing.allocUndersized'> if backing is undersized
 * @internal
 */
function mapPackedBacking<S extends CanonicalSpec>(
  plan: Plan<S>,
  backing: SharedBacking | WasmSharedBacking,
): MappedViews {
  const buf = getBackingBuffer(backing);
  const baseOffsetBytes =
    backing.kind === "wasm-shared" ? (backing.baseOffsetBytes ?? 0) : 0;

  if (baseOffsetBytes !== 0) {
    assertValidBaseOffsetBytes(baseOffsetBytes);
  }

  const requiredBytes = plan.bytesTotal + baseOffsetBytes;
  const actualBytes = buf.byteLength;

  invariant(actualBytes >= requiredBytes, () =>
    createBackingError("allocUndersized", {
      allocatedBytes: actualBytes,
      requestedBytes: requiredBytes,
      where: "backing.mapViews.packed",
      plane: "all",
      requiredBytes,
      actualBytes,
    }),
  );

  const bases = computeBackingPlaneBases(plan.planes, baseOffsetBytes);

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

/**
 * Creates typed array views for a partitioned backing (separate buffers per plane).
 *
 * @typeParam S - Layout spec type
 * @param plan - Memory layout specification
 * @param partitionedBacking - Backing with separate SharedArrayBuffer per plane
 * @returns Mapped views for all planes and locks
 * @throws SeqlokError<'backing.allocUndersized'> if any plane buffer is undersized
 * @internal
 */
function mapPartitionedBacking<S extends CanonicalSpec>(
  plan: Plan<S>,
  partitionedBacking: Extract<Backing, { kind: "shared-partitioned" }>,
): MappedViews {
  // In partitioned mode, each plane has its own SAB starting at offset 0.
  const bases = createZeroPlaneBases();

  const ensurePlaneBuffer = (plane: PlaneKey): SharedArrayBuffer => {
    const sab = partitionedBacking.planes[plane];
    const requiredBytes = plan.planes[plane] >>> 0;
    const actualBytes = sab.byteLength >>> 0;

    invariant(actualBytes >= requiredBytes, () =>
      createBackingError("allocUndersized", {
        allocatedBytes: actualBytes,
        requestedBytes: requiredBytes,
        where: "backing.mapViews.partitioned",
        plane,
        requiredBytes,
        actualBytes,
      }),
    );

    return sab;
  };

  const PF32 = new Float32Array(
    ensurePlaneBuffer("PF32"),
    0,
    Math.trunc(plan.planes.PF32 / BYTES_PER_ELEM.PF32),
  );
  const PI32 = new Int32Array(
    ensurePlaneBuffer("PI32"),
    0,
    Math.trunc(plan.planes.PI32 / BYTES_PER_ELEM.PI32),
  );
  const PB = new Uint8Array(ensurePlaneBuffer("PB"), 0, plan.planes.PB);
  const PU = new Uint32Array(
    ensurePlaneBuffer("PU"),
    0,
    Math.trunc(plan.planes.PU / BYTES_PER_ELEM.PU),
  );

  const MF32 = new Float32Array(
    ensurePlaneBuffer("MF32"),
    0,
    Math.trunc(plan.planes.MF32 / BYTES_PER_ELEM.MF32),
  );
  const MF64 = new Float64Array(
    ensurePlaneBuffer("MF64"),
    0,
    Math.trunc(plan.planes.MF64 / BYTES_PER_ELEM.MF64),
  );
  const MU32 = new Uint32Array(
    ensurePlaneBuffer("MU32"),
    0,
    Math.trunc(plan.planes.MU32 / BYTES_PER_ELEM.MU32),
  );
  const MU = new Uint32Array(
    ensurePlaneBuffer("MU"),
    0,
    Math.trunc(plan.planes.MU / BYTES_PER_ELEM.MU),
  );

  return {
    bases,
    params: { PF32, PI32, PB, PU },
    meters: { MF32, MF64, MU32, MU },
    locks: { PU, MU },
  };
}

/**
 * Maps a backing to typed array views according to the provided layout.
 *
 * @typeParam S - Layout spec type
 * @param plan - Memory layout specification
 * @param backing - Backing storage to map
 * @returns Typed array views for all planes and locks
 */
export function mapViews<S extends CanonicalSpec>(
  plan: Plan<S>,
  backing: Backing,
): MappedViews {
  switch (backing.kind) {
    case "shared-partitioned":
      return mapPartitionedBacking(plan, backing);
    case "shared":
    case "wasm-shared":
      return mapPackedBacking(plan, backing);
  }
}
