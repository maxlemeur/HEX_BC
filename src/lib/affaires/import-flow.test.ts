import { describe, expect, it } from "vitest";

import {
  buildImportFlowStats,
  IMPORT_PREVIEW_REQUIRED_MESSAGE,
  importRequiresPreview,
  normalizeMappedRowsForEstimateCreation,
  parseLocalizedNumber,
  resolveImportLaborRole,
} from "@/lib/affaires/import-flow";
import { attachImportRowStructure } from "@/lib/imports/payload";
import type { ImportStructureDecision } from "@/lib/imports/structure";

describe("import-flow helpers", () => {
  it("parses localized numbers in FR/EN formats", () => {
    expect(parseLocalizedNumber("1 234,56")).toBe(1234.56);
    expect(parseLocalizedNumber("1,234.56")).toBe(1234.56);
    expect(parseLocalizedNumber("99.5")).toBe(99.5);
    expect(parseLocalizedNumber("99,5")).toBe(99.5);
    expect(parseLocalizedNumber("")).toBeNull();
    expect(parseLocalizedNumber("abc")).toBeNull();
  });

  it("normalizes mapped rows into valid and invalid estimate lines", () => {
    const normalized = normalizeMappedRowsForEstimateCreation(
      [
        {
          id: "row-1",
          payload: {
            row_index: 7,
            mapped_row: {
              designation: "Cable cuivre",
              quantity: "2",
              unit_price_ht: "10,50",
              labor_hours: "1,5",
              // 2.3 (P-11): a majoration declares its unit; an undeclared "1,1" is refused below.
              h_mo_majoration_coefficient: "1,1",
            },
          },
        },
        {
          id: "row-2",
          payload: {
            row_index: 8,
            mapped_row: {
              quantity: "2",
              unit_price_ht: "5",
            },
          },
        },
        {
          id: "row-3",
          payload: {
            mapped_row: {
              designation: "Tube acier",
              quantity: "4",
              total_ht: "100.00",
              notes: "Ligne derivee depuis total HT",
            },
          },
        },
      ],
      {
        marginMultiplier: 1.2,
        defaultTaxRateBp: 2000,
      }
    );

    expect(normalized.totalRows).toBe(3);
    expect(normalized.validLines).toHaveLength(2);
    expect(normalized.invalidLines).toHaveLength(1);

    expect(normalized.invalidLines[0]).toMatchObject({
      mappedRowId: "row-2",
      rowIndex: 8,
      reason: "missing_title",
    });

    expect(normalized.validLines[0]).toMatchObject({
      mappedRowId: "row-1",
      rowIndex: 7,
      title: "Cable cuivre",
      quantity: 2,
      unitPriceHtCents: 1050,
      taxRateBp: 2000,
      hMo: 1.5,
      hMoMajoration: 1.1,
    });

    expect(normalized.validLines[1]).toMatchObject({
      mappedRowId: "row-3",
      title: "Tube acier",
      quantity: 4,
      unitPriceHtCents: 2500,
      description: null,
      notes: "Ligne derivee depuis total HT",
    });

    const stats = buildImportFlowStats(normalized, 2);
    expect(stats).toEqual({
      totalRows: 3,
      validRows: 2,
      invalidRows: 1,
      insertedRows: 2,
      insertedSections: 0,
      zeroPriceRows: 0,
      ignoredRows: 0,
      ignoredFooterRows: 0,
      skippedRows: 1,
    });
  });

  it("accepts missing or zero quantities when a supply price is available", () => {
    const normalized = normalizeMappedRowsForEstimateCreation(
      [
        {
          id: "row-missing-quantity",
          payload: {
            mapped_row: {
              designation: "Tube acier",
              unit_price_ht: "40,74",
            },
          },
        },
        {
          id: "row-zero-quantity",
          payload: {
            mapped_row: {
              designation: "Coude acier",
              quantity: "0",
              unit_price_ht: "24,38",
            },
          },
        },
      ],
      {
        marginMultiplier: 1.3,
        defaultTaxRateBp: 2000,
      },
    );

    expect(normalized.invalidLines).toHaveLength(0);
    expect(normalized.validLines).toEqual([
      expect.objectContaining({
        mappedRowId: "row-missing-quantity",
        quantity: 0,
        unitPriceHtCents: 4074,
        lineTotalHtCents: 0,
      }),
      expect.objectContaining({
        mappedRowId: "row-zero-quantity",
        quantity: 0,
        unitPriceHtCents: 2438,
        lineTotalHtCents: 0,
      }),
    ]);
  });

  it("still rejects negative quantities and totals that cannot be divided by zero", () => {
    const normalized = normalizeMappedRowsForEstimateCreation(
      [
        {
          id: "row-negative-quantity",
          payload: {
            mapped_row: {
              designation: "Tube cuivre",
              quantity: "-1",
              unit_price_ht: "15",
            },
          },
        },
        {
          id: "row-zero-with-total-only",
          payload: {
            mapped_row: {
              designation: "Robinet",
              quantity: "0",
              total_ht: "120",
            },
          },
        },
        {
          id: "row-malformed-quantity",
          payload: {
            mapped_row: {
              designation: "Vanne",
              quantity: "inconnue",
              unit_price_ht: "30",
            },
          },
        },
      ],
      {
        marginMultiplier: 1.3,
        defaultTaxRateBp: 2000,
      },
    );

    expect(normalized.validLines).toHaveLength(0);
    expect(normalized.invalidLines).toEqual([
      expect.objectContaining({
        mappedRowId: "row-negative-quantity",
        reason: "invalid_quantity",
      }),
      expect.objectContaining({
        mappedRowId: "row-zero-with-total-only",
        reason: "invalid_unit_price",
      }),
      expect.objectContaining({
        mappedRowId: "row-malformed-quantity",
        reason: "invalid_quantity",
      }),
    ]);
  });

  it("materializes reviewed sections, zero-price lines, units, notes, and footer exclusions", () => {
    const structure = {
      sheet_name: "plb Z3-5",
      bold_columns: ["Désignation"],
      merged_columns: [],
      outline_level: null,
      column_order: ["Désignation", "Qte", "U", "PR._FO", "h_MO", "commentaire"],
    };
    const titleRawRow = (title: string, sourceRowNumber: number) =>
      attachImportRowStructure(
        {
          Désignation: title,
          Qte: null,
          U: null,
          "PR._FO": null,
          h_MO: null,
          commentaire: null,
        },
        {
          ...structure,
          source_row_number: sourceRowNumber,
        },
      );
    const lineRawRow = (
      title: string,
      sourceRowNumber: number,
      values: Record<string, unknown>,
    ) =>
      attachImportRowStructure(
        { Désignation: title, ...values },
        {
          ...structure,
          source_row_number: sourceRowNumber,
          bold_columns: [],
        },
      );

    const normalized = normalizeMappedRowsForEstimateCreation(
      [
        {
          id: "section-level-1",
          payload: {
            row_index: 0,
            raw_row: titleRawRow("Eaux usées", 2),
            mapped_row: { designation: "Eaux usées" },
          },
        },
        {
          id: "first-line",
          payload: {
            row_index: 1,
            raw_row: lineRawRow("Tube acier", 3, {
              Qte: 200,
              U: "ml",
              "PR._FO": 40.74,
              h_MO: 1.2,
              commentaire: "Sous-sol",
            }),
            mapped_row: {
              designation: "Tube acier",
              quantity: 200,
              unit: "ml",
              unit_price_ht: 40.74,
              labor_hours: 1.2,
              notes: "Sous-sol",
            },
          },
        },
        {
          id: "section-level-2",
          payload: {
            row_index: 2,
            raw_row: titleRawRow("EUEV", 4),
            mapped_row: { designation: "EUEV" },
          },
        },
        {
          id: "zero-line",
          payload: {
            row_index: 3,
            raw_row: lineRawRow("Poste hors lot", 5, {
              Qte: "—",
              U: "ens",
              "PR._FO": "—",
            }),
            mapped_row: {
              designation: "Poste hors lot",
              quantity: "—",
              unit: "ens",
              unit_price_ht: "—",
            },
          },
        },
        {
          id: "total",
          payload: {
            row_index: 4,
            raw_row: lineRawRow("TOTAL HT", 6, {}),
            mapped_row: { designation: "TOTAL HT" },
          },
        },
        {
          id: "legal",
          payload: {
            row_index: 5,
            raw_row: lineRawRow("Conditions de validité", 7, {}),
            mapped_row: { designation: "Conditions de validité" },
          },
        },
      ],
      { marginMultiplier: 1, defaultTaxRateBp: 2000 },
      {
        detectStructure: true,
        structureDecisions: [
          { rowIndex: 2, kind: "section", level: 2 },
        ],
      },
    );

    expect(normalized.validItems.map((item) => item.itemType)).toEqual([
      "section",
      "line",
      "section",
      "line",
    ]);
    expect(normalized.validSections.map((section) => [section.title, section.level])).toEqual([
      ["Eaux usées", 1],
      ["EUEV", 2],
    ]);
    expect(normalized.validLines).toHaveLength(2);
    expect(normalized.validLines[0]).toMatchObject({
      title: "Tube acier",
      description: "ml",
      notes: "Sous-sol",
      quantity: 200,
      unitPriceHtCents: 4074,
      hMo: 1.2,
      sourceMetadata: {
        sheet_name: "plb Z3-5",
        source_row_number: 3,
        notes: "Sous-sol",
      },
    });
    expect(normalized.validLines[1]).toMatchObject({
      title: "Poste hors lot",
      quantity: 0,
      unitPriceHtCents: 0,
    });
    expect(normalized.zeroPriceRows).toBe(1);
    expect(normalized.invalidLines).toEqual([]);
    expect(normalized.ignoredRows).toEqual([
      expect.objectContaining({ mappedRowId: "total", reason: "footer" }),
      expect.objectContaining({ mappedRowId: "legal", reason: "footer" }),
    ]);
    expect(buildImportFlowStats(normalized, 2, 2)).toEqual({
      totalRows: 6,
      validRows: 4,
      invalidRows: 0,
      insertedRows: 2,
      insertedSections: 2,
      zeroPriceRows: 1,
      ignoredRows: 2,
      ignoredFooterRows: 2,
      skippedRows: 2,
    });
  });

  it("keeps the expected 14 sections, 79 operational lines, and 11 zero-price rows", () => {
    const sectionDefinitions: Array<[string, 1 | 2]> = [
      ["Colonne sèche", 1],
      ["Eaux pluviales (EP)", 1],
      ["Eaux usées", 1],
      ["EUEV", 2],
      ["Eaux vannes", 2],
      ["Ventilation primaire", 2],
      ["Alimentation EFS / EFNP", 1],
      ["Collecteur et distribution SS", 2],
      ["Panoplie EFS - DN15", 2],
      ["Panoplie EFS - DN20", 2],
      ["Panoplie EFS - DN25", 2],
      ["Distribution blocs sanitaires", 2],
      ["Equipements", 2],
      ["Frais annexes", 1],
    ];
    const rows: Array<{ id: string; payload: unknown }> = [];
    const decisions: ImportStructureDecision[] = [];
    let rowIndex = 0;
    let operationalLineIndex = 0;

    for (const [sectionTitle, level] of sectionDefinitions) {
      const sectionRawRow = attachImportRowStructure(
        {
          Désignation: sectionTitle,
          Qte: null,
          U: null,
          "PR._FO": null,
          h_MO: null,
          commentaire: null,
        },
        {
          sheet_name: "plb Z3-5",
          source_row_number: rowIndex + 2,
          bold_columns: ["Désignation"],
          merged_columns: [],
          outline_level: null,
          column_order: [
            "Désignation",
            "Qte",
            "U",
            "PR._FO",
            "h_MO",
            "commentaire",
          ],
        },
      );
      rows.push({
        id: "section-" + rowIndex,
        payload: {
          row_index: rowIndex,
          raw_row: sectionRawRow,
          mapped_row: { designation: sectionTitle },
        },
      });
      decisions.push({
        rowIndex,
        kind: "section",
        level,
      });
      rowIndex += 1;

      const linesInSection =
        sectionTitle === "Frais annexes" ? 1 : 6;
      for (let localLineIndex = 0; localLineIndex < linesInSection; localLineIndex += 1) {
        const isFirstLine = operationalLineIndex === 0;
        const isZeroPriceLine =
          operationalLineIndex >= 1 && operationalLineIndex <= 11;
        const designation = isFirstLine
          ? "Tube acier DN100"
          : "Poste " + (operationalLineIndex + 1);
        const quantity = isFirstLine ? 200 : isZeroPriceLine ? "—" : 1;
        const unit = isFirstLine ? "ml" : "ens";
        const unitPrice = isFirstLine ? 40.74 : isZeroPriceLine ? "—" : 10;
        const laborHours = isFirstLine ? 1.2 : 0;
        const lineRawRow = attachImportRowStructure(
          {
            Désignation: designation,
            Qte: quantity,
            U: unit,
            "PR._FO": unitPrice,
            h_MO: laborHours,
            commentaire: null,
          },
          {
            sheet_name: "plb Z3-5",
            source_row_number: rowIndex + 2,
            bold_columns: [],
            merged_columns: [],
            outline_level: null,
            column_order: [
              "Désignation",
              "Qte",
              "U",
              "PR._FO",
              "h_MO",
              "commentaire",
            ],
          },
        );
        rows.push({
          id: "line-" + operationalLineIndex,
          payload: {
            row_index: rowIndex,
            raw_row: lineRawRow,
            mapped_row: {
              designation,
              quantity,
              unit,
              unit_price_ht: unitPrice,
              labor_hours: laborHours,
            },
          },
        });
        rowIndex += 1;
        operationalLineIndex += 1;
      }
    }

    for (const footerTitle of ["TOTAL HT", "Conditions générales de vente"]) {
      rows.push({
        id: "footer-" + rowIndex,
        payload: {
          row_index: rowIndex,
          raw_row: { Désignation: footerTitle },
          mapped_row: { designation: footerTitle },
        },
      });
      rowIndex += 1;
    }

    const normalized = normalizeMappedRowsForEstimateCreation(
      rows,
      { marginMultiplier: 1, defaultTaxRateBp: 2000 },
      { detectStructure: true, structureDecisions: decisions },
    );

    expect(normalized.totalRows).toBe(95);
    expect(normalized.validSections).toHaveLength(14);
    expect(normalized.validLines).toHaveLength(79);
    expect(normalized.zeroPriceRows).toBe(11);
    expect(normalized.ignoredRows).toHaveLength(2);
    expect(normalized.invalidLines).toEqual([]);
    expect(normalized.validLines[0]).toMatchObject({
      quantity: 200,
      description: "ml",
      unitPriceHtCents: 4074,
      hMo: 1.2,
    });
    expect(buildImportFlowStats(normalized, 79, 14)).toMatchObject({
      insertedRows: 79,
      insertedSections: 14,
      zeroPriceRows: 11,
      ignoredFooterRows: 2,
      skippedRows: 2,
    });
  });
});

// Sub-lot 2.3 (P-11, D11, C-11): an imported majoration declares its unit. Failure modes and
// isolation rationale: docs/testing/estimate-input-import-2.3.md. Written red before 2.3; the
// legacy `h_mo_majoration` case of "normalizes mapped rows…" above follows this contract then.
describe("2.3 imported majoration convention (P-11)", () => {
  function importMajoration(fields: Record<string, unknown>) {
    return normalizeMappedRowsForEstimateCreation([{ id: "majoration", payload: { mapped_row: {
      designation: "Témoin majoration", quantity: "1", unit_price_ht: "10", labor_hours: "1", ...fields,
    } } }], { marginMultiplier: 1, defaultTaxRateBp: 2000 });
  }

  it.each([
    [{ h_mo_majoration_percent: "112,5" }, 1.125],
    [{ h_mo_majoration_percent: "100" }, 1],
    [{ h_mo_majoration_coefficient: "1,15" }, 1.15],
    // OPTIMA profile: additive majoration, coefficient = 1 + N.
    [{ h_mo_majoration_additive: "0" }, 1],
    [{ h_mo_majoration_additive: "0,15" }, 1.15],
    [{ h_mo_majoration: "" }, 1],
  ])("%j is stored as ×%s", (fields, coefficient) => {
    const result = importMajoration(fields);
    expect(result.invalidLines).toEqual([]);
    expect(result.validLines).toHaveLength(1);
    expect(result.validLines[0].hMoMajoration).toBeCloseTo(coefficient, 10);
  });

  // Today the undeclared "100" multiplies the labour cost by 100 and "10" by 10 (C-11).
  it.each([
    { h_mo_majoration: "100" },
    { h_mo_majoration: "10" },
    { h_mo_majoration_percent: "1 100" },
    { h_mo_majoration_coefficient: "12" },
    { h_mo_majoration_additive: "10" },
  ])("%j is refused instead of guessed", (fields) => {
    const result = importMajoration(fields);
    expect(result.validLines).toEqual([]);
    expect(result.invalidLines).toHaveLength(1);
  });
});

// 2.3 review (P-16 « avec aperçu », E17): the linked-DPGF import into an existing version, the
// estimate wizard's "DPGF source" mode and the quick-create action normalize mapped rows without
// the import preview. Hours per unit (h/u × Q) and a workbook parameter row (rate, majoration)
// are only read once the preview showed them and the labour role; elsewhere such lines are
// refused instead of being priced at 0 €/h. E2E: import-optima-v2 (linked-DPGF step).
describe("2.3 import paths without the preview (P-16, E17)", () => {
  const parameterRow = { id: "params", payload: { row_index: 1, mapped_row: {
    param_coeff_fo: 1.3, param_coeff_mo: 1.3, h_mo_majoration_additive: 0, param_hourly_rate: 40,
  } } };
  function optimaLine(id: string, rowIndex: number, fields: Record<string, unknown>) {
    return { id, payload: { row_index: rowIndex, mapped_row: { designation: id, ...fields } } };
  }
  const o1 = optimaLine("O1", 2, { quantity: 20, unit_price_ht: 54.66, labor_hours_per_unit: 1.991 });
  const o6 = optimaLine("O6", 3, { quantity: 282, unit_price_ht: 91.86, labor_hours_per_unit: 0.998 });
  const context = { marginMultiplier: 1.3, defaultTaxRateBp: 2000 };
  const role40 = { id: "role-40", hourlyRateCents: 4000 };

  it("converts h/u × Q and prices the hours of a previewed import", () => {
    const previewed = normalizeMappedRowsForEstimateCreation([parameterRow, o1, o6], {
      ...context, laborRole: role40, entry: "preview",
    });
    expect(previewed.invalidLines).toEqual([]);
    expect(previewed.validLines.map((line) => [line.hMo, line.laborRoleId, line.lineTotalHtCents])).toEqual([
      [39.82, "role-40", 349180],
      [281.436, "role-40", 4831055],
    ]);
  });

  it("refuses every line of an OPTIMA workbook when the import skips the preview", () => {
    const direct = normalizeMappedRowsForEstimateCreation([parameterRow, o1, o6], context);
    expect(direct.validLines).toEqual([]);
    expect(direct.invalidLines.map((line) => [line.mappedRowId, line.reason])).toEqual([
      ["O1", "preview_required"],
      ["O6", "preview_required"],
    ]);
    expect(importRequiresPreview(direct)).toBe(true);
    expect(IMPORT_PREVIEW_REQUIRED_MESSAGE).toContain("aperçu");
  });

  it("refuses hours per unit without a parameter row when the import skips the preview", () => {
    const direct = normalizeMappedRowsForEstimateCreation([o1], { ...context, entry: "direct" });
    expect(direct.invalidLines.map((line) => line.reason)).toEqual(["preview_required"]);
    expect(importRequiresPreview(direct)).toBe(true);
  });

  it("refuses the lines of a workbook with a parameter row even when they carry line hours", () => {
    const line = optimaLine("L1", 2, { quantity: 2, unit_price_ht: 10, labor_hours: 3 });
    const direct = normalizeMappedRowsForEstimateCreation([parameterRow, line], context);
    expect(direct.invalidLines.map((entry) => entry.reason)).toEqual(["preview_required"]);
  });

  it("keeps plain line hours without workbook parameters (existing behaviour, no role)", () => {
    const line = optimaLine("L1", 1, { quantity: 2, unit_price_ht: 10, labor_hours: 3 });
    const direct = normalizeMappedRowsForEstimateCreation([line], context);
    expect(direct.invalidLines).toEqual([]);
    expect(direct.validLines.map((entry) => [entry.hMo, entry.laborRoleId ?? null])).toEqual([[3, null]]);
    expect(importRequiresPreview(direct)).toBe(false);
  });
});

// 2.3 review (E17): with a workbook rate that matches no active role, choosing "no role" in the
// preview sent null, which resolved to choice_required again; an owner without any active role
// could not import at all. An explicit null now declines the role (MO valued at 0 €/h, warned).
describe("2.3 labour role of imported hours (E17)", () => {
  const roles = [
    { id: "role-40", name: "Poseur", hourlyRateCents: 4000 },
    { id: "role-45", name: "Chef d'équipe", hourlyRateCents: 4500 },
  ];

  it.each([
    ["the single role at the workbook rate", { workbookHourlyRateCents: 4000, roles }, { status: "resolved", roleId: "role-40" }],
    ["a workbook rate without matching role", { workbookHourlyRateCents: 5000, roles }, { status: "choice_required", roleId: null }],
    ["an explicit null with an owner without roles", { workbookHourlyRateCents: 5000, roles: [], requestedRoleId: null }, { status: "declined", roleId: null }],
    ["an explicit null against the matching role", { workbookHourlyRateCents: 4000, roles, requestedRoleId: null }, { status: "declined", roleId: null }],
    ["an explicit null without workbook rate", { workbookHourlyRateCents: null, roles, requestedRoleId: null }, { status: "declined", roleId: null }],
    ["no workbook rate and no choice", { workbookHourlyRateCents: null, roles }, { status: "unassigned", roleId: null }],
    ["a chosen role", { workbookHourlyRateCents: 4000, roles, requestedRoleId: "role-45" }, { status: "resolved", roleId: "role-45" }],
    ["a role of another owner", { workbookHourlyRateCents: 4000, roles, requestedRoleId: "role-x" }, { status: "invalid_role", roleId: null }],
  ])("%s", (_label, input, expected) => {
    const resolution = resolveImportLaborRole({ hasLaborHours: true, ...input });
    expect({ status: resolution.status, roleId: resolution.role?.id ?? null }).toEqual(expected);
  });
});

// 2.3 review: Excel stores a cell shown « 115 % » as 1,15. Both upload parsers now store such a
// percent-formatted number as its percent text (« 115 % », see mappings/server.test.ts); the
// import reads it under a percent target and the OPTIMA additive majoration (+15 % → ×1,15), and
// refuses it under a coefficient, a quantity or a price instead of guessing.
describe("2.3 percent text from percent-formatted spreadsheet cells", () => {
  function importLine(fields: Record<string, unknown>) {
    return normalizeMappedRowsForEstimateCreation([{ id: "pct", payload: { mapped_row: {
      designation: "Témoin pourcentage", quantity: "2", unit_price_ht: "10", labor_hours: "3", ...fields,
    } } }], { marginMultiplier: 1, defaultTaxRateBp: 2000 });
  }

  it.each([
    [{ h_mo_majoration_percent: "115 %" }, 1.15],
    [{ h_mo_majoration_additive: "15 %" }, 1.15],
    [{ h_mo_majoration_additive: "0 %" }, 1],
  ])("%j is stored as ×%s", (fields, coefficient) => {
    const result = importLine(fields);
    expect(result.invalidLines).toEqual([]);
    expect(result.validLines[0]?.hMoMajoration).toBeCloseTo(coefficient, 10);
  });

  it.each([
    { h_mo_majoration_coefficient: "115 %" },
    { k_fo: "130 %" },
    { quantity: "20 %" },
    { unit_price_ht: "15 %" },
  ])("%j is refused", (fields) => {
    expect(importLine(fields).validLines).toEqual([]);
  });
});
