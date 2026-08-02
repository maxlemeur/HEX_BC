const SORT_BY_VALUES = ["priority", "amount", "margin", "age"] as const;
export type ApprovalQueueSortBy = (typeof SORT_BY_VALUES)[number];
export type ApprovalQueueSortDirection = "asc" | "desc";

export const APPROVAL_QUEUE_DEFAULT_DIRECTIONS: Record<
  ApprovalQueueSortBy,
  ApprovalQueueSortDirection
> = {
  priority: "desc",
  amount: "desc",
  margin: "asc",
  age: "asc",
};

export type ApprovalQueueQuery = {
  sortBy: ApprovalQueueSortBy;
  sortDir: ApprovalQueueSortDirection;
  onlyExceptions: boolean;
};

function isSortBy(value: unknown): value is ApprovalQueueSortBy {
  return typeof value === "string" && (SORT_BY_VALUES as readonly string[]).includes(value);
}

function isSortDirection(value: unknown): value is ApprovalQueueSortDirection {
  return value === "asc" || value === "desc";
}

export function parseApprovalQueueQuery(
  params: Record<string, string | string[] | undefined>
): ApprovalQueueQuery {
  const rawSort = typeof params.sortBy === "string" ? params.sortBy : undefined;
  const rawSortDir = typeof params.sortDir === "string" ? params.sortDir : undefined;
  const rawExceptions = typeof params.onlyExceptions === "string" ? params.onlyExceptions : undefined;
  const sortBy = isSortBy(rawSort) ? rawSort : "priority";

  return {
    sortBy,
    sortDir: isSortDirection(rawSortDir)
      ? rawSortDir
      : APPROVAL_QUEUE_DEFAULT_DIRECTIONS[sortBy],
    onlyExceptions: rawExceptions === "true",
  };
}
