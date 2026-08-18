import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getEstimateVersionDetails: vi.fn(),
  listEstimateItems: vi.fn(),
}));

import {
  computeEstimateLineValues,
  type EstimateItemRecord,
} from "@/lib/estimate-calculations";
import {
  ESTIMATE_EXPORT_PROGRESS_COMPLETE,
  ESTIMATE_EXPORT_XLSX_CONTENT_TYPE,
  streamEstimateVersionXlsx,
  type WorkbookWriterFactory,
} from "@/lib/estimates/export-stream";
import { getEstimateVersionDetails, listEstimateItems } from "@/lib/estimates/server";

const VERSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function toCents(value: unknown) {
  return Math.round(Number(value) * 100);
}

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
    expect(vi.mocked(getEstimateVersionDetails)).toHaveBeenCalledWith(VERSION_ID, {
      includeExportCalculationContext: true,
    });
    expect(vi.mocked(listEstimateItems)).toHaveBeenCalledWith(VERSION_ID);

    const bytes = Buffer.from(await new Response(exported.stream).arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(0);

    const summarySheet = worksheets.find((sheet) => sheet.name === "Resume");
    const linesSheet = worksheets.find((sheet) => sheet.name === "Devis");

    expect(summarySheet?.committed).toBe(true);
    expect(linesSheet?.committed).toBe(true);
    expect(linesSheet?.rows.length).toBe(3);

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
    const totalHtRow = summaryRows.find(
      (row) => Array.isArray(row) && row[0] === "Total HT"
    );
    const totalTaxRow = summaryRows.find(
      (row) => Array.isArray(row) && row[0] === "Total TVA"
    );
    expect(totalTtcRow?.[1]).toBe(expectedLineValues.ttcLineCents / 100);

    const lineRows = linesSheet?.rows as unknown[][];
    const computedLine = lineRows.find(
      (row) => Array.isArray(row) && row[1] === "Ligne 1"
    );
    expect(computedLine?.[5]).toBe(expectedLineValues.saleLineCents / 100);
    expect(computedLine?.[6]).toBe(expectedLineValues.taxLineCents / 100);
    expect(computedLine?.[7]).toBe(expectedLineValues.ttcLineCents / 100);
    expect(toCents(computedLine?.[5]) + toCents(computedLine?.[6])).toBe(
      toCents(computedLine?.[7])
    );
    expect(toCents(totalHtRow?.[1]) + toCents(totalTaxRow?.[1])).toBe(
      toCents(totalTtcRow?.[1])
    );
  });

  it("uses the tenant labor flag consistently for line and summary totals", async () => {
    vi.mocked(getEstimateVersionDetails).mockResolvedValue({
      version: {
        id: VERSION_ID,
        version_number: 1,
        status: "draft",
        title: "Flag MO",
        margin_multiplier: 1,
        margin_mode: "fixed",
        global_coefficient: 1,
        tax_rate_bp: 0,
        discount_bp: 0,
        discount_mode: "simple",
        discount_steps: [],
        rounding_mode: "none",
        rounding_step_cents: 0,
        calc_engine_version: 1,
        estimate_projects: {
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          name: "Projet Flag",
          reference: "FLAG/2026",
        },
      },
      labor_roles: [
        { id: "role-legacy", hourly_rate_cents: 1000 },
        { id: "role-atelier", hourly_rate_cents: 2000 },
        { id: "role-chantier", hourly_rate_cents: 3000 },
      ],
    } as never);
    vi.mocked(listEstimateItems).mockResolvedValue({
      items: [
        {
          id: "line-flag",
          item_type: "line",
          parent_id: null,
          position: 1,
          title: "Ligne flag",
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
    } as never);

    const exportWithFlag = async (isLaborSplitEnabled: boolean) => {
      const harness = createWorkbookHarness();
      const exported = await streamEstimateVersionXlsx(VERSION_ID, {
        workbookWriterFactory: harness.workbookWriterFactory,
        isLaborSplitEnabled,
      });
      await new Response(exported.stream).arrayBuffer();

      const lineRows = harness.worksheets.find(
        (sheet) => sheet.name === "Devis"
      )?.rows as unknown[][];
      const summaryRows = harness.worksheets.find(
        (sheet) => sheet.name === "Resume"
      )?.rows as unknown[][];
      const lineTotal = lineRows.find((row) => row[1] === "Ligne flag")?.[5];
      const summaryTotal = summaryRows.find((row) => row[0] === "Total HT")?.[1];

      expect(lineTotal).toBe(summaryTotal);
      return lineTotal;
    };

    await expect(exportWithFlag(false)).resolves.toBe(10);
    await expect(exportWithFlag(true)).resolves.toBe(130);
  });

  it("replays a fresh v2 review snapshot while the version is still draft", async () => {
    vi.mocked(getEstimateVersionDetails).mockResolvedValue({
      version: {
        id: VERSION_ID,
        version_number: 5,
        status: "draft",
        title: "Snapshot v2",
        margin_multiplier: 9,
        margin_mode: "tiered",
        global_coefficient: 3,
        tax_rate_bp: 2_000,
        discount_bp: 9_999,
        discount_mode: "simple",
        discount_steps: [],
        rounding_mode: "nearest",
        rounding_step_cents: 100,
        calc_engine_version: 2,
        content_revision: 12,
        calc_snapshot_content_revision: 12,
        total_ht_cents: 19_000,
        total_tax_cents: 3_800,
        total_ttc_cents: 22_800,
        estimate_projects: {
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          name: "Projet Snapshot",
          reference: "SNAP/2026",
        },
      },
      labor_roles: [],
      margin_tiers: [],
      is_labor_split_enabled: null,
    } as never);
    vi.mocked(listEstimateItems).mockResolvedValue({
      items: [
        {
          id: "line-snapshot",
          item_type: "line",
          parent_id: null,
          position: 1,
          title: "Ligne snapshot",
          description: "u",
          quantity: 2,
          unit_price_ht_cents: 1,
          tax_rate_bp: 1,
          k_fo: 99,
          h_mo: 99,
          h_mo_majoration: 99,
          k_mo: 99,
          labor_role_id: "role-live-disparu",
          h_mo_atelier: 99,
          k_mo_atelier: 99,
          labor_role_atelier_id: "role-live-disparu",
          h_mo_chantier: 99,
          k_mo_chantier: 99,
          labor_role_chantier_id: "role-live-disparu",
          pu_ht_cents: 7_777,
          snapshot_pu_ht_cents: 9_500,
          snapshot_fo_ht_cents: 12_000,
          snapshot_mo_ht_cents: 7_000,
          snapshot_mo_atelier_ht_cents: 3_000,
          snapshot_mo_chantier_ht_cents: 4_000,
          category_id: null,
          supply_type_id: null,
          line_total_ht_cents: 19_000,
          line_tax_cents: 3_800,
          line_total_ttc_cents: 22_800,
        },
      ],
    } as never);

    const exportRows = async (isLaborSplitEnabled: boolean) => {
      const harness = createWorkbookHarness();
      const exported = await streamEstimateVersionXlsx(VERSION_ID, {
        workbookWriterFactory: harness.workbookWriterFactory,
        isLaborSplitEnabled,
      });
      await new Response(exported.stream).arrayBuffer();
      const rows = harness.worksheets.find((sheet) => sheet.name === "Devis")
        ?.rows as unknown[][];
      return rows.find((row) => row[1] === "Ligne snapshot");
    };

    const splitOff = await exportRows(false);
    const splitOn = await exportRows(true);
    expect(splitOff).toEqual(splitOn);
    expect(splitOff?.slice(4, 8)).toEqual([95, 190, 38, 228]);
  });

  it("reconciles coefficient and discount on standard v1 exports without switching engines", async () => {
    vi.mocked(getEstimateVersionDetails).mockResolvedValue({
      version: {
        id: VERSION_ID,
        version_number: 2,
        status: "draft",
        title: "Réconciliation v1",
        margin_multiplier: 1,
        margin_mode: "fixed",
        global_coefficient: 1.2,
        tax_rate_bp: 0,
        discount_bp: 0,
        discount_mode: "simple",
        discount_steps: [1000],
        rounding_mode: "none",
        rounding_step_cents: 0,
        calc_engine_version: 1,
        estimate_projects: {
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          name: "Projet v1",
          reference: "V1/2026",
        },
      },
      labor_roles: [],
    } as never);
    vi.mocked(listEstimateItems).mockResolvedValue({
      items: [
        {
          id: "line-v1",
          item_type: "line",
          parent_id: null,
          position: 1,
          title: "Ligne v1",
          description: "u",
          quantity: 2,
          unit_price_ht_cents: 10000,
          tax_rate_bp: 0,
          k_fo: 1,
          h_mo: 0,
          h_mo_majoration: 1,
          k_mo: 1,
          labor_role_id: null,
          h_mo_atelier: null,
          k_mo_atelier: null,
          labor_role_atelier_id: null,
          h_mo_chantier: null,
          k_mo_chantier: null,
          labor_role_chantier_id: null,
          pu_ht_cents: null,
          category_id: null,
          supply_type_id: null,
          line_total_ht_cents: null,
          line_tax_cents: null,
          line_total_ttc_cents: null,
        },
      ],
    } as never);

    const harness = createWorkbookHarness();
    const exported = await streamEstimateVersionXlsx(VERSION_ID, {
      workbookWriterFactory: harness.workbookWriterFactory,
      isLaborSplitEnabled: false,
    });
    await new Response(exported.stream).arrayBuffer();

    const lineRows = harness.worksheets.find(
      (sheet) => sheet.name === "Devis"
    )?.rows as unknown[][];
    const summaryRows = harness.worksheets.find(
      (sheet) => sheet.name === "Resume"
    )?.rows as unknown[][];
    const line = lineRows.find((row) => row[1] === "Ligne v1");
    const totalHt = summaryRows.find((row) => row[0] === "Total HT")?.[1];
    const totalTax = summaryRows.find((row) => row[0] === "Total TVA")?.[1];
    const totalTtc = summaryRows.find((row) => row[0] === "Total TTC")?.[1];

    expect(line?.[4]).toBe(108);
    expect(line?.[5]).toBe(216);
    expect(totalHt).toBe(216);
    expect(toCents(line?.[5]) + toCents(line?.[6])).toBe(
      toCents(line?.[7])
    );
    expect(toCents(totalHt) + toCents(totalTax)).toBe(toCents(totalTtc));
  });

  it("allocates global TTC rounding so exported lines reconcile with the summary", async () => {
    vi.mocked(getEstimateVersionDetails).mockResolvedValue({
      version: {
        id: VERSION_ID,
        version_number: 3,
        status: "draft",
        title: "Arrondi global",
        margin_multiplier: 1,
        margin_mode: "fixed",
        global_coefficient: 1.03,
        tax_rate_bp: 2000,
        discount_bp: 500,
        discount_mode: "simple",
        discount_steps: [500],
        rounding_mode: "nearest",
        rounding_step_cents: 100,
        calc_engine_version: 1,
        estimate_projects: {
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          name: "Projet arrondi",
          reference: "ROUND/2026",
        },
      },
      labor_roles: [],
    } as never);
    vi.mocked(listEstimateItems).mockResolvedValue({
      items: [
        {
          id: "line-round-a",
          item_type: "line",
          parent_id: null,
          position: 1,
          title: "Ligne arrondi A",
          description: "u",
          quantity: 1,
          unit_price_ht_cents: 3333,
          tax_rate_bp: 2000,
          k_fo: 1,
          h_mo: 0,
          h_mo_majoration: 1,
          k_mo: 1,
          labor_role_id: null,
          pu_ht_cents: null,
          category_id: null,
          supply_type_id: null,
          line_total_ht_cents: null,
          line_tax_cents: null,
          line_total_ttc_cents: null,
        },
        {
          id: "line-round-b",
          item_type: "line",
          parent_id: null,
          position: 2,
          title: "Ligne arrondi B",
          description: "u",
          quantity: 1,
          unit_price_ht_cents: 3333,
          tax_rate_bp: 2000,
          k_fo: 1,
          h_mo: 0,
          h_mo_majoration: 1,
          k_mo: 1,
          labor_role_id: null,
          pu_ht_cents: null,
          category_id: null,
          supply_type_id: null,
          line_total_ht_cents: null,
          line_tax_cents: null,
          line_total_ttc_cents: null,
        },
      ],
    } as never);

    const harness = createWorkbookHarness();
    const exported = await streamEstimateVersionXlsx(VERSION_ID, {
      workbookWriterFactory: harness.workbookWriterFactory,
      isLaborSplitEnabled: false,
    });
    await new Response(exported.stream).arrayBuffer();

    const lineRows = harness.worksheets.find(
      (sheet) => sheet.name === "Devis"
    )?.rows as unknown[][];
    const summaryRows = harness.worksheets.find(
      (sheet) => sheet.name === "Resume"
    )?.rows as unknown[][];
    const exportedLines = lineRows.filter(
      (row) =>
        row[1] === "Ligne arrondi A" || row[1] === "Ligne arrondi B"
    );
    const totalHt = summaryRows.find((row) => row[0] === "Total HT")?.[1];
    const totalTax = summaryRows.find((row) => row[0] === "Total TVA")?.[1];
    const calculatedTtc = summaryRows.find(
      (row) => row[0] === "TTC calcule"
    )?.[1];
    const rounding = summaryRows.find(
      (row) => row[0] === "Arrondi commercial"
    )?.[1];
    const amountDue = summaryRows.find(
      (row) => row[0] === "Montant a payer"
    )?.[1];

    exportedLines.forEach((row) => {
      expect(toCents(row[5])).toBeGreaterThanOrEqual(0);
      expect(toCents(row[6])).toBeGreaterThanOrEqual(0);
      expect(toCents(row[7])).toBeGreaterThanOrEqual(0);
      expect(toCents(row[5]) + toCents(row[6])).toBe(toCents(row[7]));
    });
    expect(
      exportedLines.reduce((sum, row) => sum + toCents(row[5]), 0)
    ).toBe(toCents(totalHt));
    expect(
      exportedLines.reduce((sum, row) => sum + toCents(row[6]), 0)
    ).toBe(toCents(totalTax));
    expect(
      exportedLines.reduce((sum, row) => sum + toCents(row[7]), 0)
    ).toBe(toCents(calculatedTtc));
    expect(toCents(totalHt) + toCents(totalTax)).toBe(
      toCents(calculatedTtc)
    );
    expect(toCents(calculatedTtc) + toCents(rounding)).toBe(
      toCents(amountDue)
    );
    expect(amountDue).toBe(78);
  });

  it("keeps a one-line downward rounding export aligned with the engine TTC clamp", async () => {
    vi.mocked(getEstimateVersionDetails).mockResolvedValue({
      version: {
        id: VERSION_ID,
        version_number: 4,
        status: "draft",
        title: "Arrondi inférieur borné",
        margin_multiplier: 1,
        margin_mode: "fixed",
        global_coefficient: 1,
        tax_rate_bp: 100,
        discount_bp: 0,
        discount_mode: "simple",
        discount_steps: [],
        rounding_mode: "down",
        rounding_step_cents: 1000,
        calc_engine_version: 1,
        estimate_projects: {
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          name: "Projet clamp",
          reference: "CLAMP/2026",
        },
      },
      labor_roles: [],
    } as never);
    vi.mocked(listEstimateItems).mockResolvedValue({
      items: [
        {
          id: "line-round-down",
          item_type: "line",
          parent_id: null,
          position: 1,
          title: "Ligne arrondie vers le bas",
          description: "u",
          quantity: 1,
          unit_price_ht_cents: 3333,
          tax_rate_bp: 100,
          k_fo: 1,
          h_mo: 0,
          h_mo_majoration: 1,
          k_mo: 1,
          labor_role_id: null,
          pu_ht_cents: null,
          category_id: null,
          supply_type_id: null,
          line_total_ht_cents: null,
          line_tax_cents: null,
          line_total_ttc_cents: null,
        },
      ],
    } as never);

    const harness = createWorkbookHarness();
    const exported = await streamEstimateVersionXlsx(VERSION_ID, {
      workbookWriterFactory: harness.workbookWriterFactory,
      isLaborSplitEnabled: false,
    });
    await new Response(exported.stream).arrayBuffer();

    const lineRows = harness.worksheets.find(
      (sheet) => sheet.name === "Devis"
    )?.rows as unknown[][];
    const summaryRows = harness.worksheets.find(
      (sheet) => sheet.name === "Resume"
    )?.rows as unknown[][];
    const line = lineRows.find(
      (row) => row[1] === "Ligne arrondie vers le bas"
    );
    const totalHt = summaryRows.find((row) => row[0] === "Total HT")?.[1];
    const totalTax = summaryRows.find((row) => row[0] === "Total TVA")?.[1];
    const calculatedTtc = summaryRows.find(
      (row) => row[0] === "TTC calcule"
    )?.[1];
    const rounding = summaryRows.find(
      (row) => row[0] === "Arrondi commercial"
    )?.[1];
    const amountDue = summaryRows.find(
      (row) => row[0] === "Montant a payer"
    )?.[1];

    expect(toCents(line?.[5])).toBe(3333);
    expect(toCents(line?.[6])).toBeGreaterThanOrEqual(0);
    expect(toCents(line?.[5]) + toCents(line?.[6])).toBe(toCents(line?.[7]));
    expect(toCents(totalHt) + toCents(totalTax)).toBe(
      toCents(calculatedTtc)
    );
    expect(toCents(line?.[5])).toBe(toCents(totalHt));
    expect(toCents(line?.[6])).toBe(toCents(totalTax));
    expect(toCents(line?.[7])).toBe(toCents(calculatedTtc));
    // 33,66 € arrondi vers le bas au pas de 10 € donnerait 30 €, sous le HT.
    // Le moteur borne donc le TTC contractuel au HT : 33,33 €, TVA ajustée 0.
    expect(toCents(totalTax)).toBe(33);
    expect(toCents(calculatedTtc)).toBe(3366);
    expect(toCents(rounding)).toBe(-33);
    expect(toCents(amountDue)).toBe(3333);
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
