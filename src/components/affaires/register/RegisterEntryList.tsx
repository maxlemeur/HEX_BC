"use client";

import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";

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
  getRegisterEntryImpact,
} from "./registerViewModel";

type RegisterEntryListProps = {
  items: AffaireRegisterEntry[];
  hasActiveFilters: boolean;
  isReadOnly: boolean;
  isMutationPending: boolean;
  pendingEntryId: string | null;
  focusedEntryId?: string | null;
  onOpenTransitionDialog: (transition: PendingTransition) => void;
};

function RegisterEntryRow({
  entry,
  isReadOnly,
  isMutationPending,
  pendingEntryId,
  expanded,
  onToggle,
  onOpenTransitionDialog,
}: Readonly<Omit<RegisterEntryListProps, "items" | "hasActiveFilters" | "focusedEntryId"> & {
  entry: AffaireRegisterEntry;
  expanded: boolean;
  onToggle: () => void;
}>) {
  const detailsId = useId();
  const isPendingEntry = isMutationPending && pendingEntryId === entry.id;
  const impact = getRegisterEntryImpact(entry);
  const statusPanel = getEntryStatusPanel(entry);

  return (
    <article className="register-entry" data-blocking={impact.blocking || undefined}>
      <button
        type="button"
        className="register-entry-toggle"
        aria-label={(isReadOnly ? "Consulter " : "Traiter ") + entry.text}
        aria-describedby={detailsId + "-kind " + detailsId + "-impact"}
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={onToggle}
      >
        <span className="register-entry-label">
          <span className="register-entry-title">{entry.text}</span>
          <span id={detailsId + "-kind"} className="register-entry-kind">{AFFAIRE_REGISTER_KIND_LABELS[entry.kind]}</span>
        </span>
        <span id={detailsId + "-impact"} className="register-entry-impact">{impact.label}</span>
        <span className="register-entry-affordance">
          {impact.blocking ? <span className="register-treat-label">{isReadOnly ? "Consulter" : "Traiter"}</span> : null}
          <ChevronRight size={18} aria-hidden="true" />
        </span>
      </button>
      <div id={detailsId} hidden={!expanded} className="register-entry-details">
        <div className="register-entry-metadata">
          <span>{AFFAIRE_REGISTER_SEVERITY_LABELS[entry.severity]}</span>
          <span>{getEntryStatusLabel(entry)}</span>
        </div>
        <p className="text-sm text-foreground-secondary">{getEntryContextSummary(entry)}</p>
        <dl className="register-context">
          {getEntryContextTags(entry).map((tag) => (
            <div key={tag.label}><dt>{tag.label}</dt><dd>{tag.value}</dd></div>
          ))}
          <div><dt>Mis à jour</dt><dd>{formatDateTime(entry.updatedAt)}{entry.updatedByName ? " · " + entry.updatedByName : ""}</dd></div>
        </dl>
        <div className="register-entry-decision">
          <h3>{statusPanel.title}</h3>
          <p>{statusPanel.description}</p>
          {statusPanel.note ? (
            <p className="register-entry-note"><strong>{statusPanel.note.label}</strong>{statusPanel.note.value}</p>
          ) : null}
          {!isReadOnly ? (
            <div className="register-entry-actions" aria-label="Actions de statut">
              {getEntryStatusActions(entry).map((action) => (
                <button
                  key={action.key}
                  type="button"
                  data-tone={action.tone}
                  disabled={isPendingEntry}
                  onClick={() => onOpenTransitionDialog(action.transition)}
                >
                  <span>{action.label}</span>
                  <span>{action.description}</span>
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
  focusedEntryId,
  ...props
}: Readonly<RegisterEntryListProps>) {
  const [expandedId, setExpandedId] = useState<string | null>(focusedEntryId ?? null);
  const sortedItems = [...items].sort((left, right) => getRegisterEntryImpact(left).rank - getRegisterEntryImpact(right).rank);

  if (items.length === 0) {
    return (
      <div className="register-empty">
        <p>{hasActiveFilters ? "Aucun point ne correspond à ces filtres." : "Aucun point à traiter pour le moment."}</p>
        <p>{hasActiveFilters ? "Revenez à Tous pour consulter l’ensemble du registre." : "Les hypothèses et pièces manquantes apparaîtront ici."}</p>
      </div>
    );
  }

  return (
    <div className="register-list">
      <div className="register-list-head" aria-hidden="true"><span>Point</span><span>Impact</span><span /></div>
      {sortedItems.map((entry) => (
        <RegisterEntryRow
          key={entry.id}
          entry={entry}
          expanded={expandedId === entry.id}
          onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
          {...props}
        />
      ))}
    </div>
  );
}
