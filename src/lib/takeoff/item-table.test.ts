import { describe, expect, it } from "vitest";

import {
  buildItemTable,
  checkItemReviewTargets,
  freezeItemSelection,
  ITEM_REVIEW_LIMITS,
  pageItemTable,
  planItemReviewCommand,
  type ItemAnswerView,
  type ItemReadingInput,
  type ItemTableInput,
  type ItemTablePoste,
} from "./item-table";

const PLAN_A = { key: "plan-a", name: "Plan A · RDC", location: { key: "bat-a:rdc", label: "Bâtiment A · RDC" } };
const PLAN_B = { key: "plan-b", name: "Plan B · R+1", location: { key: "bat-b:r1", label: "Bâtiment B · R+1" } };

function poste(id: string, position: number, label: string, extra: Partial<ItemTablePoste> = {}): ItemTablePoste {
  return { id, position, label, expectedUnit: "u", sectionPath: ["Plomberie", "Appareils sanitaires"], referenceQuantity: null,
    dpgfReference: null, origin: "template", ...extra };
}

let answerCount = 0;
function answer(outcome: ItemAnswerView["outcome"], quantity: number | null, extra: Partial<ItemAnswerView> = {}): ItemAnswerView {
  answerCount += 1;
  const id = `00000000-0000-4000-8000-${String(answerCount).padStart(12, "0")}`;
  return {
    answerId: id, revision: "1", jobId: "job-1", outcome, reasonCode: null, reasonText: null, searchedPages: [1, 2],
    unreadablePages: [], candidate: null, anomalies: [], readAt: "2026-11-22T08:00:00.000Z",
    observations: quantity === null || outcome !== "measured" ? []
      : [{ observationId: `obs-${id}`, quantity, unit: "u", page: 1, evidence: "symboles LAV", confidence: 0.9, method: "pdf" }],
    ...extra,
  };
}

function read(itemId: string, planKey: string, value: ItemAnswerView | ItemReadingInput["unit"], decision: ItemReadingInput["decision"] = null): ItemReadingInput {
  return typeof value === "string"
    ? { itemId, planKey, unit: value, answer: null, decision: null }
    : { itemId, planKey, unit: "succeeded", answer: value, decision };
}

const accepted = (revision = 1) => ({ kind: "accepted" as const, revision, actorId: "member-1", at: "2026-11-22T09:00:00.000Z" });
const setAside = (revision = 1) => ({ kind: "set_aside" as const, revision, reason: "duplicate" as const, note: null,
  actorId: "member-1", at: "2026-11-22T09:00:00.000Z" });

function table(input: Partial<ItemTableInput>) {
  return buildItemTable({ items: [], plans: [PLAN_A, PLAN_B], readings: [], entries: [], scope: { kind: "affaire" }, ...input });
}

describe("buildItemTable", () => {
  const lavabo = poste("lavabo", 0, "Lavabo");
  const wc = poste("wc", 1, "WC");
  const baignoire = poste("baignoire", 2, "Baignoire");
  const vanne = poste("vanne", 3, "Vanne DN32", { sectionPath: ["Plomberie", "Robinetterie"] });
  const added = poste("ajout", 4, "Receveur de douche", { origin: "manual", sectionPath: ["Postes ajoutés"] });

  it("gives every item a line in document order, with its state and its partial total", () => {
    const lines = table({
      items: [lavabo, wc, baignoire, vanne, added],
      readings: [
        read("lavabo", "plan-a", answer("measured", 3)), read("lavabo", "plan-b", "running"),
        read("wc", "plan-a", answer("measured", 2)), read("wc", "plan-b", answer("measured", 1)),
        read("baignoire", "plan-a", answer("not_found", null)), read("baignoire", "plan-b", answer("not_found", null)),
        read("vanne", "plan-a", answer("uncertain", null, { reasonCode: "diameter_unreadable", reasonText: "Le diamètre n’est pas lisible" })),
        read("vanne", "plan-b", answer("not_found", null)),
      ],
    }).lines;

    const byId = Object.fromEntries(lines.map((line) => [line.itemId, line]));
    expect(byId.lavabo).toMatchObject({ state: "reading", observed: { quantity: 3, unit: "u", partial: true },
      coverage: { expected: 2, answered: 1 }, planCount: 2 });
    expect(byId.wc).toMatchObject({ state: "measured", observed: { quantity: 3, unit: "u", partial: false } });
    expect(byId.baignoire).toMatchObject({ state: "not_found", observed: null });
    expect(byId.vanne).toMatchObject({ state: "uncertain", reasons: expect.arrayContaining(["answer_reason:diameter_unreadable"]) });
    // An item added after the analysis was sealed is still a line: « to measure », never « not found ».
    expect(byId.ajout).toMatchObject({ state: "to_measure", observed: null, planCount: 0, decision: "none" });
  });

  it("puts the decisions to take first, then keeps the stable document order", () => {
    const lines = table({
      items: [lavabo, wc, baignoire, added],
      readings: [
        read("lavabo", "plan-a", "running"),
        read("wc", "plan-a", answer("measured", 2), accepted()),
        read("baignoire", "plan-a", answer("not_found", null)),
      ],
    }).lines;
    // Baignoire waits for a decision; the others keep the order of the list.
    expect(lines.map(({ itemId }) => itemId)).toEqual(["baignoire", "lavabo", "wc", "ajout"]);
    expect(lines.map(({ decision }) => decision)).toEqual(["pending", "none", "accepted", "none"]);
  });

  it("reads one plan in the plan's scope: only the items read there, each with that plan's answer", () => {
    const view = table({
      items: [lavabo, wc, added],
      scope: { kind: "plan", planKey: "plan-b" },
      readings: [read("lavabo", "plan-a", answer("measured", 3)), read("lavabo", "plan-b", answer("measured", 2)),
        read("wc", "plan-a", answer("measured", 1))],
    });
    expect(view.lines.map(({ itemId }) => itemId)).toEqual(["lavabo"]);
    expect(view.lines[0]).toMatchObject({ state: "measured", observed: { quantity: 2, partial: false }, coverage: { expected: 1 } });
    expect(view.lines[0].targets.answers).toHaveLength(1);
  });

  it("filters by state, family, location and decision", () => {
    const base = {
      items: [lavabo, wc, vanne, added],
      readings: [read("lavabo", "plan-a", answer("measured", 3)), read("wc", "plan-b", answer("measured", 1), accepted()),
        read("vanne", "plan-a", answer("uncertain", null))],
    };
    const ids = (filter: Parameters<typeof table>[0]["filter"]) => table({ ...base, filter }).lines.map(({ itemId }) => itemId);
    expect(ids({ states: ["measured"] })).toEqual(["lavabo", "wc"]);
    expect(ids({ families: ["Plomberie / Robinetterie"] })).toEqual(["vanne"]);
    expect(ids({ locations: ["bat-b:r1"] })).toEqual(["wc"]);
    expect(ids({ decisions: ["pending"] })).toEqual(["lavabo", "vanne"]);
    expect(ids({ decisions: ["none"] })).toEqual(["ajout"]);
    // Facets count the scope before the filters, so that a filter never hides its own options.
    expect(table({ ...base, filter: { states: ["measured"] } }).facets.states).toMatchObject({ measured: 2, uncertain: 1, to_measure: 1 });
  });

  it("shows a DPGF gap above 1 % as an anomaly, not at exactly 1 %", () => {
    const reference = (quantity: number) => poste("ref", 0, "Lavabo", { origin: "dpgf", referenceQuantity: quantity, dpgfReference: "3.1.2" });
    const at = (measured: number, ref: number) => table({ items: [reference(ref)],
      readings: [read("ref", "plan-a", answer("measured", measured))] }).lines[0];
    expect(at(101, 100)).toMatchObject({ gap: { quantity: 1, percent: 1, requiresReview: false } });
    expect(at(101, 100).eligibility.accept_measured.eligible).toBe(true);
    expect(at(102, 100)).toMatchObject({ gap: { quantity: 2, percent: 2, requiresReview: true },
      reasons: expect.arrayContaining(["dpgf_gap"]) });
    expect(at(102, 100).eligibility.accept_measured).toEqual({ eligible: false, reason: "dpgf_gap" });
    // No gap is judged on a partial total.
    expect(table({ items: [reference(100)], readings: [read("ref", "plan-a", answer("measured", 50)), read("ref", "plan-b", "queued")] })
      .lines[0].gap).toBeNull();
  });

  it("retains an entered quantity apart from the model's raw result, which stays readable", () => {
    const [line] = table({
      items: [baignoire],
      readings: [read("baignoire", "plan-a", answer("not_found", null))],
      entries: [{ itemId: "baignoire", scope: "affaire", planKey: null, revision: 1, quantity: 1, unit: "u",
        category: "site_survey", note: null, included: true, actorId: "member-1", at: "2026-11-22T09:00:00.000Z", previous: null }],
    }).lines;
    expect(line).toMatchObject({ state: "not_found", observed: null, decision: "entered",
      retained: { quantity: 1, unit: "u", source: "entered" } });
    expect(line.readings[0].answer?.outcome).toBe("not_found");
  });

  it("does not retain an entered hypothesis until it is included by its own decision", () => {
    const entry = { itemId: "baignoire", scope: "affaire" as const, planKey: null, revision: 1, quantity: 1, unit: "u",
      category: "hypothesis" as const, note: "Une baignoire supposée au R+1 selon le CCTP.", included: false,
      actorId: "member-1", at: "2026-11-22T09:00:00.000Z", previous: null };
    const notIncluded = table({ items: [baignoire], readings: [read("baignoire", "plan-a", answer("not_found", null))],
      entries: [entry] }).lines[0];
    expect(notIncluded.retained).toBeNull();
    expect(notIncluded.reasons).toContain("hypothesis_to_include");
    expect(notIncluded.eligibility.include_entry.eligible).toBe(true);
    const included = table({ items: [baignoire], readings: [read("baignoire", "plan-a", answer("not_found", null))],
      entries: [{ ...entry, included: true }] }).lines[0];
    expect(included.retained).toMatchObject({ quantity: 1, source: "entered" });
    expect(included.eligibility.include_entry.eligible).toBe(false);
  });
});

describe("eligibility of the gestures", () => {
  const items = [poste("a", 0, "Lavabo"), poste("b", 1, "WC"), poste("c", 2, "Baignoire"), poste("d", 3, "Évier"),
    poste("e", 4, "Douche"), poste("f", 5, "Mitigeur"), poste("g", 6, "Vanne")];

  const view = table({
    items,
    readings: [
      read("a", "plan-a", answer("measured", 3)), read("a", "plan-b", answer("not_found", null)),
      read("b", "plan-a", answer("measured", 2, { anomalies: ["hypothesis"] })),
      read("c", "plan-a", answer("uncertain", null)),
      read("d", "plan-a", answer("not_found", null)),
      read("e", "plan-a", answer("measured", 1, { anomalies: ["page_decision"] })),
      read("f", "plan-a", answer("measured", 4)), read("f", "plan-b", "running"),
    ],
  });
  const line = (id: string) => view.lines.find(({ itemId }) => itemId === id)!;

  it("accepts only the measured items of a full coverage without anomaly", () => {
    expect(line("a").eligibility.accept_measured).toEqual({ eligible: true, reason: null });
    expect(line("b").eligibility.accept_measured).toEqual({ eligible: false, reason: "anomaly" });
    expect(line("c").eligibility.accept_measured).toEqual({ eligible: false, reason: "not_measured" });
    expect(line("d").eligibility.accept_measured).toEqual({ eligible: false, reason: "not_measured" });
    expect(line("e").eligibility.accept_measured).toEqual({ eligible: false, reason: "anomaly" });
    expect(line("f").eligibility.accept_measured).toEqual({ eligible: false, reason: "coverage_incomplete" });
    expect(line("g").eligibility.accept_measured).toEqual({ eligible: false, reason: "not_measured" });
  });

  it("sets aside any line with a reading, also without a positive quantity; never an item nothing read", () => {
    expect(line("d").eligibility.set_aside.eligible).toBe(true);
    expect(line("c").eligibility.set_aside.eligible).toBe(true);
    expect(line("g").eligibility.set_aside).toEqual({ eligible: false, reason: "no_answer" });
  });

  it("offers the complementary entry on items not found or uncertain only", () => {
    expect(line("c").eligibility.enter_quantity.eligible).toBe(true);
    expect(line("d").eligibility.enter_quantity.eligible).toBe(true);
    expect(line("a").eligibility.enter_quantity).toEqual({ eligible: false, reason: "not_entry_state" });
    expect(line("g").eligibility.enter_quantity).toEqual({ eligible: false, reason: "not_entry_state" });
  });

  it("remeasures any item with a plan to read, its first measure included, never one being read", () => {
    expect(line("g").eligibility.remeasure).toEqual({ eligible: true, reason: null });
    expect(line("g").remeasurePlans).toEqual(["plan-a", "plan-b"]);
    expect(line("a").remeasurePlans).toEqual(["plan-a", "plan-b"]);
    expect(line("f").eligibility.remeasure).toEqual({ eligible: false, reason: "reading" });
    expect(table({ items, plans: [] }).lines[0].eligibility.remeasure).toEqual({ eligible: false, reason: "no_plan" });
  });

  it("takes an item already decided out of a second acceptance and keeps a set aside apart", () => {
    const decided = table({ items: [poste("a", 0, "Lavabo")], readings: [read("a", "plan-a", answer("measured", 3), accepted())] }).lines[0];
    expect(decided.eligibility.accept_measured).toEqual({ eligible: false, reason: "already_decided" });
    const aside = table({ items: [poste("a", 0, "Lavabo")], readings: [read("a", "plan-a", answer("measured", 3), setAside())] }).lines[0];
    expect(aside.decision).toBe("set_aside");
    expect(aside.eligibility.set_aside).toEqual({ eligible: false, reason: "already_set_aside" });
    expect(aside.eligibility.reinstate.eligible).toBe(true);
    expect(aside.retained).toBeNull();
  });
});

describe("the frozen selection and the review commands", () => {
  const many = Array.from({ length: 120 }, (_, index) => poste(`item-${index}`, index, `Poste ${index}`));
  const readings = many.map((item) => read(item.id, "plan-a", answer(item.position % 3 === 0 ? "not_found" : "measured", 2)));
  const view = table({ items: many, readings });

  it("freezes every result of the filter beyond the visible page, with its count and eligible counts", () => {
    const page = pageItemTable(view.lines, { offset: 0, limit: 50 });
    expect(page.lines).toHaveLength(50);
    expect(page.total).toBe(120);
    const frozen = freezeItemSelection(view, { kind: "filter" });
    expect(frozen.count).toBe(120);
    expect(frozen.items).toHaveLength(120);
    expect(frozen.eligible).toMatchObject({ accept_measured: 80, set_aside: 120, enter_quantity: 40 });
    expect(frozen.items[0].target.answers[0]).toEqual({ answerId: expect.any(String), answerRevision: "1", decisionRevision: 0 });
    expect(frozen.items[0].eligible).toEqual(["set_aside", "enter_quantity", "remeasure"]);
  });

  it("freezes a hand-made selection by its identifiers, and names the ones no longer in the scope", () => {
    const frozen = freezeItemSelection(view, { kind: "items", itemIds: ["item-1", "item-2", "gone"] });
    expect(frozen.items.map(({ itemId }) => itemId)).toEqual(["item-1", "item-2"]);
    expect(frozen.missing).toEqual(["gone"]);
  });

  it("refuses a selection above its bound instead of truncating it", () => {
    const tooMany = table({ items: Array.from({ length: ITEM_REVIEW_LIMITS.items + 1 }, (_, index) => poste(`x-${index}`, index, "P")) });
    expect(() => freezeItemSelection(tooMany, { kind: "filter" })).toThrow(/1\s000 postes/);
  });

  it("finds a stale selection: an answer read again, a decision taken meanwhile, an answer arrived", () => {
    const frozen = freezeItemSelection(view, { kind: "items", itemIds: ["item-1", "item-2", "item-4"] });
    const changed = table({
      items: many,
      readings: readings.map((reading) => reading.itemId === "item-1" && reading.answer
        ? { ...reading, answer: { ...reading.answer, revision: "2" } }
        : reading.itemId === "item-2" ? { ...reading, decision: accepted(1) } : reading)
        .concat([read("item-4", "plan-b", answer("measured", 1))]),
      plans: [PLAN_A, PLAN_B],
    });
    const targets = frozen.items.map(({ target }) => target);
    expect(checkItemReviewTargets(changed, targets).stale.map(({ itemId }) => itemId).sort())
      .toEqual(["item-1", "item-2", "item-4"]);
    expect(checkItemReviewTargets(view, targets).stale).toEqual([]);
  });

  it("plans nothing on a stale selection, and only the eligible lines otherwise", () => {
    const frozen = freezeItemSelection(view, { kind: "items", itemIds: ["item-0", "item-1"] });
    const targets = frozen.items.map(({ target }) => target);
    const plan = planItemReviewCommand(view, { gesture: "accept_measured", targets });
    expect(plan).toEqual({ kind: "planned", apply: [expect.objectContaining({ itemId: "item-1" })],
      skipped: [{ itemId: "item-0", label: "Poste 0", reason: "not_measured" }] });

    const moved = table({ items: many, readings: readings.map((reading) => reading.itemId === "item-1"
      ? { ...reading, decision: setAside(1) } : reading) });
    expect(planItemReviewCommand(moved, { gesture: "accept_measured", targets }))
      .toEqual({ kind: "stale", stale: [{ itemId: "item-1", label: "Poste 1" }] });
  });
});
