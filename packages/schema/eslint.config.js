/**
 * @file ESLint configuration for @seqlok/schema.
 * @license MIT
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createPackageEslintConfig } from "../../scripts/eslint/eslint.base.config.js";

const HERE = dirname(fileURLToPath(import.meta.url));

export default createPackageEslintConfig({
  name: "seqlok/schema",
  tsconfigRootDir: HERE,
  tsconfigProjects: ["./tsconfig.eslint.json"],
  src: ["src/**/*.{ts,tsx}"],
  tests: ["tests/**/*.{ts,tsx}", "**/*.test.ts", "**/*.spec.ts"],
  bench: ["bench/**/*.{ts,tsx}"],
  scripts: ["scripts/**/*.{ts,tsx}"],
  config: ["*.config.ts", "vite.config.ts", "rollup.*.config.{js,ts,mts}"],
  packageDirs: [HERE],
});
