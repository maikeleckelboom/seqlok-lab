/**
 * @fileoverview @seqlok/core public API (v2.0 - zero duplication)
 */

// SPEC & LAYOUT

export { defineSpec } from './spec/define';
export { planLayout } from './plan/layout';

export type { SpecInput } from './spec/types';

// BACKING & MEMORY

export { allocateShared } from './backing/allocate';
export { attachWasmShared } from './backing/attach-wasm';

// BINDINGS (Functions)

export { bindController } from './binding/controller';
export { bindProcessor } from './binding/processor';

// BINDINGS (Types)
export type {
  // Core binding interfaces
  ControllerBinding,
  ProcessorBinding,
  ControllerParams,
  ProcessorParams,
  ControllerMeters,
  ProcessorMeters,

  // Param value types
  ParamValueFor,
  ArrayParamView,
  ParamsView,
  CoherentParamShape,
  CoherentValue,
  ScalarParamPatch,

  // Meter value types
  MeterValueFor,
  MeterWriter,

  // Snapshot types
  FullParamsSnapshot,
  FullMetersSnapshot,
  SnapshotParamsObject,
  SnapshotMetersObject,
  SnapshotParamsOptions,
  SnapshotMetersOptions,
  IntoForParams,
  IntoForMeters,

  // Options
  ControllerOptions,
  ProcessorOptions,
  RangePolicy,

  // Utility types
  Ephemeral,
  PUSeq,
  MUSeq,
} from './binding/types';

// HANDOFF

export { buildHandoff, receiveHandoff, verifyHandoff } from './handoff';

export type { Handoff, HandoffPacking, ReceivedHandoff } from './handoff';

// ERRORS

export { SeqlokError, isSeqlokError, createError } from './errors/error';
export { invariant } from './errors/invariant';

export type {
  ErrorCode,
  ErrorPayload,
  ErrorDetails,
  ErrorMeta,
  TypedArrayName,
} from './errors';

export {
  enumArrayToLabels,
  enumIndexFromLabel,
  enumLabelFromIndex,
  enumValues,
  enumLabelsToArray,
  enumPaletteFor,
  type EnumLabel,
  type EnumKeyOf,
} from './util/enum-helpers';
