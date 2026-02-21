"use client";

type MappingValidation = {
  is_valid: boolean;
  missing_required_fields: string[];
  duplicate_target_assignments: Array<{ target: string; sources: string[] }>;
  mapped_sources_count: number;
  mapped_targets_count: number;
};

type MappingPreviewRow = {
  row_index: number;
  raw_row: Record<string, unknown>;
  mapped_row: Record<string, unknown>;
  missing_required_fields: string[];
};

type DuplicatesSummary = {
  total_groups: number;
  total_rows_impacted: number;
};

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function DataPreview({
  rows,
  validation,
  duplicates,
  isLoading,
}: {
  rows: MappingPreviewRow[];
  validation: MappingValidation | null;
  duplicates: DuplicatesSummary | null;
  isLoading: boolean;
}) {
  return (
    <section className="dashboard-card overflow-hidden">
      <div className="border-b border-[var(--slate-200)] px-6 py-4">
        <h2 className="text-sm font-semibold text-[var(--slate-800)]">Apercu des donnees mappees</h2>
        <p className="mt-1 text-xs text-[var(--slate-500)]">
          Verification rapide des champs requis et detection des doublons.
        </p>
      </div>

      <div className="grid gap-3 border-b border-[var(--slate-200)] px-6 py-4 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">Validation</p>
          <p className="mt-1 text-sm font-semibold text-[var(--slate-800)]">
            {validation ? (validation.is_valid ? "Valide" : "Invalide") : "-"}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">Champs manquants</p>
          <p className="mt-1 text-sm font-semibold text-[var(--slate-800)]">
            {validation ? validation.missing_required_fields.length : "-"}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">Doublons</p>
          <p className="mt-1 text-sm font-semibold text-[var(--slate-800)]">
            {duplicates ? duplicates.total_groups : "-"}
          </p>
        </div>
      </div>

      {validation && validation.missing_required_fields.length > 0 ? (
        <div className="alert alert-error m-4">
          Champs requis manquants: {validation.missing_required_fields.join(", ")}
        </div>
      ) : null}

      {validation && validation.duplicate_target_assignments.length > 0 ? (
        <div className="alert alert-error m-4">
          Cibles dupliquees: {validation.duplicate_target_assignments
            .map((entry) => `${entry.target} (${entry.sources.join(" / ")})`)
            .join(", ")}
        </div>
      ) : null}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>hex_code</th>
              <th>designation</th>
              <th>quantity</th>
              <th>unit</th>
              <th>unit_price_ht</th>
              <th>supply_type</th>
              <th>h_mo_majoration</th>
              <th>Etat</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-sm text-[var(--slate-500)]">
                  Chargement de l&apos;apercu...
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-8 text-center text-sm text-[var(--slate-500)]">
                  Aucun apercu disponible.
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const hasMissingRequired = row.missing_required_fields.length > 0;

                return (
                  <tr key={row.row_index}>
                    <td>{row.row_index + 1}</td>
                    <td>{normalizeCell(row.mapped_row.hex_code)}</td>
                    <td>{normalizeCell(row.mapped_row.designation)}</td>
                    <td>{normalizeCell(row.mapped_row.quantity)}</td>
                    <td>{normalizeCell(row.mapped_row.unit)}</td>
                    <td>{normalizeCell(row.mapped_row.unit_price_ht)}</td>
                    <td>{normalizeCell(row.mapped_row.supply_type)}</td>
                    <td>{normalizeCell(row.mapped_row.h_mo_majoration)}</td>
                    <td>
                      <span
                        className={
                          hasMissingRequired ? "status-badge status-canceled" : "status-badge status-confirmed"
                        }
                      >
                        {hasMissingRequired ? "Incomplet" : "OK"}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {duplicates ? (
        <div className="border-t border-[var(--slate-200)] px-6 py-4 text-xs text-[var(--slate-500)]">
          {duplicates.total_groups > 0
            ? `${duplicates.total_groups} groupe(s) de doublons detecte(s), ${duplicates.total_rows_impacted} ligne(s) impactee(s).`
            : "Aucun doublon detecte sur les lignes analysees."}
        </div>
      ) : null}
    </section>
  );
}
