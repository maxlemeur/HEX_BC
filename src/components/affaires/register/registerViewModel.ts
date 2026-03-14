import {
  AFFAIRE_REGISTER_ORIGIN_LABELS,
  AFFAIRE_REGISTER_SCOPE_LABELS,
  type AffaireRegisterEntry,
  type AffaireRegisterEntrySeverity,
  type AffaireRegisterEntryStatus,
  type AffaireRegisterSummary,
} from "@/lib/affaires/register";

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
  const openQuestionsCount = items.filter((entry) => entry.status === "open").length;
  const criticalOpenCount = items.filter(
    (entry) => entry.status === "open" && entry.severity === "critical"
  ).length;
  const clarifyWithClientCount = items.filter(
    (entry) => entry.status === "clarify_with_client"
  ).length;
  const criticalClarifyWithClientCount = items.filter(
    (entry) =>
      entry.status === "clarify_with_client" && entry.severity === "critical"
  ).length;
  const openAssumptionCount = items.filter(
    (entry) => entry.status === "open" && entry.kind === "assumption"
  ).length;
  const openMissingPieceCount = items.filter(
    (entry) => entry.status === "open" && entry.kind === "missing_piece"
  ).length;
  const revalidationRequiredEntries = items.filter(
    (entry) =>
      entry.revalidationRequest?.status === "required" &&
      (entry.status === "open" || entry.status === "clarify_with_client")
  );

  return {
    openQuestionsCount,
    criticalOpenCount,
    nonCriticalOpenCount: Math.max(openQuestionsCount - criticalOpenCount, 0),
    clarifyWithClientCount,
    criticalClarifyWithClientCount,
    openAssumptionCount,
    openMissingPieceCount,
    revalidationRequired: revalidationRequiredEntries.length > 0,
    revalidationRequiredCount: revalidationRequiredEntries.length,
    criticalRevalidationRequiredCount: revalidationRequiredEntries.filter(
      (entry) => entry.severity === "critical"
    ).length,
    revalidationBlocksSubmission: revalidationRequiredEntries.length > 0,
  };
}

export function resolveTransitionPrompt(status: AffaireRegisterEntryStatus) {
  switch (status) {
    case "validated":
      return {
        title: "Valider cette entrée",
        description:
          "Expliquez si besoin pourquoi ce point est considéré comme traité ou acceptable.",
        actionLabel: "Confirmer la validation",
      };
    case "rejected":
      return {
        title: "Rejeter cette entrée",
        description:
          "Expliquez pourquoi ce point est écarté du workflow afin de garder une trace lisible.",
        actionLabel: "Confirmer le rejet",
      };
    case "clarify_with_client":
      return {
        title: "Marquer à clarifier avec le client",
        description:
          "Ajoutez le contexte à transmettre. Ce statut alertera la validation interne et bloquera l'envoi client.",
        actionLabel: "Confirmer la clarification client",
      };
    case "open":
      return {
        title: "Rouvrir cette entrée",
        description:
          "Ajoutez si besoin la raison de réouverture pour maintenir un historique clair.",
        actionLabel: "Confirmer la réouverture",
      };
  }
}

export function getEntryStatusActions(status: AffaireRegisterEntryStatus) {
  if (status === "validated" || status === "rejected") {
    return [{ label: "Rouvrir", nextStatus: "open" as const }];
  }

  if (status === "clarify_with_client") {
    return [
      { label: "Rouvrir", nextStatus: "open" as const },
      { label: "Valider", nextStatus: "validated" as const },
      { label: "Rejeter", nextStatus: "rejected" as const },
    ];
  }

  return [
    { label: "Valider", nextStatus: "validated" as const },
    { label: "Rejeter", nextStatus: "rejected" as const },
    { label: "À clarifier avec client", nextStatus: "clarify_with_client" as const },
  ];
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
