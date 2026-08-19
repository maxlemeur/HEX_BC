import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/server", () => ({
  cancelTakeoffJob: vi.fn(),
}));

import { POST } from "@/app/api/takeoff/jobs/[jobId]/cancel/route";
import * as estimateErrors from "@/lib/estimates/errors";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { cancelTakeoffJob } from "@/lib/takeoff/server";

const JOB_ID = "11111111-1111-4111-8111-111111111111";

const CANCEL_RESPONSE = {
  job: {
    id: JOB_ID,
    status: "canceled",
  },
  command: "cancel" as const,
  outcome: "applied" as const,
};

function buildPostRequest(jobId = JOB_ID) {
  return [
    new Request(`http://localhost/api/takeoff/jobs/${jobId}/cancel`, {
      method: "POST",
    }),
    {
      params: Promise.resolve({ jobId }),
    },
  ] as const;
}

describe("POST /api/takeoff/jobs/[jobId]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cancels the job id from the route params", async () => {
    vi.mocked(cancelTakeoffJob).mockResolvedValue(CANCEL_RESPONSE as never);
    const [request, context] = buildPostRequest();

    const response = await POST(request, context);
    const body = (await response.json()) as {
      ok: boolean;
      data?: typeof CANCEL_RESPONSE;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(CANCEL_RESPONSE);
    expect(vi.mocked(cancelTakeoffJob)).toHaveBeenCalledWith(JOB_ID);
  });

  it("maps TakeoffError to the takeoff error envelope", async () => {
    vi.mocked(cancelTakeoffJob).mockRejectedValue(
      new TakeoffError({
        status: 409,
        code: TakeoffErrorCode.TAKEOFF_JOB_NOT_CANCELABLE,
        message: "Le job n'est plus dans un statut annulable.",
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
        retryable?: boolean;
        jobId?: string;
      };
    };

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toEqual(
      expect.objectContaining({
        code: TakeoffErrorCode.TAKEOFF_JOB_NOT_CANCELABLE,
        message: "Le job n'est plus dans un statut annulable.",
        retryable: false,
        jobId: JOB_ID,
      })
    );
  });

  it("maps generic errors through toErrorResponse", async () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const toErrorResponseSpy = vi.spyOn(estimateErrors, "toErrorResponse");
    vi.mocked(cancelTakeoffJob).mockRejectedValue(new Error("db down"));
    const [request, context] = buildPostRequest();

    const response = await POST(request, context);
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(toErrorResponseSpy).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(500);
    expect(body).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: "INTERNAL_ERROR",
      }),
    });

    consoleErrorSpy.mockRestore();
    toErrorResponseSpy.mockRestore();
  });
});
