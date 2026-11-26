"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  COSTING_WORKBOOK_OPTIONAL_COLUMNS,
  type CostingWorkbookColumnInspection,
  type CostingWorkbookOptionalColumn,
} from "@/lib/catalogue/costing-workbook";
import { workbookCellAddress } from "@/lib/catalogue/costing-workbook-edits";

const LABELS: Record<CostingWorkbookOptionalColumn, string> = {
  "Fiabilité (/10)": "Note de fiabilité",
  Dimension: "Dimension",
  Précision: "Précision",
  norme: "Norme",
  Unité: "Unité",
  "PR. FO": "Prix de fourniture",
  "Type FO": "Famille du classeur",
  F1_nom: "Nom du fournisseur 1",
  F1_ref: "Référence du fournisseur 1",
  F1_URL: "Lien du fournisseur 1",
  F2_nom: "Nom du fournisseur 2",
  F2_ref: "Référence du fournisseur 2",
  F2_URL: "Lien du fournisseur 2",
  F3_nom: "Nom du fournisseur 3",
  F3_ref: "Référence du fournisseur 3",
  F3_URL: "Lien du fournisseur 3",
};

export function ImportColumnsDialog({
  inspection, excluded, disabled, applyingDisabled, onApply,
}: Readonly<{
  inspection: CostingWorkbookColumnInspection;
  excluded: ReadonlySet<CostingWorkbookOptionalColumn>;
  disabled: boolean;
  applyingDisabled: boolean;
  onApply: (columns: ReadonlySet<CostingWorkbookOptionalColumn>) => void;
}>) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(excluded);
  const { headerRow, found } = inspection;
  const detected = new Map(found.map(({ column, index }) => [column, index]));
  const available = COSTING_WORKBOOK_OPTIONAL_COLUMNS.filter((column) => detected.has(column));
  const ignored = available.filter((column) => excluded.has(column)).length;
  const changed = available.some((column) => draft.has(column) !== excluded.has(column));
  if (headerRow === null || inspection.missingRequired.length > 0 || available.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (next) setDraft(excluded);
      setOpen(next);
    }}>
      <DialogTrigger render={<Button variant="outline" disabled={disabled} />}>
        Colonnes à importer{ignored > 0 ? ` · ${ignored} ${ignored === 1 ? "ignorée" : "ignorées"}` : ""}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Colonnes à importer</DialogTitle>
          <DialogDescription>
            Décochez les colonnes à ignorer dans ce classeur. Ce choix s’applique aux articles et aux références fournisseur.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Colonnes requises pour lire le classeur · ID, Caractéristique, Matériau et Type_ligne.</p>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Colonnes facultatives détectées</legend>
          {available.map((column) => {
            const index = detected.get(column)!;
            const letter = workbookCellAddress(headerRow, index).replace(/\d+$/, "");
            return (
              <label key={column} className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-md border border-border px-3 py-2">
                <input
                  type="checkbox"
                  aria-label={LABELS[column]}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                  checked={!draft.has(column)}
                  onChange={(event) => {
                    const next = new Set(draft);
                    if (event.currentTarget.checked) next.delete(column);
                    else next.add(column);
                    setDraft(next);
                  }}
                />
                <span className="min-w-0">
                  <span className="block font-medium">{LABELS[column]}</span>
                  <span className="block break-words font-mono text-xs text-muted-foreground">{letter} · {column}</span>
                </span>
              </label>
            );
          })}
        </fieldset>
        {draft.has("PR. FO") || draft.has("Unité") ? (
          <div className="space-y-1 text-sm text-muted-foreground">
            {draft.has("PR. FO") ? <p>Prix ignoré · les nouveaux brouillons auront un prix de 0 €.</p> : null}
            {draft.has("Unité") ? <p>Unité ignorée · les nouveaux brouillons prendront l’unité « u ».</p> : null}
          </div>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Annuler</DialogClose>
          <Button disabled={!changed || applyingDisabled} onClick={() => {
            setOpen(false);
            onApply(draft);
          }}>
            Appliquer à l’aperçu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
