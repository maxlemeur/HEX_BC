import { z } from "zod";

import { getTakeoffVerificationReadiness } from "@/lib/takeoff/guards";
import type {
  TakeoffItemPatchEntry,
  TakeoffItemPatchField,
  TakeoffJobItem,
} from "@/lib/takeoff/types";

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
    evidence: z.string().trim().min(1).max(2000).nullable().optional(),
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
  keyof TakeoffItemPatchField | "updated_at"
>;

export type TakeoffItemPatchUpdate = TakeoffItemPatchField & {
  updated_at: string;
  verified_at?: string | null;
  verified_by?: string | null;
};

export type TakeoffItemPatchAuditField = {
  field: keyof TakeoffItemPatchField;
  previous: string | number | boolean | null;
  next: string | number | boolean | null;
};

export type TakeoffItemPatchPreparation =
  | { success: false; error: string }
  | {
      success: true;
      updatePayload: TakeoffItemPatchUpdate;
      auditFields: TakeoffItemPatchAuditField[];
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

  const updatePayload: TakeoffItemPatchUpdate = { updated_at: input.updatedAt };
  const auditFields: TakeoffItemPatchAuditField[] = [];

  for (const field of ["designation", "quantity", "unit", "source_page"] as const) {
    const next = fields[field];
    if (next !== undefined) {
      auditFields.push({ field, previous: currentItem[field], next });
      Object.assign(updatePayload, { [field]: next });
    }
  }

  if (fields.is_excluded !== undefined) {
    auditFields.push({
      field: "is_excluded",
      previous: currentItem.is_excluded,
      next: fields.is_excluded,
    });
    updatePayload.is_excluded = fields.is_excluded;
    updatePayload.exclusion_reason = fields.is_excluded
      ? fields.exclusion_reason ?? null
      : null;
  } else if (fields.exclusion_reason !== undefined) {
    updatePayload.exclusion_reason = fields.exclusion_reason;
  }

  if (fields.is_verified !== undefined) {
    auditFields.push({
      field: "is_verified",
      previous: currentItem.is_verified,
      next: fields.is_verified,
    });
    updatePayload.is_verified = fields.is_verified;
    updatePayload.verified_at = fields.is_verified ? input.updatedAt : null;
    updatePayload.verified_by = fields.is_verified ? input.userId : null;
  }

  if (fields.evidence !== undefined) {
    auditFields.push({
      field: "evidence",
      previous: currentItem.evidence,
      next: fields.evidence,
    });
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
    auditFields.push({ field: "is_verified", previous: true, next: false });
    updatePayload.is_verified = false;
    updatePayload.verified_at = null;
    updatePayload.verified_by = null;
  }

  return { success: true, updatePayload, auditFields };
}
