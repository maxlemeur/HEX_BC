import { z } from "zod";

import { getTakeoffVerificationReadiness } from "@/lib/takeoff/guards";
import type {
  TakeoffItemPatchEntry,
  TakeoffItemPatchField,
  TakeoffJobItem,
} from "@/lib/takeoff/types";

import { quantityEntryError, quantityEntryNote, quantityEntrySchema } from "@/lib/takeoff/quantity-entry";
import { pruneJustification, verificationError, verificationJustificationSchema } from "@/lib/takeoff/rules/verification";

const TAKEOFF_ITEM_BATCH_MAX = 100;

const takeoffItemPatchFieldSchema = z
  .object({
    designation: z.string().trim().min(1, "designation ne peut pas être vide.").max(500).optional(),
    quantity: z.number().finite().positive("quantity doit être > 0.").optional(),
    unit: z.string().trim().min(1, "unit ne peut pas être vide.").max(64).optional(),
    source_page: z.number().int().positive("source_page doit être > 0.").nullable().optional(),
    is_excluded: z.boolean().optional(),
    exclusion_reason: z.string().trim().min(1).max(500).nullable().optional(),
    is_verified: z.boolean().optional(),
    verification_justification: verificationJustificationSchema.nullable().optional(),
    evidence: z.string().trim().min(1).max(2000).nullable().optional(),
    // TI-686 D12: the quantity typed is attested with what it rests on; `quantity_entered` is no longer a field.
    quantity_entry: quantityEntrySchema.optional(),
  })
  .strict()
  .refine(
    (fields) => Object.keys(fields).length > 0,
    { message: "Au moins un champ de mise à jour est requis." }
  )
  .refine(
    (fields) => fields.is_excluded !== true || Boolean(fields.exclusion_reason),
    { message: "exclusion_reason est obligatoire quand is_excluded = true." }
  );

export const takeoffItemBatchPatchSchema = z
  .object({
    items: z
      .array(
        z.object({
          item_id: z.string().uuid("item_id invalide."),
          updated_at: z.string().min(1, "updated_at est requis."),
          expected_rules_evaluated_at: z.string().datetime({ offset: true }).optional(),
          fields: takeoffItemPatchFieldSchema,
        })
      )
      .min(1, "Au moins un item est requis.")
      .max(TAKEOFF_ITEM_BATCH_MAX, `Maximum ${TAKEOFF_ITEM_BATCH_MAX} items par batch.`),
  })
  .strict();

export const TAKEOFF_ITEM_CONCURRENCY_ERROR =
  "Conflit de concurrence: l'item a été modifié depuis votre dernière lecture.";

type TakeoffItemPatchCurrent = Pick<
  TakeoffJobItem,
  Exclude<keyof TakeoffItemPatchField, "quantity_entry"> | "updated_at"
> & Pick<TakeoffJobItem, "rule_results" | "rules_stale" | "rules_evaluated_at" | "quantity_entered_by" | "quantity_entry_category">;

/**
 * Whether the request changes an input the rules read, as enforce_authenticated_takeoff_item_fields compares them
 * (migration 20261110094501): on a line the rules read, the database then marks its rules stale before the acceptance
 * trigger reads them. An entry changes the entry's author or category, unless the same author attests the same one.
 */
function changesRuleInput(currentItem: TakeoffItemPatchCurrent, fields: TakeoffItemPatchField, userId: string) {
  return (fields.quantity !== undefined && fields.quantity !== currentItem.quantity)
    || (fields.unit !== undefined && fields.unit !== currentItem.unit)
    || (fields.source_page !== undefined && fields.source_page !== currentItem.source_page)
    || (fields.is_excluded !== undefined && fields.is_excluded !== currentItem.is_excluded)
    || (fields.quantity_entry !== undefined && (currentItem.quantity_entered_by !== userId
      || (currentItem.quantity_entry_category ?? null) !== fields.quantity_entry.category));
}

export type TakeoffItemPatchUpdate = Omit<TakeoffItemPatchField, "quantity_entry"> & {
  updated_at: string;
  verified_at?: string | null;
  verified_by?: string | null;
  quantity_entered_at?: string;
  quantity_entered_by?: string;
  quantity_entry_category?: string;
  quantity_entry_note?: string | null;
};

export type TakeoffItemPatchPreparation =
  | { success: false; error: string }
  | {
      success: true;
      updatePayload: TakeoffItemPatchUpdate;
    };

export function prepareTakeoffItemPatch(input: {
  currentItem: TakeoffItemPatchCurrent;
  entry: TakeoffItemPatchEntry;
  level: string;
  userId: string;
  updatedAt: string;
}): TakeoffItemPatchPreparation {
  const { currentItem, entry } = input;
  const { fields } = entry;

  if (currentItem.updated_at !== entry.updated_at) {
    return { success: false, error: TAKEOFF_ITEM_CONCURRENCY_ERROR };
  }

  if (fields.is_verified === true) {
    // TI-686 D9: the reasons the line's failures need, its quantity as saved with V. On a line the rules read, an input
    // changed in this request leaves the rules stale and the database refuses V (TAKEOFF_RULES_STALE): refused here
    // first, so that a printed surface on the price line's basis is retained by an earlier save.
    const stale = currentItem.rules_stale === true
      || (currentItem.rules_evaluated_at != null && changesRuleInput(currentItem, fields, input.userId));
    const error = verificationError(currentItem.rule_results, stale, fields.verification_justification,
      fields.quantity ?? currentItem.quantity);
    if (error) return { success: false, error };
  }
  if (fields.verification_justification !== undefined && fields.is_verified !== true) {
    return { success: false, error: "La justification accompagne une acceptation explicite." };
  }
  if (fields.quantity_entry) {
    const error = quantityEntryError(fields.quantity_entry);
    if (error) return { success: false, error };
  }

  if (input.level === "C" && fields.is_verified === true) {
    const readiness = getTakeoffVerificationReadiness({
      evidence: fields.evidence !== undefined ? fields.evidence : currentItem.evidence,
      source_page:
        fields.source_page !== undefined ? fields.source_page : currentItem.source_page,
    });
    if (!readiness.canVerify) {
      return {
        success: false,
        error: readiness.message ?? "Une preuve localisée est requise avant validation.",
      };
    }
  }

  // TI-677 (PR D): an excluded line always keeps a reason (require_takeoff_item_exclusion_reason refuses it too).
  if (fields.is_excluded === undefined && fields.exclusion_reason === null && currentItem.is_excluded) {
    return { success: false, error: "Le motif d’exclusion est obligatoire pour une ligne exclue." };
  }

  // Each change is journaled by the database in the save's transaction (audit_takeoff_item_decisions, TI-677 PR D).
  const updatePayload: TakeoffItemPatchUpdate = { updated_at: input.updatedAt };

  for (const field of ["designation", "quantity", "unit", "source_page"] as const) {
    const next = fields[field];
    if (next !== undefined) {
      Object.assign(updatePayload, { [field]: next });
    }
  }

  if (fields.is_excluded !== undefined) {
    updatePayload.is_excluded = fields.is_excluded;
    updatePayload.exclusion_reason = fields.is_excluded
      ? fields.exclusion_reason ?? null
      : null;
  } else if (fields.exclusion_reason !== undefined) {
    updatePayload.exclusion_reason = fields.exclusion_reason;
  }

  if (fields.is_verified !== undefined) {
    updatePayload.is_verified = fields.is_verified;
    // Only the reasons of the failures the line has: the database refuses any other key written with V.
    updatePayload.verification_justification = fields.is_verified
      ? pruneJustification(currentItem.rule_results, fields.verification_justification)
      : null;
    updatePayload.verified_at = fields.is_verified ? input.updatedAt : null;
    updatePayload.verified_by = fields.is_verified ? input.userId : null;
  }

  // A typed quantity is attested by its author, now, with what it rests on (the database checks all three, TI-686
  // D12): a quantity to enter is entered. A quantity changed without it is not (the database clears the entry).
  if (fields.quantity_entry) {
    updatePayload.quantity_entered_by = input.userId;
    updatePayload.quantity_entered_at = input.updatedAt;
    updatePayload.quantity_entry_category = fields.quantity_entry.category;
    updatePayload.quantity_entry_note = quantityEntryNote(fields.quantity_entry);
  }

  if (fields.evidence !== undefined) {
    updatePayload.evidence = fields.evidence;
  }

  const editsVerifiedContent = (
    [
      "designation",
      "quantity",
      "unit",
      "source_page",
      "is_excluded",
      "exclusion_reason",
      "evidence",
    ] as const
  ).some((field) => fields[field] !== undefined);
  if (currentItem.is_verified && editsVerifiedContent && fields.is_verified === undefined) {
    updatePayload.is_verified = false;
    updatePayload.verified_at = null;
    updatePayload.verified_by = null;
  }

  return { success: true, updatePayload };
}
