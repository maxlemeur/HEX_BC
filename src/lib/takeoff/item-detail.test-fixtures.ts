import type { ItemDetailQueueRequest, ItemDetailReader } from "@/lib/takeoff/item-detail-client";
import type { ItemDetailPlanRequest, ItemDetailPlanView } from "@/lib/takeoff/item-detail-contracts";
import type { ItemDetailAnswer, ItemDetailGesture, ItemDetailLine, ItemDetailQueuePage, ItemDetailReading } from "@/lib/takeoff/item-detail";

/**
 * Fictional lines of the table of items, shaped field for field by lot 4's read contract (one line per item with its
 * readings per plan), and a reader over them: the pages of the table in its order, an item outside the filter, and the
 * plan resolutions by plan and reading. Values are invented; no document of a customer.
 */

export const DETAIL_PROJECT = "11111111-1111-4111-8111-111111111111";
export const PLAN_RDC = "21111111-1111-4111-8111-111111111111";
export const PLAN_R1 = "22222222-2222-4222-8222-222222222222";
export const PLAN_SCAN = "23333333-3333-4333-8333-333333333333";
export const JOB_RDC = "31111111-1111-4111-8111-111111111111";
export const JOB_R1 = "32222222-2222-4222-8222-222222222222";
export const JOB_EARLIER = "33333333-3333-4333-8333-333333333333";
export const JOB_SCAN = "34444444-4444-4444-8444-444444444444";
export const SET = "41111111-1111-4111-8111-111111111111";
export const COPY_RDC = "51111111-1111-4111-8111-111111111111";
export const COPY_R1 = "52222222-2222-4222-8222-222222222222";
export const COPY_SCAN = "53333333-3333-4333-8333-333333333333";
export const MEMBER = "61111111-1111-4111-8111-111111111111";

const item = (index: number) => `7${String(index).padStart(7, "0")}-1111-4111-8111-111111111111`;
export const ITEMS = {
  basin: item(1), notFound: item(2), toMeasure: item(3), homonym: item(4), scan: item(5), outside: item(9),
  extra: (index: number) => item(10 + index),
};

const all = (eligible: boolean, reason: string | null = null) => ({ eligible, reason });
const gestures = (overrides: Partial<Record<ItemDetailGesture, { eligible: boolean; reason: string | null }>> = {}) => ({
  accept_measured: all(false, "not_measured"), set_aside: all(false, "no_answer"), reinstate: all(false, "not_set_aside"),
  enter_quantity: all(false, "not_entry_state"), include_entry: all(false, "no_entry_to_include"), remeasure: all(true),
  ...overrides,
});

function answer(jobId: string, overrides: Partial<ItemDetailAnswer>): ItemDetailAnswer {
  return {
    answerId: `8${jobId.slice(1)}`, revision: "1", jobId, outcome: "measured", reasonCode: null, reasonText: null,
    searchedPages: [], unreadablePages: [], observations: [], candidate: null, anomalies: [], readAt: "2026-11-21T09:30:00.000Z",
    ...overrides,
  };
}

function reading(planKey: string, planName: string, value: ItemDetailAnswer | null, extra: Partial<ItemDetailReading> = {}): ItemDetailReading {
  return { planKey, planName, location: "RDC", unit: "succeeded", answer: value, decision: null, entry: null, ...extra };
}

function line(itemId: string, position: number, overrides: Partial<ItemDetailLine>): ItemDetailLine {
  return {
    itemId, position, label: `Poste ${position}`, expectedUnit: "u", sectionPath: ["Plomberie"], family: "Plomberie",
    state: "measured", coverage: { expected: 1, answered: 1, inFlight: 0, ended: 1 }, observed: null, retained: null, entry: null,
    reasons: [], planCount: 1, decision: "pending", readings: [], remeasurePlans: [PLAN_RDC], eligibility: gestures(), ...overrides,
  };
}

/** A measured item without anomaly, read on two plans: 3 basins on the ground floor (pages 2 and 7), 2 upstairs. */
export const basinLine = line(ITEMS.basin, 0, {
  label: "Lavabo céramique", state: "measured", coverage: { expected: 2, answered: 2, inFlight: 0, ended: 2 },
  observed: { quantity: 5, unit: "u", partial: false }, planCount: 2,
  readings: [
    reading(PLAN_RDC, "Plan RDC", answer(JOB_RDC, { searchedPages: [2, 7], observations: [
      { observationId: "o-rdc-2", quantity: 2, unit: "u", page: 2, evidence: "Symbole lavabo, sanitaires hommes", confidence: 0.92, method: "plan" },
      { observationId: "o-rdc-7", quantity: 1, unit: "u", page: 7, evidence: "Symbole lavabo, local ménage", confidence: 0.88, method: "plan" },
    ] }), { decision: { kind: "accepted", revision: 1, actorId: MEMBER, at: "2026-11-21T10:00:00.000Z" } }),
    reading(PLAN_R1, "Plan R+1", answer(JOB_R1, { searchedPages: [1], observations: [
      { observationId: "o-r1-1", quantity: 2, unit: "u", page: 1, evidence: "Deux lavabos, sanitaires étage", confidence: 0.9, method: "plan" },
    ] }), { location: "R+1" }),
  ],
  remeasurePlans: [PLAN_RDC, PLAN_R1],
  eligibility: gestures({ accept_measured: all(true), set_aside: all(true) }),
});

/** An answer without a quantity: the pages searched, no point. */
export const notFoundLine = line(ITEMS.notFound, 1, {
  label: "Siphon de sol", state: "not_found", decision: "pending",
  readings: [reading(PLAN_RDC, "Plan RDC", answer(JOB_RDC, { outcome: "not_found", searchedPages: [1, 3, 4],
    reasonText: "Aucun siphon de sol dessiné sur les pages lues." }))],
  eligibility: gestures({ set_aside: all(true), enter_quantity: all(true) }),
});

/** An item never measured: no reading yet, the plan a new measure would read. */
export const toMeasureLine = line(ITEMS.toMeasure, 2, {
  label: "Robinet de puisage", state: "to_measure", coverage: { expected: 0, answered: 0, inFlight: 0, ended: 0 },
  decision: "none", readings: [], remeasurePlans: [PLAN_R1], planCount: 0,
});

/** A homonym of the basin in another section: two lines, never one. */
export const homonymLine = line(ITEMS.homonym, 3, {
  label: "Lavabo céramique", sectionPath: ["Plomberie", "Logement gardien"], family: "Plomberie / Logement gardien",
  readings: [reading(PLAN_R1, "Plan R+1", answer(JOB_R1, { searchedPages: [3], observations: [
    { observationId: "o-r1-3", quantity: 1, unit: "u", page: 3, evidence: "Lavabo du logement", confidence: 0.81, method: "plan" },
  ] }), { location: "R+1" })],
  observed: { quantity: 1, unit: "u", partial: false },
});

/** A scanned plan, read without any vector page. */
export const scanLine = line(ITEMS.scan, 4, {
  label: "WC suspendu", state: "uncertain", readings: [reading(PLAN_SCAN, "Plan scanné R+2", answer(JOB_SCAN, {
    outcome: "uncertain", searchedPages: [2], candidate: { quantity: 4, unit: "u" }, reasonText: "Symboles peu lisibles sur le scan.",
    observations: [] }), { location: "R+2" })],
  remeasurePlans: [PLAN_SCAN],
  eligibility: gestures({ set_aside: all(true), enter_quantity: all(true) }),
});

export const outsideLine = line(ITEMS.outside, 40, { label: "Clapet coupe-feu", state: "measured",
  readings: [reading(PLAN_RDC, "Plan RDC", answer(JOB_RDC, { searchedPages: [5], observations: [
    { observationId: "o-rdc-5", quantity: 1, unit: "u", page: 5, evidence: "Clapet en gaine", confidence: 0.7, method: "plan" },
  ] }))] });

export const detailPlans = [{ key: PLAN_RDC, name: "Plan RDC" }, { key: PLAN_R1, name: "Plan R+1" }, { key: PLAN_SCAN, name: "Plan scanné R+2" }];

export function planViews(): Record<string, ItemDetailPlanView> {
  const attested = (planKey: string, jobId: string, copy: string, name: string, pagesRead: number[]): ItemDetailPlanView => ({
    plan: { key: planKey, name, planFileId: copy, generation: "1", contentSha256: "c".repeat(64), pageCount: 9, pagesRead },
    reading: { jobId, status: "completed", finishedAt: "2026-11-21T09:30:00.000Z" },
    document: { kind: "attested", href: `/api/takeoff/jobs/${jobId}/vector-plans/${copy}` },
  });
  return {
    [`${JOB_RDC}:${PLAN_RDC}`]: attested(PLAN_RDC, JOB_RDC, COPY_RDC, "Plan RDC", []),
    [`${JOB_R1}:${PLAN_R1}`]: attested(PLAN_R1, JOB_R1, COPY_R1, "Plan R+1", []),
    [`${JOB_SCAN}:${PLAN_SCAN}`]: attested(PLAN_SCAN, JOB_SCAN, COPY_SCAN, "Plan scanné R+2", [2]),
    [`${JOB_EARLIER}:${PLAN_RDC}`]: attested(PLAN_RDC, JOB_EARLIER, COPY_RDC, "Plan RDC", []),
    [`:${PLAN_R1}`]: { plan: { key: PLAN_R1, name: "Plan R+1", planFileId: COPY_R1, generation: "2", contentSha256: null, pageCount: 4,
      pagesRead: [] }, reading: null, document: { kind: "dossier", planSetId: SET, planFileId: COPY_R1,
      url: `https://files.test/dossier/${COPY_R1}.pdf` } },
    [`:${PLAN_RDC}`]: { plan: { key: PLAN_RDC, name: "Plan RDC", planFileId: COPY_RDC, generation: "1", contentSha256: null, pageCount: 9,
      pagesRead: [] }, reading: null, document: { kind: "dossier", planSetId: SET, planFileId: COPY_RDC,
      url: `https://files.test/dossier/${COPY_RDC}.pdf` } },
  };
}

export type FixtureReaderCalls = { queue: ItemDetailQueueRequest[]; lines: string[]; plans: ItemDetailPlanRequest[] };

/**
 * A reader over fictional lines: pages of `limit` lines in their order, `outside` read alone, plans from `views` (read at
 * each resolution, so that a test can change what the server would answer), a page of the queue held until released.
 */
export function fixtureItemDetailReader(input: {
  lines: ItemDetailLine[];
  limit?: number;
  outside?: ItemDetailLine[];
  canReview?: boolean;
  views?: Record<string, ItemDetailPlanView>;
  holdPages?: Promise<void>;
}): { reader: ItemDetailReader; calls: FixtureReaderCalls } {
  const limit = input.limit ?? 50;
  const views = input.views ?? planViews();
  const calls: FixtureReaderCalls = { queue: [], lines: [], plans: [] };
  const page = (offset: number): ItemDetailQueuePage => ({ lines: input.lines.slice(offset, offset + limit), total: input.lines.length,
    offset, limit, canReview: input.canReview ?? true, names: { [MEMBER]: "Camille Martin" }, plans: detailPlans });
  const reader: ItemDetailReader = {
    async readQueue(request) {
      calls.queue.push(request);
      if (request.kind === "page") {
        await input.holdPages;
        return { ...page(request.offset), focusFound: false };
      }
      const index = input.lines.findIndex(({ itemId }) => itemId === request.itemId);
      return { ...page(index < 0 ? 0 : Math.floor(index / limit) * limit), focusFound: index >= 0 };
    },
    async readLine(itemId) {
      calls.lines.push(itemId);
      const found = [...input.lines, ...(input.outside ?? [])].find((entry) => entry.itemId === itemId);
      return found ? { line: found, names: { [MEMBER]: "Camille Martin" }, canReview: input.canReview ?? true } : null;
    },
    async resolvePlan(request) {
      calls.plans.push(request);
      const view = views[`${request.jobId ?? ""}:${request.planKey ?? request.source?.documentId ?? ""}`];
      if (!view) {
        const { ItemDetailPlanError } = await import("@/lib/takeoff/item-detail-client");
        throw new ItemDetailPlanError("TAKEOFF_ITEM_DETAIL_PLAN_NOT_FOUND", 404);
      }
      return view;
    },
  };
  return { reader, calls };
}
