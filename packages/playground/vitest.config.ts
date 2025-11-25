import { type UserConfig } from "vite";
import { type BenchOptions } from "vitest";
import { defineConfig } from "vitest/config";

export const MICRO_BENCH_OPTS: BenchOptions = {};

export const E2E_BENCH_OPTS: BenchOptions = {};

const config: UserConfig = defineConfig({
  test: {
    globals: true,
    reporters: ["default"],
    environment: "jsdom",
    fileParallelism: false,
    isolate: false,
    testTimeout: 30_000,
    hookTimeout: 15_000,
    include: ["tests/**/*.test.ts", "tests/**/*.spec.ts"],
    exclude: ["dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      enabled: false,
      reporter: ["text", "html", "lcov"],
      exclude: ["dist/**"],
    },
  },
});

export default config;
