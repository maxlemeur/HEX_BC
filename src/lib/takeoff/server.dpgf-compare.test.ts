import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  getAuthenticatedContext: vi.fn(),
  assertDraftStatus: vi.fn(),
  bulkUpdateEstimateItems: vi.fn(),
  insertAssemblyIntoVersion: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
  getTakeoffLowConfidenceThresholdForTenant: vi.fn(),
}));

vi.mock("@/lib/takeoff/version-links", () => ({
  listAccessibleTakeoffJobsForVersion: vi.fn(),
}));

import { getAuthenticatedContext } from "@/lib/estimates/server";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import {
  fetchDpgfTakeoffComparison,
  parseTakeoffDpgfComparisonQuery,
  saveTakeoffDpgfManualLink,
} from "@/lib/takeoff/server";
import { listAccessibleTakeoffJobsForVersion } from "@/lib/takeoff/version-links";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const JOB_ID = "44444444-4444-4444-8444-444444444444";
const ESTIMATE_ITEM_ID = "55555555-5555-4555-8555-555555555555";
const TAKEOFF_ITEM_ID = "66666666-6666-4666-8666-666666666666";
const TAKEOFF_ITEM_ID_2 = "77777777-7777-4777-8777-777777777777";

type StoredJob = {
  id: string;
  tenant_id: string;
  estimate_version_id: string;
  status: string;
  level: string;
  source_file_name: string | null;
  source_file_type: string | null;
  source_file_size_bytes: number | null;
  source_file_path: string | null;
  prompt_version: string | null;
  schema_version: string | null;
  model: string | null;
  thinking_level: string | null;
  media_resolution: string | null;
  retry_count: number;
  next_retry_at: string | null;
  last_error_at: string | null;
  token_count: number | null;
  cost_cents: number | null;
  duration_ms: number | null;
  started_at: string | null;
  completed_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

type StoredTakeoffItem = {
  id: string;
  tenant_id: string;
  job_id: string;
  designation: string;
  quantity: number;
  unit: string;
  confidence: number | null;
  evidence: string | null;
  source_file_name: string | null;
  source_page: number | null;
  metadata: Record<string, unknown>;
  is_excluded: boolean;
  exclusion_reason: string | null;
  is_verified: boolean;
  verified_at: string | null;
  verified_by: string | null;
  created_at: string;
  updated_at: string;
};

type StoredEstimateItem = {
  id: string;
  tenant_id: string;
  version_id: string;
  position: number;
  title: string;
  description: string | null;
  quantity: number | null;
  source_file_name: string | null;
  source_page: number | null;
  source_provider: string | null;
  item_type: "section" | "line";
  updated_at: string;
};

type StoredLink = {
  id: string;
  tenant_id: string;
  version_id: string;
  takeoff_job_id: string;
  estimate_item_id: string;
  takeoff_item_id: string;
  created_at: string;
  updated_at: string;
  linked_by: string | null;
};

function makeJob(): StoredJob {
  return {
    id: JOB_ID,
    tenant_id: TENANT_ID,
    estimate_version_id: VERSION_ID,
    status: "completed",
    level: "A",
    source_file_name: "plans.pdf",
    source_file_type: "application/pdf",
    source_file_size_bytes: 1200,
    source_file_path: `${TENANT_ID}/${JOB_ID}/plans.pdf`,
    prompt_version: "v1",
    schema_version: "v1",
    model: "gemini-2.5-flash",
    thinking_level: "high",
    media_resolution: null,
    retry_count: 0,
    next_retry_at: null,
    last_error_at: null,
    token_count: 10,
    cost_cents: 1,
    duration_ms: 1200,
    started_at: "2026-03-06T10:00:00.000Z",
    completed_at: "2026-03-06T10:01:00.000Z",
    error_code: null,
    error_message: null,
    created_at: "2026-03-06T09:59:00.000Z",
    updated_at: "2026-03-06T10:01:00.000Z",
    created_by: USER_ID,
  };
}

function createSupabaseMock() {
  const state: {
    job: StoredJob;
    takeoffItems: StoredTakeoffItem[];
    estimateItems: StoredEstimateItem[];
    links: StoredLink[];
    importId: string;
  } = {
    job: makeJob(),
    takeoffItems: [
      {
        id: TAKEOFF_ITEM_ID,
        tenant_id: TENANT_ID,
        job_id: JOB_ID,
        designation: "Faux plafond acoustique",
        quantity: 80,
        unit: "m2",
        confidence: 0.95,
        evidence: null,
        source_file_name: "plans.pdf",
        source_page: 5,
        metadata: {},
        is_excluded: false,
        exclusion_reason: null,
        is_verified: false,
        verified_at: null,
        verified_by: null,
        created_at: "2026-03-06T10:01:00.000Z",
        updated_at: "2026-03-06T10:01:00.000Z",
      },
      {
        id: TAKEOFF_ITEM_ID_2,
        tenant_id: TENANT_ID,
        job_id: JOB_ID,
        designation: "Reserve",
        quantity: 1,
        unit: "u",
        confidence: 0.5,
        evidence: null,
        source_file_name: "plans.pdf",
        source_page: 8,
        metadata: {},
        is_excluded: false,
        exclusion_reason: null,
        is_verified: false,
        verified_at: null,
        verified_by: null,
        created_at: "2026-03-06T10:02:00.000Z",
        updated_at: "2026-03-06T10:02:00.000Z",
      },
    ] satisfies StoredTakeoffItem[],
    estimateItems: [
      {
        id: ESTIMATE_ITEM_ID,
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        position: 1,
        title: "Faux plafond acoustique",
        description: null,
        quantity: 100,
        source_file_name: "dpgf.xlsx",
        source_page: 12,
        source_provider: "dpgf",
        item_type: "line",
        updated_at: "2026-03-06T09:00:00.000Z",
      },
    ] satisfies StoredEstimateItem[],
    links: [
      {
        id: "88888888-8888-4888-8888-888888888888",
        tenant_id: TENANT_ID,
        version_id: VERSION_ID,
        takeoff_job_id: JOB_ID,
        estimate_item_id: ESTIMATE_ITEM_ID,
        takeoff_item_id: TAKEOFF_ITEM_ID,
        created_at: "2026-03-06T10:10:00.000Z",
        updated_at: "2026-03-06T10:10:00.000Z",
        linked_by: USER_ID,
      },
    ] satisfies StoredLink[],
    importId: "99999999-9999-4999-8999-999999999999",
  };

  function buildThenable<T>(result: T) {
    return {
      then: (resolve: (value: T) => unknown) => Promise.resolve(resolve(result)),
    };
  }

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "takeoff_jobs") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, string> = {};
            const builder = {
              eq: vi.fn((column: string, value: string) => {
                filters[column] = value;
                return builder;
              }),
              maybeSingle: vi.fn(async () => ({
                data:
                  (!filters.id || state.job.id === filters.id) &&
                  (!filters.tenant_id || state.job.tenant_id === filters.tenant_id)
                    ? state.job
                    : null,
                error: null,
              })),
            };

            return builder;
          }),
        };
      }

      if (table === "takeoff_items") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, string> = {};
            const builder = {
              eq: vi.fn((column: string, value: string) => {
                filters[column] = value;
                return builder;
              }),
              order: vi.fn(() => builder),
              range: vi.fn(async (start: number, end: number) => {
                const filtered = state.takeoffItems.filter(
                  (item) =>
                    (!filters.tenant_id || item.tenant_id === filters.tenant_id) &&
                    (!filters.job_id || item.job_id === filters.job_id)
                );

                return {
                  data: filtered.slice(start, end + 1),
                  count: filtered.length,
                  error: null,
                };
              }),
              maybeSingle: vi.fn(async () => ({
                data:
                  state.takeoffItems.find(
                    (item) =>
                      (!filters.tenant_id || item.tenant_id === filters.tenant_id) &&
                      (!filters.id || item.id === filters.id)
                  ) ?? null,
                error: null,
              })),
            };

            return builder;
          }),
        };
      }

      if (table === "estimate_versions") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, string> = {};
            const builder = {
              eq: vi.fn((column: string, value: string) => {
                filters[column] = value;
                return builder;
              }),
              maybeSingle: vi.fn(async () => ({
                data:
                  (!filters.id || filters.id === VERSION_ID) &&
                  (!filters.tenant_id || filters.tenant_id === TENANT_ID)
                    ? { id: VERSION_ID, project_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }
                    : null,
                error: null,
              })),
            };

            return builder;
          }),
        };
      }

      if (table === "estimate_items") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, string> = {};
            const builder = {
              eq: vi.fn((column: string, value: string) => {
                filters[column] = value;
                return builder;
              }),
              order: vi.fn(() => builder),
              maybeSingle: vi.fn(async () => ({
                data:
                  state.estimateItems.find(
                    (item) =>
                      (!filters.tenant_id || item.tenant_id === filters.tenant_id) &&
                      (!filters.id || item.id === filters.id)
                  ) ?? null,
                error: null,
              })),
              then: buildThenable({
                data: state.estimateItems.filter(
                  (item) =>
                    (!filters.tenant_id || item.tenant_id === filters.tenant_id) &&
                    (!filters.version_id || item.version_id === filters.version_id) &&
                    (!filters.item_type || item.item_type === filters.item_type)
                ),
                error: null,
              }).then,
            };

            return builder;
          }),
        };
      }

      if (table === "takeoff_dpgf_links") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, string> = {};
            const builder = {
              eq: vi.fn((column: string, value: string) => {
                filters[column] = value;
                return builder;
              }),
              order: vi.fn(() => builder),
              then: buildThenable({
                data: state.links.filter(
                  (link) =>
                    (!filters.tenant_id || link.tenant_id === filters.tenant_id) &&
                    (!filters.version_id || link.version_id === filters.version_id) &&
                    (!filters.takeoff_job_id || link.takeoff_job_id === filters.takeoff_job_id)
                ),
                error: null,
              }).then,
            };

            return builder;
          }),
          delete: vi.fn(() => {
            const filters: Record<string, string> = {};
            let orValue = "";
            const builder = {
              eq: vi.fn((column: string, value: string) => {
                filters[column] = value;
                return builder;
              }),
              or: vi.fn((value: string) => {
                orValue = value;
                const conditions = value.split(",");
                state.links = state.links.filter((link) => {
                  const scoped =
                    (!filters.tenant_id || link.tenant_id === filters.tenant_id) &&
                    (!filters.version_id || link.version_id === filters.version_id) &&
                    (!filters.takeoff_job_id || link.takeoff_job_id === filters.takeoff_job_id);
                  if (!scoped) {
                    return true;
                  }

                  const matches = conditions.some((condition) => {
                    const [column, comparator, expected] = condition.split(".");
                    if (comparator !== "eq") return false;
                    return String(link[column as keyof StoredLink]) === expected;
                  });

                  return !matches;
                });

                return buildThenable({ error: null });
              }),
            };
            void orValue;
            return builder;
          }),
          insert: vi.fn((payload: Record<string, unknown>) => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => {
                const link = {
                  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
                  created_at: "2026-03-06T11:00:00.000Z",
                  updated_at: "2026-03-06T11:00:00.000Z",
                  ...payload,
                } as StoredLink;
                state.links.push(link);
                return {
                  data: link,
                  error: null,
                };
              }),
            })),
          })),
        };
      }

      if (table === "dpgf_imports") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, string> = {};
            const builder = {
              eq: vi.fn((column: string, value: string) => {
                filters[column] = value;
                return builder;
              }),
              order: vi.fn(() => builder),
              limit: vi.fn(() => builder),
              maybeSingle: vi.fn(async () => ({
                data:
                  (!filters.tenant_id || filters.tenant_id === TENANT_ID) &&
                  (!filters.project_id ||
                    filters.project_id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
                    ? { id: state.importId }
                    : null,
                error: null,
              })),
            };

            return builder;
          }),
        };
      }

      if (table === "dpgf_rows_mapped") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, string> = {};
            const builder = {
              eq: vi.fn((column: string, value: string) => {
                filters[column] = value;
                return builder;
              }),
              order: vi.fn(() => builder),
              then: buildThenable({
                data:
                  filters.import_id === state.importId
                    ? [
                        {
                          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                          payload: {
                            row_index: 12,
                            unit: "m2",
                          },
                        },
                      ]
                    : [],
                error: null,
              }).then,
            };

            return builder;
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    supabase: supabase as never,
    state,
  };
}

describe("takeoff DPGF comparison server helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
    vi.mocked(listAccessibleTakeoffJobsForVersion).mockResolvedValue([
      {
        id: JOB_ID,
        estimate_version_id: VERSION_ID,
        status: "completed",
        level: "A",
        source_file_name: "plans.pdf",
        source_file_type: "application/pdf",
        source_file_size_bytes: 1200,
        created_at: "2026-03-06T09:59:00.000Z",
        updated_at: "2026-03-06T10:01:00.000Z",
        linked_from_version_id: null,
        linked_from_version_number: null,
        is_linked: false,
      },
    ]);
  });

  it("builds the DPGF comparison payload with best-effort unit enrichment", async () => {
    const mock = createSupabaseMock();

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: mock.supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      tenantRole: "admin",
    } as never);

    const query = parseTakeoffDpgfComparisonQuery({
      version_id: VERSION_ID,
      threshold: "0.6",
    });
    const response = await fetchDpgfTakeoffComparison(JOB_ID, query);

    expect(response.summary).toMatchObject({
      manual_links: 1,
      gaps: 1,
      total_rows: 2,
    });
    expect(response.rows[0]).toMatchObject({
      match_source: "manual",
      dpgf: expect.objectContaining({
        estimate_item_id: ESTIMATE_ITEM_ID,
      }),
      takeoff: expect.objectContaining({
        item_id: TAKEOFF_ITEM_ID,
      }),
    });
  });

  it("replaces an existing manual link for the same estimate item", async () => {
    const mock = createSupabaseMock();

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase: mock.supabase,
      tenantId: TENANT_ID,
      userId: USER_ID,
      tenantRole: "admin",
    } as never);

    const response = await saveTakeoffDpgfManualLink(JOB_ID, {
      version_id: VERSION_ID,
      estimate_item_id: ESTIMATE_ITEM_ID,
      takeoff_item_id: TAKEOFF_ITEM_ID_2,
    });

    expect(response.deleted).toBe(false);
    expect(response.link).toMatchObject({
      version_id: VERSION_ID,
      takeoff_job_id: JOB_ID,
      estimate_item_id: ESTIMATE_ITEM_ID,
      takeoff_item_id: TAKEOFF_ITEM_ID_2,
    });
    expect(mock.state.links).toHaveLength(1);
    expect(mock.state.links[0]?.takeoff_item_id).toBe(TAKEOFF_ITEM_ID_2);
  });
});
