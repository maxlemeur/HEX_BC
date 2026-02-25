import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/server", () => ({
  applyTakeoffJob: vi.fn(),
}));

import { POST } from "@/app/api/takeoff/jobs/[jobId]/apply/route";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { applyTakeoffJob } from "@/lib/takeoff/server";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";
const SECTION_ID = "33333333-3333-4333-8333-333333333333";

const JOB_SUMMARY = {
  id: JOB_ID,
  estimate_version_id: VERSION_ID,
  status: "applied",
  level: "A",
  source_file_name: "niveau-a.csv",
  source_file_type: "text/csv",
  source_file_size_bytes: 2048,
  prompt_version: "takeoff-a-v1",
  schema_version: "v1",
  model: "gemini-2.5-flash",
  thinking_level: "high",
  media_resolution: null,
  retry_count: 0,
  error_code: null,
  error_message: null,
  next_retry_at: null,
  last_error_at: null,
  started_at: "2026-02-25T12:00:00.000Z",
  completed_at: "2026-02-25T12:00:05.000Z",
  created_at: "2026-02-25T11:59:00.000Z",
  updated_at: "2026-02-25T12:00:05.000Z",
  metrics: {
    token_count: 120,
    cost_cents: 4,
    duration_ms: 5000,
  },
};

const APPLY_PAYLOAD = {
  strategy: "merge" as const,
  target_section_id: SECTION_ID,
};

const APPLY_RESPONSE = {
  job: JOB_SUMMARY,
  summary: {
    scope: "section" as const,
    created_count: 1,
    updated_count: 0,
    ignored_count: 0,
    created_ids: [
      "55555555-5555-4555-8555-555555555555",
    ],
  },
};

function buildPostRequest(jobId = JOB_ID, payload: unknown = APPLY_PAYLOAD) {
  return [
    new Request(`http://localhost/api/takeoff/jobs/${jobId}/apply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }),
    {
      params: Promise.resolve({ jobId }),
    },
  ] as const;
}

describe("POST /api/takeoff/jobs/[jobId]/apply", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 and forwards payload to server helper", async () => {
    vi.mocked(applyTakeoffJob).mockResolvedValue(APPLY_RESPONSE);
    const [request, context] = buildPostRequest();

    const response = await POST(request, context);
    const body = (await response.json()) as {
      ok: boolean;
      data?: typeof APPLY_RESPONSE;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(APPLY_RESPONSE);
    expect(vi.mocked(applyTakeoffJob)).toHaveBeenCalledWith(JOB_ID, APPLY_PAYLOAD);
  });

  it("maps TakeoffError conflicts to the standard takeoff envelope", async () => {
    vi.mocked(applyTakeoffJob).mockRejectedValue(
      new TakeoffError({
        status: 409,
        code: TakeoffErrorCode.CONFLICT,
        message: "Conflit d'application.",
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
    expect(body.error?.message).toBe("Conflit d'application.");
  });
});
