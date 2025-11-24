import type { UserConfig } from "@commitlint/types";
import { RuleConfigSeverity } from "@commitlint/types";

const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      RuleConfigSeverity.Error,
      "always",
      [
        "feat",
        "fix",
        "chore",
        "docs",
        "refactor",
        "test",
        "build",
        "ci",
        "perf",
        "style",
        "revert",
      ],
    ],
    "scope-empty": [RuleConfigSeverity.Disabled],
    "scope-enum": [RuleConfigSeverity.Disabled],
    "scope-case": [RuleConfigSeverity.Disabled],
    "subject-empty": [RuleConfigSeverity.Disabled],
    "subject-case": [RuleConfigSeverity.Disabled],
    "type-case": [RuleConfigSeverity.Disabled],
    "header-max-length": [RuleConfigSeverity.Disabled],
    "header-full-stop": [RuleConfigSeverity.Disabled],
  },
};

export default config;
