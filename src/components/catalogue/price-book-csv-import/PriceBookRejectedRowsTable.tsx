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
    <section className="dashboard-card overflow-hidden">
      <div className="border-b border-[var(--slate-200)] px-6 py-4">
        <h3 className="text-sm font-semibold text-[var(--slate-800)]">Synthese des lignes a corriger</h3>
        <p className="mt-1 text-xs text-[var(--slate-500)]">Ligne + motif de correction.</p>
      </div>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Ligne</th>
              <th>Code</th>
              <th>Motif</th>
              <th>Suggestion</th>
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
        <div className="border-t border-[var(--slate-200)] px-6 py-4 text-xs text-[var(--slate-500)]">
          Liste tronquee aux 200 premieres lignes a corriger.
        </div>
      ) : null}
    </section>
  );
}
