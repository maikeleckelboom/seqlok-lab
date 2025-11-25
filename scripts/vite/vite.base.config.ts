import { defineConfig, type UserConfig } from "vite";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export type ViteLibConfigOptions = {
  entryRelative: string;
};

export function createLibraryViteConfig(
  importMetaUrl: string,
  { entryRelative }: ViteLibConfigOptions,
): UserConfig {
  const pkgRoot = dirname(fileURLToPath(importMetaUrl));

  return defineConfig({
    build: {
      lib: {
        entry: resolve(pkgRoot, entryRelative),
        formats: ["es"],
        fileName: () => "index.js",
      },
      sourcemap: true,
      target: "es2022",
      rollupOptions: {
        external: (id: string): boolean =>
          !id.startsWith(".") && !id.startsWith("/"),
      },
    },
    resolve: {
      conditions: ["source", "import", "module", "browser", "default"],
    },
  });
}
