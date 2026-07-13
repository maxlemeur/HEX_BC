import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServiceRoleClientMock } = vi.hoisted(() => ({
  createServiceRoleClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: createServiceRoleClientMock,
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
}));

import {
  DELETE,
  PATCH,
  PUT,
} from "@/app/api/takeoff/plan-sets/[setId]/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "99999999-9999-4999-8999-999999999999";
const ESTIMATE_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const SET_ID = "44444444-4444-4444-8444-444444444444";
const FILE_ID = "55555555-5555-4555-8555-555555555555";
const FILE_ID_2 = "66666666-6666-4666-8666-666666666666";
const MISSING_SET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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
  membershipRole?: "admin" | "engineer" | "viewer";
  planSetDeleteError?: {
    code: string;
    message: string;
  } | null;
  storageRemoveError?: { message: string } | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function basePlanSet(input?: Partial<PlanSetStoredRow>): PlanSetStoredRow {
  return {
    id: input?.id ?? SET_ID,
    tenant_id: input?.tenant_id ?? TENANT_ID,
    project_id: input?.project_id ?? PROJECT_ID,
    estimate_version_id: input?.estimate_version_id ?? ESTIMATE_VERSION_ID,
    name: input?.name ?? "Set principal",
    description: input?.description ?? "Plans chantier",
    metadata: input?.metadata ?? {},
    created_by: input?.created_by ?? USER_ID,
    created_at: input?.created_at ?? "2026-02-24T10:00:00.000Z",
    updated_at: input?.updated_at ?? "2026-02-24T10:00:00.000Z",
  };
}

function basePlanFile(input?: Partial<PlanFileStoredRow>): PlanFileStoredRow {
  const planSetId = input?.plan_set_id ?? SET_ID;
  const fileId = input?.id ?? FILE_ID;
  const fileName = input?.file_name ?? "rdc.pdf";

  return {
    id: fileId,
    tenant_id: input?.tenant_id ?? TENANT_ID,
    plan_set_id: planSetId,
    file_path:
      input?.file_path ??
      `${TENANT_ID}/${planSetId}/${fileId}/${fileName}`,
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
  const initialSets = options.planSets ?? [basePlanSet()];
  const initialFiles =
    options.planFiles ??
    [
      basePlanFile(),
      basePlanFile({
        id: FILE_ID_2,
        file_name: "etage.pdf",
      }),
    ];

  const state = {
    planSetsById: new Map<string, PlanSetStoredRow>(
      initialSets.map((row) => [row.id, row])
    ),
    planFilesById: new Map<string, PlanFileStoredRow>(
      initialFiles.map((row) => [row.id, row])
    ),
    storageRemovals: [] as string[],
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
            role: options.membershipRole ?? "admin",
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

  function createPlanSetsDeleteBuilder() {
    const filters: { tenant_id?: string; id?: string } = {};
    const deleteError = options.planSetDeleteError ?? null;

    function deleteSet() {
      const [row] = filterPlanSets(filters);
      if (!row) return null;

      state.planSetsById.delete(row.id);
      for (const file of [...state.planFilesById.values()]) {
        if (file.plan_set_id === row.id) {
          state.planFilesById.delete(file.id);
        }
      }

      return { id: row.id };
    }

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        if (column === "tenant_id" || column === "id") {
          filters[column] = value;
        }
        return builder;
      }),
      select: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        if (deleteError) {
          return { data: null, error: deleteError };
        }
        const deleted = deleteSet();
        return { data: deleted, error: null };
      }),
      single: vi.fn(async () => {
        if (deleteError) {
          return { data: null, error: deleteError };
        }
        const deleted = deleteSet();
        if (!deleted) {
          return { data: null, error: { code: "PGRST116", message: "Not found" } };
        }
        return { data: deleted, error: null };
      }),
      then: (
        onFulfilled?: (
          value: {
            data: Array<{ id: string }>;
            error: { code: string; message: string } | null;
          }
        ) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => {
        if (deleteError) {
          return Promise.resolve({
            data: [],
            error: deleteError,
          }).then(onFulfilled, onRejected);
        }
        const deleted = deleteSet();
        return Promise.resolve({
          data: deleted ? [deleted] : [],
          error: null,
        }).then(onFulfilled, onRejected);
      },
    };

    return builder;
  }

  function createPlanSetsUpdateBuilder(payload: unknown) {
    const updates = isRecord(payload)
      ? payload
      : {};
    const filters: { tenant_id?: string; id?: string } = {};

    function updateSet() {
      const [row] = filterPlanSets(filters);
      if (!row) return null;

      const nextRow: PlanSetStoredRow = {
        ...row,
        name: typeof updates.name === "string" ? updates.name : row.name,
        description:
          updates.description === null || typeof updates.description === "string"
            ? updates.description
            : row.description,
        metadata: isRecord(updates.metadata)
          ? updates.metadata
          : row.metadata,
        updated_at: "2026-02-24T11:00:00.000Z",
      };

      state.planSetsById.set(nextRow.id, nextRow);
      return { id: nextRow.id };
    }

    const builder = {
      eq: vi.fn((column: string, value: string) => {
        if (column === "tenant_id" || column === "id") {
          filters[column] = value;
        }
        return builder;
      }),
      select: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => {
        const updated = updateSet();
        return { data: updated, error: null };
      }),
      single: vi.fn(async () => {
        const updated = updateSet();
        if (!updated) {
          return { data: null, error: { code: "PGRST116", message: "Not found" } };
        }
        return { data: updated, error: null };
      }),
      then: (
        onFulfilled?: (
          value: { data: Array<{ id: string }>; error: null }
        ) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => {
        const updated = updateSet();
        return Promise.resolve({
          data: updated ? [updated] : [],
          error: null,
        }).then(onFulfilled, onRejected);
      },
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

    function deleteFiles() {
      const rows = filterPlanFiles(filters);
      for (const row of rows) {
        state.planFilesById.delete(row.id);
      }
      return rows;
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
        const [deleted] = deleteFiles();
        return { data: deleted ?? null, error: null };
      }),
      single: vi.fn(async () => {
        const [deleted] = deleteFiles();
        if (!deleted) {
          return { data: null, error: { code: "PGRST116", message: "Not found" } };
        }
        return { data: deleted, error: null };
      }),
      then: (
        onFulfilled?: (value: { data: PlanFileStoredRow[]; error: null }) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) =>
        Promise.resolve({
          data: deleteFiles(),
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
          remove: vi.fn(async (paths: string[]) => {
            state.storageRemovals.push(...paths);
            return {
              data: null,
              error: options.storageRemoveError ?? null,
            };
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
          insert: vi.fn(async (payload: PlanSetStoredRow) => {
            state.planSetsById.set(payload.id, payload);
            return { data: null, error: null };
          }),
          delete: vi.fn(() => createPlanSetsDeleteBuilder()),
          update: vi.fn((payload: unknown) => createPlanSetsUpdateBuilder(payload)),
        };
      }

      if (table === "plan_files") {
        return {
          select: vi.fn(() => createPlanFilesSelectBuilder()),
          insert: vi.fn(async (payload: PlanFileStoredRow[]) => {
            for (const row of payload) {
              state.planFilesById.set(row.id, row);
            }
            return { data: null, error: null };
          }),
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

function makeParams(setId = SET_ID) {
  return {
    params: Promise.resolve({ setId }),
  };
}

describe("/api/takeoff/plan-sets/[setId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
  });

  it.each(["admin", "engineer"] as const)(
    "DELETE removes a plan set and associated files for an %s",
    async (membershipRole) => {
      const supabase = createSupabaseMock({ membershipRole });
      vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
      createServiceRoleClientMock.mockReturnValue(supabase);

      const response = await DELETE(
        new Request(`http://localhost/api/takeoff/plan-sets/${SET_ID}`, {
          method: "DELETE",
        }),
        makeParams()
      );
      const body = (await response.json()) as {
        ok: boolean;
        data?: unknown;
      };

      expect(response.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(supabase.__state.planSetsById.has(SET_ID)).toBe(false);
      expect(
        [...supabase.__state.planFilesById.values()].filter(
          (file) => file.plan_set_id === SET_ID
        )
      ).toHaveLength(0);
      expect(supabase.__state.storageRemovals.length).toBeGreaterThan(0);
      expect(createServiceRoleClientMock).toHaveBeenCalledOnce();
    }
  );

  it("DELETE rejects a viewer before database or Storage mutation", async () => {
    const supabase = createSupabaseMock({ membershipRole: "viewer" });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await DELETE(
      new Request(`http://localhost/api/takeoff/plan-sets/${SET_ID}`, {
        method: "DELETE",
      }),
      makeParams()
    );

    expect(response.status).toBe(403);
    expect(supabase.__state.planSetsById.has(SET_ID)).toBe(true);
    expect(supabase.__state.planFilesById.size).toBeGreaterThan(0);
    expect(supabase.__state.storageRemovals).toHaveLength(0);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it("DELETE fails closed before service cleanup for a forged plan file path", async () => {
    const supabase = createSupabaseMock({
      membershipRole: "admin",
      planFiles: [
        basePlanFile({
          file_path: `${TENANT_ID}/another-set/victim-file/private.pdf`,
        }),
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await DELETE(
      new Request(`http://localhost/api/takeoff/plan-sets/${SET_ID}`, {
        method: "DELETE",
      }),
      makeParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("PLAN_FILE_STORAGE_PATH_MISMATCH");
    expect(supabase.__state.planSetsById.has(SET_ID)).toBe(true);
    expect(supabase.__state.planFilesById.has(FILE_ID)).toBe(true);
    expect(supabase.__state.storageRemovals).toHaveLength(0);
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it("DELETE restores metadata when server-side Storage cleanup fails", async () => {
    const supabase = createSupabaseMock({
      membershipRole: "admin",
      storageRemoveError: { message: "storage unavailable" },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    createServiceRoleClientMock.mockReturnValue(supabase);

    const response = await DELETE(
      new Request(`http://localhost/api/takeoff/plan-sets/${SET_ID}`, {
        method: "DELETE",
      }),
      makeParams()
    );

    expect(response.status).toBe(409);
    expect(supabase.__state.planSetsById.has(SET_ID)).toBe(true);
    expect(
      [...supabase.__state.planFilesById.values()].filter(
        (file) => file.plan_set_id === SET_ID
      )
    ).toHaveLength(2);
  });

  it("DELETE returns 400 when the plan set is still referenced by takeoff jobs", async () => {
    const supabase = createSupabaseMock({
      planSetDeleteError: {
        code: "23503",
        message: "update or delete on table \"plan_sets\" violates foreign key constraint",
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await DELETE(
      new Request(`http://localhost/api/takeoff/plan-sets/${SET_ID}`, {
        method: "DELETE",
      }),
      makeParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("BAD_REQUEST");
    expect(body.error?.message).toBe("Impossible de supprimer le jeu de plans.");
    expect(supabase.__state.planSetsById.has(SET_ID)).toBe(true);
    expect(supabase.__state.storageRemovals).toHaveLength(0);
  });

  it("PATCH updates plan set name and description", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await PATCH(
      new Request(`http://localhost/api/takeoff/plan-sets/${SET_ID}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Set mis a jour",
          description: "Nouvelle description",
        }),
      }),
      makeParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        plan_set?: {
          id: string;
          name: string;
          description: string | null;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data?.plan_set?.id).toBe(SET_ID);
    expect(body.data?.plan_set?.name).toBe("Set mis a jour");
    expect(body.data?.plan_set?.description).toBe("Nouvelle description");
    expect(supabase.__state.planSetsById.get(SET_ID)?.name).toBe("Set mis a jour");
    expect(supabase.__state.planSetsById.get(SET_ID)?.description).toBe(
      "Nouvelle description"
    );
  });

  it("PUT clears empty description and updates metadata", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await PUT(
      new Request(`http://localhost/api/takeoff/plan-sets/${SET_ID}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Set revision B",
          description: "   ",
          metadata: {
            revision: "B",
          },
        }),
      }),
      makeParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        plan_set?: {
          id: string;
          description: string | null;
          metadata: Record<string, unknown>;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data?.plan_set?.id).toBe(SET_ID);
    expect(body.data?.plan_set?.description).toBeNull();
    expect(body.data?.plan_set?.metadata).toEqual({
      revision: "B",
    });
    expect(supabase.__state.planSetsById.get(SET_ID)?.description).toBeNull();
  });

  it("PATCH returns 422 for empty update payload", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await PATCH(
      new Request(`http://localhost/api/takeoff/plan-sets/${SET_ID}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      }),
      makeParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("PATCH returns 400 when body is invalid JSON", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await PATCH(
      new Request(`http://localhost/api/takeoff/plan-sets/${SET_ID}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{invalid-json",
      }),
      makeParams()
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("BAD_REQUEST");
  });

  it("PATCH returns 404 when updating an unknown set", async () => {
    const supabase = createSupabaseMock({
      planSets: [],
      planFiles: [],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await PATCH(
      new Request(`http://localhost/api/takeoff/plan-sets/${MISSING_SET_ID}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Inexistant",
        }),
      }),
      makeParams(MISSING_SET_ID)
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBeDefined();
  });

  it("returns 400 with normalized error envelope for invalid setId", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await DELETE(
      new Request("http://localhost/api/takeoff/plan-sets/not-a-uuid", {
        method: "DELETE",
      }),
      makeParams("not-a-uuid")
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBeDefined();
  });

  it("returns 404 when deleting an unknown set", async () => {
    const supabase = createSupabaseMock({
      planSets: [],
      planFiles: [],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await DELETE(
      new Request(`http://localhost/api/takeoff/plan-sets/${MISSING_SET_ID}`, {
        method: "DELETE",
      }),
      makeParams(MISSING_SET_ID)
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
