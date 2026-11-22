import { describe, expect, it } from "vitest";

import {
  buildItemLines,
  checkItemReviewTargets,
  freezeItemSelection,
  ITEM_REVIEW_LIMITS,
  itemAnswerAnomalies,
  planItemReviewCommand,
  type ItemAnswerView,
  type ItemContributionRow,
  type ItemEntryView,
  type ItemLineDecision,
  type ItemReadingInput,
  type ItemTablePoste,
  type ItemTableRow,
  type ItemTableScope,
} from "./item-table";
import type { ItemAggregateState } from "./item-answer-aggregation";

const PLANS = [
  { key: "plan-a", name: "Plan A · RDC", location: null },
  { key: "plan-b", name: "Plan B · R+1", location: null },
];

function poste(id: string, position: number, label: string, extra: Partial<ItemTablePoste> = {}): ItemTablePoste {
  return { id, position, label, expectedUnit: "u", sectionPath: ["Plomberie", "Appareils sanitaires"], referenceQuantity: null,
    dpgfReference: null, origin: "template", ...extra };
}

let answerCount = 0;
function answer(outcome: ItemAnswerView["outcome"], quantity: number | null, extra: Partial<ItemAnswerView> = {}): ItemAnswerView {
  answerCount += 1;
  const id = `00000000-0000-4000-8000-${String(answerCount).padStart(12, "0")}`;
  return {
    answerId: id, revision: "digest", jobId: "job-1", outcome, quantity: outcome === "measured" && quantity !== null ? { quantity, unit: "u" } : null,
    reasonCode: null, reasonText: null, searchedPages: [1, 2], unreadablePages: [], candidate: null, anomalies: [],
    readAt: "2026-11-22T08:00:00.000Z",
    observations: quantity === null || outcome !== "measured" ? []
      : [{ observationId: `obs-${id}`, role: "contribution", quantity, unit: "u", page: 1, evidence: "symboles LAV", confidence: 0.9,
        method: "symbol_count", takeoffItemId: `row-${id}`, row: { quantity, unit: "u", isVerified: false, isExcluded: false } }],
    ...extra,
  };
}

const accepted = (revision = 1) => ({ kind: "accepted" as const, revision, actorId: "member-1", at: "2026-11-22T09:00:00.000Z" });
const setAside = (revision = 1) => ({ kind: "set_aside" as const, revision, reason: "duplicate" as const, note: null,
  actorId: "member-1", at: "2026-11-22T09:00:00.000Z" });

function read(itemId: string, planKey: string, value: ItemAnswerView | "queued" | "running" | "failed",
  decision: ItemReadingInput["decision"] = null, extra: Partial<ItemReadingInput> = {}): ItemReadingInput {
  const plan = PLANS.find(({ key }) => key === planKey);
  const base = { itemId, planKey, planName: plan?.name ?? "Plan", location: null, decision, decisionRevision: decision?.revision ?? 0,
    entry: null, sent: false };
  const reading: ItemReadingInput = typeof value === "string"
    ? { ...base, unit: value, reading: value === "failed" ? "ended" : "in_flight", answer: null }
    : { ...base, unit: "succeeded", reading: "answered", answer: value };
  return { ...reading, ...extra };
}

/** A row as the database gives it: its state and its decision are SQL's, given here as the database would decide them. */
function row(item: ItemTablePoste, state: ItemAggregateState, decision: ItemLineDecision, readings: ItemReadingInput[],
  entry: ItemEntryView | null = null): ItemTableRow {
  const answered = readings.filter((reading) => reading.reading === "answered").length;
  const inFlight = readings.filter((reading) => reading.reading === "in_flight").length;
  return { item, state, decision, readings, entry,
    coverage: { expected: readings.length, answered, inFlight, ended: readings.length - answered - inFlight } };
}

const lines = (rows: ItemTableRow[], scope: ItemTableScope = { kind: "affaire" }, plans = PLANS) => buildItemLines(rows, { plans, scope });

describe("buildItemLines", () => {
  it("keeps the database's state and decision, and adds the observed total, partial while a plan is read", () => {
    const [lavabo] = lines([row(poste("lavabo", 0, "Lavabo"), "reading", "pending",
      [read("lavabo", "plan-a", answer("measured", 3)), read("lavabo", "plan-b", "running")])]);
    expect(lavabo).toMatchObject({ state: "reading", decision: "pending", observed: { quantity: 3, unit: "u", partial: true },
      coverage: { expected: 2, answered: 1, inFlight: 1 }, planCount: 2, family: "Plomberie / Appareils sanitaires" });
  });

  it("adds two plans' measures, and never the answer still read again", () => {
    const [wc] = lines([row(poste("wc", 1, "WC"), "measured", "pending",
      [read("wc", "plan-a", answer("measured", 2)), read("wc", "plan-b", answer("measured", 1))])]);
    expect(wc.observed).toEqual({ quantity: 3, unit: "u", partial: false });
    const [rereading] = lines([row(poste("wc", 1, "WC"), "reading", "pending",
      [read("wc", "plan-a", answer("measured", 2)), read("wc", "plan-b", answer("measured", 9), null, { unit: "running", reading: "in_flight" })])]);
    // The answer of a plan read again stays shown, its quantity no longer counted until the new reading.
    expect(rereading.observed).toEqual({ quantity: 2, unit: "u", partial: true });
    expect(rereading.readings[1].answer?.quantity?.quantity).toBe(9);
  });

  it("names the reasons of the readings: their own, their anomalies, unreadable pages, a plan without an answer", () => {
    const [vanne] = lines([row(poste("vanne", 3, "Vanne DN32"), "incomplete", "pending", [
      read("vanne", "plan-a", answer("uncertain", null, { reasonCode: "QUALIFIER_UNREADABLE", unreadablePages: [3] })),
      read("vanne", "plan-b", "failed")])]);
    expect(vanne.reasons).toEqual(["answer_reason:QUALIFIER_UNREADABLE", "unreadable_pages", "reading_ended"]);
  });

  it("shows a DPGF gap above 1 %, not at exactly 1 %, and judges none on a partial total", () => {
    const reference = (quantity: number) => poste("ref", 0, "Lavabo", { origin: "dpgf", referenceQuantity: quantity, dpgfReference: "3.1.2" });
    const at = (measured: number, ref: number) => lines([row(reference(ref), "measured", "pending",
      [read("ref", "plan-a", answer("measured", measured))])])[0];
    expect(at(101, 100)).toMatchObject({ gap: { quantity: 1, percent: 1, requiresReview: false } });
    expect(at(101, 100).eligibility.accept_measured.eligible).toBe(true);
    expect(at(102, 100)).toMatchObject({ gap: { quantity: 2, percent: 2, requiresReview: true }, reasons: expect.arrayContaining(["dpgf_gap"]) });
    expect(at(102, 100).eligibility.accept_measured).toEqual({ eligible: false, reason: "dpgf_gap" });
    expect(lines([row(reference(100), "reading", "pending", [read("ref", "plan-a", answer("measured", 50)), read("ref", "plan-b", "queued")])])[0].gap)
      .toBeNull();
  });

  it("retains an entered quantity apart from the model's raw result, an hypothesis only once included", () => {
    const entry = (included: boolean, category: ItemEntryView["category"] = "site_survey"): ItemEntryView => ({ itemId: "baignoire",
      scope: "affaire", planKey: null, revision: 1, quantity: 1, unit: "u", category, note: included ? null : "Une baignoire supposée.",
      included, actorId: "member-1", at: "2026-11-22T09:00:00.000Z", previous: null });
    const make = (value: ItemEntryView) => lines([row(poste("baignoire", 2, "Baignoire"), "not_found", "entered",
      [read("baignoire", "plan-a", answer("not_found", null))], value)])[0];
    expect(make(entry(true))).toMatchObject({ observed: null, retained: { quantity: 1, unit: "u", source: "entered" }, decision: "entered" });
    expect(make(entry(true)).readings[0].answer?.outcome).toBe("not_found");
    const hypothesis = make(entry(false, "hypothesis"));
    expect(hypothesis.retained).toBeNull();
    expect(hypothesis.reasons).toContain("hypothesis_to_include");
    expect(hypothesis.eligibility.include_entry.eligible).toBe(true);
    expect(hypothesis.targets.entryRevision).toBe(1);
  });

  it("names each current answer with its decision's revision, which goes on after a reinstatement", () => {
    const decided = answer("measured", 3);
    const [line] = lines([row(poste("a", 0, "Lavabo"), "measured", "pending",
      [read("a", "plan-a", decided, null, { decisionRevision: 3 })])]);
    expect(line.targets).toEqual({ itemId: "a", entryRevision: 0,
      answers: [{ answerId: decided.answerId, answerRevision: "digest", decisionRevision: 3 }] });
  });
});

describe("what the table retains: the reviewed rows as they now are", () => {
  const corrected = (quantity: number, rowQuantity: number, extra: Partial<NonNullable<ItemAnswerView["observations"][number]["row"]>> = {}) => {
    const value = answer("measured", quantity);
    return { ...value, observations: value.observations.map((observation) => ({ ...observation,
      row: { quantity: rowQuantity, unit: "u", isVerified: true, isExcluded: false, ...extra } })) };
  };

  it("keeps the model's reading as observed and retains the row a targeted correction holds", () => {
    // The model read 3; an operator corrected the positive row to 7 and accepted it.
    const [line] = lines([row(poste("a", 0, "Lavabo"), "measured", "accepted", [read("a", "plan-a", corrected(3, 7), accepted())])]);
    expect(line.observed).toEqual({ quantity: 3, unit: "u", partial: false });
    expect(line.retained).toEqual({ quantity: 7, unit: "u", source: "measured", partial: false });
    expect(line.readings[0].answer?.quantity?.quantity).toBe(3);
  });

  it("shows an acceptance a targeted edit withdrew as a decision to take (the database gives it no decision)", () => {
    const [line] = lines([row(poste("a", 0, "Lavabo"), "measured", "pending", [read("a", "plan-a", corrected(3, 7, { isVerified: false }))])]);
    expect(line.retained).toBeNull();
    expect(line.eligibility.accept_measured).toEqual({ eligible: true, reason: null });
  });

  it("judges the DPGF gap and the units on the rows an acceptance would verify, not on the raw reading", () => {
    const reference = poste("ref", 0, "Lavabo", { origin: "dpgf", referenceQuantity: 10, dpgfReference: "3.1.2" });
    const [gap] = lines([row(reference, "measured", "pending", [read("ref", "plan-a", corrected(10, 12, { isVerified: false }))])]);
    expect(gap.gap).toMatchObject({ quantity: 2, requiresReview: true });
    expect(gap.eligibility.accept_measured).toEqual({ eligible: false, reason: "dpgf_gap" });
    const [units] = lines([row(poste("b", 1, "WC"), "measured", "pending", [read("b", "plan-a", corrected(1, 1, { isVerified: false })),
      read("b", "plan-b", corrected(2, 2, { isVerified: false, unit: "ml" }))])]);
    expect(units.reasons).toContain("unit_conflict");
    expect(units.eligibility.accept_measured).toEqual({ eligible: false, reason: "unit_conflict" });
  });

  it("counts nothing for a line set aside: its entry is kept, and a plan's entry on an answer set aside counts neither", () => {
    const entry = (scope: "affaire" | "plan"): ItemEntryView => ({ itemId: "b", scope, planKey: scope === "plan" ? "plan-a" : null,
      revision: 1, quantity: 5, unit: "u", category: "site_survey", note: null, included: true, actorId: "member-1",
      at: "2026-11-22T09:00:00.000Z", previous: null });
    const [aside] = lines([row(poste("b", 1, "Baignoire"), "not_found", "set_aside", [read("b", "plan-a", answer("not_found", null),
      setAside())], entry("affaire"))]);
    expect(aside.retained).toBeNull();
    expect(aside.entry?.quantity).toBe(5);
    const [planEntry] = lines([row(poste("b", 1, "Baignoire"), "not_found", "set_aside", [
      read("b", "plan-a", answer("not_found", null), setAside(), { entry: entry("plan") })])]);
    expect(planEntry.retained).toBeNull();
  });

  it("never offers a bulk gesture on a plan already sent to an estimate", () => {
    const [line] = lines([row(poste("a", 0, "Lavabo"), "measured", "pending", [read("a", "plan-a", answer("measured", 3), null,
      { sent: true })])]);
    expect(line.eligibility.accept_measured).toEqual({ eligible: false, reason: "sent" });
    expect(line.eligibility.set_aside).toEqual({ eligible: false, reason: "sent" });
    expect(line.reasons).toContain("sent");
    const [aside] = lines([row(poste("a", 0, "Lavabo"), "measured", "set_aside", [read("a", "plan-a", answer("measured", 3), setAside(),
      { sent: true })])]);
    expect(aside.eligibility.reinstate).toEqual({ eligible: false, reason: "sent" });
  });
});

describe("eligibility of the gestures", () => {
  const view = lines([
    row(poste("a", 0, "Lavabo"), "measured", "pending", [read("a", "plan-a", answer("measured", 3)), read("a", "plan-b", answer("not_found", null))]),
    row(poste("b", 1, "WC"), "measured", "pending", [read("b", "plan-a", answer("measured", 2, { anomalies: ["hypothesis"] }))]),
    row(poste("c", 2, "Baignoire"), "uncertain", "pending", [read("c", "plan-a", answer("uncertain", null))]),
    row(poste("d", 3, "Évier"), "not_found", "pending", [read("d", "plan-a", answer("not_found", null))]),
    row(poste("e", 4, "Douche"), "measured", "pending", [read("e", "plan-a", answer("measured", 1, { anomalies: ["low_confidence"] }))]),
    row(poste("f", 5, "Mitigeur"), "reading", "pending", [read("f", "plan-a", answer("measured", 4)), read("f", "plan-b", "running")]),
    row(poste("g", 6, "Vanne"), "to_measure", "none", []),
  ]);
  const line = (id: string) => view.find(({ itemId }) => itemId === id)!;

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
    expect(lines([row(poste("g", 6, "Vanne"), "to_measure", "none", [])], { kind: "affaire" }, [])[0].eligibility.remeasure)
      .toEqual({ eligible: false, reason: "no_plan" });
  });

  it("takes an item already decided out of a second acceptance and keeps a set aside apart", () => {
    const [decided] = lines([row(poste("a", 0, "Lavabo"), "measured", "accepted", [read("a", "plan-a", answer("measured", 3), accepted())])]);
    expect(decided.eligibility.accept_measured).toEqual({ eligible: false, reason: "already_decided" });
    expect(decided.retained).toMatchObject({ quantity: 3, source: "measured", partial: false });
    const [aside] = lines([row(poste("a", 0, "Lavabo"), "measured", "set_aside", [read("a", "plan-a", answer("measured", 3), setAside())])]);
    expect(aside.eligibility.set_aside).toEqual({ eligible: false, reason: "already_set_aside" });
    expect(aside.eligibility.reinstate.eligible).toBe(true);
    expect(aside.retained).toBeNull();
  });
});

describe("the anomalies of an answer, from its positive rows", () => {
  const measured = answer("measured", 3);
  const rowOf = (extra: Partial<ItemContributionRow> = {}): ItemContributionRow => ({ id: measured.observations[0].takeoffItemId!,
    quantity: 3, unit: "u", isVerified: false, isExcluded: false, rulesStale: false, ruleResults: [], confidence: 0.9, evidence: "symboles", sourcePage: 1, metadata: {},
    quantityEntryCategory: null, ...extra });
  const anomalies = (extra: Partial<ItemContributionRow> = {}, answerExtra: Partial<ItemAnswerView> = {}, expectedUnit: string | null = "u") =>
    itemAnswerAnomalies({ ...measured, ...answerExtra }, new Map([[rowOf().id, rowOf(extra)]]),
      { expectedUnit, lowConfidenceThreshold: 0.5 });

  it("finds none on a verifiable row", () => {
    expect(anomalies()).toEqual([]);
  });

  it("finds what the database's acceptance refuses, and what the bulk acceptance leaves to a review line by line", () => {
    expect(anomalies({ metadata: { quantity_nature: "estimated" } })).toEqual(["hypothesis"]);
    expect(anomalies({ rulesStale: true })).toEqual(["rules_stale"]);
    expect(anomalies({ ruleResults: [{ status: "fail", rule: "scale" }] })).toEqual(["rule_failed"]);
    expect(anomalies({ confidence: 0.4 })).toEqual(["low_confidence"]);
    expect(anomalies({ evidence: " ", sourcePage: null })).toEqual(["missing_evidence"]);
    expect(anomalies({ isExcluded: true })).toEqual(["alert"]);
    expect(anomalies({}, { reasonCode: "DUPLICATE_READING" })).toEqual(["alert"]);
    expect(anomalies({}, {}, "ml")).toEqual(["unit_mismatch"]);
    // A row the page could not read is never taken as verifiable.
    expect(itemAnswerAnomalies(measured, new Map(), { expectedUnit: "u", lowConfidenceThreshold: 0.5 })).toEqual(["missing_evidence"]);
  });
});

describe("the frozen selection and the review commands", () => {
  const many = Array.from({ length: 120 }, (_, index) => poste(`item-${index}`, index, `Poste ${index}`));
  const rows = many.map((item) => item.position % 3 === 0
    ? row(item, "not_found", "pending", [read(item.id, "plan-a", answer("not_found", null))])
    : row(item, "measured", "pending", [read(item.id, "plan-a", answer("measured", 2))]));
  const view = lines(rows);

  it("freezes every line given, with its count and what each gesture may do", () => {
    const frozen = freezeItemSelection(view);
    expect(frozen.count).toBe(120);
    expect(frozen.eligible).toMatchObject({ accept_measured: 80, set_aside: 120, enter_quantity: 40 });
    expect(frozen.items[0].eligible).toEqual(["set_aside", "enter_quantity", "remeasure"]);
  });

  it("names the items asked that are no longer in the scope", () => {
    expect(freezeItemSelection(view.slice(1, 3), ["item-1", "item-2", "gone"]).missing).toEqual(["gone"]);
  });

  it("refuses a selection above its bound instead of truncating it", () => {
    const tooMany = lines(Array.from({ length: ITEM_REVIEW_LIMITS.items + 1 }, (_, index) => row(poste(`x-${index}`, index, "P"), "to_measure", "none", [])));
    expect(() => freezeItemSelection(tooMany)).toThrow(/1\s000 postes/);
  });

  it("finds a stale selection: an answer read again, a decision taken meanwhile, an answer arrived", () => {
    const targets = view.filter(({ itemId }) => ["item-1", "item-2", "item-4"].includes(itemId)).map(({ targets }) => targets);
    const changed = lines(rows.map((value) => {
      if (value.item.id === "item-1") return { ...value, readings: [read("item-1", "plan-a", answer("measured", 2))] };
      if (value.item.id === "item-2") return { ...value, readings: value.readings.map((reading) => ({ ...reading, decision: accepted(1), decisionRevision: 1 })) };
      if (value.item.id === "item-4") return { ...value, readings: [...value.readings, read("item-4", "plan-b", answer("measured", 1))] };
      return value;
    }));
    expect(checkItemReviewTargets(changed, targets).stale.map(({ itemId }) => itemId).sort()).toEqual(["item-1", "item-2", "item-4"]);
    expect(checkItemReviewTargets(view, targets).stale).toEqual([]);
  });

  it("applies the eligible lines and names the others with their reason", () => {
    const targets = view.filter(({ itemId }) => itemId === "item-0" || itemId === "item-1").map(({ targets }) => targets);
    expect(planItemReviewCommand(view, { gesture: "accept_measured", targets })).toEqual({ kind: "planned",
      apply: [{ itemId: "item-1", label: "Poste 1" }], skipped: [{ itemId: "item-0", label: "Poste 0", reason: "not_measured" }] });
    const moved = lines(rows.map((value) => value.item.id === "item-1"
      ? { ...value, readings: value.readings.map((reading) => ({ ...reading, decision: setAside(1), decisionRevision: 1 })) } : value));
    expect(planItemReviewCommand(moved, { gesture: "accept_measured", targets }))
      .toEqual({ kind: "stale", stale: [{ itemId: "item-1", label: "Poste 1" }] });
  });
});
