"use client";

import { useEffect, useRef, useState } from "react";

import { Loader2 } from "lucide-react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { controlSurface } from "@/components/ui/input";
import { COSTING_WORKBOOK_SHEET } from "@/lib/catalogue/costing-workbook";
import {
  COSTING_WORKBOOK_FORMAT,
  COSTING_WORKBOOK_IMPORT_INCOMPLETE,
  type CostingWorkbookImportReport,
} from "@/lib/catalogue/costing-workbook-contract";
import {
  CostingWorkbookFileError,
  costingWorkbookImportBody,
  readCostingWorkbookFile,
  type CostingWorkbookRows,
} from "@/lib/catalogue/costing-workbook-file";
import { cn } from "@/lib/utils";

/**
 * Imports the office's costing workbook (« bible de chiffrage ») into catalogue drafts (TI-690, lot 1). The
 * browser reads the sheet « All_data » and asks the server for a preview (`confirm: false`, nothing written);
 * the office reads what the import will do, then confirms (`confirm: true`) with the same rows. Every draft is
 * then checked and validated one by one in the catalogue.
 */

export type CostingWorkbookImportProps = {
  open: boolean;
  onClose: () => void;
  /** Refreshes the catalogue list after drafts were created. */
  onImported: () => void | Promise<void>;
  /** Shows the catalogue filtered on drafts. */
  onShowDrafts: () => void;
};

const ENDPOINT = "/api/catalogue/workbook-import";
const FILE_INPUT_ID = "costing-workbook-file";
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const NETWORK_FAILURE = "Le serveur n’a pas répondu. Vérifiez la connexion, puis réessayez.";
const UNREADABLE_FILE = "Ce fichier n’a pas pu être lu comme un classeur Excel.";

type Phase = "idle" | "reading" | "previewing" | "importing";

const PHASE_LABELS: Record<Exclude<Phase, "idle">, string> = {
  reading: "Lecture du classeur…",
  previewing: "Comparaison avec le catalogue…",
  importing: "Création des brouillons…",
};

type Outcome =
  | { ok: true; report: CostingWorkbookImportReport }
  | { ok: false; aborted: true }
  | { ok: false; aborted: false; message: string; retry: boolean; stale: boolean };

const formatCount = (value: number) => value.toLocaleString("fr-FR");

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

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
  // The schema's refusal (« Payload invalide. ») says nothing to the office: the dialog's own sentence instead.
  const message = code === "VALIDATION_ERROR" ? null : serverMessage;
  // Drafts may have been created (an import stopped half-way) or the catalogue changed meanwhile (409): the
  // preview no longer holds, a new one counts what is left.
  const stale = code === COSTING_WORKBOOK_IMPORT_INCOMPLETE || status === 409;
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
  return { ok: false, aborted: false, message: message ?? fallback, retry, stale };
}

export function CostingWorkbookImport({ open, onClose, onImported, onShowDrafts }: Readonly<CostingWorkbookImportProps>) {
  const [isImporting, setIsImporting] = useState(false);

  return (
    <Dialog
      disablePointerDismissal
      open={open}
      onOpenChange={(nextOpen) => {
        // A confirmed import is a write in progress: its result must be seen.
        if (!nextOpen && !isImporting) onClose();
      }}
    >
      <DialogContent size="lg">
        {/* Mounted with each opening (the popup unmounts when closed): every opening starts clean. */}
        <CostingWorkbookImportSteps
          onClose={onClose}
          onImported={onImported}
          onShowDrafts={onShowDrafts}
          onImportingChange={setIsImporting}
        />
      </DialogContent>
    </Dialog>
  );
}

function CostingWorkbookImportSteps({
  onClose,
  onImported,
  onShowDrafts,
  onImportingChange,
}: Readonly<Omit<CostingWorkbookImportProps, "open"> & { onImportingChange: (importing: boolean) => void }>) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<CostingWorkbookRows | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<CostingWorkbookImportReport | null>(null);
  const [result, setResult] = useState<CostingWorkbookImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const aliveRef = useRef(true);
  const requestRef = useRef<AbortController | null>(null);
  const importingRef = useRef(false);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      // A closed dialog takes no answer: a late preview must not fill the next opening.
      aliveRef.current = false;
      requestRef.current?.abort();
      onImportingChange(false);
    };
  }, [onImportingChange]);

  const isBusy = phase !== "idle";

  async function send(currentRows: CostingWorkbookRows, confirm: boolean): Promise<Outcome> {
    let body: string;
    try {
      body = costingWorkbookImportBody(currentRows, confirm);
    } catch (bodyError) {
      const message = bodyError instanceof CostingWorkbookFileError ? bodyError.message : UNREADABLE_FILE;
      return { ok: false, aborted: false, message, retry: false, stale: false };
    }
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        cache: "no-store",
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) return refusal(response.status, payload);
      const data = asRecord(payload)?.data;
      if (!isReport(data)) {
        return { ok: false, aborted: false, message: "Réponse inattendue du serveur. Réessayez dans un instant.", retry: true, stale: false };
      }
      return { ok: true, report: data };
    } catch {
      if (controller.signal.aborted) return { ok: false, aborted: true };
      return { ok: false, aborted: false, message: NETWORK_FAILURE, retry: true, stale: false };
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

  async function runPreview(currentRows: CostingWorkbookRows) {
    setPhase("previewing");
    setError(null);
    setCanRetry(false);
    const outcome = await send(currentRows, false);
    if (!aliveRef.current || (!outcome.ok && outcome.aborted)) return;
    setPhase("idle");
    if (outcome.ok) {
      setPreview(outcome.report);
    } else {
      setError(outcome.message);
      setCanRetry(outcome.retry);
    }
  }

  async function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setRows(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setCanRetry(false);
    setFileName(file?.name ?? null);
    if (!file) return;
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
    setRows(nextRows);
    await runPreview(nextRows);
  }

  async function runImport() {
    if (!rows || !preview || preview.new_articles === 0 || importingRef.current) return;
    importingRef.current = true;
    onImportingChange(true);
    setPhase("importing");
    setError(null);
    setCanRetry(false);
    const outcome = await send(rows, true);
    importingRef.current = false;
    onImportingChange(false);
    if (!aliveRef.current || (!outcome.ok && outcome.aborted)) return;
    setPhase("idle");
    if (outcome.ok) {
      setPreview(null);
      setResult(outcome.report);
      await refreshCatalogue();
      return;
    }
    setError(outcome.message);
    if (outcome.stale) {
      // Some drafts may exist now: a new preview counts what is left.
      setPreview(null);
      setCanRetry(true);
      await refreshCatalogue();
    }
  }

  const newArticles = preview?.new_articles ?? 0;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Importer le classeur de chiffrage</DialogTitle>
        <DialogDescription>
          Les articles de l’onglet « {COSTING_WORKBOOK_SHEET} » deviennent des brouillons, à vérifier et valider
          un par un. Les articles déjà au catalogue ne changent pas.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="gap-4" aria-busy={isBusy}>
        <div className="min-w-0">
          <label className="block text-sm font-semibold text-foreground" htmlFor={FILE_INPUT_ID}>
            Classeur de chiffrage
          </label>
          <p id={`${FILE_INPUT_ID}-help`} className="mb-2 mt-1 text-xs text-muted-foreground">
            Fichier .xlsm ou .xlsx. Rien n’est enregistré avant votre confirmation.
          </p>
          <input
            id={FILE_INPUT_ID}
            type="file"
            accept=".xlsm,.xlsx,application/vnd.ms-excel.sheet.macroEnabled.12,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-describedby={`${FILE_INPUT_ID}-help`}
            disabled={isBusy}
            onChange={(event) => void chooseFile(event)}
            className={cn(
              controlSurface,
              "block w-full min-w-0 px-3 py-2.5 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:font-medium file:text-primary-foreground hover:file:brightness-105",
            )}
          />
          {fileName ? <p className="mt-2 break-all text-xs text-muted-foreground">Fichier : {fileName}</p> : null}
        </div>

        <div aria-live="polite" className="space-y-3 empty:hidden">
          {phase !== "idle" ? (
            <p className="flex items-center gap-2 text-sm text-info">
              <Loader2 aria-hidden="true" className="size-4 shrink-0 animate-spin motion-reduce:animate-none" />
              {PHASE_LABELS[phase]}
            </p>
          ) : null}
          {error ? <Alert variant="danger">{error}</Alert> : null}
          {result ? (
            <Alert variant="success">
              {result.new_articles === 0
                ? "Import terminé : aucun brouillon créé, rien de nouveau."
                : `Import terminé : ${formatCount(result.new_articles)} ${plural(result.new_articles, "brouillon créé", "brouillons créés")}.`}
            </Alert>
          ) : null}
        </div>

        {canRetry && rows && !preview && phase === "idle" ? (
          <div>
            <Button variant="secondary" size="md" onClick={() => void runPreview(rows)}>
              Réessayer
            </Button>
          </div>
        ) : null}

        {result ? (
          <p className="text-sm text-foreground-secondary">
            Vérifiez chaque brouillon puis validez-le depuis le catalogue.
          </p>
        ) : null}

        {preview ? <CostingWorkbookPreview report={preview} /> : null}
      </DialogBody>

      <DialogFooter className="border-t border-border pt-4">
        <Button variant="outline" size="lg" disabled={phase === "importing"} onClick={onClose}>
          {result ? "Fermer" : "Annuler"}
        </Button>
        {result ? (
          <Button size="lg" onClick={onShowDrafts}>
            Voir les brouillons
          </Button>
        ) : null}
        {preview && !result ? (
          <Button
            size="lg"
            loading={phase === "importing"}
            disabled={isBusy || newArticles === 0}
            onClick={() => void runImport()}
          >
            {`Importer ${formatCount(newArticles)} ${newArticles > 1 ? "brouillons" : "brouillon"}`}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}

function CostingWorkbookPreview({ report }: Readonly<{ report: CostingWorkbookImportReport }>) {
  const newArticles = report.new_articles;
  const already = report.already_in_catalogue;
  // Not written by this import (the catalogue keeps a supplier reference with its price): purchasing, lot 2.
  const notImported = report.supplier_references_not_imported;
  const shownIssues = report.issues;

  return (
    <section aria-labelledby="costing-workbook-preview-title" className="space-y-4 rounded-lg border border-border bg-surface-subtle p-4">
      <h3 id="costing-workbook-preview-title" className="text-sm font-semibold text-foreground">
        Ce que l’import va faire
      </h3>
      <ul className="space-y-1.5 text-sm text-foreground">
        <li className="font-semibold">
          {newArticles === 0
            ? "Aucun nouvel article en brouillon"
            : `${formatCount(newArticles)} ${plural(newArticles, "nouvel article", "nouveaux articles")} en brouillon`}
        </li>
        <li>
          {already === 0
            ? "Aucun article déjà au catalogue"
            : `${formatCount(already)} déjà au catalogue (${plural(already, "inchangé", "inchangés")})`}
        </li>
        {report.without_supply_type > 0 ? (
          <li>{`${formatCount(report.without_supply_type)} sans type de fourniture`}</li>
        ) : null}
      </ul>

      {newArticles === 0 ? (
        <p className="text-sm font-medium text-foreground-secondary">Rien de nouveau à importer.</p>
      ) : null}

      {notImported > 0 ? (
        <p className="text-sm text-foreground-secondary">
          {notImported === 1
            ? "1 référence fournisseur du classeur n’est pas reprise : elle le sera avec les achats."
            : `${formatCount(notImported)} références fournisseur du classeur ne sont pas reprises : elles le seront avec les achats.`}
        </p>
      ) : null}

      {report.issue_count > 0 ? (
        <div className="space-y-1.5">
          <h4 className="text-sm font-semibold text-foreground">
            {`${formatCount(report.issue_count)} ${plural(report.issue_count, "remarque", "remarques")} sur le classeur`}
          </h4>
          {shownIssues.length > 0 ? (
            <ul
              aria-label="Remarques sur le classeur"
              tabIndex={0}
              className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border bg-surface px-3 py-2 text-xs text-foreground-secondary"
            >
              {shownIssues.map((issue, index) => (
                <li key={`${issue.row}-${index}`} className="break-words">
                  {`Ligne ${issue.row}${issue.reference ? ` · ${issue.reference}` : ""} : ${issue.message}`}
                </li>
              ))}
            </ul>
          ) : null}
          {report.issue_count > shownIssues.length ? (
            <p className="text-xs text-muted-foreground">
              {`Les ${formatCount(shownIssues.length)} premières sur ${formatCount(report.issue_count)}.`}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
