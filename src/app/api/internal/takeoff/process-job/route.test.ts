import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/async-worker", () => ({
  processTakeoffJobAttempt: vi.fn(),
}));

vi.mock("@/lib/takeoff/dispatch-state", () => ({
  persistTakeoffDispatchOutcome: vi.fn().mockResolvedValue(true),
}));

import { POST } from "@/app/api/internal/takeoff/process-job/route";
import { processTakeoffJobAttempt } from "@/lib/takeoff/async-worker";
import { persistTakeoffDispatchOutcome } from "@/lib/takeoff/dispatch-state";

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
    expect(persistTakeoffDispatchOutcome).not.toHaveBeenCalled();
  });
});
