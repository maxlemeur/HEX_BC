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
  previewLimit,
  onPreviewLimitChange,
}: {
  rows: MappingPreviewRow[];
  validation: MappingValidation | null;
  duplicates: DuplicatesSummary | null;
  isLoading: boolean;
  previewLimit?: number;
  onPreviewLimitChange?: (limit: number) => void;
}) {
  return (
    <section className="dashboard-card overflow-hidden">
      <div className="border-b border-[var(--slate-200)] px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--slate-800)]">Apercu des donnees mappees</h2>
            <p className="mt-1 text-xs text-[var(--slate-500)]">
              Verification rapide des champs requis et detection des doublons.
            </p>
          </div>

          {/* Preview limit selector — integrated into header */}
          {previewLimit !== undefined && onPreviewLimitChange ? (
            <div className="flex items-center gap-2">
              <label className="text-xs text-[var(--slate-500)]" htmlFor="preview-limit">
                Lignes :
              </label>
              <select
                id="preview-limit"
                className="form-input form-select form-input--sm w-auto"
                value={previewLimit}
                onChange={(event) => onPreviewLimitChange(Number(event.target.value))}
              >
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
                <option value={200}>200</option>
              </select>
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 border-b border-[var(--slate-200)] px-6 py-4 sm:grid-cols-3">
        <div className={`rounded-xl border px-4 py-3 ${validation?.is_valid ? "border-[var(--success)] bg-emerald-50" : "border-[var(--slate-200)] bg-[var(--slate-50)]"}`}>
          <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">Validation</p>
          <p className={`mt-1 text-sm font-semibold ${validation?.is_valid ? "text-emerald-700" : "text-[var(--slate-800)]"}`}>
            {validation ? (validation.is_valid ? "Pret a enregistrer" : "Mapping en cours\u2026") : "-"}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--slate-200)] bg-[var(--slate-50)] px-4 py-3">
          <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">Champs a completer</p>
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
        <div className="alert alert-info m-4">
          <p className="font-medium">Champs a completer</p>
          <ul className="mt-1 list-inside list-disc text-sm">
            {validation.missing_required_fields.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {validation && validation.duplicate_target_assignments.length > 0 ? (
        <div className="m-4 rounded-xl border border-warning/30 bg-warning-light px-4 py-3 text-sm text-warning">
          <p className="font-medium">Cibles dupliquees</p>
          <ul className="mt-1 list-inside list-disc">
            {validation.duplicate_target_assignments.map((entry) => (
              <li key={entry.target}>
                <span className="font-medium">{entry.target}</span> assigne a : {entry.sources.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Référence article</th>
              <th>Designation</th>
              <th>Quantite</th>
              <th>Unite</th>
              <th>Prix unitaire HT</th>
              <th>Type FO</th>
              <th>Majoration MO</th>
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
                          hasMissingRequired ? "status-badge status-draft" : "status-badge status-confirmed"
                        }
                      >
                        {hasMissingRequired ? "A completer" : "OK"}
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
