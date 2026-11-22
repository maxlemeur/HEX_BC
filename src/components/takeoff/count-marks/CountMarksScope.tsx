"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useCompletions, type Completion, type CompletionTarget } from "@/components/takeoff/item-detail/useCompletions";
import { isTakeoffApiError } from "@/lib/takeoff/client-http";
import {
  TAKEOFF_COUNT_MARK_EDIT_REFUSALS,
  takeoffCountMarkEditRefusal,
  type TakeoffCountMark,
  type TakeoffCountMarkGesture,
  type TakeoffCountMarkRemovalReason,
  type TakeoffCountMarkSummary,
  type TakeoffCountPageGeometry,
} from "@/lib/takeoff/count-marks";
import { createCountMarksReader, type CountMarksReader } from "@/lib/takeoff/count-marks-client";
import {
  countMarkDuplicateDetailSchema,
  TAKEOFF_COUNT_MARKS_PLAN_SENT,
  TAKEOFF_COUNT_MARKS_PLAN_SENT_MESSAGE,
  TAKEOFF_COUNT_MARKS_READ_CHANGING,
  TAKEOFF_COUNT_MARKS_READ_CHANGING_MESSAGE,
  type CountMarksView,
} from "@/lib/takeoff/count-marks-contracts";
import {
  COUNT_MARK_SHOWN_STATE_LABELS,
  countMarksChange,
  countMarksChangeSentence,
  countPageGeometry,
  draftAdd,
  draftCommand,
  draftDecide,
  draftDistinct,
  draftCommandEntries,
  draftMarkId,
  draftMove,
  draftReattribute,
  draftRemove,
  draftSameAs,
  draftVerify,
  draftWithout,
  emptyCountMarkDraft,
  isDraftMarkId,
  rebaseCountMarkDraft,
  retainedNeighbours,
  sameCountPage,
  shownCountMarks,
  staleDraftEntries,
  type CountMarkDraft,
  type CountMarkObjectAnswer,
  type CountMarkPageSize,
  type CountMarkPoint,
  type CountMarkShown,
  type CountRegion,
} from "@/lib/takeoff/count-marks-view";
import type { PdfPageRotation } from "@/lib/takeoff/pdf-page-geometry";

/**
 * The counted marks of the answer the detail of an item shows (lot 5): one state for the layer on the plan, the
 * accessible list and the history, fed by the marks' readers and changed only by their edit command.
 *
 * - The marks of the page shown are read by lots of 1,000 (five lots at most without asking): the server's total is said
 *   apart from the number loaded. Removed marks are read on demand and never drawn.
 * - A correction session holds N gestures; it is kept for the tab by member and answer (a reload, another item, another
 *   page lose nothing) and saved in one command under the revision it was made on and one intention key.
 * - A stale revision reads the marks again, says what changed and keeps every gesture as typed, to be saved again.
 * - Any refused read (no session, no right, no affaire) withdraws the layer, the list and the history, as the table of
 *   items withdraws itself; a page outside the answer's scope is not read.
 * - Every read of the screen (the page's lots, its removed marks, the history, the count) is of one revision, or the
 *   screen reads again, the gestures kept and the member told.
 * - What ends later (a save, a read) is the detail's one rule (useCompletions): addressed to the answer, and for a read
 *   the page, that started it; it updates what it was for (that member's session on that answer) and touches what is
 *   shown only while it is still that, a failure as a success.
 */

const PAGE_LOTS_WITHOUT_ASKING = 5;
/** The states of the marks a member reviews on the page: a newer reading's marks (pending) are retained from there. */
const REVIEWED_STATES = ["proposed", "to_attribute", "retained", "pending"] as const;
const IN_FLIGHT_NOTICE = "Ce geste est en cours d’enregistrement : modifiez-le une fois enregistré.";
const PAGE_NOT_SHOWN_NOTICE = "Une page se vérifie sur son plan affiché : ouvrez-la avant de la déclarer vérifiée.";
const PAGE_NOT_DRAWN_NOTICE = "Le plan de cette page n’est pas encore dessiné : déclarez-la vérifiée une fois affichée.";
const NOTHING_IN_FRAME_NOTICE = "Aucune partie de la page n’est dans le cadre : ramenez-la pour y pointer un repère au clavier.";
const UNSAVED_REATTRIBUTION_NOTICE = "Enregistrez d’abord cet ajout : un repère non enregistré ne s’affecte pas à un autre poste.";

/** Lots read at two revisions, again: no view is published; what was shown stays, and the member is told. */
class ChangingMarksError extends Error {}

export type CountMarksAnswer = {
  answerId: string;
  jobId: string;
  /** The pages the answer's reading covered (searched and unreadable): the only pages it has marks on. */
  scopePages: readonly number[];
};

export type CountMarksTarget = { answerId: string; itemId: string; label: string };

/** What the plan shows of the page now: its size at scale 1 and its geometry, and how to bring a point to the centre. */
export type CountMarksPlanFrame = {
  page: number;
  size: CountMarkPageSize;
  geometry: { viewBox: readonly [number, number, number, number]; rotation: PdfPageRotation; userUnit: number } | null;
  centre: (point: CountMarkPoint) => void;
  /** The part of the page the frame shows, normalised: where a mark placed by the keyboard starts; null when none is. */
  visible: CountRegion | null;
  /** Whether the sheet of this page is drawn (its render completed): a page is verified on its sheet only. */
  painted: boolean;
};

type Loaded = {
  answerId: string;
  page: number;
  view: CountMarksView;
  marks: TakeoffCountMark[];
  nextAfter: string | null;
  lots: number;
};

export type CountMarksMode =
  | { kind: "idle" }
  | { kind: "add"; point: CountMarkPoint }
  | { kind: "move"; markId: string; point: CountMarkPoint };

/** The member's word asked before a gesture is put in the session: never decided by the screen. */
export type CountMarksQuestion = {
  kind: "add" | "move" | "retain" | "restore";
  /** The mark the gesture is on; null for an add. */
  mark: CountMarkShown | null;
  point: CountMarkPoint;
  neighbours: CountMarkShown[];
};

/**
 * A gesture of the session the database refused beside retained marks it named (a possible duplicate): the member says,
 * about each, whether it is the same object or a distinct one. twins: marks the database knows; additions: marks added in
 * the session (by their key).
 */
export type CountMarksRefusedQuestion = { entryId: string; op: TakeoffCountMarkGesture["op"]; twins: string[]; additions: string[] };

export type CountMarksStatus = "none" | "outside" | "loading" | "ready" | "refused" | "error" | "changing";

/** The dialog a gesture opens, from the list or the plan: the reason of a removal, the item a mark is given to. */
export type CountMarksDialog = { kind: "remove" | "reattribute"; markId: string } | null;

type Session = { viewerId: string; draft: CountMarkDraft };

/** The removed marks of the page, read at one revision (the page's). */
type Removed = { marks: TakeoffCountMark[]; total: number; nextAfter: string | null; revision: number };
const removedOf = (read: CountMarksView): Removed => ({ marks: read.marks, total: read.total, nextAfter: read.nextAfter,
  revision: read.revision });

/** Whether a change of the session would change a gesture being sent (one of `sent`, as it stands in `before`). */
function changesSent(before: CountMarkDraft, after: CountMarkDraft, sent: ReadonlySet<string>) {
  return before.entries.some((entry) => sent.has(entry.id) && after.entries.find(({ id }) => id === entry.id) !== entry);
}

export type CountMarksContextValue = {
  status: CountMarksStatus;
  answer: CountMarksAnswer | null;
  page: number;
  loaded: Loaded | null;
  reloading: boolean;
  shown: CountMarkShown[];
  removed: Removed | null;
  refusedQuestion: CountMarksRefusedQuestion | null;
  answerRefused: (answer: { object: "same"; sameAs: string } | { object: "distinct" } | "cancel") => void;
  /** The gestures being sent: they are changed once the save ends. */
  inFlight: ReadonlySet<string>;
  loadMoreRemoved: () => void;
  retry: () => void;
  draft: CountMarkDraft | null;
  staleEntries: Set<string>;
  askWords: boolean;
  activeId: string | null;
  mode: CountMarksMode;
  question: CountMarksQuestion | null;
  notice: string;
  announcement: string;
  saving: boolean;
  canEdit: boolean;
  /** Why the marks cannot be pointed on this page drawing (other bytes than those recorded), or null. */
  pointingBlocked: string | null;
  planFrame: CountMarksPlanFrame | null;
  itemLabels: Record<string, string>;
  targets: CountMarksTarget[];
  historyVersion: number;
  pageSize: CountMarkPageSize | null;
  summary: TakeoffCountMarkSummary | null;
  reader: CountMarksReader;
  dialog: CountMarksDialog;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  openDialog: (kind: "remove" | "reattribute", markId?: string | null) => void;
  closeDialog: () => void;
  /** A refused read met elsewhere (the history): everything is withdrawn. Returns whether it was one. */
  refuse: (error: unknown) => boolean;
  setPlanFrame: (frame: CountMarksPlanFrame | null) => void;
  select: (markId: string | null, options?: { centre?: boolean; announce?: boolean }) => void;
  step: (step: -1 | 1 | "first" | "last") => void;
  startAdd: () => void;
  startMove: (markId?: string | null) => void;
  movePointer: (point: CountMarkPoint) => void;
  place: (point?: CountMarkPoint) => void;
  cancelMode: () => void;
  answerQuestion: (word: CountMarkObjectAnswer | "cancel") => void;
  remove: (markId: string, reason: TakeoffCountMarkRemovalReason, note: string | null) => void;
  decide: (op: "retain" | "restore", markId?: string | null) => void;
  reattribute: (markId: string, target: CountMarksTarget) => Promise<void>;
  verifyPage: () => void;
  withoutEntry: (id: string) => void;
  giveDistinct: (id: string) => void;
  save: () => Promise<void>;
  discard: () => void;
  loadMore: () => void;
  showRemoved: (show: boolean) => void;
  dismissNotice: () => void;
  /** The screen's completions (the detail's rule): what started for this answer, and the screen it belongs to. */
  start: (target: CompletionTarget) => Completion;
  screen: string;
  /** Reads the screen again (a read of it met a later revision): the gestures kept, the member told. */
  readAgain: () => void;
};

const CountMarksContext = createContext<CountMarksContextValue | null>(null);

export function useCountMarks() {
  return useContext(CountMarksContext);
}

const newKey = () => crypto.randomUUID();

const sessionKey = (viewerId: string, answerId: string) => `metre-reperes:${viewerId}:${answerId}`;

function readSession(viewerId: string, answerId: string): CountMarkDraft | null {
  try {
    const stored = window.sessionStorage.getItem(sessionKey(viewerId, answerId));
    if (!stored) return null;
    const draft = JSON.parse(stored) as CountMarkDraft;
    return draft && draft.answerId === answerId && Array.isArray(draft.entries) && draft.entries.length ? draft : null;
  } catch {
    return null;
  }
}

function storeSession(viewerId: string, draft: CountMarkDraft) {
  try {
    if (draft.entries.length) window.sessionStorage.setItem(sessionKey(viewerId, draft.answerId), JSON.stringify(draft));
    else window.sessionStorage.removeItem(sessionKey(viewerId, draft.answerId));
  } catch {
    // A tab without storage keeps the session in memory only.
  }
}

const isReadRefusal = (error: unknown) => isTakeoffApiError(error) && [401, 403, 404].includes(error.status);
/** Reads that kept crossing revisions, here or on the server (which compares a page and its count). */
const isChanging = (error: unknown) => error instanceof ChangingMarksError
  || (isTakeoffApiError(error) && error.code === TAKEOFF_COUNT_MARKS_READ_CHANGING);

/** A refusal of the command, worded from its code only. */
function refusalSentence(error: unknown) {
  if (!isTakeoffApiError(error)) return "La modification n’a pas pu être enregistrée. Réessayez.";
  if (error.code === TAKEOFF_COUNT_MARKS_PLAN_SENT) return TAKEOFF_COUNT_MARKS_PLAN_SENT_MESSAGE;
  const code = takeoffCountMarkEditRefusal(error.code);
  if (code) return TAKEOFF_COUNT_MARK_EDIT_REFUSALS[code];
  if (error.status === 0) return "La modification n’a pas pu être envoyée. Réessayez : elle ne sera pas enregistrée deux fois.";
  return "La modification n’a pas pu être enregistrée. Réessayez.";
}

export function CountMarksScope({ projectId, answer, page, itemLabels, targets, reader: given, onSaved, children }: {
  projectId: string;
  answer: CountMarksAnswer | null;
  page: number;
  itemLabels: Record<string, string>;
  targets: CountMarksTarget[];
  /** The readers to use; by default the affaire's routes. */
  reader?: CountMarksReader;
  /**
   * Called once a save changed answers' marks, with every answer its command named (the one saved, maybe no longer the
   * one shown, and the others a move or a reattribution changed): what reads them (their items' decisions, their
   * quantities) reads again.
   */
  onSaved?: (answerIds: string[]) => void;
  children: ReactNode;
}) {
  const reader = useMemo(() => given ?? createCountMarksReader(projectId), [given, projectId]);
  const answerId = answer?.answerId ?? null;
  const inScope = answer ? answer.scopePages.includes(page) : false;

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failure, setFailure] = useState<"refused" | "error" | "changing" | null>(null);
  const [reloading, setReloading] = useState(false);
  const [removed, setRemoved] = useState<Removed | null>(null);
  const [refusedQuestion, setRefusedQuestion] = useState<CountMarksRefusedQuestion | null>(null);
  const [inFlight, setInFlight] = useState<ReadonlySet<string>>(() => new Set());
  const [attempt, setAttempt] = useState(0);
  const [wantRemoved, setWantRemoved] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<CountMarksMode>({ kind: "idle" });
  const [question, setQuestion] = useState<CountMarksQuestion | null>(null);
  const [notice, setNotice] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [saving, setSaving] = useState(false);
  const [askWords, setAskWords] = useState(false);
  const [planFrame, setPlanFrame] = useState<CountMarksPlanFrame | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [refused, setRefused] = useState(false);
  const [dialog, setDialog] = useState<CountMarksDialog>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const frameRef = useRef<CountMarksPlanFrame | null>(null);
  frameRef.current = planFrame;

  // What is shown: a completion touches it only while it is still what started it.
  const screen = projectId;
  const start = useCompletions({ screen, item: answerId, reading: String(page) });
  const shownRef = useRef({ answerId, page, inScope });
  useLayoutEffect(() => {
    shownRef.current = { answerId, page, inScope };
  });

  // A refusal belongs to the answer it was met on; a new answer is read from nothing.
  const [refusedFor, setRefusedFor] = useState(answerId);
  if (refusedFor !== answerId) {
    setRefusedFor(answerId);
    setRefused(false);
    setLoaded(null);
    setRemoved(null);
    setSession(null);
    setActiveId(null);
    setMode({ kind: "idle" });
    setQuestion(null);
    setNotice("");
  }

  const withdraw = useCallback(() => {
    setRefused(true);
    setLoaded(null);
    setRemoved(null);
    setMode({ kind: "idle" });
    setQuestion(null);
    setDialog(null);
  }, []);
  const refuse = useCallback((error: unknown) => {
    if (!isReadRefusal(error)) return false;
    withdraw();
    return true;
  }, [withdraw]);

  /**
   * Every lot of the page's marks up to the bound, or the next lot after those loaded. Lots read at another revision than
   * the first are read again from the start once: the marks shown are of one revision.
   */
  const readLots = useCallback(async (target: { answerId: string; page: number }, from: Loaded | null): Promise<Loaded> => {
    for (let attempt = 0; ; attempt += 1) {
      const start = attempt === 0 ? from : null;
      const bound = start ? start.lots + 1 : PAGE_LOTS_WITHOUT_ASKING;
      let view = await reader.readPage({ answerId: target.answerId, page: target.page, after: start?.nextAfter ?? null,
        states: REVIEWED_STATES });
      const revision = start?.view.revision ?? view.revision;
      const marks = [...(start?.marks ?? []), ...view.marks];
      const names = { ...(start?.view.names ?? {}), ...view.names };
      let lots = (start?.lots ?? 0) + 1;
      let mixed = view.revision !== revision;
      while (!mixed && view.nextAfter && lots < bound) {
        view = await reader.readPage({ answerId: target.answerId, page: target.page, after: view.nextAfter, states: REVIEWED_STATES });
        marks.push(...view.marks);
        Object.assign(names, view.names);
        lots += 1;
        mixed = view.revision !== revision;
      }
      if (mixed && attempt === 0) continue;
      if (mixed) throw new ChangingMarksError();
      return { answerId: target.answerId, page: target.page, view: { ...view, names, marks: [], loaded: marks.length },
        marks, nextAfter: view.nextAfter, lots };
    }
  }, [reader]);

  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const wantRemovedRef = useRef(wantRemoved);
  wantRemovedRef.current = wantRemoved;
  // The session as last written: every change of it goes through writeSession, so that two changes in one event see
  // each other.
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const writeSession = useCallback((next: Session | null) => {
    sessionRef.current = next;
    setSession(next);
  }, []);

  /**
   * The page's lots and, when they are shown, its removed marks, at one revision: read again once while they differ,
   * then the screen says they are changing.
   */
  const readScreen = useCallback(async (target: { answerId: string; page: number }, withRemoved: boolean) => {
    for (let attempt = 0; ; attempt += 1) {
      const next = await readLots(target, null);
      if (!withRemoved) return { next, removed: null };
      const read = await reader.readPage({ answerId: target.answerId, page: target.page, states: ["removed"] });
      if (read.revision === next.view.revision) return { next, removed: removedOf(read) };
      if (attempt > 0) throw new ChangingMarksError();
    }
  }, [readLots, reader]);

  /** What is shown read again (its page and, if shown, its removed marks); what changed is said when asked. */
  const reload = useCallback(async (options: { say?: boolean } = {}) => {
    const target = shownRef.current;
    if (!target.answerId || !target.inScope) return null;
    const answer = target.answerId;
    const done = start({ screen, item: answer, reading: String(target.page) });
    setReloading(true);
    try {
      const { next, removed: read } = await readScreen({ answerId: answer, page: target.page }, wantRemovedRef.current);
      if (!done.current()) return null;
      const previous = loadedRef.current;
      setLoaded(next);
      setRemoved(read);
      setFailure(null);
      if (options.say && previous && previous.answerId === next.answerId && previous.page === next.page) {
        const kept = sessionRef.current?.draft.answerId === answer ? sessionRef.current.draft.entries.length : 0;
        setNotice(countMarksChangeSentence(countMarksChange(previous.marks, next.marks), kept));
      }
      return next;
    } catch (error) {
      if (!done.current()) return null;
      if (isReadRefusal(error)) withdraw();
      else if (isChanging(error)) setNotice(TAKEOFF_COUNT_MARKS_READ_CHANGING_MESSAGE);
      else setFailure("error");
      return null;
    } finally {
      if (done.current()) setReloading(false);
    }
  }, [readScreen, screen, start, withdraw]);
  const readAgain = useCallback(() => {
    void reload({ say: true });
  }, [reload]);

  // The page's marks, read when the answer or the page changes.
  useEffect(() => {
    if (!answerId || !inScope || refused) return;
    const done = start({ screen, item: answerId, reading: String(page) });
    let active = true;
    setReloading(true);
    readScreen({ answerId, page }, wantRemovedRef.current).then(({ next, removed: read }) => {
      if (!active || !done.current()) return;
      setLoaded(next);
      setRemoved(read);
      setFailure(null);
      // The session of this member on this answer, kept for the tab.
      const value = sessionRef.current;
      if (!value || value.draft.answerId !== answerId || value.viewerId !== next.view.viewerId) {
        writeSession({ viewerId: next.view.viewerId, draft: readSession(next.view.viewerId, answerId)
          ?? emptyCountMarkDraft(answerId, next.view.revision, newKey()) });
      }
    }).catch((error: unknown) => {
      if (!active || !done.current()) return;
      if (isReadRefusal(error)) withdraw();
      else setFailure(isChanging(error) ? "changing" : "error");
    }).finally(() => {
      if (active && done.current()) setReloading(false);
    });
    return () => {
      active = false;
    };
  }, [answerId, page, inScope, refused, readScreen, screen, start, withdraw, writeSession, attempt]);

  const current = loaded && loaded.answerId === answerId && loaded.page === page ? loaded : null;
  const draft = session && session.draft.answerId === answerId ? session.draft : null;

  // While a save is on its way, a member goes on making gestures; the gestures being sent are not changed until it ends.
  const savingRef = useRef(false);
  const inFlightRef = useRef<ReadonlySet<string>>(new Set());
  /**
   * A change of the session shown, stored for the tab; refused (and said) when it would change a gesture being sent,
   * whatever the path (a key, a dialog, a question): only the save's own reply changes those. Returns whether it applied.
   */
  const updateDraft = useCallback((change: (draft: CountMarkDraft) => CountMarkDraft, options: { bySave?: boolean } = {}) => {
    const value = sessionRef.current;
    if (!value) return false;
    // A session begins on the revision read last: an empty one never carries an older one.
    const read = loadedRef.current;
    const base = value.draft.entries.length || !read || read.answerId !== value.draft.answerId ? value.draft
      : { ...value.draft, revision: read.view.revision };
    const next = change(base);
    if (!options.bySave && changesSent(base, next, inFlightRef.current)) {
      setNotice(IN_FLIGHT_NOTICE);
      return false;
    }
    storeSession(value.viewerId, next);
    writeSession({ ...value, draft: next });
    return true;
  }, [writeSession]);

  /** Whether a gesture would change a mark added by a gesture being sent; said, and refused, then. */
  const touchesInFlight = useCallback((markId: string | null | undefined) => {
    if (!markId || !isDraftMarkId(markId) || !inFlightRef.current.has(markId.slice("draft:".length))) return false;
    setNotice(IN_FLIGHT_NOTICE);
    return true;
  }, []);

  // A page closed or reloaded with gestures not saved asks to keep or leave them (the session stays for the tab).
  const unsaved = (draft?.entries.length ?? 0) > 0;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const shown = useMemo(() => (current ? shownCountMarks(current.marks, draft, page) : []), [current, draft, page]);
  const staleEntries = useMemo(() => staleDraftEntries(draft, current?.marks ?? [], page), [current, draft, page]);

  const recorded = current?.view.geometry ?? null;
  const drawn = planFrame && planFrame.page === page ? planFrame : null;
  const drawnSize = drawn?.size ?? null;
  const pageSize = useMemo<CountMarkPageSize | null>(() => (recorded ? { width: recorded.width, height: recorded.height } : drawnSize),
    [drawnSize, recorded]);
  const pointingBlocked = recorded && drawn && !sameCountPage(recorded, drawn.size)
    ? "Ce plan ne correspond plus à la page sur laquelle ces repères ont été posés : ils se consultent sans pointer." : null;
  const canEdit = Boolean(current?.view.edit.allowed) && !refused;

  const markOf = useCallback((markId: string | null) => (markId ? shown.find((mark) => mark.markId === markId) ?? null : null), [shown]);
  const describe = useCallback((mark: CountMarkShown) => {
    const index = shown.indexOf(mark);
    return `Repère ${index + 1}, page ${page}, ${mark.origin === "manual" ? "ajouté à la main" : "proposé par l’analyse"} : `
      + `${COUNT_MARK_SHOWN_STATE_LABELS[mark.state].toLowerCase()}${mark.unsaved ? " (non enregistré)" : ""}`;
  }, [page, shown]);

  const select = useCallback((markId: string | null, options: { centre?: boolean; announce?: boolean } = {}) => {
    setActiveId(markId);
    const mark = markOf(markId);
    if (mark && options.centre !== false) frameRef.current?.centre(mark);
    if (mark && options.announce !== false) setAnnouncement(describe(mark));
  }, [describe, markOf]);

  const listed = useMemo(() => shown.filter((mark) => mark.state !== "removed" && mark.state !== "withdrawn"), [shown]);
  const step = useCallback((by: -1 | 1 | "first" | "last") => {
    if (!listed.length) return;
    const index = listed.findIndex((mark) => mark.markId === activeId);
    const next = by === "first" ? 0 : by === "last" ? listed.length - 1
      : index < 0 ? (by > 0 ? 0 : listed.length - 1) : Math.min(listed.length - 1, Math.max(0, index + by));
    select(listed[next]!.markId);
  }, [activeId, listed, select]);

  const refuseGesture = useCallback(() => {
    if (!current) return true;
    if (!canEdit) {
      setNotice(current.view.edit.reason === "sent" ? TAKEOFF_COUNT_MARKS_PLAN_SENT_MESSAGE
        : current.view.edit.reason === "replaced" ? "Une lecture plus récente de ce poste sur ce plan a remplacé celle-ci : ses repères se consultent seulement."
          : "Un opérateur du métré de l’affaire peut corriger ces repères.");
      return true;
    }
    return false;
  }, [canEdit, current]);

  const startAdd = useCallback(() => {
    if (refuseGesture()) return;
    if (pointingBlocked || !drawn) {
      setNotice(pointingBlocked ?? "Le plan n’est pas affiché : un repère se pose sur la page dessinée.");
      return;
    }
    // By the keyboard, a mark starts at the centre of the part of the page in the frame: none, and none is placed.
    const region = drawn.visible;
    if (!region) {
      setNotice(NOTHING_IN_FRAME_NOTICE);
      return;
    }
    setMode({ kind: "add", point: { x: (region.x0 + region.x1) / 2, y: (region.y0 + region.y1) / 2 } });
    setAnnouncement("Ajout d’un repère : flèches pour déplacer le réticule, Entrée pour poser, Échap pour quitter.");
  }, [drawn, pointingBlocked, refuseGesture]);

  const startMove = useCallback((markId?: string | null) => {
    if (refuseGesture()) return;
    const mark = markOf(markId ?? activeId);
    if (!mark) {
      setNotice("Choisissez d’abord le repère à déplacer.");
      return;
    }
    if (pointingBlocked || !drawn) {
      setNotice(pointingBlocked ?? "Le plan n’est pas affiché : un repère se déplace sur la page dessinée.");
      return;
    }
    if (!drawn.visible) {
      setNotice(NOTHING_IN_FRAME_NOTICE);
      return;
    }
    if (mark.state !== "retained" && mark.state !== "proposed" && mark.state !== "to_attribute") {
      setNotice("Retenez d’abord ce repère pour le déplacer.");
      return;
    }
    setActiveId(mark.markId);
    setMode({ kind: "move", markId: mark.markId, point: { x: mark.x, y: mark.y } });
    setAnnouncement("Déplacement du repère : flèches pour le déplacer, Entrée pour le poser, Échap pour annuler.");
  }, [activeId, drawn, markOf, pointingBlocked, refuseGesture]);

  const movePointer = useCallback((point: CountMarkPoint) => {
    setMode((value) => (value.kind === "idle" ? value : { ...value, point }));
  }, []);

  const cancelMode = useCallback(() => {
    setMode({ kind: "idle" });
    setQuestion(null);
  }, []);

  const geometryForAdd = useCallback((): TakeoffCountPageGeometry | null => {
    if (current?.view.geometry || !drawn?.geometry) return null;
    return countPageGeometry(drawn.geometry);
  }, [current, drawn]);

  const others = useCallback((mark: CountMarkShown) =>
    Object.fromEntries((mark.mark?.others ?? []).map((other) => [other.answerId, other.revision])), []);

  const commit = useCallback((kind: CountMarksQuestion["kind"], mark: CountMarkShown | null, point: CountMarkPoint,
    word: CountMarkObjectAnswer) => {
    const intentKey = newKey();
    if (kind === "add") {
      const key = newKey();
      updateDraft((value) => draftAdd(value, { key, page, point, geometry: geometryForAdd(), distinct: word?.object === "distinct" }, intentKey));
      setActiveId(`draft:${key}`);
      setAnnouncement(`Repère ajouté page ${page}, non enregistré.`);
      return;
    }
    if (!mark) return;
    if (kind === "move") {
      updateDraft((value) => draftMove(value, { id: newKey(), markId: mark.markId, page, state: mark.state, point,
        distinct: word?.object === "distinct", others: others(mark) }, intentKey));
      setAnnouncement(`Repère déplacé page ${page}, non enregistré.`);
      return;
    }
    const restoredTo = mark.mark?.priorState ?? "proposed";
    updateDraft((value) => draftDecide(value, { id: newKey(), op: kind, markId: mark.markId, page, state: mark.state, restoredTo,
      word }, intentKey));
    setAnnouncement(word?.object === "same" ? "Même objet qu’un repère retenu, non enregistré."
      : kind === "retain" ? "Repère retenu, non enregistré." : "Repère rétabli, non enregistré.");
  }, [geometryForAdd, others, page, updateDraft]);

  /** A gesture near a retained mark asks the member's word first; elsewhere it goes into the session at once. */
  const propose = useCallback((kind: CountMarksQuestion["kind"], mark: CountMarkShown | null, point: CountMarkPoint) => {
    const neighbours = retainedNeighbours(shown, point, pageSize, mark?.markId ?? null);
    if (neighbours.length) {
      setQuestion({ kind, mark, point, neighbours });
      return;
    }
    commit(kind, mark, point, null);
  }, [commit, pageSize, shown]);

  const place = useCallback((point?: CountMarkPoint) => {
    if (mode.kind === "idle") return;
    // Placed by the keyboard (no point given), a mark needs a part of the page in the frame.
    if (!point && !frameRef.current?.visible) {
      setNotice(NOTHING_IN_FRAME_NOTICE);
      return;
    }
    const at = point ?? mode.point;
    if (mode.kind === "add") propose("add", null, at);
    else if (!touchesInFlight(mode.markId)) propose("move", markOf(mode.markId), at);
    setMode({ kind: "idle" });
  }, [markOf, mode, propose, touchesInFlight]);

  const answerQuestion = useCallback((word: CountMarkObjectAnswer | "cancel") => {
    const asked = question;
    setQuestion(null);
    if (!asked || word === "cancel") return;
    // « Same object » for an add or a move: nothing is added or moved there; the retained mark stands for it.
    if (word?.object === "same" && (asked.kind === "add" || asked.kind === "move")) {
      setAnnouncement("Même objet qu’un repère retenu : rien n’est ajouté.");
      return;
    }
    // The same object as an addition not saved yet: the addition is withdrawn and the mark retained stands for the object
    // (an unsaved mark has no identity the command could name). Another retained neighbour still asks its own word.
    if (word?.object === "same" && isDraftMarkId(word.sameAs)) {
      const addition = word.sameAs;
      // An addition being sent is not withdrawn: the member answers again once it is saved.
      const withdrawn = updateDraft((value) => draftRemove(value, { id: newKey(), markId: addition, page, state: "retained",
        reason: "duplicate", note: null }, newKey()));
      if (!withdrawn) return;
      const others = asked.neighbours.filter((neighbour) => neighbour.markId !== addition);
      if (others.length) setQuestion({ ...asked, neighbours: others });
      else commit(asked.kind, asked.mark, asked.point, null);
      setAnnouncement("Même objet que votre ajout non enregistré : l’ajout est retiré.");
      return;
    }
    commit(asked.kind, asked.mark, asked.point, word);
  }, [commit, page, question, updateDraft]);

  const remove = useCallback((markId: string, reason: TakeoffCountMarkRemovalReason, note: string | null) => {
    if (refuseGesture() || touchesInFlight(markId)) return;
    const mark = markOf(markId);
    if (!mark) return;
    updateDraft((value) => draftRemove(value, { id: newKey(), markId, page, state: mark.state, reason, note }, newKey()));
    setAnnouncement(`Repère retiré page ${page}, non enregistré.`);
  }, [markOf, page, refuseGesture, touchesInFlight, updateDraft]);

  const removedMarks = removed?.marks;
  const decide = useCallback((op: "retain" | "restore", markId?: string | null) => {
    if (refuseGesture()) return;
    const id = markId ?? activeId;
    const fromRemoved = removedMarks?.find((mark) => mark.markId === id);
    const mark = markOf(id ?? null) ?? (fromRemoved ? { markId: fromRemoved.markId, x: fromRemoved.x, y: fromRemoved.y,
      state: fromRemoved.state, origin: fromRemoved.origin, mark: fromRemoved, unsaved: false } satisfies CountMarkShown : null);
    if (!mark) {
      setNotice(op === "retain" ? "Choisissez d’abord le repère à retenir." : "Choisissez d’abord le repère à rétablir.");
      return;
    }
    if (op === "retain" && !(mark.state === "proposed" || mark.state === "to_attribute" || mark.state === "pending")) {
      setNotice("Seul un repère proposé, à attribuer ou d’une nouvelle lecture se retient.");
      return;
    }
    if (op === "restore" && mark.state !== "removed") {
      setNotice("Seul un repère retiré se rétablit.");
      return;
    }
    // A retain or a restore leaving the mark retained beside a retained one asks the member's word.
    const restoresRetained = op === "retain" || (mark.mark?.priorState ?? "proposed") === "retained";
    if (restoresRetained) propose(op, mark, mark);
    else commit(op, mark, mark, null);
  }, [activeId, commit, markOf, propose, refuseGesture, removedMarks]);

  const reattribute = useCallback(async (markId: string, target: CountMarksTarget) => {
    if (refuseGesture()) return;
    // A mark not saved yet has no identity the command could name: it is saved first.
    if (isDraftMarkId(markId)) {
      setNotice(UNSAVED_REATTRIBUTION_NOTICE);
      return;
    }
    const mark = markOf(markId);
    if (!mark || !answerId) return;
    const done = start({ screen, item: answerId, reading: String(page) });
    try {
      // The target's marks revision on this page: the command names it, and a page it did not read is refused here.
      const read = await reader.readPage({ answerId: target.answerId, page, limit: 1 });
      if (!done.current()) return;
      const given = updateDraft((value) => draftReattribute(value, { id: newKey(), markId, page, state: mark.state,
        toAnswerId: target.answerId, toRevision: read.revision, distinct: false }, newKey()));
      if (given) setAnnouncement(`Repère affecté à « ${target.label} », non enregistré.`);
    } catch (error) {
      if (!done.current()) return;
      setNotice(isTakeoffApiError(error) && error.status === 404 ? `« ${target.label} » n’a pas de lecture sur cette page : le repère ne peut pas lui être affecté.`
        : "Le poste choisi n’a pas pu être lu. Réessayez.");
    }
  }, [answerId, markOf, page, reader, refuseGesture, screen, start, updateDraft]);

  const verifyPage = useCallback(() => {
    if (refuseGesture()) return;
    if (!drawn || pointingBlocked) {
      setNotice(pointingBlocked ?? PAGE_NOT_SHOWN_NOTICE);
      return;
    }
    // Its sheet drawn: a size known and a render still pending is not a page seen.
    if (!drawn.painted) {
      setNotice(PAGE_NOT_DRAWN_NOTICE);
      return;
    }
    if (shown.some((mark) => mark.state === "proposed" || mark.state === "to_attribute")) {
      setNotice(TAKEOFF_COUNT_MARK_EDIT_REFUSALS.TAKEOFF_MARKS_UNDECIDED);
      return;
    }
    updateDraft((value) => draftVerify(value, { id: newKey(), page }, newKey()));
    setAnnouncement(`Page ${page} déclarée vérifiée, non enregistrée.`);
  }, [drawn, page, pointingBlocked, refuseGesture, shown, updateDraft]);

  const openDialog = useCallback((kind: "remove" | "reattribute", markId?: string | null) => {
    if (refuseGesture()) return;
    const mark = markOf(markId ?? activeId);
    if (!mark) {
      setNotice(kind === "remove" ? "Choisissez d’abord le repère à retirer." : "Choisissez d’abord le repère à affecter.");
      return;
    }
    if (kind === "remove" && (mark.state === "removed" || mark.state === "withdrawn")) {
      setNotice("Ce repère est déjà retiré.");
      return;
    }
    if (mark.state === "pending") {
      setNotice("Ce repère d’une nouvelle lecture n’est encore à aucun poste : retenez-le d’abord.");
      return;
    }
    if (kind === "reattribute" && isDraftMarkId(mark.markId)) {
      setNotice(UNSAVED_REATTRIBUTION_NOTICE);
      return;
    }
    if (kind === "reattribute" && !targets.length) {
      setNotice("Aucun autre poste de cette lecture ne peut recevoir ce repère.");
      return;
    }
    setActiveId(mark.markId);
    setDialog({ kind, markId: mark.markId });
  }, [activeId, markOf, refuseGesture, targets.length]);

  const withoutEntry = useCallback((id: string) => {
    if (inFlightRef.current.has(id)) {
      setNotice(IN_FLIGHT_NOTICE);
      return;
    }
    updateDraft((value) => draftWithout(value, id, newKey()));
  }, [updateDraft]);
  const giveDistinct = useCallback((id: string) => {
    if (inFlightRef.current.has(id)) {
      setNotice(IN_FLIGHT_NOTICE);
      return;
    }
    updateDraft((value) => draftDistinct(value, id, newKey()));
  }, [updateDraft]);

  /** The member's word on a gesture the database refused beside retained marks it named. */
  const answerRefused = useCallback((word: { object: "same"; sameAs: string } | { object: "distinct" } | "cancel") => {
    const asked = refusedQuestion;
    setRefusedQuestion(null);
    if (!asked || word === "cancel") return;
    let noted = true;
    if (word.object === "distinct") giveDistinct(asked.entryId);
    else if (isDraftMarkId(word.sameAs)) {
      // The same object as an addition of the session: the addition is withdrawn, the gesture goes as it was.
      const addition = word.sameAs.slice("draft:".length);
      noted = updateDraft((value) => draftWithout(value, addition, newKey()));
    } else if (asked.op === "retain" || asked.op === "restore") {
      noted = updateDraft((value) => draftSameAs(value, asked.entryId, word.sameAs, newKey()));
    } else {
      // An addition, a move or a reattribution onto an object already retained: the gesture is withdrawn.
      withoutEntry(asked.entryId);
    }
    if (noted) setNotice("Votre réponse est notée : enregistrez de nouveau.");
  }, [giveDistinct, refusedQuestion, updateDraft, withoutEntry]);

  const discard = useCallback(() => {
    if (!answerId || !current || savingRef.current) return;
    updateDraft(() => emptyCountMarkDraft(answerId, current.view.revision, newKey()));
    setAskWords(false);
    setNotice("Modifications abandonnées.");
  }, [answerId, current, updateDraft]);

  /** The session made again on what was read since: this answer's revision and the others' as the command needs them. */
  const rebase = useCallback(async (next: Loaded, done: Completion) => {
    const value = sessionRef.current?.draft;
    if (!value || value.answerId !== next.answerId) return;
    const named = [...new Set(value.entries.flatMap((entry) => Object.keys(entry.others)))];
    const revisions: Record<string, number> = {};
    for (const mark of next.marks) for (const other of mark.others) revisions[other.answerId] = other.revision;
    for (const other of named.filter((answer) => revisions[answer] === undefined)) {
      const entry = value.entries.find((candidate) => other in candidate.others);
      try {
        revisions[other] = (await reader.readPage({ answerId: other, page: entry?.page ?? next.page, limit: 1 })).revision;
      } catch {
        // The other answer is not read again: the command names it as before and refuses it if it changed.
      }
    }
    if (!done.current()) return;
    updateDraft((draftValue) => rebaseCountMarkDraft(draftValue, { revision: next.view.revision, others: revisions }, newKey()),
      { bySave: true });
  }, [reader, updateDraft]);

  /**
   * The page's next lots until every mark a refusal named is loaded (or the page ends), so that the member sees each one
   * before answering about it.
   */
  const loadNamed = useCallback(async (markIds: readonly string[], done: Completion) => {
    let value = loadedRef.current;
    const missing = (loaded: Loaded) => markIds.some((markId) => !loaded.marks.some((mark) => mark.markId === markId));
    while (value && value.nextAfter && missing(value) && done.current()) {
      const previous: Loaded = value;
      const next = await readLots({ answerId: previous.answerId, page: previous.page }, previous);
      if (!done.current()) return;
      if (next.view.revision !== previous.view.revision) {
        // Read at another revision: the screen is read again, its removed marks included.
        await reload({ say: true });
        return;
      }
      loadedRef.current = next;
      setLoaded(next);
      value = next;
    }
  }, [readLots, reload]);

  const save = useCallback(async () => {
    const session_ = sessionRef.current;
    if (!draft?.entries.length || !session_ || savingRef.current || refuseGesture()) return;
    // The reply belongs to the member and the answer that started the save, whatever is shown when it comes.
    const viewerId = session_.viewerId;
    const savedAnswer = draft.answerId;
    const done = start({ screen, item: savedAnswer });
    /** A change of that member's session on that answer: the one shown while it is, else the one kept for the tab. */
    const settle = (change: (value: CountMarkDraft) => CountMarkDraft) => {
      const value = sessionRef.current;
      if (done.current() && value?.viewerId === viewerId && value.draft.answerId === savedAnswer) {
        updateDraft(change, { bySave: true });
        return;
      }
      const stored = readSession(viewerId, savedAnswer);
      if (stored) storeSession(viewerId, change(stored));
    };
    // The gestures sent, in the command's order (a refusal names a gesture by its place in it).
    const sentEntries = draftCommandEntries(draft);
    const sent = new Set(sentEntries.map(({ id }) => id));
    savingRef.current = true;
    inFlightRef.current = sent;
    setInFlight(sent);
    setSaving(true);
    setAskWords(false);
    setRefusedQuestion(null);
    const command = draftCommand(draft);
    try {
      const result = await reader.edit(command);
      const answerSummary = result.summaries[savedAnswer];
      // Only what was sent is cleared, on the revision the command gave: a gesture made meanwhile stays to be saved.
      settle((value) => ({ ...value, revision: result.revisions[savedAnswer] ?? value.revision, intentKey: newKey(),
        entries: value.entries.filter(({ id }) => !sent.has(id)) }));
      // What reads the marks of every answer the command named reads again, for their items, while this is the screen
      // that saved: a reattribution reopens its target's acceptance too.
      if (done.ownScreen()) onSaved?.(Object.keys(command.revisions));
      if (!done.current()) return;
      setNotice(`${draft.entries.length > 1 ? `${draft.entries.length} modifications enregistrées` : "Modification enregistrée"}.`);
      setAnnouncement(answerSummary ? `Enregistré : ${answerSummary.retained} repère${answerSummary.retained > 1 ? "s" : ""} retenu${answerSummary.retained > 1 ? "s" : ""}.`
        : "Enregistré.");
      setHistoryVersion((value) => value + 1);
      await reload();
    } catch (error) {
      const code = isTakeoffApiError(error) ? error.code : null;
      if (code === "TAKEOFF_MARKS_INTENT_CONFLICT") settle((value) => ({ ...value, intentKey: newKey() }));
      // A failure obeys the same rule: what is shown hears of it only while it is still the saved answer.
      if (!done.current()) return;
      if (code === "TAKEOFF_MARKS_REVISION_CONFLICT") {
        // Read again, say what changed, keep every gesture: they are saved again on what was read.
        setAskWords(false);
        const next = await reload({ say: true });
        if (next && done.current()) await rebase(next, done);
        if (done.current()) setHistoryVersion((value) => value + 1);
        return;
      }
      if (code === "TAKEOFF_MARKS_OBJECT_DUPLICATE") {
        // The database names the gesture and the retained marks beside it: the member answers about each, each one loaded.
        const named = isTakeoffApiError(error) ? countMarkDuplicateDetailSchema.safeParse(error.details) : null;
        const entry = named?.success ? sentEntries[named.data.gesture - 1] : undefined;
        if (named?.success && entry) {
          setRefusedQuestion({ entryId: entry.id, op: entry.gesture.op, twins: named.data.twins,
            additions: named.data.addedKeys.map((key) => draftMarkId(key)) });
          void loadNamed(named.data.twins, done);
        } else setAskWords(true);
      }
      setNotice(refusalSentence(error));
      if (isTakeoffApiError(error) && [401, 403, 404, 409].includes(error.status) && code !== "TAKEOFF_MARKS_OBJECT_DUPLICATE") {
        // A right lost, an answer replaced, a plan sent meanwhile: what the member may do is read again.
        await reload();
      }
    } finally {
      savingRef.current = false;
      inFlightRef.current = new Set();
      setInFlight(new Set());
      setSaving(false);
    }
  }, [draft, loadNamed, onSaved, rebase, refuseGesture, reader, reload, screen, start, updateDraft]);

  // One read per cursor: a second click on the same lot reads nothing, and a lot is appended once, after its cursor.
  const lotsCursor = useRef<string | null>(null);
  const loadMore = useCallback(() => {
    const cursor = current?.nextAfter;
    if (!current || !cursor || !answerId || lotsCursor.current === cursor) return;
    lotsCursor.current = cursor;
    const done = start({ screen, item: answerId, reading: String(page) });
    setReloading(true);
    readLots({ answerId, page }, current).then(async (next) => {
      if (!done.current() || loadedRef.current?.nextAfter !== cursor) return;
      if (next.view.revision !== current.view.revision) {
        // Read at another revision: the screen is read again, its removed marks included, and the member told.
        if (wantRemovedRef.current) {
          await reload({ say: true });
          return;
        }
        const kept = sessionRef.current?.draft.answerId === answerId ? sessionRef.current.draft.entries.length : 0;
        setNotice(countMarksChangeSentence(countMarksChange(current.marks, next.marks), kept));
      }
      setLoaded(next);
    }).catch((error: unknown) => {
      if (!done.current()) return;
      if (isReadRefusal(error)) withdraw();
      else setNotice("La suite des repères n’a pas pu être lue.");
    }).finally(() => {
      if (lotsCursor.current === cursor) lotsCursor.current = null;
      if (done.current()) setReloading(false);
    });
  }, [answerId, current, page, readLots, reload, screen, start, withdraw]);

  const showRemoved = useCallback((show: boolean) => {
    setWantRemoved(show);
    wantRemovedRef.current = show;
    if (!show || !answerId || !inScope) {
      setRemoved(null);
      return;
    }
    const done = start({ screen, item: answerId, reading: String(page) });
    reader.readPage({ answerId, page, states: ["removed"] }).then((read) => {
      if (!done.current() || !wantRemovedRef.current) return;
      // Read at another revision than the page shown: both are read again, at one.
      if (read.revision !== loadedRef.current?.view.revision) {
        readAgain();
        return;
      }
      setRemoved(removedOf(read));
    }).catch((error: unknown) => {
      if (!done.current()) return;
      if (isReadRefusal(error)) withdraw();
      else setNotice("Les repères retirés n’ont pas pu être lus.");
    });
  }, [answerId, inScope, page, readAgain, reader, screen, start, withdraw]);

  /** The next lot of the removed marks, after the last one read, to the last cursor; one read per cursor. */
  const removedCursor = useRef<string | null>(null);
  const loadMoreRemoved = useCallback(() => {
    const cursor = removed?.nextAfter;
    if (!cursor || !answerId || removedCursor.current === cursor) return;
    removedCursor.current = cursor;
    const done = start({ screen, item: answerId, reading: String(page) });
    reader.readPage({ answerId, page, states: ["removed"], after: cursor }).then((read) => {
      if (!done.current()) return;
      if (read.revision !== loadedRef.current?.view.revision) {
        readAgain();
        return;
      }
      setRemoved((value) => (value && value.nextAfter === cursor ? { marks: [...value.marks, ...read.marks], total: read.total,
        nextAfter: read.nextAfter, revision: read.revision } : value));
    }).catch((error: unknown) => {
      if (!done.current()) return;
      if (isReadRefusal(error)) withdraw();
      else setNotice("La suite des repères retirés n’a pas pu être lue.");
    }).finally(() => {
      if (removedCursor.current === cursor) removedCursor.current = null;
    });
  }, [answerId, page, readAgain, reader, removed?.nextAfter, screen, start, withdraw]);

  const status: CountMarksStatus = !answer ? "none" : refused ? "refused" : !inScope ? "outside"
    : current ? "ready" : failure === "error" ? "error" : failure === "changing" ? "changing" : "loading";

  const value: CountMarksContextValue = {
    status, answer, page, loaded: current, reloading, shown, removed, draft, staleEntries, askWords, activeId, mode, question,
    notice, announcement, saving, canEdit, pointingBlocked, planFrame: drawn, itemLabels, targets, historyVersion, pageSize,
    summary: current?.view.summary ?? null, reader, refusedQuestion, answerRefused, inFlight, loadMoreRemoved,
    retry: () => {
      setFailure(null);
      setAttempt((value) => value + 1);
    },
    dialog, panelOpen, setPanelOpen, openDialog, closeDialog: () => setDialog(null),
    refuse, setPlanFrame, select, step, startAdd, startMove, movePointer, place, cancelMode, answerQuestion, remove, decide, reattribute,
    verifyPage, withoutEntry, giveDistinct, save, discard, loadMore, showRemoved, dismissNotice: () => setNotice(""),
    start, screen, readAgain,
  };
  return <CountMarksContext.Provider value={value}>{children}</CountMarksContext.Provider>;
}
