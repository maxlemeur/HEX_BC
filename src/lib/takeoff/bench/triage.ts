import type { ChatGptOwner } from "@/lib/ai/chatgpt-local-store";
import type { DecisionsTokenBudget } from "@/lib/ai/decisions-budget";
import type { ManifestDocument, PageTruthFile } from "@/lib/takeoff/bench/schemas";
import {
  TAKEOFF_PAGE_TRIAGE_CONFIDENCE_THRESHOLD,
  TAKEOFF_PAGE_TRIAGE_EXCLUDED_TYPES,
  TAKEOFF_PAGE_TYPES,
  type TakeoffPageType,
} from "@/lib/takeoff/page-triage";
import type { runTakeoffPageTriage, TakeoffPageTriageCall, TakeoffPageTriageRun, TakeoffPageTriageStop } from "@/lib/takeoff/page-triage-server";

// Page triage of the private dataset (TI-663): the product's per-page Decisions
// triage (runTakeoffPageTriage, same render, questions, rule and thumbnail) on
// every binary PDF with a page truth, as the « Mes documents » step sees it
// (empty scope, the original file name), with the bench context: project
// `bench:<id>`, the plan SHA-256 as file identity. One pass per page and prompt
// version, no retry, all documents under one `--max-decisions-tokens` ceiling;
// the run stops at the first failed call or when the ceiling refuses a call.
// The score compares each answer with truth/pages: kept pages proposed for
// exclusion (the recall that must stay 100 %), per-type precision on answered,
// non-ambiguous pages, and the lowest threshold (never below 0.8) that would
// have kept every kept page, computed outside the reserve only.

export type BenchTriageInput = { document: ManifestDocument; bytes: Buffer; truth: PageTruthFile };
export type BenchTriageDocument = BenchTriageInput & { status: "done" | "not_run"; run: TakeoffPageTriageRun | null };
export type BenchTriageStop = TakeoffPageTriageStop & { document: string };

type TriageFunction = (input: Parameters<typeof runTakeoffPageTriage>[0]) => Promise<TakeoffPageTriageRun>;

export async function runTakeoffBenchTriage(input: {
  documents: readonly BenchTriageInput[];
  owner: ChatGptOwner;
  budget: DecisionsTokenBudget;
  triage: TriageFunction;
  log?: (line: string) => void;
}): Promise<{ status: "complete" | "incomplete"; stop: BenchTriageStop | null; failures: BenchTriageStop[]; documents: BenchTriageDocument[] }> {
  const documents: BenchTriageDocument[] = [];
  let stop: BenchTriageStop | null = null;
  // A document the renderer refuses (page limit, unreadable, page count, deadline) has no page
  // classified: the run goes on with the next documents but can no longer be « complete ».
  const failures: BenchTriageStop[] = [];
  for (const entry of input.documents) {
    if (stop) {
      documents.push({ ...entry, status: "not_run", run: null });
      continue;
    }
    const run = await input.triage({
      owner: input.owner, projectId: `bench:${entry.document.id}`, bytes: new Uint8Array(entry.bytes),
      fileName: entry.document.original_title, sourceVersion: entry.document.sha256 ?? entry.document.id,
      scope: { levels: [], zones: [] }, previous: null, budget: input.budget,
      stopOnFailure: true, deadlineMs: Number.POSITIVE_INFINITY, pageCountHint: entry.document.pages,
    });
    documents.push({ ...entry, status: "done", run });
    const calls = run.calls.map((call) => `${call.page}:${call.status}${call.proposal === "exclude" ? ":exclude" : ""}`).join(" ");
    input.log?.(`${entry.document.id} ${run.render.status} ${calls}${run.stop ? ` stop=${run.stop.reason}` : ""}`);
    if (run.stop && (run.stop.reason === "call_failed" || run.stop.reason === "budget_reached")) stop = { ...run.stop, document: entry.document.id };
    else if (run.stop) failures.push({ ...run.stop, document: entry.document.id });
  }
  return { status: stop || failures.length > 0 ? "incomplete" : "complete", stop, failures, documents };
}

export type BenchTriageTypeScore = { predicted: number; correct: number; truth: number; precision: number | null; recall: number | null };

export type BenchTriageGroupScore = {
  documents: number;
  pages: { total: number; answered: number; failed: number; ambiguous: number; not_run: number };
  /** Over the pages that ran; kept pages never run are counted apart. */
  kept_recall: { kept_pages: number; wrongly_excluded: number; recall: number | null; not_run_kept: number };
  false_exclusions: Array<{ document: string; page: number; truth_type: string; type: string | null; confidence: number | null }>;
  exclusions: { proposed: number; correct: number; excludable_pages: number };
  to_review: number;
  per_type: Record<TakeoffPageType, BenchTriageTypeScore>;
  type_accuracy: { scored: number; correct: number };
  level: { scored: number; correct: number };
  zone: { scored: number; correct: number };
  /**
   * Lowest threshold >= 0.8 under which no kept page would have been excluded,
   * from the pages the rule could exclude (complete call, readable thumbnail,
   * answered excluded type); null when a kept page was answered at confidence 1.
   */
  required_threshold: number | null;
  tokens: { input: number; output: number; total: number; calls: number; calls_without_usage: number };
  latency_ms: { decisions_p50: number | null; decisions_p95: number | null; render_p50: number | null; render_p95: number | null };
};

/** Nearest rank, as the L1 bench report. */
function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

function emptyTypes(): Record<TakeoffPageType, BenchTriageTypeScore> {
  return Object.fromEntries(TAKEOFF_PAGE_TYPES.map((type) => [type, { predicted: 0, correct: 0, truth: 0, precision: null, recall: null }])) as Record<TakeoffPageType, BenchTriageTypeScore>;
}

const ANSWERED: ReadonlySet<TakeoffPageTriageCall["status"]> = new Set(["available", "partial", "cached"]);

function scoreGroup(documents: readonly BenchTriageDocument[]): BenchTriageGroupScore {
  const score: BenchTriageGroupScore = {
    documents: documents.length,
    pages: { total: 0, answered: 0, failed: 0, ambiguous: 0, not_run: 0 },
    kept_recall: { kept_pages: 0, wrongly_excluded: 0, recall: null, not_run_kept: 0 },
    false_exclusions: [], exclusions: { proposed: 0, correct: 0, excludable_pages: 0 }, to_review: 0,
    per_type: emptyTypes(), type_accuracy: { scored: 0, correct: 0 }, level: { scored: 0, correct: 0 }, zone: { scored: 0, correct: 0 },
    required_threshold: TAKEOFF_PAGE_TRIAGE_CONFIDENCE_THRESHOLD,
    tokens: { input: 0, output: 0, total: 0, calls: 0, calls_without_usage: 0 },
    latency_ms: { decisions_p50: null, decisions_p95: null, render_p50: null, render_p95: null },
  };
  const decisions: number[] = [];
  const renders: number[] = [];
  let riskiest = -1;
  for (const entry of documents) {
    for (const truth of entry.truth.pages) {
      score.pages.total += 1;
      const call = entry.run?.calls.find((candidate) => candidate.page === truth.page);
      // A page skipped after a stop was never asked; an unreadable page was decided (kept, to review).
      const neverAsked = call?.status === "skipped" && call.reason !== "render_failed";
      if (!call || neverAsked) {
        score.pages.not_run += 1;
        if (truth.garder) score.kept_recall.not_run_kept += 1;
        else score.exclusions.excludable_pages += 1;
        continue;
      }
      if (call.status !== "cached" && call.status !== "skipped") {
        score.tokens.calls += 1;
        if (call.usage) {
          score.tokens.input += call.usage.input_tokens;
          score.tokens.output += call.usage.output_tokens;
          score.tokens.total += call.usage.total_tokens;
        } else score.tokens.calls_without_usage += 1;
      }
      if (call.duration_ms !== null) decisions.push(call.duration_ms);
      if (call.render_ms !== null) renders.push(call.render_ms);
      if (truth.garder) {
        score.kept_recall.kept_pages += 1;
        if (call.proposal === "exclude") {
          score.kept_recall.wrongly_excluded += 1;
          score.false_exclusions.push({ document: entry.document.id, page: truth.page, truth_type: truth.type,
            type: typeof call.answers.type?.value === "string" ? call.answers.type.value : null, confidence: call.answers.type?.confidence ?? null });
        }
      } else score.exclusions.excludable_pages += 1;
      if (call.proposal === "exclude") {
        score.exclusions.proposed += 1;
        if (!truth.garder) score.exclusions.correct += 1;
      }
      if (call.proposal === "review") score.to_review += 1;
      if (truth.statut === "ambigu") score.pages.ambiguous += 1;
      const answered = ANSWERED.has(call.status) && call.answers.type?.status === "answered";
      if (!answered) {
        if (!ANSWERED.has(call.status)) score.pages.failed += 1;
        continue;
      }
      score.pages.answered += 1;
      const type = String(call.answers.type?.value);
      const confidence = call.answers.type?.confidence ?? null;
      const excludable = call.status === "available" && call.thumbnail !== null && !call.thumbnail.blank && !call.thumbnail.dropped_images;
      if (truth.garder && excludable && TAKEOFF_PAGE_TRIAGE_EXCLUDED_TYPES.includes(type as TakeoffPageType) && confidence !== null) riskiest = Math.max(riskiest, confidence);
      if (truth.statut === "ambigu") continue;
      score.type_accuracy.scored += 1;
      if (type === truth.type) score.type_accuracy.correct += 1;
      score.per_type[truth.type].truth += 1;
      if (type in score.per_type) {
        score.per_type[type as TakeoffPageType].predicted += 1;
        if (type === truth.type) score.per_type[type as TakeoffPageType].correct += 1;
      }
      const levelAnswer = call.answers.level;
      const zoneAnswer = call.answers.zone;
      const read = (answer: typeof levelAnswer) => answer?.status === "answered" && answer.value !== "inconnu" ? String(answer.value) : null;
      score.level.scored += 1;
      if (read(levelAnswer) === truth.niveau) score.level.correct += 1;
      score.zone.scored += 1;
      if (read(zoneAnswer) === truth.zone) score.zone.correct += 1;
    }
  }
  for (const type of TAKEOFF_PAGE_TYPES) {
    const entry = score.per_type[type];
    entry.precision = entry.predicted ? entry.correct / entry.predicted : null;
    entry.recall = entry.truth ? entry.correct / entry.truth : null;
  }
  const kept = score.kept_recall;
  kept.recall = kept.kept_pages ? (kept.kept_pages - kept.wrongly_excluded) / kept.kept_pages : null;
  score.required_threshold = riskiest < TAKEOFF_PAGE_TRIAGE_CONFIDENCE_THRESHOLD ? TAKEOFF_PAGE_TRIAGE_CONFIDENCE_THRESHOLD
    : riskiest >= 1 ? null : Math.min(1, Math.round((Math.floor(riskiest * 100) / 100 + 0.01) * 100) / 100);
  score.latency_ms = {
    decisions_p50: percentile(decisions, 50), decisions_p95: percentile(decisions, 95),
    render_p50: percentile(renders, 50), render_p95: percentile(renders, 95),
  };
  return score;
}

/** Scores of the pages outside the reserve (`main`), of the reserve, and of all pages. */
export function scoreTakeoffBenchTriage(documents: readonly BenchTriageDocument[]) {
  return {
    main: scoreGroup(documents.filter((entry) => entry.document.role !== "reserve")),
    reserve: scoreGroup(documents.filter((entry) => entry.document.role === "reserve")),
    all: scoreGroup(documents),
  };
}

/** Pages each document keeps after the triage, for `--pages-from` (an exclusion only removes a page). */
export function benchTriageRetainedPages(documents: readonly BenchTriageDocument[]) {
  return documents.filter((entry) => entry.status === "done" && entry.run?.render.page_count).map((entry) => ({
    id: entry.document.id,
    sha256: entry.document.sha256,
    page_count: entry.run!.render.page_count!,
    retained_pages: Array.from({ length: entry.run!.render.page_count! }, (_, index) => index + 1)
      .filter((page) => entry.run!.calls.find((call) => call.page === page)?.proposal !== "exclude"),
  }));
}
