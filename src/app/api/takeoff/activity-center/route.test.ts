import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/activity-center", () => ({
  listActivityCenterJobs: vi.fn(),
}));

import { GET } from "@/app/api/takeoff/activity-center/route";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { listActivityCenterJobs } from "@/lib/takeoff/activity-center";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

const ACTIVITY_CENTER_RESPONSE = {
  counters: {
    technicalJobs: 2,
    usableJobs: 5,
    blockingExceptionsJobs: 1,
  },
  jobs: [
    {
      jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      estimateVersionId: "22222222-2222-4222-8222-222222222222",
      versionLabel: "V1",
      lotLabel: null,
      planSetLabel: null,
      levelLabel: "Rapide" as const,
      statusLabel: "Analyse terminee",
      statusRaw: "completed",
      itemCount: 42,
      coveragePercent: 85,
      exceptionCount: 3,
      confidenceLabel: "Elevee" as const,
      appliedCount: 0,
      createdAt: "2026-03-01T10:00:00.000Z",
      carriedOverFrom: null,
      neverApplied: true,
      retryCount: 0,
    },
  ],
  pagination: { limit: 20, offset: 0, total: 1 },
};

function buildGetRequest(url: string) {
  return new Request(url, { method: "GET" });
}

describe("GET /api/takeoff/activity-center", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 200 with correct shape when project_id provided", async () => {
    vi.mocked(listActivityCenterJobs).mockResolvedValue(ACTIVITY_CENTER_RESPONSE);

    const request = buildGetRequest(
      `http://localhost/api/takeoff/activity-center?project_id=${PROJECT_ID}`
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.counters.technicalJobs).toBe(2);
    expect(body.data.counters.usableJobs).toBe(5);
    expect(body.data.counters.blockingExceptionsJobs).toBe(1);
    expect(body.data.jobs).toHaveLength(1);
    expect(body.data.jobs[0].levelLabel).toBe("Rapide");
    expect(body.data.jobs[0].statusLabel).toBe("Analyse terminee");
    expect(body.data.pagination.total).toBe(1);
  });

  it("returns 400 when project_id missing", async () => {
    const request = buildGetRequest(
      "http://localhost/api/takeoff/activity-center"
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("BAD_REQUEST");
  });

  it("passes filter params through to listActivityCenterJobs", async () => {
    vi.mocked(listActivityCenterJobs).mockResolvedValue({
      ...ACTIVITY_CENTER_RESPONSE,
      jobs: [],
      pagination: { limit: 50, offset: 0, total: 0 },
    });

    const request = buildGetRequest(
      `http://localhost/api/takeoff/activity-center?project_id=${PROJECT_ID}&versionId=v1&lot=CVC&planSetId=set-1&status=completed&level=A&period=7d&limit=50&offset=10`
    );
    await GET(request);

    expect(listActivityCenterJobs).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: PROJECT_ID,
        versionId: "v1",
        lot: "CVC",
        planSetId: "set-1",
        status: "completed",
        level: "A",
        period: "7d",
        limit: 50,
        offset: 10,
      })
    );
  });

  it("returns mapped error on TakeoffError", async () => {
    vi.mocked(listActivityCenterJobs).mockRejectedValue(
      new TakeoffError({
        status: 403,
        code: TakeoffErrorCode.FORBIDDEN,
        message: "Acces refuse.",
        retryable: false,
      })
    );

    const request = buildGetRequest(
      `http://localhost/api/takeoff/activity-center?project_id=${PROJECT_ID}`
    );
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(body.error.message).toBe("Acces refuse.");
  });

  it("job rows contain business labels", async () => {
    vi.mocked(listActivityCenterJobs).mockResolvedValue(ACTIVITY_CENTER_RESPONSE);

    const request = buildGetRequest(
      `http://localhost/api/takeoff/activity-center?project_id=${PROJECT_ID}`
    );
    const response = await GET(request);
    const body = await response.json();

    const job = body.data.jobs[0];
    expect(job.levelLabel).toBe("Rapide");
    expect(job.statusLabel).toBe("Analyse terminee");
    expect(job.confidenceLabel).toBe("Elevee");
    expect(job.neverApplied).toBe(true);
  });
});
