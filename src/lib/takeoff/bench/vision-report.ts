import type { BenchPass } from "@/lib/takeoff/bench/run";
import type { VectorBenchPass } from "@/lib/takeoff/bench/vector-run";
import { visionPageTimings } from "@/lib/takeoff/bench/vision-review";

// The report of the bench's vision pass (TI-664 L5c, acceptance « jetons et durée p50/p95 par page publiés, durée
// sans régression face à L1 (mêmes pages, même machine) »):
// - tokens summed over the calls that carry usage; the calls without it are counted, never read as 0 tokens;
// - a page's time is its vector call plus its vision review (renders and calls), p50 and p95 by nearest rank, over
//   every page read and over the reviewed pages alone;
// - L1 is the level C baseline (--baseline), per page of the same documents and pages (duration_per_page_ms of its
//   successful calls); « regression » when the run is slower at p50 or p95, null without L1 pages to compare.

function nearestRank(values: readonly number[], p: number) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

const percentiles = (raw: number[]) => ({ p50: nearestRank(raw, 50), p95: nearestRank(raw, 95), raw });

export type VisionReport = ReturnType<typeof visionReport>;

export function visionReport(input: {
  vector: ReadonlyArray<Pick<VectorBenchPass, "pass" | "vision">>;
  passes: readonly Pick<BenchPass, "pass" | "documents">[];
  /** The level C baseline's passes (L1), or none. */
  baseline: readonly Pick<BenchPass, "pass" | "documents">[];
}) {
  const pages = input.vector.flatMap((pass) => pass.vision?.documents.flatMap((document) => document.pages) ?? []);
  const calls = pages.flatMap((page) => page.calls);
  const byStatus: Record<string, number> = {};
  for (const call of calls) byStatus[call.status] = (byStatus[call.status] ?? 0) + 1;
  const sum = (pick: (usage: NonNullable<(typeof calls)[number]["usage"]>) => number) => calls.reduce((total, call) => total + (call.usage ? pick(call.usage) : 0), 0);
  const verdicts: Record<string, number> = {};
  for (const answer of pages.flatMap((page) => page.answers)) verdicts[answer.verdict] = (verdicts[answer.verdict] ?? 0) + 1;
  const timings = visionPageTimings(input.vector, input.passes);
  const read = new Set(timings.map((timing) => `${timing.document}#${timing.page}`));
  const baseline = input.baseline.flatMap((pass) => pass.documents.flatMap((document) => document.calls
    .filter((call) => call.status === "ok" && call.start_page === call.end_page && read.has(`${document.id}#${call.start_page}`))
    .map((call) => call.duration_per_page_ms)));
  const pageMs = percentiles(timings.map((timing) => timing.total_ms));
  const baselineMs = percentiles(baseline);
  const regression = baselineMs.p50 === null || pageMs.p50 === null ? null
    : pageMs.p50 > baselineMs.p50 || (pageMs.p95 ?? 0) > (baselineMs.p95 ?? 0);
  return {
    calls: { total: calls.length, ok: calls.filter((call) => call.status === "ok").length, without_usage: calls.filter((call) => call.usage === null).length,
      by_status: byStatus },
    tokens: { input: sum((usage) => usage.input_tokens), output: sum((usage) => usage.output_tokens), total: sum((usage) => usage.total_tokens) },
    latency_ms: percentiles(calls.map((call) => call.latency_ms)),
    render_ms: percentiles(pages.flatMap((page) => page.render_ms)),
    lines: { asked: pages.reduce((total, page) => total + page.lines, 0), left_out: pages.reduce((total, page) => total + page.left_out, 0),
      corrected: pages.reduce((total, page) => total + page.corrected, 0), verdicts },
    page_ms: pageMs,
    reviewed_page_ms: percentiles(timings.filter((timing) => timing.vision_ms > 0).map((timing) => timing.total_ms)),
    baseline_page_ms: baselineMs,
    regression,
    stop: input.vector.map((pass) => pass.vision?.stop ?? null).find(Boolean) ?? null,
  };
}

const seconds = (ms: number | null) => (ms === null ? "—" : (ms / 1000).toFixed(1));

/** The markdown section of the vision pass. */
export function renderVisionSection(report: VisionReport) {
  const verdicts = Object.entries(report.lines.verdicts).map(([verdict, count]) => `${verdict} ${count}`).join(", ") || "aucune";
  return [
    "## Passe vision ciblée (lignes rejetées par la règle DN × réseau)",
    "",
    `- Lignes demandées : ${report.lines.asked} (laissées de côté : ${report.lines.left_out}) ; corrigées : ${report.lines.corrected} ; réponses : ${verdicts}.`,
    `- Appels : ${report.calls.total} (${Object.entries(report.calls.by_status).map(([status, count]) => `${status} ${count}`).join(", ") || "aucun"}), dont ${report.calls.without_usage} sans usage.`,
    `- Jetons : ${report.tokens.input} en entrée, ${report.tokens.output} en sortie, ${report.tokens.total} au total (appels avec usage).`,
    `- Latence des appels p50 / p95 : ${seconds(report.latency_ms.p50)} / ${seconds(report.latency_ms.p95)} s ; rendu des extraits : ${seconds(report.render_ms.p50)} / ${seconds(report.render_ms.p95)} s.`,
    `- Durée par page (vecteurs + vision) p50 / p95 : ${seconds(report.page_ms.p50)} / ${seconds(report.page_ms.p95)} s ; pages revues seules : ${seconds(report.reviewed_page_ms.p50)} / ${seconds(report.reviewed_page_ms.p95)} s.`,
    report.regression === null
      ? "- L1 : sans baseline L1 sur ces pages, aucune comparaison."
      : `- L1 (mêmes pages) p50 / p95 : ${seconds(report.baseline_page_ms.p50)} / ${seconds(report.baseline_page_ms.p95)} s : ${report.regression ? "**régression**" : "sans régression"}.`,
    ...(report.stop ? [`- **Arrêt** : ${report.stop.reason} (${report.stop.message}).`] : []),
    "",
  ];
}
