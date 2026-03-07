import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/explanations", () => ({
  getEstimateLineExplanation: vi.fn(),
}));

import { GET } from "@/app/api/estimates/[versionId]/lines/[lineId]/explanation/route";
import { badRequest } from "@/lib/estimates/errors";
import { getEstimateLineExplanation } from "@/lib/estimates/explanations";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const LINE_ID = "22222222-2222-4222-8222-222222222222";

describe("GET /api/estimates/[versionId]/lines/[lineId]/explanation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards params and detail flag to the explanation service", async () => {
    vi.mocked(getEstimateLineExplanation).mockResolvedValue({
      explanation_id: "33333333-3333-4333-8333-333333333333",
      kind: "price",
      version_id: VERSION_ID,
      line_id: LINE_ID,
      compare_version_id: null,
      summary_short: "Prix explique.",
      summary_detail: "Detail complet.",
      confidence_label: "high",
      confidence_score: 0.91,
      used_fallback: false,
      provider: "gemini",
      model: "gemini-3-pro-preview",
      generated_at: "2026-03-07T10:00:00.000Z",
      facts: [],
      hypotheses: [],
      inferences: [],
      provenance: [],
      risk_signals: [],
      impact_summary: {
        current_amount_ht_cents: 12000,
        top_drivers: [],
      },
    });

    const response = await GET(
      new Request(
        `http://localhost/api/estimates/${VERSION_ID}/lines/${LINE_ID}/explanation?detail=1`
      ),
      {
        params: Promise.resolve({
          versionId: VERSION_ID,
          lineId: LINE_ID,
        }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(vi.mocked(getEstimateLineExplanation)).toHaveBeenCalledWith({
      versionId: VERSION_ID,
      lineId: LINE_ID,
      includeDetail: true,
    });
    expect(payload.ok).toBe(true);
    expect(payload.data.explanation.kind).toBe("price");
  });

  it("maps estimate errors to the standard envelope", async () => {
    vi.mocked(getEstimateLineExplanation).mockRejectedValue(
      badRequest("detail invalide.")
    );

    const response = await GET(
      new Request(
        `http://localhost/api/estimates/${VERSION_ID}/lines/${LINE_ID}/explanation`
      ),
      {
        params: Promise.resolve({
          versionId: VERSION_ID,
          lineId: LINE_ID,
        }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.error?.message).toBe("detail invalide.");
  });
});
