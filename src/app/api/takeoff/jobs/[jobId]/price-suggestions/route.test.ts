import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/server", () => ({
  getTakeoffPriceSuggestion: vi.fn(),
  parseTakeoffPriceSuggestionQuery: vi.fn(),
  requestTakeoffPriceSuggestion: vi.fn(),
}));

import {
  GET,
  POST,
} from "@/app/api/takeoff/jobs/[jobId]/price-suggestions/route";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import {
  getTakeoffPriceSuggestion,
  parseTakeoffPriceSuggestionQuery,
  requestTakeoffPriceSuggestion,
} from "@/lib/takeoff/server";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const ESTIMATE_ITEM_ID = "33333333-3333-4333-8333-333333333333";

describe("GET/POST /api/takeoff/jobs/[jobId]/price-suggestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses the GET query and forwards it to the server service", async () => {
    const parsedQuery = {
      version_id: VERSION_ID,
      estimate_item_id: ESTIMATE_ITEM_ID,
    };

    vi.mocked(parseTakeoffPriceSuggestionQuery).mockReturnValue(parsedQuery);
    vi.mocked(getTakeoffPriceSuggestion).mockResolvedValue({
      suggestion: {
        suggestion_id: "44444444-4444-4444-8444-444444444444",
        line_id: ESTIMATE_ITEM_ID,
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
        status: "pending",
        selected_action: null,
        selected_price_cents: null,
        review_note: null,
        reviewed_at: null,
        reviewed_by: null,
        created_at: "2026-03-06T10:00:00.000Z",
        updated_at: "2026-03-06T10:00:00.000Z",
        sources: [],
      },
    });

    const response = await GET(
      new Request(
        `http://localhost/api/takeoff/jobs/${JOB_ID}/price-suggestions?version_id=${VERSION_ID}&estimate_item_id=${ESTIMATE_ITEM_ID}`
      ),
      {
        params: Promise.resolve({ jobId: JOB_ID }),
      }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(parseTakeoffPriceSuggestionQuery).toHaveBeenCalledWith({
      version_id: VERSION_ID,
      estimate_item_id: ESTIMATE_ITEM_ID,
    });
    expect(getTakeoffPriceSuggestion).toHaveBeenCalledWith(JOB_ID, parsedQuery);
    expect(body.ok).toBe(true);
  });

  it("forwards POST payload to the server service", async () => {
    const payload = {
      version_id: VERSION_ID,
      estimate_item_id: ESTIMATE_ITEM_ID,
      force_refresh: true,
    };

    vi.mocked(requestTakeoffPriceSuggestion).mockResolvedValue({
      suggestion: {
        suggestion_id: "44444444-4444-4444-8444-444444444444",
        line_id: ESTIMATE_ITEM_ID,
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
        status: "pending",
        selected_action: null,
        selected_price_cents: null,
        review_note: null,
        reviewed_at: null,
        reviewed_by: null,
        created_at: "2026-03-06T10:00:00.000Z",
        updated_at: "2026-03-06T10:00:00.000Z",
        sources: [],
      },
    });

    const response = await POST(
      new Request(`http://localhost/api/takeoff/jobs/${JOB_ID}/price-suggestions`, {
        method: "POST",
        body: JSON.stringify(payload),
        headers: {
          "content-type": "application/json",
        },
      }),
      {
        params: Promise.resolve({ jobId: JOB_ID }),
      }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(requestTakeoffPriceSuggestion).toHaveBeenCalledWith(JOB_ID, payload);
    expect(body.ok).toBe(true);
  });

  it("maps takeoff errors to the standard envelope", async () => {
    vi.mocked(parseTakeoffPriceSuggestionQuery).mockReturnValue({
      version_id: VERSION_ID,
      estimate_item_id: ESTIMATE_ITEM_ID,
    });
    vi.mocked(getTakeoffPriceSuggestion).mockRejectedValue(
      new TakeoffError({
        status: 404,
        code: TakeoffErrorCode.NOT_FOUND,
        message: "Aucune suggestion de prix active pour cette ligne.",
        retryable: false,
        jobId: JOB_ID,
      })
    );

    const response = await GET(
      new Request(
        `http://localhost/api/takeoff/jobs/${JOB_ID}/price-suggestions?version_id=${VERSION_ID}&estimate_item_id=${ESTIMATE_ITEM_ID}`
      ),
      {
        params: Promise.resolve({ jobId: JOB_ID }),
      }
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("NOT_FOUND");
  });
});
