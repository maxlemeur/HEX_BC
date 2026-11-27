"use client";

import { useId } from "react";

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

/** Step « Onglet et colonnes »: the sheet, then the workbook column of each role with an example read under it. */
export function MaterialRequestWorkbookColumns({ preview, sheet, mapping, disabled, onSheetChange, onMappingChange }: Readonly<{
  preview: Pick<MaterialRequestWorkbookPreview, "sheet_names" | "sheet_name" | "columns" | "header_row">;
  sheet: string;
  mapping: WorkbookMapping;
  disabled: boolean;
  onSheetChange: (sheet: string) => void;
  onMappingChange: (mapping: WorkbookMapping) => void;
}>) {
  const id = useId();
  const byLetter = new Map(preview.columns.map((column) => [column.column, column]));
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${id}-sheet`} className="mb-1 block text-sm font-medium">Onglet</label>
        <NativeSelect id={`${id}-sheet`} value={sheet} disabled={disabled} onChange={(event) => onSheetChange(event.currentTarget.value)}>
          {preview.sheet_names.map((name) => <option key={name}>{name}</option>)}
        </NativeSelect>
        <p className="mt-1 text-xs text-muted-foreground">En-têtes lus en ligne {preview.header_row}.</p>
      </div>
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
                        <option key={column.column} value={column.column}>{column.column} · {column.header}</option>
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
    </div>
  );
}
