import coreConfig from "./packages/core/eslint.config.js";

export default coreConfig.map((block) => {
  if (!block) return block;
  if (!("files" in block) || !block.files) return block;

  const prefix = (p) =>
    p.startsWith("packages/core/") ? p : `packages/core/${p}`;
  return { ...block, files: block.files.map(prefix) };
});
