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
    });
  });

  // TI-677 (PR D): the database journals each decision with the save (audit_takeoff_item_decisions), never the route.
  it("preserves explicit reverification and leaves the journal to the database", () => {
    const result = patch({ quantity: 18, is_verified: true });
    expect(result).toMatchObject({
      success: true,
      updatePayload: { quantity: 18, is_verified: true, verified_by: USER_ID },
    });
    expect(result).not.toHaveProperty("auditFields");
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

// TI-677 (PR D): an excluded line always keeps a reason (the database refuses it too,
// require_takeoff_item_exclusion_reason).
describe("exclusion reason", () => {
  const excluded = { is_excluded: true, exclusion_reason: "Hors lot" } as const;

  it("refuses to clear the reason of a line that stays excluded", () => {
    expect(patch({ exclusion_reason: null }, excluded)).toEqual({
      success: false,
      error: "Le motif d’exclusion est obligatoire pour une ligne exclue.",
    });
  });

  it("changes the reason of an excluded line, and clears it with the inclusion", () => {
    expect(patch({ exclusion_reason: "Lot plomberie" }, excluded)).toMatchObject({
      success: true, updatePayload: { exclusion_reason: "Lot plomberie" },
    });
    expect(patch({ is_excluded: false, exclusion_reason: null }, excluded)).toMatchObject({
      success: true, updatePayload: { is_excluded: false, exclusion_reason: null },
    });
  });

  it("refuses an exclusion whose reason is blank", () => {
    const body = (fields: Record<string, unknown>) =>
      takeoffItemBatchPatchSchema.safeParse({ items: [{ item_id: ITEM_ID, updated_at: PREVIOUS_TIMESTAMP, fields }] });
    for (const reason of ["", "   ", "\t\n", null]) {
      expect(body({ is_excluded: true, exclusion_reason: reason }).success).toBe(false);
    }
    expect(body({ is_excluded: true, exclusion_reason: "Hors lot" }).success).toBe(true);
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

// TI-664, TI-686 D12: a typed quantity is attested by its author, at the save's time, with its category (the database
// refuses any other name, a missing time or a missing category). A note says what an hypothesis assumes; the route
// refuses a short one first, with a message the review shows (a refusal of the database reaches the user as a generic
// error). The former `quantity_entered: true` is no longer a field: the request is refused whole (422).
describe("quantity entry", () => {
  const body = (fields: Record<string, unknown>) =>
    takeoffItemBatchPatchSchema.safeParse({ items: [{ item_id: ITEM_ID, updated_at: PREVIOUS_TIMESTAMP, fields }] });
  const hypothesisNote = "6 soudures supposées : 3 piquages × 2, à confirmer au relevé.";

  it("attests the quantity the user typed, even unchanged, by the caller now, with its category and note", () => {
    expect(patch({ quantity: 12, quantity_entry: { category: "written_confirmation", note: "Fiche atelier A-07" } })).toMatchObject({
      success: true, updatePayload: { quantity: 12, quantity_entered_by: USER_ID, quantity_entered_at: UPDATED_TIMESTAMP,
        quantity_entry_category: "written_confirmation", quantity_entry_note: "Fiche atelier A-07" } });
    expect(patch({ quantity: 15, quantity_entry: { category: "hypothesis", note: hypothesisNote } })).toMatchObject({
      success: true, updatePayload: { quantity: 15, quantity_entered_by: USER_ID, quantity_entered_at: UPDATED_TIMESTAMP,
        quantity_entry_category: "hypothesis", quantity_entry_note: hypothesisNote } });
    const edit = patch({ quantity: 10 });
    expect(edit.success && Object.keys(edit.updatePayload).filter((key) => key.startsWith("quantity_ent"))).toEqual([]);
  });

  it("stores no note for a category that needs none, and the note without its blanks at both ends", () => {
    expect(patch({ quantity: 12, quantity_entry: { category: "site_survey" } })).toMatchObject({
      success: true, updatePayload: { quantity_entry_category: "site_survey", quantity_entry_note: null } });
    expect(patch({ quantity: 12, quantity_entry: { category: "site_survey", note: " \t\n" } })).toMatchObject({
      success: true, updatePayload: { quantity_entry_category: "site_survey", quantity_entry_note: null } });
    expect(patch({ quantity: 12, quantity_entry: { category: "dpgf_cctp", note: "\n DPGF lot 3, ligne 12 \t" } })).toMatchObject({
      success: true, updatePayload: { quantity_entry_note: "DPGF lot 3, ligne 12" } });
  });

  it("refuses an hypothesis that does not say what it assumes (10 to 500 code points)", () => {
    const refused = { success: false, error: "Une hypothèse doit dire ce qui est supposé (10 à 500 caractères)." };
    expect(patch({ quantity: 15, quantity_entry: { category: "hypothesis" } })).toEqual(refused);
    expect(patch({ quantity: 15, quantity_entry: { category: "hypothesis", note: "x".repeat(9) } })).toEqual(refused);
    // Five emoji are ten UTF-16 units but five code points, as char_length counts them.
    expect(patch({ quantity: 15, quantity_entry: { category: "hypothesis", note: "🔧".repeat(5) } })).toEqual(refused);
    expect(patch({ quantity: 15, quantity_entry: { category: "hypothesis", note: `  ${"x".repeat(10)}  ` } })).toMatchObject({ success: true });
    expect(patch({ quantity: 15, quantity_entry: { category: "hypothesis", note: "x".repeat(500) } })).toMatchObject({ success: true });
    expect(patch({ quantity: 15, quantity_entry: { category: "hypothesis", note: "x".repeat(501) } })).toEqual(refused);
  });

  it("refuses a note beyond 500 code points for any category", () => {
    expect(patch({ quantity: 12, quantity_entry: { category: "other_drawing", note: "x".repeat(501) } })).toEqual({ success: false,
      error: "Ce qui fonde la quantité tient en 500 caractères au plus." });
  });

  it("refuses the former attestation flag, an unknown category and an unknown key with the request", () => {
    expect(body({ quantity: 12, quantity_entered: true }).success).toBe(false);
    expect(body({ quantity_entered_by: USER_ID }).success).toBe(false);
    expect(body({ quantity: 12, quantity_entry: { category: "guess" } }).success).toBe(false);
    expect(body({ quantity: 12, quantity_entry: { category: "site_survey", by: USER_ID } }).success).toBe(false);
    expect(body({ quantity: 12, quantity_entry: {} }).success).toBe(false);
    for (const category of ["site_survey", "other_drawing", "dpgf_cctp", "written_confirmation", "documented_calculation", "hypothesis"]) {
      expect(body({ quantity: 12, quantity_entry: { category, note: hypothesisNote } }).success, category).toBe(true);
    }
  });

  // The database marks the rules stale when the entry's author or category changes (aac_), then refuses V (zz_).
  it("refuses V with a new entry on a line the rules read", () => {
    const evaluated = { is_verified: false, verified_at: null, verified_by: null, rules_stale: false,
      rules_evaluated_at: PREVIOUS_TIMESTAMP, rule_results: [], quantity_entered_by: null, quantity_entry_category: null };
    expect(patch({ is_verified: true, quantity_entry: { category: "site_survey" } }, evaluated))
      .toEqual({ success: false, error: "Recalculez les règles avant d’accepter la ligne." });
    // The same author attesting the same category again leaves the rules as computed.
    expect(patch({ is_verified: true, quantity_entry: { category: "site_survey" } },
      { ...evaluated, quantity_entered_by: USER_ID, quantity_entry_category: "site_survey" })).toMatchObject({ success: true });
  });
});

// TI-686 D9: V on a scale or printed-area failure carries a coded reason; the route refuses before the database (whose
// refusal reaches the user as a generic error) and stores only the reasons of the failures the line has, so that the
// database never sees a stale key (validate_takeoff_rule_acceptance refuses one written in the request).
describe("coded acceptance reasons", () => {
  const scaleFailure = { rule: "scale_dimension", status: "fail", code: "SCALE_DIMENSION_MISMATCH", version: 2, acceptable: true,
    reason: "Fictif." } as const;
  const areaFailure = { rule: "area_printed", status: "fail", code: "AREA_PRINTED_MISMATCH", version: 3, acceptable: true,
    reason: "Fictif.", details: { printed_m2: 20, measured_m2: 19.5, expected_basis: "net_floor" as const } } as const;
  const scaleReason = { scale_dimension: { reason_code: "dimension_not_to_scale" as const, note: "Cote 3,00 du tronçon interrompu." } };
  const areaReason = { area_printed: { reason_code: "measured_outline_retained" as const, retained_basis: "shab" as const,
    note: "La surface écrite est une SHAB du tableau." } };
  const sameBasis = { area_printed: { reason_code: "printed_area_basis_identified" as const, retained_basis: "net_floor" as const,
    note: "Tableau des surfaces du plan, indice B." } };
  const unverified = { is_verified: false, verified_at: null, verified_by: null, rules_stale: false, quantity: 19.5, unit: "m2" };

  it("refuses V on a scale failure without its reason", () => {
    expect(patch({ is_verified: true }, { ...unverified, rule_results: [scaleFailure] })).toEqual({ success: false,
      error: "Une cote de la page contredit l’échelle : un motif codé et ce qui a été vérifié (10 à 500 caractères) sont obligatoires." });
  });

  it("refuses V below a printed surface of the same basis as the price line, read with the quantity as stored", () => {
    expect(patch({ is_verified: true, verification_justification: sameBasis }, { ...unverified, rule_results: [areaFailure] }))
      .toEqual({ success: false,
        error: "Même base que la prestation : les deux surfaces se comparent et la plus élevée est retenue. Retenez 20 m² avant d’accepter." });
    expect(patch({ is_verified: true, verification_justification: sameBasis },
      { ...unverified, quantity: 20, rule_results: [areaFailure] })).toMatchObject({ success: true });
  });

  // TI-686 D21: « contour mesuré retenu » says the printed surface covers another outline: on the price line's basis
  // too, the quantity stays the line's (here the measurement).
  it("accepts a measured outline retained on the price line's basis at the measured quantity", () => {
    const outline = { area_printed: { ...areaReason.area_printed, retained_basis: "net_floor" as const } };
    expect(patch({ is_verified: true, verification_justification: outline }, { ...unverified, rule_results: [areaFailure] }))
      .toMatchObject({ success: true, updatePayload: { is_verified: true, verification_justification: outline } });
  });

  // The database marks the rules stale when a rule input changes (aac_) and then refuses V (zz_, TAKEOFF_RULES_STALE):
  // on a line the rules read, the route refuses V with a changed input first, with a message the review shows.
  it("refuses V with a rule input changed in the same request on a line the rules read", () => {
    const evaluated = { ...unverified, rules_evaluated_at: PREVIOUS_TIMESTAMP, rule_results: [areaFailure] };
    const stale = { success: false, error: "Recalculez les règles avant d’accepter la ligne." };
    expect(patch({ quantity: 20, is_verified: true, verification_justification: sameBasis }, evaluated)).toEqual(stale);
    expect(patch({ unit: "m²", is_verified: true, verification_justification: areaReason }, evaluated)).toEqual(stale);
    expect(patch({ source_page: 3, is_verified: true, verification_justification: areaReason }, evaluated)).toEqual(stale);
    expect(patch({ is_excluded: false, is_verified: true, verification_justification: areaReason },
      { ...evaluated, is_excluded: true, exclusion_reason: "Hors lot" })).toEqual(stale);
    // Unchanged inputs leave the rules as computed.
    expect(patch({ quantity: 19.5, unit: "m2", is_verified: true, verification_justification: areaReason }, evaluated))
      .toMatchObject({ success: true, updatePayload: { quantity: 19.5, is_verified: true } });
    expect(patch({ quantity: 20, is_verified: true, verification_justification: sameBasis }, { ...evaluated, quantity: 20 }))
      .toMatchObject({ success: true, updatePayload: { is_verified: true, verification_justification: sameBasis } });
  });

  it("stores only the reasons of the failures the line has", () => {
    expect(patch({ is_verified: true, verification_justification: { ...scaleReason, ...areaReason } },
      { ...unverified, rule_results: [scaleFailure] })).toMatchObject({ success: true, updatePayload: {
      is_verified: true, verification_justification: scaleReason, verified_by: USER_ID } });
    const duplicate = { rule: "zone_overlap", status: "fail", code: "ZONE_OVERLAP_DUPLICATE", version: 101, acceptable: true,
      reason: "Fictif." } as const;
    expect(patch({ is_verified: true, verification_justification: scaleReason }, { ...unverified, rule_results: [duplicate] }))
      .toMatchObject({ success: true, updatePayload: { is_verified: true, verification_justification: null } });
  });

  it("refuses a request whose reason is malformed before reading the line", () => {
    const body = (justification: unknown) => takeoffItemBatchPatchSchema.safeParse({ items: [{ item_id: ITEM_ID,
      updated_at: PREVIOUS_TIMESTAMP, fields: { is_verified: true, verification_justification: justification } }] });
    expect(body({ ...scaleReason, ...areaReason }).success).toBe(true);
    expect(body({ scale_dimension: { ...scaleReason.scale_dimension, note: "x".repeat(9) } }).success).toBe(false);
    expect(body({ area_printed: { ...areaReason.area_printed, retained_basis: "gross_floor" } }).success).toBe(false);
    expect(body({ unknown_rule: {} }).success).toBe(false);
    expect(body({ reason_code: "system_documented" }).success).toBe(false);
  });
});
