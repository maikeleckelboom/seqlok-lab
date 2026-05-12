/**
 * @fileoverview
 * Deterministic canonical identity materialization.
 *
 * Internal helper for schema canonicalization.
 */

import type { ParamDef, MeterDef } from "./ast";

function mix64(
  seedHi: number,
  seedLo: number,
  data: string,
): Readonly<{ hi: number; lo: number }> {
  let h1 = seedHi >>> 0;
  let h2 = seedLo >>> 0;

  for (let index = 0; index < data.length; index += 1) {
    const code = data.charCodeAt(index) >>> 0;
    h1 = Math.imul(h1 ^ code, 0x85ebca6b) >>> 0;
    h2 = Math.imul(h2 ^ code, 0xc2b2ae35) >>> 0;
    h1 = (h1 ^ (h1 >>> 13)) >>> 0;
    h2 = (h2 ^ (h2 >>> 16)) >>> 0;
  }

  return { hi: h1 >>> 0, lo: h2 >>> 0 };
}

function hashCanonicalPayload(content: unknown): string {
  const json = JSON.stringify(content);
  const mixed = mix64(0x12345678, 0x9abcdef0, json);
  const hi = mixed.hi.toString(16).padStart(8, "0");
  const lo = mixed.lo.toString(16).padStart(8, "0");
  return `${hi}${lo}`;
}

export function hashCanonicalSpecContent(
  content: Readonly<{
    params?: Readonly<Record<string, ParamDef>>;
    meters?: Readonly<Record<string, MeterDef>>;
  }>,
): string {
  return hashCanonicalPayload(content);
}

export function generateAnonymousSpecId(
  params: Readonly<Record<string, ParamDef>> | undefined,
  meters: Readonly<Record<string, MeterDef>> | undefined,
): string {
  const content: Record<string, unknown> = {};
  if (params !== undefined) {
    content.params = params;
  }
  if (meters !== undefined) {
    content.meters = meters;
  }
  const hashHex = hashCanonicalPayload(content);
  return `anon_${hashHex}`;
}
