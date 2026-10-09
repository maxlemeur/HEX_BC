"use client";

import type { PriceBookValidationResult } from "@/lib/catalogue/csv-import";

export function PriceBookRejectedRowsTable({
  validation,
}: Readonly<{
  validation: PriceBookValidationResult;
}>) {
  if (validation.rejectedRowsCount === 0) {
    return null;
  }

  return (
    <section className="min-w-0 overflow-hidden rounded-lg border border-border bg-surface shadow-card">
      <div className="border-b border-border px-4 py-4 sm:px-6">
        <h3 className="text-sm font-semibold text-foreground">Synthèse des lignes à corriger</h3>
        <p className="mt-1 text-xs text-muted-foreground">Ligne et motif de correction.</p>
      </div>

      <div className="table-scroll relative overflow-x-auto" role="region" aria-label="Lignes à corriger" tabIndex={0}>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Ligne</th>
              <th scope="col">Code</th>
              <th scope="col">Motif</th>
              <th scope="col">Suggestion</th>
            </tr>
          </thead>
          <tbody>
            {validation.rejectedRows.slice(0, 200).map((row) => (
              <tr key={`${row.lineNumber}-${row.errorCode}-${row.reason}`}>
                <td>{row.lineNumber}</td>
                <td>{row.errorCode}</td>
                <td>{row.reason}</td>
                <td>{row.suggestedFix ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {validation.rejectedRowsCount > 200 ? (
        <div className="border-t border-border px-4 py-4 text-xs text-muted-foreground sm:px-6">
          Liste tronquée aux 200 premières lignes à corriger.
        </div>
      ) : null}
    </section>
  );
}
