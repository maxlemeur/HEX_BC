import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/mappings/server", () => ({
  createMapping: vi.fn(),
}));

import { revalidatePath } from "next/cache";

import {
  confirmUnifiedImportFlow,
  getUnifiedImportFlowTakeoffCarryOverPreview,
} from "@/app/dashboard/affaires/_actions/import-flow";
import { createMapping } from "@/lib/mappings/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const IMPORT_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const VERSION_ID = "66666666-6666-4666-8666-666666666666";

function createMembershipBuilder(role: "engineer" | "admin" = "engineer") {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockResolvedValue({
    data: [{ tenant_id: TENANT_ID, role }],
    error: null,
  });

  return builder;
}

function createImportSelectBuilder(projectId: string | null) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };

  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue({
    data: {
      id: IMPORT_ID,
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      project_id: projectId,
    },
    error: null,
  });

  return builder;
}

function createProjectSelectBuilder(found = true) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };

  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue({
    data: found ? { id: PROJECT_ID } : null,
    error: null,
  });

  return builder;
}

function createLatestMappingBuilder(mappingId: string | null) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
  };

  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue({
    data: mappingId ? { id: mappingId } : null,
    error: null,
  });

  return builder;
}

function createMappedRowsBuilder(rows: unknown[]) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
  };

  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockImplementation(() => {
    if (builder.order.mock.calls.length === 1) {
      return builder;
    }

    return Promise.resolve({
      data: rows,
      error: null,
    });
  });

  return builder;
}

function createVersionContextBuilder(
  sourceVersionId: string | null = null,
  marginMultiplier = 1.2,
  taxRateBp = 2000
) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
  };

  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue({
    data: {
      id: sourceVersionId,
      margin_multiplier: marginMultiplier,
      tax_rate_bp: taxRateBp,
    },
    error: null,
  });

  return builder;
}

function createSupabaseStub(input: {
  membershipBuilder: ReturnType<typeof createMembershipBuilder>;
  importBuilder?: ReturnType<typeof createImportSelectBuilder>;
  projectBuilder?: ReturnType<typeof createProjectSelectBuilder>;
  latestMappingBuilder?: ReturnType<typeof createLatestMappingBuilder>;
  mappedRowsBuilder?: ReturnType<typeof createMappedRowsBuilder>;
  versionContextBuilder?: ReturnType<typeof createVersionContextBuilder>;
  rpcResult?: {
    data: unknown;
    error: unknown;
  };
}) {
  const tableQueues: Record<string, unknown[]> = {
    tenant_memberships: [input.membershipBuilder],
    dpgf_imports: input.importBuilder ? [input.importBuilder] : [],
    estimate_projects: input.projectBuilder ? [input.projectBuilder] : [],
    dpgf_mappings: input.latestMappingBuilder ? [input.latestMappingBuilder] : [],
    dpgf_rows_mapped: input.mappedRowsBuilder ? [input.mappedRowsBuilder] : [],
    estimate_versions: input.versionContextBuilder ? [input.versionContextBuilder] : [],
  };

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      const queue = tableQueues[table] ?? [];
      const builder = queue.shift();
      if (!builder) {
        throw new Error(`Unexpected table access: ${table}`);
      }
      return builder;
    }),
    rpc: vi.fn().mockResolvedValue(
      input.rpcResult ?? {
        data: [],
        error: null,
      }
    ),
  };

  return supabase;
}

describe("confirmUnifiedImportFlow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createMapping).mockResolvedValue({
      mapping: {
        id: "mapping-created",
      },
    } as never);
  });

  it("returns mapping_only when createEstimate=false and no projectId", async () => {
    const supabase = createSupabaseStub({
      membershipBuilder: createMembershipBuilder(),
      importBuilder: createImportSelectBuilder(null),
      latestMappingBuilder: createLatestMappingBuilder("mapping-latest"),
      mappedRowsBuilder: createMappedRowsBuilder([
        {
          id: "mapped-1",
          payload: {
            mapped_row: {
              designation: "Cable",
              quantity: "2",
              unit_price_ht: "12.5",
            },
          },
        },
      ]),
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await confirmUnifiedImportFlow({
      importId: IMPORT_ID,
      createEstimate: false,
    });

    expect(result.mode).toBe("mapping_only");
    expect(result.projectId).toBeNull();
    expect(result.mappingId).toBe("mapping-latest");
    expect(result.versionId).toBeNull();
    expect(result.stats).toEqual({
      totalRows: 1,
      validRows: 1,
      invalidRows: 0,
      insertedRows: 0,
      skippedRows: 1,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/imports");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/mappings");
  });

  it("rejects createEstimate=true without projectId", async () => {
    const supabase = createSupabaseStub({
      membershipBuilder: createMembershipBuilder(),
      importBuilder: createImportSelectBuilder(null),
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      confirmUnifiedImportFlow({
        importId: IMPORT_ID,
        createEstimate: true,
      })
    ).rejects.toThrow("projectId est requis pour creer un chiffrage.");
  });

  it("creates a new estimate version from valid mapped rows", async () => {
    const supabase = createSupabaseStub({
      membershipBuilder: createMembershipBuilder(),
      importBuilder: createImportSelectBuilder(PROJECT_ID),
      projectBuilder: createProjectSelectBuilder(true),
      latestMappingBuilder: createLatestMappingBuilder("mapping-latest"),
      mappedRowsBuilder: createMappedRowsBuilder([
        {
          id: "mapped-1",
          payload: {
            row_index: 1,
            mapped_row: {
              designation: "Poste A",
              quantity: "2",
              unit_price_ht: "100",
            },
          },
        },
      ]),
      versionContextBuilder: createVersionContextBuilder(null, 1.1, 2000),
      rpcResult: {
        data: [
          {
            version_id: VERSION_ID,
            section_id: "77777777-7777-4777-8777-777777777777",
            inserted_count: 1,
            total_ht_cents: 22000,
            total_tax_cents: 4400,
            total_ttc_cents: 26400,
          },
        ],
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await confirmUnifiedImportFlow({
      importId: IMPORT_ID,
      projectId: PROJECT_ID,
      createEstimate: true,
      versionTitle: "Import test",
      sectionTitle: "Section import",
    });

    expect(result).toMatchObject({
      mode: "version_created",
      importId: IMPORT_ID,
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      redirectTo: `/dashboard/estimates/${VERSION_ID}/edit`,
      stats: {
        totalRows: 1,
        validRows: 1,
        invalidRows: 0,
        insertedRows: 1,
        skippedRows: 0,
      },
      takeoffCarryOver: null,
    });
    expect(supabase.rpc).toHaveBeenCalledWith("create_estimate_version_from_import_lines", {
      p_project_id: PROJECT_ID,
      p_import_id: IMPORT_ID,
      p_version_title: "Import test",
      p_section_title: "Section import",
      p_lines: expect.any(Array),
    });
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/affaires/${PROJECT_ID}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/estimates/${VERSION_ID}/edit`);
  });

  it("sorts RPC lines by row_index before version creation", async () => {
    const supabase = createSupabaseStub({
      membershipBuilder: createMembershipBuilder(),
      importBuilder: createImportSelectBuilder(PROJECT_ID),
      projectBuilder: createProjectSelectBuilder(true),
      latestMappingBuilder: createLatestMappingBuilder("mapping-latest"),
      mappedRowsBuilder: createMappedRowsBuilder([
        {
          id: "mapped-b",
          payload: {
            row_index: 2,
            mapped_row: {
              designation: "Poste B",
              quantity: "1",
              unit_price_ht: "10",
            },
          },
        },
        {
          id: "mapped-a",
          payload: {
            row_index: 1,
            mapped_row: {
              designation: "Poste A",
              quantity: "1",
              unit_price_ht: "5",
            },
          },
        },
      ]),
      versionContextBuilder: createVersionContextBuilder(null, 1, 2000),
      rpcResult: {
        data: [
          {
            version_id: VERSION_ID,
            section_id: "77777777-7777-4777-8777-777777777777",
            inserted_count: 2,
            total_ht_cents: 1500,
            total_tax_cents: 300,
            total_ttc_cents: 1800,
          },
        ],
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await confirmUnifiedImportFlow({
      importId: IMPORT_ID,
      projectId: PROJECT_ID,
      createEstimate: true,
    });

    const rpcCall = vi.mocked(supabase.rpc).mock.calls[0];
    const payload = rpcCall?.[1] as { p_lines: Array<{ row_index: number }> } | undefined;
    expect(payload?.p_lines.map((line) => line.row_index)).toEqual([1, 2]);
  });

  it("keeps version creation non-blocking when takeoff carry-over cannot be resolved", async () => {
    const sourceVersionId = "77777777-7777-4777-8777-777777777777";
    const supabase = createSupabaseStub({
      membershipBuilder: createMembershipBuilder(),
      importBuilder: createImportSelectBuilder(PROJECT_ID),
      projectBuilder: createProjectSelectBuilder(true),
      latestMappingBuilder: createLatestMappingBuilder("mapping-latest"),
      mappedRowsBuilder: createMappedRowsBuilder([
        {
          id: "mapped-1",
          payload: {
            row_index: 1,
            mapped_row: {
              designation: "Poste A",
              quantity: "1",
              unit_price_ht: "100",
            },
          },
        },
      ]),
      versionContextBuilder: createVersionContextBuilder(sourceVersionId, 1, 2000),
      rpcResult: {
        data: [
          {
            version_id: VERSION_ID,
            section_id: "77777777-7777-4777-8777-777777777777",
            inserted_count: 1,
            total_ht_cents: 10000,
            total_tax_cents: 2000,
            total_ttc_cents: 12000,
          },
        ],
        error: null,
      },
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await confirmUnifiedImportFlow({
      importId: IMPORT_ID,
      projectId: PROJECT_ID,
      createEstimate: true,
    });

    expect(result.versionId).toBe(VERSION_ID);
    expect(result.takeoffCarryOver).toEqual({
      summary: {
        sourceVersionId,
        sourceVersionNumber: null,
        state: "unavailable",
        totalJobs: 0,
        acquiredJobs: 0,
        inProgressJobs: 0,
        actionRequiredJobs: 0,
      },
      linkState: "failed",
      linkedJobs: 0,
      unlinkedJobs: 0,
    });
  });

  it("rejects import linked to another project", async () => {
    const supabase = createSupabaseStub({
      membershipBuilder: createMembershipBuilder(),
      importBuilder: createImportSelectBuilder(OTHER_PROJECT_ID),
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      confirmUnifiedImportFlow({
        importId: IMPORT_ID,
        projectId: PROJECT_ID,
        createEstimate: true,
      })
    ).rejects.toThrow("Cet import est deja lie a une autre affaire.");
  });

  it("rejects estimate creation when there are zero valid lines", async () => {
    const supabase = createSupabaseStub({
      membershipBuilder: createMembershipBuilder(),
      importBuilder: createImportSelectBuilder(PROJECT_ID),
      projectBuilder: createProjectSelectBuilder(true),
      latestMappingBuilder: createLatestMappingBuilder("mapping-latest"),
      mappedRowsBuilder: createMappedRowsBuilder([
        {
          id: "mapped-1",
          payload: {
            mapped_row: {
              quantity: "2",
              unit_price_ht: "10",
            },
          },
        },
      ]),
      versionContextBuilder: createVersionContextBuilder(null, 1, 2000),
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      confirmUnifiedImportFlow({
        importId: IMPORT_ID,
        projectId: PROJECT_ID,
        createEstimate: true,
      })
    ).rejects.toThrow("Aucune ligne valide a inserer pour creer le chiffrage.");

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("returns a not_applicable carry-over preview when the project has no source version", async () => {
    const supabase = createSupabaseStub({
      membershipBuilder: createMembershipBuilder(),
      projectBuilder: createProjectSelectBuilder(true),
      versionContextBuilder: createVersionContextBuilder(null, 1, 2000),
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await getUnifiedImportFlowTakeoffCarryOverPreview({
      projectId: PROJECT_ID,
    });

    expect(result).toEqual({
      sourceVersionId: null,
      sourceVersionNumber: null,
      state: "not_applicable",
      totalJobs: 0,
      acquiredJobs: 0,
      inProgressJobs: 0,
      actionRequiredJobs: 0,
    });
  });
});
