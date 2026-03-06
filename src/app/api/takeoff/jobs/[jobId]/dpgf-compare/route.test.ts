import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/server", () => ({
  fetchDpgfTakeoffComparison: vi.fn(),
  fetchTakeoffRiskRadar: vi.fn(),
  parseTakeoffDpgfComparisonQuery: vi.fn(),
}));

import { GET } from "@/app/api/takeoff/jobs/[jobId]/dpgf-compare/route";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import {
  fetchDpgfTakeoffComparison,
  fetchTakeoffRiskRadar,
  parseTakeoffDpgfComparisonQuery,
} from "@/lib/takeoff/server";

const JOB_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "22222222-2222-4222-8222-222222222222";

const COMPARE_RESPONSE = {
  version_id: VERSION_ID,
  job_id: JOB_ID,
  view: "all" as const,
  threshold: 0.6,
  summary: {
    reliable_matches: 10,
    to_confirm: 2,
    significant_gaps: 1,
    forced_manual: 3,
    lines_without_proof: 1,
    unused_takeoff_items: 4,
    total_lines: 16,
  },
  rows: [],
  manual_link_candidates: [],
  unused_takeoff_items: [],
  pagination: {
    page_size: 50,
    next_cursor: null,
    total: 16,
  },
};

const RADAR_RESPONSE = {
  version_id: VERSION_ID,
  job_id: JOB_ID,
  summary: {
    to_process_count: 1,
    assumed_count: 0,
    false_positive_count: 0,
    critical_count: 0,
    warning_count: 1,
    info_count: 0,
    top_causes: ["Preuve absente"],
    project_score: 40,
    project_severity: "warning" as const,
  },
  project: {
    scope_type: "project" as const,
    scope_id: "33333333-3333-4333-8333-333333333333",
    scope_label: "College Jules Ferry",
    score: 40,
    severity: "warning" as const,
    open_alerts_count: 1,
    critical_alerts_count: 0,
    top_causes: ["Preuve absente"],
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

describe("GET /api/takeoff/jobs/[jobId]/dpgf-compare", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses query and returns the DPGF comparison payload", async () => {
    const parsedQuery = {
      version_id: VERSION_ID,
      threshold: 0.6,
      cursor: "opaque",
      page_size: 25,
      view: "exceptions_only" as const,
    };

    vi.mocked(parseTakeoffDpgfComparisonQuery).mockReturnValue(parsedQuery);
    vi.mocked(fetchDpgfTakeoffComparison).mockResolvedValue(COMPARE_RESPONSE);
    vi.mocked(fetchTakeoffRiskRadar).mockResolvedValue(RADAR_RESPONSE);

    const [request, context] = buildGetRequest(
      `http://localhost/api/takeoff/jobs/${JOB_ID}/dpgf-compare?version_id=${VERSION_ID}&threshold=0.6&cursor=opaque&page_size=25&view=exceptions_only`
    );

    const response = await GET(request, context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(parseTakeoffDpgfComparisonQuery).toHaveBeenCalledWith({
      version_id: VERSION_ID,
      threshold: "0.6",
      cursor: "opaque",
      page_size: "25",
      view: "exceptions_only",
    });
    expect(fetchDpgfTakeoffComparison).toHaveBeenCalledWith(JOB_ID, parsedQuery);
    expect(fetchTakeoffRiskRadar).toHaveBeenCalledWith(JOB_ID, {
      version_id: VERSION_ID,
    });
    expect(body).toEqual({
      ok: true,
      data: COMPARE_RESPONSE,
    });
  });

  it("maps takeoff errors to the standard envelope", async () => {
    vi.mocked(parseTakeoffDpgfComparisonQuery).mockReturnValue({
      version_id: VERSION_ID,
      view: "all" as const,
    });
    vi.mocked(fetchTakeoffRiskRadar).mockResolvedValue(RADAR_RESPONSE);
    vi.mocked(fetchDpgfTakeoffComparison).mockRejectedValue(
      new TakeoffError({
        status: 409,
        code: TakeoffErrorCode.CONFLICT,
        message: "Version incompatible.",
        retryable: false,
        jobId: JOB_ID,
      })
    );

    const [request, context] = buildGetRequest(
      `http://localhost/api/takeoff/jobs/${JOB_ID}/dpgf-compare?version_id=${VERSION_ID}`
    );

    const response = await GET(request, context);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("CONFLICT");
    expect(body.error?.message).toBe("Version incompatible.");
  });
});
