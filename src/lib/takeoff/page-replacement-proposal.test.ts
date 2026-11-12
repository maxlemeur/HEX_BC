import { describe, expect, it } from "vitest";

import type { TakeoffPageReplacementResponse } from "@/lib/takeoff/page-replacement-contracts";
import {
  buildPageReplacementProposal,
  type EstimateLineRow,
  type PageReplacementInput,
  type TakeoffLineRow,
} from "@/lib/takeoff/page-replacement-proposal";

// TI-682 lot D, PR 2, Codex review of 708c7fbf: the proposal reasons about the application as the database does, per
// estimate line across every page it reads. Written before the fix (red on 708c7fbf): a new line without a page was
// paired on each page it lies on (the database refuses `new_line_paired_twice`), and a line whose pages are all
// re-measured was marked as carrying other pages (removal disabled, although the database accepts it). Fictional values.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PLAN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EARLIER = id(9001);
const NEW = id(9002);

const takeoffLine = (n: number, job: string, designation: string, quantity: number, unit: string, page: number | null): TakeoffLineRow => ({
  id: id(n), job_id: job, designation, unit, quantity, is_excluded: false, created_at: `2026-11-11T10:00:${String(n % 60).padStart(2, "0")}Z`,
  source_file_name: "plan-fictif.pdf", source_page: page, source_document: { kind: "plan_file", plan_file_id: PLAN }, rule_inputs: null,
});
/** A length the earlier takeoff merged over pages 1 and 2 (10 m each), as finalize_takeoff_lengths leaves it. */
const mergedLength: EstimateLineRow = {
  id: id(201), title: "EF cuivre DN 20", unit_code: "ml", description: "ml", pricing_status: "priced", quantity: 20,
  updated_at: "2026-11-11T10:05:00.000000+00:00", unit_price_ht_cents: 2500, parent_id: id(200), position: 1, item_type: "line",
  source_provider: "takeoff", source_job_id: EARLIER, source_file_name: "plan-fictif.pdf", source_page: 1,
  takeoff_item_id: id(101), rounding_item_ids: [id(101), id(102)], rounding_job_id: EARLIER, policy_item_ids: null, policy_job_id: null,
  replacement_item_ids: null, replacement_job_id: null, mapping_action: null,
};
const earlierLines = [takeoffLine(101, EARLIER, "EF cuivre DN 20", 10, "ml", 1), takeoffLine(102, EARLIER, "EF cuivre DN 20", 10, "ml", 2)];

function proposal(ownLines: TakeoffLineRow[]): TakeoffPageReplacementResponse {
  const input: PageReplacementInput = { jobId: NEW, versionId: id(9100), mergeRequired: false, ownLines, referencedLines: earlierLines,
    estimateRows: [mergedLength], jobs: [EARLIER, NEW].map((job, index) => ({ id: job, created_at: `2026-11-1${index}T09:00:00Z`, level: "B",
      source_file_name: "plan-fictif.pdf", sources: null })),
    leftOut: new Set(), merge: null, fedTargets: new Map() };
  return buildPageReplacementProposal(input);
}

// What the proposal offers, whatever its shape: the pairs it proposes for a new line, and whether a line may be removed.
const proposedPairs = (result: TakeoffPageReplacementResponse, newLine: string) =>
  result.pairs.filter((pair) => pair.takeoff_item_id === newLine).map((pair) => pair.estimate_item_id);
const removable = (result: TakeoffPageReplacementResponse, line: string) =>
  result.lines.filter((earlier) => earlier.id === line).map((earlier) => !earlier.outside_pages);

describe("the proposal reasons per estimate line, across the pages of the application", () => {
  it("proposes a new line without a page once, although it lies on both pages of the line it replaces", () => {
    const result = proposal([takeoffLine(301, NEW, "EF cuivre DN 20", 18, "ml", null)]);
    expect(result.pages.map((page) => [page.page, page.new_line_ids])).toEqual([[1, [id(301)]], [2, [id(301)]]]);
    expect(proposedPairs(result, id(301))).toEqual([id(201)]);
    // Stated once: the line, with its sources on each page; the new line, with what it may replace on each page.
    expect(result.lines.map((line) => line.id)).toEqual([id(201)]);
    expect(result.pages.map((page) => page.lines)).toEqual([[{ id: id(201), item_ids: [id(101)] }], [{ id: id(201), item_ids: [id(102)] }]]);
    expect(result.new_lines.map((line) => line.candidates.map((candidate) => candidate.line_ids))).toEqual([[[id(201)], [id(201)]]]);
  });

  it("lets a vanished line be removed when every page it carries is re-measured", () => {
    const result = proposal([takeoffLine(301, NEW, "Vanne d'arrêt", 2, "u", 1), takeoffLine(302, NEW, "Vanne d'arrêt", 1, "u", 2)]);
    expect(result.pages.map((page) => page.page)).toEqual([1, 2]);
    expect(removable(result, id(201))).toEqual([true]);
  });

  it("keeps a line carrying a page the application does not read from being removed", () => {
    const result = proposal([takeoffLine(301, NEW, "Vanne d'arrêt", 2, "u", 1)]);
    expect(removable(result, id(201))).toEqual([false]);
  });
});
