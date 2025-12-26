import { describe, expect, it } from "vitest";

import {
  SEGMENT_SNAPSHOT_STRIDE_WORDS,
  allocateSegmentSnapshotRing,
  createSegmentSnapshotRingReader,
  createSegmentSnapshotRingWriter,
} from "../src/segment-snapshot-ring";

import type { SegmentSnapshot } from "../src/segment-snapshot";

function makeSnapshot(seq: number): SegmentSnapshot {
  // We keep this deterministic and cheap.
  // ids are opaque numbers in introspect; plain 0 is fine.
  return {
    frame: seq >>> 0,
    segmentIndex: seq >>> 0,
    segmentOffsetFrames: 0,
    segmentFrames: 128,

    phase: 0 as never,
    fadeStartFrame: 0,
    fadeEndFrame: 0,

    activeEngine: 0 as never,
    nextEngine: 0 as never,
    latencyPadFrames: 0,

    inputHashLo: (seq ^ 0x1234_5678) >>> 0,
    inputHashHi: (seq ^ 0x9abc_def0) >>> 0,

    outRmsL: 0.1,
    outRmsR: 0.2,
    outPeakL: 0.3,
    outPeakR: 0.4,

    flags: 0,
    overrunMicros: 0,
  };
}

function u32Delta(a: number, b: number): number {
  return (b - a) >>> 0;
}

function mustU32(view: Uint32Array, index: number, label: string): number {
  const v = view[index];
  if (v === undefined) {
    throw new Error(`oob u32 read (${label}) at index ${String(index)}`);
  }
  return v >>> 0;
}

describe("segment snapshot ring", () => {
  it("drain returns 0 when empty", () => {
    const sab = allocateSegmentSnapshotRing(8);
    const reader = createSegmentSnapshotRingReader(sab);

    const got = reader.drain(() => {
      throw new Error("should not be called");
    });

    expect(got).toBe(0);
    expect(reader.cursorSeq).toBe(0);
    expect(reader.droppedTotal).toBe(0);
  });

  it("publish then drain delivers all snapshots (<= capacity)", () => {
    const sab = allocateSegmentSnapshotRing(8);
    const writer = createSegmentSnapshotRingWriter(sab);
    const reader = createSegmentSnapshotRingReader(sab);

    for (let i = 1; i <= 5; i++) {
      writer.publish(makeSnapshot(i));
    }

    const seenSeq: number[] = [];
    const got = reader.drain((_s, meta) => {
      seenSeq.push(meta.seq >>> 0);
    });

    expect(got).toBe(5);
    expect(seenSeq).toEqual([1, 2, 3, 4, 5]);
    expect(reader.cursorSeq).toBe(5);
    expect(reader.droppedTotal).toBe(0);
  });

  it("reader drop counter increments when lagging behind capacity", () => {
    const capacity = 8;
    const sab = allocateSegmentSnapshotRing(capacity);
    const writer = createSegmentSnapshotRingWriter(sab);
    const reader = createSegmentSnapshotRingReader(sab);

    const total = 25; // > capacity
    for (let i = 1; i <= total; i++) {
      writer.publish(makeSnapshot(i));
    }

    const seenSeq: number[] = [];
    const got = reader.drain((_s, meta) => {
      seenSeq.push(meta.seq >>> 0);
    });

    expect(got).toBe(capacity);
    expect(reader.droppedTotal).toBe(total - capacity);

    // We should have received the last `capacity` seqs.
    expect(seenSeq).toEqual([18, 19, 20, 21, 22, 23, 24, 25]);
    expect(reader.cursorSeq).toBe(25);
  });

  it("coherency guard: in-progress slot is not readable until committed", () => {
    const capacity = 8;
    const sab = allocateSegmentSnapshotRing(capacity);

    // White-box poke: simulate writer having started a publish but not committed yet.
    // This matches the implementation’s on-wire layout.
    const HEADER_WORDS = 16;
    const H_LATEST_SEQ = 4;
    const S_COMMIT_SEQ = 0;

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

    const P_OUT_RMS_L = 13;
    const P_OUT_RMS_R = 14;
    const P_OUT_PEAK_L = 15;
    const P_OUT_PEAK_R = 16;

    const P_FLAGS = 17;
    const P_OVERRUN_MICROS = 18;

    const u32 = new Uint32Array(sab);
    const f32 = new Float32Array(sab);

    // Pretend latest seq is 1 (so reader will try to read seq=1).
    Atomics.store(u32, H_LATEST_SEQ, 1);

    const seq = 1 >>> 0;
    const index = seq % capacity;
    const slotBase = HEADER_WORDS + index * SEGMENT_SNAPSHOT_STRIDE_WORDS;

    // in-progress marker is bitwise-not(seq)
    const inProgress = (seq ^ 0xffff_ffff) >>> 0;

    // in-progress
    Atomics.store(u32, slotBase + S_COMMIT_SEQ, inProgress);

    // payload (partial or full doesn’t matter; in-progress marker should block visibility)
    u32[slotBase + P_FRAME] = 123;
    u32[slotBase + P_SEGMENT_INDEX] = 1;
    u32[slotBase + P_SEGMENT_OFFSET_FRAMES] = 0;
    u32[slotBase + P_SEGMENT_FRAMES] = 128;

    u32[slotBase + P_PHASE] = 0;
    u32[slotBase + P_FADE_START_FRAME] = 0;
    u32[slotBase + P_FADE_END_FRAME] = 0;

    u32[slotBase + P_ACTIVE_ENGINE] = 0;
    u32[slotBase + P_NEXT_ENGINE] = 0;
    u32[slotBase + P_LATENCY_PAD_FRAMES] = 0;

    u32[slotBase + P_INPUT_HASH_LO] = 0;
    u32[slotBase + P_INPUT_HASH_HI] = 0;

    f32[slotBase + P_OUT_RMS_L] = 0.1;
    f32[slotBase + P_OUT_RMS_R] = 0.2;
    f32[slotBase + P_OUT_PEAK_L] = 0.3;
    f32[slotBase + P_OUT_PEAK_R] = 0.4;

    u32[slotBase + P_FLAGS] = 0;
    u32[slotBase + P_OVERRUN_MICROS] = 0;

    const reader = createSegmentSnapshotRingReader(sab);

    // Should see nothing while commit word is ~seq.
    const got0 = reader.drain(() => {
      throw new Error("should not be readable while in-progress");
    });
    expect(got0).toBe(0);
    expect(reader.cursorSeq).toBe(0);

    // Commit and try again.
    Atomics.store(u32, slotBase + S_COMMIT_SEQ, seq);

    let deliveredFrame = 0;
    const got1 = reader.drain((s, meta) => {
      deliveredFrame = s.frame;
      expect(meta.seq >>> 0).toBe(1);
    });

    expect(got1).toBe(1);
    expect(deliveredFrame).toBe(123);
    expect(reader.cursorSeq).toBe(1);
  });

  it("u32 wraparound: reader continues correctly across 0xffffffff -> 0", () => {
    const capacity = 8;
    const sab = allocateSegmentSnapshotRing(capacity);

    const H_LATEST_SEQ = 4;

    // Force header seq near wrap point before creating writer/reader.
    const u32 = new Uint32Array(sab);
    Atomics.store(u32, H_LATEST_SEQ, 0xffff_fff0);

    const writer = createSegmentSnapshotRingWriter(sab);
    const reader = createSegmentSnapshotRingReader(sab);

    // Step 1: publish + drain a pre-wrap window so cursor moves into the high range.
    for (let i = 0; i < capacity; i++) {
      writer.publish(makeSnapshot(i + 1));
    }

    const gotA = reader.drain(() => {
      /* no-op */
    });
    expect(gotA).toBe(capacity);
    expect(reader.cursorSeq >>> 0).toBe(0xffff_fff8);

    // Step 2: publish across wrap.
    // After 12 publishes: latest should be 0x0000_0004.
    for (let i = 0; i < 12; i++) {
      writer.publish(makeSnapshot(100 + i));
    }

    const seqs: number[] = [];
    const gotB = reader.drain((_s, meta) => {
      seqs.push(meta.seq >>> 0);
    });

    // Reader should deliver exactly the last `capacity` seqs.
    expect(gotB).toBe(capacity);
    expect(seqs).toEqual([
      0xffff_fffd, 0xffff_fffe, 0xffff_ffff, 0x0000_0000, 0x0000_0001,
      0x0000_0002, 0x0000_0003, 0x0000_0004,
    ]);

    // Validate monotonicity in u32 space (no non-null assertions).
    for (let i = 1; i < seqs.length; i++) {
      const prev = seqs[i - 1];
      const cur = seqs[i];
      if (prev === undefined || cur === undefined) {
        throw new Error("unexpected undefined seq element");
      }
      const d = u32Delta(prev, cur);
      expect(d).toBeGreaterThan(0);
    }

    // Sanity: latest in header is a u32 and should be defined.
    const latest = mustU32(u32, H_LATEST_SEQ, "latestSeq");
    expect(latest).toBe(0x0000_0004);
  });
});
