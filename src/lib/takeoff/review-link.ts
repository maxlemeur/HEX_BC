import { ITEM_TABLE_PARAM_PREFIX } from "./item-detail-address";
import type { ItemLineDecision } from "./item-table";
import { itemTableAddressParams, withItemTableParams } from "./item-table-query";
import {
  takeoffDpgfExceptionsHref,
  takeoffItemDetailHref,
  takeoffReviewHref,
  type TakeoffReviewHrefInput,
} from "./review-href";

/**
 * Where a link to a takeoff's review lands (lot 4, the entries): one resolver for every review link a member can hold
 * (a bookmark, a job's « Revue », a notification, the radar, a link on a copied version, an old version's address
 * redirected to the review), applied by the review's page once the server has checked the member's access to the job
 * and to its version or carry-over, as it does for every review. The redirect is never the authorisation: the screen it
 * leads to checks the member's access again.
 *
 * - A job of the first format (no measuring order, the free extraction, a grouped analysis, another provider) opens what
 *   it opens today, as the same string: its mode, view, line, version and carry-over kept.
 * - A job read against the affaire's list of items is reviewed in the table of items: its review lands on the table
 *   filtered on the plan it read, in any tab but the DPGF one (an « Items » bookmark keeps the DPGF tab's `dpgfView`
 *   and names the items, not the exceptions); an address that names the DPGF view, on that plan's items to check; an
 *   estimate line the send by item wrote from an item on the detail of that item on this reading (or on the table, in
 *   focus on the item, when this reading did not answer it; on the plan's table when the item was withdrawn from the
 *   list since, which the table and the detail, reading the latest list, cannot show). The table names why it opened so
 *   (`lien`, `lienAnalyse`).
 * - Two addresses stay for every job: the targeted review (the correction screen the table's line detail opens while
 *   lot 4 keeps it) and the comparison of two readings (`view=compare`, a read of history).
 *
 * Nothing of the old review's address travels to the table (its mode, view, line, version): an address selects a view,
 * never a selection, a decision or a right, and stays in the link's affaire.
 */

/** The facts the server proved of a link's job, after its access check (review-link-server.ts). */
export type TakeoffLinkJobFacts =
  | { readsList: false }
  | {
    readsList: true;
    /** The plan the job read (its logical identity, as the table names it); null while it published no answer. */
    planKey: string | null;
    /**
     * The item a link's estimate line is the live target of in the link's version, whether this job answered it, and
     * whether the affaire's latest list no longer holds it (withdrawn since it was sent).
     */
    line: { itemId: string; answered: boolean; withdrawn: boolean } | null;
  };

export type TakeoffLinkDestination = { kind: "historical" | "table" | "detail"; href: string };

/** Why the table opened from a link to the review of a job read against the list. */
export const TAKEOFF_LINK_NOTICES = ["analyse", "ecarts", "ligne", "retire"] as const;
export type TakeoffLinkNoticeKind = (typeof TAKEOFF_LINK_NOTICES)[number];
export const TAKEOFF_LINK_NOTICE_PARAMS = { kind: "lien", jobId: "lienAnalyse" } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const takeoffPath = (projectId: string) => `/dashboard/affaires/${projectId}/takeoff`;

/** The table of items on the affaire's takeoff page, on a view of it and with the explanation of a link. */
function itemTableHref(projectId: string, view: { planKey?: string | null; decisions?: ItemLineDecision[]; focusItemId?: string },
  notice?: { kind: TakeoffLinkNoticeKind; jobId: string }) {
  const next = withItemTableParams("", itemTableAddressParams({
    ...(view.planKey ? { scope: { kind: "plan" as const, planKey: view.planKey } } : {}),
    ...(view.decisions ? { filter: { decisions: view.decisions } } : {}),
    ...(view.focusItemId ? { focusItemId: view.focusItemId } : {}),
  }, ITEM_TABLE_PARAM_PREFIX));
  if (notice) {
    next.set(TAKEOFF_LINK_NOTICE_PARAMS.kind, notice.kind);
    next.set(TAKEOFF_LINK_NOTICE_PARAMS.jobId, notice.jobId);
  }
  const search = next.toString();
  return `${takeoffPath(projectId)}${search ? `?${search}` : ""}`;
}

export function resolveTakeoffReviewLink(link: TakeoffReviewHrefInput, facts: TakeoffLinkJobFacts): TakeoffLinkDestination {
  if (!facts.readsList || link.targeted || link.view === "compare") return { kind: "historical", href: takeoffReviewHref(link) };
  const notice = (kind: TakeoffLinkNoticeKind) => ({ kind, jobId: link.jobId });
  if (link.line) {
    if (facts.line?.withdrawn) return { kind: "table", href: itemTableHref(link.projectId, { planKey: facts.planKey }, notice("retire")) };
    if (facts.line?.answered && facts.planKey) {
      return { kind: "detail", href: takeoffItemDetailHref({ projectId: link.projectId, itemId: facts.line.itemId, planKey: facts.planKey,
        jobId: link.jobId, versionId: link.versionId ?? null,
        from: withItemTableParams("", itemTableAddressParams({ scope: { kind: "plan", planKey: facts.planKey } }, ITEM_TABLE_PARAM_PREFIX)) }) };
    }
    if (facts.line) return { kind: "table", href: itemTableHref(link.projectId, { focusItemId: facts.line.itemId }, notice("ligne")) };
    return { kind: "table", href: itemTableHref(link.projectId, { planKey: facts.planKey }, notice("ligne")) };
  }
  if (link.view === "dpgf") {
    return { kind: "table", href: itemTableHref(link.projectId, { planKey: facts.planKey, decisions: ["pending"] }, notice("ecarts")) };
  }
  return { kind: "table", href: itemTableHref(link.projectId, { planKey: facts.planKey }, notice("analyse")) };
}

type Params = { getAll(name: string): string[] };

const VIEWS = ["dpgf", "items", "tables", "compare"] as const;
const MODES = ["assisted", "production", "validation"] as const;

/**
 * A review's address as the review reads it (TakeoffReviewPage): each parameter given once, exactly a known value (no
 * value padded or written otherwise is that value); the version, the comparison's other job and the line as written
 * (the access check and the server's facts check them).
 */
export function readTakeoffReviewLink(target: { projectId: string; jobId: string; targeted?: boolean }, params: Params): TakeoffReviewHrefInput {
  // As written: the review reads each value as it is (a padded « dpgf » is not the DPGF view there, nor here).
  const one = (name: string) => {
    const values = params.getAll(name);
    return values.length === 1 && values[0] ? values[0] : undefined;
  };
  const among = <T extends string>(allowed: readonly T[], value: string | undefined) =>
    allowed.find((candidate) => candidate === value);
  const versionId = one("versionId");
  const link: TakeoffReviewHrefInput = { projectId: target.projectId, jobId: target.jobId };
  if (target.targeted) link.targeted = true;
  if (versionId) link.versionId = UUID.test(versionId) ? versionId.toLowerCase() : versionId;
  const reviewMode = among(MODES, one("reviewMode"));
  if (reviewMode) link.reviewMode = reviewMode;
  const view = among(VIEWS, one("view"));
  if (view) link.view = view;
  if (one("dpgfView") === "exceptions_only") link.dpgfView = "exceptions_only";
  const compareWith = one("compareWith");
  if (compareWith) link.compareWith = compareWith;
  const threshold = one("threshold");
  if (threshold) link.threshold = threshold;
  const line = one("line");
  if (line) link.line = line;
  return link;
}

/**
 * The DPGF exceptions of a version's latest analysis, as the risk radar and the approvals queue open them: the review's
 * exceptions for a first-format job (as today), the affaire's items to check for a job read against the list (a
 * version is fed by the readings of several plans: the link names none of them).
 */
export function takeoffExceptionsLinkHref(input: Pick<TakeoffReviewHrefInput, "projectId" | "jobId" | "versionId" | "reviewMode">
  & { readsList: boolean }) {
  if (input.readsList) return itemTableHref(input.projectId, { decisions: ["pending"] });
  return takeoffDpgfExceptionsHref({ projectId: input.projectId, jobId: input.jobId, versionId: input.versionId,
    reviewMode: input.reviewMode });
}

/** The end of a launch request, as its notification opens it: the affaire's takeoff zone, or the table for a list. */
export function takeoffRequestNoticeHref(projectId: string, requestId: string, readsList: boolean) {
  if (!readsList) return `/dashboard/affaires/${projectId}?view=overview#metre`;
  return `${takeoffPath(projectId)}?request=${encodeURIComponent(requestId)}#postes-du-metre`;
}

/** The explanation an address carries, as the resolver writes it; anything else is no explanation. */
export function readTakeoffLinkNotice(params: Params): { kind: TakeoffLinkNoticeKind; jobId: string } | null {
  const kinds = params.getAll(TAKEOFF_LINK_NOTICE_PARAMS.kind);
  const jobs = params.getAll(TAKEOFF_LINK_NOTICE_PARAMS.jobId);
  if (kinds.length !== 1 || jobs.length !== 1) return null;
  const kind = TAKEOFF_LINK_NOTICES.find((value) => value === kinds[0]);
  return kind && UUID.test(jobs[0]!) ? { kind, jobId: jobs[0]!.toLowerCase() } : null;
}

/** An address without the explanation of a link, every other parameter kept in its order. */
export function withoutTakeoffLinkNotice(query: string | URLSearchParams) {
  const next = new URLSearchParams(query);
  next.delete(TAKEOFF_LINK_NOTICE_PARAMS.kind);
  next.delete(TAKEOFF_LINK_NOTICE_PARAMS.jobId);
  return next;
}
