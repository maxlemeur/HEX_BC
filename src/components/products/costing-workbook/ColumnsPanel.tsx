"use client";

import { useId } from "react";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/native-select";
import type { CostingWorkbookColumn, CostingWorkbookColumnInspection } from "@/lib/catalogue/costing-workbook";
import { workbookCellAddress } from "@/lib/catalogue/costing-workbook-edits";
import { missingColumnEffect } from "@/lib/catalogue/costing-workbook-review";

import { useWorkbookEditor } from "./shared";

/**
 * The columns the reader found in the sheet's header row, and those it did not (TI-711). A renamed header
 * (« PR FO » for « PR. FO ») is the usual cause: the office points the missing column to its header here, which
 * renames that header in the rows the screen holds, never in the Excel file.
 */

const columnLetter = (row: number, index: number) => workbookCellAddress(row, index).replace(/\d+$/, "");

function MissingColumn({ column, required, inspection }: Readonly<{
  column: CostingWorkbookColumn;
  required: boolean;
  inspection: CostingWorkbookColumnInspection;
}>) {
  const selectId = useId();
  const { busy, applyEdits } = useWorkbookEditor();
  const headerRow = inspection.headerRow;
  const effect = required ? "sans elle, le classeur ne peut pas être lu" : missingColumnEffect(column);
  return (
    <li className="grid gap-2 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-center sm:gap-4">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <span className="font-mono">{column}</span>
          <Badge variant={required ? "danger" : effect ? "warning" : "neutral"} size="sm">
            {required ? "obligatoire" : "absente"}
          </Badge>
        </p>
        {effect ? <p className="text-xs text-muted-foreground">{`Sans cette colonne, ${effect}.`}</p> : null}
      </div>
      {headerRow !== null && inspection.unrecognised.length > 0 ? (
        <div className="min-w-0">
          <label htmlFor={selectId} className="sr-only">{`En-tête du classeur à lire comme ${column}`}</label>
          <NativeSelect
            id={selectId}
            size="sm"
            value=""
            disabled={busy}
            onChange={(event) => {
              const index = Number(event.currentTarget.value);
              if (event.currentTarget.value !== "" && Number.isInteger(index)) {
                applyEdits([{ row: headerRow, column: index, value: column }]);
              }
            }}
          >
            <option value="">Lire une autre colonne…</option>
            {inspection.unrecognised.map(({ index, text }) => (
              <option key={index} value={index}>{`${columnLetter(headerRow, index)} · ${text}`}</option>
            ))}
          </NativeSelect>
        </div>
      ) : null}
    </li>
  );
}

export function ColumnsPanel({ inspection }: Readonly<{ inspection: CostingWorkbookColumnInspection }>) {
  const { headerRow, found, missingRequired, missingOptional, unrecognised } = inspection;
  return (
    <section aria-labelledby="costing-workbook-columns-title" className="space-y-4">
      <div className="space-y-1">
        <h3 id="costing-workbook-columns-title" className="typo-h3">Colonnes du classeur</h3>
        <p className="text-sm text-muted-foreground">
          {headerRow === null
            ? "Aucune ligne d’en-têtes n’a été trouvée dans les dix premières lignes."
            : `En-têtes lus à la ligne ${headerRow}. Une colonne renommée dans le classeur peut être désignée ici : le fichier Excel n’est pas modifié.`}
        </p>
      </div>

      {missingRequired.length > 0 ? (
        <Alert variant="danger">
          {`${missingRequired.length === 1 ? "Une colonne obligatoire manque" : "Des colonnes obligatoires manquent"} : ${missingRequired.join(", ")}.`}
        </Alert>
      ) : null}

      {missingRequired.length + missingOptional.length > 0 ? (
        <ul aria-label="Colonnes absentes du classeur" className="divide-y divide-border rounded-md border border-border px-3">
          {missingRequired.map((column) => <MissingColumn key={column} column={column} required inspection={inspection} />)}
          {missingOptional.map((column) => <MissingColumn key={column} column={column} required={false} inspection={inspection} />)}
        </ul>
      ) : (
        <p className="text-sm text-success">Toutes les colonnes attendues sont présentes.</p>
      )}

      {headerRow !== null && found.length > 0 ? (
        <div className="space-y-1.5">
          <h4 className="text-sm font-semibold">{`${found.length} colonnes reconnues`}</h4>
          <ul aria-label="Colonnes reconnues" className="flex flex-wrap gap-1.5">
            {found.map(({ column, index }) => (
              <li key={column} className="rounded border border-border bg-surface-subtle px-2 py-0.5 text-xs">
                <span className="font-mono text-muted-foreground">{columnLetter(headerRow, index)}</span> {column}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {headerRow !== null && unrecognised.length > 0 ? (
        <div className="space-y-1.5">
          <h4 className="text-sm font-semibold">{`${unrecognised.length} ${unrecognised.length === 1 ? "colonne non lue" : "colonnes non lues"}`}</h4>
          <p className="break-words text-xs text-muted-foreground">
            {unrecognised.map(({ index, text }) => `${columnLetter(headerRow, index)} · ${text}`).join(" ; ")}
          </p>
        </div>
      ) : null}
    </section>
  );
}
