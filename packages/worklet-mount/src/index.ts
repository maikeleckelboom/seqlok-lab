export {
  mountWorkletOnPort,
  mountWorkletOnPortFromUrls,
  mountWorkletOnNode,
  toMountMessage,
} from "./host/mount";

export type { MountWorkletArgs, MountWorkletOptions } from "./host/mount";

export {
  assertWasmBinary,
  hasWasmMagic,
  isWmErrorMessage,
  isWmJsonObject,
  isWmMountMessage,
  isWmPhase,
  toU8View,
} from "./wire/guards";

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
} from "./wire/types";

export {
  WORKLET_MOUNT_ERRORS,
  WORKLET_MOUNT_DOMAIN,
  createWorkletMountError,
  isWorkletMountErrorCode,
  isWorkletMountPhase,
} from "./errors";

export type {
  WorkletMountErrorCode,
  WorkletMountErrorKey,
  WorkletMountPhase,
  WorkletMountErrorsMap,
  WorkletMountErrorFactory,
  WorkletMountErrorDetailsByKey,
  WorkletMountJsonValue,
  WorkletMountJsonObject,
  WorkletMountJsonArray,
  WorkletMountJsonPrimitive,
} from "./errors";
