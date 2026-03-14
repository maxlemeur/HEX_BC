import {
  AFFAIRE_REGISTER_KIND_LABELS,
  AFFAIRE_REGISTER_REVALIDATION_IMPACTED_STAGE_LABELS,
  AFFAIRE_REGISTER_SCOPE_LABELS,
  AFFAIRE_REGISTER_SEVERITY_LABELS,
  AFFAIRE_REGISTER_STATUS_LABELS,
  isAffaireRegisterEntryRevalidationRequired,
  type AffaireRegisterEntry,
  type AffaireRegisterBusinessImpact,
  type AffaireRegisterEntryKind,
  type AffaireRegisterEntrySeverity,
  type AffaireRegisterEntryStatus,
  type AffaireRegisterSummary,
} from "@/lib/affaires/register";

import { formatDateTime, SEVERITY_TONE, STATUS_TONE } from "./registerViewModel";

const BUSINESS_IMPACT_LABELS: Record<AffaireRegisterBusinessImpact, string> = {
  affects_hub_readiness: "Affecte le travail",
  blocks_submission: "Bloque la remise",
  affects_structure_generation: "Impacte la structure",
  affects_takeoff: "Impacte le metre",
  requires_client_answer: "Réponse client attendue",
};

type RegisterSubmissionBlockersProps = {
  items: AffaireRegisterEntry[];
  summary: AffaireRegisterSummary;
  onApplyFilters: (next: {
    status?: AffaireRegisterEntryStatus | null;
    severity?: AffaireRegisterEntrySeverity | null;
    kind?: AffaireRegisterEntryKind | null;
    revalidationRequired?: boolean;
    cursor?: string | null;
  }) => void;
};

type RegisterBlockerFilters = {
  status?: AffaireRegisterEntryStatus | null;
  severity?: AffaireRegisterEntrySeverity | null;
  kind?: AffaireRegisterEntryKind | null;
  revalidationRequired?: boolean;
  cursor?: string | null;
};

function entryHasImpact(
  entry: AffaireRegisterEntry,
  impact: AffaireRegisterBusinessImpact,
) {
  return entry.businessImpact?.includes(impact) ?? false;
}

function isRevalidationBlockingEntry(entry: AffaireRegisterEntry) {
  return (
    entry.revalidationRequest?.status === "required" &&
    (entry.status === "open" || entry.status === "clarify_with_client")
  );
}

function getBlockingEntryState(entry: AffaireRegisterEntry) {
  if (isRevalidationBlockingEntry(entry)) {
    return {
      rank: entry.severity === "critical" ? 0 : 1,
      badgeLabel: "Revalidation requise",
      badgeClass: "bg-[var(--danger)]/10 text-[var(--danger)]",
      message: "Une nouvelle revue ciblee est requise avant remise.",
      resolutionHint: "Pour debloquer: relancer la revue ciblee demandee.",
      actionLabel: "Voir les revalidations",
      filters: {
        status: null,
        severity: null,
        kind: null,
        revalidationRequired: true,
        cursor: null,
      } satisfies RegisterBlockerFilters,
    };
  }

  if (entryHasImpact(entry, "blocks_submission")) {
    return {
      rank: entry.status === "clarify_with_client" ? 3 : 2,
      badgeLabel: BUSINESS_IMPACT_LABELS.blocks_submission,
      badgeClass: "bg-[var(--danger)]/10 text-[var(--danger)]",
      message:
        entry.status === "clarify_with_client"
          ? "Ce point bloque la remise tant qu'un retour client critique manque."
          : "Ce point bloque la remise tant qu'il reste ouvert.",
      resolutionHint:
        entry.kind === "missing_piece"
          ? "Pour debloquer: ajouter la piece attendue ou requalifier ce manque."
          : "Pour debloquer: traiter l'hypothese puis la faire sortir des ouverts.",
      actionLabel:
        entry.kind === "missing_piece" ? "Voir les pièces manquantes" : "Voir les hypothèses",
      filters: {
        status: entry.status,
        severity: entry.severity === "critical" ? ("critical" as const) : null,
        kind: entry.kind,
        revalidationRequired: false,
        cursor: null,
      } satisfies RegisterBlockerFilters,
    };
  }

  if (
    entryHasImpact(entry, "requires_client_answer") ||
    entry.status === "clarify_with_client"
  ) {
    return {
      rank: entry.severity === "critical" ? 4 : 5,
      badgeLabel: "Réponse client attendue",
      badgeClass: "bg-[var(--brand-blue)]/10 text-[var(--brand-blue)]",
      message: "La suite dépend encore d'un retour client explicite.",
      resolutionHint:
        "Pour debloquer: consigner le retour client puis requalifier ce point.",
      actionLabel: "Voir les clarifications client",
      filters: {
        status: "clarify_with_client" as const,
        severity: null,
        kind: entry.kind,
        revalidationRequired: false,
        cursor: null,
      } satisfies RegisterBlockerFilters,
    };
  }

  if (entry.status === "open" && entry.severity === "critical") {
    return {
      rank: 6,
      badgeLabel: "Point critique ouvert",
      badgeClass: "bg-[var(--danger)]/10 text-[var(--danger)]",
      message: "Ce point critique reste a arbitrer avant remise.",
      resolutionHint: "Pour debloquer: arbitrer ce point puis le faire sortir des ouverts.",
      actionLabel:
        entry.kind === "missing_piece" ? "Voir les pièces manquantes" : "Voir les hypothèses",
      filters: {
        status: "open" as const,
        severity: "critical" as const,
        kind: entry.kind,
        revalidationRequired: false,
        cursor: null,
      } satisfies RegisterBlockerFilters,
    };
  }

  return null;
}

function isBlockingEntry(entry: AffaireRegisterEntry) {
  return getBlockingEntryState(entry) !== null;
}

function getBlockingRank(entry: AffaireRegisterEntry) {
  return getBlockingEntryState(entry)?.rank ?? Number.MAX_SAFE_INTEGER;
}

function getBlockingEntries(items: AffaireRegisterEntry[]) {
  return items
    .filter((entry) => isBlockingEntry(entry))
    .sort((left, right) => {
      const leftRank = getBlockingRank(left);
      const rightRank = getBlockingRank(right);
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    });
}

export function RegisterSubmissionBlockers({
  items,
  summary,
  onApplyFilters,
}: Readonly<RegisterSubmissionBlockersProps>) {
  const blockingEntries = getBlockingEntries(items);
  const revalidationBlockingCount =
    summary.revalidationBlocksSubmission
      ? summary.revalidationRequiredCount ?? 0
      : 0;
  const hasBlockingState =
    summary.criticalOpenCount > 0 ||
    summary.clarifyWithClientCount > 0 ||
    revalidationBlockingCount > 0;
  const visibleStandardWorkflowEntries = items.filter(
    (entry) => !isAffaireRegisterEntryRevalidationRequired(entry),
  );
  const visibleCriticalOpenCount = visibleStandardWorkflowEntries.filter(
    (entry) => entry.status === "open" && entry.severity === "critical",
  ).length;
  const visibleClarifyWithClientCount = visibleStandardWorkflowEntries.filter(
    (entry) => entry.status === "clarify_with_client",
  ).length;
  const visibleRevalidationBlockingCount = items.filter((entry) =>
    isRevalidationBlockingEntry(entry),
  ).length;
  const hasMoreBlockingEntries =
    blockingEntries.length > 3 ||
    summary.criticalOpenCount > visibleCriticalOpenCount ||
    summary.clarifyWithClientCount > visibleClarifyWithClientCount ||
    revalidationBlockingCount > visibleRevalidationBlockingCount;
  const shouldShowRevalidationSummary =
    revalidationBlockingCount > 0 && visibleRevalidationBlockingCount === 0;
  const revalidationStages = (summary.revalidationImpactedStages ?? [])
    .map((stage) => AFFAIRE_REGISTER_REVALIDATION_IMPACTED_STAGE_LABELS[stage])
    .filter(Boolean)
    .join(" + ");

  if (!hasBlockingState) {
    return null;
  }

  return (
    <section className="mt-4 rounded-2xl border border-[var(--danger)]/15 bg-[linear-gradient(180deg,rgba(255,247,237,0.98),rgba(255,255,255,0.96))] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--slate-800)]">
            À traiter avant remise
          </h3>
          <p className="mt-1 text-sm leading-6 text-[var(--slate-600)]">
            Blocages actifs: {summary.criticalOpenCount} critique
            {summary.criticalOpenCount !== 1 ? "s" : ""} ouverte
            {summary.criticalOpenCount !== 1 ? "s" : ""} ·{" "}
            {summary.clarifyWithClientCount} clarification
            {summary.clarifyWithClientCount !== 1 ? "s" : ""} client ·{" "}
            {revalidationBlockingCount} revalidation
            {revalidationBlockingCount !== 1 ? "s" : ""} requise
            {revalidationBlockingCount !== 1 ? "s" : ""}.
          </p>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            Ce bloc distingue ce qui bloque vraiment la remise de ce qui appelle encore une action client.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {summary.criticalOpenCount > 0 ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                onApplyFilters({
                  status: "open",
                  severity: "critical",
                  kind: null,
                  revalidationRequired: false,
                  cursor: null,
                })
              }
            >
              Voir les critiques
            </button>
          ) : null}
          {summary.clarifyWithClientCount > 0 ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                onApplyFilters({
                  status: "clarify_with_client",
                  severity: null,
                  kind: null,
                  revalidationRequired: false,
                  cursor: null,
                })
              }
            >
              Voir les clarifications client
            </button>
          ) : null}
        </div>
      </div>

      {shouldShowRevalidationSummary ? (
        <div className="mt-4 rounded-2xl border border-[var(--danger)]/20 bg-white/80 px-4 py-3 text-sm text-[var(--slate-700)]">
          <p className="font-medium text-[var(--slate-900)]">
            {revalidationBlockingCount} revalidation
            {revalidationBlockingCount > 1 ? "s" : ""} requise
            {revalidationBlockingCount > 1 ? "s" : ""} bloque
            {revalidationBlockingCount > 1 ? "nt" : ""} encore la remise.
          </p>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            {revalidationStages
              ? `Impacts a revoir: ${revalidationStages}.`
              : "Un additif ou une piece critique recue tardivement impose une nouvelle revue avant remise."}
          </p>
          <div className="mt-3">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                onApplyFilters({
                  status: null,
                  severity: null,
                  kind: null,
                  revalidationRequired: true,
                  cursor: null,
                })
              }
            >
              Voir les revalidations
            </button>
          </div>
        </div>
      ) : null}

      {blockingEntries.length > 0 ? (
        <div className="mt-4 grid gap-3">
          {blockingEntries.slice(0, 3).map((entry) => {
            const blockingState = getBlockingEntryState(entry);

            if (!blockingState) {
              return null;
            }

            return (
              <article
                key={entry.id}
                className="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-[0_10px_30px_rgba(15,23,42,0.06)]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-[var(--slate-100)] px-2.5 py-1 text-xs font-medium text-[var(--slate-600)]">
                    {AFFAIRE_REGISTER_KIND_LABELS[entry.kind]}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${SEVERITY_TONE[entry.severity]}`}
                  >
                    {AFFAIRE_REGISTER_SEVERITY_LABELS[entry.severity]}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_TONE[entry.status]}`}
                  >
                    {AFFAIRE_REGISTER_STATUS_LABELS[entry.status]}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${blockingState.badgeClass}`}
                  >
                    {blockingState.badgeLabel}
                  </span>
                </div>
                <p className="mt-3 text-sm font-medium text-[var(--slate-900)]">
                  {entry.text}
                </p>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--slate-500)]">
                  <span>
                    Contexte: {AFFAIRE_REGISTER_SCOPE_LABELS[entry.scopeType]} ·{" "}
                    {entry.scopeLabel}
                  </span>
                  {entry.sourceFileName ? <span>Source: {entry.sourceFileName}</span> : null}
                  <span>MAJ: {formatDateTime(entry.updatedAt)}</span>
                </div>
                <p className="mt-3 text-xs font-medium text-[var(--danger)]">
                  {blockingState.message}
                </p>
                <p className="mt-1 text-xs text-[var(--slate-600)]">
                  {blockingState.resolutionHint}
                </p>
                <div className="mt-3">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => onApplyFilters(blockingState.filters)}
                  >
                    {blockingState.actionLabel}
                  </button>
                </div>
              </article>
            );
          })}

          {hasMoreBlockingEntries ? (
            <div className="rounded-xl border border-dashed border-[var(--danger)]/20 bg-white/70 px-3 py-2 text-sm text-[var(--slate-600)]">
              D&apos;autres points bloquants existent sur cette vue ou une autre tranche du registre.
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--danger)]/20 bg-white/70 px-3 py-3 text-sm text-[var(--slate-600)]">
          Ces points bloquants ne sont pas visibles dans la vue courante. Utilisez les filtres
          pour les traiter en priorité.
        </div>
      )}
    </section>
  );
}
