import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/line-evidence-server", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/takeoff/line-evidence-server")>(),
  buildSupplierPriceEvidenceByEstimateItemId: vi.fn(),
  syncAndHydrateTakeoffLineProofs: vi.fn(),
}));

import { buildTakeoffDpgfComparison } from "@/lib/takeoff/dpgf-compare";
import type { TakeoffDpgfComparisonContext } from "@/lib/takeoff/dpgf-comparison-context-server";
import { fetchAllTakeoffDpgfComparisonRows } from "@/lib/takeoff/dpgf-comparison-server";
import { buildSupplierPriceEvidenceByEstimateItemId, syncAndHydrateTakeoffLineProofs } from "@/lib/takeoff/line-evidence-server";

function context(): TakeoffDpgfComparisonContext {
  return {
    supabase: {} as TakeoffDpgfComparisonContext["supabase"], tenantId: "tenant", userId: "owner", projectId: "project",
    estimateItems: [], takeoffItems: [], compositions: { targets: new Map(), lines: new Map(), jobs: new Map() },
    comparisonInput: {
      versionId: "version", jobId: "job", takeoffLines: [], manualLinks: [], reviewDecisions: [], carriedReviewDecisions: new Map(),
      dpgfCompositions: { targets: new Map(), lines: new Map(), jobs: new Map() }, readAgainItemIds: new Set(), overlapPartners: new Map(),
      dpgfLines: Array.from({ length: 1301 }, (_, index) => ({
        estimate_item_id: `line-${index}`, title: `Tube ${index}`, description: null, quantity: index + 1,
        unit: "ml", position: index, source_file_name: "dpgf.xlsx", source_page: index + 1,
        mappedRowId: null, sourceFactsKnown: true,
      })),
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(buildSupplierPriceEvidenceByEstimateItemId).mockResolvedValue(new Map());
});

describe("complete DPGF proof hydration", () => {
  it("keeps every business row and its proof in page order after reversed completions with at most four pages in flight", async () => {
    const input = context();
    let active = 0;
    let peak = 0;
    let flush: ReturnType<typeof setTimeout> | undefined;
    const pending: Array<{ index: number; finish: () => void }> = [];
    const completed: number[] = [];
    vi.mocked(syncAndHydrateTakeoffLineProofs).mockImplementation(async ({ rows }) => {
      active += 1;
      peak = Math.max(peak, active);
      expect(rows.length).toBeLessThanOrEqual(200);
      const index = Math.floor(Number(rows[0].line_id.split("-")[1]) / 200);
      await new Promise<void>(resolve => {
        pending.push({ index, finish: resolve });
        flush ??= setTimeout(() => {
          flush = undefined;
          for (const page of pending.splice(0).sort((left, right) => right.index - left.index)) page.finish();
        }, 0);
      });
      active -= 1;
      completed.push(index);
      return rows.map(row => ({ ...row, proofs: row.proofs.map(proof => ({ ...proof, proof_id: `stored-${row.line_id}` })) }));
    });
    const result = await fetchAllTakeoffDpgfComparisonRows({ context: input });
    const expected = input.comparisonInput.dpgfLines.map(line => [line.estimate_item_id, line.quantity, `stored-${line.estimate_item_id}`]);
    expect(result.rows.map(row => [row.line_id, row.dpgf.quantity, row.proofs[0].proof_id])).toEqual(expected);
    expect(result.summary).toEqual(buildTakeoffDpgfComparison(input.comparisonInput).summary);
    expect(result.pagination).toMatchObject({ total: 1301, next_cursor: null });
    expect(peak).toBe(4);
    expect(completed.slice(0, 4)).toEqual([3, 2, 1, 0]);
  });

  it("rejects the whole read and drains the current batch before reporting a proof failure", async () => {
    const completed: string[] = [];
    const failure = new Error("proof transport failed");
    vi.mocked(syncAndHydrateTakeoffLineProofs).mockImplementation(async ({ rows }) => {
      if (rows[0].line_id === "line-200") throw failure;
      await new Promise(resolve => setTimeout(resolve, 5));
      completed.push(rows[0].line_id);
      return rows;
    });
    await expect(fetchAllTakeoffDpgfComparisonRows({ context: context() })).rejects.toBe(failure);
    expect(completed.sort()).toEqual(["line-0", "line-400", "line-600"]);
    expect(syncAndHydrateTakeoffLineProofs).toHaveBeenCalledTimes(4);
  });
});
