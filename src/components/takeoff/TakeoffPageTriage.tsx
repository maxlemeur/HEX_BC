"use client";

import { useEffect, useState } from "react";

import {
  loadTakeoffPageTriageAvailabilityAction,
  proposeTakeoffPageTriageAction,
} from "@/app/dashboard/affaires/_actions/takeoff-preparation";
import { buttonVariants } from "@/components/ui/button";
import { TakeoffActionError, unwrapTakeoffActionResult } from "@/lib/takeoff/action-result";
import {
  acceptTakeoffPageTriage,
  setTakeoffSourcePageRetained,
  TAKEOFF_PAGE_TRIAGE_REVIEW_REASON_LABELS,
  TAKEOFF_PAGE_TYPE_LABELS,
  takeoffSourceRetainedPages,
  type TakeoffPageTriagePage,
} from "@/lib/takeoff/page-triage";
import type { TakeoffPreparation, TakeoffPreparationSource } from "@/lib/takeoff/preparation";

type Proposal = Extract<Awaited<ReturnType<typeof proposeTakeoffPageTriageAction>>, { ok: true }>["data"];
type Availability = Extract<Awaited<ReturnType<typeof loadTakeoffPageTriageAvailabilityAction>>, { ok: true }>["data"];

const PROPOSAL_LABELS: Record<TakeoffPageTriagePage["proposal"], string> = { exclude: "À écarter", keep: "À garder", review: "À vérifier" };
const STATUS_LABELS: Record<TakeoffPageTriagePage["status"], string> = { proposed: "Proposée", to_review: "À vérifier", corrected: "Corrigée" };

function isTriageable(source: TakeoffPreparationSource) {
  return source.active && source.kind === "plan" && Boolean(source.plan_set_id && source.file_path) && !source.document_id.startsWith("upload:");
}

/**
 * « Proposer le tri des pages » (TI-663): one explicit request per active plan,
 * never on opening or reloading. The proposal is shown apart from the
 * selection; only « Accepter le tri » writes the pages, and a different
 * selection afterwards is a correction.
 */
export function TakeoffPageTriage({ projectId, draft, onChange, save, adopt, disabled, onBusyChange }: {
  projectId: string;
  draft: TakeoffPreparation;
  onChange: (draft: TakeoffPreparation) => void;
  save: () => Promise<number | null>;
  adopt: (state: Proposal["state"]) => void;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [availabilityError, setAvailabilityError] = useState(false);
  const [progress, setProgress] = useState<{ index: number; total: number; name: string } | null>(null);
  const [messages, setMessages] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadTakeoffPageTriageAvailabilityAction(projectId).then((result) => {
      if (!active) return;
      if (result.ok) setAvailability(result.data);
      else setAvailabilityError(true);
    }).catch(() => { if (active) setAvailabilityError(true); });
    return () => { active = false; };
  }, [projectId]);

  const targets = draft.sources.filter(isTriageable);
  const blocked = availabilityError ? "La disponibilité du tri des pages n’a pas pu être vérifiée. La sélection manuelle reste disponible."
    : !availability ? null
      : availability.status !== "available" ? `${availability.message}${availability.status === "disabled" ? "" : " La sélection manuelle des pages reste disponible."}`
        : draft.processing.level !== "C" ? "Le tri des pages s’applique au niveau Détaillé. Choisissez-le dans les options avancées de l’étape « Vérifier et lancer », ou sélectionnez les pages manuellement."
          : targets.length === 0 ? "Activez au moins un plan du dossier pour proposer un tri de ses pages." : null;
  const busy = progress !== null;
  const triaged = draft.sources.filter((source) => source.page_triage);

  async function propose() {
    setError(null);
    setMessages([]);
    onBusyChange(true);
    const collected: string[] = [];
    try {
      const saved = await save();
      if (saved === null) throw new Error("La préparation n’est pas enregistrée.");
      let revision: number = saved;
      for (const [index, source] of targets.entries()) {
        setProgress({ index: index + 1, total: targets.length, name: source.document_name });
        const result: Proposal = unwrapTakeoffActionResult(await proposeTakeoffPageTriageAction({ projectId, expectedRevision: revision, documentId: source.document_id }));
        adopt(result.state);
        revision = result.state.revision ?? revision;
        collected.push(`${source.document_name} : ${result.outcome.message}`);
        setMessages([...collected]);
        // No retry and no other provider: a Decisions failure stops before the next document.
        if (result.outcome.stop_reason === "call_failed") break;
      }
    } catch (cause) {
      setError(cause instanceof TakeoffActionError ? cause.message : "Le tri des pages a échoué. Votre sélection est conservée ; continuez manuellement.");
    } finally {
      setProgress(null);
      onBusyChange(false);
    }
  }

  const update = (documentId: string, change: (source: TakeoffPreparationSource) => TakeoffPreparationSource) =>
    onChange({ ...draft, sources: draft.sources.map((source) => source.document_id === documentId ? change(source) : source) });

  return <section aria-label="Tri des pages" className="space-y-3 rounded-lg border border-border bg-surface-subtle p-3">
    <div className="space-y-1">
      <p className="text-sm font-medium">Tri des pages</p>
      <p className="text-xs text-muted-foreground">Decisions propose le type, le niveau et la zone de chaque page des plans actifs, pour n’analyser que les pages utiles. Rien n’est retiré sans votre acceptation ; une page incertaine reste retenue « À vérifier ». Consommation API Decisions distincte du forfait ChatGPT.</p>
    </div>
    <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={disabled || busy || blocked !== null || !availability} onClick={() => void propose()}>
      {busy ? "Tri des pages en cours…" : "Proposer le tri des pages"}
    </button>
    <div aria-live="polite" className="space-y-1 text-sm">
      {blocked && <p className="text-muted-foreground">{blocked}</p>}
      {progress && <p role="status" className="text-muted-foreground">Tri des pages : document {progress.index} sur {progress.total} · {progress.name}</p>}
      {messages.map((message) => <p key={message} className="text-muted-foreground">{message}</p>)}
      {error && <p className="text-warning">{error} Aucune autre IA n’est sollicitée.</p>}
    </div>
    {triaged.map((source) => {
      const triage = source.page_triage!;
      const retained = takeoffSourceRetainedPages(source);
      return <div key={source.document_id} className="space-y-2 rounded-lg border border-border bg-surface p-3">
        <p className="text-sm font-medium break-words">{source.document_name} · {triage.accepted ? "Tri accepté" : "Proposition à accepter"}</p>
        <div className="overflow-x-auto">
          <table aria-label={`Tri proposé pour ${source.document_name}`} className="w-full text-left text-xs">
            <thead className="text-muted-foreground"><tr><th className="py-1 pr-2 font-medium">Page</th><th className="py-1 pr-2 font-medium">Type</th><th className="py-1 pr-2 font-medium">Niveau</th><th className="py-1 pr-2 font-medium">Zone</th><th className="py-1 pr-2 font-medium">Confiance</th><th className="py-1 pr-2 font-medium">Proposition</th><th className="py-1 pr-2 font-medium">Statut</th><th className="py-1 font-medium">Retenue</th></tr></thead>
            <tbody>
              {triage.pages.map((page) => <tr key={page.page} className="border-t border-border">
                <td className="py-1 pr-2">Page {page.page}</td>
                <td className="py-1 pr-2">{page.type ? TAKEOFF_PAGE_TYPE_LABELS[page.type] : "—"}</td>
                <td className="py-1 pr-2">{page.level ?? "—"}</td>
                <td className="py-1 pr-2">{page.zone ?? "—"}</td>
                <td className="py-1 pr-2">{page.confidence === null ? "—" : `${Math.round(page.confidence * 100)} %`}</td>
                <td className="py-1 pr-2">{PROPOSAL_LABELS[page.proposal]}{page.reason ? ` (${TAKEOFF_PAGE_TRIAGE_REVIEW_REASON_LABELS[page.reason]})` : ""}</td>
                <td className="py-1 pr-2">{STATUS_LABELS[page.status]}</td>
                <td className="py-1"><input type="checkbox" className="size-4" aria-label={`Retenir la page ${page.page} de ${source.document_name}`} checked={retained.has(page.page)} disabled={disabled || busy} onChange={(event) => update(source.document_id, (current) => setTakeoffSourcePageRetained(current, page.page, event.target.checked))} /></td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={disabled || busy} onClick={() => update(source.document_id, acceptTakeoffPageTriage)}>Accepter le tri de {source.document_name}</button>
        <p className="text-xs text-muted-foreground">L’acceptation écrit les pages retenues et rouvre la confirmation de la pièce. Une page que vous modifiez ensuite reste « Corrigée ».</p>
      </div>;
    })}
  </section>;
}
