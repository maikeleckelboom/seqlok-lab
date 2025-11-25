import coreConfig from "./packages/core/eslint.config.js";
import hotswapConfig from "./packages/hotswap/eslint.config.js";
import foundationConfig from "./packages/foundation/eslint.config.js";
import primitivesConfig from "./packages/primitives/eslint.config.js";
import diagnosticsConfig from "./packages/diagnostics/eslint.config.js";
import commandsConfig from "./packages/commands/eslint.config.js";
import hostConfig from "./packages/host/eslint.config.js";

function prefixPackage(blocks, pkgRoot) {
  return blocks.map((block) => {
    if (!block) return block;
    if (!("files" in block) || !block.files) return block;

    const prefix = (pattern) =>
      pattern.startsWith(`${pkgRoot}/`) ? pattern : `${pkgRoot}/${pattern}`;

    return {
      ...block,
      files: block.files.map(prefix),
    };
  });
}

export default [
  ...prefixPackage(coreConfig, "packages/core"),
  ...prefixPackage(hotswapConfig, "packages/hotswap"),
  ...prefixPackage(foundationConfig, "packages/foundation"),
  ...prefixPackage(primitivesConfig, "packages/primitives"),
  ...prefixPackage(diagnosticsConfig, "packages/diagnostics"),
  ...prefixPackage(commandsConfig, "packages/commands"),
  ...prefixPackage(hostConfig, "packages/host"),
];
