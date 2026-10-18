import { describe, expect, it } from "vitest";

import {
  buildClipboardPreviewRows,
  parseTsvMatrix,
  serializeSelectedRowsToTsv,
  suggestClipboardColumnMapping,
  type ClipboardPreviewValues,
} from "@/lib/estimates/clipboard";
import {
  interpretClipboardRowForV3,
  readClipboardSheetMajoration,
  readClipboardSheetRates,
  resolveV3PasteLaborRole,
  v3ClipboardUnit,
  V3_CLIPBOARD_FIELD_ORDER,
} from "@/lib/estimates/v3-paste";

// Sub-lot 2.8, rule 2 (D16): a paste into a v3 writes its v3 inputs (unit of the referential or line status,
// hours per unit) and its preview shows the interpreted values. Isolation exception: unit, status, hours and
// rate cases of the interpretation; IO04 (OPTIMA line O1, role at the sheet's rate) and V3E13 (generic sheet,
// undo) paste into a v3 grid.
const OPTIMA_HEADERS = [
  "N°", "Désignation", "Uté", "Qté", "Prix Unitaire", "Prix Total", "PR Fourniture unitaire",
  "PR Total fourniture", "Tps pose unitaire", "Tps pose unitaire majoré", "Tps pose total",
  "Coeff FO", "Coeff MO", "Majoration MO", "Taux horaire",
];
const O1 = ["1", "O1", "ml", "20", "174,59", "3 491,80", "54,66", "1 093,20", "1,991", "1,991", "39,82", "1,3", "1,3", "0", "40"];
// The workbooks keep their parameters on row 2 only (L2:O2, « Taux horaire » 40); a line carries none (review).
const PARAMETERS = ["", "", "", "0", "", "", "", "", "", "", "", "1,3", "1,3", "0", "40"];
const O1_SHEET = [...O1.slice(0, 11), "", "", "", ""];

function previewValues(headers: string[], rows: string[][]): ClipboardPreviewValues[] {
  const matrix = parseTsvMatrix([headers, ...rows].map((row) => row.join("\t")).join("\n"));
  return buildClipboardPreviewRows(matrix, suggestClipboardColumnMapping(matrix.headers)).rows.map((row) => row.values);
}

function values(overrides: Partial<ClipboardPreviewValues>): ClipboardPreviewValues {
  return {
    designation: "Ligne", quantity: 1, unit: "u", unit_price_ht: 10, supply_type: null, k_fo: null, h_mo: null,
    k_mo: null, h_mo_majoration: null, h_mo_per_unit: null, control_unit_price: null, hourly_rate: null,
    ...overrides,
  };
}

describe("2.8 paste into a v3: interpreted values (D16)", () => {
  it("reads the sheet's « Taux horaire » as the rate that chooses the labour role, never pasted", () => {
    expect(suggestClipboardColumnMapping(OPTIMA_HEADERS)["Taux horaire"]).toBe("hourly_rate");
    expect(suggestClipboardColumnMapping(["Désignation", "Quantité", "Taux horaire"])["Taux horaire"]).toBeUndefined();
    expect(previewValues(OPTIMA_HEADERS, [O1])[0]).toMatchObject({ h_mo_per_unit: 1.991, control_unit_price: 174.59, hourly_rate: 40 });
  });

  it("writes line O1 with its unit of the referential and its hours per unit, and shows them", () => {
    expect(interpretClipboardRowForV3(previewValues(OPTIMA_HEADERS, [O1])[0]!)).toEqual({
      ok: true,
      write: { unit_code: "ml", pricing_status: "priced", h_mo_per_unit: 1.991 },
      notes: ["Unité ml", "h/u 1,991", "Prix Unitaire 174,59 : contrôle"],
    });
  });

  it("writes a status mention as a non-priced line without a unit", () => {
    expect(interpretClipboardRowForV3(values({ unit: "HL" }))).toEqual({
      ok: true,
      write: { unit_code: null, pricing_status: "out_of_scope", h_mo_per_unit: null },
      notes: ["Statut Hors lot (0 €)"],
    });
  });

  it("leaves an empty unit to be chosen in the grid", () => {
    expect(interpretClipboardRowForV3(values({ unit: null }))).toEqual({
      ok: true,
      write: { unit_code: null, pricing_status: "priced", h_mo_per_unit: null },
      notes: ["Unité à choisir dans la grille"],
    });
  });

  it("refuses a unit unknown to the referential, never written as free text", () => {
    expect(interpretClipboardRowForV3(values({ unit: "bidule" }))).toEqual({
      ok: false,
      reasons: ["Unité inconnue du référentiel : « bidule »."],
      notes: [],
    });
  });

  it("refuses line hours: a v3 stores hours per unit", () => {
    const interpreted = interpretClipboardRowForV3(values({ h_mo: 12 }));
    expect(interpreted.ok).toBe(false);
    expect(interpreted.ok ? [] : interpreted.reasons).toEqual([
      "Heures de ligne : sur un devis au moteur de calcul 3, associez cette colonne à « Heures MO par unité (h/u) ».",
    ]);
  });

  it("keeps four decimals of hours per unit, and accepts zero line hours", () => {
    expect(interpretClipboardRowForV3(values({ h_mo_per_unit: 0.0003 }))).toMatchObject({
      ok: true, write: { h_mo_per_unit: 0.0003 }, notes: ["Unité u", "h/u 0,0003"],
    });
    expect(interpretClipboardRowForV3(values({ h_mo: 0 }))).toMatchObject({ ok: true, write: { h_mo_per_unit: null } });
  });

  it("shows the sheet's parameter row, never pasted, and reads its rate", () => {
    const [parameters, line] = previewValues(OPTIMA_HEADERS, [PARAMETERS, O1_SHEET]);
    expect(interpretClipboardRowForV3(parameters!)).toEqual({
      ok: false, reasons: [], notes: ["Paramètres du classeur : taux horaire 40,00 €/h, non collés"],
    });
    expect(readClipboardSheetRates([parameters!, line!])).toEqual([40]);
  });

  it("never refuses a line for a rate cell it does not paste", () => {
    const rows = previewValues(OPTIMA_HEADERS,
      [[...O1.slice(0, 14), "quarante"], [...O1.slice(0, 14), "40,1234"], [...O1.slice(0, 14), "40,00 €"]]);
    expect(rows.map((row) => row.hourly_rate)).toEqual([null, 40.1234, 40]);
    const matrix = parseTsvMatrix([OPTIMA_HEADERS, [...O1.slice(0, 14), "quarante"]].map((row) => row.join("\t")).join("\n"));
    expect(buildClipboardPreviewRows(matrix, suggestClipboardColumnMapping(matrix.headers)).rows[0]?.status).toBe("valid");
  });

  it("reads an Excel copy of the real header, whose cells « Prix⏎Unitaire » and « Prix⏎Total » are quoted", () => {
    const headers = OPTIMA_HEADERS.map((header) => header.startsWith("Prix ") ? `"${header.replace(" ", "\r\n")}"` : header);
    const matrix = parseTsvMatrix([headers.join("\t"), PARAMETERS.join("\t"), O1_SHEET.join("\t")].join("\r\n"));
    expect([matrix.headers.length, matrix.rows.length, matrix.headers[4]]).toEqual([15, 2, "Prix\nUnitaire"]);
    const mapping = suggestClipboardColumnMapping(matrix.headers);
    expect([mapping["Prix\nUnitaire"], mapping["Tps pose unitaire"], mapping["Taux horaire"]])
      .toEqual(["control_unit_price", "h_mo_per_unit", "hourly_rate"]);
  });

  it("keeps the line-by-line reading of a paste whose opening quote never closes", () => {
    const matrix = parseTsvMatrix("Désignation\tUnité\n\"Porte\tml\nFenêtre\tu");
    expect(matrix.rows).toHaveLength(2);
    expect(matrix.rows[1]).toEqual(["Fenêtre", "u"]);
  });

  it("applies the parameter row's majoration to the lines without their own, and shows it", () => {
    const withMajoration = [...PARAMETERS.slice(0, 13), "0,1", "40"];
    const [parameters, line] = previewValues(OPTIMA_HEADERS, [withMajoration, O1_SHEET]);
    expect(readClipboardSheetMajoration([parameters!, line!])).toBe(1.1);
    expect(interpretClipboardRowForV3(parameters!).notes).toEqual([
      "Paramètres du classeur : taux horaire 40,00 €/h, majoration MO ×1,1 des lignes sans majoration, non collés",
    ]);
    const [neutral] = previewValues(OPTIMA_HEADERS, [PARAMETERS]);
    expect(readClipboardSheetMajoration([neutral!])).toBe(1);
  });

  it("copies a non-priced v3 line with its status mention, read back as that status", () => {
    expect(v3ClipboardUnit({ unit_code: "ml", pricing_status: "priced" })).toBe("ml");
    expect(v3ClipboardUnit({ unit_code: null, pricing_status: "out_of_scope" })).toBe("Hors lot");
    expect(interpretClipboardRowForV3(values({ unit: v3ClipboardUnit({ unit_code: null, pricing_status: "for_memory" }) })))
      .toMatchObject({ ok: true, write: { pricing_status: "for_memory", unit_code: null } });
  });

  it("pastes back into a v3 the hours per unit its grid copy exports", () => {
    const tsv = serializeSelectedRowsToTsv(
      [{ designation: "Tube", quantity: 20, unit: "ml", unit_price_ht: 54.66, k_fo: 1, h_mo_per_unit: 1.991, k_mo: 1, h_mo_majoration: 1 }],
      { fields: V3_CLIPBOARD_FIELD_ORDER, includeHeader: true }
    );
    const matrix = parseTsvMatrix(tsv);
    const row = buildClipboardPreviewRows(matrix, suggestClipboardColumnMapping(matrix.headers)).rows[0]!;
    expect(row.status).toBe("valid");
    expect(interpretClipboardRowForV3(row.values)).toMatchObject({
      ok: true, write: { unit_code: "ml", h_mo_per_unit: 1.991 },
    });
  });
});

describe("2.8 paste into a v3: labour role (rule of the OPTIMA import, E17)", () => {
  const roles = [
    { id: "role-mason", name: "Maçon", hourlyRateCents: 0 },
    { id: "role-fitter", name: "Tuyauteur", hourlyRateCents: 4000 },
  ];

  it("takes the single active role at the sheet's rate, from a line or from the parameter row", () => {
    expect(resolveV3PasteLaborRole({ rows: previewValues(OPTIMA_HEADERS, [O1]), roles })).toEqual({
      status: "resolved", role: roles[1], origin: "workbook_rate",
    });
    const [parameters, line] = previewValues(OPTIMA_HEADERS, [PARAMETERS, O1_SHEET]);
    expect(resolveV3PasteLaborRole({ rows: [line!], roles, sheetRates: readClipboardSheetRates([parameters!, line!]) }))
      .toEqual({ status: "resolved", role: roles[1], origin: "workbook_rate" });
  });

  it("needs no role without hours, and asks a choice when the pasted rates differ or match no role", () => {
    expect(resolveV3PasteLaborRole({ rows: [values({})], roles }).status).toBe("not_needed");
    expect(resolveV3PasteLaborRole({
      rows: [values({ h_mo_per_unit: 1, hourly_rate: 40 }), values({ h_mo_per_unit: 1, hourly_rate: 45 })], roles,
    })).toEqual({ status: "choice_required", role: null, matchingRoleIds: [] });
    expect(resolveV3PasteLaborRole({ rows: [values({ h_mo_per_unit: 1, hourly_rate: 55 })], roles }).status)
      .toBe("choice_required");
  });

  it("leaves the hours unassigned without a rate, and applies an explicit choice or refusal", () => {
    expect(resolveV3PasteLaborRole({ rows: [values({ h_mo_per_unit: 1 })], roles }).status).toBe("unassigned");
    expect(resolveV3PasteLaborRole({ rows: [values({ h_mo_per_unit: 1, hourly_rate: 55 })], roles, requestedRoleId: "role-mason" }))
      .toEqual({ status: "resolved", role: roles[0], origin: "requested" });
    expect(resolveV3PasteLaborRole({ rows: [values({ h_mo_per_unit: 1 })], roles, requestedRoleId: null }).status).toBe("declined");
  });
});
