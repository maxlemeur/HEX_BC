"use client";

import { useId, useMemo } from "react";

import { Combobox } from "@/components/ui/combobox";
import { NativeSelect } from "@/components/ui/native-select";
import type { MaterialRequestSupplierOption } from "@/lib/material-requests/client";
import type { MaterialRequestWorkbookPreview, MaterialRequestWorkbookSupplier } from "@/lib/material-requests/workbook-preview-contract";
import { plural } from "@/lib/text/plural";

/** What the user decided for a name: nothing is linked or created until the step is confirmed. */
export type WorkbookSupplierChoice = { kind: "leave" } | { kind: "link"; supplierId: string } | { kind: "create" };

/** Step « Fournisseurs à reconnaître »: for each unknown or ambiguous name, link it, create it, or leave it. */
export function MaterialRequestWorkbookSuppliers({ names, rights, options, choices, applied, disabled, onChoiceChange }: Readonly<{
  names: readonly MaterialRequestWorkbookSupplier[];
  rights: MaterialRequestWorkbookPreview["supplier_rights"];
  options: readonly MaterialRequestSupplierOption[];
  choices: ReadonlyMap<string, WorkbookSupplierChoice>;
  /** Names already linked or created by an earlier confirmation of this step. */
  applied: ReadonlyMap<string, string>;
  disabled: boolean;
  onChoiceChange: (name: string, choice: WorkbookSupplierChoice) => void;
}>) {
  const id = useId();
  const labelById = useMemo(() => new Map(options.map((option) => [option.id, option.label])), [options]);
  const comboboxOptions = useMemo(() => options.map(({ id: value, label, name }) => ({ value, label, keywords: [name] })), [options]);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Ces noms ne correspondent à aucun fournisseur connu, ou à plusieurs. Associer un nom l’enregistre pour les prochains imports.
        Les lignes d’un nom laissé de côté sont importées sans fournisseur.
      </p>
      {rights.reason && <p className="text-sm">{rights.reason}</p>}
      <ul className="space-y-3">
        {names.map((entry, index) => {
          const choice = choices.get(entry.name) ?? { kind: "leave" };
          const done = applied.get(entry.name);
          const actionId = `${id}-${index}-action`;
          const supplierId = `${id}-${index}-supplier`;
          return (
            <li key={entry.name} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium break-words">« {entry.name} »</p>
                <p className="text-xs text-muted-foreground">
                  {plural(entry.row_count, "ligne", "lignes")}
                  {entry.status === "ambiguous" && ` · ${plural(entry.candidates.length, "fournisseur porte", "fournisseurs portent")} ce nom`}
                </p>
              </div>
              {done ? (
                <p className="text-sm">Associé à {labelById.get(done) ?? "un fournisseur"}.</p>
              ) : (
                <>
                  <div>
                    <label htmlFor={actionId} className="sr-only">Que faire de « {entry.name} »</label>
                    <NativeSelect
                      id={actionId}
                      size="sm"
                      value={choice.kind}
                      disabled={disabled || (!rights.can_link && !rights.can_create)}
                      onChange={(event) => {
                        const kind = event.currentTarget.value;
                        onChoiceChange(entry.name, kind === "link"
                          ? { kind, supplierId: entry.candidates[0]?.id ?? "" }
                          : kind === "create" ? { kind } : { kind: "leave" });
                      }}
                    >
                      <option value="leave">Laisser sans fournisseur</option>
                      {rights.can_link && <option value="link">Associer à un fournisseur existant</option>}
                      {rights.can_create && <option value="create">Créer le fournisseur « {entry.name} »</option>}
                    </NativeSelect>
                  </div>
                  {choice.kind === "link" && (
                    <div>
                      <label htmlFor={supplierId} className="mb-1 block text-sm">Fournisseur</label>
                      <Combobox
                        id={supplierId}
                        size="sm"
                        options={comboboxOptions}
                        value={choice.supplierId}
                        disabled={disabled}
                        placeholder="Rechercher un fournisseur"
                        emptyMessage="Aucun fournisseur trouvé."
                        onValueChange={(value) => onChoiceChange(entry.name, { kind: "link", supplierId: value })}
                      />
                      {entry.status === "ambiguous" && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Portent ce nom : {entry.candidates.map((candidate) => candidate.label).join(", ")}.
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
