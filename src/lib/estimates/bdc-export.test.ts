import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getEstimateVersionDetails: vi.fn(),
  getEstimateSupplierComparisons: vi.fn(),
}));

import {
  ESTIMATE_EXPORT_PROGRESS_COMPLETE,
  ESTIMATE_EXPORT_XLSX_CONTENT_TYPE,
  type WorkbookWriterFactory,
} from "@/lib/estimates/export-stream";
import { streamEstimateVersionBdcV11Xlsx } from "@/lib/estimates/bdc-export";
import { getEstimateSupplierComparisons, getEstimateVersionDetails } from "@/lib/estimates/server";

const VERSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type CellState = {
  numFmt?: string;
  note?: string;
  font?: {
    bold?: boolean;
    color?: { argb: string };
  };
  fill?: {
    type: "pattern";
    pattern: "solid";
    fgColor: { argb: string };
  };
  alignment?: {
    horizontal?: "left" | "center" | "right";
  };
};

type CapturedWorksheet = {
  name: string;
  columns?: Array<{ header: string; key: string; width?: number }>;
  rows: unknown[][];
  committed: boolean;
  cellStates: Map<string, CellState>;
};

function createWorkbookHarness() {
  const worksheets: CapturedWorksheet[] = [];

  const workbookWriterFactory: WorkbookWriterFactory = async (stream) => {
    const writable = stream as {
      write: (chunk: Uint8Array | Buffer | string) => void;
      end: () => void;
    };

    return {
      addWorksheet(name) {
        const sheet: CapturedWorksheet = {
          name,
          rows: [],
          committed: false,
          cellStates: new Map(),
        };
        worksheets.push(sheet);

        const getCellState = (rowIndex: number, columnIndex: number): CellState => {
          const key = `${rowIndex}:${columnIndex}`;
          const existing = sheet.cellStates.get(key);
          if (existing) return existing;
          const created: CellState = {};
          sheet.cellStates.set(key, created);
          return created;
        };

        const createRowHandle = (rowIndex: number, values: unknown[]) => ({
          font: undefined as { bold?: boolean } | undefined,
          getCell(cellIndex: number) {
            const safeCellIndex = Math.max(1, cellIndex);
            return getCellState(rowIndex, safeCellIndex);
          },
          eachCell(callback: (cell: CellState) => void) {
            const cellCount = Math.max(values.length, sheet.columns?.length ?? 0);
            for (let cellIndex = 1; cellIndex <= cellCount; cellIndex += 1) {
              callback(getCellState(rowIndex, cellIndex));
            }
          },
          commit() {},
        });

        return {
          get columns() {
            return sheet.columns;
          },
          set columns(value) {
            sheet.columns = value;
            if (!value || sheet.rows.length > 0) return;
            sheet.rows.push(value.map((column) => column.header));
          },
          addRow(value) {
            const values = Array.isArray(value) ? value : [];
            const rowIndex = sheet.rows.length + 1;
            const handle = createRowHandle(rowIndex, values);

            return {
              get font() {
                return handle.font;
              },
              set font(val) {
                handle.font = val;
              },
              getCell: handle.getCell,
              eachCell: handle.eachCell,
              commit() {
                sheet.rows.push(values);
              },
            };
          },
          getRow(index) {
            const rowIndex = Math.max(1, index);
            const values = (sheet.rows[rowIndex - 1] as unknown[]) ?? [];
            return createRowHandle(rowIndex, values);
          },
          commit() {
            sheet.committed = true;
          },
        };
      },
      async commit() {
        writable.write(Buffer.from("xlsx-binary"));
        writable.end();
      },
    };
  };

  return {
    workbookWriterFactory,
    worksheets,
  };
}

describe("streamEstimateVersionBdcV11Xlsx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates BDC v1.1 workbook with spec columns/colors/comments and supplier urls", async () => {
    vi.mocked(getEstimateVersionDetails).mockResolvedValue({
      version: {
        id: VERSION_ID,
        version_number: 4,
        margin_multiplier: 1.3,
        tax_rate_bp: 2000,
        estimate_projects: {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          name: "Projet Alpha",
          reference: "ALPHA/2026",
        },
      },
      items: [
        {
          id: "sec-1",
          item_type: "section",
          parent_id: null,
          position: 1,
          title: "Lot principal",
          description: null,
          quantity: null,
          unit_price_ht_cents: null,
          tax_rate_bp: null,
          k_fo: null,
          h_mo: null,
          h_mo_majoration: null,
          k_mo: null,
          h_mo_atelier: null,
          k_mo_atelier: null,
          labor_role_atelier_id: null,
          h_mo_chantier: null,
          k_mo_chantier: null,
          labor_role_chantier_id: null,
          pu_ht_cents: null,
          labor_role_id: null,
          category_id: null,
          supply_type_id: null,
          line_total_ht_cents: null,
          line_tax_cents: null,
          line_total_ttc_cents: null,
        },
        {
          id: "line-1",
          item_type: "line",
          parent_id: "sec-1",
          position: 2,
          title: "Coffrage",
          description: "m2",
          quantity: 2,
          unit_price_ht_cents: 10000,
          tax_rate_bp: 2000,
          k_fo: 1.2,
          h_mo: 3,
          h_mo_majoration: 1.25,
          k_mo: 1.1,
          h_mo_atelier: null,
          k_mo_atelier: null,
          labor_role_atelier_id: null,
          h_mo_chantier: null,
          k_mo_chantier: null,
          labor_role_chantier_id: null,
          pu_ht_cents: null,
          labor_role_id: "role-1",
          category_id: "cat-1",
          supply_type_id: "supply-1",
          line_total_ht_cents: null,
          line_tax_cents: null,
          line_total_ttc_cents: null,
        },
      ],
      supply_types: [
        {
          id: "supply-1",
          name: "Materiaux",
        },
      ],
      labor_roles: [
        {
          id: "role-1",
          name: "Poseur",
          hourly_rate_cents: 5000,
        },
      ],
      categories: [
        {
          id: "cat-1",
          name: "Maconnerie",
          position: 1,
        },
      ],
    } as never);
    vi.mocked(getEstimateSupplierComparisons).mockResolvedValue({
      comparisons: [
        {
          item_id: "line-1",
          selected_supplier_price_id: "sp-2",
          alternatives: [
            {
              supplier_price_id: "sp-1",
              supplier_name: "Fournisseur A",
              adjusted_unit_price_cents: 9800,
              supplier_reference: "A-9800",
              catalogue_url: "https://supplier-a.test/item",
            },
            {
              supplier_price_id: "sp-2",
              supplier_name: "Fournisseur B",
              adjusted_unit_price_cents: 9900,
              supplier_reference: "B-9900",
              catalogue_url: "https://supplier-b.test/item",
            },
            {
              supplier_price_id: "sp-3",
              supplier_name: "Fournisseur C",
              adjusted_unit_price_cents: 10100,
              supplier_reference: "C-10100",
              catalogue_url: "https://supplier-c.test/item",
            },
          ],
        },
      ],
    } as never);

    const { workbookWriterFactory, worksheets } = createWorkbookHarness();
    const exported = await streamEstimateVersionBdcV11Xlsx(VERSION_ID, {
      workbookWriterFactory,
    });

    expect(exported.filename).toBe("devis-ALPHA_2026-v4-bdc-v1_1.xlsx");
    expect(exported.contentType).toBe(ESTIMATE_EXPORT_XLSX_CONTENT_TYPE);
    expect(exported.progress).toBe(ESTIMATE_EXPORT_PROGRESS_COMPLETE);
    expect(vi.mocked(getEstimateSupplierComparisons)).toHaveBeenCalledWith(VERSION_ID, [
      "line-1",
    ]);

    const bytes = Buffer.from(await new Response(exported.stream).arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(0);

    const sheet = worksheets.find((entry) => entry.name === "BDC_V1_1");
    expect(sheet?.committed).toBe(true);
    expect(sheet?.rows[0]).toHaveLength(31);

    const lineRow = sheet?.rows[2] as unknown[];
    expect(lineRow[0]).toBe("line");
    expect(lineRow[1]).toBe(2);
    expect(lineRow[2]).toBe("line-1");
    expect(lineRow[3]).toBe("  Coffrage");
    expect(lineRow[5]).toBe(2);
    expect(lineRow[6]).toBe("Materiaux");
    expect(lineRow[13]).toBe("Poseur");
    expect(lineRow[14]).toBe("Maconnerie");
    expect(lineRow[18]).toBe("Fournisseur A");
    expect(lineRow[21]).toBe("https://supplier-a.test/item");
    expect(lineRow[22]).toBe("Fournisseur B");
    expect(lineRow[25]).toBe("https://supplier-b.test/item");
    expect(lineRow[26]).toBe("Fournisseur C");
    expect(lineRow[29]).toBe("https://supplier-c.test/item");
    expect(lineRow[30]).toBe("line-1");

    expect(typeof lineRow[7]).toBe("number");
    expect(typeof lineRow[8]).toBe("number");
    expect(typeof lineRow[15]).toBe("number");
    expect(typeof lineRow[16]).toBe("number");
    expect(typeof lineRow[17]).toBe("number");
    expect(Math.round((lineRow[17] as number) * 100)).toBe(
      Math.round((lineRow[15] as number) * 100) + Math.round((lineRow[16] as number) * 100)
    );

    const identificationColor = sheet?.cellStates.get("1:1")?.fill?.fgColor.argb;
    const foColor = sheet?.cellStates.get("1:7")?.fill?.fgColor.argb;
    const moColor = sheet?.cellStates.get("1:11")?.fill?.fgColor.argb;
    const totalColor = sheet?.cellStates.get("1:16")?.fill?.fgColor.argb;
    const supplierColor = sheet?.cellStates.get("1:19")?.fill?.fgColor.argb;

    expect(identificationColor).toBeDefined();
    expect(foColor).toBeDefined();
    expect(moColor).toBeDefined();
    expect(totalColor).toBeDefined();
    expect(supplierColor).toBeDefined();
    expect(identificationColor).not.toBe(foColor);
    expect(foColor).not.toBe(moColor);
    expect(moColor).not.toBe(totalColor);
    expect(totalColor).not.toBe(supplierColor);

    expect(sheet?.cellStates.get("1:16")?.note).toContain("Formule indicative");
    expect(sheet?.cellStates.get("1:17")?.note).toContain("Formule indicative");
    expect(sheet?.cellStates.get("1:18")?.note).toContain("Formule indicative");
    expect(sheet?.cellStates.get("3:16")?.note).toContain("=F3*H3*J3");
    expect(sheet?.cellStates.get("3:17")?.note).toContain("=K3*L3*M3");
    expect(sheet?.cellStates.get("3:18")?.note).toContain("=P3+Q3");

    expect(sheet?.cellStates.get("3:8")?.numFmt).toBe("#,##0.00 \"€\"");
    expect(sheet?.cellStates.get("3:16")?.numFmt).toBe("#,##0.00 \"€\"");
    expect(sheet?.cellStates.get("3:20")?.numFmt).toBe("#,##0.00 \"€\"");
  });

  it("chunks supplier comparison requests when estimate has more than 200 lines", async () => {
    const lineItems = Array.from({ length: 201 }, (_, index) => ({
      id: `line-${index + 1}`,
      item_type: "line" as const,
      parent_id: null,
      position: index + 1,
      title: `Ligne ${index + 1}`,
      description: "u",
      quantity: 1,
      unit_price_ht_cents: 1000,
      tax_rate_bp: 2000,
      k_fo: 1,
      h_mo: 0,
      h_mo_majoration: 1,
      k_mo: 1,
      h_mo_atelier: null,
      k_mo_atelier: null,
      labor_role_atelier_id: null,
      h_mo_chantier: null,
      k_mo_chantier: null,
      labor_role_chantier_id: null,
      pu_ht_cents: null,
      labor_role_id: null,
      category_id: null,
      supply_type_id: null,
      line_total_ht_cents: null,
      line_tax_cents: null,
      line_total_ttc_cents: null,
    }));

    vi.mocked(getEstimateVersionDetails).mockResolvedValue({
      version: {
        id: VERSION_ID,
        version_number: 5,
        margin_multiplier: 1,
        tax_rate_bp: 2000,
        estimate_projects: {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          name: "Projet Beta",
          reference: "BETA/2026",
        },
      },
      items: lineItems,
      supply_types: [],
      labor_roles: [],
      categories: [],
    } as never);
    vi.mocked(getEstimateSupplierComparisons).mockImplementation(
      async (_versionId: string, itemIds: string[] | null) =>
        ({
          stale_price_days: 90,
          coverage_summary: {
            total_items: (itemIds ?? []).length,
            covered_items: 0,
            ambiguous_items: 0,
            no_price_items: (itemIds ?? []).length,
            stale_items: 0,
          },
          comparisons: (itemIds ?? []).map((itemId) => ({
            item_id: itemId,
            selected_supplier_price_id: null,
            best_supplier_price_id: null,
            coverage_status: "no_price",
            risk_flags: [],
            selected_alternative: null,
            alternatives: [],
          })),
          bulk_preselection: {
            summary: {
              total_items: (itemIds ?? []).length,
              proposed_items: 0,
              exception_items: (itemIds ?? []).length,
              already_selected_items: 0,
              divergence_items: 0,
              stale_items: 0,
              ambiguous_items: 0,
              no_price_items: (itemIds ?? []).length,
            },
            proposals: [],
            exceptions: [],
          },
        }) as never
    );

    const { workbookWriterFactory } = createWorkbookHarness();
    const exported = await streamEstimateVersionBdcV11Xlsx(VERSION_ID, {
      workbookWriterFactory,
    });

    const bytes = Buffer.from(await new Response(exported.stream).arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(0);

    const calls = vi.mocked(getEstimateSupplierComparisons).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]?.[1]).toHaveLength(200);
    expect(calls[1]?.[1]).toHaveLength(1);
  });

  it("computes FO total from line-level rounding instead of per-unit pre-rounding", async () => {
    vi.mocked(getEstimateVersionDetails).mockResolvedValue({
      version: {
        id: VERSION_ID,
        version_number: 6,
        margin_multiplier: 1,
        tax_rate_bp: 2000,
        estimate_projects: {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          name: "Projet Gamma",
          reference: "GAMMA/2026",
        },
      },
      items: [
        {
          id: "line-fo-rounding",
          item_type: "line",
          parent_id: null,
          position: 1,
          title: "Rounding line",
          description: "u",
          quantity: 3,
          unit_price_ht_cents: 101,
          tax_rate_bp: 2000,
          k_fo: 0.3333,
          h_mo: 0.0002,
          h_mo_majoration: 1,
          k_mo: 1,
          h_mo_atelier: null,
          k_mo_atelier: null,
          labor_role_atelier_id: null,
          h_mo_chantier: null,
          k_mo_chantier: null,
          labor_role_chantier_id: null,
          pu_ht_cents: null,
          labor_role_id: "role-1",
          category_id: null,
          supply_type_id: null,
          line_total_ht_cents: null,
          line_tax_cents: null,
          line_total_ttc_cents: null,
        },
      ],
      supply_types: [],
      labor_roles: [
        {
          id: "role-1",
          name: "Poseur",
          hourly_rate_cents: 5000,
        },
      ],
      categories: [],
    } as never);
    vi.mocked(getEstimateSupplierComparisons).mockResolvedValue({
      comparisons: [],
    } as never);

    const { workbookWriterFactory, worksheets } = createWorkbookHarness();
    const exported = await streamEstimateVersionBdcV11Xlsx(VERSION_ID, {
      workbookWriterFactory,
    });

    const bytes = Buffer.from(await new Response(exported.stream).arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(0);

    const sheet = worksheets.find((entry) => entry.name === "BDC_V1_1");
    const lineRow = sheet?.rows[1] as unknown[];

    expect(Math.round((lineRow[15] as number) * 100)).toBe(101);
    expect(Math.round((lineRow[16] as number) * 100)).toBe(1);
    expect(Math.round((lineRow[17] as number) * 100)).toBe(102);
  });

  it("skips supplier comparison call when there are no line items", async () => {
    vi.mocked(getEstimateVersionDetails).mockResolvedValue({
      version: {
        id: VERSION_ID,
        version_number: 1,
        margin_multiplier: 1,
        tax_rate_bp: 2000,
        estimate_projects: {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          name: "Projet Alpha",
          reference: null,
        },
      },
      items: [
        {
          id: "sec-1",
          item_type: "section",
          parent_id: null,
          position: 1,
          title: "Section",
          description: null,
          quantity: null,
          unit_price_ht_cents: null,
          tax_rate_bp: null,
          k_fo: null,
          h_mo: null,
          h_mo_majoration: null,
          k_mo: null,
          h_mo_atelier: null,
          k_mo_atelier: null,
          labor_role_atelier_id: null,
          h_mo_chantier: null,
          k_mo_chantier: null,
          labor_role_chantier_id: null,
          pu_ht_cents: null,
          labor_role_id: null,
          category_id: null,
          supply_type_id: null,
          line_total_ht_cents: null,
          line_tax_cents: null,
          line_total_ttc_cents: null,
        },
      ],
      supply_types: [],
      labor_roles: [],
      categories: [],
    } as never);

    const { workbookWriterFactory } = createWorkbookHarness();
    const exported = await streamEstimateVersionBdcV11Xlsx(VERSION_ID, {
      workbookWriterFactory,
    });

    expect(exported.filename).toBe("devis-Projet_Alpha-v1-bdc-v1_1.xlsx");
    expect(vi.mocked(getEstimateSupplierComparisons)).not.toHaveBeenCalled();
  });
});
