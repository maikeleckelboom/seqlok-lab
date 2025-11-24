

# Bench Results

> Generated from `bench-results.json` by `scripts/format-bench.ts`. Re-run `pnpm bench:report` after changing benchmarks.

_Bench run: 2025-11-24T04:49:17.083Z_

## Hot path micro-operations

| Operation                                          | Mean time (µs) | Throughput (M ops/s) |
|----------------------------------------------------|---------------:|---------------------:|
| seqlock publish uncontended                        |          0.087 |                11.48 |
| controller.params.stage (eqBands f32[8])           |          0.134 |                 7.47 |
| meter scalar: writer.level(0.75)                   |          0.161 |                 6.21 |
| meter scalar: writer.set('level', 0.75)            |          0.169 |                 5.90 |
| seqlock tryRead uncontended                        |          0.176 |                 5.68 |
| controller.params.set (two scalars)                |          0.307 |                 3.26 |
| controller.params.update (3 scalars)               |          0.324 |                 3.08 |
| controller.params.hydrate (3 scalars + f32[8])     |          0.435 |                 2.30 |
| processor.params.within (scalars only)             |          0.520 |                 1.92 |
| processor.params.within (scalars + eqBands f32[8]) |          0.529 |                 1.89 |
| controller.params.update (3 scalars + f32[8])      |          0.622 |                 1.61 |
| meter array: writer.stage('spectrum', cb)          |          0.691 |                 1.45 |
| interleaved controller.update + processor.within   |          0.861 |                 1.16 |
| observer.params.snapshot (partial)                 |         39.374 |                 0.03 |
| observer.params.within (full view)                 |         40.557 |                 0.02 |
| observer.params.snapshot (full)                    |         50.354 |                 0.02 |
| observer.meters.snapshot (partial)                 |        112.517 |                 0.01 |
| observer.meters.snapshot (full)                    |        141.913 |                 0.01 |

## E2E setup: `spec → plan → backing → handoff → bindings`

| Spec size   | Mean setup time (ms) | Setups per second |
|-------------|---------------------:|------------------:|
| Small spec  |                0.018 |             56900 |
| Medium spec |                0.030 |             33629 |
| Large spec  |                0.045 |             22016 |

_Note:_ numbers are from a single Node 20 + Vitest bench run and are meant for relative comparison, not absolute tuning.
