import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  assertDraftStatus: vi.fn(),
  bulkUpdateEstimateItems: vi.fn(),
  getAuthenticatedContext: vi.fn(),
  insertAssemblyIntoVersion: vi.fn(),
}));

vi.mock("@/lib/takeoff/feature-flags", () => ({
  assertTakeoffEnabled: vi.fn(),
  getTakeoffLowConfidenceThresholdForTenant: vi.fn(),
}));

import {
  bulkUpdateEstimateItems,
  getAuthenticatedContext,
  insertAssemblyIntoVersion,
} from "@/lib/estimates/server";
import {
  assertTakeoffEnabled,
  getTakeoffLowConfidenceThresholdForTenant,
} from "@/lib/takeoff/feature-flags";
import { applyTakeoffJob } from "@/lib/takeoff/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const SECTION_ID = "55555555-5555-4555-8555-555555555555";
const CREATED_ITEM_ID = "77777777-7777-4777-8777-777777777777";
const TAKEOFF_ITEM_ID_1 = "88888888-8888-4888-8888-888888888888";
const TAKEOFF_ITEM_ID_2 = "99999999-9999-4999-8999-999999999999";
const VERSION_UPDATED_AT = "2026-02-25T12:00:00.000Z";

type StoredTakeoffJob = {
  id: string;
  estimate_version_id: string;
  tenant_id: string;
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

type SupabaseMockOptions = {
  jobStatus?: string;
  jobLevel?: string;
  takeoffItems?: StoredTakeoffItem[];
  mappingRules?: Array<{
    id: string;
    name: string;
    match_pattern: string;
    match_type: "exact" | "contains" | "regex";
    action: "rename" | "set_price" | "set_category" | "apply_assembly" | "skip";
    action_params: Record<string, unknown>;
    priority: number;
    is_active: boolean;
    created_at: string;
  }>;
  rpcError?: {
    code?: string;
    message?: string;
    details?: string | null;
    hint?: string | null;
  };
  auditError?: {
    code?: string;
    message?: string;
    details?: string | null;
    hint?: string | null;
  };
};

function baseJob(overrides: Partial<StoredTakeoffJob> = {}): StoredTakeoffJob {
  return {
    id: JOB_ID,
    estimate_version_id: VERSION_ID,
    tenant_id: TENANT_ID,
    status: "completed",
    level: "A",
    source_file_name: "niveau-a.csv",
    source_file_type: "text/csv",
    source_file_size_bytes: 1024,
    source_file_path: `${TENANT_ID}/${JOB_ID}/source.csv`,
    prompt_version: "takeoff-a-v1",
    schema_version: "v1",
    model: "gemini-3-flash-preview",
    thinking_level: "high",
    media_resolution: null,
    retry_count: 0,
    next_retry_at: null,
    last_error_at: null,
    token_count: 120,
    cost_cents: 4,
    duration_ms: 5000,
    started_at: "2026-02-25T11:59:00.000Z",
    completed_at: "2026-02-25T12:00:00.000Z",
    error_code: null,
    error_message: null,
    created_at: "2026-02-25T11:58:00.000Z",
    updated_at: "2026-02-25T12:00:00.000Z",
    created_by: USER_ID,
    ...overrides,
  };
}

function baseTakeoffItem(overrides: Partial<StoredTakeoffItem> = {}): StoredTakeoffItem {
  return {
    id: TAKEOFF_ITEM_ID_1,
    designation: "Tube PVC 100",
    quantity: 12,
    unit: "ml",
    confidence: 0.9,
    evidence: null,
    source_file_name: "niveau-a.csv",
    source_page: 1,
    metadata: {},
    is_excluded: false,
    exclusion_reason: null,
    is_verified: false,
    verified_at: null,
    verified_by: null,
    created_at: "2026-02-25T11:58:00.000Z",
    updated_at: "2026-02-25T11:58:00.000Z",
    ...overrides,
  };
}

function createSupabaseMock(options: SupabaseMockOptions = {}) {
  const state = {
    job: baseJob({
      status: options.jobStatus ?? "completed",
      level: options.jobLevel ?? "A",
    }),
    auditActions: [] as string[],
    takeoffItems:
      options.takeoffItems?.map((item) => ({ ...item })) ?? [baseTakeoffItem()],
    takeoffItemUpdateAppliedCount: 0,
    mappingRules: options.mappingRules ?? [],
  };

  const supabase = {
    __state: state,
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
              maybeSingle: vi.fn(async () => {
                const matchesTenant =
                  !filters.tenant_id || filters.tenant_id === state.job.tenant_id;
                const matchesId = !filters.id || filters.id === state.job.id;

                if (!matchesTenant || !matchesId) {
                  return { data: null, error: null };
                }

                return { data: { ...state.job }, error: null };
              }),
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
              maybeSingle: vi.fn(async () => {
                const matchesTenant = filters.tenant_id === TENANT_ID;
                const matchesVersion = filters.id === VERSION_ID;

                if (!matchesTenant || !matchesVersion) {
                  return { data: null, error: null };
                }

                return {
                  data: {
                    id: VERSION_ID,
                    updated_at: VERSION_UPDATED_AT,
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
          select: vi.fn((_columns?: string, opts?: { count?: "exact" }) => {
            const filters: Record<string, string> = {};
            const getScopedItems = () => {
              const matchesTenant = !filters.tenant_id || filters.tenant_id === TENANT_ID;
              const matchesJob = !filters.job_id || filters.job_id === JOB_ID;
              return matchesTenant && matchesJob ? state.takeoffItems : [];
            };
            const builder = {
              eq: vi.fn((column: string, value: string) => {
                filters[column] = value;
                return builder;
              }),
              order: vi.fn(() => builder),
              range: vi.fn(async (start: number, end: number) => {
                const scoped = getScopedItems();

                return {
                  data: scoped.slice(start, end + 1).map((item) => ({ ...item })),
                  count: opts?.count === "exact" ? scoped.length : null,
                  error: null,
                };
              }),
              then: (
                resolve: (value: {
                  data: StoredTakeoffItem[];
                  count: number | null;
                  error: null;
                }) => unknown
              ) =>
                resolve({
                  data: getScopedItems().map((item) => ({ ...item })),
                  count: opts?.count === "exact" ? getScopedItems().length : null,
                  error: null,
                }),
            };

            return builder;
          }),
          update: vi.fn((payload: Record<string, unknown>) => {
            const filters: Record<string, string> = {};
            const builder = {
              data: null,
              error: null as null,
              eq: vi.fn((column: string, value: string) => {
                filters[column] = value;
                if (filters.id && filters.job_id && filters.tenant_id) {
                  state.takeoffItemUpdateAppliedCount += 1;
                  state.takeoffItems = state.takeoffItems.map((item) =>
                    item.id === filters.id
                      ? {
                          ...item,
                          ...payload,
                        }
                      : item
                  );
                }
                return builder;
              }),
            };
            return builder;
          }),
        };
      }

      if (table === "takeoff_mapping_rules") {
        return {
          select: vi.fn(() => {
            const filters: Record<string, unknown> = {};
            const builder = {
              eq: vi.fn((column: string, value: unknown) => {
                filters[column] = value;
                return builder;
              }),
              order: vi.fn(() => builder),
              then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
                resolve({
                  data: state.mappingRules
                    .filter((rule) => {
                      if (filters.tenant_id && filters.tenant_id !== TENANT_ID) {
                        return false;
                      }
                      if (filters.is_active !== undefined) {
                        return rule.is_active === filters.is_active;
                      }
                      return true;
                    })
                    .map((rule) => ({
                      ...rule,
                      tenant_id: TENANT_ID,
                      created_by: USER_ID,
                      updated_at: rule.created_at,
                    })),
                  error: null,
                }),
            };
            return builder;
          }),
        };
      }

      if (table === "audit_logs") {
        return {
          insert: vi.fn(async (payload: Record<string, unknown>) => {
            if (typeof payload.action === "string") {
              state.auditActions.push(payload.action);
            }

            const error =
              payload.action === "takeoff.apply.override"
                ? options.auditError ?? null
                : null;
            return { data: null, error };
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn(async (fn: string) => {
      if (fn !== "apply_takeoff_job") {
        throw new Error(`Unexpected rpc function: ${fn}`);
      }

      if (options.rpcError) {
        return {
          data: null,
          error: options.rpcError,
        };
      }

      state.job = {
        ...state.job,
        status: "applied",
        updated_at: "2026-02-25T12:01:00.000Z",
      };

      return {
        data: {
          scope: "section",
          created_count: 1,
          updated_count: 0,
          ignored_count: 0,
          created_ids: [CREATED_ITEM_ID],
        },
        error: null,
      };
    }),
  };

  return supabase;
}

describe("applyTakeoffJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertTakeoffEnabled).mockResolvedValue(undefined);
    vi.mocked(getTakeoffLowConfidenceThresholdForTenant).mockResolvedValue(0.5);
    vi.mocked(insertAssemblyIntoVersion).mockResolvedValue({} as never);
  });

  it("applies a completed job, runs lock precheck and returns job+summary", async () => {
    const supabase = createSupabaseMock();
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);
    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: VERSION_UPDATED_AT,
      },
    } as never);

    const response = await applyTakeoffJob(JOB_ID, {
      strategy: "merge",
      target_section_id: SECTION_ID,
    });

    expect(vi.mocked(bulkUpdateEstimateItems)).toHaveBeenCalledWith(
      VERSION_ID,
      [],
      VERSION_UPDATED_AT
    );
    expect(supabase.rpc).toHaveBeenCalledWith(
      "apply_takeoff_job",
      expect.objectContaining({
        p_job_id: JOB_ID,
        p_strategy: "merge",
        p_target_section_id: SECTION_ID,
      })
    );
    expect(response.job.status).toBe("applied");
    expect(response.summary).toEqual({
      scope: "section",
      created_count: 1,
      updated_count: 0,
      ignored_count: 0,
      created_ids: [CREATED_ITEM_ID],
    });
    expect(supabase.__state.auditActions).toEqual([
      "takeoff.apply.started",
      "takeoff.apply.completed",
    ]);
  });

  it("maps rpc conflicts to TakeoffError and logs failed audit event", async () => {
    const supabase = createSupabaseMock({
      rpcError: {
        code: "P0001",
        message: "APPLY_CONFLICT",
        details: "already applied",
        hint: null,
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);
    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: VERSION_UPDATED_AT,
      },
    } as never);

    await expect(
      applyTakeoffJob(JOB_ID, {
        strategy: "merge",
        target_section_id: SECTION_ID,
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });

    expect(supabase.__state.auditActions).toEqual([
      "takeoff.apply.started",
      "takeoff.apply.failed",
    ]);
  });

  it("rolls back takeoff item pre-apply patches when apply RPC fails", async () => {
    const assemblyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const supabase = createSupabaseMock({
      mappingRules: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          name: "Ouvrage cloisons",
          match_pattern: "tube pvc",
          match_type: "contains",
          action: "apply_assembly",
          action_params: {
            assembly_id: assemblyId,
          },
          priority: 1,
          is_active: true,
          created_at: "2026-02-25T09:00:00.000Z",
        },
      ],
      rpcError: {
        code: "P0001",
        message: "APPLY_CONFLICT",
        details: "already applied",
        hint: null,
      },
    });

    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);
    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: VERSION_UPDATED_AT,
      },
    } as never);

    await expect(
      applyTakeoffJob(JOB_ID, {
        strategy: "merge",
        target_section_id: SECTION_ID,
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "CONFLICT",
    });

    expect(supabase.__state.takeoffItems[0]).toMatchObject({
      id: TAKEOFF_ITEM_ID_1,
      designation: "Tube PVC 100",
      is_excluded: false,
      exclusion_reason: null,
    });
    expect(supabase.__state.takeoffItemUpdateAppliedCount).toBe(2);
    expect(supabase.__state.auditActions).toEqual([
      "takeoff.apply.started",
      "takeoff.apply.failed",
    ]);
  });

  it("applies mapping action apply_assembly and logs mapping audit entries", async () => {
    const assemblyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const supabase = createSupabaseMock({
      mappingRules: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          name: "Ouvrage cloisons",
          match_pattern: "tube pvc",
          match_type: "contains",
          action: "apply_assembly",
          action_params: {
            assembly_id: assemblyId,
          },
          priority: 1,
          is_active: true,
          created_at: "2026-02-25T09:00:00.000Z",
        },
      ],
    });
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);
    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: VERSION_UPDATED_AT,
      },
    } as never);

    const response = await applyTakeoffJob(JOB_ID, {
      strategy: "merge",
      target_section_id: SECTION_ID,
    });

    expect(response.job.status).toBe("applied");
    expect(insertAssemblyIntoVersion).toHaveBeenCalledTimes(1);
    expect(insertAssemblyIntoVersion).toHaveBeenCalledWith({
      assemblyId,
      versionId: VERSION_ID,
      afterItemId: SECTION_ID,
    });
    expect(supabase.__state.auditActions).toContain("takeoff.mapping.applied");
    expect(supabase.__state.auditActions).toEqual([
      "takeoff.apply.started",
      "takeoff.mapping.applied",
      "takeoff.apply.completed",
    ]);
  });

  it("preserves apply_assembly insertion order by chaining anchor ids", async () => {
    const assemblyId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const insertedSectionId1 = "6cbe3a2a-41fd-4b98-8f02-3aa31a81f401";
    const insertedSectionId2 = "fd93367e-9069-4a54-b0ea-0d2229cc2115";
    const supabase = createSupabaseMock({
      takeoffItems: [
        baseTakeoffItem({
          id: TAKEOFF_ITEM_ID_1,
          designation: "Tube PVC 100",
          source_page: 1,
        }),
        baseTakeoffItem({
          id: TAKEOFF_ITEM_ID_2,
          designation: "Tube PVC 200",
          source_page: 2,
        }),
      ],
      mappingRules: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          name: "Ouvrage cloisons",
          match_pattern: "tube pvc",
          match_type: "contains",
          action: "apply_assembly",
          action_params: {
            assembly_id: assemblyId,
          },
          priority: 1,
          is_active: true,
          created_at: "2026-02-25T09:00:00.000Z",
        },
      ],
    });
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);
    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: VERSION_UPDATED_AT,
      },
    } as never);
    vi.mocked(insertAssemblyIntoVersion)
      .mockResolvedValueOnce({
        items: [{ id: insertedSectionId1, item_type: "section" }],
      } as never)
      .mockResolvedValueOnce({
        items: [{ id: insertedSectionId2, item_type: "section" }],
      } as never);

    const response = await applyTakeoffJob(JOB_ID, {
      strategy: "merge",
      target_section_id: SECTION_ID,
    });

    expect(response.job.status).toBe("applied");
    expect(insertAssemblyIntoVersion).toHaveBeenCalledTimes(2);
    expect(insertAssemblyIntoVersion).toHaveBeenNthCalledWith(1, {
      assemblyId,
      versionId: VERSION_ID,
      afterItemId: SECTION_ID,
    });
    expect(insertAssemblyIntoVersion).toHaveBeenNthCalledWith(2, {
      assemblyId,
      versionId: VERSION_ID,
      afterItemId: insertedSectionId1,
    });
  });

  it("blocks non-admin override attempts for level C guard failures", async () => {
    const supabase = createSupabaseMock({
      jobLevel: "C",
      takeoffItems: [
        baseTakeoffItem({
          id: TAKEOFF_ITEM_ID_1,
          confidence: 0.2,
          is_verified: false,
        }),
      ],
    });
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "site_manager",
    } as never);
    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: VERSION_UPDATED_AT,
      },
    } as never);

    await expect(
      applyTakeoffJob(JOB_ID, {
        strategy: "merge",
        target_section_id: SECTION_ID,
        override: true,
        override_justification: "Validation manuelle exceptionnelle",
      })
    ).rejects.toMatchObject({
      status: 403,
    });

    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.__state.auditActions).toEqual(["takeoff.apply.failed"]);
  });

  it("allows admin override and logs takeoff.apply.override", async () => {
    const supabase = createSupabaseMock({
      jobLevel: "C",
      takeoffItems: [
        baseTakeoffItem({
          id: TAKEOFF_ITEM_ID_1,
          confidence: 0.2,
          is_verified: false,
        }),
      ],
    });
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);
    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: VERSION_UPDATED_AT,
      },
    } as never);

    const response = await applyTakeoffJob(JOB_ID, {
      strategy: "merge",
      target_section_id: SECTION_ID,
      override: true,
      override_justification: "Validation manuelle exceptionnelle",
    });

    expect(response.job.status).toBe("applied");
    expect(supabase.__state.auditActions).toContain("takeoff.apply.override");
    expect(supabase.__state.auditActions).toEqual([
      "takeoff.apply.override",
      "takeoff.apply.started",
      "takeoff.apply.completed",
    ]);
  });

  it("fails closed when the required admin override audit cannot be persisted", async () => {
    const supabase = createSupabaseMock({
      jobLevel: "C",
      takeoffItems: [
        baseTakeoffItem({
          id: TAKEOFF_ITEM_ID_1,
          confidence: 0.2,
          is_verified: false,
        }),
      ],
      auditError: {
        code: "42501",
        message: "new row violates row-level security policy",
      },
    });
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);
    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: VERSION_UPDATED_AT,
      },
    } as never);

    await expect(
      applyTakeoffJob(JOB_ID, {
        strategy: "merge",
        target_section_id: SECTION_ID,
        override: true,
        override_justification: "Validation manuelle exceptionnelle",
      })
    ).rejects.toMatchObject({
      status: 403,
    });

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("uses tenant low-confidence threshold for level C guard", async () => {
    const supabase = createSupabaseMock({
      jobLevel: "C",
      takeoffItems: [
        baseTakeoffItem({
          id: TAKEOFF_ITEM_ID_1,
          confidence: 0.6,
          is_verified: false,
        }),
      ],
    });
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      supabase,
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
    } as never);
    vi.mocked(getTakeoffLowConfidenceThresholdForTenant).mockResolvedValue(0.7);
    vi.mocked(bulkUpdateEstimateItems).mockResolvedValue({
      updated_count: 0,
      version: {
        id: VERSION_ID,
        updated_at: VERSION_UPDATED_AT,
      },
    } as never);

    await expect(
      applyTakeoffJob(JOB_ID, {
        strategy: "merge",
        target_section_id: SECTION_ID,
      })
    ).rejects.toMatchObject({
      status: 422,
      code: "TAKEOFF_APPLY_GUARD_FAILED",
      details: {
        blocked_items: expect.arrayContaining([
          expect.objectContaining({ item_id: TAKEOFF_ITEM_ID_1 }),
        ]),
      },
    });

    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
