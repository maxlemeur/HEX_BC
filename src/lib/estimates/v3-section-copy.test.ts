import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/batch", async (original) => ({
  ...await original<typeof import("@/lib/estimates/batch")>(),
  executeEstimateBatch: vi.fn(async () => ({ committed: true, results: [] })),
}));

import { normalizeMappedRowsForEstimateCreation } from "@/lib/affaires/import-flow";
import { ESTIMATE_BATCH_MAX_BODY_BYTES, executeEstimateBatch } from "./batch";
import { commitV3Copy, planV3LinkedDpgfImport } from "./v3-section-copy";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function linkedCsvPlan(noteBytes: number, withRawIds: boolean, legacyMetadata = false) {
  const rows = Array.from({ length: 500 }, (_, row_index) => ({
    id: uuid(1000 + row_index), ...(withRawIds ? { rawRowId: uuid(2000 + row_index) } : {}),
    payload: { row_index, mapped_row: { designation: "Lavabo", unit: "u", quantity: "1", notes: "a".repeat(noteBytes) } },
  }));
  const { validLines } = normalizeMappedRowsForEstimateCreation(rows, {
    engine: 3, entry: "preview", defaultTaxRateBp: 2000, marginMultiplier: 1, saleCoefficientFo: 1, saleCoefficientMo: 1,
  });
  expect(validLines).toHaveLength(500);
  return planV3LinkedDpgfImport({
    sectionId: uuid(1), importId: uuid(2), rootPosition: 1, sectionTitle: "DPGF", filename: "postes.csv",
    lines: validLines.map((line, index) => {
      const sourceMetadata = { ...line.sourceMetadata };
      if (legacyMetadata) {
        delete sourceMetadata.dpgf_source_quantity;
        delete sourceMetadata.dpgf_source_unit;
      }
      return { ...line, sourceMetadata, id: uuid(3000 + index) };
    }),
  });
}

const bytes = (plan: ReturnType<typeof linkedCsvPlan>) =>
  Buffer.byteLength(JSON.stringify(plan.createdIds.map((item) => item.source_metadata ?? null)));

describe("linked DPGF provenance budget", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["1930-byte notes with the reported metadata shape", 1930, true],
    ["1882-byte notes with the current quantitative metadata", 1882, false],
  ])("accepts a 500-line CSV that already fit the copy budget (%s)", async (_label, noteBytes, legacyMetadata) => {
    const baseline = linkedCsvPlan(noteBytes, false, legacyMetadata);
    const enriched = linkedCsvPlan(noteBytes, true, legacyMetadata);
    expect(bytes(baseline)).toBe(1_032_444);
    expect(bytes(baseline)).toBeLessThan(ESTIMATE_BATCH_MAX_BODY_BYTES);
    expect(bytes(enriched) - bytes(baseline)).toBe(26_000);
    expect(bytes(enriched)).toBeGreaterThan(ESTIMATE_BATCH_MAX_BODY_BYTES);

    const target = { versionId: uuid(3), updatedAt: "2026-11-20T10:00:00Z" };
    await expect(commitV3Copy({ ...target, plan: baseline })).resolves.toMatchObject({ committed: true });
    await expect(commitV3Copy({ ...target, plan: enriched })).resolves.toMatchObject({ committed: true });
    expect(executeEstimateBatch).toHaveBeenCalledTimes(2);
    const first = vi.mocked(executeEstimateBatch).mock.calls[0][2]?.createdIds;
    const second = vi.mocked(executeEstimateBatch).mock.calls[1][2]?.createdIds;
    expect(second).toEqual(first);
  });
});
