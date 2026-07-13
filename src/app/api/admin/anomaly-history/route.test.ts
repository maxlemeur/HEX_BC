import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/server", () => ({
  getUserContext: vi.fn(),
  getSupabase: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/estimates/anomaly-history", () => ({
  getCurrentAnomalySummary: vi.fn(),
  getAnomalyTrend: vi.fn(),
}));

import { GET } from "@/app/api/admin/anomaly-history/route";
import { getUserContext } from "@/lib/auth/server";
import {
  getCurrentAnomalySummary,
  getAnomalyTrend,
} from "@/lib/estimates/anomaly-history";

const TENANT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const ADMIN_CONTEXT = {
  userEmail: "admin@test.com",
  profile: {
    id: "11111111-1111-4111-8111-111111111111",
    full_name: "Admin User",
    phone: null,
    job_title: null,
    work_email: null,
    role: "admin" as const,
    ui_mode: "expert" as const,
    tenant_id: TENANT_ID,
    tenant_role: "admin" as const,
  },
  tenantId: TENANT_ID,
};

const NON_ADMIN_CONTEXT = {
  userEmail: "user@test.com",
  profile: {
    id: "22222222-2222-4222-8222-222222222222",
    full_name: "Regular User",
    phone: null,
    job_title: null,
    work_email: null,
    role: "buyer" as const,
    ui_mode: "simplified" as const,
    tenant_id: TENANT_ID,
    tenant_role: "viewer" as const,
  },
  tenantId: TENANT_ID,
};

const EMPTY_SUMMARY_RESULT = {
  summary: {
    totalAnomalies: 0,
    blockingCount: 0,
    warningCount: 0,
    estimatesAffected: 0,
    estimatesTotal: 0,
  },
  currentAnomalies: [],
  ownerOptions: [],
};

const EMPTY_TREND_RESULT = {
  trend: [],
  avgResolution: [],
};

describe("/api/admin/anomaly-history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET returns aggregated anomaly data for admin", async () => {
    vi.mocked(getUserContext).mockResolvedValue(ADMIN_CONTEXT);
    vi.mocked(getCurrentAnomalySummary).mockResolvedValue(EMPTY_SUMMARY_RESULT);
    vi.mocked(getAnomalyTrend).mockResolvedValue(EMPTY_TREND_RESULT);

    const request = new Request("http://localhost/api/admin/anomaly-history");
    const response = await GET(request);
    const body = (await response.json()) as { ok: boolean; data: unknown };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data).toEqual({
      summary: EMPTY_SUMMARY_RESULT.summary,
      currentAnomalies: [],
      trend: [],
      avgResolution: [],
    });
  });

  it("returns 403 for non-admin users", async () => {
    vi.mocked(getUserContext).mockResolvedValue(NON_ADMIN_CONTEXT);

    const request = new Request("http://localhost/api/admin/anomaly-history");
    const response = await GET(request);
    const body = (await response.json()) as {
      ok: boolean;
      error: { code: string };
    };

    expect(response.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");
    expect(vi.mocked(getCurrentAnomalySummary)).not.toHaveBeenCalled();
    expect(vi.mocked(getAnomalyTrend)).not.toHaveBeenCalled();
  });

  it("returns 403 when no profile", async () => {
    vi.mocked(getUserContext).mockResolvedValue({
      userEmail: "",
      profile: null,
      tenantId: null,
    });

    const request = new Request("http://localhost/api/admin/anomaly-history");
    const response = await GET(request);

    expect(response.status).toBe(403);
  });

  it("forwards filter params correctly", async () => {
    vi.mocked(getUserContext).mockResolvedValue(ADMIN_CONTEXT);
    vi.mocked(getCurrentAnomalySummary).mockResolvedValue(EMPTY_SUMMARY_RESULT);
    vi.mocked(getAnomalyTrend).mockResolvedValue(EMPTY_TREND_RESULT);

    const request = new Request(
      "http://localhost/api/admin/anomaly-history?flag_types=missing_price,missing_quantity&owner_user_id=abc-123&search=project-a&date_from=2025-01-01&date_to=2025-12-31"
    );
    await GET(request);

    expect(vi.mocked(getCurrentAnomalySummary)).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      {
        flag_types: ["missing_price", "missing_quantity"],
        owner_user_id: "abc-123",
        search: "project-a",
        version_id: undefined,
      }
    );

    expect(vi.mocked(getAnomalyTrend)).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      {
        date_from: "2025-01-01",
        date_to: "2025-12-31",
      }
    );
  });

  it("returns a paginated current view without loading trends", async () => {
    vi.mocked(getUserContext).mockResolvedValue(ADMIN_CONTEXT);
    vi.mocked(getCurrentAnomalySummary).mockResolvedValue({
      ...EMPTY_SUMMARY_RESULT,
      ownerOptions: [{ id: "owner-1", name: "Camille Martin" }],
      currentAnomalies: Array.from({ length: 51 }, (_, index) => ({
        versionId: `version-${index}`,
        versionLabel: `V${index + 1}`,
        projectName: `Projet ${index + 1}`,
        ownerUserId: "owner-1",
        ownerName: "Camille Martin",
        flagKey: "missing_price" as const,
        flagLabel: "Prix manquant",
        severity: "blocking" as const,
        itemCount: 1,
      })),
    });

    const response = await GET(
      new Request(
        "http://localhost/api/admin/anomaly-history?view=current&page=2&size=25"
      )
    );
    const body = (await response.json()) as {
      data: {
        currentAnomalies: unknown[];
        ownerOptions: unknown[];
        pagination: Record<string, number>;
      };
    };

    expect(body.data.currentAnomalies).toHaveLength(25);
    expect(body.data.ownerOptions).toEqual([
      { id: "owner-1", name: "Camille Martin" },
    ]);
    expect(body.data.pagination).toEqual({
      page: 2,
      size: 25,
      totalItems: 51,
      totalPages: 3,
    });
    expect(vi.mocked(getAnomalyTrend)).not.toHaveBeenCalled();
  });

  it("caps the current view page size at 100", async () => {
    vi.mocked(getUserContext).mockResolvedValue(ADMIN_CONTEXT);
    vi.mocked(getCurrentAnomalySummary).mockResolvedValue(EMPTY_SUMMARY_RESULT);

    const response = await GET(
      new Request(
        "http://localhost/api/admin/anomaly-history?view=current&size=500"
      )
    );
    const body = (await response.json()) as {
      data: { pagination: { size: number } };
    };

    expect(body.data.pagination.size).toBe(100);
  });

  it("returns the trend view without loading current anomalies", async () => {
    vi.mocked(getUserContext).mockResolvedValue(ADMIN_CONTEXT);
    vi.mocked(getAnomalyTrend).mockResolvedValue(EMPTY_TREND_RESULT);

    const response = await GET(
      new Request(
        "http://localhost/api/admin/anomaly-history?view=trend&date_from=2025-01-01&date_to=2025-12-31"
      )
    );
    const body = (await response.json()) as { data: unknown };

    expect(body.data).toEqual(EMPTY_TREND_RESULT);
    expect(vi.mocked(getCurrentAnomalySummary)).not.toHaveBeenCalled();
    expect(vi.mocked(getAnomalyTrend)).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      { date_from: "2025-01-01", date_to: "2025-12-31" }
    );
  });

  it("returns text/csv when format=csv", async () => {
    vi.mocked(getUserContext).mockResolvedValue(ADMIN_CONTEXT);
    vi.mocked(getCurrentAnomalySummary).mockResolvedValue({
      summary: EMPTY_SUMMARY_RESULT.summary,
      currentAnomalies: [
        {
          versionId: "v1",
          versionLabel: "V1",
          projectName: "Projet A",
          ownerUserId: "u1",
          ownerName: "User One",
          flagKey: "missing_price" as const,
          flagLabel: "Prix manquant",
          severity: "blocking" as const,
          itemCount: 3,
        },
      ],
      ownerOptions: [{ id: "u1", name: "User One" }],
    });
    vi.mocked(getAnomalyTrend).mockRejectedValue(
      new Error("trend should not run for csv")
    );

    const request = new Request(
      "http://localhost/api/admin/anomaly-history?format=csv"
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");

    const text = await response.text();
    expect(text).toContain("Version ID");
    expect(text).toContain("Projet A");
    expect(text).toContain("Prix manquant");
    expect(vi.mocked(getAnomalyTrend)).not.toHaveBeenCalled();
  });

  it("escapes separators, quotes and newlines in CSV exports", async () => {
    vi.mocked(getUserContext).mockResolvedValue(ADMIN_CONTEXT);
    vi.mocked(getCurrentAnomalySummary).mockResolvedValue({
      summary: EMPTY_SUMMARY_RESULT.summary,
      currentAnomalies: [
        {
          versionId: "v1",
          versionLabel: "V1",
          projectName: 'Projet; "Nord"\nPhase 2',
          ownerUserId: "u1",
          ownerName: "User One",
          flagKey: "missing_price" as const,
          flagLabel: "Prix manquant",
          severity: "blocking" as const,
          itemCount: 3,
        },
      ],
      ownerOptions: [],
    });

    const response = await GET(
      new Request("http://localhost/api/admin/anomaly-history?format=csv")
    );

    expect(await response.text()).toContain(
      '"Projet; ""Nord""\nPhase 2"'
    );
  });
});
