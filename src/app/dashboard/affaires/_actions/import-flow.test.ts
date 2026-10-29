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

vi.mock("@/lib/estimates/canonical-v2-creation", () => ({
  persistCanonicalEstimateV2: vi.fn(),
}));

import { confirmUnifiedImportFlow } from "@/app/dashboard/affaires/_actions/import-flow";
import { createMapping } from "@/lib/mappings/server";
import { persistCanonicalEstimateV2 } from "@/lib/estimates/canonical-v2-creation";
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
        filename: "dpgf.xlsx",
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
    range: vi.fn(),
    then: vi.fn(),
  };

  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  const result = { data: rows, error: null, count: rows.length };
  builder.then.mockImplementation((resolve: (value: typeof result) => unknown) =>
    Promise.resolve(result).then(resolve)
  );
  builder.range.mockImplementation((from: number, to: number) =>
    Promise.resolve({ ...result, data: rows.slice(from, to + 1) })
  );

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

// Lot 2, sous-lot 2.8: the tenant calc policy decides whether the import creates a v3. Since 2.10b (M8) an absent
// policy means engine 3: the v2 cases run under the explicit policy 2 (D-i).
function createCalcPolicyBuilder(
  policy: { engine: number; fo: number | null; mo: number | null } | null = { engine: 2, fo: null, mo: null },
) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
  };

  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue({
    data: policy
      ? {
          tenant_id: TENANT_ID,
          new_estimate_calc_engine: policy.engine,
          default_sale_coefficient_fo: policy.fo,
          default_sale_coefficient_mo: policy.mo,
          allowed_tax_rates_bp: [2000],
        }
      : null,
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
  calcPolicyBuilder?: ReturnType<typeof createCalcPolicyBuilder>;
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
    tenant_calc_policies: [input.calcPolicyBuilder ?? createCalcPolicyBuilder()],
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
    vi.mocked(persistCanonicalEstimateV2).mockResolvedValue({
      project: { id: PROJECT_ID },
      version: {
        id: VERSION_ID,
        total_ht_cents: 22000,
        total_tax_cents: 4400,
        total_ttc_cents: 26400,
      },
      insertedLineCount: 1,
      insertedSectionCount: 1,
      rootSectionId: "77777777-7777-4777-8777-777777777777",
    } as never);
  });

  it("rejects version creation when the previewed carry-over source version changed", async () => {
    const currentSourceVersionId = "77777777-7777-4777-8777-777777777777";
    const previewSourceVersionId = "88888888-8888-4888-8888-888888888888";
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
      versionContextBuilder: createVersionContextBuilder(currentSourceVersionId, 1, 2000),
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      confirmUnifiedImportFlow({
        importId: IMPORT_ID,
        projectId: PROJECT_ID,
        createEstimate: true,
        previewSourceVersionId,
      })
    ).rejects.toThrow(
      "La version source du carry-over takeoff a change. Rechargez la confirmation avant de créer le chiffrage."
    );

    expect(supabase.rpc).not.toHaveBeenCalled();
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
    vi.mocked(persistCanonicalEstimateV2).mockResolvedValueOnce({
      project: { id: PROJECT_ID },
      version: {
        id: VERSION_ID,
        total_ht_cents: 10000,
        total_tax_cents: 2000,
        total_ttc_cents: 12000,
      },
      insertedLineCount: 1,
      insertedSectionCount: 1,
      rootSectionId: "77777777-7777-4777-8777-777777777777",
    } as never);

    const result = await confirmUnifiedImportFlow({
      importId: IMPORT_ID,
      projectId: PROJECT_ID,
      createEstimate: true,
      previewSourceVersionId: sourceVersionId,
    });

    expect(result.versionId).toBe(VERSION_ID);
    expect(result.totals).toEqual({
      totalHtCents: 10000,
      totalTaxCents: 2000,
      totalTtcCents: 12000,
    });
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
    ).rejects.toThrow("Cet import est déjà lié a une autre affaire.");
  });
});
