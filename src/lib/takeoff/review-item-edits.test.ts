import { describe, expect, it } from "vitest";

import { afterReviewSave, editReviewItem, reviewPatch, sourcePageSaved, type ReviewItem } from "@/lib/takeoff/review-item-edits";

const signed = { id: "weld", designation: "Soudure", unit: "u", quantity: 2, source_page: 1,
  is_verified: true, verified_by: "A", verified_at: "signed-at", is_excluded: false, exclusion_reason: null,
  evidence: "Fiche atelier", _dirty: false, _saving: false, _error: null } as ReviewItem;

describe("decisions while an earlier patch is in flight", () => {
  it("keeps B's explicit withdrawal when a quantity is changed and restored during its save", () => {
    const sent = editReviewItem(signed, { is_verified: false });
    const changed = editReviewItem({ ...sent, _saving: true }, { quantity: 3 });
    const restored = editReviewItem(changed, { quantity: 2 });
    expect(restored.is_verified).toBe(false);
    const result = afterReviewSave({ ...signed, is_verified: false, verified_by: null, verified_at: null }, sent, restored);
    expect(result.is_verified).toBe(false);
    expect(reviewPatch(result)).toEqual({});
  });

  it("keeps a second explicit V for the changed quantity after an earlier V was sent", () => {
    const unsigned = { ...signed, is_verified: false, verified_by: null, verified_at: null };
    const sent = editReviewItem(unsigned, { is_verified: true });
    const changed = editReviewItem({ ...sent, _saving: true }, { quantity: 3 });
    const rechecked = editReviewItem(changed, { is_verified: true });
    const result = afterReviewSave(signed, sent, rechecked);
    expect(reviewPatch(result)).toEqual({ quantity: 3, is_verified: true });
  });

  it("keeps an in-flight edit but never signs an exclusion B had not seen", () => {
    const sent = { ...signed, is_verified: false, verified_at: null, verified_by: null };
    const corrected = editReviewItem(sent, { quantity: 3 });
    const verified = editReviewItem(corrected, { is_verified: true });
    const saved = { ...sent, is_excluded: true, exclusion_reason: "Autre zone" };
    const result = afterReviewSave(saved, sent, verified);
    expect(result.is_verified).toBe(false);
    expect(reviewPatch(result)).toEqual({ quantity: 3 });
  });

  it("requires a fresh decision when the previous save discovers a new failed rule", () => {
    const sent = { ...signed, is_verified: false, verified_at: null, verified_by: null };
    const checked = editReviewItem(sent, { is_verified: true });
    const result = afterReviewSave({ ...sent, rule_results: [{ rule: "dn_network", status: "fail",
      code: "DN_NETWORK_DN_MISSING", reason: "DN manquant", acceptable: true, version: 1 }] }, sent, checked);
    expect(result.is_verified).toBe(false);
    expect(reviewPatch(result)).toEqual({});
  });
});

describe("a saved change of a line's source page (TI-682 lot D: the pages already in the estimate are read again)", () => {
  it("is one when the save stores the corrected page", () => {
    const sent = editReviewItem(signed, { source_page: 2 });
    expect(sourcePageSaved({ ...signed, source_page: 2 }, sent)).toBe(true);
  });

  it("is one when the save clears the page", () => {
    const sent = editReviewItem(signed, { source_page: null });
    expect(sourcePageSaved({ ...signed, source_page: null }, sent)).toBe(true);
  });

  it("is none for a save of another field, a page edited back before the save, or a line not sent", () => {
    expect(sourcePageSaved({ ...signed, quantity: 3 }, editReviewItem(signed, { quantity: 3 }))).toBe(false);
    const restored = editReviewItem(editReviewItem(signed, { source_page: 2 }), { source_page: 1 });
    expect(sourcePageSaved(signed, restored)).toBe(false);
    expect(sourcePageSaved({ ...signed, source_page: 2 }, undefined)).toBe(false);
  });
});
