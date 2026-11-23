"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useToast } from "@/components/feedback/toast-provider";
import { useCompletions } from "@/components/takeoff/item-detail/useCompletions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { releaseEstimateDraftLock } from "@/lib/estimates/client-locks";
import { ensureTakeoffApplyDraftLock } from "@/lib/takeoff/apply-draft-lock";
import { takeoffItemSendLandingHref } from "@/lib/takeoff/apply-landing";
import { confirmTakeoffItemSend, isTakeoffApiError, previewTakeoffItemSend } from "@/lib/takeoff/client";
import type { ItemSendConfirmResponse, ItemSendPreviewResponse } from "@/lib/takeoff/item-send-contracts";
import type { ItemSendBreakdown, ItemSendChoice } from "@/lib/takeoff/item-send-plan";
import {
  EMPTY_ITEM_SEND_CHOICES,
  itemSendPageHolderChanged,
  itemSendPageKey,
  itemSendPreviewChanges,
  itemSendRequestOf,
  reconcileItemSendChoices,
  withItemSendPageDecision,
  withItemSendResolution,
  type ItemSendPendingPageDecision,
  type ItemSendScreenChoices,
} from "@/lib/takeoff/item-send-screen";
import { plural } from "@/lib/text/plural";

import { ItemRedistributionPanel } from "./ItemRedistributionPanel";
import { ItemSendPageDecision, ItemSendPoint } from "./ItemSendChoices";
import {
  ItemSendBlocked,
  ItemSendBreakdownChoice,
  ItemSendDestination,
  ItemSendLines,
  ItemSendNotSent,
  ItemSendRules,
  ItemSendSectionsCreated,
} from "./ItemSendPreviewSections";

// Lot 4, PR 5c: « Envoyer ce plan au devis » for a plan read against the affaire's list of items. The preview is read
// only (POST …/item-send/preview): the draft created or fed, the breakdown, the sections, the lines and their quantities
// before and after, what is left out and why, and the choices the member must make. One button confirms the plan shown
// (POST …/item-send/confirm, with the member's choices, an intention key and the preview's digest). On an existing draft
// the writer requires the member's own editor lease: taken here at the confirmation as today's send takes it
// (ensureTakeoffApplyDraftLock) and released after, as the editor does. A stale preview is read again with the choices
// that still apply, and the screen says what changed. Every read and the confirmation are completions of the screen
// that started them (useCompletions): one that ends after the member moved does not act on what is shown now.

type Preview = ItemSendPreviewResponse;
type Point = Preview["to_resolve"][number];
type Destination = NonNullable<Preview["destination"]>;
type Ask = { destination?: Destination; breakdown?: ItemSendBreakdown; choices: ItemSendScreenChoices; read: number };
type Notice = { text: string; changes: string[] };

export const TAKEOFF_ITEM_SEND_TITLE = "Envoyer ce plan au devis";
export const ITEM_SEND_LANDING_LABEL = "Ouvrir le devis sur la ligne écrite";

type Props = {
  redistributionOnly?: boolean;
  open: boolean;
  jobId: string;
  /** The plan as the entry names it, until the preview names it. */
  planName: string;
  /** The member and their tenant: what a read started for one member never shows for another. */
  viewerKey: string;
  onOpenChange: (open: boolean) => void;
  /** The takeoff page's own state once sent (the plan shown as sent), before the landing. */
  onSent?: (response: ItemSendConfirmResponse) => void;
};

export function TakeoffItemSendDialog(props: Props) {
  if (props.redistributionOnly) return <Dialog open={props.open} onOpenChange={props.onOpenChange}>
    <DialogContent><DialogHeader><DialogTitle>Redistribuer les apports</DialogTitle>
      <DialogDescription>Choisissez les apports du poste à répartir dans le brouillon.</DialogDescription></DialogHeader>
      <DialogBody><ItemRedistributionPanel key={props.viewerKey + props.jobId} jobId={props.jobId} viewerKey={props.viewerKey} /></DialogBody>
      <DialogFooter><Button variant="outline" onClick={() => props.onOpenChange(false)}>Annuler</Button></DialogFooter>
    </DialogContent></Dialog>;
  return <TakeoffItemSendScreen key={`${props.viewerKey}:${props.jobId}`} {...props} />;
}

const lockGuards = new Set(["item_send_draft_locked", "item_send_draft_lock_required"]);
/**
 * The confirmations whose answer was lost, by screen (member and plan), with the request they sent: reopening the same send
 * with the same plan and choices sends them again under their key, so that the server replays the receipt of one that won.
 */
const uncertainIntents = new Map<string, { digest: string; id: string }>();
const pageName = (page: number | null) => (page === null ? "Toutes les pages" : `Page ${page}`);
const guardOf = (error: unknown) => (isTakeoffApiError(error) && error.details && typeof error.details === "object"
  ? (error.details as { guard?: unknown }).guard : undefined);

function TakeoffItemSendScreen({ open, jobId, planName, viewerKey, onOpenChange, onSent }: Props) {
  const toast = useToast();
  const router = useRouter();
  const [ask, setAsk] = useState<Ask>({ choices: EMPTY_ITEM_SEND_CHOICES, read: 0 });
  const [preview, setPreview] = useState<{ read: number; data: Preview | null; error: string | null; disagree?: boolean } | null>(null);
  const [heldPoints, setHeldPoints] = useState<ReadonlyMap<string, Point>>(new Map());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [redistributing, setRedistributing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Sent: nothing is confirmed again while the editor opens.
  const [sent, setSent] = useState(false);
  // The pages whose note is being typed: the confirmation waits for it to reach the preview.
  const [typing, setTyping] = useState<ReadonlySet<string>>(new Set());
  const pending = useRef(false);
  const screen = `${viewerKey}:${jobId}`;
  // One intention key per plan and choices confirmed: a retry of the same request replays its receipt (the server answers it
  // only for the same plan and the same choices), another plan or other choices get a new key. A lost answer's key outlives
  // the screen.
  const intent = useRef<{ digest: string; id: string } | null>(uncertainIntents.get(screen) ?? null);
  // The leases this send took, a lost answer's included: released after each confirmation and when the screen goes; a lease
  // the member already held is only renewed, never released.
  const leases = useRef(new Set<string>());
  // The leases a confirmation under way relies on: released only once it settled, whatever the screen does meanwhile.
  const inFlight = useRef(new Set<string>());
  useEffect(() => () => {
    for (const versionId of leases.current) {
      if (!inFlight.current.has(versionId)) void releaseEstimateDraftLock(versionId).catch(() => false);
    }
  }, []);
  // The reads of a decided page that disagree, read again a bounded number of times before the member is asked to.
  const disagreements = useRef(0);
  // A preview found stale: the one shown before it, and the choices dropped since, said with the next one.
  const stale = useRef<{ from: Preview; dropped: string[] } | null>(null);
  const start = useCompletions({ screen, item: String(ask.read) });

  /** A new request: read again only when what the server is asked changes (or the member asks to try again). */
  const update = useCallback((change: (current: Ask) => Omit<Ask, "read">, force = false) => setAsk((current) => {
    const next = change(current);
    const same = JSON.stringify(itemSendRequestOf(next)) === JSON.stringify(itemSendRequestOf(current));
    return { ...next, read: same && !force ? current.read : current.read + 1 };
  }), []);

  useEffect(() => {
    if (!open) return;
    const read = ask.read;
    const completion = start({ screen, item: String(read) });
    const controller = new AbortController();
    const request = itemSendRequestOf(ask);
    // With page decisions, what each decided page holds now is read too, without them: a decision whose page holds
    // something else than when it was taken is asked again (« Remplacer » would take out something else).
    const holders = request.page_decisions?.length
      ? previewTakeoffItemSend(jobId, itemSendRequestOf({ ...ask, choices: { ...ask.choices, pageDecisions: new Map() } }),
        { signal: controller.signal })
      : Promise.resolve(null);
    void Promise.all([previewTakeoffItemSend(jobId, request, { signal: controller.signal }), holders]).then(([data, bare]) => {
      if (!completion.current()) return;
      const fresh = (bare?.to_resolve ?? []).filter((point) => point.kind === "page_decision");
      const movedPages = [...ask.choices.pageDecisions.keys()].filter((key) => {
        const before = heldPoints.get(key);
        const now = fresh.find((point) => itemSendPageKey(point.page) === key);
        return before !== undefined && now !== undefined && itemSendPageHolderChanged(before, now);
      });
      // What the page shows and what the confirmation would do must be one state: a line a decided page holds stands in the
      // decided read at the quantity the read without decisions gives it. Otherwise nothing is confirmable, and both are
      // read again.
      const decided = (point: Point) => ask.choices.pageDecisions.has(itemSendPageKey(point.page));
      const disagree = movedPages.length === 0 && fresh.some((point) => decided(point) && point.earlier_lines.some((held) => {
        const fed = data.lines.find((candidate) => candidate.estimate_item_id?.toLowerCase() === held.estimate_item_id.toLowerCase());
        return fed !== undefined && fed.quantity_before !== null && fed.quantity_before !== held.quantity;
      }));
      if (fresh.length > 0) {
        setHeldPoints((currentPoints) => {
          const next = new Map(currentPoints);
          for (const point of fresh) next.set(itemSendPageKey(point.page), point);
          return next;
        });
      }
      if (disagree) {
        if (disagreements.current < 2) {
          disagreements.current += 1;
          setAsk((currentAsk) => (currentAsk.read === read ? { ...currentAsk, read: read + 1 } : currentAsk));
        } else {
          setPreview({ read, data, error: null, disagree: true });
        }
        return;
      }
      disagreements.current = 0;
      // The choices the new preview still applies; a dropped one is said, and the preview read again without it.
      const reconciled = reconcileItemSendChoices(ask.choices, data);
      const dropped = [...reconciled.dropped, ...movedPages.map((key) => `${pageName(heldPoints.get(key)?.page ?? null)} : ce qu’elle `
        + "tient au devis a changé depuis votre décision, décidez de nouveau.")];
      const withoutMoved = (choices: Ask["choices"]) => {
        if (movedPages.length === 0) return choices;
        const pageDecisions = new Map(choices.pageDecisions);
        for (const key of movedPages) pageDecisions.delete(key);
        return { ...choices, pageDecisions };
      };
      if (dropped.length > 0) {
        if (stale.current) stale.current.dropped.push(...dropped);
        else setNotice({ text: "Certains choix ne s’appliquent plus.", changes: dropped });
        // On the choices as they are now (a page decision begun meanwhile stays), read again without the dropped ones.
        setAsk((currentAsk) => (currentAsk.read === read ? { ...currentAsk,
          choices: withoutMoved(reconcileItemSendChoices(currentAsk.choices, data).choices), read: read + 1 } : currentAsk));
        return;
      }
      // What each kept choice is applied on, recorded with this read (the request does not change: no new read).
      if (reconciled.choices !== ask.choices) {
        setAsk((currentAsk) => (currentAsk.read === read
          ? { ...currentAsk, choices: reconcileItemSendChoices(currentAsk.choices, data).choices } : currentAsk));
      }
      if (stale.current) {
        const changes = [...itemSendPreviewChanges(stale.current.from, data), ...stale.current.dropped];
        stale.current = null;
        setNotice((current) => ({ text: current?.text ?? "L’aperçu a changé.", changes }));
      }
      setHeldPoints((current) => {
        const next = new Map(current);
        for (const point of data.to_resolve) if (point.kind === "page_decision") next.set(itemSendPageKey(point.page), point);
        return next;
      });
      setPreview({ read, data, error: null });
    }, (error: unknown) => {
      if (!completion.current() || controller.signal.aborted) return;
      // The destination asked for no longer exists (the affaire's versions changed): the one the server proposes.
      if (isTakeoffApiError(error) && error.status === 409 && guardOf(error) === "item_send_preview_stale" && ask.destination) {
        setNotice({ text: error.message, changes: [] });
        setAsk((current) => (current.read === read ? { ...current, destination: undefined, read: read + 1 } : current));
        return;
      }
      setPreview({ read, data: null, error: isTakeoffApiError(error) || error instanceof Error ? error.message
        : "Impossible de calculer l’aperçu de l’envoi des postes." });
    });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one read per request (`ask.read`), started on what it asks
  }, [jobId, open, ask.read]);

  const current = preview?.read === ask.read ? preview : null;
  const data = current?.data ?? null;
  const loading = open && current === null;
  const shownPlan = data?.plan?.name ?? planName;

  const labels = useMemo(() => {
    const names = new Map<string, string>();
    for (const entry of [...(data?.lines ?? []), ...(data?.not_sent ?? []), ...(data?.rules ?? [])]) names.set(entry.item_id, entry.label);
    for (const point of data?.to_resolve ?? []) if (point.item_id && point.label) names.set(point.item_id, point.label);
    return names;
  }, [data]);

  const choose = useCallback((point: Point, choice: ItemSendChoice | null) => {
    setNotice(null);
    update((currentAsk) => ({ ...currentAsk, choices: withItemSendResolution(currentAsk.choices, point, choice) }));
  }, [update]);
  /** A note typed and not yet committed: written only onto the same « garder les deux » it was typed for, if still current. */
  const flushNote = useCallback((page: number | null, decidedOn: Extract<ItemSendPendingPageDecision, { decision: "keep_both" }>,
    note: string) => update((currentAsk) => {
    const now = currentAsk.choices.pageDecisions.get(itemSendPageKey(page));
    if (!now || now.decision !== "keep_both" || now.reasonCode !== decidedOn.reasonCode || (now.note ?? "") !== (decidedOn.note ?? "")) {
      return currentAsk;
    }
    return { ...currentAsk, choices: withItemSendPageDecision(currentAsk.choices, { ...now, note: note || null }) };
  }), [update]);
  const decidePage = useCallback((point: Point, decision: ItemSendPendingPageDecision | null) => {
    setNotice(null);
    update((currentAsk) => ({ ...currentAsk, choices: withItemSendPageDecision(currentAsk.choices,
      decision ?? { page: point.page, decision: null }) }));
  }, [update]);

  // The points to resolve now, then those already chosen (their choice can change), in the preview's order.
  const asked = data?.to_resolve.filter((point) => point.kind !== "page_decision") ?? [];
  const chosen = [...ask.choices.resolutions.values()].filter(({ point }) => point.kind !== "page_decision"
    && !asked.some((candidate) => candidate.key === point.key)).map(({ point }) => point);
  const pagePoints = [...new Map([...heldPoints].filter(([key]) => ask.choices.pageDecisions.has(key)
    || ask.choices.resolutions.has(heldPoints.get(key)!.key)
    || data?.to_resolve.some((point) => point.kind === "page_decision" && itemSendPageKey(point.page) === key))).values()];
  const invalidFor = (page: number | null) => (data?.invalid_page_decisions ?? []).filter((entry) => entry.page === page)
    .map((entry) => entry.message);
  const invalidElsewhere = (data?.invalid_page_decisions ?? []).filter((entry) => entry.page === null
    || !pagePoints.some((point) => point.page === entry.page));

  const confirmable = !!data && data.confirmable && data.plan_digest !== null && data.invalid_page_decisions.length === 0
    && !submitting && !redistributing && !loading && !sent && typing.size === 0 && !current?.disagree;
  const noteTyping = useCallback((page: number | null, pendingNote: boolean) => setTyping((current) => {
    const key = itemSendPageKey(page);
    if (current.has(key) === pendingNote) return current;
    const next = new Set(current);
    if (pendingNote) next.add(key); else next.delete(key);
    return next;
  }), []);

  const confirm = async () => {
    if (!data || !confirmable || !data.plan_digest || pending.current) return;
    pending.current = true;
    setSubmitting(true);
    setSubmitError(null);
    const digest = data.plan_digest;
    // Exactly the request the preview shown was read with: the server binds the plan to those choices (their digest).
    const request = itemSendRequestOf(ask);
    const requestKey = `${digest}:${JSON.stringify(request)}`;
    if (intent.current?.digest !== requestKey) intent.current = { digest: requestKey, id: crypto.randomUUID() };
    const key = intent.current;
    const completion = start({ screen, item: String(ask.read) });
    const lockVersionId = data.destination?.kind === "existing_draft" ? data.destination.version_id : null;
    let response: ItemSendConfirmResponse | null = null;
    let failure: unknown = null;
    let lockRefused: string | null = null;
    try {
      if (lockVersionId) {
        const lock = await ensureTakeoffApplyDraftLock(lockVersionId);
        // A lease this send took, also when the answer granting it was lost: it is released below.
        if (lock.shouldRelease || lock.acquireAttempted) leases.current.add(lockVersionId);
        if (!lock.acquired) {
          lockRefused = lock.lockedByOther
            ? `${lock.errorMessage ?? "Le brouillon est verrouillé."} L’envoi y sera possible quand ce brouillon sera libéré. Rien n’a été écrit.`
            : `${lock.errorMessage ?? "Le brouillon n’a pas pu vous être réservé."} Rien n’a été écrit : réessayez.`;
          return;
        }
        // The member left this send while the lease was taken: nothing is posted.
        if (!completion.ownScreen()) return;
        inFlight.current.add(lockVersionId);
      }
      response = await confirmTakeoffItemSend(jobId, { ...request, request_id: key.id, plan_digest: digest });
    } catch (error) {
      failure = error;
    } finally {
      if (lockVersionId) inFlight.current.delete(lockVersionId);
      if (lockVersionId && leases.current.has(lockVersionId)) {
        const released = await releaseEstimateDraftLock(lockVersionId).then(() => true, () => false);
        if (released) leases.current.delete(lockVersionId);
      }
      // After a success the button stays off until the editor opens: the same plan is never confirmed twice from here.
      if (!response) pending.current = false;
      if (completion.ownScreen()) {
        if (response) setSent(true);
        else setSubmitting(false);
      }
      if (lockRefused && completion.ownScreen()) setSubmitError(lockRefused);
    }
    // A lost answer (network, timeout, server): its key and request are kept for the same send, also once reopened.
    const lost = failure !== null && (!isTakeoffApiError(failure) || failure.status === 408 || failure.status >= 500);
    if (lost) uncertainIntents.set(screen, key);
    else if (response || failure) uncertainIntents.delete(screen);
    if (response) {
      const title = `Plan « ${shownPlan} » envoyé au devis`;
      const description = `${plural(response.lines_written, "ligne écrite", "lignes écrites")}`
        + `${response.version_created ? ", premier brouillon créé" : ""}.`;
      const landing = takeoffItemSendLandingHref(response.version_id,
        { lines_written: response.focus_item_id ? [response.focus_item_id] : [], sections_created: [] });
      if (completion.ownScreen()) {
        router.push(landing);
        toast.success({ title, description });
        onSent?.(response);
      } else {
        // Written while the member was elsewhere: said where they are, with the way to it, without moving them nor touching
        // the screen they left.
        toast.success({ title, description: `${description} Le devis n’a pas été ouvert : vous aviez quitté cet envoi.`,
          action: { label: ITEM_SEND_LANDING_LABEL, href: landing } });
      }
      return;
    }
    if (failure && !completion.ownScreen()) {
      // Refused, or its answer lost, while the member was elsewhere: said where they are.
      const said = isTakeoffApiError(failure) || failure instanceof Error ? failure.message : "L’envoi des postes de ce plan a échoué.";
      toast.error({ title: `Plan « ${shownPlan} » : envoi non confirmé`, description: lost
        ? `${said} La réponse n’est pas arrivée : rouvrez l’envoi de ce plan pour savoir s’il est écrit.` : said });
      return;
    }
    if (!failure || !completion.ownScreen()) return;
    const message = isTakeoffApiError(failure) || failure instanceof Error ? failure.message : "L’envoi des postes de ce plan a échoué.";
    const status = isTakeoffApiError(failure) ? failure.status : 0;
    const guard = guardOf(failure);
    if (lockGuards.has(String(guard)) || status === 408 || status >= 500) {
      // The draft is held, or the answer was lost: the same plan, the same key, « Confirmer » again replays it.
      setSubmitError(message);
      return;
    }
    if (status >= 400 && status < 500) {
      // Refused, nothing written: the preview is read again with the choices that still apply, and what changed is said.
      intent.current = null;
      stale.current = { from: data, dropped: [] };
      setNotice({ text: message, changes: [] });
      update((currentAsk) => currentAsk, true);
      return;
    }
    setSubmitError(message);
  };

  const handleOpenChange = (next: boolean) => {
    if (submitting && !next) return;
    onOpenChange(next);
  };
  const confirmLabel = submitting ? "Envoi…" : data?.destination?.kind === "first_draft"
    ? `Créer le devis et y envoyer « ${shownPlan} »`
    : `Envoyer « ${shownPlan} » dans ${data?.destination_label ?? "le brouillon"}`;
  const disabled = redistributing || submitting;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal={submitting}>
      <DialogContent size="xl" showCloseButton={!submitting}>
        <DialogHeader>
          <DialogTitle>{`Envoyer le plan « ${shownPlan} » au devis`}</DialogTitle>
          <DialogDescription>
            Seuls les postes retenus de ce plan partent ; aucun autre plan n’est coché. Rien n’est écrit dans un devis avant votre
            confirmation, ni version, ni section, ni quantité.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div role="region" aria-label="Aperçu de l’envoi des postes" tabIndex={0}
            className="max-h-[calc(100dvh-15rem)] space-y-4 overflow-y-auto overscroll-contain pr-1">
            {notice ? (
              <Alert variant="warning" data-testid="item-send-notice">
                <p>{notice.text}</p>
                {notice.changes.length > 0 ? (
                  <ul aria-label="Ce qui a changé" className="mt-1 list-disc space-y-0.5 pl-5">
                    {notice.changes.map((change) => <li key={change}>{change}</li>)}
                  </ul>
                ) : null}
              </Alert>
            ) : null}
            {loading ? <Alert variant="info">Calcul de l’aperçu de l’envoi…</Alert> : null}
            {current?.disagree ? (
              <Alert variant="warning" data-testid="item-send-read-disagree">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="min-w-0">
                    Le devis a changé pendant la lecture de l’aperçu : ce que montrent ses pages et ce que ferait l’envoi ne concordent pas.
                    Rien ne peut être confirmé avant une nouvelle lecture.
                  </p>
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => { disagreements.current = 0; update((currentAsk) => currentAsk, true); }}>Relire l’aperçu</Button>
                </div>
              </Alert>
            ) : null}
            {current?.error ? (
              <Alert variant="danger">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="min-w-0">{current.error}</p>
                  <Button type="button" variant="outline" size="sm" onClick={() => update((currentAsk) => currentAsk, true)}>Réessayer</Button>
                </div>
              </Alert>
            ) : null}
            {data && data.plan ? (
              <>
                <ItemSendDestination data={data} disabled={disabled}
                  onChange={(destination) => update((currentAsk) => ({ ...currentAsk, destination, choices: EMPTY_ITEM_SEND_CHOICES }))} />
                <ItemSendBreakdownChoice value={data.breakdown}
                  disabled={disabled || (data.blocked !== null && data.blocked.reason !== "no_line")}
                  onChange={(breakdown) => update((currentAsk) => ({ ...currentAsk, breakdown, destination: data.destination ?? undefined }))} />
              </>
            ) : null}
            {data?.destination?.kind === "existing_draft" && <ItemRedistributionPanel
              key={data.destination.version_id} jobId={jobId} viewerKey={viewerKey} versionId={data.destination.version_id}
              disabled={submitting || sent} onBusyChange={setRedistributing}
              onChanged={() => update((currentAsk) => currentAsk, true)} />}
            {data?.blocked ? <ItemSendBlocked blocked={data.blocked} /> : null}
            {/* « Aucun poste à envoyer » keeps the choices shown: an item left out can be taken back. */}
            {data && (!data.blocked || data.blocked.reason === "no_line") ? (
              <>
                {asked.length + chosen.length + pagePoints.length > 0 ? (
                  <section aria-labelledby="item-send-choices" className="space-y-2">
                    <h3 id="item-send-choices" className="text-sm font-semibold text-foreground">
                      {asked.length + data.to_resolve.filter((point) => point.kind === "page_decision").length > 0
                        ? "Choix à faire avant l’envoi" : "Vos choix"}
                    </h3>
                    {[...asked, ...chosen].map((point) => (
                      <ItemSendPoint key={point.key} point={point} disabled={disabled}
                        choice={ask.choices.resolutions.get(point.key)?.choice ?? null} onChoose={(choice) => choose(point, choice)} />
                    ))}
                    {pagePoints.map((point) => (
                      <ItemSendPageDecision key={point.key} point={point} labels={labels} disabled={disabled}
                        decision={ask.choices.pageDecisions.get(itemSendPageKey(point.page)) ?? null}
                        leftOut={ask.choices.resolutions.get(point.key)?.choice.kind === "leave_out"}
                        invalid={invalidFor(point.page)} onNoteTyping={noteTyping}
                        onFlushNote={(decidedOn, note) => flushNote(point.page, decidedOn, note)}
                        onDecide={(decision) => decidePage(point, decision)}
                        onLeaveOut={(leave) => choose(point, leave ? { kind: "leave_out" } : null)} />
                    ))}
                  </section>
                ) : null}
                {invalidElsewhere.map((entry) => <Alert key={`${entry.page}-${entry.reason}`} variant="danger">{entry.message}</Alert>)}
                <ItemSendSectionsCreated sections={data.sections} />
                <ItemSendLines lines={data.lines} />
                <ItemSendNotSent data={data} labels={labels} />
                <ItemSendRules rules={data.rules} />
              </>
            ) : null}
          </div>
          {submitError ? <Alert variant="danger" className="mt-3" data-testid="item-send-error">{submitError}</Alert> : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>Annuler</Button>
          <Button onClick={() => void confirm()} disabled={!confirmable}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
