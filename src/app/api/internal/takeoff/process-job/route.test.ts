import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/async-worker", () => ({
  processTakeoffJobAttempt: vi.fn(),
}));

import { POST } from "@/app/api/internal/takeoff/process-job/route";
import { processTakeoffJobAttempt } from "@/lib/takeoff/async-worker";

const JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function buildRequest(input?: {
  secret?: string;
  body?: Record<string, unknown>;
  correlationId?: string;
}) {
  return new Request("http://localhost/api/internal/takeoff/process-job", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-takeoff-worker-secret": input?.secret ?? "test-worker-secret",
      ...(input?.correlationId
        ? {
            "x-correlation-id": input.correlationId,
          }
        : {}),
    },
    body: JSON.stringify(
      input?.body ?? {
        job_id: JOB_ID,
      }
    ),
  });
}

describe("POST /api/internal/takeoff/process-job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 202 for retryable outcomes", async () => {
    vi.mocked(processTakeoffJobAttempt).mockResolvedValue({
      job_id: JOB_ID,
      tenant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      level: "A",
      status: "failed_retryable",
      trigger: "retry",
      retry_count: 1,
      attempt: 2,
      retryable: true,
      should_retry: true,
      next_retry_in_seconds: 15,
      next_retry_at: "2026-02-25T11:00:15.000Z",
      duration_ms: 1200,
      error_code: "AI_TIMEOUT",
      error_message: "Timed out",
      correlation_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });

    const response = await POST(
      buildRequest({
        body: {
          job_id: JOB_ID,
          trigger: "retry",
        },
      })
    );

    expect(response.status).toBe(202);
    const payload = (await response.json()) as { ok: boolean; data: { status: string } };
    expect(payload.ok).toBe(true);
    expect(payload.data.status).toBe("failed_retryable");
    expect(processTakeoffJobAttempt).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        trigger: "retry",
      })
    );
  });

  it("returns 401 for invalid worker secret", async () => {
    const response = await POST(
      buildRequest({
        secret: "invalid-secret",
      })
    );

    expect(response.status).toBe(401);
    const payload = (await response.json()) as { ok: boolean; error?: { code?: string } };
    expect(payload.ok).toBe(false);
    expect(payload.error?.code).toBe("UNAUTHORIZED");
    expect(processTakeoffJobAttempt).not.toHaveBeenCalled();
  });

  it("uses correlation id from header when payload omits it", async () => {
    vi.mocked(processTakeoffJobAttempt).mockResolvedValue({
      job_id: JOB_ID,
      tenant_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      level: "A",
      status: "completed",
      trigger: "create",
      retry_count: 0,
      attempt: 1,
      retryable: false,
      should_retry: false,
      next_retry_in_seconds: null,
      next_retry_at: null,
      duration_ms: 900,
      error_code: null,
      error_message: null,
      correlation_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });

    const response = await POST(
      buildRequest({
        correlationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      })
    );

    expect(response.status).toBe(200);
    expect(processTakeoffJobAttempt).toHaveBeenCalledWith(
      JOB_ID,
      expect.objectContaining({
        correlationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      })
    );
  });
});
