/**
 * The address of a takeoff's review in its affaire: `/dashboard/affaires/{projectId}/takeoff/{jobId}/review`, or its
 * targeted review (TI-664 L5c) under `/review/targeted`. When supplied, the estimate version comes first, followed in order by
 * the review mode, the view, the DPGF view and the line: the journeys compare these addresses as strings.
 */
export type TakeoffReviewHrefInput = {
  projectId: string;
  jobId: string;
  versionId?: string | null;
  targeted?: boolean;
  /** « assisted » is read from old addresses only: no screen writes it. */
  reviewMode?: "assisted" | "validation" | "production";
  view?: "dpgf";
  dpgfView?: "exceptions_only";
  line?: string;
};

export function takeoffReviewHref(input: TakeoffReviewHrefInput): string {
  const path = `/dashboard/affaires/${input.projectId}/takeoff/${input.jobId}/review${input.targeted ? "/targeted" : ""}`;
  const query: Array<[string, string | undefined]> = [
    ["versionId", input.versionId ?? undefined],
    ["reviewMode", input.reviewMode],
    ["view", input.view],
    ["dpgfView", input.dpgfView],
    ["line", input.line],
  ];
  const search = query
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  return search ? `${path}?${search}` : path;
}

/** The review opened on the DPGF reconciliation's exceptions only. */
export function takeoffDpgfExceptionsHref(
  input: Pick<TakeoffReviewHrefInput, "projectId" | "jobId" | "versionId" | "reviewMode">
): string {
  return takeoffReviewHref({ ...input, view: "dpgf", dpgfView: "exceptions_only" });
}

/**
 * The parameters of the detail of an item on its plan (lot 5), on the affaire's takeoff page, in the order its address
 * writes them: the item, the plan (its logical identity, as the table of items names it), the reading (a job), the
 * original page (1-based), a dossier piece and its generation for a plan no analysis sealed yet, the answer and the
 * observation shown, and the estimate version a link was followed from. An address selects a view: never a gesture, a
 * payer or a right.
 */
export const TAKEOFF_ITEM_DETAIL_PARAMS = {
  itemId: "poste",
  planKey: "plan",
  jobId: "lecture",
  page: "page",
  sourceId: "source",
  generation: "generation",
  answerId: "reponse",
  observationId: "observation",
  versionId: "versionId",
} as const;

export type TakeoffItemDetailHrefInput = {
  projectId: string;
  itemId: string;
  planKey?: string | null;
  jobId?: string | null;
  page?: number | null;
  source?: { documentId: string; generation?: string | null } | null;
  answerId?: string | null;
  observationId?: string | null;
  versionId?: string | null;
  /** The query of the page the detail is opened from (the table's `poste…` parameters and the page's own): kept as is. */
  from?: string | URLSearchParams;
};

/** The detail's parameters of a query removed, every other parameter kept in its order. */
export function withoutTakeoffItemDetail(query: string | URLSearchParams = ""): URLSearchParams {
  const next = new URLSearchParams(query);
  for (const name of Object.values(TAKEOFF_ITEM_DETAIL_PARAMS)) next.delete(name);
  return next;
}

export function takeoffItemDetailHref(input: TakeoffItemDetailHrefInput): string {
  const next = withoutTakeoffItemDetail(input.from);
  const values: Record<keyof typeof TAKEOFF_ITEM_DETAIL_PARAMS, string | null | undefined> = {
    itemId: input.itemId,
    planKey: input.planKey,
    jobId: input.jobId,
    page: input.page ? String(input.page) : null,
    sourceId: input.source?.documentId,
    generation: input.source ? input.source.generation : null,
    answerId: input.answerId,
    observationId: input.observationId,
    versionId: input.versionId,
  };
  for (const [key, name] of Object.entries(TAKEOFF_ITEM_DETAIL_PARAMS) as Array<[keyof typeof TAKEOFF_ITEM_DETAIL_PARAMS, string]>) {
    const value = values[key];
    if (value) next.append(name, value);
  }
  return `/dashboard/affaires/${input.projectId}/takeoff?${next.toString()}`;
}
