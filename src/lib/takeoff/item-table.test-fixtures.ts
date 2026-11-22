import { aggregateItemReadings } from "./item-answer-aggregation";
import {
  buildItemLines,
  type ItemAnswerDecision,
  type ItemAnswerView,
  type ItemEntryView,
  type ItemLineDecision,
  type ItemReadingInput,
  type ItemTableFacets,
  type ItemTableFilter,
  type ItemTablePlan,
  type ItemTablePoste,
  type ItemTableRow,
  type ItemTableScope,
} from "./item-table";
import type { ItemRemeasurePreview, ItemTableResponse } from "./item-table-contracts";

/**
 * Fictional items, plans and answers for the table's tests. The database pages, filters, orders and decides each line's
 * state and decision (public.read_takeoff_item_table); these fixtures play its part on small inputs, then build the
 * lines through the table's own model as the server does.
 */

export const FIXTURE_ITEM_PROJECT = "11111111-1111-4111-8111-111111111111";
export const FIXTURE_MEMBER = "22222222-2222-4222-8222-222222222222";

export const fixtureItemId = (index: number) => `00000000-0000-4000-a000-${String(index).padStart(12, "0")}`;
const answerId = (index: number) => `00000000-0000-4000-b000-${String(index).padStart(12, "0")}`;

export const FIXTURE_PLANS: ItemTablePlan[] = [
  { key: "plan-rdc", name: "Plan RDC", location: { key: "A|RDC", label: "A · RDC" } },
  { key: "plan-r1", name: "Plan R+1", location: { key: "A|R+1", label: "A · R+1" } },
];

export function fixturePoste(index: number, label: string, extra: Partial<ItemTablePoste> = {}): ItemTablePoste {
  return { id: fixtureItemId(index), position: index, label, expectedUnit: "u", sectionPath: ["Plomberie", "Appareils sanitaires"],
    referenceQuantity: null, dpgfReference: null, origin: "template", ...extra };
}

let answers = 0;
export function fixtureAnswer(outcome: ItemAnswerView["outcome"], quantity: number | null,
  extra: Partial<ItemAnswerView> = {}): ItemAnswerView {
  answers += 1;
  const id = answerId(answers);
  return {
    answerId: id, revision: `digest-${answers}`, jobId: "33333333-3333-4333-8333-333333333333", outcome,
    quantity: outcome === "measured" && quantity !== null ? { quantity, unit: "u" } : null, reasonCode: null, reasonText: null,
    searchedPages: [1, 2], unreadablePages: [], candidate: null, anomalies: [], readAt: "2026-11-22T08:00:00.000Z",
    observations: outcome === "measured" && quantity !== null
      ? [{ observationId: `${id}-1`, role: "contribution", quantity, unit: "u", page: 1, evidence: "symboles relevés", confidence: 0.9,
        method: "symbol_count", takeoffItemId: "44444444-4444-4444-8444-444444444444",
        row: { quantity, unit: "u", isVerified: false, isExcluded: false } }] : [],
    ...extra,
  };
}

export function fixtureReading(item: number, planKey: string, value: ItemAnswerView | "queued" | "running" | "failed",
  decision: ItemAnswerDecision | null = null): ItemReadingInput {
  const plan = FIXTURE_PLANS.find(({ key }) => key === planKey);
  const base = { itemId: fixtureItemId(item), planKey, planName: plan?.name ?? "Plan", location: plan?.location?.label ?? null,
    decision, decisionRevision: decision?.revision ?? 0, entry: null, sent: false };
  return typeof value === "string"
    ? { ...base, unit: value, reading: value === "failed" ? "ended" : "in_flight", answer: null }
    : { ...base, unit: "succeeded", reading: "answered", answer: value };
}

/** The decision of a line as the database decides it (private.takeoff_item_line_decision). */
function lineDecision(readings: readonly ItemReadingInput[], scopeEntry: ItemEntryView | null): ItemLineDecision {
  const answered = readings.filter(({ answer }) => answer);
  if (!answered.length) return "none";
  if (scopeEntry) return "entered";
  const own = (reading: ItemReadingInput) => Boolean(reading.entry);
  if (answered.every((reading) => reading.decision?.kind === "set_aside" && !own(reading))) return "set_aside";
  if (answered.some((reading) => !reading.decision && !own(reading))) return "pending";
  return answered.some(own) ? "entered" : "accepted";
}

function rowOf(item: ItemTablePoste, readings: ItemReadingInput[], entry: ItemEntryView | null): ItemTableRow {
  const aggregate = aggregateItemReadings(readings.map((reading) => reading.reading === "in_flight" ? { reading: "in_flight" as const }
    : reading.reading === "ended" || !reading.answer ? { reading: "ended" as const }
      : { reading: "answered" as const, outcome: reading.answer.outcome, quantity: reading.answer.quantity?.quantity ?? null,
        unit: reading.answer.quantity?.unit ?? null }));
  return { item, state: aggregate.state, coverage: aggregate.coverage, decision: lineDecision(readings, entry), readings, entry };
}

export function fixtureItemTable(input: {
  items: ItemTablePoste[];
  readings?: ItemReadingInput[];
  entries?: ItemEntryView[];
  plans?: ItemTablePlan[];
  scope?: ItemTableScope;
  filter?: ItemTableFilter;
  offset?: number;
  limit?: number;
  focusItemId?: string | null;
  canReview?: boolean;
  listed?: boolean;
}): ItemTableResponse {
  const plans = input.plans ?? FIXTURE_PLANS;
  const scope = input.scope ?? { kind: "affaire" };
  const filter = input.filter ?? {};
  const rows = [...input.items].sort((left, right) => left.position - right.position).flatMap((item) => {
    const readings = (input.readings ?? []).filter((reading) => reading.itemId === item.id
      && (scope.kind === "affaire" || reading.planKey === scope.planKey));
    if (scope.kind === "plan" && !readings.length) return [];
    const entry = (input.entries ?? []).find((value) => value.itemId === item.id
      && (scope.kind === "affaire" ? value.scope === "affaire" : value.planKey === scope.planKey)) ?? null;
    return [rowOf(item, readings, entry)];
  });
  const facets: ItemTableFacets = {
    states: { to_measure: 0, reading: 0, incomplete: 0, failed: 0, measured: 0, uncertain: 0, not_found: 0 },
    decisions: { pending: 0, accepted: 0, set_aside: 0, entered: 0, none: 0 },
    families: [], locations: [], plans: plans.map(({ key, name }) => ({ key, name, count: rows.filter((row) =>
      row.readings.some((reading) => reading.planKey === key)).length })),
  };
  for (const row of rows) {
    facets.states[row.state] += 1;
    facets.decisions[row.decision] += 1;
  }
  const families = new Map<string, number>();
  for (const row of rows) if (row.item.sectionPath.length) {
    const family = row.item.sectionPath.join(" / ");
    families.set(family, (families.get(family) ?? 0) + 1);
  }
  facets.families = [...families].map(([value, count]) => ({ value, count }));
  const filtered = rows.filter((row) => (!filter.states?.length || filter.states.includes(row.state))
    && (!filter.decisions?.length || filter.decisions.includes(row.decision))
    && (!filter.families?.length || filter.families.includes(row.item.sectionPath.join(" / "))))
    .sort((left, right) => Number(right.decision === "pending") - Number(left.decision === "pending")
      || left.item.position - right.item.position);
  const limit = input.limit ?? 50;
  const focus = input.focusItemId ? filtered.findIndex((row) => row.item.id === input.focusItemId) : -1;
  const offset = focus >= 0 ? Math.floor(focus / limit) * limit : input.offset ?? 0;
  const lines = buildItemLines(filtered.slice(offset, offset + limit), { plans, scope });
  return {
    projectId: FIXTURE_ITEM_PROJECT,
    canReview: input.canReview ?? true,
    list: input.listed === false ? null
      : { revisionId: "44444444-4444-4444-8444-444444444444", revision: 3, itemCount: input.items.length },
    scope,
    filter,
    plans,
    facets,
    page: { lines, total: filtered.length, offset, limit, focusFound: focus >= 0 },
    names: { [FIXTURE_MEMBER]: "Léa Martin" },
    observedAt: "2026-11-22T09:00:00.000Z",
  };
}

export function fixtureRemeasurePreview(extra: Partial<ItemRemeasurePreview> = {}): ItemRemeasurePreview {
  return {
    items: [{ itemId: fixtureItemId(3), label: "Baignoire" }],
    plans: [{ key: "plan-rdc", name: "Plan RDC" }, { key: "plan-r1", name: "Plan R+1" }],
    payer: { memberId: FIXTURE_MEMBER, name: "Léa Martin" },
    subscription: { state: "ready", model: "modele-a", reasoningEffort: "medium" },
    running: false,
    previewDigest: "a".repeat(64),
    skipped: [],
    ...extra,
  };
}
