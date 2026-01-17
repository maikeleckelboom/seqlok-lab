/* eslint-disable no-console */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { ALL_PLANES, BYTES_PER_ELEM, type PlaneKey } from "@seqlok/primitives";
import {
  listMeterKinds,
  listParamKinds,
  METER_KIND_CATALOG,
  PARAM_KIND_CATALOG,
} from "../../packages/core/src/spec/kinds";
import {
  formatNotesBulk,
  type NotesMode,
  type LegendEntry,
} from "./notes-formatter";

// CONSTANTS

const NOTES_COL_MAX = 56;

// TYPES

type EnvSupport = Readonly<{
  sharedArrayBuffer: boolean;
  atomics: boolean;
  wasmSharedMemory: boolean;
  backingsAvailable: readonly string[];
}>;

type ImplSupport = Readonly<{
  planes: readonly PlaneKey[];
  paramKinds: readonly string[];
  meterKinds: readonly string[];
}>;

type SpecSupport = Readonly<{
  paramKinds: readonly string[];
  meterKinds: readonly string[];
}>;

type RoadmapStatus = "planned" | "deferred" | "tbd";
type DocStatus = "enabled" | RoadmapStatus;
type StatusType = "enabled" | "spec-only" | "roadmap" | RoadmapStatus;

type RoadmapPlane = Readonly<{
  plane: string;
  group: string;
  view: string;
  status: RoadmapStatus;
  note: string;
}>;

type RoadmapKind = Readonly<{
  cat: "param" | "meter";
  kind: string;
  view: string;
  requiredPlane: string;
  status: RoadmapStatus;
  note: string;
}>;

type RoadmapSupport = Readonly<{
  planes: readonly RoadmapPlane[];
  kinds: readonly RoadmapKind[];
  parseWarnings: readonly string[];
}>;

type GateAnalysis = Readonly<{
  gate: "needs plane" | "catalog disabled" | "no roadmap entry";
  cat: "param" | "meter";
  kind: string;
  requiredPlane: string;
  roadmapStatus: "has entry" | "no entry";
}>;

type AnalysisResult = Readonly<{
  missingSpecParamKinds: readonly string[];
  missingSpecMeterKinds: readonly string[];
  gateAnalysis: readonly GateAnalysis[];
  legend: readonly LegendEntry[];
}>;

type SupportReport = Readonly<{
  env: EnvSupport;
  impl: ImplSupport;
  spec: SpecSupport;
  roadmap: RoadmapSupport;
  analysis: AnalysisResult;
  meta: Readonly<{
    nodeVersion: string;
    colorEnabled: boolean;
  }>;
}>;

// UTILITIES

type ColorFn = (s: string) => string;
type Style = Readonly<{
  dim: ColorFn;
  bold: ColorFn;
  green: ColorFn;
  red: ColorFn;
  yellow: ColorFn;
  cyan: ColorFn;
  gray: ColorFn;
}>;

function isColorEnabled(): boolean {
  if (process.env.NO_COLOR !== undefined) return false;
  if (!process.stdout.isTTY) return false;
  const fc = process.env.FORCE_COLOR;
  if (fc === "0") return false;
  if (fc && fc !== "0") return true;
  return true;
}

function makeStyle(enabled: boolean): Style {
  const wrap =
    (open: string, close: string): ColorFn =>
    (s: string) =>
      enabled ? `${open}${s}${close}` : s;

  const dim = wrap("\u001b[2m", "\u001b[22m");
  const bold = wrap("\u001b[1m", "\u001b[22m");
  const green = wrap("\u001b[32m", "\u001b[39m");
  const red = wrap("\u001b[31m", "\u001b[39m");
  const yellow = wrap("\u001b[33m", "\u001b[39m");
  const cyan = wrap("\u001b[36m", "\u001b[39m");
  const gray = wrap("\u001b[90m", "\u001b[39m");
  return { dim, bold, green, red, yellow, cyan, gray };
}

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;]*m/g, "");
}

function visibleWidth(s: string): number {
  return Array.from(stripAnsi(s)).length;
}

function padRight(s: string, width: number): string {
  const w = visibleWidth(s);
  if (w >= width) return s;
  return s + " ".repeat(width - w);
}

function clampNote(note: string): string {
  if (note.length <= NOTES_COL_MAX) return note;
  return note.slice(0, NOTES_COL_MAX - 3) + "...";
}

function keysOf<T extends Record<string, unknown>>(obj: T): string[] {
  return Object.keys(obj).sort((a, b) => a.localeCompare(b));
}

function planeViewName(plane: PlaneKey): string {
  const viewMap: Record<PlaneKey, string> = {
    PF32: "Float32Array",
    MF32: "Float32Array",
    MF64: "Float64Array",
    PI32: "Int32Array",
    PB: "Uint8Array",
    PU: "Uint32Array",
    MU32: "Uint32Array",
    MU: "Uint32Array",
  };
  return viewMap[plane];
}

function planeRole(plane: PlaneKey): string {
  if (plane === "PU") return "param lock (seqlock)";
  if (plane === "MU") return "meter lock (seqlock)";
  if (plane.startsWith("P")) return "param data";
  if (plane.startsWith("M")) return "meter data";
  return "unknown";
}

function detectRuntimeSupport(): EnvSupport {
  const sharedArrayBuffer = typeof globalThis.SharedArrayBuffer === "function";
  const atomics = typeof globalThis.Atomics === "object";

  let wasmSharedMemory: boolean;
  try {
    new WebAssembly.Memory({ initial: 1, maximum: 1, shared: true });
    wasmSharedMemory = true;
  } catch {
    wasmSharedMemory = false;
  }

  const backingsAvailable = [
    sharedArrayBuffer && atomics && "shared",
    sharedArrayBuffer && atomics && "shared-partitioned",
    wasmSharedMemory && atomics && "wasm-shared",
  ].filter(Boolean) as string[];

  return { sharedArrayBuffer, atomics, wasmSharedMemory, backingsAvailable };
}

// ROADMAP PARSING

type DocDomain = "param" | "meter" | null;
type ParsedMdTable = Readonly<{
  headers: string[];
  rows: string[][];
  domain: DocDomain;
}>;

function cleanCell(raw: string): string {
  const s = raw.trim();
  const unbackticked =
    s.startsWith("`") && s.endsWith("`") && s.length >= 2 ? s.slice(1, -1) : s;
  return unbackticked.trim();
}

function findBacktickedPlaneHint(text: string): string | null {
  const m = /`([PM]\d+)`/i.exec(text);
  return m ? m[1]!.toUpperCase() : null;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseMarkdownTables(md: string): ParsedMdTable[] {
  const lines = md.split(/\r?\n/);
  const tables: ParsedMdTable[] = [];
  let currentDomain: DocDomain = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";

    const h2 = /^##\s+(.+)$/.exec(line);
    if (h2) {
      const name = (h2[1] ?? "").toLowerCase();
      if (name.includes("param kinds")) currentDomain = "param";
      else if (name.includes("meter kinds")) currentDomain = "meter";
      continue;
    }

    if (!line.includes("|")) continue;

    const headerCells = splitMdRow(line);
    if (headerCells.length < 2) continue;

    const sep = lines[i + 1] ?? "";
    if (!isMdSeparatorRow(sep)) continue;

    const headers = headerCells
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (headers.length < 2) continue;

    const rows: string[][] = [];
    let j = i + 2;
    for (; j < lines.length; j += 1) {
      const rline = lines[j] ?? "";
      if (!rline.includes("|")) break;
      const cells = splitMdRow(rline).map((c) => c.trim());
      if (cells.every((c) => c === "")) break;
      rows.push(cells);
    }

    if (rows.length > 0) tables.push({ headers, rows, domain: currentDomain });
    i = j - 1;
  }

  return tables;
}

function splitMdRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((s) => s.trim());
}

function isMdSeparatorRow(line: string): boolean {
  const cells = splitMdRow(line);
  if (cells.length < 2) return false;
  return cells.every((c) => /^:?-{3,}:?$/.test(c.trim()));
}

function asRoadmapStatus(raw: string): RoadmapStatus | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("planned") || s.includes("⏳")) return "planned";
  if (s.includes("deferred") || s.includes("💤")) return "deferred";
  if (s.includes("tbd") || s.includes("🧪") || s.includes("todo")) return "tbd";
  return null;
}

function asDocStatus(raw: string): DocStatus | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("✅") || s.includes("enabled")) return "enabled";
  return asRoadmapStatus(raw);
}

function parseRoadmapFromMarkdown(md: string): RoadmapSupport {
  const tables = parseMarkdownTables(md);
  const warnings: string[] = [];
  const planes: RoadmapPlane[] = [];
  const kinds: RoadmapKind[] = [];

  for (const t of tables) {
    const h = t.headers.map(normalizeHeader);
    const hasPlane = h.includes("plane");
    const hasKind = h.includes("kind");
    const hasCat = h.includes("cat") || h.includes("category");
    const hasStatus = h.includes("status");

    if (hasPlane && hasStatus) {
      parsePlanesTable(t, h, planes, warnings);
    } else if (hasKind && hasStatus && (hasCat || t.domain !== null)) {
      parseKindsTable(t, h, kinds, warnings);
    }
  }

  if (planes.length === 0) {
    warnings.push(
      `No roadmap planes table parsed. Expected a markdown table with headers: Plane | Group | View | Status | Notes`,
    );
  }
  if (kinds.length === 0) {
    warnings.push(
      `No roadmap kinds table parsed. (Doc tables often omit Cat, script expects tables under "## Param Kinds" or "## Meter Kinds" with Kind/Status/JS View columns.)`,
    );
  }

  return { planes, kinds, parseWarnings: warnings };
}

function parsePlanesTable(
  t: ParsedMdTable,
  h: string[],
  planes: RoadmapPlane[],
  warnings: string[],
): void {
  const idxPlane = h.indexOf("plane");
  const idxGroup = h.indexOf("group") >= 0 ? h.indexOf("group") : -1;
  const idxView = h.indexOf("view") >= 0 ? h.indexOf("view") : -1;
  const idxStatus = h.indexOf("status");
  const idxNotes = findHeaderIndex(h, ["notes", "note", "purpose"]);

  for (const r of t.rows) {
    const plane = cleanCell(r[idxPlane] ?? "");
    if (!plane) continue;

    const rawStatus = (r[idxStatus] ?? "").trim();
    const parsed = asRoadmapStatus(rawStatus);
    const status: RoadmapStatus = parsed ?? "tbd";
    if (!parsed) {
      warnings.push(
        `Roadmap planes: unknown status "${rawStatus}" for plane "${plane}" (defaulted to tbd)`,
      );
    }

    const inferredGroup = plane.startsWith("P")
      ? "Params"
      : plane.startsWith("M")
        ? "Meters"
        : "—";

    planes.push({
      plane,
      group:
        cleanCell(idxGroup >= 0 ? (r[idxGroup] ?? "") : inferredGroup) ||
        inferredGroup,
      view: cleanCell(idxView >= 0 ? (r[idxView] ?? "") : "") || "—",
      status,
      note: cleanCell(idxNotes >= 0 ? (r[idxNotes] ?? "") : "") || "",
    });
  }
}

function parseKindsTable(
  t: ParsedMdTable,
  h: string[],
  kinds: RoadmapKind[],
  warnings: string[],
): void {
  const idxCat = h.includes("cat")
    ? h.indexOf("cat")
    : h.includes("category")
      ? h.indexOf("category")
      : -1;
  const idxKind = h.indexOf("kind");
  const idxView = findHeaderIndex(h, ["js view", "view"]);
  const idxNeeds = findHeaderIndex(h, ["needs plane", "needs", "plane"]);
  const idxStatus = h.indexOf("status");
  const idxNotes = findHeaderIndex(h, ["notes", "note"]);

  for (const r of t.rows) {
    const rawCat = idxCat >= 0 ? cleanCell(r[idxCat] ?? "").toLowerCase() : "";
    const cat: "param" | "meter" =
      rawCat === "param" || rawCat === "meter"
        ? (rawCat as "param" | "meter")
        : t.domain === "param" || t.domain === "meter"
          ? t.domain
          : "param";

    const kind = cleanCell(r[idxKind] ?? "");
    if (!kind) continue;

    const rawStatus = (r[idxStatus] ?? "").trim();
    const parsed = asDocStatus(rawStatus);
    if (parsed === "enabled") continue;

    const status = (parsed ?? "tbd") as RoadmapStatus;
    if (!parsed) {
      warnings.push(
        `Roadmap kinds: unknown status "${rawStatus}" for kind "${cat}:${kind}" (defaulted to tbd)`,
      );
    }

    const requiredPlaneCell = idxNeeds >= 0 ? cleanCell(r[idxNeeds] ?? "") : "";
    const rowText = r.map((c) => String(c ?? "")).join(" | ");
    const hinted = findBacktickedPlaneHint(rowText);
    const requiredPlane = requiredPlaneCell || hinted || "—";

    kinds.push({
      cat,
      kind,
      view: cleanCell(idxView >= 0 ? (r[idxView] ?? "") : "") || "—",
      requiredPlane,
      status,
      note: cleanCell(idxNotes >= 0 ? (r[idxNotes] ?? "") : "") || "",
    });
  }
}

function findHeaderIndex(headers: string[], options: string[]): number {
  for (const option of options) {
    const idx = headers.indexOf(option);
    if (idx >= 0) return idx;
  }
  return -1;
}

// STATUS BADGE

function statusBadge(status: StatusType, s: Style): string {
  const badgeMap: Record<StatusType, (text: string) => string> = {
    enabled: s.green,
    "spec-only": s.yellow,
    roadmap: s.gray,
    planned: s.yellow,
    deferred: s.gray,
    tbd: s.cyan,
  };
  const textMap: Record<StatusType, string> = {
    enabled: "ENABLED",
    "spec-only": "SPEC-ONLY",
    roadmap: "ROADMAP",
    planned: "PLANNED",
    deferred: "DEFERRED",
    tbd: "TBD",
  };
  return badgeMap[status](textMap[status]);
}

// CLI PARSING

type OutputMode = "full" | "compact";

type CliFlags = {
  mode: OutputMode;
  notes: NotesMode;
  json: boolean;
  help: boolean;
};

function parseArgs(): CliFlags {
  const args = process.argv.slice(2);
  const flags: CliFlags = {
    mode: "full",
    notes: "legend",
    json: false,
    help: false,
  };

  let compactSpecified = false;
  let fullSpecified = false;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
    } else if (arg === "--compact") {
      flags.mode = "compact";
      compactSpecified = true;
    } else if (arg === "--full") {
      flags.mode = "full";
      fullSpecified = true;
    } else if (arg === "--json") {
      flags.json = true;
    } else if (arg.startsWith("--notes=")) {
      const value = arg.slice("--notes=".length);
      if (value === "legend" || value === "short" || value === "full") {
        flags.notes = value;
      } else {
        console.error(
          `Unknown --notes mode: ${value}. Use: legend, short, or full`,
        );
        process.exit(1);
      }
    } else if (arg.startsWith("-")) {
      console.error(`Unknown flag: ${arg}`);
      console.error("Use --help for usage");
      process.exit(1);
    }
  }

  if (compactSpecified && fullSpecified) {
    console.error("Cannot specify both --compact and --full");
    console.error("Use --help for usage");
    process.exit(1);
  }

  return flags;
}

function printHelp(): void {
  console.log(`Usage: pnpm support [flags]

Flags:
  --compact          Compact output (summary, backings, missing kinds by gate)
  --full             Full output (all tables) [default]
  --notes=<mode>     Notes formatting: legend, short, or full [default: legend]
  --json             Output as JSON (suppresses all other output)
  --help, -h         Show this help

Notes modes:
  legend             Replace markdown links with ref tokens (D1, D2, ...) + legend
  short              Strip markdown links, collapse whitespace
  full               Keep full note text but strip markdown links
`);
  process.exit(0);
}

// ANALYSIS

function analyzeGate(
  cat: "param" | "meter",
  kind: string,
  roadmap: RoadmapSupport,
  implPlanes: Set<string>,
  enabledParamSet: Set<string>,
  enabledMeterSet: Set<string>,
): GateAnalysis {
  const roadmapEntry = roadmap.kinds.find(
    (k) => k.cat === cat && k.kind === kind,
  );

  if (!roadmapEntry) {
    return {
      gate: "no roadmap entry",
      cat,
      kind,
      requiredPlane: "—",
      roadmapStatus: "no entry",
    };
  }

  const requiredPlane = roadmapEntry.requiredPlane;
  const planeIsImplemented =
    requiredPlane !== "—" && implPlanes.has(requiredPlane);

  if (requiredPlane !== "—" && !planeIsImplemented) {
    return {
      gate: "needs plane",
      cat,
      kind,
      requiredPlane,
      roadmapStatus: "has entry",
    };
  }

  const isEnabled =
    cat === "param" ? enabledParamSet.has(kind) : enabledMeterSet.has(kind);

  if (!isEnabled) {
    return {
      gate: "catalog disabled",
      cat,
      kind,
      requiredPlane,
      roadmapStatus: "has entry",
    };
  }

  // This should not be reached if logic is correct - all gates have passed
  throw new Error(`Unexpected case in analyzeGate for ${cat}:${kind}`);
}

function analyzeMissingKinds(
  spec: SpecSupport,
  impl: ImplSupport,
  roadmap: RoadmapSupport,
): AnalysisResult {
  // Precompute sets once for efficiency
  const implPlanesSet = new Set(impl.planes);
  const enabledParamSet = new Set(impl.paramKinds);
  const enabledMeterSet = new Set(impl.meterKinds);

  const missingSpecParamKinds = spec.paramKinds.filter(
    (k) => !enabledParamSet.has(k),
  );
  const missingSpecMeterKinds = spec.meterKinds.filter(
    (k) => !enabledMeterSet.has(k),
  );

  const gateAnalysis: GateAnalysis[] = [
    ...missingSpecParamKinds.map((kind) =>
      analyzeGate(
        "param",
        kind,
        roadmap,
        implPlanesSet,
        enabledParamSet,
        enabledMeterSet,
      ),
    ),
    ...missingSpecMeterKinds.map((kind) =>
      analyzeGate(
        "meter",
        kind,
        roadmap,
        implPlanesSet,
        enabledParamSet,
        enabledMeterSet,
      ),
    ),
  ].sort((a, b) => {
    const gateOrder = {
      "needs plane": 0,
      "catalog disabled": 1,
      "no roadmap entry": 2,
    };
    const gateCmp = (gateOrder[a.gate] ?? 99) - (gateOrder[b.gate] ?? 99);
    if (gateCmp !== 0) return gateCmp;
    const catCmp = a.cat.localeCompare(b.cat);
    if (catCmp !== 0) return catCmp;
    return a.kind.localeCompare(b.kind);
  });

  return {
    missingSpecParamKinds,
    missingSpecMeterKinds,
    gateAnalysis,
    legend: [],
  };
}

// BUILD MODEL

function buildSupportReport(): SupportReport {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const repoRoot = path.resolve(__dirname, "../../");

  const env = detectRuntimeSupport();

  const impl: ImplSupport = {
    planes: ALL_PLANES,
    paramKinds: keysOf(PARAM_KIND_CATALOG as Record<string, unknown>),
    meterKinds: keysOf(METER_KIND_CATALOG as Record<string, unknown>),
  };

  const spec: SpecSupport = {
    paramKinds: [...listParamKinds()],
    meterKinds: [...listMeterKinds()],
  };

  const roadmapPath = path.join(
    repoRoot,
    "packages",
    "core",
    "docs",
    "spec",
    "seqlok-planes-reference.md",
  );
  const roadmapText = fs.existsSync(roadmapPath)
    ? fs.readFileSync(roadmapPath, "utf8")
    : "";
  const roadmap = roadmapText
    ? parseRoadmapFromMarkdown(roadmapText)
    : { planes: [], kinds: [], parseWarnings: [] };

  const analysis = analyzeMissingKinds(spec, impl, roadmap);

  return {
    env,
    impl,
    spec,
    roadmap,
    analysis,
    meta: {
      nodeVersion: process.version,
      colorEnabled: isColorEnabled(),
    },
  };
}

// RENDERING UTILITIES

type Table = Readonly<{
  title: string;
  headers: readonly string[];
  rows: readonly (readonly string[])[];
}>;

function renderRuleLine(label: string, value: string, s: Style): string {
  const k = padRight(s.gray(label), 22);
  return `${k} ${value}`;
}

function box(title: string, lines: readonly string[], s: Style): string {
  const content = [s.bold(title), ...lines];
  const w = Math.max(...content.map((x) => visibleWidth(x)));
  const top = `┌${"─".repeat(w + 2)}┐`;
  const bot = `└${"─".repeat(w + 2)}┘`;
  const out: string[] = [top];
  for (const line of content) out.push(`│ ${padRight(line, w)} │`);
  out.push(bot);
  return out.join("\n");
}

function renderTable(t: Table, s: Style): string {
  const colCount = t.headers.length;
  const widths: number[] = new Array(colCount).fill(0);

  const considerRow = (row: readonly string[]): void => {
    for (let i = 0; i < colCount; i += 1) {
      const cell = row[i] ?? "";
      widths[i] = Math.max(widths[i] ?? 0, visibleWidth(cell));
    }
  };

  considerRow(t.headers);
  for (const r of t.rows) considerRow(r);

  const top = "┌" + widths.map((w) => "─".repeat(w + 2)).join("┬") + "┐";
  const mid = "├" + widths.map((w) => "─".repeat(w + 2)).join("┼") + "┤";
  const bot = "└" + widths.map((w) => "─".repeat(w + 2)).join("┴") + "┘";

  const renderRow = (row: readonly string[]): string => {
    const cells = widths.map((w, i) => ` ${padRight(row[i] ?? "", w)} `);
    return "│" + cells.join("│") + "│";
  };

  const lines: string[] = [
    s.bold(t.title),
    top,
    renderRow(t.headers.map((h) => s.cyan(h))),
    mid,
    ...t.rows.map(renderRow),
    bot,
  ];
  return lines.join("\n");
}

function renderJson(report: SupportReport): string {
  const jsonOutput = {
    nodeVersion: report.meta.nodeVersion,
    colorEnabled: report.meta.colorEnabled,
    backingsAvailable: report.env.backingsAvailable,
    implementedPlanes: [...report.impl.planes].sort(),
    implementedParamKinds: [...report.impl.paramKinds].sort(),
    implementedMeterKinds: [...report.impl.meterKinds].sort(),
    specParamKinds: [...report.spec.paramKinds].sort(),
    specMeterKinds: [...report.spec.meterKinds].sort(),
    missingSpecParamKinds: [...report.analysis.missingSpecParamKinds].sort(),
    missingSpecMeterKinds: [...report.analysis.missingSpecMeterKinds].sort(),
    roadmap: {
      planes: report.roadmap.planes,
      kinds: report.roadmap.kinds,
      parseWarnings: report.roadmap.parseWarnings,
    },
    gateAnalysis: report.analysis.gateAnalysis,
    legend: report.analysis.legend,
  };
  return JSON.stringify(jsonOutput, null, 2);
}

// SHARED RENDERING COMPONENTS

function renderSummaryCard(report: SupportReport, s: Style): string {
  const declaredKnown =
    report.spec.paramKinds.length > 0 || report.spec.meterKinds.length > 0;

  const summaryLines: string[] = [
    renderRuleLine("Node", report.meta.nodeVersion, s),
    renderRuleLine(
      "TTY color",
      report.meta.colorEnabled ? s.green("on") : s.gray("off"),
      s,
    ),
    renderRuleLine(
      "Planes (impl)",
      `${report.impl.planes.length} total (${report.impl.planes.filter((p) => p.startsWith("P")).length} P / ${report.impl.planes.filter((p) => p.startsWith("M")).length} M)`,
      s,
    ),
    renderRuleLine(
      "ParamKinds (impl)",
      `${report.impl.paramKinds.length} enabled`,
      s,
    ),
    renderRuleLine(
      "MeterKinds (impl)",
      `${report.impl.meterKinds.length} enabled`,
      s,
    ),
    renderRuleLine(
      "Kinds (spec)",
      declaredKnown
        ? `${report.spec.paramKinds.length} param, ${report.spec.meterKinds.length} meter`
        : s.gray("unknown (not enumerable)"),
      s,
    ),
    renderRuleLine(
      "Roadmap planes",
      report.roadmap.planes.length
        ? `${report.roadmap.planes.length}`
        : s.gray("—"),
      s,
    ),
    renderRuleLine(
      "Roadmap kinds",
      report.roadmap.kinds.length
        ? `${report.roadmap.kinds.length}`
        : s.gray("—"),
      s,
    ),
    renderRuleLine(
      "Roadmap doc",
      report.roadmap.parseWarnings.length
        ? s.yellow(`WARN(${report.roadmap.parseWarnings.length})`)
        : s.green("OK"),
      s,
    ),
    renderRuleLine(
      "Backings (here)",
      report.env.backingsAvailable.length
        ? report.env.backingsAvailable.join(", ")
        : s.red("none"),
      s,
    ),
  ];

  return "\n" + box("Seqlok support matrix", summaryLines, s) + "\n";
}

function renderBackingsTable(report: SupportReport, s: Style): string {
  return renderTable(
    {
      title: "Backing kinds (runtime availability here)",
      headers: ["BackingKind", "Available", "Requires", "Notes"],
      rows: [
        [
          "shared",
          report.env.sharedArrayBuffer && report.env.atomics
            ? s.green("YES")
            : s.red("NO"),
          "SAB + Atomics",
          "Browser: requires COOP+COEP",
        ],
        [
          "shared-partitioned",
          report.env.sharedArrayBuffer && report.env.atomics
            ? s.green("YES")
            : s.red("NO"),
          "SAB + Atomics (1 SAB per plane)",
          "Browser: requires COOP+COEP",
        ],
        [
          "wasm-shared",
          report.env.wasmSharedMemory && report.env.atomics
            ? s.green("YES")
            : s.red("NO"),
          "Wasm shared + Atomics",
          "Browser: threads + COOP+COEP",
        ],
      ],
    },
    s,
  );
}

function renderPlanesTable(
  title: string,
  planes: readonly PlaneKey[],
  s: Style,
): string {
  const planeRow = (p: PlaneKey): string[] => {
    const bytes = BYTES_PER_ELEM[p];
    const view = planeViewName(p);
    const role = planeRole(p);
    const lock = p === "PU" || p === "MU";
    return [
      p,
      role,
      String(bytes),
      view,
      lock ? s.yellow("LOCK") : s.gray("DATA"),
    ];
  };

  return renderTable(
    {
      title,
      headers: ["Plane", "Role", "Bytes/elem", "View", "Notes"],
      rows: planes.map(planeRow),
    },
    s,
  );
}

function renderKindsTable(
  title: string,
  kinds: readonly string[],
  catalog: typeof PARAM_KIND_CATALOG | typeof METER_KIND_CATALOG,
  s: Style,
): string {
  const kindRows: string[][] = kinds.map((k) => {
    const entry = catalog[k as keyof typeof catalog];
    if (!entry)
      return [k, "UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN", "0", "-"];

    const bytes = BYTES_PER_ELEM[entry.plane as PlaneKey];
    return [
      k,
      entry.semantic,
      entry.isArray ? "array" : "scalar",
      entry.plane,
      planeViewName(entry.plane),
      String(bytes),
      entry.isArray ? String(entry.elem ?? "-") : "-",
    ];
  });

  return renderTable(
    {
      title,
      headers: [
        "Kind",
        "Semantic",
        "Shape",
        "Plane",
        "View",
        "Bytes/elem",
        "Elem",
      ],
      rows: kindRows,
    },
    s,
  );
}

function renderSpecNotEnabledTable(
  missingParamKinds: readonly string[],
  missingMeterKinds: readonly string[],
  s: Style,
): string {
  const specNotEnabledRows: string[][] = [
    ...missingParamKinds.map((k) => ["param", k, statusBadge("spec-only", s)]),
    ...missingMeterKinds.map((k) => ["meter", k, statusBadge("spec-only", s)]),
  ];

  return renderTable(
    {
      title: "Kinds — spec-defined but NOT enabled (planner rejects)",
      headers: ["Cat", "Kind", "Status"],
      rows: specNotEnabledRows.length
        ? specNotEnabledRows
        : [[s.gray("—"), s.gray("— none —"), s.gray("—")]],
    },
    s,
  );
}

function renderGateAnalysisTable(
  gateAnalysis: readonly GateAnalysis[],
  s: Style,
): string {
  const gateAnalysisRows: string[][] = gateAnalysis.map((g) => [
    g.gate,
    g.cat,
    g.kind,
    g.requiredPlane,
    g.roadmapStatus === "has entry" ? "has entry" : "no entry",
  ]);

  return renderTable(
    {
      title: "Kinds — missing (grouped by gate)",
      headers: ["Gate", "Cat", "Kind", "Needs plane", "Roadmap status"],
      rows: gateAnalysisRows,
    },
    s,
  );
}

function renderRoadmapPlanesTable(
  roadmap: RoadmapSupport,
  implPlanes: Set<string>,
  s: Style,
): string {
  const roadmapPlaneRows: string[][] = roadmap.planes.map((p) => {
    const present = implPlanes.has(p.plane as PlaneKey);
    const st = present ? statusBadge("enabled", s) : statusBadge(p.status, s);
    return [p.plane, p.group, p.view, st, clampNote(p.note)];
  });

  return renderTable(
    {
      title: "Planes — roadmap (from doc)",
      headers: ["Plane", "Group", "View", "Status", "Notes"],
      rows: roadmapPlaneRows.length
        ? roadmapPlaneRows
        : [[s.gray("—"), s.gray("—"), s.gray("—"), s.gray("—"), s.gray("—")]],
    },
    s,
  );
}

function renderRoadmapKindsTable(
  roadmap: RoadmapSupport,
  spec: SpecSupport,
  impl: ImplSupport,
  s: Style,
): string {
  const implParamSet = new Set(impl.paramKinds);
  const implMeterSet = new Set(impl.meterKinds);
  const specParamSet = new Set(spec.paramKinds);
  const specMeterSet = new Set(spec.meterKinds);

  function kindUniverseStatus(
    k: RoadmapKind,
  ): "enabled" | "spec-only" | "roadmap" {
    const declared =
      k.cat === "param" ? specParamSet.has(k.kind) : specMeterSet.has(k.kind);
    const enabled =
      k.cat === "param" ? implParamSet.has(k.kind) : implMeterSet.has(k.kind);
    if (enabled) return "enabled";
    if (declared) return "spec-only";
    return "roadmap";
  }

  const roadmapKindRows: string[][] = roadmap.kinds.map((k) => {
    const uni = kindUniverseStatus(k);
    const st =
      uni === "roadmap" ? statusBadge(k.status, s) : statusBadge(uni, s);
    return [k.cat, k.kind, k.view, k.requiredPlane, st, clampNote(k.note)];
  });

  return renderTable(
    {
      title: "Kinds — roadmap (from doc)",
      headers: ["Cat", "Kind", "JS View", "Needs plane", "Status", "Notes"],
      rows: roadmapKindRows.length
        ? roadmapKindRows
        : [
            [
              s.gray("—"),
              s.gray("—"),
              s.gray("—"),
              s.gray("—"),
              s.gray("—"),
              s.gray("—"),
            ],
          ],
    },
    s,
  );
}

function renderRules(s: Style): string {
  return s.dim(`Rules:
  • Planner accepts only kinds present in the kind catalogs.
  • Spec unions define what builders may express; catalogs define what actually works.
  • Spec kinds are enumerated via listParamKinds/listMeterKinds; TS unions are erased.
  • Roadmap doc is the authoritative wish-list; keep its tables machine-parseable.
  • PU/MU are internal seqlock lock planes (not user-facing value kinds).
`);
}

function renderCompactMissingKinds(
  gateAnalysis: readonly GateAnalysis[],
  s: Style,
): string {
  if (gateAnalysis.length === 0) return "";

  const byGate = new Map<
    string,
    Array<{ cat: "param" | "meter"; kind: string; plane?: string }>
  >();

  for (const g of gateAnalysis) {
    if (!byGate.has(g.gate)) byGate.set(g.gate, []);
    byGate.get(g.gate)!.push({
      cat: g.cat,
      kind: g.kind,
      plane: g.requiredPlane !== "—" ? g.requiredPlane : "N/A",
    });
  }

  const gateOrder: Array<
    "needs plane" | "catalog disabled" | "no roadmap entry"
  > = ["needs plane", "catalog disabled", "no roadmap entry"];

  let output = s.bold("Missing kinds (spec-only)\n\n");

  for (const gate of gateOrder) {
    const items = byGate.get(gate);
    if (!items?.length) continue;

    if (gate === "needs plane") {
      const byPlane = new Map<string, string[]>();
      for (const item of items) {
        const plane = item.plane ?? "—";
        if (!byPlane.has(plane)) byPlane.set(plane, []);
        byPlane.get(plane)!.push(`${item.cat} ${item.kind}`);
      }

      for (const [plane, kinds] of Array.from(byPlane.entries()).sort()) {
        output += `  ${s.cyan(`needs ${plane}:`)} ${kinds.sort().join(", ")}\n`;
      }
    } else {
      const kinds = items.map((i) => `${i.cat} ${i.kind}`).sort();
      const label =
        gate === "catalog disabled"
          ? s.yellow("catalog disabled:")
          : s.gray("no roadmap entry:");
      output += `  ${label} ${kinds.join(", ")}\n`;
    }
  }

  return output + "\n";
}

function processRoadmapNotes(
  roadmap: RoadmapSupport,
  notesMode: NotesMode,
): Readonly<{ roadmap: RoadmapSupport; legend: readonly LegendEntry[] }> {
  const allNotes = [
    ...roadmap.planes.map((p) => p.note),
    ...roadmap.kinds.map((k) => k.note),
  ];

  const { notes: formattedNotes, legend } = formatNotesBulk(
    allNotes,
    notesMode,
  );

  const processedRoadmap = {
    ...roadmap,
    planes: roadmap.planes.map((p, i) => ({
      ...p,
      note: formattedNotes[i] ?? "",
    })),
    kinds: roadmap.kinds.map((k, i) => ({
      ...k,
      note: formattedNotes[roadmap.planes.length + i] ?? "",
    })),
  };

  return { roadmap: processedRoadmap, legend };
}

function renderTextReport(
  report: SupportReport,
  flags: CliFlags,
  isCompact: boolean,
): string {
  const s = makeStyle(report.meta.colorEnabled);
  const { roadmap: processedRoadmap, legend } = processRoadmapNotes(
    report.roadmap,
    flags.notes,
  );

  let output = renderSummaryCard(report, s);
  output += renderBackingsTable(report, s) + "\n";

  if (!isCompact) {
    // Implemented planes
    const paramPlanes = report.impl.planes.filter(
      (p) => p.startsWith("P") || p === "PU",
    );
    const meterPlanes = report.impl.planes.filter(
      (p) => p.startsWith("M") || p === "MU",
    );

    output +=
      renderPlanesTable("Planes — implemented (Params)", paramPlanes, s) + "\n";
    output +=
      renderPlanesTable("Planes — implemented (Meters)", meterPlanes, s) + "\n";

    // Implemented kinds
    output +=
      renderKindsTable(
        `ParamKinds — implemented (${statusBadge("enabled", s)})`,
        report.impl.paramKinds,
        PARAM_KIND_CATALOG,
        s,
      ) + "\n";

    output +=
      renderKindsTable(
        `MeterKinds — implemented (${statusBadge("enabled", s)})`,
        report.impl.meterKinds,
        METER_KIND_CATALOG,
        s,
      ) + "\n";
  }

  // Spec-defined but not enabled
  const declaredKnown =
    report.spec.paramKinds.length > 0 || report.spec.meterKinds.length > 0;

  if (!isCompact && declaredKnown) {
    output +=
      renderSpecNotEnabledTable(
        report.analysis.missingSpecParamKinds,
        report.analysis.missingSpecMeterKinds,
        s,
      ) + "\n";
  }

  // Gate analysis
  if (declaredKnown && report.analysis.gateAnalysis.length > 0) {
    if (isCompact) {
      output += renderCompactMissingKinds(report.analysis.gateAnalysis, s);
    } else {
      output += renderGateAnalysisTable(report.analysis.gateAnalysis, s) + "\n";
    }
  }

  // Roadmap tables
  const unimplementedPlanes = processedRoadmap.planes.filter(
    (p) => !new Set(report.impl.planes).has(p.plane as PlaneKey),
  );
  const shouldShowRoadmap =
    !isCompact ||
    unimplementedPlanes.length > 0 ||
    report.analysis.gateAnalysis.some((g) => g.gate === "needs plane");

  if (shouldShowRoadmap) {
    if (processedRoadmap.parseWarnings.length) {
      output += s.dim(
        `Roadmap doc parsed with warnings (${processedRoadmap.parseWarnings.length}): packages/core/docs/spec/seqlok-planes-reference.md\n`,
      );
      for (const w of processedRoadmap.parseWarnings)
        output += s.dim(`  - ${w}\n`);
      output += "\n";
    }

    output +=
      renderRoadmapPlanesTable(
        processedRoadmap,
        new Set(report.impl.planes),
        s,
      ) + "\n";

    output +=
      renderRoadmapKindsTable(processedRoadmap, report.spec, report.impl, s) +
      "\n";

    // Legend
    if (legend.length > 0) {
      output += s.bold("Legend:\n");
      for (const entry of legend) {
        output += s.dim(
          `  ${entry.token}: ${entry.title} (${s.gray(entry.anchor)})\n`,
        );
      }
      output += "\n";
    }
  }

  output += renderRules(s) + "\n";
  return output;
}

// MAIN

function main(): void {
  const flags = parseArgs();

  if (flags.help) {
    printHelp();
    return;
  }

  const report = buildSupportReport();

  if (flags.json) {
    console.log(renderJson(report));
    return;
  }

  const output = renderTextReport(report, flags, flags.mode === "compact");
  console.log(output);
}

main();
