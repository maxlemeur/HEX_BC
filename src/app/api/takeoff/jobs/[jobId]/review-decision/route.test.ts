import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/server", () => ({
  saveTakeoffReviewDecision: vi.fn(),
}));

import { PATCH } from "@/app/api/takeoff/jobs/[jobId]/review-decision/route";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { saveTakeoffReviewDecision } from "@/lib/takeoff/server";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const ESTIMATE_ITEM_ID = "33333333-3333-4333-8333-333333333333";

function buildPatchRequest(body: unknown) {
  return [
    new Request(`http://localhost/api/takeoff/jobs/${JOB_ID}/review-decision`, {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      params: Promise.resolve({ jobId: JOB_ID }),
    },
  ] as const;
}

describe("PATCH /api/takeoff/jobs/[jobId]/review-decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards the payload to the server service", async () => {
    const payload = {
      version_id: VERSION_ID,
      estimate_item_id: ESTIMATE_ITEM_ID,
      decision: "manual_fix",
      reason: "Verifier la zone de reserve.",
    } as const;

    vi.mocked(saveTakeoffReviewDecision).mockResolvedValue({
      decision: {
        id: "44444444-4444-4444-8444-444444444444",
        tenant_id: "55555555-5555-4555-8555-555555555555",
        version_id: VERSION_ID,
        takeoff_job_id: JOB_ID,
        estimate_item_id: ESTIMATE_ITEM_ID,
        decision: "manual_fix",
        reason: payload.reason,
        review_reference: "dpgf-xlsx-row-12",
        line_label: "Faux plafond acoustique",
        line_position: 1,
        source_file_name: "dpgf.xlsx",
        source_page: 12,
        decided_at: "2026-03-06T10:00:00.000Z",
        updated_at: "2026-03-06T10:00:00.000Z",
        decided_by: null,
        source: "current_version",
        carried_over_from_version_id: null,
        carried_over_from_version_number: null,
      },
    });

    const [request, context] = buildPatchRequest(payload);
    const response = await PATCH(request, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(saveTakeoffReviewDecision).toHaveBeenCalledWith(JOB_ID, payload);
    expect(body.ok).toBe(true);
  });

  it("maps takeoff errors to the standard envelope", async () => {
    vi.mocked(saveTakeoffReviewDecision).mockRejectedValue(
      new TakeoffError({
        status: 409,
        code: TakeoffErrorCode.CONFLICT,
        message: "La ligne DPGF n'appartient pas a la version cible.",
        retryable: false,
        jobId: JOB_ID,
      })
    );

    const [request, context] = buildPatchRequest({
      version_id: VERSION_ID,
      estimate_item_id: ESTIMATE_ITEM_ID,
      decision: "keep_dpgf",
      reason: null,
    });

    const response = await PATCH(request, context);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("CONFLICT");
    expect(body.error?.message).toBe(
      "La ligne DPGF n'appartient pas a la version cible."
    );
  });
});
