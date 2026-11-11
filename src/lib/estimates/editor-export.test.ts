import { beforeEach, describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

vi.mock("@/lib/browser-download", () => ({ downloadBlob: vi.fn() }));

import { downloadBlob } from "@/lib/browser-download";
import {
  buildEstimateLineExportRows,
  getEstimateLineExportColumns,
  normalizeSupplierComparisonsByItemId,
  type SupplierComparisonsByItemId,
} from "@/lib/estimates/editor-export";
import type { EstimateItem } from "@/lib/estimates/editor-items";
import { formatCurrency } from "@/lib/money";

function createItem(overrides: Partial<EstimateItem> = {}): EstimateItem {
  return {
    h_mo_atelier_per_unit: null,
    h_mo_chantier_per_unit: null,
    h_mo_per_unit: null,
    line_nature: null,
    pricing_status: "priced",
    product_id: null,
    snapshot_gross_fo_ht_cents: null,
    snapshot_gross_ht_cents: null,
    unit_code: null,
    id: "line-1",
    created_at: "2026-07-01T08:00:00.000Z",
    updated_at: "2026-07-01T08:00:00.000Z",
    tenant_id: "tenant-1",
    version_id: "version-1",
    parent_id: "section-child",
    item_type: "line",
    position: 1,
    title: " Tube acier ",
    aid: "A.1",
    description: " ml ",
    quantity: 3,
    unit_price_ht_cents: 1250,
    tax_rate_bp: 2000,
    k_fo: 1.1,
    fo_price_origin: null, fo_provision: 1, status_reason: null, was_not_priced: false,
    h_mo: 2.5,
    h_mo_majoration: 1.2,
    k_mo: 1.05,
    h_mo_atelier: 1,
    k_mo_atelier: 1.1,
    labor_role_atelier_id: "role-atelier",
    h_mo_chantier: 1.5,
    k_mo_chantier: 1.2,
    labor_role_chantier_id: "role-chantier",
    pu_ht_cents: 5200,
    labor_role_id: "role-default",
    category_id: "category-1",
    supply_type_id: "supply-1",
    selected_supplier_price_id: "supplier-price-1",
    source_provider: null,
    source_job_id: null,
    source_file_name: null,
    source_page: null,
    source_metadata: {},
    line_total_ht_cents: 15600,
    line_tax_cents: 3120,
    line_total_ttc_cents: 18720,
    ...overrides,
    snapshot_pu_ht_cents: overrides.snapshot_pu_ht_cents ?? null,
    snapshot_fo_ht_cents: overrides.snapshot_fo_ht_cents ?? null,
    snapshot_mo_ht_cents: overrides.snapshot_mo_ht_cents ?? null,
    snapshot_mo_atelier_ht_cents:
      overrides.snapshot_mo_atelier_ht_cents ?? null,
    snapshot_mo_chantier_ht_cents:
      overrides.snapshot_mo_chantier_ht_cents ?? null,
  };
}

describe("estimate editor line export rows", () => {

  it("builds a complete line with quality, supplier and labor split values", () => {
    const root = createItem({
      id: "section-root",
      item_type: "section",
      parent_id: null,
      title: "Lot plomberie",
    });
    const child = createItem({
      id: "section-child",
      item_type: "section",
      parent_id: "section-root",
      title: "Distribution",
    });
    const line = createItem();
    const supplierComparisons: SupplierComparisonsByItemId = new Map([
      [
        "line-1",
        [
          {
            supplier_name: "Fournisseur A",
            adjusted_unit_price_cents: 1234,
            unit_price_cents: 1300,
            currency: "EUR",
            supplier_reference: "REF-A",
            catalogue_url: "https://example.test/a",
            updated_at: "2026-07-01T12:00:00.000Z",
          },
        ],
      ],
    ]);

    expect(
      buildEstimateLineExportRows({
        items: [root, child, line],
        currency: "EUR",
        supplyTypeById: new Map([["supply-1", { name: "Fourniture" }]]),
        laborRoleById: new Map([
          ["role-default", { name: "Poseur" }],
          ["role-atelier", { name: "Monteur atelier" }],
          ["role-chantier", { name: "Monteur chantier" }],
        ]),
        qualityFlagsByItemId: {
          "line-1": ["missing_price", "price_outlier"],
        },
        supplierComparisonsByItemId: supplierComparisons,
      })
    ).toEqual([
      {
        section_path: "Lot plomberie > Distribution",
        designation: "Tube acier",
        quality_flags: "Prix manquant | Prix atypique",
        unit: "ml",
        quantity: 3,
        unit_price_ht_cents: 1250,
        supply_type: "Fourniture",
        supplier_1: `Fournisseur A | ${formatCurrency(
          1234,
          "EUR"
        )} | REF-A | https://example.test/a | 2026-07-01`,
        supplier_2: "",
        supplier_3: "",
        k_fo: 1.1,
        h_mo: 2.5,
        h_mo_majoration_pct: 120,
        labor_role: "Poseur",
        k_mo: 1.05,
        h_mo_atelier: 1,
        labor_role_atelier: "Monteur atelier",
        k_mo_atelier: 1.1,
        h_mo_chantier: 1.5,
        labor_role_chantier: "Monteur chantier",
        k_mo_chantier: 1.2,
        pu_ht_cents: 5200,
        line_total_ht_cents: 15600,
        tax_rate_bp: 2000,
        line_total_ttc_cents: 18720,
        takeoff_provision: "",
      },
    ]);
  });
});

// Second review of 2.9: a converted offer (bar of 3 m at 262,45 €) is 87,48 € for a line in ml and
// 262,45 € for a line written in bars; the export shows the price the line would take.
describe("estimate editor export of a converted offer", () => {
  it("prices the supplier columns in the unit of the line", () => {
    const bar = { supplier_name: "Fonte", adjusted_unit_price_cents: 8748, unit_price_cents: 26245, unit: "barre",
      estimate_unit_code: "ml", estimate_units_per_purchase_unit: 3, purchase_rounding: "ceil" };
    const comparisons = normalizeSupplierComparisonsByItemId({
      data: { comparisons: [{ estimate_item_id: "line-ml", suppliers: [bar] }, { estimate_item_id: "line-bar", suppliers: [bar] }] },
    });
    const rows = buildEstimateLineExportRows({
      items: [createItem({ id: "line-ml", parent_id: null }), createItem({ id: "line-bar", parent_id: null, description: "barre" })],
      currency: "EUR",
      supplyTypeById: new Map(),
      laborRoleById: new Map(),
      qualityFlagsByItemId: {},
      supplierComparisonsByItemId: comparisons,
    });
    expect(rows.map((row) => row.supplier_1.split(" | ")[1])).toEqual([formatCurrency(8748, "EUR"), formatCurrency(26245, "EUR")]);
  });
});

// TI-682 lot C, PR 1 (H12 lifted for the CSV): the CSV a v1/v2 editor writes says which lines come from a takeoff
// provision, as the v3 server CSV does. The marker lives in source_metadata.takeoff_provision (readTakeoffProvision).
describe("estimate editor CSV takeoff provision column (TI-682)", () => {
  beforeEach(() => vi.clearAllMocks());

  const jobId = "30000000-0000-4000-8000-000000000003";
  const source = (overrides: Record<string, unknown>) => ({
    takeoff_item_id: "40000000-0000-4000-8000-000000000004", forced: false, forced_reason: null, entry_category: null, ...overrides,
  });
  const marker = (...sources: ReturnType<typeof source>[]) => ({ takeoff_provision: { version: 1, job_id: jobId, sources } });
  const lines = [
    { title: "Ligne sans marqueur", metadata: {}, expected: "" },
    { title: "Ligne forcée", metadata: marker(source({ forced: true, forced_reason: "additional_evidence" })), expected: "Provision interne" },
    { title: "Ligne hypothèse", metadata: marker(source({ entry_category: "hypothesis" })), expected: "Hypothèse" },
    // TI-682 lot C: a quantity a plan cannot show, included without entry.
    { title: "Ligne non observable", metadata: marker(source({ hypothesis_cause: "non_observable" })), expected: "Hypothèse" },
    { title: "Ligne illisible", metadata: { takeoff_provision: "?" }, expected: "Provision interne" },
  ];

  async function downloadedCsv(isLaborSplitEnabled: boolean) {
    const rows = buildEstimateLineExportRows({
      items: lines.map((line, index) => createItem({ id: `line-${index}`, parent_id: null, title: line.title, source_metadata: line.metadata })),
      currency: "EUR",
      supplyTypeById: new Map(),
      laborRoleById: new Map(),
      qualityFlagsByItemId: {},
    });
    const { exportToCSV } = await import("@/lib/export");
    await exportToCSV(rows, getEstimateLineExportColumns(isLaborSplitEnabled), { filename: "chiffrage" });
    const [blob] = vi.mocked(downloadBlob).mock.calls[0];
    const csv = await blob.text();
    const workbook = XLSX.read(csv.replace(/^\ufeff/, ""), { type: "string", raw: true, FS: ";" });
    return XLSX.utils.sheet_to_json<string[]>(workbook.Sheets[workbook.SheetNames[0]], { header: 1, raw: true, defval: "" });
  }

  it("states for each engine 2 line whether it comes from a takeoff provision, an hypothesis, or neither", async () => {
    const parsed = await downloadedCsv(false);
    const designation = parsed[0].indexOf("Désignation");
    const provision = parsed[0].indexOf("Provision métré");
    expect(provision).toBeGreaterThan(-1);
    expect(parsed.slice(1).map((row) => [row[designation], row[provision]])).toEqual(lines.map((line) => [line.title, line.expected]));
  });

  it("appends the column after every existing one, labor split included", async () => {
    const base = ["Chemin chapitre", "Désignation", "Flags qualité", "Unité", "Quantité", "Prix unitaire HT (EUR)", "Type FO",
      "Fournisseur 1", "Fournisseur 2", "Fournisseur 3", "K FO", "h MO", "Majoration MO (%)", "Rôle MO", "K MO", "PU HT (EUR)",
      "Total HT (EUR)", "TVA (%)", "Total TTC (EUR)"];
    const split = ["h MO atelier", "Rôle MO atelier", "K MO atelier", "h MO chantier", "Rôle MO chantier", "K MO chantier"];
    expect((await downloadedCsv(false))[0]).toEqual([...base, "Provision métré"]);
    vi.clearAllMocks();
    expect((await downloadedCsv(true))[0]).toEqual([...base, ...split, "Provision métré"]);
  });
});
