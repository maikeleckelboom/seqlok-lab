/**
 * @file Vitest configuration for @seqlok/commands.
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    reporters: ["default"],
    environment: "node",
    fileParallelism: false,
    isolate: false,

    testTimeout: 30_000,
    hookTimeout: 15_000,

    include: ["tests/**/*.test.ts", "tests/**/*.spec.ts"],
    exclude: ["dist/**", "node_modules/**", "bench/**", "docs/**"],

    coverage: {
      provider: "v8",
      enabled: false,
      reporter: ["text", "html", "lcov"],
      exclude: ["dist/**", "tests/**", "bench/**"],
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
    },
  },
});
