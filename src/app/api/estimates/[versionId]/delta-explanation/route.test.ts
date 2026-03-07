import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/explanations", () => ({
  getEstimateDeltaExplanation: vi.fn(),
}));

import { GET } from "@/app/api/estimates/[versionId]/delta-explanation/route";
import { badRequest } from "@/lib/estimates/errors";
import { getEstimateDeltaExplanation } from "@/lib/estimates/explanations";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const COMPARE_VERSION_ID = "22222222-2222-4222-8222-222222222222";

describe("GET /api/estimates/[versionId]/delta-explanation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards compare version and detail flag to the explanation service", async () => {
    vi.mocked(getEstimateDeltaExplanation).mockResolvedValue({
      explanation_id: "33333333-3333-4333-8333-333333333333",
      kind: "delta",
      version_id: VERSION_ID,
      line_id: null,
      compare_version_id: COMPARE_VERSION_ID,
      summary_short: "Delta explique.",
      summary_detail: null,
      confidence_label: "medium",
      confidence_score: 0.66,
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
        delta_ht_cents: 5600,
        delta_ttc_cents: 6720,
        top_drivers: ["Lot beton: +56,00 EUR HT"],
      },
    });

    const response = await GET(
      new Request(
        `http://localhost/api/estimates/${VERSION_ID}/delta-explanation?compare_version_id=${COMPARE_VERSION_ID}`
      ),
      {
        params: Promise.resolve({
          versionId: VERSION_ID,
        }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(vi.mocked(getEstimateDeltaExplanation)).toHaveBeenCalledWith({
      versionId: VERSION_ID,
      compareVersionId: COMPARE_VERSION_ID,
      includeDetail: false,
    });
    expect(payload.ok).toBe(true);
    expect(payload.data.explanation.kind).toBe("delta");
  });

  it("maps estimate errors to the standard envelope", async () => {
    vi.mocked(getEstimateDeltaExplanation).mockRejectedValue(
      badRequest("Version de comparaison invalide.")
    );

    const response = await GET(
      new Request(
        `http://localhost/api/estimates/${VERSION_ID}/delta-explanation?compare_version_id=${COMPARE_VERSION_ID}`
      ),
      {
        params: Promise.resolve({
          versionId: VERSION_ID,
        }),
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.error?.message).toBe("Version de comparaison invalide.");
  });
});
