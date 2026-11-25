"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  exportRejectedWorkbookEdits,
  SKIPPED_CORRECTION_LABELS,
  type RejectedWorkbookEdit,
} from "@/lib/catalogue/costing-workbook-corrections";

import { boundedPage, DECISIONS_PER_PAGE, ReviewPager } from "./shared";

export function RejectedWorkbookEdits({ entries, exportable = false }: Readonly<{
  entries: readonly RejectedWorkbookEdit[];
  exportable?: boolean;
}>) {
  const [page, setPage] = useState(0);
  const [exportError, setExportError] = useState(false);
  const current = boundedPage(page, entries.length);
  const start = current * DECISIONS_PER_PAGE;

  if (!entries.length) return null;
  return (
    <section aria-label="Corrections écartées du journal" className="space-y-2 rounded-md border border-border p-3 text-sm">
      <p className="font-medium">{exportable ? "Corrections écartées du journal" : "Ces corrections ne seront pas reprises"}</p>
      <ul className="max-h-36 space-y-1 overflow-y-auto wrap-anywhere text-muted-foreground">
        {entries.slice(start, start + DECISIONS_PER_PAGE).map(({ address, value, reason }, index) => (
          <li key={start + index}>{`${address} · ${value === null ? "Effacer la cellule" : `« ${value} »`} · ${SKIPPED_CORRECTION_LABELS[reason]}`}</li>
        ))}
      </ul>
      <ReviewPager page={current} total={entries.length} onSelect={setPage} />
      {exportable ? (
        <Button variant="outline" size="sm" onClick={() => {
          setExportError(false);
          exportRejectedWorkbookEdits(entries).catch(() => setExportError(true));
        }}>
          Exporter les corrections écartées
        </Button>
      ) : null}
      {exportError ? <p role="alert" className="text-danger">Les corrections écartées n’ont pas pu être exportées.</p> : null}
    </section>
  );
}
