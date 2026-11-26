"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CostingWorkbookColumn, CostingWorkbookColumnInspection } from "@/lib/catalogue/costing-workbook";
import { workbookCellAddress, workbookCellText } from "@/lib/catalogue/costing-workbook-edits";
import type { CostingWorkbookRows } from "@/lib/catalogue/costing-workbook-file";

import { WorkbookColumnDataPreview } from "./WorkbookColumnDataPreview";

const LABELS: Record<CostingWorkbookColumn, string> = {
  ID: "Référence",
  Caractéristique: "Caractéristique",
  Matériau: "Matériau",
  Type_ligne: "Type de ligne",
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

export function ImportColumnsDialog({ rows, inspection, disabled }: Readonly<{
  rows: CostingWorkbookRows;
  inspection: CostingWorkbookColumnInspection;
  disabled: boolean;
}>) {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const { headerRow, found } = inspection;
  if (headerRow === null) return null;
  const recognized = new Map(found.map(({ column, index }) => [index, column]));
  const columns = (rows[headerRow - 1] ?? []).flatMap((_, index) => {
    const header = workbookCellText(rows, headerRow, index);
    if (!header) return [];
    const field = recognized.get(index);
    return [{ index, header, field, label: field ? LABELS[field] : header, key: `${index}:${header}` }];
  });
  if (!columns.length) return null;
  const chosen = columns.filter(({ key }) => !hidden.has(key));
  const visible = chosen.length ? chosen : columns;

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="outline" disabled={disabled} />}>
        Colonnes à afficher
      </DialogTrigger>
      <DialogContent size="xl" className="lg:max-w-[min(92vw,80rem)]">
        <DialogHeader>
          <DialogTitle>Colonnes à afficher</DialogTitle>
          <DialogDescription>
            Choisissez les colonnes Excel utiles à votre préfiltre. Le choix des colonnes, le tri et la recherche s’appliquent uniquement à ce tableau.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Popover>
            <PopoverTrigger render={<Button variant="outline" size="sm" />}>
              Colonnes affichées · {visible.length} sur {columns.length}
            </PopoverTrigger>
            <PopoverContent align="start" aria-label="Choisir les colonnes affichées" className="border border-border">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">En-têtes Excel</span>
                <Button size="xs" variant="ghost" disabled={visible.length === columns.length} onClick={() => setHidden(new Set())}>
                  Tout afficher
                </Button>
              </div>
              <fieldset className="max-h-[min(55dvh,24rem)] space-y-1 overflow-y-auto overscroll-contain">
                <legend className="sr-only">Colonnes du classeur</legend>
                {columns.map(({ key, header, index, label }) => {
                  const letter = workbookCellAddress(headerRow, index).replace(/\d+$/, "");
                  const checked = visible.some((column) => column.key === key);
                  return (
                    <label key={key} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-surface-subtle">
                      <input type="checkbox" aria-label={`${label} · ${letter}`}
                        className="size-4 shrink-0 accent-primary"
                        checked={checked}
                        disabled={checked && visible.length === 1}
                        onChange={(event) => {
                          const next = new Set(chosen.length ? hidden : []);
                          if (event.currentTarget.checked) next.delete(key);
                          else next.add(key);
                          setHidden(next);
                        }} />
                      <span className="min-w-0 wrap-anywhere">
                        {label}
                        <span className="block font-mono text-xs text-muted-foreground">{letter} · {header}</span>
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            </PopoverContent>
          </Popover>
        </div>
        <WorkbookColumnDataPreview rows={rows} headerRow={headerRow} columns={visible} />
      </DialogContent>
    </Dialog>
  );
}
