// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./audioworklet.d.ts" />

export type {
  WmErrorMessage,
  WmJsonArray,
  WmJsonObject,
  WmJsonPrimitive,
  WmJsonValue,
  WmLogLevel,
  WmLogMessage,
  WmMessageIn,
  WmMessageOut,
  WmMountMessage,
  WmPhase,
  WmReadyMessage,
  WmWasmBytes,
} from "../wire/types";

export {
  assertWasmBinary,
  hasWasmMagic,
  isWmErrorMessage,
  isWmJsonObject,
  isWmMountMessage,
  isWmPhase,
  toU8View,
} from "../wire/guards";

export {
  createWorkletMountError,
  isWorkletMountErrorCode,
  isWorkletMountPhase,
  WORKLET_MOUNT_DOMAIN,
  WORKLET_MOUNT_ERRORS,
} from "../errors";

export type {
  WorkletMountErrorCode,
  WorkletMountErrorKey,
  WorkletMountPhase,
  WorkletMountErrorDetailsByKey,
} from "../errors";

export { WorkletMountAudioWorkletProcessor } from "./processor-base";
export type { WorkletMountState, ProcessorPhase } from "./processor-base";

export { createDynamicFactory } from "./backend-dynamic";
export type {
  EmscriptenFactory,
  EmscriptenModule,
  Registry,
  RuntimeInstance,
} from "./types";

export * from "./processor-core";
