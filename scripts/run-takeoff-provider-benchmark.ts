import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import { getLocalChatGptCredential } from "@/lib/ai/chatgpt-local-auth";
import { assertLocalChatGptOverride, callLocalChatGptStructured, type LocalChatGptOverride } from "@/lib/ai/chatgpt-local-inference";
import { readChatGptStore, type ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import { getOpenAiDecisionsCapability } from "@/lib/ai/decisions";
import { createDecisionsTokenBudget } from "@/lib/ai/decisions-budget";
import { BENCH_USAGE, BenchUsageError, benchCouples, parseBenchArgs, parseBenchOwner, type BenchArgs, type ChatGptBenchArgs } from "@/lib/takeoff/bench/args";
import { BenchDatasetError, loadBenchDataset, type BenchDataset } from "@/lib/takeoff/bench/dataset";
import { remapBenchRunPages, selectBenchPages } from "@/lib/takeoff/bench/pages";
import { buildBenchReport, renderBenchReportMarkdown, type BenchReport, type BenchReportMetadata } from "@/lib/takeoff/bench/report";
import {
  classifyCallError,
  describeError,
  planBenchDocuments,
  runTakeoffBench,
  stoppedBeforeRun,
  type BenchCouple,
  type BenchRunResult,
  type PlannedDocument,
  type RequestedCouple,
  type StopReason,
} from "@/lib/takeoff/bench/run";
import { buildScoreScopes, type ScoreScope } from "@/lib/takeoff/bench/score";
import { runTakeoffBenchTriage } from "@/lib/takeoff/bench/triage";
import { buildBenchTriageReport, renderBenchTriageReportMarkdown, type BenchTriageMetadata } from "@/lib/takeoff/bench/triage-report";
import { compareVectorWithBaseline, renderVectorSections, vectorDecisionsSummary, vectorTimings } from "@/lib/takeoff/bench/vector-report";
import { baselineRasterFallback, runVectorBench, stoppedVectorBench, type VectorDecisionsHook } from "@/lib/takeoff/bench/vector-run";
import { getPdfPageCount } from "@/lib/takeoff/chunking";
import {
  runTakeoffPageTriage,
  TAKEOFF_PAGE_TRIAGE_CALL_ESTIMATE_TOKENS,
  TAKEOFF_PAGE_TRIAGE_CONCURRENCY,
  TAKEOFF_PAGE_TRIAGE_PROMPT_VERSION,
  TAKEOFF_PAGE_TRIAGE_TEXT,
  TAKEOFF_PAGE_TRIAGE_THUMBNAIL,
  takeoffPageTriageRenderLimits,
} from "@/lib/takeoff/page-triage-server";
import { VECTOR_EXTRACTION_HEAP_MB, VECTOR_EXTRACTION_LIMITS, VECTOR_EXTRACTION_TIMEOUT_MS_PER_PAGE, VECTOR_EXTRACTION_VERSION } from "@/lib/takeoff/vectors/extraction";
import { CLASSIFIED_DECISIONS_CONFIDENCE } from "@/lib/takeoff/vectors/classify";
import { RING_CLOSURE_PT } from "@/lib/takeoff/vectors/geometry";
import {
  GROUP_DECISIONS_EVIDENCE_MAX_BYTES,
  GROUP_DECISIONS_LABELS,
  GROUP_DECISIONS_LIMITS,
  GROUP_DECISIONS_PROMPT_VERSION,
  GROUP_DECISIONS_VERSION,
} from "@/lib/takeoff/vectors/group-decisions";
import { classifyVectorGroups, GROUP_DECISIONS_CALL_ESTIMATE_TOKENS, GROUP_DECISIONS_DEDICATED_RENDER_CHUNK } from "@/lib/takeoff/vectors/group-decisions-server";
import { GROUP_SHEET } from "@/lib/takeoff/vectors/group-sheet";
import { GROUP_LEGEND_RENDER, GROUP_SHEET_RENDER } from "@/lib/takeoff/vectors/group-sheet-server";
import { VECTOR_ITEMS_VERSION } from "@/lib/takeoff/vectors/items";
import { LEGEND_RULE_VERSION, TINT_TOLERANCE } from "@/lib/takeoff/vectors/legend";
import { BAND_GAP_PT, BAND_MAX_PT, JOIN_PT, LEADER_REACH_PT, MEASURE_RULE_VERSION, RUN_GAP_PT } from "@/lib/takeoff/vectors/measure";
import { RASTER_COVERAGE, VECTOR_READING_VERSION } from "@/lib/takeoff/vectors/pipeline";
import { COTE_RELATIVE_TOLERANCE, FORMAT_TOLERANCE, SCALE_RULE_VERSION } from "@/lib/takeoff/vectors/scale";
import { SURFACE_RULE_VERSION } from "@/lib/takeoff/vectors/surfaces";

// `npm run takeoff:bench -- --dataset <dir> --docs <ids|all> --models <...> --efforts <...> [--repeat <n>] --out <run_path>`
// (TI-660): the production level C reading of the private bench plans through the
// local ChatGPT profile, scored per key, without persistence. Run it alone (the
// durations are the bench clock's) from the checkout that holds the ChatGPT store
// (.private/chatgpt-local under the working directory). From another checkout,
// TSX_TSCONFIG_PATH must point to this script's tsconfig.json, so that `@/` is
// this checkout's code. The model and effort of the profile are never written:
// a couple other than the profile's is sent as an override, validated against
// the account's models before the first call (read-only, once per couple and
// run, so that no chunk's time includes a model listing). Writes report.json and
// report.md to --out only; the operator wraps the run with storage-guard begin
// / finish. The report records the command with its working directory and the
// variables it needs, so that it reruns as is.
// Exit 0: complete run, whatever the score. 1: bench error (usage, dataset,
// crash). 2: stopped by ChatGPT (quota, rate limit, authorisation, missing
// account or model, changed profile), with a partial report.
// `--mode triage` (TI-663): the product's Decisions page triage on every binary
// PDF with a page truth, under --max-decisions-tokens, scored against
// truth/pages (see bench/triage.ts). Inject only OPENAI_DECISIONS_API_KEY and
// MERGEONE_OPENAI_DECISIONS=1 (never --env-file); the key is never recorded.
// Exit 2 when Decisions is unavailable, at the first failed call, or when the
// ceiling refuses a call, with a partial report. `--pages` / `--pages-from`
// restrict an extraction to some pages (the « après » of the triage).
// `--pipeline vector` (TI-662): the vector reading of the same plans, no model
// and no owner; `--baseline <report.json>` re-scores a level C report with the
// current scorer, compares both (report.json `comparison`), and stands for the
// raster pages (pipeline step 5). With --max-decisions-tokens (TI-662 L3c) the
// groups the keywords leave are asked to Decisions under that ceiling, as the
// triage mode is: TAKEOFF_BENCH_CHATGPT_OWNER and, injected alone,
// OPENAI_DECISIONS_API_KEY with MERGEONE_OPENAI_DECISIONS=1 (the key is never
// recorded). Exit 0 or 1, and 2 when Decisions is unavailable (no page read),
// at the first failed call or when the ceiling refuses one, with a partial report.

const SCRIPT_ROOT = path.resolve(import.meta.dirname, "..");
const REPORT_FILES = ["report.json", "report.md"] as const;
/** The variables a run needs, recorded with its command so that it reruns as is. */
const RUN_ENV = ["TAKEOFF_BENCH_CHATGPT_OWNER", "TSX_TSCONFIG_PATH"] as const;
/** Recorded for a triage run; OPENAI_DECISIONS_API_KEY is deliberately absent. */
const TRIAGE_RUN_ENV = [...RUN_ENV, "MERGEONE_OPENAI_DECISIONS"] as const;

function host(before: number[]) {
  return { platform: os.platform(), release: os.release(), cpus: os.cpus().length, loadavg_before: before, loadavg_after: os.loadavg() };
}

function recordedEnv(names: readonly string[]) {
  return Object.fromEntries(names.flatMap((name) => (process.env[name] === undefined ? [] : [[name, process.env[name] as string]])));
}

function datasetMetadata(dataset: BenchDataset) {
  return {
    sha256: dataset.sha256,
    documents: dataset.selected.map(({ document }) => ({
      id: document.id, lot: document.lot, role: document.role, sha256: document.sha256 as string,
      bytes: document.file_size as number, pages: document.pages,
    })),
    skipped: dataset.skipped,
  };
}

const triageReportSchema = z.object({
  mode: z.literal("triage"),
  retained: z.array(z.object({ id: z.string(), sha256: z.string().nullable(), page_count: z.number().int().positive(), retained_pages: z.array(z.number().int().positive()) })),
});

async function readTriageReport(file: string) {
  const bytes = await readFile(file).catch(() => { throw new BenchRefusal(`--pages-from ${file} cannot be read.`); });
  const parsed = triageReportSchema.safeParse(JSON.parse(bytes.toString("utf8")));
  if (!parsed.success) throw new BenchRefusal(`--pages-from ${file} is not a triage report.`);
  return { path: path.resolve(file), sha256: createHash("sha256").update(bytes).digest("hex"), retained: parsed.data.retained };
}

async function runTriage(args: ChatGptBenchArgs, owner: ChatGptOwner, startedAt: string, loadBefore: number[]) {
  const dataset = await loadBenchDataset(args.dataset, args.docs, { mode: "triage" });
  const budget = createDecisionsTokenBudget(args.maxDecisionsTokens as number, TAKEOFF_PAGE_TRIAGE_CALL_ESTIMATE_TOKENS);
  const capability = getOpenAiDecisionsCapability();
  const inputs = dataset.selected.map(({ document, bytes }) => ({ document, bytes, truth: dataset.pageTruths.get(document.id)! }));
  const result = capability.status === "available"
    ? await runTakeoffBenchTriage({ documents: inputs, owner, budget, triage: runTakeoffPageTriage, log: (line) => console.error(line) })
    : { status: "incomplete" as const, stop: { reason: "decisions_unavailable" as const, message: capability.message, document: null },
      failures: [], documents: inputs.map((entry) => ({ ...entry, status: "not_run" as const, run: null })) };
  const status = git(["status", "--porcelain"]);
  const metadata: BenchTriageMetadata = {
    started_at: startedAt, finished_at: new Date().toISOString(),
    command: ["node", ...process.execArgv, scriptPath(), ...process.argv.slice(2)], cwd: process.cwd(),
    env: recordedEnv(TRIAGE_RUN_ENV), node: process.version, commit: git(["rev-parse", "HEAD"]),
    dirty: status === null ? null : status.length > 0, dataset: datasetMetadata(dataset), host: host(loadBefore),
    decisions: { status: capability.status, model: capability.model },
  };
  const report = buildBenchTriageReport({
    metadata, status: result.status, stop: result.stop, failures: result.failures, documents: result.documents, budget: budget.snapshot(),
    rules: {
      prompt_version: TAKEOFF_PAGE_TRIAGE_PROMPT_VERSION, model: capability.model, concurrency: TAKEOFF_PAGE_TRIAGE_CONCURRENCY,
      thumbnail: TAKEOFF_PAGE_TRIAGE_THUMBNAIL, text: TAKEOFF_PAGE_TRIAGE_TEXT, render_limits_one_page: takeoffPageTriageRenderLimits(1),
      call_estimate_tokens: TAKEOFF_PAGE_TRIAGE_CALL_ESTIMATE_TOKENS, retries: 0,
    },
  });
  await writeFile(path.join(args.out, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  await writeFile(path.join(args.out, "report.md"), renderBenchTriageReportMarkdown(report), { flag: "wx" });
  console.log(`Takeoff bench triage ${result.status}: ${budget.snapshot().calls} Decisions calls, ${budget.snapshot().spent_tokens} tokens, reports in ${args.out}.`);
  if (result.stop) {
    console.error(`Stopped: ${result.stop.reason}${result.stop.document ? ` at ${result.stop.document}` : ""}: ${result.stop.message}`);
  }
  for (const failure of result.failures) console.error(`Not classified: ${failure.document}: ${failure.reason}: ${failure.message}`);
  if (result.status === "incomplete") process.exitCode = 2;
}

/** This script, relative to the working directory when under it (main's checkout), absolute otherwise (a worktree). */
function scriptPath() {
  const script = path.resolve(process.argv[1] ?? "");
  const relative = path.relative(process.cwd(), script);
  return relative.startsWith("..") || path.isAbsolute(relative) ? script : relative;
}

class BenchRefusal extends Error {}

function git(args: string[]) {
  try {
    return execFileSync("git", ["-C", import.meta.dirname, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function assertOwnCode() {
  const expected = path.join(SCRIPT_ROOT, "tsconfig.json");
  const effective = path.resolve(process.env.TSX_TSCONFIG_PATH ?? path.join(process.cwd(), "tsconfig.json"));
  if (effective !== expected) {
    throw new BenchRefusal(`@/ would resolve to another checkout (${path.dirname(effective)}): set TSX_TSCONFIG_PATH=${expected}.`);
  }
}

async function assertOutput(out: string) {
  const stats = await stat(out).catch(() => null);
  if (!stats?.isDirectory()) throw new BenchRefusal(`--out ${out} is not a directory (storage-guard begin creates the run_path).`);
  for (const file of REPORT_FILES) {
    if (await stat(path.join(out, file)).catch(() => null)) throw new BenchRefusal(`${path.join(out, file)} already exists: use a new run.`);
  }
}

type Profile = { profileId: string; model: string; reasoningEffort: BenchCouple["reasoningEffort"] };

/** Read-only check that the selected profile kept its model and effort. */
async function profileUnchanged(owner: ChatGptOwner, before: Profile) {
  try {
    const store = await readChatGptStore(owner);
    const profile = store.profiles.find((entry) => entry.id === store.selectedId);
    return store.selectedId === before.profileId && profile?.model === before.model
      && (profile?.reasoningEffort ?? null) === before.reasoningEffort;
  } catch {
    return null;
  }
}

type Preflight = { profile: Profile; couples: BenchCouple[]; overrides: Map<string, Readonly<LocalChatGptOverride>> }
  | { stopped: BenchRunResult; profile: Profile | null };

function coupleId(couple: Omit<BenchCouple, "override">) {
  return JSON.stringify([couple.model, couple.reasoningEffort]);
}

async function preflight(owner: ChatGptOwner, plans: PlannedDocument[], requested: Array<Omit<BenchCouple, "override">>,
  repeat: number): Promise<Preflight> {
  const asCouples = (profile: Profile): BenchCouple[] => requested.map((couple) => ({
    ...couple, override: !(couple.model === profile.model && couple.reasoningEffort === profile.reasoningEffort),
  }));
  const stop = (reason: StopReason, error: unknown, profile: Profile | null = null): Preflight => {
    // Before the profile is read, no couple has a send mode yet.
    const couples: RequestedCouple[] = profile ? asCouples(profile) : requested.map((couple) => ({ ...couple, override: null }));
    return { stopped: stoppedBeforeRun(plans, couples, repeat, { kind: "provider", reason, error: describeError(error) }), profile };
  };
  const stopOn = (error: unknown, profile: Profile | null = null) => {
    const classified = classifyCallError(error);
    return stop(classified.outcome === "stop" ? classified.reason : "other", error, profile);
  };
  let credential: Awaited<ReturnType<typeof getLocalChatGptCredential>>;
  try {
    // Renews the access token if needed; never chooses a model.
    credential = await getLocalChatGptCredential(owner);
  } catch (error) {
    return stopOn(error);
  }
  if (!credential) return stop("account_missing", new Error("Aucun compte ChatGPT sélectionné pour ce propriétaire."));
  // A profile without model is refused: the bench never gives it one (listLocalChatGptModels would).
  if (!credential.model) return stop("model_missing", new Error("Le profil ChatGPT n’a pas de modèle : choisissez-le dans Mon profil."));
  const profile: Profile = { profileId: credential.profileId, model: credential.model, reasoningEffort: credential.reasoningEffort ?? null };
  const couples = asCouples(profile);
  const overrides = new Map<string, Readonly<LocalChatGptOverride>>();
  for (const couple of couples.filter((entry) => entry.override)) {
    try {
      // With the credential read above, never the store; the checked override then holds for every chunk of this run.
      overrides.set(coupleId(couple), await assertLocalChatGptOverride(owner, credential, { model: couple.model, reasoningEffort: couple.reasoningEffort }));
    } catch (error) {
      return stopOn(error, profile);
    }
  }
  return { profile, couples, overrides };
}

function vectorRules() {
  return {
    extraction: { version: VECTOR_EXTRACTION_VERSION, timeout_ms_per_page: VECTOR_EXTRACTION_TIMEOUT_MS_PER_PAGE, heap_mb: VECTOR_EXTRACTION_HEAP_MB,
      limits: VECTOR_EXTRACTION_LIMITS },
    reading: { version: VECTOR_READING_VERSION, raster_coverage: RASTER_COVERAGE },
    scale: { version: SCALE_RULE_VERSION, cote_relative_tolerance: COTE_RELATIVE_TOLERANCE, format_tolerance: FORMAT_TOLERANCE },
    legend: { version: LEGEND_RULE_VERSION, tint_tolerance: TINT_TOLERANCE },
    measure: { version: MEASURE_RULE_VERSION, band_gap_pt: BAND_GAP_PT, band_max_pt: BAND_MAX_PT, run_gap_pt: RUN_GAP_PT, join_pt: JOIN_PT,
      leader_reach_pt: LEADER_REACH_PT },
    surfaces: { version: SURFACE_RULE_VERSION, ring_closure_pt: RING_CLOSURE_PT },
    items: { version: VECTOR_ITEMS_VERSION },
    decisions: {
      version: GROUP_DECISIONS_VERSION, prompt_version: GROUP_DECISIONS_PROMPT_VERSION, limits_per_page: GROUP_DECISIONS_LIMITS,
      classified_confidence: CLASSIFIED_DECISIONS_CONFIDENCE, evidence_max_bytes: GROUP_DECISIONS_EVIDENCE_MAX_BYTES, labels: GROUP_DECISIONS_LABELS,
      call_estimate_tokens: GROUP_DECISIONS_CALL_ESTIMATE_TOKENS, dedicated_render_chunk: GROUP_DECISIONS_DEDICATED_RENDER_CHUNK,
      sheet: GROUP_SHEET, sheet_render: GROUP_SHEET_RENDER, legend_render: GROUP_LEGEND_RENDER, retries: 0,
    },
  };
}

type BaselineJson = Pick<BenchReport, "status" | "stop" | "calls_planned" | "calls_done" | "metadata" | "couples">;

/** The level C report a vector run compares with: its run, re-scored by the current scorer on the current scopes. */
async function readBaseline(file: string) {
  const bytes = await readFile(file);
  const json = JSON.parse(bytes.toString("utf8")) as BaselineJson & { pipeline?: string };
  if (!Array.isArray(json.couples) || json.couples.length !== 1 || !Array.isArray(json.couples[0].passes)) {
    throw new BenchRefusal(`--baseline ${file}: a takeoff:bench report with one couple is expected.`);
  }
  if (json.pipeline !== undefined && json.pipeline !== "chatgpt") {
    throw new BenchRefusal(`--baseline ${file}: a level C (chatgpt) report is expected, not a ${json.pipeline} run.`);
  }
  const run: BenchRunResult = {
    status: json.status, stop: json.stop, calls_planned: json.calls_planned, calls_done: json.calls_done,
    couples: json.couples.map((couple) => ({
      model: couple.model, reasoning_effort: couple.reasoning_effort, override: couple.override, prompt_version: couple.prompt_version,
      passes: couple.passes.map((pass) => ({ pass: pass.pass, complete: pass.complete, documents: pass.documents })),
    })),
  };
  return { file, sha256: createHash("sha256").update(bytes).digest("hex"), metadata: json.metadata, run };
}

async function mainVector(args: Extract<BenchArgs, { pipeline: "vector" }>) {
  // Decisions needs the owner whose tenant the calls are made for; keywords alone need none.
  const owner = args.maxDecisionsTokens === null ? null : parseBenchOwner(process.env.TAKEOFF_BENCH_CHATGPT_OWNER);
  assertOwnCode();
  await assertOutput(args.out);
  const startedAt = new Date().toISOString();
  const loadBefore = os.loadavg();
  // A load file without truth (TI-662 load criterion) runs unscored.
  const dataset: BenchDataset = await loadBenchDataset(args.dataset, args.docs, { unscored: true });
  const scopes: ScoreScope[] = buildScoreScopes(dataset.truthFiles, dataset.manifest.documents);
  const baseline = args.baseline ? await readBaseline(path.resolve(args.baseline)) : null;
  if (baseline) {
    // A baseline read another revision of a plan when its document's SHA-256 differs: its items would be scored against this truth.
    const changed = dataset.selected.filter(({ document }) => baseline.run.couples[0].passes.some((pass) =>
      pass.documents.some((entry) => entry.id === document.id && entry.sha256 !== document.sha256)));
    if (changed.length > 0) {
      throw new BenchRefusal(`--baseline read other revisions of ${changed.map(({ document }) => document.id).join(", ")} (SHA-256 differs from the manifest).`);
    }
  }
  const rasterFallback = baseline ? baselineRasterFallback(baseline.run.couples[0]?.passes ?? [], baseline.metadata.page_selection) : undefined;
  const documents = [];
  for (const { document, bytes } of dataset.selected) {
    const copy = new Uint8Array(bytes);
    documents.push({ id: document.id, lot: document.lot, role: document.role === "reserve" ? "reserve" as const : "truth" as const,
      bytes: copy, sha256: document.sha256 as string, pages: await getPdfPageCount(copy.slice().buffer) });
  }
  const budget = args.maxDecisionsTokens === null ? null : createDecisionsTokenBudget(args.maxDecisionsTokens, GROUP_DECISIONS_CALL_ESTIMATE_TOKENS);
  const capability = owner ? getOpenAiDecisionsCapability() : null;
  const log = (line: string) => console.error(line);
  const hook: VectorDecisionsHook | undefined = owner && budget ? {
    promptVersion: GROUP_DECISIONS_PROMPT_VERSION,
    classify: (document, _page, extraction, reading) => classifyVectorGroups({
      bytes: document.bytes, extraction, reading, owner, budget, log,
      context: { tenantId: owner.tenantId, projectId: `bench:${document.id}`,
        preparationFingerprint: createHash("sha256").update(`${document.sha256}:${GROUP_DECISIONS_PROMPT_VERSION}`).digest("hex") },
    }),
  } : undefined;
  // Unavailable Decisions: no page is read, the run stops before its first page.
  const result = capability && capability.status !== "available"
    ? stoppedVectorBench(documents, args.repeat, GROUP_DECISIONS_PROMPT_VERSION, { reason: "decisions_unavailable", message: capability.message })
    : await runVectorBench({ documents, groups: dataset.groups, repeat: args.repeat, rasterFallback, decisions: hook, log });
  const status = git(["status", "--porcelain"]);
  const metadata: BenchReportMetadata = {
    started_at: startedAt, finished_at: new Date().toISOString(),
    command: ["node", ...process.execArgv, scriptPath(), ...process.argv.slice(2)], cwd: process.cwd(),
    env: recordedEnv(owner ? TRIAGE_RUN_ENV : RUN_ENV),
    node: process.version, commit: git(["rev-parse", "HEAD"]), dirty: status === null ? null : status.length > 0,
    dataset: {
      sha256: dataset.sha256,
      documents: dataset.selected.map(({ document }) => ({
        id: document.id, lot: document.lot, role: document.role, sha256: document.sha256 as string, bytes: document.file_size as number, pages: document.pages,
      })),
      skipped: dataset.skipped,
    },
    profile: { model: null, reasoning_effort: null, unchanged: null },
    ...(owner ? { host: host(loadBefore) } : {}),
  };
  const report = buildBenchReport({ metadata, run: result.run, scopes, noise: dataset.noise, pipeline: "vector", vectorRules: vectorRules() });
  const baselineReport = baseline ? buildBenchReport({ metadata: baseline.metadata, run: baseline.run, scopes, noise: dataset.noise }) : null;
  const comparison = baselineReport ? compareVectorWithBaseline(report, baselineReport) : null;
  const decisions = budget && capability ? {
    capability: { status: capability.status, model: capability.model }, budget: budget.snapshot(),
    stop: result.run.stop?.error.name === "DecisionsStop" ? { reason: result.run.stop.error.code, message: result.run.stop.error.message, at: result.run.stop.at } : null,
    documents: vectorDecisionsSummary(result.vector.passes),
  } : null;
  const full = {
    ...report, vector: { ...result.vector, timings: vectorTimings(result.vector.passes), decisions }, comparison,
    baseline: baseline ? { file: baseline.file, sha256: baseline.sha256, commit: baseline.metadata.commit, dataset_sha256: baseline.metadata.dataset.sha256 } : null,
  };
  await writeFile(path.join(args.out, "report.json"), `${JSON.stringify(full, null, 2)}\n`, { flag: "wx" });
  const markdown = `${renderBenchReportMarkdown(report).trimEnd()}\n\n${renderVectorSections(result.vector.passes, comparison, decisions).join("\n")}\n`;
  await writeFile(path.join(args.out, "report.md"), markdown, { flag: "wx" });
  console.log(`Takeoff bench (vector) ${result.run.status}: ${result.run.calls_done}/${result.run.calls_planned} pages, reports in ${args.out}.`);
  if (budget) console.log(`Decisions: ${budget.snapshot().calls} calls, ${budget.snapshot().spent_tokens} tokens.`);
  if (result.run.stop) {
    console.error(`Stopped: ${result.run.stop.error.code ?? result.run.stop.reason}: ${result.run.stop.error.message}`);
    process.exitCode = 2;
  }
}

async function main() {
  if (process.env.CI !== undefined || process.env.VERCEL !== undefined) {
    throw new BenchRefusal("takeoff:bench refuses to start with CI or VERCEL set: it reads private plans through a local ChatGPT profile.");
  }
  const args = parseBenchArgs(process.argv.slice(2));
  if (args.pipeline === "vector") {
    await mainVector(args);
    return;
  }
  const owner = parseBenchOwner(process.env.TAKEOFF_BENCH_CHATGPT_OWNER);
  assertOwnCode();
  await assertOutput(args.out);
  const startedAt = new Date().toISOString();
  const loadBefore = os.loadavg();
  if (args.mode === "triage") return runTriage(args, owner, startedAt, loadBefore);
  const dataset = await loadBenchDataset(args.dataset, args.docs);
  const scopes = buildScoreScopes(dataset.truthFiles, dataset.manifest.documents);
  const triage = args.pagesFrom ? await readTriageReport(args.pagesFrom) : null;
  const { documents: read, selection, pageMaps } = await selectBenchPages(dataset.selected, { pages: args.pages, triage });
  const plans = await planBenchDocuments(read.map(({ document, bytes }) => ({
    id: document.id, lot: document.lot, role: document.role === "reserve" ? "reserve" as const : "truth" as const,
    bytes, sha256: document.sha256 as string,
  })));
  const checked = await preflight(owner, plans, benchCouples(args.models, args.efforts), args.repeat);
  let run: BenchRunResult;
  if ("stopped" in checked) {
    run = checked.stopped;
  } else {
    const { profile: selection, overrides } = checked;
    run = await runTakeoffBench({
      plans,
      couples: checked.couples,
      repeat: args.repeat,
      // A couple without its checked override would be listed again on each call, never sent unchecked.
      call: (options, couple) => callLocalChatGptStructured(owner, options, selection, couple.override
        ? overrides.get(coupleId(couple)) ?? { model: couple.model, reasoningEffort: couple.reasoningEffort } : undefined),
      log: (line) => console.error(line),
    });
  }
  const status = git(["status", "--porcelain"]);
  const metadata: BenchReportMetadata = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    command: ["node", ...process.execArgv, scriptPath(), ...process.argv.slice(2)],
    cwd: process.cwd(),
    env: recordedEnv(RUN_ENV),
    node: process.version,
    commit: git(["rev-parse", "HEAD"]),
    dirty: status === null ? null : status.length > 0,
    dataset: datasetMetadata(dataset),
    host: host(loadBefore),
    page_selection: selection,
    profile: {
      model: checked.profile?.model ?? null,
      reasoning_effort: checked.profile?.reasoningEffort ?? null,
      unchanged: checked.profile ? await profileUnchanged(owner, checked.profile) : null,
    },
  };
  const report = buildBenchReport({
    metadata, run: remapBenchRunPages(run, pageMaps), scopes, noise: dataset.noise,
    excludedDocuments: selection.documents.filter((entry) => entry.excluded).map((entry) => entry.id),
  });
  await writeFile(path.join(args.out, "report.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  await writeFile(path.join(args.out, "report.md"), renderBenchReportMarkdown(report), { flag: "wx" });
  console.log(`Takeoff bench ${run.status}: ${run.calls_done}/${run.calls_planned} calls, reports in ${args.out}.`);
  if (metadata.profile.unchanged === false) console.error("The ChatGPT profile changed during the run: see report.md.");
  if (run.stop) {
    console.error(`Stopped (${run.stop.kind}): ${run.stop.reason}, ${run.stop.error.code ?? run.stop.error.name}: ${run.stop.error.message}`);
    process.exitCode = run.stop.kind === "provider" ? 2 : 1;
  }
}

void main().catch((error: unknown) => {
  if (error instanceof BenchUsageError) console.error(`${error.message}\n${BENCH_USAGE}`);
  else if (error instanceof BenchDatasetError || error instanceof BenchRefusal) console.error(error.message);
  else console.error(`takeoff:bench crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
