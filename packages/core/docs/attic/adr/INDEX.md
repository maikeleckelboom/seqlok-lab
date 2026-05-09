# Historical ADR Archive

This folder contains **archived Architecture Decision Records (ADRs)** that are no longer current.

**These documents are historical, not normative.** They are preserved for context and traceability, but they do not describe current system behavior or current package ownership.

---

## Archived ADRs

| File | Reason Archived |
|------|-----------------|
| `ADR-00D-primitives-internal-and-pruned.md` | Archived because it conflicts with the current separate `@seqlok/primitives` package. |
| `ADR-00E-electron-multi-process-runtimes.md` | Archived because it is future-oriented and compose-era, not current live package guidance. |
| `ADR-00X-introduce-seqlok-compose-for-system-level-composition.md` | Archived because `@seqlok/compose` is not part of the current repo. |
| `ADR-00Y-mwmr-architecture.md` | Archived because it is proposal-grade and compose-era; current guardrails belong in ADR-011. |
| `ADR-00Z-observer-binding-role.md` | Archived because it is proposal/rationale material, not the current narrow ADR set. |
| `ADR-012-bind-observer-telemetry-and-multi-reader-rationale.md` | Archived because it is rationale-heavy and not a current accepted decision record. |
| `ADR-013-clarify-plan-backing-handoff-naming.md` | Archived because it is a proposal, not a current active decision. |

---

## Why Archive?

Live ADRs must:

- Match current code and current package ownership.
- Not mention non-existent packages (e.g., `@seqlok/compose`).
- Not present conceptual/proposed APIs as current truth.

When an ADR no longer meets these criteria, it moves here. History is preserved; stale guidance is removed from the live set.

---

## Current Truth

For live, accepted decisions, see [`../../adr/`](../../adr/).

For patterns and design notes, see [`../../patterns/`](../../patterns/).
