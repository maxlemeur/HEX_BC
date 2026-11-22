import { describe, expect, it } from "vitest";

import { isTakeoffCountUnit } from "./units";

import {
  deriveTakeoffCountMarkSummary,
  parseTakeoffCountMarkEditResult,
  parseTakeoffCountMarksPage,
  parseTakeoffCountMarkSummary,
  takeoffCountMarkEditRefusal,
  takeoffCountMarkSummaryLabel,
  TAKEOFF_COUNT_MARK_EDIT_REFUSALS,
  type TakeoffCountMarkPageFacts,
} from "./count-marks";

// The derivation of an answer's marks, as private.takeoff_count_mark_summary computes it
// (20261122144104_takeoff_count_marks.sql); the same cases as its pgTAP file. Fictional values.
const facts = (page: number, values: Partial<TakeoffCountMarkPageFacts> = {}): TakeoffCountMarkPageFacts => ({
  page, proposed: 0, toAttribute: 0, retained: 0, removed: 0, pending: 0, changedRevision: 0, verifiedRevision: null, ...values,
});

describe("deriveTakeoffCountMarkSummary", () => {
  it("leaves machine marks alone to check, with no quantity", () => {
    const summary = deriveTakeoffCountMarkSummary({ unit: "u", revision: 1, scopePages: [2, 7],
      pages: [facts(2, { proposed: 3, changedRevision: 1 }), facts(7, { toAttribute: 1, changedRevision: 1 })] });
    expect(summary).toMatchObject({ state: "to_check", proposed: 3, toAttribute: 1, retained: 0, reread: 0, quantity: null });
  });

  it("gives the marks retained once every page of the scope is verified, and nothing else", () => {
    const summary = deriveTakeoffCountMarkSummary({ unit: "u", revision: 2, scopePages: [7, 2],
      pages: [facts(2, { retained: 3, removed: 1, changedRevision: 2, verifiedRevision: 2 }),
        facts(7, { retained: 1, removed: 1, changedRevision: 2, verifiedRevision: 2 })] });
    // A grouped page total of lot 4 (3 for this answer) is no input: the count is 4, never 7.
    expect(summary).toMatchObject({ state: "verified", retained: 4, reread: 4, quantity: 4, verifiedPages: 2, scopePages: 2 });
    expect(summary.pages.map(({ page, state }) => `${page}:${state}`)).toEqual(["2:verified", "7:verified"]);
  });

  it("reopens the verification of the page a correction changed, even at the same count", () => {
    const summary = deriveTakeoffCountMarkSummary({ unit: "u", revision: 3, scopePages: [2, 7],
      pages: [facts(2, { retained: 3, changedRevision: 3, verifiedRevision: 2 }),
        facts(7, { retained: 1, changedRevision: 2, verifiedRevision: 2 })] });
    expect(summary).toMatchObject({ state: "to_verify_again", retained: 4, reread: 1, quantity: null });
    expect(summary.pages.map(({ state }) => state)).toEqual(["to_verify_again", "verified"]);
  });

  it("gives no quantity, never 0, once the last mark is removed", () => {
    const summary = deriveTakeoffCountMarkSummary({ unit: "u", revision: 5, scopePages: [2, 7],
      pages: [facts(2, { removed: 4, changedRevision: 5, verifiedRevision: 5 }),
        facts(7, { removed: 2, changedRevision: 5, verifiedRevision: 5 })] });
    expect(summary.state).toBe("no_mark_retained");
    expect(summary.quantity).toBeNull();
  });

  it("keeps the number proposed, the number reread and the quantity apart", () => {
    const summary = deriveTakeoffCountMarkSummary({ unit: "u", revision: 4, scopePages: [2, 7],
      pages: [facts(2, { retained: 2, changedRevision: 3, verifiedRevision: 4 }), facts(7, { proposed: 2, changedRevision: 1 })] });
    expect(summary).toMatchObject({ proposed: 2, reread: 2, retained: 2, quantity: null, state: "to_check" });
  });

  it("never counts as verified a page where something is still undecided", () => {
    const summary = deriveTakeoffCountMarkSummary({ unit: "u", revision: 2, scopePages: [2],
      pages: [facts(2, { retained: 1, toAttribute: 1, changedRevision: 1, verifiedRevision: 2 })] });
    expect(summary).toMatchObject({ verifiedPages: 0, quantity: null, state: "to_check" });
  });

  it("gives no quantity to a length or a surface: its marks locate the objects, its three numbers stay", () => {
    const summary = deriveTakeoffCountMarkSummary({ unit: "m²", revision: 2, scopePages: [2, 7],
      pages: [facts(2, { retained: 2, changedRevision: 2, verifiedRevision: 2 }), facts(7, { changedRevision: 0, verifiedRevision: 2 })] });
    expect(summary).toMatchObject({ state: "verified", counted: false, retained: 2, reread: 2, quantity: null });
    expect(takeoffCountMarkSummaryLabel(summary)).toBe("Repères vérifiés, sans quantité");
    expect(deriveTakeoffCountMarkSummary({ unit: null, revision: 2, scopePages: [2],
      pages: [facts(2, { retained: 1, changedRevision: 2, verifiedRevision: 2 })] }).quantity).toBeNull();
  });

  it("has nothing to say about an answer without marks, pending ones included", () => {
    expect(deriveTakeoffCountMarkSummary({ unit: "u", revision: 0, scopePages: [2, 7], pages: [] }))
      .toMatchObject({ state: "none", quantity: null, scopePages: 2 });
    expect(deriveTakeoffCountMarkSummary({ unit: "u", revision: 3, scopePages: [2], pages: [facts(2, { pending: 1 })] }))
      .toMatchObject({ state: "none", pending: 1, quantity: null });
  });
});

const uuid = (n: number) => `d5e00000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const summaryDocument = {
  answer_id: uuid(1), revision: 2, unit: "u", counted: true, proposed: 0, to_attribute: 0, retained: 4, removed: 2, pending: 0, reread: 4, scope_pages: 2,
  verified_pages: 2, quantity: 4, state: "verified",
  pages: [
    { page: 2, proposed: 0, to_attribute: 0, retained: 3, removed: 1, pending: 0, reread: 3, changed_revision: 2,
      verified_revision: 2, verified_by: uuid(9), verified_at: "2026-11-22T10:00:00+00:00", state: "verified" },
    { page: 7, proposed: 0, to_attribute: 0, retained: 1, removed: 1, pending: 0, reread: 1, changed_revision: 2,
      verified_revision: 2, verified_by: uuid(9), verified_at: "2026-11-22T10:00:00+00:00", state: "verified" },
  ],
};

describe("the database's documents", () => {
  it("reads the server-side count, the same as the pure derivation of its facts", () => {
    const parsed = parseTakeoffCountMarkSummary(summaryDocument);
    const derived = deriveTakeoffCountMarkSummary({ revision: parsed.revision, unit: parsed.unit,
      scopePages: parsed.pages.map(({ page }) => page), pages: parsed.pages });
    expect(derived).toEqual(parsed);
    expect(parseTakeoffCountMarkSummary({ ...summaryDocument, quantity: null, state: "to_verify_again" }).quantity).toBeNull();
  });

  it("reads a page of marks with its total apart from the number loaded", () => {
    const page = parseTakeoffCountMarksPage({
      answer_id: uuid(1), page: 2, revision: 1, total: 3, loaded: 1, next_after: uuid(20),
      geometry: { version: 1, view_box: [0, 0, 1190.55, 841.89], rotation: 0, user_unit: 1, width: 1190.55, height: 841.89,
        plan_file_id: uuid(100), plan_generation: "generation-fictive-1" },
      marks: [{ mark_id: uuid(20), x: 0.5, y: 0.25, box: null, origin: "machine", position_revision: 1, created_by: null,
        created_job_id: uuid(1010), created_at: "2026-11-22T09:00:00+00:00", moved_by: null, moved_at: null, state: "proposed",
        prior_state: null, reason_code: null, reason_text: null, decided_by: null, decided_at: null,
        possible_duplicates: [uuid(22)],
        others: [{ answer_id: uuid(2), item_id: uuid(301), state: "proposed", revision: 1 }],
        proposals: [{ proposal_id: uuid(30), answer_id: uuid(1), job_id: uuid(1010), observation_id: null, generation: 1,
          source_key: "lav-3", method: "symbol_count", method_version: "banc-1", state: "proposed", x: 0.5, y: 0.25, box: null,
          raw_centre: [120, 340], raw_box: null, raw_frame: "tile:1", source_ref: null, subtype: null, diameter_mm: 32,
          diameter_source: "label", confidence: 0.8, published_at: "2026-11-22T09:00:00+00:00" }] }],
    });
    expect(page).toMatchObject({ total: 3, loaded: 1, nextAfter: uuid(20), geometry: { rotation: 0, plan_file_id: uuid(100) } });
    expect(page.marks[0]).toMatchObject({ origin: "machine", state: "proposed", possibleDuplicates: [uuid(22)],
      others: [{ answerId: uuid(2), state: "proposed" }], proposals: [{ sourceKey: "lav-3", diameterMm: 32, rawCentre: [120, 340] }] });
  });

  it("refuses a document that is not one", () => {
    expect(() => parseTakeoffCountMarkSummary({ ...summaryDocument, state: "counted" })).toThrow(TypeError);
    expect(() => parseTakeoffCountMarksPage({ answer_id: uuid(1), page: 2, revision: 1, total: 0, loaded: 0, next_after: null,
      geometry: { version: 2, view_box: [0, 0, 1, 1], rotation: 0, user_unit: 1, width: 1, height: 1, plan_file_id: uuid(100),
        plan_generation: null }, marks: [] })).toThrow(TypeError);
  });

  it("reads an edit's answer: the new revisions, the marks added by key, the counts", () => {
    const result = parseTakeoffCountMarkEditResult({ replayed: false, command_id: uuid(40), revisions: { [uuid(1)]: 2 },
      added: [{ key: uuid(701), mark_id: uuid(21) }], summaries: { [uuid(1)]: summaryDocument } });
    expect(result).toMatchObject({ replayed: false, revisions: { [uuid(1)]: 2 }, added: [{ key: uuid(701), markId: uuid(21) }] });
    expect(result.summaries[uuid(1)]?.quantity).toBe(4);
  });

  it("names the command's refusals in French, and only those", () => {
    expect(takeoffCountMarkEditRefusal("TAKEOFF_MARKS_REVISION_CONFLICT")).toBe("TAKEOFF_MARKS_REVISION_CONFLICT");
    expect(takeoffCountMarkEditRefusal("TAKEOFF_MARKS_WRITER_REQUIRED")).toBeNull();
    expect(takeoffCountMarkEditRefusal("duplicate key value violates unique constraint")).toBeNull();
    expect(Object.values(TAKEOFF_COUNT_MARK_EDIT_REFUSALS).every((sentence) => !/TAKEOFF|_/.test(sentence))).toBe(true);
  });
});

describe("the count units (the same cases as the database's private.takeoff_count_unit_counts)", () => {
  it("counts pieces, never a length or a surface", () => {
    expect(["u", "U", "Unité", "unités", "pce", "Pièces", "ens", "Ensemble", "lot", "nb"].every(isTakeoffCountUnit)).toBe(true);
    expect(["m2", "m²", "ml", "m", "kg", "", null].some(isTakeoffCountUnit)).toBe(false);
  });
});
