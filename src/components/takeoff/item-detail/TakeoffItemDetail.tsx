"use client";

import useSWR from "swr";
import { fetchMeasureReview } from "@/lib/takeoff/item-table-client";
import { MeasureRetention } from "./MeasureRetention";
import type { ItemQuantityChoice } from "@/lib/takeoff/item-table";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowLeft, ListTree } from "lucide-react";

import { RevisionPanel } from "@/components/takeoff/contribution-revision/RevisionPanel";
import { useContributionRevisions } from "@/components/takeoff/contribution-revision/useContributionRevisions";
import { useRevisionMarksReader } from "@/components/takeoff/contribution-revision/useRevisionMarksReader";
import { CountMarksLayer } from "@/components/takeoff/count-marks/CountMarksLayer";
import { CountMarksPanel } from "@/components/takeoff/count-marks/CountMarksPanel";
import { CountMarksScope, type CountMarksAnswer } from "@/components/takeoff/count-marks/CountMarksScope";
import { CountMarksTools } from "@/components/takeoff/count-marks/CountMarksTools";
import { MeasureItemOnPlan } from "./MeasureItemOnPlan";
import { ItemDetailEvidencePane } from "@/components/takeoff/item-detail/ItemDetailEvidencePane";
import { isRightRefusal, useCompletions } from "@/components/takeoff/item-detail/useCompletions";
import {
  ItemDetailPlanPane,
  type ItemDetailDocumentState,
  type ItemDetailPlanResolution,
} from "@/components/takeoff/item-detail/ItemDetailPlanPane";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { itemDetailHref, itemTablePageOffset, itemTableReturnHref, type ItemDetailAddress } from "@/lib/takeoff/item-detail-address";
import { ItemDetailPlanError, type ItemDetailReader } from "@/lib/takeoff/item-detail-client";
import type { ItemDetailPlanRequest } from "@/lib/takeoff/item-detail-contracts";
import {
  ItemDetailQueue,
  chooseItemDetailPlan,
  itemDetailChoiceAddress,
  itemDetailGestureOffer,
  itemDetailOpeningPage,
  itemDetailPagesOfInterest,
  type ItemDetailLine,
  type ItemDetailLineRead,
  type ItemDetailOfferedGesture,
  type ItemDetailPlanChoice,
} from "@/lib/takeoff/item-detail";
import { isItemDetailFieldTarget, itemDetailKeyAction, type ItemDetailKeyGesture } from "@/lib/takeoff/item-detail-keys";
import { itemDetailGestureRefusalLabel, itemDetailPlanErrorLabel } from "@/lib/takeoff/item-detail-labels";
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

/** A gesture asked on what the detail shows (`key`: the item and the reading shown when it was asked). */
export type ItemDetailGestureRequest = { quantityChoice?: ItemQuantityChoice; gesture: ItemDetailKeyGesture; line: ItemDetailLine; initial: string | null; key: string };

/**
 * What the detail shows, for the page that confirms its gestures: the item and its reading (`key`), the item's line as
 * last read, and the gestures the one rule offers on it now. Null while nothing of an item is shown.
 */
export type ItemDetailShown = { key: string; line: ItemDetailLine; offered: readonly ItemDetailOfferedGesture[] };

const OFFERED_GESTURES = ["accept_measured", "set_aside", "enter_quantity", "include_entry"] as const satisfies readonly ItemDetailOfferedGesture[];

type Props = {
  viewerKey?: string;
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
  /**
   * Changes after each command of the page: the command's item (`itemId`, whichever item is shown when the command ends)
   * is read again and its line kept, the journal shown read again; nothing moves.
   */
  refresh?: { version: number; itemId: string } | null;
  onMeasureChanged?: (itemId: string) => void;
  /** Told what the detail shows each time it changes (another item, reading, line read again or right). */
  onShown?: (shown: ItemDetailShown | null) => void;
};

type Load = { state: "loading" } | { state: "ready" } | { state: "missing" } | { state: "error" };
type Outside = ItemDetailLineRead & { line: ItemDetailLine };

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

/** The plan to resolve for the item shown: a reading is resolved only for an item its analysis answered on that plan. */
function planRequest(choice: ItemDetailPlanChoice, itemId: string): ItemDetailPlanRequest | null {
  switch (choice.kind) {
    case "reading": return { itemId, planKey: choice.planKey, jobId: choice.jobId, source: null };
    case "dossier": return { itemId, planKey: choice.planKey, jobId: null, source: null };
    case "source": return { itemId, planKey: null, jobId: null, source: { documentId: choice.documentId, generation: choice.generation } };
    default: return null;
  }
}

const neverRefused = () => false;
/** The detail's screen: one per member and scope (a new reader remounts it), so its own completions name it alone. */
const DETAIL_SCREEN = "detail";

function ItemDetailView({ projectId, viewerKey, address, reader, tableQuery, onBack, onGesture, onMeasureChanged, onAddressChange, onRefused = neverRefused,
  refresh = null, onShown }: Props) {
  const version = refresh?.version ?? 0;
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
  /** The member's right to decide, as the latest read of the table answered it (a page, an item read alone or again). */
  const [rights, setRights] = useState<boolean | null>(null);

  // The queue: the table's page that holds the item, as the table filtered it; an item outside the filter (a link of the
  // radar) is read alone and shown beside it. Read once per item not yet in the queue.
  const itemId = address.itemId;
  const found = queue.find(itemId);
  useEffect(() => {
    if (queue.find(itemId) || outside?.line.itemId === itemId) return;
    const done = begin({ screen: DETAIL_SCREEN, item: itemId });
    setLoad({ state: "loading" });
    void reader.readQueue({ kind: "focus", itemId }).then(async (page) => {
      if (!done.ownScreen()) return;
      setRights(page.canReview);
      if (!done.current()) return;
      queue.add(page);
      setAnchor(page.page.offset);
      if (page.page.focusFound && queue.find(itemId)) {
        setOutside(null);
        setLoad({ state: "ready" });
        setRevision((value) => value + 1);
        return;
      }
      const alone = await reader.readLine(itemId);
      if (!done.ownScreen()) return;
      if (alone) setRights(alone.canReview);
      if (!done.current()) return;
      setOutside(alone?.line ? { ...alone, line: alone.line } : null);
      setLoad({ state: alone?.line ? "ready" : "missing" });
      setRevision((value) => value + 1);
    }).catch((caught: unknown) => {
      // A refusal of the member's right is the screen's at once, whatever item is shown now.
      if (isRightRefusal(caught)) {
        if (done.ownScreen()) onRefused(caught);
        return;
      }
      if (!done.current()) return;
      if (!onRefused(caught)) setLoad({ state: "error" });
    });
    // `outside` is read, not followed: an item shown outside the filter is not read again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, queue, reader]);

  // After a command of the page, the command's item (the member may have moved on since) is read again in the table's
  // scope and replaces its line where it stands, kept by item: the queue's membership, its order and the page shown do not
  // move. An item no longer in the list (or in the plan's scope) is cleared of what was read of it; the right the reply
  // carries governs the gestures, whatever happens to the item. Reads of different items live until they end: only a later
  // read of the same item, or the end of this screen, makes a reply obsolete. A save of an answer's counted marks (lot 5)
  // reads its item again the same way.
  const [fresh, setFresh] = useState<Record<string, ItemDetailLineRead | null>>({});
  const rereads = useRef<Record<string, number>>({});
  const read = found?.page.page.lines[found.index] ?? (outside?.line.itemId === itemId ? outside.line : null);
  const gone = itemId in fresh && !fresh[itemId]?.line;
  const storedLine = itemId in fresh ? fresh[itemId]?.line ?? null : read;
  const context = found?.page ?? (anchor !== null ? queue.page(anchor) : null);
  const canReview = rights ?? false;
  const plans = fresh[itemId]?.plans ?? (outside?.line.itemId === itemId ? outside.plans : context?.plans);
  const line = useMemo(() => storedLine && canReview && storedLine.coverage.answered === 0 && plans
    ? { ...storedLine, remeasurePlans: plans.map(({ key }) => key) } : storedLine, [storedLine, canReview, plans]);
  // A notice belongs to the item it was said for.
  const [noticeFor, setNoticeFor] = useState(itemId);
  if (noticeFor !== itemId) {
    setNoticeFor(itemId);
    setNotice("");
  }
  const names = useMemo(() => ({ ...(context?.names ?? {}), ...(outside?.names ?? {}) }), [context, outside]);
  const planNames = useMemo(() => Object.fromEntries((plans ?? []).map(({ key, name }) => [key, name])), [plans]);
  const position = queue.position(itemId);

  const original = useMemo<ItemDetailPlanChoice>(() => (line ? chooseItemDetailPlan(line, address) : { kind: "none" }), [line, address]);
  const originalKey = `${itemId}|${choiceKey(original)}`;
  const [currentCopy, setCurrentCopy] = useState<{ original: string; plan: string; revision: number } | null>(null);
  const current = currentCopy?.original === originalKey ? currentCopy : null;
  const chosen = useMemo<ItemDetailPlanChoice>(() => current
    ? { kind: "dossier", planKey: current.plan, planName: planNames[current.plan] ?? null, reading: null } : original,
  [current, original, planNames]);
  // A plan is resolved again each time it is opened (another plan, reading or piece), never for a page turned or an item
  // shown on the same plan: the request is read when the plan changes, not followed.
  const key = `${itemId}|${choiceKey(chosen)}|${current?.revision ?? 0}`;
  // What is shown, to which every completion is addressed (the screen: this member and scope, remounted otherwise).
  const begin = useCompletions({ screen: DETAIL_SCREEN, item: itemId, reading: key });
  const measureRefused = useMemo(() => {
    const completion = begin({ screen: DETAIL_SCREEN, item: itemId });
    return (error: unknown) => completion.ownScreen() && onRefused(error);
  }, [begin, itemId, onRefused]);
  const rereadItem = useCallback((target: string) => {
    const asked = (rereads.current[target] ?? 0) + 1;
    rereads.current[target] = asked;
    const done = begin({ screen: DETAIL_SCREEN, item: target });
    const latest = () => done.ownScreen() && rereads.current[target] === asked;
    void reader.readLine(target).then((read) => {
      if (!latest()) return;
      setFresh((current) => ({ ...current, [target]: read }));
      if (read) setRights(read.canReview);
    }).catch((caught: unknown) => {
      if (isRightRefusal(caught) ? done.ownScreen() : latest() && done.current()) onRefused(caught);
    });
  }, [begin, onRefused, reader]);
  useEffect(() => {
    if (!refresh) return;
    rereadItem(refresh.itemId);
    // The command's item is read again when the page says a command ended, not when another item is shown; a read under
    // way is never cancelled by another item's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  const request = useRef<ItemDetailPlanRequest | null>(null);
  request.current = planRequest(chosen, itemId);
  /** The reading the server refused for this item (its analysis did not answer it on that plan): shown as a mismatch. */
  const [refusedReading, setRefusedReading] = useState<string | null>(null);
  const choice = useMemo<ItemDetailPlanChoice>(() => (refusedReading === key ? { kind: "mismatch" } : chosen), [chosen, key, refusedReading]);
  // The page's latest handler of a refusal, without resolving the plan again when it changes.
  const planRefused = useEffectEvent((failure: ItemDetailPlanError) => onRefused(failure));
  const [resolved, setResolved] = useState<{ key: string; resolution: ItemDetailPlanResolution }>({ key: "", resolution: { state: "none" } });
  useEffect(() => {
    const asked = request.current;
    if (!asked) {
      setResolved({ key, resolution: { state: "none" } });
      return;
    }
    const done = begin({ screen: DETAIL_SCREEN, item: itemId, reading: key });
    setResolved({ key, resolution: { state: "loading" } });
    reader.resolvePlan(asked).then((view) => {
      if (done.current()) setResolved({ key, resolution: { state: "ready", view } });
    }).catch((error: unknown) => {
      const failure = error instanceof ItemDetailPlanError ? error : new ItemDetailPlanError(null, null);
      // A refusal of the member's right is the screen's at once, whatever item or reading is shown now.
      if (isRightRefusal(failure)) {
        if (done.ownScreen()) planRefused(failure);
        return;
      }
      if (!done.current()) return;
      if (failure.code === "TAKEOFF_ITEM_DETAIL_READING_NOT_FOUND") {
        setRefusedReading(key);
        setResolved({ key, resolution: { state: "none" } });
        return;
      }
      // The affaire itself refused (rights, session, the affaire gone): the page withdraws the detail.
      if (failure.status === 401 || failure.status === 403 || (failure.status === 404 && failure.code === "NOT_FOUND")) {
        planRefused(failure);
        return;
      }
      setResolved({ key, resolution: { state: "error", message: itemDetailPlanErrorLabel(failure.code, failure.status) } });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `begin` is stable; `itemId` is part of `key`
  }, [key, reader]);
  const resolution: ItemDetailPlanResolution = resolved.key === key ? resolved.resolution
    : request.current ? { state: "loading" } : { state: "none" };
  const view = resolution.state === "ready" ? resolution.view : null;
  const answer = choice.kind === "reading" && choice.current ? choice.reading.answer : null;
  const reviewId = answer?.outcome === "measured" && !gone && onGesture ? answer.answerId : null;
  // Returning from the targeted review starts a new reader. Wait for its review before offering a decision:
  // a freshly justified row can still have exactly the same quantity, decision revision and plan.
  const measure = useSWR(reviewId ? ["poste-measure", viewerKey, projectId, reviewId, readerIdentity(reader), fresh[itemId]?.line?.targets, version] : null,
    () => fetchMeasureReview(projectId, reviewId!), { shouldRetryOnError: false });
  useEffect(() => { if (isRightRefusal(measure.error)) onRefused(measure.error); }, [measure.error, onRefused]);
  const review = measure.data && measure.data.answer_id === reviewId && measure.data.item_id === itemId
    && choice.kind === "reading" && measure.data.plan_id === choice.planKey ? measure.data : null;
  const canRetain = canReview && !!review && (!review.reason || review.reason === "justification_required");
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
      const done = begin({ screen: DETAIL_SCREEN, item: itemId });
      try {
        const page = await reader.readQueue({ kind: "page", offset: next.offset });
        if (!done.ownScreen()) return;
        setRights(page.canReview);
        // The member went back or elsewhere meanwhile, or another address arrived: the move is dropped.
        if (!done.current() || navigation.current !== asked || latestAddress.current !== from) return;
        queue.add(page);
        setRevision((value) => value + 1);
      } catch (caught) {
        if (isRightRefusal(caught)) {
          if (done.ownScreen()) onRefused(caught);
          return;
        }
        if (!done.current() || navigation.current !== asked) return;
        if (!onRefused(caught)) setNotice("La page suivante des postes n’a pas pu être lue.");
        return;
      }
      next = queue.neighbour(itemId, step);
    }
    if (next && "itemId" in next) openItem(next.itemId);
    else setNotice(step > 0 ? "Dernier poste de la sélection." : "Premier poste de la sélection.");
  }, [begin, context, itemId, onRefused, openItem, queue, reader]);

  const back = useCallback(() => {
    navigation.current += 1;
    const index = position?.index ?? null;
    onBack(itemTableReturnHref(projectId, tableQuery, index === null ? { itemId, offset: 0 }
      : { itemId, offset: itemTablePageOffset(index, context?.page.limit ?? 0) }));
  }, [context, itemId, onBack, position, projectId, tableQuery]);

  // What is offered on what is shown: the one rule the buttons, the keys and the page's confirmations read.
  const offer = useCallback((requested: ItemDetailOfferedGesture) =>
    itemDetailGestureOffer({ line: line!, choice, canReview: canReview && Boolean(onGesture) }, requested), [canReview, choice, line, onGesture]);
  const gesture = useCallback((requested: ItemDetailKeyGesture, initial: string | null, quantityChoice?: ItemQuantityChoice) => {
    if (!line) return;
    const offered = offer(requested);
    if (!offered.offered) {
      const mention = requested === "accept_measured" && canRetain && offered.reason === "ineligible"
        && (offered.ineligibility === "anomaly" || offered.ineligibility === "dpgf_gap");
      setNotice(itemDetailGestureRefusalLabel(requested, offered) + (mention ? " Ouvrez « Retenir cette mesure »." : ""));
      return;
    }
    onGesture!({ gesture: requested, line, initial, key, ...(quantityChoice ? { quantityChoice } : {}) });
  }, [canRetain, key, line, offer, onGesture]);

  // The journal of the item shown: a refusal of one of its reads withdraws the detail while that item is shown; a
  // refusal of the member's right, while this screen is the one that read it, whatever item is shown now.
  const historyRefused = useMemo(() => {
    if (!line) return onRefused;
    const done = begin({ screen: DETAIL_SCREEN, item: line.itemId });
    return (caught: unknown) => ((isRightRefusal(caught) ? done.ownScreen() : done.current()) ? onRefused(caught) : true);
  }, [begin, line, onRefused]);

  // The page is told what is shown and what it offers, so that a confirmation never outlives what opened it.
  const offeredNow = line && !gone && choice.kind !== "mismatch" && load.state === "ready"
    ? OFFERED_GESTURES.filter((requested) => offer(requested).offered) : null;
  const offeredKey = offeredNow?.join(",") ?? null;
  const tellShown = useEffectEvent((shown: ItemDetailShown | null) => onShown?.(shown));
  useEffect(() => {
    tellShown(line && offeredNow ? { key, line, offered: offeredNow } : null);
    // `offeredKey` stands for the gestures offered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, line, offeredKey]);
  useEffect(() => () => tellShown(null), []);

  const onEvidenceKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.nativeEvent.isComposing
      || isItemDetailFieldTarget(event.target)) return;
    event.preventDefault();
    back();
  };

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
  const shownLines = revision >= 0 ? [...(outside && outside.line.itemId === itemId && !found ? [outside.line] : []), ...(context?.page.lines ?? [])]
    .map((entry) => fresh[entry.itemId]?.line ?? entry) : [];

  // The counted marks of the reading shown (lot 5): its answer, the items of the queue by their label, and the items of
  // the same reading a mark may be given to. Only the item's current reading: an earlier one's plan is another sheet, and
  // its own marks are not readable by its job yet.
  const reading = choice.kind === "reading" && choice.current ? choice.reading : null;
  const earlierReading = choice.kind === "reading" && !choice.current && choice.reading.answer ? choice : null;
  // An earlier reading's own answer, as the server proved it with its plan (the job answered the item there): its marks,
  // read only, on its own copy of the plan.
  const earlierAnswer = earlierReading && view?.reading?.jobId === earlierReading.jobId ? view.reading.answer ?? null : null;
  const earlierJob = earlierReading?.jobId ?? null;
  const marksAnswer = useMemo<CountMarksAnswer | null>(() => (reading?.answer ? { answerId: reading.answer.answerId,
    jobId: reading.answer.jobId, scopePages: [...new Set([...reading.answer.searchedPages, ...reading.answer.unreadablePages])] }
    : earlierAnswer && earlierJob ? { answerId: earlierAnswer.answerId, jobId: earlierJob, scopePages: earlierAnswer.scopePages }
      : null), [earlierAnswer, earlierJob, reading]);
  const sentJob = reading?.sent ? reading.answer?.jobId : null;
  const viewer = viewerKey ?? String(readerIdentity(reader));
  const revisionRead = useContributionRevisions(viewer, projectId, sentJob ? [{ jobId:sentJob, itemId }] : []);
  useEffect(() => {
    if (isRightRefusal(revisionRead.error)) onRefused(revisionRead.error);
  }, [revisionRead.error, onRefused]);
  const versions = sentJob && !isRightRefusal(revisionRead.error) ? revisionRead.data?.[sentJob] : undefined;
  const destination = versions?.find(v=>v.version_id===address.versionId) ?? (!address.versionId && versions?.length===1 ? versions[0] : undefined);
  const revisionItem = destination?.items.find(i=>i.item_id===itemId);
  const revisionEditable = !!(canReview && destination?.editable && revisionItem?.current && reading?.unit!=="running" && reading?.unit!=="queued" && reading?.attempt?.unit!=="queued" && reading?.attempt?.unit!=="running");
  const revisionReceipt = revisionEditable ? destination?.receipt_id : null;
  const revisionVersion = destination?.version_id;
  const revisionMarks = useRevisionMarksReader(projectId,sentJob,revisionVersion,revisionReceipt);
  const refreshRevision = revisionRead.mutate;
  const itemLabels = Object.fromEntries(shownLines.map((entry) => [entry.itemId, entry.label]));
  // The item of each answer the detail knows (the answer shown, every reading of the queue loaded): a save names every
  // answer its command changed, with the item when the marks know it (a reattribution's target, another item holding a
  // moved mark), maybe once another item is shown, and each one's item is read again, its acceptance reopened too.
  const answerItems = useRef<Record<string, string>>({});
  for (const entry of shownLines) for (const other of entry.readings) if (other.answer) answerItems.current[other.answer.answerId] = entry.itemId;
  if (marksAnswer) answerItems.current[marksAnswer.answerId] = itemId;
  const marksSaved = useCallback((answers: ReadonlyArray<{ answerId: string; itemId: string | null }>) => {
    const items = new Set(answers.flatMap(({ answerId, itemId: named }) => named ?? answerItems.current[answerId] ?? []));
    for (const target of items) rereadItem(target);
    if (sentJob) void refreshRevision();
  }, [rereadItem, refreshRevision, sentJob]);

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

      {load.state === "missing" || gone ? (
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
                    <span>{ITEM_STATE_LABELS[entry.state]}{!found && entry.itemId === outside?.line.itemId ? " · hors du filtre" : ""}</span>
                    <span className="font-mono tabular-nums">{entry.observed ? formatItemQuantity(entry.observed.quantity, entry.observed.unit) : "—"}</span>
                  </span>
                </li>
              ))}
            </ul>
            <p className="shrink-0 border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              ↑ ↓ poste · Entrée preuve · Échap tableau{canReview ? " · V accepter · E écarter · I inclure · F2 saisir" : ""}
            </p>
          </aside>
          <CountMarksScope key={revisionVersion ?? "plan"} reader={revisionMarks} revisionVersion={revisionVersion} projectId={projectId} answer={marksAnswer} page={opening.page} itemLabels={itemLabels} onSaved={marksSaved}
            readOnly={earlierAnswer !== null || (!!sentJob && !revisionEditable)} onRefused={onRefused} showPage={(next) => go({ page: next, observationId: null })}>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <ItemDetailPlanPane resolution={line ? resolution : { state: "loading" }} page={opening.page} requestedMissing={opening.requestedMissing}
                pagesOfInterest={pagesOfInterest} onPage={(page) => go({ page, observationId: null })} onDocumentState={setDocumentState}
                emptyMessage="Aucun plan n’est associé à ce poste pour le moment."
                tools={<CountMarksTools />} layer={(frame) => <CountMarksLayer frame={frame} />} />
              {canReview && line && view?.plan.planFileId && view.document.kind !== "unavailable" && !earlierReading ? (
                <MeasureItemOnPlan key={`${itemId}:${view.plan.key}:${view.plan.planFileId}`} projectId={projectId} line={line}
                  plan={view.plan} page={opening.page} listRevisionId={fresh[itemId]?.listRevisionId ?? (outside?.line.itemId === itemId ? outside.listRevisionId : context?.listRevisionId) ?? null}
                  onOpenComparison={(jobId, page) => go({ planKey: view.plan.key, jobId, page, answerId: null, observationId: null, source: null })}
                  receipt={address.receipt} onFollow={(receipt) => go({ receipt })}
                  onOpenCurrent={() => setCurrentCopy({ original: originalKey, plan: view.plan.key, revision: (current?.revision ?? 0) + 1 })}
                  onRefused={measureRefused} onRefresh={() => { rereadItem(itemId); go({ planKey: view.plan.key, jobId: null, answerId: null, observationId: null, source: null }); }} />
              ) : null}
              {sentJob && versions && versions.length>1 && <label className="flex flex-wrap items-center gap-2 px-3 text-sm">Devis à consulter ou corriger
                <NativeSelect size="sm" wrapperClassName="w-auto" value={destination?.version_id??""} onChange={e=>go({versionId:e.target.value || null})}>
                  <option value="">Choisir un devis</option>{versions.map(v=><option key={v.version_id} value={v.version_id}>V{v.version_number} · {v.status==="draft"?"brouillon":"lecture seule"}</option>)}
                </NativeSelect></label>}
              {sentJob && revisionRead.error && <p role="alert">Impossible de lire les apports du devis. <button onClick={()=>void refreshRevision()}>Réessayer</button></p>}
              {sentJob && versions?.length===0 && <p>La lecture a déjà été envoyée. Son historique ne permet pas d’isoler un apport à corriger.</p>}
              {sentJob && destination && revisionItem && <RevisionPanel key={`${viewer}/${sentJob}/${destination.version_id}/${itemId}`}
                version={destination} measuredAnswer={reading?.answer?.outcome==="measured"} item={revisionItem} viewer={viewer} editable={revisionEditable} planId={reading!.planKey}
                onRefused={onRefused} onItem={id=>go({itemId:id,page:null,answerId:null,observationId:null})}
                refresh={async()=>{rereadItem(itemId);return (await refreshRevision())?.[sentJob]?.find(v=>v.version_id===destination.version_id);}}/>}
              <CountMarksPanel sent={!!sentJob} />
              {earlierReading ? (
                <p className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border bg-surface px-3 py-2 text-xs text-foreground-secondary"
                  data-testid="reperes-lecture-ancienne">
                  {earlierAnswer && address.receipt?.jobId === earlierJob ? "Propositions de la comparaison sur sa propre copie du plan, en lecture seule. Vos corrections restent sur la lecture actuelle."
                    : earlierAnswer ? "Repères de cette lecture plus ancienne, sur sa propre copie du plan, en lecture seule."
                    : "Les repères comptés sont ceux de la lecture actuelle de ce poste, sur sa propre copie du plan."}
                  <Button size="xs" variant="outline" onClick={() => go({ planKey: earlierReading.planKey,
                    jobId: earlierReading.reading.answer!.jobId, page: null, answerId: null, observationId: null })}>
                    Ouvrir la lecture actuelle
                  </Button>
                </p>
              ) : null}
            </div>
          </CountMarksScope>
          {/* Escape comes back to the table from the evidence too (its heading takes the focus with Enter). */}
          <div data-testid="poste-detail-evidence-panel" data-narrow-collapsed={String(!panels.evidence)} onKeyDown={onEvidenceKey}
            className={cn("w-[24rem] shrink-0 border-l border-border max-lg:w-full max-lg:border-l-0 max-lg:border-t", !panels.evidence && "max-lg:hidden")}>
            {line ? (
              <ItemDetailEvidencePane ref={evidence} projectId={projectId} line={line} choice={choice} plan={view}
                measureRetention={choice.kind === "reading" && review && answer ? <MeasureRetention
                  key={`${viewerKey}:${review.answer_id}:${review.revision}:${canReview}`} projectId={projectId}
                  observations={answer.observations} planName={choice.planName} jobId={choice.jobId} review={review} label={line.label}
                  undecided={!choice.reading.decision} acceptedMeasure={choice.reading.decision?.kind === "accepted"
                    && !choice.reading.quantityDecision} canReview={canReview} onRefused={historyRefused}
                  onRefresh={() => {
                    if (!begin({ screen: DETAIL_SCREEN, item: itemId }).ownScreen()) return;
                    if (onMeasureChanged) onMeasureChanged(itemId);
                    else { rereadItem(itemId); void measure.mutate(); }
                  }} /> : reviewId && measure.error ?
                    <Button size="xs" variant="outline" onClick={() => void measure.mutate()}>Relire la mesure</Button> : null}
                documentState={documentState} names={names} planNames={planNames} outsideFilter={!found && outside !== null}
                historyVersion={version} onRefused={historyRefused} historyScope={`lecteur-${readerIdentity(reader)}`}
                proof={chosen.kind === "reading" && !chosen.current ? resolution.state === "ready" ? "proven"
                  : resolution.state === "loading" ? "pending" : "unproven" : null}
                decide={{ offer, onGesture: (requested, quantityChoice) => gesture(requested, null, quantityChoice) }}
                onObservation={(observation) => go({ page: observation.page, observationId: observation.observationId,
                  answerId: answer?.answerId ?? null })}
                onPage={(page) => go({ page, observationId: null })}
                onPlan={(planKey, jobId) => go({ planKey, jobId, receipt: planKey === view?.plan.key ? address.receipt : undefined, page: null, source: null, answerId: null, observationId: null })} />
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
