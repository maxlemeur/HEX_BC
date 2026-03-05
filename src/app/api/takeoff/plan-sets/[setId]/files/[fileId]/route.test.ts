import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
}));

import { DELETE, GET } from "@/app/api/takeoff/plan-sets/[setId]/files/[fileId]/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "99999999-9999-4999-8999-999999999999";
const ESTIMATE_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const SET_ID = "44444444-4444-4444-8444-444444444444";
const FILE_ID = "55555555-5555-4555-8555-555555555555";
const MISSING_FILE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

type PlanSetStoredRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  estimate_version_id: string | null;
  name: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type PlanFileStoredRow = {
  id: string;
  tenant_id: string;
  plan_set_id: string;
  file_path: string;
  file_name: string;
  file_type: string;
  file_size_bytes: number;
  page_count: number | null;
  file_hash: string | null;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type SupabaseMockOptions = {
  planSets?: PlanSetStoredRow[];
  planFiles?: PlanFileStoredRow[];
  hasMembership?: boolean;
  signedDownloadBehavior?: "success" | "missing";
};

function basePlanSet(input?: Partial<PlanSetStoredRow>): PlanSetStoredRow {
  return {
    id: input?.id ?? SET_ID,
    tenant_id: input?.tenant_id ?? TENANT_ID,
    project_id: input?.project_id ?? PROJECT_ID,
    estimate_version_id: input?.estimate_version_id ?? ESTIMATE_VERSION_ID,
    name: input?.name ?? "Set plans",
    description: input?.description ?? "Plans PDF",
    metadata: input?.metadata ?? {},
    created_by: input?.created_by ?? USER_ID,
    created_at: input?.created_at ?? "2026-02-24T10:00:00.000Z",
    updated_at: input?.updated_at ?? "2026-02-24T10:00:00.000Z",
  };
}

function basePlanFile(input?: Partial<PlanFileStoredRow>): PlanFileStoredRow {
  const setId = input?.plan_set_id ?? SET_ID;
  const fileId = input?.id ?? FILE_ID;
  const fileName = input?.file_name ?? "rdc.pdf";

  return {
    id: fileId,
    tenant_id: input?.tenant_id ?? TENANT_ID,
    plan_set_id: setId,
    file_path:
      input?.file_path ??
      `${TENANT_ID}/${setId}/${fileId}/${fileName}`,
    file_name: fileName,
    file_type: input?.file_type ?? "application/pdf",
    file_size_bytes: input?.file_size_bytes ?? 1024,
    page_count: input?.page_count ?? 2,
    file_hash: input?.file_hash ?? null,
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
    planFilesById: new Map<string, PlanFileStoredRow>(
      (options.planFiles ?? [basePlanFile()]).map((row) => [row.id, row])
    ),
    storageRemovals: [] as string[],
    signedDownloadPaths: [] as string[],
  };

  const hasMembership = options.hasMembership ?? true;
  const signedDownloadBehavior = options.signedDownloadBehavior ?? "success";
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

  function filterPlanSets(filters: { tenant_id?: string; id?: string }) {
    return [...state.planSetsById.values()]
      .filter((row) => !filters.tenant_id || row.tenant_id === filters.tenant_id)
      .filter((row) => !filters.id || row.id === filters.id);
  }

  function filterPlanFiles(filters: {
    tenant_id?: string;
    id?: string;
    plan_set_id?: string;
  }) {
    return [...state.planFilesById.values()]
      .filter((row) => !filters.tenant_id || row.tenant_id === filters.tenant_id)
      .filter((row) => !filters.id || row.id === filters.id)
      .filter((row) => !filters.plan_set_id || row.plan_set_id === filters.plan_set_id);
  }

  function createPlanSetsSelectBuilder() {
    const filters: { tenant_id?: string; id?: string } = {};

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        if (column === "tenant_id" || column === "id") {
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
        Promise.resolve({
          data: filterPlanSets(filters),
          error: null,
        }).then(onFulfilled, onRejected),
    };

    return builder;
  }

  function createPlanFilesSelectBuilder() {
    const filters: { tenant_id?: string; id?: string; plan_set_id?: string } = {};

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        if (column === "tenant_id" || column === "id" || column === "plan_set_id") {
          filters[column] = value;
        }
        return builder;
      }),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        const [row] = filterPlanFiles(filters);
        return { data: row ?? null, error: null };
      }),
      single: vi.fn(async () => {
        const [row] = filterPlanFiles(filters);
        if (!row) {
          return { data: null, error: { code: "PGRST116", message: "Not found" } };
        }
        return { data: row, error: null };
      }),
      then: (
        onFulfilled?: (value: { data: PlanFileStoredRow[]; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) =>
        Promise.resolve({
          data: filterPlanFiles(filters),
          error: null,
        }).then(onFulfilled, onRejected),
    };

    return builder;
  }

  function createPlanFilesDeleteBuilder() {
    const filters: { tenant_id?: string; id?: string; plan_set_id?: string } = {};

    function deleteOne() {
      const [row] = filterPlanFiles(filters);
      if (!row) return null;
      state.planFilesById.delete(row.id);
      return row;
    }

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        if (column === "tenant_id" || column === "id" || column === "plan_set_id") {
          filters[column] = value;
        }
        return builder;
      }),
      select: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        const deleted = deleteOne();
        return { data: deleted, error: null };
      }),
      single: vi.fn(async () => {
        const deleted = deleteOne();
        if (!deleted) {
          return { data: null, error: { code: "PGRST116", message: "Not found" } };
        }
        return { data: deleted, error: null };
      }),
      then: (
        onFulfilled?: (value: { data: PlanFileStoredRow[]; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => {
        const deleted = deleteOne();
        return Promise.resolve({
          data: deleted ? [deleted] : [],
          error: null,
        }).then(onFulfilled, onRejected);
      },
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
          createSignedUrl: vi.fn(async (path: string) => {
            state.signedDownloadPaths.push(path);

            if (signedDownloadBehavior === "missing") {
              return {
                data: null,
                error: {
                  message: "Object not found",
                  status: 404,
                  statusCode: "404",
                  code: "NoSuchKey",
                },
              };
            }

            return {
              data: {
                signedUrl: `https://signed.local/${encodeURIComponent(path)}`,
              },
              error: null,
            };
          }),
          remove: vi.fn(async (paths: string[]) => {
            state.storageRemovals.push(...paths);
            return { data: null, error: null };
          }),
        };
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => membershipBuilder),
        };
      }

      if (table === "plan_sets") {
        return {
          select: vi.fn(() => createPlanSetsSelectBuilder()),
        };
      }

      if (table === "plan_files") {
        return {
          select: vi.fn(() => createPlanFilesSelectBuilder()),
          delete: vi.fn(() => createPlanFilesDeleteBuilder()),
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

function makeParams(setId = SET_ID, fileId = FILE_ID) {
  return {
    params: Promise.resolve({ setId, fileId }),
  };
}

describe("/api/takeoff/plan-sets/[setId]/files/[fileId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
  });

  it("GET returns a signed download URL when requested", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET(
      new Request(
        `http://localhost/api/takeoff/plan-sets/${SET_ID}/files/${FILE_ID}?include_download_url=true`,
        {
          method: "GET",
        }
      ),
      makeParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        plan_file?: {
          download_url?: string | null;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data?.plan_file?.download_url).toContain("https://signed.local/");
    expect(supabase.__state.signedDownloadPaths).toContain(
      `${TENANT_ID}/${SET_ID}/${FILE_ID}/rdc.pdf`
    );
  });

  it("GET keeps metadata available when the storage object is not uploaded yet", async () => {
    const supabase = createSupabaseMock({
      signedDownloadBehavior: "missing",
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET(
      new Request(
        `http://localhost/api/takeoff/plan-sets/${SET_ID}/files/${FILE_ID}?include_download_url=true`,
        {
          method: "GET",
        }
      ),
      makeParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        plan_file?: {
          download_url?: string | null;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data?.plan_file?.download_url).toBeNull();
  });

  it("DELETE removes the file and associated storage object", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await DELETE(
      new Request(
        `http://localhost/api/takeoff/plan-sets/${SET_ID}/files/${FILE_ID}`,
        {
          method: "DELETE",
        }
      ),
      makeParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: unknown;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(supabase.__state.planFilesById.has(FILE_ID)).toBe(false);
    expect(supabase.__state.storageRemovals).toContain(
      `${TENANT_ID}/${SET_ID}/${FILE_ID}/rdc.pdf`
    );
  });

  it("returns 400 for invalid fileId", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await DELETE(
      new Request(
        `http://localhost/api/takeoff/plan-sets/${SET_ID}/files/not-a-uuid`,
        {
          method: "DELETE",
        }
      ),
      makeParams(SET_ID, "not-a-uuid")
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBeDefined();
  });

  it("returns 404 when deleting an unknown file", async () => {
    const supabase = createSupabaseMock({
      planFiles: [],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await DELETE(
      new Request(
        `http://localhost/api/takeoff/plan-sets/${SET_ID}/files/${MISSING_FILE_ID}`,
        {
          method: "DELETE",
        }
      ),
      makeParams(SET_ID, MISSING_FILE_ID)
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBeDefined();
  });
});
