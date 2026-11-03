import type { BenchReport } from "@/lib/takeoff/bench/report";
import type { KeyScore, ScopeScore } from "@/lib/takeoff/bench/score";
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
// errors, never a quantity.

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
export type VectorComparison = {
  passes: { vector: number; baseline: number };
  scopes: ScopeComparison[];
  totals: Record<"reserve" | "truth" | "all", { vector: SideMetrics; baseline: SideMetrics; lengths_gain: boolean | null; surfaces_no_regression: boolean | null }>;
  /** Scopes scored by the vector run but not by both runs in every pass: shown per scope, left out of the totals. */
  left_out_of_totals: string[];
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

export function compareVectorWithBaseline(vector: BenchReport, baseline: BenchReport): VectorComparison {
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
  return {
    passes: { vector: vectorPasses.length, baseline: baselinePasses.length },
    scopes, totals: { reserve: total("reserve"), truth: total("truth"), all: total("all") },
    left_out_of_totals: ids.filter((id) => !common.includes(id)),
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

/** report.md sections of a vector run: page readings (codes and counts only) and the comparison. */
export function renderVectorSections(passes: readonly VectorBenchPass[], comparison: VectorComparison | null) {
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
  }
  return lines;
}
