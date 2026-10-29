import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  EstimateDocument,
  type EstimateDocumentProps,
} from "@/components/EstimateDocument";
import { formatCurrency, type SupportedEstimateCurrency } from "@/lib/money";
import type { Database } from "@/types/database";

vi.mock("next/image", () => ({
  default: function NextImageMock() {
    return null;
  },
}));

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

function createEstimateItem(
  overrides: Partial<EstimateItem> = {},
): EstimateItem {
  return {
    aid: null,
    h_mo_atelier_per_unit: null,
    h_mo_chantier_per_unit: null,
    h_mo_per_unit: null,
    line_nature: null,
    pricing_status: "priced",
    product_id: null,
    snapshot_gross_fo_ht_cents: null,
    snapshot_gross_ht_cents: null,
    unit_code: null,
    id: overrides.id ?? crypto.randomUUID(),
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    tenant_id: "tenant-test",
    version_id: "version-test",
    parent_id: null,
    item_type: "line",
    position: 0,
    title: "Ligne test",
    description: null,
    quantity: 1,
    unit_price_ht_cents: 0,
    tax_rate_bp: 2000,
    k_fo: 1,
    fo_provision: 1,
    h_mo: 0,
    h_mo_majoration: 1,
    k_mo: 1,
    h_mo_atelier: null,
    k_mo_atelier: null,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    k_mo_chantier: null,
    labor_role_chantier_id: null,
    pu_ht_cents: 0,
    labor_role_id: null,
    category_id: null,
    supply_type_id: null,
    selected_supplier_price_id: null,
    line_total_ht_cents: 0,
    line_tax_cents: 0,
    line_total_ttc_cents: 0,
    ...overrides,
    source_provider: overrides.source_provider ?? null,
    source_job_id: overrides.source_job_id ?? null,
    source_file_name: overrides.source_file_name ?? null,
    source_page: overrides.source_page ?? null,
    source_metadata: overrides.source_metadata ?? {},
    snapshot_pu_ht_cents: overrides.snapshot_pu_ht_cents ?? null,
    snapshot_fo_ht_cents: overrides.snapshot_fo_ht_cents ?? null,
    snapshot_mo_ht_cents: overrides.snapshot_mo_ht_cents ?? null,
    snapshot_mo_atelier_ht_cents:
      overrides.snapshot_mo_atelier_ht_cents ?? null,
    snapshot_mo_chantier_ht_cents:
      overrides.snapshot_mo_chantier_ht_cents ?? null,
  };
}

function createSection(overrides: Partial<EstimateItem> = {}): EstimateItem {
  return createEstimateItem({
    item_type: "section",
    title: "Section test",
    quantity: null,
    unit_price_ht_cents: null,
    pu_ht_cents: null,
    line_total_ht_cents: null,
    line_tax_cents: null,
    line_total_ttc_cents: null,
    ...overrides,
  });
}

const BASE_PROPS: Omit<EstimateDocumentProps, "items"> = {
  projectName: "Projet test",
  projectClient: null,
  projectReference: null,
  versionNumber: 1,
  dateDevis: "2026-01-01",
  validiteJours: 30,
  marginMultiplier: 1,
  discountCents: 0,
  taxRateBp: 2000,
  currency: "EUR",
  isLaborSplitEnabled: false,
  laborRateById: {},
  totalHtCents: 0,
  totalTaxCents: 0,
  totalTtcCents: 0,
};

function renderEstimateDocument(
  items: EstimateItem[],
  overrides: Partial<Omit<EstimateDocumentProps, "items">> = {},
) {
  return renderToStaticMarkup(
    createElement(EstimateDocument, {
      ...BASE_PROPS,
      ...overrides,
      items,
    }),
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatCurrencyForTest(
  cents: number,
  currency: SupportedEstimateCurrency,
) {
  return formatCurrency(cents, currency);
}

function findTableRowMarkup(markup: string, token: string): string {
  const pattern = new RegExp(
    `<tr[^>]*>[\\s\\S]*?${escapeRegExp(token)}[\\s\\S]*?<\\/tr>`,
    "g",
  );
  const matches = markup.match(pattern) ?? [];
  expect(matches).toHaveLength(1);
  return matches[0] ?? "";
}

function expectSectionSummaryInRow(
  rowMarkup: string,
  totals: {
    htCents: number;
  },
) {
  expect(rowMarkup).toContain(formatCurrency(totals.htCents, "EUR"));
  expect(rowMarkup).not.toContain("FO ");
  expect(rowMarkup).not.toContain("MO ");
  expect(rowMarkup).not.toContain("TTC ");
  expect(rowMarkup).not.toContain("HT ");
}

function expectSectionSummary(
  markup: string,
  sectionTitle: string,
  totals: {
    htCents: number;
  },
) {
  const rowMarkup = findTableRowMarkup(markup, sectionTitle);
  expectSectionSummaryInRow(rowMarkup, totals);
}

describe("EstimateDocument - EST-121", () => {
  it("rend le PU contractuel figé pour une version v2 finalisée", () => {
    const markup = renderEstimateDocument(
      [
        createEstimateItem({
          id: "line-snapshot-pu",
          title: "Ligne snapshot PU",
          quantity: 2,
          pu_ht_cents: 7_777,
          snapshot_pu_ht_cents: 9_500,
          snapshot_fo_ht_cents: 12_000,
          snapshot_mo_ht_cents: 7_000,
          snapshot_mo_atelier_ht_cents: 3_000,
          snapshot_mo_chantier_ht_cents: 4_000,
          line_total_ht_cents: 19_000,
          line_tax_cents: 3_800,
          line_total_ttc_cents: 22_800,
        }),
      ],
      {
        calcEngineVersion: 2,
        preserveStoredSnapshot: true,
        totalHtCents: 19_000,
        totalTaxCents: 3_800,
        totalTtcCents: 22_800,
      }
    );
    const row = findTableRowMarkup(markup, "Ligne snapshot PU");

    expect(row).toContain(formatCurrencyForTest(9_500, "EUR"));
    expect(row).not.toContain(formatCurrencyForTest(7_777, "EUR"));
  });

  it("garde un seul total principal en autoliquidation", () => {
    const totalHtCents = 123_456;
    const formattedTotal = formatCurrencyForTest(totalHtCents, "EUR");
    const markup = renderEstimateDocument([], {
      totalHtCents,
      totalTaxCents: 0,
      totalTtcCents: totalHtCents,
      vatReverseCharge: true,
    });

    expect(markup.match(new RegExp(escapeRegExp(formattedTotal), "g"))).toHaveLength(1);
    expect(markup.match(/>Total HT</g)).toHaveLength(2);
    expect(markup).toContain("Autoliquidation");
    expect(markup).not.toContain("Total TTC");
  });

  it("affiche le total HT d'une section avec remise proportionnelle", () => {
    const sectionId = "section-target";
    const items: EstimateItem[] = [
      createSection({ id: sectionId, title: "Section cible", position: 1 }),
      createSection({
        id: "section-other",
        title: "Section autre",
        position: 2,
      }),
      createEstimateItem({
        id: "line-target",
        parent_id: sectionId,
        title: "Ligne cible",
        position: 1,
        quantity: 2,
        unit_price_ht_cents: 1000,
        k_fo: 1,
        h_mo: 3,
        k_mo: 1,
        labor_role_id: "role-a",
      }),
      createEstimateItem({
        id: "line-other",
        parent_id: "section-other",
        title: "Ligne autre",
        position: 1,
        quantity: 1,
        unit_price_ht_cents: 1500,
        k_fo: 1,
        h_mo: 0,
        k_mo: 1,
      }),
    ];

    const markup = renderEstimateDocument(items, {
      marginMultiplier: 2,
      discountCents: 1000,
      taxRateBp: 2000,
      laborRateById: { "role-a": 500 },
    });

    expectSectionSummary(markup, "Section cible", {
      htCents: 6300,
    });
    expectSectionSummary(markup, "Section autre", {
      htCents: 2700,
    });
  });

  it("inclut les lignes des sous-sections dans le total de la section parente", () => {
    const parentSectionId = "section-parent";
    const childSectionId = "section-child";
    const items: EstimateItem[] = [
      createSection({
        id: parentSectionId,
        title: "Section parent",
        position: 1,
      }),
      createSection({
        id: childSectionId,
        parent_id: parentSectionId,
        title: "Sous-section",
        position: 1,
      }),
      createEstimateItem({
        id: "line-parent",
        parent_id: parentSectionId,
        title: "Ligne parent",
        position: 2,
        quantity: 1,
        unit_price_ht_cents: 1000,
        k_fo: 1,
        h_mo: 0,
        k_mo: 1,
      }),
      createEstimateItem({
        id: "line-child",
        parent_id: childSectionId,
        title: "Ligne enfant",
        position: 1,
        quantity: 1,
        unit_price_ht_cents: 500,
        k_fo: 1,
        h_mo: 0,
        k_mo: 1,
      }),
    ];

    const markup = renderEstimateDocument(items, {
      marginMultiplier: 1,
      discountCents: 0,
      taxRateBp: 2000,
    });

    expectSectionSummary(markup, "Section parent", {
      htCents: 1500,
    });
    expectSectionSummary(markup, "Sous-section", {
      htCents: 500,
    });
  });

  it("affiche MO atelier/chantier en mode split actif", () => {
    const sectionId = "section-split";
    const lineId = "line-split";
    const items: EstimateItem[] = [
      createSection({ id: sectionId, title: "Section split", position: 1 }),
      createEstimateItem({
        id: lineId,
        parent_id: sectionId,
        title: "Ligne split",
        position: 1,
        quantity: 1,
        unit_price_ht_cents: 1000,
        k_fo: 1,
        h_mo: 0,
        k_mo: 1,
        h_mo_majoration: 1,
        h_mo_atelier: 1,
        k_mo_atelier: 1,
        labor_role_atelier_id: "role-atelier",
        h_mo_chantier: 2,
        k_mo_chantier: 1,
        labor_role_chantier_id: "role-chantier",
      }),
    ];

    const markup = renderEstimateDocument(items, {
      marginMultiplier: 1,
      discountCents: 0,
      taxRateBp: 2000,
      isLaborSplitEnabled: true,
      laborRateById: {
        "role-atelier": 500,
        "role-chantier": 300,
      },
    });

    expectSectionSummary(markup, "Section split", {
      htCents: 2100,
    });

    const lineRowMarkup = findTableRowMarkup(markup, "Ligne split");
    expect(lineRowMarkup).not.toContain("Maj:");
  });
});
