import type { ItemDetailQueueRequest, ItemDetailReader } from "@/lib/takeoff/item-detail-client";
import type { ItemDetailPlanRequest, ItemDetailPlanView } from "@/lib/takeoff/item-detail-contracts";
import type { ItemDetailLine } from "@/lib/takeoff/item-detail";
import type { ItemAnswerDecision, ItemAnswerView, ItemEntryView, ItemReadingInput, ItemTablePlan, ItemTablePoste } from "@/lib/takeoff/item-table";
import { FIXTURE_MEMBER, fixtureAnswer, fixtureItemTable, fixturePoste } from "@/lib/takeoff/item-table.test-fixtures";

/**
 * Fictional lines of the table of items for the detail, built as the table builds them: items, plans and answers through
 * the table's own fixtures, each line through its model (state, decision, eligibility), so that a line here is a line of
 * its read contract. A reader over them pages, focuses and reads an item alone as the table's routes do. Fictional values.
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
export const MEMBER = FIXTURE_MEMBER;
export const MEMBER_NAME = "Léa Martin";

const item = (index: number) => `7${String(index).padStart(7, "0")}-1111-4111-8111-111111111111`;
export const ITEMS = {
  basin: item(1), notFound: item(2), toMeasure: item(3), homonym: item(4), scan: item(5), outside: item(9),
  extra: (index: number) => item(10 + index),
};

export const DETAIL_PLANS: ItemTablePlan[] = [
  { key: PLAN_RDC, name: "Plan RDC", location: { key: "A|RDC", label: "A · RDC" } },
  { key: PLAN_R1, name: "Plan R+1", location: { key: "A|R+1", label: "A · R+1" } },
  { key: PLAN_SCAN, name: "Plan scanné R+2", location: null },
];

const poste = (id: string, position: number, label: string, extra: Partial<ItemTablePoste> = {}) =>
  ({ ...fixturePoste(position, label, extra), id });

function reading(itemId: string, planKey: string, answer: ItemAnswerView | null, extra: Partial<ItemReadingInput> = {}): ItemReadingInput {
  const plan = DETAIL_PLANS.find(({ key }) => key === planKey)!;
  return { itemId, planKey, planName: plan.name, location: plan.location?.label ?? null, unit: answer ? "succeeded" : "queued",
    reading: answer ? "answered" : "in_flight", answer, decision: null, decisionRevision: 0, entry: null, sent: false, ...extra };
}

/** A contribution and its row; an accepted answer's rows are verified (the table counts it undecided otherwise). */
const observation = (id: string, quantity: number, page: number, evidence: string, confidence: number, verified = false) => ({
  observationId: id, role: "contribution" as const, quantity, unit: "u", page, evidence, confidence, method: "symbol_count",
  takeoffItemId: null, row: { quantity, unit: "u", isVerified: verified, isExcluded: false },
});

const accepted: ItemAnswerDecision = { kind: "accepted", revision: 1, actorId: MEMBER, at: "2026-11-21T10:00:00.000Z" };

export const DETAIL_ITEMS: ItemTablePoste[] = [
  poste(ITEMS.basin, 0, "Lavabo céramique", { sectionPath: ["Plomberie"] }),
  poste(ITEMS.notFound, 1, "Siphon de sol", { sectionPath: ["Plomberie"] }),
  poste(ITEMS.toMeasure, 2, "Robinet de puisage", { sectionPath: ["Plomberie"] }),
  poste(ITEMS.homonym, 3, "Lavabo céramique", { sectionPath: ["Plomberie", "Logement gardien"] }),
  poste(ITEMS.scan, 4, "WC suspendu", { sectionPath: ["Plomberie"] }),
];
export const OUTSIDE_ITEM = poste(ITEMS.outside, 40, "Clapet coupe-feu", { sectionPath: ["Ventilation"] });

/** The readings: a measured item on two plans (pages 2 and 7, then 1), an absence, a homonym, a scan, the outside item. */
export function detailReadings(options: { sent?: boolean } = {}): ItemReadingInput[] {
  return [
    reading(ITEMS.basin, PLAN_RDC, fixtureAnswer("measured", 3, { jobId: JOB_RDC, searchedPages: [2, 7], readAt: "2026-11-21T09:30:00.000Z",
      observations: [observation("o-rdc-2", 2, 2, "Symbole lavabo, sanitaires hommes", 0.92, true),
        observation("o-rdc-7", 1, 7, "Symbole lavabo, local ménage", 0.88, true)] }),
    { decision: accepted, decisionRevision: 1, sent: options.sent === true }),
    reading(ITEMS.basin, PLAN_R1, fixtureAnswer("measured", 2, { jobId: JOB_R1, searchedPages: [1], readAt: "2026-11-21T09:30:00.000Z",
      observations: [observation("o-r1-1", 2, 1, "Deux lavabos, sanitaires étage", 0.9)] })),
    reading(ITEMS.notFound, PLAN_RDC, fixtureAnswer("not_found", null, { jobId: JOB_RDC, searchedPages: [1, 3, 4],
      reasonText: "Aucun siphon de sol dessiné sur les pages lues." })),
    reading(ITEMS.homonym, PLAN_R1, fixtureAnswer("measured", 1, { jobId: JOB_R1, searchedPages: [3],
      observations: [observation("o-r1-3", 1, 3, "Lavabo du logement", 0.81)] })),
    reading(ITEMS.scan, PLAN_SCAN, fixtureAnswer("uncertain", null, { jobId: JOB_SCAN, searchedPages: [2],
      candidate: { quantity: 4, unit: "u" }, reasonText: "Symboles peu lisibles sur le scan." })),
    reading(ITEMS.outside, PLAN_RDC, fixtureAnswer("measured", 1, { jobId: JOB_RDC, searchedPages: [5],
      observations: [observation("o-rdc-5", 1, 5, "Clapet en gaine", 0.7)] })),
  ];
}

/** The readings every test shares (an answer's identity is made once). */
export const DETAIL_READINGS = detailReadings();

/** Every line of the fixtures, as the table builds them (decisions to take first, then the list's order). */
export function detailLines(readings: ItemReadingInput[] = DETAIL_READINGS): ItemDetailLine[] {
  return fixtureItemTable({ items: [...DETAIL_ITEMS, OUTSIDE_ITEM], readings, plans: DETAIL_PLANS, limit: 100 }).page.lines;
}
const lineOf = (itemId: string) => detailLines().find((line) => line.itemId === itemId)!;
export const basinLine = lineOf(ITEMS.basin);
export const notFoundLine = lineOf(ITEMS.notFound);
export const toMeasureLine = lineOf(ITEMS.toMeasure);
export const homonymLine = lineOf(ITEMS.homonym);
export const scanLine = lineOf(ITEMS.scan);
export const outsideLine = lineOf(ITEMS.outside);

export function planViews(): Record<string, ItemDetailPlanView> {
  const attested = (planKey: string, jobId: string, copy: string, name: string, pagesRead: number[]): ItemDetailPlanView => ({
    plan: { key: planKey, name, planFileId: copy, generation: "1", contentSha256: "c".repeat(64), pageCount: 9, pagesRead },
    reading: { jobId, status: "completed", finishedAt: "2026-11-21T09:30:00.000Z" },
    document: { kind: "attested", href: `/api/takeoff/jobs/${jobId}/vector-plans/${copy}` },
  });
  const dossier = (planKey: string, copy: string, name: string, pageCount: number): ItemDetailPlanView => ({
    plan: { key: planKey, name, planFileId: copy, generation: "2", contentSha256: null, pageCount, pagesRead: [] }, reading: null,
    document: { kind: "dossier", planSetId: SET, planFileId: copy, url: `https://files.test/dossier/${copy}.pdf` },
  });
  return {
    [`${JOB_RDC}:${PLAN_RDC}`]: attested(PLAN_RDC, JOB_RDC, COPY_RDC, "Plan RDC", []),
    [`${JOB_R1}:${PLAN_R1}`]: attested(PLAN_R1, JOB_R1, COPY_R1, "Plan R+1", []),
    [`${JOB_SCAN}:${PLAN_SCAN}`]: attested(PLAN_SCAN, JOB_SCAN, COPY_SCAN, "Plan scanné R+2", [2]),
    [`${JOB_EARLIER}:${PLAN_RDC}`]: attested(PLAN_RDC, JOB_EARLIER, COPY_RDC, "Plan RDC", []),
    [`:${PLAN_R1}`]: dossier(PLAN_R1, COPY_R1, "Plan R+1", 4),
    [`:${PLAN_RDC}`]: dossier(PLAN_RDC, COPY_RDC, "Plan RDC", 9),
  };
}

export type FixtureReaderCalls = { queue: ItemDetailQueueRequest[]; lines: string[]; plans: ItemDetailPlanRequest[] };

/**
 * A reader over fictional lines: the table's pages of `limit` lines in its order, the item asked found on its page, an
 * item outside the filter read alone, plans from `views` (read at each resolution, so that a test can change what the
 * server would answer), a page of the queue held until released.
 */
export function fixtureItemDetailReader(input: {
  items?: ItemTablePoste[];
  readings?: ItemReadingInput[];
  entries?: ItemEntryView[];
  limit?: number;
  outside?: ItemTablePoste[];
  canReview?: boolean;
  views?: Record<string, ItemDetailPlanView>;
  holdPages?: Promise<void>;
}): { reader: ItemDetailReader; calls: FixtureReaderCalls } {
  const items = input.items ?? DETAIL_ITEMS;
  const readings = input.readings ?? DETAIL_READINGS;
  const limit = input.limit ?? 50;
  const views = input.views ?? planViews();
  const calls: FixtureReaderCalls = { queue: [], lines: [], plans: [] };
  const table = (request: { offset?: number; focusItemId?: string | null }) => {
    const read = fixtureItemTable({ items, readings, entries: input.entries, plans: DETAIL_PLANS, limit, canReview: input.canReview,
      ...request });
    return { page: read.page, canReview: read.canReview, names: read.names, plans: read.plans };
  };
  const reader: ItemDetailReader = {
    async readQueue(request) {
      calls.queue.push(request);
      if (request.kind === "page") {
        await input.holdPages;
        return table({ offset: request.offset });
      }
      return table({ focusItemId: request.itemId });
    },
    async readLine(itemId) {
      calls.lines.push(itemId);
      const all = fixtureItemTable({ items: [...items, ...(input.outside ?? [])], readings, entries: input.entries, plans: DETAIL_PLANS,
        limit: 1000, canReview: input.canReview });
      const line = all.page.lines.find((entry) => entry.itemId === itemId);
      return line ? { line, canReview: all.canReview, names: all.names, plans: all.plans } : null;
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
