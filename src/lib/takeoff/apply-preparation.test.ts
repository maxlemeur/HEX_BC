import { describe, expect, it } from "vitest";

import {
  buildTakeoffAtomicMappingPlan,
  buildTakeoffDpgfApplyAuthorizationRecord,
  hashTakeoffApplyAuthorizationToken,
} from "@/lib/takeoff/apply-preparation";
import type {
  TakeoffDpgfComparisonSummary,
  TakeoffMappingPreviewItem,
} from "@/lib/takeoff/types";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const JOB_ID = "44444444-4444-4444-8444-444444444444";
const VERSION_ID = "55555555-5555-4555-8555-555555555555";
const TAKEOFF_ITEM_ID = "88888888-8888-4888-8888-888888888888";
const CATEGORY_ID = "99999999-9999-4999-8999-999999999999";
const ASSEMBLY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RULE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function previewItem(
  action: TakeoffMappingPreviewItem["action"],
  overrides: Partial<TakeoffMappingPreviewItem> = {}
): TakeoffMappingPreviewItem {
  const original = {
    designation: "Tube cuivre",
    quantity: 12,
    unit: "ml",
    is_excluded: false,
    category_id: null,
    unit_price_cents: null,
    assembly_id: null,
  };
  return {
    item_id: TAKEOFF_ITEM_ID,
    source_order: 3,
    rule_id: RULE_ID,
    rule_name: "Tube normalisé",
    action,
    action_params: {},
    applied_by: "rule",
    original,
    transformed: {
      ...original,
      designation: "Tube cuivre normalisé",
      unit_price_cents: 1250,
      category_id: CATEGORY_ID,
      assembly_id: ASSEMBLY_ID,
    },
    ...overrides,
  };
}

describe("buildTakeoffAtomicMappingPlan", () => {
  it.each([
    { action: "none", price: null, category: null, assembly: null },
    { action: "rename", price: null, category: null, assembly: null },
    { action: "set_price", price: 1250, category: null, assembly: null },
    { action: "set_category", price: null, category: CATEGORY_ID, assembly: null },
    { action: "apply_assembly", price: null, category: null, assembly: ASSEMBLY_ID },
    { action: "skip", price: null, category: null, assembly: null },
  ] as const)("limits $action to its own mutation fields", ({ action, price, category, assembly }) => {
    expect(buildTakeoffAtomicMappingPlan([previewItem(action)])).toEqual([
      {
        item_id: TAKEOFF_ITEM_ID,
        source_order: 3,
        rule_id: RULE_ID,
        action,
        designation: "Tube cuivre normalisé",
        unit_price_cents: price,
        category_id: category,
        assembly_id: assembly,
      },
    ]);
  });

  it("retains excluded and skipped items and preserves the supplied order for atomic anchors", () => {
    const excluded = previewItem("none", {
      item_id: "10000000-0000-4000-8000-000000000001",
      source_order: 7,
      rule_id: null,
    });
    excluded.original.is_excluded = true;
    const skipped = previewItem("skip", {
      item_id: "10000000-0000-4000-8000-000000000002",
      source_order: 2,
    });
    skipped.transformed.is_excluded = true;
    const assembly = previewItem("apply_assembly", {
      item_id: "10000000-0000-4000-8000-000000000003",
      source_order: 5,
    });
    const items = [excluded, skipped, assembly];
    const originalItems = structuredClone(items);

    const result = buildTakeoffAtomicMappingPlan(items);

    expect(result.map(({ item_id, source_order, action }) => ({ item_id, source_order, action }))).toEqual([
      { item_id: excluded.item_id, source_order: 7, action: "none" },
      { item_id: skipped.item_id, source_order: 2, action: "skip" },
      { item_id: assembly.item_id, source_order: 5, action: "apply_assembly" },
    ]);
    expect(items).toEqual(originalItems);
  });
});

describe("buildTakeoffDpgfApplyAuthorizationRecord", () => {
  it("binds the review to its owner and target, stores only the hash and expires five minutes after the supplied time", () => {
    const authorizationToken = "11111111-1111-4111-8111-111111111111";
    const summary: TakeoffDpgfComparisonSummary = {
      reliable_matches: 3,
      to_confirm: 0,
      significant_gaps: 0,
      forced_manual: 0,
      lines_without_proof: 0,
      unused_takeoff_items: 0,
      total_lines: 3,
    };
    const record = buildTakeoffDpgfApplyAuthorizationRecord({
      tenantId: TENANT_ID,
      userId: USER_ID,
      jobId: JOB_ID,
      estimateVersionId: VERSION_ID,
      summary,
      authorizationToken,
      nowMs: Date.parse("2026-12-31T23:58:04.321Z"),
    });

    expect(record).toEqual({
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      job_id: JOB_ID,
      estimate_version_id: VERSION_ID,
      authorization_token_hash: "bd7662a5eeb41614e720d477abfcb2272e19a8a70a93b7e3bc8560d44ad326e9",
      review_summary: summary,
      expires_at: "2027-01-01T00:03:04.321Z",
    });
    expect(hashTakeoffApplyAuthorizationToken(authorizationToken)).toBe(record.authorization_token_hash);
    expect(JSON.stringify(record)).not.toContain(authorizationToken);
  });
});
