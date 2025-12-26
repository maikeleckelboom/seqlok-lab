// File: packages/coprocessor-runtime/src/mount/mount.ts

import { createCoprocessorRuntimeError } from "../errors";
import {
  assertWasmBinary,
  isCpErrorMessage,
  type CpLogMessage,
  type CpMountMessage,
  type CpWasmBytes,
} from "../protocol";

export interface MountCoprocessorArgs {
  readonly key: string;
  /**
   * Monotonic sequence number chosen by the host.
   * Used to correlate responses when reloading the same key.
   */
  readonly seq: number;

  /**
   * Emscripten wrapper URL (dynamic backend).
   *
   * Omit to use bundled backend (CSP-safe).
   */
  readonly wrapperUrl?: string;

  /** WASM binary URL. */
  readonly wasmUrl: string;

  /** Optional module options forwarded to the Emscripten factory. */
  readonly moduleOpts?: Readonly<Record<string, unknown>>;
}

export interface MountCoprocessorOptions {
  /**
   * Called for worklet-originated logs during mount.
   * This also receives logs after mount if you keep the handler installed elsewhere.
   */
  readonly onLog?: (msg: CpLogMessage) => void;
}

function looksLikeHtml(text: string): boolean {
  return text.trimStart().startsWith("<");
}

function ensureNonEmptyKey(key: string, op: string): void {
  if (key.length === 0) {
    throw createCoprocessorRuntimeError("emptyKey", { op });
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw createCoprocessorRuntimeError("fetchFailed", {
      resource: "wrapper",
      url,
      status: res.status,
    });
  }
  return res.text();
}

async function fetchWasm(url: string): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw createCoprocessorRuntimeError("fetchFailed", {
      resource: "wasm",
      url,
      status: res.status,
    });
  }
  return res.arrayBuffer();
}

function transferListFor(bytes: CpWasmBytes): Transferable[] {
  if (bytes instanceof ArrayBuffer) {
    return [bytes];
  }
  return [];
}

/**
 * Mount by sending a `cp:mount` message over a MessagePort (i.e. `AudioWorkletNode.port`).
 */
export async function mountCoprocessor(
  port: MessagePort,
  msg: CpMountMessage,
  opts: MountCoprocessorOptions = {},
): Promise<void> {
  ensureNonEmptyKey(msg.key, "mountCoprocessor");

  return new Promise<void>((resolve, reject) => {
    const handler = (e: MessageEvent<unknown>) => {
      const data: unknown = e.data;
      if (data === null || typeof data !== "object") {
        return;
      }
      const rec = data as Record<string, unknown>;

      if (rec.key !== msg.key || rec.seq !== msg.seq) {
        return;
      }

      if (rec.type === "cp:log") {
        opts.onLog?.(rec as unknown as CpLogMessage);
        return;
      }

      if (rec.type === "cp:ready") {
        port.removeEventListener("message", handler);
        resolve();
        return;
      }

      if (rec.type === "cp:error") {
        port.removeEventListener("message", handler);

        if (!isCpErrorMessage(data)) {
          reject(
            createCoprocessorRuntimeError("invalidMountMessage", {
              reason:
                "worklet sent cp:error but it failed structural validation",
              receivedType: "cp:error",
              receivedKeys: Object.keys(rec),
            }),
          );
          return;
        }

        const errMsg = data;

        reject(
          createCoprocessorRuntimeError("workletError", {
            key: msg.key,
            seq: msg.seq,
            phase: errMsg.phase,
            message: errMsg.message,
            ...(errMsg.code !== undefined ? { workletCode: errMsg.code } : {}),
            ...(errMsg.details !== undefined
              ? { workletDetails: errMsg.details }
              : {}),
          }),
        );
        return;
      }
    };

    port.addEventListener("message", handler);
    port.start();

    port.postMessage(msg, transferListFor(msg.wasmBytes));
  });
}

export async function mountCoprocessorFromUrls(
  port: MessagePort,
  args: MountCoprocessorArgs,
  opts: MountCoprocessorOptions = {},
): Promise<void> {
  const { key, seq, wrapperUrl, wasmUrl, moduleOpts } = args;

  ensureNonEmptyKey(key, "mountCoprocessorFromUrls");

  const [wrapperJs, wasmBytes] = await Promise.all([
    wrapperUrl
      ? fetchText(wrapperUrl)
      : Promise.resolve<string | undefined>(undefined),
    fetchWasm(wasmUrl),
  ]);

  if (wrapperJs !== undefined && looksLikeHtml(wrapperJs)) {
    throw createCoprocessorRuntimeError("wrapperReturnedHtml", {
      url: wrapperUrl ?? "",
    });
  }

  assertWasmBinary(wasmBytes, "host.mountCoprocessorFromUrls");

  const msg: CpMountMessage = toMountMessage({
    type: "cp:mount",
    key,
    seq,
    wasmBytes,
    wrapperJs,
    moduleOpts,
  });

  await mountCoprocessor(port, msg, opts);
}

/**
 * Convenience wrapper around {@link mountCoprocessorFromUrls} for AudioWorkletNode.
 */
export async function mountCoprocessorOnNode(
  node: AudioWorkletNode,
  args: MountCoprocessorArgs,
  opts: MountCoprocessorOptions = {},
): Promise<void> {
  return mountCoprocessorFromUrls(node.port, args, opts);
}

type ToMountMessageInit = Readonly<{
  /**
   * Optional so callers can pass either:
   * - { key, seq, wasmBytes, ... }
   * - { type: "cp:mount", key, seq, wasmBytes, ... }   (your current callsite)
   */
  type?: "cp:mount" | undefined;

  readonly key: string;
  readonly seq: number;
  readonly wasmBytes: CpWasmBytes;
  readonly wrapperJs?: string | undefined;
  readonly moduleOpts?: Readonly<Record<string, unknown>> | undefined;
}>;

function ensureValidSeq(seq: number, op: string): void {
  if (!Number.isSafeInteger(seq) || seq < 0) {
    throw createCoprocessorRuntimeError("invalidMountMessage", {
      reason: "seq must be a non-negative safe integer",
      receivedType: "cp:mount",
      receivedKeys: [op],
    });
  }
}

function buildMountMessage(
  init: ToMountMessageInit,
  op: string,
): CpMountMessage {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (init.type !== undefined && init.type !== "cp:mount") {
    throw createCoprocessorRuntimeError("invalidMountMessage", {
      reason: `unexpected message type: ${String(init.type)}`,
      receivedType: String(init.type),
      receivedKeys: Object.keys(init),
    });
  }

  ensureNonEmptyKey(init.key, op);
  ensureValidSeq(init.seq, op);
  assertWasmBinary(init.wasmBytes, `host.${op}`);

  return {
    type: "cp:mount",
    key: init.key,
    seq: init.seq,
    wasmBytes: init.wasmBytes,
    ...(init.wrapperJs !== undefined ? { wrapperJs: init.wrapperJs } : {}),
    ...(init.moduleOpts !== undefined ? { moduleOpts: init.moduleOpts } : {}),
  };
}

export function toMountMessage(init: ToMountMessageInit): CpMountMessage;
export function toMountMessage(
  key: string,
  seq: number,
  wasmBytes: CpWasmBytes,
  wrapperJs?: string,
  moduleOpts?: Readonly<Record<string, unknown>>,
): CpMountMessage;
export function toMountMessage(
  keyOrInit: string | ToMountMessageInit,
  seq?: number,
  wasmBytes?: CpWasmBytes,
  wrapperJs?: string,
  moduleOpts?: Readonly<Record<string, unknown>>,
): CpMountMessage {
  if (typeof keyOrInit === "string") {
    if (seq === undefined || wasmBytes === undefined) {
      throw createCoprocessorRuntimeError("invalidMountMessage", {
        reason:
          "toMountMessage(key, seq, wasmBytes, ...) requires both seq and wasmBytes",
        receivedType: "host.toMountMessage",
        receivedKeys: ["key", "seq", "wasmBytes"],
      });
    }

    return buildMountMessage(
      { key: keyOrInit, seq, wasmBytes, wrapperJs, moduleOpts },
      "toMountMessage",
    );
  }

  // Object form
  return buildMountMessage(keyOrInit, "toMountMessage");
}
