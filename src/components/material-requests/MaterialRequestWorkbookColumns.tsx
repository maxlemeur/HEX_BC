"use client";

import { useId } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { NativeSelect } from "@/components/ui/native-select";
import { WORKBOOK_ROLES, WORKBOOK_ROLE_LABELS, type WorkbookMapping, type WorkbookRole } from "@/lib/material-requests/workbook-mapping";
import type { MaterialRequestWorkbookPreview } from "@/lib/material-requests/workbook-preview-contract";

/** One column per role; a column chosen for a role leaves the role that held it. */
export function assignWorkbookColumn(mapping: WorkbookMapping, role: WorkbookRole, letter: string): WorkbookMapping {
  const next: WorkbookMapping = {};
  for (const other of WORKBOOK_ROLES) {
    const held = mapping[other];
    if (other !== role && held && held !== letter) next[other] = held;
  }
  if (letter) next[role] = letter;
  return next;
}

type Reading = Pick<MaterialRequestWorkbookPreview, "sheet_names" | "sheet_name" | "columns" | "header_row" | "header_detected" | "first_rows">;

function rowSummary(row: Reading["first_rows"][number]) {
  const texts = row.cells.slice(0, 4).map((cell) => cell.text);
  return `Ligne ${row.row_number} · ${texts.join(", ")}${row.cells.length > 4 ? ", …" : ""}`;
}

/**
 * Step « Onglet et colonnes »: the sheet, the header row (recognized, or chosen among the first rows when it is not),
 * then the workbook column of each role with an example read under it.
 */
export function MaterialRequestWorkbookColumns({ preview, sheet, mapping, disabled, onSheetChange, onHeaderRowChange, onMappingChange }: Readonly<{
  preview: Reading;
  sheet: string;
  mapping: WorkbookMapping;
  disabled: boolean;
  onSheetChange: (sheet: string) => void;
  onHeaderRowChange: (row: number) => void;
  onMappingChange: (mapping: WorkbookMapping) => void;
}>) {
  const id = useId();
  const byLetter = new Map(preview.columns.map((column) => [column.column, column]));
  const headerKnown = preview.header_row !== null;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${id}-sheet`} className="mb-1 block text-sm font-medium">Onglet</label>
          <NativeSelect id={`${id}-sheet`} value={sheet} disabled={disabled} onChange={(event) => onSheetChange(event.currentTarget.value)}>
            {preview.sheet_names.map((name) => <option key={name}>{name}</option>)}
          </NativeSelect>
        </div>
        {preview.first_rows.length > 0 && (
          <div>
            <label htmlFor={`${id}-header`} className="mb-1 block text-sm font-medium">Ligne d’en-tête</label>
            <NativeSelect
              id={`${id}-header`}
              value={preview.header_row === null ? "" : String(preview.header_row)}
              disabled={disabled}
              onChange={(event) => {
                const row = Number(event.currentTarget.value);
                if (row) onHeaderRowChange(row);
              }}
            >
              {!headerKnown && <option value="">Choisissez la ligne des titres</option>}
              {preview.first_rows.map((row) => <option key={row.row_number} value={row.row_number}>{rowSummary(row)}</option>)}
            </NativeSelect>
            {preview.header_detected && <p className="mt-1 text-xs text-muted-foreground">Reconnue automatiquement.</p>}
          </div>
        )}
      </div>

      {!headerKnown && (
        <>
          <Alert variant="info"><AlertDescription>
            {preview.first_rows.length > 0
              ? "MergeOne ne reconnaît pas les titres de cet onglet. Choisissez la ligne qui porte les titres des colonnes, puis indiquez la colonne de chaque information."
              : "Cet onglet ne contient rien dans ses 50 premières lignes. Choisissez un autre onglet."}
          </AlertDescription></Alert>
          {preview.first_rows.length > 0 && (
            <div className="max-h-[40dvh] overflow-auto rounded-md border border-border" tabIndex={0} role="region" aria-label="Premières lignes de l’onglet">
              <table className="w-full min-w-max border-collapse text-sm">
                <tbody>
                  {preview.first_rows.map((row) => (
                    <tr key={row.row_number} className="border-t border-border align-top first:border-t-0">
                      <th scope="row" className="px-3 py-1.5 text-right font-normal tabular-nums text-muted-foreground">{row.row_number}</th>
                      {row.cells.slice(0, 12).map((cell) => (
                        <td key={cell.column} className="max-w-48 break-words px-3 py-1.5">
                          <span className="text-muted-foreground">{cell.column} </span>{cell.text}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {headerKnown && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Colonne du classeur pour chaque information</caption>
            <thead className="bg-surface-subtle text-left">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Information</th>
                <th scope="col" className="px-3 py-2 font-medium">Colonne du classeur</th>
                <th scope="col" className="px-3 py-2 font-medium">Exemple</th>
              </tr>
            </thead>
            <tbody>
              {WORKBOOK_ROLES.map((role) => {
                const letter = mapping[role] ?? "";
                const example = byLetter.get(letter)?.examples[0];
                return (
                  <tr key={role} className="border-t border-border align-middle">
                    <th scope="row" className="whitespace-nowrap px-3 py-2 font-normal">
                      <label htmlFor={`${id}-${role}`}>{WORKBOOK_ROLE_LABELS[role]}</label>
                      {role === "designation" && <span className="text-muted-foreground"> (obligatoire)</span>}
                    </th>
                    <td className="min-w-48 px-3 py-2">
                      <NativeSelect
                        id={`${id}-${role}`}
                        size="sm"
                        value={letter}
                        disabled={disabled}
                        aria-invalid={role === "designation" && !letter ? true : undefined}
                        onChange={(event) => onMappingChange(assignWorkbookColumn(mapping, role, event.currentTarget.value))}
                      >
                        <option value="">Aucune</option>
                        {preview.columns.map((column) => (
                          <option key={column.column} value={column.column}>
                            {column.header ? `${column.column} · ${column.header}` : `Colonne ${column.column} (sans titre)`}
                          </option>
                        ))}
                      </NativeSelect>
                    </td>
                    <td className="max-w-60 break-words px-3 py-2 text-muted-foreground">{example}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
