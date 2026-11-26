"use client";

import type { IntakeAiChoice } from "@/lib/affaires/intake-ai-settings";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  HardDrive,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  Search,
  RotateCw,
} from "lucide-react";
import {
  readAffaireIntakeRetryStatus,
  reclassifyAffaireDocument,
  retryAffaireDocumentAnalysis,
} from "@/app/dashboard/affaires/_actions/intake";
import {
  AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS,
  type AffaireIntakeDocumentKind,
} from "@/lib/affaires/intake";
import {
  canClassifyDossierDocument,
  canRetryDossierDocument,
  dossierDocumentAiConfidence,
  dossierDocumentClassificationState,
  dossierDocumentState,
  type DossierDocument,
} from "@/lib/affaires/document-triage";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-workspace-server";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IntakeDocumentPreview } from "./IntakeDocumentPreview";
import { IntakeDocumentCard } from "./IntakeDocumentCard";
import { IntakeDropzone } from "./IntakeDropzone";
import { SupplierDocumentsHint } from "./SupplierDocumentsHint";
import { useIntakeUploadFeedback, type IntakeUploadFeedbackState } from "./IntakeUploadFeedback";
import { useDossierPoll } from "./useAffaireDossier";
import { GoogleDriveImport, openGoogleDriveImport } from "./GoogleDriveImport";
import { PlanDossierSyncNotice } from "@/components/takeoff/PlanDossierSyncNotice";
import {
  COCKPIT_OPEN_SURFACE_EVENT,
  type CockpitOpenSurfaceEventDetail,
} from "@/lib/cockpit/events";
import { AFFAIRE_INTAKE_AWAITING_LAUNCH_LABEL } from "@/lib/affaires/intake";
import { IntakeAnalysisRetryDialog } from "./IntakeAiControls";
import { IntakeAnalysisLaunch } from "./IntakeAnalysisLaunch";
import "./AffaireDocumentDesk.css";

const categories = Object.entries(AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS) as [
  AffaireIntakeDocumentKind,
  string,
][];
const stateLabels = {
  awaiting_launch: AFFAIRE_INTAKE_AWAITING_LAUNCH_LABEL,
  review: "À vérifier",
  valid: "Validé",
  processing: "En cours",
  unavailable: "Indisponible",
};
const PAGE_SIZE = 30;

export function AffaireDocumentDesk({
  projectId,
  projectName,
  workspace,
  canManage,
  onOverview,
  onImportDpgf,
  onReload,
  initialAddFiles = false,
  uploadFeedback: sharedUploadFeedback,
  uploadRequestId = 0,
}: {
  projectId: string;
  projectName: string;
  workspace: AffaireIntakeWorkspace;
  canManage: boolean;
  onOverview: (anchor?: string) => void;
  onImportDpgf: (documentId: string) => void;
  // Reads the dossier again (useAffaireDossier) without refreshing the router.
  onReload: () => Promise<void>;
  initialAddFiles?: boolean;
  uploadFeedback?: IntakeUploadFeedbackState;
  uploadRequestId?: number;
}) {
  const params = useSearchParams();
  const batchPending = (workspace.pendingUploadIds?.length ?? 0) > 0;
  const localUploadFeedback = useIntakeUploadFeedback(projectId, workspace.documents, onReload, batchPending);
  const uploadFeedback = sharedUploadFeedback ?? localUploadFeedback;
  const [filter, setFilter] = useState(
    params.has("intakeDocument") || (params.get("intakeFilter") !== "a_revoir" && !workspace.documents.some((document) => dossierDocumentState(document) === "review")) ? "all" : "review",
  );
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(
    params.get("intakeDocument"),
  );
  const [selection, setSelection] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<
    Record<string, AffaireIntakeDocumentKind>
  >({});
  const [bulkCategory, setBulkCategory] = useState<
    AffaireIntakeDocumentKind | ""
  >("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [failures, setFailures] = useState<string[]>([]);
  const [addFiles, setAddFiles] = useState(initialAddFiles);
  const previousUploadRequest = useRef(uploadRequestId);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const running = useRef(false);
  const appliedFocus = useRef<string | null>(null);
  const documents = workspace.documents;
  const counts = {
    awaiting_launch: 0,
    review: 0,
    valid: 0,
    processing: 0,
    unavailable: 0,
    all: documents.length,
  };
  for (const document of documents) counts[dossierDocumentState(document)]++;
  // A source link from the brief opens its document even when it is already valid.
  const focusedId = params.get("intakeDocument");
  const filtered = documents.filter(
    (document) =>
      !uploadFeedback.files.some((file) => file.documentId === document.documentId) &&
      (filter === "all" || dossierDocumentState(document) === filter) &&
      document.fileName
        .toLocaleLowerCase("fr")
        .includes(search.toLocaleLowerCase("fr")),
  );
  const lastPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const rows = filtered.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const active =
    filtered.find((document) => document.documentId === activeId) ?? rows[0];
  const selectedDocuments = documents.filter(
    (document) =>
      selection.includes(document.documentId) &&
      canClassifyDossierDocument(document),
  );
  const retryableDocuments = documents.filter(canRetryDossierDocument);
  const selectedRetryableDocuments = selectedDocuments.filter(
    canRetryDossierDocument,
  );
  const [retrySelection, setRetrySelection] = useState<DossierDocument[]>([]);
  const [pendingRetryId, setPendingRetryId] = useState<string | null>(null);
  const [retryBudgetNotice, setRetryBudgetNotice] = useState<string | null>(null);
  useDossierPoll(Boolean(pendingRetryId), async () => {
    if (!pendingRetryId) return;
    const status = await readAffaireIntakeRetryStatus(projectId, pendingRetryId);
    if (status.message) setRetryBudgetNotice(status.message);
    if (status.finished) {
      setPendingRetryId(null);
      await onReload();
    }
  }, { intervalMs: 5000, maxMs: 300_000 });
  const fallbackCount = retryableDocuments.filter(
    (item) =>
      item.classificationSource === "heuristic" &&
      item.issues.some(
        (issue) =>
          issue.includes("l'analyse IA a echoue") ||
          issue.startsWith("Analyse IA :"),
      ),
  ).length;
  const details = documents.find(
    (document) => document.documentId === detailsId,
  );
  const processing = counts.processing > 0;

  useEffect(() => {
    if (previousUploadRequest.current === uploadRequestId) return;
    previousUploadRequest.current = uploadRequestId;
    if (canManage) setAddFiles(true);
  }, [uploadRequestId, canManage]);

  // Follows the analyses for two minutes. A read, not a refresh of the router: a refresh in flight
  // holds back what a classification brings to the screen (TI-722).
  useDossierPoll(processing || batchPending, onReload, { intervalMs: 5000, maxMs: 120_000 });
  useEffect(() => {
    const openUpload = (event: Event) => {
      const detail = (event as CustomEvent<CockpitOpenSurfaceEventDetail>)
        .detail;
      if (
        canManage &&
        detail?.projectId === projectId &&
        detail.surfaceId === "intake-upload"
      )
        setAddFiles(true);
    };
    document.addEventListener(COCKPIT_OPEN_SURFACE_EVENT, openUpload);
    return () =>
      document.removeEventListener(COCKPIT_OPEN_SURFACE_EVENT, openUpload);
  }, [canManage, projectId]);
  useEffect(() => {
    if (focusedId && focusedId !== appliedFocus.current) {
      appliedFocus.current = focusedId;
      setActiveId(focusedId);
      setFilter("all");
      setPage(
        Math.max(
          0,
          Math.floor(
            documents.findIndex(
              (document) => document.documentId === focusedId,
            ) / PAGE_SIZE,
          ),
        ),
      );
    }
  }, [focusedId, documents]);

  function chooseFilter(value: string) {
    setFilter(value);
    setPage(0);
    setActiveId(null);
  }
  function toggle(id: string) {
    setSelection((prior) =>
      prior.includes(id) ? prior.filter((item) => item !== id) : [...prior, id],
    );
  }
  async function classify(
    items: DossierDocument[],
    category?: AffaireIntakeDocumentKind,
  ) {
    if (!canManage || running.current || busy) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    setFailures([]);
    const failed: string[] = [];
    const successful: string[] = [];
    try {
      for (let index = 0; index < items.length; index++) {
        const document = items[index];
        if (!canClassifyDossierDocument(document)) continue;
        const target =
          category ?? drafts[document.documentId] ?? document.detectedCategory;
        setProgress(`Enregistrement ${index + 1} sur ${items.length}…`);
        try {
          await reclassifyAffaireDocument({
            projectId,
            documentId: document.documentId,
            category: target,
          });
          successful.push(document.documentId);
        } catch (cause) {
          failed.push(
            `${document.fileName} : ${cause instanceof Error ? cause.message : "Enregistrement interrompu. Réessayez."}`,
          );
        }
      }
      setSelection((prior) => prior.filter((id) => !successful.includes(id)));
      setDrafts((prior) =>
        Object.fromEntries(
          Object.entries(prior).filter(([id]) => !successful.includes(id)),
        ),
      );
      setFailures(failed);
      if (successful.length)
        setMessage(
          `${successful.length} document${successful.length > 1 ? "s" : ""} enregistré${successful.length > 1 ? "s" : ""}.`,
        );
      // Each classification re-renders the page in its own response. Only a failure, whose write
      // may still have landed, asks for the dossier again.
      if (failed.length) void onReload();
    } finally {
      running.current = false;
      setBusy(false);
      setProgress("");
    }
  }
  function showDepositedFiles() {
    chooseFilter("all");
    setSearch("");
    setAddFiles(false);
  }
  function uploaded() {
    showDepositedFiles();
    void onReload();
  }
  async function retryAnalysis(choice: IntakeAiChoice) {
    if (!canManage || busy || running.current) return;
    const eligible = retrySelection.filter(canRetryDossierDocument);
    setRetrySelection([]);
    setRetryBudgetNotice(null);
    setPendingRetryId(null);
    if (!eligible.length) return;
    running.current = true;
    setBusy(true);
    setFailures([]);
    setMessage("");
    setProgress(`Analyse de ${eligible.length} pièce${eligible.length > 1 ? "s" : ""}…`);
    try {
      const result = await retryAffaireDocumentAnalysis({ projectId, documentIds: eligible.map(item => item.documentId), choice });
      const analyzed = new Set(result.analyzedDocumentIds ?? []);
      setDrafts(prior => {
        const next = { ...prior };
        for (const id of analyzed) delete next[id];
        return next;
      });
      setSelection(prior => prior.filter(id => !analyzed.has(id)));
      setFailures(result.failures);
      setMessage(result.message);
      setPendingRetryId(result.batchId ?? null);
    } catch {
      setMessage("Analyse interrompue. Actualisez le dossier et relancez les pièces à analyser.");
    } finally {
      running.current = false;
      setBusy(false);
      setProgress("");
      void onReload();
    }
  }
  const selectableRows = rows.filter(canClassifyDossierDocument);

  return (
    <section
      id="intake"
      className="affaire-document-desk"
      aria-label="Dossier de consultation"
    >
      {canManage && workspace.uploadId && (
        <PlanDossierSyncNotice
          projectId={projectId}
          automatic
          onSynchronized={(changed) => {
            if (changed) void onReload();
          }}
        />
      )}
      <div className="document-desk-breadcrumb">
        <Link href="/dashboard/affaires">Affaires</Link>
        <span>/</span>
        <span>{projectName}</span>
        <span>/ Documents</span>
        <button disabled={busy} onClick={() => onOverview()}>
          Vue d’ensemble de l’affaire
        </button>
      </div>
      <header className="document-desk-header">
        <div>
          <span className="document-desk-eyebrow">DOSSIER DE CONSULTATION</span>
          <h1>
            {projectName} <span>/ Documents</span>
          </h1>
        </div>
        <div className="document-desk-header-actions">
          <div className="document-desk-progress">
            <span>
              <strong>{counts.valid}</strong> / {documents.length} documents
              validés
            </span>
            <progress
              value={counts.valid}
              max={Math.max(1, documents.length)}
              aria-label="Documents validés"
            />
          </div>
          {canManage && (
            <>
              <button
                className="document-desk-button"
                disabled={
                  busy || retryableDocuments.length === 0
                }
                title="Relancer l’IA, y compris sur les pièces validées. Les classements manuels sont conservés."
                onClick={() => setRetrySelection(retryableDocuments)}
              >
                <RotateCw size={15} />
                Relancer l’analyse ({retryableDocuments.length})
              </button>
              <button
                className="document-desk-button"
                disabled={busy}
                onClick={() => openGoogleDriveImport(projectId)}
              >
                <HardDrive size={15} />
                Google Drive
              </button>
              <button
                className="document-desk-button document-desk-primary"
                disabled={busy}
                onClick={() => setAddFiles(true)}
              >
                <Plus size={16} />
                Ajouter des fichiers
              </button>
            </>
          )}
          <button
            className="document-desk-button"
            disabled={busy}
            onClick={() => onOverview("brief")}
          >
            Continuer vers le brief
            <ChevronRight size={15} />
          </button>
        </div>
      </header>
      <IntakeAnalysisLaunch workspace={workspace} canManage={canManage} onReload={onReload} />
      {!canManage && (
        <p className="document-desk-readonly">
          Consultation du dossier. Le classement est réservé au responsable de
          l’affaire et aux administrateurs.
        </p>
      )}
      {canManage && fallbackCount > 0 && (
        <p className="document-desk-analysis-notice" role="status">
          {`${fallbackCount} document${fallbackCount > 1 ? "s" : ""} classé${fallbackCount > 1 ? "s" : ""} d’après le nom après un échec de l’IA. Vous pouvez relancer l’analyse.`}
        </p>
      )}
      {retryBudgetNotice && <p role="status">{retryBudgetNotice}</p>}
      {(message || progress) && (
        <p className="document-desk-feedback" role="status">
          {progress || message}
        </p>
      )}
      {failures.length > 0 && (
        <div className="document-desk-errors" role="alert">
          <strong>
            Certaines pièces n’ont pas pu être traitées. Le motif est indiqué
            ci-dessous.
          </strong>
          <ul>
            {failures.map((failure) => (
              <li key={failure}>{failure}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="document-desk-columns">
        <div className="document-desk-list">
          <div className="document-desk-toolbar">
            <div
              className="document-desk-tabs"
              role="group"
              aria-label="Afficher les documents"
            >
              {[
                ["review", "À vérifier"],
                ["valid", "Validés"],
                ...(counts.awaiting_launch ? [["awaiting_launch", AFFAIRE_INTAKE_AWAITING_LAUNCH_LABEL]] : []),
                ...(counts.processing ? [["processing", "En cours"]] : []),
                ["all", "Tous"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  disabled={busy}
                  aria-pressed={filter === value}
                  onClick={() => chooseFilter(value)}
                >
                  {label}
                  <span>{counts[value as keyof typeof counts]}</span>
                </button>
              ))}
            </div>
            <label className="document-desk-search">
              <Search size={16} />
              <input
                aria-label="Rechercher un document"
                placeholder="Rechercher un document…"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(0);
                }}
              />
            </label>
          </div>
          {canManage && selectedDocuments.length > 0 && (
            <div className="document-desk-bulk">
              <strong>
                {selectedDocuments.length} sélectionné
                {selectedDocuments.length > 1 ? "s" : ""}
              </strong>
              <button
                className="document-desk-button"
                disabled={
                  busy ||
                  selectedRetryableDocuments.length === 0
                }
                onClick={() => setRetrySelection(selectedRetryableDocuments)}
              >
                <RotateCw size={14} />
                Réanalyser ({selectedRetryableDocuments.length})
              </button>
              <select
                aria-label="Catégorie de la sélection"
                disabled={busy}
                value={bulkCategory}
                onChange={(event) =>
                  setBulkCategory(
                    event.target.value as AffaireIntakeDocumentKind | "",
                  )
                }
              >
                <option value="">Catégories actuelles</option>
                {categories
                  .filter(([value]) => value !== "a_classer")
                  .map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
              </select>
              <button
                className="document-desk-button document-desk-primary"
                disabled={
                  busy ||
                  (!bulkCategory &&
                    selectedDocuments.some(
                      (document) =>
                        (drafts[document.documentId] ??
                          document.detectedCategory) === "a_classer",
                    ))
                }
                onClick={() =>
                  void classify(selectedDocuments, bulkCategory || undefined)
                }
              >
                <Check size={14} />
                Valider la sélection
              </button>
              <button
                className="document-desk-text"
                disabled={busy}
                onClick={() => setSelection([])}
              >
                Désélectionner
              </button>
            </div>
          )}
          <div className="document-desk-table-scroll">
            <table className="sheet-table">
              <thead>
                <tr>
                  {canManage && (
                    <th className="document-desk-check">
                      <input
                        type="checkbox"
                        aria-label="Sélectionner les documents de cette page"
                        disabled={busy || selectableRows.length === 0}
                        checked={
                          selectableRows.length > 0 &&
                          selectableRows.every((document) =>
                            selection.includes(document.documentId),
                          )
                        }
                        onChange={(event) =>
                          setSelection(
                            event.target.checked
                              ? [
                                  ...new Set([
                                    ...selection,
                                    ...selectableRows.map(
                                      (document) => document.documentId,
                                    ),
                                  ]),
                                ]
                              : selection.filter(
                                  (id) =>
                                    !selectableRows.some(
                                      (document) => document.documentId === id,
                                    ),
                                ),
                          )
                        }
                      />
                    </th>
                  )}
                  <th>Document</th>
                  <th className="document-desk-category">Catégorie</th>
                  <th className="document-desk-state">État</th>
                  <th className="document-desk-action">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {uploadFeedback.files.map((file) => <tr key={file.key} aria-label={`Ajout de ${file.fileName}`}>
                  {canManage ? <td /> : null}
                  <td><span className="document-desk-file"><FileText size={19} /><span>{file.fileName}</span></span></td>
                  <td>—</td>
                  <td colSpan={2}>
                    <span className={`document-desk-status document-desk-status-${file.phase === "failed" ? "unavailable" : "processing"}`} role={file.phase === "failed" ? "alert" : "status"}>
                      {file.phase !== "failed" ? <LoaderCircle size={14} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
                      {file.label}
                    </span>
                    {file.phase === "failed" ? <button type="button" className="document-desk-text" onClick={() => uploadFeedback.dismissFailure(file.key)}>Masquer</button> : null}
                  </td>
                </tr>)}
                {rows.map((document) => {
                  const state = dossierDocumentState(document);
                  const category =
                    drafts[document.documentId] ?? document.detectedCategory;
                  const aiConfidence = category === document.detectedCategory
                    ? dossierDocumentAiConfidence(document)
                    : null;
                  const eligible =
                    canManage && canClassifyDossierDocument(document);
                  return (
                    <tr
                      key={document.documentId}
                      data-document-id={document.documentId}
                      aria-selected={active?.documentId === document.documentId}
                      className={
                        active?.documentId === document.documentId
                          ? "document-desk-active"
                          : ""
                      }
                    >
                      {canManage && (
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Sélectionner ${document.fileName}`}
                            disabled={busy || !eligible}
                            checked={selection.includes(document.documentId)}
                            onChange={() => toggle(document.documentId)}
                          />
                        </td>
                      )}
                      <td>
                        <button
                          className="document-desk-file"
                          title={document.fileName}
                          onClick={() => setActiveId(document.documentId)}
                        >
                          <FileText size={19} />
                          <span>{document.fileName}</span>
                        </button>
                        {document.sizeBytes !== undefined && (
                          <small className="document-desk-file-size">
                            {(document.sizeBytes / 1024 / 1024).toLocaleString(
                              "fr-FR",
                              { maximumFractionDigits: 1 },
                            )}{" "}
                            Mo
                          </small>
                        )}
                      </td>
                      <td>
                        {eligible && (state !== "valid" || category !== document.detectedCategory) ? (
                          <select
                            aria-label={`Catégorie de ${document.fileName}`}
                            disabled={busy}
                            value={category}
                            onChange={(event) => {
                              setDrafts((prior) => ({
                                ...prior,
                                [document.documentId]: event.target
                                  .value as AffaireIntakeDocumentKind,
                              }));
                              setActiveId(document.documentId);
                            }}
                          >
                            {categories.map(([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS[
                            document.detectedCategory
                          ]
                        )}
                        {document.extractedMetadata.aiCategoryProposal && document.extractedMetadata.aiCategoryProposal.category !== document.detectedCategory && (
                          <button type="button" className="mt-1 block text-left text-xs text-primary underline" disabled={busy}
                            aria-label={`Voir la proposition IA pour ${document.fileName}`} onClick={() => setDetailsId(document.documentId)}>
                            IA : {AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS[document.extractedMetadata.aiCategoryProposal.category]}
                            {document.extractedMetadata.aiCategoryProposal.nature ? ` · ${document.extractedMetadata.aiCategoryProposal.nature}` : ""}
                          </button>
                        )}
                      </td>
                      <td>
                        <span
                          className={`document-desk-status document-desk-status-${aiConfidence !== null ? "ai" : state}`}
                          title={aiConfidence !== null ? "Confiance de l’IA dans la catégorie proposée" : undefined}
                        >
                          {state === "valid" && <Check size={12} />}
                          {state === "processing" && <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                          {aiConfidence !== null ? <><span className="sr-only">Confiance de l’IA : </span><span>{aiConfidence} %</span></> : stateLabels[state]}
                        </span>
                      </td>
                      <td>
                        <div className="document-desk-row-actions">
                          {canManage && canRetryDossierDocument(document) && (
                            <button
                              className="document-desk-icon"
                              aria-label={`Relancer l’analyse de ${document.fileName}`}
                              title="Relancer l’analyse"
                              disabled={busy}
                              onClick={() => setRetrySelection([document])}
                            >
                              <RotateCw size={15} />
                            </button>
                          )}
                          {eligible &&
                            (state !== "valid" ||
                              category !== document.detectedCategory) && (
                              <button
                                className="document-desk-button"
                                disabled={busy || category === "a_classer"}
                                onClick={() => void classify([document])}
                              >
                                {state === "valid" ? "Enregistrer" : "Valider"}
                              </button>
                            )}
                          <button
                            className="document-desk-icon"
                            aria-label={`Détails de ${document.fileName}`}
                            onClick={() => setDetailsId(document.documentId)}
                          >
                            <MoreHorizontal size={17} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {rows.length === 0 && uploadFeedback.files.length === 0 && (
              <div className="document-desk-empty">
                <Check size={25} />
                <h2>
                  {filter === "review" && !search
                    ? "Aucune pièce à vérifier"
                    : "Aucun document dans cette vue"}
                </h2>
                <p>
                  {filter === "review" && !search
                    ? "Retrouvez les pièces classées dans l’onglet Validés."
                    : "Modifiez la recherche ou le filtre."}
                </p>
              </div>
            )}
          </div>
          <footer className="document-desk-list-footer">
            <span>
              {filtered.length} document{filtered.length > 1 ? "s" : ""}
              {selection.length
                ? ` · ${selectedDocuments.length} sélectionné(s)`
                : ""}
            </span>
            {lastPage > 0 && (
              <div>
                <button
                  className="document-desk-icon"
                  aria-label="Page précédente"
                  disabled={currentPage === 0}
                  onClick={() => {
                    setPage(currentPage - 1);
                    setActiveId(null);
                  }}
                >
                  <ChevronLeft size={16} />
                </button>
                <span>
                  {currentPage + 1} / {lastPage + 1}
                </span>
                <button
                  className="document-desk-icon"
                  aria-label="Page suivante"
                  disabled={currentPage === lastPage}
                  onClick={() => {
                    setPage(currentPage + 1);
                    setActiveId(null);
                  }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </footer>
        </div>
        <aside
          className="document-desk-preview"
          aria-label="Aperçu de la pièce sélectionnée"
        >
          {active ? (
            <>
              <IntakeDocumentPreview
                key={`${projectId}:${active.documentId}:${active.uploadStatus}:${active.isBeingDeleted}`}
                projectId={projectId}
                document={active}
                canManage={canManage}
              />
              {canManage && canClassifyDossierDocument(active) && (
                <div className="document-desk-preview-actions">
                  {active.detectedCategory === "dpgf" &&
                    dossierDocumentClassificationState(active) === "valid" && (
                      <button
                        className="document-desk-button"
                        disabled={busy}
                        onClick={() => onImportDpgf(active.documentId)}
                      >
                        Importer cette DPGF
                        <ChevronRight size={14} />
                      </button>
                    )}
                  {dossierDocumentClassificationState(active) === "valid" && (
                    <button
                      className="document-desk-text"
                      disabled={busy}
                      onClick={() => void classify([active], "a_classer")}
                    >
                      Remettre à vérifier
                    </button>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="document-desk-empty">
              <FileText size={30} />
              <p>Sélectionnez un document pour l’afficher ici.</p>
            </div>
          )}
        </aside>
      </div>
      {canManage && (
        <GoogleDriveImport
          projectId={projectId}
          showTrigger={false}
          onUploadComplete={uploaded}
          onRefresh={() => void onReload()}
        />
      )}
      {retrySelection.length > 0 && <IntakeAnalysisRetryDialog projectId={projectId} count={retrySelection.length}
        onClose={() => setRetrySelection([])} onSubmit={choice => void retryAnalysis(choice)} />}
      <Dialog open={addFiles} onOpenChange={setAddFiles}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Ajouter des documents</DialogTitle>
            <DialogDescription>
              Ajoutez les pièces du dossier de consultation.
            </DialogDescription>
          </DialogHeader>
          <SupplierDocumentsHint projectId={projectId} />
          <IntakeDropzone
            projectId={projectId}
            onUploadComplete={() => void onReload()}
            onUploadEvent={(event) => {
              uploadFeedback.onUploadEvent(event);
              if (event.type === "started") showDepositedFiles();
            }}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(details)}
        onOpenChange={(open) => {
          if (!open && !busy) setDetailsId(null);
        }}
      >
        <DialogContent size="lg" className="max-h-[90dvh] overflow-y-auto" aria-busy={busy}>
          <DialogHeader>
            <DialogTitle>Document et détails</DialogTitle>
            <DialogDescription>
              Provenance et actions complémentaires.
            </DialogDescription>
          </DialogHeader>
          {details && (
            <IntakeDocumentCard
              document={details}
              projectId={projectId}
              canManage={canManage && !running.current}
              canClassify={canClassifyDossierDocument(details)}
              onPendingChange={setBusy}
              onReclassified={() => void onReload()}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
