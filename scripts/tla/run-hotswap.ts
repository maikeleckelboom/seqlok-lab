import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

type HotswapMode = "invonly" | "full";

const TOOLS_JAR = resolve("tools/tla/tla2tools.jar");

// Centralize the TLA directory for hotswap
const HOTSWAP_TLA_DIR = resolve("packages", "hotswap", "docs", "formal", "tla");

// Spec now lives under docs/formal/tla
const SPEC_PATH = resolve(HOTSWAP_TLA_DIR, "HotSwapProtocol.tla");

function getConfigPath(mode: HotswapMode): string {
  if (mode === "full") {
    // Full config under docs/formal/tla
    return resolve(HOTSWAP_TLA_DIR, "HotSwapProtocol.cfg");
  }

  // Invariants-only config under docs/formal/tla
  return resolve(HOTSWAP_TLA_DIR, "HotSwapProtocol.invonly.cfg");
}

interface ParsedArgs {
  mode: HotswapMode;
  extraTlcArgs: string[];
}

function parseArgs(argv: string[]): ParsedArgs {
  const [, , rawMode, ...rest] = argv;

  if (rawMode !== "full" && rawMode !== "invonly") {
    console.log(
      `Unknown mode "${rawMode ?? ""}". Supported modes are "invonly" and "full".`,
    );
    console.log("Examples");
    console.log("  pnpm tla:hotswap");
    console.log("  pnpm tla:hotswap:full");
    console.log("  pnpm tla:hotswap:full -- -nowarning");

    process.exitCode = 1;
    process.exit(1);
  }

  return {
    mode: rawMode,
    extraTlcArgs: rest,
  };
}

function ensureToolsJar(): void {
  if (existsSync(TOOLS_JAR)) {
    return;
  }

  console.error(
    `Missing tla2tools.jar at ${TOOLS_JAR}. Run "pnpm tla:fetch" first.`,
  );
  process.exitCode = 1;
  process.exit(1);
}

function runTlc(mode: HotswapMode, extraTlcArgs: string[]): void {
  ensureToolsJar();

  const configPath = getConfigPath(mode);

  const javaArgs = [
    "-XX:+UseParallelGC",
    "-cp",
    TOOLS_JAR,
    "tlc2.TLC",
    ...extraTlcArgs,
    "-workers",
    "4",
    "-config",
    configPath,
    SPEC_PATH,
  ];

  console.log(`Running TLC for HotSwapProtocol in mode "${mode}" with config`);
  console.log(`  ${configPath}`);
  if (extraTlcArgs.length > 0) {
    console.log("Extra TLC args", extraTlcArgs.join(" "));
  }

  const child = spawn("java", javaArgs, {
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      console.error(`TLC exited due to signal ${signal}`);
      process.exitCode = 1;
      return;
    }

    process.exitCode = code ?? 1;
  });
}

function main(): void {
  const { mode, extraTlcArgs } = parseArgs(process.argv);
  runTlc(mode, extraTlcArgs);
}

main();
