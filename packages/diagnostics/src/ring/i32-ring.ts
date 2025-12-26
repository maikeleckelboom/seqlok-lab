export type I32RingBacking = Readonly<{
  sab: SharedArrayBuffer;
  magic: number;
  version: number;
  capacity: number;
  strideI32: number;
}>;

export const I32_RING_HEADER_I32 = 6;

export const I32_RING_HDR_MAGIC = 0;
export const I32_RING_HDR_VERSION = 1;
export const I32_RING_HDR_WRITESEQ = 2;
export const I32_RING_HDR_CAPACITY = 3;
export const I32_RING_HDR_STRIDE = 4;
export const I32_RING_HDR_RESERVED = 5;

export function createI32RingBacking(args: {
  magic: number;
  version: number;
  capacity: number;
  strideI32: number;
}): I32RingBacking {
  const capacity = Math.max(2, args.capacity | 0);
  const strideI32 = Math.max(2, args.strideI32 | 0);

  const i32Count = I32_RING_HEADER_I32 + capacity * strideI32;
  const sab = new SharedArrayBuffer(i32Count * 4);
  const i32 = new Int32Array(sab);
  const header = i32.subarray(0, I32_RING_HEADER_I32);

  header[I32_RING_HDR_MAGIC] = args.magic | 0;
  header[I32_RING_HDR_VERSION] = args.version | 0;
  header[I32_RING_HDR_WRITESEQ] = 0;
  header[I32_RING_HDR_CAPACITY] = capacity | 0;
  header[I32_RING_HDR_STRIDE] = strideI32 | 0;
  header[I32_RING_HDR_RESERVED] = 0;

  return {
    sab,
    magic: args.magic | 0,
    version: args.version | 0,
    capacity,
    strideI32,
  };
}

function mustLoad(header: Int32Array, index: number, ctx: string): number {
  const v = header[index];
  if (v === undefined) {
    throw new RangeError(`${ctx}: out-of-bounds i32[${String(index)}]`);
  }
  return v | 0;
}

export function assertI32RingHeader(
  backing: I32RingBacking,
  i32: Int32Array,
): void {
  const header = i32.subarray(0, I32_RING_HEADER_I32);

  const magic = mustLoad(header, I32_RING_HDR_MAGIC, "ring header");
  if (magic !== (backing.magic | 0)) {
    throw new RangeError(
      `ring header: bad magic (${String(magic)} != ${String(backing.magic | 0)})`,
    );
  }

  const version = mustLoad(header, I32_RING_HDR_VERSION, "ring header");
  if (version !== (backing.version | 0)) {
    throw new RangeError(
      `ring header: bad version (${String(version)} != ${String(backing.version | 0)})`,
    );
  }

  const cap = mustLoad(header, I32_RING_HDR_CAPACITY, "ring header");
  if (cap !== (backing.capacity | 0)) {
    throw new RangeError(
      `ring header: capacity mismatch (${String(cap)} != ${String(backing.capacity | 0)})`,
    );
  }

  const stride = mustLoad(header, I32_RING_HDR_STRIDE, "ring header");
  if (stride !== (backing.strideI32 | 0)) {
    throw new RangeError(
      `ring header: stride mismatch (${String(stride)} != ${String(backing.strideI32 | 0)})`,
    );
  }
}

export type I32RingViews = Readonly<{
  i32: Int32Array;
  header: Int32Array;
  capacity: number;
  strideI32: number;
}>;

export function openI32Ring(backing: I32RingBacking): I32RingViews {
  const i32 = new Int32Array(backing.sab);
  assertI32RingHeader(backing, i32);
  return {
    i32,
    header: i32.subarray(0, I32_RING_HEADER_I32),
    capacity: backing.capacity | 0,
    strideI32: backing.strideI32 | 0,
  };
}

export function ringBaseForSeq(views: I32RingViews, seq: number): number {
  const s = seq | 0;
  const idx = (s - 1) % views.capacity | 0;
  return (I32_RING_HEADER_I32 + idx * views.strideI32) | 0;
}

export function ringMinSeqAvailable(
  views: I32RingViews,
  writeSeq: number,
): number {
  const w = writeSeq | 0;
  const min = (w - views.capacity + 1) | 0;
  return Math.max(1, min) | 0;
}
