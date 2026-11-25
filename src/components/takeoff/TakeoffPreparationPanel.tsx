"use client";

import { CHATGPT_REASONING_EFFORT_LABELS } from "@/lib/ai/chatgpt-model-preferences";
import { TakeoffActionError } from "@/lib/takeoff/action-result";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import Link from "next/link";

import { useOptionalUserContext } from "@/lib/auth/user-context";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { TakeoffPreparationFields } from "@/components/takeoff/TakeoffPreparationFields";
import { useTakeoffPreparation } from "@/components/takeoff/useTakeoffPreparation";
import { TakeoffPreparationProfiles } from "@/components/takeoff/TakeoffPreparationProfiles";
import { TakeoffPreparationAssistance } from "@/components/takeoff/TakeoffPreparationAssistance";
import { TakeoffPageTriage } from "@/components/takeoff/TakeoffPageTriage";
import { TakeoffLaunchPagesNotice } from "@/components/takeoff/review/TakeoffPagesAlreadyInEstimate";
import { evaluateTakeoffPreparation } from "@/lib/takeoff/preparation";
import { resolveDeducedPlanVersions, restorePlanSetOptions } from "@/lib/takeoff/preparation-from-dossier";
import { describeTakeoffRelaunchChoice } from "@/lib/takeoff/launch-request";
import type { RelaunchPlanChoice, RelaunchPlanState } from "@/lib/takeoff/relaunch-plan-choice-server";
import { describeTakeoffRequestUnitState } from "@/lib/takeoff/request-activity";

const STEPS = ["Mes documents", "Ce que je veux mesurer", "Points à préciser", "Vérifier et lancer"];
const PLAN_STATE_LABELS: Record<RelaunchPlanState, string> = {
  analysed: describeTakeoffRequestUnitState({ state: "succeeded", retryAt: null }, null),
  in_progress: describeTakeoffRequestUnitState({ state: "running", retryAt: null }, null),
  failed: describeTakeoffRequestUnitState({ state: "failed", retryAt: null }, null),
  not_analysed: "Non lu",
};

export type TakeoffPreparationPanelProps = {
  projectId: string;
  planSetId?: string | null;
  estimateVersionId: string | null;
  documentControls?: ReactNode;
  destinationControls?: ReactNode;
  planChoice?: "required";
  relaunchPlans?: RelaunchPlanChoice;
  onRefreshRelaunchPlans?: () => Promise<RelaunchPlanChoice>;
  onLaunch: (revision: number, planFileCount: number, planIds?: string[]) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  onRegisterSave?: (save: () => Promise<number | null>) => void;
  disabled?: boolean;
  launchDisabled?: boolean;
  /** Why nothing can be launched from here now, said above the launch button. */
  launchNotice?: string | null;
  /** The analysis has no version until its send: the destination is the analysis and its review only. */
  analysisOnly?: boolean;
};

export function TakeoffPreparationPanel(props: TakeoffPreparationPanelProps) {
  const user = useOptionalUserContext();
  return <TakeoffPreparationPanelContent key={`${user?.tenantId ?? "unknown"}:${user?.profile?.id ?? "unknown"}:${props.projectId}`} {...props} />;
}

function TakeoffPreparationPanelContent({ projectId, planSetId, estimateVersionId, documentControls, destinationControls, onLaunch, onBusyChange, onRegisterSave, planChoice, relaunchPlans, onRefreshRelaunchPlans, launchDisabled = false, launchNotice = null, analysisOnly = false, disabled = false }: TakeoffPreparationPanelProps) {
  const { record, support, draft, updateDraft, saveState, error, save, saveOptions, renew, reload, confirm, adopt, addProfile } = useTakeoffPreparation(projectId, planSetId);
  const [planChoices, setPlanChoices] = useState<Record<string, boolean>>({});
  const [triaging, setTriaging] = useState(false);
  const [step, setStep] = useState(3);
  const [showOptions, setShowOptions] = useState(false);
  const [orderedQuestionIds, setOrderedQuestionIds] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [renewedRevision, setRenewedRevision] = useState<number | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const availableSources = useMemo(() => record?.availableSources ?? [], [record?.availableSources]);
  const isRelaunch = relaunchPlans !== undefined;
  const effective = useMemo(() => {
    if (!draft?.provenance) return draft;
    return resolveDeducedPlanVersions(isRelaunch ? restorePlanSetOptions(structuredClone(draft)) : draft);
  }, [draft, isRelaunch]);

  const persistedRevision = saveState === "saved" && !record?.needsSave ? record?.revision : null;
  const preparationConfirmed = Boolean(persistedRevision && record?.confirmedAt);
  const saveLabel = {
    loading: "Chargement de la préparation…",
    saving: "Enregistrement…",
    pending: "Modifications à enregistrer…",
    error: "Préparation non enregistrée",
    saved: persistedRevision ? `Préparation enregistrée · révision ${persistedRevision}` : "Préparation à enregistrer",
  }[saveState];
  const readinessLabel = preparationConfirmed
    ? "Préparation confirmée. Les résultats resteront à vérifier."
    : "Les sources seront vérifiées au lancement. Les résultats resteront à vérifier.";
  const locked = disabled || confirming || renewing || triaging || Boolean(draft?.provenance && draft.provenance.plan_set_id !== planSetId);
  useEffect(() => { onRegisterSave?.(save); }, [onRegisterSave, save]);

  const choosePlans = planChoice === "required";
  const availablePlans = useMemo(() => effective?.sources.filter((source) => source.active && source.kind === "plan") ?? [], [effective]);
  const chosen = useMemo(() => availablePlans.map((plan) => plan.document_id)
    .filter((id) => !relaunchPlans || relaunchPlans.currentIds.includes(id))
    .filter((id) => planChoices[id] ?? relaunchPlans?.defaultIds.includes(id) ?? false), [availablePlans, planChoices, relaunchPlans]);
  const emptyChoice = choosePlans && !chosen.length;
  const launchSources = useMemo(() => {
    if (!effective || !choosePlans || (!isRelaunch && !chosen.length)) return effective?.sources;
    const chosenIds = new Set(chosen);
    return effective.sources.map((source) =>
      source.kind === "plan" && !chosenIds.has(source.document_id) ? { ...source, active: false } : source);
  }, [effective, choosePlans, chosen, isRelaunch]);
  const readiness = useMemo(() => effective && launchSources && evaluateTakeoffPreparation({ ...effective, sources: launchSources }),
    [effective, launchSources]);
  async function launch() {
    if (!readiness?.can_launch || locked || launchDisabled || emptyChoice) return;
    setConfirming(true);
    onBusyChange?.(true);
    setLaunchError(null);
    setSelectionNotice(null);
    try {
      if (relaunchPlans && onRefreshRelaunchPlans) {
        const latest = await onRefreshRelaunchPlans();
        const missing = chosen.filter((id) => !latest.currentIds.includes(id));
        const readSince = chosen.filter((id) => {
          const state = latest.states[id];
          return planChoices[id] !== true && state !== relaunchPlans.states[id] && (state === "analysed" || state === "in_progress");
        });
        const removed = [...missing, ...readSince];
        const addedByRefresh = latest.defaultIds.filter((id) => !relaunchPlans.defaultIds.includes(id) && !chosen.includes(id));
        if (removed.length || addedByRefresh.length) {
          setPlanChoices((current) => ({ ...current, ...Object.fromEntries([...removed, ...addedByRefresh].map((id) => [id, false])) }));
        }
        if (removed.length) {
          setSelectionNotice(readSince.length
            ? "La sélection a été actualisée. Les plans lus ou en cours de lecture depuis l’ouverture ont été décochés. Vérifiez les plans avant de relancer."
            : "La sélection a été actualisée. Les plans devenus indisponibles ont été décochés. Vérifiez les plans avant de relancer.");
          return;
        }
      }
      const confirmed = await confirm(choosePlans ? chosen : undefined);
      if (confirmed === null) {
        setShowOptions(true);
        setStep(0);
        return;
      }
      if (isRelaunch && (confirmed.planFileIds.length !== chosen.length || chosen.some((id) => !confirmed.planFileIds.includes(id)))) {
        setLaunchError("Les plans retenus ont changé pendant la confirmation. Vérifiez la sélection avant de relancer.");
        return;
      }
      if (choosePlans) await onLaunch(confirmed.revision, confirmed.planFileCount, confirmed.planFileIds);
      else await onLaunch(confirmed.revision, confirmed.planFileCount);
    } catch (cause) {
      setLaunchError(cause instanceof TakeoffActionError ? cause.message : "Impossible de confirmer le lancement. Vos réponses sont conservées.");
    } finally { setConfirming(false); onBusyChange?.(false); }
  }

  async function prepareNewAnalysis() {
    if (locked || !record?.confirmedAt) return;
    setRenewing(true);
    onBusyChange?.(true);
    setLaunchError(null);
    try {
      setRenewedRevision(await renew());
    } catch (cause) {
      setLaunchError(cause instanceof TakeoffActionError ? cause.message : "Impossible d'ouvrir une nouvelle préparation. Vos réponses sont conservées.");
    } finally { setRenewing(false); onBusyChange?.(false); }
  }

  // The steps read nothing on their own: what they show besides the draft is loaded with it (TI-720).
  if (!draft || !effective || !support) return <div className="space-y-3 py-4" role="status">
    <p className="text-sm text-muted-foreground">{error ?? "Chargement de la préparation…"}</p>
    {error && <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => void reload()}>Réessayer le chargement</button>}
  </div>;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <p className="text-sm font-medium">Analyse détaillée avec votre forfait ChatGPT</p>
      <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={locked} aria-expanded={showOptions} onClick={() => { setShowOptions(!showOptions); if (showOptions) setStep(3); }}>Options du métré</button>
    </div>
    <p className="text-sm text-muted-foreground">
      {support.chatGpt ? `${support.chatGpt.model} · Effort ${support.chatGpt.reasoningEffort ? CHATGPT_REASONING_EFFORT_LABELS[support.chatGpt.reasoningEffort].toLocaleLowerCase("fr") : "par défaut"}.` : "Connectez votre forfait ChatGPT et choisissez un modèle dans Mon profil pour lancer le métré."}{" "}
      <Link href="/dashboard/profile" className="underline">Gérer mon forfait ChatGPT</Link>
    </p>
    {relaunchPlans?.withoutCopy.length && (relaunchPlans.planSetId === planSetId || relaunchPlans.planSetId === null) ? (
      <Alert variant="warning"><AlertDescription>
        {describeTakeoffRelaunchChoice({ withoutCopy: relaunchPlans.withoutCopy, remaining: [] })}
      </AlertDescription></Alert>
    ) : null}
    {choosePlans && <fieldset disabled={locked} className="space-y-2">
      <legend className="text-sm font-medium">{isRelaunch ? "Plans à relancer" : "Plans à lancer avec mon forfait"}</legend>
      {availablePlans.map((plan) => {
        const id = plan.document_id;
        const state = relaunchPlans?.states[id] ?? "not_analysed";
        const stop = relaunchPlans?.stops[id];
        const unavailable = Boolean(relaunchPlans && !relaunchPlans.currentIds.includes(id));
        return (
          <label key={id} className="flex flex-wrap items-center gap-x-2 py-1 text-sm">
            <span className="flex min-w-0 items-start gap-2">
              <input type="checkbox" className="mt-1 shrink-0" checked={chosen.includes(id)} disabled={unavailable} onChange={(event) => {
                const checked = event.target.checked;
                setPlanChoices((current) => ({ ...current, [id]: checked }));
              }} />
              <span className="wrap-anywhere">{plan.document_name}</span>
            </span>
            {relaunchPlans && <span className="text-xs text-muted-foreground">
              {PLAN_STATE_LABELS[state]}
              {unavailable ? (relaunchPlans.unavailable[id] === "removed" ? " · Retiré du dossier" : " · Copie de travail manquante")
                : stop === "before_start" && state === "not_analysed" ? " · Arrêté avant le démarrage"
                : stop === "interrupted" && state === "failed" ? " · Lecture arrêtée" : ""}
            </span>}
          </label>
        );
      })}
    </fieldset>}
    {draft.provenance?.converted_from_legacy && <p className="text-sm text-muted-foreground">Préparation précédente adaptée à l’analyse détaillée. Vérifiez les sources et le périmètre avant le lancement.</p>}
    {showOptions && <nav aria-label="Étapes de préparation du métré" className="grid grid-cols-2 gap-1 sm:grid-cols-4">
      {STEPS.map((label, index) => <button key={label} type="button" disabled={locked} aria-current={step === index ? "step" : undefined} className={`rounded-lg px-2 py-2 text-left text-xs ${step === index ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-surface-subtle"}`} onClick={() => setStep(index)}><span className="mr-1">{index + 1}.</span>{label}</button>)}
    </nav>}
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs" aria-live="polite">
      <span className={saveState === "error" ? "text-danger" : "text-muted-foreground"}>{saveLabel}</span>
      {showOptions && <button type="button" disabled={locked || saveState === "saving"} className="text-primary underline disabled:opacity-50" onClick={() => void saveOptions().catch(() => undefined)}>Enregistrer maintenant</button>}
    </div>
    {(error || launchError) && <Alert variant="danger"><AlertDescription>{error ?? launchError}<button type="button" className="mt-2 block text-sm underline" onClick={() => { setLaunchError(null); void reload(); }}>Reprendre la dernière préparation</button><span className="mt-1 block text-xs">La reprise remplace les réponses affichées par la dernière révision enregistrée.</span></AlertDescription></Alert>}
    {record && record.changedSourceIds.length > 0 && <Alert variant="warning"><AlertDescription>Des documents ont changé depuis la dernière préparation. Vérifiez les sources concernées et les confirmations rouvertes ; les analyses précédentes sont conservées.</AlertDescription></Alert>}
    {/* Keep the proposal and its question ordering active while navigating the steps. */}
    {showOptions && <div hidden={step !== 1}>
      <TakeoffPreparationAssistance projectId={projectId} draft={draft} onChange={updateDraft} save={saveOptions} disabled={locked} onStepChange={setStep} onOrderQuestions={setOrderedQuestionIds} />
    </div>}
    <fieldset disabled={locked} className="space-y-4 disabled:opacity-70">
      <legend className="sr-only">{STEPS[step]}</legend>
      {(step === 0 || !showOptions) && documentControls}
      {step === 1 && <TakeoffPreparationProfiles draft={draft} onChange={updateDraft} profiles={support.profiles} loadError={support.profilesError} onSaved={addProfile} />}
      {step === 3 && destinationControls}
      {showOptions && step === 3 && draft.destination.kind === "estimate_review" && estimateVersionId && draft.destination.estimate_version_id !== estimateVersionId && <div className="space-y-2 rounded-lg border border-border bg-surface-subtle p-3"><p className="text-sm text-muted-foreground">La destination de la préparation diffère de la version cible sélectionnée.</p><button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => updateDraft({ ...draft, destination: { ...draft.destination, estimate_version_id: estimateVersionId, confirmed: false } })}>Utiliser la version cible sélectionnée</button></div>}
      <TakeoffPreparationFields showOptions={showOptions} estimateVersionId={estimateVersionId} analysisOnly={analysisOnly} draft={draft} effectiveSources={isRelaunch ? launchSources : effective.sources} onChange={updateDraft} step={step} projectId={projectId} availableSources={availableSources} orderedQuestionIds={orderedQuestionIds} />
      {step === 0 && <TakeoffPageTriage projectId={projectId} draft={draft} availability={support.pageTriage} onChange={updateDraft} save={saveOptions} adopt={adopt} disabled={locked || saveState === "error"} onBusyChange={(busy) => { setTriaging(busy); onBusyChange?.(busy); }} />}
    </fieldset>
    {/* TI-682 lot D: the chosen plan pages the target version already holds from an earlier takeoff (a notice, the launch stays open). */}
    {step === 3 && <TakeoffLaunchPagesNotice versionId={draft.destination.estimate_version_id ?? estimateVersionId}
      sources={isRelaunch ? launchSources ?? [] : effective.sources} />}
    {step === 3 && readiness && <div className="space-y-3" aria-live="polite">
      {readiness.blockers.length > 0 ? <Alert variant="warning"><AlertDescription><p className="font-medium">{readiness.blockers.length} point{readiness.blockers.length > 1 ? "s" : ""} à préciser avant le lancement</p><ul className="mt-2 list-disc space-y-1 pl-4 text-sm">{readiness.blockers.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul></AlertDescription></Alert> : <Alert variant={readiness.reservations.length ? "warning" : preparationConfirmed ? "success" : "info"}><AlertDescription>{readinessLabel}</AlertDescription></Alert>}
      {record?.confirmedAt && <div className="space-y-1 rounded-lg border border-border p-3"><button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={locked || saveState === "saving"} onClick={() => void prepareNewAnalysis()}>Préparer une nouvelle analyse</button><p className="text-xs text-muted-foreground">Conserve vos réponses et ouvre une nouvelle préparation.</p></div>}
      {renewedRevision !== null && persistedRevision === renewedRevision && !preparationConfirmed && <p role="status" className="text-sm text-muted-foreground">Nouvelle préparation enregistrée. Vérifiez le récapitulatif puis confirmez le lancement.</p>}
      {readiness.reservations.length > 0 && <div className="text-sm"><p className="font-medium">Réserves conservées</p><ul className="mt-1 list-disc pl-4">{readiness.reservations.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul></div>}
    </div>}
    {launchNotice && <p role="status" className="text-sm text-muted-foreground">{launchNotice}</p>}
    {selectionNotice && <p role="status" className="text-sm text-muted-foreground">{selectionNotice}</p>}
    {isRelaunch && emptyChoice && <p role="status" className="text-sm text-muted-foreground">
      {availablePlans.length ? "Cochez au moins un plan à relancer." : "Aucun plan actif dans ce jeu de plans."}
    </p>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      {showOptions && <button type="button" className={buttonVariants({ variant: "outline", size: "md" })} disabled={locked || step === 0} onClick={() => setStep((value) => value - 1)}>Retour</button>}
      {step < 3 ? <button type="button" className={buttonVariants({ variant: "primary", size: "md" })} disabled={locked} onClick={() => setStep((value) => value + 1)}>Continuer</button> : <button type="button" className={buttonVariants({ variant: "primary", size: "md" })} disabled={locked || launchDisabled || emptyChoice || !readiness?.can_launch || saveState === "error"} onClick={() => void launch()}>{renewing ? "Nouvelle préparation…" : confirming ? "Confirmation et lancement…" : isRelaunch ? `Relancer ${chosen.length} plan${chosen.length > 1 ? "s" : ""} avec mon forfait` : "Confirmer et lancer le métré"}</button>}
    </div>
  </div>;
}
