import { describe, expect, it } from "vitest";

import { comparePosteRevisions, createPosteRevision, type DpgfPosteOrigin, type PosteDraft } from "./poste-list";
import { dpgfNotesDigest } from "./poste-list-dpgf";

const scope = { tenantId: "tenant", projectId: "affaire" };

function line(rawRowId: string, mappedRowId = rawRowId, importId = "import"): PosteDraft & { origin: DpgfPosteOrigin } {
  return {
    label: "Lavabo", expectedUnit: "u", measurementBasis: "comptage", qualifiers: {},
    sections: [{ id: "sanitaires", title: "Sanitaires", order: 1 }],
    referenceQuantity: 2,
    origin: {
      kind: "dpgf", importId, rawRowId, mappedRowId, rowIndex: 7, mappingId: "mapping",
      sheetName: null, sourceRowNumber: null, sourcePage: null, tableIndex: null,
      documentId: null, reference: "A7", sourceUnit: "u", measurementNotesDigest: null, factsDigest: "facts",
    },
  };
}

describe("poste list revisions", () => {
  it("keeps homonyms apart and preserves identity across a remapping and rename", () => {
    const initial = createPosteRevision(scope, [line("raw-a"), line("raw-b")]);
    const renamed = { ...line("raw-a", "new-mapped-a"), label: "Lavabo suspendu", referenceQuantity: 3 };
    const next = createPosteRevision(scope, [renamed, line("raw-b", "new-mapped-b")], initial);
    const diff = comparePosteRevisions(initial, next);

    expect(initial.items[0].id).not.toBe(initial.items[1].id);
    expect(next.items.map((item) => item.id)).toEqual(initial.items.map((item) => item.id));
    expect(next.digest).not.toBe(initial.digest);
    expect(initial.items[0].label).toBe("Lavabo");
    expect(diff.changes[0]).toMatchObject({ targetChanged: true, referenceChanged: true, measurementChanged: true });
    expect(diff.changes[1]).toMatchObject({ targetChanged: false, referenceChanged: false, measurementChanged: false });
    expect(createPosteRevision({ ...scope, projectId: "autre-affaire" }, [line("raw-a")]).items[0].id)
      .not.toBe(initial.items[0].id);
  });

  it("requires a reviewed link across imports and reports competing homonyms", () => {
    const initial = createPosteRevision(scope, [line("raw-a")]);
    const unlinked = createPosteRevision(scope, [line("raw-a", "other-mapped", "replacement")], initial);
    const match = { previousItemId: initial.items[0].id, nextItemId: unlinked.items[0].id };

    expect(comparePosteRevisions(initial, unlinked).continuities).toEqual([{ ...match, ambiguous: false }]);
    expect(comparePosteRevisions(initial, unlinked).removed).toEqual([initial.items[0]]);
    const accepted = createPosteRevision(scope, unlinked.items, initial, [match]);
    expect(accepted.items[0].id).toBe(initial.items[0].id);
    const retired = createPosteRevision(scope, [], accepted);
    expect(retired.items).toEqual([]);
    const restored = createPosteRevision(scope, [line("raw-a", "remapped-again", "replacement")], retired);
    expect(restored.items[0].id).toBe(initial.items[0].id);
    const ambiguous = createPosteRevision(scope, [line("raw-a", "a", "replacement"), line("raw-b", "b", "replacement")], initial);
    expect(comparePosteRevisions(initial, ambiguous).continuities.map((candidate) => candidate.ambiguous)).toEqual([true, true]);
  });

  it("handles replayed manual intents while keeping distinct additions with the same label", () => {
    const definition = { ...line("raw-a"), referenceQuantity: null };
    const manual = (intentId: string): PosteDraft => ({
      ...definition, origin: { kind: "manual", intentId, addedBy: "actor", addedAt: "2026-11-20T10:00Z", addedInRevision: 1 },
    });
    const initial = createPosteRevision(scope, [manual("a"), manual("a"), manual("b")]);
    const next = createPosteRevision(scope, [manual("a"), manual("b")], initial);

    expect(new Set(initial.items.map((item) => item.id)).size).toBe(2);
    expect(next.revision).toBe(1);
    expect(next.digest).toBe(initial.digest);
    expect(() => createPosteRevision(scope, [manual("a"), { ...manual("a"), label: "WC" }])).toThrow();
  });

  it("distinguishes a reference-only edit from a changed measurement basis", () => {
    const source = line("raw-a");
    const initial = createPosteRevision(scope, [source]);
    const referenceOnly = createPosteRevision(scope, [{ ...source, referenceQuantity: 3 }], initial);
    const basisChanged = createPosteRevision(scope, [{ ...source, measurementBasis: "par ensemble" }], initial);
    const scopeChanged = createPosteRevision(scope, [{
      // The row's notes are kept as a digest only (never their text in the list): a changed note still changes it.
      ...source, origin: { ...source.origin, measurementNotesDigest: dpgfNotesDigest("Rez-de-chaussée uniquement", "a".repeat(64)) },
    }], initial);

    expect(comparePosteRevisions(initial, referenceOnly).changes[0]).toMatchObject({
      referenceChanged: true, measurementChanged: false, targetChanged: false,
    });
    expect(comparePosteRevisions(initial, basisChanged).changes[0]).toMatchObject({ measurementChanged: true });
    expect(comparePosteRevisions(initial, scopeChanged).changes[0]).toMatchObject({
      measurementChanged: true, referenceChanged: false,
    });
  });
});
