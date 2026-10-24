import { describe, expect, it } from "vitest";

import type { EstimateSettingsState } from "@/components/estimates/EstimateSettingsPanel";
import type { EstimateTotals } from "@/lib/estimate-calculations";
import { buildEstimateLineExportRows, buildEstimateRecapRow, normalizeSupplierComparisonsByItemId, type SupplierComparisonsByItemId } from "@/lib/estimates/editor-export";
import type {
  EstimateItem,
  EstimateVersionRow,
} from "@/lib/estimates/editor-items";
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
    fo_provision: 1,
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

function createSettings(): EstimateSettingsState {
  return {
    title: "Devis principal",
    exclusions: "",
    date_devis: "2026-07-15",
    validite_jours: 30,
    currency: "EUR",
    margin_multiplier: 1.2,
    discount_cents: 2500,
    tax_rate_bp: 2000,
    rounding_mode: "nearest",
    rounding_step_cents: 100,
  };
}

function createTotals(overrides: Partial<EstimateTotals> = {}): EstimateTotals {
  return {
    costSubtotalCents: 10000,
    saleSubtotalBeforeCoefficientCents: 20000,
    saleSubtotalCents: 20000,
    discountCents: 2500,
    appliedMarginMultiplier: 1.2,
    globalCoefficient: 1,
    discountMode: "simple",
    discountStepTotals: [],
    saleTotalCents: 17500,
    taxCents: 3500,
    ttcCents: 21000,
    roundedTtcCents: 21000,
    roundingAdjustmentCents: 0,
    adjustedTaxCents: 3500,
    ...overrides,
  };
}

const QUALITY_COUNTS = {
  linesCount: 4,
  linesWithAnomaliesCount: 2,
  totalFlagsCount: 3,
  byFlag: {
    missing_price: 1,
    missing_quantity: 0,
    missing_labor_time: 0,
    missing_labor_role: 0,
    line_nature_mismatch: 0,
    supplier_price_outdated: 0,
    labor_split_incomplete: 0,
    price_outlier: 2,
    quantity_outlier: 0,
  },
} as const;

describe("estimate editor export filename and recap", () => {

  it("guards incomplete recap inputs and computes the discount basis points", () => {
    const version = {
      id: "version-1",
      version_number: 7,
      status: "draft",
    } as EstimateVersionRow;
    const settings = createSettings();
    const totals = createTotals();

    expect(
      buildEstimateRecapRow({
        projectName: "Projet Alpha",
        version: null,
        settings,
        totals,
        qualityCounts: QUALITY_COUNTS,
      })
    ).toBeNull();
    expect(
      buildEstimateRecapRow({
        projectName: "Projet Alpha",
        version,
        settings: null,
        totals,
        qualityCounts: QUALITY_COUNTS,
      })
    ).toBeNull();
    expect(
      buildEstimateRecapRow({
        projectName: "Projet Alpha",
        version,
        settings,
        totals: null,
        qualityCounts: QUALITY_COUNTS,
      })
    ).toBeNull();

    expect(
      buildEstimateRecapRow({
        projectName: "",
        version,
        settings,
        totals,
        qualityCounts: QUALITY_COUNTS,
      })
    ).toEqual({
      project_name: "Chiffrage",
      version_id: "version-1",
      version_number: 7,
      status: "draft",
      date_devis: "2026-07-15",
      validite_jours: 30,
      margin_multiplier: 1.2,
      discount_cents: 2500,
      discount_bp: 1250,
      tax_rate_bp: 2000,
      rounding_mode: "nearest",
      rounding_step_cents: 100,
      sale_subtotal_cents: 20000,
      sale_total_cents: 17500,
      tax_cents: 3500,
      ttc_cents: 21000,
      quality_lines_count: 2,
      quality_flags_count: 3,
    });

    expect(
      buildEstimateRecapRow({
        projectName: "Projet Alpha",
        version,
        settings,
        totals: createTotals({ saleSubtotalCents: 0 }),
        qualityCounts: QUALITY_COUNTS,
      })?.discount_bp
    ).toBe(0);
  });
});

describe("estimate editor supplier comparison normalization", () => {
  it("accepts container and alias variants while limiting each line to three alternatives", () => {
    const alternatives = [
      {
        name: "Supplier A",
        adjusted_unit_price_cents: "1234",
        reference: "REF-A",
        url: "https://example.test/a",
        date: "2026-07-01T12:00:00.000Z",
      },
      { supplier_name: "Supplier B", unit_price_cents: 1400 },
      { supplier_name: "Supplier C", unit_price_cents: 1500 },
      { supplier_name: "Supplier D", unit_price_cents: 1600 },
    ];
    const result = normalizeSupplierComparisonsByItemId({
      itemId: "line-direct",
      alternatives,
      data: {
        comparisons: [
          {
            estimate_item_id: "line-array",
            suppliers: [{ supplier_name: "Supplier Array", unit_price_cents: 9 }],
          },
        ],
        "line-map": {
          options: [{ supplier_name: "Supplier Map", unit_price_cents: 10 }],
        },
      },
    });

    expect(result.get("line-direct")).toHaveLength(3);
    expect(result.get("line-direct")?.[0]).toEqual({
      supplier_name: "Supplier A",
      adjusted_unit_price_cents: 1234,
      unit_price_cents: null,
      currency: null,
      supplier_reference: "REF-A",
      catalogue_url: "https://example.test/a",
      updated_at: "2026-07-01T12:00:00.000Z",
    });
    expect(result.get("line-array")?.[0].supplier_name).toBe("Supplier Array");
    expect(result.get("line-map")?.[0].supplier_name).toBe("Supplier Map");
    expect(result.has("missing")).toBe(false);
  });
});

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
