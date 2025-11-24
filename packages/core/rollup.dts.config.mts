import dts from "rollup-plugin-dts";

export default [
  {
    // Main public API declarations
    input: "src/index.ts",
    output: {
      file: "dist/index.d.ts",
      format: "es",
    },
    plugins: [
      dts({
        tsconfig: "tsconfig.build.json",
      }),
    ],
  },
  {
    // Diagnostics entrypoint
    input: "src/diagnostics.ts",
    output: {
      file: "dist/diagnostics.d.ts",
      format: "es",
    },
    plugins: [
      dts({
        tsconfig: "tsconfig.build.json",
      }),
    ],
  },
];
