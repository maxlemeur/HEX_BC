import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
}));

import { GET, POST } from "@/app/api/takeoff/plan-sets/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const ESTIMATE_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const SET_ID = "44444444-4444-4444-8444-444444444444";

type PlanSetStoredRow = {
  id: string;
  tenant_id: string;
  estimate_version_id: string;
  name: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type SupabaseMockOptions = {
  planSets?: PlanSetStoredRow[];
  planFiles?: Array<{ id: string; plan_set_id: string; tenant_id: string }>;
  hasMembership?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function basePlanSet(input?: Partial<PlanSetStoredRow>): PlanSetStoredRow {
  return {
    id: input?.id ?? SET_ID,
    tenant_id: input?.tenant_id ?? TENANT_ID,
    estimate_version_id: input?.estimate_version_id ?? ESTIMATE_VERSION_ID,
    name: input?.name ?? "Lot plans RDC",
    description: input?.description ?? "Plans de reference",
    metadata: input?.metadata ?? {},
    created_by: input?.created_by ?? USER_ID,
    created_at: input?.created_at ?? "2026-02-24T10:00:00.000Z",
    updated_at: input?.updated_at ?? "2026-02-24T10:00:00.000Z",
  };
}

function createSupabaseMock(options: SupabaseMockOptions = {}) {
  const state = {
    planSetsById: new Map<string, PlanSetStoredRow>(
      (options.planSets ?? [basePlanSet()]).map((row) => [row.id, row])
    ),
    planFiles: options.planFiles ?? [],
  };

  const hasMembership = options.hasMembership ?? true;

  const membershipBuilder = {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  membershipBuilder.eq.mockReturnValue(membershipBuilder);
  membershipBuilder.order.mockReturnValue(membershipBuilder);
  membershipBuilder.limit.mockResolvedValue({
    data: hasMembership
      ? [
          {
            tenant_id: TENANT_ID,
            role: "admin",
            is_default: true,
            created_at: "2026-01-01T00:00:00.000Z",
          },
        ]
      : [],
    error: null,
  });

  function filterPlanSets(filters: {
    tenant_id?: string;
    id?: string;
    estimate_version_id?: string;
  }) {
    return [...state.planSetsById.values()]
      .filter((row) => !filters.tenant_id || row.tenant_id === filters.tenant_id)
      .filter((row) => !filters.id || row.id === filters.id)
      .filter(
        (row) =>
          !filters.estimate_version_id ||
          row.estimate_version_id === filters.estimate_version_id
      )
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  }

  function createPlanFilesSelectBuilder() {
    const filters: {
      tenant_id?: string;
      plan_set_ids?: string[];
    } = {};

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        if (column === "tenant_id") {
          filters.tenant_id = value;
        }
        return builder;
      }),
      in: vi.fn((column: string, value: string[]) => {
        if (column === "plan_set_id") {
          filters.plan_set_ids = value;
        }
        return builder;
      }),
      then: (
        onFulfilled?: (
          value: {
            data: Array<{ id: string; plan_set_id: string; tenant_id: string }>;
            error: null;
          }
        ) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => {
        const filtered = state.planFiles.filter((row) => {
          if (filters.tenant_id && row.tenant_id !== filters.tenant_id) return false;
          if (
            filters.plan_set_ids &&
            !filters.plan_set_ids.includes(row.plan_set_id)
          ) {
            return false;
          }

          return true;
        });

        return Promise.resolve({ data: filtered, error: null }).then(
          onFulfilled,
          onRejected
        );
      },
    };

    return builder;
  }

  function createPlanSetsSelectBuilder() {
    const filters: {
      tenant_id?: string;
      id?: string;
      estimate_version_id?: string;
    } = {};

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        if (
          column === "tenant_id" ||
          column === "id" ||
          column === "estimate_version_id"
        ) {
          filters[column] = value;
        }
        return builder;
      }),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        const [row] = filterPlanSets(filters);
        return { data: row ?? null, error: null };
      }),
      single: vi.fn(async () => {
        const [row] = filterPlanSets(filters);
        if (!row) {
          return { data: null, error: { code: "PGRST116", message: "Not found" } };
        }
        return { data: row, error: null };
      }),
      then: (
        onFulfilled?: (value: { data: PlanSetStoredRow[]; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) =>
        Promise.resolve({ data: filterPlanSets(filters), error: null }).then(
          onFulfilled,
          onRejected
        ),
    };

    return builder;
  }

  function createEstimateVersionsSelectBuilder() {
    let filterId: string | null = null;

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        if (column === "id") {
          filterId = value;
        }
        return builder;
      }),
      maybeSingle: vi.fn(async () => ({
        data:
          filterId === ESTIMATE_VERSION_ID
            ? {
                id: ESTIMATE_VERSION_ID,
                status: "draft",
                tenant_id: TENANT_ID,
                estimate_projects: {
                  tenant_id: TENANT_ID,
                  user_id: USER_ID,
                },
              }
            : null,
        error: null,
      })),
      single: vi.fn(async () =>
        filterId === ESTIMATE_VERSION_ID
          ? {
              data: {
                id: ESTIMATE_VERSION_ID,
                status: "draft",
                tenant_id: TENANT_ID,
                estimate_projects: {
                  tenant_id: TENANT_ID,
                  user_id: USER_ID,
                },
              },
              error: null,
            }
          : { data: null, error: { code: "PGRST116", message: "Not found" } }
      ),
      then: (
        onFulfilled?: (value: { data: Array<{ id: string }>; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) =>
        Promise.resolve({
          data: filterId === ESTIMATE_VERSION_ID ? [{ id: ESTIMATE_VERSION_ID }] : [],
          error: null,
        }).then(onFulfilled, onRejected),
    };

    return builder;
  }

  const supabase = {
    __state: state,
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: {
          user: {
            id: USER_ID,
          },
        },
        error: null,
      }),
    },
    storage: {
      from: vi.fn((bucket: string) => {
        if (bucket !== "plan-files") {
          throw new Error(`Unexpected storage bucket: ${bucket}`);
        }

        return {
          upload: vi.fn(async () => ({ data: null, error: null })),
          remove: vi.fn(async () => ({ data: null, error: null })),
          createSignedUploadUrl: vi.fn(async (path: string) => ({
            data: { path, token: "signed-upload-token" },
            error: null,
          })),
          createSignedUrl: vi.fn(async (path: string) => ({
            data: { signedUrl: `https://signed.local/${encodeURIComponent(path)}` },
            error: null,
          })),
        };
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => membershipBuilder),
        };
      }

      if (table === "estimate_versions") {
        return {
          select: vi.fn(() => createEstimateVersionsSelectBuilder()),
        };
      }

      if (table === "plan_sets") {
        return {
          select: vi.fn(() => createPlanSetsSelectBuilder()),
          insert: vi.fn((payload: unknown) => {
            const raw = (Array.isArray(payload) ? payload[0] : payload) as
              | Partial<PlanSetStoredRow>
              | undefined;

            const row = basePlanSet({
              id: raw?.id ?? "55555555-5555-4555-8555-555555555555",
              tenant_id: raw?.tenant_id ?? TENANT_ID,
              estimate_version_id: raw?.estimate_version_id ?? ESTIMATE_VERSION_ID,
              name: typeof raw?.name === "string" ? raw.name : "Nouveau set",
              description:
                typeof raw?.description === "string" ? raw.description : null,
              metadata: isRecord(raw?.metadata) ? raw.metadata : {},
              created_by: raw?.created_by ?? USER_ID,
              created_at: "2026-02-24T12:00:00.000Z",
              updated_at: "2026-02-24T12:00:00.000Z",
            });

            state.planSetsById.set(row.id, row);

            const insertBuilder = {
              select: vi.fn(() => insertBuilder),
              single: vi.fn(async () => ({ data: row, error: null })),
              maybeSingle: vi.fn(async () => ({ data: row, error: null })),
              then: (
                onFulfilled?: (
                  value: { data: PlanSetStoredRow[]; error: null }
                ) => unknown,
                onRejected?: (reason: unknown) => unknown
              ) =>
                Promise.resolve({
                  data: [row],
                  error: null,
                }).then(onFulfilled, onRejected),
            };

            return insertBuilder;
          }),
        };
      }

      if (table === "plan_files") {
        return {
          select: vi.fn(() => createPlanFilesSelectBuilder()),
        };
      }

      if (table === "audit_logs") {
        return {
          insert: vi.fn(async () => ({ data: null, error: null })),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return supabase;
}

function extractPlanSets(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }

  if (isRecord(data) && Array.isArray(data.plan_sets)) {
    return data.plan_sets;
  }

  return [];
}

describe("/api/takeoff/plan-sets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
  });

  it("POST creates a plan set and GET lists plan sets", async () => {
    const supabase = createSupabaseMock({ planSets: [] });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const createResponse = await POST(
      new Request("http://localhost/api/takeoff/plan-sets", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          estimate_version_id: ESTIMATE_VERSION_ID,
          name: "Plans batiment A",
          description: "Pack principal",
          metadata: {
            source: "vitest",
          },
        }),
      })
    );
    const createBody = (await createResponse.json()) as {
      ok: boolean;
      data?: unknown;
      error?: { code?: string };
    };

    expect([200, 201]).toContain(createResponse.status);
    expect(createBody.ok).toBe(true);
    expect(createBody.data).toBeDefined();
    expect(supabase.__state.planSetsById.size).toBe(1);

    const listResponse = await GET(
      new Request("http://localhost/api/takeoff/plan-sets", {
        method: "GET",
      })
    );
    const listBody = (await listResponse.json()) as {
      ok: boolean;
      data?: unknown;
    };

    expect(listResponse.status).toBe(200);
    expect(listBody.ok).toBe(true);
    expect(extractPlanSets(listBody.data).length).toBeGreaterThan(0);
  });

  it("returns 403 with normalized error envelope when membership is missing", async () => {
    const supabase = createSupabaseMock({ hasMembership: false });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET(
      new Request("http://localhost/api/takeoff/plan-sets", {
        method: "GET",
      })
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBeDefined();
  });
});
