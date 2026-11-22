"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "@/components/feedback/toast-provider";
import { TAKEOFF_APPLY_SENT_TITLE, takeoffApplySentDescription } from "@/components/takeoff/review/useTakeoffReviewSupport";
import { TakeoffApplyGuardSection } from "@/components/takeoff/takeoff-apply-wizard/TakeoffApplyGuardSection";
import { TakeoffPageDecisionsPanel } from "@/components/takeoff/takeoff-apply-wizard/TakeoffPageDecisionsPanel";
import { forcedOverrideOf, type ForcedDrafts } from "@/components/takeoff/takeoff-apply-wizard/forced-drafts";
import {
  currentConfirmationChoices,
  initialConfirmationDraft,
  NO_CONFIRMATION_CHOICES,
  recordConfirmationChoices,
  resolveConfirmation,
  type ConfirmationDraft,
  type RevisedConfirmationDraft,
} from "@/components/takeoff/takeoff-apply-wizard/page-decisions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { releaseEstimateDraftLock } from "@/lib/estimates/client-locks";
import { ensureTakeoffApplyDraftLock } from "@/lib/takeoff/apply-draft-lock";
import { isTakeoffApiError, previewTakeoffSend, sendTakeoffJobToEstimate } from "@/lib/takeoff/client";
import type { ApplyGuardResult } from "@/lib/takeoff/guards";
import type { TakeoffPageDecision } from "@/lib/takeoff/page-replacement-contracts";
import type {
  TakeoffSendDestination,
  TakeoffSendEstimateLine,
  TakeoffSendPlanScope,
  TakeoffSendPreviewResponse,
  TakeoffSendResponse,
  TakeoffSendSectionChoice,
} from "@/lib/takeoff/send-contracts";
import { plural } from "@/lib/text/plural";

export const TAKEOFF_SEND_TITLE = "Envoyer au tableau de chiffrage";

const quantity = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 });
const RESERVATION_LABELS: Record<TakeoffSendPreviewResponse["reservations"][number]["kind"], string> = {
  entered_hypothesis: "hypothèse saisie",
  estimated: "quantité estimée",
  non_observable: "quantité non observable sur le plan",
  entered: "quantité saisie",
  to_review: "à revoir (confiance ou contrôle)",
};

const CHANGE_LABELS: Record<TakeoffSendEstimateLine["change"], string> = { created: "nouvelle ligne", changed: "ligne modifiée", removed: "ligne retirée" };

const destinationKey = (destination: TakeoffSendDestination) => destination.kind === "existing_draft" ? `draft:${destination.version_id}`
  : destination.kind === "version_copy" ? `copy:${destination.source_version_id}` : "first";

/** Where the estimator lands once sent: the version's editor, on the first line created, else the first one fed. */
function landingHref(response: TakeoffSendResponse) {
  const editor = `/dashboard/estimates/${encodeURIComponent(response.version_id)}/edit`;
  const lineId = response.lines_created[0] ?? response.lines_updated[0];
  return lineId ? `${editor}?focusItemId=${encodeURIComponent(lineId)}` : editor;
}

type Props = {
  open: boolean;
  jobId: string;
  isAdmin: boolean;
  jobLevel: string | null;
  targetedReviewHref?: string;
  onOpenChange: (open: boolean) => void;
  /** The review's own state once sent, before the landing. */
  onSent: (response: TakeoffSendResponse) => void;
};

/**
 * « Envoyer au tableau de chiffrage » for a takeoff of an affaire (lot 2, M2): the destination (the first draft the
 * confirmation creates, a draft of the affaire, or a copy of an issued version), the section, the lines of the estimate
 * as the send leaves them (its dry run: rounded lengths, grouped lines, the lines a page decision changes or removes),
 * the measures sent, the reservations and the controls evaluated for that destination. Nothing is written before
 * « Confirmer »; the server sends what this preview showed or refuses, and the preview is read again. The pages already
 * in the estimate are decided first: the preview is computed again with those decisions, and confirmed with them. A
 * confirmation keeps its request id across a timeout: sent again, it returns the receipt instead of sending twice.
 */
export function TakeoffSendDialog(props: Props) {
  return <TakeoffSendScreen key={props.jobId} {...props} />;
}

function TakeoffSendScreen({ open, jobId, isAdmin, jobLevel, targetedReviewHref, onOpenChange, onSent }: Props) {
  const toast = useToast();
  const router = useRouter();
  const [request, setRequest] = useState<{ destination?: TakeoffSendDestination; section?: TakeoffSendSectionChoice;
    page_decisions?: TakeoffPageDecision[]; read: number }>({ read: 0 });
  const [preview, setPreview] = useState<{ read: number; data: TakeoffSendPreviewResponse | null; error: string | null } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [forcedDrafts, setForcedDrafts] = useState<ForcedDrafts>({});
  const [pageChoices, setPageChoices] = useState<RevisedConfirmationDraft>(NO_CONFIRMATION_CHOICES);
  // One id per confirmation of one preview: a retry after a timeout replays it, a new preview gets a new one.
  const requestId = useRef<string | null>(null);
  const pending = useRef(false);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const read = request.read;
    void previewTakeoffSend(jobId, { ...(request.destination ? { destination: request.destination } : {}),
      ...(request.section ? { section: request.section } : {}),
      ...(request.page_decisions ? { page_decisions: request.page_decisions } : {}) }, { signal: controller.signal }).then(
      (data) => { if (!controller.signal.aborted) { requestId.current = null; setPreview({ read, data, error: null }); } },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        // The destination asked for no longer exists (another version appeared): ask for the one the server proposes.
        if (isTakeoffApiError(error) && error.status === 409 && request.destination) {
          setSubmitError(error.message);
          setRequest((current) => ({ read: current.read + 1 }));
          return;
        }
        setPreview({ read, data: null, error: isTakeoffApiError(error) || error instanceof Error ? error.message
          : "Impossible de calculer l’aperçu de l’envoi." });
      });
    return () => controller.abort();
  }, [jobId, open, request]);

  const current = preview?.read === request.read ? preview : null;
  const data = current?.data ?? null;
  const loading = open && current === null;

  const proposal = data?.page_proposal && data.page_proposal.pages.length > 0 ? data.page_proposal : null;
  const pageDraft = useMemo<ConfirmationDraft | null>(() => {
    if (!proposal) return null;
    const initial = initialConfirmationDraft(proposal);
    const choices = currentConfirmationChoices(pageChoices, proposal);
    return { ...choices, pairs: { ...initial.pairs, ...choices.pairs } };
  }, [proposal, pageChoices]);
  const pageResolution = useMemo(() => (proposal && pageDraft ? resolveConfirmation(proposal, pageDraft) : null), [proposal, pageDraft]);
  const pagesReady = pageResolution?.complete ?? true;
  // The decisions made, once complete, are previewed: the outcome shown, and confirmed, is the one they give.
  const decided = pageResolution?.complete ? pageResolution.payload : null;
  useEffect(() => {
    if (!decided || JSON.stringify(decided) === JSON.stringify(request.page_decisions ?? [])) return;
    setRequest((currentRequest) => ({ ...currentRequest, page_decisions: decided, read: currentRequest.read + 1 }));
  }, [decided, request.page_decisions]);

  const guardResult = useMemo<ApplyGuardResult | null>(() => (data ? {
    passed: data.controls.blocked_items.length === 0,
    // The server's own guard result for this destination, its codes as it wrote them.
    blocked_items: data.controls.blocked_items as unknown as ApplyGuardResult["blocked_items"],
    medium_items: data.controls.medium_items as unknown as ApplyGuardResult["medium_items"],
    threshold: data.controls.threshold,
  } : null), [data]);
  const guardBlocking = guardResult !== null && !guardResult.passed;
  // Only an outcome the dry run computed is confirmed: the lines the member sees are the ones written.
  const sendable = !!data && !data.blocked && data.impact.sent_count > 0 && !submitting && pagesReady && data.estimate_lines !== null;
  const canConfirm = sendable && !guardBlocking;
  const canOverride = sendable && isAdmin && guardBlocking;

  const readAgain = useCallback((next?: { destination?: TakeoffSendDestination; section?: TakeoffSendSectionChoice }) => {
    setRequest((currentRequest) => ({ destination: next ? next.destination : currentRequest.destination,
      section: next ? next.section : currentRequest.section,
      page_decisions: next ? undefined : currentRequest.page_decisions, read: currentRequest.read + 1 }));
  }, []);

  const confirm = async (override: boolean) => {
    if (!data?.destination || !data.section || pending.current) return;
    const forced = override && guardResult ? forcedOverrideOf(guardResult.blocked_items, forcedDrafts) : null;
    if (override && !forced) return;
    pending.current = true;
    setSubmitting(true);
    setSubmitError(null);
    requestId.current ??= crypto.randomUUID();
    const destination = data.destination;
    const lockVersionId = destination.kind === "existing_draft" ? destination.version_id : null;
    let releaseLock = false;
    let response: TakeoffSendResponse | null = null;
    try {
      if (lockVersionId) {
        const lock = await ensureTakeoffApplyDraftLock(lockVersionId);
        if (!lock.acquired) {
          setSubmitError(lock.errorMessage ?? "Impossible d'acquérir le verrou de brouillon de la version cible.");
          return;
        }
        releaseLock = lock.shouldRelease;
      }
      response = await sendTakeoffJobToEstimate(jobId, {
        request_id: requestId.current, fingerprint: data.fingerprint, destination,
        section: data.section.kind === "existing" ? { kind: "existing", id: data.section.id } : { kind: "new" },
        page_decisions: request.page_decisions ?? [],
        ...(forced ? { override: true, forced_items: forced.forced_items, forced_justifications: forced.forced_justifications } : {}),
      });
    } catch (error) {
      const message = isTakeoffApiError(error) || error instanceof Error ? error.message : "Erreur lors de l'envoi au tableau de chiffrage.";
      setSubmitError(message);
      // A refusal reads the preview again (a new confirmation, a new id); a timeout keeps the id for « Réessayer ».
      if (isTakeoffApiError(error) && error.status >= 400 && error.status < 500 && error.status !== 408) {
        requestId.current = null;
        readAgain();
      }
    } finally {
      if (releaseLock && lockVersionId) await releaseEstimateDraftLock(lockVersionId).catch(() => false);
      pending.current = false;
      setSubmitting(false);
    }
    if (!response) return;
    // The send of one plan says which plan arrived: the estimate opens on the first line it wrote.
    const planName = data.plan_scope ? data.plan_scope.plan_name ?? "sans nom" : null;
    toast.success({ title: planName ? `Plan « ${planName} » envoyé au tableau de chiffrage` : TAKEOFF_APPLY_SENT_TITLE,
      description: takeoffApplySentDescription(response) });
    onSent(response);
    router.push(landingHref(response));
  };

  const handleOpenChange = (next: boolean) => {
    if (submitting && !next) return;
    onOpenChange(next);
  };
  const sentCount = data?.impact.sent_count ?? 0;
  const headline = !data?.destination ? null
    : data.destination.kind === "first_draft" ? `Créer le premier brouillon et y envoyer ${plural(sentCount, "ligne", "lignes")}`
    : data.destination.kind === "version_copy" ? `Copier la version émise et y envoyer ${plural(sentCount, "ligne", "lignes")}`
    : `Envoyer ${plural(sentCount, "ligne", "lignes")} dans ${data.destination_label ?? "le brouillon"}`;
  const confirmLabel = submitting ? "Envoi…" : data?.destination?.kind === "first_draft" ? "Créer le brouillon et envoyer"
    : data?.destination?.kind === "version_copy" ? "Créer la copie et envoyer" : "Confirmer l'envoi";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal={submitting}>
      <DialogContent size="xl" showCloseButton={!submitting}>
        <DialogHeader>
          <DialogTitle>{TAKEOFF_SEND_TITLE}</DialogTitle>
          <DialogDescription>
            Vérifiez la destination et l’aperçu, puis confirmez : rien n’est écrit dans un devis avant, ni version, ni section, ni quantité.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div role="region" aria-label="Contenu de l’envoi" tabIndex={0}
            className="max-h-[calc(100dvh-15rem)] space-y-4 overflow-y-auto overscroll-contain pr-1">
            {loading ? <Alert variant="info">Calcul de l’aperçu de l’envoi…</Alert> : null}
            {current?.error ? (
              <Alert variant="danger">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="min-w-0">{current.error}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => readAgain()}>Réessayer</Button>
                </div>
              </Alert>
            ) : null}
            {data ? <SendPreviewBody data={data} headline={headline} disabled={submitting}
              onDestinationChange={(destination) => { setForcedDrafts({}); setPageChoices(NO_CONFIRMATION_CHOICES); readAgain({ destination }); }}
              onSectionChange={(section) => { readAgain({ destination: data.destination ?? undefined, section }); }} /> : null}
            {proposal ? (
              <TakeoffPageDecisionsPanel proposal={proposal} error={null} loading={false} draft={pageDraft} disabled={submitting}
                onDraftChange={(next) => setPageChoices((choices) => recordConfirmationChoices(choices, next, proposal))}
                onRetry={() => readAgain()} />
            ) : null}
            {data && !data.blocked ? (
              <TakeoffApplyGuardSection guardBlocking={guardBlocking} guardResult={guardResult} isAdmin={isAdmin} canOverride={canOverride}
                forcedDrafts={forcedDrafts} onForcedDraftsChange={setForcedDrafts} onOverrideConfirm={() => void confirm(true)}
                onReturnToReview={() => handleOpenChange(false)} targetedReviewHref={targetedReviewHref} isLevelC={jobLevel === "C"}
                disabled={submitting} />
            ) : null}
          </div>
          {submitError ? <Alert variant="danger" className="mt-3">{submitError}</Alert> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>Annuler</Button>
          <Button onClick={() => void confirm(false)} disabled={!canConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const UNREAD_LABELS: Record<TakeoffSendPlanScope["unread"][number]["state"], string> = {
  queued: "en attente de lecture", running: "en lecture", failed: "lecture en échec", canceled: "lecture arrêtée",
  not_started: "lecture non démarrée",
};

/** What the controls between takeoffs say for this destination, each one evaluated or not as it ran. */
function crossTakeoffSummary(data: TakeoffSendPreviewResponse) {
  const { controls } = data;
  if (controls.cross_takeoff === null) {
    return "Doublons et couverture entre métrés : comparaison au devis disponible à l’envoi, une fois la destination choisie.";
  }
  // The send of one plan is also compared with the affaire's other plans already read (« 2 autres plans déjà lus »), and
  // never with a plan not read or not compared, which the summary says.
  const scope = data.plan_scope;
  const peers = scope && scope.compared.length > 0 ? plural(scope.compared.length, "autre plan déjà lu", "autres plans déjà lus") : null;
  const outside = scope && scope.unread.length + scope.never_read.length + scope.uncompared_readings > 0
    ? ", hors plans non lus ou non comparés" : "";
  const where = (controls.evaluated_for === "existing_draft" ? `avec les métrés de ce brouillon${peers ? ` et ${peers}` : ""}`
    : controls.evaluated_for === "version_copy" ? `avec les métrés de la version copiée${peers ? ` et ${peers}` : ""}`
      : peers ? `avec ${peers} de l’affaire, ce nouveau devis ne portant encore aucun autre métré`
        : "pour ce nouveau devis, qui ne porte encore aucun autre métré") + outside;
  const { duplicates, coverage } = controls.cross_takeoff;
  if (duplicates === coverage) {
    return duplicates === "evaluated" ? `Doublons et couverture entre métrés : vérifiés ${where}.`
      : "Doublons et couverture entre métrés : non évalués : aucune ligne de ce métré ne porte les repères qu’ils comparent.";
  }
  const notEvaluated = "non évaluée : aucune ligne de ce métré ne porte les repères qu’elle compare";
  return duplicates === "evaluated"
    ? `Doublons entre métrés : vérifiés ${where}. Couverture entre métrés : ${notEvaluated}.`
    : `Couverture entre métrés : vérifiée ${where}. Doublons entre métrés : non évalués : aucune ligne de ce métré ne porte les repères qu’ils comparent.`;
}

function SendPreviewBody({ data, headline, disabled, onDestinationChange, onSectionChange }: {
  data: TakeoffSendPreviewResponse;
  headline: string | null;
  disabled: boolean;
  onDestinationChange: (destination: TakeoffSendDestination) => void;
  onSectionChange: (section: TakeoffSendSectionChoice) => void;
}) {
  const added = data.lines.filter((line) => line.target.kind === "existing_line");
  return (
    <>
      <section aria-labelledby="takeoff-send-destination" className="space-y-3 rounded-xl border border-border bg-surface-subtle p-4">
        <h3 id="takeoff-send-destination" className="text-sm font-semibold text-foreground">Destination</h3>
        {data.destinations.length > 1 ? (
          <div>
            <label htmlFor="takeoff-send-destination-choice" className="block text-xs font-semibold text-foreground-secondary">
              Devis qui reçoit le métré
            </label>
            <NativeSelect id="takeoff-send-destination-choice" size="sm" className="mt-1 w-full" disabled={disabled}
              value={data.destination ? destinationKey(data.destination) : ""}
              onChange={(event) => {
                const chosen = data.destinations.find((option) => destinationKey(option.destination) === event.target.value);
                if (chosen) onDestinationChange(chosen.destination);
              }}>
              <option value="" disabled>Choisir la destination</option>
              {data.destinations.map((option) => (
                <option key={destinationKey(option.destination)} value={destinationKey(option.destination)}>{option.label}</option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        {headline ? <p className="text-sm font-medium text-foreground">{headline}</p> : null}
        {data.destination?.kind === "version_copy" ? (
          <p className="text-sm text-muted-foreground">La copie est créée à la confirmation ; la version émise n’est jamais modifiée.</p>
        ) : null}
        {data.destination?.kind === "existing_draft" && data.section_options.length > 0 ? (
          <div>
            <label htmlFor="takeoff-send-section" className="block text-xs font-semibold text-foreground-secondary">Section cible</label>
            <NativeSelect id="takeoff-send-section" size="sm" className="mt-1 w-full" disabled={disabled}
              value={data.section?.kind === "existing" ? data.section.id : "new"}
              onChange={(event) => onSectionChange(event.target.value === "new" ? { kind: "new" } : { kind: "existing", id: event.target.value })}>
              {data.section_options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              <option value="new">Nouvelle section « {data.new_section_title} »</option>
            </NativeSelect>
          </div>
        ) : data.section ? (
          <p className="text-sm text-muted-foreground">
            {data.section.kind === "new" ? `Section proposée : « ${data.section.title} », créée à la confirmation.` : `Section : ${data.section.title}`}
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">{crossTakeoffSummary(data)}</p>
      </section>

      {data.plan_scope ? <PlanScope scope={data.plan_scope} /> : null}

      {data.blocked ? <Alert variant={data.blocked.reason === "choose_destination" ? "info" : "warning"}>{data.blocked.message}</Alert> : null}

      {data.estimate_lines ? (
        <section aria-labelledby="takeoff-send-estimate-lines" className="space-y-2">
          <h3 id="takeoff-send-estimate-lines" className="text-sm font-semibold text-foreground">Lignes du devis après l’envoi</h3>
          <p className="text-sm text-muted-foreground">
            Ce que l’envoi écrit, tel quel : une longueur arrondie au mètre, des longueurs identiques réunies en une ligne.
          </p>
          <ul aria-label="Lignes du devis après l’envoi" className="divide-y divide-border rounded-lg border border-border text-sm">
            {data.estimate_lines.map((line, index) => (
              <li key={`${line.change}-${index}`} aria-label={line.title}
                className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <strong className={line.change === "removed" ? "line-through" : undefined}>{line.title}</strong>
                  <span className="text-muted-foreground"> · {CHANGE_LABELS[line.change]}</span>
                  {line.section_title ? <span className="text-muted-foreground"> · {line.section_title}</span> : null}
                </span>
                <span className="font-mono tabular-nums">
                  {line.change === "changed" && line.quantity_before !== null
                    ? `${quantity.format(line.quantity_before)} → ${quantity.format(line.quantity)}`
                    : quantity.format(line.quantity)}{line.unit ? ` ${line.unit}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : data.outcome_pending === "page_decisions" ? (
        <Alert variant="info">Décidez des pages déjà au devis ci-dessous : les lignes du devis s’affichent ensuite, et l’envoi se confirme sur elles.</Alert>
      ) : data.outcome_pending === "blocked" ? (
        <Alert variant="warning">Des lignes sont bloquées par les contrôles : seul un administrateur peut forcer leur envoi.</Alert>
      ) : null}

      <section aria-labelledby="takeoff-send-lines" className="space-y-2">
        <h3 id="takeoff-send-lines" className="text-sm font-semibold text-foreground">
          {`Mesures envoyées (${data.lines.length})`}
        </h3>
        {added.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {plural(added.length, "ligne s’ajoute", "lignes s’ajoutent")} à une ligne déjà mesurée par un autre métré : sa quantité augmente, son prix ne change pas.
          </p>
        ) : null}
        <ul aria-label="Lignes envoyées" className="divide-y divide-border rounded-lg border border-border text-sm">
          {data.lines.map((line) => (
            <li key={line.takeoff_item_id} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2">
              <span className="min-w-0">
                <strong>{line.designation}</strong>
                {line.renamed_from ? <span className="text-muted-foreground"> (renommée depuis « {line.renamed_from} »)</span> : null}
                {line.source_file_name ? <span className="text-muted-foreground"> · {line.source_file_name}</span> : null}
                {line.source_page ? <span className="text-muted-foreground"> · p. {line.source_page}</span> : null}
                {line.target.kind === "existing_line" ? (
                  <span className="block text-muted-foreground">
                    S’ajoute à « {line.target.title} » : {quantity.format(line.target.quantity_before)} → {quantity.format(line.target.quantity_after)} {line.unit}
                  </span>
                ) : null}
              </span>
              <span className="font-mono tabular-nums">{quantity.format(line.quantity)} {line.unit}</span>
            </li>
          ))}
        </ul>
        {data.left_out.length > 0 ? (
          <p className="text-sm text-muted-foreground">
            {plural(data.left_out.length, "ligne écartée", "lignes écartées")} (exclue à la revue ou laissée de côté par une règle) : elles ne partent pas.
          </p>
        ) : null}
        {data.price_rules_ignored.length > 0 ? (
          <Alert variant="info">
            {plural(data.price_rules_ignored.length, "règle de correspondance", "règles de correspondance")} fixerait un prix ou un ouvrage : sans effet ici, les prix ne sont jamais modifiés par l’envoi.
          </Alert>
        ) : null}
      </section>

      {data.reservations.length > 0 ? (
        <section aria-labelledby="takeoff-send-reservations" className="space-y-2">
          <h3 id="takeoff-send-reservations" className="text-sm font-semibold text-foreground">Réserves</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {data.reservations.map((reservation) => (
              <li key={reservation.takeoff_item_id}>{reservation.designation} : {RESERVATION_LABELS[reservation.kind]}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/**
 * The send of one plan of a request read plan by plan: this plan only, while the others may still be read. The plans
 * already read are compared with it; those not read yet are named, never covered by the controls: each will be reviewed
 * and sent on its own, and its own send compares it with this one.
 */
function PlanScope({ scope }: { scope: TakeoffSendPlanScope }) {
  const name = scope.plan_name ?? "sans nom";
  return (
    <section aria-labelledby="takeoff-send-plan-scope" className="space-y-2 rounded-xl border border-border p-4">
      <h3 id="takeoff-send-plan-scope" className="text-sm font-semibold text-foreground">Envoi du plan « {name} »</h3>
      <p className="text-sm text-muted-foreground">
        Seules les lignes retenues de ce plan partent ; les autres plans de la demande s’envoient chacun depuis leur revue.
      </p>
      {scope.location && (scope.location.level || scope.location.building) ? (
        <p className="text-sm text-muted-foreground">
          {`Localisation du plan saisie par un opérateur : ${[scope.location.building ? `bâtiment ${scope.location.building}` : null,
            scope.location.level ? `niveau ${scope.location.level}` : null].filter(Boolean).join(", ")}.`}
          {scope.location.level ? " Une page sans niveau lu est comparée sous ce niveau." : ""}
        </p>
      ) : null}
      {scope.compared.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          Comparé avec {scope.compared.length > 1 ? "les plans déjà lus" : "le plan déjà lu"} :{" "}
          {scope.compared.map((plan) => `« ${plan.plan_name ?? "sans nom"} »`).join(", ")}.
        </p>
      ) : null}
      {scope.unread.length > 0 ? (
        <div className="text-sm">
          <p className="text-foreground">
            {plural(scope.unread.length, "plan de la demande n’est pas encore lu", "plans de la demande ne sont pas encore lus")} :
            les contrôles entre plans ne les couvrent pas.
          </p>
          <ul aria-label="Plans non lus" className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
            {scope.unread.map((plan, index) => (
              <li key={`${plan.plan_name ?? ""}-${index}`}>« {plan.plan_name ?? "sans nom"} » : {UNREAD_LABELS[plan.state]}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {scope.never_read.length > 0 ? (
        <p className="text-sm text-foreground">
          {scope.never_read.length > 1 ? "Plans du dossier jamais lus un par un" : "Plan du dossier jamais lu un par un"} :{" "}
          {scope.never_read.map((name) => `« ${name ?? "sans nom"} »`).join(", ")} : les contrôles entre plans ne les couvrent pas.
        </p>
      ) : null}
      {scope.uncompared_readings > 0 ? (
        <p className="text-sm text-foreground">
          {plural(scope.uncompared_readings, "analyse groupée de l’affaire, lue et pas encore envoyée, n’est pas comparée",
            "analyses groupées de l’affaire, lues et pas encore envoyées, ne sont pas comparées")} avec ce plan.
        </p>
      ) : null}
    </section>
  );
}
