import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/server", () => ({
  resubmitTakeoffJob: vi.fn(),
}));

vi.mock("@/lib/takeoff/edge-trigger", () => ({
  triggerTakeoffJobProcessing: vi.fn().mockResolvedValue({
    triggered: true,
    correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    statusCode: 202,
  }),
}));

import { POST } from "@/app/api/takeoff/jobs/[jobId]/resubmit/route";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { resubmitTakeoffJob } from "@/lib/takeoff/server";

const JOB_ID = "11111111-1111-4111-8111-111111111111";

const RESUBMIT_RESPONSE = {
  job: {
    id: JOB_ID,
    status: "pending",
    retry_count: 2,
  },
  command: "resubmit",
  outcome: "applied",
};

function buildPostRequest(jobId = JOB_ID) {
  return [
    new Request(`http://localhost/api/takeoff/jobs/${jobId}/resubmit`, {
      method: "POST",
    }),
    {
      params: Promise.resolve({ jobId }),
    },
  ] as const;
}

describe("POST /api/takeoff/jobs/[jobId]/resubmit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(triggerTakeoffJobProcessing).mockResolvedValue({
      triggered: true,
      correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      statusCode: 202,
    });
  });

  it("resubmits the job and retriggers async processing", async () => {
    vi.mocked(resubmitTakeoffJob).mockResolvedValue(RESUBMIT_RESPONSE as never);
    const [request, context] = buildPostRequest();

    const response = await POST(request, context);
    const body = (await response.json()) as {
      ok: boolean;
      data?: typeof RESUBMIT_RESPONSE;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(RESUBMIT_RESPONSE);
    expect(vi.mocked(resubmitTakeoffJob)).toHaveBeenCalledWith(JOB_ID);
    expect(vi.mocked(triggerTakeoffJobProcessing)).toHaveBeenCalledWith({
      jobId: JOB_ID,
      trigger: "retry",
    });
  });

  it("maps TakeoffError to the standard takeoff envelope", async () => {
    vi.mocked(resubmitTakeoffJob).mockRejectedValue(
      new TakeoffError({
        status: 403,
        code: TakeoffErrorCode.FORBIDDEN,
        message: "Acces refuse.",
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

    expect(response.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("FORBIDDEN");
    expect(body.error?.message).toBe("Acces refuse.");
    expect(vi.mocked(triggerTakeoffJobProcessing)).not.toHaveBeenCalled();
  });

  it("returns 503 when the async worker trigger is not queued", async () => {
    vi.mocked(resubmitTakeoffJob).mockResolvedValue(RESUBMIT_RESPONSE as never);
    vi.mocked(triggerTakeoffJobProcessing).mockResolvedValue({
      triggered: false,
      correlationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      statusCode: 504,
    });
    const [request, context] = buildPostRequest();

    const response = await POST(request, context);
    const body = (await response.json()) as {
      ok: boolean;
      error?: {
        code?: string;
        message?: string;
        retryable?: boolean;
      };
    };

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe(TakeoffErrorCode.INTERNAL_ERROR);
    expect(body.error?.message).toBe(
      "Le worker async takeoff n'a pas pu etre declenche."
    );
    expect(body.error?.retryable).toBe(true);
  });
});
