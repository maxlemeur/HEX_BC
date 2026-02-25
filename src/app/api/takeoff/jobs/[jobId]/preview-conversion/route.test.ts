import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/server", () => ({
  previewTakeoffJobConversion: vi.fn(),
}));

import { POST } from "@/app/api/takeoff/jobs/[jobId]/preview-conversion/route";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { previewTakeoffJobConversion } from "@/lib/takeoff/server";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const SECTION_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";

const PREVIEW_PAYLOAD = {
  strategy: "merge" as const,
  target_section_id: SECTION_ID,
  overrides: [
    {
      item_id: ITEM_ID,
      action: "set_price" as const,
      action_params: {
        unit_price_cents: 990,
      },
    },
  ],
};

const PREVIEW_RESPONSE = {
  job_id: JOB_ID,
  strategy: "merge" as const,
  target_section_id: SECTION_ID,
  summary: {
    total_count: 1,
    included_count: 1,
    transformed_count: 1,
    overridden_count: 1,
    excluded_by_mapping_count: 0,
    assembly_insertions_count: 0,
  },
  items: [
    {
      item_id: ITEM_ID,
      source_order: 0,
      rule_id: null,
      rule_name: null,
      action: "set_price" as const,
      action_params: {
        unit_price_cents: 990,
      },
      applied_by: "override" as const,
      original: {
        designation: "Tube PVC",
        quantity: 12,
        unit: "ml",
        is_excluded: false,
        category_id: null,
        unit_price_cents: null,
        assembly_id: null,
      },
      transformed: {
        designation: "Tube PVC",
        quantity: 12,
        unit: "ml",
        is_excluded: false,
        category_id: null,
        unit_price_cents: 990,
        assembly_id: null,
      },
    },
  ],
};

function buildPostRequest(jobId = JOB_ID, payload: unknown = PREVIEW_PAYLOAD) {
  return [
    new Request(
      `http://localhost/api/takeoff/jobs/${jobId}/preview-conversion`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    ),
    {
      params: Promise.resolve({ jobId }),
    },
  ] as const;
}

describe("POST /api/takeoff/jobs/[jobId]/preview-conversion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 and forwards payload to server helper", async () => {
    vi.mocked(previewTakeoffJobConversion).mockResolvedValue(PREVIEW_RESPONSE);
    const [request, context] = buildPostRequest();

    const response = await POST(request, context);
    const body = (await response.json()) as {
      ok: boolean;
      data?: typeof PREVIEW_RESPONSE;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(PREVIEW_RESPONSE);
    expect(vi.mocked(previewTakeoffJobConversion)).toHaveBeenCalledWith(
      JOB_ID,
      PREVIEW_PAYLOAD
    );
  });

  it("maps TakeoffError to takeoff envelope", async () => {
    vi.mocked(previewTakeoffJobConversion).mockRejectedValue(
      new TakeoffError({
        status: 422,
        code: TakeoffErrorCode.VALIDATION_ERROR,
        message: "Payload de preview invalide.",
        retryable: false,
        jobId: JOB_ID,
      })
    );
    const [request, context] = buildPostRequest();

    const response = await POST(request, context);
    const body = (await response.json()) as {
      ok: boolean;
      error?: {
        code?: string;
        message?: string;
      };
    };

    expect(response.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
    expect(body.error?.message).toBe("Payload de preview invalide.");
  });
});
