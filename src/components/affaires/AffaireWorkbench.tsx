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
  const [error, setError] = useState<{ documentId: string; message: string } | null>(null);
  const [message, setMessage] = useState("");
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const running = useRef(false);
  const documents = workspace?.documents ?? [];
  const brief = workspace?.briefDraft;
  const critical = registerEntries.filter((entry) => entry.severity === "critical" && ["open", "clarify_with_client"].includes(entry.status));
  const briefLabel = brief?.status === "confirme" ? "Confirmé" : brief ? "À confirmer" : "À préparer";
  const scope = brief?.lots.length ? brief.lots.join(", ") : brief?.scope[0] || "À préciser à partir des pièces reçues";
  function classify(document: DossierDocument) {
    const category = drafts[document.documentId] ?? document.detectedCategory;
    if (!workspace?.canManageDocuments || isReadOnly || pending || running.current || !canClassifyDossierDocument(document) || category === "a_classer") return;
    running.current = true;
    setSubmittedId(document.documentId);
    setError(null);
    setMessage("");
    startTransition(async () => {
      try {
        await reclassifyAffaireDocument({ projectId: workspace.projectId, documentId: document.documentId, category });
        startTransition(() => {
          setDrafts((prior) => Object.fromEntries(Object.entries(prior).filter(([id]) => id !== document.documentId)));
          setMessage("Classification enregistrée.");
          router.refresh();
        });
      } catch (cause) {
        setError({ documentId: document.documentId, message: cause instanceof Error ? cause.message : "Enregistrement interrompu. Réessayez." });
      } finally {
        running.current = false;
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
              <div className="affaire-file-list" role="table" aria-label="Documents reçus">
                <div className="affaire-file-list-head" role="row"><span role="columnheader">Pièce</span><span role="columnheader">Classification</span></div>
                {documents.slice(0, 8).map((document) => {
                  const category = drafts[document.documentId] ?? document.detectedCategory;
                  const changed = category !== document.detectedCategory;
                  const aiConfidence = changed ? null : dossierDocumentAiConfidence(document);
                  const validated = !changed && dossierDocumentState(document) === "valid";
                  const editable = !isReadOnly && workspace?.canManageDocuments && canClassifyDossierDocument(document);
                  return (
                    <div role="row" className="affaire-file-list-row" key={document.documentId}>
                      <div role="cell"><button type="button" className="affaire-file-open" onClick={() => onOpenDocument(document.documentId)} disabled={document.isBeingDeleted}>
                        <FileText className={document.fileName.toLowerCase().endsWith(".pdf") ? "affaire-file-pdf" : "affaire-file-other"} size={24} aria-hidden="true" />
                        <span>{document.fileName}</span>
                      </button></div>
                      <div role="cell" className="affaire-file-classification">
                        {editable ? <select
                          aria-label={`Catégorie de ${document.fileName}`}
                          value={category}
                          disabled={pending}
                          onChange={(event) => {
                            setDrafts((prior) => ({ ...prior, [document.documentId]: event.target.value as AffaireIntakeDocumentKind }));
                            setError(null);
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
                          onClick={() => classify(document)}
                        >Valider</Button> : null}
                        {error?.documentId === document.documentId ? <span className="affaire-file-classification-error" role="alert">{error.message}</span> : null}
                      </div>
                    </div>
                  );
                })}
              </div>
              {pending || message ? <p className="affaire-workbench-note" role="status">{pending ? "Enregistrement de la classification…" : message}</p> : null}
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
