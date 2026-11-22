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

type Props = {
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
  return <TakeoffItemSendScreen key={`${props.viewerKey}:${props.jobId}`} {...props} />;
}

const lockGuards = new Set(["item_send_draft_locked", "item_send_draft_lock_required"]);
const guardOf = (error: unknown) => (isTakeoffApiError(error) && error.details && typeof error.details === "object"
  ? (error.details as { guard?: unknown }).guard : undefined);

function TakeoffItemSendScreen({ open, jobId, planName, viewerKey, onOpenChange, onSent }: Props) {
  const toast = useToast();
  const router = useRouter();
  const [ask, setAsk] = useState<Ask>({ choices: EMPTY_ITEM_SEND_CHOICES, read: 0 });
  const [preview, setPreview] = useState<{ read: number; data: Preview | null; error: string | null } | null>(null);
  const [heldPoints, setHeldPoints] = useState<ReadonlyMap<string, Point>>(new Map());
  const [notice, setNotice] = useState<Notice | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  // One intention key per plan confirmed: a retry of the same plan replays its receipt, another plan gets a new key.
  const intent = useRef<{ digest: string; id: string } | null>(null);
  // A preview found stale: the one shown before it, and the choices dropped since, said with the next one.
  const stale = useRef<{ from: Preview; dropped: string[] } | null>(null);
  const screen = `${viewerKey}:${jobId}`;
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
    void previewTakeoffItemSend(jobId, itemSendRequestOf(ask), { signal: controller.signal }).then((data) => {
      if (!completion.current()) return;
      // The choices the new preview still applies; a dropped one is said, and the preview read again without it.
      const { choices, dropped } = reconcileItemSendChoices(ask.choices, data);
      if (dropped.length > 0) {
        if (stale.current) stale.current.dropped.push(...dropped);
        else setNotice({ text: "Certains choix ne s’appliquent plus.", changes: dropped });
        setAsk((current) => (current.read === read ? { ...current, choices, read: read + 1 } : current));
        return;
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
    && !submitting && !loading;

  const confirm = async () => {
    if (!data || !confirmable || !data.plan_digest || pending.current) return;
    pending.current = true;
    setSubmitting(true);
    setSubmitError(null);
    const digest = data.plan_digest;
    if (intent.current?.digest !== digest) intent.current = { digest, id: crypto.randomUUID() };
    const completion = start({ screen, item: String(ask.read) });
    const lockVersionId = data.destination?.kind === "existing_draft" ? data.destination.version_id : null;
    let release = false;
    let response: ItemSendConfirmResponse | null = null;
    let failure: unknown = null;
    let lockRefused: string | null = null;
    try {
      if (lockVersionId) {
        const lock = await ensureTakeoffApplyDraftLock(lockVersionId);
        if (!lock.acquired) {
          lockRefused = `${lock.errorMessage ?? "Le brouillon est verrouillé."} L’envoi y sera possible quand ce brouillon sera libéré. `
            + "Rien n’a été écrit.";
          return;
        }
        release = lock.shouldRelease;
      }
      response = await confirmTakeoffItemSend(jobId, { ...itemSendRequestOf({ ...ask, destination: data.destination ?? undefined,
        breakdown: data.breakdown }), request_id: intent.current.id, plan_digest: digest });
    } catch (error) {
      failure = error;
    } finally {
      if (release && lockVersionId) await releaseEstimateDraftLock(lockVersionId).catch(() => false);
      pending.current = false;
      if (completion.ownScreen()) setSubmitting(false);
      if (lockRefused && completion.ownScreen()) setSubmitError(lockRefused);
    }
    if (response) {
      toast.success({ title: `Plan « ${shownPlan} » envoyé au devis`,
        description: `${plural(response.lines_written, "ligne écrite", "lignes écrites")}${response.version_created ? ", premier brouillon créé" : ""}.` });
      onSent?.(response);
      if (completion.ownScreen()) {
        router.push(takeoffItemSendLandingHref(response.version_id,
          { lines_written: response.focus_item_id ? [response.focus_item_id] : [], sections_created: [] }));
      }
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
  const disabled = submitting;

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
                <ItemSendBreakdownChoice value={data.breakdown} disabled={disabled || data.blocked !== null}
                  onChange={(breakdown) => update((currentAsk) => ({ ...currentAsk, breakdown, destination: data.destination ?? undefined }))} />
              </>
            ) : null}
            {data?.blocked ? <ItemSendBlocked blocked={data.blocked} /> : null}
            {data && !data.blocked ? (
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
                        invalid={invalidFor(point.page)}
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
