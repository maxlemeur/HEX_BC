const SORT_BY_VALUES = ["priority", "amount", "margin", "age"] as const;
export type ApprovalQueueSortBy = (typeof SORT_BY_VALUES)[number];

export type ApprovalQueueQuery = {
  sortBy: ApprovalQueueSortBy;
  onlyExceptions: boolean;
};

function isSortBy(value: unknown): value is ApprovalQueueSortBy {
  return typeof value === "string" && (SORT_BY_VALUES as readonly string[]).includes(value);
}

export function parseApprovalQueueQuery(
  params: Record<string, string | string[] | undefined>
): ApprovalQueueQuery {
  const rawSort = typeof params.sortBy === "string" ? params.sortBy : undefined;
  const rawExceptions = typeof params.onlyExceptions === "string" ? params.onlyExceptions : undefined;

  return {
    sortBy: isSortBy(rawSort) ? rawSort : "priority",
    onlyExceptions: rawExceptions === "true",
  };
}
