/**
 * @file Vite build configuration for @seqlok/schema.
 */

import { createLibraryViteConfig } from "../../scripts/vite/vite.base.config";

export default createLibraryViteConfig({
  entryRelative: "src/index.ts",
  external: [],
});
