import { describe, expect, it } from "vitest";

import { parseProductCsv } from "./product-csv";

const FAMILIES = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Tube" },
  { id: "22222222-2222-4222-8222-222222222222", name: "Raccord" },
];

describe("parseProductCsv", () => {
  it("maps French headers and semicolon-delimited localized values", () => {
    const result = parseProductCsv([
      "Référence;Désignation;Famille;Type;Matière;Nuance;Dimensions;Norme;Unité;Prix unitaire HT;TVA",
      "INOX-001;Tube inox 304L;tubes;Tube;Inox;304L;DN 50;EN 10217;m;1 234,56 €;20%",
    ].join("\n"), FAMILIES);

    expect(result.delimiter).toBe(";");
    expect(result.rejectedRows).toEqual([]);
    expect(result.acceptedRows).toEqual([
      {
        reference: "INOX-001",
        designation: "Tube inox 304L",
        // The family the file names is the company's « Tube », whatever its case or plural.
        supply_type_id: "11111111-1111-4111-8111-111111111111",
        family: "Tube",
        product_type: "Tube",
        material: "Inox",
        grade: "304L",
        dimensions: "DN 50",
        standard: "EN 10217",
        unit: "m",
        unit_price_cents: 123456,
        is_active: true,
      },
    ]);
    expect(result.ignoredColumns).toContain("TVA");
  });

  it("supports comma-delimited English headers and quoted cells", () => {
    const result = parseProductCsv([
      "reference,designation,family,type,material,unit_price,tax_rate",
      'A-1,"Elbow, stainless steel",Raccord,Elbow,Stainless steel,12.5,5.5',
    ].join("\n"), FAMILIES);

    expect(result.acceptedRows[0]).toMatchObject({
      reference: "A-1",
      designation: "Elbow, stainless steel",
      supply_type_id: "22222222-2222-4222-8222-222222222222",
      family: "Raccord",
      product_type: "Elbow",
      material: "Stainless steel",
      unit_price_cents: 1250,
    });
  });

  it("rejects a row whose family is not one of the company's, and files a row without family under none", () => {
    const result = parseProductCsv([
      "reference;designation;famille",
      "A-1;Pompe de relevage;Pompes",
      "A-2;Article sans famille;",
    ].join("\n"), FAMILIES);

    expect(result.rejectedRows).toEqual([
      { line: 2, designation: "Pompe de relevage", reasons: ["Famille inconnue du catalogue : « Pompes »"] },
    ]);
    expect(result.acceptedRows).toEqual([
      expect.objectContaining({ reference: "A-2", supply_type_id: null, family: null }),
    ]);
  });

  it("no longer reads the former free-text « catégorie » column", () => {
    const result = parseProductCsv([
      "reference;designation;categorie",
      "A-1;Tube inox;Tuyauterie",
    ].join("\n"), FAMILIES);

    expect(result.ignoredColumns).toEqual(["categorie"]);
    expect(result.acceptedRows[0]).toMatchObject({ supply_type_id: null, family: null });
  });

  it("rejects invalid rows while retaining valid rows and defaults", () => {
    const result = parseProductCsv([
      "reference;designation;prix_unitaire_ht;tva",
      "A-1;Produit valide;;",
      "A-2;;12;20",
      "A-3;Prix invalide;-2;20",
      "A-1;Doublon;10;120",
    ].join("\n"));

    expect(result.acceptedRows).toHaveLength(1);
    expect(result.acceptedRows[0]).toMatchObject({ unit_price_cents: 0 });
    expect(result.rejectedRows).toEqual([
      expect.objectContaining({ line: 3, reasons: ["Désignation obligatoire"] }),
      expect.objectContaining({ line: 4, reasons: ["Prix unitaire HT invalide"] }),
      expect.objectContaining({
        line: 5,
        reasons: ["Référence en double dans le fichier"],
      }),
    ]);
  });

  it("requires a designation-compatible column", () => {
    expect(() => parseProductCsv("reference;prix\nA-1;12")).toThrow(/colonne obligatoire désignation/i);
  });
});
