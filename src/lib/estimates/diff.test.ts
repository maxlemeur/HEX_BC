import { describe, expect, it } from "vitest";

import {
  buildEstimateDiff,
  type EstimateVersionDetailsForDiff,
} from "@/lib/estimates/diff";
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
    source_provider: overrides.source_provider ?? null,
    source_job_id: overrides.source_job_id ?? null,
    source_file_name: overrides.source_file_name ?? null,
    source_page: overrides.source_page ?? null,
    source_metadata: overrides.source_metadata ?? {},
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
    source_provider: overrides.source_provider ?? null,
    source_job_id: overrides.source_job_id ?? null,
    source_file_name: overrides.source_file_name ?? null,
    source_page: overrides.source_page ?? null,
    source_metadata: overrides.source_metadata ?? {},
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

describe("estimate diff", () => {
  it("uses persisted version totals in summary deltas", () => {
    const previous = createDetails({
      version: createVersion({
        id: "version-prev",
        version_number: 1,
        total_ht_cents: 123_456,
        total_ttc_cents: 145_678,
      }),
      items: [
        createLine({
          id: "prev-line-1",
          version_id: "version-prev",
          position: 1,
          title: "Line A",
          quantity: 42,
          unit_price_ht_cents: 9_999,
          line_total_ht_cents: 419_958,
          line_total_ttc_cents: 503_950,
        }),
      ],
    });

    const current = createDetails({
      version: createVersion({
        id: "version-current",
        version_number: 2,
        total_ht_cents: 124_999,
        total_ttc_cents: 149_999,
      }),
      items: [
        createLine({
          id: "current-line-1",
          version_id: "version-current",
          position: 1,
          title: "Line A",
          quantity: 1,
          unit_price_ht_cents: 1,
          line_total_ht_cents: 1,
          line_total_ttc_cents: 1,
        }),
      ],
    });

    const diff = buildEstimateDiff({ previous, current });

    expect(diff.summary.previousTotals).toEqual({
      totalHtCents: 123_456,
      totalTtcCents: 145_678,
    });
    expect(diff.summary.currentTotals).toEqual({
      totalHtCents: 124_999,
      totalTtcCents: 149_999,
    });
    expect(diff.summary.deltaHtCents).toBe(1_543);
    expect(diff.summary.deltaTtcCents).toBe(4_321);
  });

  it("matches renamed lines as a modification instead of add/remove", () => {
    const previous = createDetails({
      version: createVersion({
        id: "version-prev",
        version_number: 1,
        total_ht_cents: 1_000,
        total_ttc_cents: 1_200,
      }),
      items: [
        createLine({
          id: "prev-line-rename",
          version_id: "version-prev",
          position: 1,
          title: "Old label",
        }),
      ],
    });

    const current = createDetails({
      version: createVersion({
        id: "version-current",
        version_number: 2,
        total_ht_cents: 1_000,
        total_ttc_cents: 1_200,
      }),
      items: [
        createLine({
          id: "current-line-rename",
          version_id: "version-current",
          position: 1,
          title: "New label",
        }),
      ],
    });

    const diff = buildEstimateDiff({ previous, current });

    expect(diff.summary.addedCount).toBe(0);
    expect(diff.summary.removedCount).toBe(0);
    expect(diff.summary.modifiedCount).toBe(1);

    expect(diff.entries).toHaveLength(1);
    expect(diff.entries[0]?.changeType).toBe("modified");
    expect(diff.entries[0]?.fieldChanges.map((change) => change.field)).toContain(
      "title"
    );
  });

  it("does not cascade add/remove on duplicate titles when one new line is inserted", () => {
    const previousSection = createSection({
      id: "prev-section-1",
      version_id: "version-prev",
      position: 1,
      title: "Electricity",
    });
    const previousLineA = createLine({
      id: "prev-line-a",
      version_id: "version-prev",
      parent_id: previousSection.id,
      position: 1,
      title: "Cable",
      quantity: 1,
      unit_price_ht_cents: 100,
      pu_ht_cents: 100,
      line_total_ht_cents: 100,
      line_tax_cents: 20,
      line_total_ttc_cents: 120,
    });
    const previousLineB = createLine({
      id: "prev-line-b",
      version_id: "version-prev",
      parent_id: previousSection.id,
      position: 2,
      title: "Cable",
      quantity: 2,
      unit_price_ht_cents: 200,
      pu_ht_cents: 200,
      line_total_ht_cents: 400,
      line_tax_cents: 80,
      line_total_ttc_cents: 480,
    });

    const currentSection = createSection({
      id: "current-section-1",
      version_id: "version-current",
      position: 1,
      title: "Electricity",
    });
    const insertedLine = createLine({
      id: "current-line-inserted",
      version_id: "version-current",
      parent_id: currentSection.id,
      position: 1,
      title: "Cable",
      description: "Inserted",
      quantity: 9,
      unit_price_ht_cents: 999,
      tax_rate_bp: 5500,
      k_fo: 3,
      h_mo: 5,
      h_mo_majoration: 2,
      k_mo: 4,
      h_mo_atelier: 1,
      k_mo_atelier: 1,
      labor_role_atelier_id: "role-atelier",
      h_mo_chantier: 2,
      k_mo_chantier: 2,
      labor_role_chantier_id: "role-chantier",
      pu_ht_cents: 500,
      labor_role_id: "role-main",
      category_id: "category-1",
      supply_type_id: "supply-1",
      line_total_ht_cents: 4_500,
      line_tax_cents: 2_475,
      line_total_ttc_cents: 6_975,
    });
    const currentLineA = createLine({
      id: "current-line-a",
      version_id: "version-current",
      parent_id: currentSection.id,
      position: 2,
      title: "Cable",
      quantity: 1,
      unit_price_ht_cents: 100,
      pu_ht_cents: 100,
      line_total_ht_cents: 100,
      line_tax_cents: 20,
      line_total_ttc_cents: 120,
    });
    const currentLineB = createLine({
      id: "current-line-b",
      version_id: "version-current",
      parent_id: currentSection.id,
      position: 3,
      title: "Cable",
      quantity: 2,
      unit_price_ht_cents: 200,
      pu_ht_cents: 200,
      line_total_ht_cents: 400,
      line_tax_cents: 80,
      line_total_ttc_cents: 480,
    });

    const previous = createDetails({
      version: createVersion({
        id: "version-prev",
        version_number: 1,
        total_ht_cents: 500,
        total_ttc_cents: 600,
      }),
      items: [previousSection, previousLineA, previousLineB],
    });

    const current = createDetails({
      version: createVersion({
        id: "version-current",
        version_number: 2,
        total_ht_cents: 5_000,
        total_ttc_cents: 7_000,
      }),
      items: [currentSection, insertedLine, currentLineA, currentLineB],
    });

    const diff = buildEstimateDiff({ previous, current });

    expect(diff.summary.addedCount).toBe(1);
    expect(diff.summary.removedCount).toBe(0);
    expect(diff.summary.modifiedCount).toBe(0);
    expect(diff.entries).toHaveLength(1);
    expect(diff.entries[0]?.changeType).toBe("added");
    expect(diff.entries[0]?.afterItem?.id).toBe("current-line-inserted");
  });

  it("returns 0 entries when versions are identical", () => {
    const section = createSection({
      id: "section-1",
      version_id: "version-prev",
      position: 1,
      title: "Electricite",
    });
    const line = createLine({
      id: "line-1",
      version_id: "version-prev",
      parent_id: section.id,
      position: 1,
      title: "Cable",
      quantity: 2,
      unit_price_ht_cents: 500,
      line_total_ht_cents: 1_000,
      line_total_ttc_cents: 1_200,
    });

    const sectionCopy = createSection({
      id: "section-1-copy",
      version_id: "version-current",
      position: 1,
      title: "Electricite",
    });
    const lineCopy = createLine({
      id: "line-1-copy",
      version_id: "version-current",
      parent_id: sectionCopy.id,
      position: 1,
      title: "Cable",
      quantity: 2,
      unit_price_ht_cents: 500,
      line_total_ht_cents: 1_000,
      line_total_ttc_cents: 1_200,
    });

    const diff = buildEstimateDiff({
      previous: createDetails({
        version: createVersion({
          id: "version-prev",
          version_number: 1,
          total_ht_cents: 1_000,
          total_ttc_cents: 1_200,
        }),
        items: [section, line],
      }),
      current: createDetails({
        version: createVersion({
          id: "version-current",
          version_number: 2,
          total_ht_cents: 1_000,
          total_ttc_cents: 1_200,
        }),
        items: [sectionCopy, lineCopy],
      }),
    });

    expect(diff.entries).toHaveLength(0);
    expect(diff.summary.addedCount).toBe(0);
    expect(diff.summary.removedCount).toBe(0);
    expect(diff.summary.modifiedCount).toBe(0);
    expect(diff.summary.deltaHtCents).toBe(0);
    expect(diff.summary.deltaTtcCents).toBe(0);
  });

  it("returns 0 entries when both versions have 0 items", () => {
    const diff = buildEstimateDiff({
      previous: createDetails({
        version: createVersion({
          id: "version-prev",
          version_number: 1,
          total_ht_cents: 0,
          total_ttc_cents: 0,
        }),
        items: [],
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

    expect(diff.entries).toHaveLength(0);
    expect(diff.summary.addedCount).toBe(0);
    expect(diff.summary.removedCount).toBe(0);
    expect(diff.summary.modifiedCount).toBe(0);
  });

  it("handles mixed section and line changes at the same level", () => {
    const prevSection = createSection({
      id: "prev-section",
      version_id: "version-prev",
      position: 1,
      title: "Section A",
    });
    const prevLine = createLine({
      id: "prev-root-line",
      version_id: "version-prev",
      position: 2,
      title: "Root line",
      line_total_ht_cents: 100,
      line_total_ttc_cents: 120,
    });

    const curSection = createSection({
      id: "cur-section",
      version_id: "version-current",
      position: 1,
      title: "Section A modified",
    });
    const curLine = createLine({
      id: "cur-root-line",
      version_id: "version-current",
      position: 2,
      title: "Root line",
      quantity: 5,
      line_total_ht_cents: 500,
      line_total_ttc_cents: 600,
    });

    const diff = buildEstimateDiff({
      previous: createDetails({
        version: createVersion({
          id: "version-prev",
          version_number: 1,
          total_ht_cents: 100,
          total_ttc_cents: 120,
        }),
        items: [prevSection, prevLine],
      }),
      current: createDetails({
        version: createVersion({
          id: "version-current",
          version_number: 2,
          total_ht_cents: 500,
          total_ttc_cents: 600,
        }),
        items: [curSection, curLine],
      }),
    });

    expect(diff.summary.modifiedCount).toBe(2);
    const entityTypes = diff.entries.map((e) => e.entityType);
    expect(entityTypes).toContain("section");
    expect(entityTypes).toContain("line");
  });

  it("matches renamed sections and still compares their children", () => {
    const previousSection = createSection({
      id: "prev-section",
      version_id: "version-prev",
      position: 1,
      title: "Phase 1",
    });
    const previousLine = createLine({
      id: "prev-line",
      version_id: "version-prev",
      parent_id: previousSection.id,
      position: 1,
      title: "Socket",
    });

    const currentSection = createSection({
      id: "current-section",
      version_id: "version-current",
      position: 1,
      title: "Phase A",
    });
    const currentLine = createLine({
      id: "current-line",
      version_id: "version-current",
      parent_id: currentSection.id,
      position: 1,
      title: "Socket",
    });

    const previous = createDetails({
      version: createVersion({
        id: "version-prev",
        version_number: 1,
        total_ht_cents: 100,
        total_ttc_cents: 120,
      }),
      items: [previousSection, previousLine],
    });
    const current = createDetails({
      version: createVersion({
        id: "version-current",
        version_number: 2,
        total_ht_cents: 100,
        total_ttc_cents: 120,
      }),
      items: [currentSection, currentLine],
    });

    const diff = buildEstimateDiff({ previous, current });

    expect(diff.summary.addedCount).toBe(0);
    expect(diff.summary.removedCount).toBe(0);
    expect(diff.summary.modifiedCount).toBe(1);
    expect(diff.entries[0]?.entityType).toBe("section");
    expect(diff.entries[0]?.fieldChanges.map((change) => change.field)).toContain(
      "title"
    );
  });
});
