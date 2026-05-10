import type {
  MeterDef,
  ParamDef,
  ResolvedSpec,
  SpecAstInput,
  SpecNamespace,
} from "./types";

type Join<Prefix extends string, Key extends string> = Prefix extends ""
  ? Key
  : `${Prefix}.${Key}`;

export type ParamKeyMirror<
  NS extends SpecNamespace<ParamDef>,
  Prefix extends string = "",
> = {
  readonly [K in Extract<keyof NS, string>]:
    NS[K] extends ParamDef
      ? Join<Prefix, K>
      : NS[K] extends SpecNamespace<ParamDef>
        ? ParamKeyMirror<NS[K], Join<Prefix, K>>
        : never;
};

export type MeterKeyMirror<
  NS extends SpecNamespace<MeterDef>,
  Prefix extends string = "",
> = {
  readonly [K in Extract<keyof NS, string>]:
    NS[K] extends MeterDef
      ? Join<Prefix, K>
      : NS[K] extends SpecNamespace<MeterDef>
        ? MeterKeyMirror<NS[K], Join<Prefix, K>>
        : never;
};

export type KeyMirrorFromAst<S extends SpecAstInput> = Readonly<{
  params: S["params"] extends SpecNamespace<ParamDef>
    ? ParamKeyMirror<S["params"]>
    : Record<string, never>;
  meters: S["meters"] extends SpecNamespace<MeterDef>
    ? MeterKeyMirror<S["meters"]>
    : Record<string, never>;
}>;

function setAtPath(
  root: Record<string, unknown>,
  parts: readonly string[],
  value: string,
): void {
  let node = root;

  for (let i = 0; i < parts.length - 1; i += 1) {
    // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style
    const part = parts[i] as string;
    const existing = node[part];

    if (existing == null || typeof existing !== "object") {
      node[part] = Object.create(null) as Record<string, unknown>;
    }

    node = node[part] as Record<string, unknown>;
  }

  // eslint-disable-next-line @typescript-eslint/non-nullable-type-assertion-style
  node[parts[parts.length - 1] as string] = value;
}

function deepFreeze<T extends object>(obj: T): T {
  Object.freeze(obj);

  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
      deepFreeze(value as object);
    }
  }

  return obj;
}

export function keysOf<const S extends SpecAstInput>(
  spec: ResolvedSpec<S>,
): KeyMirrorFromAst<S> {
  const params = Object.create(null) as Record<string, unknown>;
  const meters = Object.create(null) as Record<string, unknown>;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const flatParams = spec.params != null ? Object.keys(spec.params) : [];
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const flatMeters = spec.meters != null ? Object.keys(spec.meters) : [];

  for (const key of flatParams) {
    setAtPath(params, key.split("."), key);
  }

  for (const key of flatMeters) {
    setAtPath(meters, key.split("."), key);
  }

  return deepFreeze({
    params,
    meters,
  }) as KeyMirrorFromAst<S>;
}
