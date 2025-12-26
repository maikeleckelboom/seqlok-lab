import type { CoprocessorRuntimeErrorCode } from "../errors";

export type CpLogLevel = "info" | "warn" | "error" | "critical";

/**
 * Runtime phase of the coprocessor as observed at the worklet boundary.
 *
 * - `"loading"`: a mount/load attempt is in progress (or failed during load).
 * - `"rt"`: the processor is in real-time mode (audio callback running).
 */
export type CpPhase = "loading" | "rt";

/**
 * JSON-serializable value type used for compact, structured error `details`.
 *
 * @remarks
 * This is intentionally strict: no `undefined`, no functions, no class instances.
 *
 * TypeScript forbids recursive type-aliases under some configurations, so the
 * recursive pieces are expressed as interfaces.
 */
export type CpJsonPrimitive = string | number | boolean | null;

export interface CpJsonObject {
  readonly [key: string]: CpJsonValue;
}

export type CpJsonArray = readonly CpJsonValue[];

export type CpJsonValue = CpJsonPrimitive | CpJsonObject | CpJsonArray;

/**
 * WASM bytes accepted by the protocol.
 *
 * - `ArrayBuffer` is the most transferable-friendly option.
 * - `SharedArrayBuffer` supports COOP/COEP environments.
 * - `ArrayBufferView` (e.g. `Uint8Array`) is ergonomic for callers.
 */
export type CpWasmBytes = ArrayBuffer | SharedArrayBuffer | ArrayBufferView;

/**
 * Mount request sent from host -> worklet.
 */
export interface CpMountMessage {
  readonly type: "cp:mount";
  readonly key: string;
  readonly seq: number;

  /**
   * Raw WASM bytes. Must start with `\0asm`.
   */
  readonly wasmBytes: CpWasmBytes;

  /**
   * Optional Emscripten wrapper JS text.
   *
   * @remarks
   * If omitted, the worklet will attempt to resolve a bundled factory by `key`.
   */
  readonly wrapperJs?: string;

  /**
   * Optional module options passed to the Emscripten factory.
   *
   * @remarks
   * Values must be structured-clone compatible if they cross the port.
   */
  readonly moduleOpts?: Readonly<Record<string, unknown>>;
}

/**
 * Ready acknowledgement sent from worklet -> host.
 */
export interface CpReadyMessage {
  readonly type: "cp:ready";
  readonly key: string;
  readonly seq: number;
}

/**
 * Error response sent from worklet -> host.
 */
export interface CpErrorMessage {
  readonly type: "cp:error";
  readonly key: string;
  readonly seq: number;

  /**
   * Phase at the time the error was produced.
   */
  readonly phase: CpPhase;

  /**
   * Human-friendly error message (best-effort).
   */
  readonly message: string;

  /**
   * Optional domains error code (e.g. `"coprocessorRuntime.invalidMountMessage"`).
   */
  readonly code?: CoprocessorRuntimeErrorCode;

  /**
   * Optional structured, JSON-serializable details.
   */
  readonly details?: CpJsonObject;
}

export interface CpLogMessage {
  readonly type: "cp:log";
  readonly key: string;
  readonly seq: number;
  readonly level: CpLogLevel;
  readonly msg: string;
}

export type CpMessageIn = CpMountMessage;
export type CpMessageOut = CpReadyMessage | CpErrorMessage | CpLogMessage;
