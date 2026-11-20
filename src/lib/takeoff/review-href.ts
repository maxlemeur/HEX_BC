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
  reviewMode?: "validation" | "production";
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
