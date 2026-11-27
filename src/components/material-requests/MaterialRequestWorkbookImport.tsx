"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileInput } from "lucide-react";

import { useToast } from "@/components/feedback/toast-provider";
import { LoadingState } from "@/components/layout/loading-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useOptionalUserContext } from "@/lib/auth/user-context";
import { workbookSupplierNameKey } from "@/lib/catalogue/costing-workbook";
import { rememberSupplierAlias } from "@/lib/catalogue/import-review-client";
import { fetchSupplierDirectory } from "@/lib/catalogue/supplier-items-client";
import {
  fetchMaterialRequestWorkbookPreview,
  materialRequestErrorMessage,
  type MaterialRequestSupplierOption,
} from "@/lib/material-requests/client";
import { MATERIAL_REQUEST_MAX_LINES, type MaterialRequestFile } from "@/lib/material-requests/contracts";
import {
  WORKBOOK_ROLES,
  sameWorkbookMapping,
  workbookHeaderSignature,
  type WorkbookMapping,
} from "@/lib/material-requests/workbook-mapping";
import type { MaterialRequestWorkbookColumns as ColumnLetters, MaterialRequestWorkbookPreview } from "@/lib/material-requests/workbook-preview-contract";
import { plural } from "@/lib/text/plural";

import { MaterialRequestWorkbookColumns } from "./MaterialRequestWorkbookColumns";
import { MaterialRequestWorkbookSuppliers, type WorkbookSupplierChoice } from "./MaterialRequestWorkbookSuppliers";
import type { MaterialRequestEditorApi } from "./useMaterialRequestEditor";
import { readRememberedWorkbookColumns, rememberWorkbookColumns } from "./workbook-columns-memory";

type Step = "columns" | "suppliers" | "preview";

const quantityFormat = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
const HEADINGS = ["Ligne Excel", "Désignation", "Dimension", "Précision", "Quantité", "Unité", "Fournisseur", "Référence", "Matière", "Repère"];
const STEP_TITLES: Record<Step, string> = {
  columns: "Onglet et colonnes",
  suppliers: "Fournisseurs à reconnaître",
  preview: "Lignes à importer",
};

function toMapping(columns: ColumnLetters): WorkbookMapping {
  return Object.fromEntries(WORKBOOK_ROLES.flatMap((role) => (columns[role] ? [[role, columns[role]]] : [])));
}

/** A remembered mapping applies only while each of its columns is still offered for the sheet. */
/** Splitting is proposed when sampled cells of the dimension column hold a part separator. */
function columnHasParts(preview: MaterialRequestWorkbookPreview, letter: string | undefined) {
  return preview.columns.some((column) => column.column === letter && column.has_parts);
}

function usableMapping(mapping: WorkbookMapping | null | undefined, preview: MaterialRequestWorkbookPreview): WorkbookMapping | null {
  if (!mapping?.designation) return null;
  const letters = new Set(preview.columns.map((column) => column.column));
  return Object.values(mapping).every((letter) => letters.has(letter)) ? mapping : null;
}

export function MaterialRequestWorkbookImport({ editor, file, onImported }: Readonly<{
  editor: MaterialRequestEditorApi;
  file: MaterialRequestFile;
  onImported: () => void;
}>) {
  const toast = useToast();
  const profileId = useOptionalUserContext()?.profile?.id;
  const { projectId, requestId } = editor;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("columns");
  const [sheet, setSheet] = useState<string>();
  /** The header row chosen by hand; undefined lets the server recognize it. */
  const [headerRow, setHeaderRow] = useState<number>();
  /** Bumped to read the chosen sheet again after a failure. */
  const [attempt, setAttempt] = useState(0);
  /** The automatic reading of the chosen sheet: its columns, examples and recognized mapping. */
  const [detection, setDetection] = useState<MaterialRequestWorkbookPreview | null>(null);
  const [mapping, setMapping] = useState<WorkbookMapping>({});
  /** Split the dimension cell into dimension, precision and dropped doubts (« · » and « ; »). */
  const [splitDimension, setSplitDimension] = useState(false);
  /** The reading of the confirmed mapping; its suppliers resolved by the server, before the choices below. */
  const [preview, setPreview] = useState<MaterialRequestWorkbookPreview | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [choices, setChoices] = useState<ReadonlyMap<string, WorkbookSupplierChoice>>(() => new Map());
  /** Supplier names linked or created in this dialog, to the supplier they now stand for. */
  const [applied, setApplied] = useState<ReadonlyMap<string, string>>(() => new Map());
  /** Suppliers created in this dialog by name, kept even when the association that follows fails: a retry never creates twice. */
  const [created, setCreated] = useState<ReadonlyMap<string, string>>(() => new Map());
  /** Suppliers found under a name about to be created, offered for linking although the page's list predates them. */
  const [foundOptions, setFoundOptions] = useState<readonly MaterialRequestSupplierOption[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const readAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    void fetchMaterialRequestWorkbookPreview(projectId, requestId, file.id, { sheet, headerRow }, abort.signal)
      .then((data) => {
        if (abort.signal.aborted) return;
        setDetection(data);
        const stored = readRememberedWorkbookColumns(profileId, workbookHeaderSignature(data.columns));
        const remembered = usableMapping(stored?.mapping, data);
        const next = remembered ?? toMapping(data.detected_columns);
        setMapping(next);
        setSplitDimension((remembered ? stored?.splitDimension : undefined) ?? columnHasParts(data, next.dimension));
        setReading(false);
      })
      .catch((cause: unknown) => {
        if (abort.signal.aborted) return;
        setError(materialRequestErrorMessage(cause, "L’aperçu du classeur n’a pas pu être affiché."));
        setReading(false);
      });
    return () => abort.abort();
  }, [attempt, file.id, headerRow, open, profileId, projectId, requestId, sheet]);

  useEffect(() => () => readAbort.current?.abort(), []);

  const changeOpen = (next: boolean) => {
    if (busy.current) return;
    readAbort.current?.abort();
    setOpen(next);
    setStep("columns");
    setSheet(undefined);
    setHeaderRow(undefined);
    setDetection(null);
    setPreview(null);
    setMapping({});
    setChoices(new Map());
    setApplied(new Map());
    setCreated(new Map());
    setFoundOptions([]);
    setError(null);
    setReading(next);
  };

  const retryReading = () => {
    setError(null);
    setReading(true);
    setAttempt((count) => count + 1);
  };

  const unresolved = useMemo(() => (preview?.suppliers ?? []).filter((entry) => entry.status !== "recognized"), [preview]);
  const nameByKey = useMemo(
    () => new Map((preview?.suppliers ?? []).map((entry) => [workbookSupplierNameKey(entry.name), entry.name])),
    [preview],
  );
  const supplierOptions = useMemo(() => {
    const known = new Set(editor.data.supplierOptions.map((option) => option.id));
    return [...editor.data.supplierOptions, ...foundOptions.filter((option) => !known.has(option.id))];
  }, [editor.data.supplierOptions, foundOptions]);
  const labelById = useMemo(() => new Map(supplierOptions.map((option) => [option.id, option.label])), [supplierOptions]);
  /** The reading on screen is the one of the sheet and header row chosen (not one still loading or that failed). */
  const readingCurrent = detection !== null
    && (sheet === undefined || sheet === detection.sheet_name)
    && (headerRow === undefined || headerRow === detection.header_row);

  const showPreview = (data: MaterialRequestWorkbookPreview) => {
    setPreview(data);
    setSelected(new Set(data.rows.filter((row) => row.selected).map((row) => row.row_number)));
    // Choices and what was already linked or created are kept by name: going back to the columns never creates twice.
    setStep(data.suppliers.some((entry) => entry.status !== "recognized") ? "suppliers" : "preview");
  };

  const confirmColumns = async () => {
    if (!detection || detection.header_row === null || !mapping.designation || busy.current) return;
    const split = splitDimension && mapping.dimension !== undefined;
    rememberWorkbookColumns(profileId, workbookHeaderSignature(detection.columns), mapping, split);
    setError(null);
    if (sameWorkbookMapping(mapping, toMapping(detection.mapped_columns)) && split === detection.split_dimension) {
      showPreview(detection);
      return;
    }
    readAbort.current?.abort();
    const abort = new AbortController();
    readAbort.current = abort;
    setReading(true);
    try {
      const data = await fetchMaterialRequestWorkbookPreview(projectId, requestId, file.id, { sheet: detection.sheet_name, headerRow: detection.header_row, mapping, splitDimension: split }, abort.signal);
      if (!abort.signal.aborted) showPreview(data);
    } catch (cause) {
      if (!abort.signal.aborted) setError(materialRequestErrorMessage(cause, "L’aperçu du classeur n’a pas pu être affiché."));
    } finally {
      if (!abort.signal.aborted) setReading(false);
    }
  };

  /**
   * Links and creates what the user chose, one name after the other; a name done stays done if a later one fails.
   * Before creating a supplier for an unknown name, the active suppliers are read again: one of that name created
   * meanwhile (by another import, for instance) is offered for linking instead.
   */
  const confirmSuppliers = async () => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    const done = new Map(applied);
    const made = new Map(created);
    let directory: Awaited<ReturnType<typeof fetchSupplierDirectory>> | null = null;
    let failure: string | null = null;
    for (const entry of unresolved) {
      if (done.has(entry.name) || entry.status === "inactive_alias") continue;
      const choice = choices.get(entry.name);
      if (!choice || choice.kind === "leave") continue;
      try {
        if (choice.kind === "link") {
          if (!choice.supplierId) {
            failure = `Choisissez le fournisseur à associer à « ${entry.name} », ou laissez-le sans fournisseur.`;
            break;
          }
          await rememberSupplierAlias(choice.supplierId, entry.name);
          done.set(entry.name, choice.supplierId);
          continue;
        }
        let supplierId = made.get(entry.name);
        if (!supplierId) {
          if (entry.status === "unknown") {
            directory ??= await fetchSupplierDirectory(undefined, "active");
            const key = workbookSupplierNameKey(entry.name);
            const existing = directory.find((supplier) => workbookSupplierNameKey(supplier.name) === key);
            if (existing) {
              setFoundOptions((current) => (current.some((option) => option.id === existing.id) ? current : [...current, existing]));
              setChoices((current) => new Map(current).set(entry.name, { kind: "link", supplierId: existing.id }));
              failure = `Le fournisseur « ${existing.label} » existe déjà. Il est proposé à l’association avec « ${entry.name} » : vérifiez, puis continuez.`;
              break;
            }
          }
          const answer = await editor.createSupplier(entry.name);
          if (!answer.ok) {
            failure = answer.message;
            break;
          }
          supplierId = answer.id;
          made.set(entry.name, supplierId);
        }
        // A homonym already exists: the spelling is associated with the new supplier so the next import is certain.
        if (entry.status === "ambiguous") await rememberSupplierAlias(supplierId, entry.name);
        done.set(entry.name, supplierId);
      } catch (cause) {
        failure = made.has(entry.name)
          ? materialRequestErrorMessage(cause, `Le fournisseur « ${entry.name} » est créé, mais ce nom n’a pas pu lui être associé. Continuez pour réessayer.`)
          : materialRequestErrorMessage(cause, `« ${entry.name} » n’a pas pu être associé.`);
        break;
      }
    }
    setApplied(done);
    setCreated(made);
    busy.current = false;
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    setStep("preview");
  };

  const rows = useMemo(() => (preview?.rows ?? []).map((row) => {
    const name = row.supplier_name ? nameByKey.get(workbookSupplierNameKey(row.supplier_name)) : undefined;
    const supplierId = (name && applied.get(name)) || row.line.supplier_id || null;
    return { ...row, line: supplierId ? { ...row.line, supplier_id: supplierId } : row.line };
  }), [applied, nameByKey, preview]);
  const chosen = rows.filter(({ row_number }) => selected.has(row_number));
  const available = MATERIAL_REQUEST_MAX_LINES - editor.data.lines.length;
  const canAdd = editor.canWrite && !reading && chosen.length > 0 && chosen.length <= available;

  const add = async () => {
    if (!canAdd || busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    const result = await editor.addLines(chosen.map(({ line }) => line));
    busy.current = false;
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    toast.success({ title: `${plural(chosen.length, "ligne ajoutée", "lignes ajoutées")} en brouillon` });
    changeOpen(false);
    onImported();
  };

  const issues = new Map((preview?.issues ?? []).map(({ row_number, message }) => [row_number, message]));
  const lines = new Map(rows.map((row) => [row.row_number, row]));
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
          <DialogDescription className="break-words">{file.file_name} · {STEP_TITLES[step]}</DialogDescription>
        </DialogHeader>
        {step === "columns" && (reading && !detection ? <LoadingState label="Lecture du classeur…" /> : detection && (
          <MaterialRequestWorkbookColumns
            preview={detection}
            sheet={sheet ?? detection.sheet_name}
            mapping={mapping}
            disabled={reading || saving}
            onSheetChange={(next) => {
              setError(null);
              setReading(true);
              setHeaderRow(undefined);
              setSheet(next);
            }}
            onHeaderRowChange={(row) => {
              // The same row again (after a failed reading) reads it again: the error is never cleared without a load.
              if (row === headerRow) {
                retryReading();
                return;
              }
              setError(null);
              setReading(true);
              setHeaderRow(row);
            }}
            splitDimension={splitDimension}
            onSplitDimensionChange={setSplitDimension}
            onMappingChange={(next) => {
              // A new dimension column comes with its own proposal; the user's tick stays for the same column.
              if (next.dimension !== mapping.dimension) setSplitDimension(columnHasParts(detection, next.dimension));
              setMapping(next);
            }}
          />
        ))}
        {step === "suppliers" && preview && (
          <MaterialRequestWorkbookSuppliers
            names={unresolved}
            rights={preview.supplier_rights}
            options={supplierOptions}
            choices={choices}
            applied={applied}
            disabled={saving}
            onChoiceChange={(name, choice) => setChoices((current) => new Map(current).set(name, choice))}
          />
        )}
        {step === "preview" && preview && (
          <div className="space-y-3">
            {rowNumbers.length === 0 ? <p>Cette feuille ne contient aucune ligne de matériel.</p> : (
              <div className="max-h-[50dvh] overflow-auto rounded-md border border-border" tabIndex={0} aria-label="Aperçu des lignes Excel" role="region">
                <table className="w-full min-w-max border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-surface-subtle text-left">
                    <tr>
                      <th scope="col" className="px-3 py-2">
                        <input type="checkbox" className="size-4 accent-primary"
                          aria-label="Sélectionner toutes les lignes"
                          checked={rows.length > 0 && chosen.length === rows.length}
                          disabled={saving || rows.length === 0}
                          onChange={(event) => setSelected(new Set(event.currentTarget.checked ? rows.map((row) => row.row_number) : []))}
                        />
                      </th>
                      {HEADINGS.map((heading) => <th key={heading} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{heading}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rowNumbers.map((number) => {
                      const row = lines.get(number);
                      const line = row?.line;
                      const supplier = line?.supplier_id ? labelById.get(line.supplier_id) ?? row?.supplier_name : row?.supplier_name;
                      return (
                        <tr key={number} className="border-t border-border align-top">
                          <td className="px-3 py-2">
                            {row && <input type="checkbox" className="size-4 accent-primary"
                              aria-label={`Sélectionner la ligne ${number}`}
                              checked={selected.has(number)} disabled={saving}
                              onChange={(event) => {
                                const next = new Set(selected);
                                if (event.currentTarget.checked) next.add(number);
                                else next.delete(number);
                                setSelected(next);
                              }}
                            />}
                          </td>
                          <th scope="row" className="px-3 py-2 text-right font-normal tabular-nums">{number}</th>
                          <td className="max-w-60 break-words px-3 py-2">
                            {line?.original_text}
                            {issues.has(number) && <p className="text-xs text-warning">{issues.get(number)}</p>}
                            {row?.remarks.map((remark) => (
                              <p key={remark.code} className={remark.code === "rounded" ? "text-xs text-muted-foreground" : "text-xs text-warning"}>{remark.message}</p>
                            ))}
                          </td>
                          <td className="max-w-40 break-words px-3 py-2">{line?.dimension}</td>
                          <td className="max-w-40 break-words px-3 py-2">{line?.material_precision}</td>
                          <td className="whitespace-nowrap px-3 py-2 tabular-nums">{line?.quantity == null ? null : quantityFormat.format(line.quantity)}</td>
                          <td className="max-w-40 break-words px-3 py-2">{line?.unit}</td>
                          <td className="max-w-40 break-words px-3 py-2">
                            {supplier}
                            {row?.supplier_name && !line?.supplier_id && <p className="text-xs text-muted-foreground">Sans fournisseur</p>}
                          </td>
                          <td className="max-w-40 break-words px-3 py-2">{line?.reference}</td>
                          <td className="max-w-40 break-words px-3 py-2">{line?.material}</td>
                          <td className="max-w-40 break-words px-3 py-2">{line?.zone}</td>
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
            {chosen.length > available && (
              <Alert variant="warning"><AlertDescription>
                Il reste {plural(available, "place", "places")} dans la demande. Réduisez la sélection pour continuer.
              </AlertDescription></Alert>
            )}
          </div>
        )}
        {error && (
          <Alert variant="danger" role="alert"><AlertDescription>
            {error}
            {step === "columns" && !reading && !readingCurrent && (
              <Button type="button" variant="outline" size="sm" className="mt-2 block" onClick={retryReading}>Réessayer</Button>
            )}
          </AlertDescription></Alert>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" disabled={saving} onClick={() => changeOpen(false)}>Annuler</Button>
          {step !== "columns" && (
            <Button type="button" variant="outline" disabled={saving}
              onClick={() => { setError(null); setStep(step === "preview" && unresolved.length > 0 ? "suppliers" : "columns"); }}>
              Retour
            </Button>
          )}
          {step === "columns" && (
            <Button type="button" disabled={!readingCurrent || detection.header_row === null || !mapping.designation || reading} loading={reading && !!detection} onClick={() => void confirmColumns()}>
              Continuer
            </Button>
          )}
          {step === "suppliers" && (
            <Button type="button" loading={saving} onClick={() => void confirmSuppliers()}>Continuer</Button>
          )}
          {step === "preview" && (
            <Button type="button" disabled={!canAdd} loading={saving} onClick={() => void add()}>
              Ajouter {plural(chosen.length, "ligne", "lignes")} en brouillon
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
