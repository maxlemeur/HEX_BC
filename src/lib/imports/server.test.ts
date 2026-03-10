import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import {
  createImportFromJsonBody,
  listUserImports,
} from "@/lib/imports/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

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

function createAwaitableImportsBuilder(data: unknown[] = []) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    order: vi.fn(),
    then: vi.fn(),
  };

  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.then.mockImplementation((onFulfilled, onRejected) =>
    Promise.resolve({ data, error: null }).then(onFulfilled, onRejected)
  );

  return builder;
}

function createImportCreationSupabaseMock() {
  const membershipBuilder = createMembershipBuilder();
  const rawRowBatches: unknown[][] = [];
  const importInsertPayloads: Array<Record<string, unknown>> = [];
  const importUpdatePayloads: Array<Record<string, unknown>> = [];
  let currentImportRecord: Record<string, unknown> | null = null;

  const importsTable = {
    insert: vi.fn((payload: Record<string, unknown>) => {
      importInsertPayloads.push(payload);
      currentImportRecord = {
        id: "import-created",
        created_at: "2026-03-10T09:00:00.000Z",
        updated_at: "2026-03-10T09:00:00.000Z",
        error_message: null,
        ...payload,
      };

      return {
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({
            data: currentImportRecord,
            error: null,
          }),
        })),
      };
    }),
    update: vi.fn((payload: Record<string, unknown>) => {
      importUpdatePayloads.push(payload);

      return {
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: {
                ...currentImportRecord,
                ...payload,
                updated_at: "2026-03-10T09:05:00.000Z",
              },
              error: null,
            }),
          })),
        })),
      };
    }),
  };

  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: USER_ID } },
        error: null,
      }),
    },
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => membershipBuilder),
        };
      }

      if (table === "dpgf_imports") {
        return importsTable;
      }

      if (table === "dpgf_rows_raw") {
        return {
          insert: vi.fn(async (payload: unknown) => {
            rawRowBatches.push(Array.isArray(payload) ? payload : [payload]);
            return {
              data: null,
              error: null,
            };
          }),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    supabase,
    state: {
      rawRowBatches,
      importInsertPayloads,
      importUpdatePayloads,
    },
  };
}

describe("listUserImports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects invalid projectId before querying Supabase", async () => {
    await expect(
      listUserImports({
        projectId: "not-a-uuid",
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });

    expect(createSupabaseServerClient).not.toHaveBeenCalled();
  });

  it("applies project_id filter when provided", async () => {
    const membershipBuilder = createMembershipBuilder();
    const importsBuilder = createAwaitableImportsBuilder([
      {
        id: "import-1",
      },
    ]);

    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: USER_ID } },
          error: null,
        }),
      },
      from: vi.fn((table: string) => {
        if (table === "tenant_memberships") return membershipBuilder;
        if (table === "dpgf_imports") return importsBuilder;
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await listUserImports({
      projectId: PROJECT_ID,
    });

    expect(importsBuilder.eq).toHaveBeenCalledWith("project_id", PROJECT_ID);
  });
});

describe("createImportFromJsonBody", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persists approved tabular PDF rows inside the canonical raw rows pipeline", async () => {
    const { supabase, state } = createImportCreationSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await createImportFromJsonBody({
      sourceKind: "tabular_pdf",
      filename: "dpgf-tabular-pdf.json",
      provenanceDefaults: {
        sourceFileName: "lot-cvc-dpgf.pdf",
        sourceDocumentId: "doc-123",
      },
      validation: {
        approvedTables: [{ sourcePage: 3, tableIndex: 1 }],
      },
      rows: [
        {
          cells: {
            Code: "A-001",
            Description: "Cable cuivre",
          },
          provenance: {
            sourcePage: 3,
            tableIndex: 1,
          },
        },
        {
          cells: {
            Code: "A-002",
            Description: "Disjoncteur",
          },
          provenance: {
            sourcePage: 3,
            tableIndex: 1,
            sourceFileName: "lot-cvc-dpgf-v2.pdf",
          },
        },
      ],
    });

    expect(state.importInsertPayloads[0]).toMatchObject({
      filename: "dpgf-tabular-pdf.json",
      source_format: "json",
      parse_mode: "worker",
      status: "parsing",
    });
    expect(state.rawRowBatches).toHaveLength(1);
    expect(state.rawRowBatches[0]).toEqual([
      {
        import_id: "import-created",
        row_index: 0,
        payload: {
          Code: "A-001",
          Description: "Cable cuivre",
          _timax_provenance: {
            source_page: 3,
            table_index: 1,
            source_file_name: "lot-cvc-dpgf.pdf",
            source_document_id: "doc-123",
          },
        },
      },
      {
        import_id: "import-created",
        row_index: 1,
        payload: {
          Code: "A-002",
          Description: "Disjoncteur",
          _timax_provenance: {
            source_page: 3,
            table_index: 1,
            source_file_name: "lot-cvc-dpgf-v2.pdf",
            source_document_id: "doc-123",
          },
        },
      },
    ]);
    expect(result).toMatchObject({
      id: "import-created",
      status: "completed",
      row_count: 2,
      source_format: "json",
    });
  });

  it("rejects tabular PDF imports without explicit approved tables", async () => {
    const { supabase, state } = createImportCreationSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      createImportFromJsonBody({
        sourceKind: "tabular_pdf",
        rows: [
          {
            cells: {
              Code: "A-001",
            },
            provenance: {
              sourcePage: 2,
              tableIndex: 0,
            },
          },
        ],
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });

    expect(state.importInsertPayloads).toEqual([]);
    expect(state.rawRowBatches).toEqual([]);
  });
});
