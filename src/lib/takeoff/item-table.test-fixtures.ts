import {
  buildItemTable,
  pageItemTable,
  type ItemAnswerDecision,
  type ItemAnswerView,
  type ItemEntryView,
  type ItemReadingInput,
  type ItemTableFilter,
  type ItemTablePlan,
  type ItemTablePoste,
  type ItemTableScope,
} from "./item-table";
import type { ItemRemeasurePreview, ItemTableResponse } from "./item-table-contracts";

/** Fictional items, plans and answers for the table's tests, built through the table's own model as the server builds them. */

export const FIXTURE_ITEM_PROJECT = "11111111-1111-4111-8111-111111111111";
export const FIXTURE_MEMBER = "22222222-2222-4222-8222-222222222222";

export const fixtureItemId = (index: number) => `00000000-0000-4000-a000-${String(index).padStart(12, "0")}`;
const answerId = (index: number) => `00000000-0000-4000-b000-${String(index).padStart(12, "0")}`;

export const FIXTURE_PLANS: ItemTablePlan[] = [
  { key: "plan-rdc", name: "Plan RDC", location: { key: "bat-a:rdc", label: "Bâtiment A · RDC" } },
  { key: "plan-r1", name: "Plan R+1", location: { key: "bat-a:r1", label: "Bâtiment A · R+1" } },
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
    answerId: id, revision: "1", jobId: "33333333-3333-4333-8333-333333333333", outcome, reasonCode: null, reasonText: null,
    searchedPages: [1, 2], unreadablePages: [], candidate: null, anomalies: [], readAt: "2026-11-22T08:00:00.000Z",
    observations: outcome === "measured" && quantity !== null
      ? [{ observationId: `${id}-1`, quantity, unit: "u", page: 1, evidence: "symboles relevés", confidence: 0.9, method: "pdf" }] : [],
    ...extra,
  };
}

export function fixtureReading(item: number, planKey: string, value: ItemAnswerView | ItemReadingInput["unit"],
  decision: ItemAnswerDecision | null = null): ItemReadingInput {
  return typeof value === "string"
    ? { itemId: fixtureItemId(item), planKey, unit: value, answer: null, decision: null }
    : { itemId: fixtureItemId(item), planKey, unit: "succeeded", answer: value, decision };
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
  const view = buildItemTable({ items: input.items, plans, readings: input.readings ?? [], entries: input.entries ?? [], scope,
    filter: input.filter });
  return {
    projectId: FIXTURE_ITEM_PROJECT,
    canReview: input.canReview ?? true,
    list: input.listed === false ? null
      : { revisionId: "44444444-4444-4444-8444-444444444444", revision: 3, itemCount: input.items.length },
    scope,
    filter: input.filter ?? {},
    plans,
    facets: view.facets,
    page: pageItemTable(view.lines, { offset: input.offset ?? 0, limit: input.limit ?? 50, focusItemId: input.focusItemId ?? null }),
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
