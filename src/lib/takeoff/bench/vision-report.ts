import type { PassRules } from "@/lib/takeoff/bench/report";
import type { BenchPass } from "@/lib/takeoff/bench/run";
import type { VectorBenchPass } from "@/lib/takeoff/bench/vector-run";
import { visionPageTimings } from "@/lib/takeoff/bench/vision-review";

// The report of the bench's vision pass (TI-664 L5c, acceptance « jetons et durée p50/p95 par page publiés, durée
// sans régression face à L1 (mêmes pages, même machine) »):
// - tokens summed over the calls that carry usage; the calls without it are counted, never read as 0 tokens;
// - a page's time is its vector call plus its vision review (renders and calls), p50 and p95 by nearest rank, over
//   every page read and over the reviewed pages alone;
// - L1 is the level C baseline (--baseline): both sides on the same pages only, those L1 read alone in a successful
//   call (a multi-page chunk has no time of its own per page) and the run read from its vectors (a raster page takes
//   its items from L1, at the vector reading's time): « regression » when the run is slower at p50 or p95, null without
//   such pages; the pages left out are counted;
// - an interrupted vision pass (a stop, e.g. the plan limit) gives no L1 verdict: its later pages were never reviewed
//   and carry no vision time. Its partial cost (tokens, latencies, timings) is still reported;
// - the acceptance counter: per pass and role, the keys at high confidence and those in error after the rules and
//   after vision; any rise of the errors is flagged.

function nearestRank(values: readonly number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

const percentiles = (raw: number[]) => ({ p50: nearestRank(raw, 50), p95: nearestRank(raw, 95), raw });

export type VisionReport = ReturnType<typeof visionReport>;

export function visionReport(input: {
  vector: ReadonlyArray<Pick<VectorBenchPass, "pass" | "vision"> & Partial<Pick<VectorBenchPass, "documents">>>;
  passes: readonly Pick<BenchPass, "pass" | "documents">[];
  /** The level C baseline's passes (L1), or none. */
  baseline: readonly Pick<BenchPass, "pass" | "documents">[];
  /** Per pass, the rules after the rules and after vision (report passes' `rules`). */
  scores?: ReadonlyArray<{ pass: number; after_rules: PassRules | null; after_vision: PassRules | null }>;
}) {
  const pages = input.vector.flatMap((pass) => pass.vision?.documents.flatMap((document) => document.pages) ?? []);
  const calls = pages.flatMap((page) => page.calls);
  const byStatus: Record<string, number> = {};
  for (const call of calls) byStatus[call.status] = (byStatus[call.status] ?? 0) + 1;
  const sum = (pick: (usage: NonNullable<(typeof calls)[number]["usage"]>) => number) => calls.reduce((total, call) => total + (call.usage ? pick(call.usage) : 0), 0);
  const multiPage = input.baseline.flatMap((pass) => pass.documents.flatMap((document) => document.calls
    .filter((call) => call.status === "ok" && call.start_page !== call.end_page))).length;
  const verdicts: Record<string, number> = {};
  for (const answer of pages.flatMap((page) => page.answers)) verdicts[answer.verdict] = (verdicts[answer.verdict] ?? 0) + 1;
  const timings = visionPageTimings(input.vector, input.passes);
  const key = (document: string, page: number) => `${document}#${page}`;
  const raster = new Set(input.vector.flatMap((pass) => (pass.documents ?? []).flatMap((document) => document.pages
    .filter((page) => page.raster_items_from_baseline !== null && page.raster_items_from_baseline !== undefined).map((page) => key(document.id, page.page)))));
  const baselineCalls = input.baseline.flatMap((pass) => pass.documents.flatMap((document) => document.calls
    .filter((call) => call.status === "ok").map((call) => ({ document: document.id, call }))));
  const alone = new Set(baselineCalls.filter(({ call }) => call.start_page === call.end_page).map(({ document, call }) => key(document, call.start_page)));
  const vectorRead = new Set(timings.filter((timing) => !raster.has(key(timing.document, timing.page))).map((timing) => key(timing.document, timing.page)));
  const compared = new Set([...alone].filter((page) => vectorRead.has(page)));
  const runCompared = percentiles(timings.filter((timing) => compared.has(key(timing.document, timing.page))).map((timing) => timing.total_ms));
  const baselineCompared = percentiles(baselineCalls.filter(({ document, call }) => call.start_page === call.end_page && compared.has(key(document, call.start_page)))
    .map(({ call }) => call.duration_per_page_ms));
  const stop = input.vector.map((pass) => pass.vision?.stop ?? null).find(Boolean) ?? null;
  const interrupted = stop !== null;
  const regression = interrupted || baselineCompared.p50 === null || runCompared.p50 === null ? null
    : runCompared.p50 > baselineCompared.p50 || (runCompared.p95 ?? 0) > (baselineCompared.p95 ?? 0);
  // Lines per document rejected / uncertain / high, after the rules and after vision (the « before the rules » of the
  // vision state is not shown: its lines are already corrected).
  const tiers = (input.scores ?? []).flatMap((score) => (score.after_rules?.documents ?? []).map((document) => ({
    pass: score.pass, document: document.id, role: document.role, after_rules: document.after,
    after_vision: score.after_vision?.documents.find((entry) => entry.id === document.id)?.after ?? null,
  })));
  const keys = (input.scores ?? []).flatMap((score) => (["main", "reserve"] as const).flatMap((role) => {
    const before = score.after_rules?.confidence[role].after;
    const after = score.after_vision?.confidence[role].after;
    if (!before || !after) return [];
    return [{ pass: score.pass, role, after_rules: { high: before.keys_high_confidence, errors: before.keys_high_confidence_error },
      after_vision: { high: after.keys_high_confidence, errors: after.keys_high_confidence_error } }];
  }));
  return {
    calls: { total: calls.length, ok: calls.filter((call) => call.status === "ok").length, without_usage: calls.filter((call) => call.usage === null).length,
      by_status: byStatus },
    tokens: { input: sum((usage) => usage.input_tokens), output: sum((usage) => usage.output_tokens),
      ...(calls.some((call) => call.usage?.reasoning_tokens !== undefined) ? { reasoning: sum((usage) => usage.reasoning_tokens ?? 0) } : {}),
      total: sum((usage) => usage.total_tokens) },
    latency_ms: percentiles(calls.map((call) => call.latency_ms)),
    render_ms: percentiles(pages.flatMap((page) => page.render_ms)),
    lines: { asked: pages.reduce((total, page) => total + page.lines, 0), left_out: pages.reduce((total, page) => total + page.left_out, 0),
      not_drawn: pages.reduce((total, page) => total + (page.not_drawn ?? 0), 0), too_spread: pages.reduce((total, page) => total + (page.too_spread ?? 0), 0),
      corrected: pages.reduce((total, page) => total + page.corrected, 0), verdicts },
    page_ms: percentiles(timings.map((timing) => timing.total_ms)),
    reviewed_page_ms: percentiles(timings.filter((timing) => timing.vision_ms > 0).map((timing) => timing.total_ms)),
    l1: { pages: compared.size, raster_pages_left_out: raster.size, multi_page_calls_left_out: multiPage,
      run_ms: runCompared, baseline_ms: baselineCompared, regression, interrupted },
    tiers,
    keys,
    high_confidence_errors_increased: keys.some((entry) => entry.after_vision.errors > entry.after_rules.errors),
    stop,
  };
}

const seconds = (ms: number | null) => (ms === null ? "—" : (ms / 1000).toFixed(1));

/** The markdown section of the vision pass. */
export function renderVisionSection(report: VisionReport) {
  const verdicts = Object.entries(report.lines.verdicts).map(([verdict, count]) => `${verdict} ${count}`).join(", ") || "aucune";
  return [
    "## Passe vision ciblée (lignes rejetées par la règle DN × réseau)",
    "",
    `- Lignes demandées : ${report.lines.asked} (laissées de côté : ${report.lines.left_out}, trop étalées : ${report.lines.too_spread}, extrait non dessiné : ${report.lines.not_drawn}) ; corrigées : ${report.lines.corrected} ; réponses : ${verdicts}.`,
    `- Appels : ${report.calls.total} (${Object.entries(report.calls.by_status).map(([status, count]) => `${status} ${count}`).join(", ") || "aucun"}), dont ${report.calls.without_usage} sans usage.`,
    `- Jetons : ${report.tokens.input} en entrée, ${report.tokens.output} en sortie${"reasoning" in report.tokens ? `, ${report.tokens.reasoning} de raisonnement` : ""}, ${report.tokens.total} au total (appels avec usage).`,
    `- Latence des appels p50 / p95 : ${seconds(report.latency_ms.p50)} / ${seconds(report.latency_ms.p95)} s ; rendu des extraits : ${seconds(report.render_ms.p50)} / ${seconds(report.render_ms.p95)} s.`,
    `- Durée par page (vecteurs + vision) p50 / p95 : ${seconds(report.page_ms.p50)} / ${seconds(report.page_ms.p95)} s ; pages revues seules : ${seconds(report.reviewed_page_ms.p50)} / ${seconds(report.reviewed_page_ms.p95)} s.`,
    report.l1.interrupted
      ? `- L1 : passe vision interrompue (${report.stop?.reason ?? "arrêt"}), aucun verdict face à L1 ; les coûts partiels ci-dessus restent valables.`
      : report.l1.regression === null
      ? "- L1 : sans baseline L1 sur ces pages, aucune comparaison."
      : `- Mêmes pages que L1 (${report.l1.pages} ; laissées de côté : ${report.l1.raster_pages_left_out} raster, ${report.l1.multi_page_calls_left_out} appels L1 de plusieurs pages) : run ${seconds(report.l1.run_ms.p50)} / ${seconds(report.l1.run_ms.p95)} s, L1 ${seconds(report.l1.baseline_ms.p50)} / ${seconds(report.l1.baseline_ms.p95)} s (p50 / p95) : ${report.l1.regression ? "**régression**" : "sans régression"}.`,
    ...(report.tiers.length > 0 ? ["", "| Passe | Document | Rôle | Après règles (rejetées / incertaines / haute) | Après vision |", "|---|---|---|---|---|",
      ...report.tiers.map((entry) => `| ${entry.pass} | ${entry.document} | ${entry.role === "reserve" ? "réserve" : "hors réserve"} | ${entry.after_rules.rejected} / ${entry.after_rules.uncertain} / ${entry.after_rules.high} | ${entry.after_vision ? `${entry.after_vision.rejected} / ${entry.after_vision.uncertain} / ${entry.after_vision.high}` : "—"} |`), ""] : []),
    ...report.keys.map((entry) => `- Passe ${entry.pass}, ${entry.role === "main" ? "hors réserve" : "réserve"} : clés à haute confiance en erreur ${entry.after_rules.errors}/${entry.after_rules.high} après règles, ${entry.after_vision.errors}/${entry.after_vision.high} après vision.`),
    ...(report.high_confidence_errors_increased ? ["- **Attention : hausse des clés à haute confiance en erreur après la passe vision.**"] : []),
    ...(report.stop ? [`- **Arrêt** : ${report.stop.reason} (${report.stop.message}).`] : []),
    "",
  ];
}
