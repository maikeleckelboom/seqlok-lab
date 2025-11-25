

# Bench Results

> Generated from `bench-results.json` by `scripts/format-bench.ts`. Re-run `pnpm bench:report` after changing benchmarks.

_Bench run: 2025-11-25T04:30:23.699Z_

## Hot path micro-operations

| Operation                                          | Mean time (µs) | Throughput (M ops/s) |
|----------------------------------------------------|---------------:|---------------------:|
| seqlock publish uncontended                        |          0.088 |                11.33 |
| meter scalar: writer.set('level', 0.75)            |          0.158 |                 6.34 |
| meter scalar: writer.level(0.75)                   |          0.160 |                 6.27 |
| seqlock tryRead uncontended                        |          0.163 |                 6.14 |
| controller.params.stage (eqBands f32[8])           |          0.185 |                 5.39 |
| controller.params.set (two scalars)                |          0.260 |                 3.85 |
| controller.params.update (3 scalars)               |          0.366 |                 2.73 |
| controller.params.hydrate (3 scalars + f32[8])     |          0.412 |                 2.43 |
| controller.params.update (3 scalars + f32[8])      |          0.446 |                 2.24 |
| processor.params.within (scalars + eqBands f32[8]) |          0.564 |                 1.77 |
| processor.params.within (scalars only)             |          0.582 |                 1.72 |
| meter array: writer.stage('spectrum', cb)          |          0.727 |                 1.38 |
| interleaved controller.update + processor.within   |          0.963 |                 1.04 |
| observer.params.snapshot (partial)                 |         37.207 |                 0.03 |
| observer.params.within (full view)                 |         39.424 |                 0.03 |
| observer.params.snapshot (full)                    |         42.156 |                 0.02 |
| observer.meters.snapshot (partial)                 |         92.531 |                 0.01 |
| observer.meters.snapshot (full)                    |        120.194 |                 0.01 |

## E2E setup: `spec → plan → backing → handoff → bindings`

| Spec size   | Mean setup time (ms) | Setups per second |
|-------------|---------------------:|------------------:|
| Small spec  |                0.017 |             57456 |
| Medium spec |                0.028 |             36205 |
| Large spec  |                0.039 |             25544 |

_Note:_ numbers are from a single Node 20 + Vitest bench run and are meant for relative comparison, not absolute tuning.
