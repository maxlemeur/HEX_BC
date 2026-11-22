"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowLeft, ListTree } from "lucide-react";

import { ItemDetailEvidencePane } from "@/components/takeoff/item-detail/ItemDetailEvidencePane";
import { ItemDetailPlanPane, type ItemDetailPlanResolution } from "@/components/takeoff/item-detail/ItemDetailPlanPane";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { itemDetailHref, itemTablePageOffset, itemTableReturnHref, type ItemDetailAddress } from "@/lib/takeoff/item-detail-address";
import { ItemDetailPlanError, type ItemDetailReader } from "@/lib/takeoff/item-detail-client";
import type { ItemDetailPlanRequest } from "@/lib/takeoff/item-detail-contracts";
import {
  ItemDetailQueue,
  chooseItemDetailPlan,
  itemDetailOpeningPage,
  itemDetailPagesOfInterest,
  type ItemDetailLine,
  type ItemDetailPlanChoice,
} from "@/lib/takeoff/item-detail";
import { isItemDetailFieldTarget, itemDetailKeyAction, type ItemDetailKeyGesture } from "@/lib/takeoff/item-detail-keys";
import {
  ITEM_DETAIL_GESTURE_LABELS,
  ITEM_DETAIL_STATE_LABELS,
  formatItemDetailQuantity,
  itemDetailIneligibilityLabel,
  itemDetailPlanErrorLabel,
} from "@/lib/takeoff/item-detail-labels";

/**
 * The detail of an item on its plan (lot 5, second depth of the review): in the same review space as the table, the
 * item's result on its plan in the centre, the frozen filtered queue of the table on the left, the evidence, state,
 * source, decisions and history on the right. It opens a measured item, an answer without a quantity (« not found »,
 * with the pages searched and no point), and an item never measured (« À mesurer », the plan resolved from the dossier).
 *
 * The address is the state: a move inside replaces it (`onNavigate`, no history entry per arrow), the way back gives the
 * table's address with the item shown in focus (`onBack`). The keyboard of the list may ask for a review gesture
 * (`onGesture`); the gesture's own confirmation and its command are the table's, and the server decides them again.
 */

export type ItemDetailGestureRequest = { gesture: ItemDetailKeyGesture; line: ItemDetailLine; initial: string | null };

type Props = {
  projectId: string;
  address: ItemDetailAddress;
  reader: ItemDetailReader;
  /** The query of the page (the table's parameters and the page's own), kept by every move and by the way back. */
  tableQuery: string;
  onNavigate: (href: string) => void;
  onBack: (href: string) => void;
  onGesture?: (request: ItemDetailGestureRequest) => void;
};

type Load = { state: "loading" } | { state: "ready" } | { state: "missing" } | { state: "error" };
type Outside = { line: ItemDetailLine; names: Record<string, string>; canReview: boolean };

const choiceKey = (choice: ItemDetailPlanChoice) => (choice.kind === "reading" ? `r:${choice.jobId}:${choice.planKey}`
  : choice.kind === "dossier" ? `d:${choice.planKey}` : choice.kind === "source" ? `s:${choice.documentId}:${choice.generation ?? ""}` : "none");

function planRequest(choice: ItemDetailPlanChoice): ItemDetailPlanRequest | null {
  switch (choice.kind) {
    case "reading": return { planKey: choice.planKey, jobId: choice.jobId, source: null };
    case "dossier": return { planKey: choice.planKey, jobId: null, source: null };
    case "source": return { planKey: null, jobId: null, source: { documentId: choice.documentId, generation: choice.generation } };
    default: return null;
  }
}

export function TakeoffItemDetail({ projectId, address, reader, tableQuery, onNavigate, onBack, onGesture }: Props) {
  const queue = useMemo(() => new ItemDetailQueue(), []);
  const [revision, setRevision] = useState(0);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [outside, setOutside] = useState<Outside | null>(null);
  /** The table's page read with the item asked: the queue shown beside an item outside the filter. */
  const [anchor, setAnchor] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [panels, setPanels] = useState({ queue: false, evidence: false });
  const list = useRef<HTMLUListElement>(null);
  const evidence = useRef<HTMLHeadingElement>(null);

  // The queue: the table's page that holds the item, as the table filtered it; an item outside the filter (a link of the
  // radar) is read alone and shown beside it. Read once per item not yet in the queue.
  const itemId = address.itemId;
  const found = queue.find(itemId);
  useEffect(() => {
    if (queue.find(itemId) || outside?.line.itemId === itemId) return;
    let active = true;
    setLoad({ state: "loading" });
    void reader.readQueue({ kind: "focus", itemId }).then(async (page) => {
      if (!active) return;
      queue.add(page);
      setAnchor(page.offset);
      if (page.focusFound && queue.find(itemId)) {
        setOutside(null);
        setLoad({ state: "ready" });
        setRevision((value) => value + 1);
        return;
      }
      const alone = await reader.readLine(itemId);
      if (!active) return;
      setOutside(alone);
      setLoad({ state: alone ? "ready" : "missing" });
      setRevision((value) => value + 1);
    }).catch(() => active && setLoad({ state: "error" }));
    return () => {
      active = false;
    };
    // `outside` is read, not followed: an item shown outside the filter is not read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, queue, reader]);

  const line = found?.page.lines[found.index] ?? (outside?.line.itemId === itemId ? outside.line : null);
  const context = found?.page ?? (anchor !== null ? queue.page(anchor) : null);
  const canReview = found ? found.page.canReview : outside?.canReview ?? false;
  // A notice belongs to the item it was said for.
  const [noticeFor, setNoticeFor] = useState(itemId);
  if (noticeFor !== itemId) {
    setNoticeFor(itemId);
    setNotice("");
  }
  const names = useMemo(() => ({ ...(context?.names ?? {}), ...(outside?.names ?? {}) }), [context, outside]);
  const planNames = useMemo(() => Object.fromEntries((context?.plans ?? []).map(({ key, name }) => [key, name])), [context]);
  const position = queue.position(itemId);

  const choice = useMemo<ItemDetailPlanChoice>(() => (line ? chooseItemDetailPlan(line, address) : { kind: "none" }), [line, address]);
  const request = useMemo(() => planRequest(choice), [choice]);
  const [resolved, setResolved] = useState<{ key: string; resolution: ItemDetailPlanResolution }>({ key: "", resolution: { state: "none" } });
  const key = choiceKey(choice);
  useEffect(() => {
    if (!request) {
      setResolved({ key, resolution: { state: "none" } });
      return;
    }
    let active = true;
    setResolved({ key, resolution: { state: "loading" } });
    reader.resolvePlan(request).then((view) => {
      if (active) setResolved({ key, resolution: { state: "ready", view } });
    }).catch((error: unknown) => {
      if (!active) return;
      const failure = error instanceof ItemDetailPlanError ? error : new ItemDetailPlanError(null, null);
      setResolved({ key, resolution: { state: "error", message: itemDetailPlanErrorLabel(failure.code, failure.status) } });
    });
    return () => {
      active = false;
    };
  }, [key, request, reader]);
  const resolution: ItemDetailPlanResolution = resolved.key === key ? resolved.resolution : request ? { state: "loading" } : { state: "none" };
  const view = resolution.state === "ready" ? resolution.view : null;
  const answer = choice.kind === "reading" && choice.current ? choice.reading.answer : null;
  const opening = itemDetailOpeningPage({ requested: address.page, answer, pagesRead: view?.plan.pagesRead ?? [],
    pageCount: view?.plan.pageCount ?? null });
  const pagesOfInterest = itemDetailPagesOfInterest(answer, view?.plan.pagesRead ?? []);

  const go = useCallback((next: Partial<ItemDetailAddress>) => {
    onNavigate(itemDetailHref(projectId, { ...address, ...next }, tableQuery));
  }, [address, onNavigate, projectId, tableQuery]);
  const openItem = useCallback((nextItemId: string) => {
    onNavigate(itemDetailHref(projectId, { itemId: nextItemId, planKey: null, jobId: null, page: null, source: null, answerId: null,
      observationId: null, versionId: address.versionId }, tableQuery));
  }, [address.versionId, onNavigate, projectId, tableQuery]);

  const move = useCallback(async (step: -1 | 1) => {
    let next = queue.neighbour(itemId, step);
    if (!next && !queue.find(itemId) && step > 0) {
      // From an item outside the filter, down leads into the queue.
      const first = context?.lines[0]?.itemId ?? null;
      if (first) next = { itemId: first };
    }
    if (next && "offset" in next) {
      try {
        queue.add(await reader.readQueue({ kind: "page", offset: next.offset }));
        setRevision((value) => value + 1);
      } catch {
        setNotice("La page suivante des postes n’a pas pu être lue.");
        return;
      }
      next = queue.neighbour(itemId, step);
    }
    if (next && "itemId" in next) openItem(next.itemId);
    else setNotice(step > 0 ? "Dernier poste de la sélection." : "Premier poste de la sélection.");
  }, [context, itemId, openItem, queue, reader]);

  const back = useCallback(() => {
    const index = position?.index ?? null;
    onBack(itemTableReturnHref(projectId, tableQuery, index === null ? { itemId, offset: 0 }
      : { itemId, offset: itemTablePageOffset(index, context?.limit ?? 0) }));
  }, [context, itemId, onBack, position, projectId, tableQuery]);

  const gesture = useCallback((requested: ItemDetailKeyGesture, initial: string | null) => {
    if (!line) return;
    const label = ITEM_DETAIL_GESTURE_LABELS[requested];
    if (!canReview || !onGesture) {
      setNotice("Un opérateur du métré de l’affaire peut revoir ce poste.");
      return;
    }
    const eligibility = line.eligibility[requested];
    if (!eligibility.eligible) {
      setNotice(`« ${label} » ne s’applique pas à ce poste : ${itemDetailIneligibilityLabel(eligibility.reason)}.`);
      return;
    }
    onGesture({ gesture: requested, line, initial });
  }, [canReview, line, onGesture]);

  const onListKey = (event: ReactKeyboardEvent<HTMLUListElement>) => {
    const action = itemDetailKeyAction({ key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey,
      isComposing: event.nativeEvent.isComposing }, isItemDetailFieldTarget(event.target) && event.target !== event.currentTarget);
    if (!action) return;
    event.preventDefault();
    if (action.kind === "move") void move(action.step);
    else if (action.kind === "evidence") {
      setPanels((value) => ({ ...value, evidence: true }));
      evidence.current?.focus();
    } else if (action.kind === "back") back();
    else gesture(action.gesture, action.initial);
  };

  // The list takes the keyboard when the detail opens, and keeps it as the item changes.
  useEffect(() => {
    if (load.state === "ready") list.current?.focus({ preventScroll: true });
  }, [load.state]);

  // The queue as read so far (`revision` follows its pages), the item outside the filter first.
  const shownLines = revision >= 0 ? [...(outside && outside.line.itemId === itemId && !found ? [outside.line] : []), ...(context?.lines ?? [])] : [];

  return (
    <div className="flex min-h-[36rem] flex-col rounded-lg border border-border bg-surface-subtle" data-testid="poste-detail">
      <header className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-1.5">
        <Button size="xs" variant="outline" onClick={back}><ArrowLeft className="mr-1 size-4" />Revenir aux postes</Button>
        <h1 className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold text-foreground">
          <ListTree aria-hidden="true" className="size-4 text-primary" />Détail du poste
        </h1>
        {position ? <span className="text-xs text-muted-foreground">Poste {position.index + 1} sur {position.total}</span> : null}
        <div className="ml-auto flex gap-1 lg:hidden">
          <Button size="xs" variant="ghost" aria-expanded={panels.queue} onClick={() => setPanels((value) => ({ ...value, queue: !value.queue }))}>Postes</Button>
          <Button size="xs" variant="ghost" aria-expanded={panels.evidence} onClick={() => setPanels((value) => ({ ...value, evidence: !value.evidence }))}>Preuve</Button>
        </div>
      </header>
      <p role="status" aria-live="polite" className="sr-only">
        {notice || (line ? `${line.label} : ${ITEM_DETAIL_STATE_LABELS[line.state]}` : "")}
      </p>
      {notice ? <p className="shrink-0 border-b border-border bg-surface px-3 py-1 text-xs text-foreground-secondary" data-testid="poste-detail-notice">{notice}</p> : null}

      {load.state === "missing" ? (
        <div className="p-4"><Alert variant="danger">Ce poste est introuvable dans la liste de l’affaire.</Alert></div>
      ) : load.state === "error" ? (
        <div className="p-4"><Alert variant="danger">Les postes du métré n’ont pas pu être lus. Revenez aux postes puis réessayez.</Alert></div>
      ) : (
        <div className="flex min-h-0 flex-1 max-lg:flex-col">
          <aside aria-label="Postes de la sélection" className={cn("flex w-72 shrink-0 flex-col border-r border-border bg-surface max-lg:w-full max-lg:border-b max-lg:border-r-0",
            !panels.queue && "max-lg:hidden")}>
            {load.state === "loading" ? (
              <p className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground"><Spinner aria-label="Chargement" />Chargement des postes…</p>
            ) : null}
            <ul ref={list} role="listbox" aria-label="Postes" tabIndex={0} onKeyDown={onListKey}
              aria-keyshortcuts="ArrowUp ArrowDown Enter Escape V E I F2" aria-activedescendant={line ? `poste-detail-${line.itemId}` : undefined}
              className="min-h-0 flex-1 divide-y divide-border-subtle overflow-y-auto focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring max-lg:max-h-64">
              {shownLines.map((entry) => (
                <li key={entry.itemId} id={`poste-detail-${entry.itemId}`} role="option" aria-selected={entry.itemId === itemId}
                  className={cn("cursor-pointer px-3 py-2 text-xs", entry.itemId === itemId ? "bg-primary/10" : "hover:bg-surface-subtle")}
                  onClick={() => { if (entry.itemId !== itemId) openItem(entry.itemId); list.current?.focus(); }}>
                  <span className="block truncate text-sm font-medium text-foreground" title={entry.label}>{entry.label}</span>
                  <span className="flex items-center justify-between gap-2 text-muted-foreground">
                    <span>{ITEM_DETAIL_STATE_LABELS[entry.state]}{entry === outside?.line ? " · hors du filtre" : ""}</span>
                    <span className="font-mono tabular-nums">{entry.observed ? formatItemDetailQuantity(entry.observed.quantity, entry.observed.unit) : "—"}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="shrink-0 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              ↑ ↓ poste · Entrée preuve · Échap tableau{canReview ? " · V accepter · E écarter · I inclure · F2 saisir" : ""}
            </p>
          </aside>
          <ItemDetailPlanPane resolution={line ? resolution : { state: "loading" }} page={opening.page} requestedMissing={opening.requestedMissing}
            pagesOfInterest={pagesOfInterest} onPage={(page) => go({ page })} dossierUrl={reader.dossierUrl}
            emptyMessage="Aucun plan n’est associé à ce poste pour le moment." />
          <div className={cn("w-[24rem] shrink-0 border-l border-border max-lg:w-full max-lg:border-l-0 max-lg:border-t", !panels.evidence && "max-lg:hidden")}>
            {line ? (
              <ItemDetailEvidencePane ref={evidence} line={line} choice={choice} plan={view} names={names} planNames={planNames} page={opening.page}
                outsideFilter={!found && outside !== null}
                onObservation={(observation) => go({ page: observation.page, observationId: observation.observationId,
                  answerId: answer?.answerId ?? null })}
                onPlan={(planKey, jobId) => go({ planKey, jobId, page: null, source: null, answerId: null, observationId: null })} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
