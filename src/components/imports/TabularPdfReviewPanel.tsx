"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  ApprovedPdfTable,
  TabularPdfReviewPayload,
} from "@/hooks/useImportFlow";
import { cn } from "@/lib/utils";

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
      return "Validation légère";
    case "reinforced_validation":
      return "Validation renforcée";
    default:
      return "Reprise manuelle";
  }
}

function reviewStateTone(reviewState: TabularPdfReviewPayload["review"]["review_state"]) {
  switch (reviewState) {
    case "light_validation":
      return "border-success-border bg-success-subtle";
    case "reinforced_validation":
      return "border-warning-border bg-warning-subtle";
    default:
      return "border-danger-border bg-danger-subtle";
  }
}

function countLabel(count: number, singular: string, pluralForm: string) {
  return `${count} ${count > 1 ? pluralForm : singular}`;
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
  const { summary } = pdfReview.review;

  return (
    <div
      className={cn(
        "animate-fade-in rounded-lg border-2 p-4 sm:p-5",
        reviewStateTone(pdfReview.review.review_state)
      )}
    >
      <div className="flex flex-wrap items-start gap-3 sm:flex-nowrap sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {fileName}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              {fileSizeLabel}
            </span>
          </p>
          <p className="mt-1 text-xs font-medium text-foreground-secondary">
            {reviewStateLabel(pdfReview.review.review_state)} ·{" "}
            {countLabel(summary.approvable_tables, "tableau exploitable", "tableaux exploitables")} sur{" "}
            {summary.total_tables}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Le PDF rejoint le mapping standard uniquement après approbation explicite
            des tableaux retenus.
          </p>
        </div>
        <Button variant="outline" size="md" onClick={onClearFile} disabled={isSubmitting}>
          Retirer
        </Button>
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Tableaux proposés", value: summary.approvable_tables },
          { label: "Tableaux rejetés", value: summary.rejected_tables },
          { label: "Lignes retenues", value: summary.approvable_rows },
        ].map((stat) => (
          <div key={stat.label} className="rounded-lg border border-border-subtle bg-surface px-3 py-2">
            <dt className="text-micro uppercase tracking-wide text-muted-foreground">{stat.label}</dt>
            <dd className="mt-1 text-lg font-semibold text-foreground">{stat.value}</dd>
          </div>
        ))}
      </dl>

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
              className={cn(
                "block rounded-lg border bg-surface px-4 py-3",
                selected ? "border-primary ring-1 ring-primary/20" : "border-border-subtle",
                selectable ? "cursor-pointer" : "cursor-not-allowed opacity-80"
              )}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-primary"
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
                    <p className="text-sm font-semibold text-foreground">
                      {table.title || `Tableau page ${table.source_page}`}
                    </p>
                    <Badge size="sm">
                      p.{table.source_page} · tableau {table.table_index + 1}
                    </Badge>
                    <Badge size="sm">
                      {countLabel(table.row_count, "ligne", "lignes")}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Colonnes : {table.headers.join(" · ") || "Aucune"}
                  </p>
                  {table.issues.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {table.issues.map((issue) => (
                        <Badge
                          key={`${table.source_page}:${table.table_index}:${issue.code}`}
                          size="sm"
                          variant={issue.severity === "error" ? "danger" : "warning"}
                          className="h-auto min-h-5 whitespace-normal py-0.5"
                        >
                          {issue.message}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                  {table.sample_rows.length > 0 ? (
                    <div
                      className="relative mt-2 overflow-x-auto rounded-md border border-border bg-surface-subtle"
                      role="region"
                      aria-label={`Exemple de lignes, page ${table.source_page}`}
                      tabIndex={0}
                    >
                      <table className="min-w-full text-left text-xs text-foreground-secondary">
                        <caption className="sr-only">
                          Exemple de lignes du tableau page {table.source_page}
                        </caption>
                        <tbody>
                          {table.sample_rows.slice(0, 2).map((row, rowIndex) => (
                            <tr
                              key={`${table.source_page}:${table.table_index}:sample:${rowIndex}`}
                              className="border-t border-border first:border-t-0"
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

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-4">
        <p className="text-xs text-foreground-secondary">
          {approvedCount > 0
            ? `${countLabel(approvedCount, "tableau retenu", "tableaux retenus")} avant mapping canonique.`
            : hasSelectableTable
              ? "Sélectionnez au moins un tableau à retenir."
              : "Aucun tableau exploitable n’a été retenu pour ce PDF."}
        </p>
        <Button
          size="lg"
          disabled={approvedCount === 0}
          loading={isSubmitting}
          onClick={onSubmit}
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
