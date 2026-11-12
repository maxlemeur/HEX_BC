import { describe, expect, it } from "vitest";

import type { TakeoffPageReplacementResponse } from "@/lib/takeoff/page-replacement-contracts";

import { initialConfirmationDraft, resolveConfirmation, setConfirmationControl, confirmationControls } from "./page-decisions";

// TI-682 lot D4: the step shows what each DPGF line the application touches will hold, before and after, under the
// estimator's page decisions: the sum of the takeoffs it keeps, a replaced page's part taken out. A line that falls says
// so on the line, with why (the page no longer feeds it) and where the page's new measure went (lines added outside
// the DPGF, or nowhere); it never reads as unchanged. Written before the step knew any composition. Fictional values.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const document = { plan_file_id: null, content_hash: null, logical_document_id: null, file_name: "plan.pdf" };
const earlierJob = id(9000);
type Proposal = TakeoffPageReplacementResponse;
const proposal = (extra: Partial<Proposal>): Proposal => ({
  job_id: id(1), version_id: id(2), pages: [], lines: [], new_lines: [], pairs: [], jobs: [{ id: earlierJob,
    created_at: "2026-11-10T09:00:00.000Z", level: "B", source_file_name: "plan.pdf" }], unidentified_count: 0, merge_required: true,
  dpgf_targets: [], ...extra,
});
const dpgfLine = (n: number, title: string, quantity: number) => ({
  id: id(n), title, unit_key: "ml", quantity, measured_quantity: null, changed_by_hand: false, updated_at: "2026-11-12T10:00:00.000000+00:00",
  unit_price_ht_cents: 1000, dpgf_target: true, assembly: false, outside_pages: false, sources: [], length_factor: 1,
});
const part = (n: number, quantity: number, page: number) =>
  ({ job_id: earlierJob, item_ids: [id(n)], quantity, protective: 0, printed_gap: 0, source_file_name: "plan.pdf", source_page: page });
const fed = (n: number, quantity: number, page: number) =>
  ({ item_id: id(n), quantity, protective: 0, printed_gap: 0, source_file_name: "plan.pdf", source_page: page });
const target = (extra: Partial<Proposal["dpgf_targets"][number]>): Proposal["dpgf_targets"][number] => ({
  id: id(300), title: "EF cuivre DN 22", unit_key: "ml", quantity: 20, reference: 20, length_factor: 1, earlier: [], fed: [], ...extra,
});

describe("what each DPGF line the application touches will hold", () => {
  it("sums two takeoffs of two pages, with no page decision at all", () => {
    const data = proposal({ dpgf_targets: [target({ earlier: [part(101, 12.4, 1)], fed: [fed(201, 10.2, 2)] })] });
    const [outcome] = resolveConfirmation(data, initialConfirmationDraft(data)).dpgf;
    expect([outcome.before, outcome.after, outcome.falls]).toEqual([20, 23, false]);
    expect(outcome.takeoffs.map((entry) => [entry.job_id, entry.quantity, entry.pages.map((page) => [page.label, page.quantity])])).toEqual([
      [earlierJob, 12.4, [["plan.pdf, page 1", 12.4]]], [null, 10.2, [["plan.pdf, page 2", 10.2]]]]);
  });

  it("takes out the part of a page replaced without feeding the line, says it falls, why, and where the page's new measure went", () => {
    const data = proposal({
      pages: [{ key: "page-1", document, file_name: "plan.pdf", page: 1, earlier_job_ids: [earlierJob],
        lines: [{ id: id(300), item_ids: [id(101)] }], new_line_ids: [id(201), id(202)], dpgf_fed_again: [], ambiguous_document: false,
        keep_both_refused: null }],
      lines: [dpgfLine(300, "EF cuivre DN 22", 16)],
      new_lines: [{ id: id(201), designation: "EF cuivre DN 22", unit: "ml", quantity: 30, unit_key: "ml", candidates: [{ key: "page-1", line_ids: [] }] },
        { id: id(202), designation: "Vanne d'arrêt", unit: "u", quantity: 3, unit_key: "u", candidates: [{ key: "page-1", line_ids: [] }] }],
      dpgf_targets: [target({ quantity: 16, reference: 5, earlier: [part(101, 10, 1), part(102, 6, 2)] })],
    });
    const replaced = resolveConfirmation(data, initialConfirmationDraft(data));
    expect(replaced.complete).toBe(true);
    const [outcome] = replaced.dpgf;
    expect([outcome.before, outcome.after, outcome.falls]).toEqual([16, 6, true]);
    // Where the page's new measure went: the lines of its unit added outside the DPGF.
    expect(outcome.drops).toEqual([{ pageKey: "page-1", label: "plan.pdf, page 1", refed: false,
      destinations: [{ designation: "EF cuivre DN 22", quantity: 30, unit: "ml" }] }]);
    // The line on the page says it too.
    expect(replaced.lines.find((entry) => entry.line.id === id(300))?.after).toBe(6);

    const control = confirmationControls(replaced).find((entry) => entry.id === "page:page-1")!;
    const keptBoth = resolveConfirmation(data, setConfirmationControl(initialConfirmationDraft(data), control, "keep_both")).dpgf[0];
    expect([keptBoth.after, keptBoth.falls, keptBoth.drops]).toEqual([16, false, []]);
  });

  it("announces nothing for a line the application leaves as it is: neither fed nor on a page replaced", () => {
    // Its quantity differs from its composition (changed after the last takeoff): kept both, it stays 20; replaced, the
    // page's part leaves its sum and it is written.
    const data = proposal({
      pages: [{ key: "page-1", document, file_name: "plan.pdf", page: 1, earlier_job_ids: [earlierJob],
        lines: [{ id: id(300), item_ids: [id(101)] }], new_line_ids: [id(202)], dpgf_fed_again: [], ambiguous_document: false, keep_both_refused: null }],
      lines: [dpgfLine(300, "EF cuivre DN 22", 20)],
      new_lines: [{ id: id(202), designation: "Vanne d'arrêt", unit: "u", quantity: 3, unit_key: "u", candidates: [{ key: "page-1", line_ids: [] }] }],
      dpgf_targets: [target({ quantity: 20, reference: 5, earlier: [part(101, 13, 1)] })],
    });
    const replaced = resolveConfirmation(data, initialConfirmationDraft(data));
    expect([replaced.dpgf[0].after, replaced.dpgf[0].falls]).toEqual([5, true]);
    const control = confirmationControls(replaced).find((entry) => entry.id === "page:page-1")!;
    const kept = resolveConfirmation(data, setConfirmationControl(initialConfirmationDraft(data), control, "keep_both"));
    expect([kept.dpgf[0].before, kept.dpgf[0].after, kept.dpgf[0].falls, kept.dpgf[0].drops]).toEqual([20, 20, false, []]);
    expect(kept.lines[0].after).toBe(20);
  });

  it("says nowhere when the replaced page brings nothing of the line's unit", () => {
    const data = proposal({
      pages: [{ key: "page-1", document, file_name: "plan.pdf", page: 1, earlier_job_ids: [earlierJob],
        lines: [{ id: id(300), item_ids: [id(101)] }], new_line_ids: [id(202)], dpgf_fed_again: [], ambiguous_document: false, keep_both_refused: null }],
      lines: [dpgfLine(300, "EF cuivre DN 22", 10)],
      new_lines: [{ id: id(202), designation: "Vanne d'arrêt", unit: "u", quantity: 3, unit_key: "u", candidates: [{ key: "page-1", line_ids: [] }] }],
      dpgf_targets: [target({ quantity: 10, reference: 0, earlier: [part(101, 10, 1)] })],
    });
    const [outcome] = resolveConfirmation(data, initialConfirmationDraft(data)).dpgf;
    expect([outcome.after, outcome.drops[0]?.destinations]).toEqual([0, []]);
  });
});

describe("a DPGF part whose share per page is unknown (a policy applied before D4)", () => {
  // One part of two lines, on pages 1 and 2; the relaunch reads page 1 only.
  const data = proposal({ merge_required: false,
    pages: [{ key: "page-1", document, file_name: "plan.pdf", page: 1, earlier_job_ids: [earlierJob],
      lines: [{ id: id(300), item_ids: [id(101)] }], new_line_ids: [id(202)], dpgf_fed_again: [], ambiguous_document: false, keep_both_refused: null }],
    lines: [dpgfLine(300, "EF cuivre DN 22", 16)],
    new_lines: [{ id: id(202), designation: "Vanne d'arrêt", unit: "u", quantity: 3, unit_key: "u", candidates: [{ key: "page-1", line_ids: [] }] }],
    dpgf_targets: [target({ quantity: 16, reference: 5, earlier: [{ ...part(101, 16, 1), item_ids: [id(101), id(102)] }] })],
  });

  it("is never cut by replacing one of its pages: the line asks to keep both, and replacing is not recommended", () => {
    const resolution = resolveConfirmation(data, initialConfirmationDraft(data));
    expect([resolution.complete, resolution.pages[0].recommended]).toEqual([false, false]);
    expect(resolution.lines[0].missing).toEqual(["« EF cuivre DN 22 » : sa part sur plan.pdf, page 1 n’est pas connue (métré appliqué avant le "
      + "cumul) ; remplacer la page la retirerait entière. Gardez les deux mesures de la page."]);
    expect(resolution.lines[0].advice[0].choose).toEqual([{ control: "page:page-1", value: "keep_both" }]);
    expect(resolution.introduction.text).toBe("Une page n’entre qu’une fois : gardez les deux avec un motif.");
    const control = confirmationControls(resolution).find((entry) => entry.id === "page:page-1")!;
    const kept = resolveConfirmation(data, setConfirmationControl(initialConfirmationDraft(data), control, "keep_both"));
    expect([kept.lines[0].missing, kept.dpgf[0].after]).toEqual([[], 16]);
  });
});
