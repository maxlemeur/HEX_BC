import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EstimateDocument, type EstimateDocumentProps } from "@/components/EstimateDocument";
import { formatEUR } from "@/lib/money";
import type { Database } from "@/types/database";

vi.mock("next/image", () => ({
  default: function NextImageMock() {
    return null;
  },
}));

type EstimateItem = Database["public"]["Tables"]["estimate_items"]["Row"];

function createEstimateItem(overrides: Partial<EstimateItem> = {}): EstimateItem {
  return {
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
    line_total_ht_cents: 0,
    line_tax_cents: 0,
    line_total_ttc_cents: 0,
    ...overrides,
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
  isLaborSplitEnabled: false,
  laborRateById: {},
  totalHtCents: 0,
  totalTaxCents: 0,
  totalTtcCents: 0,
  supplyTypeLabelsById: {},
};

function renderEstimateDocument(
  items: EstimateItem[],
  overrides: Partial<Omit<EstimateDocumentProps, "items">> = {}
) {
  return renderToStaticMarkup(
    createElement(EstimateDocument, {
      ...BASE_PROPS,
      ...overrides,
      items,
    })
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findTableRowMarkup(markup: string, token: string): string {
  const pattern = new RegExp(
    `<tr[^>]*>[\\s\\S]*?${escapeRegExp(token)}[\\s\\S]*?<\\/tr>`,
    "g"
  );
  const matches = markup.match(pattern) ?? [];
  expect(matches).toHaveLength(1);
  return matches[0] ?? "";
}

function getSummaryLabels(rowMarkup: string): string[] {
  return Array.from(
    rowMarkup.matchAll(/>(FO|MO atelier|MO chantier|MO|HT|TTC)\s[^<]+</g)
  ).map((entry) => entry[1]);
}

function expectSectionSummaryInRow(
  rowMarkup: string,
  totals: {
    foCents: number;
    moCents?: number;
    moAtelierCents?: number;
    moChantierCents?: number;
    htCents: number;
    ttcCents: number;
  }
) {
  const labels = getSummaryLabels(rowMarkup);
  expect(rowMarkup).toContain(`FO ${formatEUR(totals.foCents)}`);
  if (typeof totals.moCents === "number") {
    expect(labels).toContain("MO");
    expect(labels).not.toContain("MO atelier");
    expect(labels).not.toContain("MO chantier");
    expect(rowMarkup).toContain(`MO ${formatEUR(totals.moCents)}`);
  }
  if (typeof totals.moAtelierCents === "number") {
    expect(labels).toContain("MO atelier");
    expect(labels).not.toContain("MO");
    expect(rowMarkup).toContain(`MO atelier ${formatEUR(totals.moAtelierCents)}`);
  }
  if (typeof totals.moChantierCents === "number") {
    expect(labels).toContain("MO chantier");
    expect(labels).not.toContain("MO");
    expect(rowMarkup).toContain(`MO chantier ${formatEUR(totals.moChantierCents)}`);
  }
  expect(rowMarkup).toContain(`HT ${formatEUR(totals.htCents)}`);
  expect(rowMarkup).toContain(`TTC ${formatEUR(totals.ttcCents)}`);
}

function expectSectionSummary(
  markup: string,
  sectionTitle: string,
  totals: {
    foCents: number;
    moCents?: number;
    moAtelierCents?: number;
    moChantierCents?: number;
    htCents: number;
    ttcCents: number;
  }
) {
  const rowMarkup = findTableRowMarkup(markup, sectionTitle);
  expectSectionSummaryInRow(rowMarkup, totals);
}

describe("EstimateDocument - EST-121", () => {
  it("affiche FO/MO/HT/TTC d'une section avec remise proportionnelle", () => {
    const sectionId = "section-target";
    const items: EstimateItem[] = [
      createSection({ id: sectionId, title: "Section cible", position: 1 }),
      createSection({ id: "section-other", title: "Section autre", position: 2 }),
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
      foCents: 3600,
      moCents: 2700,
      htCents: 6300,
      ttcCents: 7560,
    });
    expectSectionSummary(markup, "Section autre", {
      foCents: 2700,
      moCents: 0,
      htCents: 2700,
      ttcCents: 3240,
    });
  });

  it("affiche les libelles de type FO quand le mapping est fourni", () => {
    const sectionId = "section-type";
    const items: EstimateItem[] = [
      createSection({ id: sectionId, title: "Section type", position: 1 }),
      createEstimateItem({
        id: "line-type",
        parent_id: sectionId,
        title: "Ligne type",
        position: 1,
        quantity: 1,
        unit_price_ht_cents: 1000,
        k_fo: 1,
        h_mo: 0,
        k_mo: 1,
        supply_type_id: "supply-a",
      }),
    ];

    const markup = renderEstimateDocument(items, {
      supplyTypeLabelsById: {
        "supply-a": "Pompe",
      },
    });

    expect(markup).toContain("Pompe");
  });

  it("inclut les lignes des sous-sections dans le total de la section parente", () => {
    const parentSectionId = "section-parent";
    const childSectionId = "section-child";
    const items: EstimateItem[] = [
      createSection({ id: parentSectionId, title: "Section parent", position: 1 }),
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
      foCents: 1500,
      moCents: 0,
      htCents: 1500,
      ttcCents: 1800,
    });
    expectSectionSummary(markup, "Sous-section", {
      foCents: 500,
      moCents: 0,
      htCents: 500,
      ttcCents: 600,
    });
  });

  it("affiche FO/MO/HT/TTC a zero pour une section vide", () => {
    const emptySectionId = "section-empty";
    const otherSectionId = "section-other";
    const items: EstimateItem[] = [
      createSection({ id: emptySectionId, title: "Section vide", position: 1 }),
      createSection({ id: otherSectionId, title: "Section autre", position: 2 }),
      createEstimateItem({
        id: "line-other",
        parent_id: otherSectionId,
        title: "Ligne autre",
        position: 1,
        quantity: 1,
        unit_price_ht_cents: 1000,
        k_fo: 1,
        h_mo: 0,
        k_mo: 1,
      }),
    ];

    const markup = renderEstimateDocument(items, {
      marginMultiplier: 1.5,
      discountCents: 300,
      taxRateBp: 2000,
    });

    expectSectionSummary(markup, "Section vide", {
      foCents: 0,
      moCents: 0,
      htCents: 0,
      ttcCents: 0,
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
      foCents: 1000,
      moAtelierCents: 500,
      moChantierCents: 600,
      htCents: 2100,
      ttcCents: 2520,
    });

    const lineRowMarkup = findTableRowMarkup(markup, "Ligne split");
    expect(lineRowMarkup).toContain("Atelier:");
    expect(lineRowMarkup).toContain("Chantier:");
    expect(lineRowMarkup).toContain("Maj:");
  });
});
