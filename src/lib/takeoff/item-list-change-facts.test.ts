import { describe, expect, it } from "vitest";

import { itemListChangedFacts } from "./item-list-change-facts";
import type { ItemListViewPoste } from "./item-list-server";

/** Two title rows of the DPGF: a section is identified by its row. */
const SECTION_SANITAIRES = "aaaaaaaa-0000-4000-8000-0000000000e3";
const SECTION_CHAUFFERIE = "aaaaaaaa-0000-4000-8000-0000000000e4";

/** A row of a fictional DPGF as a reader sees it in a proposal (no digest of its notes). */
function row(change: Partial<ItemListViewPoste> & { sourceUnit?: string | null } = {}): ItemListViewPoste {
  const { sourceUnit = null, ...item } = change;
  return {
    id: "aaaaaaaa-0000-4000-8000-0000000000d1", label: "Lavabo", expectedUnit: "u", measurementBasis: null, qualifiers: {},
    sections: [{ id: SECTION_SANITAIRES, title: "Plomberie", order: 2 }], synonyms: [], referenceQuantity: 2,
    origin: { kind: "dpgf", importId: "import-a", mappingId: "mapping", rawRowId: "raw-7", mappedRowId: "mapped-7", rowIndex: 7,
      sheetName: null, sourceRowNumber: null, sourcePage: null, tableIndex: null, documentId: null, reference: "3.1", sourceUnit },
    ...item,
  } as ItemListViewPoste;
}
const facts = (previous: ItemListViewPoste, current: ItemListViewPoste,
  extra: { moved?: boolean; notesChanged?: boolean; sourceFormat?: string } = {}) =>
  itemListChangedFacts({ previous, current, moved: extra.moved ?? false, notesChanged: extra.notesChanged ?? false },
    { sourceFormat: extra.sourceFormat ?? "xlsx" });

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
    const chaufferie = [{ id: SECTION_CHAUFFERIE, title: "Plomberie", order: 14 }];
    expect(facts(row(), row({ sections: chaufferie })))
      .toEqual(["Section : Plomberie (ligne importée 3) → Plomberie (ligne importée 15)"]);
    // A CSV numbers its records; an item added by hand into a DPGF section is placed by that section's own row.
    expect(facts(row(), row({ sections: chaufferie }), { sourceFormat: "csv" }))
      .toEqual(["Section : Plomberie (enregistrement importé 3) → Plomberie (enregistrement importé 15)"]);
    const manual = { kind: "manual", intentId: "aaaaaaaa-0000-4000-8000-0000000000e5", addedBy: "membre", addedAt: "2026-11-21T09:00:00Z",
      addedInRevision: 2 } as const;
    expect(facts(row({ origin: manual }), row({ origin: manual, sections: chaufferie })))
      .toEqual(["Section : Plomberie (ligne importée 3) → Plomberie (ligne importée 15)"]);
    // A template's families keep their position.
    expect(facts(row({ sections: [{ id: "reseaux", title: "Réseaux", order: 0 }] }),
      row({ sections: [{ id: "reseaux-bis", title: "Réseaux", order: 3 }] })))
      .toEqual(["Section : Réseaux (position 1) → Réseaux (position 4)"]);
    expect(facts(row(), row({ sections: [{ id: "section-eaux", title: "Eaux usées", order: 9 }] })))
      .toEqual(["Section : Plomberie → Eaux usées"]);
  });

  // A template line kept its identifier and moved to another family of the same title, at the same position: the two
  // families are told apart by the template version each side was read from.
  it("tells apart two template families of the same title and position", () => {
    const line = (version: number, familyId: string) => row({
      origin: { kind: "template", templateId: "plomberie", version, familyId, lineId: "lavabo" },
      sections: [{ id: familyId, title: "Appareils sanitaires", order: 2 }] });
    expect(facts(line(1, "appareils"), line(2, "appareils-sanitaires")))
      .toEqual(["Section : Appareils sanitaires (gabarit, version 1) → Appareils sanitaires (gabarit, version 2)"]);
    // Two DPGF sections of one title on the same row of two imports: still told apart.
    const imported = (importId: string, section: string) => row({ origin: { ...row().origin, importId } as ItemListViewPoste["origin"],
      sections: [{ id: section, title: "Plomberie", order: 2 }] });
    expect(facts(imported("import-a", SECTION_SANITAIRES), imported("import-b", SECTION_CHAUFFERIE)))
      .toEqual(["Section : Plomberie (ligne importée 3) → Plomberie (ligne importée 3, autre section du même nom)"]);
  });

  it("agrees the absence of a value with its fact, and names a change of notes or of place", () => {
    expect(facts(row({ qualifiers: { material: "Cuivre" } }), row())).toEqual(["Matière : Cuivre → aucune"]);
    expect(facts(row({ qualifiers: { network: "EF" } }), row())).toEqual(["Réseau : EF → aucun"]);
    expect(facts(row({ expectedUnit: "m" }), row(), { notesChanged: true, moved: true }))
      .toEqual(["Unité : m → u", "Notes de la ligne de la DPGF modifiées", "Place dans la liste modifiée"]);
  });
});
