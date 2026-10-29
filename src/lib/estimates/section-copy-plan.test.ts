import { describe, expect, it } from "vitest";

import {
  buildImportedSubtreePayload,
  collectSectionSubtreeItems,
  prepareSectionsImport,
  selectSectionImportSubtrees,
} from "@/lib/estimates/section-copy-plan";
import type { EstimateItemRow } from "@/lib/estimates/version-read-server";

function item(overrides: Partial<EstimateItemRow>): EstimateItemRow {
  return {
    id: "line", tenant_id: "source-tenant", version_id: "source-version",
    created_at: "2026-10-28T09:00:00.000Z", updated_at: "2026-10-28T09:00:00.000Z",
    parent_id: "section", item_type: "line", position: 1, title: "Tube acier", aid: "A.1",
    description: "ml", line_nature: "supply_and_labor",
    quantity: 2, unit_price_ht_cents: 1000, tax_rate_bp: 2000, k_fo: 1.1,
    h_mo: 1, h_mo_majoration: 1.2, k_mo: 1.3, labor_role_id: "role",
    h_mo_atelier: 0.5, k_mo_atelier: 1.1, labor_role_atelier_id: "workshop-role",
    h_mo_chantier: 0.5, k_mo_chantier: 1.2, labor_role_chantier_id: "site-role",
    category_id: "category", supply_type_id: "supply", product_id: "product",
    selected_supplier_price_id: "price", pu_ht_cents: 4500,
    line_total_ht_cents: 9000, line_tax_cents: 1800, line_total_ttc_cents: 10800,
    source_provider: "takeoff", source_job_id: "job", source_file_name: "lot.pdf",
    source_page: 4, source_metadata: { extraction: "measured" },
    unit_code: null, pricing_status: "priced", fo_provision: 1,
    h_mo_per_unit: null, h_mo_atelier_per_unit: null, h_mo_chantier_per_unit: null,
    snapshot_fo_ht_cents: null, snapshot_gross_fo_ht_cents: null,
    snapshot_gross_ht_cents: null, snapshot_mo_atelier_ht_cents: null,
    snapshot_mo_chantier_ht_cents: null, snapshot_mo_ht_cents: null,
    snapshot_pu_ht_cents: null,
    ...overrides,
  };
}

function hierarchy() {
  return [
    item({ id: "section", item_type: "section", title: "Plomberie", parent_id: null, position: 1 }),
    item({ id: "subsection", item_type: "section", title: "Tubes", parent_id: "section", position: 2 }),
    item({ id: "line", parent_id: "subsection", position: 4 }),
    item({ id: "direct-line", parent_id: "section", position: 5, title: "Vanne" }),
    item({ id: "other", item_type: "section", title: "Chauffage", parent_id: null, position: 9 }),
  ];
}

function idsFor(subtrees: ReturnType<typeof selectSectionImportSubtrees>) {
  return subtrees.map((subtree, index) => new Map(
    subtree.orderedSubtreeItems.map((row) => [row.id, `copy-${index}-${row.id}`])
  ));
}

describe("section copy selection and hierarchy", () => {
  it("does not import a selected descendant twice when its ancestor is also selected", () => {
    expect(selectSectionImportSubtrees(hierarchy(), ["subsection", "section", "other"])
      .map((subtree) => subtree.rootSection.id)).toEqual(["section", "other"]);
  });

  it("remaps hierarchy and ownership while preserving priced values and provenance", () => {
    const subtree = collectSectionSubtreeItems("section", hierarchy())!;
    const identities = new Map(subtree.orderedSubtreeItems.map((row) => [row.id, `copy-${row.id}`]));
    const before = structuredClone(subtree);
    const copied = buildImportedSubtreePayload({
      subtree, tenantId: "target-tenant", targetVersionId: "target-version",
      rootPosition: 12, rootTitle: "Plomberie (copie)", newIdBySourceId: identities,
    });
    expect(copied.items.map((row) => [row.id, row.parent_id, row.position])).toEqual([
      ["copy-section", null, 12], ["copy-subsection", "copy-section", 2],
      ["copy-line", "copy-subsection", 4], ["copy-direct-line", "copy-section", 5],
    ]);
    expect(copied.items.every((row) => row.tenant_id === "target-tenant" && row.version_id === "target-version")).toBe(true);
    expect(copied.items[2]).toMatchObject({
      title: "Tube acier", aid: "A.1", description: "ml", quantity: 2,
      unit_price_ht_cents: 1000, pu_ht_cents: 4500, tax_rate_bp: 2000,
      line_total_ht_cents: 9000, line_tax_cents: 1800, line_total_ttc_cents: 10800,
      k_fo: 1.1, h_mo: 1, h_mo_majoration: 1.2, k_mo: 1.3,
      h_mo_atelier: 0.5, k_mo_atelier: 1.1, labor_role_atelier_id: "workshop-role",
      h_mo_chantier: 0.5, k_mo_chantier: 1.2, labor_role_chantier_id: "site-role",
      selected_supplier_price_id: "price", source_provider: "takeoff", source_job_id: "job",
      source_file_name: "lot.pdf", source_page: 4, source_metadata: { extraction: "measured" },
    });
    expect(copied.created_section_ids).toEqual(["copy-section", "copy-subsection"]);
    expect(copied.created_line_ids).toEqual(["copy-line", "copy-direct-line"]);
    expect(copied.line_count).toBe(2);
    expect(subtree).toEqual(before);
    expect([...identities]).toEqual(before.orderedSubtreeItems.map((row) => [row.id, `copy-${row.id}`]));
  });
});

describe("append and merge preparation", () => {
  it("keeps hierarchy when merge has no matching target root", () => {
    const subtrees = selectSectionImportSubtrees(hierarchy(), ["section"]);
    const result = prepareSectionsImport({ subtrees, targetItems: [], mode: "merge", tenantId: "tenant", targetVersionId: "target", newIdsBySubtree: idsFor(subtrees) });
    expect(result.items[0]).toMatchObject({ id: "copy-0-section", title: "Plomberie", parent_id: null, position: 1 });
    expect(result.items[2].parent_id).toBe("copy-0-subsection");
    expect(result.createdSectionIds).toEqual(["copy-0-section", "copy-0-subsection"]);
  });
});
