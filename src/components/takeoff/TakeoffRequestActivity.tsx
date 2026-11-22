"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { assumeTakeoffLaunchRequestAction } from "@/app/dashboard/affaires/_actions/takeoff";
import { TakeoffPlanLocationDialog } from "@/components/takeoff/TakeoffPlanLocationDialog";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cancelTakeoffJob, isTakeoffApiError, resubmitTakeoffJob } from "@/lib/takeoff/client";
import { formatTakeoffCompletionDate } from "@/lib/takeoff/completion-outcome";
import type { TakeoffRequestUnitView } from "@/lib/takeoff/launch-request-coverage";
import { describeTakeoffResume } from "@/lib/takeoff/operator-state";
import {
  describeTakeoffRequestActivityCoverage,
  describeTakeoffRequestPages,
  describeTakeoffRequestUnitState,
} from "@/lib/takeoff/request-activity";
import type {
  TakeoffRequestActivity as Activity,
  TakeoffRequestActivityJob,
  TakeoffRequestActivityResponse,
} from "@/lib/takeoff/request-activity-contracts";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";
import { describeTakeoffJobFailure } from "@/lib/takeoff/visible-status";

import { useTakeoffRequestActivity } from "./useTakeoffRequestActivity";

const TakeoffItemSendDialog = dynamic(
  () => import("@/components/takeoff/item-send/TakeoffItemSendDialog").then((module) => module.TakeoffItemSendDialog),
  { ssr: false },
);

const clock = new Intl.DateTimeFormat("fr-FR", { timeStyle: "medium", timeZone: "Europe/Paris" });
const formatClock = (value: string) => clock.format(new Date(value));

const STATE_TONE: Record<TakeoffRequestUnitView["state"], "neutral" | "info" | "success" | "danger" | "warning"> = {
  queued: "neutral", running: "info", succeeded: "success", failed: "danger", canceled: "warning", not_started: "warning",
};

/** Where the request comes from, as its heading says it. */
function describeOrigin(request: Activity) {
  if (request.origin === "automatic") return "Démarrage automatique à la confirmation du dossier";
  return request.intent === "remeasure_items" ? "Nouvelle mesure de postes" : "Relance de l’analyse";
}

/** The request's own state, for a request that has no unit to show (not admitted) or once it is closed. */
function describeRequestState(request: Activity) {
  switch (request.state) {
    case "evaluating": return "Vérification du dossier";
    case "not_eligible": return "En attente du dossier";
    case "blocked": return "Non démarrée";
    case "admitted": return "En cours";
    case "superseded": return "Remplacée par une relance";
    case "closed":
      switch (request.outcome) {
        case "success": return "Terminée";
        case "partial": return "Terminée en partie";
        case "failure": return "Échouée";
        case "canceled": return "Arrêtée";
        default: return "Close";
      }
  }
}

function describeDates(request: Activity) {
  const parts = [`demandée le ${formatTakeoffCompletionDate(request.createdAt)}`];
  if (request.closedAt) parts.push(`terminée le ${formatTakeoffCompletionDate(request.closedAt)}`);
  return parts.join(", ");
}

type LocationTarget = { setId: string; fileId: string; name: string };
type Command = { jobId: string; kind: "resubmit" | "cancel" };
type SendTarget = { jobId: string; name: string };

/**
 * The plans of one request, in the recorded order: each one's state, its last transition, why it stopped and what the
 * member may do (by the one resume policy), « Revoir [plan] » as soon as it is read, and its building and level.
 */
function RequestUnits({ projectId, request, onLocate, onCommand, onSendItems, pending }: {
  projectId: string;
  request: Activity;
  onLocate: (target: LocationTarget) => void;
  onCommand: (command: Command) => void;
  /** A plan read against the list of items: the send of its retained items (lot 4). */
  onSendItems: (target: SendTarget) => void;
  pending: Command | null;
}) {
  const units = request.units;
  if (!units) return null;
  const jobs = new Map(request.jobs.map((job) => [job.jobId, job]));
  const grouped = units.format === "grouped";

  return (
    <ol className="divide-y divide-border" aria-label={grouped ? "Analyse groupée" : "Plans de l’analyse"}>
      {units.units.map((unit) => {
        const job: TakeoffRequestActivityJob | null = jobs.get(unit.jobId) ?? null;
        const name = unit.name;
        const failure = unit.state === "failed" || ((unit.state === "canceled" || unit.state === "not_started") && unit.reasonCode)
          ? describeTakeoffJobFailure(job?.errorCode ?? unit.reasonCode) : null;
        const resume = job?.resume ? describeTakeoffResume(job.resume) : null;
        const reviewable = unit.reviewable && job !== null;
        const busy = pending?.jobId === unit.jobId;
        return (
          <li key={unit.key} className="space-y-2 py-3 first:pt-0 last:pb-0" data-testid="takeoff-request-unit" data-state={unit.state}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-foreground [overflow-wrap:anywhere]">
                  {grouped ? `Analyse groupée de ${request.groupedPlans.length} plan${request.groupedPlans.length > 1 ? "s" : ""}` : name}
                </p>
                {!grouped ? (
                  <p className="text-xs text-muted-foreground">{describeTakeoffRequestPages(unit.pages)}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATE_TONE[unit.state]} size="sm">{describeTakeoffRequestUnitState(unit, job)}</Badge>
                {/* The analysis's own last transition (created, started, ended), never a renewal of its lease. */}
                {job?.lastTransitionAt ? (
                  <time dateTime={job.lastTransitionAt} className="text-xs text-muted-foreground">
                    {formatTakeoffCompletionDate(job.lastTransitionAt)}
                  </time>
                ) : null}
              </div>
            </div>
            {grouped && request.groupedPlans.length > 0 ? (
              <ul className="space-y-1 text-sm" aria-label="Plans de l’analyse groupée">
                {request.groupedPlans.map((plan, index) => (
                  <li key={plan.planFileId ?? `${index}:${plan.name}`} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      {plan.name} <span className="text-xs text-muted-foreground">· {describeTakeoffRequestPages(plan.pages)}</span>
                    </span>
                    {plan.planFileId && job?.planSetId ? (
                      <button type="button" className="journey-text-action min-h-11 sm:min-h-9"
                        aria-label={`Bâtiment et niveau de ${plan.name}`}
                        onClick={() => onLocate({ setId: job.planSetId!, fileId: plan.planFileId!, name: plan.name })}>
                        Bâtiment et niveau
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {unit.state === "queued" && unit.retryAt ? (
              <p className="text-xs text-muted-foreground">Nouvelle tentative à partir du {formatTakeoffCompletionDate(unit.retryAt)}.</p>
            ) : null}
            {unit.state === "succeeded" && job && !job.applied && job.itemCount === 0 ? (
              <p className="text-xs text-muted-foreground">
                La lecture n’a retenu aucune ligne : la revue reste consultable, rien n’est à envoyer au devis.
              </p>
            ) : null}
            {failure || resume ? (
              <div className="space-y-1 text-xs text-muted-foreground">
                {failure ? <p>{failure}</p> : null}
                {resume ? <p>{resume}</p> : null}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {reviewable ? (
                <Link href={takeoffReviewHref({ projectId, jobId: unit.jobId, versionId: job.estimateVersionId })}
                  className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {grouped ? "Ouvrir la revue" : `Revoir ${name}`}
                </Link>
              ) : null}
              {!grouped && unit.planFileId && job?.planSetId ? (
                <Button type="button" variant="ghost" size="sm" aria-label={`Bâtiment et niveau de ${name}`}
                  onClick={() => onLocate({ setId: job.planSetId!, fileId: unit.planFileId!, name })}>
                  Bâtiment et niveau
                </Button>
              ) : null}
              {/* A plan read against the list of items is sent item by item, from its own screen; today's formats
                  keep today's send, from their review. */}
              {!grouped && job?.canSendItems ? (
                <Button type="button" size="sm" aria-label={`Envoyer ce plan au devis : « ${name} »`}
                  onClick={() => onSendItems({ jobId: unit.jobId, name })}>
                  Envoyer ce plan au devis
                </Button>
              ) : null}
              {job?.canResubmit ? (
                <Button type="button" variant="outline" size="sm" disabled={pending !== null}
                  onClick={() => onCommand({ jobId: unit.jobId, kind: "resubmit" })}>
                  {busy && pending?.kind === "resubmit" ? "Nouvelle soumission…" : "Soumettre à nouveau"}
                </Button>
              ) : null}
              {job?.canCancel ? (
                <Button type="button" variant="outline" size="sm" disabled={pending !== null}
                  onClick={() => onCommand({ jobId: unit.jobId, kind: "cancel" })}>
                  {busy && pending?.kind === "cancel" ? "Annulation…" : "Annuler"}
                </Button>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** What the request's units cannot say: its reason, its gesture, the plans set aside and the dossier's changes since. */
function RequestNotes({ projectId, request, onChanged }: { projectId: string; request: Activity; onChanged: () => void }) {
  const [gesture, setGesture] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null });
  const action = request.action;
  const take = async (kind: "take_on" | "resume") => {
    setGesture({ pending: true, error: null });
    const result = await assumeTakeoffLaunchRequestAction({ projectId, requestId: request.id, seenRevision: action!.mandateRevision, action: kind });
    setGesture({ pending: false, error: result.ok ? null : result.error.message });
    onChanged();
  };
  const changed = request.dossierChanged;
  const OMITTED: Record<Activity["plansOmitted"][number]["reason"], string> = {
    alternate: "autre indice retenu", identical_copy: "copie identique", unsupported_format: "format non lu",
    not_requested: "lu par une analyse précédente",
  };

  return (
    <>
      {request.reason ? <p className="text-sm text-foreground-secondary">{request.reason.message}</p> : null}
      {action && (action.kind === "take_on" || action.kind === "resume") && action.label ? (
        <div className="space-y-2">
          <Button type="button" variant="primary" size="sm" disabled={gesture.pending} onClick={() => void take(action.kind as "take_on" | "resume")}>
            {gesture.pending ? "Enregistrement…" : action.label}
          </Button>
          {gesture.error ? <p className="text-sm text-danger" role="alert">{gesture.error}</p> : null}
        </div>
      ) : action?.kind === "open_mac" ? (
        <p className="text-sm text-muted-foreground">Ouvrez MergeOne sur le Mac connecté pour reprendre ce métré avec votre forfait.</p>
      ) : null}
      {request.units?.unknownCalls ? (
        <p className="text-sm text-warning">
          Consommation indéterminée : {request.units.unknownCalls} appel{request.units.unknownCalls > 1 ? "s" : ""} envoyé
          {request.units.unknownCalls > 1 ? "s" : ""} sans réponse. Aucune nouvelle dépense n’est engagée pour {request.units.unknownCalls > 1 ? "eux" : "lui"}.
        </p>
      ) : null}
      {request.plansOmitted.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Écartés de cette analyse : {request.plansOmitted.map((plan) => `« ${plan.name} » (${OMITTED[plan.reason]})`).join(", ")}.
        </p>
      ) : null}
      {changed ? (
        <div className="rounded-xl border border-warning-border bg-warning-light p-3 text-sm text-foreground-secondary" data-testid="takeoff-request-dossier-changed">
          <p className="font-medium text-foreground">Dossier modifié depuis cette analyse</p>
          {changed.added.length ? <p>Plans ajoutés, non mesurés : {changed.added.map((plan) => `« ${plan.name} »`).join(", ")}.</p> : null}
          {changed.replaced.length ? <p>Plans remplacés : {changed.replaced.map((plan) => `« ${plan.name} »`).join(", ")}.</p> : null}
          {changed.removed.length ? <p>Plans retirés : {changed.removed.map((plan) => `« ${plan.name} »`).join(", ")}.</p> : null}
          <p className="text-xs text-muted-foreground">Rien n’est relu de lui-même : une nouvelle analyse se lance depuis les options du métré.</p>
        </div>
      ) : null}
    </>
  );
}

/**
 * The affaire's launch requests, in its activity: the latest execution, its plans as they are read, and the older
 * executions below. Readers see the states and open the reviews; only the member a decision allows sees an action. The
 * latest execution is the page's one poll; the older ones are read again only when it moves.
 */
export function TakeoffRequestActivity({ projectId, viewerKey, live, linked, onShowLatest, onChanged }: {
  projectId: string;
  viewerKey: string;
  /** The page's one poll of the latest execution (or of the request a link names). */
  live: {
    data: TakeoffRequestActivityResponse | undefined;
    error: unknown;
    isLoading: boolean;
    /** The member may not read this affaire's takeoff any more: nothing earlier is shown. */
    refused: boolean;
    refreshMs: number;
    refresh: () => void;
  };
  /** The request a link names (?request=), or the analysis whose request it opens (?job=). */
  linked: { view: "request" | "job"; target: string } | null;
  onShowLatest: () => void;
  /** After a member's action: every list of the page is read again. */
  onChanged: () => void;
}) {
  const [historyOffset, setHistoryOffset] = useState(0);
  const history = useTakeoffRequestActivity({
    viewerKey, projectId, view: "history", offset: historyOffset, poll: false, enabled: linked === null,
  });
  const [locating, setLocating] = useState<LocationTarget | null>(null);
  const [sending, setSending] = useState<SendTarget | null>(null);
  const [pending, setPending] = useState<Command | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  // The older executions are not polled: they are read again when the latest one moved (a new request, a closure).
  const signature = live.data?.signature;
  const seenSignature = useRef(signature);
  const reloadHistory = history.mutate;
  useEffect(() => {
    if (signature === undefined || seenSignature.current === signature) return;
    const first = seenSignature.current === undefined;
    seenSignature.current = signature;
    if (!first) void reloadHistory();
  }, [signature, reloadHistory]);

  const runCommand = async (command: Command) => {
    setPending(command);
    setCommandError(null);
    try {
      if (command.kind === "resubmit") await resubmitTakeoffJob(command.jobId);
      else await cancelTakeoffJob(command.jobId);
    } catch (error) {
      setCommandError(isTakeoffApiError(error) ? error.message
        : command.kind === "resubmit" ? "Impossible de soumettre à nouveau cette analyse." : "Impossible d’annuler cette analyse.");
    } finally {
      setPending(null);
      onChanged();
    }
  };

  if (live.refused) {
    return (
      <section className="journey-panel" aria-labelledby="takeoff-request-heading" data-testid="takeoff-request-refused">
        <header className="journey-panel-heading"><h2 id="takeoff-request-heading">Analyse des plans</h2></header>
        <div className="journey-panel-body">
          <p className="text-sm text-muted-foreground" role="alert">
            {isTakeoffApiError(live.error) && live.error.message ? live.error.message : "Vous n’avez plus accès au métré de cette affaire."}
          </p>
        </div>
      </section>
    );
  }
  const current = live.data?.current ?? null;
  const olders = linked || history.refused ? [] : history.data?.history ?? [];
  // A linked analysis without a request is the list's own (?job=): nothing to say here.
  const linkedRequestId = linked?.view === "request" ? linked.target : null;
  if (!current && olders.length === 0) {
    return live.error && linkedRequestId ? (
      <section className="journey-panel" aria-labelledby="takeoff-request-heading">
        <header className="journey-panel-heading"><h2 id="takeoff-request-heading">Analyse demandée</h2></header>
        <div className="journey-panel-body space-y-2">
          <p className="text-sm text-muted-foreground">{isTakeoffApiError(live.error) ? live.error.message : "Impossible de lire cette analyse."}</p>
          <button type="button" className="journey-text-action min-h-11 sm:min-h-9" onClick={onShowLatest}>Voir la dernière analyse de l’affaire</button>
        </div>
      </section>
    ) : linkedRequestId && live.data ? (
      <section className="journey-panel" aria-labelledby="takeoff-request-heading">
        <header className="journey-panel-heading"><h2 id="takeoff-request-heading">Analyse demandée</h2></header>
        <div className="journey-panel-body space-y-2">
          <p className="text-sm text-muted-foreground">Cette analyse n’est pas visible avec votre profil, ou elle n’existe plus.</p>
          <button type="button" className="journey-text-action min-h-11 sm:min-h-9" onClick={onShowLatest}>Voir la dernière analyse de l’affaire</button>
        </div>
      </section>
    ) : null;
  }

  const coverage = current ? describeTakeoffRequestActivityCoverage(current) : null;
  // The send stays open only while a fresh read still lets this member send that plan: a right withdrawn withdraws it.
  const sendable = sending !== null && [current, ...olders].some((request) => request?.jobs
    .some((job) => job.jobId === sending.jobId && job.canSendItems));
  const observedAt = live.data?.observedAt;
  const failedRead = Boolean(live.error) && Boolean(live.data);

  return (
    <section className="journey-panel" aria-labelledby="takeoff-request-heading" data-testid="takeoff-request-activity">
      <header className="journey-panel-heading">
        <h2 id="takeoff-request-heading">{linked ? "Analyse demandée" : "Analyse des plans"}</h2>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
          {observedAt && (failedRead || live.refreshMs > 0) ? (
            <p className={`text-xs ${failedRead ? "text-warning" : "text-muted-foreground"}`} data-testid="takeoff-request-freshness">
              {failedRead
                ? `Dernier état connu à ${formatClock(observedAt)} : la lecture suivante a échoué.`
                : `Mise à jour automatique · état de ${formatClock(observedAt)}`}
            </p>
          ) : null}
          {current ? (
            <Button type="button" variant="ghost" size="sm" onClick={live.refresh}>Actualiser</Button>
          ) : null}
        </div>
      </header>
      {current ? (
        <div className="journey-panel-body space-y-3" data-testid="takeoff-request-current" data-request-state={current.state}>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {describeOrigin(current)} · {describeRequestState(current)}
            </p>
            <p className="text-xs text-muted-foreground">{describeDates(current)}</p>
            {/* Announced when it changes; an arrival never moves the focus or the selection. */}
            <p className="text-sm text-foreground-secondary" role="status" data-testid="takeoff-request-coverage">{coverage ?? ""}</p>
          </div>
          <RequestNotes projectId={projectId} request={current} onChanged={onChanged} />
          {commandError ? <p className="text-sm text-danger" role="alert">{commandError}</p> : null}
          <RequestUnits projectId={projectId} request={current} onLocate={setLocating} onCommand={(command) => void runCommand(command)}
            onSendItems={setSending} pending={pending} />
          {linked ? (
            <button type="button" className="journey-text-action min-h-11 sm:min-h-9" onClick={onShowLatest}>
              Voir la dernière analyse de l’affaire
            </button>
          ) : null}
        </div>
      ) : null}
      {olders.length > 0 || historyOffset > 0 ? (
        <div className="journey-panel-body space-y-2 border-t border-border" data-testid="takeoff-request-history">
          <h3 className="text-sm font-semibold text-foreground">Analyses précédentes</h3>
          <ul className="divide-y divide-border">
            {olders.map((request) => (
              <li key={request.id} className="py-2">
                <details>
                  <summary className="cursor-pointer text-sm">
                    <span className="font-medium text-foreground">{describeOrigin(request)} · {describeRequestState(request)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{describeDates(request)}</span>
                    {describeTakeoffRequestActivityCoverage(request) ? (
                      <span className="block text-xs text-muted-foreground">{describeTakeoffRequestActivityCoverage(request)}</span>
                    ) : null}
                  </summary>
                  <div className="mt-3 space-y-3">
                    <RequestNotes projectId={projectId} request={request} onChanged={onChanged} />
                    <RequestUnits projectId={projectId} request={request} onLocate={setLocating}
                      onCommand={(command) => void runCommand(command)} onSendItems={setSending} pending={pending} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
          {historyOffset > 0 || history.data?.historyHasOlder ? (
            <nav aria-label="Pages des analyses précédentes" className="flex flex-wrap gap-4">
              {historyOffset > 0 ? (
                <button type="button" className="journey-text-action min-h-11 sm:min-h-9"
                  onClick={() => setHistoryOffset((offset) => Math.max(0, offset - 5))}>Plus récentes</button>
              ) : null}
              {history.data?.historyHasOlder ? (
                <button type="button" className="journey-text-action min-h-11 sm:min-h-9"
                  onClick={() => setHistoryOffset((offset) => offset + 5)}>Plus anciennes</button>
              ) : null}
            </nav>
          ) : null}
        </div>
      ) : null}
      {locating ? (
        <TakeoffPlanLocationDialog setId={locating.setId} fileId={locating.fileId} documentName={locating.name}
          open onOpenChange={(open) => { if (!open) setLocating(null); }} onSaved={() => undefined} />
      ) : null}
      {sending && sendable ? (
        <TakeoffItemSendDialog open jobId={sending.jobId} planName={sending.name} viewerKey={viewerKey}
          onOpenChange={(open) => { if (!open) setSending(null); }} onSent={onChanged} />
      ) : null}
    </section>
  );
}
