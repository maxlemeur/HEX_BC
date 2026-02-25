import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
}));

import { PATCH } from "@/app/api/takeoff/jobs/[jobId]/items/route";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { assertTakeoffEnabled } from "@/lib/takeoff/feature-flags";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const ITEM_ID_1 = "44444444-4444-4444-8444-444444444444";
const ITEM_ID_2 = "55555555-5555-4555-8555-555555555555";
const ITEM_ID_3 = "66666666-6666-4666-8666-666666666666";
const UPDATED_AT = "2026-02-25T10:00:00.000Z";
const STALE_UPDATED_AT = "2026-02-24T10:00:00.000Z";
const VERSION_ID = "77777777-7777-4777-8777-777777777777";

type StoredItem = {
  id: string;
  job_id: string;
  tenant_id: string;
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

function makeItem(overrides: Partial<StoredItem> = {}): StoredItem {
  return {
    id: ITEM_ID_1,
    job_id: JOB_ID,
    tenant_id: TENANT_ID,
    designation: "Tube PVC 100mm",
    quantity: 12,
    unit: "ml",
    confidence: 0.85,
    evidence: "ligne 3 du fichier",
    source_file_name: "niveau-a.csv",
    source_page: 1,
    metadata: { category: "tuyauterie" },
    is_excluded: false,
    exclusion_reason: null,
    is_verified: false,
    verified_at: null,
    verified_by: null,
    created_at: "2026-02-25T09:00:00.000Z",
    updated_at: UPDATED_AT,
    ...overrides,
  };
}

type SupabaseMockOptions = {
  jobStatus?: string;
  missingJob?: boolean;
  items?: StoredItem[];
};

function createSupabaseMock(options: SupabaseMockOptions = {}) {
  const storedItems = new Map<string, StoredItem>();
  for (const item of options.items ?? [makeItem()]) {
    storedItems.set(item.id, { ...item });
  }

  const audits: Array<Record<string, unknown>> = [];

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

  const supabase = {
    __state: { storedItems, audits },
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return { select: vi.fn(() => membershipBuilder) };
      }

      if (table === "takeoff_jobs") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, string> = {};
            const builder = {
              eq: vi.fn((col: string, val: string) => {
                filters[col] = val;
                return builder;
              }),
              maybeSingle: vi.fn(async () => {
                if (options.missingJob) return { data: null, error: null };
                return {
                  data: {
                    id: JOB_ID,
                    estimate_version_id: VERSION_ID,
                    status: options.jobStatus ?? "completed",
                    level: "A",
                    source_file_name: "niveau-a.csv",
                    source_file_type: "text/csv",
                    source_file_size_bytes: 100,
                    source_file_path: null,
                    prompt_version: "1.0",
                    schema_version: null,
                    model: null,
                    thinking_level: null,
                    media_resolution: null,
                    retry_count: 0,
                    next_retry_at: null,
                    last_error_at: null,
                    token_count: null,
                    cost_cents: null,
                    duration_ms: null,
                    started_at: null,
                    completed_at: "2026-02-25T10:00:00.000Z",
                    error_code: null,
                    error_message: null,
                    created_at: "2026-02-25T09:00:00.000Z",
                    updated_at: "2026-02-25T10:00:00.000Z",
                    created_by: USER_ID,
                  },
                  error: null,
                };
              }),
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
              eq: vi.fn((col: string, val: string) => {
                filters[col] = val;
                return builder;
              }),
              maybeSingle: vi.fn(async () => {
                const itemId = filters.id;
                const item = itemId ? storedItems.get(itemId) : null;
                if (!item || item.tenant_id !== filters.tenant_id) {
                  return { data: null, error: null };
                }
                return { data: { ...item }, error: null };
              }),
            };
            return builder;
          }),
          update: vi.fn((payload: Record<string, unknown>) => {
            const filters: Record<string, string> = {};
            const builder = {
              eq: vi.fn((col: string, val: string) => {
                filters[col] = val;
                return builder;
              }),
              select: vi.fn(() => ({
                maybeSingle: vi.fn(async () => {
                  const itemId = filters.id;
                  const item = itemId ? storedItems.get(itemId) : null;
                  if (!item) return { data: null, error: null };

                  const updated = { ...item, ...payload };
                  storedItems.set(itemId, updated as StoredItem);
                  return { data: { ...updated }, error: null };
                }),
              })),
            };
            return builder;
          }),
        };
      }

      if (table === "audit_logs") {
        return {
          insert: vi.fn(async (payload: Record<string, unknown>) => {
            audits.push(payload);
            return { data: null, error: null };
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return supabase;
}

function buildPatchRequest(
  jobId: string,
  body: unknown
): [Request, { params: Promise<{ jobId: string }> }] {
  return [
    new Request(`http://localhost/api/takeoff/jobs/${jobId}/items`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ jobId }) },
  ];
}

describe("PATCH /api/takeoff/jobs/[jobId]/items", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
  });

  it("returns 200 with updated items on valid batch patch", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const [request, context] = buildPatchRequest(JOB_ID, {
      items: [
        {
          item_id: ITEM_ID_1,
          updated_at: UPDATED_AT,
          fields: { designation: "Tube PVC 150mm" },
        },
      ],
    });

    const response = await PATCH(request, context);
    const body = (await response.json()) as {
      ok: boolean;
      data?: { succeeded: number; failed: number; results: unknown[] };
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data?.succeeded).toBe(1);
    expect(body.data?.failed).toBe(0);
  });

  it("returns 422 when no items are provided", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const [request, context] = buildPatchRequest(JOB_ID, {
      items: [],
    });

    const response = await PATCH(request, context);
    const body = (await response.json()) as { ok: boolean; error?: { code?: string } };

    expect(response.status).toBe(422);
    expect(body.ok).toBe(false);
  });

  it("returns 422 when quantity is negative", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const [request, context] = buildPatchRequest(JOB_ID, {
      items: [
        {
          item_id: ITEM_ID_1,
          updated_at: UPDATED_AT,
          fields: { quantity: -5 },
        },
      ],
    });

    const response = await PATCH(request, context);
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(422);
    expect(body.ok).toBe(false);
  });

  it("returns 422 when is_excluded=true without exclusion_reason", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const [request, context] = buildPatchRequest(JOB_ID, {
      items: [
        {
          item_id: ITEM_ID_1,
          updated_at: UPDATED_AT,
          fields: { is_excluded: true },
        },
      ],
    });

    const response = await PATCH(request, context);
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(422);
    expect(body.ok).toBe(false);
  });

  it("handles OCC conflict per item", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const [request, context] = buildPatchRequest(JOB_ID, {
      items: [
        {
          item_id: ITEM_ID_1,
          updated_at: STALE_UPDATED_AT,
          fields: { designation: "Updated" },
        },
      ],
    });

    const response = await PATCH(request, context);
    const body = (await response.json()) as {
      ok: boolean;
      data?: { succeeded: number; failed: number; results: Array<{ success: boolean; error?: string }> };
    };

    expect(response.status).toBe(200);
    expect(body.data?.failed).toBe(1);
    expect(body.data?.results[0]?.success).toBe(false);
    expect(body.data?.results[0]?.error).toMatch(/concurrence/i);
  });

  it("handles partial success with multiple items", async () => {
    const items = [
      makeItem({ id: ITEM_ID_1, updated_at: UPDATED_AT }),
      makeItem({ id: ITEM_ID_2, updated_at: UPDATED_AT }),
      makeItem({ id: ITEM_ID_3, updated_at: STALE_UPDATED_AT }),
    ];
    const supabase = createSupabaseMock({ items });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const [request, context] = buildPatchRequest(JOB_ID, {
      items: [
        {
          item_id: ITEM_ID_1,
          updated_at: UPDATED_AT,
          fields: { designation: "A" },
        },
        {
          item_id: ITEM_ID_2,
          updated_at: UPDATED_AT,
          fields: { designation: "B" },
        },
        {
          item_id: ITEM_ID_3,
          updated_at: "1999-01-01T00:00:00.000Z",
          fields: { designation: "C" },
        },
      ],
    });

    const response = await PATCH(request, context);
    const body = (await response.json()) as {
      ok: boolean;
      data?: { succeeded: number; failed: number };
    };

    expect(response.status).toBe(200);
    expect(body.data?.succeeded).toBe(2);
    expect(body.data?.failed).toBe(1);
  });

  it("returns 404 when job does not exist", async () => {
    const supabase = createSupabaseMock({ missingJob: true });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const [request, context] = buildPatchRequest(JOB_ID, {
      items: [
        {
          item_id: ITEM_ID_1,
          updated_at: UPDATED_AT,
          fields: { designation: "test" },
        },
      ],
    });

    const response = await PATCH(request, context);
    const body = (await response.json()) as { ok: boolean; error?: { code?: string } };

    expect(response.status).toBe(404);
    expect(body.ok).toBe(false);
  });

  it("returns 409 when job status is not completed", async () => {
    const supabase = createSupabaseMock({ jobStatus: "processing" });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const [request, context] = buildPatchRequest(JOB_ID, {
      items: [
        {
          item_id: ITEM_ID_1,
          updated_at: UPDATED_AT,
          fields: { designation: "test" },
        },
      ],
    });

    const response = await PATCH(request, context);
    const body = (await response.json()) as { ok: boolean; error?: { code?: string } };

    expect(response.status).toBe(409);
    expect(body.ok).toBe(false);
  });

  it("returns 403 when takeoff feature flag is disabled", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    const { forbidden } = await import("@/lib/estimates/errors");
    vi.mocked(assertTakeoffEnabled).mockRejectedValue(
      forbidden(
        "Le module Takeoff est desactive pour ce tenant.",
        undefined,
        "TAKEOFF_MODULE_DISABLED"
      )
    );

    const [request, context] = buildPatchRequest(JOB_ID, {
      items: [
        {
          item_id: ITEM_ID_1,
          updated_at: UPDATED_AT,
          fields: { designation: "test" },
        },
      ],
    });

    const response = await PATCH(request, context);
    const body = (await response.json()) as { ok: boolean; error?: { code?: string } };

    expect(response.status).toBe(403);
    expect(body.ok).toBe(false);
  });

  it("logs audit events for item modifications", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const [request, context] = buildPatchRequest(JOB_ID, {
      items: [
        {
          item_id: ITEM_ID_1,
          updated_at: UPDATED_AT,
          fields: {
            designation: "Updated Name",
            is_excluded: true,
            exclusion_reason: "Doublon",
          },
        },
      ],
    });

    await PATCH(request, context);

    // Should have audit events for designation change + exclusion
    expect(supabase.__state.audits.length).toBeGreaterThanOrEqual(1);
  });
});
