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
import { frozenV3ExportDocument, type FixtureExportLine } from "@/lib/estimates/v3-export-document.fixtures";

// TI-682 lot C, PR 3 (D25): the internal reason of an exclusion stays internal. PR 4: so does the written reserve of a
// « Non chiffrée » line (its basis, code and note): the client reads the status and the limits text only. Only the internal CSV names it
// (v3-csv-export.test.ts). The standard, DPGF and BDC workbooks are, or can be, sent to a client or a supplier: a line
// excluded after « Non chiffrée » with a reason exports exactly as the same line without one. The reason exists on engine
// 3 only (its statuses do), so the v3 workbooks are the ones to guard.

const VERSION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const INTERNAL_WORDING = /MOTIF CONFIDENTIEL|Motif interne|status_reason|was_not_priced|client_supplied|Fourni ou réalisé|RÉSERVE CONFIDENTIELLE|Réserve dans l'offre|offer_choice|private_estimate|indicative_quantities|pending_survey|Devis privé|Quantités indicatives|relevé/;
const LINES: ReadonlyArray<Omit<FixtureExportLine, "metadata">> = [
  { title: "ARMY tube chiffré" },
  { title: "ARMY calorifuge hors lot", pricing_status: "out_of_scope" },
  { title: "ARMY robinet inclus", pricing_status: "included" },
  { title: "ARMY essais pour mémoire", pricing_status: "for_memory" },
  { title: "ARMY réseau non chiffré", pricing_status: "not_priced" },
];

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

function mockV3(reasoned: boolean) {
  const document = frozenV3ExportDocument(LINES.map((line) => ({
    ...line, metadata: {},
    ...(line.pricing_status && line.pricing_status !== "not_priced" && reasoned
      ? { was_not_priced: true, status_reason: { code: "client_supplied", note: "MOTIF CONFIDENTIEL fourni par le client" } }
      : {}),
    ...(line.pricing_status === "not_priced" && reasoned
      ? { was_not_priced: true, offer_choice: { kind: "reserve", basis: "indicative_quantities", code: "pending_survey",
        note: "RÉSERVE CONFIDENTIELLE selon RC", decided_by: "11111111-1111-4111-8111-111111111111",
        decided_at: "2026-11-11T18:02:23.123456+00:00" } }
      : {}),
  })));
  vi.mocked(getEstimateVersionDetails).mockResolvedValue({
    version: { id: VERSION_ID, version_number: 1, title: "Exclusions", status: "draft", date_devis: "2026-11-11",
      calc_engine_version: 3, estimate_projects: project },
    items: document.items, supply_types: [], labor_roles: [], categories: [],
  } as never);
  vi.mocked(listEstimateItems).mockResolvedValue({ items: document.items } as never);
  vi.mocked(loadEstimateV3ExportDocument).mockResolvedValue(document);
}

describe("client and supplier workbooks never carry the internal reason of an exclusion nor a written reserve (TI-682)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEstimateSupplierComparisons).mockResolvedValue({ comparisons: [] } as never);
  });

  it.each(EXPORTERS)("the %s workbook exports an excluded line with a reason, and a reserved line, as the same lines without them", async (_name, exporter) => {
    mockV3(false);
    const ordinary = await run(exporter);
    mockV3(true);
    const reasoned = await run(exporter);
    expect(vi.mocked(loadEstimateV3ExportDocument)).toHaveBeenCalled();
    expect(JSON.stringify(reasoned)).toContain(LINES[1].title);
    expect(reasoned).toEqual(ordinary);
    expect(JSON.stringify(reasoned)).not.toMatch(INTERNAL_WORDING);
  });
});
