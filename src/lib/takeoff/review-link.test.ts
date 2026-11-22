import { describe, expect, it } from "vitest";

import {
  readTakeoffLinkNotice,
  readTakeoffReviewLink,
  resolveTakeoffReviewLink,
  takeoffExceptionsLinkHref,
  takeoffRequestNoticeHref,
  withoutTakeoffLinkNotice,
  type TakeoffLinkJobFacts,
} from "@/lib/takeoff/review-link";
import { takeoffReviewHref, type TakeoffReviewHrefInput } from "@/lib/takeoff/review-href";

// Every way into a takeoff a member can hold today (lot 4, PR 6a), written as the screens of main write it, and where it
// must land: a job of the first format opens what it opened, as the same string; a job read against the affaire's list
// opens the table of items filtered on what the link names (its plan, its items to check, the item of its line) or the
// item's detail, with an explanation when the link named nothing more than the job. Ways it could land wrong:
// - a first-format link changed in any character (its mode, view, line, version or carry-over dropped or reordered);
// - a list job's link carrying the old review's parameters, its version or a line into the table (a selection or a
//   decision travelling in a query string), or leaving the link's affaire;
// - a line made into an item the server did not prove, or a detail opened on a reading that did not answer the item;
// - the targeted review of a list job taken away while the table's line detail still sends there for the correction.
// Fictional ids.

const PROJECT = "11111111-1111-4111-8111-111111111111";
const JOB = "22222222-2222-4222-8222-222222222222";
const VERSION = "33333333-3333-4333-8333-333333333333";
const CARRIED = "44444444-4444-4444-8444-444444444444";
const LINE = "55555555-5555-4555-8555-555555555555";
const ITEM = "66666666-6666-4666-8666-666666666666";
const PLAN = "77777777-7777-4777-8777-777777777777";
const REQUEST = "88888888-8888-4888-8888-888888888888";
const AFFAIRE = `/dashboard/affaires/${PROJECT}`;
const TAKEOFF = `${AFFAIRE}/takeoff`;
const REVIEW = `${TAKEOFF}/${JOB}/review`;

const FIRST_FORMAT: TakeoffLinkJobFacts = { readsList: false };
const listJob = (line?: { itemId: string; answered: boolean; withdrawn?: boolean } | null, planKey: string | null = PLAN):
  TakeoffLinkJobFacts => ({ readsList: true, planKey, line: line ? { withdrawn: false, ...line } : null });

/** The matrix: each kind of link, the builder of main that writes it, and the address it writes. */
const LINKS: Array<{ kind: string; link: TakeoffReviewHrefInput; written: string }> = [
  { kind: "versioned bookmark, the job's « Revue », the activity's next step, the source badge",
    link: { projectId: PROJECT, jobId: JOB, versionId: VERSION }, written: `${REVIEW}?versionId=${VERSION}` },
  { kind: "a job without a version (by affaire), the end-of-analysis notification",
    link: { projectId: PROJECT, jobId: JOB }, written: REVIEW },
  { kind: "a link on a copied version (carry-over)",
    link: { projectId: PROJECT, jobId: JOB, versionId: CARRIED }, written: `${REVIEW}?versionId=${CARRIED}` },
  { kind: "reviewMode=assisted", link: { projectId: PROJECT, jobId: JOB, versionId: VERSION, reviewMode: "assisted" },
    written: `${REVIEW}?versionId=${VERSION}&reviewMode=assisted` },
  { kind: "reviewMode=production", link: { projectId: PROJECT, jobId: JOB, versionId: VERSION, reviewMode: "production" },
    written: `${REVIEW}?versionId=${VERSION}&reviewMode=production` },
  { kind: "reviewMode=validation", link: { projectId: PROJECT, jobId: JOB, versionId: VERSION, reviewMode: "validation" },
    written: `${REVIEW}?versionId=${VERSION}&reviewMode=validation` },
  { kind: "the DPGF tab (view=dpgf)", link: { projectId: PROJECT, jobId: JOB, versionId: VERSION, view: "dpgf" },
    written: `${REVIEW}?versionId=${VERSION}&view=dpgf` },
  { kind: "the pilotage panel, the plans card, the cockpit's suggestion (exceptions only)",
    link: { projectId: PROJECT, jobId: JOB, versionId: VERSION, view: "dpgf", dpgfView: "exceptions_only" },
    written: `${REVIEW}?versionId=${VERSION}&view=dpgf&dpgfView=exceptions_only` },
  { kind: "the risk radar and the approvals queue (exceptions only, validation)",
    link: { projectId: PROJECT, jobId: JOB, versionId: VERSION, reviewMode: "validation", view: "dpgf", dpgfView: "exceptions_only" },
    written: `${REVIEW}?versionId=${VERSION}&reviewMode=validation&view=dpgf&dpgfView=exceptions_only` },
  { kind: "the exceptions tab's estimate line", link: { projectId: PROJECT, jobId: JOB, versionId: VERSION, line: LINE },
    written: `${REVIEW}?versionId=${VERSION}&line=${LINE}` },
  { kind: "the targeted review", link: { projectId: PROJECT, jobId: JOB, versionId: VERSION, targeted: true },
    written: `${REVIEW}/targeted?versionId=${VERSION}` },
  { kind: "the targeted review's takeoff line (the table's « corriger dans la revue ciblée »)",
    link: { projectId: PROJECT, jobId: JOB, targeted: true, line: LINE }, written: `${REVIEW}/targeted?line=${LINE}` },
];

const notice = (kind: string) => `lien=${kind}&lienAnalyse=${JOB}`;

describe("resolveTakeoffReviewLink", () => {
  it("opens every link of a first-format job as it opens today, as the same string", () => {
    for (const { kind, link, written } of LINKS) {
      expect(takeoffReviewHref(link), kind).toBe(written);
      expect(resolveTakeoffReviewLink(link, FIRST_FORMAT), kind).toEqual({ kind: "historical", href: written });
    }
  });

  it("lands a list job's review, in any mode, version or carry-over, on the table filtered on its plan, with an explanation", () => {
    for (const { kind, link } of LINKS.slice(0, 6)) {
      expect(resolveTakeoffReviewLink(link, listJob()), kind)
        .toEqual({ kind: "table", href: `${TAKEOFF}?postePlan=${PLAN}&${notice("analyse")}` });
    }
  });

  it("lands a list job's DPGF exceptions on the items to check of its plan", () => {
    for (const { kind, link } of LINKS.slice(6, 9)) {
      expect(resolveTakeoffReviewLink(link, listJob()), kind)
        .toEqual({ kind: "table", href: `${TAKEOFF}?postePlan=${PLAN}&posteDecision=pending&${notice("ecarts")}` });
    }
  });

  it("opens the item an estimate line was sent from, on this reading when it answered the item, else the table on it", () => {
    const { link } = LINKS[9]!;
    // The server proved the line is the live target of the item in the link's version, and this job answered it.
    expect(resolveTakeoffReviewLink(link, listJob({ itemId: ITEM, answered: true }))).toEqual({ kind: "detail",
      href: `${TAKEOFF}?postePlan=${PLAN}&poste=${ITEM}&plan=${PLAN}&lecture=${JOB}&versionId=${VERSION}` });
    // The item of the line was read on another plan: the table, in focus on it, says why.
    expect(resolveTakeoffReviewLink(link, listJob({ itemId: ITEM, answered: false })))
      .toEqual({ kind: "table", href: `${TAKEOFF}?posteFocus=${ITEM}&${notice("ligne")}` });
    // A line no item was sent to: never an invented item, the reading's plan and why.
    expect(resolveTakeoffReviewLink(link, listJob(null)))
      .toEqual({ kind: "table", href: `${TAKEOFF}?postePlan=${PLAN}&${notice("ligne")}` });
  });

  it("keeps the targeted review of a list job: the correction screen the table's line detail opens during lot 4", () => {
    for (const { kind, link, written } of LINKS.slice(10)) {
      expect(resolveTakeoffReviewLink(link, listJob({ itemId: ITEM, answered: true })), kind)
        .toEqual({ kind: "historical", href: written });
    }
  });

  it("lands a list job that published no answer on the affaire's table, with the explanation", () => {
    expect(resolveTakeoffReviewLink(LINKS[0]!.link, listJob(null, null))).toEqual({ kind: "table", href: `${TAKEOFF}?${notice("analyse")}` });
    expect(resolveTakeoffReviewLink(LINKS[8]!.link, listJob(null, null)))
      .toEqual({ kind: "table", href: `${TAKEOFF}?posteDecision=pending&${notice("ecarts")}` });
  });

  it("never carries the old review's parameters, a version into the table, or the link out of its affaire", () => {
    for (const { kind, link } of LINKS) {
      for (const facts of [listJob(), listJob({ itemId: ITEM, answered: false }), listJob(null, null)]) {
        const { kind: landing, href } = resolveTakeoffReviewLink(link, facts);
        if (landing === "historical") continue;
        const url = new URL(href, "https://app.test");
        expect(url.pathname, kind).toBe(`${AFFAIRE}/takeoff`);
        for (const name of ["reviewMode", "view", "dpgfView", "line", "targeted"]) expect(url.searchParams.has(name), `${kind}: ${name}`).toBe(false);
        if (landing === "table") expect(url.searchParams.has("versionId"), kind).toBe(false);
      }
    }
  });
});

describe("the builders of new links", () => {
  it("builds the radar's and the approvals queue's link of a list job to its items to check, others as today", () => {
    const input = { projectId: PROJECT, jobId: JOB, versionId: VERSION, reviewMode: "validation" as const };
    expect(takeoffExceptionsLinkHref({ ...input, readsList: false }))
      .toBe(`${REVIEW}?versionId=${VERSION}&reviewMode=validation&view=dpgf&dpgfView=exceptions_only`);
    expect(takeoffExceptionsLinkHref({ projectId: PROJECT, jobId: JOB, versionId: VERSION, readsList: false }))
      .toBe(`${REVIEW}?versionId=${VERSION}&view=dpgf&dpgfView=exceptions_only`);
    // A version fed by several plans' readings: the affaire's items to check, not one plan's.
    expect(takeoffExceptionsLinkHref({ ...input, readsList: true })).toBe(`${TAKEOFF}?posteDecision=pending`);
  });

  it("builds the notification of a request's end to its affaire's zone, or to the table for a request read against the list", () => {
    expect(takeoffRequestNoticeHref(PROJECT, REQUEST, false)).toBe(`${AFFAIRE}?view=overview#metre`);
    expect(takeoffRequestNoticeHref(PROJECT, REQUEST, true)).toBe(`${TAKEOFF}?request=${REQUEST}#postes-du-metre`);
  });
});

describe("the explanation of a link", () => {
  it("is read only as written by the resolver, and removed without touching the table's address", () => {
    const params = (query: string) => new URLSearchParams(query);
    expect(readTakeoffLinkNotice(params(`postePlan=${PLAN}&${notice("ecarts")}`))).toEqual({ kind: "ecarts", jobId: JOB });
    expect(readTakeoffLinkNotice(params(`lien=ecarts&lienAnalyse=${JOB.toUpperCase()}`))).toEqual({ kind: "ecarts", jobId: JOB });
    for (const query of ["", `lien=autre&lienAnalyse=${JOB}`, "lien=analyse&lienAnalyse=pas-un-id", `lien=analyse`,
      `lien=analyse&lien=ligne&lienAnalyse=${JOB}`]) {
      expect(readTakeoffLinkNotice(params(query)), query).toBeNull();
    }
    expect(withoutTakeoffLinkNotice(`postePlan=${PLAN}&${notice("analyse")}&posteLimit=50`).toString())
      .toBe(`postePlan=${PLAN}&posteLimit=50`);
  });
});

// The independent reading of #501, written before the fixes:
// 1. the review's tab switch keeps `dpgfView=exceptions_only` when a member goes from the DPGF tab to « Items »: that
//    bookmark landed on the items to check only, hiding the accepted ones;
// 2. an estimate line fed by an item since withdrawn from the list led to a detail that cannot show it (« introuvable
//    dans la liste »);
// 3. a saved comparison of two readings landed on the table, with no way back to it.
describe("review of #501", () => {
  const OTHER = "99999999-9999-4999-8999-999999999999";
  const read = (query: string, targeted = false) =>
    readTakeoffReviewLink({ projectId: PROJECT, jobId: JOB, targeted }, new URLSearchParams(query));

  it("lands an « Items » bookmark that kept the DPGF view's filter on the plan's table with every decision", () => {
    const items = { projectId: PROJECT, jobId: JOB, versionId: VERSION, reviewMode: "production" as const, dpgfView: "exceptions_only" as const };
    expect(resolveTakeoffReviewLink(items, listJob()))
      .toEqual({ kind: "table", href: `${TAKEOFF}?postePlan=${PLAN}&${notice("analyse")}` });
    for (const query of [`versionId=${VERSION}&reviewMode=production&view=items&dpgfView=exceptions_only`,
      `versionId=${VERSION}&view=tables&dpgfView=exceptions_only`, `dpgfView=exceptions_only`]) {
      expect(resolveTakeoffReviewLink(read(query), listJob()), query)
        .toEqual({ kind: "table", href: `${TAKEOFF}?postePlan=${PLAN}&${notice("analyse")}` });
    }
    // Only an address that names the DPGF view opens the items to check.
    expect(resolveTakeoffReviewLink(read(`versionId=${VERSION}&view=dpgf`), listJob()))
      .toEqual({ kind: "table", href: `${TAKEOFF}?postePlan=${PLAN}&posteDecision=pending&${notice("ecarts")}` });
  });

  it("lands an estimate line fed by an item since withdrawn from the list on the plan's table, never on a detail", () => {
    const link = { projectId: PROJECT, jobId: JOB, versionId: VERSION, line: LINE };
    for (const answered of [true, false]) {
      expect(resolveTakeoffReviewLink(link, listJob({ itemId: ITEM, answered, withdrawn: true })), String(answered))
        .toEqual({ kind: "table", href: `${TAKEOFF}?postePlan=${PLAN}&${notice("retire")}` });
    }
    expect(readTakeoffLinkNotice(new URLSearchParams(notice("retire")))).toEqual({ kind: "retire", jobId: JOB });
  });

  it("never redirects an address that asks for the comparison of two readings, for a list job as for any other", () => {
    expect(resolveTakeoffReviewLink({ projectId: PROJECT, jobId: JOB, versionId: VERSION, view: "compare", compareWith: OTHER }, listJob()))
      .toEqual({ kind: "historical", href: `${REVIEW}?versionId=${VERSION}&view=compare&compareWith=${OTHER}` });
    for (const query of [`versionId=${VERSION}&view=compare&compareWith=${OTHER}`,
      `versionId=${VERSION}&reviewMode=production&view=compare&compareWith=${OTHER}&threshold=0.8`, `versionId=${VERSION}&view=compare`]) {
      const link = read(query);
      for (const facts of [FIRST_FORMAT, listJob(), listJob(null, null)]) {
        expect(resolveTakeoffReviewLink(link, facts), query).toEqual({ kind: "historical", href: `${REVIEW}?${query}` });
      }
    }
  });

  it("reads the review's address as the review reads it: one value per parameter, known values only", () => {
    expect(read(`versionId=${VERSION}&reviewMode=assisted&view=dpgf&dpgfView=exceptions_only&line=${LINE}`)).toEqual({ projectId: PROJECT,
      jobId: JOB, versionId: VERSION, reviewMode: "assisted", view: "dpgf", dpgfView: "exceptions_only", line: LINE });
    expect(read(`reviewMode=autre&view=autre&dpgfView=all&line=${LINE}&line=${OTHER}`)).toEqual({ projectId: PROJECT, jobId: JOB });
    expect(read(`line=${LINE}`, true)).toEqual({ projectId: PROJECT, jobId: JOB, targeted: true, line: LINE });
    expect(read(`versionId=${VERSION.toUpperCase()}`)).toEqual({ projectId: PROJECT, jobId: JOB, versionId: VERSION });
  });
});
