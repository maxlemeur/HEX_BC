import { describe, expect, it } from "vitest";

import { buildClipboardPreviewRows, CLIPBOARD_MAPPING_TARGETS, parseClipboardNumber, parseTsvMatrix, serializeSelectedRowsToTsv, suggestClipboardColumnMapping, type ClipboardColumnMapping } from "@/lib/estimates/clipboard";
import { NUMERIC_INPUT_ERROR } from "@/lib/numeric-input/parsers";

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
    const matrix = parseTsvMatrix("Designation\tUnité\n\"Porte\tBois\"\tml");

    expect(matrix.headers).toEqual(["Designation", "Unité"]);
    expect(matrix.rows).toEqual([["Porte\tBois", "ml"]]);
  });
});

describe("clipboard mapping suggestions", () => {

  it("prioritizes canonical bdc headers", () => {
    const headers = [
      "Designation",
      "Quantité",
      "Unité",
      "Prix unitaire HT (EUR)",
      "Type FO",
      "K FO",
      "h MO",
      "K MO",
      "Majoration MO (%)",
    ];

    const mapping = suggestClipboardColumnMapping(headers);

    expect(mapping["Designation"]).toBe("designation");
    expect(mapping["Quantité"]).toBe("quantity");
    expect(mapping["Unité"]).toBe("unit");
    expect(mapping["Prix unitaire HT (EUR)"]).toBe("unit_price_ht");
    expect(mapping["Type FO"]).toBe("supply_type");
    expect(mapping["K FO"]).toBe("k_fo");
    expect(mapping["h MO"]).toBe("h_mo");
    expect(mapping["K MO"]).toBe("k_mo");
    expect(mapping["Majoration MO (%)"]).toBe("h_mo_majoration");
  });

  it("maps bdc PR.FO header to unit_price_ht", () => {
    const headers = ["Designation", "Quantité", "PR.FO", "Type FO"];

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
    expect(parseClipboardNumber("1,234")).toBeNull();
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
        "Designation\tQuantité\tUnité\tPrix unitaire HT (EUR)\tType FO\tK FO\th MO\tK MO\tMajoration MO (%)",
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
    expect(result.rows[1]?.reasons).toContain("Désignation manquante.");

    expect(result.rows[2]?.lineNumber).toBe(4);
    expect(result.rows[2]?.status).toBe("invalid");
    // 2.3 (D11) : même message qu'en grille et dans les réglages, précédé du champ refusé.
    expect(result.rows[2]?.reasons).toContain(`Quantité : ${NUMERIC_INPUT_ERROR}`);

    expect(result.rows[3]?.lineNumber).toBe(5);
    expect(result.rows[3]?.status).toBe("invalid");
    expect(result.rows[3]?.reasons).toContain("Ligne vide.");

    expect(result.rows[4]?.lineNumber).toBe(6);
    expect(result.rows[4]?.status).toBe("invalid");
    expect(result.rows[4]?.reasons).toContain("Prix unitaire HT doit être >= 0.");
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
    expect(result.rows[0]?.reasons).toContain("Colonne désignation non mappée.");
  });
});

describe("parseClipboardNumber - T16 : l'ambiguite se tranche par le domaine", () => {
  // « 2,500 » ne veut pas dire la meme chose selon ce qu'on colle. La langue ne
  // suffit pas a trancher : en francais le separateur de milliers est l'espace,
  // et les espaces sont retires en amont. Ce qui discrimine, c'est le nombre de
  // decimales que le domaine autorise.
  it("money : trois chiffres = milliers (un montant a deux decimales)", () => {
    expect(parseClipboardNumber("2,500", "money")).toBe(2.5);
    expect(parseClipboardNumber("2.500", "money")).toBeNull();
    expect(parseClipboardNumber("1,234", "money")).toBeNull();
  });

  it("quantity : trois chiffres = decimales (tonnes, m³, coefficients)", () => {
    // Le defaut corrige : un metre colle en tonnes voyait 2,500 t devenir
    // 2500 t. Un facteur mille, en silence, sur un collage en masse.
    expect(parseClipboardNumber("2,500", "quantity")).toBeCloseTo(2.5, 6);
    expect(parseClipboardNumber("1,750", "quantity")).toBeCloseTo(1.75, 6);
    expect(parseClipboardNumber("2.500", "quantity")).toBeNull();
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

// Sub-lot 2.3 (P-11, D11, U-03): the paste preview owns its majoration convention and its
// header guesses. Failure modes and isolation rationale: docs/testing/estimate-input-import-2.3.md.
// Written red before 2.3.
describe("2.3 paste majoration convention (P-11)", () => {
  function pastedMajoration(header: string, cell: string) {
    const matrix = parseTsvMatrix([`Désignation\t${header}`, `Ligne témoin\t${cell}`].join("\n"));
    const mapping = suggestClipboardColumnMapping(matrix.headers);
    expect(mapping[header]).toBe("h_mo_majoration");
    return buildClipboardPreviewRows(matrix, mapping).rows[0]!;
  }

  it.each([
    ["Majoration MO (%)", "100", 1],
    ["Majoration MO (%)", "112,5", 1.125],
    ["Majoration MO (%)", "112,5 %", 1.125],
    ["Majoration MO (coef)", "1,15", 1.15],
    ["Majoration MO", "", null],
  ])("%s %j is read as ×%s", (header, cell, coefficient) => {
    const row = pastedMajoration(header, cell);
    expect({ status: row.status, coefficient: row.values.h_mo_majoration }).toEqual({ status: "valid", coefficient });
  });

  // Today "10" without a declared unit becomes ×10, "150" becomes ×1,5, a declared
  // coefficient of 12 becomes ×0,12 and 1 100 % becomes ×11, all without a warning.
  it.each([
    ["Majoration MO", "10"],
    ["Majoration MO", "150"],
    ["Majoration MO (coef)", "12"],
    ["Majoration MO (%)", "1 100"],
  ])("%s %j is refused instead of guessed", (header, cell) => {
    const row = pastedMajoration(header, cell);
    expect({ status: row.status, coefficient: row.values.h_mo_majoration }).toEqual({ status: "invalid", coefficient: null });
    expect(row.reasons.some((reason) => reason.includes("Majoration MO"))).toBe(true);
  });
});

// The editor writes its copy to the OS clipboard, which no browser journey can read back
// (tech-debt-numeric-entry.md limits); the serialized text must survive the paste grammar.
describe("2.3 grid copy re-reads through the paste preview (D11)", () => {
  it("keeps three-decimal quantities, hours, coefficients and the majoration", () => {
    const tsv = serializeSelectedRowsToTsv([{
      designation: "Ligne copiée", quantity: 1.234, unit: "ml", unit_price_ht: 12.5,
      supply_type: null, k_fo: 1.125, h_mo: 0.125, k_mo: 1, h_mo_majoration: 1.125,
    }]);
    const matrix = parseTsvMatrix(tsv);
    const row = buildClipboardPreviewRows(matrix, suggestClipboardColumnMapping(matrix.headers)).rows[0];
    expect(row).toMatchObject({
      status: "valid",
      reasons: [],
      values: { quantity: 1.234, unit_price_ht: 12.5, k_fo: 1.125, h_mo: 0.125, k_mo: 1, h_mo_majoration: 1.125 },
    });
  });
});

describe("2.3 pasted OPTIMA headers (U-03, F17)", () => {
  it("never puts a price or a time into the unit and reads Uté as the unit", () => {
    const headers = [
      "N°", "Désignation", "Uté", "Qté", "Prix Unitaire", "Prix Total", "PR Fourniture unitaire",
      "PR Total fourniture", "Tps pose unitaire", "Tps pose unitaire majoré", "Tps pose total",
      "Coeff FO", "Coeff MO", "Majoration MO", "Taux horaire",
    ];
    const mapping = suggestClipboardColumnMapping(headers);
    expect(Object.keys(mapping).filter((header) => mapping[header] === "unit")).toEqual(["Uté"]);
    expect(mapping["PR Fourniture unitaire"]).toBe("unit_price_ht");
    // Hours per unit are not v1/v2 line hours (C-01); 2.8 owns the OPTIMA paste conversion.
    expect(mapping["Tps pose unitaire"]).not.toBe("h_mo");
  });
});

// 2.3 review: a generic sale price ("Prix Unitaire" of an OPTIMA sheet without its "PR Fourniture
// unitaire", "PU", "Unit price") was proposed as the supply cost, so a v2 margin applied twice
// (D11). The developers' "Prix unitaire HT" (d484c5a1, the paste field label and the BDC format)
// and explicit purchase prices stay the supply cost.
describe("2.3 pasted sale prices never become the supply cost (D11)", () => {
  it.each([
    [["Désignation", "Uté", "Qté", "Prix Unitaire"], "Prix Unitaire"],
    [["Désignation", "Qté", "PU"], "PU"],
    [["Désignation", "Qté", "P.U."], "P.U."],
    [["Désignation", "Qté", "PU HT"], "PU HT"],
    [["Désignation", "Quantity", "Unit price"], "Unit price"],
    [["Désignation", "Qté", "Prix HT"], "Prix HT"],
  ])("%j leaves %j unmapped", (headers, saleHeader) => {
    const mapping = suggestClipboardColumnMapping(headers);
    expect(mapping[saleHeader]).toBeUndefined();
    expect(Object.values(mapping)).not.toContain("unit_price_ht");
  });

  it.each(["PR FO", "PR Fourniture unitaire", "Prix d'achat unitaire HT", "Prix d’achat", "Prix de revient unitaire", "Prix unitaire HT"])(
    "%j is the supply cost",
    (header) => {
      expect(suggestClipboardColumnMapping(["Désignation", "Qté", header])[header]).toBe("unit_price_ht");
    },
  );
});

// 2.3 review: quantity, h MO, K FO and K MO are numeric(12,3) in v1/v2. The paste kept 1,2345
// and PostgreSQL rounded it on write; the import already refused it (D11, E5).
describe("2.3 pasted precision follows the stored scale (D11)", () => {
  function pastedRow(header: string, cell: string) {
    const matrix = parseTsvMatrix([`Désignation\t${header}`, `Ligne témoin\t${cell}`].join("\n"));
    return buildClipboardPreviewRows(matrix, suggestClipboardColumnMapping(matrix.headers)).rows[0]!;
  }

  it.each([
    ["Quantité", "1,2345", "quantity"],
    ["h MO", "2,1234", "h_mo"],
    ["K FO", "1,2345", "k_fo"],
    ["K MO", "1,2345", "k_mo"],
  ] as const)("%s %j is refused instead of rounded on write", (header, cell, field) => {
    const row = pastedRow(header, cell);
    expect({ status: row.status, value: row.values[field], reasons: row.reasons }).toEqual({
      status: "invalid", value: null, reasons: [`${header} : ${NUMERIC_INPUT_ERROR}`],
    });
  });

  it.each([
    ["Quantité", "1,234", "quantity", 1.234],
    ["h MO", "2,125", "h_mo", 2.125],
    ["K FO", "1,235", "k_fo", 1.235],
    ["K MO", "0,875", "k_mo", 0.875],
  ] as const)("%s %j keeps its three decimals", (header, cell, field, value) => {
    expect(pastedRow(header, cell)).toMatchObject({ status: "valid", values: { [field]: value } });
  });
});

// 2.3 review (D11): a majoration column without a declared unit "doit être choisie
// explicitement". The mapping offers "Majoration MO (%)" and "Majoration MO (coefficient)"; the
// chosen unit wins over the header, and a cell's "%" still contradicts a chosen coefficient.
describe("2.3 pasted majoration unit chosen in the mapping (D11, P-11)", () => {
  function pasteWith(header: string, target: string, cell: string) {
    const matrix = parseTsvMatrix([`Désignation\t${header}`, `Ligne témoin\t${cell}`].join("\n"));
    return buildClipboardPreviewRows(matrix, { Désignation: "designation", [header]: target } as ClipboardColumnMapping).rows[0]!;
  }

  it("offers both declared units among the paste targets", () => {
    expect(CLIPBOARD_MAPPING_TARGETS).toEqual(expect.arrayContaining(["h_mo_majoration_percent", "h_mo_majoration_coefficient"]));
  });

  it.each([
    ["Majoration MO", "h_mo_majoration_percent", "150", 1.5],
    ["Majoration MO", "h_mo_majoration_percent", "112,5 %", 1.125],
    ["Majoration MO", "h_mo_majoration_coefficient", "1,5", 1.5],
    ["Majoration MO (coef)", "h_mo_majoration_percent", "150", 1.5],
    ["Majoration MO (%)", "h_mo_majoration_coefficient", "1,15", 1.15],
  ])("%s chosen as %s reads %j as ×%s", (header, target, cell, coefficient) => {
    const row = pasteWith(header, target, cell);
    expect({ status: row.status, coefficient: row.values.h_mo_majoration }).toEqual({ status: "valid", coefficient });
  });

  it.each([
    ["Majoration MO", "h_mo_majoration_coefficient", "150 %"],
    ["Majoration MO", "h_mo_majoration_coefficient", "12"],
    ["Majoration MO", "h_mo_majoration_percent", "1 001"],
  ])("%s chosen as %s refuses %j", (header, target, cell) => {
    const row = pasteWith(header, target, cell);
    expect({ status: row.status, coefficient: row.values.h_mo_majoration }).toEqual({ status: "invalid", coefficient: null });
    expect(row.reasons.some((reason) => reason.includes("Majoration MO"))).toBe(true);
  });

  it("refuses two majoration columns instead of keeping one silently", () => {
    const matrix = parseTsvMatrix(["Désignation\tMaj A\tMaj B", "Ligne témoin\t150\t1,2"].join("\n"));
    const row = buildClipboardPreviewRows(matrix, {
      Désignation: "designation", "Maj A": "h_mo_majoration_percent", "Maj B": "h_mo_majoration_coefficient",
    } as ClipboardColumnMapping).rows[0]!;
    expect(row.status).toBe("invalid");
    expect(row.reasons.some((reason) => reason.includes("Majoration MO"))).toBe(true);
  });

  it("names the explicit choice when the header declares no unit", () => {
    const matrix = parseTsvMatrix(["Désignation\tMajoration MO", "Ligne témoin\t150"].join("\n"));
    const row = buildClipboardPreviewRows(matrix, suggestClipboardColumnMapping(matrix.headers)).rows[0]!;
    expect(row.status).toBe("invalid");
    expect(row.reasons.join(" ")).toContain("choisissez « Majoration MO (%) » ou « Majoration MO (coefficient) »");
  });
});
