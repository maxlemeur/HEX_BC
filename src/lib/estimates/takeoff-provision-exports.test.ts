import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getEstimateVersionDetails: vi.fn(),
  listEstimateItems: vi.fn(),
  getEstimateSupplierComparisons: vi.fn(),
}));
vi.mock("@/lib/estimates/supplier-export-search", async (original) => ({
  ...await original<typeof import("@/lib/estimates/supplier-export-search")>(),
  loadSupplierExportSearch: vi.fn(async () => null),
}));
vi.mock("@/lib/estimates/v3-export", async (original) => ({
  ...await original<typeof import("@/lib/estimates/v3-export")>(),
  loadEstimateV3ExportDocument: vi.fn(),
}));

import { streamEstimateVersionBdcV11Xlsx } from "@/lib/estimates/bdc-export";
import { streamEstimateVersionDpgfXlsx } from "@/lib/estimates/dpgf-export";
import { streamEstimateVersionXlsx, type WorkbookWriterFactory } from "@/lib/estimates/export-stream";
import { getEstimateSupplierComparisons, getEstimateVersionDetails, listEstimateItems } from "@/lib/estimates/server";
import { loadEstimateV3ExportDocument } from "@/lib/estimates/v3-export";
import { frozenV3ExportDocument, takeoffProvisionMetadata } from "@/lib/estimates/v3-export-document.fixtures";

// TI-682 lot C, PR 1: only the internal CSV exports name a takeoff provision (« Provision métré »). The standard, DPGF
// and BDC workbooks are, or can be, sent to a client or a supplier: a line built from a forced source, an hypothesis or
// an unreadable marker exports exactly as the same line without a marker. dpgf-export.test.ts already guards the v1/v2
// DPGF; this guards the v3 standard, DPGF and BDC workbooks and the v1/v2 standard and BDC workbooks.

const VERSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INTERNAL_WORDING = /Provision métré|Provision interne|Hypothèse|takeoff_provision|forced_reason|entry_category|hypothesis_cause/;
const MARKERS = [
  takeoffProvisionMetadata({ forced: true, forced_reason: "additional_evidence" }),
  takeoffProvisionMetadata({ entry_category: "hypothesis" }),
  takeoffProvisionMetadata({ forced: true, forced_reason: "priced_hypothesis" }),
  { takeoff_provision: { version: 2 } },
  // TI-682 lot C: an hypothesis included without entry, marked with its cause.
  takeoffProvisionMetadata({ hypothesis_cause: "estimated" }),
  takeoffProvisionMetadata({ hypothesis_cause: "non_observable" }),
];
const TITLES = ["ARMY tube forcé", "ARMY tube hypothèse saisie", "ARMY tube hypothèse chiffrée", "ARMY tube marqueur illisible",
  "ARMY support estimé", "ARMY soudure non observable"];

type Captured = { name: string; columns: string[]; rows: unknown[] };

function captureWorkbook() {
  const sheets: Captured[] = [];
  const factory: WorkbookWriterFactory = async (stream) => {
    const writable = stream as { write: (chunk: Buffer) => void; end: () => void };
    const row = () => ({ commit() {}, getCell: () => ({}), eachCell: () => {} });
    return {
      addWorksheet(name: string) {
        const sheet: Captured = { name, columns: [], rows: [] };
        sheets.push(sheet);
        return {
          set columns(value: Array<{ header: string }> | undefined) { sheet.columns = (value ?? []).map((column) => column.header); },
          get columns() { return undefined; },
          addRow(values: unknown) { sheet.rows.push(values); return row(); },
          getRow: row,
          commit() {},
        };
      },
      async commit() { writable.write(Buffer.from("xlsx")); writable.end(); },
    } as never;
  };
  return { sheets, factory };
}

type Exporter = (versionId: string, options: { workbookWriterFactory: WorkbookWriterFactory; isLaborSplitEnabled: boolean })
  => Promise<{ stream: ReadableStream<Uint8Array> }>;
const EXPORTERS: Array<[string, Exporter]> = [
  ["standard", streamEstimateVersionXlsx],
  ["DPGF", streamEstimateVersionDpgfXlsx],
  ["BDC V1.1", streamEstimateVersionBdcV11Xlsx],
];

async function run(exporter: Exporter) {
  const { sheets, factory } = captureWorkbook();
  const exported = await exporter(VERSION_ID, { workbookWriterFactory: factory, isLaborSplitEnabled: false });
  await new Response(exported.stream).arrayBuffer();
  return sheets;
}

const project = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", user_id: null, name: "Projet fictif", reference: "FICTIF/1",
  client_name: null };

describe("client and supplier workbooks never carry the takeoff provision (TI-682)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEstimateSupplierComparisons).mockResolvedValue({ comparisons: [] } as never);
  });

  describe("engine 3", () => {
    function mockV3(marked: boolean) {
      const document = frozenV3ExportDocument(TITLES.map((title, index) => ({ title, metadata: marked ? MARKERS[index] : {} })));
      vi.mocked(getEstimateVersionDetails).mockResolvedValue({
        version: { id: VERSION_ID, version_number: 1, title: "Provisions", status: "draft", date_devis: "2026-11-11",
          calc_engine_version: 3, estimate_projects: project },
        items: document.items, supply_types: [], labor_roles: [], categories: [],
      } as never);
      vi.mocked(listEstimateItems).mockResolvedValue({ items: document.items } as never);
      vi.mocked(loadEstimateV3ExportDocument).mockResolvedValue(document);
    }

    it.each(EXPORTERS)("the %s workbook exports a marked line as the same line without a marker", async (_name, exporter) => {
      mockV3(false);
      const ordinary = await run(exporter);
      mockV3(true);
      const marked = await run(exporter);
      expect(vi.mocked(loadEstimateV3ExportDocument)).toHaveBeenCalled();
      expect(JSON.stringify(marked)).toContain(TITLES[0]);
      expect(marked).toEqual(ordinary);
      expect(JSON.stringify(marked)).not.toMatch(INTERNAL_WORDING);
    });
  });

  describe("engine 2", () => {
    function mockV2(marked: boolean) {
      const items = TITLES.map((title, index) => ({
        id: `c2000000-0000-4000-8000-00000000000${index}`, item_type: "line", parent_id: null, position: index, title,
        description: "ml", quantity: 2, unit_price_ht_cents: 1000, tax_rate_bp: 2000, k_fo: 1, h_mo: 0, h_mo_majoration: 1, k_mo: 1,
        h_mo_atelier: null, k_mo_atelier: null, labor_role_atelier_id: null, h_mo_chantier: null, k_mo_chantier: null,
        labor_role_chantier_id: null, pu_ht_cents: null, labor_role_id: null, category_id: null, supply_type_id: null,
        line_total_ht_cents: null, line_tax_cents: null, line_total_ttc_cents: null, source_provider: "takeoff",
        source_metadata: marked ? MARKERS[index] : {},
      }));
      vi.mocked(getEstimateVersionDetails).mockResolvedValue({
        version: { id: VERSION_ID, version_number: 1, title: "Provisions", status: "draft", date_devis: "2026-11-11",
          calc_engine_version: 2, margin_multiplier: 1, tax_rate_bp: 2000, discount_bp: 0, estimate_projects: project },
        items, supply_types: [], labor_roles: [], categories: [],
      } as never);
      vi.mocked(listEstimateItems).mockResolvedValue({ items } as never);
    }

    it.each(EXPORTERS.filter(([name]) => name !== "DPGF"))("the %s workbook exports a marked line as the same line without a marker",
      async (_name, exporter) => {
        mockV2(false);
        const ordinary = await run(exporter);
        mockV2(true);
        const marked = await run(exporter);
        expect(vi.mocked(loadEstimateV3ExportDocument)).not.toHaveBeenCalled();
        expect(JSON.stringify(marked)).toContain(TITLES[0]);
        expect(marked).toEqual(ordinary);
        expect(JSON.stringify(marked)).not.toMatch(INTERNAL_WORDING);
      });
  });
});
