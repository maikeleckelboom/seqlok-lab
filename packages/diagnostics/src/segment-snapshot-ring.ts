// File: packages/introspect/src/diagnostics/segment-snapshot-ring.ts

import {
  engineKindId,
  phaseId,
  type SegmentSnapshot,
} from "./segment-snapshot";
import {
  createIntrospectError,
  type IntrospectCounterDetails,
  type IntrospectFeatureDetails,
} from "../../introspect/src/errors/introspect";
// TODO: Move errors to diagnostsics package (make)

const MAGIC = 0x534c4b44; // "SLKD"
const VERSION = 1;

const HEADER_WORDS = 16;

// Header indices (u32 words)
const H_MAGIC = 0;
const H_VERSION = 1;
const H_CAPACITY = 2;
const H_STRIDE_WORDS = 3;
const H_LATEST_SEQ = 4;
const H_DROPPED_TOTAL = 5;

// Slot layout (words within each slot)
const S_COMMIT_SEQ = 0;

// Payload word offsets (relative to slot base)
const P_FRAME = 1;
const P_SEGMENT_INDEX = 2;
const P_SEGMENT_OFFSET_FRAMES = 3;
const P_SEGMENT_FRAMES = 4;

const P_PHASE = 5;
const P_FADE_START_FRAME = 6;
const P_FADE_END_FRAME = 7;

const P_ACTIVE_ENGINE = 8;
const P_NEXT_ENGINE = 9;
const P_LATENCY_PAD_FRAMES = 10;

const P_INPUT_HASH_LO = 11;
const P_INPUT_HASH_HI = 12;

// Float payload shares the same backing; use f32 view for these word indices
const P_OUT_RMS_L = 13;
const P_OUT_RMS_R = 14;
const P_OUT_PEAK_L = 15;
const P_OUT_PEAK_R = 16;

const P_FLAGS = 17;
const P_OVERRUN_MICROS = 18;

// Room for growth without ABI churn.
export const SEGMENT_SNAPSHOT_STRIDE_WORDS = 24; // 96 bytes/slot

export interface SegmentSnapshotRingInfo {
  readonly capacity: number;
  readonly strideWords: number;
}

export interface SegmentSnapshotRingWriter {
  readonly sab: SharedArrayBuffer;
  readonly info: SegmentSnapshotRingInfo;

  /**
   * Publish a snapshot into the ring.
   * Pass a *reused* object in RT code to avoid GC pressure.
   */
  publish(snapshot: SegmentSnapshot): void;
}

export interface SegmentSnapshotRingReader {
  readonly sab: SharedArrayBuffer;
  readonly info: SegmentSnapshotRingInfo;

  /**
   * Drain all snapshots newer than the reader cursor.
   * Returns count delivered. If the writer outran the reader, older entries are skipped.
   */
  drain(
    onSnapshot: (
      snapshot: SegmentSnapshot,
      meta: { readonly seq: number },
    ) => void,
  ): number;

  /** Current reader cursor (last delivered seq, u32). */
  readonly cursorSeq: number;

  /** Total number of dropped snapshots observed by this reader (monotonic, u32). */
  readonly droppedTotal: number;
}

function failCounter(name: string, value: number): never {
  const details: IntrospectCounterDetails = { name, value };
  throw createIntrospectError("counterInvalid", details);
}

function failFeature(feature: string, detail?: string): never {
  const details: IntrospectFeatureDetails =
    detail === undefined ? { feature } : { feature, detail };
  throw createIntrospectError("featureInvalid", details);
}

export function allocateSegmentSnapshotRing(
  capacity: number,
): SharedArrayBuffer {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    failCounter("segmentSnapshotRing.capacity", capacity);
  }

  const strideWords = SEGMENT_SNAPSHOT_STRIDE_WORDS;
  const totalWords = HEADER_WORDS + capacity * strideWords;

  const sab = new SharedArrayBuffer(totalWords * 4);
  const u32 = new Uint32Array(sab);

  u32[H_MAGIC] = MAGIC >>> 0;
  u32[H_VERSION] = VERSION >>> 0;
  u32[H_CAPACITY] = capacity >>> 0;
  u32[H_STRIDE_WORDS] = strideWords >>> 0;

  Atomics.store(u32, H_LATEST_SEQ, 0);
  Atomics.store(u32, H_DROPPED_TOTAL, 0);

  return sab;
}

export function createSegmentSnapshotRingWriter(
  sab: SharedArrayBuffer,
): SegmentSnapshotRingWriter {
  const { capacity, strideWords } = assertAndGetInfo(sab);

  const u32 = new Uint32Array(sab);
  const f32 = new Float32Array(sab);

  const dataBase = HEADER_WORDS;

  return {
    sab,
    info: { capacity, strideWords },

    publish(snapshot) {
      // Monotonic u32 sequence, starting at 1.
      const seq = (Atomics.add(u32, H_LATEST_SEQ, 1) + 1) >>> 0;
      const index = seq % capacity;
      const slotBase = dataBase + index * strideWords;

      // Mark in-progress by storing bitwise-not(seq).
      // Committed is seq. These cannot be equal for any u32.
      Atomics.store(u32, slotBase + S_COMMIT_SEQ, (seq ^ 0xffff_ffff) >>> 0);

      u32[slotBase + P_FRAME] = snapshot.frame >>> 0;
      u32[slotBase + P_SEGMENT_INDEX] = snapshot.segmentIndex >>> 0;
      u32[slotBase + P_SEGMENT_OFFSET_FRAMES] =
        snapshot.segmentOffsetFrames >>> 0;
      u32[slotBase + P_SEGMENT_FRAMES] = snapshot.segmentFrames >>> 0;

      u32[slotBase + P_PHASE] = (snapshot.phase as number) >>> 0;
      u32[slotBase + P_FADE_START_FRAME] = snapshot.fadeStartFrame >>> 0;
      u32[slotBase + P_FADE_END_FRAME] = snapshot.fadeEndFrame >>> 0;

      u32[slotBase + P_ACTIVE_ENGINE] = (snapshot.activeEngine as number) >>> 0;
      u32[slotBase + P_NEXT_ENGINE] = (snapshot.nextEngine as number) >>> 0;
      u32[slotBase + P_LATENCY_PAD_FRAMES] = snapshot.latencyPadFrames >>> 0;

      u32[slotBase + P_INPUT_HASH_LO] = snapshot.inputHashLo >>> 0;
      u32[slotBase + P_INPUT_HASH_HI] = snapshot.inputHashHi >>> 0;

      f32[slotBase + P_OUT_RMS_L] = snapshot.outRmsL;
      f32[slotBase + P_OUT_RMS_R] = snapshot.outRmsR;
      f32[slotBase + P_OUT_PEAK_L] = snapshot.outPeakL;
      f32[slotBase + P_OUT_PEAK_R] = snapshot.outPeakR;

      u32[slotBase + P_FLAGS] = snapshot.flags >>> 0;
      u32[slotBase + P_OVERRUN_MICROS] = snapshot.overrunMicros >>> 0;

      // Commit last.
      Atomics.store(u32, slotBase + S_COMMIT_SEQ, seq);
    },
  };
}

export function createSegmentSnapshotRingReader(
  sab: SharedArrayBuffer,
): SegmentSnapshotRingReader {
  const { capacity, strideWords } = assertAndGetInfo(sab);

  const u32 = new Uint32Array(sab);
  const f32 = new Float32Array(sab);

  const dataBase = HEADER_WORDS;

  let cursorSeq = 0 >>> 0;

  const scratch: MutableSnapshot = createEmptyMutableSnapshot();

  return {
    sab,
    info: { capacity, strideWords },

    get cursorSeq() {
      return cursorSeq >>> 0;
    },

    get droppedTotal() {
      return Atomics.load(u32, H_DROPPED_TOTAL) >>> 0;
    },

    drain(onSnapshot) {
      const latest = Atomics.load(u32, H_LATEST_SEQ) >>> 0;
      if (latest === 0) {
        return 0;
      }

      const cursor = cursorSeq >>> 0;
      const delta = (latest - cursor) >>> 0;
      if (delta === 0) {
        return 0;
      }

      // If writer outran reader by more than capacity, skip forward and count drops.
      if (delta > capacity) {
        const dropped = (delta - capacity) >>> 0;
        Atomics.add(u32, H_DROPPED_TOTAL, dropped);
        cursorSeq = (latest - capacity) >>> 0;
      }

      const cursor2 = cursorSeq >>> 0;
      const delta2 = (latest - cursor2) >>> 0;
      if (delta2 === 0) {
        return 0;
      }

      const readable = delta2 > capacity ? capacity : delta2;
      const startSeq = (latest - (readable - 1)) >>> 0;

      let delivered = 0;

      for (let i = 0; i < readable; i++) {
        const seq = (startSeq + i) >>> 0;
        const index = seq % capacity;
        const slotBase = dataBase + index * strideWords;

        const got = tryReadSlotInto(u32, f32, slotBase, seq, scratch);
        if (!got) {
          continue;
        }

        cursorSeq = seq;
        delivered += 1;

        onSnapshot(cloneSnapshot(scratch), { seq });
      }

      return delivered;
    },
  };
}

function assertAndGetInfo(sab: SharedArrayBuffer): SegmentSnapshotRingInfo {
  const u32 = new Uint32Array(sab);

  if (u32.length < HEADER_WORDS) {
    failFeature("segmentSnapshotRing.bufferTooSmall");
  }

  const magic = mustU32(u32, H_MAGIC, "magic");
  if (magic !== MAGIC >>> 0) {
    failFeature("segmentSnapshotRing.badMagic");
  }

  const version = mustU32(u32, H_VERSION, "version");
  if (version !== VERSION >>> 0) {
    failFeature(
      "segmentSnapshotRing.unsupportedVersion",
      `version=${String(version)}`,
    );
  }

  const capacity = mustU32(u32, H_CAPACITY, "capacity");
  const strideWords = mustU32(u32, H_STRIDE_WORDS, "strideWords");

  if (capacity === 0) {
    failCounter("segmentSnapshotRing.capacityDeclared", capacity);
  }
  if (strideWords < SEGMENT_SNAPSHOT_STRIDE_WORDS) {
    failCounter("segmentSnapshotRing.strideWordsDeclared", strideWords);
  }

  const minWords = HEADER_WORDS + capacity * strideWords;
  if (u32.length < minWords) {
    failFeature("segmentSnapshotRing.bufferShorterThanDeclared");
  }

  return { capacity, strideWords };
}

function tryReadSlotInto(
  u32: Uint32Array,
  f32: Float32Array,
  slotBase: number,
  expectedSeq: number,
  out: MutableSnapshot,
): boolean {
  const expected = expectedSeq >>> 0;
  const expectedInProgress = (expected ^ 0xffff_ffff) >>> 0;

  for (let attempt = 0; attempt < 3; attempt++) {
    const commit0 = Atomics.load(u32, slotBase + S_COMMIT_SEQ) >>> 0;

    if (commit0 !== expected) {
      // If writer is currently publishing this seq, retry a bounded number of times.
      if (commit0 === expectedInProgress) {
        continue;
      }
      return false;
    }

    out.frame = mustU32(u32, slotBase + P_FRAME, "frame");
    out.segmentIndex = mustU32(u32, slotBase + P_SEGMENT_INDEX, "segmentIndex");
    out.segmentOffsetFrames = mustU32(
      u32,
      slotBase + P_SEGMENT_OFFSET_FRAMES,
      "segmentOffsetFrames",
    );
    out.segmentFrames = mustU32(
      u32,
      slotBase + P_SEGMENT_FRAMES,
      "segmentFrames",
    );

    out.phase = mustU32(u32, slotBase + P_PHASE, "phase");
    out.fadeStartFrame = mustU32(
      u32,
      slotBase + P_FADE_START_FRAME,
      "fadeStartFrame",
    );
    out.fadeEndFrame = mustU32(
      u32,
      slotBase + P_FADE_END_FRAME,
      "fadeEndFrame",
    );

    out.activeEngine = mustU32(u32, slotBase + P_ACTIVE_ENGINE, "activeEngine");
    out.nextEngine = mustU32(u32, slotBase + P_NEXT_ENGINE, "nextEngine");
    out.latencyPadFrames = mustU32(
      u32,
      slotBase + P_LATENCY_PAD_FRAMES,
      "latencyPadFrames",
    );

    out.inputHashLo = mustU32(u32, slotBase + P_INPUT_HASH_LO, "inputHashLo");
    out.inputHashHi = mustU32(u32, slotBase + P_INPUT_HASH_HI, "inputHashHi");

    out.outRmsL = mustF32(f32, slotBase + P_OUT_RMS_L, "outRmsL");
    out.outRmsR = mustF32(f32, slotBase + P_OUT_RMS_R, "outRmsR");
    out.outPeakL = mustF32(f32, slotBase + P_OUT_PEAK_L, "outPeakL");
    out.outPeakR = mustF32(f32, slotBase + P_OUT_PEAK_R, "outPeakR");

    out.flags = mustU32(u32, slotBase + P_FLAGS, "flags");
    out.overrunMicros = mustU32(
      u32,
      slotBase + P_OVERRUN_MICROS,
      "overrunMicros",
    );

    const commit1 = Atomics.load(u32, slotBase + S_COMMIT_SEQ) >>> 0;
    if (commit1 === expected) {
      return true;
    }
  }

  return false;
}

interface MutableSnapshot {
  frame: number;
  segmentIndex: number;
  segmentOffsetFrames: number;
  segmentFrames: number;

  phase: number;
  fadeStartFrame: number;
  fadeEndFrame: number;

  activeEngine: number;
  nextEngine: number;
  latencyPadFrames: number;

  inputHashLo: number;
  inputHashHi: number;

  outRmsL: number;
  outRmsR: number;
  outPeakL: number;
  outPeakR: number;

  flags: number;
  overrunMicros: number;
}

function createEmptyMutableSnapshot(): MutableSnapshot {
  return {
    frame: 0,
    segmentIndex: 0,
    segmentOffsetFrames: 0,
    segmentFrames: 0,

    phase: 0,
    fadeStartFrame: 0,
    fadeEndFrame: 0,

    activeEngine: 0,
    nextEngine: 0,
    latencyPadFrames: 0,

    inputHashLo: 0,
    inputHashHi: 0,

    outRmsL: 0,
    outRmsR: 0,
    outPeakL: 0,
    outPeakR: 0,

    flags: 0,
    overrunMicros: 0,
  };
}

function cloneSnapshot(m: MutableSnapshot): SegmentSnapshot {
  return {
    frame: m.frame,
    segmentIndex: m.segmentIndex,
    segmentOffsetFrames: m.segmentOffsetFrames,
    segmentFrames: m.segmentFrames,

    phase: phaseId(m.phase),
    fadeStartFrame: m.fadeStartFrame,
    fadeEndFrame: m.fadeEndFrame,

    activeEngine: engineKindId(m.activeEngine),
    nextEngine: engineKindId(m.nextEngine),
    latencyPadFrames: m.latencyPadFrames,

    inputHashLo: m.inputHashLo,
    inputHashHi: m.inputHashHi,

    outRmsL: m.outRmsL,
    outRmsR: m.outRmsR,
    outPeakL: m.outPeakL,
    outPeakR: m.outPeakR,

    flags: m.flags,
    overrunMicros: m.overrunMicros,
  };
}

function mustU32(view: Uint32Array, index: number, label: string): number {
  const v = view[index];
  if (v === undefined) {
    failFeature(
      "segmentSnapshotRing.oobU32Read",
      `label=${label} index=${String(index)} len=${String(view.length)}`,
    );
  }
  return v >>> 0;
}

function mustF32(view: Float32Array, index: number, label: string): number {
  const v = view[index];
  if (v === undefined) {
    failFeature(
      "segmentSnapshotRing.oobF32Read",
      `label=${label} index=${String(index)} len=${String(view.length)}`,
    );
  }
  return v;
}
