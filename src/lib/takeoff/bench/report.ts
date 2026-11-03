import type { ChatGptReasoningEffort } from "@/lib/ai/chatgpt-model-preferences";
import {
  DEFAULT_TAKEOFF_BENCHMARK_THRESHOLDS,
  type TakeoffBenchmarkFailedCheck,
  type TakeoffBenchmarkThresholds,
} from "@/lib/takeoff/benchmark";
import { DIAMETER_TABLE_VERSION } from "@/lib/takeoff/bench/diameters";
import { ITEM_KEY_READER_VERSION, scoredUnit, type ScoredUnit } from "@/lib/takeoff/bench/item-keys";
import type { BenchPageSelection } from "@/lib/takeoff/bench/pages";
import {
  countTiers,
  designationRuleResults,
  failedCodes,
  guardTiers,
  type GuardTier,
  type TierCounts,
} from "@/lib/takeoff/bench/rules";
import {
  BENCH_CHUNKING,
  LOCAL_CHATGPT_TIMEOUT_CAP_MS,
  type BenchRunResult,
  type BenchStop,
  type CallStatus,
  type DocumentRun,
  type TokenUsage,
} from "@/lib/takeoff/bench/run";
import type { NoiseFile } from "@/lib/takeoff/bench/schemas";
import {
  BENCH_TOLERANCES,
  SCORE_VERSION,
  scoreScopes,
  type ConfidenceCounts,
  type IndicativeCounts,
  type KeyLabel,
  type KeyScore,
  type ScopeCounts,
  type ScopeScore,
  type ScoreScope,
} from "@/lib/takeoff/bench/score";
import { TAKEOFF_C_TIMEOUT_MS_DEFAULT } from "@/lib/takeoff/constants";
import { VECTOR_EXTRACTION_TIMEOUT_MS_PER_PAGE } from "@/lib/takeoff/vectors/extraction";
import { getTakeoffPromptVersion } from "@/lib/takeoff/prompts";
import type { TakeoffItem } from "@/lib/takeoff/types";
import { DEFAULT_LOW_CONFIDENCE_THRESHOLD } from "@/lib/takeoff/guards";
import { TAKEOFF_RULE_VERSIONS } from "@/lib/takeoff/rules/evaluate";
import { TAKEOFF_RULES_VERSION } from "@/lib/takeoff/rules/types";

// Report of a takeoff bench run (TI-660): report.json keeps every call, item and
// key; report.md publishes codes, counts, relative deviations, tokens and
// latencies only, never a quantity, a tolerance (a share of a quantity), a
// designation read on a plan or free text of the private dataset: a room is
// printed as its index among the sorted rooms of its table (« pièce 3 »), its
// label stays in report.json. Lots and scopes whose documents did not run are
// left out; a scope whose reading lost a chunk is listed with its unread pages,
// not scored; the reserve is reported apart from the lots it is held out from.
// Causes count once per key or unpaired false-positive group: a group paired with
// a missed key (one network, DN or unit apart), or an unreadable item that may be
// that key, is one deviation with it, counted on the key. A couple stopped before the profile was read has no send mode
// (override null). Latency: nearest-rank p50
// / p95 of each call's duration divided by the pages of its chunk; a timeout
// counts as max(its duration, 180 s), and a second distribution keeps the
// completed calls only (answer received, schema failures included). The passed / failedChecks
// of evaluateTakeoffBenchmark's thresholds are indicative: they are the
// fictional fixture's.

export const INDICATIVE_NOTE = "indicatif, seuils de la fixture fictive";
/** A page of the vector pipeline is killed at 15 s: a timeout counts at least that long. */
export const VECTOR_TIMEOUT_FLOOR_MS = VECTOR_EXTRACTION_TIMEOUT_MS_PER_PAGE;

export const PRODUCTION_GAPS = [
  "Sans préparation du métré (cadrage, calibration).",
  "Sans DPGF ni CCTP joints au prompt.",
  "Sans flags tenant : découpage et timeout par défaut (15/10/2 pages, 300 s demandés, plafonnés à 180 s par callLocalChatGptStructured).",
  "Un document à la fois, sans persistance.",
] as const;

export type BenchReportMetadata = {
  started_at: string;
  finished_at: string;
  /** node, its flags, the script (relative to `cwd` when under it, absolute otherwise) and its arguments. */
  command: string[];
  /** The directory the command ran in: the one holding the ChatGPT store. */
  cwd: string;
  /** The variables the command needs, as set for the run (TAKEOFF_BENCH_CHATGPT_OWNER, TSX_TSCONFIG_PATH). */
  env: Record<string, string>;
  node: string;
  commit: string | null;
  dirty: boolean | null;
  dataset: {
    sha256: string;
    documents: Array<{ id: string; lot: string; role: string; sha256: string; bytes: number; pages: number | null }>;
    skipped: Array<{ id: string; reason: string }>;
  };
  profile: { model: string | null; reasoning_effort: ChatGptReasoningEffort | null; unchanged: boolean | null };
  /** Host and load before and after the run (AGENTS.md: performance figures carry the host load). */
  host?: { platform: string; release: string; cpus: number; loadavg_before: number[]; loadavg_after: number[] };
  /** Pages read when the extraction did not read every page (TI-663 « après »). */
  page_selection?: BenchPageSelection;
};

export type LatencySummary = { n: number; p50_ms: number | null; p95_ms: number | null };

export type TimeoutEntry = {
  document: string;
  start_page: number;
  end_page: number;
  pages: number;
  bytes: number;
  model: string;
  reasoning_effort: ChatGptReasoningEffort | null;
  duration_ms: number;
};

export type LotScore = Omit<ScopeCounts, "attachment_rate"> & {
  attachment_rate: number | null;
  scopes: number;
  scopes_not_run: number;
  scopes_read_failed: number;
};

export type LotSummary = {
  documents: number;
  calls: number;
  pages: number;
  statuses: Record<CallStatus, number>;
  tokens: TokenUsage;
  latency_per_page: LatencySummary & { timeouts_counted_at_ms: number };
  completed_latency_per_page: LatencySummary;
  timeouts: TimeoutEntry[];
  duplicate_items: number;
  score: LotScore;
};

export type GroupSummary = { lots: Record<string, LotSummary>; all: LotSummary };

export type IndicativeReport = {
  note: typeof INDICATIVE_NOTE;
  passed: boolean;
  failedChecks: TakeoffBenchmarkFailedCheck[];
  precision: number;
  recall: number;
  quantityAccuracy: number;
  localizedProofCoverage: number;
  highConfidenceErrorRate: number;
  counts: IndicativeCounts;
  thresholds: TakeoffBenchmarkThresholds;
};

/** Keys at high confidence and those in error, over the scored scopes of a role (TI-664). */
export type ConfidenceSummary = Omit<ConfidenceCounts, "high_confidence_errors"> & {
  scopes: number;
  high_confidence_errors: Array<ConfidenceCounts["high_confidence_errors"][number] & { scope: string }>;
};

/**
 * The fixed rules on a pass (TI-664): per document, its lines rejected, uncertain and at high confidence before and
 * after the rules, and the failed rule codes; per role, the keys at high confidence and those in error.
 */
export type PassRules = {
  version: number;
  threshold: number;
  documents: Array<{ id: string; lot: string; role: "truth" | "reserve"; before: TierCounts; after: TierCounts; failed: Record<string, number> }>;
  confidence: Record<"main" | "reserve", { before: ConfidenceSummary; after: ConfidenceSummary }>;
};

export type PassReport = {
  pass: number;
  complete: boolean;
  documents: DocumentRun[];
  scopes: ScopeScore[];
  summary: { main: GroupSummary; reserve: GroupSummary };
  indicative: IndicativeReport;
  rules?: PassRules;
};

export type NoiseReport = {
  status: NoiseFile["status"];
  reason: string | null;
  plan_index_same: boolean | null;
  keys: Array<{
    key: KeyLabel;
    unit: string;
    relative_deviation: number | null;
    tolerance_relative: number | null;
    within: boolean | null;
    note: string | null;
  }>;
};

/** The reading a bench run scores: the level C ChatGPT reading (TI-660) or the vector reading (TI-662). */
export type BenchPipeline = "chatgpt" | "vector";

export const VECTOR_PRODUCTION_GAPS = [
  "Lecture vectorielle seule, sans appel de modèle : classes par mots-clés (calques, légende) et correspondances de truth/groups.",
  "Sans préparation du métré : l’échelle vient du cartouche, vérifiée par une cote, ou de la calibration de truth/groups.",
  "Pages raster : lecture niveau C de la baseline quand --baseline est donné, sinon aucun item.",
  "Un document à la fois, sans persistance.",
] as const;

export type BenchReport = {
  schema_version: 1;
  /** Absent in the reports of TI-660: chatgpt. */
  pipeline?: BenchPipeline;
  status: BenchRunResult["status"];
  stop: BenchStop | null;
  calls_planned: number;
  calls_done: number;
  metadata: BenchReportMetadata;
  production_gaps: readonly string[];
  rules: Record<string, unknown>;
  couples: Array<{
    model: string;
    reasoning_effort: ChatGptReasoningEffort | null;
    override: boolean | null;
    prompt_version: string | null;
    passes_done: number;
    passes: PassReport[];
  }>;
  noise: NoiseReport | null;
};

/** Nearest-rank percentile (no interpolation); null without values. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function round(value: number) {
  return Math.round(value * 1e6) / 1e6;
}

function latency(values: readonly number[]): LatencySummary {
  return { n: values.length, p50_ms: percentile(values, 50), p95_ms: percentile(values, 95) };
}

const STATUSES: CallStatus[] = ["ok", "schema_failure", "timeout", "rejected", "provider_failed", "stopped"];

function emptyScore(): LotScore {
  return {
    scopes: 0, scopes_not_run: 0, scopes_read_failed: 0, items: 0, attached: 0, unreadable: 0, out_of_score_items: 0, attachment_rate: null,
    keys_scored: 0, keys_ok: 0, keys_out_of_tolerance: 0, keys_missed: 0, keys_out_of_score: 0, false_positive_groups: 0,
    false_positive_items: 0, not_reviewed: 0, causes: {},
  };
}

const SUMMED_COUNTS = [
  "items", "attached", "unreadable", "out_of_score_items", "keys_scored", "keys_ok", "keys_out_of_tolerance", "keys_missed",
  "keys_out_of_score", "false_positive_groups", "false_positive_items", "not_reviewed",
] as const;

function summarizeLot(documents: readonly DocumentRun[], scopes: readonly ScopeScore[], floorMs: number): LotSummary {
  const calls = documents.flatMap((document) => document.calls.map((entry) => ({ document: document.id, call: entry })));
  const statuses = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<CallStatus, number>;
  const tokens: TokenUsage = { input: 0, output: 0, reasoning: 0, total: 0 };
  const perPage: number[] = [];
  const completed: number[] = [];
  const timeouts: TimeoutEntry[] = [];
  for (const { document, call } of calls) {
    statuses[call.status] += 1;
    if (call.usage) {
      tokens.input += call.usage.input;
      tokens.output += call.usage.output;
      tokens.reasoning += call.usage.reasoning;
      tokens.total += call.usage.total;
    }
    if (call.status === "ok" || call.status === "schema_failure") {
      perPage.push(call.duration_ms / call.pages);
      completed.push(call.duration_ms / call.pages);
    } else if (call.status === "timeout") {
      perPage.push(Math.max(call.duration_ms, floorMs) / call.pages);
      timeouts.push({
        document, start_page: call.start_page, end_page: call.end_page, pages: call.pages, bytes: call.bytes,
        model: call.model, reasoning_effort: call.reasoning_effort, duration_ms: call.duration_ms,
      });
    }
  }
  const score = emptyScore();
  for (const scope of scopes) {
    score.scopes += 1;
    if (scope.status === "not_run") {
      score.scopes_not_run += 1;
      continue;
    }
    if (scope.status === "read_failed") {
      score.scopes_read_failed += 1;
      continue;
    }
    for (const field of SUMMED_COUNTS) score[field] += scope.counts[field];
    for (const [cause, count] of Object.entries(scope.counts.causes)) score.causes[cause] = (score.causes[cause] ?? 0) + count;
  }
  score.attachment_rate = score.items === 0 ? null : round(score.attached / score.items);
  score.causes = Object.fromEntries(Object.entries(score.causes).sort(([left], [right]) => (left < right ? -1 : 1)));
  return {
    documents: documents.length,
    calls: calls.length,
    pages: calls.reduce((total, { call }) => total + call.pages, 0),
    statuses,
    tokens,
    latency_per_page: { ...latency(perPage), timeouts_counted_at_ms: floorMs },
    completed_latency_per_page: latency(completed),
    timeouts,
    duplicate_items: documents.reduce((total, document) => total + document.duplicate_items, 0),
    score,
  };
}

function summarizeGroup(documents: readonly DocumentRun[], scopes: readonly ScopeScore[], floorMs: number): GroupSummary {
  // A lot is reported once one of its documents ran: a truth whose plans did not run adds no row of zeros.
  const lots = [...new Set([...documents.map((document) => document.lot),
    ...scopes.filter((scope) => scope.status === "scored").map((scope) => scope.lot)])].sort();
  return {
    lots: Object.fromEntries(lots.map((lot) => [lot,
      summarizeLot(documents.filter((document) => document.lot === lot), scopes.filter((scope) => scope.lot === lot), floorMs)])),
    all: summarizeLot(documents, scopes, floorMs),
  };
}

function ratio(numerator: number, denominator: number, empty: number) {
  return round(denominator > 0 ? numerator / denominator : empty);
}

function indicative(scopes: readonly ScopeScore[]): IndicativeReport {
  const counts: IndicativeCounts = {
    expected_keys: 0, matched_keys: 0, ok_keys: 0, candidates: 0, items: 0, localized_items: 0, high_confidence_items: 0, high_confidence_errors: 0,
  };
  for (const scope of scopes) {
    if (scope.status !== "scored") continue;
    for (const field of Object.keys(counts) as Array<keyof IndicativeCounts>) counts[field] += scope.indicative[field];
  }
  const thresholds = DEFAULT_TAKEOFF_BENCHMARK_THRESHOLDS;
  const none = counts.expected_keys === 0 ? 1 : 0;
  const precision = ratio(counts.matched_keys, counts.candidates, none);
  const recall = ratio(counts.matched_keys, counts.expected_keys, counts.candidates === 0 ? 1 : 0);
  const quantityAccuracy = ratio(counts.ok_keys, counts.matched_keys, none);
  const localizedProofCoverage = ratio(counts.localized_items, counts.items, none);
  const highConfidenceErrorRate = ratio(counts.high_confidence_errors, counts.high_confidence_items, 0);
  const failedChecks: TakeoffBenchmarkFailedCheck[] = [];
  if (precision < thresholds.minPrecision) failedChecks.push("precision");
  if (recall < thresholds.minRecall) failedChecks.push("recall");
  if (quantityAccuracy < thresholds.minQuantityAccuracy) failedChecks.push("quantity_accuracy");
  if (localizedProofCoverage < thresholds.minLocalizedProofCoverage) failedChecks.push("localized_proof_coverage");
  if (highConfidenceErrorRate > thresholds.maxHighConfidenceErrorRate) failedChecks.push("high_confidence_error_rate");
  return {
    note: INDICATIVE_NOTE, passed: failedChecks.length === 0, failedChecks, precision, recall, quantityAccuracy,
    localizedProofCoverage, highConfidenceErrorRate, counts, thresholds,
  };
}

function confidenceSummary(scopes: readonly ScopeScore[]): ConfidenceSummary {
  const summary: ConfidenceSummary = {
    scopes: 0, lines: { rejected: 0, uncertain: 0, high: 0 }, keys_high_confidence: 0, keys_high_confidence_error: 0, high_confidence_errors: [],
  };
  for (const scope of scopes) {
    if (scope.status !== "scored" || !scope.confidence) continue;
    summary.scopes += 1;
    for (const tier of ["rejected", "uncertain", "high"] as const) summary.lines[tier] += scope.confidence.lines[tier];
    summary.keys_high_confidence += scope.confidence.keys_high_confidence;
    summary.keys_high_confidence_error += scope.confidence.keys_high_confidence_error;
    summary.high_confidence_errors.push(...scope.confidence.high_confidence_errors.map((entry) => ({ ...entry, scope: scope.id })));
  }
  return summary;
}

/**
 * Rules of a pass: a document's rule results come from its run (vector pipeline: geometry, pages and the other
 * documents of its lot) or, without them, from its lines' designations (level C answers).
 */
function passRules(read: readonly DocumentRun[], scopes: readonly ScoreScope[], items: ReadonlyMap<string, readonly TakeoffItem[]>,
  readings: { failures: Map<string, Array<{ start_page: number; end_page: number; status: string }>>; chunks: Map<string, number[][]> },
  threshold: number) {
  const before = new Map<string, GuardTier[]>();
  const after = new Map<string, GuardTier[]>();
  const documents: PassRules["documents"] = [];
  for (const document of read) {
    const results = document.item_rules ?? designationRuleResults(document.items);
    const tiersBefore = guardTiers(document.items, null, threshold);
    const tiersAfter = guardTiers(document.items, results, threshold);
    before.set(document.id, tiersBefore);
    after.set(document.id, tiersAfter);
    documents.push({ id: document.id, lot: document.lot, role: document.role, before: countTiers(tiersBefore), after: countTiers(tiersAfter),
      failed: failedCodes(results) });
  }
  const scoredBefore = scoreScopes(scopes, items, { ...readings, tiers: before });
  const scoredAfter = scoreScopes(scopes, items, { ...readings, tiers: after });
  const byRole = (scored: readonly ScopeScore[], role: "truth" | "reserve") => confidenceSummary(scored.filter((scope) => scope.role === role));
  return {
    after: scoredAfter,
    rules: {
      version: TAKEOFF_RULES_VERSION, threshold, documents,
      confidence: {
        main: { before: byRole(scoredBefore, "truth"), after: byRole(scoredAfter, "truth") },
        reserve: { before: byRole(scoredBefore, "reserve"), after: byRole(scoredAfter, "reserve") },
      },
    } satisfies PassRules,
  };
}

const NOISE_M2_UNDETERMINED = "indéterminé (part absolue 0,5 m² non évaluable sans quantité)";

/**
 * Within its unit's tolerance, from the relative deviation alone (a noise key holds no quantity): an m2 deviation
 * above 2 % may still be under the 0.5 m² floor of max(2 %, 0.5 m²), so it is undetermined (null), never false.
 */
function noiseWithin(unit: ScoredUnit | null, relativeDeviation: number | null) {
  if (unit === null || relativeDeviation === null) return null;
  const within = Math.abs(relativeDeviation) <= BENCH_TOLERANCES[unit].relative + 1e-9;
  return within || BENCH_TOLERANCES[unit].absolute === 0 ? within : null;
}

function noiseReport(noise: NoiseFile | null): NoiseReport | null {
  if (noise === null) return null;
  return {
    status: noise.status, reason: noise.reason, plan_index_same: noise.plan_index_same,
    keys: noise.keys.map((key) => {
      const unit = scoredUnit(key.unit);
      const tolerance = unit === null ? null : BENCH_TOLERANCES[unit].relative;
      const label: KeyLabel = {
        kind: key.kind, zone: key.zone, level: key.level, network: key.network, material: key.material, organ: key.organ,
        dn: key.dn, room: key.room, unit: key.unit,
      };
      return {
        key: label, unit: key.unit, relative_deviation: key.relative_deviation, tolerance_relative: tolerance,
        within: noiseWithin(unit, key.relative_deviation),
        note: unit === "m2" ? "the 0.5 m² absolute part needs a quantity: within is null above 2 %" : key.reason,
      };
    }),
  };
}

export function buildBenchReport(input: {
  metadata: BenchReportMetadata;
  run: BenchRunResult;
  scopes: readonly ScoreScope[];
  noise: NoiseFile | null;
  pipeline?: BenchPipeline;
  /** Rules of the vector reading (versions and thresholds), recorded with a vector run. */
  vectorRules?: Record<string, unknown>;
  /** Documents a page triage fully excluded (`--pages-from`): scored as read with no item, their keys missed. */
  excludedDocuments?: readonly string[];
  /** Low-confidence threshold of the apply guard the lines are classed with (TI-664); the guard's default otherwise. */
  threshold?: number;
}): BenchReport {
  const promptVersion = getTakeoffPromptVersion("C");
  const vector = input.pipeline === "vector";
  const floorMs = vector ? VECTOR_TIMEOUT_FLOOR_MS : LOCAL_CHATGPT_TIMEOUT_CAP_MS;
  const common = {
    tolerances: BENCH_TOLERANCES,
    item_key_reader_version: ITEM_KEY_READER_VERSION,
    score_version: SCORE_VERSION,
    diameter_table_version: DIAMETER_TABLE_VERSION,
    attachment: "items whose key is read / items",
    causes: "one per key or unpaired false-positive group; pairs are one to one: a group paired with a missed key (one network, "
      + "DN or unit apart) counts on that key; an unreadable item that may be a missed key makes it indetermine:illisible and counts "
      + "on it; other unreadable items: one group per reason (indetermine:illisible)",
    indicative: INDICATIVE_NOTE,
    takeoff_rules: { version: TAKEOFF_RULES_VERSION, rules: TAKEOFF_RULE_VERSIONS,
      tiers: "rejected: blocked by the apply guard (after the rules: or by a failed rule); uncertain: medium; high: neither, confidence >= 0.8" },
  };
  return {
    schema_version: 1,
    ...(vector ? { pipeline: "vector" as const } : {}),
    status: input.run.status,
    stop: input.run.stop,
    calls_planned: input.run.calls_planned,
    calls_done: input.run.calls_done,
    metadata: input.metadata,
    production_gaps: vector ? VECTOR_PRODUCTION_GAPS : PRODUCTION_GAPS,
    rules: vector ? {
      vector: input.vectorRules ?? {},
      ...common,
      read_failures: "a scope whose document lost a page (timeout, too large, invalid output) is not scored",
      latency: "nearest-rank p50 / p95 of page duration (extraction in its process, then reading); a timeout counts max(duration, 15 s)",
    } : {
      prompt: { level: "C", version: promptVersion, schema_version: "v1", schema: "TakeoffExchangeSchema" },
      chunking: BENCH_CHUNKING,
      timeout_ms: { requested: TAKEOFF_C_TIMEOUT_MS_DEFAULT, cap: LOCAL_CHATGPT_TIMEOUT_CAP_MS },
      ...common,
      read_failures: "a scope whose document lost a chunk (timeout, rejection, provider or schema failure) is not scored",
      latency: "nearest-rank p50 / p95 of call duration / chunk pages; a timeout counts max(duration, 180 s)",
    },
    couples: input.run.couples.map((couple) => ({
      model: couple.model,
      reasoning_effort: couple.reasoning_effort,
      override: couple.override,
      prompt_version: couple.prompt_version,
      passes_done: couple.passes.filter((pass) => pass.complete).length,
      passes: couple.passes.map((pass) => {
        const read = pass.documents.filter((document) => document.complete);
        const items = new Map(read.map((document) => [document.id, document.items]));
        for (const id of input.excludedDocuments ?? []) if (!items.has(id)) items.set(id, []);
        const failures = new Map(read.map((document) => [document.id, document.calls.filter((entry) => entry.status !== "ok")
          .map((entry) => ({ start_page: entry.start_page, end_page: entry.end_page, status: entry.status }))]));
        const chunks = new Map(read.map((document) => [document.id, document.item_chunks]));
        // Scored with each line's tier after the rules; the same scopes before them give the « before » counts only.
        const { after: scores, rules } = passRules(read, input.scopes, items, { failures, chunks }, input.threshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD);
        const byRole = (role: "truth" | "reserve") => summarizeGroup(
          pass.documents.filter((document) => document.role === role), scores.filter((scope) => scope.role === role), floorMs);
        return {
          pass: pass.pass, complete: pass.complete, documents: pass.documents, scopes: scores,
          summary: { main: byRole("truth"), reserve: byRole("reserve") },
          indicative: indicative(scores.filter((scope) => scope.role === "truth")),
          rules,
        };
      }),
    })),
    noise: noiseReport(input.noise),
  };
}

// ---------------------------------------------------------------------------
// report.md

function seconds(ms: number | null) {
  return ms === null ? "–" : `${(ms / 1000).toFixed(1)}`;
}

function percent(value: number | null | undefined) {
  if (value === null || value === undefined) return "–";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)} %`;
}

export type RoomIndex = ReadonlyMap<string, number>;

/** Rooms of one table, numbered in label order: report.md prints the number, never the label (private plan text). */
export function roomIndex(keys: ReadonlyArray<KeyLabel | null>): RoomIndex {
  const rooms = [...new Set(keys.flatMap((key) => (key?.room ? [key.room] : [])))].sort();
  return new Map(rooms.map((room, index) => [room, index + 1]));
}

export function formatKeyLabel(key: KeyLabel, rooms: RoomIndex) {
  const place = `${key.zone ?? "-"} ${key.level ?? "-"}`;
  if (key.kind === "surface") return `${place} pièce ${key.room === null ? "?" : rooms.get(key.room) ?? "?"} ${key.unit}`;
  if (key.kind === "count") return `${place} ${key.organ ?? "?"} ${key.dn ?? "sans DN"} ${key.unit}`;
  return `${place} ${key.network ?? "?"} ${key.material ?? "sans matériau"} ${key.dn ?? "sans DN"} ${key.unit}`;
}

const STATUS_LABELS: Record<KeyScore["status"], string> = {
  ok: "dans la tolérance", out_of_tolerance: "hors tolérance", missed: "manquée", out_of_score: "hors score",
};
const OUT_OF_SCORE_LABELS: Record<NonNullable<KeyScore["reason"]>, string> = {
  not_observable: "non observable", partly_observable: "partiellement observable", ambiguous: "ambiguë", unit: "unité",
};

function cell(value: string | number | null) {
  return String(value ?? "–").replace(/\|/g, "\\|");
}

function table(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null>>) {
  if (rows.length === 0) return "_Aucune ligne._";
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`)].join("\n");
}

function lotLabel(lot: string) {
  return lot === "all" ? "Tous" : lot.toUpperCase();
}

function lotRows(summary: GroupSummary) {
  return [...Object.entries(summary.lots), ["all", summary.all] as const] as Array<readonly [string, LotSummary]>;
}

function groupSection(title: string, summary: GroupSummary) {
  const floor = `${Math.round(summary.all.latency_per_page.timeouts_counted_at_ms / 1000)} s`;
  const rows = lotRows(summary);
  return [
    `### ${title} : score`,
    table(["Lot", "Docs", "Clés notées", "Dans la tolérance", "Hors tolérance", "Manquées", "Hors score", "Faux positifs (groupes / items)",
      "Illisibles (items)", "Rattachement", "Non relus", "Portées en échec de lecture"], rows.map(([lot, entry]) => [
      lotLabel(lot), entry.documents, entry.score.keys_scored, entry.score.keys_ok, entry.score.keys_out_of_tolerance, entry.score.keys_missed,
      entry.score.keys_out_of_score, `${entry.score.false_positive_groups} / ${entry.score.false_positive_items}`, entry.score.unreadable,
      entry.score.attachment_rate === null ? null : `${(entry.score.attachment_rate * 100).toFixed(1)} %`, entry.score.not_reviewed,
      entry.score.scopes_read_failed,
    ])),
    "",
    `### ${title} : causes`,
    table(["Lot", "Causes (une par clé ou groupe de faux positifs non apparié à une clé manquée)"], rows.map(([lot, entry]) => [lotLabel(lot),
      Object.entries(entry.score.causes).map(([cause, count]) => `${cause} ${count}`).join(", ") || "–"])),
    "",
    `### ${title} : mesures`,
    table(["Lot", "Appels", "Pages", "Jetons entrée", "Jetons sortie", "Jetons raisonnement", `p50 / p95 par page (s, timeouts ≥ ${floor})`,
      "p50 / p95 terminés (s)", "Timeouts", "Échecs de schéma", "Refus", "Échecs fournisseur", "Doublons fusionnés"],
    rows.map(([lot, entry]) => [
      lotLabel(lot), entry.calls, entry.pages, entry.tokens.input, entry.tokens.output, entry.tokens.reasoning,
      `${seconds(entry.latency_per_page.p50_ms)} / ${seconds(entry.latency_per_page.p95_ms)} (n ${entry.latency_per_page.n})`,
      `${seconds(entry.completed_latency_per_page.p50_ms)} / ${seconds(entry.completed_latency_per_page.p95_ms)} (n ${entry.completed_latency_per_page.n})`,
      entry.statuses.timeout, entry.statuses.schema_failure, entry.statuses.rejected, entry.statuses.provider_failed, entry.duplicate_items,
    ])),
    "",
    ...(summary.all.timeouts.length > 0 ? [
      `### ${title} : timeouts`,
      table(["Document", "Pages", "Taille (octets)", "Modèle", "Effort", "Durée (s)"], summary.all.timeouts.map((entry) => [
        entry.document, `${entry.start_page}-${entry.end_page}`, entry.bytes, entry.model, entry.reasoning_effort ?? "auto", seconds(entry.duration_ms),
      ])),
      "",
    ] : []),
  ];
}

function scopeSection(scope: ScopeScore) {
  const heading = `#### ${scope.documents.join(", ")} (lot ${scope.lot.toUpperCase()}${scope.role === "reserve" ? ", réserve" : ""})`;
  const rooms = roomIndex([...scope.keys.map((key) => key.key), ...scope.false_positives.map((group) => group.key)]);
  return [
    heading,
    ...scope.warnings.map((warning) => `- ${warning}`),
    table(["Clé", "Statut", "Écart relatif", "Cause"], scope.keys.map((key) => [
      formatKeyLabel(key.key, rooms),
      key.status === "out_of_score" ? `${STATUS_LABELS[key.status]} (${OUT_OF_SCORE_LABELS[key.reason ?? "unit"]})` : STATUS_LABELS[key.status],
      key.status === "out_of_tolerance" ? percent(key.relative_deviation) : null,
      key.cause?.label ?? (key.plan_causes.length > 0 ? key.plan_causes.join(", ") : null),
    ])),
    "",
    table(["Faux positif", "Items", "Cause"], scope.false_positives.map((group) => [
      group.key ? formatKeyLabel(group.key, rooms) : `clé illisible (${group.reason})`, group.items,
      group.paired_with ? `${group.cause.label} (apparié à ${formatKeyLabel(group.paired_with, rooms)})` : group.cause.label,
    ])),
    "",
  ];
}

function stopLines(stop: BenchStop | null) {
  if (stop === null) return [];
  const at = stop.at
    ? `, à ${stop.at.model}/${stop.at.reasoning_effort ?? "auto"} passe ${stop.at.pass}, ${stop.at.document}${stop.at.chunk === null ? "" : ` bloc ${stop.at.chunk}`}`
    : ", avant le premier appel";
  return [
    "## Arrêt",
    `- ${stop.kind === "bench" ? "Erreur du banc" : "Arrêt fournisseur"} : ${stop.reason} (${stop.error.name}${stop.error.code ? ` ${stop.error.code}` : ""} : `
      + `${stop.error.message})${at}.`,
    `- ${stop.calls_done} appel${stop.calls_done > 1 ? "s" : ""} fait${stop.calls_done > 1 ? "s" : ""}, `
      + `${stop.calls_remaining} restant${stop.calls_remaining > 1 ? "s" : ""}.`,
    "",
  ];
}

function shellWord(word: string) {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
}

/** The command as it reruns: from its directory, with its variables. */
export function commandLine(metadata: Pick<BenchReportMetadata, "command" | "cwd" | "env">) {
  const env = Object.entries(metadata.env).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => `${name}=${shellWord(value)}`);
  return [`cd ${shellWord(metadata.cwd)} &&`, ...env, ...metadata.command.map(shellWord)].join(" ");
}

function tierCells(counts: TierCounts) {
  return `${counts.rejected} / ${counts.uncertain} / ${counts.high}`;
}

/** The rules of a pass: lines per document before and after them, failed codes, keys at high confidence in error. */
export function rulesSection(rules: PassRules): string[] {
  const confidenceRow = (label: string, before: ConfidenceSummary, after: ConfidenceSummary) => [
    label, after.scopes, `${before.keys_high_confidence_error} / ${before.keys_high_confidence}`, `${after.keys_high_confidence_error} / ${after.keys_high_confidence}`,
    after.high_confidence_errors.map((entry) => `${entry.kind === "invented" ? "inventée" : "hors tolérance"} (${entry.cause ?? "–"}`
      + `${entry.reason ? `, ${entry.reason}` : ""})`).join(", ") || "–",
  ];
  return [
    `### Règles fixes (v${rules.version}, seuil de confiance ${rules.threshold})`,
    "",
    "Lignes rejetées / incertaines / à haute confiance, avant puis après les règles.",
    "",
    table(["Document", "Rôle", "Avant", "Après", "Règles en échec"], rules.documents.map((entry) => [
      entry.id, entry.role === "reserve" ? "réserve" : "hors réserve", tierCells(entry.before), tierCells(entry.after),
      Object.entries(entry.failed).map(([code, count]) => `${code} ${count}`).join(", ") || "–",
    ])),
    "",
    "Clés à haute confiance en erreur / clés à haute confiance, sur les périmètres notés de cette lecture (chaque ligne illisible "
      + "compte comme une clé). Deux lectures ne se comparent que sur les mêmes périmètres.",
    "",
    table(["Rôle", "Périmètres notés", "Avant", "Après", "Erreurs restantes"], [
      confidenceRow("hors réserve", rules.confidence.main.before, rules.confidence.main.after),
      confidenceRow("réserve", rules.confidence.reserve.before, rules.confidence.reserve.after),
    ]),
    "",
  ];
}

export function renderBenchReportMarkdown(report: BenchReport) {
  const { metadata } = report;
  const vector = report.pipeline === "vector";
  const lines = [
    `# ${vector ? "Banc métré, lecture vectorielle (TI-662)" : "Banc métré niveau C (TI-660)"} : ${report.status === "complete" ? "run complet" : "run incomplet"}`,
    "",
    `- Date : ${metadata.started_at} → ${metadata.finished_at}`,
    `- Commande : \`${commandLine(metadata)}\``,
    `- Commit : ${metadata.commit ?? "inconnu"}${metadata.dirty === null ? "" : metadata.dirty ? " (modifications locales)" : " (propre)"}, Node ${metadata.node}`,
    `- Dataset : SHA-256 ${metadata.dataset.sha256}, ${metadata.dataset.documents.length} document${metadata.dataset.documents.length > 1 ? "s" : ""} `
      + `(${metadata.dataset.documents.map((document) => `${document.id}${document.role === "reserve" ? " réserve" : ""}`).join(", ") || "aucun"})`,
    ...(metadata.dataset.skipped.length > 0
      ? [`- Ignorés : ${metadata.dataset.skipped.map((entry) => `${entry.id} (${entry.reason})`).join(", ")}`] : []),
    vector
      ? `- Lecture : ${report.couples[0]?.prompt_version ?? "vector"} (sans modèle) ; lecteur de clés v${ITEM_KEY_READER_VERSION}, score v${SCORE_VERSION}, `
        + `table des diamètres v${DIAMETER_TABLE_VERSION}`
      : `- Prompt : ${getTakeoffPromptVersion("C")} (niveau C, schéma v1) ; lecteur de clés v${ITEM_KEY_READER_VERSION}, score v${SCORE_VERSION}, `
        + `table des diamètres v${DIAMETER_TABLE_VERSION}`,
    ...(vector ? [] : [`- Profil ChatGPT : ${metadata.profile.model ?? "aucun modèle"} / ${metadata.profile.reasoning_effort ?? "auto"}, inchangé après le run : `
      + `${metadata.profile.unchanged === null ? "non vérifié" : metadata.profile.unchanged ? "oui" : "NON"}`]),
    ...(metadata.host ? [`- Machine : ${metadata.host.platform} ${metadata.host.release}, ${metadata.host.cpus} CPU, charge ${metadata.host.loadavg_before.map((value) => value.toFixed(2)).join(" ")} → ${metadata.host.loadavg_after.map((value) => value.toFixed(2)).join(" ")}`] : []),
    ...(metadata.page_selection && metadata.page_selection.mode !== "all"
      ? [`- Pages lues (${metadata.page_selection.mode}) : ${metadata.page_selection.documents.map((entry) => `${entry.id} ${entry.excluded ? "écarté" : entry.pages_read.join("+")}/${entry.pages_total}`).join(", ")}`] : []),
    `- Appels : ${report.calls_done} faits sur ${report.calls_planned} prévus`,
    "",
    ...stopLines(report.stop),
    "## Écarts avec la production",
    ...report.production_gaps.map((gap) => `- ${gap}`),
    "",
    "Tolérances : u exact, ml ±10 %, m2 ±max(2 %, 0,5 m²). Rattachement : items dont la clé est lue ÷ items.",
    "",
  ];
  for (const couple of report.couples) {
    for (const pass of couple.passes) {
      lines.push(
        `## ${couple.model} / ${couple.reasoning_effort ?? "auto"}${couple.override === null ? "" : couple.override ? " (override)" : " (profil)"}, `
          + `prompt ${couple.prompt_version ?? "–"} : passe ${pass.pass}${pass.complete ? "" : " (incomplète)"}`,
        "",
        ...groupSection("Lots hors réserve", pass.summary.main),
        ...groupSection("Réserve", pass.summary.reserve),
        `### Indicatif (${pass.indicative.note})`,
        `- passed : ${pass.indicative.passed}, failedChecks : ${pass.indicative.failedChecks.join(", ") || "aucun"}`,
        `- précision ${pass.indicative.precision}, rappel ${pass.indicative.recall}, quantités ${pass.indicative.quantityAccuracy}, `
          + `preuves localisées ${pass.indicative.localizedProofCoverage}, erreurs à haute confiance ${pass.indicative.highConfidenceErrorRate}`,
        "",
        ...(pass.rules ? rulesSection(pass.rules) : []),
        "### Clés",
        "",
        ...pass.scopes.filter((scope) => scope.status === "scored").flatMap(scopeSection),
      );
      const notRun = pass.scopes.filter((scope) => scope.status === "not_run").map((scope) => scope.documents.join("+"));
      if (notRun.length > 0) lines.push(`Non notés (un de leurs documents n'a pas été lu dans cette passe) : ${notRun.join(", ")}`, "");
      const unread = pass.scopes.filter((scope) => scope.status === "read_failed").flatMap((scope) => scope.unread_pages)
        .map((entry) => `${entry.document} pages ${entry.start_page}-${entry.end_page} (${entry.status})`);
      if (unread.length > 0) lines.push(`Non notés (lecture en échec, leurs clés ne sont pas imputées au modèle) : ${unread.join(", ")}`, "");
    }
    if (couple.passes.length === 0) lines.push(`## ${couple.model} / ${couple.reasoning_effort ?? "auto"} : aucune passe`, "");
  }
  if (report.noise) {
    const rooms = roomIndex(report.noise.keys.map((key) => key.key));
    lines.push("## Bruit de mesure (truth/noise.json) face aux tolérances", "",
      // The reason is free text of the private dataset: report.json keeps it, report.md does not.
      `Statut : ${report.noise.status}.`, "",
      table(["Clé", "Écart relatif", "Tolérance relative", "Dans la tolérance"], report.noise.keys.map((key) => [
        formatKeyLabel(key.key, rooms), percent(key.relative_deviation),
        key.tolerance_relative === null ? "hors score" : `${(key.tolerance_relative * 100).toFixed(0)} %`,
        key.within !== null ? (key.within ? "oui" : "non")
          : scoredUnit(key.unit) === "m2" && key.relative_deviation !== null ? NOISE_M2_UNDETERMINED : "–",
      ])), "");
  }
  return `${lines.join("\n")}\n`;
}
