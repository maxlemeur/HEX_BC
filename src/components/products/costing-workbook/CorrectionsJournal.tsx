"use client";

import { useState } from "react";

import { DownloadIcon, Undo2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { exportWorkbookEdits } from "@/lib/catalogue/costing-workbook-corrections";
import type { CostingWorkbookRows } from "@/lib/catalogue/costing-workbook-file";
import type { WorkbookEditEntry } from "@/lib/catalogue/costing-workbook-edits";

import { formatCount, plural } from "./shared";

/**
 * The corrections made in the screen (TI-711), as a journal the office reads, undoes and exports. The preview
 * and the import read the sheet with these corrections; the Excel file keeps its values, so the export is what
 * to copy back into it, or to read back here at the next import of the same workbook.
 */
export function CorrectionsJournal({ entries, rows, mapped, busy, onUndo, onUndoAll }: Readonly<{
  entries: readonly WorkbookEditEntry[];
  rows: CostingWorkbookRows;
  mapped: CostingWorkbookRows;
  busy: boolean;
  onUndo: (entry: WorkbookEditEntry) => void;
  onUndoAll: () => void;
}>) {
  const [open, setOpen] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);
  if (entries.length === 0) return null;

  return (
    <section aria-label="Corrections appliquées à l’aperçu" className="rounded-lg border border-info-border bg-info-subtle px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0">
          <span className="font-semibold">
            {`${formatCount(entries.length)} ${plural(entries.length, "correction appliquée", "corrections appliquées")} à l’aperçu.`}
          </span>{" "}
          <span className="text-foreground-secondary">Le fichier Excel n’est pas modifié : exportez-les pour les y reporter.</span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((shown) => !shown)}>
            {open ? "Masquer" : "Voir"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            leftIcon={<DownloadIcon aria-hidden="true" />}
            onClick={() => {
              setExportFailed(false);
              exportWorkbookEdits(entries, rows, mapped).catch(() => setExportFailed(true));
            }}
          >
            Exporter
          </Button>
          <Button variant="outline" size="sm" disabled={busy} leftIcon={<Undo2Icon aria-hidden="true" />} onClick={onUndoAll}>
            Tout annuler
          </Button>
        </div>
      </div>
      {exportFailed ? <p role="alert" className="mt-1 text-xs text-danger">Le fichier Excel n’a pas pu être téléchargé.</p> : null}
      {open ? (
        <ul aria-label="Corrections" className="mt-2 max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border bg-surface px-3">
          {entries.map((entry) => (
            <li key={entry.address} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-1.5">
              <span className="min-w-0 wrap-anywhere">
                <span className="font-mono text-xs text-primary">{entry.address}</span>
                {entry.header ? <span className="text-xs text-muted-foreground">{` · ${entry.header}`}</span> : null}
                {" : "}
                <span className="text-muted-foreground line-through">{entry.before || "vide"}</span>
                {" → "}
                <span className="font-medium">{entry.after || "vide"}</span>
              </span>
              <Button variant="ghost" size="xs" disabled={busy} aria-label={`Annuler la correction de ${entry.address}`} onClick={() => onUndo(entry)}>
                Annuler
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
