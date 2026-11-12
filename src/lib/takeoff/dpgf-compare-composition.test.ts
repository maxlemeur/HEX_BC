import { describe, expect, it } from "vitest";

import { computeTakeoffDpgfRows } from "@/lib/takeoff/dpgf-compare";
import type { DpgfContribution } from "@/lib/takeoff/dpgf-composition";
import { dpgfReviewQuantitySnapshot } from "@/lib/takeoff/dpgf-review-quantity";
import type { TakeoffDpgfReviewDecisionRecord } from "@/lib/takeoff/types";

// TI-682 lot D4: the reconciliation judges a DPGF line on the total it will hold, the other takeoffs it keeps and this
// one, shows that composition by takeoff and page, flags a line drawn again in a line it keeps, and a decision taken
// on another composition goes stale. Written before the reconciliation read any other takeoff (red on 32b078dd).
// Fictional identifiers and quantities.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const versionId = id(1);
const jobOne = id(11);
const jobTwo = id(12);
const target = id(3);

const takeoffLine = (n: number, quantity: number, page: number, designation = "EF cuivre DN 22", unit = "ml") => ({
  item_id: id(n), designation, quantity, unit, confidence: 0.99, source_page: page, source_file_name: "plan-fictif.pdf",
  evidence: "Mesure fictive", metadata: {},
});

function input(options: {
  reference: number | null;
  current: Array<ReturnType<typeof takeoffLine>>;
  earlier: DpgfContribution[];
  readAgain?: string[];
  partners?: Map<string, Array<{ item_id: string; job_id: string; overlap_m: number; resolved: boolean }>>;
  decision?: TakeoffDpgfReviewDecisionRecord;
  unit?: string;
  title?: string;
}) {
  return {
    versionId, jobId: jobTwo,
    dpgfLines: [{ estimate_item_id: target, title: options.title ?? "EF cuivre DN 22", description: null,
      quantity: options.reference, unit: options.unit ?? "ml", source_page: 1, source_file_name: "dpgf-fictif.xlsx", position: 1 }],
    takeoffLines: options.current,
    reviewDecisions: options.decision ? [options.decision] : [],
    dpgfCompositions: {
      targets: new Map([[target, { contributions: options.earlier }]]),
      lines: new Map(options.earlier.flatMap((entry) => entry.item_ids.map((itemId, index) => [itemId,
        { job_id: entry.job_id, source_file_name: "plan-fictif.pdf", source_page: index + Number(itemId.slice(-2)) % 10 }] as const))),
      jobs: new Map([[jobOne, { created_at: "2026-11-10T09:00:00Z", level: "B" }]]),
    },
    readAgainItemIds: new Set(options.readAgain ?? []),
    overlapPartners: options.partners ?? new Map(),
  } as Parameters<typeof computeTakeoffDpgfRows>[0];
}
const part = (n: number, quantity: number, job = jobOne): DpgfContribution =>
  ({ job_id: job, item_ids: [id(n)], quantity, protective: 0, printed_gap: 0 });

describe("the reconciliation of a DPGF line other takeoffs feed", () => {
  it("judges the gap on the total the line will hold, and shows it by takeoff and page", () => {
    // 12 ml from another takeoff, 10 ml from this one: 22 against a DPGF reference of 22, no gap.
    const [row] = computeTakeoffDpgfRows(input({ reference: 22, current: [takeoffLine(201, 10, 2)], earlier: [part(101, 12)] })).rows;
    expect(row.takeoff_quantity).toBe(10);
    expect(row.composition).toEqual({
      earlier: [{ job_id: jobOne, job_created_at: "2026-11-10T09:00:00Z", job_level: "B", quantity: 12, read_again: false,
        pages: [{ source_file_name: "plan-fictif.pdf", source_page: 1, quantity: 12 }] }],
      earlier_quantity: 12, earlier_protective: 0, earlier_printed_gap: 0, total_quantity: 22, double_counted: [],
    });
    expect(row.delta_absolute).toBe(0);
    expect(row.review_status).not.toBe("significant_gap");
    // Alone, this takeoff's 10 ml against 22 is a significant gap: the other takeoff no longer hides behind it.
    const [alone] = computeTakeoffDpgfRows(input({ reference: 22, current: [takeoffLine(201, 10, 2)], earlier: [] })).rows;
    expect(alone.review_status).toBe("significant_gap");
    expect(alone.composition).toBeUndefined();
  });

  it("leaves out of the total the earlier part of a page this takeoff reads again (replaced by default)", () => {
    const [row] = computeTakeoffDpgfRows(input({ reference: 30, current: [takeoffLine(201, 10, 1)],
      earlier: [part(101, 12), part(102, 6)], readAgain: [id(101)] })).rows;
    expect(row.composition?.earlier.map((entry) => [entry.quantity, entry.read_again])).toEqual([[6, false], [12, true]]);
    expect(row.composition?.total_quantity).toBe(16);
  });

  it("keeps in the total a part of unknown share that lies partly on a page this takeoff does not read (TI-696)", () => {
    // A policy applied before D4, one block over pages 1 and 2; the relaunch reads page 1 only. The application cannot take
    // it out (dpgf_part_unknown): the page is kept both, and the line holds the block and this takeoff's measure.
    const block: DpgfContribution = { job_id: jobOne, item_ids: [id(101), id(102)], quantity: 45, protective: 0, printed_gap: 0 };
    const [row] = computeTakeoffDpgfRows(input({ reference: 30, current: [takeoffLine(201, 10, 1)], earlier: [block], readAgain: [id(101)] })).rows;
    expect([row.composition?.earlier.map((entry) => [entry.quantity, entry.read_again]), row.composition?.total_quantity]).toEqual([[[45, false]], 55]);
  });

  it("judges a decision on the pages the review reads again, the total on those the application does (TI-696)", () => {
    // DPGF reference 14. At the review page 1 is read again (its 12 leaves the total): 10 + 6 = 16, the measure kept.
    const atReview = input({ reference: 14, current: [takeoffLine(201, 10, 2)], earlier: [part(101, 12), part(102, 6)], readAgain: [id(101)] });
    const [first] = computeTakeoffDpgfRows(atReview).rows;
    const decision = { id: id(501), tenant_id: id(2), version_id: versionId, takeoff_job_id: jobTwo, estimate_item_id: target,
      decision: "keep_takeoff", reason: "Mesure vérifiée (fictif)", review_reference: "ref", line_label: "EF cuivre DN 22", line_position: 1,
      source_file_name: "dpgf-fictif.xlsx", source_page: 1, decided_at: "2026-11-12T08:00:00Z", updated_at: "2026-11-12T08:00:00Z",
      decided_by: id(1), quantity_snapshot: dpgfReviewQuantitySnapshot(first), source: "current_version",
      carried_over_from_version_id: null, carried_over_from_version_number: null } as TakeoffDpgfReviewDecisionRecord;
    const later = (readAgain: string[]) => input({ reference: 14, current: [takeoffLine(201, 10, 2)], earlier: [part(101, 12), part(102, 6)],
      readAgain, decision });
    // At the application the mapping plan leaves the page's only line out: page 1 is no longer read again and the total is
    // 28; the decision, taken on the pages the review reads again, stands.
    const [atApplication] = computeTakeoffDpgfRows({ ...later([]), decisionReadAgainItemIds: new Set([id(101)]) }).rows;
    expect([atApplication.composition?.total_quantity, atApplication.applied_decision?.id]).toEqual([28, id(501)]);
    // At the review, the line of page 1 excluded: the total under review changes, the decision goes stale.
    const [excluded] = computeTakeoffDpgfRows(later([])).rows;
    expect([excluded.composition?.total_quantity, excluded.applied_decision]).toEqual([28, null]);
  });

  it("judges a row decided out of scope as it would be fed, and states what its line keeps unfed (TI-696)", () => {
    // Reference 5. Another takeoff's 12 on page 1; this takeoff's only line on page 1 (10) is this row's, decided out of
    // scope: the application skips it, so page 1 is not read again and the line keeps 12. Fed, its line would read page 1
    // again and the line would hold 10.
    const decided = (decision: "out_of_scope" | "keep_takeoff", n: number, snapshot: Record<string, unknown>) => ({ id: id(n), tenant_id: id(2),
      version_id: versionId, takeoff_job_id: jobTwo, estimate_item_id: target, decision, reason: "Décision fictive", review_reference: "ref",
      line_label: "EF cuivre DN 22", line_position: 1, source_file_name: "dpgf-fictif.xlsx", source_page: 1, decided_at: "2026-11-12T08:00:00Z",
      updated_at: "2026-11-12T08:00:00Z", decided_by: id(1), quantity_snapshot: snapshot, source: "current_version",
      carried_over_from_version_id: null, carried_over_from_version_number: null }) as TakeoffDpgfReviewDecisionRecord;
    const [unfed] = computeTakeoffDpgfRows({ ...input({ reference: 5, current: [takeoffLine(201, 10, 1)], earlier: [part(101, 12)], readAgain: [],
      decision: decided("out_of_scope", 502, {}) }), readAgainIfFed: new Map([[target, new Set([id(101)])]]) }).rows;
    expect([unfed.composition?.total_quantity, unfed.composition?.unfed_quantity]).toEqual([10, 12]);
    // « Conserver métré » recorded on it, with the snapshot it reads there; once saved, its line reads page 1 again.
    const kept = decided("keep_takeoff", 503, dpgfReviewQuantitySnapshot(unfed));
    const [fed] = computeTakeoffDpgfRows(input({ reference: 5, current: [takeoffLine(201, 10, 1)], earlier: [part(101, 12)],
      readAgain: [id(101)], decision: kept })).rows;
    expect([fed.applied_decision?.id, fed.composition?.total_quantity, fed.composition?.unfed_quantity]).toEqual([id(503), 10, undefined]);
  });

  it("shows a count fed by two takeoffs with its composition, whatever the unit", () => {
    const [row] = computeTakeoffDpgfRows(input({ reference: 7, title: "WC suspendu", unit: "u",
      current: [takeoffLine(201, 3, 2, "WC suspendu", "u")], earlier: [part(101, 4)] })).rows;
    expect(row.composition?.earlier.map((entry) => entry.quantity)).toEqual([4]);
    expect(row.composition?.total_quantity).toBe(7);
  });

  it("puts to check a line of this takeoff drawn again in a line the target keeps, without taking anything off", () => {
    const partners = new Map([[id(201), [{ item_id: id(101), job_id: jobOne, overlap_m: 4.5, resolved: false }]]]);
    const [row] = computeTakeoffDpgfRows(input({ reference: 22, current: [takeoffLine(201, 10, 2)], earlier: [part(101, 12)], partners })).rows;
    expect(row.composition?.double_counted).toEqual([{ item_id: id(201), partner_item_id: id(101), partner_job_id: jobOne, overlap_m: 4.5 }]);
    expect(row.review_status).toBe("to_confirm");
    expect(row.composition?.total_quantity).toBe(22);
  });

  it("puts to check a line drawn again in a part of a page this takeoff reads again: « keep both » would keep it", () => {
    // Left out of the total by default (the page is replaced), but the estimator may keep both: the doubt stays on screen.
    const partners = new Map([[id(201), [{ item_id: id(102), job_id: jobOne, overlap_m: 2, resolved: false }]]]);
    const [row] = computeTakeoffDpgfRows(input({ reference: 30, current: [takeoffLine(201, 10, 1)],
      earlier: [part(101, 12), part(102, 6)], readAgain: [id(102)], partners })).rows;
    expect(row.composition?.double_counted).toEqual([{ item_id: id(201), partner_item_id: id(102), partner_job_id: jobOne, overlap_m: 2 }]);
    expect(row.composition?.total_quantity).toBe(22);
  });

  it("makes a review decision stale once what the line keeps of the other takeoffs changes", () => {
    const reviewed = input({ reference: 22, current: [takeoffLine(201, 10, 2)], earlier: [part(101, 12)] });
    const [first] = computeTakeoffDpgfRows(reviewed).rows;
    const decision = { id: id(500), tenant_id: id(2), version_id: versionId, takeoff_job_id: jobTwo, estimate_item_id: target,
      decision: "keep_takeoff", reason: "Mesure vérifiée (fictif)", review_reference: "ref", line_label: "EF cuivre DN 22", line_position: 1,
      source_file_name: "dpgf-fictif.xlsx", source_page: 1, decided_at: "2026-11-12T08:00:00Z", updated_at: "2026-11-12T08:00:00Z",
      decided_by: id(1), quantity_snapshot: dpgfReviewQuantitySnapshot(first), source: "current_version",
      carried_over_from_version_id: null, carried_over_from_version_number: null } as TakeoffDpgfReviewDecisionRecord;
    const [kept] = computeTakeoffDpgfRows(input({ reference: 22, current: [takeoffLine(201, 10, 2)], earlier: [part(101, 12)], decision })).rows;
    expect(kept.applied_decision?.id).toBe(id(500));
    const [changed] = computeTakeoffDpgfRows(input({ reference: 22, current: [takeoffLine(201, 10, 2)], earlier: [part(101, 14)], decision })).rows;
    expect(changed.applied_decision).toBeNull();
  });
});
