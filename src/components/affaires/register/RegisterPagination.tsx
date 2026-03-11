type RegisterPaginationProps = {
  cursor: string | null;
  nextCursor: string | null;
  isFilterPending: boolean;
  onApplyCursor: (cursor: string | null) => void;
};

export function RegisterPagination({
  cursor,
  nextCursor,
  isFilterPending,
  onApplyCursor,
}: Readonly<RegisterPaginationProps>) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--slate-200)] bg-[var(--slate-50)]/70 px-4 py-3">
      <div>
        <p className="text-sm font-medium text-[var(--slate-700)]">
          {cursor ? "Vue paginée sur une tranche du registre" : "Début du registre pour cette vue"}
        </p>
        <p className="mt-1 text-xs text-[var(--slate-500)]">
          {nextCursor
            ? "D'autres points sont disponibles. Chargez la suite pour poursuivre la revue."
            : "Vous êtes sur la dernière tranche disponible pour ces filtres."}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!cursor || isFilterPending}
          onClick={() => onApplyCursor(null)}
        >
          Revenir au début
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={!nextCursor || isFilterPending}
          onClick={() => onApplyCursor(nextCursor)}
        >
          Charger les points suivants
        </button>
      </div>
    </div>
  );
}
