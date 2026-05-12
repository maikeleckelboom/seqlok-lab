/**
 * @fileoverview
 * Allocates shared WebAssembly memory backings for a plan.
 *
 * @remarks
 * - Uses `WebAssembly.Memory` with `shared: true` for WASM-based runtimes.
 * - Derives byte requirements from the Plan.
 * - Bootstrapping growth:
 * - If `options.backing` (or `options.memory`) is provided, it will be grown
 * via `.grow()` until it can hold `plan.bytesTotal + baseOffsetBytes`.
 * - If no memory is provided, a new `WebAssembly.Memory` is allocated.
 *
 * @internal
 */

import { BYTES_PER_ELEM } from "@seqlok/primitives";

import { createBackingError } from "../errors/backing";
import { createEnvError } from "../errors/env";

import type { WasmSharedBacking } from "./types";
import type { Plan } from "../plan/types";
import type { CanonicalSpec } from "@seqlok/schema";

/** WebAssembly page size in bytes (64 KiB). */
const WASM_PAGE_SIZE = 64 * 1024;

/**
 * Options for allocating or wrapping a shared WebAssembly memory.
 *
 * @remarks
 * This is a discriminated union to ensure a single source of truth:
 * - Pass `backing` to reuse an existing typed backing (inherits baseOffset).
 * - Pass `memory` + `baseOffsetBytes` to wrap a raw WebAssembly.Memory.
 */
export type AllocateWasmSharedOptions = Readonly<
  | {
      /** Reuse an existing typed backing (baseOffsetBytes comes from it). */
      backing: WasmSharedBacking;
      memory?: never;
      baseOffsetBytes?: never;
    }
  | {
      /** Reuse a raw shared WebAssembly.Memory (baseOffsetBytes supplied here). */
      backing?: never;
      memory?: WebAssembly.Memory;
      baseOffsetBytes?: number;
    }
>;

function normalizeBaseOffsetBytes(
  raw: number | undefined,
  where: string,
): number {
  if (raw === undefined) {
    return 0;
  }
  if (!Number.isSafeInteger(raw) || raw < 0) {
    throw createBackingError("invalidBaseOffset", {
      baseOffsetBytes: typeof raw === "number" ? raw : Number.NaN,
      alignmentBytes: BYTES_PER_ELEM.MF64,
      where,
    });
  }
  if (raw % BYTES_PER_ELEM.MF64 !== 0) {
    throw createBackingError("invalidBaseOffset", {
      baseOffsetBytes: raw,
      alignmentBytes: BYTES_PER_ELEM.MF64,
      where,
    });
  }
  return raw;
}

/**
 * Validates that a buffer is a SharedArrayBuffer.
 */
function toSharedBuffer(buf: ArrayBuffer, where: string): SharedArrayBuffer {
  const sharedAvailable = typeof SharedArrayBuffer !== "undefined";
  const isShared = sharedAvailable && buf instanceof SharedArrayBuffer;

  if (!isShared) {
    throw createBackingError("wasmMemoryNotShared", {
      plane: "wasm",
      shared: false,
      where,
    });
  }

  return buf as SharedArrayBuffer;
}

/**
 * Ensure that the given WebAssembly.Memory is large enough to hold `totalBytes`.
 *
 * @remarks
 * - Calls `memory.grow()` in page-sized increments if needed.
 * - Throws `backing.allocUndersized` if growth fails (e.g. maximum hit).
 */
function ensureWasmCapacity(
  totalBytes: number,
  memory: WebAssembly.Memory,
  where: string,
): void {
  const currentBytes = memory.buffer.byteLength;

  if (currentBytes >= totalBytes) {
    return;
  }

  const missingBytes = totalBytes - currentBytes;
  const pagesNeeded = Math.ceil(missingBytes / WASM_PAGE_SIZE);

  try {
    memory.grow(pagesNeeded);
  } catch (cause) {
    throw createBackingError(
      "allocUndersized",
      {
        plane: "all",
        requestedBytes: totalBytes,
        allocatedBytes: currentBytes,
        where,
      },
      cause,
    );
  }
}

/**
 * Allocate or wrap a shared WebAssembly.Memory for the given plan.
 *
 * @remarks
 * - If `options.backing` is provided: reuses its memory and preserves its offset.
 * - If `options.memory` is provided: wraps it and applies `options.baseOffsetBytes`.
 * - In both cases, the memory is grown if necessary to satisfy requirements.
 * - If neither is provided, a new `WebAssembly.Memory` is allocated.
 */
export function allocateWasmShared<S extends CanonicalSpec>(
  plan: Plan<S>,
  options?: AllocateWasmSharedOptions,
): WasmSharedBacking {
  if (
    typeof WebAssembly === "undefined" ||
    typeof WebAssembly.Memory === "undefined"
  ) {
    throw createEnvError("unsupported", {
      feature: "WebAssembly.Memory",
      reason: "WebAssembly or WebAssembly.Memory is not defined",
    });
  }

  // Resolve baseOffsetBytes from the correct source based on union state.
  const rawBaseOffset =
    options && "backing" in options
      ? options.backing.baseOffsetBytes
      : options?.baseOffsetBytes;

  const baseOffsetBytes = normalizeBaseOffsetBytes(
    rawBaseOffset,
    "allocateWasmShared",
  );

  const totalBytes = plan.bytesTotal + baseOffsetBytes;

  // Resolve existing memory from the correct source.
  const existingMemory =
    options && "backing" in options ? options.backing.memory : options?.memory;

  let memory: WebAssembly.Memory;

  if (existingMemory) {
    memory = existingMemory;
    toSharedBuffer(memory.buffer, "allocateWasmShared");
    ensureWasmCapacity(totalBytes, memory, "allocateWasmShared.grow");
  } else {
    const requiredPages = Math.max(1, Math.ceil(totalBytes / WASM_PAGE_SIZE));

    try {
      memory = new WebAssembly.Memory({
        initial: requiredPages,
        maximum: requiredPages,
        shared: true,
      });
    } catch (cause) {
      throw createBackingError(
        "wasmMemoryNotShared",
        {
          plane: "wasm",
          shared: false,
          where: "allocateWasmShared",
        },
        cause,
      );
    }
  }

  const sharedBuf = toSharedBuffer(memory.buffer, "allocateWasmShared");

  if (sharedBuf.byteLength < totalBytes) {
    throw createBackingError("allocUndersized", {
      plane: "all",
      requestedBytes: totalBytes,
      allocatedBytes: sharedBuf.byteLength,
      where: "allocateWasmShared",
    });
  }

  return baseOffsetBytes === 0
    ? { kind: "wasm-shared", memory }
    : { kind: "wasm-shared", memory, baseOffsetBytes };
}
