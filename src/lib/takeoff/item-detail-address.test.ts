import { describe, expect, it } from "vitest";

import {
  itemDetailHref,
  itemTablePageOffset,
  itemTableReturnHref,
  readItemDetailAddress,
  resolveHistoricalReviewLink,
  type ItemDetailAddress,
} from "@/lib/takeoff/item-detail-address";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";

// The address of the detail of an item (lot 5) lives on the affaire's takeoff page beside the table's own parameters
// (`poste…`, lot 4) and the activity's (`job`, `planSet`, `offset`…). Ways it could open the wrong view, written with
// the scheme:
// - a parameter of the table or of the activity read as the detail's (`postePlan`, `offset`, `job`), or a detail opened
//   from a notification's activity link;
// - an identifier that is not one, a value given twice or a combination with two meanings guessed into a view instead
//   of « not found »;
// - the way back losing the table's filter or page size, or focusing the item first opened instead of the one shown;
// - an old review link (targeted line, versioned bookmark, carried-over review, notification, radar) no longer opening
//   what it opened, or a line turned into an invented item.

const PROJECT = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";
const CARRIED = "34343434-3434-4434-8434-343434343434";
const ITEM = "44444444-4444-4444-8444-444444444444";
const OTHER_ITEM = "45454545-4545-4545-8545-454545454545";
const PIECE = "55555555-5555-4555-8555-555555555555";
const ANSWER = "66666666-6666-4666-8666-666666666666";
const LINE = "77777777-7777-4777-8777-777777777777";
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
      .toBe(`${TAKEOFF}?postePlan=${PIECE}&posteState=measured&posteLimit=25&posteOffset=50&posteFocus=${OTHER_ITEM}&tab=jobs`);
    expect(itemTableReturnHref(PROJECT, open, { itemId: OTHER_ITEM, offset: itemTablePageOffset(3, 25) }))
      .toBe(`${TAKEOFF}?postePlan=${PIECE}&posteState=measured&posteLimit=25&posteFocus=${OTHER_ITEM}&tab=jobs`);
    expect(itemTableReturnHref(PROJECT, `poste=${ITEM}&plan=p`, null)).toBe(TAKEOFF);
  });
});

describe("resolveHistoricalReviewLink", () => {
  // Each old link as the screens of main write it, and where it leads while no stored answer names an item for it.
  const links = {
    "targeted line": { projectId: PROJECT, jobId: JOB, versionId: VERSION, targeted: true, line: LINE },
    "versioned bookmark": { projectId: PROJECT, jobId: JOB, versionId: VERSION },
    "carried-over review": { projectId: PROJECT, jobId: JOB, versionId: CARRIED },
    "notification of an affaire's takeoff": { projectId: PROJECT, jobId: JOB, versionId: null },
    "risk radar": { projectId: PROJECT, jobId: JOB, versionId: VERSION, reviewMode: "validation" as const, view: "dpgf" as const,
      dpgfView: "exceptions_only" as const },
    "exceptions signal on an estimate line": { projectId: PROJECT, jobId: JOB, versionId: VERSION, line: LINE },
  };
  const written = {
    "targeted line": `/dashboard/affaires/${PROJECT}/takeoff/${JOB}/review/targeted?versionId=${VERSION}&line=${LINE}`,
    "versioned bookmark": `/dashboard/affaires/${PROJECT}/takeoff/${JOB}/review?versionId=${VERSION}`,
    "carried-over review": `/dashboard/affaires/${PROJECT}/takeoff/${JOB}/review?versionId=${CARRIED}`,
    "notification of an affaire's takeoff": `/dashboard/affaires/${PROJECT}/takeoff/${JOB}/review`,
    // Written out, as the radar's banner and the approvals queue have it on main (not built with the builder under test).
    "risk radar": `/dashboard/affaires/${PROJECT}/takeoff/${JOB}/review?versionId=${VERSION}&reviewMode=validation&view=dpgf&dpgfView=exceptions_only`,
    "exceptions signal on an estimate line": `/dashboard/affaires/${PROJECT}/takeoff/${JOB}/review?versionId=${VERSION}&line=${LINE}`,
  };

  it("keeps opening each old link as it opened, as the same address, while no item is known for it", () => {
    for (const [kind, link] of Object.entries(links)) {
      expect(resolveHistoricalReviewLink(link, []), kind).toEqual({ kind: "historical", href: written[kind as keyof typeof written] });
      expect(takeoffReviewHref(link), kind).toBe(written[kind as keyof typeof written]);
    }
  });

  it("opens the detail of the one item a line is evidence for, on that reading and with the link's version", () => {
    expect(resolveHistoricalReviewLink(links["targeted line"], [{ itemId: ITEM, planKey: PIECE, answerId: ANSWER }])).toEqual({
      kind: "detail", href: `${TAKEOFF}?poste=${ITEM}&plan=${PIECE}&lecture=${JOB}&reponse=${ANSWER}&versionId=${VERSION}` });
  });

  it("offers a choice when a line is evidence for several items, the historical reader among the choices", () => {
    const resolved = resolveHistoricalReviewLink(links["exceptions signal on an estimate line"], [
      { itemId: ITEM, planKey: PIECE, answerId: null }, { itemId: OTHER_ITEM, planKey: PIECE, answerId: null },
      { itemId: ITEM, planKey: PIECE, answerId: null },
    ]);
    expect(resolved).toEqual({ kind: "choice", historicalHref: written["exceptions signal on an estimate line"], options: [
      { itemId: ITEM, href: `${TAKEOFF}?poste=${ITEM}&plan=${PIECE}&lecture=${JOB}&versionId=${VERSION}` },
      { itemId: OTHER_ITEM, href: `${TAKEOFF}?poste=${OTHER_ITEM}&plan=${PIECE}&lecture=${JOB}&versionId=${VERSION}` },
    ] });
  });

  it("leaves a link without a line in the historical reader, whatever is known of its job", () => {
    expect(resolveHistoricalReviewLink(links["versioned bookmark"], [{ itemId: ITEM, planKey: PIECE, answerId: ANSWER }]))
      .toEqual({ kind: "historical", href: written["versioned bookmark"] });
  });
});
