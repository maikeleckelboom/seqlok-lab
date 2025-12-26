import dts from "rollup-plugin-dts";

const external: readonly string[] = [];

export default [
  {
    input: "src/index.ts",
    output: { file: "dist/index.d.ts", format: "es" },
    external,
    plugins: [
      dts({
        tsconfig: "tsconfig.json",
        respectExternal: true,
      }),
    ],
  },
  {
    input: "src/protocol/index.ts",
    output: { file: "dist/protocol.d.ts", format: "es" },
    external,
    plugins: [
      dts({
        tsconfig: "tsconfig.json",
        respectExternal: true,
      }),
    ],
  },
  {
    input: "src/mount/index.ts",
    output: { file: "dist/mount.d.ts", format: "es" },
    external,
    plugins: [
      dts({
        tsconfig: "tsconfig.json",
        respectExternal: true,
      }),
    ],
  },
  {
    input: "src/kernel/index.ts",
    output: { file: "dist/kernel.d.ts", format: "es" },
    external,
    plugins: [
      dts({
        tsconfig: "tsconfig.json",
        respectExternal: true,
      }),
    ],
  },
];
