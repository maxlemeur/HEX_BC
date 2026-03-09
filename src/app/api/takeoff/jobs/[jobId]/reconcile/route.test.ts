import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/server", () => ({
  reconcileTakeoffJobNow: vi.fn(),
}));

vi.mock("@/lib/takeoff/edge-trigger", () => ({
  triggerTakeoffJobProcessing: vi.fn().mockResolvedValue({
    triggered: true,
    correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    statusCode: 202,
  }),
}));

import { POST } from "@/app/api/takeoff/jobs/[jobId]/reconcile/route";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { reconcileTakeoffJobNow } from "@/lib/takeoff/server";

const JOB_ID = "11111111-1111-4111-8111-111111111111";

const RECONCILE_RESPONSE = {
  job: {
    id: JOB_ID,
    status: "processing",
    retry_count: 1,
  },
  command: "reconcile",
  outcome: "applied",
};

function buildPostRequest(jobId = JOB_ID) {
  return [
    new Request(`http://localhost/api/takeoff/jobs/${jobId}/reconcile`, {
      method: "POST",
    }),
    {
      params: Promise.resolve({ jobId }),
    },
  ] as const;
}

describe("POST /api/takeoff/jobs/[jobId]/reconcile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(triggerTakeoffJobProcessing).mockResolvedValue({
      triggered: true,
      correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      statusCode: 202,
    });
  });

  it("reconciles the job and triggers the reconcile worker", async () => {
    vi.mocked(reconcileTakeoffJobNow).mockResolvedValue(
      RECONCILE_RESPONSE as never
    );
    const [request, context] = buildPostRequest();

    const response = await POST(request, context);
    const body = (await response.json()) as {
      ok: boolean;
      data?: typeof RECONCILE_RESPONSE;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(RECONCILE_RESPONSE);
    expect(vi.mocked(reconcileTakeoffJobNow)).toHaveBeenCalledWith(JOB_ID);
    expect(vi.mocked(triggerTakeoffJobProcessing)).toHaveBeenCalledWith({
      jobId: JOB_ID,
      trigger: "reconcile",
    });
  });

  it("does not trigger the worker on a noop reconcile", async () => {
    vi.mocked(reconcileTakeoffJobNow).mockResolvedValue({
      ...RECONCILE_RESPONSE,
      outcome: "noop",
    } as never);
    const [request, context] = buildPostRequest();

    const response = await POST(request, context);

    expect(response.status).toBe(200);
    expect(vi.mocked(triggerTakeoffJobProcessing)).not.toHaveBeenCalled();
  });

  it("maps TakeoffError to the standard takeoff envelope", async () => {
    vi.mocked(reconcileTakeoffJobNow).mockRejectedValue(
      new TakeoffError({
        status: 409,
        code: TakeoffErrorCode.CONFLICT,
        message: "Le provider est deja dans un etat terminal pour ce job.",
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
    expect(body.error?.message).toBe(
      "Le provider est deja dans un etat terminal pour ce job."
    );
    expect(vi.mocked(triggerTakeoffJobProcessing)).not.toHaveBeenCalled();
  });

  it("returns 503 when the reconcile worker trigger is not queued", async () => {
    vi.mocked(reconcileTakeoffJobNow).mockResolvedValue(
      RECONCILE_RESPONSE as never
    );
    vi.mocked(triggerTakeoffJobProcessing).mockResolvedValue({
      triggered: false,
      correlationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      statusCode: 503,
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
