"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  HardDrive,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react";
import { reclassifyAffaireDocument } from "@/app/dashboard/affaires/_actions/intake";
import {
  AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS,
  type AffaireIntakeDocumentKind,
} from "@/lib/affaires/intake";
import {
  canClassifyDossierDocument,
  dossierDocumentState,
  type DossierDocument,
} from "@/lib/affaires/document-triage";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
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
import { GoogleDriveImport, openGoogleDriveImport } from "./GoogleDriveImport";
import { PlanDossierSyncNotice } from "@/components/takeoff/PlanDossierSyncNotice";
import {
  COCKPIT_OPEN_SURFACE_EVENT,
  type CockpitOpenSurfaceEventDetail,
} from "@/lib/cockpit/events";
import "./AffaireDocumentDesk.css";

const categories = Object.entries(AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS) as [
  AffaireIntakeDocumentKind,
  string,
][];
const stateLabels = {
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
}: {
  projectId: string;
  projectName: string;
  workspace: AffaireIntakeWorkspace;
  canManage: boolean;
  onOverview: (anchor?: string) => void;
  onImportDpgf: (documentId: string) => void;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [filter, setFilter] = useState(
    params.has("intakeDocument") ? "all" : "review",
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
  const [addFiles, setAddFiles] = useState(false);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const running = useRef(false);
  const appliedFocus = useRef<string | null>(null);
  const documents = workspace.documents;
  const counts = {
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
  const details = documents.find(
    (document) => document.documentId === detailsId,
  );
  const processing = counts.processing > 0;

  useEffect(() => {
    if (!processing || busy) return;
    const started = Date.now();
    const interval = setInterval(() => {
      if (Date.now() - started >= 120_000) clearInterval(interval);
      else router.refresh();
    }, 5000);
    return () => clearInterval(interval);
  }, [processing, busy, router]);
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
      router.refresh();
    } finally {
      running.current = false;
      setBusy(false);
      setProgress("");
    }
  }
  function uploaded() {
    setAddFiles(false);
    router.refresh();
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
            if (changed) router.refresh();
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
      {!canManage && (
        <p className="document-desk-readonly">
          Consultation du dossier. Le classement est réservé au responsable de
          l’affaire et aux administrateurs.
        </p>
      )}
      {(message || progress) && (
        <p className="document-desk-feedback" role="status">
          {progress || message}
        </p>
      )}
      {failures.length > 0 && (
        <div className="document-desk-errors" role="alert">
          <strong>
            Certaines opérations sont incomplètes. Vérifiez l’état actualisé des
            pièces et du brief avant de reprendre.
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
            <table>
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
                {rows.map((document) => {
                  const state = dossierDocumentState(document);
                  const category =
                    drafts[document.documentId] ?? document.detectedCategory;
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
                        {eligible ? (
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
                      </td>
                      <td>
                        <span
                          className={`document-desk-status document-desk-status-${state}`}
                        >
                          {state === "valid" && <Check size={12} />}
                          {stateLabels[state]}
                        </span>
                      </td>
                      <td>
                        <div className="document-desk-row-actions">
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
            {rows.length === 0 && (
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
              />
              {canManage && canClassifyDossierDocument(active) && (
                <div className="document-desk-preview-actions">
                  {active.detectedCategory === "dpgf" &&
                    dossierDocumentState(active) === "valid" && (
                      <button
                        className="document-desk-button"
                        disabled={busy}
                        onClick={() => onImportDpgf(active.documentId)}
                      >
                        Importer cette DPGF
                        <ChevronRight size={14} />
                      </button>
                    )}
                  {dossierDocumentState(active) === "valid" && (
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
          onRefresh={() => router.refresh()}
        />
      )}
      <Dialog open={addFiles} onOpenChange={setAddFiles}>
        <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle>Ajouter des documents</DialogTitle>
            <DialogDescription>
              Ajoutez les pièces du dossier de consultation.
            </DialogDescription>
          </DialogHeader>
          <IntakeDropzone
            projectId={projectId}
            onUploadComplete={uploaded}
            onRefresh={() => router.refresh()}
          />
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(details)}
        onOpenChange={(open) => {
          if (!open && !busy) setDetailsId(null);
        }}
      >
        <DialogContent size="lg" className="max-h-[90dvh] overflow-y-auto">
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
              onReclassified={() => router.refresh()}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
