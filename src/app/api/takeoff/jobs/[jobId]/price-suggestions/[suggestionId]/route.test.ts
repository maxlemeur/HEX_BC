import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/server", () => ({
  reviewTakeoffPriceSuggestion: vi.fn(),
}));

import { PATCH } from "@/app/api/takeoff/jobs/[jobId]/price-suggestions/[suggestionId]/route";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { reviewTakeoffPriceSuggestion } from "@/lib/takeoff/server";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const SUGGESTION_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";

describe("PATCH /api/takeoff/jobs/[jobId]/price-suggestions/[suggestionId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the payload to the server service", async () => {
    const payload = {
      version_id: VERSION_ID,
      action: "apply_target",
      review_note: "Application explicite de la borne centrale.",
    } as const;

    vi.mocked(reviewTakeoffPriceSuggestion).mockResolvedValue({
      suggestion: {
        suggestion_id: SUGGESTION_ID,
        line_id: "44444444-4444-4444-8444-444444444444",
        version_id: VERSION_ID,
        job_id: JOB_ID,
        current_price_cents: 1200,
        low_cents: 1100,
        target_cents: 1250,
        high_cents: 1400,
        confidence_score: 0.72,
        confidence_label: "medium",
        candidate_count: 3,
        outlier_count: 1,
        justification: "Fourchette expliquee.",
        factors: [],
        summary: {},
        status: "applied",
        selected_action: "apply_target",
        selected_price_cents: 1250,
        review_note: payload.review_note,
        reviewed_at: "2026-03-06T10:00:00.000Z",
        reviewed_by: null,
        created_at: "2026-03-06T09:59:00.000Z",
        updated_at: "2026-03-06T10:00:00.000Z",
        sources: [],
      },
      applied_item: {
        id: "44444444-4444-4444-8444-444444444444",
        unit_price_ht_cents: 1250,
        updated_at: "2026-03-06T10:00:00.000Z",
      },
    });

    const response = await PATCH(
      new Request(
        `http://localhost/api/takeoff/jobs/${JOB_ID}/price-suggestions/${SUGGESTION_ID}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
          headers: {
            "content-type": "application/json",
          },
        }
      ),
      {
        params: Promise.resolve({
          jobId: JOB_ID,
          suggestionId: SUGGESTION_ID,
        }),
      }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(reviewTakeoffPriceSuggestion).toHaveBeenCalledWith(
      JOB_ID,
      SUGGESTION_ID,
      payload
    );
    expect(body.ok).toBe(true);
  });

  it("maps takeoff errors to the standard envelope", async () => {
    vi.mocked(reviewTakeoffPriceSuggestion).mockRejectedValue(
      new TakeoffError({
        status: 409,
        code: TakeoffErrorCode.CONFLICT,
        message: "La suggestion de prix cible a deja ete supersedee.",
        retryable: false,
        jobId: JOB_ID,
      })
    );

    const response = await PATCH(
      new Request(
        `http://localhost/api/takeoff/jobs/${JOB_ID}/price-suggestions/${SUGGESTION_ID}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            version_id: VERSION_ID,
            action: "reject",
            review_note: "Sources trop fragiles.",
          }),
          headers: {
            "content-type": "application/json",
          },
        }
      ),
      {
        params: Promise.resolve({
          jobId: JOB_ID,
          suggestionId: SUGGESTION_ID,
        }),
      }
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("CONFLICT");
  });
});
