# @seqlok/schema

Canonical authored spec contract for Seqlok.

This package owns the **authored AST** — the JSON-serializable contract that
all other Seqlok layers build from. It does **not** own the builder DSL,
semantic compilation, runtime planning, or binding.

## Purpose

- Publish the canonical authored spec model as plain-data types.
- Provide structural validation of authored spec objects.
- Provide deterministic normalization into canonical authored form.
- Publish the official JSON Schema artifact (`spec-ast/v1.json`).

## What lives here

- `SpecAstInput` and leaf definition unions (`ParamDef`, `MeterDef`).
- `validateSpecAst(...)` — structural validation only.
- `normalizeSpecAst(...)` — deterministic authored-layer canonicalization.
- `SPEC_AST_V1_ID` — the stable `$id` URI of the published JSON Schema.
- `spec-ast/v1.json` — the published JSON Schema file, available via
  `@seqlok/schema/spec-ast/v1.json`.

## What does NOT live here

- Builder DSL sugar (owned by `@seqlok/core`).
- Semantic compilation, namespace flattening, runtime defaults (owned by `@seqlok/core`).
- Spec hashing and identity (owned by `@seqlok/core`).
- Planning, backing, handoff, bindings (owned by `@seqlok/core`).
- `keysOf(...)` projection (owned by `@seqlok/core`).

## Why normalizeSpecAst

`normalizeSpecAst` operates at the **authored** layer only:

- Sorts object keys deterministically at every nesting level
- Preserves enum vocabulary order (identity-significant)
- Omits empty `params`/`meters` planes
- Does **not** flatten namespaces or apply runtime defaults

This is the canonical collapsing function that makes two equivalent authored
ASTs produce identical JSON. It is distinct from `@seqlok/core`'s semantic
compilation, which flattens namespaces, fills defaults, and validates meaning.

## Schema version

Current published schema: **v1** (`spec-ast/v1.json`).

The `$id` is `https://seqlok.dev/schema/spec-ast/v1.json`.

## Usage

```ts
import {
  validateSpecAst,
  normalizeSpecAst,
  SPEC_AST_V1_ID,
  type SpecAstInput,
} from "@seqlok/schema";

const ast: SpecAstInput = {
  id: "transport",
  params: {
    tempo: { kind: "f32", min: 40, max: 240 },
    mode: { kind: "enum", values: ["vinyl", "cdj", "sync"] },
  },
};

validateSpecAst(ast); // throws SchemaValidationError if structurally invalid
const canonical = normalizeSpecAst(ast); // deterministic authored form
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

`@seqlok/core` validates **meaning**:

- numeric range validity (`min < max`)
- runtime defaults
- namespace flattening and collision rules
- planner invariants
- hash and compatibility policy

That boundary is intentional and should remain stable.
