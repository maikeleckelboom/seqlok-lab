import { createLibraryViteConfig } from "../../scripts/vite/vite.base.config";

import type { UserConfig } from "vite";

const config: UserConfig = createLibraryViteConfig(import.meta.url, {
  entryRelative: "src/index.ts",
});

export default config;
