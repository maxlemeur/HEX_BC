import { describe, expect, it } from "vitest";

import { IMPORT_PREVIEW_REQUIRED_MESSAGE } from "@/lib/affaires/import-flow";
import { prepareLinkedDpgfImportItems, prepareLinkedDpgfLines } from "@/lib/estimates/linked-dpgf-plan";

function mapped(id: string, rowIndex: number, fields: Record<string, unknown>) {
  return { id, payload: { row_index: rowIndex, mapped_row: { designation: id, ...fields } } };
}

const context = { marginMultiplier: 1.3, defaultTaxRateBp: 2000 };

describe("linked DPGF direct-import preparation", () => {
  it("orders valid lines by source row and identity, retaining the total for skipped-line reporting", () => {
    const rows = [
      mapped("last", 12, { quantity: 2, unit_price_ht: "10,50" }),
      mapped("b", 2, { quantity: 1, unit_price_ht: 20 }),
      mapped("a", 2, { quantity: 1, unit_price_ht: 30 }),
      mapped("invalid", 3, { designation: "", quantity: 1, unit_price_ht: 5 }),
    ];
    const before = structuredClone(rows);
    const prepared = prepareLinkedDpgfLines({ ...context, mappedRows: rows });
    expect(prepared.totalRows).toBe(4);
    expect(prepared.validLines.map((line) => line.mappedRowId)).toEqual(["a", "b", "last"]);
    expect(prepared.validLines[2]).toMatchObject({
      quantity: 2, unitPriceHtCents: 1050, puHtCents: 1365,
      lineTotalHtCents: 2730, lineTaxCents: 546, lineTotalTtcCents: 3276,
    });
    expect(rows).toEqual(before);
  });

  it.each([
    { rows: [], message: "La source DPGF liée ne contient aucune ligne mappee exploitable." },
    { rows: [mapped("bad", 1, { designation: "", quantity: 1, unit_price_ht: 2 })], message: "Aucune ligne DPGF valide à importer depuis la source liée." },
  ])("refuses unusable mapped rows: $message", ({ rows, message }) => {
    expect(() => prepareLinkedDpgfLines({ ...context, mappedRows: rows })).toThrow(message);
  });

  it.each([
    [mapped("hours-per-unit", 2, { quantity: 2, unit_price_ht: 10, labor_hours_per_unit: 1.5 })],
    [
      { id: "params", payload: { row_index: 1, mapped_row: { param_coeff_fo: 1.3, param_coeff_mo: 1.3, param_hourly_rate: 40 } } },
      mapped("line-hours", 2, { quantity: 2, unit_price_ht: 10, labor_hours: 3 }),
    ],
  ])("requires the existing preview for workbook parameters or per-unit labour", (...rows) => {
    expect(() => prepareLinkedDpgfLines({ ...context, mappedRows: rows })).toThrow(IMPORT_PREVIEW_REQUIRED_MESSAGE);
  });

  it("keeps v3 units, pricing statuses and the target draft sale coefficients", () => {
    const prepared = prepareLinkedDpgfLines({
      ...context,
      v3: { saleCoefficientFo: 1.5, saleCoefficientMo: 1.2 },
      mappedRows: [
        mapped("pipe", 1, { quantity: 2, unit: "ml", unit_price_ht: "10,50" }),
        mapped("excluded", 2, { quantity: 1, unit: "HL", unit_price_ht: 0 }),
      ],
    });
    expect(prepared.validLines[0]).toMatchObject({
      unitCode: "ml", pricingStatus: "priced", unitPriceHtCents: 1050,
      puHtCents: 1575, lineTotalHtCents: 3150,
    });
    expect(prepared.validLines[1]).toMatchObject({
      unitCode: null, pricingStatus: "out_of_scope", puHtCents: 0, lineTotalHtCents: 0,
    });
  });

  it("builds stable copy identities and DPGF provenance without inventing a takeoff job", () => {
    const { validLines } = prepareLinkedDpgfLines({
      ...context,
      mappedRows: [mapped("pipe", 7, { quantity: 2, unit_price_ht: "10,50", labor_hours: 1 })],
    });
    const before = structuredClone(validLines);
    const result = prepareLinkedDpgfImportItems({
      tenantId: "tenant", versionId: "version", createdSectionId: "section",
      rootPosition: 9, resolvedSectionTitle: "Import DPGF - source.xlsx", filename: "source.xlsx",
      validLines, lineIds: ["imported-line"],
    });
    expect(result.sectionItemPayload).toMatchObject({
      id: "section", parent_id: null, item_type: "section", position: 9,
      quantity: null, unit_price_ht_cents: null, line_total_ht_cents: null,
      source_provider: "dpgf", source_job_id: null, source_file_name: "source.xlsx", source_page: null,
    });
    expect(result.lineItemsPayload).toEqual([expect.objectContaining({
      id: "imported-line", tenant_id: "tenant", version_id: "version", parent_id: "section",
      item_type: "line", position: 1, title: "pipe", quantity: 2, unit_price_ht_cents: 1050,
      h_mo: 1, labor_role_id: null, h_mo_atelier: null, h_mo_chantier: null,
      source_provider: "dpgf", source_job_id: null, source_file_name: "source.xlsx", source_page: 7,
      source_metadata: {}, line_total_ht_cents: 2730, line_tax_cents: 546, line_total_ttc_cents: 3276,
    })]);
    expect(validLines).toEqual(before);
  });
});
