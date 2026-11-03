import "server-only";

import { evaluateTakeoffBenchmark } from "@/lib/takeoff/benchmark";
import { scoreScopes } from "@/lib/takeoff/bench/score";
import type { LabScore } from "@/lib/takeoff/lab/contracts";
import type { LabTruth } from "@/lib/takeoff/lab/dataset";
import type { TakeoffItem } from "@/lib/takeoff/types";

/**
 * Score of an extraction of the whole PDF against its truth: lines (precision,
 * recall, quantity accuracy of evaluateTakeoffBenchmark) or bench keys (keys
 * within tolerance of the TI-660 score). A crop is never scored: the truth
 * covers the whole document.
 */
export function scoreLabExtraction(documentId: string, truth: LabTruth, items: readonly TakeoffItem[]): LabScore | null {
  if (!truth) return null;
  if (truth.kind === "lines") {
    const report = evaluateTakeoffBenchmark(truth.truth.items, items.map((item) => ({
      designation: item.designation, quantity: item.quantity, unit: item.unit,
      confidence: item.confidence ?? null, evidence: item.evidence ?? null, source_page: item.source_page ?? null,
    })));
    return {
      kind: "lines", truth: truth.file, expected: report.expectedCount, candidates: report.candidateCount,
      matched: report.matchedCount, precision: report.precision, recall: report.recall, quantity_accuracy: report.quantityAccuracy,
    };
  }
  const scores = scoreScopes(truth.scopes, new Map([[documentId, items]]));
  const sum = (pick: (counts: (typeof scores)[number]["counts"]) => number) => scores.reduce((total, score) => total + pick(score.counts), 0);
  const items_ = sum((counts) => counts.items);
  const attached = sum((counts) => counts.attached);
  return {
    kind: "keys", truth: truth.file,
    status: scores.every((score) => score.status === "scored") ? "scored" : scores.some((score) => score.status === "read_failed") ? "read_failed" : "not_run",
    keys_scored: sum((counts) => counts.keys_scored), keys_ok: sum((counts) => counts.keys_ok), keys_missed: sum((counts) => counts.keys_missed),
    false_positive_groups: sum((counts) => counts.false_positive_groups), attachment_rate: items_ > 0 ? attached / items_ : null,
  };
}
