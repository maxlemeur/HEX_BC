import { describe, expect, it } from "vitest";

import {
  prepareTakeoffItemPatch,
  takeoffItemBatchPatchSchema,
} from "@/lib/takeoff/item-patch-preparation";
import type { TakeoffItemPatchField, TakeoffJobItem } from "@/lib/takeoff/types";

const ITEM_ID = "77777777-7777-4777-8777-777777777777";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const PREVIOUS_TIMESTAMP = "2026-10-28T08:00:00.000Z";
const UPDATED_TIMESTAMP = "2026-10-28T09:00:00.000Z";
const currentItem: TakeoffJobItem = {
  id: ITEM_ID,
  designation: "Tube cuivre",
  quantity: 12,
  unit: "ml",
  confidence: 0.9,
  evidence: "Repère EF, travée 3",
  source_file_name: "Plan R+1.pdf",
  source_page: 2,
  metadata: { original_unit: "m.l", normalized_unit: "ml" },
  is_excluded: false,
  exclusion_reason: null,
  is_verified: true,
  verified_at: PREVIOUS_TIMESTAMP,
  verified_by: USER_ID,
  created_at: PREVIOUS_TIMESTAMP,
  updated_at: PREVIOUS_TIMESTAMP,
};

function patch(fields: TakeoffItemPatchField, overrides: Partial<TakeoffJobItem> = {}) {
  return prepareTakeoffItemPatch({
    currentItem: { ...currentItem, ...overrides },
    entry: { item_id: ITEM_ID, updated_at: PREVIOUS_TIMESTAMP, fields },
    level: "C",
    userId: USER_ID,
    updatedAt: UPDATED_TIMESTAMP,
  });
}

describe("takeoff item patch preparation", () => {
  it("refuses a stale read before preparing a verified update", () => {
    expect(patch({ is_verified: true }, { updated_at: UPDATED_TIMESTAMP })).toEqual({
      success: false,
      error: "Conflit de concurrence: l'item a été modifié depuis votre dernière lecture.",
    });
  });

  it.each([
    [{ source_page: 4, is_verified: true }, { source_page: null }],
    [{ evidence: "Repère EF page 2", is_verified: true }, { evidence: null }],
  ] as const)("verifies Level C using the merged evidence and page (%j)", (fields, current) => {
    const result = patch(fields, current);
    expect(result).toMatchObject({
      success: true,
      updatePayload: {
        ...fields,
        is_verified: true,
        verified_by: USER_ID,
        verified_at: UPDATED_TIMESTAMP,
      },
    });
  });

  it.each([{ evidence: null }, { source_page: null }])(
    "refuses explicit verification when the patch removes proof (%j)",
    (fields) => {
      expect(patch({ ...fields, is_verified: true })).toMatchObject({ success: false });
    }
  );

  it.each([
    { designation: "Tube acier" },
    { quantity: 18 },
    { unit: "m2" },
    { source_page: 3 },
    { is_excluded: true, exclusion_reason: "Hors périmètre" },
    { exclusion_reason: "Hors périmètre" },
    { evidence: "Repère EF, travée 4" },
  ])("invalidates human verification for edited content (%j)", (fields) => {
    expect(patch(fields)).toMatchObject({
      success: true,
      updatePayload: { is_verified: false, verified_at: null, verified_by: null },
      auditFields: expect.arrayContaining([
        { field: "is_verified", previous: true, next: false },
      ]),
    });
  });

  it("preserves explicit reverification and records the content before and after", () => {
    const result = patch({ quantity: 18, is_verified: true });
    expect(result).toMatchObject({
      success: true,
      updatePayload: { quantity: 18, is_verified: true, verified_by: USER_ID },
      auditFields: [
        { field: "quantity", previous: 12, next: 18 },
        { field: "is_verified", previous: true, next: true },
      ],
    });
  });

  it("clears the exclusion reason on inclusion without modifying provenance", () => {
    const result = patch(
      { is_excluded: false, exclusion_reason: "Raison obsolète", source_page: 5 },
      { is_excluded: true, exclusion_reason: "Hors périmètre" }
    );
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("Expected a prepared update");
    expect(result.updatePayload).toMatchObject({
      exclusion_reason: null,
      source_page: 5,
      updated_at: UPDATED_TIMESTAMP,
    });
    expect(result.updatePayload).not.toHaveProperty("metadata");
    expect(result.updatePayload).not.toHaveProperty("source_file_name");
    expect(currentItem.metadata).toEqual({ original_unit: "m.l", normalized_unit: "ml" });
  });
});

describe("takeoff item patch request boundary", () => {
  const entry = { item_id: ITEM_ID, updated_at: PREVIOUS_TIMESTAMP, fields: { quantity: 18 } };

  it.each([1, 100])("accepts a batch of %i items without reordering duplicate IDs", (count) => {
    const items = Array.from({ length: count }, (_, index) => ({
      ...entry,
      fields: { quantity: index + 1 },
    }));
    expect(takeoffItemBatchPatchSchema.parse({ items }).items).toEqual(items);
  });

  it.each([
    {},
    { source_file_name: "Substitution.pdf" },
    { metadata: { original_unit: "m2" } },
    { is_excluded: true },
  ])("rejects missing fields, provenance edits and exclusions without a reason (%j)", (fields) => {
    expect(takeoffItemBatchPatchSchema.safeParse({ items: [{ ...entry, fields }] }).success).toBe(false);
  });
});
