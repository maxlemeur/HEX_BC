"use client";

type TargetFieldOption = {
  value: string;
  label: string;
  required?: boolean;
};

export type ColumnMapping = Record<string, string>;

export function ColumnMapper({
  sourceColumns,
  mapping,
  targetFields,
  disabled = false,
  onChange,
}: {
  sourceColumns: string[];
  mapping: ColumnMapping;
  targetFields: TargetFieldOption[];
  disabled?: boolean;
  onChange: (next: ColumnMapping) => void;
}) {
  const requiredTargets = targetFields.filter((field) => field.required).map((field) => field.value);
  const mappedTargets = new Set(Object.values(mapping));
  const missingRequiredTargets = requiredTargets.filter((required) => !mappedTargets.has(required));

  function setMapping(sourceColumn: string, nextTarget: string) {
    const next = { ...mapping };

    if (!nextTarget) {
      delete next[sourceColumn];
    } else {
      next[sourceColumn] = nextTarget;
    }

    onChange(next);
  }

  return (
    <section className="dashboard-card overflow-hidden">
      <div className="border-b border-[var(--slate-200)] px-6 py-4">
        <h2 className="text-sm font-semibold text-[var(--slate-800)]">Mapping des colonnes</h2>
        <p className="mt-1 text-xs text-[var(--slate-500)]">
          Associez les colonnes source aux champs metier.
        </p>
      </div>

      {sourceColumns.length === 0 ? (
        <div className="px-6 py-8 text-sm text-[var(--slate-500)]">
          Aucune colonne detectee. Selectionnez un import pour commencer.
        </div>
      ) : (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Colonne source</th>
                <th>Champ cible</th>
              </tr>
            </thead>
            <tbody>
              {sourceColumns.map((sourceColumn) => {
                const currentTarget = mapping[sourceColumn] ?? "";

                return (
                  <tr key={sourceColumn}>
                    <td>
                      <span className="font-medium text-[var(--slate-800)]">{sourceColumn}</span>
                    </td>
                    <td>
                      <select
                        className="form-input form-select form-input--sm"
                        value={currentTarget}
                        onChange={(event) => setMapping(sourceColumn, event.target.value)}
                        disabled={disabled}
                      >
                        <option value="">Non mappe</option>
                        {targetFields.map((target) => (
                          <option key={target.value} value={target.value}>
                            {target.label}
                            {target.required ? " (requis)" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-[var(--slate-200)] px-6 py-4 text-xs text-[var(--slate-500)]">
        {missingRequiredTargets.length === 0
          ? "Champs requis presents: hex_code, designation."
          : `Champs requis manquants: ${missingRequiredTargets.join(", ")}.`}
      </div>
    </section>
  );
}
