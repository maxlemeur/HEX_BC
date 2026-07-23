import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  EstimateDocument,
  type EstimateDocumentProps,
} from "@/components/EstimateDocument";
import {
  createDevelopmentEstimateTermsTemplate,
  createEstimateTermsSnapshot,
} from "@/lib/estimates/pdf-terms";
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
  it("masque la remise sur le document client lorsqu'elle est nulle", () => {
    const markup = renderEstimateDocument([], { discountCents: 0 });

    expect(markup).not.toContain("Remise");
  });

  it("affiche la remise sur le document client lorsqu'elle est positive", () => {
    const markup = renderEstimateDocument([], { discountCents: 1000 });

    expect(markup).toContain("Remise");
    expect(markup).toContain(`-${formatCurrencyForTest(1000, "EUR")}`);
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

  it("affiche HT a zero pour une section vide", () => {
    const emptySectionId = "section-empty";
    const otherSectionId = "section-other";
    const items: EstimateItem[] = [
      createSection({ id: emptySectionId, title: "Section vide", position: 1 }),
      createSection({
        id: otherSectionId,
        title: "Section autre",
        position: 2,
      }),
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
      htCents: 0,
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

  it("affiche une numerotation hierarchique calculee a la volee", () => {
    const parentSectionId = "section-number-parent";
    const childSectionId = "section-number-child";
    const items: EstimateItem[] = [
      createSection({
        id: parentSectionId,
        title: "Section parent",
        position: 1,
      }),
      createSection({
        id: childSectionId,
        parent_id: parentSectionId,
        title: "Section enfant",
        position: 1,
      }),
      createEstimateItem({
        id: "line-number-child",
        parent_id: childSectionId,
        title: "Ligne enfant",
        position: 1,
      }),
    ];

    const markup = renderEstimateDocument(items);
    const parentSectionRow = findTableRowMarkup(markup, "Section parent");
    const childSectionRow = findTableRowMarkup(markup, "Section enfant");
    const lineRow = findTableRowMarkup(markup, "Ligne enfant");

    expect(parentSectionRow).toMatch(
      />01<\/span>\s*<span>Section parent<\/span>/,
    );
    expect(childSectionRow).toMatch(
      />01\.1<\/span>\s*<span>Section enfant<\/span>/,
    );
    expect(lineRow).toContain("Ligne enfant");
    expect(lineRow).not.toContain("01.1.01");
  });

  it("formate les montants avec la devise du devis", () => {
    const sectionId = "section-currency";
    const items: EstimateItem[] = [
      createSection({ id: sectionId, title: "Section devise", position: 1 }),
      createEstimateItem({
        id: "line-currency",
        parent_id: sectionId,
        title: "Ligne devise",
        position: 1,
        quantity: 1,
        unit_price_ht_cents: 1000,
        pu_ht_cents: 1250,
        line_total_ht_cents: 1250,
        line_tax_cents: 250,
        line_total_ttc_cents: 1500,
        k_fo: 1,
        h_mo: 0,
        k_mo: 1,
      }),
    ];

    const markup = renderEstimateDocument(items, {
      currency: "USD",
      marginMultiplier: 1,
      discountCents: 100,
      taxRateBp: 2000,
      totalHtCents: 1250,
      totalTaxCents: 250,
      totalTtcCents: 1500,
    });

    expect(markup).toContain(formatCurrencyForTest(1250, "USD"));
    expect(markup).toContain(formatCurrencyForTest(250, "USD"));
    expect(markup).toContain(`-${formatCurrencyForTest(100, "USD")}`);
  });

  it("applique nowrap et align-middle sur les entetes courts", () => {
    const markup = renderEstimateDocument([]);

    expect(markup).toMatch(
      /<th class="[^"]*align-middle[^"]*whitespace-nowrap[^"]*">Designation<\/th>/,
    );
    expect(markup).toMatch(
      /<th class="[^"]*align-middle[^"]*whitespace-nowrap[^"]*">P\.U\. HT<\/th>/,
    );
  });

  it("masque les informations internes cote client", () => {
    const markup = renderEstimateDocument([]);

    expect(markup).not.toContain("AID");
    expect(markup).not.toContain("Type FO");
    expect(markup).not.toContain("Marge");
  });

  it("normalise l'emetteur et affiche les limites de prestation", () => {
    const markup = renderEstimateDocument([], {
      issuerName: "maxime.michel@hydroexpress.fr",
      issuerRole: "Charge d'affaires",
      issuerEmail: "maxime.michel@hydroexpress.fr",
      exclusions: "Percements structurels exclus.",
      layout: {
        preset: "client_detailed",
        detailLevel: "lines",
        priceMode: "unit_and_total",
        density: "standard",
        showNumbering: true,
        showSectionSubtotals: true,
        conditionsPlacement: "new_page",
        includeTerms: false,
      },
    });

    expect(markup).toContain("Maxime MICHEL");
    expect(markup.match(/maxime\.michel@hydroexpress\.fr/g)).toHaveLength(1);
    expect(markup).toContain("Précisions et limites de prestation");
    expect(markup).toContain("17 rue Dupin 75006 Paris");
    expect(markup).not.toContain("Siège social : 29 bis, rue de la Prairie");
    expect(markup).not.toContain("Precisions et exclusions");
  });

  it("ajoute la maquette CGV comme dernier feuillet non contractuel", () => {
    const draft = createDevelopmentEstimateTermsTemplate(
      "tenant-test",
      "development",
    );
    if (!draft) throw new Error("Expected a development draft.");

    const markup = renderEstimateDocument([], {
      layout: {
        preset: "client_detailed",
        detailLevel: "lines",
        priceMode: "unit_and_total",
        density: "standard",
        showNumbering: true,
        showSectionSubtotals: true,
        conditionsPlacement: "auto",
        includeTerms: true,
      },
      terms: createEstimateTermsSnapshot(draft, "2026-07-19T08:00:00.000Z"),
    });

    expect(markup).toContain("Projet de CGV - Travaux B2B");
    expect(markup).toContain("Projet non contractuel");
    expect(markup).toContain(
      "à faire valider par un conseil juridique avant toute utilisation contractuelle",
    );
    expect(markup).toContain("1. FORMATION ET DOCUMENTS CONTRACTUELS");
    expect(markup).toContain("8. PREUVE, DROIT APPLICABLE ET LITIGES");
    expect(markup).not.toContain("VALIDITÉ ET ACCEPTATION");
    expect(markup).not.toContain("ACCÈS ET CONDITIONS DE CHANTIER");
    expect(markup).toContain("columns-1");
    expect(markup).toContain("print-page-break-before");
    expect(markup.lastIndexOf("Projet de CGV - Travaux B2B")).toBeGreaterThan(
      markup.lastIndexOf("Total TTC"),
    );
  });

  it("confine le debordement mobile au tableau du document", () => {
    const markup = renderEstimateDocument([]);

    expect(markup).toContain(
      "document-page relative mx-auto my-5 flex w-full max-w-full",
    );
    expect(markup).toContain("overflow-x-auto");
    expect(markup).toContain("min-w-[40rem] md:min-w-0");
  });
});
