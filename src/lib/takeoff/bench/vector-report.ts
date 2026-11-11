import type { DecisionsTokenBudgetSnapshot } from "@/lib/ai/decisions-budget";
import { measuredKey, type MeasuredLengths } from "@/lib/takeoff/bench/measured";
import type { BenchReport } from "@/lib/takeoff/bench/report";
import { toleranceOf, withinTolerance, type KeyScore, type ScopeScore } from "@/lib/takeoff/bench/score";
import { CLASSIFIED_DECISIONS_CONFIDENCE } from "@/lib/takeoff/vectors/classify";
import type { VectorBenchPass } from "@/lib/takeoff/bench/vector-run";

// Comparison of the vector reading with the level C baseline (TI-662
// acceptance): per scope (document) and in total, lengths (network keys in ml)
// and surfaces (m2) apart, over the scored keys (observable on the plan, not
// ambiguous): the share within tolerance and the median relative error, a
// missed key counting 100 %. Each is the median over the passes of its run.
// Lengths gain when the share is strictly higher and the error strictly lower;
// surfaces when neither regresses. Totals use the scopes scored by both runs
// in all their passes, the others are listed. The baseline is re-scored with
// the current scorer, so both sides use the same rules. report.md prints shares and
// errors, never a quantity. With Decisions (TI-662 L3c), per document: calls
// by kind, tokens of the calls that report usage, latency of the calls and of
// the renders apart (nearest rank), answers classified (≥ 0.8), proposed or
// left « à revoir », and the stops; report.md never prints a group id, colour
// or layer (report.json keeps each group's answer).
//
// Vector and raster slices (TI-678, decision Q8 of 5 Nov): added after the v1
// results were read, beside the global figure, which stays the headline and is
// computed as before. A plan is in the slice of its pages in the vector run:
// vector when none is raster, raster when all are; a plan with both, or with a
// failed page, is in neither and is named. Per slice, lengths and surfaces
// apart: the coverage (scored keys read over scored keys), the median error
// on the keys read (nothing when none was read), the keys within tolerance,
// and the silent errors (keys at high confidence in error, when the run
// classed its lines). On the raster slice the vector reading abstains: its
// page goes to a human, and the lines the run copies there from the baseline
// are the baseline's reading, never a success of the vectors. The interval is
// taken over the plans of the slice (lowest and highest plan), each plan the
// median of its passes; a single plan has none.
//
// Lengths judged on the hand measurement (TI-662, decision of 11 Nov): added
// after the v1 results were read, beside the figures judged on the devis, which
// stay as they are. On the plans measured along the drawn line (measured.ts),
// the length each run read on a scored key is compared with the measurement
// instead of the devis, same tolerance, a missed key 100 %; the keys without
// measurement are left out, on both sides. The section also gives how far the
// devis is from the measurement on those keys (median, signed): it is what the
// judgment on the devis asks of a reading beyond the drawing.

export type KindMetrics = { keys: number; within: number | null; share: number | null; median_error: number | null };
export type SideMetrics = { lengths: KindMetrics; surfaces: KindMetrics };
export type ScopeComparison = {
  scope: string;
  documents: string[];
  lot: string;
  role: "truth" | "reserve";
  vector: SideMetrics;
  baseline: SideMetrics;
  lengths_gain: boolean | null;
  surfaces_no_regression: boolean | null;
};
export type ScopeSlice = "vector" | "raster" | "mixed";
export type SliceKind = {
  /** Scored keys of the slice. */
  keys: number;
  /** Scored keys read (within or out of tolerance), and their share of the scored keys. */
  read: number | null;
  coverage: number | null;
  within: number | null;
  /** Median relative error over the keys read; null when none was read. */
  median_error_read: number | null;
  /** Lowest and highest plan of the slice, each the median of its passes; null with fewer than two plans. */
  by_plan: { plans: number; coverage: [number, number] | null; median_error_read: [number, number] | null } | null;
};
export type SliceSide = {
  /** The reading hands the slice's pages to a human: its keys are counted, nothing is read. */
  abstained: boolean;
  lengths: SliceKind;
  surfaces: SliceKind;
  /** Keys at high confidence in error; null when a plan of the slice was scored without classing its lines. */
  silent_errors: number | null;
};
export type SliceComparison = {
  plans: string[];
  vector: SliceSide;
  baseline: SliceSide;
  /** The acceptance rule on the slice's keys (share strictly higher, median error strictly lower, a missed key 100 %); null on an abstention. */
  lengths_gain: boolean | null;
};
export type VectorComparison = {
  passes: { vector: number; baseline: number };
  scopes: ScopeComparison[];
  totals: Record<"reserve" | "truth" | "all", { vector: SideMetrics; baseline: SideMetrics; lengths_gain: boolean | null; surfaces_no_regression: boolean | null }>;
  /** Scopes scored by the vector run but not by both runs in every pass: shown per scope, left out of the totals. */
  left_out_of_totals: string[];
  /** Vector and raster slices, added after the v1 results were read (TI-678); null when the pages of the vector run are not given. */
  slices: {
    declared: "added_after_v1_results";
    totals: Record<"reserve" | "truth" | "all", Record<"vector" | "raster", SliceComparison>>;
    /** Plans of the totals in neither slice: vector and raster pages, or a failed page. */
    left_out: string[];
  } | null;
  /** Lengths judged on the hand measurement of the plans that have one (TI-662); null when no measurement is given. */
  measured: {
    declared: "added_after_v1_results";
    totals: Record<"reserve" | "truth" | "all", MeasuredJudgment>;
    /** Scopes measured on some of their plans only: left to their devis. */
    partial: string[];
  } | null;
};
export type MeasuredJudgment = {
  plans: string[];
  vector: KindMetrics;
  baseline: KindMetrics;
  /** The acceptance rule on the measured keys: share strictly higher, median error strictly lower. */
  lengths_gain: boolean | null;
  /** Median over the measured keys of (devis − measurement) / measurement. */
  devis_gap: number | null;
};

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function round(value: number | null) {
  return value === null ? null : Math.round(value * 10000) / 10000;
}

function isLength(key: KeyScore) {
  return key.key.kind === "network" && key.key.unit === "ml";
}

function isSurface(key: KeyScore) {
  return key.key.kind === "surface";
}

function keyError(key: KeyScore) {
  if (key.status === "missed" || key.relative_deviation === null) return 1;
  return Math.abs(key.relative_deviation);
}

function kindOfPass(keys: readonly KeyScore[]) {
  const scored = keys.filter((key) => key.status !== "out_of_score");
  if (scored.length === 0) return null;
  return { keys: scored.length, within: scored.filter((key) => key.status === "ok").length, error: median(scored.map(keyError)) as number };
}

function metrics(passes: ReadonlyArray<readonly KeyScore[]>, filter: (key: KeyScore) => boolean): KindMetrics {
  const perPass = passes.map((keys) => kindOfPass(keys.filter(filter))).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  if (perPass.length === 0) return { keys: 0, within: null, share: null, median_error: null };
  return {
    keys: perPass[0].keys,
    within: median(perPass.map((entry) => entry.within)),
    share: round(median(perPass.map((entry) => entry.within / entry.keys))),
    median_error: round(median(perPass.map((entry) => entry.error))),
  };
}

function side(passes: ReadonlyArray<readonly KeyScore[]>): SideMetrics {
  return { lengths: metrics(passes, isLength), surfaces: metrics(passes, isSurface) };
}

function verdicts(vector: SideMetrics, baseline: SideMetrics) {
  const lengths = vector.lengths.share === null || baseline.lengths.share === null || vector.lengths.median_error === null || baseline.lengths.median_error === null
    ? null : vector.lengths.share > baseline.lengths.share && vector.lengths.median_error < baseline.lengths.median_error;
  const surfaces = vector.surfaces.share === null || baseline.surfaces.share === null || vector.surfaces.median_error === null || baseline.surfaces.median_error === null
    ? null : vector.surfaces.share >= baseline.surfaces.share && vector.surfaces.median_error <= baseline.surfaces.median_error;
  return { lengths_gain: lengths, surfaces_no_regression: surfaces };
}

function scoredScopes(report: BenchReport) {
  return report.couples.flatMap((couple) => couple.passes).map((pass) => pass.scopes.filter((scope) => scope.status === "scored"));
}

/**
 * The slice of each scope from the pages of its documents in the vector run: « vector » when no page is raster,
 * « raster » when every page is, « mixed » otherwise (pages of both kinds, a failed page, or passes that disagree).
 * A scope none of whose documents ran has no slice.
 */
export function scopeSlices(passes: readonly VectorBenchPass[], scopes: ReadonlyArray<Pick<ScopeScore, "id" | "documents">>): Map<string, ScopeSlice> {
  const slices = new Map<string, ScopeSlice>();
  for (const scope of scopes) {
    const perPass = passes.flatMap((pass): ScopeSlice[] => {
      const pages = pass.documents.filter((document) => scope.documents.includes(document.id)).flatMap((document) => document.pages);
      if (pages.length === 0) return [];
      if (pages.some((page) => page.status === "failed")) return ["mixed"];
      const raster = pages.filter((page) => page.reading?.mode === "raster" || page.raster_items_from_baseline !== null).length;
      return [raster === 0 ? "vector" : raster === pages.length ? "raster" : "mixed"];
    });
    if (perPass.length > 0) slices.set(scope.id, new Set(perPass).size === 1 ? perPass[0] : "mixed");
  }
  return slices;
}

const EMPTY_SLICE_KIND: SliceKind = { keys: 0, read: null, coverage: null, within: null, median_error_read: null, by_plan: null };

function sliceKindOfPass(keys: readonly KeyScore[]) {
  const scored = keys.filter((key) => key.status !== "out_of_score");
  if (scored.length === 0) return null;
  const read = scored.filter((key) => key.status !== "missed");
  return { keys: scored.length, read: read.length, within: scored.filter((key) => key.status === "ok").length, error: median(read.map(keyError)) };
}

/** Coverage, keys within tolerance and median error on the keys read, each the median over the passes. */
function sliceMetrics(passes: ReadonlyArray<readonly KeyScore[]>, filter: (key: KeyScore) => boolean): Omit<SliceKind, "by_plan"> {
  const perPass = passes.map((keys) => sliceKindOfPass(keys.filter(filter))).filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  if (perPass.length === 0) return { keys: 0, read: null, coverage: null, within: null, median_error_read: null };
  return {
    keys: perPass[0].keys, read: median(perPass.map((entry) => entry.read)), coverage: round(median(perPass.map((entry) => entry.read / entry.keys))),
    within: median(perPass.map((entry) => entry.within)),
    median_error_read: round(median(perPass.flatMap((entry) => (entry.error === null ? [] : [entry.error])))),
  };
}

function range(values: ReadonlyArray<number | null>): [number, number] | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : [Math.min(...known), Math.max(...known)];
}

/** One side of a slice: its plans' scopes per pass (a pass may lack a plan the totals already left out). */
function sliceSide(passes: ScopeScore[][], plans: readonly string[], abstained: boolean): SliceSide {
  const inSlice = passes.map((scopes) => scopes.filter((scope) => plans.includes(scope.id)));
  const pooled = inSlice.map((scopes) => scopes.flatMap((scope) => scope.keys));
  const kind = (filter: (key: KeyScore) => boolean): SliceKind => {
    const total = sliceMetrics(pooled, filter);
    if (abstained) return { ...EMPTY_SLICE_KIND, keys: total.keys };
    const perPlan = plans.map((plan) => sliceMetrics(inSlice.map((scopes) => scopes.filter((scope) => scope.id === plan).flatMap((scope) => scope.keys)), filter))
      .filter((entry) => entry.keys > 0);
    return { ...total, by_plan: perPlan.length < 2 ? null
      : { plans: perPlan.length, coverage: range(perPlan.map((entry) => entry.coverage)), median_error_read: range(perPlan.map((entry) => entry.median_error_read)) } };
  };
  const classed = plans.length > 0 && inSlice.every((scopes) => scopes.every((scope) => scope.confidence !== undefined));
  const silent = classed ? median(inSlice.map((scopes) => scopes.reduce((sum, scope) => sum + (scope.confidence?.keys_high_confidence_error ?? 0), 0))) : null;
  return { abstained, lengths: kind(isLength), surfaces: kind(isSurface), silent_errors: abstained ? null : silent };
}

/** The scored length keys of a scope that have a measurement, judged on it: same reading, the measurement as the expected length. */
function againstMeasurement(keys: readonly KeyScore[], lengths: ReadonlyMap<string, number> | undefined): KeyScore[] {
  return keys.flatMap((key): KeyScore[] => {
    const measured = isLength(key) && key.status !== "out_of_score" ? lengths?.get(measuredKey(key.key)) : undefined;
    if (measured === undefined) return [];
    const judged = { ...key, expected: measured, tolerance: toleranceOf("ml", measured) };
    if (key.status === "missed" || key.actual === null) return [{ ...judged, status: "missed", relative_deviation: -1 }];
    return [{ ...judged, status: withinTolerance("ml", measured, key.actual) ? "ok" : "out_of_tolerance", relative_deviation: (key.actual - measured) / measured }];
  });
}

export function compareVectorWithBaseline(vector: BenchReport, baseline: BenchReport,
  { slices, measured }: { slices?: ReadonlyMap<string, ScopeSlice>; measured?: MeasuredLengths } = {}): VectorComparison {
  const vectorPasses = scoredScopes(vector);
  const baselinePasses = scoredScopes(baseline);
  const ids = [...new Set(vectorPasses.flat().map((scope) => scope.id))].sort();
  const keysOf = (passes: ScopeScore[][], id: string) => passes.map((scopes) => scopes.find((scope) => scope.id === id)?.keys ?? [])
    .filter((_, index) => passes[index].some((scope) => scope.id === id));
  const scopes: ScopeComparison[] = ids.map((id) => {
    const reference = vectorPasses.flat().find((scope) => scope.id === id) as ScopeScore;
    const vectorSide = side(keysOf(vectorPasses, id));
    const baselineSide = side(keysOf(baselinePasses, id));
    return { scope: id, documents: reference.documents, lot: reference.lot, role: reference.role, vector: vectorSide, baseline: baselineSide,
      ...verdicts(vectorSide, baselineSide) };
  });
  // Totals compare the same keys: the scopes scored on both sides in every pass of each run (a scope one
  // side lost to a timeout or never read would count on the other side only).
  const scoredEverywhere = (passes: ScopeScore[][]) => new Set(ids.filter((id) => passes.length > 0 && passes.every((scopes) => scopes.some((scope) => scope.id === id))));
  const vectorEverywhere = scoredEverywhere(vectorPasses), baselineEverywhere = scoredEverywhere(baselinePasses);
  const common = ids.filter((id) => vectorEverywhere.has(id) && baselineEverywhere.has(id));
  const total = (role: "reserve" | "truth" | "all") => {
    const pick = (passes: ScopeScore[][]) => passes.map((scopes) => scopes.filter((scope) => common.includes(scope.id) && (role === "all" || scope.role === role))
      .flatMap((scope) => scope.keys));
    const vectorSide = side(pick(vectorPasses));
    const baselineSide = side(pick(baselinePasses));
    return { vector: vectorSide, baseline: baselineSide, ...verdicts(vectorSide, baselineSide) };
  };
  // Slices use the plans of the totals (scored on both sides in every pass), so each compares the same keys.
  const roleOf = (id: string) => (vectorPasses.flat().find((scope) => scope.id === id) as ScopeScore).role;
  const slice = (role: "reserve" | "truth" | "all", name: "vector" | "raster"): SliceComparison => {
    const plans = common.filter((id) => slices?.get(id) === name && (role === "all" || roleOf(id) === role));
    const pick = (passes: ScopeScore[][]) => passes.map((scopes) => scopes.filter((scope) => plans.includes(scope.id)).flatMap((scope) => scope.keys));
    return {
      plans, vector: sliceSide(vectorPasses, plans, name === "raster"), baseline: sliceSide(baselinePasses, plans, false),
      lengths_gain: name === "raster" ? null : verdicts(side(pick(vectorPasses)), side(pick(baselinePasses))).lengths_gain,
    };
  };
  const slicesOf = (role: "reserve" | "truth" | "all") => ({ vector: slice(role, "vector"), raster: slice(role, "raster") });
  // The measured judgment uses the plans of the totals too, and on each the keys that have a measurement.
  const judgment = (role: "reserve" | "truth" | "all"): MeasuredJudgment => {
    const plans = common.filter((id) => measured?.by_scope.has(id) && (role === "all" || roleOf(id) === role));
    const pick = (passes: ScopeScore[][]) => passes.map((scopes) => scopes.filter((scope) => plans.includes(scope.id))
      .flatMap((scope) => againstMeasurement(scope.keys, measured?.by_scope.get(scope.id))));
    const vectorSide = metrics(pick(vectorPasses), isLength), baselineSide = metrics(pick(baselinePasses), isLength);
    const gaps = (vectorPasses[0] ?? []).filter((scope) => plans.includes(scope.id)).flatMap((scope) => scope.keys.flatMap((key) => {
      const [judged] = againstMeasurement([key], measured?.by_scope.get(scope.id));
      return judged && key.expected !== null && judged.expected ? [(key.expected - judged.expected) / judged.expected] : [];
    }));
    const none = { keys: 0, within: null, share: null, median_error: null };
    return { plans, vector: vectorSide, baseline: baselineSide, devis_gap: round(median(gaps)),
      lengths_gain: verdicts({ lengths: vectorSide, surfaces: none }, { lengths: baselineSide, surfaces: none }).lengths_gain };
  };
  return {
    passes: { vector: vectorPasses.length, baseline: baselinePasses.length },
    scopes, totals: { reserve: total("reserve"), truth: total("truth"), all: total("all") },
    left_out_of_totals: ids.filter((id) => !common.includes(id)),
    slices: slices ? {
      declared: "added_after_v1_results", totals: { reserve: slicesOf("reserve"), truth: slicesOf("truth"), all: slicesOf("all") },
      left_out: common.filter((id) => slices.get(id) !== "vector" && slices.get(id) !== "raster"),
    } : null,
    measured: measured ? {
      declared: "added_after_v1_results", totals: { reserve: judgment("reserve"), truth: judgment("truth"), all: judgment("all") },
      partial: [...measured.partial],
    } : null,
  };
}

function share(metrics: KindMetrics) {
  if (metrics.share === null) return "–";
  return `${(metrics.share * 100).toFixed(0)} % (${metrics.within} / ${metrics.keys}), erreur médiane ${((metrics.median_error ?? 0) * 100).toFixed(0)} %`;
}

function verdict(value: boolean | null, yes: string, no: string) {
  return value === null ? "–" : value ? yes : no;
}

function table(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null>>) {
  if (rows.length === 0) return ["_(aucune ligne)_"];
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => (cell === null ? "–" : String(cell))).join(" | ")} |`)];
}

function nearestRank(values: readonly number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function seconds(ms: number | null) {
  return ms === null ? "–" : (ms / 1000).toFixed(2);
}

/** Per document, over every pass: extraction (child process) and reading durations, peak memory of the extraction process. */
export function vectorTimings(passes: readonly VectorBenchPass[]) {
  const ids = [...new Set(passes.flatMap((pass) => pass.documents.map((document) => document.id)))];
  return ids.map((id) => {
    const pages = passes.flatMap((pass) => pass.documents.filter((document) => document.id === id).flatMap((document) => document.pages));
    const read = pages.flatMap((page) => (page.reading ? [page.reading] : []));
    const extraction = read.map((reading) => reading.timings.total_ms);
    const reading = read.map((reading) => reading.timings.reading_ms);
    return {
      document: id, samples: pages.length, failed: pages.filter((page) => page.status === "failed").length,
      extraction_ms: { p50: nearestRank(extraction, 50), p95: nearestRank(extraction, 95), raw: extraction },
      reading_ms: { p50: nearestRank(reading, 50), p95: nearestRank(reading, 95), raw: reading },
      operators: read[0]?.counts.operators ?? null, stroke_paths: read[0]?.counts.strokePaths ?? null,
      max_rss_mb: read.length ? Math.round(Math.max(...read.map((entry) => entry.memory.max_rss_kb)) / 1024) : null,
    };
  });
}

/** Per document, over every pass: the Decisions calls, tokens, latencies, answers and stops of its pages (empty without Decisions). */
type DecisionsPage = { pass: number; page: number; decisions: NonNullable<VectorBenchPass["documents"][number]["pages"][number]["decisions"]> };

function decisionsPages(passes: readonly VectorBenchPass[], id: string | null): DecisionsPage[] {
  return passes.flatMap((pass) => pass.documents.filter((document) => id === null || document.id === id)
    .flatMap((document) => document.pages.flatMap((page) => (page.decisions ? [{ pass: pass.pass, page: page.page, decisions: page.decisions }] : []))));
}

/** The Decisions of some pages: calls by kind, tokens of the calls with usage, latency of calls and renders apart, answers, stops. */
function summarizeDecisions(document: string | null, pages: readonly DecisionsPage[]) {
  const calls = pages.flatMap((entry) => entry.decisions.calls);
  const answers = pages.flatMap((entry) => entry.decisions.answers);
  const latency = calls.map((call) => call.latency_ms);
  const renders = pages.flatMap((entry) => [...(entry.decisions.render.legend_ms === null ? [] : [entry.decisions.render.legend_ms]), ...entry.decisions.render.sheets_ms]);
  const sum = (pick: (usage: NonNullable<(typeof calls)[number]["usage"]>) => number) => calls.reduce((total, call) => total + (call.usage ? pick(call.usage) : 0), 0);
  return {
    document, pages: pages.length,
    calls: { batch: calls.filter((call) => call.kind === "batch").length, dedicated: calls.filter((call) => call.kind === "dedicated").length,
      without_usage: calls.filter((call) => call.usage === null).length },
    tokens: { input: sum((usage) => usage.input_tokens), output: sum((usage) => usage.output_tokens), total: sum((usage) => usage.total_tokens) },
    latency_ms: { p50: nearestRank(latency, 50), p95: nearestRank(latency, 95), raw: latency },
    render_ms: { p50: nearestRank(renders, 50), p95: nearestRank(renders, 95), raw: renders },
    candidates: pages.reduce((total, entry) => total + entry.decisions.candidates, 0),
    left_out: pages.reduce((total, entry) => total + entry.decisions.left_out, 0),
    answers: (() => {
      // As isClassified reads them: « autre » is never classified; every candidate without such an answer (unanswered,
      // refused, « autre », or never asked: images not drawn, budget refused, a failed call or a stop) is to review.
      const proposed = answers.filter((answer) => answer.status === "answered" && answer.class !== null && answer.class !== "autre");
      const classified = proposed.filter((answer) => (answer.confidence ?? 0) >= CLASSIFIED_DECISIONS_CONFIDENCE).length;
      const proposals = proposed.length - classified;
      const candidates = pages.reduce((total, entry) => total + entry.decisions.candidates, 0);
      return { classified, proposals, review: Math.max(0, candidates - classified - proposals) };
    })(),
    stops: pages.flatMap((entry) => (entry.decisions.stop ? [{ pass: entry.pass, page: entry.page, reason: entry.decisions.stop.reason }] : [])),
  };
}

export function vectorDecisionsSummary(passes: readonly VectorBenchPass[]) {
  const ids = [...new Set(passes.flatMap((pass) => pass.documents.map((document) => document.id)))];
  return ids.flatMap((id) => {
    const pages = decisionsPages(passes, id);
    return pages.length === 0 ? [] : [{ ...summarizeDecisions(id, pages), document: id }];
  });
}

/** The same over the whole run (every document and pass); null when no page asked Decisions. */
export function vectorDecisionsTotal(passes: readonly VectorBenchPass[]) {
  const pages = decisionsPages(passes, null);
  return pages.length === 0 ? null : summarizeDecisions(null, pages);
}

function percent(value: number | null) {
  return value === null ? "–" : `${(value * 100).toFixed(0)} %`;
}

function sliceCell(kind: SliceKind, abstained: boolean) {
  if (kind.keys === 0) return "–";
  if (abstained) return `abstention (${kind.keys} clés)`;
  const interval = kind.by_plan
    ? `, par plan (${kind.by_plan.plans}) : couverture ${kind.by_plan.coverage ? kind.by_plan.coverage.map(percent).join(" à ") : "–"}, `
      + `erreur ${kind.by_plan.median_error_read ? kind.by_plan.median_error_read.map(percent).join(" à ") : "–"}`
    : "";
  return `couverture ${percent(kind.coverage)} (${kind.read} / ${kind.keys}), erreur médiane des clés lues ${percent(kind.median_error_read)}, `
    + `${kind.within} dans la tolérance${interval}`;
}

/** The slices of the comparison: shares and counts only, declared as added after the v1 results. */
function renderSlices(slices: NonNullable<VectorComparison["slices"]>) {
  const lines = ["### Tranches vecteur et raster (ajoutées après lecture des résultats v1)", "",
    "Le chiffre global ci-dessus reste le chiffre de tête. Couverture : clés notées lues ; l’erreur médiane ne porte que sur les clés lues. "
    + "Une page raster est confiée à un humain : la lecture vectorielle s’y abstient, ce n’est jamais un succès. "
    + "Erreurs silencieuses : clés à haute confiance en erreur. Intervalle : plan le plus bas et le plus haut de la tranche.", ""];
  const silent = (side: SliceSide) => (side.abstained ? "abstention" : side.silent_errors === null ? "–" : String(side.silent_errors));
  const rows = (["reserve", "truth", "all"] as const).flatMap((role) => (["vector", "raster"] as const).map((name) => {
    const entry = slices.totals[role][name];
    return [`**${role === "reserve" ? "Réserve" : role === "truth" ? "Hors réserve" : "Tous"}**, ${name === "vector" ? "vecteur" : "raster"}`, entry.plans.length,
      sliceCell(entry.vector.lengths, entry.vector.abstained), sliceCell(entry.baseline.lengths, false),
      entry.vector.abstained ? "abstention" : verdict(entry.lengths_gain, "gain", "pas de gain"),
      sliceCell(entry.vector.surfaces, entry.vector.abstained), sliceCell(entry.baseline.surfaces, false),
      `${silent(entry.vector)} / ${silent(entry.baseline)}`];
  }));
  lines.push(...table(["Tranche", "Plans", "Longueurs, vecteurs", "Longueurs, baseline", "Longueurs", "Surfaces, vecteurs", "Surfaces, baseline",
    "Erreurs silencieuses (vecteurs / baseline)"], rows), "");
  if (slices.left_out.length > 0) lines.push(`Hors tranches (pages vecteur et raster mêlées, ou page en échec) : ${slices.left_out.join(", ")}.`, "");
  return lines;
}

function renderMeasured(measured: NonNullable<VectorComparison["measured"]>) {
  const lines = ["### Longueurs jugées à la mesure au trait (ajoutée après lecture des résultats v1)", "",
    "Sur les plans mesurés à la main le long de l’axe du tuyau dessiné, en plan, sans chute ni majoration : la longueur lue est comparée à la mesure "
    + "au lieu du devis, même tolérance, une clé manquée compte 100 %. Seules les clés mesurées sont comptées, des deux côtés. "
    + "Les chiffres jugés au devis ci-dessus ne changent pas. Écart du devis : médiane de (devis − mesure) / mesure sur ces clés.", ""];
  const gap = (value: number | null) => (value === null ? "–" : `${value >= 0 ? "+" : "−"}${(Math.abs(value) * 100).toFixed(0)} %`);
  lines.push(...table(["Périmètre", "Plans mesurés", "Longueurs, vecteurs", "Longueurs, baseline", "Longueurs", "Écart médian du devis à la mesure"],
    (["reserve", "truth", "all"] as const).map((role) => {
      const entry = measured.totals[role];
      return [role === "reserve" ? "**Réserve**" : role === "truth" ? "**Hors réserve**" : "**Tous**", entry.plans.length, share(entry.vector),
        share(entry.baseline), verdict(entry.lengths_gain, "gain", "pas de gain"), gap(entry.devis_gap)];
    })), "");
  if (measured.partial.length > 0) lines.push(`Mesurés en partie, laissés au devis (un plan du périmètre n’a pas de mesure) : ${measured.partial.join(", ")}.`, "");
  return lines;
}

/** report.md sections of a vector run: page readings (codes and counts only), Decisions when used, and the comparison. */
export function renderVectorSections(passes: readonly VectorBenchPass[], comparison: VectorComparison | null,
  decisions: { budget: DecisionsTokenBudgetSnapshot } | null = null) {
  const lines: string[] = ["## Lecture vectorielle par page (passe 1)", ""];
  const first = passes[0];
  lines.push(...table(["Document", "Page", "Mode", "Échelle", "Cotes (cohérentes / lues)", "Légende (codes)", "Groupes (visibles / classés / réseau)",
    "Quasi-blancs classés réseau", "Détection", "Libellés (rattachés / lus, superposés, incomplets)", "Surfaces (avec polygone / imprimées)",
    "Écart médian aire / imprimée", "Extraction (s)", "Lecture (s)"], (first?.documents ?? []).flatMap((document) => document.pages.map((page) => {
    const reading = page.reading;
    if (!reading) return [document.id, page.page, `échec (${page.error?.name ?? "?"})`, null, null, null, null, null, null, null, null, null, null, null];
    const deviations = reading.surfaces.flatMap((surface) => (surface.deviation === null ? [] : [Math.abs(surface.deviation)]));
    const labels = reading.networks?.labels;
    return [
      document.id, page.page, reading.mode + (page.raster_items_from_baseline === null ? "" : ` (niveau C : ${page.raster_items_from_baseline} items)`),
      `${reading.scale.status}${reading.scale.reason ? ` (${reading.scale.reason})` : ""}${reading.scale.denominator ? ` 1/${reading.scale.denominator}` : ""}`,
      `${reading.scale.cotes.filter((cote) => cote.consistent).length} / ${reading.scale.cotes.length}`,
      reading.legend.entries.map((entry) => entry.network).filter((code, index, all) => all.indexOf(code) === index).join(", ") || "–",
      `${reading.counts.groups_visible} / ${reading.groups_classified} / ${reading.groups_network}`,
      reading.near_white_network_groups,
      reading.detection === null ? "–" : `${(reading.detection * 100).toFixed(1)} %`,
      labels ? `${labels.attached} / ${labels.blocks}, ${labels.superposed}, ${labels.incomplete}` : "–",
      `${reading.surfaces.filter((surface) => surface.polygon_m2 !== null).length} / ${reading.surfaces.length}`,
      deviations.length ? `${((median(deviations) ?? 0) * 100).toFixed(1)} %` : "–",
      (reading.timings.total_ms / 1000).toFixed(2), (reading.timings.reading_ms / 1000).toFixed(2),
    ];
  }))), "");
  lines.push(`## Durées par page, toutes passes (${passes.length})`, "");
  lines.push(...table(["Document", "Pages lues", "Échecs", "Opérateurs", "Tracés en trait", "Extraction p50 / p95 (s)", "Lecture p50 / p95 (s)",
    "Mémoire max de l’extraction (Mo)"], vectorTimings(passes).map((entry) => [entry.document, entry.samples, entry.failed, entry.operators, entry.stroke_paths,
    `${seconds(entry.extraction_ms.p50)} / ${seconds(entry.extraction_ms.p95)}`, `${seconds(entry.reading_ms.p50)} / ${seconds(entry.reading_ms.p95)}`,
    entry.max_rss_mb])), "");
  const decided = vectorDecisionsSummary(passes);
  if (decided.length > 0) {
    lines.push(`## Decisions, classes des groupes (toutes passes, ${passes.length})`, "");
    if (decisions) {
      const { budget } = decisions;
      lines.push(`Budget : ${budget.spent_tokens} jetons sur ${budget.max_tokens}, ${budget.calls} appels (${budget.calls_without_usage} sans usage), `
        + `${budget.refused_starts} refus du plafond.`, "");
    }
    const total = vectorDecisionsTotal(passes);
    const rows = total ? [...decided, { ...total, document: "Total" }] : decided;
    lines.push(...table(["Document", "Pages", "Appels (lot / dédiés)", "Jetons (entrée / sortie / total)", "Appel p50 / p95 (s)", "Rendu p50 / p95 (s)",
      "Candidats (hors limite)", "Réponses (≥ 0,8 / < 0,8 / à revoir)", "Arrêts"], rows.map((entry) => [
      entry.document, entry.pages, `${entry.calls.batch} / ${entry.calls.dedicated}`, `${entry.tokens.input} / ${entry.tokens.output} / ${entry.tokens.total}`,
      `${seconds(entry.latency_ms.p50)} / ${seconds(entry.latency_ms.p95)}`, `${seconds(entry.render_ms.p50)} / ${seconds(entry.render_ms.p95)}`,
      `${entry.candidates} (${entry.left_out})`, `${entry.answers.classified} / ${entry.answers.proposals} / ${entry.answers.review}`,
      entry.stops.map((stop) => `p${stop.page} passe ${stop.pass} : ${stop.reason}`).join(", ") || "–",
    ])), "");
  }
  if (comparison) {
    lines.push(`## Comparaison avec la baseline niveau C (médianes de ${comparison.passes.vector} passes vectorielles et ${comparison.passes.baseline} passes de la baseline, re-notée au score courant)`, "");
    const rows = [
      ...(["reserve", "truth", "all"] as const).map((role) => {
        const entry = comparison.totals[role];
        return [role === "reserve" ? "**Réserve**" : role === "truth" ? "**Hors réserve**" : "**Tous**", share(entry.vector.lengths), share(entry.baseline.lengths),
          verdict(entry.lengths_gain, "gain", "pas de gain"), share(entry.vector.surfaces), share(entry.baseline.surfaces),
          verdict(entry.surfaces_no_regression, "sans régression", "régression")];
      }),
      ...comparison.scopes.map((scope) => [`${scope.documents.join(", ")}${scope.role === "reserve" ? " (réserve)" : ""}`, share(scope.vector.lengths),
        share(scope.baseline.lengths), verdict(scope.lengths_gain, "gain", "pas de gain"), share(scope.vector.surfaces), share(scope.baseline.surfaces),
        verdict(scope.surfaces_no_regression, "sans régression", "régression")]),
    ];
    lines.push(...table(["Périmètre", "Longueurs, vecteurs", "Longueurs, baseline", "Longueurs", "Surfaces, vecteurs", "Surfaces, baseline", "Surfaces"], rows), "");
    if (comparison.left_out_of_totals.length > 0) {
      lines.push(`Hors totaux (non notés par les deux runs à chaque passe) : ${comparison.left_out_of_totals.join(", ")}.`, "");
    }
    if (comparison.slices) lines.push(...renderSlices(comparison.slices));
    if (comparison.measured) lines.push(...renderMeasured(comparison.measured));
  }
  return lines;
}
