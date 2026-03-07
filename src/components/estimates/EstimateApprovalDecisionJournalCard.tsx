"use client";

import { useEffect, useState, useTransition } from "react";

import { useToast } from "@/components/ui/Toast";
import {
  downloadEstimateApprovalDecisionJournalCsv,
  fetchEstimateApprovalDecisionJournal,
} from "@/lib/estimates/client";
import type {
  EstimateApprovalDecisionFilter,
  EstimateApprovalDecisionJournal,
} from "@/lib/estimates/approval-decision-journal";
import {
  APPROVAL_DECISION_JOURNAL_AUTHOR_QUERY_PARAM,
  APPROVAL_DECISION_JOURNAL_STATUS_QUERY_PARAM,
} from "@/lib/estimates/approval-decision-journal";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const DECISION_META: Record<
  EstimateApprovalDecisionFilter,
  {
    label: string;
    className: string;
  }
> = {
  approved: {
    label: "Approuvee",
    className: "bg-[var(--success)]/10 text-[var(--success)]",
  },
  approved_with_reservations: {
    label: "Approuvee sous reserve",
    className: "bg-[var(--warning-light)] text-[var(--warning)]",
  },
  changes_requested: {
    label: "Retour correction",
    className: "bg-[var(--danger)]/10 text-[var(--danger)]",
  },
};

const SCOPE_LABELS = {
  project: "Affaire",
  lot: "Lot",
  line: "Ligne",
  exception: "Exception",
  hypothesis: "Hypothese",
  approval_rule: "Exception",
} as const;

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return DATE_TIME_FORMATTER.format(date);
}

function resolveActorLabel(input: {
  actorUserId: string | null;
  actorName: string | null;
}) {
  if (input.actorName && input.actorName.trim().length > 0) {
    return input.actorName;
  }

  if (input.actorUserId) {
    return `Utilisateur ${input.actorUserId.slice(0, 8)}`;
  }

  return "Systeme";
}

function parseDecisionFilter(value: string | null): EstimateApprovalDecisionFilter | "" {
  switch (value) {
    case "approved":
    case "approved_with_reservations":
    case "changes_requested":
      return value;
    default:
      return "";
  }
}

export function EstimateApprovalDecisionJournalCard({
  versionId,
  initialJournal,
  title = "Journal de decision",
}: Readonly<{
  versionId: string;
  initialJournal: EstimateApprovalDecisionJournal;
  title?: string;
}>) {
  const toast = useToast();
  const [journal, setJournal] = useState(initialJournal);
  const [selectedAuthor, setSelectedAuthor] = useState(
    initialJournal.filters.actorUserId ?? ""
  );
  const [selectedDecision, setSelectedDecision] = useState(
    initialJournal.filters.decision ?? ""
  );
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setJournal(initialJournal);
    setSelectedAuthor(initialJournal.filters.actorUserId ?? "");
    setSelectedDecision(initialJournal.filters.decision ?? "");
    setError(null);
  }, [initialJournal]);

  function loadJournal(nextFilters?: {
    authorUserId?: string | null;
    decision?: EstimateApprovalDecisionFilter | null;
  }) {
    startTransition(() => {
      void (async () => {
        try {
          const nextJournal = await fetchEstimateApprovalDecisionJournal(versionId, {
            authorUserId:
              nextFilters?.authorUserId !== undefined
                ? nextFilters.authorUserId
                : selectedAuthor || null,
            decision:
              nextFilters?.decision !== undefined
                ? nextFilters.decision
                : ((selectedDecision as EstimateApprovalDecisionFilter | "") || null),
          });

          setJournal(nextJournal);
          setError(null);
        } catch (loadError) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Impossible de charger le journal de decision."
          );
        }
      })();
    });
  }

  function updateUrlFilters(nextFilters: {
    authorUserId?: string | null;
    decision?: EstimateApprovalDecisionFilter | null;
  }) {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    const nextAuthor = nextFilters.authorUserId ?? null;
    const nextDecision = nextFilters.decision ?? null;

    if (nextAuthor) {
      params.set(APPROVAL_DECISION_JOURNAL_AUTHOR_QUERY_PARAM, nextAuthor);
    } else {
      params.delete(APPROVAL_DECISION_JOURNAL_AUTHOR_QUERY_PARAM);
    }

    if (nextDecision) {
      params.set(APPROVAL_DECISION_JOURNAL_STATUS_QUERY_PARAM, nextDecision);
    } else {
      params.delete(APPROVAL_DECISION_JOURNAL_STATUS_QUERY_PARAM);
    }

    const nextSearch = params.toString();
    const nextUrl = nextSearch
      ? `${window.location.pathname}?${nextSearch}`
      : window.location.pathname;
    window.history.replaceState(window.history.state, "", nextUrl);
  }

  function applyFilters(nextFilters: {
    authorUserId?: string | null;
    decision?: EstimateApprovalDecisionFilter | null;
  }) {
    setSelectedAuthor(nextFilters.authorUserId ?? "");
    setSelectedDecision(nextFilters.decision ?? "");
    setError(null);
    updateUrlFilters(nextFilters);
    loadJournal(nextFilters);
  }

  return (
    <section
      className="dashboard-card min-w-0 overflow-hidden p-5"
      aria-busy={isPending}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-[14rem]">
          <h2 className="text-sm font-semibold text-[var(--slate-800)]">{title}</h2>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            Decisions historisees, filtrables par auteur et statut.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={isPending}
            onClick={() =>
              loadJournal({
                authorUserId: selectedAuthor || null,
                decision:
                  (selectedDecision as EstimateApprovalDecisionFilter | "") || null,
              })
            }
          >
            {isPending ? "Chargement…" : "Actualiser"}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={isExporting || journal.events.length === 0}
            onClick={() => {
              setIsExporting(true);
              void (async () => {
                try {
                  await downloadEstimateApprovalDecisionJournalCsv(versionId, {
                    authorUserId: selectedAuthor || null,
                    decision:
                      (selectedDecision as EstimateApprovalDecisionFilter | "") || null,
                  });
                  toast.success({
                    title: "Export pret",
                    description: "Le journal de decision a ete exporte en CSV.",
                  });
                } catch (downloadError) {
                  toast.error({
                    title: "Export impossible",
                    description:
                      downloadError instanceof Error
                        ? downloadError.message
                        : "Impossible d'exporter le journal de decision.",
                  });
                } finally {
                  setIsExporting(false);
                }
              })();
            }}
          >
            {isExporting ? "Export…" : "Exporter CSV"}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <div
          className="basis-full rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-3 py-2 text-sm text-[var(--slate-600)]"
          aria-live="polite"
        >
          {journal.events.length} decision
          {journal.events.length > 1 ? "s" : ""}
          {selectedAuthor || selectedDecision
            ? " visible(s) avec les filtres actifs."
            : " historique(s) sur cette version."}
        </div>

        <label className="flex min-w-0 flex-1 basis-[180px] flex-col gap-1 text-sm text-[var(--slate-700)]">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
            Auteur
          </span>
          <select
            className="input w-full min-w-0"
            name="approval-journal-author"
            value={selectedAuthor}
            disabled={isPending}
            onChange={(event) => {
              const nextAuthor = event.target.value;
              applyFilters({
                authorUserId: nextAuthor || null,
                decision:
                  (selectedDecision as EstimateApprovalDecisionFilter | "") || null,
              });
            }}
          >
            <option value="">Tous les auteurs</option>
            {journal.availableAuthors.map((author) => (
              <option key={author.userId} value={author.userId}>
                {author.actorName}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-0 flex-1 basis-[180px] flex-col gap-1 text-sm text-[var(--slate-700)]">
          <span className="text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
            Statut
          </span>
          <select
            className="input w-full min-w-0"
            name="approval-journal-status"
            value={selectedDecision}
            disabled={isPending}
            onChange={(event) => {
              const nextDecision = parseDecisionFilter(event.target.value);
              applyFilters({
                authorUserId: selectedAuthor || null,
                decision: nextDecision || null,
              });
            }}
          >
            <option value="">Tous les statuts</option>
            {Object.entries(DECISION_META).map(([decision, meta]) => (
              <option key={decision} value={decision}>
                {meta.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? (
        <div className="alert alert-error mt-4">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="m15 9-6 6" />
            <path d="m9 9 6 6" />
          </svg>
          {error}
        </div>
      ) : null}

      {journal.events.length === 0 ? (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-5 text-sm text-[var(--slate-600)]">
          {selectedAuthor || selectedDecision
            ? "Aucune decision ne correspond aux filtres actifs."
            : "Aucune decision d'approbation n'a encore ete historisee pour cette version."}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {journal.events.map((event) => {
            const meta = DECISION_META[event.decision];
            const actorLabel = resolveActorLabel({
              actorUserId: event.actorUserId,
              actorName: event.actorName,
            });

            return (
              <article
                key={event.id}
                className="rounded-xl border border-[var(--slate-200)] bg-white/90 px-4 py-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${meta.className}`}
                      >
                        {meta.label}
                      </span>
                      {event.cycleNumber !== null ? (
                        <span className="rounded-full bg-[var(--slate-100)] px-2 py-0.5 text-[11px] font-medium text-[var(--slate-600)]">
                          Cycle {event.cycleNumber}
                        </span>
                      ) : null}
                    </div>

                    <p className="mt-2 text-sm font-semibold text-[var(--slate-800)]">
                      {event.perimeterLabel}
                    </p>
                    <p className="mt-1 text-xs text-[var(--slate-500)]">
                      {actorLabel} · {formatDateTime(event.occurredAt)}
                    </p>
                  </div>

                  <div className="text-right text-xs text-[var(--slate-500)]">
                    <p>{event.commentCount} commentaire{event.commentCount > 1 ? "s" : ""}</p>
                    <p>{event.scopeCount} portee{event.scopeCount > 1 ? "s" : ""}</p>
                  </div>
                </div>

                {event.rulesTriggered.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {event.rulesTriggered.map((rule) => (
                      <span
                        key={`${event.id}-${rule.ruleId}`}
                        className="rounded-full bg-[var(--slate-100)] px-2 py-0.5 text-[11px] font-medium text-[var(--slate-600)]"
                        title={rule.message}
                      >
                        {rule.label}
                      </span>
                    ))}
                  </div>
                ) : null}

                {event.comments.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {event.comments.map((comment, index) => (
                      <div
                        key={`${event.id}-${comment.scopeType}-${comment.scopeId ?? "project"}-${index}`}
                        className="rounded-lg border border-[var(--slate-200)] bg-[var(--slate-50)] px-3 py-3"
                      >
                        <p className="text-xs font-medium uppercase tracking-wider text-[var(--slate-500)]">
                          {SCOPE_LABELS[comment.scopeType]}
                        </p>
                        <p className="mt-1 text-sm font-semibold text-[var(--slate-800)]">
                          {comment.scopeLabel}
                        </p>
                        <p className="mt-2 text-sm text-[var(--slate-700)]">
                          {comment.comment}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
