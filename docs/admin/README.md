# Admin docs

This folder holds Seqlok admin documentation.  
It covers how the project is run, not the runtime API.

Typical readers are:

- future me (what did I do, when and why)
- tax and R&D authorities (WBSO style evidence of work)
- reviewers or partners who want to see process and governance

These docs are internal and not shipped with any public bundle.

## Layout

- `rd-log-2025.md`: running R&D log for 2025
- `rd-log-2026.md`: next year once the calendar flips
- `release-checklist.md`: steps to cut a release safely
- `governance.md`: notes on roles, decisions and process

More files can appear here as the project grows.  
Rule of thumb: if it is about how we work rather than what the code does, it lives in `docs/admin`.

## R&D log conventions

Each R&D log file tracks one calendar year:

- `rd-log-2025.md`
- `rd-log-2026.md`
- and so on

Inside a file:

- one section per day: `## YYYY-MM-DD`
- under each date, one to three bullets
- each bullet uses this shape:

  - `<hours> | <area>: <concrete technical result>`

Keep bullets short and technical.  
This is for evidence and recall, not for personal diary notes.

Example:

```markdown
## 2025-11-25

- 3h | Hotswap: refined the seqlock-backed SwapTicket state machine and
  extended conformance tests to cover ABA and version wraparound cases.
- 2h | Monorepo scaffolding: created base packages for the layered workspace
  and wired up per-package tsconfig, ESLint and Vitest configs so each layer
  can lint and test in isolation.
````
