import {
  canAffaireRegisterEntryClarifyWithClient,
  canAffaireRegisterEntryContinueWithHypothesis,
  AFFAIRE_REGISTER_ORIGIN_LABELS,
  AFFAIRE_REGISTER_SCOPE_LABELS,
  AFFAIRE_REGISTER_STATUS_LABELS,
  isAffaireRegisterEntryRevalidationRequired,
  type AffaireRegisterEntry,
  type AffaireRegisterEntrySeverity,
  type AffaireRegisterEntryStatus,
  type AffaireRegisterSummary,
} from "@/lib/affaires/register";
import type { PendingTransition } from "./registerTypes";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const STATUS_TONE: Record<AffaireRegisterEntryStatus, string> = {
  open: "bg-[var(--warning)]/10 text-[var(--warning)]",
  validated: "bg-[var(--success)]/10 text-[var(--success)]",
  rejected: "bg-[var(--danger)]/10 text-[var(--danger)]",
  clarify_with_client: "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]",
};

export const SEVERITY_TONE: Record<AffaireRegisterEntrySeverity, string> = {
  info: "bg-[var(--slate-100)] text-[var(--slate-600)]",
  warning: "bg-[var(--warning)]/10 text-[var(--warning)]",
  critical: "bg-[var(--danger)]/10 text-[var(--danger)]",
};

export type RegisterEntryWorkflowAction = {
  key: string;
  label: string;
  description: string;
  tone: "success" | "danger" | "brand" | "neutral";
  transition: PendingTransition;
};

export function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return DATE_TIME_FORMATTER.format(date);
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Une erreur est survenue sur le registre affaire.";
}

export function buildDerivedSummary(
  items: AffaireRegisterEntry[]
): AffaireRegisterSummary {
  const standardWorkflowEntries = items.filter(
    (entry) => !isAffaireRegisterEntryRevalidationRequired(entry)
  );
  const openQuestionsCount = standardWorkflowEntries.filter(
    (entry) => entry.status === "open"
  ).length;
  const criticalOpenCount = standardWorkflowEntries.filter(
    (entry) => entry.status === "open" && entry.severity === "critical"
  ).length;
  const clarifyWithClientCount = standardWorkflowEntries.filter(
    (entry) => entry.status === "clarify_with_client"
  ).length;
  const criticalClarifyWithClientCount = standardWorkflowEntries.filter(
    (entry) =>
      entry.status === "clarify_with_client" && entry.severity === "critical"
  ).length;
  const openAssumptionCount = standardWorkflowEntries.filter(
    (entry) => entry.status === "open" && entry.kind === "assumption"
  ).length;
  const openMissingPieceCount = standardWorkflowEntries.filter(
    (entry) => entry.status === "open" && entry.kind === "missing_piece"
  ).length;
  const continuedWithHypothesisCount = standardWorkflowEntries.filter(
    (entry) =>
      entry.status === "open" &&
      entry.kind === "missing_piece" &&
      entry.continuationDecision?.status === "accepted_with_hypothesis"
  ).length;
  const continuedCriticalMissingPieceCount = standardWorkflowEntries.filter(
    (entry) =>
      entry.status === "open" &&
      entry.kind === "missing_piece" &&
      entry.severity === "critical" &&
      entry.continuationDecision?.status === "accepted_with_hypothesis"
  ).length;
  const revalidationRequiredEntries = items.filter(
    (entry) => isAffaireRegisterEntryRevalidationRequired(entry)
  );

  return {
    openQuestionsCount,
    criticalOpenCount,
    nonCriticalOpenCount: Math.max(openQuestionsCount - criticalOpenCount, 0),
    clarifyWithClientCount,
    criticalClarifyWithClientCount,
    openAssumptionCount,
    openMissingPieceCount,
    continuedWithHypothesisCount,
    continuedCriticalMissingPieceCount,
    revalidationRequired: revalidationRequiredEntries.length > 0,
    revalidationRequiredCount: revalidationRequiredEntries.length,
    criticalRevalidationRequiredCount: revalidationRequiredEntries.filter(
      (entry) => entry.severity === "critical"
    ).length,
    revalidationBlocksSubmission: revalidationRequiredEntries.length > 0,
  };
}

export function resolveTransitionPrompt(transition: PendingTransition) {
  if (transition.kind === "continue_with_hypothesis") {
    return {
      title: "Continuer avec hypothese",
      description:
        "Utilisez cette action pour poursuivre l'etude sans lever le manque. Le point reste ouvert et une hypothese formelle est tracee dans le registre.",
      actionLabel: "Confirmer la continuation",
      commentLabel: "Commentaire de continuation (facultatif)",
      commentPlaceholder:
        "Ex. Budget exploratoire maintenu dans l'attente de la piece definitive.",
      impactTitle: "Ce que cela change",
      impactItems: [
        "Le manque reste visible dans le registre et dans la readiness hub.",
        "Une hypothese de continuation est creee ou mise a jour pour tracer la decision.",
        "Aucun hard-block n'est ajoute tant que l'affaire reste en etude.",
      ],
      changeLabel: "Ouverte · continuation sous hypothese",
    };
  }

  switch (transition.nextStatus) {
    case "validated":
      return {
        title: "Marquer ce point comme traité",
        description:
          "Utilisez ce statut quand le point est levé ou assumé de façon suffisamment claire pour poursuivre cette affaire.",
        actionLabel: "Marquer comme traité",
        commentLabel: "Trace de résolution (facultative)",
        commentPlaceholder:
          "Ex. Hypothèse confirmée après contrôle interne ou pièce reçue et vérifiée.",
        impactTitle: "Ce que cela change",
        impactItems: [
          "Le point quitte les éléments ouverts du registre.",
          "La décision reste visible dans l'historique récent.",
        ],
        changeLabel: formatEntryStatusChange(
          transition.entry.status,
          transition.nextStatus,
        ),
      };
    case "rejected":
      return {
        title: "Écarter ce point",
        description:
          "Utilisez ce statut si le point n'est pas retenu pour cette affaire et ne doit plus être suivi activement.",
        actionLabel: "Confirmer l'écart",
        commentLabel: "Raison d'écart (facultative)",
        commentPlaceholder:
          "Ex. Doublon, faux positif ou sujet finalement hors périmètre.",
        impactTitle: "Ce que cela change",
        impactItems: [
          "Le point sort du traitement actif.",
          "La trace d'écart reste consultable dans l'historique.",
        ],
        changeLabel: formatEntryStatusChange(
          transition.entry.status,
          transition.nextStatus,
        ),
      };
    case "clarify_with_client":
      return {
        title: "Demander un retour client",
        description:
          "Utilisez ce statut si la suite dépend d'une réponse client et doit rester visible avant remise.",
        actionLabel: "Confirmer l'attente client",
        commentLabel: "Message de suivi (facultatif)",
        commentPlaceholder:
          "Ex. Confirmation attendue sur la variante, le phasage ou la pièce manquante.",
        impactTitle: "Ce que cela change",
        impactItems: [
          "Le point remontera dans les clarifications client du registre.",
          "Il restera visible avant remise tant que la réponse manque.",
        ],
        changeLabel: formatEntryStatusChange(
          transition.entry.status,
          transition.nextStatus,
        ),
      };
    case "open":
      return {
        title: "Rouvrir cette entrée",
        description:
          "Utilisez ce statut si le point doit revenir dans le traitement actif de l'affaire.",
        actionLabel: "Confirmer la réouverture",
        commentLabel: "Motif de réouverture (facultatif)",
        commentPlaceholder:
          "Ex. Un nouvel additif remet ce point en question ou la réponse reçue reste insuffisante.",
        impactTitle: "Ce que cela change",
        impactItems: [
          "Le point revient dans les éléments à traiter.",
          "La réouverture reste historisée dans le registre.",
        ],
        changeLabel: formatEntryStatusChange(
          transition.entry.status,
          transition.nextStatus,
        ),
      };
  }
}

export function getEntryStatusPanel(status: AffaireRegisterEntryStatus) {
  switch (status) {
    case "open":
      return {
        title: "Décision à prendre",
        description:
          "Le point reste actif. Choisissez maintenant comment le traiter.",
      };
    case "clarify_with_client":
      return {
        title: "En attente client",
        description:
          "Le point dépend d'un retour client. Gardez-le visible jusqu'à l'arbitrage.",
      };
    case "validated":
      return {
        title: "Point traité",
        description:
          "Le sujet est considéré comme résolu ou assumé pour cette affaire. Rouvrez seulement si le contexte change.",
      };
    case "rejected":
      return {
        title: "Point écarté",
        description:
          "Le sujet n'est pas retenu pour cette affaire. La trace d'écart reste consultable.",
      };
  }
}

export function getEntryStatusActions(
  entry: AffaireRegisterEntry
): RegisterEntryWorkflowAction[] {
  if (entry.status === "validated" || entry.status === "rejected") {
    return [
      {
        key: "reopen",
        label: "Rouvrir le point",
        description: "Le point redevient actif dans le registre.",
        transition: {
          kind: "status",
          entry,
          nextStatus: "open",
        },
        tone: "neutral" as const,
      },
    ];
  }

  if (entry.status === "clarify_with_client") {
    return [
      {
        key: "resume_internal",
        label: "Reprendre en interne",
        description: "Le point revient dans les ouverts à traiter.",
        transition: {
          kind: "status",
          entry,
          nextStatus: "open",
        },
        tone: "neutral" as const,
      },
      {
        key: "validate",
        label: "Marquer comme traité",
        description: "La résolution est actée et historisée.",
        transition: {
          kind: "status",
          entry,
          nextStatus: "validated",
        },
        tone: "success" as const,
      },
      {
        key: "reject",
        label: "Écarter ce point",
        description: "Le point sort du flux actif mais reste traçable.",
        transition: {
          kind: "status",
          entry,
          nextStatus: "rejected",
        },
        tone: "danger" as const,
      },
    ];
  }

  const actions: RegisterEntryWorkflowAction[] = [
    {
      key: "validate",
      label: "Marquer comme traité",
      description: "Le point est considéré comme levé ou accepté.",
      transition: {
        kind: "status",
        entry,
        nextStatus: "validated",
      },
      tone: "success" as const,
    },
    {
      key: "reject",
      label: "Écarter ce point",
      description: "Le sujet n'est pas retenu dans ce flux et reste tracé.",
      transition: {
        kind: "status",
        entry,
        nextStatus: "rejected",
      },
      tone: "danger" as const,
    },
  ];

  if (canAffaireRegisterEntryContinueWithHypothesis(entry)) {
    actions.push({
      key: "continue_with_hypothesis",
      label: "Continuer avec hypothese",
      description:
        "Le manque reste ouvert mais l'etude peut continuer sous reserve.",
      transition: {
        kind: "continue_with_hypothesis",
        entry,
      },
      tone: "brand",
    });
  }

  if (canAffaireRegisterEntryClarifyWithClient(entry)) {
    actions.push({
      key: "clarify_with_client",
      label: "Demander un retour client",
      description: "Le point reste visible jusqu'à la réponse attendue.",
      transition: {
        kind: "status",
        entry,
        nextStatus: "clarify_with_client",
      },
      tone: "brand" as const,
    });
  }

  return actions;
}

export function resolveStatusChangeFeedback(status: AffaireRegisterEntryStatus) {
  switch (status) {
    case "validated":
      return {
        inlineMessage:
          "Point marqué comme traité. La décision reste visible dans l'historique du registre.",
        toastTitle: "Point traité",
        toastDescription: "La résolution a été enregistrée dans le registre.",
      };
    case "rejected":
      return {
        inlineMessage:
          "Point écarté du traitement actif. La raison reste historisée dans le registre.",
        toastTitle: "Point écarté",
        toastDescription: "Le point sort du flux actif tout en restant traçable.",
      };
    case "clarify_with_client":
      return {
        inlineMessage:
          "Point passé en attente client. Il restera visible avant remise tant que la réponse manque.",
        toastTitle: "Retour client demandé",
        toastDescription: "Le point remonte désormais dans les clarifications client.",
      };
    case "open":
      return {
        inlineMessage:
          "Point rouvert. Il revient dans les éléments à traiter du registre.",
        toastTitle: "Point rouvert",
        toastDescription: "La reprise du traitement a été enregistrée.",
      };
  }
}

export function resolveTransitionFeedback(transition: PendingTransition) {
  if (transition.kind === "continue_with_hypothesis") {
    return {
      inlineMessage:
        "Continuation sous hypothese enregistree. Le manque reste ouvert et la trace est visible dans le registre.",
      toastTitle: "Continuation tracee",
      toastDescription:
        "Une hypothese de continuation a ete ajoutee sans masquer le point manquant.",
    };
  }

  return resolveStatusChangeFeedback(transition.nextStatus);
}

export function formatEntryStatusChange(
  previousStatus: AffaireRegisterEntryStatus,
  nextStatus: AffaireRegisterEntryStatus,
) {
  return `${AFFAIRE_REGISTER_STATUS_LABELS[previousStatus]} → ${AFFAIRE_REGISTER_STATUS_LABELS[nextStatus]}`;
}

function getEntryContextTarget(entry: AffaireRegisterEntry) {
  if (entry.scopeType === "project") {
    return entry.scopeLabel.trim().length > 0
      ? `toute l'affaire ${entry.scopeLabel}`
      : "toute l'affaire";
  }

  if (entry.scopeType === "lot") {
    return entry.scopeLabel.trim().length > 0
      ? `le lot ${entry.scopeLabel}`
      : "le lot concerné";
  }

  if (entry.scopeType === "line") {
    if (entry.scopeRef && entry.scopeLabel.trim().length > 0) {
      return `la ligne ${entry.scopeRef} · ${entry.scopeLabel}`;
    }

    return entry.scopeLabel.trim().length > 0
      ? `la ligne ${entry.scopeLabel}`
      : "la ligne concernée";
  }

  if (entry.scopeRef && entry.scopeLabel.trim().length > 0) {
    return `l'exception ${entry.scopeRef} · ${entry.scopeLabel}`;
  }

  return entry.scopeLabel.trim().length > 0
    ? `l'exception ${entry.scopeLabel}`
    : "l'exception concernée";
}

export function getEntryContextSummary(entry: AffaireRegisterEntry) {
  return `Ce point concerne ${getEntryContextTarget(entry)}.`;
}

export function getEntryContextTags(entry: AffaireRegisterEntry) {
  const tags = [
    {
      label: AFFAIRE_REGISTER_SCOPE_LABELS[entry.scopeType],
      value:
        entry.scopeRef && entry.scopeType !== "project" && entry.scopeType !== "lot"
          ? `${entry.scopeRef} · ${entry.scopeLabel}`
          : entry.scopeLabel,
    },
    {
      label: "Créé via",
      value: AFFAIRE_REGISTER_ORIGIN_LABELS[entry.originKind],
    },
  ].filter((tag) => tag.value && tag.value.trim().length > 0);

  if (entry.sourceFileName) {
    tags.splice(1, 0, {
      label: "Pièce liée",
      value: entry.sourceFileName,
    });
  }

  return tags;
}
