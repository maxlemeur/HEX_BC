import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { itemAnswerAnomalies, itemPartsTotal, type ItemAnswerView, type ItemContributionRow } from "./item-table";
import { compareQuantityPairs } from "./quantity-policy";

// What an acceptance certifies, judged by the planner and by the database (private.takeoff_item_row_anomalies,
// private.takeoff_item_total and private.takeoff_quantity_requires_review) on the same cases: the vectors are the pgTAP
// suite's, read in its file. The gaps give the parts, never their sum: the sum is the rule under test.
const PGTAP = path.join(process.cwd(), "supabase/tests/database/takeoff-item-review.test.sql");
const sql = fs.readFileSync(PGTAP, "utf8");
function block(tag: string) {
  const quote = "$" + tag + "$";
  const start = sql.indexOf(quote);
  const end = sql.indexOf(quote, start + quote.length);
  expect(start).toBeGreaterThan(-1);
  return JSON.parse(sql.slice(start + quote.length, end)) as unknown[];
}

type Vector = {
  position: number; label: string; outcome: ItemAnswerView["outcome"]; reason_code: string | null; row_found: boolean;
  is_excluded: boolean | null; rules_stale: boolean | null; rule_results: unknown; confidence: number | null; threshold: number;
  evidence: string | null; source_page: number | null; metadata: unknown; entry_category: string | null; unit: string | null;
  expected_unit: string | null; anomalies: string[];
};

describe("the acceptance rules, against SQL's", () => {
  const vectors = block("vectors") as Vector[];

  it("reads every vector of the pgTAP suite, in order", () => {
    expect(vectors.map(({ position }) => position)).toEqual(vectors.map((_, index) => index + 1));
    expect(vectors.length).toBeGreaterThanOrEqual(20);
  });

  it.each(vectors)("vector $position: $label", (vector) => {
    const rowId = "row-1";
    const answer = { outcome: vector.outcome, quantity: { quantity: 1, unit: vector.unit ?? "u" }, reasonCode: vector.reason_code,
      observations: [{ observationId: "obs-1", role: "contribution" as const, quantity: 1, unit: vector.unit ?? "u", page: 2,
        evidence: null, confidence: null, method: null, takeoffItemId: rowId, row: null }] };
    const rows = new Map<string, ItemContributionRow>(vector.row_found ? [[rowId, { id: rowId, quantity: 1, unit: vector.unit ?? "",
      isVerified: false, isExcluded: vector.is_excluded === true, rulesStale: vector.rules_stale === true, ruleResults: vector.rule_results,
      confidence: vector.confidence, evidence: vector.evidence, sourcePage: vector.source_page, metadata: vector.metadata,
      quantityEntryCategory: vector.entry_category }]] : []);
    expect(itemAnswerAnomalies(answer, rows, { expectedUnit: vector.expected_unit, lowConfidenceThreshold: vector.threshold }))
      .toEqual(vector.anomalies);
  });
});

describe("the DPGF gap on the total of the parts, against SQL's", () => {
  const gaps = block("gaps") as Array<{ position: number; reference: number; parts: number[]; review: boolean }>;

  it("reads every gap vector of the pgTAP suite, the brief's three entries of a third included", () => {
    expect(gaps.map(({ position }) => position)).toEqual(gaps.map((_, index) => index + 1));
    expect(gaps.some(({ parts }) => parts.join() === "10,0.0333336,0.0333336,0.0333326")).toBe(true);
  });

  it.each(gaps)("gap vector $position: $parts against $reference", ({ reference, parts, review }) => {
    expect(compareQuantityPairs([{ reference, measured: itemPartsTotal(parts) }])?.requiresReview).toBe(review);
  });
});
