"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FileInput } from "lucide-react";

import { useToast } from "@/components/feedback/toast-provider";
import { LoadingState } from "@/components/layout/loading-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { fetchMaterialRequestWorkbookPreview, materialRequestErrorMessage } from "@/lib/material-requests/client";
import { MATERIAL_REQUEST_MAX_LINES, type MaterialRequestFile } from "@/lib/material-requests/contracts";
import type { MaterialRequestWorkbookPreview } from "@/lib/material-requests/workbook-preview-contract";
import { plural } from "@/lib/text/plural";

import type { MaterialRequestEditorApi } from "./useMaterialRequestEditor";

const quantityFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
const HEADINGS = ["Ligne Excel", "Désignation", "Référence", "Dimension", "Quantité", "Unité", "Matière", "Zone"];

export function MaterialRequestWorkbookImport({ editor, file, onImported }: Readonly<{
  editor: MaterialRequestEditorApi;
  file: MaterialRequestFile;
  onImported: () => void;
}>) {
  const sheetId = useId();
  const toast = useToast();
  const { projectId, requestId } = editor;
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState<string>();
  const [preview, setPreview] = useState<MaterialRequestWorkbookPreview | null>(null);
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const adding = useRef(false);

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    void fetchMaterialRequestWorkbookPreview(projectId, requestId, file.id, sheet, abort.signal)
      .then((data) => {
        if (abort.signal.aborted) return;
        setPreview(data);
        setExcluded(new Set());
        setReading(false);
      })
      .catch((cause: unknown) => {
        if (abort.signal.aborted) return;
        setPreview(null);
        setError(materialRequestErrorMessage(cause, "L’aperçu du classeur n’a pas pu être affiché."));
        setReading(false);
      });
    return () => abort.abort();
  }, [file.id, open, projectId, requestId, sheet]);

  const changeOpen = (next: boolean) => {
    if (adding.current) return;
    setOpen(next);
    setSheet(undefined);
    setPreview(null);
    setError(null);
    setReading(next);
  };

  const rows = preview?.rows ?? [];
  const selected = rows.filter(({ row_number }) => !excluded.has(row_number));
  const available = MATERIAL_REQUEST_MAX_LINES - editor.data.lines.length;
  const canAdd = editor.canWrite && !reading && selected.length > 0 && selected.length <= available;

  const add = async () => {
    if (!canAdd || adding.current) return;
    adding.current = true;
    setSaving(true);
    setError(null);
    const result = await editor.addLines(selected.map(({ line }) => line));
    adding.current = false;
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    toast.success({ title: `${plural(selected.length, "ligne ajoutée", "lignes ajoutées")} en brouillon` });
    changeOpen(false);
    onImported();
  };

  const issues = new Map((preview?.issues ?? []).map(({ row_number, message }) => [row_number, message]));
  const lines = new Map(rows.map(({ row_number, line }) => [row_number, line]));
  const rowNumbers = [...new Set([...issues.keys(), ...lines.keys()])].sort((a, b) => a - b);

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>
        <FileInput aria-hidden="true" />
        Prévisualiser les lignes
      </DialogTrigger>
      <DialogContent size="xl" className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Importer les lignes Excel</DialogTitle>
          <DialogDescription className="break-words">{file.file_name}</DialogDescription>
        </DialogHeader>
        {preview && (preview.sheet_names.length > 1 ? (
          <div>
            <label htmlFor={sheetId} className="mb-1 block text-sm font-medium">Feuille Excel</label>
            <NativeSelect
              id={sheetId}
              value={sheet ?? preview.sheet_name}
              disabled={reading || saving}
              onChange={(event) => {
                setError(null);
                setReading(true);
                setSheet(event.currentTarget.value);
              }}
            >
              {preview.sheet_names.map((name) => <option key={name}>{name}</option>)}
            </NativeSelect>
          </div>
        ) : <p className="text-muted-foreground">Feuille « {preview.sheet_name} »</p>)}
        {reading ? <LoadingState label="Lecture du classeur…" /> : preview && (
          <div className="space-y-3">
            {rowNumbers.length === 0 ? <p>Cette feuille ne contient aucune ligne de matériel.</p> : (
              <div className="max-h-[50dvh] overflow-auto rounded-md border border-border" tabIndex={0} aria-label="Aperçu des lignes Excel" role="region">
                <table className="w-full min-w-max border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-surface-subtle text-left">
                    <tr>
                      <th scope="col" className="px-3 py-2">
                        <input type="checkbox" className="size-4 accent-primary"
                          aria-label="Sélectionner toutes les lignes"
                          checked={rows.length > 0 && selected.length === rows.length}
                          disabled={saving || rows.length === 0}
                          onChange={(event) => setExcluded(new Set(event.currentTarget.checked ? [] : rows.map((row) => row.row_number)))}
                        />
                      </th>
                      {HEADINGS.map((heading) => <th key={heading} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{heading}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rowNumbers.map((number) => {
                      const line = lines.get(number);
                      return (
                        <tr key={number} className="border-t border-border align-top">
                          <td className="px-3 py-2">
                            {line && <input type="checkbox" className="size-4 accent-primary"
                              aria-label={`Sélectionner la ligne ${number}`}
                              checked={!excluded.has(number)} disabled={saving}
                              onChange={(event) => {
                                const next = new Set(excluded);
                                if (event.currentTarget.checked) next.delete(number);
                                else next.add(number);
                                setExcluded(next);
                              }}
                            />}
                          </td>
                          <th scope="row" className="px-3 py-2 text-right font-normal tabular-nums">{number}</th>
                          <td className="max-w-60 break-words px-3 py-2">
                            {line?.original_text ?? "—"}
                            {issues.has(number) && <p className="text-xs text-warning">{issues.get(number)}</p>}
                          </td>
                          {[line?.reference, line?.dimension, line?.quantity == null ? null : quantityFormat.format(line.quantity),
                            line?.unit, line?.material, line?.zone].map((value, index) => (
                            <td key={HEADINGS[index + 2]} className="max-w-40 break-words px-3 py-2">{value ?? "—"}</td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {preview.omitted_rows > 0 && (
              <Alert variant="warning"><AlertDescription>
                {plural(preview.omitted_rows, "ligne supplémentaire hors aperçu", "lignes supplémentaires hors aperçu")}.
                Seules les {MATERIAL_REQUEST_MAX_LINES} premières lignes sont proposées.
              </AlertDescription></Alert>
            )}
            {selected.length > available && (
              <Alert variant="warning"><AlertDescription>
                Il reste {plural(available, "place", "places")} dans la demande. Réduisez la sélection pour continuer.
              </AlertDescription></Alert>
            )}
          </div>
        )}
        {error && <Alert variant="danger" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={saving} onClick={() => changeOpen(false)}>Annuler</Button>
          <Button type="button" disabled={!canAdd} loading={saving} onClick={() => void add()}>
            Ajouter {plural(selected.length, "ligne", "lignes")} en brouillon
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
