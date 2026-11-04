import { describe, expect, it, vi } from "vitest";

import { fetchTakeoffJobWithAllItems } from "@/lib/takeoff/client";
import { JOB_ID, takeoffItemFixture } from "@/lib/takeoff/response-contracts.test-fixtures";
import type { TakeoffJobDetailResponse } from "@/lib/takeoff/types";

// The job monitor's apply wizard ran checkApplyGuard on the first 50 lines only (the route's default page), while the
// server guards every line (TI-664 L5b review): a blocked line at row 55 was never shown, yet an admin override covered
// it. Every caller of the guard now reads every line, page by page, or refuses to guard part of them.

function page(total: number, offset: number, count: number) {
  return {
    job: { id: JOB_ID },
    items: { data: Array.from({ length: count }, (_, index) => takeoffItemFixture({ id: `item-${offset + index}` })),
      pagination: { total, offset, limit: 200 } },
  } as unknown as TakeoffJobDetailResponse;
}

type PageOptions = { signal?: AbortSignal; itemsLimit?: number; itemsOffset?: number } | undefined;

describe("every line of a job for the apply guard", () => {
  it("reads past the route's first page, page by page", async () => {
    const fetchPage = vi.fn(async (_jobId: string, options?: PageOptions) => {
      const offset = options?.itemsOffset ?? 0;
      return page(260, offset, Math.min(200, 260 - offset));
    });
    const detail = await fetchTakeoffJobWithAllItems(JOB_ID, {}, fetchPage);
    expect(detail.items.data.map((item) => item.id)).toEqual(Array.from({ length: 260 }, (_, index) => `item-${index}`));
    expect(fetchPage.mock.calls.map(([, options]) => [options?.itemsLimit, options?.itemsOffset])).toEqual([[200, 0], [200, 200]]);
  });

  it("refuses an incomplete list rather than guard part of it", async () => {
    const fetchPage = vi.fn(async (_jobId: string, options?: PageOptions) =>
      (options?.itemsOffset ?? 0) === 0 ? page(260, 0, 200) : page(260, options?.itemsOffset ?? 0, 0));
    await expect(fetchTakeoffJobWithAllItems(JOB_ID, {}, fetchPage)).rejects.toThrow("Lignes du job incomplètes");
  });
});
