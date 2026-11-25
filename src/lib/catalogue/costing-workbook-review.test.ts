import { describe, expect, it } from "vitest";

import { inspectCostingWorkbookColumns, readCostingWorkbookRows } from "./costing-workbook";
import {
  articleFindings,
  groupSupplierDecisions,
  missingColumnWarnings,
  rankSupplierCandidates,
  supplierNameSimilarity,
  type SupplierDecision,
} from "./costing-workbook-review";

/**
 * Failure modes of what the import screen works out from the sheet (TI-711), written before the screen.
 *  1. A draft the office must complete before validating (no price, a default unit or classification, no
 *     material, no supply type) looks like the others in the list.
 *  2. A missing column that changes what is imported is not said, or a workbook with two suppliers is warned
 *     about its absent third.
 *  3. A workbook supplier name is not brought to the catalogue supplier it abbreviates or extends, or is
 *     brought to an unrelated one.
 *  4. Several hundred cells that one fix resolves (a supplier name, an article identifier) are listed one by
 *     one; cells that share nothing are merged.
 */

const HEADERS = ["ID", "Caractéristique", "Matériau", "Unité", "PR. FO", "Type FO", "F1_nom", "F1_ref", "F2_nom", "F2_ref", "Type_ligne"];

describe("articleFindings", () => {
  it("lists what to check on a draft, in the order the office reads it (1)", () => {
    const { articles } = readCostingWorkbookRows([
      HEADERS,
      ["A.1", "Tube", "Inox 304L soudé", "ml", 12.5, "I4L", null, null, null, null, "Art"],
      ["A.2", "Vase expansion", "", "", null, "", null, null, null, null, "Art"],
    ]);
    expect(articleFindings(articles[0], false)).toEqual([]);
    expect(articleFindings(articles[1], false)).toEqual(["price_missing", "unit_defaulted", "supply_type_defaulted", "material_missing"]);
    // Without a supply type, the default classification is no longer the point.
    expect(articleFindings(articles[1], true)).toEqual(["price_missing", "unit_defaulted", "without_supply_type", "material_missing"]);
  });
});

describe("missingColumnWarnings", () => {
  it("warns about a column whose absence changes the import, not about an absent supplier (2)", () => {
    const inspection = inspectCostingWorkbookColumns([
      ["ID", "Caractéristique", "Matériau", "Type_ligne", "Unité", "PR FO", "F1_nom", "F1_ref", "F2_nom"],
    ]);
    expect(missingColumnWarnings(inspection)).toEqual([
      { column: "Fiabilité (/10)", effect: "aucun article n’aurait de note de fiabilité" },
      { column: "Dimension", effect: "aucun article n’aurait de dimension" },
      { column: "PR. FO", effect: "tous les articles seraient importés sans prix (0 €)" },
      { column: "Type FO", effect: "le type de fourniture serait déduit du libellé seul" },
      // F2_nom without F2_ref is a pair cut in half; F3 is simply absent.
      { column: "F2_ref", effect: "les références du fournisseur 2 ne seraient pas lues" },
    ]);
  });
});

describe("supplier name matching", () => {
  const directory = [
    { id: "1", name: "Point P Matériaux", label: "Point P Matériaux" },
    { id: "2", name: "Comptoir Atlas SAS", label: "Comptoir Atlas SAS" },
    { id: "3", name: "Plastiques Union Matériaux", label: "Plastiques Union Matériaux" },
    { id: "4", name: "Rexel", label: "Rexel" },
  ];

  it("brings a workbook name to the supplier it abbreviates, extends or misspells (3)", () => {
    expect(supplierNameSimilarity("COMPTOIR ATLAS", "Comptoir Atlas SAS")).toBe(1);
    expect(rankSupplierCandidates("Point P", directory).map(({ id }) => id)).toEqual(["1"]);
    expect(rankSupplierCandidates("Sté Comptoir-Atlas", directory)[0]).toMatchObject({ id: "2", score: 1 });
    expect(rankSupplierCandidates("PUM", directory)[0]).toMatchObject({ id: "3" });
    expect(rankSupplierCandidates("Pt.P", directory)[0]).toMatchObject({ id: "1", score: 0.75 });
    // A lone letter stands for itself only: « Pt.P » is not « Petit Plombier ».
    expect(supplierNameSimilarity("Pt.P", "Petit Plombier")).toBeLessThan(0.6);
    expect(rankSupplierCandidates("Rexell", directory)[0]).toMatchObject({ id: "4" });
    expect(rankSupplierCandidates("Brossette", directory)).toEqual([]);
    expect(rankSupplierCandidates("", directory)).toEqual([]);
  });
});

describe("groupSupplierDecisions", () => {
  const rows = [
    HEADERS,
    ["A.1", "Tube", "Inox", "ml", 1, "I4L", "Pt.P", "P-1", "Inconnu", "I-1", "Art"],
    ["A.1", "Tube", "Inox", "ml", 1, "I4L", "pt.p", "P-2", "", "I-2", "Art"],
    ["A.2", "Coude", "Inox", "u", 1, "I4L", "Pt.P", "P-3", null, null, "Art"],
  ];
  const sources = new Map(readCostingWorkbookRows(rows).supplierReferenceOccurrences.map((source) => [`${source.row}-${source.slot}`, source]));
  const decisions: SupplierDecision[] = [
    { row: 2, slot: 1, reason: "supplier_not_found" },
    { row: 2, slot: 2, reason: "supplier_not_found" },
    { row: 3, slot: 1, reason: "supplier_not_found" },
    { row: 3, slot: 2, reason: "invalid_supplier_name" },
    { row: 4, slot: 1, reason: "supplier_not_found" },
  ];

  it("groups the cells one fix resolves, and leaves the others alone (4)", () => {
    const bySupplier = groupSupplierDecisions(decisions, sources, true);
    expect(bySupplier.map(({ key, kind, label, entries }) => [key, kind, label, entries.length])).toEqual([
      ["supplier:pt.p", "supplier", "Pt.P", 3],
      ["supplier:inconnu", "supplier", "Inconnu", 1],
      // No name to share: a cell on its own.
      ["cell:3-2", "cell", "", 1],
    ]);
    const byArticle = groupSupplierDecisions(decisions.map((entry) => ({ ...entry, reason: "article_not_found" as const })), sources, true);
    expect(byArticle.map(({ key, entries }) => [key, entries.length])).toEqual([["article:a.1", 4], ["article:a.2", 1]]);
    expect(groupSupplierDecisions(decisions, sources, false).every(({ kind, entries }) => kind === "cell" && entries.length === 1)).toBe(true);
  });
});
