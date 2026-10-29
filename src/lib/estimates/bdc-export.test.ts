import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getEstimateVersionDetails: vi.fn(),
  getEstimateSupplierComparisons: vi.fn(),
}));
vi.mock("@/lib/estimates/supplier-export-search", async (original) => ({
  ...await original<typeof import("@/lib/estimates/supplier-export-search")>(),
  loadSupplierExportSearch: vi.fn(async () => null),
}));

import { type WorkbookWriterFactory } from "@/lib/estimates/export-stream";
import { getSupplierComparisonsForExport, streamEstimateVersionBdcV11Xlsx } from "@/lib/estimates/bdc-export";
import { getEstimateSupplierComparisons, getEstimateVersionDetails } from "@/lib/estimates/server";
import { loadSupplierExportSearch } from "@/lib/estimates/supplier-export-search";

beforeEach(() => { vi.mocked(loadSupplierExportSearch).mockResolvedValue(null); });

it("preserves retained suppliers and positive candidates while eliminating impossible bulk lookups", async () => {
  const items = Array.from({ length: 401 }, (_, index) => index === 11
    ? { id: `item-${index}`, title: `Ligne ${index}` }
    : { id: `item-${index}`, title: `Ligne ${index}`, selected_supplier_price_id: index === 10 ? "retained-price" : null });
  vi.mocked(loadSupplierExportSearch).mockResolvedValue({ ascii: ["ligne 301"], unicode: [] });
  vi.mocked(getEstimateSupplierComparisons).mockImplementation(async (_version, ids) => ({
    comparisons: ids!.map(id => ({ item_id: id, selected_supplier_price_id: id === "item-11" ? "unknown-retained-price" : null, alternatives: [] })),
  }) as never);
  const result = await getSupplierComparisonsForExport("version", items.map(item => item.id), items);
  expect(result.map(item => item.item_id)).toEqual(items.map(item => item.id));
  expect(getEstimateSupplierComparisons).toHaveBeenCalledOnce();
  // "Ligne 3" is also a legitimate substring of "Ligne 301"; do not drop it.
  expect(getEstimateSupplierComparisons).toHaveBeenCalledWith("version", ["item-3", "item-10", "item-11", "item-30", "item-301"]);
  expect(result.find(item => item.item_id === "item-10")).toBeDefined();
  expect(result.find(item => item.item_id === "item-11")?.selected_supplier_price_id).toBe("unknown-retained-price");
});

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

  it("ignores residual split payload when the tenant flag is disabled", async () => {
    vi.mocked(getEstimateVersionDetails).mockResolvedValue({
      version: {
        id: VERSION_ID,
        version_number: 1,
        margin_multiplier: 1,
        tax_rate_bp: 0,
        estimate_projects: {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          name: "Projet Flag",
          reference: "FLAG/2026",
        },
      },
      items: [
        {
          id: "line-flag",
          item_type: "line",
          parent_id: null,
          position: 1,
          title: "Pose flag",
          description: "u",
          quantity: 1,
          unit_price_ht_cents: 0,
          tax_rate_bp: 0,
          k_fo: 1,
          h_mo: 1,
          h_mo_majoration: 1,
          k_mo: 1,
          labor_role_id: "role-legacy",
          h_mo_atelier: 2,
          k_mo_atelier: 1,
          labor_role_atelier_id: "role-atelier",
          h_mo_chantier: 3,
          k_mo_chantier: 1,
          labor_role_chantier_id: "role-chantier",
          pu_ht_cents: null,
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
          id: "role-legacy",
          name: "Legacy",
          hourly_rate_cents: 1000,
        },
        {
          id: "role-atelier",
          name: "Atelier",
          hourly_rate_cents: 2000,
        },
        {
          id: "role-chantier",
          name: "Chantier",
          hourly_rate_cents: 3000,
        },
      ],
      categories: [],
    } as never);
    vi.mocked(getEstimateSupplierComparisons).mockResolvedValue({
      comparisons: [],
    } as never);

    const exportWithFlag = async (isLaborSplitEnabled: boolean) => {
      const harness = createWorkbookHarness();
      const exported = await streamEstimateVersionBdcV11Xlsx(VERSION_ID, {
        workbookWriterFactory: harness.workbookWriterFactory,
        isLaborSplitEnabled,
      });
      await new Response(exported.stream).arrayBuffer();
      return harness.worksheets.find(
        (entry) => entry.name === "BDC_V1_1"
      )?.rows[1] as unknown[];
    };

    const legacyRow = await exportWithFlag(false);
    expect(legacyRow[10]).toBe(1);
    expect(legacyRow[12]).toBe(10);
    expect(legacyRow[13]).toBe("Legacy");
    expect(legacyRow[16]).toBe(10);

    const splitRow = await exportWithFlag(true);
    expect(splitRow[10]).toBe(5);
    expect(splitRow[12]).toBe(26);
    expect(splitRow[13]).toBe("Atelier: Atelier / Chantier: Chantier");
    expect(splitRow[16]).toBe(130);
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

  it("exports a fresh v2 review snapshot instead of live draft inputs", async () => {
    vi.mocked(getEstimateVersionDetails).mockResolvedValue({
      version: {
        id: VERSION_ID,
        version_number: 3,
        status: "draft",
        calc_engine_version: 2,
        content_revision: 9,
        calc_snapshot_content_revision: 9,
        margin_multiplier: 9,
        tax_rate_bp: 2_000,
        estimate_projects: {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          name: "Projet Revue",
          reference: "REVUE/2026",
        },
      },
      items: [
        {
          id: "line-review",
          item_type: "line",
          parent_id: null,
          position: 1,
          title: "Ligne figée",
          description: "u",
          quantity: 2,
          unit_price_ht_cents: 1,
          pu_ht_cents: 7_777,
          snapshot_pu_ht_cents: 9_500,
          snapshot_fo_ht_cents: 12_000,
          snapshot_mo_ht_cents: 7_000,
          snapshot_mo_atelier_ht_cents: 3_000,
          snapshot_mo_chantier_ht_cents: 4_000,
          line_total_ht_cents: 19_000,
          line_tax_cents: 3_800,
          line_total_ttc_cents: 22_800,
          labor_role_id: "role-live",
          h_mo: 99,
          k_mo: 99,
          h_mo_majoration: 99,
          category_id: null,
          supply_type_id: null,
        },
      ],
      supply_types: [],
      labor_roles: [{ id: "role-live", name: "Taux vivant", hourly_rate_cents: 999_999 }],
      categories: [],
    } as never);
    vi.mocked(getEstimateSupplierComparisons).mockResolvedValue({
      comparisons: [],
    } as never);

    const { workbookWriterFactory, worksheets } = createWorkbookHarness();
    const exported = await streamEstimateVersionBdcV11Xlsx(VERSION_ID, {
      workbookWriterFactory,
      isLaborSplitEnabled: false,
    });
    await new Response(exported.stream).arrayBuffer();

    const lineRow = worksheets.find((sheet) => sheet.name === "BDC_V1_1")
      ?.rows[1] as unknown[];
    expect(lineRow.slice(7, 9)).toEqual([60, 60]);
    expect(lineRow.slice(15, 18)).toEqual([120, 70, 190]);
    expect(lineRow[10]).toBeNull();
    expect(lineRow[13]).toBe("");
  });
});
