import { defineConfig } from "vitest/config";

import { createSeqlokWorkspaceAliases } from "../../scripts/vite/workspace-aliases";
import { createSharedTestConfig } from "../../scripts/vitest/shared-config";

const shared = createSharedTestConfig({
  testTimeout: 60_000,
  hookTimeout: 30_000,
  coverageThresholds: {
    statements: 75,
    branches: 70,
    functions: 70,
    lines: 75,
  },
  coverageExclude: [
    "src/**/index.ts",
    "src/types/**",
    "src/context/**",

    // New: never let legacy stuff affect coverage discovery
    "tests_legacy/**",
  ],
});

export default defineConfig({
  resolve: {
    alias: createSeqlokWorkspaceAliases(),
  },
  test: {
    ...shared,

    // New: only run the new suite under packages/core/tests/**
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.prop.test.ts",
      "tests/**/*.stress.test.ts",
      "tests/**/*.types.test.ts",
    ],

    // New: hard exclude legacy tests, even if someone loosens include globs later
    exclude: [
      ...(shared.exclude ?? []),
      "tests_legacy/**",
      "**/node_modules/**",
      "**/dist/**",
    ],
  },
});
