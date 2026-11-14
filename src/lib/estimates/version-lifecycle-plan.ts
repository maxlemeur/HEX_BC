import { badRequest, forbidden } from "@/lib/estimates/errors";
import type { EstimateSendGatingResult } from "@/lib/estimates/gating";
import { ESTIMATE_GATING_ALWAYS_BLOCKING_FLAG_KEYS } from "@/lib/estimates/gating-policy";
import { provisionalMentionsOverflowMessage } from "@/lib/estimates/provisional-quantity";
import type { EstimateStatus } from "@/lib/estimates/status";

export type EstimateVersionEventType =
  | "sent"
  | "accepted"
  | "archived"
  | "rejected"
  | "seal_verified";
export type EstimateVersionStatusEventType = Extract<
  EstimateVersionEventType,
  "sent" | "accepted" | "archived"
>;

const ESTIMATE_STATUS_TRANSITIONS: Readonly<
  Record<EstimateStatus, readonly EstimateStatus[]>
> = {
  draft: ["sent"],
  sending: [],
  sent: ["accepted", "archived"],
  accepted: ["archived"],
  archived: [],
};
const ESTIMATE_VERSION_STATUS_EVENT_TYPES: Readonly<
  Record<EstimateStatus, EstimateVersionStatusEventType | null>
> = {
  draft: null,
  sending: null,
  sent: "sent",
  accepted: "accepted",
  archived: "archived",
};

export function assertEstimateStatusTransition(
  currentStatus: EstimateStatus,
  nextStatus: EstimateStatus
) {
  const allowedTransitions = ESTIMATE_STATUS_TRANSITIONS[currentStatus] ?? [];

  if (allowedTransitions.includes(nextStatus)) return;

  throw badRequest(
    `Transition de statut invalide: ${currentStatus} -> ${nextStatus}.`
  );
}

export function resolveStatusEventType(
  status: EstimateStatus
): EstimateVersionStatusEventType | null {
  return ESTIMATE_VERSION_STATUS_EVENT_TYPES[status] ?? null;
}

export function assertEstimateForceSendAllowed(force: boolean | undefined, isAdmin: boolean) {
  if (force === true && !isAdmin) {
    throw forbidden(
      "Le forcage d'envoi est réservé aux administrateurs.",
      undefined,
      "FORCE_SEND_FORBIDDEN"
    );
  }
}

/** The never-forced blockers the refusal below writes a sentence for; any other one is named by its label. */
const NOT_FORCEABLE_REASON_KEYS = [
  "not_priced_unclassified",
  "excluded_without_reason",
  "offer_limits_required",
  "provisional_quantity_mention_missing",
  "offer_choice_unreadable",
] as const;

/** TI-682, lot C, PR 5: the refusal of missing provisional sentences, with what unblocks when the text has no room left. */
function provisionalMentionsRefusal(gating: EstimateSendGatingResult) {
  const reason = "des quantités provisionnelles déclarées n'ont pas leur phrase, écrite d'après la ligne actuelle, dans le texte "
    + "« Précisions et limites de prestation »";
  const overflow = gating.blockingFlags.find((flag) => flag.key === "provisional_quantity_mention_missing")?.details?.limits_overflow;
  const missing = overflow && typeof overflow === "object" ? (overflow as { missing_characters?: unknown }).missing_characters : null;
  return typeof missing === "number" && missing > 0
    ? `${reason}. ${provisionalMentionsOverflowMessage(missing, "send").replace(/\.$/, "")}` : reason;
}

export function resolveEstimateSendOverride(
  gating: EstimateSendGatingResult,
  force: boolean | undefined
) {
  if (gating.blockingFlags.length > 0 && force !== true) {
    throw badRequest(
      "Envoi bloque: des anomalies bloquantes doivent être corrigees avant validation.",
      { gating },
      "ESTIMATE_GATING_BLOCKED"
    );
  }
  // TI-682 (D25): some blockers are decisions to take, never anomalies an administrator may accept for the client.
  const notForceable = gating.blockingFlags
    .map((flag) => flag.key)
    .filter((key) => (ESTIMATE_GATING_ALWAYS_BLOCKING_FLAG_KEYS as readonly string[]).includes(key));
  if (notForceable.length > 0) {
    const reasons = [
      ...(notForceable.includes("not_priced_unclassified")
        ? ["des lignes « Non chiffrée » restent à classer (chiffrez-les, ou passez-les en Inclus, Pour mémoire, Hors lot ou Sans objet)"]
        : []),
      ...(notForceable.includes("excluded_without_reason")
        ? ["des lignes exclues après « Non chiffrée » attendent leur motif interne"]
        : []),
      ...(notForceable.includes("offer_limits_required")
        ? ["l'offre réserve des lignes ou annonce des quantités provisionnelles et son texte « Précisions et limites de prestation » est vide"]
        : []),
      ...(notForceable.includes("provisional_quantity_mention_missing")
        ? [provisionalMentionsRefusal(gating)]
        : []),
      ...(notForceable.includes("offer_choice_unreadable")
        ? ["une réserve ou une quantité provisionnelle déclarée sur des lignes ne peut pas être relue (un administrateur la "
          + "déclare de nouveau depuis la ligne)"]
        : []),
    ];
    // A blocker never forced that has no sentence above still names itself: the refusal never reads « Envoi bloqué : . ».
    for (const key of notForceable) {
      if (!(NOT_FORCEABLE_REASON_KEYS as readonly string[]).includes(key)) {
        reasons.push(gating.blockingFlags.find((flag) => flag.key === key)?.label ?? key);
      }
    }
    throw badRequest(
      `Envoi bloqué : ${reasons.join(" ; ")}. Un administrateur ne peut pas forcer cet envoi.`,
      { gating, not_forceable: notForceable },
      "ESTIMATE_GATING_NOT_FORCEABLE"
    );
  }

  return {
    forcedByAdmin: gating.blockingFlags.length > 0 && force === true,
    forcedBlockingFlags: force === true ? gating.blockingFlags.map((flag) => flag.key) : [],
  };
}
