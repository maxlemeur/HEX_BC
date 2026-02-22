import { describe, expect, it } from "vitest";

import { buildEstimateChangelog } from "@/lib/estimates/changelog";
import type { EstimateVersionDetailsForDiff } from "@/lib/estimates/diff";
import type { Database } from "@/types/database";

type EstimateVersionRow =
  Database["public"]["Tables"]["estimate_versions"]["Row"];
type EstimateItemRow = Database["public"]["Tables"]["estimate_items"]["Row"];

const BASE_TIMESTAMP = "2026-02-20T10:00:00.000Z";

function createVersion(
  overrides: Partial<EstimateVersionRow> & Pick<EstimateVersionRow, "id">
): EstimateVersionRow {
  const totalHtCents = overrides.total_ht_cents ?? 0;
  const totalTtcCents = overrides.total_ttc_cents ?? totalHtCents;

  return {
    id: overrides.id,
    created_at: overrides.created_at ?? BASE_TIMESTAMP,
    updated_at: overrides.updated_at ?? BASE_TIMESTAMP,
    tenant_id: overrides.tenant_id ?? "tenant-1",
    project_id: overrides.project_id ?? "project-1",
    version_number: overrides.version_number ?? 1,
    status: overrides.status ?? "draft",
    title: overrides.title ?? "Version",
    date_devis: overrides.date_devis ?? "2026-02-20",
    validite_jours: overrides.validite_jours ?? 30,
    margin_multiplier: overrides.margin_multiplier ?? 1,
    margin_mode: overrides.margin_mode ?? "fixed",
    currency: overrides.currency ?? "EUR",
    margin_bp: overrides.margin_bp ?? 0,
    discount_bp: overrides.discount_bp ?? 0,
    discount_mode: overrides.discount_mode ?? "simple",
    discount_steps: overrides.discount_steps ?? [],
    global_coefficient: overrides.global_coefficient ?? 1,
    tax_rate_bp: overrides.tax_rate_bp ?? 2000,
    rounding_mode: overrides.rounding_mode ?? "none",
    rounding_step_cents: overrides.rounding_step_cents ?? 1,
    total_ht_cents: totalHtCents,
    total_tax_cents:
      overrides.total_tax_cents ?? Math.max(totalTtcCents - totalHtCents, 0),
    total_ttc_cents: totalTtcCents,
    seal_hash: overrides.seal_hash ?? null,
    parent_version_id: overrides.parent_version_id ?? null,
    variant_label: overrides.variant_label ?? null,
  } as EstimateVersionRow;
}

function createSection(
  overrides: Partial<EstimateItemRow> &
    Pick<EstimateItemRow, "id" | "version_id" | "position" | "title">
): EstimateItemRow {
  return {
    id: overrides.id,
    created_at: overrides.created_at ?? BASE_TIMESTAMP,
    updated_at: overrides.updated_at ?? BASE_TIMESTAMP,
    tenant_id: overrides.tenant_id ?? "tenant-1",
    version_id: overrides.version_id,
    parent_id: overrides.parent_id ?? null,
    item_type: "section",
    position: overrides.position,
    title: overrides.title,
    description: overrides.description ?? null,
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
    selected_supplier_price_id: null,
    line_total_ht_cents: null,
    line_tax_cents: null,
    line_total_ttc_cents: null,
  };
}

function createLine(
  overrides: Partial<EstimateItemRow> &
    Pick<EstimateItemRow, "id" | "version_id" | "position" | "title">
): EstimateItemRow {
  return {
    id: overrides.id,
    created_at: overrides.created_at ?? BASE_TIMESTAMP,
    updated_at: overrides.updated_at ?? BASE_TIMESTAMP,
    tenant_id: overrides.tenant_id ?? "tenant-1",
    version_id: overrides.version_id,
    parent_id: overrides.parent_id ?? null,
    item_type: "line",
    position: overrides.position,
    title: overrides.title,
    description: overrides.description ?? null,
    quantity: overrides.quantity ?? 1,
    unit_price_ht_cents: overrides.unit_price_ht_cents ?? 100,
    tax_rate_bp: overrides.tax_rate_bp ?? 2000,
    k_fo: overrides.k_fo ?? 1,
    h_mo: overrides.h_mo ?? 0,
    h_mo_majoration: overrides.h_mo_majoration ?? 1,
    k_mo: overrides.k_mo ?? 1,
    h_mo_atelier: overrides.h_mo_atelier ?? null,
    k_mo_atelier: overrides.k_mo_atelier ?? null,
    labor_role_atelier_id: overrides.labor_role_atelier_id ?? null,
    h_mo_chantier: overrides.h_mo_chantier ?? null,
    k_mo_chantier: overrides.k_mo_chantier ?? null,
    labor_role_chantier_id: overrides.labor_role_chantier_id ?? null,
    pu_ht_cents: overrides.pu_ht_cents ?? 100,
    labor_role_id: overrides.labor_role_id ?? null,
    category_id: overrides.category_id ?? null,
    supply_type_id: overrides.supply_type_id ?? null,
    selected_supplier_price_id: overrides.selected_supplier_price_id ?? null,
    line_total_ht_cents: overrides.line_total_ht_cents ?? 100,
    line_tax_cents: overrides.line_tax_cents ?? 20,
    line_total_ttc_cents: overrides.line_total_ttc_cents ?? 120,
  };
}

function createDetails(input: {
  version: EstimateVersionRow;
  items: EstimateItemRow[];
}): EstimateVersionDetailsForDiff {
  return {
    version: input.version,
    items: input.items,
    labor_roles: [],
    categories: [],
    supply_types: [],
    margin_tiers: [],
  };
}

describe("estimate changelog", () => {
  it("groups changes by section and computes section/total deltas", () => {
    const previousSection = createSection({
      id: "prev-section-electricity",
      version_id: "version-prev",
      position: 1,
      title: "Electricite",
    });
    const previousLine = createLine({
      id: "prev-line-cable",
      version_id: "version-prev",
      parent_id: previousSection.id,
      position: 1,
      title: "Cable",
      quantity: 1,
      line_total_ht_cents: 100,
      line_tax_cents: 20,
      line_total_ttc_cents: 120,
    });

    const currentSection = createSection({
      id: "current-section-electricity",
      version_id: "version-current",
      position: 1,
      title: "Electricite",
    });
    const currentLineModified = createLine({
      id: "current-line-cable",
      version_id: "version-current",
      parent_id: currentSection.id,
      position: 1,
      title: "Cable",
      quantity: 2,
      line_total_ht_cents: 200,
      line_tax_cents: 40,
      line_total_ttc_cents: 240,
    });
    const currentLineAdded = createLine({
      id: "current-line-socket",
      version_id: "version-current",
      parent_id: currentSection.id,
      position: 2,
      title: "Prise",
      quantity: 1,
      line_total_ht_cents: 50,
      line_tax_cents: 10,
      line_total_ttc_cents: 60,
    });

    const changelog = buildEstimateChangelog({
      previous: createDetails({
        version: createVersion({
          id: "version-prev",
          version_number: 1,
          total_ht_cents: 1_000,
          total_ttc_cents: 1_200,
        }),
        items: [previousSection, previousLine],
      }),
      current: createDetails({
        version: createVersion({
          id: "version-current",
          version_number: 2,
          total_ht_cents: 1_150,
          total_ttc_cents: 1_380,
        }),
        items: [currentSection, currentLineModified, currentLineAdded],
      }),
    });

    expect(changelog.summary.deltaHtCents).toBe(150);
    expect(changelog.summary.deltaTtcCents).toBe(180);
    expect(changelog.summary.addedCount).toBe(1);
    expect(changelog.summary.modifiedCount).toBe(1);
    expect(changelog.summary.removedCount).toBe(0);

    const electricitySection = changelog.sections.find(
      (section) => section.label === "Electricite"
    );
    expect(electricitySection?.deltaHtCents).toBe(150);
    expect(electricitySection?.deltaTtcCents).toBe(180);
    expect(electricitySection?.changes).toHaveLength(2);

    const modifiedChange = electricitySection?.changes.find(
      (change) => change.changeType === "modified"
    );
    expect(modifiedChange).toBeDefined();
    expect(
      modifiedChange?.fields.some((field) => field.beforeValue !== field.afterValue)
    ).toBe(true);
  });

  it("includes before/after fields for removed lines", () => {
    const removedLine = createLine({
      id: "prev-line-removed",
      version_id: "version-prev",
      position: 1,
      title: "Tube cuivre",
      quantity: 4,
      unit_price_ht_cents: 90,
      line_total_ht_cents: 360,
      line_tax_cents: 72,
      line_total_ttc_cents: 432,
    });

    const changelog = buildEstimateChangelog({
      previous: createDetails({
        version: createVersion({
          id: "version-prev",
          total_ht_cents: 360,
          total_ttc_cents: 432,
        }),
        items: [removedLine],
      }),
      current: createDetails({
        version: createVersion({
          id: "version-current",
          version_number: 2,
          total_ht_cents: 0,
          total_ttc_cents: 0,
        }),
        items: [],
      }),
    });

    expect(changelog.summary.removedCount).toBe(1);
    const rootSection = changelog.sections.find((section) => section.label === "Racine");
    expect(rootSection).toBeDefined();

    const removedChange = rootSection?.changes[0];
    expect(removedChange?.changeType).toBe("removed");
    const designationField = removedChange?.fields.find(
      (field) => field.field === "title"
    );
    expect(designationField?.beforeValue).toBe("Tube cuivre");
    expect(designationField?.afterValue).toBeNull();
  });

  it("splits deltas between root section entry and nested section lines", () => {
    const addedSection = createSection({
      id: "section-plomberie",
      version_id: "version-current",
      position: 1,
      title: "Plomberie",
    });
    const addedLine = createLine({
      id: "line-vanne",
      version_id: "version-current",
      parent_id: addedSection.id,
      position: 1,
      title: "Vanne",
      line_total_ht_cents: 300,
      line_tax_cents: 60,
      line_total_ttc_cents: 360,
    });

    const changelog = buildEstimateChangelog({
      previous: createDetails({
        version: createVersion({
          id: "version-prev",
          total_ht_cents: 0,
          total_ttc_cents: 0,
        }),
        items: [],
      }),
      current: createDetails({
        version: createVersion({
          id: "version-current",
          version_number: 2,
          total_ht_cents: 300,
          total_ttc_cents: 360,
        }),
        items: [addedSection, addedLine],
      }),
    });

    const rootSection = changelog.sections.find((section) => section.label === "Racine");
    const plumbingSection = changelog.sections.find(
      (section) => section.label === "Plomberie"
    );

    expect(changelog.summary.addedCount).toBe(2);
    expect(rootSection?.deltaHtCents).toBe(0);
    expect(rootSection?.deltaTtcCents).toBe(0);
    expect(plumbingSection?.deltaHtCents).toBe(300);
    expect(plumbingSection?.deltaTtcCents).toBe(360);
  });
});
