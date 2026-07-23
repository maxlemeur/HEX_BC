import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyInterParentMoveOptimistically,
  buildEstimateItemInsertPayload,
  buildEstimateItemUpdatePayload,
  buildVersionTotalsPatch,
  createOptimisticLineItem,
  createOptimisticSectionItem,
  createTempEstimateItemId,
  hasLaborSplitFields,
  isPendingCreateEstimateItem,
  isTempEstimateItemId,
  readLaborSplitFields,
  resolveLaborRoleHourlyRate,
  type EstimateItem,
} from "@/lib/estimates/editor-items";

const FIXED_NOW = "2026-07-15T15:30:45.000Z";

function createItem(overrides: Partial<EstimateItem> = {}): EstimateItem {
  return {
    id: "line-1",
    created_at: "2026-07-01T08:00:00.000Z",
    updated_at: "2026-07-01T08:00:00.000Z",
    tenant_id: "tenant-1",
    version_id: "version-1",
    parent_id: "section-1",
    item_type: "line",
    position: 2,
    title: "Tube acier",
    aid: "A.1",
    description: "Fourniture et pose",
    quantity: 3,
    unit_price_ht_cents: 1250,
    tax_rate_bp: 2000,
    k_fo: 1.1,
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
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("estimate editor item payloads", () => {
  it("keeps section update and insert payloads intentionally minimal", () => {
    const section = createItem({
      id: "section-1",
      item_type: "section",
      parent_id: null,
      position: 1,
      title: "Lot plomberie",
      aid: null,
    });

    expect(buildEstimateItemUpdatePayload(section)).toEqual({
      title: "Lot plomberie",
      aid: null,
    });
    expect(
      buildEstimateItemInsertPayload("version-target", section, {
        parentId: "chapter-target",
        position: 4,
        title: "Lot plomberie copie",
      })
    ).toEqual({
      version_id: "version-target",
      parent_id: "chapter-target",
      item_type: "section",
      position: 4,
      title: "Lot plomberie copie",
      aid: null,
    });
  });

  it("persists only the canonical single-role labor fields", () => {
    const line = createItem();
    const updatePayload = buildEstimateItemUpdatePayload(line);

    expect(updatePayload).toEqual({
      title: "Tube acier",
      aid: "A.1",
      description: "Fourniture et pose",
      quantity: 3,
      unit_price_ht_cents: 1250,
      tax_rate_bp: 2000,
      k_fo: 1.1,
      h_mo: 2.5,
      h_mo_majoration: 1.2,
      k_mo: 1.05,
      pu_ht_cents: 5200,
      labor_role_id: "role-default",
      category_id: "category-1",
      supply_type_id: "supply-1",
      selected_supplier_price_id: "supplier-price-1",
      line_total_ht_cents: 15600,
      line_tax_cents: 3120,
      line_total_ttc_cents: 18720,
    });
    expect(updatePayload).not.toHaveProperty("labor_role_atelier_id");
    expect(updatePayload).not.toHaveProperty("labor_role_chantier_id");

    expect(
      buildEstimateItemInsertPayload("version-target", line, {
        parentId: null,
        position: 7,
      })
    ).toEqual({
      version_id: "version-target",
      parent_id: null,
      item_type: "line",
      position: 7,
      ...updatePayload,
    });
  });

  it("normalizes labor split fields and resolves scoped hourly-rate fallbacks", () => {
    expect(
      readLaborSplitFields({
        h_mo_atelier: Number.NaN,
        k_mo_atelier: 1.25,
        labor_role_atelier_id: "  atelier-role  ",
        h_mo_chantier: 2,
        k_mo_chantier: Number.POSITIVE_INFINITY,
        labor_role_chantier_id: "   ",
      })
    ).toEqual({
      h_mo_atelier: 0,
      k_mo_atelier: 1.25,
      labor_role_atelier_id: "atelier-role",
      h_mo_chantier: 2,
      k_mo_chantier: 1,
      labor_role_chantier_id: null,
    });

    expect(
      readLaborSplitFields({
        h_mo_atelier: 0,
        k_mo_atelier: 1,
        h_mo_chantier: 0,
        k_mo_chantier: 1,
      })
    ).toMatchObject({
      h_mo_atelier: null,
      h_mo_chantier: null,
    });

    expect(hasLaborSplitFields({ title: "legacy line" })).toBe(false);
    expect(hasLaborSplitFields({ h_mo_atelier: undefined })).toBe(true);

    const role = {
      hourly_rate_cents: 4200,
      hourly_rate_atelier_cents: 5100,
      hourly_rate_chantier_cents: Number.NaN,
    };
    expect(resolveLaborRoleHourlyRate(role, "default")).toBe(4200);
    expect(resolveLaborRoleHourlyRate(role, "atelier")).toBe(5100);
    expect(resolveLaborRoleHourlyRate(role, "chantier")).toBe(4200);
  });

  it("maps editor totals to the persisted version totals contract", () => {
    expect(buildVersionTotalsPatch(null)).toBeUndefined();
    expect(
      buildVersionTotalsPatch({
        saleTotalCents: 10000,
        adjustedTaxCents: 2000,
        roundedTtcCents: 12000,
      } as never)
    ).toEqual({
      total_ht_cents: 10000,
      total_tax_cents: 2000,
      total_ttc_cents: 12000,
    });
  });
});

describe("estimate editor optimistic items", () => {
  it("prefixes deterministic temporary ids and recognizes pending items", () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(
      "11111111-2222-4333-8444-555555555555"
    );

    const tempId = createTempEstimateItemId();
    expect(tempId).toBe("tmp:11111111-2222-4333-8444-555555555555");
    expect(isTempEstimateItemId(tempId)).toBe(true);
    expect(isTempEstimateItemId("item-1")).toBe(false);
    expect(
      isPendingCreateEstimateItem(
        createItem({ _pendingCreate: true } as Partial<EstimateItem>)
      )
    ).toBe(true);
  });

  it("creates a stable optimistic section shape", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));

    const section = createOptimisticSectionItem({
      tempId: "tmp:section",
      tenantId: "tenant-1",
      versionId: "version-1",
      parentId: null,
      position: 3,
      title: "Nouveau lot",
    });

    expect(section).toMatchObject({
      id: "tmp:section",
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
      tenant_id: "tenant-1",
      version_id: "version-1",
      parent_id: null,
      item_type: "section",
      position: 3,
      title: "Nouveau lot",
      quantity: null,
      h_mo_majoration: 1,
      source_metadata: {},
      _optimistic: true,
      _pendingCreate: true,
      _tempId: "tmp:section",
    });
  });

  it("never initializes deprecated labor split values", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(FIXED_NOW));

    const createLine = (isLaborSplitEnabled: boolean) =>
      createOptimisticLineItem({
        tempId: isLaborSplitEnabled ? "tmp:split" : "tmp:standard",
        tenantId: "tenant-1",
        versionId: "version-1",
        parentId: "section-1",
        position: 2,
        title: "Nouvelle ligne",
        quantity: 1,
        taxRateBp: 2000,
        puHtCents: 1000,
        lineTotalHtCents: 1000,
        lineTaxCents: 200,
        lineTotalTtcCents: 1200,
        isLaborSplitEnabled,
      });

    expect(createLine(true)).toMatchObject({
      created_at: FIXED_NOW,
      updated_at: FIXED_NOW,
      h_mo_atelier: null,
      k_mo_atelier: null,
      h_mo_chantier: null,
      k_mo_chantier: null,
      _optimistic: true,
      _pendingCreate: true,
    });
    expect(createLine(false)).toMatchObject({
      h_mo_atelier: null,
      k_mo_atelier: null,
      h_mo_chantier: null,
      k_mo_chantier: null,
    });
  });
});

describe("estimate editor inter-parent moves", () => {
  it("reparents the moved item and reindexes both sibling groups immutably", () => {
    const sourceFirst = createItem({
      id: "source-first",
      parent_id: "source-parent",
      position: 1,
    });
    const moved = createItem({
      id: "moved",
      parent_id: "source-parent",
      position: 2,
    });
    const targetFirst = createItem({
      id: "target-first",
      parent_id: "target-parent",
      position: 1,
    });
    const targetLast = createItem({
      id: "target-last",
      parent_id: "target-parent",
      position: 2,
    });
    const unrelated = createItem({
      id: "unrelated",
      parent_id: "unrelated-parent",
      position: 9,
    });
    const items = [sourceFirst, moved, targetFirst, targetLast, unrelated];

    const result = applyInterParentMoveOptimistically(items, {
      itemId: "moved",
      fromParentId: "source-parent",
      toParentId: "target-parent",
      orderedSourceIds: ["source-first"],
      orderedTargetIds: ["target-first", "moved", "target-last"],
    });

    expect(result.map(({ id, parent_id, position }) => ({ id, parent_id, position })))
      .toEqual([
        { id: "source-first", parent_id: "source-parent", position: 1 },
        { id: "moved", parent_id: "target-parent", position: 2 },
        { id: "target-first", parent_id: "target-parent", position: 1 },
        { id: "target-last", parent_id: "target-parent", position: 3 },
        { id: "unrelated", parent_id: "unrelated-parent", position: 9 },
      ]);
    expect(items[1]).toBe(moved);
    expect(result[1]).not.toBe(moved);
    expect(result[4]).toBe(unrelated);
  });
});
