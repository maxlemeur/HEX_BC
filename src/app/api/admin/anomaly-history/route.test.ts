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

describe("/api/admin/anomaly-history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("neutralizes spreadsheet formulas in CSV exports", async () => {
    vi.mocked(getUserContext).mockResolvedValue(ADMIN_CONTEXT);
    vi.mocked(getCurrentAnomalySummary).mockResolvedValue({
      summary: EMPTY_SUMMARY_RESULT.summary,
      currentAnomalies: [
        {
          versionId: "v1",
          versionLabel: "+1+1",
          projectName: '=HYPERLINK("https://example.invalid")',
          ownerUserId: "u1",
          ownerName: "  @SUM(1,1)",
          flagKey: "missing_price" as const,
          flagLabel: "-2+3",
          severity: "blocking" as const,
          itemCount: 3,
        },
      ],
      ownerOptions: [],
    });

    const response = await GET(
      new Request("http://localhost/api/admin/anomaly-history?format=csv")
    );
    const text = await response.text();

    expect(text).toContain("'+1+1");
    expect(text).toContain("'=HYPERLINK");
    expect(text).toContain("'  @SUM");
    expect(text).toContain("'-2+3");
  });
});
