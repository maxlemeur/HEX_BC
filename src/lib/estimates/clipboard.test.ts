import { describe, expect, it } from "vitest";

import {
  buildClipboardPreviewRows,
  detectClipboardFormat,
  normalizeClipboardHeader,
  parseClipboardNumber,
  parseTsvMatrix,
  serializeSelectedRowsToTsv,
  suggestClipboardColumnMapping,
  type ClipboardColumnMapping,
} from "@/lib/estimates/clipboard";

describe("clipboard tsv parsing", () => {
  it("parses tsv, trims cells, and dedupes duplicate/empty headers", () => {
    const matrix = parseTsvMatrix(
      "\uFEFFDesignation\tQuantité\tQuantité\t\r\n Porte \t 2 \t3\t\r\nFenêtre\t1\t\t\r\n\r\n"
    );

    expect(matrix.columnCount).toBe(4);
    expect(matrix.headers).toEqual([
      "Designation",
      "Quantité",
      "Quantité_2",
      "column_4",
    ]);
    expect(matrix.rows).toEqual([
      ["Porte", "2", "3", ""],
      ["Fenêtre", "1", "", ""],
    ]);
  });

  it("supports quoted cells containing tabs", () => {
    const matrix = parseTsvMatrix("Designation\tUnite\n\"Porte\tBois\"\tml");

    expect(matrix.headers).toEqual(["Designation", "Unite"]);
    expect(matrix.rows).toEqual([["Porte\tBois", "ml"]]);
  });
});

describe("clipboard header normalization and format detection", () => {
  it("normalizes accents and separators in headers", () => {
    expect(normalizeClipboardHeader("  Désignation  ")).toBe("designation");
    expect(normalizeClipboardHeader("Type_FO")).toBe("type fo");
    expect(normalizeClipboardHeader("Majoration MO (%)")).toBe("majoration mo %");
  });

  it("detects bdc_v1_1, optima, and generic formats", () => {
    expect(
      detectClipboardFormat([
        "Designation",
        "Quantite",
        "Unite",
        "Prix unitaire HT (EUR)",
        "Type FO",
        "K FO",
        "h MO",
        "K MO",
        "Majoration MO (%)",
      ])
    ).toBe("bdc_v1_1");

    expect(
      detectClipboardFormat([
        "Libellé",
        "Qté",
        "Unité",
        "PU HT",
        "Famille FO",
        "Temps majoré",
      ])
    ).toBe("optima");

    expect(detectClipboardFormat(["Nom", "Valeur", "Commentaire"])).toBe("generic");
  });
});

describe("clipboard mapping suggestions", () => {
  it("suggests all estimate fields from mixed french/english headers", () => {
    const headers = [
      "Désignation article",
      "Qty",
      "UoM",
      "Unit price HT",
      "Famille FO",
      "Coef FO",
      "Heures MO",
      "Coef MO",
      "Majoration MO (%)",
    ];

    const mapping = suggestClipboardColumnMapping(headers);

    expect(mapping).toEqual({
      "Désignation article": "designation",
      Qty: "quantity",
      UoM: "unit",
      "Unit price HT": "unit_price_ht",
      "Famille FO": "supply_type",
      "Coef FO": "k_fo",
      "Heures MO": "h_mo",
      "Coef MO": "k_mo",
      "Majoration MO (%)": "h_mo_majoration",
    });
  });

  it("prioritizes canonical bdc headers", () => {
    const headers = [
      "Designation",
      "Quantite",
      "Unite",
      "Prix unitaire HT (EUR)",
      "Type FO",
      "K FO",
      "h MO",
      "K MO",
      "Majoration MO (%)",
    ];

    const mapping = suggestClipboardColumnMapping(headers);

    expect(mapping["Designation"]).toBe("designation");
    expect(mapping["Quantite"]).toBe("quantity");
    expect(mapping["Unite"]).toBe("unit");
    expect(mapping["Prix unitaire HT (EUR)"]).toBe("unit_price_ht");
    expect(mapping["Type FO"]).toBe("supply_type");
    expect(mapping["K FO"]).toBe("k_fo");
    expect(mapping["h MO"]).toBe("h_mo");
    expect(mapping["K MO"]).toBe("k_mo");
    expect(mapping["Majoration MO (%)"]).toBe("h_mo_majoration");
  });

  it("maps bdc PR.FO header to unit_price_ht", () => {
    const headers = ["Designation", "Quantite", "PR.FO", "Type FO"];

    const mapping = suggestClipboardColumnMapping(headers);

    expect(mapping["PR.FO"]).toBe("unit_price_ht");
  });
});

describe("clipboard number parsing", () => {
  it("parses FR and EN number formats", () => {
    expect(parseClipboardNumber("1 234,56")).toBeCloseTo(1234.56, 6);
    expect(parseClipboardNumber("1 234,56")).toBeCloseTo(1234.56, 6);
    expect(parseClipboardNumber("1,234.56")).toBeCloseTo(1234.56, 6);
    expect(parseClipboardNumber("1.234,56")).toBeCloseTo(1234.56, 6);
    expect(parseClipboardNumber("€2'345.70")).toBeCloseTo(2345.7, 6);
    expect(parseClipboardNumber("(1 234,5)")).toBeCloseTo(-1234.5, 6);
    expect(parseClipboardNumber("1,234")).toBeCloseTo(1234, 6);
  });

  it("returns null for invalid number inputs", () => {
    expect(parseClipboardNumber("abc")).toBeNull();
    expect(parseClipboardNumber("--")).toBeNull();
    expect(parseClipboardNumber("1..2")).toBeNull();
    expect(parseClipboardNumber(null)).toBeNull();
    expect(parseClipboardNumber(undefined)).toBeNull();
  });
});

describe("clipboard preview rows", () => {
  it("builds preview rows with valid and invalid reasons", () => {
    const matrix = parseTsvMatrix(
      [
        "Designation\tQuantite\tUnite\tPrix unitaire HT (EUR)\tType FO\tK FO\th MO\tK MO\tMajoration MO (%)",
        "Porte\t2\tu\t12,50\tBois\t1,1\t3\t1\t125",
        "\t1\tu\t10\tMetal\t1\t2\t1\t100",
        "Fenetre\tabc\tu\t10\tBois\t1\t2\t1\t100",
        "\t\t\t\t\t\t\t\t",
        "Mur\t1\tm2\t-5\tBeton\t1\t2\t1\t100",
      ].join("\n")
    );

    const mapping = suggestClipboardColumnMapping(matrix.headers);
    const result = buildClipboardPreviewRows(matrix, mapping);

    expect(result.totalRows).toBe(5);
    expect(result.validCount).toBe(1);
    expect(result.invalidCount).toBe(4);

    expect(result.rows[0]?.lineNumber).toBe(2);
    expect(result.rows[0]?.status).toBe("valid");
    expect(result.rows[0]?.values.h_mo_majoration).toBeCloseTo(1.25, 6);

    expect(result.rows[1]?.lineNumber).toBe(3);
    expect(result.rows[1]?.status).toBe("invalid");
    expect(result.rows[1]?.reasons).toContain("Designation manquante.");

    expect(result.rows[2]?.lineNumber).toBe(4);
    expect(result.rows[2]?.status).toBe("invalid");
    expect(result.rows[2]?.reasons).toContain("Nombre invalide pour Quantite.");

    expect(result.rows[3]?.lineNumber).toBe(5);
    expect(result.rows[3]?.status).toBe("invalid");
    expect(result.rows[3]?.reasons).toContain("Ligne vide.");

    expect(result.rows[4]?.lineNumber).toBe(6);
    expect(result.rows[4]?.status).toBe("invalid");
    expect(result.rows[4]?.reasons).toContain("Prix unitaire HT doit etre >= 0.");
  });

  it("flags rows when designation mapping is missing", () => {
    const matrix = parseTsvMatrix("Qte\tPU HT\n1\t12,50");
    const mapping: ClipboardColumnMapping = {
      Qte: "quantity",
      "PU HT": "unit_price_ht",
    };

    const result = buildClipboardPreviewRows(matrix, mapping);

    expect(result.totalRows).toBe(1);
    expect(result.rows[0]?.status).toBe("invalid");
    expect(result.rows[0]?.reasons).toContain("Colonne designation non mappee.");
  });
});

describe("clipboard tsv serialization", () => {
  it("serializes selected rows with default headers", () => {
    const tsv = serializeSelectedRowsToTsv([
      {
        designation: "Porte\tbois\nstandard",
        quantity: 2,
        unit: "u",
        unit_price_ht: 12.5,
        supply_type: "Bois",
        k_fo: 1.1,
        h_mo: 3,
        k_mo: 1,
        h_mo_majoration: 1.25,
      },
      {
        designation: "Fenetre",
        quantity: null,
        unit_price_ht: 8,
      },
    ]);

    const lines = tsv.split("\n");
    expect(lines[0]).toBe(
      "designation\tquantity\tunit\tunit_price_ht\tsupply_type\tk_fo\th_mo\tk_mo\th_mo_majoration"
    );
    expect(lines[1]).toBe("Porte bois standard\t2\tu\t12.5\tBois\t1.1\t3\t1\t1.25");
    expect(lines[2]).toBe("Fenetre\t\t\t8\t\t\t\t\t");
  });

  it("supports custom field order without header row", () => {
    const tsv = serializeSelectedRowsToTsv(
      [{ designation: "Porte", quantity: 2 }],
      {
        includeHeader: false,
        fields: ["designation", "quantity"],
      }
    );

    expect(tsv).toBe("Porte\t2");
  });
});

describe("parseClipboardNumber - T16 : l'ambiguite se tranche par le domaine", () => {
  // « 2,500 » ne veut pas dire la meme chose selon ce qu'on colle. La langue ne
  // suffit pas a trancher : en francais le separateur de milliers est l'espace,
  // et les espaces sont retires en amont. Ce qui discrimine, c'est le nombre de
  // decimales que le domaine autorise.
  it("money : trois chiffres = milliers (un montant a deux decimales)", () => {
    expect(parseClipboardNumber("2,500", "money")).toBeCloseTo(2500, 6);
    expect(parseClipboardNumber("2.500", "money")).toBeCloseTo(2500, 6);
    expect(parseClipboardNumber("1,234", "money")).toBeCloseTo(1234, 6);
  });

  it("quantity : trois chiffres = decimales (tonnes, m³, coefficients)", () => {
    // Le defaut corrige : un metre colle en tonnes voyait 2,500 t devenir
    // 2500 t. Un facteur mille, en silence, sur un collage en masse.
    expect(parseClipboardNumber("2,500", "quantity")).toBeCloseTo(2.5, 6);
    expect(parseClipboardNumber("1,750", "quantity")).toBeCloseTo(1.75, 6);
    expect(parseClipboardNumber("2.500", "quantity")).toBeCloseTo(2.5, 6);
    // Un coefficient k_fo a 1,050 devenait 1050.
    expect(parseClipboardNumber("1,050", "quantity")).toBeCloseTo(1.05, 6);
  });

  it("le double separateur reste non ambigu dans les deux domaines", () => {
    for (const domain of ["money", "quantity"] as const) {
      expect(parseClipboardNumber("1.234,56", domain)).toBeCloseTo(1234.56, 6);
      expect(parseClipboardNumber("1,234.56", domain)).toBeCloseTo(1234.56, 6);
    }
  });

  it("les separateurs repetes restent des milliers dans les deux domaines", () => {
    for (const domain of ["money", "quantity"] as const) {
      expect(parseClipboardNumber("1.234.567", domain)).toBeCloseTo(1234567, 6);
    }
  });

  it("moins de trois decimales : aucune ambiguite, meme lecture partout", () => {
    for (const domain of ["money", "quantity"] as const) {
      expect(parseClipboardNumber("12,5", domain)).toBeCloseTo(12.5, 6);
      expect(parseClipboardNumber("0,500", domain)).toBeCloseTo(0.5, 6);
    }
  });
});
