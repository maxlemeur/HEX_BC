import { Suspense } from "react";

import { fetchApprovalQueue } from "@/lib/approvals/server";
import { parseApprovalQueueQuery } from "@/lib/approvals/schemas";
import { ApprovalQueuePage } from "@/components/approvals/ApprovalQueuePage";
import ApprovalsLoading from "./loading";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ApprovalsPageRoute({ searchParams }: Props) {
  const params = await searchParams;
  const query = parseApprovalQueueQuery(params);
  const data = await fetchApprovalQueue(query);

  return (
    <Suspense fallback={<ApprovalsLoading />}>
      <ApprovalQueuePage
        initialData={data}
        initialSortBy={query.sortBy}
        initialSortDir={query.sortDir}
        initialOnlyExceptions={query.onlyExceptions}
      />
    </Suspense>
  );
}
