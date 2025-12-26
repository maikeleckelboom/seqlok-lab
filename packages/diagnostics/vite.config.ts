/**
 * @file Vite build configuration for @seqlok/diagnostics.
 */

import { createLibraryViteConfig } from "../../scripts/vite/vite.base.config";

export default createLibraryViteConfig({
  entryRelative: "src/index.ts",
  external: ["@seqlok/base", "@seqlok/primitives"],
});
