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
  I32_RING_HDR_WRITESEQ,
  type I32RingBacking,
  type I32RingViews,
} from "../../ring/i32-ring";

export type U64Parts = Readonly<{
  lo: number;
  hi: number;
}>;

export function u64FromParts(lo: number, hi: number): U64Parts {
  return { lo: lo >>> 0, hi: hi >>> 0 };
}

/**
 * Convert u64 parts to a JS number if it is safe (<= 2^53 - 1).
 */
export function u64ToNumberOrNull(u: U64Parts): number | null {
  const hi = u.hi >>> 0;
  const lo = u.lo >>> 0;

  // max safe integer = 0x1f_ffff_ffff_ffff
  const maxHi = 0x001f_ffff;
  if (hi > maxHi) {
    return null;
  }

  // number = hi * 2^32 + lo
  return hi * 4294967296 + lo;
}

export function u64ToBigint(u: U64Parts): bigint {
  return (BigInt(u.hi >>> 0) << 32n) | BigInt(u.lo >>> 0);
}

export const HotswapPhaseV2 = {
  idle: 0,
  prewarm: 1,
  crossfade: 2,
  steady: 3,
} satisfies Readonly<
  Record<"idle" | "prewarm" | "crossfade" | "steady", number>
>;

export type HotswapPhaseV2 =
  (typeof HotswapPhaseV2)[keyof typeof HotswapPhaseV2];

/**
 * Flags are schema-level “facts”, not product policy.
 *
 * Keep these stable; consumers can interpret them freely.
 */
export const HotswapFlagsV2 = {
  swapScheduled: 1 << 0,
  swapCommittedEdge: 1 << 1,
  swapRetiredEdge: 1 << 2,

  seekEdge: 1 << 3,
  resetEdge: 1 << 4,
  flushEdge: 1 << 5,

  errorEdge: 1 << 6,
  overrun: 1 << 7,
} satisfies Readonly<Record<string, number>>;

export type HotswapSnapshotV2 = Readonly<{
  timelineFrame: U64Parts;

  segmentStartFrame: U64Parts;
  segmentFrames: number;

  phase: HotswapPhaseV2;
  mixTo: number;
  rms: number;

  activeKind: number;
  nextKind: number;
  committedKind: number;

  fadeStartFrame: U64Parts;
  fadeEndFrame: U64Parts;

  /**
   * Curve id:
   * - 0 linear
   * - 1 equal-power
   * - others reserved
   */
  fadeCurve: number;

  processInputSamples: number;
  processOutputSamples: number;

  /**
   * ABI status/error in u32 bit-pattern form (two’s complement if original was i32).
   * Use `(u32 | 0)` to decode to signed.
   */
  statusU32: number;
  errorU32: number;

  swapTicketId: number;
  commandSeqSeen: number;

  /**
   * Segment render time in microseconds (coarse but extremely useful).
   */
  renderMicros: number;

  flags: number;
}>;

export type HotswapTelemetryBackingV2 = I32RingBacking;

const MAGIC = 0x5345514c; // "SEQL"
const VERSION = 2;

/**
 * Record layout (i32):
 *
 * [0]  seqBegin
 *
 * [1]  timelineLo
 * [2]  timelineHi
 *
 * [3]  segmentStartLo
 * [4]  segmentStartHi
 * [5]  segmentFrames
 *
 * [6]  phase
 * [7]  mixToBits
 * [8]  rmsBits
 *
 * [9]  activeKind
 * [10] nextKind
 * [11] committedKind
 *
 * [12] fadeStartLo
 * [13] fadeStartHi
 * [14] fadeEndLo
 * [15] fadeEndHi
 * [16] fadeCurve
 *
 * [17] processInputSamples
 * [18] processOutputSamples
 *
 * [19] statusU32
 * [20] errorU32
 *
 * [21] swapTicketId
 * [22] commandSeqSeen
 *
 * [23] renderMicros
 * [24] flags
 *
 * [25] reserved0
 * [26] reserved1
 *
 * [27] seqEnd
 */
const STRIDE_I32 = 28;

const REC_SEQ_BEGIN = 0;

const REC_TIMELINE_LO = 1;
const REC_TIMELINE_HI = 2;

const REC_SEG_START_LO = 3;
const REC_SEG_START_HI = 4;
const REC_SEG_FRAMES = 5;

const REC_PHASE = 6;
const REC_MIX_BITS = 7;
const REC_RMS_BITS = 8;

const REC_ACTIVE = 9;
const REC_NEXT = 10;
const REC_COMMITTED = 11;

const REC_FADE_START_LO = 12;
const REC_FADE_START_HI = 13;
const REC_FADE_END_LO = 14;
const REC_FADE_END_HI = 15;
const REC_FADE_CURVE = 16;

const REC_IN_SAMPLES = 17;
const REC_OUT_SAMPLES = 18;

const REC_STATUS_U32 = 19;
const REC_ERROR_U32 = 20;

const REC_SWAP_TICKET = 21;
const REC_COMMAND_SEQ = 22;

const REC_RENDER_MICROS = 23;
const REC_FLAGS = 24;

const REC_RESERVED0 = 25;
const REC_RESERVED1 = 26;

const REC_SEQ_END = 27;

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

export function createHotswapTelemetryBackingV2(
  capacity: number,
): HotswapTelemetryBackingV2 {
  const backing = createI32RingBacking({
    magic: MAGIC,
    version: VERSION,
    capacity: Math.max(2, capacity | 0),
    strideI32: STRIDE_I32,
  });

  // Header is initialized by createI32RingBacking.
  return backing;
}

export class HotswapTelemetryWriterV2 {
  private readonly views: I32RingViews;
  private readonly bits: BitsScratch;

  constructor(private readonly backing: HotswapTelemetryBackingV2) {
    this.views = openI32Ring(backing);
    this.bits = createBitsScratch();
  }

  write(s: HotswapSnapshotV2): number {
    const { i32, header } = this.views;

    const seq = Atomics.add(header, I32_RING_HDR_WRITESEQ, 1) + 1;
    const base = ringBaseForSeq(this.views, seq);

    storeI32(i32, base + REC_SEQ_BEGIN, seq, "hotswap v2 write");

    storeI32(
      i32,
      base + REC_TIMELINE_LO,
      s.timelineFrame.lo,
      "hotswap v2 write",
    );
    storeI32(
      i32,
      base + REC_TIMELINE_HI,
      s.timelineFrame.hi,
      "hotswap v2 write",
    );

    storeI32(
      i32,
      base + REC_SEG_START_LO,
      s.segmentStartFrame.lo,
      "hotswap v2 write",
    );
    storeI32(
      i32,
      base + REC_SEG_START_HI,
      s.segmentStartFrame.hi,
      "hotswap v2 write",
    );
    storeI32(i32, base + REC_SEG_FRAMES, s.segmentFrames, "hotswap v2 write");

    storeI32(i32, base + REC_PHASE, s.phase, "hotswap v2 write");
    storeI32(
      i32,
      base + REC_MIX_BITS,
      f32ToBits(s.mixTo, this.bits),
      "hotswap v2 write",
    );
    storeI32(
      i32,
      base + REC_RMS_BITS,
      f32ToBits(s.rms, this.bits),
      "hotswap v2 write",
    );

    storeI32(i32, base + REC_ACTIVE, s.activeKind, "hotswap v2 write");
    storeI32(i32, base + REC_NEXT, s.nextKind, "hotswap v2 write");
    storeI32(i32, base + REC_COMMITTED, s.committedKind, "hotswap v2 write");

    storeI32(
      i32,
      base + REC_FADE_START_LO,
      s.fadeStartFrame.lo,
      "hotswap v2 write",
    );
    storeI32(
      i32,
      base + REC_FADE_START_HI,
      s.fadeStartFrame.hi,
      "hotswap v2 write",
    );
    storeI32(
      i32,
      base + REC_FADE_END_LO,
      s.fadeEndFrame.lo,
      "hotswap v2 write",
    );
    storeI32(
      i32,
      base + REC_FADE_END_HI,
      s.fadeEndFrame.hi,
      "hotswap v2 write",
    );
    storeI32(i32, base + REC_FADE_CURVE, s.fadeCurve, "hotswap v2 write");

    storeI32(
      i32,
      base + REC_IN_SAMPLES,
      s.processInputSamples,
      "hotswap v2 write",
    );
    storeI32(
      i32,
      base + REC_OUT_SAMPLES,
      s.processOutputSamples,
      "hotswap v2 write",
    );

    storeI32(i32, base + REC_STATUS_U32, s.statusU32, "hotswap v2 write");
    storeI32(i32, base + REC_ERROR_U32, s.errorU32, "hotswap v2 write");

    storeI32(i32, base + REC_SWAP_TICKET, s.swapTicketId, "hotswap v2 write");
    storeI32(i32, base + REC_COMMAND_SEQ, s.commandSeqSeen, "hotswap v2 write");

    storeI32(i32, base + REC_RENDER_MICROS, s.renderMicros, "hotswap v2 write");
    storeI32(i32, base + REC_FLAGS, s.flags, "hotswap v2 write");

    storeI32(i32, base + REC_RESERVED0, 0, "hotswap v2 write");
    storeI32(i32, base + REC_RESERVED1, 0, "hotswap v2 write");

    storeI32(i32, base + REC_SEQ_END, seq, "hotswap v2 write");
    return seq;
  }
}

export class HotswapTelemetryReaderV2 {
  private readonly views: I32RingViews;
  private readonly bits: BitsScratch;

  constructor(private readonly backing: HotswapTelemetryBackingV2) {
    this.views = openI32Ring(backing);
    this.bits = createBitsScratch();
  }

  readLatest(maxRetries = 2): HotswapSnapshotV2 | null {
    const retries = Math.max(0, maxRetries | 0);
    const { i32, header } = this.views;

    for (let attempt = 0; attempt <= retries; attempt++) {
      const writeSeq0 = Atomics.load(header, I32_RING_HDR_WRITESEQ) | 0;
      if (writeSeq0 <= 0) {
        return null;
      }

      const base = ringBaseForSeq(this.views, writeSeq0);

      const a = loadI32(i32, base + REC_SEQ_BEGIN, "hotswap v2 read");

      const timeline = u64FromParts(
        loadI32(i32, base + REC_TIMELINE_LO, "hotswap v2 read") >>> 0,
        loadI32(i32, base + REC_TIMELINE_HI, "hotswap v2 read") >>> 0,
      );

      const segStart = u64FromParts(
        loadI32(i32, base + REC_SEG_START_LO, "hotswap v2 read") >>> 0,
        loadI32(i32, base + REC_SEG_START_HI, "hotswap v2 read") >>> 0,
      );

      const segFrames =
        loadI32(i32, base + REC_SEG_FRAMES, "hotswap v2 read") >>> 0;

      const phase = loadI32(i32, base + REC_PHASE, "hotswap v2 read");

      const mixTo = bitsToF32(
        loadI32(i32, base + REC_MIX_BITS, "hotswap v2 read"),
        this.bits,
      );
      const rms = bitsToF32(
        loadI32(i32, base + REC_RMS_BITS, "hotswap v2 read"),
        this.bits,
      );

      const activeKind =
        loadI32(i32, base + REC_ACTIVE, "hotswap v2 read") >>> 0;
      const nextKind = loadI32(i32, base + REC_NEXT, "hotswap v2 read") >>> 0;
      const committedKind =
        loadI32(i32, base + REC_COMMITTED, "hotswap v2 read") >>> 0;

      const fadeStart = u64FromParts(
        loadI32(i32, base + REC_FADE_START_LO, "hotswap v2 read") >>> 0,
        loadI32(i32, base + REC_FADE_START_HI, "hotswap v2 read") >>> 0,
      );
      const fadeEnd = u64FromParts(
        loadI32(i32, base + REC_FADE_END_LO, "hotswap v2 read") >>> 0,
        loadI32(i32, base + REC_FADE_END_HI, "hotswap v2 read") >>> 0,
      );
      const fadeCurve =
        loadI32(i32, base + REC_FADE_CURVE, "hotswap v2 read") >>> 0;

      const processInputSamples =
        loadI32(i32, base + REC_IN_SAMPLES, "hotswap v2 read") >>> 0;
      const processOutputSamples =
        loadI32(i32, base + REC_OUT_SAMPLES, "hotswap v2 read") >>> 0;

      const statusU32 =
        loadI32(i32, base + REC_STATUS_U32, "hotswap v2 read") >>> 0;
      const errorU32 =
        loadI32(i32, base + REC_ERROR_U32, "hotswap v2 read") >>> 0;

      const swapTicketId =
        loadI32(i32, base + REC_SWAP_TICKET, "hotswap v2 read") >>> 0;
      const commandSeqSeen =
        loadI32(i32, base + REC_COMMAND_SEQ, "hotswap v2 read") >>> 0;

      const renderMicros =
        loadI32(i32, base + REC_RENDER_MICROS, "hotswap v2 read") >>> 0;
      const flags = loadI32(i32, base + REC_FLAGS, "hotswap v2 read") >>> 0;

      const b = loadI32(i32, base + REC_SEQ_END, "hotswap v2 read");
      const writeSeq1 = Atomics.load(header, I32_RING_HDR_WRITESEQ) | 0;

      if (a === b && a === writeSeq0 && writeSeq1 === writeSeq0) {
        return {
          timelineFrame: timeline,
          segmentStartFrame: segStart,
          segmentFrames: segFrames,
          phase,
          mixTo,
          rms,
          activeKind,
          nextKind,
          committedKind,
          fadeStartFrame: fadeStart,
          fadeEndFrame: fadeEnd,
          fadeCurve,
          processInputSamples,
          processOutputSamples,
          statusU32,
          errorU32,
          swapTicketId,
          commandSeqSeen,
          renderMicros,
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
    items: readonly HotswapSnapshotV2[];
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

    const count = Math.max(0, maxItems | 0);
    const endSeq = Math.min(writeSeq, (startSeq + count - 1) | 0) | 0;

    const out: HotswapSnapshotV2[] = [];
    for (let seq = startSeq; seq <= endSeq; seq++) {
      const base = ringBaseForSeq(this.views, seq);
      const a = loadI32(i32, base + REC_SEQ_BEGIN, "hotswap v2 readSince");
      if (a !== (seq | 0)) {
        continue;
      }

      const b = loadI32(i32, base + REC_SEQ_END, "hotswap v2 readSince");
      if (a !== b) {
        continue;
      }

      // Decode using readLatest logic structure, but for this seq.
      const timeline = u64FromParts(
        loadI32(i32, base + REC_TIMELINE_LO, "hotswap v2 readSince") >>> 0,
        loadI32(i32, base + REC_TIMELINE_HI, "hotswap v2 readSince") >>> 0,
      );
      const segStart = u64FromParts(
        loadI32(i32, base + REC_SEG_START_LO, "hotswap v2 readSince") >>> 0,
        loadI32(i32, base + REC_SEG_START_HI, "hotswap v2 readSince") >>> 0,
      );

      out.push({
        timelineFrame: timeline,
        segmentStartFrame: segStart,
        segmentFrames:
          loadI32(i32, base + REC_SEG_FRAMES, "hotswap v2 readSince") >>> 0,
        phase: loadI32(i32, base + REC_PHASE, "hotswap v2 readSince"),
        mixTo: bitsToF32(
          loadI32(i32, base + REC_MIX_BITS, "hotswap v2 readSince"),
          this.bits,
        ),
        rms: bitsToF32(
          loadI32(i32, base + REC_RMS_BITS, "hotswap v2 readSince"),
          this.bits,
        ),
        activeKind:
          loadI32(i32, base + REC_ACTIVE, "hotswap v2 readSince") >>> 0,
        nextKind: loadI32(i32, base + REC_NEXT, "hotswap v2 readSince") >>> 0,
        committedKind:
          loadI32(i32, base + REC_COMMITTED, "hotswap v2 readSince") >>> 0,
        fadeStartFrame: u64FromParts(
          loadI32(i32, base + REC_FADE_START_LO, "hotswap v2 readSince") >>> 0,
          loadI32(i32, base + REC_FADE_START_HI, "hotswap v2 readSince") >>> 0,
        ),
        fadeEndFrame: u64FromParts(
          loadI32(i32, base + REC_FADE_END_LO, "hotswap v2 readSince") >>> 0,
          loadI32(i32, base + REC_FADE_END_HI, "hotswap v2 readSince") >>> 0,
        ),
        fadeCurve:
          loadI32(i32, base + REC_FADE_CURVE, "hotswap v2 readSince") >>> 0,
        processInputSamples:
          loadI32(i32, base + REC_IN_SAMPLES, "hotswap v2 readSince") >>> 0,
        processOutputSamples:
          loadI32(i32, base + REC_OUT_SAMPLES, "hotswap v2 readSince") >>> 0,
        statusU32:
          loadI32(i32, base + REC_STATUS_U32, "hotswap v2 readSince") >>> 0,
        errorU32:
          loadI32(i32, base + REC_ERROR_U32, "hotswap v2 readSince") >>> 0,
        swapTicketId:
          loadI32(i32, base + REC_SWAP_TICKET, "hotswap v2 readSince") >>> 0,
        commandSeqSeen:
          loadI32(i32, base + REC_COMMAND_SEQ, "hotswap v2 readSince") >>> 0,
        renderMicros:
          loadI32(i32, base + REC_RENDER_MICROS, "hotswap v2 readSince") >>> 0,
        flags: loadI32(i32, base + REC_FLAGS, "hotswap v2 readSince") >>> 0,
      });
    }

    return { nextCursorSeq: endSeq | 0, lost, items: out };
  }
}
