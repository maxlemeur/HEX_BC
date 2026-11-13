import { describe, expect, it } from "vitest";

import type { ExportColumn } from "@/lib/export";

import { buildItemsExportRows, ITEM_EXPORT_COLUMNS, ORDER_EXPORT_COLUMNS } from "./orders-export";
import type { OrderItemRow } from "./orders-model";

/** The cells of one exported row, by header, as the workbook and the CSV write them. */
function cells<T>(columns: ExportColumn<T>[], row: T): Record<string, unknown> {
  return Object.fromEntries(columns.map((column) => {
    const value = (row as Record<string, unknown>)[column.key as string];
    return [column.header, column.formatter ? column.formatter(value, row) : value];
  }));
}

const REQUEST_ORDER = {
  id: "c1000000-0000-4000-8000-000000000001",
  reference: "C-2026-0101",
  created_at: "2026-11-12T08:00:00.000Z",
  status: "draft" as const,
  expected_delivery_date: null,
  total_ht_cents: 17_000,
  suppliers: { id: "c1000000-0000-4000-8000-000000000011", name: "Négoce Fictif" },
  delivery_sites: null,
  project_id: "c1000000-0000-4000-8000-000000000021",
  project: { id: "c1000000-0000-4000-8000-000000000021", name: "Affaire fictive" },
  delivery_mode: "office" as const,
};
const MANUAL_ORDER = {
  ...REQUEST_ORDER,
  id: "c1000000-0000-4000-8000-000000000002",
  reference: "C-2026-0102",
  total_ht_cents: 1_250,
  delivery_sites: { id: "c1000000-0000-4000-8000-000000000031", name: "Chantier fictif" },
  project_id: null,
  project: null,
  delivery_mode: null,
};
const SCREWS: OrderItemRow = {
  id: "c1000000-0000-4000-8000-000000000101",
  designation: "Vis inox M6x20",
  reference: "VIS-M6",
  quantity: 5000,
  unit: "u",
  price_unit: "u",
  unit_price_ht_cents: 340,
  line_total_ht_cents: 17_000,
  line_tax_cents: 3_400,
  line_total_ttc_cents: 20_400,
  price_per: 100,
  line_kind: "article",
};
const ELBOW: OrderItemRow = {
  ...SCREWS,
  id: "c1000000-0000-4000-8000-000000000102",
  designation: "Coude fictif",
  quantity: 5,
  unit_price_ht_cents: 250,
  line_total_ht_cents: 1_250,
  line_tax_cents: 250,
  line_total_ttc_cents: 1_500,
  price_per: undefined,
};

describe("order export", () => {
  it("gives a line priced per lot its lot, so quantity x price / lot is the line total (review of TI-691 3a)", () => {
    const [row] = buildItemsExportRows([REQUEST_ORDER], { [REQUEST_ORDER.id]: [SCREWS] });
    const line = cells(ITEM_EXPORT_COLUMNS, row);
    expect(line).toMatchObject({ Quantité: 5000, "P.U. HT (EUR)": 3.4, "Prix pour (quantité)": 100, "Total ligne HT (EUR)": 170 });
    expect((5000 * 3.4) / (line["Prix pour (quantité)"] as number)).toBe(line["Total ligne HT (EUR)"]);
  });

  it("names the affaire of an order made from a request, on the orders and on their lines", () => {
    const [row] = buildItemsExportRows([REQUEST_ORDER], { [REQUEST_ORDER.id]: [SCREWS] });
    expect(cells(ITEM_EXPORT_COLUMNS, row)).toMatchObject({ Affaire: "Affaire fictive", Chantier: "-" });
    expect(cells(ORDER_EXPORT_COLUMNS, REQUEST_ORDER)).toMatchObject({ Affaire: "Affaire fictive" });
  });

  it("keeps a manual order as before: price for 1 unit, its site, no affaire", () => {
    const [row] = buildItemsExportRows([MANUAL_ORDER], { [MANUAL_ORDER.id]: [ELBOW] });
    expect(cells(ITEM_EXPORT_COLUMNS, row)).toMatchObject({
      Chantier: "Chantier fictif",
      Affaire: "-",
      "P.U. HT (EUR)": 2.5,
      "Prix pour (quantité)": 1,
      "Total ligne HT (EUR)": 12.5,
    });
    expect(cells(ORDER_EXPORT_COLUMNS, MANUAL_ORDER)).toMatchObject({ Affaire: "-", Chantier: "Chantier fictif" });
  });
});
