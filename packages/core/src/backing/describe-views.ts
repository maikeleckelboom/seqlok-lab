/**
 * @fileoverview
 * Human-readable description of memory views and layout.
 *
 * @remarks
 * - Generates formatted descriptions of backing memory layouts.
 * - Used for debugging and introspect output.
 * - Provides clear, readable representations of memory planes.
 */

import { PLANE_PACK_ORDER, type PlaneKey } from "@seqlok/primitives";

import type { Plan } from "../plan/types";
import type { CanonicalSpec } from "@seqlok/schema";

function label(key: PlaneKey): string {
  switch (key) {
    case "PU":
      return "Param seqlock";
    case "PF32":
      return "Param f32";
    case "PI32":
      return "Param i32/enum";
    case "PB":
      return "Param bool (u8)";

    case "MF32":
      return "Meter f32";
    case "MU32":
      return "Meter u32";
    case "MF64":
      return "Meter f64";
    case "MU":
      return "Meter seqlock";
  }
}

/**
 * Pad string on the right to a fixed width.
 */
function padRight(s: string, width: number): string {
  return s.length >= width ? s : s.padEnd(width);
}

/**
 * Pad string on the left to a fixed width.
 */
function padLeft(s: string, width: number): string {
  return s.length >= width ? s : s.padStart(width);
}

/**
 * Human-readable summary of the backing layout.
 *
 * Dev-only helper: safe to `console.log(describeViews(plan).join('\n'))`.
 */
export function describeViews<S extends CanonicalSpec>(
  plan: Plan<S>,
): string[] {
  const { planes } = plan;

  const lines: string[] = [];
  lines.push("Plane  Kind              Present  Length(B)  Offset");
  lines.push("-----  ----------------  -------  ---------  ------");

  let totalBytes = 0;
  let offset = 0;

  for (const key of PLANE_PACK_ORDER) {
    const byteLength = planes[key];
    const present = byteLength > 0;
    const byteOffset = present ? offset : undefined;

    totalBytes += byteLength;
    offset += byteLength;

    lines.push(
      `${padRight(key, 5)}  ` +
        `${padRight(label(key), 16)}  ` +
        `${present ? "   ✔" : "   ·"}   ` +
        `${padLeft(String(byteLength), 9)}  ` +
        padLeft(byteOffset !== undefined ? String(byteOffset) : "-", 6),
    );
  }

  lines.push("");
  lines.push(`Total backing bytes: ${String(totalBytes)}`);

  return lines;
}
