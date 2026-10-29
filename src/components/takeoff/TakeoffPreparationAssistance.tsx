"use client";

import { TakeoffActionError, unwrapTakeoffActionResult } from "@/lib/takeoff/action-result";
import { useRef, useState } from "react";

import { assistTakeoffPreparationAction } from "@/app/dashboard/affaires/_actions/takeoff-preparation";
import { buttonVariants } from "@/components/ui/button";
import { TakeoffPreparationSourcePreview } from "@/components/takeoff/TakeoffPreparationSourcePreview";
import { Textarea } from "@/components/ui/textarea";
import {
  applyTakeoffPreparationProposal,
  attachTakeoffPreparationAssistanceProvenance,
  createTakeoffPreparationQuestion,
  orderTakeoffPreparationQuestions,
  type TakeoffPreparationAssistance as Assistance,
} from "@/lib/takeoff/preparation-assistance";
import { TAKEOFF_PREPARATION_OBJECTIVES, type TakeoffPreparation } from "@/lib/takeoff/preparation";

const FIELD_LABELS = {
  objective: "Objectif", "scope.lots": "Lots", "scope.networks": "Réseaux", "scope.levels": "Niveaux",
  "scope.zones": "Zones", "scope.inclusions": "Inclusions", "scope.exclusions": "Exclusions", "conventions.unit": "Unité",
};

export function TakeoffPreparationAssistance({ projectId, draft, onChange, save, disabled, onStepChange, onOrderQuestions }: {
  projectId: string;
  draft: TakeoffPreparation;
  onChange: (draft: TakeoffPreparation) => void;
  save: () => Promise<number | null>;
  disabled: boolean;
  onStepChange: (step: number) => void;
  onOrderQuestions: (ids: string[]) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Assistance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<string[]>([]);
  const baseDraft = useRef("");
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const stale = result !== null && baseDraft.current !== JSON.stringify(draft);

  async function propose() {
    setBusy(true);
    setError(null);
    try {
      const expectedRevision = await save();
      const before = JSON.stringify(latestDraft.current);
      const response = unwrapTakeoffActionResult(await assistTakeoffPreparationAction({ projectId, expectedRevision, instruction: instruction.trim() || undefined }));
      baseDraft.current = before;
      setResult(response);
      setAccepted([]);
      if (JSON.stringify(latestDraft.current) === before) onOrderQuestions(response.decisions.ordered_question_ids);
    } catch (cause) {
      setError(cause instanceof TakeoffActionError ? cause.message : "L'assistance est indisponible. Poursuivez la préparation manuellement.");
    } finally { setBusy(false); }
  }

  function adopt(id: string, next: TakeoffPreparation) {
    const traced = result && next !== draft ? attachTakeoffPreparationAssistanceProvenance(next, result, id) : next;
    baseDraft.current = JSON.stringify(traced);
    onChange(traced);
    setAccepted((previous) => [...previous, id]);
  }

  function sources(ids: string[]) {
    return ids.map((sourceId) => draft.sources.find((source) => source.document_id === sourceId)?.document_name ?? "Source à revoir").join(" · ") || "Aucune source établie";
  }

  return <details className="rounded-lg border border-border bg-surface-subtle p-3">
    <summary className="cursor-pointer text-sm font-medium">Assistance au cadrage</summary>
    <div className="mt-3 space-y-3">
      <p className="text-xs text-muted-foreground">L&apos;assistance propose des champs et des questions à partir du dossier. Les décisions confirmées restent conservées. Vous pouvez poursuivre manuellement.</p>
      <label className="block space-y-1 text-sm"><span>Décrire le périmètre ou corriger le cadrage</span><Textarea maxLength={2000} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="Exemple : compter les équipements au R+1, zone 1, en excluant le RDC." disabled={disabled || busy} /></label>
      <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => void propose()} disabled={disabled || busy}>{busy ? "Préparation des propositions…" : "Proposer un cadrage"}</button>
      <div aria-live="polite" className="space-y-3">
        {error && <p className="text-sm text-warning">{error} Vos réponses sont conservées et la saisie manuelle reste disponible.</p>}
        {result && <>
          <p className="text-sm text-muted-foreground">{result.message}</p>
          <p className="text-xs text-muted-foreground">{result.capabilities.writing.message} {result.capabilities.writing.billing === "chatgpt_plan" ? "Consommation : forfait ChatGPT local." : result.capabilities.writing.billing === "api" ? "Consommation : API configurée." : ""}</p>
          <p className="text-xs text-muted-foreground">Decisions : {result.decisions.message} Accès API distinct de la connexion ChatGPT.</p>
          {stale && <p className="text-sm text-warning">Le cadrage a changé depuis ces propositions. Relancez l&apos;assistance pour les actualiser.</p>}
          {result.proposals.map((proposal) => <div key={proposal.id} className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm">
            <p className="font-medium">{FIELD_LABELS[proposal.field]} · {accepted.includes(proposal.id) ? "Ajouté au brouillon, à confirmer" : "Proposition à confirmer"}</p>
            <p>{proposal.field === "objective" ? proposal.values.map((value) => value in TAKEOFF_PREPARATION_OBJECTIVES ? TAKEOFF_PREPARATION_OBJECTIVES[value as keyof typeof TAKEOFF_PREPARATION_OBJECTIVES] : value).join(" · ") : proposal.values.join(" · ")}</p>
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Sources et explication</summary><p className="mt-1">{sources(proposal.source_document_ids)}</p><p className="mt-1">{proposal.explanation}</p>{proposal.source_document_ids.map((sourceId) => <TakeoffPreparationSourcePreview key={sourceId} projectId={projectId} documentId={sourceId} name={draft.sources.find((source) => source.document_id === sourceId)?.document_name ?? "la pièce"} />)}</details>
            <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={disabled || stale || accepted.includes(proposal.id) || applyTakeoffPreparationProposal(draft, proposal) === draft} onClick={() => adopt(proposal.id, applyTakeoffPreparationProposal(draft, proposal))}>Utiliser la proposition pour {FIELD_LABELS[proposal.field]}</button>
          </div>)}
          {orderTakeoffPreparationQuestions(result.questions, result.decisions.ordered_question_ids).map((question) => <div key={question.id} className="space-y-2 rounded-lg border border-border bg-surface p-3 text-sm"><p className="font-medium">{question.question}</p><details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Pourquoi cette question ?</summary><p className="mt-1">{question.explanation}</p><p className="mt-1">Sources : {sources(question.source_document_ids)}</p></details><button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={disabled || stale || accepted.includes(question.id)} onClick={() => { adopt(question.id, createTakeoffPreparationQuestion(draft, question)); onStepChange(2); }}>Ajouter ce point à préciser</button></div>)}
          {result.decisions.next_action && !stale && <button type="button" className="text-sm text-primary underline" onClick={() => onStepChange(({ sources: 0, scope: 1, conventions: 2, recap: 3 })[result.decisions.next_action!])}>Voir la prochaine étape proposée</button>}
        </>}
      </div>
    </div>
  </details>;
}
