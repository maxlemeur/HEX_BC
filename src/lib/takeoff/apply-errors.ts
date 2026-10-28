import { z } from "zod";

import { describeV3EntryRefusal } from "@/lib/estimates/assemblies-server";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";

export type ApplyTakeoffRpcError = {
  code?: string;
  message?: string;
  details?: string | null;
  hint?: string | null;
};

type TakeoffV3UnresolvedUnit = {
  takeoff_item_id: string | null;
  designation: string;
  unit: string | null;
};

const takeoffV3UnresolvedUnitsDetailSchema = z.object({
  items: z.array(
    z.object({
      takeoff_item_id: z.string().nullable().optional(),
      designation: z.string().nullable().optional(),
      unit: z.string().nullable().optional(),
    })
  ),
});

/** Les items dont l'unité n'a pas de code dans le référentiel, tels que la migration M2 les nomme (détail JSON). */
function parseTakeoffV3UnresolvedUnits(detail: string | null | undefined): TakeoffV3UnresolvedUnit[] {
  if (!detail) return [];
  try {
    const parsed = takeoffV3UnresolvedUnitsDetailSchema.safeParse(JSON.parse(detail));
    if (!parsed.success) return [];
    return parsed.data.items.map((item) => ({
      takeoff_item_id: item.takeoff_item_id ?? null,
      designation: item.designation?.trim() || "Item sans désignation",
      unit: item.unit ?? null,
    }));
  } catch {
    return [];
  }
}

const TAKEOFF_V3_UNRESOLVED_UNITS_NAMED = 5;

function takeoffV3UnresolvedUnitsMessage(items: TakeoffV3UnresolvedUnit[]) {
  const advice =
    "Corrigez l’unité dans la revue (par exemple ml, m2, u, ens ou PM) ou excluez l’item, puis appliquez à nouveau.";
  if (items.length === 0) {
    return `Une unité du métré est inconnue du devis moteur 3. ${advice}`;
  }
  const named = items
    .slice(0, TAKEOFF_V3_UNRESOLVED_UNITS_NAMED)
    .map((item) => `« ${item.designation} » (${item.unit?.trim() ? item.unit.trim() : "sans unité"})`)
    .join(", ");
  const others = items.length - TAKEOFF_V3_UNRESOLVED_UNITS_NAMED;
  const more = others > 0 ? ` et ${others} autre${others > 1 ? "s" : ""}` : "";
  return `Unité inconnue du devis moteur 3 pour ${named}${more}. ${advice}`;
}

export function mapApplyTakeoffRpcError(
  error: ApplyTakeoffRpcError,
  input: { jobId: string }
): TakeoffError {
  const normalized = [
    error.code ?? "",
    error.message ?? "",
    error.details ?? "",
    error.hint ?? "",
  ]
    .join(" ")
    .toLowerCase();
  const details = {
    rpc: {
      code: error.code ?? null,
      message: error.message ?? null,
      details: error.details ?? null,
      hint: error.hint ?? null,
    },
  };

  if (error.code === "PGRST202") {
    return new TakeoffError({
      status: 503,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message:
        "L’application atomique du métré n’est pas encore disponible. Réessayez après la mise à jour du service.",
      details: {
        ...details,
        guard: "atomic_apply_unavailable",
      },
      retryable: true,
      jobId: input.jobId,
    });
  }

  // Métré M2 v0.1 : refus nommés de l'application à un brouillon du moteur 3.
  if (error.message === "TAKEOFF_V3_UNIT_UNRESOLVED") {
    const items = parseTakeoffV3UnresolvedUnits(error.details);
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.VALIDATION_ERROR,
      message: takeoffV3UnresolvedUnitsMessage(items),
      details: {
        ...details,
        guard: "v3_unit_unresolved",
        items,
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (error.message === "TAKEOFF_TARGET_VERSION_DRAFT_REQUIRED") {
    return new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message:
        "Ce devis n’est plus un brouillon : le métré ne peut plus s’y appliquer. Créez un brouillon depuis cette version, puis relancez le métré sur ce brouillon.",
      details: {
        ...details,
        guard: "target_version_draft_required",
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  const v3EntryRefusal = describeV3EntryRefusal(error);
  if (v3EntryRefusal) {
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.VALIDATION_ERROR,
      message: v3EntryRefusal.message,
      details: {
        ...details,
        guard: "v3_entry_refusal",
        refusal: v3EntryRefusal.code,
        title: v3EntryRefusal.title,
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (error.message === "ESTIMATE_V3_WRITER_NOT_SUPPORTED") {
    return new TakeoffError({
      status: 503,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message:
        "L’application du métré à un devis moteur 3 n’est pas encore disponible. Réessayez après la mise à jour du service.",
      details: {
        ...details,
        guard: "v3_apply_unavailable",
      },
      retryable: true,
      jobId: input.jobId,
    });
  }

  // Refus du moteur 3 au calcul des lignes : rien n'est appliqué, la revue reste corrigeable.
  if (error.message === "ESTIMATE_V3_INPUT_INVALID" || error.message === "ESTIMATE_AMOUNT_OVERFLOW") {
    const overflow = error.message === "ESTIMATE_AMOUNT_OVERFLOW";
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.VALIDATION_ERROR,
      message: overflow
        ? "Avec ce métré, un montant du devis moteur 3 dépasserait la limite autorisée : rien n’a été appliqué. Vérifiez les quantités dans la revue, puis appliquez à nouveau."
        : "Une quantité ou un prix du métré ne peut pas être chiffré par le devis moteur 3 (valeur négative, illisible ou trop précise) : rien n’a été appliqué. Corrigez-le dans la revue, puis appliquez à nouveau.",
      details: {
        ...details,
        guard: overflow ? "v3_amount_overflow" : "v3_input_invalid",
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (error.message === "ESTIMATE_V3_PROJECTION_MISMATCH") {
    return new TakeoffError({
      status: 500,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message:
        "Le calcul moteur 3 du devis ne concorde pas après ce métré : rien n’a été appliqué. Signalez-le avant d’appliquer à nouveau.",
      details: {
        ...details,
        guard: "v3_projection_mismatch",
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (error.code === "57014") {
    return new TakeoffError({
      status: 503,
      code: TakeoffErrorCode.INTERNAL_ERROR,
      message:
        "L’application du métré a pris trop de temps et a été annulée : rien n’a été appliqué. Réessayez dans un instant.",
      details: {
        ...details,
        guard: "statement_timeout",
      },
      retryable: true,
      jobId: input.jobId,
    });
  }

  if (normalized.includes("takeoff_root_replace_disabled")) {
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.VALIDATION_ERROR,
      message:
        "Le remplacement complet du devis est désactivé : choisissez une section pour limiter l’application et protéger le chiffrage existant.",
      details: {
        ...details,
        guard: "root_replace_disabled",
      },
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (
    normalized.includes("takeoff_atomic_mapping_plan") ||
    normalized.includes("takeoff_atomic_line_mapping_failed")
  ) {
    return new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message:
        "Le métré ou le devis a changé depuis l’aperçu. Rechargez la revue avant d’appliquer.",
      details: {
        ...details,
        guard: "atomic_mapping_stale",
      },
      retryable: true,
      jobId: input.jobId,
    });
  }

  if (
    normalized.includes("takeoff_dpgf_apply_authorization_required") ||
    normalized.includes("takeoff_dpgf_apply_authorization_invalid")
  ) {
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.TAKEOFF_APPLY_GUARD_FAILED,
      message:
        "La validation DPGF a expiré ou n’est plus valable. Relancez l’application pour recalculer les contrôles.",
      details: {
        ...details,
        guard: "dpgf_authorization",
      },
      retryable: true,
      jobId: input.jobId,
    });
  }

  if (
    error.code === "PGRST116" ||
    normalized.includes("not found") ||
    normalized.includes("introuvable")
  ) {
    return new TakeoffError({
      status: 404,
      code: TakeoffErrorCode.TAKEOFF_JOB_NOT_FOUND,
      message: "Job takeoff introuvable.",
      details,
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (
    error.code === "P0001" ||
    error.code === "23505" ||
    normalized.includes("conflict") ||
    normalized.includes("already applied") ||
    normalized.includes("deja applique") ||
    normalized.includes("lock")
  ) {
    return new TakeoffError({
      status: 409,
      code: TakeoffErrorCode.CONFLICT,
      message: "Conflit lors de l'application du job takeoff.",
      details,
      retryable: false,
      jobId: input.jobId,
    });
  }

  if (
    error.code === "22P02" ||
    error.code === "23503" ||
    error.code === "23514" ||
    normalized.includes("validation") ||
    normalized.includes("invalid") ||
    normalized.includes("invalide") ||
    normalized.includes("uuid")
  ) {
    return new TakeoffError({
      status: 422,
      code: TakeoffErrorCode.VALIDATION_ERROR,
      message: "Le payload d'application takeoff est invalide.",
      details,
      retryable: false,
      jobId: input.jobId,
    });
  }

  return new TakeoffError({
    status: 500,
    code: TakeoffErrorCode.INTERNAL_ERROR,
    message: "Erreur interne lors de l'application du job takeoff.",
    details,
    retryable: false,
    jobId: input.jobId,
  });
}
