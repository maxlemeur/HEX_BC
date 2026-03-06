import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/server", () => ({
  fetchTakeoffRiskRadar: vi.fn(),
  parseTakeoffRiskRadarQuery: vi.fn(),
}));

import { GET } from "@/app/api/takeoff/jobs/[jobId]/risk-radar/route";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import {
  fetchTakeoffRiskRadar,
  parseTakeoffRiskRadarQuery,
} from "@/lib/takeoff/server";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";

const RADAR_RESPONSE = {
  version_id: VERSION_ID,
  job_id: JOB_ID,
  summary: {
    to_process_count: 2,
    assumed_count: 1,
    false_positive_count: 0,
    critical_count: 1,
    warning_count: 2,
    info_count: 0,
    top_causes: ["Preuve absente", "Ecart DPGF / metre"],
    project_score: 75,
    project_severity: "critical" as const,
  },
  project: {
    scope_type: "project" as const,
    scope_id: "33333333-3333-4333-8333-333333333333",
    scope_label: "College Jules Ferry",
    score: 75,
    severity: "critical" as const,
    open_alerts_count: 2,
    critical_alerts_count: 1,
    top_causes: ["Preuve absente", "Ecart DPGF / metre"],
  },
  lots: [],
  items: [],
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

describe("GET /api/takeoff/jobs/[jobId]/risk-radar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses query and returns the risk radar payload", async () => {
    const parsedQuery = {
      version_id: VERSION_ID,
      severity: "critical" as const,
      status: "to_process" as const,
      scope: "line" as const,
    };

    vi.mocked(parseTakeoffRiskRadarQuery).mockReturnValue(parsedQuery);
    vi.mocked(fetchTakeoffRiskRadar).mockResolvedValue(RADAR_RESPONSE);

    const [request, context] = buildGetRequest(
      `http://localhost/api/takeoff/jobs/${JOB_ID}/risk-radar?version_id=${VERSION_ID}&severity=critical&status=to_process&scope=line`
    );

    const response = await GET(request, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(parseTakeoffRiskRadarQuery).toHaveBeenCalledWith({
      version_id: VERSION_ID,
      severity: "critical",
      status: "to_process",
      scope: "line",
    });
    expect(fetchTakeoffRiskRadar).toHaveBeenCalledWith(JOB_ID, parsedQuery);
    expect(body).toEqual({
      ok: true,
      data: RADAR_RESPONSE,
    });
  });

  it("maps takeoff errors to the standard envelope", async () => {
    vi.mocked(parseTakeoffRiskRadarQuery).mockReturnValue({
      version_id: VERSION_ID,
    });
    vi.mocked(fetchTakeoffRiskRadar).mockRejectedValue(
      new TakeoffError({
        status: 409,
        code: TakeoffErrorCode.CONFLICT,
        message: "Version incompatible.",
        retryable: false,
        jobId: JOB_ID,
      })
    );

    const [request, context] = buildGetRequest(
      `http://localhost/api/takeoff/jobs/${JOB_ID}/risk-radar?version_id=${VERSION_ID}`
    );

    const response = await GET(request, context);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("CONFLICT");
  });
});
