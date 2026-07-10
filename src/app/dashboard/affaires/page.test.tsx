import { Children, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

import type { AffairePageDataResult } from "@/lib/affaires/server";

vi.mock("@/lib/affaires/server", () => ({
  fetchAffairePageData: vi.fn(),
  fetchAffaireManagerQueueSummary: vi.fn(
    () => new Promise(() => undefined)
  ),
}));

import AffairesPage from "@/app/dashboard/affaires/page";
import {
  fetchAffaireManagerQueueSummary,
  fetchAffairePageData,
} from "@/lib/affaires/server";

const data: AffairePageDataResult = {
  list: {
    items: [],
    pageSize: 20,
    nextCursor: null,
    hasNextPage: false,
  },
  counters: {
    totalCount: 0,
    filteredCount: 0,
    statusCounts: {
      draft: 0,
      sent: 0,
      accepted: 0,
      archived: 0,
    },
  },
  managerQueue: null,
};

describe("AffairesPage", () => {
  it("renders the list without waiting for the manager queue summary", async () => {
    vi.mocked(fetchAffairePageData).mockResolvedValue(data);

    const pageElement = (await AffairesPage({
      searchParams: Promise.resolve({}),
    })) as ReactElement<{ children: ReactElement }>;
    const clientElement = Children.only(pageElement.props.children) as ReactElement<{
      initialData: AffairePageDataResult;
    }>;

    expect(fetchAffairePageData).toHaveBeenCalledTimes(1);
    expect(fetchAffaireManagerQueueSummary).not.toHaveBeenCalled();
    expect(clientElement.props.initialData).toBe(data);
  });
});
