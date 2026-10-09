import {
  AFFAIRE_REGISTER_KIND_LABELS,
  AFFAIRE_REGISTER_SEVERITY_LABELS,
  type AffaireRegisterEntry,
} from "@/lib/affaires/register";

import type { PendingTransition } from "./registerTypes";
import {
  formatDateTime,
  getEntryContextSummary,
  getEntryContextTags,
  getEntryStatusLabel,
  getEntryStatusPanel,
  getEntryStatusActions,
  getEntryStatusTone,
  SEVERITY_TONE,
} from "./registerViewModel";

type RegisterEntryListProps = {
  items: AffaireRegisterEntry[];
  hasActiveFilters: boolean;
  isReadOnly: boolean;
  isMutationPending: boolean;
  pendingEntryId: string | null;
  onOpenTransitionDialog: (transition: PendingTransition) => void;
};

function RegisterEntryCard({
  entry,
  isReadOnly,
  isMutationPending,
  pendingEntryId,
  onOpenTransitionDialog,
}: Readonly<{
  entry: AffaireRegisterEntry;
  isReadOnly: boolean;
  isMutationPending: boolean;
  pendingEntryId: string | null;
  onOpenTransitionDialog: (transition: PendingTransition) => void;
}>) {
  const isPendingEntry = isMutationPending && pendingEntryId === entry.id;
  const statusPanel = getEntryStatusPanel(entry);

  return (
    <article className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-slate-600">
              {AFFAIRE_REGISTER_KIND_LABELS[entry.kind]}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${SEVERITY_TONE[entry.severity]}`}
            >
              {AFFAIRE_REGISTER_SEVERITY_LABELS[entry.severity]}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium ${getEntryStatusTone(entry)}`}
            >
              {getEntryStatusLabel(entry)}
            </span>
          </div>
          <p className="mt-3 text-sm text-slate-800">{entry.text}</p>
          <div className="mt-3 rounded-2xl border border-border bg-surface-subtle/80 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Contexte métier
            </p>
            <p className="mt-1 text-sm text-foreground-secondary">
              {getEntryContextSummary(entry)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {getEntryContextTags(entry).map((tag) => (
                <span
                  key={`${entry.id}-${tag.label}`}
                  className="rounded-full border border-border bg-surface px-2.5 py-1 text-xs text-slate-600"
                >
                  <span className="font-medium text-foreground-secondary">{tag.label}</span>
                  {` · ${tag.value}`}
                </span>
              ))}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              MAJ: {formatDateTime(entry.updatedAt)}
              {entry.updatedByName ? ` · ${entry.updatedByName}` : ""}
            </span>
          </div>
        </div>
        <div className="w-full max-w-sm rounded-2xl border border-border bg-surface-subtle/80 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {statusPanel.title}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {statusPanel.description}
          </p>
          {statusPanel.note ? (
            <div className="mt-3 rounded-xl border border-primary/15 bg-surface/80 px-3 py-2 text-xs text-slate-600">
              <p className="font-medium text-foreground-secondary">
                {statusPanel.note.label}
              </p>
              <p className="mt-1">{statusPanel.note.value}</p>
            </div>
          ) : null}
          {!isReadOnly ? (
            <div className="mt-3 grid gap-2" aria-label="Actions de statut">
              {getEntryStatusActions(entry).map((action) => (
                <button
                  key={action.key}
                  type="button"
                  className={`rounded-2xl border px-3 py-3 text-left transition ${
                    action.tone === "success"
                      ? "border-success/20 bg-success/5 hover:border-success/35"
                      : action.tone === "danger"
                        ? "border-danger/20 bg-danger/5 hover:border-danger/35"
                        : action.tone === "brand"
                          ? "border-primary/20 bg-primary/5 hover:border-primary/35"
                          : "border-border bg-surface hover:border-border-strong"
                  } disabled:cursor-not-allowed disabled:opacity-60`}
                  disabled={isPendingEntry}
                  onClick={() => onOpenTransitionDialog(action.transition)}
                >
                  <span className="block text-sm font-medium text-slate-800">
                    {action.label}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {action.description}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

export function RegisterEntryList({
  items,
  hasActiveFilters,
  isReadOnly,
  isMutationPending,
  pendingEntryId,
  onOpenTransitionDialog,
}: Readonly<RegisterEntryListProps>) {
  return (
    <div className="mt-4 space-y-3">
      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface-subtle/70 px-4 py-8 text-center">
          <p className="text-sm font-medium text-foreground-secondary">
            {hasActiveFilters
              ? "Aucun point ne correspond à ces filtres."
              : "Aucun point du registre sur cette vue pour le moment."}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {hasActiveFilters
              ? "Réinitialisez les filtres pour revenir à l'ensemble du registre."
              : isReadOnly
                ? "Les futures hypothèses, pièces manquantes et transitions apparaîtront ici."
                : "Ajoutez une hypothèse ou une pièce manquante pour démarrer une trace exploitable."}
          </p>
        </div>
      ) : (
        items.map((entry) => (
          <RegisterEntryCard
            key={entry.id}
            entry={entry}
            isReadOnly={isReadOnly}
            isMutationPending={isMutationPending}
            pendingEntryId={pendingEntryId}
            onOpenTransitionDialog={onOpenTransitionDialog}
          />
        ))
      )}
    </div>
  );
}
