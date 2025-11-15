import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

export default defineConfig(({ mode }) => ({
  define: {
    __SEQLOK_DEV_ASSERTS__: mode === 'development' ? 'true' : 'false',
  },
  build: {
    lib: {
      entry: 'src/index.ts',
      fileName: 'index',
      formats: ['es'],
    },
    rollupOptions: {
      output: {
        hoistTransitiveImports: false,
        inlineDynamicImports: true,
      },
    },
    sourcemap: false,
    emptyOutDir: true,
    outDir: 'dist',
  },
  plugins: [
    dts({
      entryRoot: 'src',
      tsconfigPath: './tsconfig.build.json',
      outDir: 'dist',
      insertTypesEntry: true,
      // Bundle all types into single declaration file
      rollupTypes: true,
      // Ensure proper compilation
      compilerOptions: {
        declaration: true,
        emitDeclarationOnly: true,
        noEmit: false,
      },
      exclude: [
        'tests/**/*',
        'examples/**/*',
        '**/*.test.ts',
        '**/*.spec.ts',
        'vite.config.ts',
        'vitest.config.ts',
      ],
    }),
  ],
}));
