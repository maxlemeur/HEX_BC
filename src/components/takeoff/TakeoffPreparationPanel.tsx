"use client";

import { TakeoffActionError } from "@/lib/takeoff/action-result";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useOptionalUserContext } from "@/components/UserContext";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { TakeoffPreparationFields, type PreparationSourceOption } from "@/components/takeoff/TakeoffPreparationFields";
import { useTakeoffPreparation } from "@/components/takeoff/useTakeoffPreparation";
import { TakeoffPreparationProfiles } from "@/components/takeoff/TakeoffPreparationProfiles";
import { TakeoffPreparationAssistance } from "@/components/takeoff/TakeoffPreparationAssistance";
import { evaluateTakeoffPreparation, type TakeoffPreparation } from "@/lib/takeoff/preparation";
import { TAKEOFF_LEVEL_BUSINESS_LABELS } from "@/lib/takeoff/document-classifier";
import type { TakeoffLevel } from "@/lib/takeoff/types";

export type PreparationAdvancedControlsContext = {
  processing: TakeoffPreparation["processing"];
  onProcessingChange: (patch: Partial<TakeoffPreparation["processing"]>) => void;
  isConfirmed: boolean;
};
const PROCESSING_LEVELS: TakeoffLevel[] = ["A", "B", "C"];
const PROCESSING_PROVIDER_LABELS = { auto: "Automatique — fournisseur fixé à la création", chatgpt: "ChatGPT — forfait local", gemini: "Gemini — API" };

const STEPS = ["Mes documents", "Ce que je veux mesurer", "Points à préciser", "Vérifier et lancer"];

export type TakeoffPreparationPanelProps = {
  projectId: string;
  planSetId?: string | null;
  estimateVersionId: string | null;
  targetSelectionKey?: number;
  recommendedLevel?: TakeoffLevel | null;
  compatibleLevels?: TakeoffLevel[];
  documentControls?: ReactNode;
  destinationControls?: ReactNode;
  advancedControls?: ReactNode | ((context: PreparationAdvancedControlsContext) => ReactNode);
  uploadSource?: PreparationSourceOption | null;
  localPreviewUrl?: string | null;
  onLaunch: (revision: number, processing: TakeoffPreparation["processing"]) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  onRegisterSave?: (save: () => Promise<number | null>) => void;
  disabled?: boolean;
  launchDisabled?: boolean;
};

export function TakeoffPreparationPanel(props: TakeoffPreparationPanelProps) {
  const user = useOptionalUserContext();
  return <TakeoffPreparationPanelContent key={`${user?.tenantId ?? "unknown"}:${user?.profile?.id ?? "unknown"}:${props.projectId}`} {...props} />;
}

function TakeoffPreparationPanelContent({ projectId, planSetId, estimateVersionId, targetSelectionKey = 0, recommendedLevel = "B", compatibleLevels = PROCESSING_LEVELS, documentControls, destinationControls, advancedControls, localPreviewUrl, uploadSource, onLaunch, onBusyChange, onRegisterSave, launchDisabled = false, disabled = false }: TakeoffPreparationPanelProps) {
  const { record, draft, updateDraft, saveState, error, save, renew, reload, confirm } = useTakeoffPreparation(projectId);
  const [step, setStep] = useState(0);
  const [orderedQuestionIds, setOrderedQuestionIds] = useState<string[]>([]);
  const initialStepResolved = useRef(false);
  const previousSelection = useRef<string | null | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [renewed, setRenewed] = useState(false);
  const [renewTargetIntent, setRenewTargetIntent] = useState(0);
  const previousTargetIntent = useRef(`${targetSelectionKey}:0`);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const availableSources = useMemo(() => record?.availableSources ?? [], [record?.availableSources]);
  const readiness = useMemo(() => draft ? evaluateTakeoffPreparation(draft) : null, [draft]);
  const locked = disabled || confirming || renewing;
  const processingCompatible = draft?.processing.level !== null && draft?.processing.level !== undefined && compatibleLevels.includes(draft.processing.level);
  useEffect(() => { onRegisterSave?.(save); }, [onRegisterSave, save]);
  useEffect(() => {
    if (!readiness || initialStepResolved.current) return;
    initialStepResolved.current = true;
    const paths = readiness.blockers.map((issue) => issue.path);
    setStep(paths.some((path) => path.startsWith("sources")) ? 0 : paths.some((path) => path === "objective" || path === "scope") ? 1 : paths.some((path) => path.startsWith("conventions") || path.startsWith("unknowns")) ? 2 : 3);
  }, [readiness]);

  useEffect(() => {
    if (!draft) return;
    if (draft.processing.level === null) {
      const initialLevel = recommendedLevel && compatibleLevels.includes(recommendedLevel) ? recommendedLevel : compatibleLevels[0];
      if (initialLevel) updateDraft({ ...draft, processing: { ...draft.processing, level: initialLevel } });
      return;
    }
    const target = estimateVersionId;
    const targetIntent = `${targetSelectionKey}:${renewTargetIntent}`;
    const explicitlyChangedTarget = previousTargetIntent.current !== targetIntent;
    previousTargetIntent.current = targetIntent;
    const shouldBindTarget = explicitlyChangedTarget || draft.destination.estimate_version_id === null || record?.revision === null;
    if (draft.destination.estimate_version_id !== target && shouldBindTarget) {
      updateDraft({ ...draft, destination: { ...draft.destination, estimate_version_id: target, confirmed: false } });
      return;
    }
    const candidates = uploadSource ? [uploadSource] : availableSources;
    const selection = uploadSource?.document_id ?? planSetId;
    const didSwitch = (previousSelection.current !== undefined && previousSelection.current !== selection) || (previousSelection.current === undefined && record?.revision === null && !draft.sources.some((source) => source.active));
    previousSelection.current = selection;
    const currentIds = new Set(draft.sources.map((source) => source.document_id));
    const newSources = candidates.filter((source) => !currentIds.has(source.document_id));
    const changedSelection = draft.sources.some((source) => source.active && (
      uploadSource ? source.document_id !== uploadSource.document_id : (source.document_id.startsWith("upload:") || Boolean(source.plan_set_id && source.plan_set_id !== planSetId))
    ));
    if (newSources.length === 0 && !changedSelection && !didSwitch) return;
    updateDraft({ ...draft, sources: [
      ...draft.sources.map((source) => ({ ...source, ...(didSwitch ? { active: uploadSource ? source.document_id === uploadSource.document_id : source.plan_set_id === planSetId, confirmed: false } : {}), ...(source.active && (uploadSource ? source.document_id !== uploadSource.document_id : (source.document_id.startsWith("upload:") || Boolean(source.plan_set_id && source.plan_set_id !== planSetId))) ? { active: false, confirmed: false } : {}) })),
      ...newSources.map((source) => ({ ...source, revision: source.revision ?? null, pages: [], active: uploadSource ? source.document_id === uploadSource.document_id : Boolean(planSetId && source.plan_set_id === planSetId), confirmed: false })),
    ] });
  }, [availableSources, compatibleLevels, draft, estimateVersionId, planSetId, recommendedLevel, record?.revision, renewTargetIntent, targetSelectionKey, updateDraft, uploadSource]);

  async function launch() {
    if (!readiness?.can_launch || locked || launchDisabled || !processingCompatible) return;
    setConfirming(true);
    onBusyChange?.(true);
    setLaunchError(null);
    try {
      const revision = await confirm();
      if (revision === null) throw new Error("La confirmation n'a pas été enregistrée.");
      await onLaunch(revision, draft!.processing);
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
      await renew();
      setRenewed(true);
      setRenewTargetIntent((value) => value + 1);
    } catch (cause) {
      setLaunchError(cause instanceof TakeoffActionError ? cause.message : "Impossible d'ouvrir une nouvelle préparation. Vos réponses sont conservées.");
    } finally { setRenewing(false); onBusyChange?.(false); }
  }

  if (!draft) return <div className="space-y-3 py-4" role="status">
    <p className="text-sm text-muted-foreground">{error ?? "Chargement de la préparation…"}</p>
    {error && <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => void reload()}>Réessayer le chargement</button>}
  </div>;

  const processingControls = typeof advancedControls === "function" ? advancedControls({
    processing: draft.processing,
    isConfirmed: Boolean(record?.confirmedAt),
    onProcessingChange: (patch) => {
      const processing = { ...draft.processing, ...patch };
      if (processing.level !== draft.processing.level || processing.provider !== draft.processing.provider) updateDraft({ ...draft, processing });
    },
  }) : advancedControls;

  return <div className="space-y-5">
    <nav aria-label="Étapes de préparation du métré" className="grid grid-cols-2 gap-1 sm:grid-cols-4">
      {STEPS.map((label, index) => <button key={label} type="button" disabled={locked} aria-current={step === index ? "step" : undefined} className={`rounded-lg px-2 py-2 text-left text-xs ${step === index ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-surface-subtle"}`} onClick={() => setStep(index)}><span className="mr-1">{index + 1}.</span>{label}</button>)}
    </nav>
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs" aria-live="polite">
      <span className={saveState === "error" ? "text-danger" : "text-muted-foreground"}>{saveState === "saving" ? "Enregistrement…" : saveState === "pending" ? "Modifications à enregistrer…" : saveState === "error" ? "Préparation non enregistrée" : "Préparation enregistrée"}{record?.revision ? ` · révision ${record.revision}` : ""}</span>
      <button type="button" disabled={locked || saveState === "saving"} className="text-primary underline disabled:opacity-50" onClick={() => void save().catch(() => undefined)}>Enregistrer maintenant</button>
    </div>
    {(error || launchError) && <Alert variant="danger"><AlertDescription>{error ?? launchError}<button type="button" className="mt-2 block text-sm underline" onClick={() => void reload()}>Reprendre la dernière préparation</button><span className="mt-1 block text-xs">La reprise remplace les réponses affichées par la dernière révision enregistrée.</span></AlertDescription></Alert>}
    {record && record.changedSourceIds.length > 0 && <Alert variant="warning"><AlertDescription>Des documents ont changé depuis la dernière préparation. Vérifiez les sources concernées et les confirmations rouvertes ; les analyses précédentes sont conservées.</AlertDescription></Alert>}
    <TakeoffPreparationAssistance projectId={projectId} draft={draft} onChange={updateDraft} save={save} disabled={locked} onStepChange={setStep} onOrderQuestions={setOrderedQuestionIds} />
    <fieldset disabled={locked} className="space-y-4 disabled:opacity-70">
      <legend className="sr-only">{STEPS[step]}</legend>
      {step === 0 && documentControls}
      {step === 1 && <TakeoffPreparationProfiles draft={draft} onChange={updateDraft} />}
      {step === 3 && destinationControls}
      {step === 3 && estimateVersionId && draft.destination.estimate_version_id !== estimateVersionId && <div className="space-y-2 rounded-lg border border-border bg-surface-subtle p-3"><p className="text-sm text-muted-foreground">La destination enregistrée est conservée pour retrouver la demande précédente. Pour changer sa destination, choisissez explicitement la version affichée.</p><button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => updateDraft({ ...draft, destination: { ...draft.destination, estimate_version_id: estimateVersionId, confirmed: false } })}>Utiliser la version cible sélectionnée</button></div>}
      <TakeoffPreparationFields draft={draft} onChange={updateDraft} step={step} projectId={projectId} availableSources={uploadSource ? [...availableSources, uploadSource] : availableSources} localPreviewUrl={localPreviewUrl} orderedQuestionIds={orderedQuestionIds} />
      {step === 3 && <p className="text-sm text-muted-foreground">Réglages du traitement : {draft.processing.level ? TAKEOFF_LEVEL_BUSINESS_LABELS[draft.processing.level] : "Niveau à préciser"} · {PROCESSING_PROVIDER_LABELS[draft.processing.provider]}.</p>}
      {step === 3 && !processingCompatible && <Alert variant="warning"><AlertDescription>Le niveau enregistré n’est pas compatible avec les documents sélectionnés. Choisissez explicitement un niveau compatible dans les options avancées.</AlertDescription></Alert>}
      {step === 3 && processingControls && <details className="rounded-lg border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Options avancées</summary><div className="mt-3 space-y-4">{processingControls}</div></details>}
    </fieldset>
    {step === 3 && readiness && <div className="space-y-3" aria-live="polite">
      {readiness.blockers.length > 0 ? <Alert variant="warning"><AlertDescription><p className="font-medium">{readiness.blockers.length} point{readiness.blockers.length > 1 ? "s" : ""} à préciser avant le lancement</p><ul className="mt-2 list-disc space-y-1 pl-4 text-sm">{readiness.blockers.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul></AlertDescription></Alert> : <Alert variant={readiness.reservations.length ? "warning" : "success"}><AlertDescription>{readiness.reservations.length ? "Préparation complète avec réserves conservées." : "Préparation complète. Les résultats resteront à vérifier."}</AlertDescription></Alert>}
      {record?.confirmedAt && <div className="space-y-1 rounded-lg border border-border p-3"><button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={locked || saveState === "saving"} onClick={() => void prepareNewAnalysis()}>Préparer une nouvelle analyse</button><p className="text-xs text-muted-foreground">Conserve vos réponses et ouvre une nouvelle préparation.</p></div>}
      {renewed && !record?.confirmedAt && <p role="status" className="text-sm text-muted-foreground">Nouvelle préparation enregistrée. Vérifiez le récapitulatif puis confirmez le lancement.</p>}
      {readiness.reservations.length > 0 && <div className="text-sm"><p className="font-medium">Réserves conservées</p><ul className="mt-1 list-disc pl-4">{readiness.reservations.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul></div>}
    </div>}
    <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
      <button type="button" className={buttonVariants({ variant: "outline", size: "md" })} disabled={locked || step === 0} onClick={() => setStep((value) => value - 1)}>Retour</button>
      {step < 3 ? <button type="button" className={buttonVariants({ variant: "primary", size: "md" })} disabled={locked} onClick={() => setStep((value) => value + 1)}>Continuer</button> : <button type="button" className={buttonVariants({ variant: "primary", size: "md" })} disabled={locked || launchDisabled || !processingCompatible || !readiness?.can_launch || saveState === "error"} onClick={() => void launch()}>{renewing ? "Nouvelle préparation…" : locked ? "Confirmation et lancement…" : "Confirmer et lancer le métré"}</button>}
    </div>
  </div>;
}
