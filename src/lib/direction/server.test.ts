import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getAuthenticatedContext: vi.fn(),
}));

vi.mock("@/lib/affaires/server", () => ({
  fetchAffaireHubPlansSummary: vi.fn(async () => null),
}));

vi.mock("@/lib/affaires/intake-server", () => ({
  fetchAffaireIntakeWorkspace: vi.fn(async () => null),
}));

vi.mock("@/lib/direction/alerts", () => ({
  buildDirectionSyntheticAlerts: vi.fn((input) =>
    input.alerts.map((alert: { alert_id: string; takeoff_job_id?: string | null }) => ({
      id: alert.alert_id,
      alertIds: [alert.alert_id],
      jobId: input.latestJobId,
      rawJobId: alert.takeoff_job_id ?? null,
      level: "warning",
      status: "to_process",
      label: `signal:${alert.alert_id}`,
      reasons: [],
      lotLabels: [],
      href: `/alerts/${alert.alert_id}`,
    }))
  ),
}));

import { getAuthenticatedContext } from "@/lib/estimates/server";
import { fetchDirectionProjectSignals } from "@/lib/direction/server";

type Row = Record<string, unknown>;

function createBuilder(resolve: () => { data: unknown; error: unknown }) {
  const state = {
    eq: new Map<string, unknown>(),
    in: new Map<string, unknown[]>(),
  };

  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((column: string, value: unknown) => {
      state.eq.set(column, value);
      return builder;
    }),
    neq: vi.fn(() => builder),
    in: vi.fn((column: string, values: unknown[]) => {
      state.in.set(column, values);
      return builder;
    }),
    order: vi.fn(() => builder),
    is: vi.fn(() => builder),
    maybeSingle: vi.fn(() => resolve()),
    getState: () => state,
    then: (onFulfilled: (value: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve(resolve()).then(onFulfilled),
  };

  return builder;
}

function createSupabaseMock(fixtures: {
  versions: Row[];
  jobs: Row[];
  alerts: Row[];
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === "estimate_versions") {
        let builder: ReturnType<typeof createBuilder>;
        builder = createBuilder(() => {
          const versionId = builder.getState().eq.get("id");
          const projectId = builder.getState().eq.get("project_id");

          if (typeof versionId === "string" && typeof projectId === "string") {
            return {
              data:
                fixtures.versions.find(
                  (row) => row.id === versionId && row.project_id === projectId
                ) ?? null,
              error: null,
            };
          }

          return {
            data: fixtures.versions,
            error: null,
          };
        });
        return builder;
      }

      if (table === "takeoff_jobs") {
        let builder: ReturnType<typeof createBuilder>;
        builder = createBuilder(() => {
          const versionIds = builder.getState().in.get("estimate_version_id") ?? [];
          return {
            data: fixtures.jobs.filter((row) =>
              versionIds.includes(row.estimate_version_id)
            ),
            error: null,
          };
        });
        return builder;
      }

      if (table === "estimate_risk_alerts") {
        let builder: ReturnType<typeof createBuilder>;
        builder = createBuilder(() => {
          const versionIds = builder.getState().in.get("version_id") ?? [];
          return {
            data: fixtures.alerts.filter((row) => versionIds.includes(row.version_id)),
            error: null,
          };
        });
        return builder;
      }

      if (table === "tenant_memberships") {
        return createBuilder(() => ({ data: [], error: null }));
      }

      if (table === "profiles") {
        return createBuilder(() => ({ data: [], error: null }));
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

function createVersionRow(projectId: string, versionId: string, versionNumber: number) {
  return {
    id: versionId,
    project_id: projectId,
    version_number: versionNumber,
    status: "draft",
    approval_status: "not_required",
    total_ht_cents: 150_000,
    margin_bp: 1_500,
    discount_bp: 0,
    updated_at: "2026-03-07T10:00:00.000Z",
    date_devis: "2026-03-07",
    validite_jours: 30,
    estimate_projects: {
      id: projectId,
      user_id: "owner-1",
      name: "Affaire test",
      client_name: "Client test",
      is_archived: false,
    },
  };
}

function createAlertRow(versionId: string, alertId: string, jobId: string, metadata: Row = {}) {
  return {
    id: alertId,
    created_at: "2026-03-07T10:00:00.000Z",
    updated_at: "2026-03-07T10:00:00.000Z",
    tenant_id: "tenant-1",
    project_id: "project-1",
    version_id: versionId,
    takeoff_job_id: jobId,
    scope_type: "line",
    scope_ref: "line-ref",
    scope_id: "line-1",
    scope_label: "Ligne test",
    cause_code: "missing_proof",
    severity: "warning",
    status: "to_process",
    risk_score: 42,
    margin_bucket: "thin",
    line_id: "line-1",
    lot_id: null,
    reason_labels: ["Missing proof"],
    provenance: [],
    metadata,
    review_note: null,
    reviewed_at: null,
    reviewed_by: null,
    is_active: true,
    first_detected_at: "2026-03-07T10:00:00.000Z",
    last_detected_at: "2026-03-07T10:00:00.000Z",
  };
}

describe("fetchDirectionProjectSignals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads signals for the requested non-latest version", async () => {
    const projectId = "project-non-latest";
    const versionId = "version-1";
    const latestVersionId = "version-2";

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      tenantId: "tenant-1",
      tenantRole: "director",
      userId: "user-1",
      supabase: createSupabaseMock({
        versions: [
          createVersionRow(projectId, latestVersionId, 2),
          createVersionRow(projectId, versionId, 1),
        ],
        jobs: [
          {
            id: "job-v1",
            estimate_version_id: versionId,
            status: "completed",
            created_at: "2026-03-07T10:00:00.000Z",
            completed_at: "2026-03-07T10:05:00.000Z",
          },
        ],
        alerts: [createAlertRow(versionId, "alert-v1", "job-v1")],
      }),
    } as never);

    const result = await fetchDirectionProjectSignals(projectId, versionId);

    expect(result.latestJobId).toBe("job-v1");
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]).toMatchObject({
      id: "alert-v1",
      rawJobId: "job-v1",
    });
  });

  it("filters out alerts that belong to older takeoff jobs", async () => {
    const projectId = "project-filter";
    const versionId = "version-filter";

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      tenantId: "tenant-1",
      tenantRole: "director",
      userId: "user-1",
      supabase: createSupabaseMock({
        versions: [createVersionRow(projectId, versionId, 3)],
        jobs: [
          {
            id: "job-latest",
            estimate_version_id: versionId,
            status: "completed",
            created_at: "2026-03-07T11:00:00.000Z",
            completed_at: "2026-03-07T11:05:00.000Z",
          },
        ],
        alerts: [
          createAlertRow(versionId, "alert-latest", "job-latest"),
          createAlertRow(versionId, "alert-stale", "job-old", {
            takeoff_job_id: "job-latest",
          }),
        ],
      }),
    } as never);

    const result = await fetchDirectionProjectSignals(projectId, versionId);

    expect(result.latestJobId).toBe("job-latest");
    expect(result.alerts).toHaveLength(1);
    expect(result.alerts[0]).toMatchObject({
      id: "alert-latest",
      rawJobId: "job-latest",
    });
  });

  it("returns no synthetic alerts when only older-job alerts remain", async () => {
    const projectId = "project-stale-only";
    const versionId = "version-stale-only";

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      tenantId: "tenant-1",
      tenantRole: "director",
      userId: "user-1",
      supabase: createSupabaseMock({
        versions: [createVersionRow(projectId, versionId, 4)],
        jobs: [
          {
            id: "job-latest-empty",
            estimate_version_id: versionId,
            status: "completed",
            created_at: "2026-03-07T12:00:00.000Z",
            completed_at: "2026-03-07T12:05:00.000Z",
          },
        ],
        alerts: [
          createAlertRow(versionId, "alert-stale-only", "job-old", {
            takeoff_job_id: "job-latest-empty",
          }),
        ],
      }),
    } as never);

    const result = await fetchDirectionProjectSignals(projectId, versionId);

    expect(result.latestJobId).toBe("job-latest-empty");
    expect(result.alerts).toEqual([]);
  });
});
