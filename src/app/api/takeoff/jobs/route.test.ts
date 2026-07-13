import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";

const { createServiceRoleClientMock, serviceRoleRemoveMock } = vi.hoisted(() => {
  const remove = vi.fn().mockResolvedValue({ data: null, error: null });
  return {
    serviceRoleRemoveMock: remove,
    createServiceRoleClientMock: vi.fn(() => ({
      storage: {
        from: vi.fn(() => ({ remove })),
      },
    })),
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: createServiceRoleClientMock,
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
  getTakeoffGeminiDeliveryConfigForTenant: vi.fn().mockResolvedValue({
    useBatchApi: false,
  }),
}));

vi.mock("@/lib/takeoff/edge-trigger", () => ({
  triggerTakeoffJobProcessing: vi.fn().mockResolvedValue({
    triggered: true,
    correlationId: "00000000-0000-4000-8000-000000000000",
    statusCode: 202,
  }),
}));

import { GET, POST } from "@/app/api/takeoff/jobs/route";
import { forbidden } from "@/lib/estimates/errors";
import { TakeoffError, TakeoffErrorCode } from "@/lib/takeoff/errors";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { triggerTakeoffJobProcessing } from "@/lib/takeoff/edge-trigger";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";
import { TAKEOFF_PROMPT_VERSION_BY_LEVEL } from "@/lib/takeoff/prompts";
import * as takeoffServer from "@/lib/takeoff/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const ESTIMATE_VERSION_ID = "33333333-3333-4333-8333-333333333333";
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getAuditMetadata(
  auditRow: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  const afterData =
    auditRow?.after_data && typeof auditRow.after_data === "object"
      ? (auditRow.after_data as { metadata?: Record<string, unknown> })
      : null;
  return afterData?.metadata;
}

type SupabaseMockOptions = {
  estimateStatus?: "draft" | "sent" | "accepted" | "archived";
  missingEstimate?: boolean;
  simulateInsertConflictAfterUpload?: boolean;
};

type TakeoffJobStoredRow = {
  id: string;
  tenant_id: string;
  estimate_version_id: string;
  level: string;
  status: string;
  source_file_name: string | null;
  source_file_path: string | null;
  source_file_type: string | null;
  source_file_size_bytes: number | null;
  prompt_version: string | null;
  created_by: string | null;
  created_at: string;
};

function createSupabaseMock(options: SupabaseMockOptions = {}) {
  let currentEstimateStatus = options.estimateStatus ?? "draft";
  let missingEstimate = options.missingEstimate ?? false;

  const state = {
    jobsById: new Map<string, TakeoffJobStoredRow>(),
    uploads: [] as string[],
    removals: [] as string[],
    audits: [] as Array<Record<string, unknown>>,
  };

  const membershipBuilder = {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  membershipBuilder.eq.mockReturnValue(membershipBuilder);
  membershipBuilder.order.mockReturnValue(membershipBuilder);
  membershipBuilder.limit.mockResolvedValue({
    data: [
      {
        tenant_id: TENANT_ID,
        role: "admin",
        is_default: true,
        created_at: "2026-01-01T00:00:00.000Z",
      },
    ],
    error: null,
  });

  const estimateVersionsBuilder = {
    eq: vi.fn(),
    single: vi.fn(),
  };

  estimateVersionsBuilder.eq.mockReturnValue(estimateVersionsBuilder);
  estimateVersionsBuilder.single.mockImplementation(async () =>
    missingEstimate
      ? { data: null, error: { code: "PGRST116", message: "Not found" } }
      : {
          data: {
            id: ESTIMATE_VERSION_ID,
            status: currentEstimateStatus,
            estimate_projects: {
              tenant_id: TENANT_ID,
              user_id: USER_ID,
            },
          },
          error: null,
        }
  );

  function createTakeoffJobsSelectBuilder() {
    const filters: Record<string, string> = {};
    const builder = {
      eq: vi.fn((column: string, value: string) => {
        filters[column] = value;
        return builder;
      }),
      maybeSingle: vi.fn(async () => {
        const jobId = filters.id;
        const tenantId = filters.tenant_id;
        const row =
          jobId && tenantId
            ? state.jobsById.get(jobId) ?? null
            : null;

        if (!row || row.tenant_id !== tenantId) {
          return { data: null, error: null };
        }

        return { data: row, error: null };
      }),
    };

    return builder;
  }

  function createTakeoffJobsInsertBuilder() {
    return {
      select: vi.fn(() => ({
        single: vi.fn(async () => {
          const payload = takeoffJobsInsertInput;

          if (
            options.simulateInsertConflictAfterUpload &&
            !state.jobsById.has(payload.id)
          ) {
            state.jobsById.set(payload.id, {
              id: payload.id,
              tenant_id: payload.tenant_id,
              estimate_version_id: payload.estimate_version_id,
              level: payload.level,
              status: "pending",
              source_file_name: "other.csv",
              source_file_path: `${payload.tenant_id}/${payload.id}/other-fingerprint-other.csv`,
              source_file_type: "text/csv",
              source_file_size_bytes: 1,
              prompt_version: TAKEOFF_PROMPT_VERSION_BY_LEVEL.A,
              created_by: USER_ID,
              created_at: "2026-02-24T12:00:00.000Z",
            });

            return {
              data: null,
              error: {
                code: "23505",
                message: "duplicate key value violates unique constraint",
              },
            };
          }

          if (state.jobsById.has(payload.id)) {
            return {
              data: null,
              error: {
                code: "23505",
                message: "duplicate key value violates unique constraint",
              },
            };
          }

          const row: TakeoffJobStoredRow = {
            id: payload.id,
            tenant_id: payload.tenant_id,
            estimate_version_id: payload.estimate_version_id,
            level: payload.level,
            status: payload.status,
            source_file_name: payload.source_file_name ?? null,
            source_file_path: payload.source_file_path ?? null,
            source_file_type: payload.source_file_type ?? null,
            source_file_size_bytes: payload.source_file_size_bytes ?? null,
            prompt_version: payload.prompt_version ?? null,
            created_by: payload.created_by ?? null,
            created_at: "2026-02-24T12:00:00.000Z",
          };

          state.jobsById.set(row.id, row);
          return { data: row, error: null };
        }),
      })),
    };
  }

  let takeoffJobsInsertInput: {
    id: string;
    tenant_id: string;
    estimate_version_id: string;
    level: string;
    status: string;
    source_file_name?: string | null;
    source_file_path?: string | null;
    source_file_type?: string | null;
    source_file_size_bytes?: number | null;
    prompt_version?: string | null;
    created_by?: string | null;
  };

  const supabase = {
    __state: state,
    __controls: {
      setEstimateStatus: (value: "draft" | "sent" | "accepted" | "archived") => {
        currentEstimateStatus = value;
      },
      setMissingEstimate: (value: boolean) => {
        missingEstimate = value;
      },
    },
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
        if (bucket !== "takeoff-files") {
          throw new Error(`Unexpected storage bucket: ${bucket}`);
        }

        return {
          upload: vi.fn(
            async (path: string) => {
              state.uploads.push(path);
              return { data: { path }, error: null };
            }
          ),
          remove: vi.fn(async (paths: string[]) => {
            state.removals.push(...paths);
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

      if (table === "estimate_versions") {
        return {
          select: vi.fn(() => estimateVersionsBuilder),
        };
      }

      if (table === "takeoff_jobs") {
        return {
          select: vi.fn(() => createTakeoffJobsSelectBuilder()),
          insert: vi.fn((payload) => {
            takeoffJobsInsertInput = payload as never;
            return createTakeoffJobsInsertBuilder();
          }),
        };
      }

      if (table === "audit_logs") {
        return {
          insert: vi.fn(async (payload: Record<string, unknown>) => {
            state.audits.push(payload);
            return { data: null, error: null };
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return supabase;
}

function buildTakeoffRequest(input?: {
  estimateVersionId?: string;
  level?: string;
  fileName?: string;
  fileType?: string;
  fileContent?: BlobPart;
  fileSizeBytes?: number;
  headers?: Record<string, string>;
}) {
  const formData = new FormData();
  const fileContent =
    input?.fileSizeBytes !== undefined
      ? new Uint8Array(input.fileSizeBytes)
      : input?.fileContent ?? "designation;quantity;unit\nTube PVC;12;ml";
  const file = new File(
    [fileContent],
    input?.fileName ?? "niveau-a.csv",
    {
      type: input?.fileType ?? "text/csv",
    }
  );

  formData.append("file", file);
  formData.append("estimate_version_id", input?.estimateVersionId ?? ESTIMATE_VERSION_ID);
  formData.append("level", input?.level ?? "A");

  return new Request("http://localhost/api/takeoff/jobs", {
    method: "POST",
    headers: input?.headers,
    body: formData,
  });
}

function buildTakeoffListRequest(query?: string) {
  return new Request(
    `http://localhost/api/takeoff/jobs${query ? `?${query}` : ""}`,
    {
      method: "GET",
    }
  );
}

async function createPdfBytes(pageCount = 1) {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    pdf.addPage([595, 842]);
  }
  return new Uint8Array(await pdf.save());
}

describe("GET /api/takeoff/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns jobs list with filters and pagination", async () => {
    const parsedQuery: takeoffServer.ListTakeoffJobsQuery = {
      estimate_version_id: ESTIMATE_VERSION_ID,
      status: "failed",
      level: "A",
      period: "30d",
      limit: 20,
      offset: 0,
    };
    const parseSpy = vi
      .spyOn(takeoffServer, "parseListTakeoffJobsQuery")
      .mockReturnValue(parsedQuery);
    const listSpy = vi.spyOn(takeoffServer, "listTakeoffJobs").mockResolvedValue({
      jobs: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          estimate_version_id: ESTIMATE_VERSION_ID,
          status: "failed",
          level: "A",
          processing_strategy: "sync" as const,
          provider_batch_id: null,
          provider_batch_state: null,
          provider_batch_updated_at: null,
          source_file_name: "niveau-a.csv",
          source_file_type: "text/csv",
          source_file_size_bytes: 1024,
          prompt_version: "takeoff-a-v1",
          schema_version: "v1",
          model: "gemini-3-flash-preview",
          thinking_level: "high",
          media_resolution: null,
          retry_count: 1,
          error_code: "AI_TIMEOUT",
          error_message: "Timed out",
          next_retry_at: null,
          last_error_at: null,
          started_at: null,
          completed_at: null,
          created_at: "2026-02-25T12:00:00.000Z",
          updated_at: "2026-02-25T12:00:00.000Z",
          items_count: 4,
          metrics: {
            token_count: 120,
            cost_cents: 9,
            duration_ms: 1200,
          },
        },
      ],
      counters: {
        total: 5,
        processing: 1,
        completed: 2,
        failed: 1,
        canceled: 1,
      },
      pagination: {
        limit: 20,
        offset: 0,
        total: 1,
      },
    });

    const response = await GET(
      buildTakeoffListRequest(
        `estimate_version_id=${ESTIMATE_VERSION_ID}&status=failed&level=A&period=30d&limit=20&offset=0`
      )
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        jobs: Array<{ id: string }>;
        pagination: {
          limit: number;
          offset: number;
          total: number;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data?.jobs).toHaveLength(1);
    expect(body.data?.jobs[0]?.id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(parseSpy).toHaveBeenCalledWith({
      estimate_version_id: ESTIMATE_VERSION_ID,
      status: "failed",
      level: "A",
      period: "30d",
      limit: "20",
      offset: "0",
    });
    expect(listSpy).toHaveBeenCalledWith(parsedQuery);
  });

  it("returns 403 when takeoff module is disabled", async () => {
    vi.spyOn(takeoffServer, "parseListTakeoffJobsQuery").mockReturnValue({});
    vi.spyOn(takeoffServer, "listTakeoffJobs").mockRejectedValue(
      new TakeoffError({
        status: 403,
        code: TakeoffErrorCode.TAKEOFF_MODULE_DISABLED,
        message: "Le module Takeoff est desactive.",
        retryable: false,
      })
    );

    const response = await GET(buildTakeoffListRequest());
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe(TakeoffErrorCode.TAKEOFF_MODULE_DISABLED);
  });

  it("returns 404 when list query targets an unknown estimate version", async () => {
    vi.spyOn(takeoffServer, "parseListTakeoffJobsQuery").mockReturnValue({
      estimate_version_id: ESTIMATE_VERSION_ID,
    });
    vi.spyOn(takeoffServer, "listTakeoffJobs").mockRejectedValue(
      new TakeoffError({
        status: 404,
        code: TakeoffErrorCode.NOT_FOUND,
        message: "Version introuvable.",
        retryable: false,
      })
    );

    const response = await GET(
      buildTakeoffListRequest(`estimate_version_id=${ESTIMATE_VERSION_ID}`)
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe(TakeoffErrorCode.NOT_FOUND);
  });
});

describe("POST /api/takeoff/jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
    vi.mocked(triggerTakeoffJobProcessing).mockResolvedValue({
      triggered: true,
      correlationId: "00000000-0000-4000-8000-000000000000",
      statusCode: 202,
    });
  });

  it("creates a pending takeoff job and writes an audit event", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(buildTakeoffRequest());
    const body = (await response.json()) as {
      ok: boolean;
      data?: {
        id: string;
        status: string;
        level: string;
      };
    };

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data?.id).toMatch(UUID_REGEX);
    expect(body.data?.status).toBe("pending");
    expect(body.data?.level).toBe("A");
    expect(supabase.__state.uploads).toHaveLength(1);
    expect(supabase.__state.audits).toHaveLength(1);
    expect(supabase.__state.audits[0]?.action).toBe("takeoff.job.created");
    expect(getAuditMetadata(supabase.__state.audits[0])).toMatchObject({
      level: "A",
      estimate_version_id: ESTIMATE_VERSION_ID,
      classification: {
        document_class: "structured",
        recommended_level: "A",
        compatible_levels: ["A"],
        recommendation_strength: "high",
      },
      selection: {
        selected_level: "A",
        override_applied: false,
        source_kind: "upload",
      },
    });
    expect(triggerTakeoffJobProcessing).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: expect.stringMatching(UUID_REGEX),
        trigger: "create",
      })
    );

    const [storedJob] = [...supabase.__state.jobsById.values()];
    expect(storedJob?.prompt_version).toBe(TAKEOFF_PROMPT_VERSION_BY_LEVEL.A);
  });

  it("returns 403 when takeoff feature flag is disabled", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(assertTakeoffEnabled).mockRejectedValue(
      forbidden(
        "Le module Takeoff est desactive pour ce tenant.",
        undefined,
        "TAKEOFF_MODULE_DISABLED"
      )
    );

    const response = await POST(buildTakeoffRequest());
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("TAKEOFF_MODULE_DISABLED");
  });

  it("returns 403 when estimate version is not draft", async () => {
    const supabase = createSupabaseMock({ estimateStatus: "sent" });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(buildTakeoffRequest());
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("READ_ONLY");
  });

  it("returns 404 when estimate version does not exist", async () => {
    const supabase = createSupabaseMock({ missingEstimate: true });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(buildTakeoffRequest());
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("NOT_FOUND");
  });

  it("returns 413 when file exceeds 10 MB", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      buildTakeoffRequest({
        fileSizeBytes: 10 * 1024 * 1024 + 1,
      })
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(413);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("TAKEOFF_FILE_TOO_LARGE");
  });

  it("creates a level B job when a PDF is uploaded", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    const pdfBytes = await createPdfBytes();

    const response = await POST(
      buildTakeoffRequest({
        level: "B",
        fileName: "lot-cvc-dpgf.pdf",
        fileType: "application/pdf",
        fileContent: pdfBytes,
      })
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: { level?: string; source_file_name?: string };
    };

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data?.level).toBe("B");
    expect(body.data?.source_file_name).toBe("lot-cvc-dpgf.pdf");
    expect(getAuditMetadata(supabase.__state.audits[0])).toMatchObject({
      classification: {
        document_class: "tabular_pdf",
        recommended_level: "B",
        compatible_levels: ["B", "C"],
      },
      selection: {
        selected_level: "B",
        override_applied: false,
        source_kind: "upload",
      },
    });
  });

  it("accepts a PDF when the browser sends application/octet-stream", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    const pdfBytes = await createPdfBytes();

    const response = await POST(
      buildTakeoffRequest({
        level: "B",
        fileName: "terrain-plan.pdf",
        fileType: "application/octet-stream",
        fileContent: pdfBytes,
      })
    );
    const body = (await response.json()) as {
      ok: boolean;
      data?: { level?: string };
    };

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data?.level).toBe("B");
  });

  it("returns 422 with a dedicated code when the uploaded PDF is corrupted", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      buildTakeoffRequest({
        level: "B",
        fileName: "terrain-corrompu.pdf",
        fileType: "application/pdf",
        fileContent: "not-a-valid-pdf",
      })
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string; message?: string };
    };

    expect(response.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("TAKEOFF_PDF_CORRUPTED");
    expect(body.error?.message).toMatch(/pdf/i);
  });

  it("returns 422 when file format is not supported", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      buildTakeoffRequest({
        fileName: "notes.txt",
        fileType: "text/plain",
        fileContent: "contenu",
      })
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(422);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("TAKEOFF_FILE_TYPE_INVALID");
  });

  it("returns 400 when idempotency key is blank", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      buildTakeoffRequest({
        headers: { "idempotency-key": "   " },
      })
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("IDEMPOTENCY_KEY_INVALID");
  });

  it("returns same job with same idempotency key and payload", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const headers = { "idempotency-key": "same-key" };

    const firstResponse = await POST(
      buildTakeoffRequest({
        headers,
      })
    );
    const firstBody = (await firstResponse.json()) as {
      ok: boolean;
      data: { id: string };
    };

    const secondResponse = await POST(
      buildTakeoffRequest({
        headers,
      })
    );
    const secondBody = (await secondResponse.json()) as {
      ok: boolean;
      data: { id: string };
    };

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(firstBody.data.id).toBe(secondBody.data.id);
    expect(supabase.__state.jobsById.size).toBe(1);
    expect(supabase.__state.uploads).toHaveLength(1);
    expect(supabase.__state.audits).toHaveLength(1);
    expect(triggerTakeoffJobProcessing).toHaveBeenCalledTimes(2);
  });

  it("returns existing job on idempotent retry even if preconditions changed", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const headers = { "idempotency-key": "same-key" };

    const firstResponse = await POST(
      buildTakeoffRequest({
        headers,
      })
    );
    const firstBody = (await firstResponse.json()) as {
      ok: boolean;
      data: { id: string };
    };

    supabase.__controls.setEstimateStatus("sent");
    vi.mocked(assertTakeoffEnabled).mockRejectedValue(
      forbidden(
        "Le module Takeoff est desactive pour ce tenant.",
        undefined,
        "TAKEOFF_MODULE_DISABLED"
      )
    );

    const secondResponse = await POST(
      buildTakeoffRequest({
        headers,
      })
    );
    const secondBody = (await secondResponse.json()) as {
      ok: boolean;
      data: { id: string };
    };

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(201);
    expect(secondBody.data.id).toBe(firstBody.data.id);
    expect(assertTakeoffEnabled).toHaveBeenCalledTimes(1);
  });

  it("returns 409 when idempotency key is reused with a different payload", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const headers = { "idempotency-key": "same-key" };

    await POST(
      buildTakeoffRequest({
        headers,
        fileContent: "designation;quantity;unit\nTube PVC;12;ml",
      })
    );

    const conflictResponse = await POST(
      buildTakeoffRequest({
        headers,
        fileContent: "designation;quantity;unit\nTube Cuivre;3;ml",
      })
    );
    const body = (await conflictResponse.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(conflictResponse.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("rolls back uploaded file when concurrent conflict reuses idempotency key", async () => {
    const supabase = createSupabaseMock({
      simulateInsertConflictAfterUpload: true,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const response = await POST(
      buildTakeoffRequest({
        headers: { "idempotency-key": "same-key" },
        fileContent: "designation;quantity;unit\nTube PVC;12;ml",
      })
    );
    const body = (await response.json()) as {
      ok: boolean;
      error?: { code?: string };
    };

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(supabase.__state.uploads).toHaveLength(1);
    expect(supabase.__state.removals).toHaveLength(0);
    expect(createServiceRoleClientMock).toHaveBeenCalledOnce();
    expect(serviceRoleRemoveMock).toHaveBeenCalledWith([
      supabase.__state.uploads[0],
    ]);
  });

  it("returns 201 even when edge trigger fails", async () => {
    const supabase = createSupabaseMock();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    vi.mocked(triggerTakeoffJobProcessing).mockResolvedValue({
      triggered: false,
      correlationId: "11111111-1111-4111-8111-111111111111",
      statusCode: null,
    });

    const response = await POST(buildTakeoffRequest());
    const body = (await response.json()) as {
      ok: boolean;
      data?: { id: string; status: string };
    };

    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data?.status).toBe("pending");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Takeoff job created but async processing trigger failed.",
      expect.objectContaining({
        jobId: expect.any(String),
        correlationId: "11111111-1111-4111-8111-111111111111",
      })
    );

    consoleErrorSpy.mockRestore();
  });
});
