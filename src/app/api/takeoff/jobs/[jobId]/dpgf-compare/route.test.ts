import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/takeoff/server", () => ({
  fetchTakeoffActiveRiskAlerts: vi.fn(),
  fetchDpgfTakeoffComparison: vi.fn(),
  parseTakeoffDpgfComparisonQuery: vi.fn(),
}));

import { GET } from "@/app/api/takeoff/jobs/[jobId]/dpgf-compare/route";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import {
  fetchTakeoffActiveRiskAlerts,
  fetchDpgfTakeoffComparison,
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
  rows: [
    {
      line_id: "line-1",
      line_label: "Doublage acoustique",
      dpgf: {
        estimate_item_id: "line-1",
        title: "Doublage acoustique",
        description: null,
        quantity: 10,
        unit: "m2",
        source_page: 1,
        source_file_name: "dpgf.xlsx",
        position: 1,
      },
      linked_takeoff_items: [],
      dpgf_quantity: 10,
      takeoff_quantity: 12,
      quantity_unit: "m2",
      matching_score: 0.8,
      confidence_score: 0.8,
      review_status: "significant_gap" as const,
      proofs: [],
      suggested_decision: "keep_dpgf" as const,
      applied_decision: null,
      delta_absolute: 2,
      delta_percent: 20,
      is_exception: true,
      manual_link_count: 0,
      matched_by: null,
      risk: null,
    },
  ],
  manual_link_candidates: [],
  unused_takeoff_items: [],
  pagination: {
    page_size: 50,
    next_cursor: null,
    total: 16,
  },
};

const ACTIVE_ALERTS_RESPONSE = [
  {
    alert_id: "alert-1",
    scope_type: "line" as const,
    scope_id: "line-1",
    scope_label: "Doublage acoustique",
    line_id: "line-1",
    lot_id: null,
    cause_code: "missing_proof" as const,
    cause_label: "Preuve absente",
    severity: "warning" as const,
    risk_score: 40,
    status: "to_process" as const,
    margin_bucket: "unknown" as const,
    reason_labels: ["Aucune preuve active"],
    provenance: [],
    review_note: null,
    reviewed_at: null,
    reviewed_by: null,
    created_at: "2026-03-06T10:00:00.000Z",
    updated_at: "2026-03-06T10:00:00.000Z",
    metadata: {},
  },
];

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
    vi.mocked(fetchTakeoffActiveRiskAlerts).mockResolvedValue(ACTIVE_ALERTS_RESPONSE);

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
    expect(fetchTakeoffActiveRiskAlerts).toHaveBeenCalledWith(JOB_ID, {
      version_id: VERSION_ID,
    });
    expect(body).toEqual({
      ok: true,
      data: {
        ...COMPARE_RESPONSE,
        rows: [
          {
            ...COMPARE_RESPONSE.rows[0],
            risk: {
              severity: "warning",
              score: 40,
              causes: ["Aucune preuve active"],
              status: "to_process",
            },
          },
        ],
      },
    });
  });

  it("maps takeoff errors to the standard envelope", async () => {
    vi.mocked(parseTakeoffDpgfComparisonQuery).mockReturnValue({
      version_id: VERSION_ID,
      view: "all" as const,
    });
    vi.mocked(fetchTakeoffActiveRiskAlerts).mockResolvedValue(ACTIVE_ALERTS_RESPONSE);
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
