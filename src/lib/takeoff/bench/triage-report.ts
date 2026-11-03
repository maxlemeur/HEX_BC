import type { DecisionsTokenBudgetSnapshot } from "@/lib/ai/decisions-budget";
import type { BenchReportMetadata } from "@/lib/takeoff/bench/report";
import {
  benchTriageRetainedPages,
  scoreTakeoffBenchTriage,
  type BenchTriageDocument,
  type BenchTriageGroupScore,
  type BenchTriageStop,
} from "@/lib/takeoff/bench/triage";
import { TAKEOFF_PAGE_TRIAGE_CONFIDENCE_THRESHOLD, TAKEOFF_PAGE_TRIAGE_EXCLUDED_TYPES, TAKEOFF_PAGE_TYPES } from "@/lib/takeoff/page-triage";

// report.json / report.md of `takeoff:bench --mode triage` (TI-663). report.json
// keeps every call (status, usage, answers, proposal, truth) next to the scores;
// report.md publishes ids, page types (product codes), counts and timings only,
// never a title, a page text or a thumbnail.

export type BenchTriageMetadata = Omit<BenchReportMetadata, "profile"> & {
  decisions: { status: string; model: string };
};

export type BenchTriageReport = ReturnType<typeof buildBenchTriageReport>;

export function buildBenchTriageReport(input: {
  metadata: BenchTriageMetadata;
  status: "complete" | "incomplete";
  stop: BenchTriageStop | { reason: "decisions_unavailable"; message: string; document: null } | null;
  documents: readonly BenchTriageDocument[];
  budget: DecisionsTokenBudgetSnapshot;
  rules: { prompt_version: string } & Record<string, unknown>;
}) {
  return {
    schema_version: 1,
    mode: "triage" as const,
    status: input.status,
    stop: input.stop,
    metadata: input.metadata,
    rules: {
      threshold: TAKEOFF_PAGE_TRIAGE_CONFIDENCE_THRESHOLD,
      excluded_types: TAKEOFF_PAGE_TRIAGE_EXCLUDED_TYPES,
      types: TAKEOFF_PAGE_TYPES,
      scope: "empty, as the « Mes documents » step",
      score: "kept pages (garder) proposed for exclusion; per-type precision on answered, non-ambiguous pages; required_threshold from main pages only",
      ...input.rules,
    },
    budget: input.budget,
    scores: scoreTakeoffBenchTriage(input.documents),
    retained: benchTriageRetainedPages(input.documents),
    documents: input.documents.map((entry) => ({
      id: entry.document.id, lot: entry.document.lot, role: entry.document.role, sha256: entry.document.sha256,
      status: entry.status, render: entry.run?.render ?? null, stop: entry.run?.stop ?? null,
      calls: (entry.run?.calls ?? []).map((call) => ({ ...call, truth: entry.truth.pages.find((page) => page.page === call.page) ?? null })),
    })),
  };
}

const ratio = (value: number | null) => (value === null ? "—" : `${Math.round(value * 1000) / 10} %`);
const ms = (value: number | null) => (value === null ? "—" : `${(value / 1000).toFixed(1)} s`);

function group(name: string, score: BenchTriageGroupScore) {
  const lines = [
    `### ${name}`,
    "",
    `- Documents ${score.documents}, pages ${score.pages.total} (answered ${score.pages.answered}, failed ${score.pages.failed}, not run ${score.pages.not_run}, ambiguous ${score.pages.ambiguous}).`,
    `- Kept pages proposed for exclusion: ${score.kept_recall.wrongly_excluded} of ${score.kept_recall.kept_pages} (recall ${ratio(score.kept_recall.recall)}).`,
    `- Exclusions proposed ${score.exclusions.proposed}, correct ${score.exclusions.correct}, of ${score.exclusions.excludable_pages} excludable pages; to review ${score.to_review}.`,
    `- Type accuracy ${score.type_accuracy.correct}/${score.type_accuracy.scored}; level ${score.level.correct}/${score.level.scored}; zone ${score.zone.correct}/${score.zone.scored}.`,
    `- Threshold that keeps every kept page: ${score.required_threshold ?? "none (a kept page was answered at confidence 1)"}.`,
    ...(score.kept_recall.not_run_kept ? [`- Kept pages not run (left out of the recall): ${score.kept_recall.not_run_kept}.`] : []),
    `- Decisions tokens: ${score.tokens.input} in, ${score.tokens.output} out, ${score.tokens.total} total, ${score.tokens.calls} calls (${score.tokens.calls_without_usage} without usage).`,
    `- Decisions call p50/p95 ${ms(score.latency_ms.decisions_p50)} / ${ms(score.latency_ms.decisions_p95)}; page render p50/p95 ${ms(score.latency_ms.render_p50)} / ${ms(score.latency_ms.render_p95)}.`,
  ];
  if (score.false_exclusions.length) {
    lines.push(`- False exclusions: ${score.false_exclusions.map((entry) => `${entry.document} p${entry.page} (${entry.truth_type} read ${entry.type} ${entry.confidence ?? "—"})`).join(", ")}.`);
  }
  lines.push("", "| Type | Predicted | Correct | Truth | Precision | Recall |", "|---|---|---|---|---|---|");
  for (const type of TAKEOFF_PAGE_TYPES) {
    const entry = score.per_type[type];
    if (!entry.predicted && !entry.truth) continue;
    lines.push(`| ${type} | ${entry.predicted} | ${entry.correct} | ${entry.truth} | ${ratio(entry.precision)} | ${ratio(entry.recall)} |`);
  }
  return [...lines, ""];
}

export function renderBenchTriageReportMarkdown(report: BenchTriageReport) {
  const { metadata } = report;
  const env = Object.entries(metadata.env).map(([name, value]) => `${name}=${value}`).join(" ");
  return [
    "# Takeoff bench — page triage (TI-663)",
    "",
    `- Status: ${report.status}${report.stop ? ` (stop: ${report.stop.reason}${report.stop.document ? ` at ${report.stop.document}` : ""})` : ""}.`,
    `- Command: \`cd ${metadata.cwd} && ${env ? `${env} ` : ""}${metadata.command.join(" ")}\``,
    `- Commit ${metadata.commit ?? "unknown"}${metadata.dirty ? " (dirty)" : ""}, Node ${metadata.node}, dataset ${metadata.dataset.sha256}.`,
    `- Host: ${metadata.host ? `${metadata.host.platform}, ${metadata.host.cpus} CPUs, load ${metadata.host.loadavg_before.map((value) => value.toFixed(2)).join(" ")} → ${metadata.host.loadavg_after.map((value) => value.toFixed(2)).join(" ")}` : "unknown"}.`,
    `- Decisions ${metadata.decisions.model} (${metadata.decisions.status}), prompt ${report.rules.prompt_version}, threshold ${report.rules.threshold}.`,
    `- Budget: ${report.budget.spent_tokens} of ${report.budget.max_tokens} tokens, ${report.budget.calls} calls (${report.budget.calls_without_usage} without usage), ${report.budget.refused_starts} refused starts.`,
    "",
    ...group("Outside the reserve", report.scores.main),
    ...group("Reserve (measured once, never tunes the threshold)", report.scores.reserve),
    ...group("All pages", report.scores.all),
    "## Pages kept per document",
    "",
    ...report.retained.map((entry) => `- ${entry.id}: ${entry.retained_pages.length ? entry.retained_pages.join(", ") : "none (document excluded)"} of ${entry.page_count}`),
    "",
  ].join("\n");
}
