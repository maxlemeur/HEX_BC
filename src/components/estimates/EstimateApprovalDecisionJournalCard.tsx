"use client";

import { useEffect, useId, useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FieldLabel } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { useToast } from "@/components/ui-legacy/Toast";
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
    variant: NonNullable<BadgeProps["variant"]>;
  }
> = {
  approved: {
    label: "Approuvée",
    variant: "success",
  },
  approved_with_reservations: {
    label: "Approuvée sous réserve",
    variant: "warning",
  },
  changes_requested: {
    label: "Retour correction",
    variant: "danger",
  },
};

const SCOPE_LABELS = {
  project: "Affaire",
  lot: "Lot",
  line: "Ligne",
  exception: "Exception",
  hypothesis: "Hypothèse",
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

  return "Système";
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
  title = "Journal de décision",
}: Readonly<{
  versionId: string;
  initialJournal: EstimateApprovalDecisionJournal;
  title?: string;
}>) {
  const toast = useToast();
  const fieldId = useId();
  const authorSelectId = `${fieldId}-author`;
  const statusSelectId = `${fieldId}-status`;
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
              : "Impossible de charger le journal de décision."
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

  const hasActiveFilters = Boolean(selectedAuthor || selectedDecision);

  return (
    <Card className="min-w-0 overflow-hidden p-5" aria-busy={isPending}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-[14rem]">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Décisions historisées, filtrables par auteur et statut.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:justify-end">
          <Button
            variant="outline"
            size="sm"
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
          </Button>
          <Button
            variant="outline"
            size="sm"
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
                    title: "Export prêt",
                    description: "Le journal de décision a été exporté en CSV.",
                  });
                } catch (downloadError) {
                  toast.error({
                    title: "Export impossible",
                    description:
                      downloadError instanceof Error
                        ? downloadError.message
                        : "Impossible d'exporter le journal de décision.",
                  });
                } finally {
                  setIsExporting(false);
                }
              })();
            }}
          >
            {isExporting ? "Export…" : "Exporter en CSV"}
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <p
          className="basis-full rounded-lg border border-border-subtle bg-surface-subtle px-3 py-2 text-sm text-foreground-secondary"
          aria-live="polite"
        >
          {journal.events.length} décision
          {journal.events.length > 1 ? "s" : ""}
          {hasActiveFilters
            ? " visible(s) avec les filtres actifs."
            : " historisée(s) sur cette version."}
        </p>

        <div className="flex min-w-0 flex-1 basis-[180px] flex-col gap-2">
          <FieldLabel htmlFor={authorSelectId}>Auteur</FieldLabel>
          <NativeSelect
            id={authorSelectId}
            size="sm"
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
          </NativeSelect>
        </div>

        <div className="flex min-w-0 flex-1 basis-[180px] flex-col gap-2">
          <FieldLabel htmlFor={statusSelectId}>Statut</FieldLabel>
          <NativeSelect
            id={statusSelectId}
            size="sm"
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
          </NativeSelect>
        </div>
      </div>

      {error ? (
        <Alert variant="danger" className="mt-4">
          {error}
        </Alert>
      ) : null}

      {journal.events.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-5 text-sm text-foreground-secondary">
          {hasActiveFilters
            ? "Aucune décision ne correspond aux filtres actifs."
            : "Aucune décision d'approbation n'a encore été historisée pour cette version."}
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {journal.events.map((event) => {
            const meta = DECISION_META[event.decision];
            const actorLabel = resolveActorLabel({
              actorUserId: event.actorUserId,
              actorName: event.actorName,
            });

            return (
              <li
                key={event.id}
                className="rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      {event.cycleNumber !== null ? (
                        <Badge variant="neutral" size="sm">
                          Cycle {event.cycleNumber}
                        </Badge>
                      ) : null}
                    </div>

                    <p className="mt-2 break-words text-sm font-semibold text-foreground">
                      {event.perimeterLabel}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {actorLabel} · {formatDateTime(event.occurredAt)}
                    </p>
                  </div>

                  <div className="text-xs text-muted-foreground sm:text-right">
                    <p>{event.commentCount} commentaire{event.commentCount > 1 ? "s" : ""}</p>
                    <p>{event.scopeCount} portée{event.scopeCount > 1 ? "s" : ""}</p>
                  </div>
                </div>

                {event.rulesTriggered.length > 0 ? (
                  <ul className="mt-3 flex flex-wrap gap-2" aria-label="Règles déclenchées">
                    {event.rulesTriggered.map((rule) => (
                      <li key={`${event.id}-${rule.ruleId}`} className="max-w-full">
                        <Badge variant="outline" size="sm" className="max-w-full">
                          <span className="truncate">{rule.label}</span>
                        </Badge>
                        {rule.message ? <span className="sr-only">{` : ${rule.message}`}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {event.comments.length > 0 ? (
                  <ul className="mt-3 space-y-2">
                    {event.comments.map((comment, index) => (
                      <li
                        key={`${event.id}-${comment.scopeType}-${comment.scopeId ?? "project"}-${index}`}
                        className="rounded-lg border border-border-subtle bg-surface-subtle px-3 py-3"
                      >
                        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                          {SCOPE_LABELS[comment.scopeType]}
                        </p>
                        <p className="mt-1 break-words text-sm font-semibold text-foreground">
                          {comment.scopeLabel}
                        </p>
                        <p className="mt-2 break-words text-sm text-foreground-secondary">
                          {comment.comment}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
