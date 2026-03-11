import {
  AFFAIRE_REGISTER_KIND_LABELS,
  AFFAIRE_REGISTER_SEVERITY_LABELS,
  AFFAIRE_REGISTER_STATUS_LABELS,
  type AffaireRegisterEntryKind,
  type AffaireRegisterEntrySeverity,
  type AffaireRegisterEntryStatus,
} from "@/lib/affaires/register";

type RegisterFiltersBarProps = {
  filterStatus: string;
  filterSeverity: string;
  filterKind: string;
  hasActiveFilters: boolean;
  onApplyFilters: (next: {
    status?: AffaireRegisterEntryStatus | null;
    severity?: AffaireRegisterEntrySeverity | null;
    kind?: AffaireRegisterEntryKind | null;
    cursor?: string | null;
  }) => void;
  onResetFilters: () => void;
};

export function RegisterFiltersBar({
  filterStatus,
  filterSeverity,
  filterKind,
  hasActiveFilters,
  onApplyFilters,
  onResetFilters,
}: Readonly<RegisterFiltersBarProps>) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <select
        aria-label="Filtrer par statut"
        className="min-h-[44px] rounded-lg border border-[var(--slate-200)] bg-white px-2.5 py-1.5 text-xs text-[var(--slate-700)] sm:min-h-0"
        value={filterStatus}
        onChange={(event) =>
          onApplyFilters({
            status: (event.target.value as AffaireRegisterEntryStatus) || null,
            cursor: null,
          })
        }
      >
        <option value="">Tous les statuts</option>
        {Object.entries(AFFAIRE_REGISTER_STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select
        aria-label="Filtrer par sévérité"
        className="min-h-[44px] rounded-lg border border-[var(--slate-200)] bg-white px-2.5 py-1.5 text-xs text-[var(--slate-700)] sm:min-h-0"
        value={filterSeverity}
        onChange={(event) =>
          onApplyFilters({
            severity: (event.target.value as AffaireRegisterEntrySeverity) || null,
            cursor: null,
          })
        }
      >
        <option value="">Toutes les sévérités</option>
        {Object.entries(AFFAIRE_REGISTER_SEVERITY_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select
        aria-label="Filtrer par type"
        className="min-h-[44px] rounded-lg border border-[var(--slate-200)] bg-white px-2.5 py-1.5 text-xs text-[var(--slate-700)] sm:min-h-0"
        value={filterKind}
        onChange={(event) =>
          onApplyFilters({
            kind: (event.target.value as AffaireRegisterEntryKind) || null,
            cursor: null,
          })
        }
      >
        <option value="">Tous les types</option>
        {Object.entries(AFFAIRE_REGISTER_KIND_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {hasActiveFilters ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onResetFilters}>
          Réinitialiser
        </button>
      ) : null}
    </div>
  );
}
