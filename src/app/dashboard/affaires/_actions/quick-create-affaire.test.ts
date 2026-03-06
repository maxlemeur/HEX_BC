import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/mappings/server", () => ({
  createMapping: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { quickCreateAffaire } from "@/app/dashboard/affaires/_actions/quick-create-affaire";
import { createMapping } from "@/lib/mappings/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const IMPORT_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const CREATED_PROJECT_ID = "77777777-7777-4777-8777-777777777777";
const CREATED_VERSION_ID = "88888888-8888-4888-8888-888888888888";

function createMembershipBuilder(role: "engineer" | "admin" | "viewer") {
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

function createImportUpdateBuilder() {
  const builder = {
    update: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn(),
  };

  builder.update.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.select.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue({
    data: { id: IMPORT_ID },
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

function createEstimateProjectsInsertBuilder(projectId: string) {
  const single = vi.fn().mockResolvedValue({
    data: { id: projectId },
    error: null,
  });
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));

  return {
    insert,
    select,
    single,
  };
}

function createEstimateVersionsInsertBuilder(versionId: string) {
  const single = vi.fn().mockResolvedValue({
    data: { id: versionId },
    error: null,
  });
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));

  return {
    insert,
    select,
    single,
  };
}

function createSupabaseStub(input: {
  role: "engineer" | "admin" | "viewer";
  importProjectId?: string | null;
  enableImportLinkUpdate?: boolean;
  mappedRows?: unknown[];
  createdProjectId?: string;
  latestMappingId?: string | null;
  rpcResult?: { data: unknown; error: unknown };
}) {
  const membershipBuilder = createMembershipBuilder(input.role);
  const importBuilder =
    input.importProjectId !== undefined
      ? createImportSelectBuilder(input.importProjectId)
      : null;
  const importUpdateBuilder = input.enableImportLinkUpdate
    ? createImportUpdateBuilder()
    : null;
  const mappedRowsBuilder = input.mappedRows
    ? createMappedRowsBuilder(input.mappedRows)
    : null;
  const latestMappingBuilder =
    input.importProjectId !== undefined
      ? createLatestMappingBuilder(input.latestMappingId ?? null)
      : null;
  const projectInsertBuilder = createEstimateProjectsInsertBuilder(
    input.createdProjectId ?? CREATED_PROJECT_ID
  );
  const versionInsertBuilder = createEstimateVersionsInsertBuilder(CREATED_VERSION_ID);

  const tableQueues: Record<string, unknown[]> = {
    tenant_memberships: [membershipBuilder],
    dpgf_imports: [
      ...(importBuilder ? [importBuilder] : []),
      ...(importUpdateBuilder ? [importUpdateBuilder] : []),
    ],
    dpgf_rows_mapped: mappedRowsBuilder ? [mappedRowsBuilder] : [],
    dpgf_mappings: latestMappingBuilder ? [latestMappingBuilder] : [],
    estimate_projects: [projectInsertBuilder],
    estimate_versions: [versionInsertBuilder],
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
      if (table === "estimate_projects") {
        return {
          insert: (builder as ReturnType<typeof createEstimateProjectsInsertBuilder>).insert,
        };
      }
      if (table === "estimate_versions") {
        return {
          insert: (builder as ReturnType<typeof createEstimateVersionsInsertBuilder>).insert,
        };
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

  return {
    supabase,
    projectInsertBuilder,
    versionInsertBuilder,
    importUpdateBuilder,
  };
}

describe("quickCreateAffaire", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createMapping).mockResolvedValue({
      mapping: { id: "mapping-created" },
    } as never);
    vi.mocked(redirect).mockImplementation((url: string) => {
      throw new Error(`NEXT_REDIRECT:${url}`);
    });
  });

  it("creates an empty project and redirects to affaire hub when no import is provided", async () => {
    const { supabase, projectInsertBuilder } = createSupabaseStub({
      role: "engineer",
      createdProjectId: CREATED_PROJECT_ID,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      quickCreateAffaire({
        projectName: "Affaire vide",
      })
    ).rejects.toThrow(`NEXT_REDIRECT:/dashboard/affaires/${CREATED_PROJECT_ID}?created=1`);

    expect(projectInsertBuilder.insert).toHaveBeenCalledWith({
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      name: "Affaire vide",
      client_name: null,
      reference: null,
      notes: null,
      is_archived: false,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/affaires");
    expect(revalidatePath).toHaveBeenCalledWith(
      `/dashboard/affaires/${CREATED_PROJECT_ID}`
    );
  });

  it("links uploaded import when creating an empty project from low-confidence flow", async () => {
    const { supabase, importUpdateBuilder } = createSupabaseStub({
      role: "engineer",
      importProjectId: null,
      enableImportLinkUpdate: true,
      createdProjectId: CREATED_PROJECT_ID,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      quickCreateAffaire({
        projectName: "Affaire import lie",
        importId: null,
        linkImportId: IMPORT_ID,
      })
    ).rejects.toThrow(`NEXT_REDIRECT:/dashboard/affaires/${CREATED_PROJECT_ID}?created=1`);

    expect(importUpdateBuilder?.update).toHaveBeenCalledWith({
      project_id: CREATED_PROJECT_ID,
    });
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("creates project+version from import and redirects to estimate editor", async () => {
    const { supabase } = createSupabaseStub({
      role: "engineer",
      importProjectId: null,
      mappedRows: [
        {
          id: "mapped-1",
          payload: {
            mapped_row: {
              designation: "Cable R2V",
              quantity: "2",
              unit_price_ht: "10.00",
            },
          },
        },
      ],
      rpcResult: {
        data: [
          {
            project_id: CREATED_PROJECT_ID,
            version_id: CREATED_VERSION_ID,
            section_id: "sec-1",
            inserted_count: 1,
            total_ht_cents: 2000,
            total_tax_cents: 400,
            total_ttc_cents: 2400,
          },
        ],
        error: null,
      },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      quickCreateAffaire({
        projectName: "Affaire importee",
        importId: IMPORT_ID,
        mapping: {
          Code: "hex_code",
          Designation: "designation",
          Quantite: "quantity",
          PU: "unit_price_ht",
        },
      })
    ).rejects.toThrow(
      `NEXT_REDIRECT:/dashboard/estimates/${CREATED_VERSION_ID}/edit?fromQuickCreate=1&projectId=${CREATED_PROJECT_ID}&importId=${IMPORT_ID}&insertedRows=1&skippedRows=0&mappingId=mapping-created`
    );

    expect(createMapping).toHaveBeenCalledWith({
      import_id: IMPORT_ID,
      mapping: {
        Code: "hex_code",
        Designation: "designation",
        Quantite: "quantity",
        PU: "unit_price_ht",
      },
      save_template: false,
    });
    expect(supabase.rpc).toHaveBeenCalledWith("create_affaire_from_import_lines", {
      p_import_id: IMPORT_ID,
      p_project_name: "Affaire importee",
      p_project_client: null,
      p_project_reference: null,
      p_version_title: null,
      p_section_title: null,
      p_lines: expect.any(Array),
    });
    expect(revalidatePath).toHaveBeenCalledWith(
      `/dashboard/affaires/${CREATED_PROJECT_ID}`
    );
    expect(revalidatePath).toHaveBeenCalledWith(
      `/dashboard/estimates/${CREATED_VERSION_ID}/edit`
    );
  });

  it("rejects import already linked to another project", async () => {
    const { supabase } = createSupabaseStub({
      role: "engineer",
      importProjectId: OTHER_PROJECT_ID,
      mappedRows: [],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      quickCreateAffaire({
        projectName: "Affaire conflict",
        importId: IMPORT_ID,
      })
    ).rejects.toThrow("Cet import est deja lie a une autre affaire.");

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("creates an empty affaire without linking a non-importable source", async () => {
    const { supabase, importUpdateBuilder, projectInsertBuilder, versionInsertBuilder } =
      createSupabaseStub({
        role: "engineer",
        importProjectId: null,
        enableImportLinkUpdate: true,
        mappedRows: [
          {
            id: "mapped-invalid",
            payload: {
              mapped_row: {
                designation: "",
                quantity: "0",
              },
            },
          },
        ],
      });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      quickCreateAffaire({
        projectName: "Affaire invalide",
        importId: IMPORT_ID,
      })
    ).rejects.toThrow(`NEXT_REDIRECT:/dashboard/affaires/${CREATED_PROJECT_ID}?created=1`);

    expect(projectInsertBuilder.insert).toHaveBeenCalledTimes(1);
    expect(versionInsertBuilder.insert).toHaveBeenCalledWith({
      project_id: CREATED_PROJECT_ID,
      version_number: 1,
    });
    expect(importUpdateBuilder?.update).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects viewer role", async () => {
    const { supabase } = createSupabaseStub({
      role: "viewer",
      createdProjectId: CREATED_PROJECT_ID,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      quickCreateAffaire({
        projectName: "Affaire viewer",
      })
    ).rejects.toThrow("Acces refuse: role non autorise pour cette action.");
  });
});
