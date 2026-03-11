"use client";

import type {
  ApprovedPdfTable,
  TabularPdfReviewPayload,
} from "@/hooks/useImportFlow";

type TabularPdfReviewPanelProps = {
  fileName: string;
  fileSizeLabel: string;
  pdfReview: TabularPdfReviewPayload;
  approvedTables: ApprovedPdfTable[];
  onToggleTable: (table: ApprovedPdfTable) => void;
  onClearFile: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  submitLabel?: string;
};

function buildTableKey(sourcePage: number, tableIndex: number) {
  return `${sourcePage}:${tableIndex}`;
}

function isTableApproved(
  approvedTables: ApprovedPdfTable[],
  sourcePage: number,
  tableIndex: number
) {
  const key = buildTableKey(sourcePage, tableIndex);
  return approvedTables.some(
    (table) => buildTableKey(table.sourcePage, table.tableIndex) === key
  );
}

function reviewStateLabel(reviewState: TabularPdfReviewPayload["review"]["review_state"]) {
  switch (reviewState) {
    case "light_validation":
      return "Validation legere";
    case "reinforced_validation":
      return "Validation renforcee";
    default:
      return "Reprise manuelle";
  }
}

function reviewStateTone(reviewState: TabularPdfReviewPayload["review"]["review_state"]) {
  switch (reviewState) {
    case "light_validation":
      return "border-[var(--success)] bg-[var(--success)]/5";
    case "reinforced_validation":
      return "border-[var(--warning)] bg-[var(--warning)]/5";
    default:
      return "border-[var(--error)] bg-[var(--error)]/5";
  }
}

export function TabularPdfReviewPanel({
  fileName,
  fileSizeLabel,
  pdfReview,
  approvedTables,
  onToggleTable,
  onClearFile,
  onSubmit,
  isSubmitting,
  submitLabel = "Valider les tableaux et lancer l'import",
}: TabularPdfReviewPanelProps) {
  const approvedCount = approvedTables.length;
  const hasSelectableTable = pdfReview.review.tables.some(
    (table) => table.decision !== "reject"
  );

  return (
    <div
      className={`animate-fade-in rounded-xl border-2 p-5 ${reviewStateTone(
        pdfReview.review.review_state
      )}`}
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--slate-800)]">
            {fileName}
            <span className="ml-2 text-xs font-normal text-[var(--slate-500)]">
              {fileSizeLabel}
            </span>
          </p>
          <p className="mt-1 text-xs font-medium text-[var(--slate-700)]">
            {reviewStateLabel(pdfReview.review.review_state)} ·{" "}
            {pdfReview.review.summary.approvable_tables} tableau(x) exploitable(s) sur{" "}
            {pdfReview.review.summary.total_tables}
          </p>
          <p className="mt-1 text-xs text-[var(--slate-500)]">
            Le PDF rejoint le mapping standard uniquement apres approbation explicite
            des tableaux retenus.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={onClearFile}
          disabled={isSubmitting}
        >
          Retirer
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-white/60 bg-white/70 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">
            Tableaux proposes
          </p>
          <p className="mt-1 text-lg font-semibold text-[var(--slate-900)]">
            {pdfReview.review.summary.approvable_tables}
          </p>
        </div>
        <div className="rounded-lg border border-white/60 bg-white/70 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">
            Tableaux rejetes
          </p>
          <p className="mt-1 text-lg font-semibold text-[var(--slate-900)]">
            {pdfReview.review.summary.rejected_tables}
          </p>
        </div>
        <div className="rounded-lg border border-white/60 bg-white/70 px-3 py-2">
          <p className="text-[11px] uppercase tracking-wide text-[var(--slate-500)]">
            Lignes retenues
          </p>
          <p className="mt-1 text-lg font-semibold text-[var(--slate-900)]">
            {pdfReview.review.summary.approvable_rows}
          </p>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {pdfReview.review.tables.map((table) => {
          const selected = isTableApproved(
            approvedTables,
            table.source_page,
            table.table_index
          );
          const selectable = table.decision !== "reject";

          return (
            <label
              key={buildTableKey(table.source_page, table.table_index)}
              className={`block rounded-lg border px-4 py-3 ${
                selected
                  ? "border-[var(--brand-blue)] bg-white"
                  : "border-white/60 bg-white/70"
              } ${selectable ? "cursor-pointer" : "cursor-not-allowed opacity-80"}`}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected}
                  disabled={!selectable || isSubmitting}
                  onChange={() =>
                    onToggleTable({
                      sourcePage: table.source_page,
                      tableIndex: table.table_index,
                    })
                  }
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-[var(--slate-800)]">
                      {table.title || `Tableau page ${table.source_page}`}
                    </p>
                    <span className="rounded-full bg-[var(--slate-100)] px-2 py-0.5 text-[11px] text-[var(--slate-600)]">
                      p.{table.source_page} · tableau {table.table_index + 1}
                    </span>
                    <span className="rounded-full bg-[var(--slate-100)] px-2 py-0.5 text-[11px] text-[var(--slate-600)]">
                      {table.row_count} ligne(s)
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--slate-500)]">
                    Colonnes: {table.headers.join(" · ") || "Aucune"}
                  </p>
                  {table.issues.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {table.issues.map((issue) => (
                        <span
                          key={`${table.source_page}:${table.table_index}:${issue.code}`}
                          className={`rounded-full px-2 py-0.5 text-[11px] ${
                            issue.severity === "error"
                              ? "bg-[var(--error)]/10 text-[var(--error)]"
                              : "bg-[var(--warning)]/10 text-[var(--warning-dark,var(--warning))]"
                          }`}
                        >
                          {issue.message}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {table.sample_rows.length > 0 ? (
                    <div className="mt-2 overflow-hidden rounded-md border border-[var(--slate-200)] bg-[var(--slate-50)]">
                      <table className="min-w-full text-left text-xs text-[var(--slate-600)]">
                        <tbody>
                          {table.sample_rows.slice(0, 2).map((row, rowIndex) => (
                            <tr
                              key={`${table.source_page}:${table.table_index}:sample:${rowIndex}`}
                              className="border-t border-[var(--slate-200)] first:border-t-0"
                            >
                              {row.map((cell, cellIndex) => (
                                <td
                                  key={`${table.source_page}:${table.table_index}:sample:${rowIndex}:${cellIndex}`}
                                  className="px-2 py-1.5"
                                >
                                  {cell || "—"}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </div>
              </div>
            </label>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/60 pt-4">
        <p className="text-xs text-[var(--slate-600)]">
          {approvedCount > 0
            ? `${approvedCount} tableau(x) retenu(s) avant mapping canonique.`
            : hasSelectableTable
              ? "Selectionnez au moins un tableau a retenir."
              : "Aucun tableau exploitable n'a ete retenu pour ce PDF."}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          disabled={isSubmitting || approvedCount === 0}
          onClick={onSubmit}
        >
          {isSubmitting ? (
            <span className="flex items-center gap-2">
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Import en cours...
            </span>
          ) : (
            submitLabel
          )}
        </button>
      </div>
    </div>
  );
}
