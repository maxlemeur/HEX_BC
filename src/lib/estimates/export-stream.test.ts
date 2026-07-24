import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getEstimateVersionDetails: vi.fn(),
  listEstimateItems: vi.fn(),
}));

import {
  computeEstimateLineValues,
  computeReadOnlyTotals,
  type EstimateItemRecord,
  type EstimateVersionForCalc,
} from "@/lib/estimate-calculations";
import {
  ESTIMATE_EXPORT_PROGRESS_COMPLETE,
  ESTIMATE_EXPORT_XLSX_CONTENT_TYPE,
  streamEstimateVersionXlsx,
  type WorkbookWriterFactory,
} from "@/lib/estimates/export-stream";
import { getEstimateVersionDetails, listEstimateItems } from "@/lib/estimates/server";

const VERSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type CapturedWorksheet = {
  name: string;
  columns?: Array<{ header: string; key: string; width?: number }>;
  rows: Array<Record<string, unknown> | unknown[]>;
  committed: boolean;
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
        };
        worksheets.push(sheet);

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
            return {
              commit() {
                sheet.rows.push(value);
              },
            };
          },
          getRow(index) {
            const rowValues = sheet.rows[index - 1];
            const cells =
              Array.isArray(rowValues) && rowValues.length > 0
                ? rowValues.map(() => ({}))
                : [];

            return {
              commit() {},
              getCell(cellIndex: number) {
                const resolvedIndex = Math.max(cellIndex - 1, 0);
                const existingCell = cells[resolvedIndex];
                if (existingCell) {
                  return existingCell;
                }

                const createdCell = {};
                cells[resolvedIndex] = createdCell;
                return createdCell;
              },
              eachCell(callback: (cell: Record<string, unknown>) => void) {
                cells.forEach((cell) => {
                  callback(cell);
                });
              },
            };
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

describe("streamEstimateVersionXlsx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a streamable XLSX export from details + items with computed totals", async () => {
    const details = {
      version: {
        id: VERSION_ID,
        version_number: 4,
        status: "sent",
        title: "Version export",
        margin_multiplier: 1.2,
        tax_rate_bp: 2000,
        discount_bp: 0,
        total_ht_cents: 13200,
        total_tax_cents: 2640,
        total_ttc_cents: 15840,
        estimate_projects: {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          name: "Projet Alpha",
          reference: "ALPHA/2026",
        },
      },
      labor_roles: [
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          hourly_rate_cents: 1200,
        },
      ],
    };

    const items = [
      {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        item_type: "section",
        parent_id: null,
        position: 1,
        title: "Chapitre",
        description: null,
        quantity: null,
        unit_price_ht_cents: null,
        tax_rate_bp: null,
        k_fo: null,
        h_mo: null,
        h_mo_majoration: 1,
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
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        item_type: "line",
        parent_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        position: 2,
        title: "Ligne 1",
        description: "Description ligne",
        quantity: 2,
        unit_price_ht_cents: 5000,
        tax_rate_bp: 2000,
        k_fo: 1,
        h_mo: 1,
        h_mo_majoration: 1,
        k_mo: 1,
        h_mo_atelier: null,
        k_mo_atelier: null,
        labor_role_atelier_id: null,
        h_mo_chantier: null,
        k_mo_chantier: null,
        labor_role_chantier_id: null,
        pu_ht_cents: 6600,
        labor_role_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        category_id: null,
        supply_type_id: null,
        line_total_ht_cents: 13200,
        line_tax_cents: 2640,
        line_total_ttc_cents: 15840,
      },
    ] as EstimateItemRecord[];

    vi.mocked(getEstimateVersionDetails).mockResolvedValue(details as never);
    vi.mocked(listEstimateItems).mockResolvedValue({
      items,
    } as never);

    const { workbookWriterFactory, worksheets } = createWorkbookHarness();

    const exported = await streamEstimateVersionXlsx(VERSION_ID, {
      workbookWriterFactory,
    });

    expect(exported.filename).toBe("devis-ALPHA_2026-v4.xlsx");
    expect(exported.contentType).toBe(ESTIMATE_EXPORT_XLSX_CONTENT_TYPE);
    expect(exported.progress).toBe(ESTIMATE_EXPORT_PROGRESS_COMPLETE);
    expect(vi.mocked(getEstimateVersionDetails)).toHaveBeenCalledWith(VERSION_ID);
    expect(vi.mocked(listEstimateItems)).toHaveBeenCalledWith(VERSION_ID);

    const bytes = Buffer.from(await new Response(exported.stream).arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(0);

    const summarySheet = worksheets.find((sheet) => sheet.name === "Resume");
    const linesSheet = worksheets.find((sheet) => sheet.name === "Devis");

    expect(summarySheet?.committed).toBe(true);
    expect(linesSheet?.committed).toBe(true);
    expect(linesSheet?.rows.length).toBe(3);

    const laborRateById = new Map([["cccccccc-cccc-4ccc-8ccc-cccccccccccc", 1200]]);
    const expectedTotals = computeReadOnlyTotals({
      isLaborSplitEnabled: false,
      items,
      version: details.version as EstimateVersionForCalc,
      discountCents: 0,
      laborRateById,
    });
    const expectedLineValues = computeEstimateLineValues(
      {
        ...items[1],
        labor_role_hourly_rate_cents: 1200,
      },
      {
        isLaborSplitEnabled: false,
        marginMultiplier: details.version.margin_multiplier,
        taxRateBp: 2000,
      }
    );

    const summaryRows = summarySheet?.rows as unknown[][];
    const totalTtcRow = summaryRows.find(
      (row) => Array.isArray(row) && row[0] === "Total TTC"
    );
    expect(totalTtcRow?.[1]).toBe(expectedTotals.roundedTtcCents / 100);

    const lineRows = linesSheet?.rows as unknown[][];
    const computedLine = lineRows.find(
      (row) => Array.isArray(row) && row[1] === "Ligne 1"
    );
    expect(computedLine?.[5]).toBe(expectedLineValues.saleLineCents / 100);
    expect(computedLine?.[6]).toBe(expectedLineValues.taxLineCents / 100);
    expect(computedLine?.[7]).toBe(expectedLineValues.ttcLineCents / 100);
  });

  it("falls back to project name when reference is empty in filename", async () => {
    vi.mocked(getEstimateVersionDetails).mockResolvedValue({
      version: {
        id: VERSION_ID,
        version_number: 2,
        status: "draft",
        title: null,
        margin_multiplier: 1,
        tax_rate_bp: 2000,
        discount_bp: 0,
        total_ht_cents: 0,
        total_tax_cents: 0,
        total_ttc_cents: 0,
        estimate_projects: {
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          name: "Projet Éxport #1",
          reference: "   ",
        },
      },
      labor_roles: [],
    } as never);
    vi.mocked(listEstimateItems).mockResolvedValue({
      items: [],
    } as never);

    const { workbookWriterFactory } = createWorkbookHarness();

    const exported = await streamEstimateVersionXlsx(VERSION_ID, {
      workbookWriterFactory,
    });

    expect(exported.filename).toBe("devis-Projet_Export_1-v2.xlsx");
  });
});
