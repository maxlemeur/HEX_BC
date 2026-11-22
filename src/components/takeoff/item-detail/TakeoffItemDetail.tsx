"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowLeft, ListTree } from "lucide-react";

import { ItemDetailEvidencePane } from "@/components/takeoff/item-detail/ItemDetailEvidencePane";
import {
  ItemDetailPlanPane,
  type ItemDetailDocumentState,
  type ItemDetailPlanResolution,
} from "@/components/takeoff/item-detail/ItemDetailPlanPane";
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
  itemDetailChoiceAddress,
  itemDetailOpeningPage,
  itemDetailPagesOfInterest,
  type ItemDetailLine,
  type ItemDetailLineRead,
  type ItemDetailPlanChoice,
} from "@/lib/takeoff/item-detail";
import { isItemDetailFieldTarget, itemDetailKeyAction, type ItemDetailKeyGesture } from "@/lib/takeoff/item-detail-keys";
import {
  ITEM_DETAIL_GESTURE_LABELS,
  itemDetailIneligibilityLabel,
  itemDetailPlanErrorLabel,
} from "@/lib/takeoff/item-detail-labels";
import { ITEM_STATE_LABELS, formatItemQuantity } from "@/lib/takeoff/item-table-labels";

/**
 * The detail of an item on its plan (lot 5, second depth of the review): in the same review space as the table, the
 * item's result on its plan in the centre, the frozen filtered queue of the table on the left, the evidence, state,
 * source, decisions and history on the right. It opens a measured item, an answer without a quantity (« not found »,
 * with the pages searched and no point), and an item never measured (« À mesurer », the plan resolved from the dossier).
 *
 * The address is the state. A move inside replaces it in place (`history.replaceState`, which the router follows: no
 * history entry per arrow), naming what is shown so that every address written parses and opens the same view again; the
 * way back gives the table's address with the item shown in focus (`onBack`). The keyboard of the list may ask for a
 * review gesture (`onGesture`); its confirmation and its command are the table's, and the server decides them again.
 *
 * Everything the detail shows belongs to its reader, one per member and affaire: a new reader starts from nothing.
 */

export type ItemDetailGestureRequest = { gesture: ItemDetailKeyGesture; line: ItemDetailLine; initial: string | null };

type Props = {
  projectId: string;
  address: ItemDetailAddress;
  reader: ItemDetailReader;
  /** The query of the page (the table's parameters and the page's own), kept by every move and by the way back. */
  tableQuery: string;
  onBack: (href: string) => void;
  onGesture?: (request: ItemDetailGestureRequest) => void;
  /** Called once the address was replaced in place, for a parent that does not follow the router's search parameters. */
  onAddressChange?: (href: string) => void;
  /**
   * A read of the affaire refused (the table's, a plan's resolution, the journal): the page withdraws the detail, as the
   * table withdraws itself. Returns whether it was a refusal.
   */
  onRefused?: (caught: unknown) => boolean;
  /** Changes after a decision of the page on the item shown: its line and its journal are read again, nothing moves. */
  version?: number;
};

type Load = { state: "loading" } | { state: "ready" } | { state: "missing" } | { state: "error" };
type Outside = ItemDetailLineRead;

const readers = new WeakMap<ItemDetailReader, number>();
const identities = { next: 0 };
/** The identity of a reader: the detail is rebuilt from nothing for another one. */
function readerIdentity(reader: ItemDetailReader) {
  const known = readers.get(reader);
  if (known !== undefined) return known;
  identities.next += 1;
  readers.set(reader, identities.next);
  return identities.next;
}

export function TakeoffItemDetail(props: Props) {
  return <ItemDetailView key={readerIdentity(props.reader)} {...props} />;
}

const choiceKey = (choice: ItemDetailPlanChoice) => (choice.kind === "reading" ? `r:${choice.jobId}:${choice.planKey}`
  : choice.kind === "dossier" ? `d:${choice.planKey}` : choice.kind === "source" ? `s:${choice.documentId}:${choice.generation ?? ""}`
    : choice.kind);

function planRequest(choice: ItemDetailPlanChoice): ItemDetailPlanRequest | null {
  switch (choice.kind) {
    case "reading": return { planKey: choice.planKey, jobId: choice.jobId, source: null };
    case "dossier": return { planKey: choice.planKey, jobId: null, source: null };
    case "source": return { planKey: null, jobId: null, source: { documentId: choice.documentId, generation: choice.generation } };
    default: return null;
  }
}

const neverRefused = () => false;

function ItemDetailView({ projectId, address, reader, tableQuery, onBack, onGesture, onAddressChange, onRefused = neverRefused,
  version = 0 }: Props) {
  const queue = useMemo(() => new ItemDetailQueue(), []);
  const [revision, setRevision] = useState(0);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [outside, setOutside] = useState<Outside | null>(null);
  /** The table's page read with the item asked: the queue shown beside an item outside the filter. */
  const [anchor, setAnchor] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [panels, setPanels] = useState({ queue: false, evidence: false });
  const [focusEvidence, setFocusEvidence] = useState(false);
  const [documentState, setDocumentState] = useState<ItemDetailDocumentState>(null);
  const list = useRef<HTMLUListElement>(null);
  const evidence = useRef<HTMLHeadingElement>(null);
  /** Changes with each navigation the member asks for: a move still waiting for a page does not act after another. */
  const navigation = useRef(0);

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
      setAnchor(page.page.offset);
      if (page.page.focusFound && queue.find(itemId)) {
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
    }).catch((caught: unknown) => {
      if (!active) return;
      if (!onRefused(caught)) setLoad({ state: "error" });
    });
    return () => {
      active = false;
    };
    // `outside` is read, not followed: an item shown outside the filter is not read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, queue, reader]);

  // After a decision of the page, the item shown is read again alone and replaces its line where it stands: the queue's
  // order and the page shown do not move.
  const [refreshed, setRefreshed] = useState<{ version: number; line: ItemDetailLine } | null>(null);
  useEffect(() => {
    if (version === 0) return;
    let active = true;
    void reader.readLine(itemId).then((read) => {
      if (active && read) setRefreshed({ version, line: read.line });
    }).catch((caught: unknown) => {
      if (active) onRefused(caught);
    });
    return () => {
      active = false;
    };
    // The item is read again when the page says it changed, not when another item is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  const read = found?.page.page.lines[found.index] ?? (outside?.line.itemId === itemId ? outside.line : null);
  const line = refreshed && refreshed.line.itemId === itemId ? refreshed.line : read;
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
  // A plan is resolved again each time it is opened (another plan, reading or piece), never for a page turned or an item
  // shown on the same plan: the request is read when the plan changes, not followed.
  const key = choiceKey(choice);
  const request = useRef<ItemDetailPlanRequest | null>(null);
  request.current = planRequest(choice);
  // The page's latest handler of a refusal, without resolving the plan again when it changes.
  const planRefused = useEffectEvent((failure: ItemDetailPlanError) => onRefused(failure));
  const [resolved, setResolved] = useState<{ key: string; resolution: ItemDetailPlanResolution }>({ key: "", resolution: { state: "none" } });
  useEffect(() => {
    const asked = request.current;
    if (!asked) {
      setResolved({ key, resolution: { state: "none" } });
      return;
    }
    let active = true;
    setResolved({ key, resolution: { state: "loading" } });
    reader.resolvePlan(asked).then((view) => {
      if (active) setResolved({ key, resolution: { state: "ready", view } });
    }).catch((error: unknown) => {
      if (!active) return;
      const failure = error instanceof ItemDetailPlanError ? error : new ItemDetailPlanError(null, null);
      // The affaire itself refused (rights, session, the affaire gone): the page withdraws the detail.
      if (failure.status === 401 || failure.status === 403 || (failure.status === 404 && failure.code === "NOT_FOUND")) {
        planRefused(failure);
        return;
      }
      setResolved({ key, resolution: { state: "error", message: itemDetailPlanErrorLabel(failure.code, failure.status) } });
    });
    return () => {
      active = false;
    };
  }, [key, reader]);
  const resolution: ItemDetailPlanResolution = resolved.key === key ? resolved.resolution
    : request.current ? { state: "loading" } : { state: "none" };
  const view = resolution.state === "ready" ? resolution.view : null;
  const answer = choice.kind === "reading" && choice.current ? choice.reading.answer : null;
  const opening = itemDetailOpeningPage({ requested: address.page, answer, pagesRead: view?.plan.pagesRead ?? [],
    pageCount: view?.plan.pageCount ?? null, observationId: choice.kind === "reading" ? choice.observationId : null });
  const pagesOfInterest = itemDetailPagesOfInterest(answer, view?.plan.pagesRead ?? []);

  // The address the detail shows now: a move still waiting for a page does not act once another address arrived (the
  // member's, the router's or the page's).
  const shownAddress = itemDetailHref(projectId, address, tableQuery);
  const latestAddress = useRef(shownAddress);
  latestAddress.current = shownAddress;
  const replaceAddress = useCallback((next: ItemDetailAddress) => {
    const href = itemDetailHref(projectId, next, tableQuery);
    // A state of its own (not the router's): Next then follows the address (`useSearchParams`) without a navigation. A
    // move still waiting for a page is dropped once the member went back (`navigation`), so it never meets one under way.
    window.history.replaceState(null, "", href);
    onAddressChange?.(href);
  }, [onAddressChange, projectId, tableQuery]);
  /** A view of the item shown: what the centre shows is named, so that the address parses and reopens it. */
  const go = useCallback((next: Partial<ItemDetailAddress>) => {
    navigation.current += 1;
    replaceAddress({ ...address, ...itemDetailChoiceAddress(choice), ...next });
  }, [address, choice, replaceAddress]);
  const openItem = useCallback((nextItemId: string) => {
    navigation.current += 1;
    replaceAddress({ itemId: nextItemId, planKey: null, jobId: null, page: null, source: null, answerId: null, observationId: null,
      versionId: address.versionId });
  }, [address.versionId, replaceAddress]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const move = useCallback(async (step: -1 | 1) => {
    const asked = navigation.current;
    const from = latestAddress.current;
    let next = queue.neighbour(itemId, step);
    if (!next && !queue.find(itemId) && step > 0) {
      // From an item outside the filter, down leads into the queue.
      const first = context?.page.lines[0]?.itemId ?? null;
      if (first) next = { itemId: first };
    }
    if (next && "offset" in next) {
      try {
        const page = await reader.readQueue({ kind: "page", offset: next.offset });
        // The member went back or elsewhere meanwhile, or another address arrived: the move is dropped.
        if (!mounted.current || navigation.current !== asked || latestAddress.current !== from) return;
        queue.add(page);
        setRevision((value) => value + 1);
      } catch {
        if (mounted.current && navigation.current === asked) setNotice("La page suivante des postes n’a pas pu être lue.");
        return;
      }
      next = queue.neighbour(itemId, step);
    }
    if (next && "itemId" in next) openItem(next.itemId);
    else setNotice(step > 0 ? "Dernier poste de la sélection." : "Premier poste de la sélection.");
  }, [context, itemId, openItem, queue, reader]);

  const back = useCallback(() => {
    navigation.current += 1;
    const index = position?.index ?? null;
    onBack(itemTableReturnHref(projectId, tableQuery, index === null ? { itemId, offset: 0 }
      : { itemId, offset: itemTablePageOffset(index, context?.page.limit ?? 0) }));
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
      shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing },
    isItemDetailFieldTarget(event.target) && event.target !== event.currentTarget);
    if (!action) return;
    event.preventDefault();
    if (action.kind === "move") void move(action.step);
    else if (action.kind === "evidence") {
      // On a narrow screen the evidence panel is shown first; the focus follows once it is rendered.
      setPanels((value) => ({ ...value, evidence: true }));
      setFocusEvidence(true);
    } else if (action.kind === "back") back();
    else gesture(action.gesture, action.initial);
  };
  useEffect(() => {
    if (!focusEvidence || !panels.evidence) return;
    setFocusEvidence(false);
    evidence.current?.focus();
  }, [focusEvidence, panels.evidence]);

  // The list takes the keyboard when the detail opens, and keeps it as the item changes.
  useEffect(() => {
    if (load.state === "ready") list.current?.focus({ preventScroll: true });
  }, [load.state]);

  // The queue as read so far (`revision` follows its pages), the item outside the filter first.
  const shownLines = revision >= 0 ? [...(outside && outside.line.itemId === itemId && !found ? [outside.line] : []), ...(context?.page.lines ?? [])] : [];

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
        {notice || (line ? `${line.label} : ${ITEM_STATE_LABELS[line.state]}` : "")}
      </p>
      {notice ? <p className="shrink-0 border-b border-border bg-surface px-3 py-1 text-xs text-foreground-secondary" data-testid="poste-detail-notice">{notice}</p> : null}

      {load.state === "missing" ? (
        <div className="p-4"><Alert variant="danger">Ce poste est introuvable dans la liste de l’affaire.</Alert></div>
      ) : load.state === "error" ? (
        <div className="p-4"><Alert variant="danger">Les postes du métré n’ont pas pu être lus. Revenez aux postes puis réessayez.</Alert></div>
      ) : choice.kind === "mismatch" ? (
        <div className="p-4"><Alert variant="danger">Ce lien ne désigne pas une lecture de ce poste.</Alert></div>
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
                    <span>{ITEM_STATE_LABELS[entry.state]}{entry === outside?.line ? " · hors du filtre" : ""}</span>
                    <span className="font-mono tabular-nums">{entry.observed ? formatItemQuantity(entry.observed.quantity, entry.observed.unit) : "—"}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="shrink-0 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              ↑ ↓ poste · Entrée preuve · Échap tableau{canReview ? " · V accepter · E écarter · I inclure · F2 saisir" : ""}
            </p>
          </aside>
          <ItemDetailPlanPane resolution={line ? resolution : { state: "loading" }} page={opening.page} requestedMissing={opening.requestedMissing}
            pagesOfInterest={pagesOfInterest} onPage={(page) => go({ page, observationId: null })} onDocumentState={setDocumentState}
            emptyMessage="Aucun plan n’est associé à ce poste pour le moment." />
          <div data-testid="poste-detail-evidence-panel" data-narrow-collapsed={String(!panels.evidence)}
            className={cn("w-[24rem] shrink-0 border-l border-border max-lg:w-full max-lg:border-l-0 max-lg:border-t", !panels.evidence && "max-lg:hidden")}>
            {line ? (
              <ItemDetailEvidencePane ref={evidence} projectId={projectId} line={line} choice={choice} plan={view}
                documentState={documentState} names={names} planNames={planNames} outsideFilter={!found && outside !== null}
                historyVersion={version} onRefused={onRefused}
                decide={{ canReview: canReview && Boolean(onGesture), onGesture: (requested) => gesture(requested, null) }}
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
