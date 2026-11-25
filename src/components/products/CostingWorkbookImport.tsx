"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import Link from "next/link";
import { FileSpreadsheetIcon, FileUpIcon, Loader2, RefreshCwIcon } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  COSTING_WORKBOOK_SHEET,
  inspectCostingWorkbookColumns,
  type CostingWorkbookSupplyKind,
} from "@/lib/catalogue/costing-workbook";
import {
  COSTING_WORKBOOK_FORMAT,
  COSTING_WORKBOOK_IMPORT_INCOMPLETE,
  COSTING_WORKBOOK_SUPPLY_TYPE_UNKNOWN,
  costingWorkbookSupplierReferenceReportSchema,
  type CostingWorkbookImportReport,
  type CostingWorkbookSupplierReferenceReport,
} from "@/lib/catalogue/costing-workbook-contract";
import {
  readWorkbookCorrectionsFile,
  WorkbookCorrectionsFileError,
} from "@/lib/catalogue/costing-workbook-corrections";
import {
  applyWorkbookEdits,
  mergeWorkbookEdits,
  workbookEditEntries,
  type WorkbookEdit,
} from "@/lib/catalogue/costing-workbook-edits";
import {
  CostingWorkbookFileError,
  costingWorkbookImportBody,
  readCostingWorkbookFile,
  type CostingWorkbookRows,
} from "@/lib/catalogue/costing-workbook-file";
import { asRecord } from "@/lib/value-guards";

import { ArticlePreview, type SupplyTypeChoices } from "./costing-workbook/ArticlePreview";
import { ColumnsPanel } from "./costing-workbook/ColumnsPanel";
import { CorrectionsJournal } from "./costing-workbook/CorrectionsJournal";
import { formatCount, plural, WorkbookEditorProvider, type WorkbookReview } from "./costing-workbook/shared";
import { SupplierReferenceReview } from "./costing-workbook/SupplierReferenceReview";

/**
 * Imports the office's costing workbook (« bible de chiffrage ») into the catalogue (TI-690, TI-711): its
 * articles as drafts, then the supplier references of its articles. The browser reads the sheet « All_data » and
 * asks the server for a preview (`confirm: false`, nothing written); the office reads what the import will do,
 * corrects in the screen what is wrong (a cell, a column, a supplier name), then confirms (`confirm: true`) with
 * the same rows. A correction changes the rows the screen holds, never the Excel file: the journal of
 * corrections says what to copy back into it.
 */

export type CostingWorkbookImportProps = {
  catalogueHref: string;
  draftsHref: string;
  onImported: () => void | Promise<void>;
};

const ENDPOINT = "/api/catalogue/workbook-import";
const FILE_INPUT_ID = "costing-workbook-file";
const CORRECTIONS_INPUT_ID = "costing-workbook-corrections-file";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const NETWORK_FAILURE = "Le serveur n’a pas répondu. Vérifiez la connexion, puis réessayez.";
const UNREADABLE_FILE = "Ce fichier n’a pas pu être lu comme un classeur Excel.";

type Phase = "idle" | "reading" | "previewing" | "importing";

type Mode = "articles" | "supplier-references";
type Report = CostingWorkbookImportReport | CostingWorkbookSupplierReferenceReport;
const INITIAL_SUPPLIER_REVIEW: WorkbookReview = { page: 0, view: "", search: "" };
const INITIAL_ARTICLE_REVIEW: WorkbookReview = { page: 0, view: "proposed", search: "" };

const PHASE_LABELS: Record<Exclude<Phase, "idle">, string> = {
  reading: "Lecture du classeur…",
  previewing: "Comparaison avec le catalogue…",
  importing: "Création des brouillons…",
};

type Outcome =
  | { ok: true; report: Report }
  | { ok: false; aborted: true }
  | { ok: false; aborted: false; message: string; retry: boolean; stale: boolean; code: string | null };

type RequestOptions = { previewToken?: string; supplyTypes?: SupplyTypeChoices };

function isReport(value: unknown): value is CostingWorkbookImportReport {
  const record = asRecord(value);
  return Boolean(
    record &&
      typeof record.new_articles === "number" &&
      typeof record.already_in_catalogue === "number" &&
      typeof record.supplier_references_not_imported === "number" &&
      Array.isArray(record.issues),
  );
}

/** A refusal in the server's words when it has some, in plain words otherwise. */
function refusal(status: number, payload: unknown): Extract<Outcome, { aborted: false }> {
  const error = asRecord(asRecord(payload)?.error);
  const code = typeof error?.code === "string" ? error.code : null;
  const serverMessage = typeof error?.message === "string" && error.message.trim() ? error.message : null;
  // The schema's refusal (« Payload invalide. ») says nothing to the office: the screen's own sentence instead.
  const message = code === "VALIDATION_ERROR" ? null : serverMessage;
  // Drafts may have been created (an import stopped half-way), the catalogue changed meanwhile (409) or a supply
  // type chosen here is gone: the preview no longer holds, a new one counts what is left.
  const stale = code === COSTING_WORKBOOK_IMPORT_INCOMPLETE || code === COSTING_WORKBOOK_SUPPLY_TYPE_UNKNOWN || status === 409;
  let fallback: string;
  if (code === COSTING_WORKBOOK_IMPORT_INCOMPLETE) {
    fallback = "L’import s’est arrêté en cours de route. Relancez-le : il reprend où il s’est arrêté.";
  } else if (code === COSTING_WORKBOOK_FORMAT || status === 422) {
    fallback = "Ce classeur n’a pas la forme attendue.";
  } else if (status === 403) {
    fallback = "L’import du classeur est réservé aux administrateurs et aux ingénieurs.";
  } else if (status === 413) {
    fallback = `L’onglet « ${COSTING_WORKBOOK_SHEET} » est trop lourd pour être envoyé.`;
  } else if (status === 400) {
    fallback = `Le serveur a refusé le contenu de l’onglet « ${COSTING_WORKBOOK_SHEET} ».`;
  } else {
    fallback = `L’import n’a pas abouti (erreur ${status}). Réessayez dans un instant.`;
  }
  // The file itself is refused (format, rights, size, content): choosing it again changes nothing.
  const retry = stale || ![400, 403, 413, 422].includes(status);
  return { ok: false, aborted: false, message: message ?? fallback, retry, stale, code };
}

export function CostingWorkbookImport({
  catalogueHref,
  draftsHref,
  onImported,
}: Readonly<CostingWorkbookImportProps>) {
  const [mode, setMode] = useState<Mode>("articles");
  const [fileName, setFileName] = useState<string | null>(null);
  /** The sheet as the file holds it, and the corrections made here: the import reads the first with the second. */
  const [baseRows, setBaseRows] = useState<CostingWorkbookRows | null>(null);
  const [edits, setEdits] = useState<WorkbookEdit[]>([]);
  const [supplyTypeChoices, setSupplyTypeChoices] = useState<SupplyTypeChoices>({});
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [phase, setPhase] = useState<Phase>("idle");
  const [previews, setPreviews] = useState<Partial<Record<Mode, Report>>>({});
  const [results, setResults] = useState<Partial<Record<Mode, Report>>>({});
  const [supplierReview, setSupplierReview] = useState(INITIAL_SUPPLIER_REVIEW);
  const [articleReview, setArticleReview] = useState(INITIAL_ARTICLE_REVIEW);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const correctionsInputRef = useRef<HTMLInputElement>(null);
  const aliveRef = useRef(true);
  const requestRef = useRef<AbortController | null>(null);
  const importingRef = useRef(false);

  const rows = useMemo(() => (baseRows ? applyWorkbookEdits(baseRows, edits) : null), [baseRows, edits]);
  const inspection = useMemo(() => (rows ? inspectCostingWorkbookColumns(rows) : null), [rows]);
  const journal = useMemo(
    () => (baseRows ? workbookEditEntries(baseRows, edits, inspection?.headerRow ?? null) : []),
    [baseRows, edits, inspection],
  );

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      // Leaving the page can discard a preview. A confirmed write should finish.
      aliveRef.current = false;
      if (!importingRef.current) requestRef.current?.abort();
    };
  }, []);

  // Leaving loses a running import's answer, and the corrections made here: they live in this page only.
  const warnBeforeLeaving = phase === "importing" || edits.length > 0;
  useEffect(() => {
    if (!warnBeforeLeaving) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [warnBeforeLeaving]);

  const isBusy = phase !== "idle";
  const preview = previews[mode];
  const result = results[mode];

  const supplierMode = mode === "supplier-references";

  async function send(targetMode: Mode, currentRows: CostingWorkbookRows, confirm: boolean, options: RequestOptions = {}): Promise<Outcome> {
    const forSuppliers = targetMode === "supplier-references";
    let body: string;
    try {
      body = costingWorkbookImportBody(currentRows, confirm, forSuppliers
        ? { preview_token: options.previewToken }
        : { supply_types: options.supplyTypes && Object.keys(options.supplyTypes).length > 0 ? options.supplyTypes : undefined });
    } catch (bodyError) {
      const message = bodyError instanceof CostingWorkbookFileError ? bodyError.message : UNREADABLE_FILE;
      return { ok: false, aborted: false, message, retry: false, stale: false, code: null };
    }
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch(forSuppliers ? ENDPOINT + "/supplier-references" : ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        cache: "no-store",
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) return refusal(response.status, payload);
      const data = asRecord(payload)?.data;
      if (forSuppliers) {
        const report = costingWorkbookSupplierReferenceReportSchema.safeParse(data);
        if (report.success) return { ok: true, report: report.data };
      } else if (isReport(data)) {
        return { ok: true, report: data };
      }
      return { ok: false, aborted: false, message: "Réponse inattendue du serveur. Réessayez dans un instant.", retry: true, stale: false, code: null };
    } catch {
      if (controller.signal.aborted) return { ok: false, aborted: true };
      return { ok: false, aborted: false, message: NETWORK_FAILURE, retry: true, stale: false, code: null };
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  async function refreshCatalogue() {
    try {
      await onImported();
    } catch {
      if (aliveRef.current) setError("Les brouillons sont créés, mais la liste n’a pas pu être actualisée.");
    }
  }

  async function runPreview(targetMode: Mode, currentRows: CostingWorkbookRows, choices: SupplyTypeChoices = supplyTypeChoices) {
    setPhase("previewing");
    setError(null);
    setCanRetry(false);
    const outcome = await send(targetMode, currentRows, false, { supplyTypes: choices });
    if (!aliveRef.current || (!outcome.ok && outcome.aborted)) return;
    setPhase("idle");
    if (outcome.ok) {
      setPreviews((previous) => ({ ...previous, [targetMode]: outcome.report }));
    } else {
      if (outcome.code === COSTING_WORKBOOK_SUPPLY_TYPE_UNKNOWN) setSupplyTypeChoices({});
      setError(outcome.message);
      setCanRetry(outcome.retry);
    }
  }

  function changeMode(choice: Mode) {
    if (choice === mode || isBusy) return;
    setMode(choice);
    if (!rows) return;
    setError(null);
    setCanRetry(false);
    if (!previews[choice] && !results[choice]) void runPreview(choice, rows);
  }

  /** The same sheet against the catalogue as it is now: after a fix made in the catalogue, or to see an import's rest. */
  function refresh() {
    if (!rows || isBusy) return;
    setPreviews({});
    setResults((previous) => ({ ...previous, [mode]: undefined }));
    void runPreview(mode, rows);
  }

  /** The journal changed: every preview read the sheet without it, and a result is no longer what the screen shows. */
  function commitEdits(nextEdits: WorkbookEdit[]) {
    if (!baseRows || isBusy) return;
    setEdits(nextEdits);
    setPreviews({});
    setResults({});
    void runPreview(mode, applyWorkbookEdits(baseRows, nextEdits));
  }

  function applyEdits(added: WorkbookEdit[]) {
    if (!baseRows || added.length === 0) return;
    setNotice(null);
    commitEdits(mergeWorkbookEdits(baseRows, edits, added));
  }

  function chooseSupplyType(kind: CostingWorkbookSupplyKind, supplyTypeId: string | null) {
    if (!rows || isBusy) return;
    const next = { ...supplyTypeChoices };
    if (supplyTypeId) next[kind] = supplyTypeId;
    else delete next[kind];
    setSupplyTypeChoices(next);
    setPreviews((previous) => ({ ...previous, articles: undefined }));
    void runPreview("articles", rows, next);
  }

  async function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    // A file dialog closed without a choice keeps the workbook in hand.
    if (!file) return;
    setBaseRows(null);
    setFileName(null);
    setEdits([]);
    setSupplyTypeChoices({});
    setDismissed(new Set());
    setPreviews({});
    setResults({});
    setSupplierReview(INITIAL_SUPPLIER_REVIEW);
    setArticleReview(INITIAL_ARTICLE_REVIEW);
    setError(null);
    setNotice(null);
    setCanRetry(false);
    if (!/\.xls[xm]$/i.test(file.name)) {
      setError("Choisissez un fichier .xlsm ou .xlsx.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError("Ce fichier dépasse 20 Mo : ce n’est pas le classeur de chiffrage attendu.");
      return;
    }

    setPhase("reading");
    let nextRows: CostingWorkbookRows;
    try {
      nextRows = await readCostingWorkbookFile(await file.arrayBuffer());
    } catch (readError) {
      if (!aliveRef.current) return;
      setPhase("idle");
      setError(readError instanceof CostingWorkbookFileError ? readError.message : UNREADABLE_FILE);
      return;
    }
    if (!aliveRef.current) return;
    setBaseRows(nextRows);
    setFileName(file.name);
    await runPreview(mode, nextRows, {});
  }

  /** A corrections file exported from this screen and filled by the office: each filled line corrects its cell. */
  async function chooseCorrectionsFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file || !baseRows || !rows || isBusy) return;
    setError(null);
    setNotice(null);
    try {
      const read = await readWorkbookCorrectionsFile(await file.arrayBuffer(), rows);
      if (!aliveRef.current) return;
      const changed = read.skipped.filter((entry) => entry.reason === "changed").length;
      const unknown = read.skipped.length - changed;
      const left = [
        changed > 0 ? `${formatCount(changed)} ${plural(changed, "écartée : sa cellule", "écartées : leur cellule")} ne contient plus la valeur d’origine` : "",
        unknown > 0 ? `${formatCount(unknown)} ${plural(unknown, "écartée : son adresse", "écartées : leur adresse")} n’est pas une cellule de l’onglet` : "",
      ].filter(Boolean).join(" ; ");
      if (read.edits.length === 0) {
        setNotice(`Aucune correction à appliquer dans ce fichier${left ? ` (${left})` : " : la colonne « Correction à renseigner » est vide"}.`);
        return;
      }
      setNotice(
        `${formatCount(read.edits.length)} ${plural(read.edits.length, "correction lue", "corrections lues")} dans ${file.name}${left ? ` ; ${left}` : ""}.`,
      );
      commitEdits(mergeWorkbookEdits(baseRows, edits, read.edits));
    } catch (readError) {
      if (!aliveRef.current) return;
      setError(readError instanceof WorkbookCorrectionsFileError ? readError.message : "Ce fichier de corrections n’a pas pu être lu.");
    }
  }

  const supplierReport = result && "for_decision" in result
    ? result : preview && "for_decision" in preview ? preview : null;
  const articleResult = result && "new_articles" in result ? result : null;
  const articlePreview = preview && "new_articles" in preview ? preview : null;
  const toImport = articlePreview?.new_articles ?? supplierReport?.to_import ?? 0;

  async function runImport() {
    if (!rows || !preview || toImport === 0 || importingRef.current) return;
    importingRef.current = true;
    setPhase("importing");
    setError(null);
    setNotice(null);
    setCanRetry(false);
    // A write can change the catalogue that the other mode's preview was based on.
    setPreviews({ [mode]: preview });
    const outcome = await send(mode, rows, true, {
      previewToken: supplierReport?.preview_token ?? undefined,
      supplyTypes: supplyTypeChoices,
    });
    importingRef.current = false;
    if (!outcome.ok && outcome.aborted) return;
    if (!aliveRef.current) {
      if (!supplierMode && (outcome.ok || outcome.stale)) await refreshCatalogue();
      return;
    }
    setPhase("idle");
    if (outcome.ok) {
      setPreviews({});
      // New drafts are articles the references can now attach to: a result of the references shown before them
      // no longer says what is left to import.
      setResults((previous) => (supplierMode ? { ...previous, [mode]: outcome.report } : { [mode]: outcome.report }));
      if (!supplierMode) await refreshCatalogue();
      return;
    }
    if (outcome.code === COSTING_WORKBOOK_SUPPLY_TYPE_UNKNOWN) setSupplyTypeChoices({});
    setError(outcome.message);
    if (outcome.stale || (supplierMode && outcome.retry)) {
      // The catalogue may have changed, or the response may have been lost after a successful write.
      setPreviews({});
      setCanRetry(true);
      if (!supplierMode) await refreshCatalogue();
    }
  }

  const label = supplierMode ? (toImport > 1 ? "références" : "référence")
    : (toImport > 1 ? "brouillons" : "brouillon");
  // The reader cannot start without its required columns: the office points them to their headers here.
  const columnsToMap = inspection && !preview && !result && phase === "idle" && inspection.missingRequired.length > 0 ? inspection : null;

  return (
    <section aria-labelledby="costing-workbook-title" className="w-full min-w-0">
      <PageHeader
        title={<span id="costing-workbook-title">Importer le classeur de chiffrage</span>}
        breadcrumbs={[
          { label: "Référentiel", href: phase === "importing" ? undefined : "/dashboard/referentiel" },
          { label: "Produits", href: phase === "importing" ? undefined : catalogueHref },
          { label: "Import du classeur" },
        ]}
      />
      <Tabs
        value={mode}
        onValueChange={(value) => {
          if (value === "articles" || value === "supplier-references") changeMode(value);
        }}
        className="min-w-0 gap-4"
      >
        <div className="space-y-3 border-b border-border bg-background pb-3 xl:sticky xl:top-15 xl:z-10 xl:pt-2">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <TabsList aria-label="Type d’import" variant="line" className="h-auto! max-w-full flex-wrap justify-start p-0">
              <TabsTrigger value="articles" disabled={isBusy && supplierMode} className="min-h-9 px-3">
                Articles en brouillon
              </TabsTrigger>
              <TabsTrigger value="supplier-references" disabled={isBusy && !supplierMode} className="min-h-9 px-3">
                Références fournisseur
              </TabsTrigger>
            </TabsList>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                id={FILE_INPUT_ID}
                type="file"
                accept=".xlsm,.xlsx,application/vnd.ms-excel.sheet.macroEnabled.12,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                aria-label="Fichier Excel"
                disabled={isBusy}
                onChange={(event) => void chooseFile(event)}
                hidden
              />
              <input
                ref={correctionsInputRef}
                id={CORRECTIONS_INPUT_ID}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                aria-label="Fichier de corrections"
                disabled={isBusy || !rows}
                onChange={(event) => void chooseCorrectionsFile(event)}
                hidden
              />
              <Button
                variant="outline"
                disabled={isBusy}
                leftIcon={<FileSpreadsheetIcon aria-hidden="true" />}
                onClick={() => {
                  const input = fileInputRef.current;
                  if (!input) return;
                  // A browser stays silent when the same path is chosen again: the workbook saved under its own
                  // name after a correction would not be read. Emptied first, any choice is a new one.
                  input.value = "";
                  input.click();
                }}
              >
                {rows ? "Changer de fichier Excel" : "Choisir un fichier Excel"}
              </Button>
              {rows ? (
                <>
                  <Button
                    variant="outline"
                    disabled={isBusy}
                    leftIcon={<RefreshCwIcon aria-hidden="true" />}
                    title="Comparer à nouveau ce classeur au catalogue, sans le choisir à nouveau"
                    onClick={refresh}
                  >
                    Actualiser l’aperçu
                  </Button>
                  <Button
                    variant="outline"
                    disabled={isBusy}
                    leftIcon={<FileUpIcon aria-hidden="true" />}
                    title="Lire un fichier de corrections exporté d’ici, puis rempli"
                    onClick={() => correctionsInputRef.current?.click()}
                  >
                    Importer des corrections
                  </Button>
                </>
              ) : null}
              {articleResult ? (
                <Link className={buttonVariants()} href={draftsHref}>
                  Voir les brouillons
                </Link>
              ) : null}
              {preview && !result ? (
                <Button
                  loading={phase === "importing"}
                  disabled={isBusy || toImport === 0}
                  onClick={() => void runImport()}
                >
                  {"Importer " + formatCount(toImport) + " " + label}
                </Button>
              ) : null}
            </div>
          </div>

          {fileName && baseRows ? (
            <p className="text-xs text-muted-foreground">
              {`${fileName} · ${formatCount(baseRows.length)} ${plural(baseRows.length, "ligne lue", "lignes lues")} dans l’onglet « ${COSTING_WORKBOOK_SHEET} »`}
            </p>
          ) : null}

          <div aria-live="polite" className="space-y-3 empty:hidden">
            {phase !== "idle" ? (
              <p className="flex items-center gap-2 text-sm text-info">
                <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
                {supplierMode && phase === "importing" ? "Enregistrement des références…" : PHASE_LABELS[phase]}
              </p>
            ) : null}
            {error ? <Alert variant="danger">{error}</Alert> : null}
            {notice ? <Alert variant="info">{notice}</Alert> : null}
            {articleResult ? (
              <Alert variant="success">
                {articleResult.new_articles === 0
                  ? "Import terminé : aucun brouillon créé, rien de nouveau."
                  : `Import terminé : ${formatCount(articleResult.new_articles)} ${plural(articleResult.new_articles, "brouillon créé", "brouillons créés")}.`}
              </Alert>
            ) : null}
          </div>

          {canRetry && rows && !preview && phase === "idle" ? (
            <div>
              <Button variant="secondary" size="md" onClick={() => void runPreview(mode, rows)}>
                Réessayer
              </Button>
            </div>
          ) : null}

          {articleResult ? (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <p className="text-sm text-foreground-secondary">
                Vérifiez chaque brouillon puis validez-le depuis le catalogue.
              </p>
              {articleResult.supplier_references_not_imported > 0 ? (
                <Button variant="secondary" size="sm" disabled={isBusy} onClick={() => changeMode("supplier-references")}>
                  Reprendre leurs références fournisseur
                </Button>
              ) : null}
            </div>
          ) : null}

          <CorrectionsJournal
            entries={journal}
            busy={isBusy}
            onUndo={(entry) => commitEdits(edits.filter((edit) => edit.row !== entry.row || edit.column !== entry.column))}
            onUndoAll={() => commitEdits([])}
          />
        </div>
        {rows ? (
          <WorkbookEditorProvider value={{ rows, busy: isBusy, applyEdits }}>
            {columnsToMap ? (
              <div className="rounded-lg border border-border bg-surface p-4 sm:p-5">
                <ColumnsPanel inspection={columnsToMap} />
              </div>
            ) : null}
            <TabsContent value="articles">
              {articlePreview ? (
                <ArticlePreview
                  report={articlePreview}
                  rows={rows}
                  review={articleReview}
                  onReviewChange={setArticleReview}
                  supplyTypeChoices={supplyTypeChoices}
                  onSupplyTypeChoice={chooseSupplyType}
                  onShowSupplierReferences={() => changeMode("supplier-references")}
                />
              ) : null}
            </TabsContent>
            <TabsContent value="supplier-references">
              {supplierReport ? (
                <SupplierReferenceReview
                  report={supplierReport}
                  rows={rows}
                  review={supplierReview}
                  onReviewChange={setSupplierReview}
                  dismissed={dismissed}
                  onDismiss={(cells, set) => setDismissed((previous) => {
                    const next = new Set(previous);
                    for (const cell of cells) {
                      if (set) next.add(cell);
                      else next.delete(cell);
                    }
                    return next;
                  })}
                  onShowDrafts={() => changeMode("articles")}
                  onRefresh={refresh}
                />
              ) : null}
            </TabsContent>
          </WorkbookEditorProvider>
        ) : null}
      </Tabs>
    </section>
  );
}
