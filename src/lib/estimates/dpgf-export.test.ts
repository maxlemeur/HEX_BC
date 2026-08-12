import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getEstimateVersionDetails: vi.fn(),
}));

import {
  ESTIMATE_EXPORT_PROGRESS_COMPLETE,
  ESTIMATE_EXPORT_XLSX_CONTENT_TYPE,
  type WorkbookWriterFactory,
} from "@/lib/estimates/export-stream";
import { streamEstimateVersionDpgfXlsx } from "@/lib/estimates/dpgf-export";
import { getEstimateVersionDetails } from "@/lib/estimates/server";

const VERSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type CapturedWorksheet = {
  name: string;
  columns?: Array<{ header: string; key: string; width?: number }>;
  rows: unknown[][];
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
              font: undefined as { bold?: boolean } | undefined,
              getCell() {
                return {};
              },
              eachCell(callback: (cell: Record<string, unknown>) => void) {
                (Array.isArray(value) ? value : []).forEach(() => {
                  callback({});
                });
              },
              commit() {
                sheet.rows.push(Array.isArray(value) ? value : []);
              },
            };
          },
          getRow(index) {
            const rowValues = sheet.rows[index - 1] ?? [];

            return {
              commit() {},
              getCell() {
                return {};
              },
              eachCell(callback: (cell: Record<string, unknown>) => void) {
                (Array.isArray(rowValues) ? rowValues : []).forEach(() => {
                  callback({});
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

describe("streamEstimateVersionDpgfXlsx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates DPGF workbook with parser-compatible columns and metadata", async () => {
    vi.mocked(getEstimateVersionDetails).mockResolvedValue({
      version: {
        id: VERSION_ID,
        version_number: 4,
        title: "Version Export",
        date_devis: "2026-02-22",
        estimate_projects: {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          name: "Projet Alpha",
          reference: "ALPHA/2026",
          client_name: "Client Delta",
        },
      },
      items: [
        {
          id: "sec-1",
          item_type: "section",
          parent_id: null,
          position: 1,
          title: "Gros oeuvre",
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
          title: "Beton arme",
          description: "m3",
          quantity: 3,
          unit_price_ht_cents: 12550,
          tax_rate_bp: 2000,
          k_fo: 1.1,
          h_mo: 4,
          h_mo_majoration: 1.15,
          k_mo: 1.2,
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

    const { workbookWriterFactory, worksheets } = createWorkbookHarness();

    const exported = await streamEstimateVersionDpgfXlsx(VERSION_ID, {
      workbookWriterFactory,
    });

    expect(exported.filename).toBe("devis-ALPHA_2026-v4-dpgf.xlsx");
    expect(exported.contentType).toBe(ESTIMATE_EXPORT_XLSX_CONTENT_TYPE);
    expect(exported.progress).toBe(ESTIMATE_EXPORT_PROGRESS_COMPLETE);

    const bytes = Buffer.from(await new Response(exported.stream).arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(0);

    const dataSheet = worksheets.find((sheet) => sheet.name === "Donnees");
    const metadataSheet = worksheets.find((sheet) => sheet.name === "Metadata");

    expect(dataSheet?.committed).toBe(true);
    expect(metadataSheet?.committed).toBe(true);
    expect(dataSheet?.rows[0]).toEqual([
      "Type",
      "AID",
      "Désignation",
      "Quantité",
      "Unite",
      "Prix unitaire HT EUR",
      "Type FO",
      "K FO",
      "h MO",
      "K MO",
      "Majoration MO",
      "Role MO",
      "Categorie",
      "h MO Atelier",
      "K MO Atelier",
      "Role MO Atelier",
      "h MO Chantier",
      "K MO Chantier",
      "Role MO Chantier",
    ]);

    const sectionRow = dataSheet?.rows[1] as unknown[];
    expect(sectionRow[0]).toBe("section");
    expect(sectionRow[1]).toBe("sec-1");
    expect(sectionRow[2]).toBe("Gros oeuvre");

    const lineRow = dataSheet?.rows[2] as unknown[];
    expect(lineRow[0]).toBe("line");
    expect(lineRow[1]).toBe("line-1");
    expect(lineRow[2]).toBe("  Beton arme");
    expect(lineRow[3]).toBe(3);
    expect(lineRow[4]).toBe("m3");
    expect(lineRow[5]).toBe(125.5);
    expect(lineRow[6]).toBe("Materiaux");
    expect(lineRow[7]).toBe(1.1);
    expect(lineRow[8]).toBe(4);
    expect(lineRow[9]).toBe(1.2);
    expect(lineRow[10]).toBe(1.15);
    expect(lineRow[11]).toBe("Poseur");
    expect(lineRow[12]).toBe("Maconnerie");
    expect(lineRow[13]).toBeNull();
    expect(lineRow[14]).toBeNull();
    expect(lineRow[15]).toBe("");
    expect(lineRow[16]).toBeNull();
    expect(lineRow[17]).toBeNull();
    expect(lineRow[18]).toBe("");

    const metadataRows = metadataSheet?.rows as unknown[][];
    expect(metadataRows).toContainEqual(["Référence", "ALPHA/2026"]);
    expect(metadataRows).toContainEqual(["Client", "Client Delta"]);
    expect(metadataRows).toContainEqual(["Date", "2026-02-22"]);
    expect(metadataRows).toContainEqual(["Version", "v4 - Version Export"]);
    expect(metadataRows).toContainEqual([
      "Auteur",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ]);
  });

  it("exports split MO atelier/chantier columns when labor split is enabled", async () => {
    vi.mocked(getEstimateVersionDetails).mockResolvedValue({
      version: {
        id: VERSION_ID,
        version_number: 2,
        title: "Split MO",
        date_devis: "2026-02-22",
        estimate_projects: {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          name: "Projet Split",
          reference: "SPLIT/2026",
          client_name: "Client Split",
        },
      },
      items: [
        {
          id: "line-split-1",
          item_type: "line",
          parent_id: null,
          position: 1,
          title: "Pose split",
          description: "u",
          quantity: 1,
          unit_price_ht_cents: 10000,
          tax_rate_bp: 2000,
          k_fo: 1,
          h_mo: null,
          h_mo_majoration: 1,
          k_mo: null,
          h_mo_atelier: 1.5,
          k_mo_atelier: 1.1,
          labor_role_atelier_id: "role-atelier",
          h_mo_chantier: 2,
          k_mo_chantier: 1.3,
          labor_role_chantier_id: "role-chantier",
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
      labor_roles: [
        {
          id: "role-atelier",
          name: "Role Atelier",
          hourly_rate_cents: 4500,
        },
        {
          id: "role-chantier",
          name: "Role Chantier",
          hourly_rate_cents: 5500,
        },
      ],
      categories: [],
    } as never);

    const { workbookWriterFactory, worksheets } = createWorkbookHarness();
    const exported = await streamEstimateVersionDpgfXlsx(VERSION_ID, {
      workbookWriterFactory,
      isLaborSplitEnabled: true,
    });

    const bytes = Buffer.from(await new Response(exported.stream).arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(0);

    const dataSheet = worksheets.find((sheet) => sheet.name === "Donnees");
    const lineRow = dataSheet?.rows[1] as unknown[];

    expect(lineRow[8]).toBe(3.5);
    expect(lineRow[9]).toBeCloseTo((1.5 * 1.1 + 2 * 1.3) / 3.5, 6);
    expect(lineRow[11]).toBe("Atelier: Role Atelier / Chantier: Role Chantier");
    expect(lineRow[13]).toBe(1.5);
    expect(lineRow[14]).toBe(1.1);
    expect(lineRow[15]).toBe("Role Atelier");
    expect(lineRow[16]).toBe(2);
    expect(lineRow[17]).toBe(1.3);
    expect(lineRow[18]).toBe("Role Chantier");

    const disabledHarness = createWorkbookHarness();
    const disabledExport = await streamEstimateVersionDpgfXlsx(VERSION_ID, {
      workbookWriterFactory: disabledHarness.workbookWriterFactory,
      isLaborSplitEnabled: false,
    });
    await new Response(disabledExport.stream).arrayBuffer();

    const disabledSheet = disabledHarness.worksheets.find(
      (sheet) => sheet.name === "Donnees"
    );
    const disabledLineRow = disabledSheet?.rows[1] as unknown[];

    expect(disabledLineRow[8]).toBe(0);
    expect(disabledLineRow[9]).toBe(1);
    expect(disabledLineRow[11]).toBe("");
    expect(disabledLineRow.slice(13, 19)).toEqual([
      null,
      null,
      "",
      null,
      null,
      "",
    ]);
  });

  it("falls back to project name in DPGF filename when reference is empty", async () => {
    vi.mocked(getEstimateVersionDetails).mockResolvedValue({
      version: {
        id: VERSION_ID,
        version_number: 1,
        title: null,
        date_devis: "2026-02-22",
        estimate_projects: {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          name: "Projet Éxport #1",
          reference: " ",
          client_name: null,
        },
      },
      items: [],
      supply_types: [],
      labor_roles: [],
      categories: [],
    } as never);

    const { workbookWriterFactory } = createWorkbookHarness();
    const exported = await streamEstimateVersionDpgfXlsx(VERSION_ID, {
      workbookWriterFactory,
    });

    expect(exported.filename).toBe("devis-Projet_Export_1-v1-dpgf.xlsx");
  });

  it("exports a fresh v2 review snapshot instead of live draft inputs", async () => {
    vi.mocked(getEstimateVersionDetails).mockResolvedValue({
      version: {
        id: VERSION_ID,
        version_number: 3,
        status: "draft",
        title: "Revue v2",
        date_devis: "2026-08-12",
        calc_engine_version: 2,
        content_revision: 9,
        calc_snapshot_content_revision: 9,
        estimate_projects: {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          name: "Projet Revue",
          reference: "REVUE/2026",
          client_name: "Client Revue",
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
      labor_roles: [{ id: "role-live", name: "Taux vivant" }],
      categories: [],
    } as never);

    const { workbookWriterFactory, worksheets } = createWorkbookHarness();
    const exported = await streamEstimateVersionDpgfXlsx(VERSION_ID, {
      workbookWriterFactory,
      isLaborSplitEnabled: false,
    });
    await new Response(exported.stream).arrayBuffer();

    const lineRow = worksheets.find((sheet) => sheet.name === "Donnees")
      ?.rows[1] as unknown[];
    expect(lineRow[5]).toBe(95);
    expect(lineRow[7]).toBe(1);
    expect(lineRow[8]).toBeNull();
    expect(lineRow[11]).toBe("");
  });
});
