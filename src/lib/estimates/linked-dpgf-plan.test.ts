import { describe, expect, it } from "vitest";

import { IMPORT_PREVIEW_REQUIRED_MESSAGE } from "@/lib/affaires/import-flow";
import { prepareLinkedDpgfLines } from "@/lib/estimates/linked-dpgf-plan";

function mapped(id: string, rowIndex: number, fields: Record<string, unknown>) {
  return { id, payload: { row_index: rowIndex, mapped_row: { designation: id, ...fields } } };
}

const context = { marginMultiplier: 1.3, defaultTaxRateBp: 2000 };

describe("linked DPGF direct-import preparation", () => {
  it.each([
    [mapped("hours-per-unit", 2, { quantity: 2, unit_price_ht: 10, labor_hours_per_unit: 1.5 })],
    [
      { id: "params", payload: { row_index: 1, mapped_row: { param_coeff_fo: 1.3, param_coeff_mo: 1.3, param_hourly_rate: 40 } } },
      mapped("line-hours", 2, { quantity: 2, unit_price_ht: 10, labor_hours: 3 }),
    ],
  ])("requires the existing preview for workbook parameters or per-unit labour", (...rows) => {
    expect(() => prepareLinkedDpgfLines({ ...context, mappedRows: rows })).toThrow(IMPORT_PREVIEW_REQUIRED_MESSAGE);
  });
});
