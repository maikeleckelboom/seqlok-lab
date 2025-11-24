import { defineConfig } from "vite";

export default defineConfig(({ mode }) => ({
  define: {
    __SEQLOK_DEV_ASSERTS__: mode === "development" ? "true" : "false",
  },
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        diagnostics: "src/diagnostics.ts",
      },
      formats: ["es"],
      fileName: (_format, entry) => `${entry}.js`,
    },
    minify: "esbuild",
    sourcemap: true,
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        preserveModules: false,
      },
    },
  },
  esbuild: {
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
    legalComments: "none",
  },
}));
