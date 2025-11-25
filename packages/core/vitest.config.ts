import { defineConfig } from "vitest/config";

import type { BenchOptions } from "vitest";

/**
 * For ultra-fast micro operations where we want low RME.
 */
export const MICRO_BENCH_OPTS: BenchOptions = {
  time: 1_000,
  warmupTime: 500,
  warmupIterations: 128,
  iterations: 512,
  throws: true,
};

/**
 * For heavier E2E-ish things (plan+allocate+bind, real-world patterns).
 */
export const E2E_BENCH_OPTS: BenchOptions = {
  time: 1_500,
  warmupTime: 750,
  warmupIterations: 64,
  iterations: 128,
  throws: true,
};

export default defineConfig({
  test: {
    globals: true,
    reporters: ["default"],
    environment: "node",
    fileParallelism: false,
    isolate: false,

    testTimeout: 60_000,
    hookTimeout: 30_000,

    include: ["tests/**/*.test.ts", "tests/**/*.spec.ts"],
    exclude: ["dist/**", "node_modules/**", "bench/**", "docs/**"],

    coverage: {
      provider: "v8",
      enabled: false,
      reporter: ["text", "html", "lcov"],
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 70,
        lines: 75,
      },
      exclude: [
        "dist/**",
        "tests/**",
        "bench/**",
        "src/**/index.ts",
        "src/types/**",
        "src/context/**",
      ],
    },

    benchmark: {
      include: ["bench/**/*.bench.ts"],
      exclude: [
        "node_modules/**",
        "dist/**",
        ".idea/**",
        ".git/**",
        ".cache/**",
      ],
      reporters: ["verbose"],
      outputJson: "bench-results.json",
      // compare: "bench-results-main.json",
    },
  },
});
