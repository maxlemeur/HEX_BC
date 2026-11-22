import { describe, expect, it } from "vitest";

import { itemListChangedFacts } from "./item-list-change-facts";
import type { ItemListViewPoste } from "./item-list-server";

/** A row of a fictional DPGF as a reader sees it in a proposal (no digest of its notes). */
function row(change: Partial<ItemListViewPoste> & { sourceUnit?: string | null } = {}): ItemListViewPoste {
  const { sourceUnit = null, ...item } = change;
  return {
    id: "aaaaaaaa-0000-4000-8000-0000000000d1", label: "Lavabo", expectedUnit: "u", measurementBasis: null, qualifiers: {},
    sections: [{ id: "section-sanitaires", title: "Plomberie", order: 2 }], synonyms: [], referenceQuantity: 2,
    origin: { kind: "dpgf", importId: "import-a", mappingId: "mapping", rawRowId: "raw-7", mappedRowId: "mapped-7", rowIndex: 7,
      sheetName: null, sourceRowNumber: null, sourcePage: null, tableIndex: null, documentId: null, reference: "3.1", sourceUnit },
    ...item,
  } as ItemListViewPoste;
}
const facts = (previous: ItemListViewPoste, current: ItemListViewPoste, extra: { moved?: boolean; notesChanged?: boolean } = {}) =>
  itemListChangedFacts({ previous, current, moved: extra.moved ?? false, notesChanged: extra.notesChanged ?? false });

describe("what a proposal tells of a changed item", () => {
  it("shows the unit each side is measured in, a DPGF unit the list does not recognise included", () => {
    expect(facts(row({ expectedUnit: null, sourceUnit: "kit" }), row({ expectedUnit: "u", sourceUnit: "u" })))
      .toEqual(["Unité : kit → u"]);
    expect(facts(row({ expectedUnit: "m" }), row({ expectedUnit: "u" }))).toEqual(["Unité : m → u"]);
    // Counterexample: a unit given by the list where the DPGF gave the same one changes nothing a reader measures in.
    expect(facts(row({ expectedUnit: null, sourceUnit: "u" }), row({ expectedUnit: "u", sourceUnit: "u" }))).toEqual([]);
    expect(facts(row({ expectedUnit: null }), row({ expectedUnit: "u" }))).toEqual(["Unité : à préciser → u"]);
  });

  it("tells two sections of the same title apart by their place in the DPGF", () => {
    expect(facts(row(), row({ sections: [{ id: "section-chaufferie", title: "Plomberie", order: 14 }] })))
      .toEqual(["Section : Plomberie (ligne importée 3) → Plomberie (ligne importée 15)"]);
    expect(facts(row(), row({ sections: [{ id: "section-eaux", title: "Eaux usées", order: 9 }] })))
      .toEqual(["Section : Plomberie → Eaux usées"]);
  });

  it("agrees the absence of a value with its fact, and names a change of notes or of place", () => {
    expect(facts(row({ qualifiers: { material: "Cuivre" } }), row())).toEqual(["Matière : Cuivre → aucune"]);
    expect(facts(row({ qualifiers: { network: "EF" } }), row())).toEqual(["Réseau : EF → aucun"]);
    expect(facts(row({ expectedUnit: "m" }), row(), { notesChanged: true, moved: true }))
      .toEqual(["Unité : m → u", "Notes de la ligne de la DPGF modifiées", "Place dans la liste modifiée"]);
  });
});
