# @seqlok/schema

Canonical authored spec contract for Seqlok.

This package owns the **authored AST** and the **canonical collapsed spec** —
the JSON-serializable contract that all other Seqlok layers build from. It does
**not** own the builder DSL, runtime planning, or binding.

## Purpose

- Publish the canonical authored spec model as plain-data types.
- Provide structural validation of authored spec objects.
- Provide the only public AST-to-canonical collapse (`canonicalizeSpecAst`).
- Publish the official JSON Schema artifact (`spec-ast/v1.json`).

## What lives here

- `SpecAstInput` and leaf definition unions (`ParamDef`, `MeterDef`).
- `CanonicalSpec` and `CanonicalSpecFromAst` — the flat, validated runtime contract.
- `canonicalizeSpecAst(...)` — the only public AST-to-canonical collapse function.
- `validateSpecAst(...)` — structural validation only.
- `SPEC_AST_V1_ID` — the stable `$id` URI of the published JSON Schema.
- `spec-ast/v1.json` — the published JSON Schema file, available via
  `@seqlok/schema/spec-ast/v1.json`.

## What does NOT live here

- Builder DSL sugar (owned by `@seqlok/core`).
- Runtime planning, backing, handoff, bindings (owned by `@seqlok/core`).
- Spec hashing and identity (owned by `@seqlok/core`).
- `keysOf(...)` projection (owned by `@seqlok/core`).

## Why canonicalizeSpecAst

`canonicalizeSpecAst` is the single owner of the AST-to-canonical collapse:

- Validates authored structure via `validateSpecAst`
- Flattens nested namespaces into flat dot-path canonical planes
- Fills default scalar ranges (f32, i32, u32)
- Generates a deterministic anonymous id when `id` is omitted
- Omits empty planes
- Rejects empty segments, dotted segments, duplicate canonical keys,
  and leaf/namespace collisions

This is distinct from `@seqlok/core`'s DSL sugar, which sits on top of
schema-owned contract types without re-owning canonical meaning.

## Schema version

Current published schema: **v1** (`spec-ast/v1.json`).

The `$id` is `https://seqlok.dev/schema/spec-ast/v1.json`.

## Usage

```ts
import {
  validateSpecAst,
  canonicalizeSpecAst,
  SPEC_AST_V1_ID,
  type SpecAstInput,
  type CanonicalSpec,
} from "@seqlok/schema";

const ast: SpecAstInput = {
  id: "transport",
  params: {
    tempo: { kind: "f32", min: 40, max: 240 },
    mode: { kind: "enum", values: ["vinyl", "cdj", "sync"] },
  },
};

validateSpecAst(ast); // throws SchemaValidationError if structurally invalid
const spec: CanonicalSpec = canonicalizeSpecAst(ast); // canonical flat contract
```

### Importing the JSON Schema file

```ts
import schema from "@seqlok/schema/spec-ast/v1.json";
```

## Structural vs semantic

`@seqlok/schema` validates **structure**:

- correct object shapes
- legal `kind` values
- required fields present
- enum vocabularies are non-empty arrays of unique non-empty strings
- array lengths are positive integers

`canonicalizeSpecAst` adds **semantic** validation over the authenticated contract:

- numeric range validity (`min < max`)
- namespace flattening and collision rules
- deterministic default range filling
- deterministic missing-id materialization

That boundary is intentional and should remain stable.
