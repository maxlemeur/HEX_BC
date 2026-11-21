/**
 * Whether the takeoff review may open the send dialog, and what it says about it. One computation for the review's
 * panels and readiness bar; the send dialog and the server check the same conditions again on their side.
 */

/** A condition that keeps the takeoff away from the send dialog, in the order the review names them. */
export type TakeoffApplyBlocker =
  | "read_only"
  | "already_applied"
  | "no_included_line"
  | "saving"
  | "save_errors"
  | "blocking_anomalies"
  | "dpgf_pending"
  | "dpgf_error"
  | "dpgf_exceptions";

export type TakeoffApplyReadinessInput = {
  jobStatus: string | null;
  hasDestination?: boolean;
  canEdit?: boolean;
  includedCount: number;
  hasDirtyOrSaving: boolean;
  hasSaveErrors: boolean;
  hasBlockingAnomalies: boolean;
  dpgfPending: boolean;
  dpgfError: boolean;
  dpgfExceptions: boolean;
  /** The included lines the apply guard blocks (0 when it passes or has not run). */
  guardBlockedCount: number;
  isAdmin: boolean;
};

export type TakeoffApplyReadiness = {
  /**
   * `ready`: nothing blocks the send. `admin_may_force`: the guard blocks lines and the viewer is an admin, who may
   * justify them one by one in the send dialog once nothing else blocks it (`canOpen`). `blocked`: anything else.
   */
  state: "ready" | "admin_may_force" | "blocked";
  /** The send dialog may open: every other condition is met and the guard passes, or the admin may force it. */
  canOpen: boolean;
  /** The active blockers, in the order of `TakeoffApplyBlocker`. */
  blockers: TakeoffApplyBlocker[];
  /** What the review says next about the send. */
  message: string;
  /** The admin's advice while the guard blocks lines (`admin_may_force`), else null. */
  guidance: string | null;
  /**
   * Lot 2: a takeoff of an affaire without a version compared nothing with an estimate yet; the send's preview does it
   * for the destination chosen. Never shown as passed meanwhile.
   */
  comparisonDeferred: boolean;
};

export const TAKEOFF_NO_INCLUDED_LINE_MESSAGE =
  "Aucune ligne retenue. Réintégrez au moins une ligne avant l'envoi au tableau de chiffrage.";

export const TAKEOFF_COMPARISON_DEFERRED = "Comparaison au devis disponible à l’envoi.";
export const TAKEOFF_CROSS_JOB_COMPARISON_LABEL = "Doublons et couverture entre métrés";

const BLOCKER_MESSAGES: Record<TakeoffApplyBlocker, string> = {
  read_only: "Ce métré est accessible en lecture seule.",
  already_applied: "Ce métré a déjà été appliqué au chiffrage.",
  no_included_line: TAKEOFF_NO_INCLUDED_LINE_MESSAGE,
  saving: "Attendez la fin des sauvegardes avant l'envoi au tableau de chiffrage.",
  save_errors: "Corrigez les lignes en erreur avant l'envoi au tableau de chiffrage.",
  blocking_anomalies: "Corrigez les anomalies bloquantes avant l'envoi au tableau de chiffrage.",
  dpgf_pending: "Attendez le chargement du rapprochement DPGF avant l'envoi au tableau de chiffrage.",
  dpgf_error:
    "Impossible de valider le rapprochement DPGF. Rechargez cette revue avant l'envoi au tableau de chiffrage.",
  dpgf_exceptions:
    "Des rapprochements DPGF restent à trancher. Ouvrez la revue détaillée pour finaliser les liens manuels.",
};

function forceGuidance(blockedCount: number): string {
  return blockedCount === 1
    ? "1 ligne reste à trancher. Vous pouvez la traiter dans la revue ciblée ou la justifier à l’envoi."
    : `${blockedCount} lignes restent à trancher. Vous pouvez les traiter dans la revue ciblée ou les justifier une par une à l’envoi.`;
}

export function takeoffApplyReadiness(input: TakeoffApplyReadinessInput): TakeoffApplyReadiness {
  const comparisonDeferred = input.hasDestination === false;
  if (input.canEdit === false) {
    return { state: "blocked", canOpen: false, blockers: ["read_only"], message: BLOCKER_MESSAGES.read_only, guidance: null,
      comparisonDeferred };
  }
  const conditions: Record<TakeoffApplyBlocker, boolean> = {
    read_only: false,
    already_applied: input.jobStatus === "applied",
    no_included_line: input.includedCount === 0,
    saving: input.hasDirtyOrSaving,
    save_errors: input.hasSaveErrors,
    blocking_anomalies: input.hasBlockingAnomalies,
    dpgf_pending: input.dpgfPending,
    dpgf_error: input.dpgfError,
    dpgf_exceptions: input.dpgfExceptions,
  };
  const blockers = (Object.keys(BLOCKER_MESSAGES) as TakeoffApplyBlocker[]).filter((blocker) => conditions[blocker]);
  // A status other than completed (or applied) blocks too, without a message of its own.
  const meetsConditions = blockers.length === 0 && input.jobStatus === "completed";
  const guardBlocked = input.guardBlockedCount > 0;
  const guidance = guardBlocked && input.isAdmin ? forceGuidance(input.guardBlockedCount) : null;

  const state = guidance !== null ? "admin_may_force" : meetsConditions && !guardBlocked ? "ready" : "blocked";
  const message = blockers.length > 0
    ? BLOCKER_MESSAGES[blockers[0]]
    : guidance ??
      (guardBlocked
        ? `Le contrôle de ${input.guardBlockedCount} ligne(s) reste incomplet : complétez les preuves localisées, tranchez les règles en échec ou validez les lignes avant l'application.`
        : comparisonDeferred
          ? `${TAKEOFF_COMPARISON_DEFERRED} L’aperçu de l’envoi choisit la destination et y vérifie les doublons et la couverture entre métrés avant que vous confirmiez.`
          : "Prêt pour l'envoi au tableau de chiffrage : vérifiez l'aperçu d'impact avant de confirmer.");

  return {
    state,
    canOpen: meetsConditions && (!guardBlocked || input.isAdmin),
    blockers,
    message,
    guidance,
    comparisonDeferred,
  };
}
