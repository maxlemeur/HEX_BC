import { describe, expect, it } from "vitest";

import type { TakeoffPageReplacementRow } from "@/lib/takeoff/page-replacement-contracts";

import { initialPageDraft, pageDecisionsPayload, pageMissing, pageOutcomes, type PageDraft } from "./page-decisions";

// TI-682 lot D, PR 2, Codex review of c06cbb1b: the confirmation is the estimator's only check, so it must show, per
// estimate line, the quantity the database will store. A line carrying two pages, both measured again, takes both pages'
// new measures at once (private.takeoff_replace_pages aggregates every update of the line). Written before the fix: each
// page showed its own outcome alone (25 and 30 for a stored 35). Fictional identifiers.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const line = (pageSource: number) => ({ id: id(201), title: "EF cuivre DN 20", unit_key: "ml", quantity: 20, measured_quantity: 20,
  changed_by_hand: false, updated_at: "2026-11-11T10:00:00.000000+00:00", unit_price_ht_cents: 2500, job_id: id(9000), dpgf_target: false,
  fed_again: false, assembly: false, other_pages: true, item_ids: [id(pageSource)],
  sources: [{ id: id(1), quantity: 10 }, { id: id(2), quantity: 10 }], length_factor: 1 });
const row = (page: number, newLine: number, quantity: number): TakeoffPageReplacementRow => ({
  key: `row-${page}`, document: { plan_file_id: null, content_hash: null, logical_document_id: null, file_name: "plan.pdf" },
  file_name: "plan.pdf", page, earlier_job_ids: [id(9000)],
  new_lines: [{ id: id(newLine), designation: "EF cuivre DN 20", unit: "ml", quantity, unit_key: "ml", candidate_ids: [id(201)] }],
  earlier_lines: [line(page)],
  pairs: [{ takeoff_item_id: id(newLine), estimate_item_id: id(201), source_item_id: id(page), reason: "same_designation", locked: false }],
  ambiguous_document: false, keep_both_refused: null });

describe("the quantity shown is the quantity stored", () => {
  const rows = [row(1, 101, 15), row(2, 102, 20)];
  const drafts = Object.fromEntries(rows.map((entry) => [entry.key, initialPageDraft(entry)]));

  it("shows a line carrying two replaced pages with both new measures, on each page", () => {
    const outcomes = pageOutcomes(rows, drafts);
    expect(rows.map((entry) => outcomes.get(entry.key)!.updated.map((updated) => [updated.before, updated.after, updated.pages])))
      .toEqual([[[20, 35, 2]], [[20, 35, 2]]]);
  });

  it("keeps the other page's part when only one page is replaced", () => {
    const keepSecond = { ...drafts, "row-2": { ...drafts["row-2"], decision: "keep_both" as const, reason: "other_zone" as const } };
    const outcomes = pageOutcomes(rows, keepSecond);
    expect(outcomes.get("row-1")!.updated.map((updated) => updated.after)).toEqual([25]);
  });

  it("asks once, for both pages, whether a quantity changed by hand takes the new measure", () => {
    const handRows = rows.map((entry) => ({ ...entry, earlier_lines: entry.earlier_lines.map((earlier) => ({ ...earlier, quantity: 24, changed_by_hand: true })) }));
    const chosen: Record<string, PageDraft> = { ...drafts, "row-1": { ...drafts["row-1"], takes: { [id(201)]: "keep_mine" as const } } };
    expect(handRows.map((entry) => pageMissing(entry, chosen[entry.key], { rows: handRows, drafts: chosen }))).toEqual([[], []]);
    expect(pageDecisionsPayload(handRows, chosen).map((decision) => decision.lines[0].take)).toEqual(["keep_mine", "keep_mine"]);
    expect(pageOutcomes(handRows, chosen).get("row-2")!.updated[0].after).toBe(24);
  });
});
