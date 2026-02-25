import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/server", () => ({
  compareTakeoffJobs: vi.fn(),
  parseCompareTakeoffJobsQuery: vi.fn(),
}));

import { GET } from "@/app/api/takeoff/jobs/[jobId]/compare/route";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import {
  compareTakeoffJobs,
  parseCompareTakeoffJobsQuery,
} from "@/lib/takeoff/server";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_JOB_ID = "22222222-2222-4222-8222-222222222222";

const COMPARE_RESPONSE = {
  base_job_id: JOB_ID,
  other_job_id: OTHER_JOB_ID,
  threshold: 0.8,
  summary: {
    added: 1,
    removed: 0,
    changed: 2,
    unchanged: 3,
    total_base: 5,
    total_other: 6,
  },
  added: [],
  removed: [],
  changed: [],
  unchanged: [],
};

function buildGetRequest(url: string) {
  return [
    new Request(url, {
      method: "GET",
    }),
    {
      params: Promise.resolve({ jobId: JOB_ID }),
    },
  ] as const;
}

describe("GET /api/takeoff/jobs/[jobId]/compare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses query and returns compare payload", async () => {
    const parsedQuery = {
      with: OTHER_JOB_ID,
      threshold: 0.8,
    };

    vi.mocked(parseCompareTakeoffJobsQuery).mockReturnValue(parsedQuery);
    vi.mocked(compareTakeoffJobs).mockResolvedValue(COMPARE_RESPONSE);

    const [request, context] = buildGetRequest(
      `http://localhost/api/takeoff/jobs/${JOB_ID}/compare?with=${OTHER_JOB_ID}&threshold=0.8`
    );

    const response = await GET(request, context);
    const body = (await response.json()) as {
      ok: boolean;
      data: typeof COMPARE_RESPONSE;
    };

    expect(response.status).toBe(200);
    expect(parseCompareTakeoffJobsQuery).toHaveBeenCalledWith({
      with: OTHER_JOB_ID,
      threshold: "0.8",
    });
    expect(compareTakeoffJobs).toHaveBeenCalledWith(JOB_ID, parsedQuery);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual(COMPARE_RESPONSE);
  });

  it("maps takeoff errors to standard envelope", async () => {
    vi.mocked(parseCompareTakeoffJobsQuery).mockReturnValue({
      with: OTHER_JOB_ID,
    });
    vi.mocked(compareTakeoffJobs).mockRejectedValue(
      new TakeoffError({
        status: 409,
        code: TakeoffErrorCode.CONFLICT,
        message: "Jobs non comparables.",
        retryable: false,
        jobId: JOB_ID,
      })
    );

    const [request, context] = buildGetRequest(
      `http://localhost/api/takeoff/jobs/${JOB_ID}/compare?with=${OTHER_JOB_ID}`
    );

    const response = await GET(request, context);
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
    expect(body.error?.message).toBe("Jobs non comparables.");
  });
});
