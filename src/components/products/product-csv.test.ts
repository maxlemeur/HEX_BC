import { describe, expect, it } from "vitest";

import { parseProductCsv } from "./product-csv";

describe("parseProductCsv", () => {
  it("maps French headers and semicolon-delimited localized values", () => {
    const result = parseProductCsv([
      "Référence;Désignation;Famille;Type;Matière;Nuance;Dimensions;Norme;Unité;Prix unitaire HT;TVA",
      "INOX-001;Tube inox 304L;Tuyauterie;Tube;Inox;304L;DN 50;EN 10217;m;1 234,56 €;20%",
    ].join("\n"));

    expect(result.delimiter).toBe(";");
    expect(result.rejectedRows).toEqual([]);
    expect(result.acceptedRows).toEqual([
      {
        reference: "INOX-001",
        designation: "Tube inox 304L",
        category: "Tuyauterie",
        product_type: "Tube",
        material: "Inox",
        grade: "304L",
        dimensions: "DN 50",
        standard: "EN 10217",
        unit: "m",
        unit_price_cents: 123456,
        tax_rate_bp: 2000,
        is_active: true,
      },
    ]);
  });

  it("supports comma-delimited English headers and quoted cells", () => {
    const result = parseProductCsv([
      "reference,designation,category,material,unit_price,tax_rate",
      'A-1,"Elbow, stainless steel",Fittings,Stainless steel,12.5,5.5',
    ].join("\n"));

    expect(result.acceptedRows[0]).toMatchObject({
      reference: "A-1",
      designation: "Elbow, stainless steel",
      category: "Fittings",
      material: "Stainless steel",
      unit_price_cents: 1250,
      tax_rate_bp: 550,
    });
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
    expect(result.acceptedRows[0]).toMatchObject({ unit_price_cents: 0, tax_rate_bp: 2000 });
    expect(result.rejectedRows).toEqual([
      expect.objectContaining({ line: 3, reasons: ["Désignation obligatoire"] }),
      expect.objectContaining({ line: 4, reasons: ["Prix unitaire HT invalide"] }),
      expect.objectContaining({
        line: 5,
        reasons: ["Référence en double dans le fichier", "TVA invalide (valeur attendue entre 0 et 100)"],
      }),
    ]);
  });

  it("requires a designation-compatible column", () => {
    expect(() => parseProductCsv("reference;prix\nA-1;12")).toThrow(/colonne obligatoire désignation/i);
  });
});
