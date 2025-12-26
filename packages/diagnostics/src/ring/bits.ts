export type BitsScratch = Readonly<{
  i32: Int32Array;
  f32: Float32Array;
}>;

export function createBitsScratch(): BitsScratch {
  const buf = new ArrayBuffer(4);
  return { i32: new Int32Array(buf), f32: new Float32Array(buf) };
}

export function f32ToBits(x: number, scratch: BitsScratch): number {
  scratch.f32[0] = Math.fround(x);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return scratch.i32[0]! | 0;
}

export function bitsToF32(bits: number, scratch: BitsScratch): number {
  scratch.i32[0] = bits | 0;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return scratch.f32[0]!;
}
