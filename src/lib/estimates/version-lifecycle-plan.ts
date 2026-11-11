import { badRequest, forbidden } from "@/lib/estimates/errors";
import type { EstimateSendGatingResult } from "@/lib/estimates/gating";
import { ESTIMATE_GATING_ALWAYS_BLOCKING_FLAG_KEYS } from "@/lib/estimates/gating-policy";
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
    ];
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
