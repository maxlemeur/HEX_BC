"use client";

import Link from "next/link";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowRight, Check, ChevronDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import type { AffaireRegisterSummary } from "@/lib/affaires/register";
import type { CockpitSurfaceId } from "@/lib/cockpit/suggestions";
import { buildPilotageExceptions, type PilotageAction } from "./AffairePilotagePanel.logic";
import { buildAffaireJourney, type JourneyInput, type JourneyStage } from "./AffaireJourneyPanel.model";
import { AffaireFinishLineActions } from "./AffaireFinishLineActions";
import { AffaireOrderDraftsPanel } from "./AffaireOrderDraftsPanel";
import "@/components/journey/journey.css";
import "./AffaireJourneyPanel.css";

type Props = JourneyInput & {
  projectId: string;
  projectName: string;
  registerSummary: AffaireRegisterSummary | null;
  onOpenSurface?: (surfaceId: CockpitSurfaceId) => void;
  onOpenDocuments?: () => void;
  studyContent?: ReactNode;
  ghost?: boolean;
  hiddenExceptionIds?: string[];
};

function subscribeHash(callback: () => void) {
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}
const readHash = () => window.location.hash;
const emptyHash = () => "";

function JourneyAction({ action, onOpenSurface }: { action: PilotageAction; onOpenSurface?: Props["onOpenSurface"] }) {
  if (action.kind === "href") return <Link className="journey-text-action" href={action.href}>{action.label}<ArrowRight size={14} aria-hidden="true" /></Link>;
  return onOpenSurface ? <button className="journey-text-action" onClick={() => onOpenSurface(action.surfaceId)}>{action.label}<ArrowRight size={14} aria-hidden="true" /></button> : null;
}

export function AffairePilotagePanel(props: Props) {
  const { projectId, projectName, intakeWorkspace, registerSummary, currentVersion, onOpenDocuments, onOpenSurface, studyContent, ghost = false } = props;
  const hash = useSyncExternalStore(subscribeHash, readHash, emptyHash);
  const journey = buildAffaireJourney({ ...props, revealPurchases: hash === "#finish-line-orders" });
  const scope = `${projectId}:${currentVersion?.id ?? "none"}:${journey.current}`;
  const [selection, setSelection] = useState<{ scope: string; hash: string; stage: JourneyStage | null } | null>(null);
  const hashStage = hash === "#finish-line-orders" && journey.showPurchases ? "achats"
    : ["#finish-line-output", "#approval"].includes(hash) && journey.canShowOutput ? "remise" : null;
  const expanded = selection?.scope === scope && selection.hash === hash ? selection.stage : hashStage ?? journey.current;
  const currentIndex = journey.stages.findIndex((stage) => stage.key === journey.current);
  const editHref = currentVersion ? `/dashboard/estimates/${currentVersion.id}${currentVersion.status === "draft" ? "/edit" : ""}` : `/dashboard/estimates/new?projectId=${projectId}`;
  const exceptions = buildPilotageExceptions({ ...props, allowSurfaceActions: Boolean(onOpenSurface) })
    .filter((item) => item.id !== "intake-review" && item.id !== "brief-confirm")
    .filter((item) => item.id !== "missing-pieces" || (registerSummary?.criticalOpenCount ?? 0) === 0);
  const cadrageExceptions = exceptions.filter((item) => /^(missing|register)/.test(item.id));
  const studyExceptions = exceptions.filter((item) => /^(takeoff|dpgf)/.test(item.id));
  const documents = intakeWorkspace?.documents ?? [];
  const validPlans = documents.filter((doc) => doc.uploadStatus === "uploaded" && doc.detectedCategory === "plans" && doc.classificationStatus === "classified" && !doc.isBeingDeleted).length;

  function exceptionList(stage: JourneyStage) {
    const items = stage === "cadrage" ? cadrageExceptions : stage === "etude" ? studyExceptions : [];
    if (!items.length) return null;
    return <div className="journey-issues">
      <div className="journey-issue"><span className={`journey-issue-dot ${items[0].severity === "critical" ? "journey-critical" : ""}`} /><div><strong>{items[0].title}</strong><p>{items[0].summary}</p><JourneyAction action={items[0].action} onOpenSurface={onOpenSurface} /></div></div>
      {items.length > 1 ? <details><summary>{items.length - 1} autre{items.length > 2 ? "s" : ""} point{items.length > 2 ? "s" : ""} à traiter</summary>{items.slice(1).map((item) => <div className="journey-additional-issue" key={item.id}><strong>{item.title}</strong><p>{item.summary}</p><JourneyAction action={item.action} onOpenSurface={onOpenSurface} /></div>)}</details> : null}
    </div>;
  }

  function stageContent(stage: JourneyStage) {
    if (stage === "cadrage" && !intakeWorkspace) return <><h3>Dossier indisponible</h3><p className="journey-description">Rechargez la page pour vérifier les documents et le brief de l&apos;affaire.</p><Button onClick={() => window.location.reload()}>Recharger</Button></>;
    if (stage === "cadrage") return <>
      <h3>{documents.length === 0 ? "Documents de l'affaire" : journey.reviewCount ? "Vérifier les documents reçus" : journey.processingCount ? "Classement des documents en cours" : journey.briefConfirmed ? "Dossier confirmé" : "Confirmer le brief de l'affaire"}</h3>
      <p className="journey-description">{journey.reviewCount ? `${journey.reviewCount} pièce${journey.reviewCount > 1 ? "s restent" : " reste"} à classer avant de confirmer le périmètre de l'étude.` : journey.processingCount ? "Le classement se poursuit. Vous pouvez consulter les pièces déjà reçues." : journey.briefConfirmed ? "Le périmètre de l'étude a été confirmé. Les documents restent consultables." : "Relisez les hypothèses, le périmètre et les pièces attendues avant de confirmer le brief."}</p>
      {onOpenDocuments ? <Button onClick={onOpenDocuments}>Ouvrir les documents<ArrowRight size={14} aria-hidden="true" /></Button> : null}
      {intakeWorkspace?.briefDraft && !journey.briefConfirmed && journey.reviewCount === 0 && journey.processingCount === 0 ? <div className="mt-3"><JourneyAction action={onOpenSurface ? { kind: "surface", surfaceId: "brief-confirm", label: "Ouvrir le brief" } : { kind: "href", href: "#brief", label: "Consulter le brief" }} onOpenSurface={onOpenSurface} /></div> : null}
      {exceptionList(stage)}
    </>;
    if (stage === "etude") return <>
      <h3>{props.lineCount > 0 ? "Poursuivre le chiffrage" : "Structurer le devis"}</h3>
      <p className="journey-description">{props.lineCount > 0 ? `${props.lineCount} ligne${props.lineCount > 1 ? "s" : ""} dans la version courante. Vérifiez les quantités, les prix et les preuves utiles à l'étude.` : "Démarrez en manuel ou choisissez la base du devis selon les pièces du dossier."}</p>
      <Link href={editHref} className={buttonVariants({ variant: "primary" })}>{currentVersion ? "Reprendre le devis" : "Créer un devis"}<ArrowRight size={14} aria-hidden="true" /></Link>
      {props.plansError ? <p role="alert" className="journey-description">Les métrés sont indisponibles. Rechargez la page avant de préparer la remise.</p> : null}
      {studyContent ? <details className="journey-tools"><summary>Choisir la base du devis et les métrés</summary>{studyContent}</details> : null}
      {exceptionList(stage)}
    </>;
    if (stage === "remise") return <>
      <h3>{journey.accepted ? "Devis accepté par le client" : currentVersion?.status === "archived" ? "Version archivée" : currentVersion?.status === "sent" ? "Devis envoyé au client" : currentVersion?.status === "sending" ? "Envoi à reprendre" : "Préparer la remise du devis"}</h3>
      <p className="journey-description">{journey.accepted ? "L'accord du client est enregistré sur cette version." : currentVersion?.status === "sent" ? "La réponse du client reste attendue. Retrouvez le document de cette version ci-dessous." : "Vérifiez la validation et les points bloquants, puis préparez le PDF et l'email client."}</p>
      {journey.canShowOutput ? <AffaireFinishLineActions projectId={projectId} projectName={projectName} currentVersion={currentVersion} finishLineSummary={props.finishLineSummary} /> : null}
    </>;
    return currentVersion && journey.showPurchases ? <AffaireOrderDraftsPanel projectId={projectId} currentVersion={currentVersion} allowCreate={Boolean(onOpenSurface) && (journey.accepted || hash === "#finish-line-orders")} refreshSignal={props.finishLineSummary?.readyToOrder} /> : null;
  }

  return <section className="affaire-journey" aria-label="Pilotage de l'affaire">
    <div className="journey-grid"><div className="journey-panel">
      <header className="journey-panel-heading"><h2>Pilotage de l&apos;affaire</h2><span>{ghost ? "À démarrer" : `Étape ${currentIndex + 1} sur ${journey.stages.length}`}</span></header>
      {journey.stages.map((stage, index) => {
        const done = index < currentIndex || (stage.key === "remise" && journey.issued && currentVersion?.status !== "sending");
        const available = !ghost && (stage.key === "etude" || index <= currentIndex || (stage.key === "achats" && journey.showPurchases));
        return <div className="journey-stage" key={stage.key}>
          <button className="journey-stage-heading" aria-expanded={expanded === stage.key && available} aria-controls={`journey-${stage.key}`} disabled={!available} onClick={() => setSelection({ scope, hash, stage: expanded === stage.key ? null : stage.key })}>
            <span className={`journey-number ${done ? "journey-done" : index === currentIndex ? "journey-current" : ""}`}>{done ? <Check size={16} aria-hidden="true" /> : index + 1}</span>
            <span><strong>{stage.label}</strong><small>{stage.description}</small></span>
            <Badge variant={done ? "success" : index === currentIndex ? "info" : "neutral"}>{done ? "Terminé" : stage.key === "achats" && !journey.accepted ? hash === "#finish-line-orders" ? "Préparation" : "Existants" : index === currentIndex && !ghost ? "En cours" : "À venir"}</Badge>
            {available ? <ChevronDown size={16} className={expanded === stage.key ? "rotate-180" : ""} aria-hidden="true" /> : null}
          </button>
          {available && expanded === stage.key ? <div id={`journey-${stage.key}`} className="journey-stage-content">{stageContent(stage.key)}</div> : null}
        </div>;
      })}
    </div><aside className="journey-facts" aria-label="Repères du dossier">
      <h3>Repères du dossier</h3><dl><div><dt>Documents reçus</dt><dd>{intakeWorkspace ? `${documents.length} pièce${documents.length > 1 ? "s" : ""}` : "Indisponible"}</dd></div><div><dt>Plans confirmés</dt><dd>{intakeWorkspace ? `${validPlans} plan${validPlans > 1 ? "s" : ""}` : "Indisponible"}</dd></div><div><dt>Brief</dt><dd>{!intakeWorkspace ? "Indisponible" : journey.briefConfirmed ? "Confirmé" : intakeWorkspace.briefDraft ? "À confirmer" : "Non renseigné"}</dd></div></dl>
      {intakeWorkspace?.briefDraft ? <Link className="journey-text-action" href="#brief">Consulter le brief<ArrowRight size={14} aria-hidden="true" /></Link> : null}
      {currentVersion && !journey.showPurchases && (!props.finishLineSummary || props.finishLineSummary.readyToOrder.status === "unavailable") ? <Link className="journey-text-action" href="#finish-line-orders">Consulter les commandes existantes<ArrowRight size={14} aria-hidden="true" /></Link> : null}
    </aside></div>
  </section>;
}
