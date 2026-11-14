import {
  buildAffaireRegisterSearchHref,
  type AffaireRegisterEntryKind,
  type AffaireRegisterEntrySeverity,
  type AffaireRegisterEntryStatus,
} from "@/lib/affaires/register";

/**
 * What lifts a send blocker of the affaire's register, and where (TI-691): the send window, the estimate page and the
 * editor name each blocker with the same action and the same filtered view of the register.
 */
type RegisterRemedy = {
  action: string;
  status: AffaireRegisterEntryStatus;
  severity: AffaireRegisterEntrySeverity | null;
  kind: AffaireRegisterEntryKind;
};

const REGISTER_REMEDIES: Record<string, RegisterRemedy> = {
  critical_missing_pieces: {
    action: "Récupérez ou requalifiez ces pièces critiques avant de reprendre l'envoi.",
    status: "open", severity: "critical", kind: "missing_piece",
  },
  critical_open_questions: {
    action: "Traitez ces points critiques dans le registre affaire avant de reprendre l'envoi.",
    status: "open", severity: "critical", kind: "assumption",
  },
  client_missing_documents_required: {
    action: "Revenez sur les demandes de pièces client pour solder ou requalifier ces attentes documentaires.",
    status: "clarify_with_client", severity: null, kind: "missing_piece",
  },
  client_clarification_required: {
    action: "Revenez sur le registre affaire pour lever ou requalifier ces clarifications client.",
    status: "clarify_with_client", severity: null, kind: "assumption",
  },
  missing_pieces_pending: {
    action: "Passez par le registre affaire pour solder ou assumer explicitement ces pièces manquantes.",
    status: "open", severity: null, kind: "missing_piece",
  },
  open_questions_pending: {
    action: "Passez par le registre affaire pour solder ou assumer explicitement ces points ouverts.",
    status: "open", severity: null, kind: "assumption",
  },
};

/** The action that lifts a register blocker, or `null` when the flag is not one of the register's. */
export function formatSendBlockerRegisterAction(flag: { key: string }): string | null {
  return Object.hasOwn(REGISTER_REMEDIES, flag.key) ? REGISTER_REMEDIES[flag.key].action : null;
}

/** The affaire's register filtered on the entries behind the flag; the affaire itself for any other flag. */
export function buildSendBlockerRegisterHref(projectId: string, flag: { key: string }): string {
  const pathname = `/dashboard/affaires/${projectId}`;
  if (!Object.hasOwn(REGISTER_REMEDIES, flag.key)) return pathname;
  const remedy = REGISTER_REMEDIES[flag.key];
  return buildAffaireRegisterSearchHref({
    pathname,
    searchParams: new URLSearchParams(),
    status: remedy.status,
    severity: remedy.severity,
    kind: remedy.kind,
    cursor: null,
  });
}
