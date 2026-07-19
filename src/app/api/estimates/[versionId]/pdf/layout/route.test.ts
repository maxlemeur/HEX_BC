import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/pdf-generator", () => ({
  getEstimatePdfLayoutConfiguration: vi.fn(),
}));

import { GET } from "@/app/api/estimates/[versionId]/pdf/layout/route";
import { getEstimatePdfLayoutConfiguration } from "@/lib/estimates/pdf-generator";

const VERSION_ID = "44444444-4444-4444-8444-444444444444";

describe("GET /api/estimates/[versionId]/pdf/layout", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns layout capabilities for the authenticated estimate", async () => {
    vi.mocked(getEstimatePdfLayoutConfiguration).mockResolvedValue({
      lineCount: 12,
      sectionCountsByLevel: { "1": 2, "2": 3, "3": 1, "4": 0 },
      hasConditions: true,
      terms: {
        available: true,
        policy: "default",
        title: "Conditions generales de vente",
        version: 2,
      },
    });

    const response = await GET(
      new Request(`http://localhost/api/estimates/${VERSION_ID}/pdf/layout`),
      { params: Promise.resolve({ versionId: VERSION_ID }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { lineCount: 12, hasConditions: true },
    });
  });
});
