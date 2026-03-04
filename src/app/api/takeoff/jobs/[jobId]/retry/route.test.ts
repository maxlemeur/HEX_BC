import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/server", () => ({
  retryTakeoffJob: vi.fn(),
}));

vi.mock("@/lib/takeoff/edge-trigger", () => ({
  triggerTakeoffJobProcessing: vi.fn().mockResolvedValue({
    triggered: true,
    correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    statusCode: 202,
  }),
}));

import { POST } from "@/app/api/takeoff/jobs/[jobId]/retry/route";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { retryTakeoffJob } from "@/lib/takeoff/server";

const JOB_ID = "11111111-1111-4111-8111-111111111111";

const RETRY_RESPONSE = {
  job: {
    id: JOB_ID,
    status: "pending",
    retry_count: 2,
  },
};

function buildPostRequest(jobId = JOB_ID) {
  return [
    new Request(`http://localhost/api/takeoff/jobs/${jobId}/retry`, {
      method: "POST",
    }),
    {
      params: Promise.resolve({ jobId }),
    },
  ] as const;
}

describe("POST /api/takeoff/jobs/[jobId]/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(triggerTakeoffJobProcessing).mockResolvedValue({
      triggered: true,
      correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      statusCode: 202,
    });
  });

  it("returns 200, retries the job, and retriggers async processing", async () => {
    vi.mocked(retryTakeoffJob).mockResolvedValue(RETRY_RESPONSE as never);
    const [request, context] = buildPostRequest();

    const response = await POST(request, context);
    const body = (await response.json()) as {
      ok: boolean;
      data?: typeof RETRY_RESPONSE;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(RETRY_RESPONSE);
    expect(vi.mocked(retryTakeoffJob)).toHaveBeenCalledWith(JOB_ID);
    expect(vi.mocked(triggerTakeoffJobProcessing)).toHaveBeenCalledWith({
      jobId: JOB_ID,
      trigger: "retry",
    });
  });

  it("returns 200 even when retry trigger fails", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(retryTakeoffJob).mockResolvedValue(RETRY_RESPONSE as never);
    vi.mocked(triggerTakeoffJobProcessing).mockResolvedValue({
      triggered: false,
      correlationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      statusCode: null,
    });
    const [request, context] = buildPostRequest();

    const response = await POST(request, context);

    expect(response.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Takeoff retry accepted but async processing trigger failed.",
      {
        jobId: JOB_ID,
        correlationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      }
    );

    consoleErrorSpy.mockRestore();
  });

  it("maps TakeoffError to the standard takeoff envelope", async () => {
    vi.mocked(retryTakeoffJob).mockRejectedValue(
      new TakeoffError({
        status: 409,
        code: TakeoffErrorCode.CONFLICT,
        message: "Le job n'est plus dans un statut relancable.",
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

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("CONFLICT");
    expect(body.error?.message).toBe("Le job n'est plus dans un statut relancable.");
    expect(vi.mocked(triggerTakeoffJobProcessing)).not.toHaveBeenCalled();
  });
});
