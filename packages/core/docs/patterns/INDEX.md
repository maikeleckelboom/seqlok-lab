# Patterns

This folder contains **implementation patterns and design notes** for Seqlok.

**These are not ADRs.** They are exploratory, may age out, and can be replaced over time. They describe useful patterns that have been identified but are not architectural decisions that must be followed.

---

## Current Patterns

| File | Description |
|------|-------------|
| `DESIGN-002-webgpu-digital-twin-pattern.md` | WebGPU "digital twin" pattern: meters → observer → GPU buffer → WGSL shaders. |
| `DESIGN-003-telemetry-bridge-pattern.md` | Mirroring Seqlok state into external telemetry or hardware without violating SWMR. |

---

## What Belongs Here

- Implementation patterns that emerge from real usage.
- Design sketches for specific use cases.
- Integration examples (WebGPU, Node/UDP, etc.).

## What Does Not Belong Here

- **ADRs** → go to [`../adr/`](../adr/)
- **Historical drafts** → go to [`../attic/adr/`](../attic/adr/)
- **System documentation** → go to [`../architecture/`](../architecture/)

---

## Maintenance

Patterns may:

- Be updated as practices evolve.
- Be removed if they become obsolete.
- Be promoted to ADRs if they become normative decisions.

These are living documents, not permanent records.

---

## Related

- Live ADRs: [`../adr/`](../adr/)
- Historical archive: [`../attic/adr/`](../attic/adr/)
