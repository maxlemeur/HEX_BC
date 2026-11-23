import { describe, expect, it } from "vitest";

import {
  itemDetailHref,
  itemTableLineDetailHref,
  itemTablePageOffset,
  itemTableReturnHref,
  readItemDetailAddress,
  readItemDetailPlanRequest,
  type ItemDetailAddress,
} from "@/lib/takeoff/item-detail-address";
import {
  DETAIL_PROJECT, ITEMS, JOB_R1, JOB_RDC, PLAN_R1, PLAN_RDC, PLAN_SCAN, basinLine, toMeasureLine,
} from "@/lib/takeoff/item-detail.test-fixtures";

// The address of the detail of an item (lot 5) lives on the affaire's takeoff page beside the table's own parameters
// (`poste…`, lot 4) and the activity's (`job`, `planSet`, `offset`…). Ways it could open the wrong view, written with
// the scheme:
// - a parameter of the table or of the activity read as the detail's (`postePlan`, `offset`, `job`), or a detail opened
//   from a notification's activity link;
// - an identifier that is not one, a value given twice or a combination with two meanings guessed into a view instead
//   of « not found »;
// - the way back losing the table's filter or page size, or focusing the item first opened instead of the one shown.
// Old review links (a targeted line, a bookmark, a carried-over review, a notification, the radar) are resolved by
// review-link.ts (review-link.test.ts).

const PROJECT = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";
const ITEM = "44444444-4444-4444-8444-444444444444";
const OTHER_ITEM = "45454545-4545-4545-8545-454545454545";
const PIECE = "55555555-5555-4555-8555-555555555555";
const ANSWER = "66666666-6666-4666-8666-666666666666";
const TAKEOFF = `/dashboard/affaires/${PROJECT}/takeoff`;

const read = (query: string) => readItemDetailAddress(new URLSearchParams(query));
const detail = (overrides: Partial<ItemDetailAddress> = {}): ItemDetailAddress => ({
  itemId: ITEM, planKey: null, jobId: null, page: null, source: null, answerId: null, observationId: null, versionId: null, ...overrides,
});

describe("readItemDetailAddress", () => {
  it("reads the item, its plan, its reading and the page", () => {
    expect(read(`poste=${ITEM.toUpperCase()}&plan=${PIECE}&lecture=${JOB}&page=7`)).toEqual({ kind: "detail",
      address: detail({ planKey: PIECE, jobId: JOB, page: 7 }) });
  });

  it("round trips a measure receipt independently of the displayed reading and removes it on return to the table", () => {
    const href = itemDetailHref(PROJECT, detail({ planKey: PIECE, jobId: JOB, receipt: { requestId: VERSION, jobId: ANSWER } }));
    const search = new URL(href, "https://app.test").search;
    expect(read(search)).toEqual({ kind: "detail",
      address: detail({ planKey: PIECE, jobId: JOB, receipt: { requestId: VERSION, jobId: ANSWER } }) });
    expect(itemTableReturnHref(PROJECT, search, null)).toBe(TAKEOFF);
    for (const pair of [`demandeMesure=${VERSION}`, `analyseMesure=${ANSWER}`, `demandeMesure=${VERSION}&analyseMesure=bad`]) {
      expect(read(`poste=${ITEM}&plan=${PIECE}&${pair}`)).toEqual({ kind: "invalid" });
    }
  });

  it("reads a dossier piece and its generation for a plan no analysis sealed, apart from the plan", () => {
    expect(read(`poste=${ITEM}&source=${PIECE}&generation=g-2&page=2`)).toEqual({ kind: "detail",
      address: detail({ source: { documentId: PIECE, generation: "g-2" }, page: 2 }) });
  });

  it("reads the answer, the observation and the version of a link, optional", () => {
    expect(read(`poste=${ITEM}&plan=p&lecture=${JOB}&reponse=${ANSWER}&observation=o-1&versionId=${VERSION}`)).toEqual({ kind: "detail",
      address: detail({ planKey: "p", jobId: JOB, answerId: ANSWER, observationId: "o-1", versionId: VERSION }) });
  });

  it("asks for no detail without an item: the table's, the activity's and a notification's parameters are not the detail's", () => {
    for (const query of [
      "", `postePlan=${PIECE}&posteFocus=${ITEM}&posteOffset=50`, `job=${JOB}`, `planSet=${PIECE}&offset=20&tab=jobs`,
      `plan=${PIECE}&lecture=${JOB}&page=3`, "postes=liste&postesPage=2",
    ]) {
      expect(read(query)).toEqual({ kind: "none" });
    }
  });

  it("is invalid, never guessed, for what cannot be an identifier, a repeated value or two meanings at once", () => {
    for (const query of [
      "poste=12", `poste=${ITEM}&poste=${OTHER_ITEM}`, `poste=${ITEM}&lecture=job-1`, `poste=${ITEM}&plan=p&page=0`,
      `poste=${ITEM}&plan=p&page=2.5`, `poste=${ITEM}&plan=p&page=07`, `poste=${ITEM}&plan=${"x".repeat(201)}`,
      `poste=${ITEM}&generation=g-2`, `poste=${ITEM}&source=${PIECE}&lecture=${JOB}`, `poste=${ITEM}&source=${PIECE}&plan=p`,
      `poste=${ITEM}&observation=o-1`, `poste=${ITEM}&page=3`, `poste=${ITEM}&source=piece`, `poste=${ITEM}&reponse=a`,
      `poste=${ITEM}&versionId=v`, `poste=${ITEM}&lecture=${JOB}`, `poste=${ITEM}&lecture=${JOB}&page=2`,
    ]) {
      expect(read(query), query).toEqual({ kind: "invalid" });
    }
  });
});

describe("itemDetailHref and itemTableReturnHref", () => {
  const table = `postePlan=${PIECE}&posteState=measured&posteLimit=25&posteOffset=25&posteFocus=${ITEM}&tab=jobs`;

  it("opens the detail beside the table's parameters, in one order, and reads back as written", () => {
    const address = detail({ planKey: PIECE, jobId: JOB, page: 7, answerId: ANSWER });
    const href = itemDetailHref(PROJECT, address, table);
    expect(href).toBe(`${TAKEOFF}?${table}&poste=${ITEM}&plan=${PIECE}&lecture=${JOB}&page=7&reponse=${ANSWER}`);
    expect(read(new URL(href, "https://app.test").search)).toEqual({ kind: "detail", address });
  });

  it("moves to another item by replacing the detail's parameters, not adding to them", () => {
    const first = itemDetailHref(PROJECT, detail({ planKey: PIECE, jobId: JOB, page: 7 }), table);
    const next = itemDetailHref(PROJECT, detail({ itemId: OTHER_ITEM, source: { documentId: PIECE, generation: null } }),
      new URL(first, "https://app.test").search);
    expect(next).toBe(`${TAKEOFF}?${table}&poste=${OTHER_ITEM}&source=${PIECE}`);
  });

  it("comes back to the table with its filter and page size, the item shown in focus on the page that holds it", () => {
    const open = new URL(itemDetailHref(PROJECT, detail({ planKey: PIECE, jobId: JOB, page: 7 }), table), "https://app.test").search;
    expect(itemTableReturnHref(PROJECT, open, { itemId: OTHER_ITEM, offset: itemTablePageOffset(57, 25) }))
      .toBe(`${TAKEOFF}?postePlan=${PIECE}&posteState=measured&posteLimit=25&tab=jobs&posteOffset=50&posteFocus=${OTHER_ITEM}`);
    expect(itemTableReturnHref(PROJECT, open, { itemId: OTHER_ITEM, offset: itemTablePageOffset(3, 25) }))
      .toBe(`${TAKEOFF}?postePlan=${PIECE}&posteState=measured&posteLimit=25&tab=jobs&posteFocus=${OTHER_ITEM}`);
    expect(itemTableReturnHref(PROJECT, `poste=${ITEM}&plan=p`, null)).toBe(TAKEOFF);
  });
});

// Review of #483 (written before the fix): the plan route resolved a reading without the item, so a job that read only
// another item on the plan was shown as this item's earlier reading. A reading is asked for an item.
describe("readItemDetailPlanRequest", () => {
  it("reads the item a reading is asked for, and refuses a reading asked for no item", () => {
    expect(readItemDetailPlanRequest(new URLSearchParams(`poste=${ITEM}&plan=${PIECE}&lecture=${JOB}`)))
      .toEqual({ itemId: ITEM, planKey: PIECE, jobId: JOB, source: null });
    expect(readItemDetailPlanRequest(new URLSearchParams(`plan=${PIECE}&lecture=${JOB}`))).toBeNull();
    expect(readItemDetailPlanRequest(new URLSearchParams(`plan=${PIECE}`))).toEqual({ itemId: null, planKey: PIECE, jobId: null, source: null });
    expect(readItemDetailPlanRequest(new URLSearchParams(`poste=${ITEM}&source=${PIECE}`)))
      .toEqual({ itemId: ITEM, planKey: null, jobId: null, source: { documentId: PIECE, generation: null } });
  });
});

describe("itemTableLineDetailHref", () => {
  const takeoff = `/dashboard/affaires/${DETAIL_PROJECT}/takeoff`;

  it("opens a line on the plan the table is filtered on, else on its first plan that answered, else on the dossier's", () => {
    expect(itemTableLineDetailHref(DETAIL_PROJECT, basinLine, "posteState=measured&tab=jobs"))
      .toBe(`${takeoff}?posteState=measured&tab=jobs&poste=${ITEMS.basin}&plan=${PLAN_RDC}&lecture=${JOB_RDC}`);
    expect(itemTableLineDetailHref(DETAIL_PROJECT, basinLine, `postePlan=${PLAN_R1}`))
      .toBe(`${takeoff}?postePlan=${PLAN_R1}&poste=${ITEMS.basin}&plan=${PLAN_R1}&lecture=${JOB_R1}`);
    // Never measured: the plan filtered on when the item is to be measured there, else the detail opens the dossier's.
    expect(itemTableLineDetailHref(DETAIL_PROJECT, toMeasureLine, `postePlan=${PLAN_SCAN}`))
      .toBe(`${takeoff}?postePlan=${PLAN_SCAN}&poste=${ITEMS.toMeasure}&plan=${PLAN_SCAN}`);
    expect(itemTableLineDetailHref(DETAIL_PROJECT, toMeasureLine, "")).toBe(`${takeoff}?poste=${ITEMS.toMeasure}`);
    // Every address it writes opens a detail.
    for (const href of [itemTableLineDetailHref(DETAIL_PROJECT, basinLine, `postePlan=${PLAN_R1}`),
      itemTableLineDetailHref(DETAIL_PROJECT, toMeasureLine, "")]) {
      expect(read(new URL(href, "https://app.test").search).kind).toBe("detail");
    }
  });
});
