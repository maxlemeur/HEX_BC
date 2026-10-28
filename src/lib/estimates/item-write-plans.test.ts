import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/estimates/errors";
import { prepareEstimateItemCreation } from "@/lib/estimates/item-create-plan";
import {
  assertEstimateMovePermutation,
  assertEstimateReorderPermutation,
  collectEstimateSubtreeIds,
} from "@/lib/estimates/item-structure-plan";
import {
  calculateEstimateLineUpdate,
  prepareEstimateLineUpdate,
  prepareEstimateSectionUpdate,
} from "@/lib/estimates/item-update-plan";
import type { CreateEstimateItemInput, UpdateEstimateItemInput } from "@/lib/estimates/schemas";
import type { EstimateItemRow } from "@/lib/estimates/version-read-server";

const AID_REGEX = /^[A-Z]\.\d+$/;

function item(overrides: Partial<EstimateItemRow> = {}): EstimateItemRow {
  return {
    id: "line", tenant_id: "tenant", version_id: "version",
    created_at: "2026-10-28T09:00:00.000Z", updated_at: "2026-10-28T09:00:00.000Z",
    parent_id: "lot", item_type: "line", position: 2, title: "Tube acier", aid: "A.1",
    description: "Fourniture et pose", line_nature: "supply_and_labor",
    quantity: 2, unit_price_ht_cents: 1000, tax_rate_bp: 2000, k_fo: 1,
    h_mo: 1, h_mo_majoration: 1, k_mo: 1, labor_role_id: "role",
    h_mo_atelier: null, k_mo_atelier: null, labor_role_atelier_id: null,
    h_mo_chantier: null, k_mo_chantier: null, labor_role_chantier_id: null,
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

function creation(input: CreateEstimateItemInput,
  overrides: Partial<Omit<Parameters<typeof prepareEstimateItemCreation>[0], "input">> = {}) {
  return prepareEstimateItemCreation({
    input, id: "new-item", parentId: "lot", position: 3, aid: null,
    parentSectionLevel: 1, maxSectionDepth: 3, versionTaxRateBp: 550,
    ...overrides,
  });
}

function lineUpdate(input: UpdateEstimateItemInput, currentItem = item(), versionTaxRateBp: number | null = 550) {
  return prepareEstimateLineUpdate({ input, currentItem, versionTaxRateBp, aidRegex: AID_REGEX });
}

function publicError(action: () => unknown) {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return error as ApiError;
  }
  throw new Error("Expected an estimate API error");
}

describe("estimate item creation plans", () => {
  it("starts an unlinked manual line with neutral costs and the version tax", () => {
    const result = creation({ item_type: "line", product_id: null });
    expect(result).toMatchObject({
      id: "new-item", parent_id: "lot", position: 3, item_type: "line",
      title: "Nouvelle ligne", line_nature: "supply_only", quantity: 1,
      unit_price_ht_cents: 0, tax_rate_bp: 550, k_fo: 1, h_mo: 0,
      h_mo_majoration: 1, k_mo: 1, description: null,
      h_mo_atelier: null, k_mo_atelier: null, labor_role_atelier_id: null,
      h_mo_chantier: null, k_mo_chantier: null, labor_role_chantier_id: null,
      source_provider: "manual", source_job_id: null, source_file_name: null, source_page: null,
    });
    expect(result).not.toHaveProperty("product_id");
    expect(result).not.toHaveProperty("unit_code");
    expect(result).not.toHaveProperty("h_mo_per_unit");
  });

  it("keeps explicit zeros, a linked product and all supplied v3 fields", () => {
    const result = creation({
      item_type: "line", quantity: 0, unit_price_ht_cents: 0, tax_rate_bp: 0,
      k_fo: 0, h_mo: 0, h_mo_majoration: 0, k_mo: 0, product_id: "product",
      unit_code: "ml", pricing_status: "not_priced", h_mo_per_unit: 0,
      h_mo_atelier_per_unit: null, h_mo_chantier_per_unit: 0.25,
      source_provider: " takeoff ", source_job_id: "job",
      source_file_name: " lot.pdf ", source_page: 4, description: "  Coupe  ",
    });
    expect(result).toMatchObject({
      quantity: 0, unit_price_ht_cents: 0, tax_rate_bp: 0,
      k_fo: 0, h_mo: 0, h_mo_majoration: 0, k_mo: 0, product_id: "product",
      unit_code: "ml", pricing_status: "not_priced", h_mo_per_unit: 0,
      h_mo_atelier_per_unit: null, h_mo_chantier_per_unit: 0.25,
      source_provider: "takeoff", source_job_id: "job",
      source_file_name: "lot.pdf", source_page: 4, description: "Coupe",
    });
  });

  it("uses the standard tax when neither the line nor version supplies one", () => {
    expect(creation({ item_type: "line" }, { versionTaxRateBp: null }).tax_rate_bp).toBe(2000);
  });

  it("creates a structural section retaining its source without adding pricing fields", () => {
    const result = creation({
      item_type: "section", title: "Lot plomberie", source_provider: "takeoff",
      source_job_id: "job", source_file_name: "lot.pdf", source_page: 4,
    }, { parentId: null, parentSectionLevel: null });
    expect(result).toEqual({
      id: "new-item", parent_id: null, item_type: "section", position: 3,
      title: "Lot plomberie", aid: null, source_provider: "takeoff",
      source_job_id: "job", source_file_name: "lot.pdf", source_page: 4,
    });
  });

  it.each([
    { input: { item_type: "line" } as const, parentSectionLevel: null, message: "Une ligne doit être ajoutée sous une section." },
    { input: { item_type: "line" } as const, parentSectionLevel: 4, message: "Une ligne ne peut pas être rattachee au-dela du niveau 3." },
    { input: { item_type: "section" } as const, parentSectionLevel: 3, message: "Impossible de créer ce niveau: profondeur max 3." },
  ])("rejects invalid $input.item_type placement at parent depth $parentSectionLevel", ({ input, parentSectionLevel, message }) => {
    expect(publicError(() => creation(input, { parentSectionLevel }))).toMatchObject({
      status: 400, code: "BAD_REQUEST", message,
    });
  });
});

describe("estimate section update plans", () => {
  it("changes only explicitly supplied structural fields", () => {
    expect(prepareEstimateSectionUpdate({
      input: { id: "section", title: "Lot corrigé", parent_id: null, aid: "  A.2  " },
      aidRegex: AID_REGEX, convertingLineToSection: false,
    })).toEqual({ title: "Lot corrigé", parent_id: null, aid: "A.2" });
  });

  it("clears every historical line field on conversion while preserving identity and provenance", () => {
    const original = item({
      h_mo_atelier: 1, k_mo_atelier: 1.2, labor_role_atelier_id: "atelier",
      h_mo_chantier: 2, k_mo_chantier: 1.3, labor_role_chantier_id: "chantier",
    });
    const patch = prepareEstimateSectionUpdate({
      input: { id: original.id, item_type: "section" },
      aidRegex: AID_REGEX, convertingLineToSection: true,
    });
    const converted = { ...original, ...patch };
    expect(converted).toMatchObject({
      id: "line", item_type: "section", parent_id: "lot", position: 2, title: "Tube acier", aid: "A.1",
      line_nature: null, description: null, quantity: null, unit_price_ht_cents: null,
      tax_rate_bp: null, k_fo: null, h_mo: null, h_mo_majoration: null, k_mo: null,
      h_mo_atelier: null, k_mo_atelier: null, labor_role_atelier_id: null,
      h_mo_chantier: null, k_mo_chantier: null, labor_role_chantier_id: null,
      pu_ht_cents: null, labor_role_id: null, category_id: null, supply_type_id: null,
      product_id: null, selected_supplier_price_id: null,
      line_total_ht_cents: null, line_tax_cents: null, line_total_ttc_cents: null,
      source_provider: "takeoff", source_job_id: "job", source_file_name: "lot.pdf",
      source_page: 4, source_metadata: { extraction: "measured" },
    });
    expect(original.item_type).toBe("line");
    expect(original.quantity).toBe(2);
  });

  it.each([{ quantity: 0 }, { description: null }, { labor_role_atelier_id: null }, { product_id: null }])(
    "rejects a supplied line-only field even if it is empty: %j", (lineFields) => {
      expect(publicError(() => prepareEstimateSectionUpdate({
        input: { id: "section", ...lineFields }, aidRegex: AID_REGEX, convertingLineToSection: false,
      }))).toMatchObject({ status: 400, code: "BAD_REQUEST", message: "Les champs de ligne ne sont pas autorises pour une section." });
    },
  );
});

describe("estimate historical line update plans", () => {
  it("keeps omitted values, applies explicit nulls and preserves zero", () => {
    const original = item({ h_mo_atelier: 2, k_mo_atelier: 1.5, labor_role_atelier_id: "atelier" });
    const result = lineUpdate({
      id: original.id, description: "  ", quantity: 0, unit_price_ht_cents: 0,
      tax_rate_bp: 0, k_fo: 0, h_mo: 0, h_mo_majoration: 0, k_mo: 0,
      parent_id: null, product_id: null, h_mo_atelier: null, labor_role_atelier_id: null,
    }, original);
    expect(result.fields).toMatchObject({
      title: "Tube acier", position: 2, aid: "A.1", category_id: "category",
      supply_type_id: "supply", selected_supplier_price_id: "price", labor_role_id: "role",
      k_mo_atelier: 1.5, description: null, quantity: 0, unit_price_ht_cents: 0,
      tax_rate_bp: 0, k_fo: 0, h_mo: 0, h_mo_majoration: 0, k_mo: 0,
      parent_id: null, product_id: null, h_mo_atelier: null, labor_role_atelier_id: null,
    });
    expect(result.previousUnitPriceHtCents).toBe(4500);
    expect(original).toMatchObject({ quantity: 2, product_id: "product", h_mo_atelier: 2 });
  });

  it("converts a historical section to a fresh supply line while keeping its source and placement", () => {
    const original = item({ item_type: "section", quantity: null, tax_rate_bp: null });
    const prepared = lineUpdate({ id: original.id, item_type: "line" }, original);
    const converted = { ...original, ...prepared.fields };
    expect(converted).toMatchObject({
      item_type: "line", line_nature: "supply_only", parent_id: "lot", position: 2,
      title: "Tube acier", aid: "A.1", description: null, quantity: 1,
      unit_price_ht_cents: 0, tax_rate_bp: 550, k_fo: 1, h_mo: 0, h_mo_majoration: 1, k_mo: 1,
      labor_role_id: null, category_id: null, supply_type_id: null,
      product_id: null, selected_supplier_price_id: null,
      h_mo_atelier: null, k_mo_atelier: null, labor_role_atelier_id: null,
      h_mo_chantier: null, k_mo_chantier: null, labor_role_chantier_id: null,
      source_provider: "takeoff", source_job_id: "job", source_file_name: "lot.pdf",
      source_page: 4, source_metadata: { extraction: "measured" },
    });
    expect(prepared.previousUnitPriceHtCents).toBe(0);
  });

  it("promotes a supply line when labor is added, but respects a manual nature", () => {
    const supply = item({ line_nature: "supply_only", h_mo: 0, labor_role_id: null });
    expect(lineUpdate({ id: supply.id, h_mo: 1 }, supply).fields.line_nature).toBe("supply_and_labor");
    expect(lineUpdate({ id: supply.id, h_mo: 1, line_nature: "supply_only" }, supply).fields.line_nature).toBe("supply_only");
    expect(lineUpdate({ id: "line", h_mo: 0, labor_role_id: null }).fields.line_nature).toBe("supply_and_labor");
  });

  it("does not repair an inconsistent historical nature during a title edit", () => {
    const legacy = item({ line_nature: "supply_only", h_mo: 2 });
    expect(lineUpdate({ id: legacy.id, title: "Titre corrigé" }, legacy).fields.line_nature).toBe("supply_only");
  });

  it("normalizes an old AID on unrelated edits and validates only replacements", () => {
    const legacy = item({ aid: "historical id" });
    expect(lineUpdate({ id: legacy.id, title: "Titre corrigé" }, legacy).fields.aid).toBe("HISTORICAL ID");
    expect(lineUpdate({ id: legacy.id, aid: null }, legacy).fields.aid).toBeNull();
    expect(publicError(() => lineUpdate({ id: legacy.id, aid: "invalid" }, legacy))).toMatchObject({
      status: 400, code: "BAD_REQUEST",
    });
  });

  it.each([
    { name: "one legacy hour at 40 euros", overrides: {}, legacyRate: 4000 },
    { name: "half a workshop hour at 20 euros and one site hour at 30 euros", overrides: {
      h_mo: 100, h_mo_atelier: 0.5, k_mo_atelier: 1, labor_role_atelier_id: "atelier",
      h_mo_chantier: 1, k_mo_chantier: 1, labor_role_chantier_id: "chantier",
    }, legacyRate: 9999 },
  ])("prices two 10-euro units plus $name at margin 1.5 and VAT 20%", ({ overrides, legacyRate }) => {
    const preparedLine = lineUpdate({ id: "line" }, item(overrides));
    expect(calculateEstimateLineUpdate({
      preparedLine, marginMultiplier: 1.5, laborRateLegacyCents: legacyRate,
      laborRateAtelierCents: 2000, laborRateChantierCents: 3000,
    })).toMatchObject({ pu_ht_cents: 4500, line_total_ht_cents: 9000, line_tax_cents: 1800, line_total_ttc_cents: 10800 });
  });
});

describe("estimate subtree deletion plans", () => {
  it("returns the complete selected subtree once without siblings or unrelated roots", () => {
    const rows = Object.freeze([
      { id: "other-root", parent_id: null }, { id: "selected", parent_id: null },
      { id: "first-child", parent_id: "selected" }, { id: "second-child", parent_id: "selected" },
      { id: "grandchild", parent_id: "first-child" }, { id: "unrelated", parent_id: "other-root" },
    ]);
    expect(collectEstimateSubtreeIds("selected", rows)).toEqual(["selected", "second-child", "first-child", "grandchild"]);
    expect(collectEstimateSubtreeIds("grandchild", rows)).toEqual(["grandchild"]);
  });

  it("terminates and includes each id once even when historical rows contain a cycle or duplicate", () => {
    expect(collectEstimateSubtreeIds("a", [
      { id: "a", parent_id: "b" }, { id: "b", parent_id: "a" },
      { id: "b", parent_id: "a" }, { id: "other", parent_id: null },
    ])).toEqual(["a", "b"]);
  });

  it("rejects a missing root even when an orphan refers to that id", () => {
    expect(publicError(() => collectEstimateSubtreeIds("missing", [{ id: "orphan", parent_id: "missing" }]))).toMatchObject({
      status: 404, code: "NOT_FOUND", message: "Élément de chiffrage introuvable.",
    });
  });
});

describe("estimate sibling permutation plans", () => {
  it("accepts a reordered complete sibling set without changing the requested order", () => {
    const requested = Object.freeze(["c", "a", "b"]);
    expect(() => assertEstimateReorderPermutation(["a", "b", "c"], requested)).not.toThrow();
    expect(requested).toEqual(["c", "a", "b"]);
  });

  it.each([["a"], ["a", "foreign"], ["a", "a"], ["b", "a", "b"]])(
    "reports stale reorder details for %j", (...received) => {
      expect(publicError(() => assertEstimateReorderPermutation(["a", "b"], received))).toMatchObject({
        status: 409, code: "CONFLICT", message: "La liste de réordonnancement est obsolète.",
        details: { expected_ids: ["a", "b"], received_ids: received },
      });
    },
  );

  it("reports no siblings as not found rather than an empty successful reorder", () => {
    expect(publicError(() => assertEstimateReorderPermutation([], []))).toMatchObject({
      status: 404, code: "NOT_FOUND", message: "Aucun élément à réordonner pour ce parent.",
    });
  });

  const move = {
    itemId: "moving", fromParentId: null, toParentId: "target",
    expectedSourceIds: ["a", "b"], expectedTargetIds: ["c", "moving"],
    orderedSourceIds: ["b", "a"], orderedTargetIds: ["moving", "c"],
  };

  it("accepts arbitrary complete permutations and moving the only source item to an empty target", () => {
    expect(() => assertEstimateMovePermutation(move)).not.toThrow();
    expect(() => assertEstimateMovePermutation({
      ...move, expectedSourceIds: [], expectedTargetIds: ["moving"],
      orderedSourceIds: [], orderedTargetIds: ["moving"],
    })).not.toThrow();
  });

  it.each([
    { orderedSourceIds: ["moving", "a"], orderedTargetIds: ["moving", "c"], message: "ordered_source_ids ne doit pas contenir item_id." },
    { orderedSourceIds: ["a", "b"], orderedTargetIds: ["c"], message: "ordered_target_ids doit contenir item_id." },
    { orderedSourceIds: ["a", "b"], orderedTargetIds: ["moving", "a"], message: "ordered_source_ids et ordered_target_ids ne doivent pas se chevaucher." },
  ])("rejects malformed move lists: $message", ({ message, ...lists }) => {
    expect(publicError(() => assertEstimateMovePermutation({ ...move, ...lists }))).toMatchObject({
      status: 400, code: "BAD_REQUEST", message,
    });
  });

  it.each([
    { orderedSourceIds: ["a"], orderedTargetIds: ["moving", "c"] },
    { orderedSourceIds: ["a", "foreign"], orderedTargetIds: ["moving", "c"] },
    { orderedSourceIds: ["a", "a"], orderedTargetIds: ["moving", "c"] },
    { orderedSourceIds: ["a", "b"], orderedTargetIds: ["moving"] },
    { orderedSourceIds: ["a", "b"], orderedTargetIds: ["moving", "foreign"] },
    { orderedSourceIds: ["a", "b"], orderedTargetIds: ["moving", "moving"] },
  ])("reports both expected and received groups for a stale move: %j", (lists) => {
    expect(publicError(() => assertEstimateMovePermutation({ ...move, ...lists }))).toMatchObject({
      status: 409, code: "CONFLICT", message: "La liste de déplacement est obsolète.",
      details: {
        item_id: "moving", from_parent_id: null, to_parent_id: "target",
        expected_source_ids: ["a", "b"], received_source_ids: lists.orderedSourceIds,
        expected_target_ids: ["c", "moving"], received_target_ids: lists.orderedTargetIds,
      },
    });
  });
});
