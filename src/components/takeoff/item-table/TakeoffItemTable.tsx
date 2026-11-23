"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ChevronDown } from "lucide-react";

import { isTakeoffApiError } from "@/lib/takeoff/client-http";
import { itemTableLineDetailHref } from "@/lib/takeoff/item-detail-address";
import { isTakeoffReadRefusal } from "../useTakeoffRequestActivity";
import { ITEM_AGGREGATE_STATES } from "@/lib/takeoff/item-answer-aggregation";
import { ITEM_LINE_DECISIONS, type ItemSetAsideReason, type ItemTableScope } from "@/lib/takeoff/item-table";
import {
  fetchFrozenItemSelection,
  fetchItemTable,
  itemReviewStaleLines,
  previewItemRemeasure,
  sendItemRemeasure,
  sendItemReviewCommand,
} from "@/lib/takeoff/item-table-client";
import {
  ITEM_REVIEW_COMMAND_VERSION,
  ITEM_TABLE_PAGE_SIZES,
  type ItemRemeasurePreview,
  type ItemRemeasureSeen,
  type ItemReviewCommand,
  type ItemReviewResult,
  type ItemTableResponseLine,
} from "@/lib/takeoff/item-table-contracts";
import {
  formatItemCount,
  formatItemPercent,
  formatItemQuantity,
  ITEM_DECISION_LABELS,
  ITEM_INELIGIBILITY_LABELS,
  ITEM_STATE_LABELS,
  itemReasonBlocks,
  itemReasonLabel,
} from "@/lib/takeoff/item-table-labels";
import { itemTableAddressParams, readItemTableAddress, withItemTableParams, type ItemTableAddress } from "@/lib/takeoff/item-table-query";
import {
  emptyItemSelection,
  itemSelectionCounts,
  itemSelectionStorageKey,
  parseStoredItemSelection,
  selectedTargets,
  toggleItemSelection,
  withFrozenSelection,
  type ItemSelection,
} from "@/lib/takeoff/item-table-selection";
import type { QuantityEntry } from "@/lib/takeoff/quantity-entry";
import { JourneyPanel } from "@/components/journey/JourneyPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import {
  AcceptMeasuredDialog,
  EntryDialog,
  ReinstateDialog,
  RemeasureDialog,
  SetAsideDialog,
} from "./ItemTableGestureDialogs";
import { ItemTableLineDetail } from "./ItemTableLineDetail";
import { useCompletions, type Completion } from "@/components/takeoff/item-detail/useCompletions";

const TakeoffItemSendDialog = dynamic(
  () => import("@/components/takeoff/item-send/TakeoffItemSendDialog").then((module) => module.TakeoffItemSendDialog),
  { ssr: false },
);
const readingDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

/**
 * In a plan's scope, the analyses of that plan whose answers the page shows (usually one; a new measure of some items
 * adds another), each sent or not: a plan read against the list is sent to the estimate from here, one analysis at a time.
 */
function planSends(lines: readonly ItemTableResponseLine[], planKey: string) {
  const jobs = new Map<string, { jobId: string; sent: boolean; readAt: string }>();
  for (const line of lines) {
    for (const reading of line.readings) {
      if (reading.planKey !== planKey || !reading.answer) continue;
      const known = jobs.get(reading.answer.jobId);
      jobs.set(reading.answer.jobId, { jobId: reading.answer.jobId, sent: (known?.sent ?? true) && reading.sent,
        readAt: reading.answer.readAt });
    }
  }
  return [...jobs.values()].sort((left, right) => left.readAt.localeCompare(right.readAt));
}

/**
 * The table of items of an affaire's takeoff: a line per item of the list, with its state, its observed quantity, the
 * quantity retained or entered apart, its DPGF reference and gap, its coverage, its reasons and its plans; the decisions
 * to take first. Any reader sees it; an operator ticks lines (on several pages, or every result of a filter), and the
 * selection, the values typed and the focus stay when a plan's result arrives and after a reload. The server decides
 * every gesture on the selection it froze.
 */

const PREFIX = "poste";
/** The line an address focuses, marked as the sheets of the application mark the line shown beside them. */
const FOCUSED_ROW = "bg-primary/5 shadow-[inset_3px_0_0_var(--color-primary)]";
type Gesture = "accept" | "set_aside" | "reinstate" | "entry" | "remeasure";
type Draft = { quantity: string; unit: string };
type Notice = { tone: "success" | "info" | "danger"; text: string };

const fetchTable = ([, , projectId, address]: readonly [string, string, string, ItemTableAddress]) => fetchItemTable(projectId, address);

function scopeLabel(scope: ItemTableScope, plans: Array<{ key: string; name: string }>) {
  if (scope.kind === "affaire") return "Portée : toute l’affaire";
  return `Portée : plan « ${plans.find(({ key }) => key === scope.planKey)?.name ?? "choisi"} »`;
}

function readStoredSelection(key: string, scope: ItemTableScope) {
  try {
    return parseStoredItemSelection(window.sessionStorage.getItem(key), scope);
  } catch {
    return null;
  }
}

function storeSelection(key: string, selection: ItemSelection) {
  try {
    if (Object.keys(selection.items).length) window.sessionStorage.setItem(key, JSON.stringify(selection));
    else window.sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable: the selection lives as long as the page */
  }
}

type StoredDrafts = Record<string, Draft & { line: ItemTableResponseLine }>;

/** The values being typed, kept for the tab with the scope they were typed in (as the selection), never beyond it. */
function readStoredDrafts(key: string, scopeKey: string): StoredDrafts {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(key) ?? "null") as { scope?: unknown; drafts?: unknown } | null;
    if (!stored || stored.scope !== scopeKey || !stored.drafts || typeof stored.drafts !== "object") return {};
    return Object.fromEntries(Object.entries(stored.drafts as Record<string, unknown>).flatMap(([itemId, value]) => {
      const draft = value as Partial<Draft & { line: ItemTableResponseLine }> | null;
      return draft && typeof draft.quantity === "string" && typeof draft.unit === "string" && draft.line?.itemId === itemId
        ? [[itemId, { quantity: draft.quantity, unit: draft.unit, line: draft.line }]] : [];
    }));
  } catch {
    return {};
  }
}

function storeDrafts(key: string, scopeKey: string, drafts: StoredDrafts) {
  try {
    if (Object.keys(drafts).length) window.sessionStorage.setItem(key, JSON.stringify({ scope: scopeKey, drafts }));
    else window.sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable: the values live as long as the page */
  }
}

function parseDecimal(text: string) {
  const value = Number(text.trim().replace(/\s/g, "").replace(",", "."));
  return text.trim() && Number.isFinite(value) && value > 0 ? value : null;
}

const newIntent = () => crypto.randomUUID();

function resultNotice(result: ItemReviewResult, done: string): Notice {
  const applied = formatItemCount(result.applied.length, `poste ${done}`, `postes ${done}s`);
  if (!result.skipped.length) return { tone: "success", text: `${applied}.` };
  const left = result.skipped.slice(0, 5).map(({ label, reason }) => `${label} (${ITEM_INELIGIBILITY_LABELS[reason]})`).join(", ");
  return { tone: result.applied.length ? "success" : "info",
    text: `${applied}. Laissés : ${left}${result.skipped.length > 5 ? ` et ${result.skipped.length - 5} autres` : ""}.` };
}

// Each selection the member holds is one value: a completion started for it applies only while it is still the one held
// (a tick, « Vider la sélection », a read-back or another completion makes another).
const selectionTokens = new WeakMap<ItemSelection, string>();
let selectionCount = 0;
function selectionToken(value: ItemSelection) {
  let token = selectionTokens.get(value);
  if (!token) {
    selectionCount += 1;
    token = String(selectionCount);
    selectionTokens.set(value, token);
  }
  return token;
}

export function TakeoffItemTable({ projectId, viewerKey, signature }: {
  projectId: string;
  /** The member and their tenant: the table's reads and its stored selection belong to them alone. */
  viewerKey: string;
  /** Changes when a plan's reading moves (the page's one poll): the table is read again then, never on its own interval. */
  signature?: string;
}) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const address = useMemo(() => readItemTableAddress(searchParams, PREFIX), [searchParams]);
  const scopeKey = JSON.stringify(address.scope);
  const key = ["item-table", viewerKey, projectId, address] as const;
  const { data, error, isLoading, mutate } = useSWR(key, fetchTable, {
    keepPreviousData: true, revalidateOnFocus: true, shouldRetryOnError: false,
  });

  // Each read of the table this component asks for reads the open history again with it (its version).
  const [historyVersion, setHistoryVersion] = useState(0);
  const refresh = useCallback(() => {
    setHistoryVersion((version) => version + 1);
    return mutate();
  }, [mutate]);
  // The first signature the page's poll gives is the state the table's first read already shows: only a later one that
  // differs reads the table again.
  const seenSignature = useRef(signature);
  useEffect(() => {
    if (signature === undefined || seenSignature.current === signature) return;
    const first = seenSignature.current === undefined;
    seenSignature.current = signature;
    if (!first) void refresh();
  }, [signature, refresh]);

  // Any read of the affaire refused (the table's, an item's history, a frozen selection): the table, its detail, its
  // history and its dialogs are withdrawn, whatever they showed before, until the page is opened again.
  const [refusal, setRefusal] = useState<unknown>(null);
  const withdrawOnRefusal = useCallback((caught: unknown) => {
    if (!isTakeoffReadRefusal(caught)) return false;
    setRefusal(caught);
    return true;
  }, []);

  const storageKey = itemSelectionStorageKey(viewerKey, projectId);
  const [selection, setSelection] = useState<ItemSelection>(() => emptyItemSelection(address.scope));
  // The tab's selection is read back after the first render (the server's render has none), for the scope shown.
  useEffect(() => {
    setSelection(readStoredSelection(storageKey, address.scope) ?? emptyItemSelection(address.scope));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once per scope
  }, [storageKey, scopeKey]);
  const updateSelection = useCallback((next: ItemSelection) => {
    setSelection(next);
    storeSelection(storageKey, next);
  }, [storageKey]);

  // The values being typed stay for the tab after a reload, in the scope they were typed in, as the selection does.
  const draftsKey = `${storageKey}:saisies`;
  const [drafts, setDraftsState] = useState<StoredDrafts>({});
  const setDrafts = useCallback((update: (current: StoredDrafts) => StoredDrafts) => setDraftsState((current) => {
    const next = update(current);
    if (next !== current) storeDrafts(draftsKey, scopeKey, next);
    return next;
  }), [draftsKey, scopeKey]);
  // A draft's targets are those of its line as it is now: after any read of the table (the lines of the page), after a
  // stale refusal and after a reload (the items typed, read again as a frozen selection), never those it was typed on.
  const withLines = useCallback((lines: readonly ItemTableResponseLine[]) => setDrafts((current) => {
    const fresh = lines.filter(({ itemId }) => itemId in current && current[itemId].line !== lines.find((line) => line.itemId === itemId));
    if (!fresh.length) return current;
    const next = { ...current };
    for (const line of fresh) next[line.itemId] = { ...next[line.itemId], line };
    return next;
  }), [setDrafts]);
  const readDraftTargets = useCallback(async (itemIds: string[]) => {
    if (!itemIds.length) return;
    try {
      const frozen = await fetchFrozenItemSelection(projectId, address.scope, { kind: "items", itemIds });
      setDrafts((current) => {
        const next = { ...current };
        for (const { itemId, target } of frozen.items) {
          if (next[itemId]) next[itemId] = { ...next[itemId], line: { ...next[itemId].line, targets: target } };
        }
        return next;
      });
    } catch (caught) {
      withdrawOnRefusal(caught);
    }
  }, [projectId, address.scope, setDrafts, withdrawOnRefusal]);
  useEffect(() => {
    const stored = readStoredDrafts(draftsKey, scopeKey);
    setDraftsState(stored);
    void readDraftTargets(Object.keys(stored));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read back once per scope, then read their lines again
  }, [draftsKey, scopeKey]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [dialog, setDialog] = useState<null | { gesture: Gesture; intentKey: string; seen?: ItemRemeasureSeen }>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [preview, setPreview] = useState<{ value: ItemRemeasurePreview | null; error: string | null }>({ value: null, error: null });
  // The send belongs to the plan's scope it was opened from: another scope (a filter, the browser's history) closes it.
  const [sending, setSending] = useState<{ jobId: string; planName: string; scope: string } | null>(null);

  // The table's completions (useCompletions, the detail's one rule): each is addressed to what started it — the screen (the
  // member, the affaire, the scope) and the selection held, or the selection with its filter — and changes what is shown
  // only if that is still what is shown; a selection cleared or changed meanwhile stays as the member left it.
  const screenKey = `${viewerKey}|${projectId}|${scopeKey}`;
  const filterKey = JSON.stringify(address.filter);
  const forSelection = useCompletions({ screen: screenKey, item: selectionToken(selection) });
  const forFilter = useCompletions({ screen: screenKey, item: selectionToken(selection), reading: filterKey });
  // The remeasure's dialog (lot 4 PR 4b): its preview is shown only in the dialog it was asked for.
  const forDialog = useCompletions({ screen: screenKey, item: dialog?.intentKey ?? null });

  const navigate = useCallback((partial: Partial<ItemTableAddress>) => {
    const next = withItemTableParams(searchParams.toString(), itemTableAddressParams(partial, PREFIX));
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [searchParams, router, pathname]);

  // The focused line is brought into view once per focus, when its page is shown.
  const scrolledFocus = useRef<string | null>(null);
  const focusId = address.focusItemId;
  const lines = data?.page.lines;
  useEffect(() => {
    if (lines) withLines(lines);
  }, [lines, withLines]);
  useEffect(() => {
    if (!focusId || scrolledFocus.current === focusId || !lines?.some(({ itemId }) => itemId === focusId)) return;
    scrolledFocus.current = focusId;
    const row = document.getElementById(`poste-ligne-${focusId}`);
    row?.scrollIntoView?.({ block: "center" });
    // Back from the item's detail (nothing holds the focus): the keyboard is given back to the line's « Détail ».
    if (document.activeElement === document.body) row?.querySelector<HTMLElement>("[data-poste-detail-link]")?.focus({ preventScroll: true });
  }, [focusId, lines]);

  const counts = itemSelectionCounts(selection);
  const canReview = data?.canReview === true;
  const plans = data?.plans ?? [];
  const label = scopeLabel(address.scope, plans);
  const entryValues = Object.entries(drafts).flatMap(([itemId, draft]) => {
    const quantity = parseDecimal(draft.quantity);
    const unit = draft.unit.trim() || draft.line.expectedUnit || "";
    return quantity !== null && unit ? [{ itemId, label: draft.line.label, quantity, unit, target: draft.line.targets }] : [];
  });

  /** The selection read again as it is stored now: applied only to the selection it was read for, if still held. */
  const refreshSelection = useCallback(async (current: ItemSelection) => {
    const ids = Object.keys(current.items);
    if (!ids.length) return false;
    const completion = forSelection({ screen: screenKey, item: selectionToken(current) });
    try {
      const frozen = await fetchFrozenItemSelection(projectId, current.scope, { kind: "items", itemIds: ids });
      if (!completion.current()) return false;
      updateSelection(withFrozenSelection(current, frozen));
      return true;
    } catch (caught) {
      if (completion.ownScreen()) withdrawOnRefusal(caught);
      return false;
    }
  }, [projectId, updateSelection, withdrawOnRefusal, forSelection, screenKey]);

  const failure = useCallback(async (caught: unknown, current: ItemSelection) => {
    const stale = itemReviewStaleLines(caught);
    if (stale) {
      const names = stale.slice(0, 5).map(({ label: name }) => name ?? "un poste retiré").join(", ");
      const verb = stale.length > 1 ? "ont changé" : "a changé";
      const changed = `Rien n’a été appliqué : ${names}${stale.length > 5 ? ` et ${stale.length - 5} autres` : ""} ${verb} depuis la sélection.`;
      setNotice({ tone: "danger", text: changed });
      // Said refreshed once it is, and only if the selection was still the one refused.
      if (await refreshSelection(current)) {
        setNotice({ tone: "danger", text: `${changed} La sélection a été rafraîchie : vérifiez-la, puis confirmez de nouveau.` });
      }
      await readDraftTargets(Object.keys(drafts));
      void refresh();
      return;
    }
    setNotice({ tone: "danger", text: isTakeoffApiError(caught) ? caught.message : "Impossible d’enregistrer la décision sur les postes." });
  }, [refreshSelection, readDraftTargets, drafts, refresh]);

  const runCommand = useCallback(async (command: ItemReviewCommand, done: string,
    onApplied?: (result: ItemReviewResult, started: ItemSelection, completion: Completion) => void) => {
    setBusy(true);
    const started = selection;
    const completion = forSelection({ screen: screenKey, item: selectionToken(started) });
    try {
      const result = await sendItemReviewCommand(projectId, command);
      if (completion.ownScreen()) setNotice(resultNotice(result, done));
      onApplied?.(result, started, completion);
      setDialog(null);
      void refresh();
    } catch (caught) {
      setDialog(null);
      await failure(caught, started);
    } finally {
      setBusy(false);
    }
  }, [projectId, refresh, failure, selection, forSelection, screenKey]);

  /** The items a command applied leave the selection it was sent from, if the member still holds it. */
  const dropApplied = useCallback((result: ItemReviewResult, started: ItemSelection, completion: Completion) => {
    if (!completion.current()) return;
    const items = { ...started.items };
    for (const { itemId } of result.applied) delete items[itemId];
    updateSelection({ ...started, items });
  }, [updateSelection]);

  const base = (intentKey: string) => ({ command_version: ITEM_REVIEW_COMMAND_VERSION, intent_key: intentKey, scope: selection.scope,
    targets: selectedTargets(selection) });

  // What the member saw of the selection: the list revision of the table shown and each line's readings, frozen with the
  // selection when it was ticked. The preview and the confirmation compare them with the readings stored now.
  const seenOfSelection = useCallback((): ItemRemeasureSeen => ({ list_revision_id: data?.list?.revisionId ?? null,
    targets: Object.values(selection.items).map(({ target }) => target) }), [data?.list?.revisionId, selection]);

  const openRemeasure = useCallback(async () => {
    const intentKey = newIntent();
    setDialog({ gesture: "remeasure", intentKey, seen: seenOfSelection() });
    setPreview({ value: null, error: null });
    // The preview is shown in the dialog it was asked for only: one closed, or opened again since, never receives it.
    const completion = forDialog({ screen: screenKey, item: intentKey });
    try {
      const value = await previewItemRemeasure(projectId, selection.scope, Object.keys(selection.items), seenOfSelection());
      if (completion.current()) setPreview({ value, error: null });
    } catch (caught) {
      if (completion.current()) {
        setPreview({ value: null, error: isTakeoffApiError(caught) ? caught.message : "Impossible de préparer la nouvelle mesure." });
      }
    }
  }, [projectId, selection, seenOfSelection, forDialog, screenKey]);

  const confirmRemeasure = useCallback(async () => {
    if (!dialog || !preview.value) return;
    setBusy(true);
    const started = selection;
    const completion = forSelection({ screen: screenKey, item: selectionToken(started) });
    try {
      const result = await sendItemRemeasure(projectId, { command_version: ITEM_REVIEW_COMMAND_VERSION, intent_key: dialog.intentKey,
        scope: selection.scope, item_ids: preview.value.items.map(({ itemId }) => itemId),
        plan_keys: preview.value.plans.map(({ key: planKey }) => planKey),
        // The profile's setting as it is: the Mac reads a request with its payer's profile.
        setting: null, preview_digest: preview.value.previewDigest,
        seen: dialog.seen ?? seenOfSelection() });
      if (completion.ownScreen()) {
        setNotice(result.outcome === "already_running"
          ? { tone: "info", text: "Une analyse de l’affaire est en cours : la sélection reste prête pour la nouvelle mesure." }
          : { tone: "success", text: "Nouvelle mesure demandée : les postes seront lus de nouveau sur votre forfait." });
      }
      if (result.outcome !== "already_running") {
        if (completion.current()) updateSelection(emptyItemSelection(started.scope));
        // The items asked read « En lecture » on their plans now: the table shows it at once.
        void refresh();
      }
      setDialog(null);
    } catch (caught) {
      setDialog(null);
      await failure(caught, started);
    } finally {
      setBusy(false);
    }
  }, [dialog, preview.value, projectId, selection, updateSelection, failure, refresh, seenOfSelection, forSelection, screenKey]);

  // « Tous les résultats du filtre »: applied only if the member still holds the selection and the filter it was asked for.
  const selectFilter = useCallback(async () => {
    const completion = forFilter({ screen: screenKey, item: selectionToken(selection), reading: filterKey });
    try {
      const frozen = await fetchFrozenItemSelection(projectId, address.scope, { kind: "filter", filter: address.filter });
      if (!completion.current()) return;
      updateSelection(withFrozenSelection(emptyItemSelection(address.scope), frozen));
      setNotice({ tone: "info", text: `${formatItemCount(frozen.count, "poste sélectionné", "postes sélectionnés")}, sur toutes les pages du filtre.` });
    } catch (caught) {
      if (completion.ownScreen() && withdrawOnRefusal(caught)) return;
      if (!completion.current()) return;
      setNotice({ tone: "danger", text: isTakeoffApiError(caught) ? caught.message : "Impossible de sélectionner les résultats du filtre." });
    }
  }, [projectId, address.scope, address.filter, updateSelection, withdrawOnRefusal, forFilter, screenKey, selection, filterKey]);

  const setDraft = (line: ItemTableResponseLine, change: Partial<Draft>) => setDrafts((current) => {
    const previous = current[line.itemId] ?? { quantity: "", unit: "", line };
    const next = { ...previous, ...change, line };
    const copy = { ...current };
    // A draft lives as soon as either field is typed: a unit typed first is kept for the quantity that follows.
    if (!next.quantity.trim() && !next.unit.trim()) delete copy[line.itemId];
    else copy[line.itemId] = next;
    return copy;
  });

  const filterSelect = (id: string, labelText: string, value: string, options: Array<{ value: string; label: string }>,
    onChange: (value: string) => void) => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-semibold text-muted-foreground">{labelText}</label>
      <NativeSelect id={id} size="sm" className="h-11 w-full min-w-0 sm:h-9" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </NativeSelect>
    </div>
  );

  const pageLines = data?.page.lines ?? [];
  const planScope = address.scope.kind === "plan" ? address.scope : null;
  const planName = planScope ? plans.find(({ key: planKey }) => planKey === planScope.planKey)?.name ?? "choisi" : null;
  const sends = planScope ? planSends(pageLines, planScope.planKey) : [];
  const allOnPage = pageLines.length > 0 && pageLines.every(({ itemId }) => itemId in selection.items);
  const hasFilter = Object.keys(address.filter).length > 0 || address.scope.kind === "plan";
  const columns = canReview ? 14 : 11;

  // An access removed: the table, its detail, its history and its dialogs are withdrawn, whatever was read before.
  const refused = isTakeoffReadRefusal(error) ? error : refusal;
  if (refused) {
    return (
      <JourneyPanel headingId="postes-du-metre" title="Postes du métré">
        <div className="journey-panel-body">
          <p className="text-sm text-danger" data-testid="poste-refus">
            {isTakeoffApiError(refused) ? refused.message : "Accès refusé aux postes du métré."}
          </p>
        </div>
      </JourneyPanel>
    );
  }

  return (
    <JourneyPanel headingId="postes-du-metre" title="Postes du métré">
      <div className="journey-panel-body space-y-3">
        <p className="sr-only" role="status">{notice?.text ?? ""}</p>
        {error && !data ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-danger">{isTakeoffApiError(error) ? error.message : "Impossible de lire les postes du métré."}</p>
            <Button variant="outline" size="sm" onClick={() => void mutate()}>Réessayer</Button>
          </div>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">{isLoading ? "Chargement des postes…" : ""}</p>
        ) : !data.list ? (
          <p className="text-sm">
            La liste des postes n’est pas encore enregistrée : acceptez-la dans « Postes à mesurer » pour suivre ici la mesure de
            chaque poste.
          </p>
        ) : (
          <>
            <div className="journey-filters" role="group" aria-label="Filtres des postes">
              {filterSelect("poste-filtre-plan", "Plan", address.scope.kind === "plan" ? address.scope.planKey : "all",
                [{ value: "all", label: "Tous les plans" }, ...data.facets.plans.map(({ key: planKey, name, count }) =>
                  ({ value: planKey, label: `${name} (${count})` }))],
                (value) => navigate({ scope: value === "all" ? { kind: "affaire" } : { kind: "plan", planKey: value }, offset: 0 }))}
              {filterSelect("poste-filtre-etat", "État", address.filter.states?.[0] ?? "all",
                [{ value: "all", label: "Tous les états" }, ...ITEM_AGGREGATE_STATES.map((state) =>
                  ({ value: state, label: `${ITEM_STATE_LABELS[state]} (${data.facets.states[state] ?? 0})` }))],
                (value) => navigate({ filter: { ...address.filter, states: value === "all" ? undefined : [value as typeof ITEM_AGGREGATE_STATES[number]] }, offset: 0 }))}
              {filterSelect("poste-filtre-famille", "Famille", address.filter.families?.[0] ?? "all",
                [{ value: "all", label: "Toutes les familles" }, ...data.facets.families.map(({ value, count }) =>
                  ({ value, label: `${value} (${count})` }))],
                (value) => navigate({ filter: { ...address.filter, families: value === "all" ? undefined : [value] }, offset: 0 }))}
              {filterSelect("poste-filtre-lieu", "Localisation", address.filter.locations?.[0] ?? "all",
                [{ value: "all", label: "Toutes les localisations" }, ...data.facets.locations.map(({ value, label: text, count }) =>
                  ({ value, label: `${text} (${count})` }))],
                (value) => navigate({ filter: { ...address.filter, locations: value === "all" ? undefined : [value] }, offset: 0 }))}
              {filterSelect("poste-filtre-decision", "Décision", address.filter.decisions?.[0] ?? "all",
                [{ value: "all", label: "Toutes les décisions" }, ...ITEM_LINE_DECISIONS.map((decision) =>
                  ({ value: decision, label: `${ITEM_DECISION_LABELS[decision]} (${data.facets.decisions[decision] ?? 0})` }))],
                (value) => navigate({ filter: { ...address.filter, decisions: value === "all" ? undefined : [value as typeof ITEM_LINE_DECISIONS[number]] }, offset: 0 }))}
              {hasFilter ? (
                <div className="flex items-end">
                  <Button variant="ghost" size="sm" onClick={() => navigate({ scope: { kind: "affaire" }, filter: {}, offset: 0 })}>
                    Réinitialiser
                  </Button>
                </div>
              ) : null}
            </div>

            {canReview ? (
              <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Gestes sur la sélection">
                <span className="text-sm" data-testid="poste-selection-count">
                  {formatItemCount(counts.total, "poste sélectionné", "postes sélectionnés")} · {label}
                </span>
                {data.page.total > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => void selectFilter()}>
                    Sélectionner les {formatItemCount(data.page.total, "résultat", "résultats")} du filtre
                  </Button>
                ) : null}
                {counts.total > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => updateSelection(emptyItemSelection(address.scope))}>
                    Vider la sélection
                  </Button>
                ) : null}
                <Button size="sm" disabled={counts.accept_measured === 0 || busy}
                  onClick={() => setDialog({ gesture: "accept", intentKey: newIntent() })}>
                  Accepter les mesurés sans anomalie ({counts.accept_measured})
                </Button>
                <Button size="sm" variant="outline" disabled={counts.set_aside === 0 || busy}
                  onClick={() => setDialog({ gesture: "set_aside", intentKey: newIntent() })}>
                  Écarter la sélection ({counts.set_aside})
                </Button>
                <Button size="sm" variant="outline" disabled={counts.remeasure === 0 || busy} onClick={() => void openRemeasure()}>
                  Demander une nouvelle mesure ({counts.remeasure})
                </Button>
                {counts.reinstate > 0 ? (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDialog({ gesture: "reinstate", intentKey: newIntent() })}>
                    Réintégrer ({counts.reinstate})
                  </Button>
                ) : null}
                {entryValues.length > 0 ? (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => setDialog({ gesture: "entry", intentKey: newIntent() })}>
                    Enregistrer les saisies ({entryValues.length})
                  </Button>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Un opérateur du métré de l’affaire peut revoir ces postes.</p>
            )}

            {planScope && sends.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2" data-testid="poste-plan-send">
                {sends.every(({ sent }) => sent) ? (
                  <p className="text-sm" data-testid="poste-plan-sent">
                    Plan « {planName} » envoyé au devis : ses postes ne se modifient plus en bloc.
                  </p>
                ) : null}
                {canReview ? sends.filter(({ sent }) => !sent).map((send) => (
                  <Button key={send.jobId} size="sm" variant="secondary"
                    onClick={() => setSending({ jobId: send.jobId, planName: planName ?? "", scope: scopeKey })}>
                    Envoyer ce plan au devis{sends.length > 1 ? ` (lecture du ${readingDate.format(new Date(send.readAt))})` : ""}
                  </Button>
                )) : null}
              </div>
            ) : null}

            {notice ? (
              <p className={`text-sm ${notice.tone === "danger" ? "text-danger" : notice.tone === "success" ? "text-success" : ""}`}
                data-testid="poste-notice">
                {notice.text}
              </p>
            ) : null}

            {data.page.total === 0 ? (
              <p className="text-sm">
                {hasFilter ? "Aucun poste ne correspond à ces filtres." : "La liste des postes est vide."}
              </p>
            ) : (
              <div className="table-scroll" role="region" aria-label="Tableau des postes" tabIndex={0}>
                {/* A sheet of cells (the shared `data-table` rules): one line per item, one value per cell, a field alone
                    in its cell is the cell, a missing value is a yellow cell, orange only for what blocks. */}
                <table className="data-table w-full whitespace-nowrap [&_td]:px-2.5 [&_th]:px-2.5" aria-label="Postes du métré">
                  <thead>
                    <tr>
                      {canReview ? (
                        <th scope="col" className="w-9">
                          <input type="checkbox" aria-label="Sélectionner les postes de la page" checked={allOnPage}
                            onChange={(event) => {
                              let next = selection;
                              for (const line of pageLines) next = toggleItemSelection(next, line, event.target.checked);
                              updateSelection(next);
                            }} />
                        </th>
                      ) : null}
                      <th scope="col">Poste</th>
                      <th scope="col">Famille</th>
                      <th scope="col">Unité</th>
                      <th scope="col">État</th>
                      <th scope="col">Plans</th>
                      <th scope="col">Observé</th>
                      <th scope="col">Retenu</th>
                      {/* The value and its unit are typed apart, each a cell, under one heading. */}
                      {canReview ? <th scope="colgroup" colSpan={2}>Saisie</th> : null}
                      <th scope="col">DPGF</th>
                      <th scope="col">Motifs</th>
                      <th scope="col">Décision</th>
                      <th scope="col"><span className="sr-only">Détail</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageLines.map((line) => {
                      const draft = drafts[line.itemId];
                      const focused = line.itemId === focusId;
                      const open = expanded[line.itemId] === true;
                      const entryOpen = canReview && line.eligibility.enter_quantity.eligible;
                      const typedQuantity = draft?.quantity ?? "";
                      const typedUnit = draft?.unit ?? "";
                      const quantityUnreadable = typedQuantity.trim() !== "" && parseDecimal(typedQuantity) === null;
                      // The item's expected unit is the entry's unit unless another is typed: a cell without either is missing.
                      const unitMissing = typedQuantity.trim() !== "" && !typedUnit.trim() && !line.expectedUnit;
                      const reasons = [...new Map(line.reasons.map((reason) => [itemReasonLabel(reason), itemReasonBlocks(reason)]))];
                      return (
                        <Fragment key={line.itemId}>
                          <tr id={`poste-ligne-${line.itemId}`} data-testid={`poste-${line.itemId}`} aria-current={focused ? "true" : undefined}
                            className={focused ? FOCUSED_ROW : undefined}>
                            {canReview ? (
                              <td className="w-9">
                                <input type="checkbox" aria-label={`Sélectionner le poste « ${line.label} »`}
                                  checked={line.itemId in selection.items}
                                  onChange={(event) => updateSelection(toggleItemSelection(selection, line, event.target.checked))} />
                              </td>
                            ) : null}
                            <th scope="row" className="text-left font-medium">
                              <button type="button" title={line.label}
                                className="block max-w-[13rem] truncate text-left underline-offset-2 hover:underline"
                                onClick={() => navigate({ focusItemId: line.itemId })}>
                                {line.label}
                              </button>
                            </th>
                            <td className="text-muted-foreground">
                              {/* The item's own section; its whole path (the filter's family) on hover. */}
                              <span className="block max-w-[9rem] truncate" title={line.family ?? undefined}>{line.sectionPath.at(-1)}</span>
                            </td>
                            <td className={line.expectedUnit ? undefined : "bg-warning-subtle"} title={line.expectedUnit ? undefined : "Unité à préciser"}>
                              {line.expectedUnit ?? <span className="sr-only">Unité à préciser</span>}
                            </td>
                            <td>{ITEM_STATE_LABELS[line.state]}</td>
                            <td className="tabular-nums">
                              {line.coverage.expected > 0 ? `${line.coverage.answered}/${line.coverage.expected}` : null}
                            </td>
                            <td className="tabular-nums">
                              {line.observed ? (
                                <>{formatItemQuantity(line.observed.quantity, line.observed.unit)}
                                  {line.observed.partial ? <span className="text-muted-foreground"> partiel</span> : null}</>
                              ) : line.state === "not_found" ? "—" : null}
                            </td>
                            <td className="tabular-nums">
                              {line.retained ? (
                                <>{formatItemQuantity(line.retained.quantity, line.retained.unit)}
                                  {line.retained.source !== "measured" || line.retained.partial ? (
                                    <span className="text-muted-foreground">
                                      {line.retained.source === "entered" ? " saisi" : line.retained.source === "mixed" ? " mesuré et saisi" : ""}
                                      {line.retained.partial ? " partiel" : ""}
                                    </span>
                                  ) : null}</>
                              ) : null}
                            </td>
                            {canReview ? (
                              <td>
                                {entryOpen ? (
                                  <Input size="sm" inputMode="decimal" className="w-20" aria-label={`Quantité saisie pour « ${line.label} »`}
                                    aria-invalid={quantityUnreadable || undefined}
                                    value={typedQuantity} onChange={(event) => setDraft(line, { quantity: event.target.value })} />
                                ) : null}
                              </td>
                            ) : null}
                            {canReview ? (
                              <td className={unitMissing ? "bg-warning-light" : undefined}>
                                {entryOpen ? (
                                  <Input size="sm" className="w-14" aria-label={`Unité saisie pour « ${line.label} »`}
                                    required={unitMissing || undefined} value={typedUnit} placeholder={line.expectedUnit ?? undefined} maxLength={16}
                                    onChange={(event) => setDraft(line, { unit: event.target.value })} />
                                ) : null}
                              </td>
                            ) : null}
                            <td className="tabular-nums">
                              {line.reference ? (
                                <>{line.reference.dpgfReference ? `${line.reference.dpgfReference} · ` : ""}
                                  {formatItemQuantity(line.reference.quantity, line.expectedUnit)}
                                  {line.gap?.percent !== null && line.gap?.percent !== undefined ? (
                                    <><span className="text-muted-foreground"> · </span>
                                      <span className={line.gap.requiresReview ? "font-medium text-warning" : "text-muted-foreground"}
                                        title={line.gap.requiresReview ? "Écart à la DPGF à vérifier" : "Écart à la DPGF"}>
                                        {formatItemPercent(line.gap.percent)}
                                      </span></>
                                  ) : null}</>
                              ) : null}
                            </td>
                            <td>
                              <span className="block max-w-[9rem] truncate" title={reasons.map(([text]) => text).join(" · ") || undefined}>
                                {reasons.map(([text, blocks], index) => (
                                  <Fragment key={text}>
                                    {index > 0 ? <span className="text-muted-foreground"> · </span> : null}
                                    <span className={blocks ? "font-medium text-warning" : "text-muted-foreground"}>{text}</span>
                                  </Fragment>
                                ))}
                              </span>
                            </td>
                            <td>{line.decision === "none" ? null : ITEM_DECISION_LABELS[line.decision]}</td>
                            <td className="whitespace-nowrap">
                              {/* The item on its plan, the second depth of the review; the way back restores this page. */}
                              <Link data-poste-detail-link="" prefetch={false} className="mr-1 text-xs underline underline-offset-2"
                                aria-label={`Détail de « ${line.label} » sur le plan`} href={itemTableLineDetailHref(projectId, line, searchParams)}>
                                Détail
                              </Link>
                              <Button variant="ghost" size="icon-xs" aria-expanded={open} aria-controls={`poste-detail-ligne-${line.itemId}`}
                                aria-label={`Détail du poste « ${line.label} »`}
                                onClick={() => setExpanded((current) => ({ ...current, [line.itemId]: !open }))}>
                                <ChevronDown aria-hidden="true"
                                  className={`transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : "-rotate-90"}`} />
                              </Button>
                            </td>
                          </tr>
                          {open ? (
                            <tr id={`poste-detail-ligne-${line.itemId}`}>
                              <td colSpan={columns} className="whitespace-normal">
                                <ItemTableLineDetail line={line} projectId={projectId} names={data.names} canReview={canReview} busy={busy}
                                  historyVersion={historyVersion} onRefused={withdrawOnRefusal}
                                  onIncludeEntry={(target) => void runCommand({ command_version: ITEM_REVIEW_COMMAND_VERSION,
                                    intent_key: newIntent(), scope: address.scope, gesture: "include_entry", targets: [target.targets] }, "inclus")} />
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {data.page.total > 0 ? (
              <nav aria-label="Pagination des postes" className="flex flex-wrap items-center gap-4 text-sm">
                <span>
                  {data.page.offset + 1}–{Math.min(data.page.offset + data.page.limit, data.page.total)} sur{" "}
                  {formatItemCount(data.page.total, "poste", "postes")}
                </span>
                {data.page.offset > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => navigate({ offset: Math.max(0, data.page.offset - data.page.limit), focusItemId: null })}>
                    Page précédente
                  </Button>
                ) : null}
                {data.page.offset + data.page.limit < data.page.total ? (
                  <Button variant="ghost" size="sm" onClick={() => navigate({ offset: data.page.offset + data.page.limit, focusItemId: null })}>
                    Page suivante
                  </Button>
                ) : null}
                <label className="flex items-center gap-2 whitespace-nowrap">
                  Postes par page
                  <NativeSelect size="sm" className="w-20" value={String(address.limit)}
                    onChange={(event) => navigate({ limit: Number(event.target.value) as ItemTableAddress["limit"], offset: 0 })}>
                    {ITEM_TABLE_PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
                  </NativeSelect>
                </label>
              </nav>
            ) : null}
          </>
        )}
      </div>

      {dialog?.gesture === "accept" ? (
        <AcceptMeasuredDialog scopeLabel={label} busy={busy} total={counts.total} eligible={counts.accept_measured}
          onClose={() => setDialog(null)}
          onConfirm={() => void runCommand({ ...base(dialog.intentKey), gesture: "accept_measured" }, "accepté", dropApplied)} />
      ) : null}
      {dialog?.gesture === "set_aside" ? (
        <SetAsideDialog scopeLabel={label} busy={busy} total={counts.total} eligible={counts.set_aside}
          answers={Object.values(selection.items).filter(({ eligible }) => eligible.includes("set_aside"))
            .reduce((total, { target }) => total + target.answers.length, 0)}
          onClose={() => setDialog(null)}
          onConfirm={(reason: ItemSetAsideReason, note: string | null) => void runCommand({ ...base(dialog.intentKey), gesture: "set_aside",
            reason, ...(note ? { note } : {}) }, "écarté", dropApplied)} />
      ) : null}
      {dialog?.gesture === "reinstate" ? (
        <ReinstateDialog scopeLabel={label} busy={busy} eligible={counts.reinstate} onClose={() => setDialog(null)}
          onConfirm={() => void runCommand({ ...base(dialog.intentKey), gesture: "reinstate" }, "réintégré", dropApplied)} />
      ) : null}
      {dialog?.gesture === "entry" ? (
        <EntryDialog scopeLabel={label} busy={busy} values={entryValues} onClose={() => setDialog(null)}
          onConfirm={(entry: QuantityEntry) => void runCommand({ command_version: ITEM_REVIEW_COMMAND_VERSION, intent_key: dialog.intentKey,
            scope: address.scope, gesture: "enter_quantity", targets: entryValues.map(({ target }) => target),
            values: entryValues.map(({ itemId, quantity, unit }) => ({ item_id: itemId, quantity, unit })), entry }, "saisi",
          (result) => setDrafts((current) => {
            const copy = { ...current };
            for (const { itemId } of result.applied) delete copy[itemId];
            return copy;
          }))} />
      ) : null}
      {/* Withdrawn on the freshest read of the table: another scope, the right gone, or its plan now sent. */}
      {sending && sending.scope === scopeKey && canReview && !sends.some((send) => send.jobId === sending.jobId && send.sent) ? (
        <TakeoffItemSendDialog open jobId={sending.jobId} planName={sending.planName} viewerKey={viewerKey}
          onOpenChange={(open) => { if (!open) setSending(null); }} onSent={() => void refresh()} />
      ) : null}
      {dialog?.gesture === "remeasure" ? (
        <RemeasureDialog scopeLabel={label} busy={busy} preview={preview.value} loadError={preview.error}
          onClose={() => setDialog(null)} onConfirm={() => void confirmRemeasure()} />
      ) : null}
    </JourneyPanel>
  );
}
