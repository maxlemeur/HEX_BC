import { describe, expect, it } from "vitest";

import type { TakeoffPageReplacementResponse } from "@/lib/takeoff/page-replacement-contracts";

import {
  confirmationControls,
  initialConfirmationDraft,
  resolveConfirmation,
  setConfirmationControl,
  type ConfirmationDraft,
} from "./page-decisions";

// TI-682 lot D, PR 2: the estimator's decisions, one draft for the whole application. Codex reviews of c06cbb1b and
// 708c7fbf: the database decides per estimate line across every page (private.takeoff_replace_pages aggregates every
// update of a line; one take, one removal, one pair per new line), so the screen and the decisions are read from one
// resolution of that draft. Fictional identifiers.

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const document = { plan_file_id: null, content_hash: null, logical_document_id: null, file_name: "plan.pdf" };
const key = (page: number) => `page-${page}`;
const page = (n: number, lines: Array<[number, number[]]>, newLines: number[], extra: Partial<TakeoffPageReplacementResponse["pages"][number]> = {}) => ({
  key: key(n), document, file_name: "plan.pdf", page: n, earlier_job_ids: [id(9000)],
  lines: lines.map(([line, items]) => ({ id: id(line), item_ids: items.map(id) })), new_line_ids: newLines.map(id),
  dpgf_fed_again: [], ambiguous_document: false, keep_both_refused: null, ...extra,
});
/** A length of 10 m on each of pages 1 and 2, merged into one estimate line. */
const length = (extra: Partial<TakeoffPageReplacementResponse["lines"][number]> = {}) => ({
  id: id(201), title: "EF cuivre DN 20", unit_key: "ml", quantity: 20, measured_quantity: 20, changed_by_hand: false,
  updated_at: "2026-11-11T10:00:00.000000+00:00", unit_price_ht_cents: 2500, dpgf_target: false, assembly: false, outside_pages: false,
  sources: [{ id: id(1), quantity: 10 }, { id: id(2), quantity: 10 }], length_factor: 1, ...extra,
});
const newLine = (n: number, quantity: number, candidates: Array<[number, number[]]>, designation = "EF cuivre DN 20", unit = "ml") => ({
  id: id(n), designation, unit, quantity, unit_key: unit, candidates: candidates.map(([pageNumber, lines]) => ({ key: key(pageNumber), line_ids: lines.map(id) })),
});
const proposal = (extra: Partial<TakeoffPageReplacementResponse>): TakeoffPageReplacementResponse => ({
  job_id: id(1), version_id: id(2), pages: [], lines: [], new_lines: [], pairs: [], jobs: [], unidentified_count: 0, merge_required: false, ...extra,
});
/** Re-measured on both pages: 15 m on page 1, 20 m on page 2, each proposed onto the merged line. */
const twoPages = (lineExtra: Partial<TakeoffPageReplacementResponse["lines"][number]> = {}) => proposal({
  pages: [page(1, [[201, [1]]], [101]), page(2, [[201, [2]]], [102])],
  lines: [length(lineExtra)],
  new_lines: [newLine(101, 15, [[1, [201]]]), newLine(102, 20, [[2, [201]]])],
  pairs: [{ takeoff_item_id: id(101), estimate_item_id: id(201), reason: "same_designation", locked: false },
    { takeoff_item_id: id(102), estimate_item_id: id(201), reason: "same_designation", locked: false }],
});
/** Sets one control by its id, as the screen does. */
const set = (data: TakeoffPageReplacementResponse, draft: ConfirmationDraft, controlId: string, value: unknown) => {
  const control = confirmationControls(resolveConfirmation(data, draft)).find((entry) => entry.id === controlId);
  if (!control) throw new Error(`no control ${controlId}`);
  return setConfirmationControl(draft, control, value);
};
const actions = (data: TakeoffPageReplacementResponse, draft: ConfirmationDraft) =>
  resolveConfirmation(data, draft).payload.map((decision) => [decision.decision, decision.lines.map((line) => [line.action, line.take])]);

describe("the quantity shown is the quantity stored (Codex review of c06cbb1b)", () => {
  it("shows a line of two replaced pages once, with both new measures", () => {
    const data = twoPages();
    const resolution = resolveConfirmation(data, initialConfirmationDraft(data));
    expect(resolution.lines.map((entry) => [entry.before, entry.after, entry.pages.map((onPage) => onPage.role)]))
      .toEqual([[20, 35, ["replaced", "replaced"]]]);
    expect(resolution.complete).toBe(true);
    expect(resolution.payload.map((decision) => decision.pairs.map((pair) => pair.takeoff_item_id))).toEqual([[id(101)], [id(102)]]);
  });

  it("keeps the other page's part when that page keeps both", () => {
    const data = twoPages();
    let draft = set(data, initialConfirmationDraft(data), `page:${key(2)}`, "keep_both");
    draft = set(data, draft, `reason:${key(2)}`, "other_zone");
    const resolution = resolveConfirmation(data, draft);
    expect(resolution.lines.map((entry) => [entry.after, entry.pages.map((onPage) => onPage.role)])).toEqual([[25, ["replaced", "kept_both"]]]);
    expect(resolution.newLines.map((entry) => entry.pair)).toEqual([id(201), null]);
  });
});

describe("one owner per choice (Codex review of 708c7fbf)", () => {
  it("holds one take per line: the last one set, on every page it updates", () => {
    const data = twoPages({ quantity: 24, changed_by_hand: true });
    let draft = initialConfirmationDraft(data);
    expect(resolveConfirmation(data, draft).complete).toBe(false);
    draft = set(data, draft, `take:${id(201)}`, "keep_mine");
    draft = set(data, draft, `take:${id(201)}`, "new");
    expect(actions(data, draft)).toEqual([["replace", [["update", "new"]]], ["replace", [["update", "new"]]]]);
    expect(confirmationControls(resolveConfirmation(data, draft)).filter((control) => control.kind === "take").map((control) => control.value)).toEqual(["new"]);
    // A page then kept both carries no take: the other page's update carries the line's one choice.
    draft = set(data, set(data, draft, `page:${key(1)}`, "keep_both"), `reason:${key(1)}`, "other_trade");
    draft = set(data, draft, `take:${id(201)}`, "keep_mine");
    expect(actions(data, draft)).toEqual([["keep_both", [["keep", null]]], ["replace", [["update", "keep_mine"]]]]);
    expect(resolveConfirmation(data, draft).lines[0].after).toBe(24);
  });

  it("sends a new line without a page in one pair only, on the first page of the line it replaces", () => {
    const data = proposal({
      pages: [page(1, [[201, [1]]], [301]), page(2, [[201, [2]]], [301])],
      lines: [length()], new_lines: [newLine(301, 18, [[1, [201]], [2, [201]]])],
      pairs: [{ takeoff_item_id: id(301), estimate_item_id: id(201), reason: "same_designation", locked: false }],
    });
    const resolution = resolveConfirmation(data, initialConfirmationDraft(data));
    expect(resolution.complete).toBe(true);
    expect(resolution.payload.flatMap((decision) => decision.pairs)).toEqual([{ takeoff_item_id: id(301), estimate_item_id: id(201) }]);
    expect(actions(data, initialConfirmationDraft(data))).toEqual([["replace", [["update", null]]], ["replace", [["update", null]]]]);
    expect(resolution.lines[0].after).toBe(18);
  });

  it("lets a vanished line whose pages are all re-measured be removed, from one control, on every page", () => {
    const data = proposal({
      pages: [page(1, [[201, [1]]], [301]), page(2, [[201, [2]]], [302])], lines: [length()],
      new_lines: [newLine(301, 2, [[1, []]], "Vanne d'arrêt", "u"), newLine(302, 1, [[2, []]], "Vanne d'arrêt", "u")],
    });
    const draft = set(data, initialConfirmationDraft(data), `vanished:${id(201)}`, "remove");
    expect(confirmationControls(resolveConfirmation(data, draft)).find((control) => control.id === `vanished:${id(201)}`)?.options)
      .toEqual([{ value: "remove", disabled: null }, { value: "keep", disabled: null }]);
    expect(actions(data, draft)).toEqual([["replace", [["remove", null]]], ["replace", [["remove", null]]]]);
    expect(resolveConfirmation(data, draft).complete).toBe(true);
  });

  it("says why a vanished line cannot be removed: pages outside the application, or a page kept both", () => {
    const outside = proposal({ pages: [page(1, [[201, [1]]], [301])], lines: [length({ outside_pages: true })],
      new_lines: [newLine(301, 2, [[1, []]], "Vanne d'arrêt", "u")] });
    const removal = (data: TakeoffPageReplacementResponse, draft: ConfirmationDraft) =>
      confirmationControls(resolveConfirmation(data, draft)).find((control) => control.id === `vanished:${id(201)}`)!.options[0];
    expect(removal(outside, initialConfirmationDraft(outside)).disabled).toMatch(/pages que ce métré ne relit pas/);
    const both = proposal({ pages: [page(1, [[201, [1]]], [301]), page(2, [[201, [2]]], [302])], lines: [length()],
      new_lines: [newLine(301, 2, [[1, []]], "Vanne d'arrêt", "u"), newLine(302, 1, [[2, []]], "Vanne d'arrêt", "u")] });
    const kept = set(both, set(both, initialConfirmationDraft(both), `page:${key(2)}`, "keep_both"), `reason:${key(2)}`, "other_zone");
    expect(removal(both, kept).disabled).toMatch(/gardée avec plan\.pdf, page 2/);
    // A disabled option changes nothing.
    expect(set(both, kept, `vanished:${id(201)}`, "remove")).toBe(kept);
  });

  it("asks for the part of a re-measured page no new line replaces, and sends it as the line's own update", () => {
    const data = proposal({
      pages: [page(1, [[201, [1]]], [101]), page(2, [[201, [2]]], [302])], lines: [length()],
      new_lines: [newLine(101, 15, [[1, [201]]]), newLine(302, 1, [[2, []]], "Vanne d'arrêt", "u")],
      pairs: [{ takeoff_item_id: id(101), estimate_item_id: id(201), reason: "same_designation", locked: false }],
    });
    let draft = initialConfirmationDraft(data);
    expect(resolveConfirmation(data, draft).complete).toBe(false);
    draft = set(data, draft, `part:${id(201)}:${key(2)}`, "drop");
    expect(actions(data, draft)).toEqual([["replace", [["update", null]]], ["replace", [["update", null]]]]);
    expect(resolveConfirmation(data, draft).lines[0].after).toBe(15);
    draft = set(data, draft, `part:${id(201)}:${key(2)}`, "keep");
    expect(actions(data, draft)).toEqual([["replace", [["update", null]]], ["replace", [["keep", null]]]]);
    expect(resolveConfirmation(data, draft).lines[0].after).toBe(25);
  });

  it("makes every enabled option of every control take effect, and states why a disabled one is not offered", () => {
    const data = twoPages({ quantity: 24, changed_by_hand: true });
    const seen = new Set<string>();
    const queue = [initialConfirmationDraft(data)];
    while (queue.length > 0 && seen.size < 200) {
      const draft = queue.shift()!;
      const signature = JSON.stringify(draft);
      if (seen.has(signature)) continue;
      seen.add(signature);
      for (const control of confirmationControls(resolveConfirmation(data, draft))) {
        for (const option of control.options) {
          if (option.disabled !== null) {
            expect(option.disabled.length).toBeGreaterThan(10);
            continue;
          }
          if (control.kind === "pair" && control.disabled) continue;
          const next = setConfirmationControl(draft, control, option.value);
          const after = confirmationControls(resolveConfirmation(data, next)).find((entry) => entry.id === control.id);
          expect(after?.value, `${control.id} = ${String(option.value)}`).toEqual(option.value);
          queue.push(next);
        }
      }
    }
    expect(seen.size).toBeGreaterThan(10);
  });
});
