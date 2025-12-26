import {
  bitsToF32,
  createBitsScratch,
  f32ToBits,
  type BitsScratch,
} from "../../ring/bits";
import {
  createI32RingBacking,
  openI32Ring,
  ringBaseForSeq,
  ringMinSeqAvailable,
  I32_RING_HDR_CAPACITY,
  I32_RING_HDR_MAGIC,
  I32_RING_HDR_RESERVED,
  I32_RING_HDR_STRIDE,
  I32_RING_HDR_VERSION,
  I32_RING_HDR_WRITESEQ,
  type I32RingBacking,
  type I32RingViews,
} from "../../ring/i32-ring";

export const HotswapPhaseV1 = {
  idle: 0,
  prewarm: 1,
  crossfade: 2,
  steady: 3,
} satisfies Readonly<
  Record<"idle" | "prewarm" | "crossfade" | "steady", number>
>;

export type HotswapPhaseV1 =
  (typeof HotswapPhaseV1)[keyof typeof HotswapPhaseV1];

export type HotswapSnapshotV1 = Readonly<{
  timelineFrame: number;
  phase: HotswapPhaseV1;
  mixTo: number;
  rms: number;
  activeKind: number;
  nextKind: number;
  flags: number;
}>;

export type HotswapTelemetryBackingV1 = I32RingBacking;

// "SEQL"
const MAGIC = 0x5345514c;
const VERSION = 1;

// record layout (i32):
// [0] seqBegin
// [1] timelineFrame
// [2] phase
// [3] mixToBits
// [4] rmsBits
// [5] activeKind
// [6] nextKind
// [7] flags
// [8] reserved
// [9] seqEnd
const STRIDE_I32 = 10;

const REC_SEQ_BEGIN = 0;
const REC_TIMELINE_FRAME = 1;
const REC_PHASE = 2;
const REC_MIX_TO_BITS = 3;
const REC_RMS_BITS = 4;
const REC_ACTIVE_KIND = 5;
const REC_NEXT_KIND = 6;
const REC_FLAGS = 7;
const REC_RESERVED = 8;
const REC_SEQ_END = 9;

function loadI32(view: Int32Array, index: number, ctx: string): number {
  try {
    return Atomics.load(view, index) | 0;
  } catch {
    throw new RangeError(
      `${ctx}: out-of-bounds Atomics.load at i32[${String(index)}]`,
    );
  }
}

function storeI32(
  view: Int32Array,
  index: number,
  value: number,
  ctx: string,
): void {
  try {
    Atomics.store(view, index, value | 0);
  } catch {
    throw new RangeError(
      `${ctx}: out-of-bounds Atomics.store at i32[${String(index)}]`,
    );
  }
}

export function createHotswapTelemetryBackingV1(
  capacity: number,
): HotswapTelemetryBackingV1 {
  return createI32RingBacking({
    magic: MAGIC,
    version: VERSION,
    capacity: Math.max(2, capacity | 0),
    strideI32: STRIDE_I32,
  });
}

/**
 * Initializes (or re-initializes) the ring header.
 *
 * Notes:
 * - `createHotswapTelemetryBackingV1` already initializes the header.
 * - This function exists so callers can "reset" a ring to a known-good state.
 * - This is safe to call before sharing the SAB, or during teardown/reuse.
 */
export function initHotswapTelemetryBackingV1(
  backing: HotswapTelemetryBackingV1,
): void {
  const { header } = openI32Ring(backing);

  Atomics.store(header, I32_RING_HDR_MAGIC, backing.magic | 0);
  Atomics.store(header, I32_RING_HDR_VERSION, backing.version | 0);
  Atomics.store(header, I32_RING_HDR_WRITESEQ, 0);
  Atomics.store(header, I32_RING_HDR_CAPACITY, backing.capacity | 0);
  Atomics.store(header, I32_RING_HDR_STRIDE, backing.strideI32 | 0);
  Atomics.store(header, I32_RING_HDR_RESERVED, 0);
}

export class HotswapTelemetryWriterV1 {
  private readonly views: I32RingViews;
  private readonly bits: BitsScratch;

  constructor(private readonly backing: HotswapTelemetryBackingV1) {
    this.views = openI32Ring(backing);
    this.bits = createBitsScratch();
  }

  write(s: HotswapSnapshotV1): number {
    const { i32, header } = this.views;

    const seq = Atomics.add(header, I32_RING_HDR_WRITESEQ, 1) + 1;
    const base = ringBaseForSeq(this.views, seq);

    storeI32(i32, base + REC_SEQ_BEGIN, seq, "hotswap v1 write");

    storeI32(
      i32,
      base + REC_TIMELINE_FRAME,
      s.timelineFrame,
      "hotswap v1 write",
    );
    storeI32(i32, base + REC_PHASE, s.phase, "hotswap v1 write");
    storeI32(
      i32,
      base + REC_MIX_TO_BITS,
      f32ToBits(s.mixTo, this.bits),
      "hotswap v1 write",
    );
    storeI32(
      i32,
      base + REC_RMS_BITS,
      f32ToBits(s.rms, this.bits),
      "hotswap v1 write",
    );
    storeI32(i32, base + REC_ACTIVE_KIND, s.activeKind, "hotswap v1 write");
    storeI32(i32, base + REC_NEXT_KIND, s.nextKind, "hotswap v1 write");
    storeI32(i32, base + REC_FLAGS, s.flags, "hotswap v1 write");
    storeI32(i32, base + REC_RESERVED, 0, "hotswap v1 write");

    storeI32(i32, base + REC_SEQ_END, seq, "hotswap v1 write");
    return seq;
  }
}

export class HotswapTelemetryReaderV1 {
  private readonly views: I32RingViews;
  private readonly bits: BitsScratch;

  constructor(private readonly backing: HotswapTelemetryBackingV1) {
    this.views = openI32Ring(backing);
    this.bits = createBitsScratch();
  }

  readLatest(maxRetries = 2): HotswapSnapshotV1 | null {
    const retries = Math.max(0, maxRetries | 0);
    const { i32, header } = this.views;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const writeSeq0 = Atomics.load(header, I32_RING_HDR_WRITESEQ) | 0;
      if (writeSeq0 <= 0) {
        return null;
      }

      const base = ringBaseForSeq(this.views, writeSeq0);

      const a = loadI32(i32, base + REC_SEQ_BEGIN, "hotswap v1 read");
      const timelineFrame = loadI32(
        i32,
        base + REC_TIMELINE_FRAME,
        "hotswap v1 read",
      );
      const phase = loadI32(i32, base + REC_PHASE, "hotswap v1 read");
      const mixTo = bitsToF32(
        loadI32(i32, base + REC_MIX_TO_BITS, "hotswap v1 read"),
        this.bits,
      );
      const rms = bitsToF32(
        loadI32(i32, base + REC_RMS_BITS, "hotswap v1 read"),
        this.bits,
      );
      const activeKind = loadI32(
        i32,
        base + REC_ACTIVE_KIND,
        "hotswap v1 read",
      );
      const nextKind = loadI32(i32, base + REC_NEXT_KIND, "hotswap v1 read");
      const flags = loadI32(i32, base + REC_FLAGS, "hotswap v1 read");
      const b = loadI32(i32, base + REC_SEQ_END, "hotswap v1 read");

      const writeSeq1 = Atomics.load(header, I32_RING_HDR_WRITESEQ) | 0;

      if (a === b && a === writeSeq0 && writeSeq1 === writeSeq0) {
        return {
          timelineFrame,
          phase,
          mixTo,
          rms,
          activeKind,
          nextKind,
          flags,
        };
      }
    }

    return null;
  }

  readSince(
    cursorSeq: number,
    maxItems: number,
  ): Readonly<{
    nextCursorSeq: number;
    lost: number;
    items: readonly HotswapSnapshotV1[];
  }> {
    const { i32, header } = this.views;
    const writeSeq = Atomics.load(header, I32_RING_HDR_WRITESEQ) | 0;

    if (writeSeq <= 0) {
      return { nextCursorSeq: cursorSeq | 0, lost: 0, items: [] };
    }

    const minSeq = ringMinSeqAvailable(this.views, writeSeq);
    let startSeq = ((cursorSeq | 0) + 1) | 0;

    let lost = 0;
    if (startSeq < minSeq) {
      lost = (minSeq - startSeq) | 0;
      startSeq = minSeq;
    }

    const endSeq =
      Math.min(writeSeq, (startSeq + Math.max(0, maxItems | 0) - 1) | 0) | 0;
    const out: HotswapSnapshotV1[] = [];

    for (let seq = startSeq; seq <= endSeq; seq++) {
      const base = ringBaseForSeq(this.views, seq);
      const a = loadI32(i32, base + REC_SEQ_BEGIN, "hotswap v1 readSince");
      if (a !== (seq | 0)) {
        continue;
      }

      const timelineFrame = loadI32(
        i32,
        base + REC_TIMELINE_FRAME,
        "hotswap v1 readSince",
      );
      const phase = loadI32(i32, base + REC_PHASE, "hotswap v1 readSince");
      const mixTo = bitsToF32(
        loadI32(i32, base + REC_MIX_TO_BITS, "hotswap v1 readSince"),
        this.bits,
      );
      const rms = bitsToF32(
        loadI32(i32, base + REC_RMS_BITS, "hotswap v1 readSince"),
        this.bits,
      );
      const activeKind = loadI32(
        i32,
        base + REC_ACTIVE_KIND,
        "hotswap v1 readSince",
      );
      const nextKind = loadI32(
        i32,
        base + REC_NEXT_KIND,
        "hotswap v1 readSince",
      );
      const flags = loadI32(i32, base + REC_FLAGS, "hotswap v1 readSince");
      const b = loadI32(i32, base + REC_SEQ_END, "hotswap v1 readSince");

      if (a === b) {
        out.push({
          timelineFrame,
          phase,
          mixTo,
          rms,
          activeKind,
          nextKind,
          flags,
        });
      }
    }

    return {
      nextCursorSeq: endSeq | 0,
      lost,
      items: out,
    };
  }
}
