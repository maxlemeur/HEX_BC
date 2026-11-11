"use client";

import { useId, useState } from "react";
import { Funnel } from "lucide-react";

import {
  AFFAIRE_REGISTER_KIND_LABELS,
  AFFAIRE_REGISTER_SEVERITY_LABELS,
  AFFAIRE_REGISTER_STATUS_LABELS,
  type AffaireRegisterEntryKind,
  type AffaireRegisterEntrySeverity,
  type AffaireRegisterEntryStatus,
} from "@/lib/affaires/register";
import type { RegisterFilters } from "./registerTypes";

type RegisterFiltersBarProps = {
  filterStatus: string;
  filterSeverity: string;
  filterKind: string;
  filterRevalidationRequired: boolean;
  filterBlockingOnly: boolean;
  blockingCount: number;
  hasActiveFilters: boolean;
  onApplyFilters: (next: RegisterFilters) => void;
  onResetFilters: () => void;
};

export function RegisterFiltersBar({
  filterStatus,
  filterSeverity,
  filterKind,
  filterRevalidationRequired,
  filterBlockingOnly,
  blockingCount,
  hasActiveFilters,
  onApplyFilters,
  onResetFilters,
}: Readonly<RegisterFiltersBarProps>) {
  const [expanded, setExpanded] = useState(false);
  const filtersId = useId();
  const hasDetailedFilters = Boolean(filterStatus || filterSeverity || filterKind || filterRevalidationRequired);
  const clearDetailedFilters = { status: null, severity: null, kind: null, revalidationRequired: false, cursor: null };

  return (
    <div className="register-filters">
      <div className="register-toolbar">
        <div className="register-views" role="group" aria-label="Vues du registre">
          <button type="button" aria-pressed={!hasActiveFilters} onClick={onResetFilters}>Tous</button>
          <button
            type="button"
            aria-pressed={filterBlockingOnly && !hasDetailedFilters}
            onClick={() => onApplyFilters({ ...clearDetailedFilters, blockingOnly: true })}
          >
            Bloquants <span className="register-count">{blockingCount}</span>
          </button>
        </div>
        <button
          type="button"
          className="register-icon-button"
          aria-label="Filtres du registre"
          aria-expanded={expanded}
          aria-controls={filtersId}
          data-active={hasDetailedFilters || undefined}
          onClick={() => setExpanded(!expanded)}
        >
          <Funnel size={18} aria-hidden="true" />
          {hasDetailedFilters ? <span className="register-filter-indicator" /> : null}
        </button>
      </div>
      {hasDetailedFilters && !expanded ? (
        <p className="register-filter-caption">
          {[filterStatus && AFFAIRE_REGISTER_STATUS_LABELS[filterStatus as AffaireRegisterEntryStatus],
            filterSeverity && AFFAIRE_REGISTER_SEVERITY_LABELS[filterSeverity as AffaireRegisterEntrySeverity],
            filterKind && AFFAIRE_REGISTER_KIND_LABELS[filterKind as AffaireRegisterEntryKind],
            filterRevalidationRequired && "Revalidation requise"].filter(Boolean).join(" · ")}
          <button type="button" onClick={onResetFilters}>Effacer les filtres</button>
        </p>
      ) : null}
      <div id={filtersId} hidden={!expanded} className="register-filter-options">
        <label>
          Statut
          <select aria-label="Filtrer par statut" value={filterStatus}
            onChange={(event) => onApplyFilters({ status: (event.target.value as AffaireRegisterEntryStatus) || null, cursor: null })}>
            <option value="">Tous les statuts</option>
            {Object.entries(AFFAIRE_REGISTER_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          Sévérité
          <select aria-label="Filtrer par sévérité" value={filterSeverity}
            onChange={(event) => onApplyFilters({ severity: (event.target.value as AffaireRegisterEntrySeverity) || null, cursor: null })}>
            <option value="">Toutes les sévérités</option>
            {Object.entries(AFFAIRE_REGISTER_SEVERITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label>
          Type
          <select aria-label="Filtrer par type" value={filterKind}
            onChange={(event) => onApplyFilters({ kind: (event.target.value as AffaireRegisterEntryKind) || null, cursor: null })}>
            <option value="">Tous les types</option>
            {Object.entries(AFFAIRE_REGISTER_KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="register-revalidation-filter">
          <input type="checkbox" checked={filterRevalidationRequired}
            onChange={(event) => onApplyFilters({ revalidationRequired: event.target.checked, cursor: null })} />
          Revalidation requise
        </label>
        {hasActiveFilters ? <button type="button" className="register-text-button" onClick={onResetFilters}>Réinitialiser</button> : null}
      </div>
    </div>
  );
}
