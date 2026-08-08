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
    expect(result.totals).toBeNull();
    expect(result.stats).toEqual({
      totalRows: 1,
      validRows: 1,
      invalidRows: 0,
      insertedRows: 0,
      skippedRows: 1,
      insertedSections: 0,
      zeroPriceRows: 0,
      ignoredRows: 0,
      ignoredFooterRows: 0,
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
      totals: {
        totalHtCents: 22000,
        totalTaxCents: 4400,
        totalTtcCents: 26400,
      },
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

  it("sends reviewed sections, source provenance, and operational lines to the RPC", async () => {
    const rawStructure = (sourceRowNumber: number, bold: boolean) => ({
      sheet_name: "plb Z3-5",
      source_row_number: sourceRowNumber,
      bold_columns: bold ? ["column_1"] : [],
      merged_columns: [],
      outline_level: null,
      column_order: ["column_1", "Qte", "U", "PR._FO", "h_MO", "commentaire"],
    });
    const supabase = createSupabaseStub({
      membershipBuilder: createMembershipBuilder(),
      importBuilder: createImportSelectBuilder(PROJECT_ID),
      projectBuilder: createProjectSelectBuilder(true),
      latestMappingBuilder: createLatestMappingBuilder("mapping-latest"),
      mappedRowsBuilder: createMappedRowsBuilder([
        {
          id: "mapped-section-l1",
          payload: {
            row_index: 0,
            raw_row: {
              column_1: "Eaux usées",
              _timax_structure: rawStructure(2, true),
            },
            mapped_row: {
              designation: "Eaux usées",
            },
          },
        },
        {
          id: "mapped-section-l2",
          payload: {
            row_index: 1,
            raw_row: {
              column_1: "EUEV",
              _timax_structure: rawStructure(3, true),
            },
            mapped_row: {
              designation: "EUEV",
            },
          },
        },
        {
          id: "mapped-line",
          payload: {
            row_index: 2,
            raw_row: {
              column_1: "Tube acier DN100",
              _timax_structure: rawStructure(4, false),
              _timax_provenance: {
                source_page: 7,
                table_index: 0,
                extraction_method: "tabular_pdf",
                source_document_id: "source-document-1",
              },
            },
            mapped_row: {
              designation: "Tube acier DN100",
              quantity: 200,
              unit: "ml",
              unit_price_ht: 40.74,
              labor_hours: 1.2,
              notes: "Sous-sol",
            },
          },
        },
        {
          id: "mapped-footer",
          payload: {
            row_index: 3,
            raw_row: {
              column_1: "TOTAL HT",
              _timax_structure: rawStructure(5, true),
            },
            mapped_row: {
              designation: "TOTAL HT",
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
            inserted_count: 1,
            total_ht_cents: 814800,
            total_tax_cents: 162960,
            total_ttc_cents: 977760,
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
      structurePlan: {
        decisions: [
          { rowIndex: 0, kind: "section", level: 1 },
          { rowIndex: 1, kind: "section", level: 2 },
        ],
      },
    });

    const rpcCall = vi.mocked(supabase.rpc).mock.calls[0];
    const payload = rpcCall?.[1] as {
      p_lines: Array<Record<string, unknown>>;
    } | undefined;

    expect(payload?.p_lines.map((item) => item.item_type)).toEqual([
      "section",
      "section",
      "line",
    ]);
    expect(payload?.p_lines[1]).toMatchObject({
      title: "EUEV",
      section_level: 2,
      source_metadata: {
        import_id: IMPORT_ID,
        mapping_id: "mapping-latest",
        sheet_name: "plb Z3-5",
        source_row_number: 3,
      },
    });
    expect(payload?.p_lines[2]).toMatchObject({
      title: "Tube acier DN100",
      description: "ml",
      quantity: 200,
      unit_price_ht_cents: 4074,
      h_mo: 1.2,
      notes: "Sous-sol",
      source_page: 7,
      source_metadata: {
        notes: "Sous-sol",
        import_id: IMPORT_ID,
        mapping_id: "mapping-latest",
        sheet_name: "plb Z3-5",
        source_row_number: 4,
        _timax_structure: expect.objectContaining({
          sheet_name: "plb Z3-5",
          source_row_number: 4,
        }),
        _timax_provenance: {
          source_page: 7,
          table_index: 0,
          extraction_method: "tabular_pdf",
          source_document_id: "source-document-1",
        },
      },
    });
    expect(result.stats).toMatchObject({
      insertedRows: 1,
      insertedSections: 2,
      zeroPriceRows: 0,
      ignoredRows: 1,
      ignoredFooterRows: 1,
      skippedRows: 1,
    });
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
      "La version source du carry-over takeoff a change. Rechargez la confirmation avant de creer le chiffrage."
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
