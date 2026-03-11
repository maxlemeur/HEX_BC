import {
  AFFAIRE_REGISTER_KIND_LABELS,
  AFFAIRE_REGISTER_ORIGIN_LABELS,
  AFFAIRE_REGISTER_SCOPE_LABELS,
  AFFAIRE_REGISTER_SEVERITY_LABELS,
  AFFAIRE_REGISTER_STATUS_LABELS,
  type AffaireRegisterEntry,
  type AffaireRegisterEntryStatus,
} from "@/lib/affaires/register";

import {
  formatDateTime,
  getEntryStatusActions,
  SEVERITY_TONE,
  STATUS_TONE,
} from "./registerViewModel";

type RegisterEntryListProps = {
  items: AffaireRegisterEntry[];
  hasActiveFilters: boolean;
  isReadOnly: boolean;
  isMutationPending: boolean;
  pendingEntryId: string | null;
  onOpenTransitionDialog: (
    entry: AffaireRegisterEntry,
    status: AffaireRegisterEntryStatus
  ) => void;
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
  onOpenTransitionDialog: (
    targetEntry: AffaireRegisterEntry,
    status: AffaireRegisterEntryStatus
  ) => void;
}>) {
  const isPendingEntry = isMutationPending && pendingEntryId === entry.id;

  return (
    <article className="rounded-2xl border border-[var(--slate-200)] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
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
          </div>
          <p className="mt-3 text-sm text-[var(--slate-800)]">{entry.text}</p>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--slate-500)]">
            <span>
              Scope: {AFFAIRE_REGISTER_SCOPE_LABELS[entry.scopeType]} · {entry.scopeLabel}
            </span>
            <span>Origine: {AFFAIRE_REGISTER_ORIGIN_LABELS[entry.originKind]}</span>
            <span>
              MAJ: {formatDateTime(entry.updatedAt)}
              {entry.updatedByName ? ` · ${entry.updatedByName}` : ""}
            </span>
            {entry.sourceFileName ? <span>Source: {entry.sourceFileName}</span> : null}
          </div>
        </div>
        <div className="w-full max-w-sm rounded-2xl border border-[var(--slate-200)] bg-[var(--slate-50)]/80 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--slate-500)]">
            Prochaine action
          </p>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            {entry.status === "open"
              ? "Choisissez l'issue du point ou marquez un retour client requis."
              : entry.status === "clarify_with_client"
                ? "Ce point reste en attente d'un retour client avant envoi."
                : "Ce point est clos. Rouvrez-le si le contexte change."}
          </p>
          {!isReadOnly ? (
            <div className="mt-3 flex flex-wrap gap-2" aria-label="Actions de statut">
              {getEntryStatusActions(entry.status).map((action) => (
                <button
                  key={action.nextStatus}
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={isPendingEntry}
                  onClick={() => onOpenTransitionDialog(entry, action.nextStatus)}
                >
                  {action.label}
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
        <div className="rounded-2xl border border-dashed border-[var(--slate-200)] bg-[var(--slate-50)]/70 px-4 py-8 text-center">
          <p className="text-sm font-medium text-[var(--slate-700)]">
            {hasActiveFilters
              ? "Aucun point ne correspond à ces filtres."
              : "Aucun point du registre sur cette vue pour le moment."}
          </p>
          <p className="mt-2 text-sm text-[var(--slate-500)]">
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
