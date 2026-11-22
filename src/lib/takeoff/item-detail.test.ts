import { afterEach, describe, expect, it, vi } from "vitest";

import { ItemDetailQueue, chooseItemDetailPlan, itemDetailOpeningPage, itemDetailPagesOfInterest, type ItemDetailQueuePage } from "@/lib/takeoff/item-detail";
import { ItemDetailPlanError, createItemDetailReader } from "@/lib/takeoff/item-detail-client";
import { isItemDetailFieldTarget, itemDetailKeyAction } from "@/lib/takeoff/item-detail-keys";
import {
  DETAIL_PROJECT, JOB_EARLIER, JOB_RDC, PLAN_R1, PLAN_RDC, PLAN_SCAN, basinLine, notFoundLine, planViews, toMeasureLine,
} from "@/lib/takeoff/item-detail.test-fixtures";

// The pure parts of the detail of an item (lot 5), written with them: the plan it opens, the page, the frozen queue across
// the table's pages, the keyboard's mapping and the reader's bounded cache of plan resolutions.

const none = { planKey: null, jobId: null, source: null };

describe("chooseItemDetailPlan", () => {
  it("opens the first plan that answered, the plan named, an earlier reading named, or the dossier's plan to measure", () => {
    expect(chooseItemDetailPlan(basinLine, none)).toMatchObject({ kind: "reading", planKey: PLAN_RDC, jobId: JOB_RDC, current: true });
    expect(chooseItemDetailPlan(basinLine, { ...none, planKey: PLAN_R1 })).toMatchObject({ kind: "reading", planKey: PLAN_R1, current: true });
    expect(chooseItemDetailPlan(basinLine, { ...none, planKey: PLAN_RDC, jobId: JOB_EARLIER }))
      .toMatchObject({ kind: "reading", jobId: JOB_EARLIER, current: false });
    expect(chooseItemDetailPlan(toMeasureLine, none)).toEqual({ kind: "dossier", planKey: PLAN_R1, planName: null, reading: null });
    expect(chooseItemDetailPlan(toMeasureLine, { ...none, source: { documentId: PLAN_R1, generation: "2" } }))
      .toEqual({ kind: "source", documentId: PLAN_R1, generation: "2" });
    expect(chooseItemDetailPlan({ ...toMeasureLine, remeasurePlans: [] }, none)).toEqual({ kind: "none" });
  });
});

describe("chooseItemDetailPlan, identifiers that must be the item's", () => {
  const answerId = basinLine.readings[0]!.answer!.answerId;
  it("opens nothing for a plan, a piece, an answer or an observation of another item", () => {
    expect(chooseItemDetailPlan(basinLine, { ...none, planKey: PLAN_SCAN })).toEqual({ kind: "mismatch" });
    expect(chooseItemDetailPlan(basinLine, { ...none, source: { documentId: PLAN_SCAN, generation: null } })).toEqual({ kind: "mismatch" });
    expect(chooseItemDetailPlan(basinLine, { ...none, planKey: PLAN_RDC, jobId: JOB_RDC, answerId: "a-autre" })).toEqual({ kind: "mismatch" });
    expect(chooseItemDetailPlan(basinLine, { ...none, planKey: PLAN_RDC, jobId: JOB_RDC, answerId, observationId: "o-r1-1" }))
      .toEqual({ kind: "mismatch" });
  });

  it("selects the observation named in the answer shown", () => {
    expect(chooseItemDetailPlan(basinLine, { ...none, planKey: PLAN_RDC, jobId: JOB_RDC, answerId, observationId: "o-rdc-7" }))
      .toMatchObject({ kind: "reading", current: true, observationId: "o-rdc-7" });
  });
});

describe("itemDetailOpeningPage and itemDetailPagesOfInterest", () => {
  const answer = basinLine.readings[0]!.answer;

  it("opens the address's page, else the first observation's, else the first page searched", () => {
    expect(itemDetailOpeningPage({ requested: 7, answer, pagesRead: [], pageCount: 9 })).toEqual({ page: 7, requestedMissing: false });
    expect(itemDetailOpeningPage({ requested: null, answer, pagesRead: [], pageCount: 9 })).toEqual({ page: 2, requestedMissing: false });
    expect(itemDetailOpeningPage({ requested: null, answer: notFoundLine.readings[0]!.answer, pagesRead: [], pageCount: null }).page).toBe(1);
    expect(itemDetailOpeningPage({ requested: null, answer: null, pagesRead: [4, 6], pageCount: 9 }).page).toBe(4);
  });

  it("shows the first page, and says so, for a page the plan does not have", () => {
    expect(itemDetailOpeningPage({ requested: 12, answer, pagesRead: [], pageCount: 9 })).toEqual({ page: 1, requestedMissing: true });
  });

  it("lists the observations' and searched pages once, in order", () => {
    expect(itemDetailPagesOfInterest(answer, [9])).toEqual([2, 7, 9]);
    expect(itemDetailPagesOfInterest(null)).toEqual([]);
  });
});

describe("ItemDetailQueue", () => {
  const page = (offset: number, ids: string[], total: number): ItemDetailQueuePage => ({
    lines: ids.map((id, index) => ({ ...basinLine, itemId: id, position: offset + index })), total, offset, limit: 2, canReview: true,
    names: {}, plans: [],
  });

  it("finds the neighbours across a page boundary, asking for the page to read first", () => {
    const queue = new ItemDetailQueue();
    queue.add(page(2, ["c", "d"], 5));
    expect(queue.neighbour("c", -1)).toEqual({ offset: 0 });
    expect(queue.neighbour("d", 1)).toEqual({ offset: 4 });
    queue.add(page(4, ["e"], 5));
    expect(queue.neighbour("d", 1)).toEqual({ itemId: "e" });
    expect(queue.neighbour("e", 1)).toBeNull();
    expect(queue.position("e")).toEqual({ index: 4, total: 5, previous: null, next: null });
  });

  it("keeps a page as first read: a later read of it does not move its lines", () => {
    const queue = new ItemDetailQueue();
    queue.add(page(0, ["a", "b"], 4));
    queue.add(page(0, ["b", "a"], 4));
    expect(queue.position("a")?.index).toBe(0);
  });

  it("keeps a bounded number of pages", () => {
    const queue = new ItemDetailQueue(2);
    for (const offset of [0, 2, 4]) queue.add(page(offset, [`${offset}`], 10));
    expect(queue.page(0)).toBeNull();
    expect(queue.page(4)).not.toBeNull();
  });
});

describe("itemDetailKeyAction", () => {
  const key = (value: string, extra: Partial<Parameters<typeof itemDetailKeyAction>[0]> = {}) =>
    itemDetailKeyAction({ key: value, ctrlKey: false, metaKey: false, altKey: false, ...extra }, false);

  it("maps the first row of the keyboard table, and nothing that forces, sends or spends", () => {
    expect(key("ArrowDown")).toEqual({ kind: "move", step: 1 });
    expect(key("Escape")).toEqual({ kind: "back" });
    expect(key("V")).toEqual({ kind: "gesture", gesture: "accept_measured", initial: null });
    expect(key("3")).toEqual({ kind: "gesture", gesture: "enter_quantity", initial: "3" });
    for (const other of ["r", "m", "s", "f", "Delete", "Tab", " "]) expect(key(other)).toBeNull();
    expect(key("Process")).toBeNull();
  });

  // Review of PR 2 (written before the fix): Shift + ↓ moved the item, the handler never saw Shift.
  it("leaves Shift to the browser, but for a digit (typed with Shift on a French keyboard)", () => {
    expect(key("ArrowDown", { shiftKey: true })).toBeNull();
    expect(key("V", { shiftKey: true })).toBeNull();
    expect(key("Enter", { shiftKey: true })).toBeNull();
    expect(key("4", { shiftKey: true })).toEqual({ kind: "gesture", gesture: "enter_quantity", initial: "4" });
  });

  it("leaves a field's keys to the field", () => {
    expect(itemDetailKeyAction({ key: "v", ctrlKey: false, metaKey: false, altKey: false }, true)).toBeNull();
    expect(isItemDetailFieldTarget(null)).toBe(false);
    expect(isItemDetailFieldTarget({ closest: (selector: string) => (selector.includes("input") ? {} : null) } as never)).toBe(true);
  });
});

describe("createItemDetailReader", () => {
  afterEach(() => vi.unstubAllGlobals());
  const table = { readQueue: vi.fn(), readLine: vi.fn() };
  const view = planViews()[`${JOB_RDC}:${PLAN_RDC}`];

  // Review of PR 2 (written before the fix): the reader kept a resolution, so a dossier copy replaced since, or an
  // absence, was shown until evicted. A plan is resolved at each opening (the screen asks when a plan is opened).
  it("asks the server at each resolution, never answering from a previous one", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: view }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const reader = createItemDetailReader({ projectId: DETAIL_PROJECT, table });
    const request = { planKey: PLAN_RDC, jobId: JOB_RDC, source: null };
    expect(await reader.resolvePlan(request)).toEqual(view);
    await reader.resolvePlan(request);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String((fetch.mock.calls as unknown[][])[0]![0])).toBe(
      `/api/affaires/${DETAIL_PROJECT}/takeoff/item-detail/plan?plan=${PLAN_RDC}&lecture=${JOB_RDC}`);
  });

  it("refuses by the code and status of the answer, never with its text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: { code: "TAKEOFF_ITEM_DETAIL_PLAN_NOT_FOUND",
      message: "texte de la base" } }), { status: 404 })));
    const reader = createItemDetailReader({ projectId: DETAIL_PROJECT, table });
    await expect(reader.resolvePlan({ planKey: PLAN_R1, jobId: null, source: null }))
      .rejects.toEqual(new ItemDetailPlanError("TAKEOFF_ITEM_DETAIL_PLAN_NOT_FOUND", 404));
  });
});
