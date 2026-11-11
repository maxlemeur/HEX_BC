"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Calculator, Check, FileText, Folder, House, Info, Plus, Send, TriangleAlert } from "lucide-react";

import { reclassifyAffaireDocument } from "@/app/dashboard/affaires/_actions/intake";
import { Button } from "@/components/ui/button";
import { AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS, type AffaireIntakeDocumentKind } from "@/lib/affaires/intake";
import { canClassifyDossierDocument, dossierDocumentAiConfidence, dossierDocumentState, type DossierDocument } from "@/lib/affaires/document-triage";
import type { AffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import type { AffaireRegisterEntry, AffaireRegisterSummary } from "@/lib/affaires/register";

export type AffaireWorkbenchSection = "overview" | "dossier" | "estimate" | "register" | "submission";

const sections = [
  { id: "overview", label: "Vue d’ensemble", icon: House },
  { id: "dossier", label: "Dossier", icon: Folder },
  { id: "estimate", label: "Chiffrage", icon: Calculator },
  { id: "register", label: "Points à traiter", icon: TriangleAlert },
  { id: "submission", label: "Remise", icon: Send },
] as const;

export function affaireSectionFromLocation(params: URLSearchParams, hash: string): AffaireWorkbenchSection {
  if (hash === "#brief" || hash === "#intake") return "dossier";
  if (hash === "#register") return "register";
  if (["#financial", "#timeline", "#plans", "#dpgf"].includes(hash)) return "estimate";
  if (["#approval", "#finish-line-orders", "#finish-line-output"].includes(hash)) return "submission";
  const view = params.get("view");
  if (sections.some((section) => section.id === view)) return view as AffaireWorkbenchSection;
  if ([...params.keys()].some((key) => key.startsWith("register"))) return "register";
  if ([...params.keys()].some((key) => key.startsWith("approval"))) return "submission";
  if ([...params.keys()].some((key) => key.startsWith("timeline"))) return "estimate";
  return "dossier";
}

export function AffaireWorkbench({ active, onSelect, criticalCount, children }: {
  active: AffaireWorkbenchSection;
  onSelect: (section: AffaireWorkbenchSection) => void;
  criticalCount: number;
  children: ReactNode;
}) {
  return (
    <div className="affaire-workbench-layout">
      <nav className="affaire-workbench-nav" aria-label="Navigation de l'affaire">
        {sections.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" aria-current={active === id ? "page" : undefined} onClick={() => onSelect(id)}>
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
            {id === "register" && criticalCount > 0 ? <span className="affaire-workbench-count" aria-label={`${criticalCount} points critiques`}>{criticalCount}</span> : null}
          </button>
        ))}
      </nav>
      <div className="affaire-workbench-content" id="affaire-workbench-content">{children}</div>
    </div>
  );
}

export function AffaireDossierOverview({ workspace, clientName, registerSummary, registerEntries, isReadOnly, onOpenDocuments, onAddDocuments, onOpenDocument, onReviewBrief, onOpenRegister, estimateHref, versionLabel }: {
  workspace: AffaireIntakeWorkspace | null | undefined;
  clientName: string | null;
  registerSummary: AffaireRegisterSummary | null | undefined;
  registerEntries: AffaireRegisterEntry[];
  isReadOnly: boolean;
  onOpenDocuments: () => void;
  onAddDocuments: () => void;
  onOpenDocument: (documentId: string) => void;
  onReviewBrief: () => void;
  onOpenRegister: () => void;
  estimateHref: string | null;
  versionLabel: string;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, AffaireIntakeDocumentKind>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState("");
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const running = useRef(false);
  const documents = workspace?.documents ?? [];
  const visibleDocuments = documents.slice(0, 8);
  const canManage = !isReadOnly && Boolean(workspace?.canManageDocuments);
  const selectableDocuments = canManage ? visibleDocuments.filter(canClassifyDossierDocument) : [];
  const selectedDocuments = selectableDocuments.filter((document) => selection.includes(document.documentId));
  const allSelected = selectableDocuments.length > 0 && selectedDocuments.length === selectableDocuments.length;
  const selectionNeedsCategory = selectedDocuments.some((document) => (drafts[document.documentId] ?? document.detectedCategory) === "a_classer");
  const brief = workspace?.briefDraft;
  const critical = registerEntries.filter((entry) => entry.severity === "critical" && ["open", "clarify_with_client"].includes(entry.status));
  const briefLabel = brief?.status === "confirme" ? "Confirmé" : brief ? "À confirmer" : "À préparer";
  const scope = brief?.lots.length ? brief.lots.join(", ") : brief?.scope[0] || "À préciser à partir des pièces reçues";
  function classify(items: DossierDocument[]) {
    if (!workspace || !canManage || pending || running.current || items.length === 0 || items.some((document) =>
      !canClassifyDossierDocument(document) || (drafts[document.documentId] ?? document.detectedCategory) === "a_classer")) return;
    running.current = true;
    setErrors({});
    setMessage("");
    startTransition(async () => {
      const successful: string[] = [];
      const failures: Record<string, string> = {};
      try {
        for (const [index, document] of items.entries()) {
          setSubmittedId(document.documentId);
          setProgress(`Validation ${index + 1} sur ${items.length}…`);
          try {
            await reclassifyAffaireDocument({
              projectId: workspace.projectId, documentId: document.documentId,
              category: drafts[document.documentId] ?? document.detectedCategory,
            });
            successful.push(document.documentId);
          } catch (cause) {
            failures[document.documentId] = cause instanceof Error ? cause.message : "Enregistrement interrompu. Réessayez.";
          }
        }
        startTransition(() => {
          setDrafts((prior) => Object.fromEntries(Object.entries(prior).filter(([id]) => !successful.includes(id))));
          setSelection((prior) => prior.filter((id) => !successful.includes(id)));
          setErrors(failures);
          setMessage(successful.length === 1 ? "Classification enregistrée." : successful.length > 1 ? `${successful.length} classifications enregistrées.` : "");
          if (successful.length > 0) router.refresh();
        });
      } finally {
        running.current = false;
        setSubmittedId(null);
        setProgress("");
      }
    });
  }
  return (
    <section aria-label="Dossier de l'affaire" className="affaire-dossier-overview">
      <header className="affaire-workbench-intro">
        <h2>Préparer le dossier</h2>
        <p>{workspace ? `${documents.length} pièce${documents.length > 1 ? "s" : ""} reçue${documents.length > 1 ? "s" : ""}` : "Documents indisponibles"} · Brief {briefLabel.toLocaleLowerCase("fr-FR")}</p>
      </header>
      <div className="affaire-dossier-columns">
        <section className="affaire-dossier-files" aria-label="Pièces du dossier">
          <div className="affaire-workbench-section-heading">
            <h3>Pièces du dossier</h3>
            {workspace ? <Button variant="outline" onClick={isReadOnly || !workspace.canManageDocuments ? onOpenDocuments : onAddDocuments}><Plus size={16} aria-hidden="true" />{isReadOnly || !workspace.canManageDocuments ? "Consulter les pièces" : "Ajouter des pièces"}</Button> : null}
          </div>
          {documents.length > 0 ? (
            <>
              {selectedDocuments.length > 0 ? <div className="affaire-file-selection" role="group" aria-label="Actions sur les pièces sélectionnées">
                <strong>{selectedDocuments.length} pièce{selectedDocuments.length > 1 ? "s" : ""} sélectionnée{selectedDocuments.length > 1 ? "s" : ""}</strong>
                <Button type="button" size="sm" disabled={pending || selectionNeedsCategory} loading={pending} onClick={() => classify(selectedDocuments)}>
                  <Check size={16} aria-hidden="true" />Valider la sélection
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setSelection([])}>Désélectionner</Button>
                {selectionNeedsCategory ? <p className="affaire-file-selection-hint">Choisissez une catégorie pour chaque pièce sélectionnée avant de valider.</p> : null}
              </div> : null}
              <div className="affaire-file-list" role="table" aria-label="Documents reçus">
                <div className="affaire-file-list-head" role="row"><div role="columnheader"><label className="affaire-file-name-cell">
                  {canManage ? <span className="affaire-file-check"><input type="checkbox" aria-label="Sélectionner les pièces affichées"
                    checked={allSelected} aria-checked={selectedDocuments.length > 0 && !allSelected ? "mixed" : allSelected}
                    ref={(input) => { if (input) input.indeterminate = selectedDocuments.length > 0 && !allSelected; }}
                    disabled={pending || selectableDocuments.length === 0}
                    onChange={(event) => setSelection(event.target.checked ? selectableDocuments.map((document) => document.documentId) : [])}
                  /></span> : null}<span>Pièce</span>
                </label></div><span role="columnheader">Classification</span></div>
                {visibleDocuments.map((document) => {
                  const category = drafts[document.documentId] ?? document.detectedCategory;
                  const changed = category !== document.detectedCategory;
                  const aiConfidence = changed ? null : dossierDocumentAiConfidence(document);
                  const validated = !changed && dossierDocumentState(document) === "valid";
                  const editable = !isReadOnly && workspace?.canManageDocuments && canClassifyDossierDocument(document);
                  return (
                    <div role="row" className="affaire-file-list-row" data-selected={editable && selection.includes(document.documentId) || undefined} key={document.documentId}>
                      <div role="cell" className="affaire-file-name-cell">
                        {canManage ? <label className="affaire-file-check"><input type="checkbox" aria-label={`Sélectionner ${document.fileName}`}
                          checked={Boolean(editable && selection.includes(document.documentId))} disabled={pending || !editable}
                          onChange={(event) => setSelection((prior) => event.target.checked ? [...prior, document.documentId] : prior.filter((id) => id !== document.documentId))}
                        /></label> : null}
                        <button type="button" className="affaire-file-open" onClick={() => onOpenDocument(document.documentId)} disabled={document.isBeingDeleted}>
                        <FileText className={document.fileName.toLowerCase().endsWith(".pdf") ? "affaire-file-pdf" : "affaire-file-other"} size={24} aria-hidden="true" />
                        <span>{document.fileName}</span>
                      </button></div>
                      <div role="cell" className="affaire-file-classification">
                        {editable ? <select
                          aria-label={`Catégorie de ${document.fileName}`}
                          value={category}
                          disabled={pending}
                          onChange={(event) => {
                            const value = event.target.value as AffaireIntakeDocumentKind;
                            setDrafts((prior) => value === document.detectedCategory
                              ? Object.fromEntries(Object.entries(prior).filter(([id]) => id !== document.documentId))
                              : { ...prior, [document.documentId]: value });
                            setErrors({});
                            setMessage("");
                          }}
                        >
                          {Object.entries(AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select> : <span>{document.isBeingDeleted ? "Suppression en cours" : AFFAIRE_INTAKE_DOCUMENT_KIND_LABELS[document.detectedCategory]}</span>}
                        {aiConfidence !== null ? <span className="affaire-file-confidence" title="Confiance de l’IA dans la catégorie proposée"><span className="sr-only">Confiance de l’IA : </span><span>{aiConfidence} %</span></span> : null}
                        {validated ? <span className="affaire-file-validated"><Check size={13} aria-hidden="true" />Validé</span> : null}
                        {editable && !validated ? <Button
                          type="button" variant="outline" size="sm"
                          aria-label={`Valider la classification de ${document.fileName}`}
                          disabled={pending || category === "a_classer"}
                          loading={pending && submittedId === document.documentId}
                          onClick={() => classify([document])}
                        >Valider</Button> : null}
                        {errors[document.documentId] ? <span className="affaire-file-classification-error" role="alert">{errors[document.documentId]}</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              {pending || message ? <p className="affaire-workbench-note" role="status">{pending ? progress || "Enregistrement de la classification…" : message}</p> : null}
              {documents.length > 8 ? <button className="affaire-workbench-text-action" type="button" onClick={onOpenDocuments}>Voir les {documents.length} pièces <ArrowRight size={16} aria-hidden="true" /></button> : null}
              {workspace?.missingPieces.some((piece) => piece.code === "missing_plans") ? <p className="affaire-workbench-note"><Info size={17} aria-hidden="true" />Des pièces sont reçues. Vérifiez leur classement si des plans restent signalés manquants.</p> : null}
            </>
          ) : <p className="affaire-workbench-empty">{workspace ? "Ajoutez les pièces pour préparer le périmètre de l’étude." : "Le dossier ne peut pas être chargé. Actualisez la page pour réessayer."}</p>}
        </section>
        <section className="affaire-dossier-brief" aria-label="Résumé du brief">
          <h3>Brief de l’affaire</h3>
          <span className={`affaire-brief-status${brief?.status === "confirme" ? " is-confirmed" : ""}`}>{briefLabel}</span>
          <dl className="affaire-brief-facts">
            <div><dt>Périmètre et lots</dt><dd>{scope}</dd></div>
            <div><dt>Client</dt><dd>{clientName || "À confirmer"}</dd></div>
          </dl>
          {(registerSummary?.criticalOpenCount ?? 0) > 0 ? <div className="affaire-dossier-blockers">
            <h4>À arbitrer avant remise</h4>
            {critical.slice(0, 3).map((entry) => <p key={entry.id}>{entry.text}</p>)}
            <small>{registerSummary?.criticalOpenCount} point{registerSummary?.criticalOpenCount === 1 ? " critique" : "s critiques"} à traiter avant la remise.</small>
          </div> : null}
          <Button className="affaire-review-brief" onClick={onReviewBrief}>{isReadOnly ? "Consulter le brief" : "Revoir le brief"}<ArrowRight size={18} aria-hidden="true" /></Button>
          <div className="affaire-register-access"><button type="button" className="affaire-workbench-text-action" onClick={onOpenRegister}>Ouvrir le registre <ArrowRight size={17} aria-hidden="true" /></button><span>{registerSummary ? `${registerSummary.openQuestionsCount} points ouverts` : "Registre indisponible"}</span></div>
        </section>
      </div>
      {estimateHref ? <a className="affaire-workbench-estimate-link" href={estimateHref}><Calculator size={22} aria-hidden="true" /><strong>Chiffrage</strong><span>{versionLabel}</span><span className="affaire-workbench-estimate-action">Ouvrir le devis <ArrowRight size={18} aria-hidden="true" /></span></a> : <p className="affaire-workbench-estimate-link"><Calculator size={22} aria-hidden="true" /><strong>Chiffrage</strong><span>{versionLabel}</span></p>}
    </section>
  );
}
