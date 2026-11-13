import type { DecisionsTokenBudgetSnapshot } from "@/lib/ai/decisions-budget";
import { measuredKey, type MeasuredLengths } from "@/lib/takeoff/bench/measured";
import type { BenchReport } from "@/lib/takeoff/bench/report";
import { toleranceOf, withinTolerance, type KeyLabel, type KeyScore, type ScopeScore } from "@/lib/takeoff/bench/score";
import { DECISIONS_ACCEPTED_MARGIN, LOCAL_MODEL_ACCEPTED_PROBABILITY } from "@/lib/takeoff/vectors/classify";
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
// and tokens of the calls that report usage, latency of the calls and of the
// drawings apart (nearest rank), classes from the rules, Decisions answers at
// its accepted margin, proposed under it or left « à revoir », and the stops; report.md never prints a group id, colour
// or layer (report.json keeps each group's answer).
//
// Vector and raster slices (TI-678, decision Q8 of 5 Nov): added after the v1
// results were read, beside the global figure, which stays the headline and is
// computed as before. A plan is in the slice of its pages in the vector run:
// vector when none is raster, raster when all are; a plan with both, or whose
// passes disagree, is in neither and is named (a plan with a failed page is
// not scored, so it is already out of the totals). Per slice, lengths and
// surfaces apart: the coverage (scored keys read over scored keys), the median
// error on the keys read (nothing when none was read) and the keys within
// tolerance; and, for the slice as a whole, the silent errors (keys of any
// kind at high confidence in error, when the run classed its lines). On the
// raster slice the vector reading abstains: its
// page goes to a human, and the lines the run copies there from the baseline
// are the baseline's reading, never a success of the vectors. The interval is
// taken over the plans of the slice (lowest and highest plan), each plan the
// median of its passes; a single plan has none.
//
// Lengths judged on the hand measurement (TI-662, decision of 11 Nov): added
// after the v1 results were read, beside the figures judged on the devis, which
// stay as they are. On the plans measured along the drawn line (measured.ts),
// the length each run read on a scored key is compared with the measurement
// instead of the devis, same tolerance rule (10 % of the measurement), a missed
// key 100 %; the keys without measurement are left out, on both sides, and the
// section says how many scored lengths the judged plans have. Only the plans
// of the vector slice are judged: on a raster or mixed plan the vector run
// holds the lines of the baseline, and judging them would count the baseline's
// reading as the vectors'. A measured plan that is not judged is named with
// its reason. The section also gives how far the devis is from the measurement
// on the judged keys (median, signed): it is what the judgment on the devis
// asks of a reading beyond the drawing. report.json keeps, per judged plan and
// key, the devis, the measurement and each run's reading per pass.
//
// Count keys (TI-676): a measurement beside the lengths and surfaces, with no
// verdict, that leaves every other figure as it is. Per scope, total and slice,
// each run's scored count keys (kind count, unit u as the score reads it), those
// read (an item attached), exact (the score's u tolerance), within one of the
// truth (the exact ones included) and missed; and its extra counts, the count
// keys it read that the truth lacks (false-positive groups of a count, a key
// read one DN apart from a missed key included; unreadable lines, whose key is
// unknown, are not). Each figure is the median over the passes. On the raster
// slice the vector reading abstains, as for the lengths. report.md prints
// numbers of keys, never a count of the devis or of a reading.

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
/** Count keys of a run (TI-676), each figure the median over the passes; null without a scored key (extra: without a scope). */
export type CountMetrics = {
  keys: number;
  found: number | null;
  exact: number | null;
  /** Within one of the truth, the exact keys included. */
  within_one: number | null;
  missed: number | null;
  /** Count keys read that the truth lacks: false-positive groups of a count. */
  extra: number | null;
};
export type CountSlice = {
  plans: string[];
  /** The vector reading hands the slice's pages to a human: its keys are counted, nothing is read. */
  abstained: boolean;
  vector: CountMetrics;
  baseline: CountMetrics;
};
export type CountComparison = {
  /** A measurement: no verdict, and no other figure of the comparison depends on it. */
  declared: "measurement_only";
  scopes: Array<{ scope: string; documents: string[]; role: "truth" | "reserve"; vector: CountMetrics; baseline: CountMetrics }>;
  /** On the scopes of the comparison's totals. */
  totals: Record<"reserve" | "truth" | "all", { vector: CountMetrics; baseline: CountMetrics }>;
  /** On the plans of each slice; null when the pages of the vector run are not given. */
  slices: Record<"reserve" | "truth" | "all", Record<"vector" | "raster", CountSlice>> | null;
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
    /** Plans of the totals in neither slice: vector and raster pages, or passes that disagree. */
    left_out: string[];
  } | null;
  /** Lengths judged on the hand measurement of the plans that have one (TI-662); null when no measurement is given. */
  measured: {
    declared: "added_after_v1_results";
    totals: Record<"reserve" | "truth" | "all", MeasuredJudgment>;
    /** The judged plans, key by key: what the totals stand on. */
    scopes: MeasuredScope[];
    /** Measured plans left to their devis, and why. */
    not_judged: Array<{ scope: string; reason: MeasuredNotJudged }>;
  } | null;
  /** Count keys of each run (TI-676), beside the lengths and surfaces. */
  counts: CountComparison;
};
/**
 * Why a measured plan is not judged on its measurement: its truth covers several plans; the two runs did not both
 * score it in every pass; its pages are not all vector in the vector run (or the pages are not given); none of its
 * scored lengths has a measurement.
 */
export type MeasuredNotJudged = "several_plans" | "not_in_totals" | "not_vector" | "no_measured_key";
export type MeasuredJudgment = {
  plans: string[];
  /** Scored length keys of the judged plans; `vector.keys` of them have a measurement. */
  scored_keys: number;
  vector: KindMetrics;
  baseline: KindMetrics;
  /** The acceptance rule on the measured keys: share strictly higher, median error strictly lower. */
  lengths_gain: boolean | null;
  /** Median over the measured keys of (devis − measurement) / measurement. */
  devis_gap: number | null;
};
export type MeasuredReading = { actual: number | null; status: "ok" | "out_of_tolerance" | "missed"; relative_deviation: number };
export type MeasuredScope = {
  scope: string;
  documents: string[];
  role: "truth" | "reserve";
  scored_keys: number;
  /** The scored lengths without measurement (a line left without length): left to the devis. */
  unmeasured: KeyLabel[];
  /** The scored lengths that have a measurement, with each run's reading per pass, judged on the measurement. */
  keys: Array<{ key: KeyLabel; devis: number | null; measured: number; vector: MeasuredReading[]; baseline: MeasuredReading[] }>;
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

const NO_COUNTS: CountMetrics = { keys: 0, found: null, exact: null, within_one: null, missed: null, extra: null };

function countsOfPass(scopes: readonly ScopeScore[]) {
  const scored = scopes.flatMap((scope) => scope.keys).filter((key) => key.key.kind === "count" && key.status !== "out_of_score");
  const found = scored.filter((key) => key.status !== "missed");
  return {
    keys: scored.length, found: found.length, exact: scored.filter((key) => key.status === "ok").length,
    within_one: found.filter((key) => key.status === "ok" || (key.actual !== null && key.expected !== null && Math.abs(key.actual - key.expected) <= 1 + 1e-9)).length,
    missed: scored.length - found.length,
    extra: scopes.reduce((total, scope) => total + scope.false_positives.filter((group) => group.key?.kind === "count").length, 0),
  };
}

/** The count keys of some scopes, each figure the median over the passes that hold any of them. */
function countMetrics(passes: ReadonlyArray<readonly ScopeScore[]>): CountMetrics {
  const perPass = passes.filter((scopes) => scopes.length > 0).map(countsOfPass);
  if (perPass.length === 0) return NO_COUNTS;
  const keys = perPass[0].keys;
  const of = (pick: (entry: (typeof perPass)[number]) => number) => (keys === 0 ? null : median(perPass.map(pick)));
  return { keys, found: of((entry) => entry.found), exact: of((entry) => entry.exact), within_one: of((entry) => entry.within_one),
    missed: of((entry) => entry.missed), extra: median(perPass.map((entry) => entry.extra)) };
}

function isScoredLength(key: KeyScore) {
  return isLength(key) && key.status !== "out_of_score";
}

/** The scored length keys of a scope that have a measurement, judged on it: same reading, the measurement as the expected length. */
function againstMeasurement(keys: readonly KeyScore[], lengths: ReadonlyMap<string, number> | undefined): KeyScore[] {
  return keys.flatMap((key): KeyScore[] => {
    const measured = isScoredLength(key) ? lengths?.get(measuredKey(key.key)) : undefined;
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
  const slicePlans = (role: "reserve" | "truth" | "all", name: "vector" | "raster") =>
    common.filter((id) => slices?.get(id) === name && (role === "all" || roleOf(id) === role));
  const slice = (role: "reserve" | "truth" | "all", name: "vector" | "raster"): SliceComparison => {
    const plans = slicePlans(role, name);
    const pick = (passes: ScopeScore[][]) => passes.map((scopes) => scopes.filter((scope) => plans.includes(scope.id)).flatMap((scope) => scope.keys));
    return {
      plans, vector: sliceSide(vectorPasses, plans, name === "raster"), baseline: sliceSide(baselinePasses, plans, false),
      lengths_gain: name === "raster" ? null : verdicts(side(pick(vectorPasses)), side(pick(baselinePasses))).lengths_gain,
    };
  };
  const slicesOf = (role: "reserve" | "truth" | "all") => ({ vector: slice(role, "vector"), raster: slice(role, "raster") });
  // The measured judgment uses the plans of the totals too, among them the plans of the vector slice (elsewhere the
  // vector run holds the baseline's lines), and on each the scored lengths that have a measurement.
  const lengthsOf = (id: string) => measured?.by_scope.get(id);
  const judgedKeys = (passes: ScopeScore[][], id: string) => passes.map((scopes) => againstMeasurement(scopes.find((scope) => scope.id === id)?.keys ?? [], lengthsOf(id)));
  const notJudged = (id: string): MeasuredNotJudged | null => {
    if (!common.includes(id)) return "not_in_totals";
    if (slices?.get(id) !== "vector") return "not_vector";
    return judgedKeys(vectorPasses, id)[0].length === 0 ? "no_measured_key" : null;
  };
  const measuredIds = [...(measured?.by_scope.keys() ?? [])].sort();
  const judgedPlans = measuredIds.filter((id) => notJudged(id) === null);
  const measuredScope = (id: string): MeasuredScope => {
    const reference = vectorPasses[0].find((scope) => scope.id === id) as ScopeScore;
    const scored = reference.keys.filter(isScoredLength);
    // Each key is found again by its identity in every pass of each run, never by its position.
    const readings = (passes: ScopeScore[][], identity: string) => judgedKeys(passes, id).flatMap((keys): MeasuredReading[] => {
      const judged = keys.find((key) => measuredKey(key.key) === identity);
      return judged ? [{ actual: judged.actual, status: judged.status as MeasuredReading["status"], relative_deviation: round(judged.relative_deviation) as number }] : [];
    });
    return { scope: id, documents: reference.documents, role: reference.role, scored_keys: scored.length,
      unmeasured: scored.filter((key) => lengthsOf(id)?.get(measuredKey(key.key)) === undefined).map((key) => key.key),
      keys: scored.flatMap((key) => {
        const identity = measuredKey(key.key), length = lengthsOf(id)?.get(identity);
        return length === undefined ? [] : [{ key: key.key, devis: key.expected, measured: length, vector: readings(vectorPasses, identity),
          baseline: readings(baselinePasses, identity) }];
      }) };
  };
  const measuredScopes = judgedPlans.map(measuredScope);
  // Counts (TI-676) on the same scopes as the lengths: per scope, the totals' scopes, and the plans of each slice.
  const scopesOf = (passes: ScopeScore[][], pick: (scope: ScopeScore) => boolean) => passes.map((scopes) => scopes.filter(pick));
  const countTotal = (role: "reserve" | "truth" | "all") => {
    const pick = (scope: ScopeScore) => common.includes(scope.id) && (role === "all" || scope.role === role);
    return { vector: countMetrics(scopesOf(vectorPasses, pick)), baseline: countMetrics(scopesOf(baselinePasses, pick)) };
  };
  const countSlice = (role: "reserve" | "truth" | "all", name: "vector" | "raster"): CountSlice => {
    const plans = slicePlans(role, name);
    const pick = (scope: ScopeScore) => plans.includes(scope.id);
    const vectorCounts = countMetrics(scopesOf(vectorPasses, pick));
    return { plans, abstained: name === "raster", vector: name === "raster" ? { ...NO_COUNTS, keys: vectorCounts.keys } : vectorCounts,
      baseline: countMetrics(scopesOf(baselinePasses, pick)) };
  };
  const countSlices = (role: "reserve" | "truth" | "all") => ({ vector: countSlice(role, "vector"), raster: countSlice(role, "raster") });
  const judgment = (role: "reserve" | "truth" | "all"): MeasuredJudgment => {
    const judged = measuredScopes.filter((scope) => role === "all" || scope.role === role);
    const plans = judged.map((scope) => scope.scope);
    const pick = (passes: ScopeScore[][]) => passes.map((_, pass) => plans.flatMap((id) => judgedKeys(passes, id)[pass]));
    const vectorSide = metrics(pick(vectorPasses), isLength), baselineSide = metrics(pick(baselinePasses), isLength);
    const gaps = judged.flatMap((scope) => scope.keys.flatMap((key) => (key.devis === null ? [] : [(key.devis - key.measured) / key.measured])));
    const none = { keys: 0, within: null, share: null, median_error: null };
    return { plans, scored_keys: judged.reduce((sum, scope) => sum + scope.scored_keys, 0), vector: vectorSide, baseline: baselineSide,
      devis_gap: round(median(gaps)), lengths_gain: verdicts({ lengths: vectorSide, surfaces: none }, { lengths: baselineSide, surfaces: none }).lengths_gain };
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
      scopes: measuredScopes,
      not_judged: [
        ...measured.several_plans.map((scope) => ({ scope, reason: "several_plans" as const })),
        ...measuredIds.flatMap((scope) => { const reason = notJudged(scope); return reason ? [{ scope, reason }] : []; }),
      ].sort((left, right) => (left.scope < right.scope ? -1 : left.scope > right.scope ? 1 : 0)),
    } : null,
    counts: {
      declared: "measurement_only",
      scopes: scopes.map((entry) => ({ scope: entry.scope, documents: entry.documents, role: entry.role,
        vector: countMetrics(scopesOf(vectorPasses, (scope) => scope.id === entry.scope)),
        baseline: countMetrics(scopesOf(baselinePasses, (scope) => scope.id === entry.scope)) })),
      totals: { reserve: countTotal("reserve"), truth: countTotal("truth"), all: countTotal("all") },
      slices: slices ? { reserve: countSlices("reserve"), truth: countSlices("truth"), all: countSlices("all") } : null,
    },
  };
}

function share(metrics: KindMetrics) {
  if (metrics.share === null) return "–";
  return `${(metrics.share * 100).toFixed(0)} % (${metrics.within} / ${metrics.keys}), erreur médiane ${((metrics.median_error ?? 0) * 100).toFixed(0)} %`;
}

function verdict(value: boolean | null, yes: string, no: string) {
  return value === null ? "–" : value ? yes : no;
}

export function table(headers: readonly string[], rows: ReadonlyArray<ReadonlyArray<string | number | null>>) {
  if (rows.length === 0) return ["_(aucune ligne)_"];
  return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map((cell) => (cell === null ? "–" : String(cell))).join(" | ")} |`)];
}

export function nearestRank(values: readonly number[], p: number) {
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

/** The classification of some pages: calls, tokens of the calls with usage, latency of calls and renders apart, answers (the rules' apart), stops. */
function summarizeDecisions(document: string | null, pages: readonly DecisionsPage[]) {
  const calls = pages.flatMap((entry) => entry.decisions.calls);
  const answers = pages.flatMap((entry) => entry.decisions.answers);
  const latency = calls.map((call) => call.latency_ms);
  // The page's one analysis and drawing, then each image cut from it.
  const renders = pages.flatMap((entry) => [...(entry.decisions.render.page_ms === null ? [] : [entry.decisions.render.page_ms]), ...entry.decisions.render.legends_ms,
    ...entry.decisions.render.groups_ms]);
  const sum = (pick: (usage: NonNullable<(typeof calls)[number]["usage"]>) => number) => calls.reduce((total, call) => total + (call.usage ? pick(call.usage) : 0), 0);
  return {
    document, pages: pages.length,
    calls: { batch: calls.length, without_usage: calls.filter((call) => call.usage === null).length },
    tokens: { input: sum((usage) => usage.input_tokens), output: sum((usage) => usage.output_tokens), total: sum((usage) => usage.total_tokens) },
    latency_ms: { p50: nearestRank(latency, 50), p95: nearestRank(latency, 95), raw: latency },
    render_ms: { p50: nearestRank(renders, 50), p95: nearestRank(renders, 95), raw: renders },
    candidates: pages.reduce((total, entry) => total + entry.decisions.candidates, 0),
    left_out: pages.reduce((total, entry) => total + entry.decisions.left_out, 0),
    answers: (() => {
      // As isClassified reads them: « autre » is never classified, a rule's class always is, Decisions' from its accepted
      // margin, the local plan's model's from its probability of 0.8; every candidate without such an answer (unanswered,
      // refused, « autre », « inconnu », « hors_liste », or never asked: images not drawn, budget refused, a failed call or
      // a stop) is to review.
      const proposed = answers.filter((answer) => answer.status === "answered" && answer.class !== null && answer.class !== "autre");
      const ruled = proposed.filter((answer) => answer.via === "rule").length;
      const threshold = (via: string) => (via === "local" ? LOCAL_MODEL_ACCEPTED_PROBABILITY : DECISIONS_ACCEPTED_MARGIN);
      const classified = proposed.filter((answer) => answer.via !== "rule" && (answer.confidence ?? 0) >= threshold(answer.via)).length;
      const proposals = proposed.length - ruled - classified;
      const candidates = pages.reduce((total, entry) => total + entry.decisions.candidates, 0);
      return { ruled, classified, proposals, review: Math.max(0, candidates - ruled - classified - proposals) };
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

function plural(value: number | null, one: string, many: string) {
  return (value ?? 0) >= 2 ? many : one;
}

/** Numbers of count keys, never a count of the devis or of a reading. */
function countCell(counts: CountMetrics, abstained = false) {
  if (abstained) return counts.keys === 0 ? "–" : `abstention (${counts.keys} ${plural(counts.keys, "clé", "clés")})`;
  if (counts.keys === 0) return counts.extra ? `aucune clé notée, ${counts.extra} en trop` : "–";
  return `${counts.exact} ${plural(counts.exact, "exacte", "exactes")} sur ${counts.keys}, ${counts.within_one} à ±1, `
    + `${counts.found} ${plural(counts.found, "lue", "lues")}, ${counts.missed} ${plural(counts.missed, "manquée", "manquées")}, ${counts.extra} en trop`;
}

const COUNTS_NOTE = "Comptages : clés de comptage notées (u). Exactes comme au score ; « à ±1 » compte aussi les exactes ; lues : un item rattaché "
  + "à la clé ; en trop : clés de comptage lues que la vérité n’a pas, une clé lue avec un autre DN comprise. Une mesure, sans verdict.";

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
function renderSlices(slices: NonNullable<VectorComparison["slices"]>, counts: CountComparison["slices"]) {
  const lines = ["### Tranches vecteur et raster (ajoutées après lecture des résultats v1)", "",
    "Le chiffre global ci-dessus reste le chiffre de tête. Couverture : clés notées lues ; l’erreur médiane ne porte que sur les clés lues. "
    + "Une page raster est confiée à un humain : la lecture vectorielle s’y abstient, ce n’est jamais un succès. "
    + "Erreurs silencieuses : clés à haute confiance en erreur, tous types de clés confondus. "
    + "Intervalle : plan le plus bas et le plus haut de la tranche.", ""];
  const silent = (side: SliceSide) => (side.abstained ? "abstention" : side.silent_errors === null ? "–" : String(side.silent_errors));
  const rows = (["reserve", "truth", "all"] as const).flatMap((role) => (["vector", "raster"] as const).map((name) => {
    const entry = slices.totals[role][name];
    return [`**${role === "reserve" ? "Réserve" : role === "truth" ? "Hors réserve" : "Tous"}**, ${name === "vector" ? "vecteur" : "raster"}`, entry.plans.length,
      sliceCell(entry.vector.lengths, entry.vector.abstained), sliceCell(entry.baseline.lengths, false),
      entry.vector.abstained ? "abstention" : verdict(entry.lengths_gain, "gain", "pas de gain"),
      sliceCell(entry.vector.surfaces, entry.vector.abstained), sliceCell(entry.baseline.surfaces, false),
      counts ? countCell(counts[role][name].vector, counts[role][name].abstained) : "–", counts ? countCell(counts[role][name].baseline) : "–",
      `${silent(entry.vector)} / ${silent(entry.baseline)}`];
  }));
  lines.push(...table(["Tranche", "Plans", "Longueurs, vecteurs", "Longueurs, baseline", "Longueurs", "Surfaces, vecteurs", "Surfaces, baseline",
    "Comptages, vecteurs", "Comptages, baseline", "Erreurs silencieuses (vecteurs / baseline)"], rows), "");
  if (slices.left_out.length > 0) lines.push(`Hors tranches (pages vecteur et raster mêlées, ou passes qui ne s’accordent pas) : ${slices.left_out.join(", ")}.`, "");
  return lines;
}

const NOT_JUDGED: Record<MeasuredNotJudged, string> = {
  several_plans: "vérité de plusieurs plans (une mesure se juge sur la vérité d’un seul plan)",
  not_in_totals: "non noté par les deux runs à chaque passe, ou non lancé",
  not_vector: "plan raster ou mixte (la lecture vectorielle y reprend les lignes de la baseline)",
  no_measured_key: "aucune longueur notée n’a de mesure",
};

function signedPercent(value: number | null) {
  if (value === null) return "–";
  const rounded = Math.round(Math.abs(value) * 100);
  return rounded === 0 ? "0 %" : `${value > 0 ? "+" : "−"}${rounded} %`;
}

function renderMeasured(measured: NonNullable<VectorComparison["measured"]>) {
  const lines = ["### Longueurs jugées à la mesure au trait (jugement ajouté après lecture des résultats v1)", "",
    "Sur les plans mesurés à la main le long de l’axe du tuyau dessiné, en plan, sans chute ni majoration, et lus en vecteur sur toutes leurs pages : "
    + "la longueur lue est comparée à la mesure au lieu du devis, à 10 % de la mesure, une clé manquée compte 100 %. "
    + "Seules les clés mesurées sont comptées, des deux côtés ; « Clés mesurées » les rapporte aux longueurs notées de ces plans. "
    + "Les chiffres jugés au devis ci-dessus ne changent pas. Écart du devis : médiane de (devis − mesure) / mesure sur ces clés.", ""];
  lines.push(...table(["Périmètre", "Plans jugés", "Clés mesurées / notées", "Longueurs, vecteurs", "Longueurs, baseline", "Longueurs", "Écart médian du devis à la mesure"],
    (["reserve", "truth", "all"] as const).map((role) => {
      const entry = measured.totals[role];
      return [role === "reserve" ? "**Réserve**" : role === "truth" ? "**Hors réserve**" : "**Tous**", entry.plans.length,
        entry.plans.length === 0 ? null : `${entry.vector.keys} / ${entry.scored_keys}`, share(entry.vector), share(entry.baseline),
        verdict(entry.lengths_gain, "gain", "pas de gain"), signedPercent(entry.devis_gap)];
    })), "");
  for (const reason of Object.keys(NOT_JUDGED) as MeasuredNotJudged[]) {
    const scopes = measured.not_judged.filter((entry) => entry.reason === reason).map((entry) => entry.scope);
    if (scopes.length > 0) lines.push(`Mesurés mais laissés au devis, ${NOT_JUDGED[reason]} : ${scopes.join(", ")}.`, "");
  }
  return lines;
}

/**
 * report.md sections of a vector run: page readings (codes and counts only), the groups' model when used (Decisions, or
 * with `model: "local"` the local plan's), and the comparison.
 */
export function renderVectorSections(passes: readonly VectorBenchPass[], comparison: VectorComparison | null,
  decisions: { budget: DecisionsTokenBudgetSnapshot } | null = null, options: { model?: "decisions" | "local" } = {}) {
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
  const timed = (first?.documents ?? []).flatMap((document) => document.pages.flatMap((page) => (page.durations ? [{ document: document.id, page }] : [])));
  if (timed.length > 0) {
    // TI-704 latency: where a page's time goes, the drawing begun during its keyword reading.
    const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
    lines.push("## Durées de chaque page (passe 1)", "",
      "Groupes : le classement des groupes (dessin, demandes), après la lecture par mots-clés pendant laquelle la page est déjà analysée "
      + "pour ses images. Le dessin des groupes additionne leurs temps, y compris dans des processus en parallèle.", "");
    lines.push(...table(["Document", "Page", "Extraction (s)", "Mots-clés (s)", "Groupes (s)", "Analyse de la page (s)", "Dessin des groupes (s)",
      "Appels en cours (s)", "Reste (s)", "Total (s)"], timed.map(({ document, page }) => {
      const durations = page.durations as NonNullable<typeof page.durations>;
      const render = page.decisions?.render;
      return [document, page.page, seconds(durations.extraction_ms), seconds(durations.keywords_ms), seconds(durations.groups_ms),
        seconds(render?.page_ms ?? null), render && render.groups_ms.length ? seconds(sum(render.groups_ms)) : "–",
        seconds(page.decisions?.calls_ms ?? null), seconds(durations.rest_ms),
        seconds(durations.total_ms)];
    })), "");
  }
  lines.push(`## Durées par page, toutes passes (${passes.length})`, "");
  lines.push(...table(["Document", "Pages lues", "Échecs", "Opérateurs", "Tracés en trait", "Extraction p50 / p95 (s)", "Lecture p50 / p95 (s)",
    "Mémoire max de l’extraction (Mo)"], vectorTimings(passes).map((entry) => [entry.document, entry.samples, entry.failed, entry.operators, entry.stroke_paths,
    `${seconds(entry.extraction_ms.p50)} / ${seconds(entry.extraction_ms.p95)}`, `${seconds(entry.reading_ms.p50)} / ${seconds(entry.reading_ms.p95)}`,
    entry.max_rss_mb])), "");
  const decided = vectorDecisionsSummary(passes);
  if (decided.length > 0) {
    const local = options.model === "local";
    lines.push(`## ${local ? "ChatGPT local" : "Decisions"}, classes des groupes (toutes passes, ${passes.length})`, "");
    if (decisions) {
      const { budget } = decisions;
      lines.push(`Budget : ${budget.spent_tokens} jetons sur ${budget.max_tokens}, ${budget.calls} appels (${budget.calls_without_usage} sans usage), `
        + `${budget.refused_starts} refus du plafond.`, "");
    }
    const total = vectorDecisionsTotal(passes);
    const rows = total ? [...decided, { ...total, document: "Total" }] : decided;
    const margin = String(local ? LOCAL_MODEL_ACCEPTED_PROBABILITY : DECISIONS_ACCEPTED_MARGIN).replace(".", ",");
    lines.push(...table(["Document", "Pages", local ? "Demandes" : "Appels", "Jetons (entrée / sortie / total)", `${local ? "Demande" : "Appel"} p50 / p95 (s)`,
      "Rendu p50 / p95 (s)", "Candidats (hors limite)", `Classes (règles / ${local ? "modèle" : "Decisions"} ≥ ${margin} / < ${margin} / à revoir)`, "Arrêts"],
    rows.map((entry) => [
      entry.document, entry.pages, entry.calls.batch, `${entry.tokens.input} / ${entry.tokens.output} / ${entry.tokens.total}`,
      `${seconds(entry.latency_ms.p50)} / ${seconds(entry.latency_ms.p95)}`, `${seconds(entry.render_ms.p50)} / ${seconds(entry.render_ms.p95)}`,
      `${entry.candidates} (${entry.left_out})`, `${entry.answers.ruled} / ${entry.answers.classified} / ${entry.answers.proposals} / ${entry.answers.review}`,
      entry.stops.map((stop) => `p${stop.page} passe ${stop.pass} : ${stop.reason}`).join(", ") || "–",
    ])), "");
  }
  if (comparison) {
    lines.push(`## Comparaison avec la baseline niveau C (médianes de ${comparison.passes.vector} passes vectorielles et ${comparison.passes.baseline} passes de la baseline, re-notée au score courant)`, "");
    const counts = comparison.counts;
    const scopeCounts = (id: string) => counts.scopes.find((entry) => entry.scope === id);
    const rows = [
      ...(["reserve", "truth", "all"] as const).map((role) => {
        const entry = comparison.totals[role];
        return [role === "reserve" ? "**Réserve**" : role === "truth" ? "**Hors réserve**" : "**Tous**", share(entry.vector.lengths), share(entry.baseline.lengths),
          verdict(entry.lengths_gain, "gain", "pas de gain"), share(entry.vector.surfaces), share(entry.baseline.surfaces),
          verdict(entry.surfaces_no_regression, "sans régression", "régression"), countCell(counts.totals[role].vector), countCell(counts.totals[role].baseline)];
      }),
      ...comparison.scopes.map((scope) => [`${scope.documents.join(", ")}${scope.role === "reserve" ? " (réserve)" : ""}`, share(scope.vector.lengths),
        share(scope.baseline.lengths), verdict(scope.lengths_gain, "gain", "pas de gain"), share(scope.vector.surfaces), share(scope.baseline.surfaces),
        verdict(scope.surfaces_no_regression, "sans régression", "régression"), countCell(scopeCounts(scope.scope)?.vector ?? NO_COUNTS),
        countCell(scopeCounts(scope.scope)?.baseline ?? NO_COUNTS)]),
    ];
    lines.push(...table(["Périmètre", "Longueurs, vecteurs", "Longueurs, baseline", "Longueurs", "Surfaces, vecteurs", "Surfaces, baseline", "Surfaces",
      "Comptages, vecteurs", "Comptages, baseline"], rows), "", COUNTS_NOTE, "");
    if (comparison.left_out_of_totals.length > 0) {
      lines.push(`Hors totaux (non notés par les deux runs à chaque passe) : ${comparison.left_out_of_totals.join(", ")}.`, "");
    }
    if (comparison.slices) lines.push(...renderSlices(comparison.slices, comparison.counts.slices));
    if (comparison.measured) lines.push(...renderMeasured(comparison.measured));
  }
  return lines;
}
