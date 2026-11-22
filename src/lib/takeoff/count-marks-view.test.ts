import { describe, expect, it } from "vitest";

import type { TakeoffCountMark } from "./count-marks";
import {
  countMarkEventLabel,
  countMarkOriginLabel,
  countMarksChange,
  countMarksChangeSentence,
  countMarksListKey,
  countPageGeometry,
  draftAdd,
  draftCommand,
  draftCommandEntries,
  draftCountPreview,
  draftDecide,
  draftDistinct,
  draftEntryAsksWord,
  draftMarkId,
  draftMove,
  draftReattribute,
  draftRemove,
  draftSameAs,
  draftVerify,
  emptyCountMarkDraft,
  inCountRegion,
  isDrawnCountMark,
  mayBeSameCountObject,
  nudgeCountPoint,
  rebaseCountMarkDraft,
  retainedNeighbours,
  sameCountPage,
  shownCountMarks,
  staleDraftEntries,
  visibleCountRegion,
} from "./count-marks-view";

// The model the layer, the list and the history of an item's marks share (lot 5). Fictional identifiers and values.
const ANSWER = "a0000000-0000-4000-8000-000000000001";
const OTHER = "a0000000-0000-4000-8000-000000000002";
const id = (n: number) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mark = (n: number, values: Partial<TakeoffCountMark> = {}): TakeoffCountMark => ({
  markId: id(n), x: 0.5, y: 0.5, box: null, origin: "machine", positionRevision: 0, createdBy: null, createdJobId: null,
  createdAt: "2026-11-22T10:00:00Z", movedBy: null, movedAt: null, state: "proposed", priorState: null, reasonCode: null,
  reasonText: null, decidedBy: null, decidedAt: null, possibleDuplicates: [], others: [], proposals: [], ...values,
});
const keys = (() => {
  let next = 100;
  return () => id(next++);
})();

describe("the same object at 4 points of the visible page at scale 1", () => {
  // An A3 sheet turned a quarter: its visible page is 842 points wide, 1191 high.
  const turned = countPageGeometry({ viewBox: [0, 0, 1191, 842], rotation: 90, userUnit: 1 });

  it("describes the visible page as the database checks it: the box turned, times UserUnit", () => {
    expect(turned).toMatchObject({ width: 842, height: 1191, rotation: 90 });
    expect(countPageGeometry({ viewBox: [10, 20, 110, 70], rotation: 0, userUnit: 2 })).toMatchObject({ width: 200, height: 100 });
    expect(countPageGeometry({ viewBox: [10, 20, 110, 70], rotation: 270, userUnit: 2 })).toMatchObject({ width: 100, height: 200 });
  });

  it("measures in points of the page, not in shares of it", () => {
    // 3 points apart across, 5 points apart down: the page's two sides are not the same length.
    expect(mayBeSameCountObject({ x: 0.5, y: 0.5 }, { x: 0.5 + 3 / 842, y: 0.5 }, turned)).toBe(true);
    expect(mayBeSameCountObject({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 + 5 / 1191 }, turned)).toBe(false);
    expect(mayBeSameCountObject({ x: 0.5, y: 0.5 }, { x: 0.5 + 4 / 842, y: 0.5 }, turned)).toBe(true);
  });

  it("asks about retained neighbours only, the mark itself excepted", () => {
    const shown = shownCountMarks([mark(1, { state: "retained" }), mark(2, { state: "proposed" }), mark(3, { state: "retained", x: 0.9 })],
      null, 7);
    expect(retainedNeighbours(shown, { x: 0.5 + 1 / 842, y: 0.5 }, turned, null).map(({ markId }) => markId)).toEqual([id(1)]);
    expect(retainedNeighbours(shown, { x: 0.5, y: 0.5 }, turned, id(1))).toEqual([]);
    expect(retainedNeighbours(shown, { x: 0.5, y: 0.5 }, null, null)).toEqual([]);
  });

  it("tells a page drawn from other bytes from the page the marks were recorded on", () => {
    expect(sameCountPage({ width: 842, height: 1191 }, { width: 842.0004, height: 1191 })).toBe(true);
    expect(sameCountPage({ width: 842, height: 1191 }, { width: 1191, height: 842 })).toBe(false);
  });
});

describe("a correction session", () => {
  const start = () => emptyCountMarkDraft(ANSWER, 4, keys());

  it("sends its gestures in the order made, every verification last, under the expected revision of each answer", () => {
    let draft = start();
    draft = draftVerify(draft, { id: keys(), page: 7 }, keys());
    draft = draftAdd(draft, { key: id(50), page: 7, point: { x: 0.2, y: 0.3 }, geometry: null, distinct: false }, keys());
    draft = draftMove(draft, { id: keys(), markId: id(1), page: 7, state: "retained", point: { x: 0.4, y: 0.4 }, distinct: false,
      others: { [OTHER]: 9 } }, keys());
    draft = draftReattribute(draft, { id: keys(), markId: id(2), page: 7, state: "proposed", toAnswerId: OTHER, toRevision: 9,
      distinct: false }, keys());
    const command = draftCommand(draft);
    expect(command.gestures.map(({ op }) => op)).toEqual(["add", "move", "reattribute", "verify"]);
    expect(command.revisions).toEqual({ [ANSWER]: 4, [OTHER]: 9 });
    expect(command.intentKey).toBe(draft.intentKey);
  });

  // Closing review of #485: a reattribution of an addition not saved yet sent its display identifier as a mark's. Every
  // builder given one either changes the addition itself (a move), drops it (a removal), or refuses it; the command never
  // carries one.
  it("never puts the display identifier of an addition not saved yet into a stored field, whichever gesture builds", () => {
    let draft = draftAdd(start(), { key: id(60), page: 7, point: { x: 0.2, y: 0.3 }, geometry: null, distinct: false }, keys());
    const addition = draftMarkId(id(60));
    draft = draftMove(draft, { id: keys(), markId: addition, page: 7, state: "retained", point: { x: 0.25, y: 0.3 }, distinct: true,
      others: {} }, keys());
    expect(draft.entries).toHaveLength(1);
    expect(() => draftReattribute(draft, { id: keys(), markId: addition, page: 7, state: "retained", toAnswerId: OTHER, toRevision: 9,
      distinct: false }, keys())).toThrow(/non enregistré/);
    expect(() => draftDecide(draft, { id: keys(), op: "retain", markId: addition, page: 7, state: "retained", restoredTo: "proposed",
      word: null }, keys())).toThrow(/non enregistré/);
    expect(() => draftDecide(draft, { id: keys(), op: "retain", markId: id(1), page: 7, state: "proposed", restoredTo: "proposed",
      word: { object: "same", sameAs: addition } }, keys())).toThrow(/non enregistré/);
    expect(() => draftSameAs(draft, draft.entries[0]!.id, addition, keys())).toThrow(/non enregistré/);
    const command = draftCommand(draftVerify(draftDistinct(draft, id(60), keys()), { id: keys(), page: 7 }, keys()));
    expect(JSON.stringify(command)).not.toContain("draft:");
    expect(command.gestures[0]).toMatchObject({ op: "add", key: id(60), x: 0.25, object: "distinct" });
    expect(draftRemove(draft, { id: keys(), markId: addition, page: 7, state: "retained", reason: "duplicate", note: null }, keys())
      .entries).toEqual([]);
  });

  it("changes its intention key with every change of its gestures", () => {
    const draft = start();
    const added = draftAdd(draft, { key: id(50), page: 2, point: { x: 0.2, y: 0.3 }, geometry: null, distinct: false }, keys());
    expect(added.intentKey).not.toBe(draft.intentKey);
    expect(draftVerify(draftVerify(added, { id: keys(), page: 2 }, keys()), { id: keys(), page: 2 }, keys()).entries)
      .toHaveLength(2);
  });

  it("moves a mark added in the session where it is added, and drops it when it is removed", () => {
    let draft = draftAdd(start(), { key: id(50), page: 2, point: { x: 0.2, y: 0.3 }, geometry: null, distinct: false }, keys());
    draft = draftMove(draft, { id: keys(), markId: draftMarkId(id(50)), page: 2, state: "retained", point: { x: 0.6, y: 0.7 },
      distinct: true, others: {} }, keys());
    expect(draftCommand(draft).gestures).toEqual([{ op: "add", answer_id: ANSWER, key: id(50), page: 2, x: 0.6, y: 0.7,
      object: "distinct" }]);
    draft = draftRemove(draft, { id: keys(), markId: draftMarkId(id(50)), page: 2, state: "retained", reason: "duplicate",
      note: null }, keys());
    expect(draft.entries).toEqual([]);
  });

  it("removes with a reason and a trimmed note, and decides beside a retained mark with the member's word only", () => {
    let draft = draftRemove(start(), { id: keys(), markId: id(1), page: 2, state: "proposed", reason: "other", note: "  posé ailleurs " },
      keys());
    draft = draftDecide(draft, { id: keys(), op: "retain", markId: id(2), page: 2, state: "proposed", restoredTo: "retained",
      word: { object: "same", sameAs: id(3) } }, keys());
    draft = draftDecide(draft, { id: keys(), op: "restore", markId: id(4), page: 2, state: "removed", restoredTo: "proposed",
      word: null }, keys());
    expect(draftCommand(draft).gestures).toEqual([
      { op: "remove", answer_id: ANSWER, mark_id: id(1), reason: "other", note: "posé ailleurs" },
      { op: "retain", answer_id: ANSWER, mark_id: id(2), object: "same", same_as: id(3) },
      { op: "restore", answer_id: ANSWER, mark_id: id(4) },
    ]);
    // The restore carries no word: a refusal of « possible duplicate » asks it, never the screen by itself.
    const restore = draft.entries[2]!;
    expect(draftEntryAsksWord(restore)).toBe(true);
    const answered = draftDistinct(draft, restore.id, keys());
    expect(draftCommand(answered).gestures[2]).toEqual({ op: "restore", answer_id: ANSWER, mark_id: id(4), object: "distinct" });
    expect(draftEntryAsksWord(answered.entries[1]!)).toBe(false);
  });

  it("never puts the identifier of a mark not saved yet in a stored field", () => {
    expect(() => draftDecide(start(), { id: keys(), op: "retain", markId: id(2), page: 2, state: "proposed", restoredTo: "retained",
      word: { object: "same", sameAs: draftMarkId(id(50)) } }, keys())).toThrow();
  });

  it("names in a retain refused for a possible duplicate the retained mark the database named, never an addition", () => {
    let draft = draftAdd(start(), { key: id(50), page: 2, point: { x: 0.1, y: 0.1 }, geometry: null, distinct: false }, keys());
    draft = draftVerify(draft, { id: keys(), page: 2 }, keys());
    draft = draftDecide(draft, { id: id(61), op: "retain", markId: id(2), page: 2, state: "proposed", restoredTo: "retained",
      word: null }, keys());
    // The command's order: the add, the retain, then the verification.
    expect(draftCommandEntries(draft).map(({ gesture }) => gesture.op)).toEqual(["add", "retain", "verify"]);
    const answered = draftSameAs(draft, id(61), id(3), keys());
    expect(draftCommand(answered).gestures[1]).toEqual({ op: "retain", answer_id: ANSWER, mark_id: id(2), object: "same", same_as: id(3) });
    expect(() => draftSameAs(draft, id(61), draftMarkId(id(50)), keys())).toThrow();
  });

  it("is made again on the marks read since, its gestures kept as typed", () => {
    const draft = draftReattribute(draftRemove(start(), { id: keys(), markId: id(1), page: 2, state: "retained", reason: "other",
      note: "à garder" }, keys()), { id: keys(), markId: id(2), page: 2, state: "retained", toAnswerId: OTHER, toRevision: 3,
      distinct: false }, keys());
    const rebased = rebaseCountMarkDraft(draft, { revision: 6, others: { [OTHER]: 5 } }, keys());
    expect(draftCommand(rebased).revisions).toEqual({ [ANSWER]: 6, [OTHER]: 5 });
    expect(draftCommand(rebased).gestures).toEqual(draftCommand(draft).gestures);
    expect(rebased.intentKey).not.toBe(draft.intentKey);
  });
});

describe("what the screen shows of a page", () => {
  const marks = [mark(1, { state: "retained" }), mark(2, { state: "proposed", x: 0.1, y: 0.1 }), mark(3, { state: "removed" })];

  it("applies the session to the marks read: added, moved, removed or withdrawn as the same object", () => {
    let draft = emptyCountMarkDraft(ANSWER, 1, keys());
    draft = draftAdd(draft, { key: id(50), page: 7, point: { x: 0.8, y: 0.8 }, geometry: null, distinct: false }, keys());
    draft = draftMove(draft, { id: keys(), markId: id(1), page: 7, state: "retained", point: { x: 0.3, y: 0.3 }, distinct: false,
      others: {} }, keys());
    draft = draftDecide(draft, { id: keys(), op: "retain", markId: id(2), page: 7, state: "proposed", restoredTo: "retained",
      word: { object: "same", sameAs: id(1) } }, keys());
    // A gesture on another page changes nothing here.
    draft = draftRemove(draft, { id: keys(), markId: id(9), page: 2, state: "retained", reason: "duplicate", note: null }, keys());
    const shown = shownCountMarks(marks, draft, 7);
    expect(shown.map(({ markId, state, x, unsaved }) => [markId, state, x, unsaved])).toEqual([
      [id(1), "retained", 0.3, true], [id(2), "withdrawn", 0.1, true], [id(3), "removed", 0.5, false],
      [draftMarkId(id(50)), "retained", 0.8, true]]);
    expect(shown.filter(isDrawnCountMark).map(({ markId }) => markId)).toEqual([id(1), draftMarkId(id(50))]);
  });

  it("counts what a session would leave, a moved mark changing nothing", () => {
    let draft = emptyCountMarkDraft(ANSWER, 1, keys());
    draft = draftDecide(draft, { id: keys(), op: "retain", markId: id(2), page: 7, state: "proposed", restoredTo: "retained",
      word: null }, keys());
    draft = draftRemove(draft, { id: keys(), markId: id(1), page: 7, state: "retained", reason: "duplicate", note: null }, keys());
    draft = draftAdd(draft, { key: id(50), page: 7, point: { x: 0.8, y: 0.8 }, geometry: null, distinct: false }, keys());
    draft = draftMove(draft, { id: keys(), markId: id(4), page: 7, state: "retained", point: { x: 0.3, y: 0.3 }, distinct: false,
      others: {} }, keys());
    expect(draftCountPreview({ proposed: 3, toAttribute: 1, retained: 2 }, draft)).toEqual({ proposed: 3, retained: 3, changes: 4 });
    expect(draftCountPreview({ proposed: 0, toAttribute: 0, retained: 1 }, draftRemove(emptyCountMarkDraft(ANSWER, 1, keys()),
      { id: keys(), markId: id(1), page: 7, state: "retained", reason: "duplicate", note: null }, keys()))).toMatchObject({ retained: 0 });
  });

  it("counts a gesture from the state its mark has now, once the marks were read again", () => {
    // Made on a proposed mark, which another member retained meanwhile: saving removes a retained mark.
    const draft = draftDecide(draftRemove(emptyCountMarkDraft(ANSWER, 1, keys()), { id: keys(), markId: id(1), page: 7,
      state: "proposed", reason: "duplicate", note: null }, keys()), { id: keys(), op: "restore", markId: id(1), page: 7,
      state: "removed", restoredTo: "proposed", word: null }, keys());
    const afterRemove = { ...draft, entries: draft.entries.slice(0, 1) };
    expect(draftCountPreview({ proposed: 0, toAttribute: 0, retained: 5 }, afterRemove, new Map([[id(1), "retained" as const]])))
      .toEqual({ proposed: 0, retained: 4, changes: 1 });
    // The next gesture on the mark counts from the state the previous one left.
    expect(draftCountPreview({ proposed: 0, toAttribute: 0, retained: 5 }, draft, new Map([[id(1), "retained" as const]])))
      .toEqual({ proposed: 1, retained: 4, changes: 2 });
  });

  it("draws only the part of the page the frame shows, whatever the zoom and the pan", () => {
    // A page of 800 × 400 points at scale 2 (1600 × 800 pixels) panned 400 pixels left in a frame of 800 × 400.
    const region = visibleCountRegion({ frame: { width: 800, height: 400 }, offset: { x: -400, y: 0 }, scale: 2,
      size: { width: 800, height: 400 } })!;
    expect(region).toEqual({ x0: 0.25, y0: 0, x1: 0.75, y1: 0.5 });
    expect(inCountRegion({ x: 0.5, y: 0.25 }, region)).toBe(true);
    expect(inCountRegion({ x: 0.1, y: 0.25 }, region)).toBe(false);
    expect(visibleCountRegion({ frame: { width: 800, height: 400 }, offset: { x: 0, y: 0 }, scale: 0, size: { width: 800, height: 400 } }))
      .toBeNull();
    // The sheet panned entirely beyond the frame: no part of it is shown, never a clamped edge (closing review of #485).
    expect(visibleCountRegion({ frame: { width: 800, height: 400 }, offset: { x: 1700, y: 0 }, scale: 2,
      size: { width: 800, height: 400 } })).toBeNull();
    expect(visibleCountRegion({ frame: { width: 800, height: 400 }, offset: { x: 0, y: -900 }, scale: 2,
      size: { width: 800, height: 400 } })).toBeNull();
  });
});

describe("a reload", () => {
  it("says what changed meanwhile", () => {
    const before = [mark(1, { state: "retained" }), mark(2), mark(3)];
    const after = [mark(1, { state: "retained", positionRevision: 1 }), mark(2, { state: "removed" }), mark(4)];
    const change = countMarksChange(before, after);
    expect(change).toEqual({ added: 1, removed: 2, moved: 1, decided: 0 });
    expect(countMarksChangeSentence(change, 2)).toBe("Les repères ont changé depuis leur affichage : 1 ajouté, 2 retirés, 1 déplacé. "
      + "Vos 2 modifications sont gardées : vérifiez-les puis enregistrez de nouveau.");
  });

  it("names the gestures made on a mark the page no longer holds as they were made", () => {
    let draft = emptyCountMarkDraft(ANSWER, 1, keys());
    draft = draftRemove(draft, { id: id(60), markId: id(1), page: 7, state: "retained", reason: "duplicate", note: null }, keys());
    draft = draftDecide(draft, { id: id(61), op: "retain", markId: id(2), page: 7, state: "proposed", restoredTo: "retained",
      word: null }, keys());
    draft = draftDecide(draft, { id: id(62), op: "restore", markId: id(2), page: 7, state: "retained", restoredTo: "proposed",
      word: null }, keys());
    draft = draftDecide(draft, { id: id(63), op: "retain", markId: id(3), page: 7, state: "proposed", restoredTo: "retained",
      word: null }, keys());
    const stale = staleDraftEntries(draft, [mark(2, { state: "removed" }), mark(3)], 7);
    expect([...stale].sort()).toEqual([id(60), id(61)]);
  });
});

describe("words", () => {
  const VIEWER = id(90);

  it("says who added or corrected a mark", () => {
    expect(countMarkOriginLabel(mark(1, { origin: "manual", createdBy: VIEWER }), {}, VIEWER)).toBe("Ajouté par vous");
    expect(countMarkOriginLabel(mark(1, { origin: "manual", createdBy: id(91) }), { [id(91)]: "Léa Fictive" }, VIEWER))
      .toBe("Ajouté à la main par Léa Fictive");
    expect(countMarkOriginLabel(mark(1, { movedBy: id(91) }), { [id(91)]: "Léa Fictive" }, VIEWER))
      .toBe("Proposé par l'analyse · Corrigé par Léa Fictive");
  });

  it("says what each event of the journal did, before and after, with its reason", () => {
    expect(countMarkEventLabel({ gesture: "move", before: { x: 0.5, y: 0.25, box: null }, after: { x: 0.125, y: 0.75, box: null },
      reasonCode: null, reasonText: null })).toBe("Déplacé de 50,0 % × 25,0 % à 12,5 % × 75,0 %");
    expect(countMarkEventLabel({ gesture: "remove", before: { state: "proposed" }, after: { state: "removed" }, reasonCode: "other",
      reasonText: "posé ailleurs" })).toBe("Retiré : autre motif — posé ailleurs");
    expect(countMarkEventLabel({ gesture: "retain", before: { state: "pending" }, after: { state: "retained", object: "distinct" },
      reasonCode: null, reasonText: null })).toBe("Retenu (était : nouvelle lecture à examiner) (objet distinct)");
    expect(countMarkEventLabel({ gesture: "verify", before: null, after: { retained: 3 }, reasonCode: null, reasonText: null }))
      .toBe("Page vérifiée : 3 repères retenus");
  });
});

describe("the keyboard", () => {
  const key = (value: string, more: Partial<Parameters<typeof countMarksListKey>[0]> = {}) =>
    ({ key: value, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, ...more });

  it("gives every gesture of the list its key", () => {
    expect(["ArrowDown", "ArrowUp", "Home", "End", "Delete", "r", "t", "d", "a", "n", "p"].map((value) => countMarksListKey(key(value), false)))
      .toEqual([{ kind: "step", step: 1 }, { kind: "step", step: -1 }, { kind: "edge", to: "first" }, { kind: "edge", to: "last" },
        { kind: "remove" }, { kind: "retain" }, { kind: "restore" }, { kind: "move" }, { kind: "reattribute" }, { kind: "add" },
        { kind: "verify" }]);
  });

  it("stays out of a field, a composition and the browser's own shortcuts", () => {
    expect(countMarksListKey(key("r"), true)).toBeNull();
    expect(countMarksListKey(key("r", { isComposing: true }), false)).toBeNull();
    expect(countMarksListKey(key("r", { ctrlKey: true }), false)).toBeNull();
    expect(countMarksListKey(key("ArrowDown", { shiftKey: true }), false)).toBeNull();
    expect(countMarksListKey(key("v"), false)).toBeNull();
  });

  it("moves the pointer one point of the page per arrow, ten with Shift, never off the page", () => {
    const size = { width: 1000, height: 500 };
    expect(nudgeCountPoint({ x: 0.5, y: 0.5 }, { key: "ArrowRight", shiftKey: false }, size)).toEqual({ x: 0.501, y: 0.5 });
    expect(nudgeCountPoint({ x: 0.5, y: 0.5 }, { key: "ArrowUp", shiftKey: true }, size)).toEqual({ x: 0.5, y: 0.48 });
    expect(nudgeCountPoint({ x: 0, y: 1 }, { key: "ArrowLeft", shiftKey: true }, size)).toEqual({ x: 0, y: 1 });
    expect(nudgeCountPoint({ x: 0.5, y: 0.5 }, { key: "Enter", shiftKey: false }, size)).toBeNull();
  });
});
