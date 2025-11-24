/**
 * @file ESLint configuration file.
 * @author Maikel Eckelboom
 * @license MIT
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import importPlugin from "eslint-plugin-import";
import regex from "eslint-plugin-regex";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * The directory name of the current module.
 * @type {string}
 */
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The root directory of the repository.
 * @type {string}
 */
const REPO_ROOT = dirname(dirname(HERE));

/**
 * An object containing file and directory paths for ESLint configurations.
 * @property {string[]} ignores - Patterns for files and directories to be ignored by ESLint.
 * @property {string[]} src - Path patterns for source TypeScript files.
 * @property {string[]} tests - Path patterns for test files.
 * @property {string[]} examples - Path patterns for example files.
 * @property {string[]} bench - Path patterns for benchmark files.
 * @property {string[]} scripts - Path patterns for script files.
 * @property {string[]} allTs - An aggregation of all TypeScript file paths.
 */
const paths = {
  ignores: [
    "**/dist/**",
    "**/build/**",
    "**/coverage/**",
    "**/.output/**",
    "**/generated/**",
    "**/node_modules/**",
    "**/*.d.ts",
    "**/docs/**",
  ],
  src: ["src/**/*.{ts,tsx}"],
  tests: ["tests/**/*.{ts,tsx}", "**/*.test.ts", "**/*.spec.ts"],
  examples: ["examples/**/*.{ts,tsx}"],
  bench: ["bench/**/*.{ts,tsx}"],
  scripts: ["scripts/**/*.{ts,tsx}"],
  config: ["*.config.ts", "vite.config.ts"],
};

paths.allTs = [
  ...paths.src,
  ...paths.tests,
  ...paths.examples,
  ...paths.bench,
  ...paths.scripts,
  ...paths.config,
];

/**
 * Defines the architectural layers of the application for import restrictions.
 * @type {Record<
 *   'primitives' |
 *   'errors' |
 *   'types' |
 *   'spec' |
 *   'plan' |
 *   'backing' |
 *   'handoff' |
 *   'binding' |
 *   'diagnostics' |
 *   'context' |
 *   'internal',
 *   string
 * >}
 */
const layers = {
  primitives: "src/primitives",
  errors: "src/errors",
  types: "src/types",
  spec: "src/spec",
  plan: "src/plan",
  backing: "src/backing",
  handoff: "src/handoff",
  binding: "src/binding",
  diagnostics: "src/diagnostics",
  context: "src/context",
  internal: "src/internal",
};

/**
 * @typedef {object} LayerRestriction
 * @property {string} target - The layer where the restriction is applied.
 * @property {string} from - The layer that is not allowed to be imported.
 * @property {string} message - The error message for the restriction.
 */

/**
 * Builds an array of layer-based import restrictions.
 * This function enforces architectural boundaries by preventing illegal imports between layers.
 * @returns {LayerRestriction[]} An array of restriction objects for the 'import/no-restricted-paths' rule.
 */
function buildLayerRestrictions() {
  /** @type {LayerRestriction[]} */
  const restrictions = [];

  /**
   * Adds a new restriction to the list.
   * @param {string} target - The target layer.
   * @param {string} from - The source layer that is forbidden.
   * @param {string} message - The message to display on violation.
   */
  const addRestriction = (target, from, message) => {
    restrictions.push({ target, from, message });
  };

  // errors: foundational leaf — cannot import any other layer
  const layersAboveErrors = [
    "primitives",
    "types",
    "spec",
    "plan",
    "backing",
    "handoff",
    "binding",
    "context",
  ];
  for (const layer of layersAboveErrors) {
    addRestriction(
      layers.errors,
      layers[layer],
      `errors must not import ${layer}`,
    );
  }

  // primitives: bottom layer — cannot import domain layers
  const layersAbovePrimitives = [
    "types",
    "spec",
    "plan",
    "backing",
    "handoff",
    "binding",
    "context",
  ];
  for (const layer of layersAbovePrimitives) {
    addRestriction(
      layers.primitives,
      layers[layer],
      `primitives must not import ${layer}`,
    );
  }

  // types: cannot import any domain layer or primitives/errors
  const layersAboveTypes = [
    "spec",
    "plan",
    "backing",
    "handoff",
    "binding",
    "errors",
    "primitives",
    "context",
  ];
  for (const layer of layersAboveTypes) {
    addRestriction(
      layers.types,
      layers[layer],
      `types must not import ${layer}`,
    );
  }

  // spec: cannot import layers above it
  for (const layer of ["plan", "backing", "handoff", "binding", "context"]) {
    addRestriction(layers.spec, layers[layer], `spec must not import ${layer}`);
  }

  // plan: above spec, below backing
  for (const layer of ["backing", "handoff", "binding", "context"]) {
    addRestriction(layers.plan, layers[layer], `plan must not import ${layer}`);
  }

  // backing: below handoff/binding/context
  for (const layer of ["handoff", "binding", "context"]) {
    addRestriction(
      layers.backing,
      layers[layer],
      `backing must not import ${layer}`,
    );
  }

  // handoff: cannot import binding
  addRestriction(
    layers.handoff,
    layers.binding,
    "handoff must not import binding",
  );

  // context: host ergonomics over spec/plan/backing; cannot import higher layers
  for (const layer of ["handoff", "binding", "diagnostics"]) {
    addRestriction(
      layers.context,
      layers[layer],
      `context must not import ${layer}`,
    );
  }

  // Prevent imports from central type files (use domain-owned types instead)
  const centralTypeFiles = [
    {
      file: "src/types/backing.ts",
      domain: "src/backing/types.ts",
    },
    {
      file: "src/types/binding.ts",
      domain: "src/binding/types.ts",
    },
    {
      file: "src/types/spec.ts",
      domain: "src/spec/types.ts",
    },
    {
      file: "src/types/plan.ts",
      domain: "src/plan/types.ts",
    },
    {
      file: "src/types/handoff.ts",
      domain: "src/handoff/types.ts",
    },
    {
      file: "src/types/errors.ts",
      domain: "src/errors/types.ts",
    },
  ];

  for (const { file, domain } of centralTypeFiles) {
    addRestriction("src", file, `Import from ${domain}`);
  }

  // diagnostics: outermost leaf — production core layers cannot import it,
  // EXCEPT binding, which is allowed to bump counters on slow/error paths.
  const productionLayersExceptBinding = [
    "primitives",
    "errors",
    "types",
    "spec",
    "plan",
    "backing",
    "handoff",
    "context",
  ];
  for (const layer of productionLayersExceptBinding) {
    addRestriction(
      layers[layer],
      layers.diagnostics,
      `${layer} must not import diagnostics`,
    );
  }

  return restrictions;
}

/**
 * Base ESLint rules for code hygiene, TypeScript, and import organization.
 * @type {import('eslint').Linter.RulesRecord}
 */
const baseRules = {
  // Code hygiene
  curly: ["error", "all"],
  eqeqeq: ["error", "smart"],
  "no-var": "error",
  "prefer-const": ["error", { destructuring: "all" }],
  "no-console": "warn",

  // TypeScript
  "@typescript-eslint/consistent-type-imports": [
    "error",
    { fixStyle: "inline-type-imports" },
  ],
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-unused-vars": [
    "warn",
    {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      ignoreRestSiblings: true,
    },
  ],
  "@typescript-eslint/no-non-null-assertion": "error",
  "@typescript-eslint/no-unsafe-function-type": "error",
  "@typescript-eslint/ban-ts-comment": [
    "error",
    {
      "ts-expect-error": "allow-with-description",
      "ts-ignore": true,
      "ts-nocheck": true,
      "ts-check": false,
      minimumDescriptionLength: 3,
    },
  ],

  // Import ordering and organization
  "import/order": [
    "error",
    {
      groups: [
        "builtin",
        "external",
        "internal",
        ["parent", "sibling", "index"],
        "object",
        "type",
      ],
      "newlines-between": "always",
      alphabetize: { order: "asc", caseInsensitive: true },
    },
  ],
  "import/no-duplicates": "error",
  "import/newline-after-import": "error",
  "import/extensions": [
    "error",
    "never",
    { ts: "never", tsx: "never", js: "never", jsx: "never" },
  ],
  "import/no-extraneous-dependencies": [
    "error",
    {
      devDependencies: true,
      optionalDependencies: false,
      peerDependencies: true,
      packageDir: [HERE, REPO_ROOT],
    },
  ],
  "import/no-cycle": ["error", { maxDepth: 2 }],
  "import/no-restricted-paths": ["error", { zones: buildLayerRestrictions() }],
};

/**
 * Rules for banning specific string patterns in the codebase using regex.
 * @type {import('eslint').Linter.RulesRecord}
 */
const regexRules = {
  "regex/invalid": [
    "error",
    [
      {
        id: "no-blanket-type-barrels",
        message:
          "Do not blanket re-export types; import from the owning domain.",
        regex: String.raw`^\s*export\s+type\s+\*\s+from\s+['"]\./types['"];`,
        regexOptions: "m",
      },
      {
        id: "no-fence-singleline",
        message: "Avoid fence-style section headers; prefer concise JSDoc.",
        regex: String.raw`^\s*//\s*([=\-*_/\u2500-\u257F\u23AF\u2013\u2014\u2015\u2212])\1{3,}.*$`,
        regexOptions: "u",
      },
      {
        id: "no-fence-block-start",
        message: "Avoid banner block comment starts.",
        regex: String.raw`^\s*/\*+\s*([=\-*_/\u2500-\u257F\u23AF\u2013\u2014\u2015\u2212])\1{3,}.*$`,
        regexOptions: "u",
      },
      {
        id: "no-fence-block-line",
        message: "Avoid banner lines inside block comments.",
        regex: String.raw`^\s*\*\s*([=\-*_/\u2500-\u257F\u23AF\u2013\u2014\u2015\u2212])\1{3,}\s*(?:\*/)?\s*$`,
        regexOptions: "u",
      },
      {
        id: "no-fence-one-line-block",
        message: "Avoid one-line banner comments.",
        regex: String.raw`^\s*/\*+\s*([=\-*_/\u2500-\u257F\u23AF\u2013\u2014\u2015\u2212])\1{3,}\s*\*+/\s*$`,
        regexOptions: "u",
      },
    ],
  ],
};

/**
 * The main ESLint configuration exported as a flat config array.
 * @type {import('typescript-eslint').Config}
 */
export default tseslint.config(
  { ignores: paths.ignores },

  // Apply strict and stylistic type-checking rules to all TypeScript files.
  ...tseslint.configs.strictTypeChecked.map((c) => ({
    ...c,
    files: paths.allTs,
  })),

  ...tseslint.configs.stylisticTypeChecked.map((c) => ({
    ...c,
    files: paths.allTs,
  })),

  // Apply recommended import plugin rules.
  ...[
    importPlugin.flatConfigs.recommended,
    importPlugin.flatConfigs.typescript,
  ].map((c) => ({
    ...c,
    files: paths.allTs,
  })),

  // Base configuration for the project.
  {
    name: "seqlok/base",
    files: paths.allTs,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ["./tsconfig.eslint.json"],
        tsconfigRootDir: HERE,
      },
      ecmaVersion: "latest",
      sourceType: "module",
    },
    settings: {
      "import/resolver": {
        typescript: {
          project: ["./tsconfig.json"],
          alwaysTryTypes: true,
        },
        node: {
          extensions: [".ts", ".tsx", ".js", ".jsx"],
        },
      },
      "import/ignore": ["\\?url$", "^virtual:", "^vite(-client)?$"],
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: baseRules,
  },

  // Configuration overrides for tests and examples.
  {
    name: "seqlok/tests-and-examples",
    files: [...paths.tests, ...paths.examples],
    languageOptions: {
      globals: { ...globals.vitest },
    },
    rules: {
      "import/no-restricted-paths": "off", // Relax layer restrictions in tests.
    },
  },

  // Configuration for regular expression-based rules.
  {
    name: "seqlok/regex-bans",
    files: ["**/*.{ts,tsx,js,jsx}"],
    plugins: {
      // @ts-expect-error -- eslint-plugin-regex doesn't have flat config types yet
      regex: { rules: regex.rules },
    },
    rules: regexRules,
  },

  // Configuration for TypeScript declaration files (*.d.ts).
  {
    name: "seqlok/type-declarations",
    files: ["**/*.d.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: null, // No type-checking needed for d.ts files.
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  // Allow console logging in benches and scripts
  {
    files: ["bench/**/*.{ts,tsx}", "scripts/**/*.{ts,tsx}"],
    rules: {
      "no-console": "off",
    },
  },
);
