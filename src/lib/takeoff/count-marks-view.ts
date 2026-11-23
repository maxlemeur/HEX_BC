import {
  TAKEOFF_COUNT_MARK_ORIGIN_LABELS,
  TAKEOFF_COUNT_MARK_REASON_LABELS,
  TAKEOFF_COUNT_MARK_STATE_LABELS,
  type TakeoffCountMark,
  type TakeoffCountMarkGesture,
  type TakeoffCountMarkRemovalReason,
  type TakeoffCountMarkState,
  type TakeoffCountMarkSummary,
  type TakeoffCountPageGeometry,
} from "@/lib/takeoff/count-marks";
import type { CountMarkHistoryEvent } from "@/lib/takeoff/count-marks-contracts";

/**
 * The marks of an answer as the detail of an item shows and corrects them (lot 5): a pure model, so that the layer on
 * the plan, the accessible list and the tests read one rule. A correction session holds N gestures before they are saved
 * in one command (public.edit_takeoff_count_marks, under the answer's expected revision and an intention key); the
 * screen shows what they would do, the database decides them again and gives the count.
 *
 * Positions are those of the database: a centre normalised in [0, 1] in the visible page (after its intrinsic rotation,
 * from its top-left corner), whatever the zoom, the pan or the size of the canvas.
 */

export type CountMarkPoint = { x: number; y: number };
/** The visible page at scale 1, in points (its geometry's width and height). */
export type CountMarkPageSize = { width: number; height: number };

/** Two points of a page within this distance at scale 1 may be one object (the database's same rule). */
export const COUNT_MARK_DUPLICATE_POINTS = 4;

/** Whether two points of a page may stand on one object: within 4 points at scale 1 (private.takeoff_count_same_object). */
export function mayBeSameCountObject(a: CountMarkPoint, b: CountMarkPoint, size: CountMarkPageSize) {
  const dx = (a.x - b.x) * size.width;
  const dy = (a.y - b.y) * size.height;
  // The database computes in exact numerics: a point at 4 points exactly is the same object there too.
  return dx * dx + dy * dy <= COUNT_MARK_DUPLICATE_POINTS * COUNT_MARK_DUPLICATE_POINTS + 1e-9;
}

/** The geometry descriptor of a page as pdf.js reads it (its view box, /Rotate and UserUnit), for its first mark. */
export function countPageGeometry(page: { viewBox: readonly [number, number, number, number]; rotation: 0 | 90 | 180 | 270;
  userUnit: number }): TakeoffCountPageGeometry {
  const [x0, y0, x1, y1] = page.viewBox;
  const turned = page.rotation === 90 || page.rotation === 270;
  return { version: 1, view_box: [x0, y0, x1, y1], rotation: page.rotation, user_unit: page.userUnit,
    width: page.userUnit * (turned ? y1 - y0 : x1 - x0), height: page.userUnit * (turned ? x1 - x0 : y1 - y0) };
}

/**
 * Whether the page drawn is the page the marks were recorded on: the same visible size at scale 1, to a thousandth. Other
 * bytes under the same name never receive a mark (the database refuses a geometry that is not its own).
 */
export function sameCountPage(recorded: CountMarkPageSize, drawn: CountMarkPageSize) {
  const close = (a: number, b: number) => Math.abs(a - b) <= 0.001 * Math.max(a, b);
  return close(recorded.width, drawn.width) && close(recorded.height, drawn.height);
}

// The correction session.

/** The state a gesture leaves the mark in for the answer; « withdrawn »: the same object as a retained mark. */
export type CountMarkShownState = TakeoffCountMarkState | "withdrawn";

export type CountMarkDraftEntry = {
  /** The entry's own identity; for an add, the key the command gives back with the new mark. */
  id: string;
  page: number;
  /** null for a mark added in this session. */
  markId: string | null;
  from: CountMarkShownState | null;
  to: CountMarkShownState;
  gesture: TakeoffCountMarkGesture;
  /** The marks revision of every other answer the gesture changes (the others that hold a moved mark, a reattribution's target). */
  others: Record<string, number>;
  /**
   * The mark as read, for a mark the page's lots do not hold (a removed mark restored from the removed list): the screen
   * shows it from it, operable like the others, until the session is saved.
   */
  mark?: TakeoffCountMark;
};

export type CountMarkDraft = {
  answerId: string;
  /** The answer's marks revision the session was made on: the command's expected revision. */
  revision: number;
  /** A new one for every change of the gestures: the same key is a replay of the same content. */
  intentKey: string;
  entries: CountMarkDraftEntry[];
};

export const emptyCountMarkDraft = (answerId: string, revision: number, intentKey: string): CountMarkDraft =>
  ({ answerId, revision, intentKey, entries: [] });

export const draftMarkId = (key: string) => `draft:${key}`;
export const isDraftMarkId = (markId: string) => markId.startsWith("draft:");

const withEntries = (draft: CountMarkDraft, entries: CountMarkDraftEntry[], intentKey: string): CountMarkDraft =>
  ({ ...draft, intentKey, entries });

/** A mark added at a point of a page; the geometry is given only for a page no mark was recorded on yet. */
export function draftAdd(draft: CountMarkDraft, input: { key: string; page: number; point: CountMarkPoint;
  geometry: TakeoffCountPageGeometry | null; distinct: boolean }, intentKey: string): CountMarkDraft {
  const gesture: TakeoffCountMarkGesture = { op: "add", answer_id: draft.answerId, key: input.key, page: input.page,
    x: input.point.x, y: input.point.y, ...(input.geometry ? { geometry: input.geometry } : {}),
    ...(input.distinct ? { object: "distinct" as const } : {}) };
  return withEntries(draft, [...draft.entries, { id: input.key, page: input.page, markId: null, from: null, to: "retained",
    gesture, others: {} }], intentKey);
}

/** A mark moved; a mark added in this session is moved where it is added. Every answer holding the mark changes. */
export function draftMove(draft: CountMarkDraft, input: { id: string; markId: string; page: number; state: CountMarkShownState;
  point: CountMarkPoint; distinct: boolean; others: Record<string, number> }, intentKey: string): CountMarkDraft {
  if (isDraftMarkId(input.markId)) {
    const key = input.markId.slice("draft:".length);
    return withEntries(draft, draft.entries.map((entry) => entry.id === key && entry.gesture.op === "add"
      ? { ...entry, gesture: { ...entry.gesture, x: input.point.x, y: input.point.y,
        ...(input.distinct ? { object: "distinct" as const } : {}) } } : entry), intentKey);
  }
  const gesture: TakeoffCountMarkGesture = { op: "move", mark_id: input.markId, x: input.point.x, y: input.point.y,
    ...(input.distinct ? { object: "distinct" as const } : {}) };
  return withEntries(draft, [...draft.entries, { id: input.id, page: input.page, markId: input.markId, from: input.state,
    to: input.state, gesture, others: input.others }], intentKey);
}

/** A mark removed with its reason; a mark added in this session is simply not added. */
export function draftRemove(draft: CountMarkDraft, input: { id: string; markId: string; page: number; state: CountMarkShownState;
  reason: TakeoffCountMarkRemovalReason; note: string | null }, intentKey: string): CountMarkDraft {
  if (isDraftMarkId(input.markId)) {
    const key = input.markId.slice("draft:".length);
    return withEntries(draft, draft.entries.filter((entry) => entry.id !== key), intentKey);
  }
  const note = input.note?.trim() || null;
  const gesture: TakeoffCountMarkGesture = { op: "remove", answer_id: draft.answerId, mark_id: input.markId,
    reason: input.reason, ...(note ? { note } : {}) };
  return withEntries(draft, [...draft.entries, { id: input.id, page: input.page, markId: input.markId, from: input.state,
    to: "removed", gesture, others: {} }], intentKey);
}

/** The member's word beside a retained mark within 4 points: the same object (named) or a distinct one. */
export type CountMarkObjectAnswer = { object: "same"; sameAs: string } | { object: "distinct" } | null;

/** A removed mark restored to the state it had, or a proposed one retained, with the member's word when one is needed. */
export function draftDecide(draft: CountMarkDraft, input: { id: string; op: "restore" | "retain"; markId: string; page: number;
  state: CountMarkShownState; restoredTo: CountMarkShownState; word: CountMarkObjectAnswer; mark?: TakeoffCountMark | null },
  intentKey: string): CountMarkDraft {
  // A mark not saved yet has no identity the database knows: it is never named in a stored field, decided or as the same.
  if (isDraftMarkId(input.markId)) throw new Error("Un repère non enregistré se décide une fois enregistré.");
  if (input.word?.object === "same" && isDraftMarkId(input.word.sameAs)) {
    throw new Error("Un repère non enregistré ne peut pas être nommé comme le même objet.");
  }
  const word = input.word?.object === "same" ? { object: "same" as const, same_as: input.word.sameAs }
    : input.word?.object === "distinct" ? { object: "distinct" as const } : {};
  const gesture = { op: input.op, answer_id: draft.answerId, mark_id: input.markId, ...word } as TakeoffCountMarkGesture;
  const to: CountMarkShownState = input.word?.object === "same" ? "withdrawn" : input.op === "retain" ? "retained" : input.restoredTo;
  return withEntries(draft, [...draft.entries, { id: input.id, page: input.page, markId: input.markId, from: input.state, to,
    gesture, others: {}, ...(input.mark ? { mark: input.mark } : {}) }], intentKey);
}

/** A mark given to another item of the same reading, whose answer then retains it: a mark the database knows only. */
export function draftReattribute(draft: CountMarkDraft, input: { id: string; markId: string; page: number;
  state: CountMarkShownState; toAnswerId: string; toRevision: number; distinct: boolean }, intentKey: string): CountMarkDraft {
  if (isDraftMarkId(input.markId)) throw new Error("Un repère non enregistré ne s’affecte pas à un autre poste : enregistrez-le d’abord.");
  const gesture: TakeoffCountMarkGesture = { op: "reattribute", answer_id: draft.answerId, mark_id: input.markId,
    to_answer_id: input.toAnswerId, ...(input.distinct ? { object: "distinct" as const } : {}) };
  return withEntries(draft, [...draft.entries, { id: input.id, page: input.page, markId: input.markId, from: input.state,
    to: "removed", gesture, others: { [input.toAnswerId]: input.toRevision } }], intentKey);
}

/** A page declared verified: every mark of it decided, its retained marks reread. */
export function draftVerify(draft: CountMarkDraft, input: { id: string; page: number }, intentKey: string): CountMarkDraft {
  if (draft.entries.some((entry) => entry.gesture.op === "verify" && entry.page === input.page)) return draft;
  return withEntries(draft, [...draft.entries, { id: input.id, page: input.page, markId: null, from: null, to: "retained",
    gesture: { op: "verify", answer_id: draft.answerId, pages: [input.page] }, others: {} }], intentKey);
}

/** One gesture withdrawn from the session (and, for an add, what was done to that mark after it). */
export function draftWithout(draft: CountMarkDraft, id: string, intentKey: string): CountMarkDraft {
  return withEntries(draft, draft.entries.filter((entry) => entry.id !== id), intentKey);
}

/** The words a refusal of « possible duplicate » asks: « distinct object » given to the gestures that take it. */
export function draftDistinct(draft: CountMarkDraft, id: string, intentKey: string): CountMarkDraft {
  return withEntries(draft, draft.entries.map((entry) => {
    if (entry.id !== id) return entry;
    const { gesture } = entry;
    if (gesture.op === "add" || gesture.op === "move" || gesture.op === "reattribute") {
      return { ...entry, gesture: { ...gesture, object: "distinct" as const } };
    }
    if ((gesture.op === "retain" || gesture.op === "restore") && gesture.object !== "same") {
      return { ...entry, gesture: { op: gesture.op, answer_id: gesture.answer_id, mark_id: gesture.mark_id, object: "distinct" as const } };
    }
    return entry;
  }), intentKey);
}

/**
 * « Same object » given to a retain or a restore the database refused beside a retained mark it named: the mark is that
 * retained one. Only a mark the database knows is named (never an addition of the session).
 */
export function draftSameAs(draft: CountMarkDraft, id: string, sameAs: string, intentKey: string): CountMarkDraft {
  if (isDraftMarkId(sameAs)) throw new Error("Un repère non enregistré ne peut pas être nommé comme le même objet.");
  return withEntries(draft, draft.entries.map((entry) => {
    const { gesture } = entry;
    if (entry.id !== id || (gesture.op !== "retain" && gesture.op !== "restore")) return entry;
    return { ...entry, to: "withdrawn" as const, gesture: { op: gesture.op, answer_id: gesture.answer_id, mark_id: gesture.mark_id,
      object: "same" as const, same_as: sameAs } };
  }), intentKey);
}

/** Whether a gesture can take « distinct object » and does not carry a word yet. */
export function draftEntryAsksWord(entry: CountMarkDraftEntry) {
  const { gesture } = entry;
  return (gesture.op === "add" || gesture.op === "move" || gesture.op === "reattribute" || gesture.op === "retain"
    || gesture.op === "restore") && gesture.object === undefined;
}

/** The gestures of a session in the order its command sends them: as made, every verification last. */
export function draftCommandEntries(draft: CountMarkDraft) {
  return [...draft.entries.filter((entry) => entry.gesture.op !== "verify"),
    ...draft.entries.filter((entry) => entry.gesture.op === "verify")];
}

/** The command of a session: its gestures in the order made, every verification last, each answer it changes named. */
export function draftCommand(draft: CountMarkDraft) {
  const gestures = draftCommandEntries(draft).map((entry) => entry.gesture);
  const revisions: Record<string, number> = {};
  for (const entry of draft.entries) Object.assign(revisions, entry.others);
  revisions[draft.answerId] = draft.revision;
  return { intentKey: draft.intentKey, revisions, gestures };
}

/** The session made again on the marks read since: its gestures kept as typed, under the revision read. */
export function rebaseCountMarkDraft(draft: CountMarkDraft, input: { revision: number; others: Record<string, number> },
  intentKey: string): CountMarkDraft {
  return { ...draft, revision: input.revision, intentKey, entries: draft.entries.map((entry) => ({ ...entry,
    others: Object.fromEntries(Object.keys(entry.others).map((answerId) => [answerId, input.others[answerId] ?? entry.others[answerId]])) })) };
}

// What the screen shows.

export type CountMarkShown = {
  /** The mark's identity, or draftMarkId(key) for a mark added in this session. */
  markId: string;
  x: number;
  y: number;
  state: CountMarkShownState;
  origin: "machine" | "manual";
  /** The mark as read; null for a mark added in this session. */
  mark: TakeoffCountMark | null;
  /** The gestures of the session on it. */
  unsaved: boolean;
};

/** The marks of one page with the session's gestures applied, in the server's order, the marks added last. */
export function shownCountMarks(marks: readonly TakeoffCountMark[], draft: CountMarkDraft | null, page: number): CountMarkShown[] {
  const shown = new Map<string, CountMarkShown>(marks.map((mark) => [mark.markId, { markId: mark.markId, x: mark.x, y: mark.y,
    state: mark.state, origin: mark.origin, mark, unsaved: false }]));
  for (const entry of draft?.entries ?? []) {
    if (entry.page !== page) continue;
    const { gesture } = entry;
    if (gesture.op === "add") {
      shown.set(draftMarkId(entry.id), { markId: draftMarkId(entry.id), x: gesture.x, y: gesture.y, state: "retained",
        origin: "manual", mark: null, unsaved: true });
      continue;
    }
    // A removed mark restored from the removed list: shown from the mark as read, in the state it is restored to.
    if (entry.mark && entry.markId && !shown.has(entry.markId)) {
      shown.set(entry.markId, { markId: entry.markId, x: entry.mark.x, y: entry.mark.y, state: entry.to, origin: entry.mark.origin,
        mark: entry.mark, unsaved: true });
      continue;
    }
    const target = entry.markId ? shown.get(entry.markId) : undefined;
    if (!target) continue;
    if (gesture.op === "move") shown.set(target.markId, { ...target, x: gesture.x, y: gesture.y, unsaved: true });
    else if (gesture.op !== "verify") shown.set(target.markId, { ...target, state: entry.to, unsaved: true });
  }
  return [...shown.values()];
}

/** States drawn on the plan: what counts or waits for a decision. Removed and withdrawn marks are read in the history. */
export const COUNT_MARK_DRAWN_STATES: readonly CountMarkShownState[] = ["proposed", "to_attribute", "retained", "pending"];
export const isDrawnCountMark = (mark: Pick<CountMarkShown, "state">) => COUNT_MARK_DRAWN_STATES.includes(mark.state);

/**
 * The part of the visible page the frame shows, normalised (clamped to the page); null when the frame shows none of it
 * (the sheet panned beyond the frame): clamping an empty part would give a point nobody sees.
 */
export function visibleCountRegion(input: { frame: { width: number; height: number }; offset: CountMarkPoint; scale: number;
  size: CountMarkPageSize }) {
  const width = input.size.width * input.scale;
  const height = input.size.height * input.scale;
  if (!(width > 0) || !(height > 0)) return null;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const region = { x0: clamp(-input.offset.x / width), y0: clamp(-input.offset.y / height),
    x1: clamp((input.frame.width - input.offset.x) / width), y1: clamp((input.frame.height - input.offset.y) / height) };
  return region.x1 > region.x0 && region.y1 > region.y0 ? region : null;
}

export type CountRegion = NonNullable<ReturnType<typeof visibleCountRegion>>;
export const inCountRegion = (point: CountMarkPoint, region: CountRegion) =>
  point.x >= region.x0 && point.x <= region.x1 && point.y >= region.y0 && point.y <= region.y1;

/** The retained marks shown within 4 points of a point (the mark itself excepted): the neighbours a gesture asks about. */
export function retainedNeighbours(shown: readonly CountMarkShown[], point: CountMarkPoint, size: CountMarkPageSize | null,
  except: string | null) {
  if (!size) return [];
  return shown.filter((mark) => mark.state === "retained" && mark.markId !== except && mayBeSameCountObject(mark, point, size));
}

/**
 * The count once the session is saved, as the screen expects it: the database gives the number that stands. A gesture
 * counts from the state its mark has now when the marks were read since it was made (`current`, the marks of the page
 * read last), else from the state it was made on; the next gestures on a mark from the state the previous one left.
 */
export function draftCountPreview(summary: Pick<TakeoffCountMarkSummary, "proposed" | "toAttribute" | "retained">,
  draft: CountMarkDraft | null, current: ReadonlyMap<string, CountMarkShownState> = new Map()) {
  const undecided = (state: CountMarkShownState | null) => state === "proposed" || state === "to_attribute" ? 1 : 0;
  const retained = (state: CountMarkShownState | null) => state === "retained" ? 1 : 0;
  const states = new Map(current);
  let proposed = summary.proposed + summary.toAttribute;
  let kept = summary.retained;
  for (const entry of draft?.entries ?? []) {
    if (entry.gesture.op === "verify" || entry.gesture.op === "move") continue;
    const from = entry.markId ? states.get(entry.markId) ?? entry.from : entry.from;
    if (entry.markId) states.set(entry.markId, entry.to);
    proposed += undecided(entry.to) - undecided(from);
    kept += retained(entry.to) - retained(from);
  }
  return { proposed: Math.max(0, proposed), retained: Math.max(0, kept), changes: draft?.entries.length ?? 0 };
}

/** What changed between two reads of the same page of marks: said to the member after a reload. */
export function countMarksChange(before: readonly TakeoffCountMark[], after: readonly TakeoffCountMark[]) {
  const previous = new Map(before.map((mark) => [mark.markId, mark]));
  const next = new Map(after.map((mark) => [mark.markId, mark]));
  let added = 0, removed = 0, moved = 0, decided = 0;
  for (const mark of after) {
    const earlier = previous.get(mark.markId);
    if (!earlier) added += 1;
    else {
      if (earlier.positionRevision !== mark.positionRevision) moved += 1;
      if (earlier.state !== mark.state && mark.state === "removed") removed += 1;
      else if (earlier.state !== mark.state) decided += 1;
    }
  }
  for (const mark of before) if (!next.has(mark.markId)) removed += 1;
  return { added, removed, moved, decided };
}

const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;

export function countMarksChangeSentence(change: ReturnType<typeof countMarksChange>, kept: number) {
  const parts = [change.added ? plural(change.added, "ajouté", "ajoutés") : null,
    change.removed ? plural(change.removed, "retiré", "retirés") : null,
    change.moved ? plural(change.moved, "déplacé", "déplacés") : null,
    change.decided ? plural(change.decided, "décidé autrement", "décidés autrement") : null].filter(Boolean);
  const what = parts.length ? `Les repères ont changé depuis leur affichage : ${parts.join(", ")}.`
    : "La révision des repères a changé depuis leur affichage.";
  return kept ? `${what} ${kept > 1 ? `Vos ${kept} modifications sont gardées` : "Votre modification est gardée"} : vérifiez-les puis enregistrez de nouveau.`
    : what;
}

/** The gestures of the session that name a mark the page no longer holds in the state they were made on. */
export function staleDraftEntries(draft: CountMarkDraft | null, marks: readonly TakeoffCountMark[], page: number) {
  const byId = new Map(marks.map((mark) => [mark.markId, mark]));
  const stale = new Set<string>();
  const seen = new Set<string>();
  for (const entry of draft?.entries ?? []) {
    if (entry.page !== page || !entry.markId || seen.has(entry.markId)) continue;
    // Only the first gesture on a mark was made on the state read; the next ones on the state it left.
    seen.add(entry.markId);
    const mark = byId.get(entry.markId);
    // A mark the lots never hold (a removed one, restored) is judged when its list is read, not by its absence here.
    if (!mark && entry.mark) continue;
    if (!mark || (entry.from !== null && entry.from !== mark.state)) stale.add(entry.id);
  }
  return stale;
}

// Words.

type Names = Record<string, string>;
const who = (actorId: string | null, names: Names, viewerId: string | null) =>
  actorId === null ? null : actorId === viewerId ? "vous" : names[actorId] ?? "un membre";

/** Where a mark comes from and who corrected it: « Ajouté par vous », « Proposé par l’analyse · Corrigé par … ». */
export function countMarkOriginLabel(mark: Pick<TakeoffCountMark, "origin" | "createdBy" | "movedBy"> & Partial<Pick<TakeoffCountMark, "proposals">>, names: Names,
  viewerId: string | null) {
  const origin = mark.origin === "manual"
    ? (mark.createdBy && mark.createdBy === viewerId ? "Ajouté par vous" : `${TAKEOFF_COUNT_MARK_ORIGIN_LABELS.manual}${mark.createdBy ? ` par ${who(mark.createdBy, names, viewerId)}` : ""}`)
    : TAKEOFF_COUNT_MARK_ORIGIN_LABELS.machine;
  const sources = mark.proposals ?? [];
  const parts = [origin];
  if (sources.length) {
    const readers = new Set(sources.map((p) => p.method));
    if (sources.some((p) => p.sourceKey.startsWith("neighbours:")) || new Set(sources.map((p) => p.diameterMm).filter((dn) => dn !== null)).size > 1) {
      parts.push("Lectures en désaccord");
    } else if (readers.has("vector") && readers.has("tile")) parts.push("Deux lectures concordantes");
    for (const source of sources) {
      const variant = source.sourceRef?.split(":")[0];
      const draw = variant === "label" ? "libellé" : variant === "pipe" ? "raccordement" : "symbole";
      const tile = source.sourceRef?.match(/^tile:(\d+)$/)?.[1];
      const method = source.method === "vector" ? `Lecture du dessin (${draw})` : source.method === "tile" && tile
        ? `Lecture par tuile n° ${tile}` : "Lecture de symboles";
      parts.push(`${method} v${source.methodVersion} · ${source.qualified ? "qualifié" : "non qualifié"}`
        + (source.diameterMm === null ? "" : ` · DN ${source.diameterMm}`));
    }
  }
  if (mark.movedBy) parts.push(`Corrigé par ${who(mark.movedBy, names, viewerId)}`);
  return parts.join(" · ");
}

export const COUNT_MARK_SHOWN_STATE_LABELS: Record<CountMarkShownState, string> = {
  ...TAKEOFF_COUNT_MARK_STATE_LABELS,
  withdrawn: "Même objet qu’un repère retenu",
};

/** The place of a point on the page, for a list or an announcement: « à 41,2 % × 23,3 % de la page ». */
export function countMarkPlace(point: CountMarkPoint) {
  const percent = (value: number) => `${(value * 100).toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
  return `${percent(point.x)} × ${percent(point.y)}`;
}

const reasonLabel = (code: string | null) => code && Object.hasOwn(TAKEOFF_COUNT_MARK_REASON_LABELS, code)
  ? TAKEOFF_COUNT_MARK_REASON_LABELS[code as keyof typeof TAKEOFF_COUNT_MARK_REASON_LABELS] : null;
const stateLabel = (value: unknown) => typeof value === "string" && Object.hasOwn(COUNT_MARK_SHOWN_STATE_LABELS, value)
  ? COUNT_MARK_SHOWN_STATE_LABELS[value as CountMarkShownState] : null;
const pointOf = (value: Record<string, unknown> | null): CountMarkPoint | null => {
  const x = Number(value?.x);
  const y = Number(value?.y);
  return value && Number.isFinite(x) && Number.isFinite(y) && value.x !== null && value.y !== null ? { x, y } : null;
};

/** What an event of an answer's marks journal did, in French: the gesture, before and after, the reason. */
export function countMarkEventLabel(event: Pick<CountMarkHistoryEvent, "gesture" | "before" | "after" | "reasonCode" | "reasonText">) {
  const distinct = event.after?.object === "distinct" ? " (objet distinct)" : "";
  switch (event.gesture) {
    case "proposed": return "Proposé par l’analyse";
    case "add": {
      const at = pointOf(event.after);
      return `Ajouté${at ? ` à ${countMarkPlace(at)}` : ""}${distinct}`;
    }
    case "move": {
      const from = pointOf(event.before);
      const to = pointOf(event.after);
      return `Déplacé${from ? ` de ${countMarkPlace(from)}` : ""}${to ? ` à ${countMarkPlace(to)}` : ""}${distinct}`;
    }
    case "remove": {
      const reason = reasonLabel(event.reasonCode);
      return `Retiré${reason ? ` : ${reason.toLowerCase()}` : ""}${event.reasonText ? ` — ${event.reasonText}` : ""}`;
    }
    case "restore": {
      const to = stateLabel(event.after?.state);
      return `Rétabli${to ? ` (${to.toLowerCase()})` : ""}${distinct}`;
    }
    case "retain": {
      const from = stateLabel(event.before?.state);
      return `Retenu${from ? ` (était : ${from.toLowerCase()})` : ""}${distinct}`;
    }
    case "reattribute_out": return "Affecté à un autre poste";
    case "reattribute_in": return `Reçu d’un autre poste${distinct}`;
    case "verify": {
      const retained = Number(event.after?.retained);
      return `Page vérifiée${Number.isFinite(retained) ? ` : ${plural(retained, "repère retenu", "repères retenus")}` : ""}`;
    }
    case "same_object": return "Même objet qu’un repère retenu";
  }
}

/** Who made an event: the analysis, « vous » or the member's name. */
export function countMarkEventActor(event: Pick<CountMarkHistoryEvent, "actorKind" | "actorId">, names: Names, viewerId: string | null) {
  if (event.actorKind === "worker") return "L’analyse";
  const name = who(event.actorId, names, viewerId);
  return name === "vous" ? "Vous" : name ?? "Un membre";
}

// The keyboard.

export type CountMarksKey =
  | { kind: "step"; step: -1 | 1 }
  | { kind: "edge"; to: "first" | "last" }
  | { kind: "retain" }
  | { kind: "remove" }
  | { kind: "restore" }
  | { kind: "move" }
  | { kind: "reattribute" }
  | { kind: "add" }
  | { kind: "verify" };

type KeyInput = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; isComposing: boolean };

/**
 * The keys of the list of marks: ↑/↓ the previous or next mark (centred on the plan), Début/Fin the first or last, R
 * retain, Suppr remove with a reason, T restore, D move on the plan, A give to another item, N add a mark, P declare the
 * page verified. Inactive in a field, during a composition or with a modifier (the browser's own shortcuts).
 */
export function countMarksListKey(input: KeyInput, inField: boolean): CountMarksKey | null {
  if (inField || input.isComposing || input.ctrlKey || input.metaKey || input.altKey) return null;
  switch (input.key) {
    case "ArrowUp": return input.shiftKey ? null : { kind: "step", step: -1 };
    case "ArrowDown": return input.shiftKey ? null : { kind: "step", step: 1 };
    case "Home": return { kind: "edge", to: "first" };
    case "End": return { kind: "edge", to: "last" };
    case "Delete": case "Backspace": return { kind: "remove" };
  }
  if (input.shiftKey) return null;
  switch (input.key.toLowerCase()) {
    case "r": return { kind: "retain" };
    case "t": return { kind: "restore" };
    case "d": return { kind: "move" };
    case "a": return { kind: "reattribute" };
    case "n": return { kind: "add" };
    case "p": return { kind: "verify" };
    default: return null;
  }
}

export const COUNT_MARKS_LIST_KEYS_HELP = "↑ ↓ repère · Début Fin · R retenir · Suppr retirer · T rétablir · D déplacer · A affecter à un autre poste · N ajouter · P page vérifiée";
export const COUNT_MARKS_PLAN_KEYS_HELP = "Pointage : flèches 1 point · Maj + flèche 10 points · Entrée poser · Échap quitter";

/** A pointer moved by the keyboard: one point of the page per arrow, ten with Shift, within the page. */
export function nudgeCountPoint(point: CountMarkPoint, input: Pick<KeyInput, "key" | "shiftKey">, size: CountMarkPageSize) {
  const step = input.shiftKey ? 10 : 1;
  const dx = input.key === "ArrowLeft" ? -step : input.key === "ArrowRight" ? step : 0;
  const dy = input.key === "ArrowUp" ? -step : input.key === "ArrowDown" ? step : 0;
  if (!dx && !dy) return null;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return { x: clamp(point.x + dx / size.width), y: clamp(point.y + dy / size.height) };
}
