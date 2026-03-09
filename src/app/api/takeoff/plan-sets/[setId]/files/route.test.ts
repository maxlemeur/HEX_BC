import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
}));

import { GET, POST } from "@/app/api/takeoff/plan-sets/[setId]/files/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "99999999-9999-4999-8999-999999999999";
const ESTIMATE_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const SET_ID = "44444444-4444-4444-8444-444444444444";
const FILE_ID = "55555555-5555-4555-8555-555555555555";
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
};

type UploadInput = {
  fileName?: string;
  fileType?: string;
  fileSizeBytes?: number;
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
    name: input?.name ?? "Set plans B",
    description: input?.description ?? "Documents PDF",
    metadata: input?.metadata ?? {},
    created_by: input?.created_by ?? USER_ID,
    created_at: input?.created_at ?? "2026-02-24T10:00:00.000Z",
    updated_at: input?.updated_at ?? "2026-02-24T10:00:00.000Z",
  };
}

function basePlanFile(input?: Partial<PlanFileStoredRow>): PlanFileStoredRow {
  const setId = input?.plan_set_id ?? SET_ID;
  const fileId = input?.id ?? FILE_ID;
  const fileName = input?.file_name ?? "plan-rdc.pdf";

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
    page_count: input?.page_count ?? 3,
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
      (options.planFiles ?? []).map((row) => [row.id, row])
    ),
    uploads: [] as string[],
    signedUploadPaths: [] as string[],
    signedDownloadPaths: [] as string[],
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
      .filter((row) => !filters.plan_set_id || row.plan_set_id === filters.plan_set_id)
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
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
          upload: vi.fn(async (path: string) => {
            state.uploads.push(path);
            return { data: { path }, error: null };
          }),
          createSignedUploadUrl: vi.fn(async (path: string) => {
            state.signedUploadPaths.push(path);
            return {
              data: {
                path,
                token: "signed-upload-token",
                signedUrl: `https://upload.local/${encodeURIComponent(path)}`,
              },
              error: null,
            };
          }),
          createSignedUrl: vi.fn(async (path: string) => {
            state.signedDownloadPaths.push(path);
            return {
              data: {
                signedUrl: `https://signed.local/${encodeURIComponent(path)}`,
              },
              error: null,
            };
          }),
          remove: vi.fn(async () => ({ data: null, error: null })),
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
          insert: vi.fn((payload: unknown) => {
            const raw = (Array.isArray(payload) ? payload[0] : payload) as
              | Partial<PlanFileStoredRow>
              | undefined;
            const fileId = raw?.id ?? "77777777-7777-4777-8777-777777777777";
            const planSetId = raw?.plan_set_id ?? SET_ID;
            const fileName =
              typeof raw?.file_name === "string" ? raw.file_name : "plan-rdc.pdf";
            const row = basePlanFile({
              id: fileId,
              plan_set_id: planSetId,
              tenant_id: raw?.tenant_id ?? TENANT_ID,
              file_name: fileName,
              file_type:
                typeof raw?.file_type === "string"
                  ? raw.file_type
                  : "application/pdf",
              file_size_bytes:
                typeof raw?.file_size_bytes === "number"
                  ? raw.file_size_bytes
                  : 4096,
              file_path:
                typeof raw?.file_path === "string"
                  ? raw.file_path
                  : `${TENANT_ID}/${planSetId}/${fileId}/${fileName}`,
              page_count:
                typeof raw?.page_count === "number" ? raw.page_count : null,
              file_hash:
                typeof raw?.file_hash === "string" ? raw.file_hash : null,
              metadata: isRecord(raw?.metadata) ? raw.metadata : {},
              created_by: raw?.created_by ?? USER_ID,
              created_at: "2026-02-24T12:00:00.000Z",
              updated_at: "2026-02-24T12:00:00.000Z",
            });

            state.planFilesById.set(row.id, row);

            const insertBuilder = {
              select: vi.fn(() => insertBuilder),
              single: vi.fn(async () => ({ data: row, error: null })),
              maybeSingle: vi.fn(async () => ({ data: row, error: null })),
              then: (
                onFulfilled?: (
                  value: { data: PlanFileStoredRow[]; error: null }
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

function buildSnakeCaseJsonUploadRequest(setId: string, input?: UploadInput) {
  return new Request(`http://localhost/api/takeoff/plan-sets/${setId}/files`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      file_name: input?.fileName ?? "plan-rdc.pdf",
      file_type: input?.fileType ?? "application/pdf",
      file_size_bytes: input?.fileSizeBytes ?? 4096,
      metadata: {},
    }),
  });
}

function buildCamelCaseJsonUploadRequest(setId: string, input?: UploadInput) {
  return new Request(`http://localhost/api/takeoff/plan-sets/${setId}/files`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      fileName: input?.fileName ?? "plan-rdc.pdf",
      fileType: input?.fileType ?? "application/pdf",
      fileSizeBytes: input?.fileSizeBytes ?? 4096,
      metadata: {},
    }),
  });
}

function buildMultipartUploadRequest(setId: string, input?: UploadInput) {
  const fileSize = input?.fileSizeBytes ?? 4096;
  const fileName = input?.fileName ?? "plan-rdc.pdf";
  const fileType = input?.fileType ?? "application/pdf";
  const file = new File([new Uint8Array(fileSize)], fileName, {
    type: fileType,
  });

  const formData = new FormData();
  formData.append("file", file);
  formData.append("file_name", fileName);
  formData.append("file_type", fileType);
  formData.append("file_size_bytes", String(fileSize));

  return new Request(`http://localhost/api/takeoff/plan-sets/${setId}/files`, {
    method: "POST",
    body: formData,
  });
}

async function postUploadWithFallback(
  setId: string,
  params: { params: Promise<{ setId: string }> },
  input?: UploadInput
) {
  const attempts = [
    buildSnakeCaseJsonUploadRequest(setId, input),
    buildCamelCaseJsonUploadRequest(setId, input),
    buildMultipartUploadRequest(setId, input),
  ];

  let lastResponse: Response | null = null;

  for (const request of attempts) {
    const response = await POST(request, params);
    lastResponse = response;

    if (![400, 405, 415, 422].includes(response.status)) {
      return response;
    }
  }

  return lastResponse as Response;
}

function extractPlanFiles(data: unknown): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }

  if (isRecord(data) && Array.isArray(data.plan_files)) {
    return data.plan_files;
  }

  return [];
}

describe("/api/takeoff/plan-sets/[setId]/files", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
  });

  it("POST uploads/creates a file and GET lists files for the set", async () => {
    const supabase = createSupabaseMock({
      planFiles: [],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const uploadResponse = await postUploadWithFallback(SET_ID, makeParams(), {
      fileName: "plan-rdc.pdf",
      fileType: "application/pdf",
      fileSizeBytes: 1024,
    });
    const uploadBody = (await uploadResponse.json()) as {
      ok: boolean;
      data?: unknown;
      error?: { code?: string };
    };

    expect([200, 201]).toContain(uploadResponse.status);
    expect(uploadBody.ok).toBe(true);
    expect(uploadBody.data).toBeDefined();
    expect(
      supabase.__state.planFilesById.size > 0 ||
        supabase.__state.uploads.length > 0 ||
        supabase.__state.signedUploadPaths.length > 0
    ).toBe(true);

    const listResponse = await GET(
      new Request(`http://localhost/api/takeoff/plan-sets/${SET_ID}/files`, {
        method: "GET",
      }),
      makeParams()
    );
    const listBody = (await listResponse.json()) as {
      ok: boolean;
      data?: unknown;
    };

    expect(listResponse.status).toBe(200);
    expect(listBody.ok).toBe(true);
    expect(extractPlanFiles(listBody.data).length).toBeGreaterThan(0);
  });

  it("accepts PDF registration when MIME is application/octet-stream but extension is .pdf", async () => {
    const supabase = createSupabaseMock({
      planFiles: [],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await postUploadWithFallback(SET_ID, makeParams(), {
      fileName: "plan-terrain.pdf",
      fileType: "application/octet-stream",
      fileSizeBytes: 1024,
    });
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect([200, 201]).toContain(response.status);
    expect(body.ok).toBe(true);
  });

  it("returns 413 when uploaded file exceeds 50 MB", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await postUploadWithFallback(SET_ID, makeParams(), {
      fileName: "plan-massif.pdf",
      fileType: "application/pdf",
      fileSizeBytes: 50 * 1024 * 1024 + 1,
    });
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(413);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBeDefined();
  });

  it("returns 404 when set does not exist", async () => {
    const supabase = createSupabaseMock({
      planSets: [],
      planFiles: [],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await GET(
      new Request(`http://localhost/api/takeoff/plan-sets/${MISSING_SET_ID}/files`, {
        method: "GET",
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
