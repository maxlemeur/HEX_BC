import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const extractionMocks = vi.hoisted(() => ({
  extractTabularPdfTablesFromFile: vi.fn(),
}));

vi.mock("@/lib/imports/tabular-pdf-extraction", () => extractionMocks);

import {
  createImportFromMultipartFormData,
  createImportFromJsonBody,
  listUserImports,
  requireTabularPdfReviewAccess,
  reviewTabularPdfImportFile,
  validateTabularPdfReviewFile,
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
  const storageUploads: Array<{
    bucket: string;
    path: string;
    file: File;
    options: Record<string, unknown>;
  }> = [];
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
    storage: {
      from: vi.fn((bucket: string) => ({
        upload: vi.fn(
          async (
            path: string,
            file: File,
            options: Record<string, unknown>
          ) => {
            storageUploads.push({
              bucket,
              path,
              file,
              options,
            });

            return {
              data: { path },
              error: null,
            };
          }
        ),
        remove: vi.fn(async () => ({
          data: null,
          error: null,
        })),
      })),
    },
  };

  return {
    supabase,
    state: {
      rawRowBatches,
      importInsertPayloads,
      importUpdatePayloads,
      storageUploads,
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

describe("requireTabularPdfReviewAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated callers", async () => {
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(requireTabularPdfReviewAccess()).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });

    expect(supabase.auth.getUser).toHaveBeenCalledOnce();
  });
});

describe("validateTabularPdfReviewFile", () => {
  it("accepts a non-empty pdf file", async () => {
    await expect(
      validateTabularPdfReviewFile(
        new File(["%PDF-1.7"], "lot-cvc.pdf", {
          type: "application/pdf",
        })
      )
    ).resolves.toBeUndefined();
  });

  it("rejects empty pdf files", async () => {
    await expect(
      validateTabularPdfReviewFile(
        new File([], "empty.pdf", {
          type: "application/pdf",
        })
      )
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });
  });

  it("rejects oversized pdf files", async () => {
    const file = new File(["%PDF-1.7"], "too-large.pdf", {
      type: "application/pdf",
    });
    Object.defineProperty(file, "size", {
      value: 50 * 1024 * 1024 + 1,
    });

    await expect(validateTabularPdfReviewFile(file)).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
    });
  });

  it("rejects files without a pdf name or content type", async () => {
    await expect(
      validateTabularPdfReviewFile(
        new File(["not a pdf"], "notes.txt", {
          type: "text/plain",
        })
      )
    ).rejects.toMatchObject({
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
  });

  it("rejects fake pdf uploads before parser execution", async () => {
    await expect(
      validateTabularPdfReviewFile(
        new File(["not a pdf"], "fake.pdf", {
          type: "application/pdf",
        })
      )
    ).rejects.toMatchObject({
      status: 415,
      code: "UNSUPPORTED_MEDIA_TYPE",
    });
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
      filename: "lot-cvc-dpgf.pdf",
      source_format: "pdf",
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
      filename: "lot-cvc-dpgf.pdf",
      source_format: "pdf",
    });
  });

  it("uses top-level PDF metadata when the tabular envelope wraps a reviewed PDF", async () => {
    const { supabase, state } = createImportCreationSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await createImportFromJsonBody({
      sourceKind: "tabular_pdf",
      filename: "import.json",
      sourceFormat: "json",
      sourceFileName: "lot-cfo-dpgf.pdf",
      sourceDocumentId: "doc-top-level",
      validation: {
        approvedTables: [{ sourcePage: 4, tableIndex: 0 }],
      },
      rows: [
        {
          cells: {
            Code: "B-001",
            Description: "Gaine technique",
          },
          provenance: {
            sourcePage: 4,
            tableIndex: 0,
          },
        },
      ],
    });

    expect(state.importInsertPayloads[0]).toMatchObject({
      filename: "lot-cfo-dpgf.pdf",
      source_format: "pdf",
    });
    expect(state.rawRowBatches[0]).toEqual([
      {
        import_id: "import-created",
        row_index: 0,
        payload: {
          Code: "B-001",
          Description: "Gaine technique",
          _timax_provenance: {
            source_page: 4,
            table_index: 0,
            source_file_name: "lot-cfo-dpgf.pdf",
            source_document_id: "doc-top-level",
          },
        },
      },
    ]);
    expect(result).toMatchObject({
      filename: "lot-cfo-dpgf.pdf",
      source_format: "pdf",
    });
  });

  it("builds canonical raw rows from reviewed PDF tables without a parallel row envelope", async () => {
    const { supabase, state } = createImportCreationSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await createImportFromJsonBody({
      sourceKind: "tabular_pdf",
      sourceFileName: "lot-cvc-dpgf.pdf",
      sourceDocumentId: "doc-tables",
      validation: {
        approvedTables: [{ sourcePage: 5, tableIndex: 0 }],
      },
      tables: [
        {
          page: 5,
          headers: ["Code article", "Description", "Qt"],
          rows: [
            { cells: ["A-001", "Cable cuivre", "12"] },
            { cells: ["A-002", "Disjoncteur", "4"] },
          ],
        },
      ],
    });

    expect(state.importInsertPayloads[0]).toMatchObject({
      filename: "lot-cvc-dpgf.pdf",
      source_format: "pdf",
    });
    expect(state.rawRowBatches[0]).toEqual([
      {
        import_id: "import-created",
        row_index: 0,
        payload: {
          "Code article": "A-001",
          Description: "Cable cuivre",
          Qt: "12",
          _timax_provenance: {
            source_page: 5,
            table_index: 0,
            source_file_name: "lot-cvc-dpgf.pdf",
            source_document_id: "doc-tables",
          },
        },
      },
      {
        import_id: "import-created",
        row_index: 1,
        payload: {
          "Code article": "A-002",
          Description: "Disjoncteur",
          Qt: "4",
          _timax_provenance: {
            source_page: 5,
            table_index: 0,
            source_file_name: "lot-cvc-dpgf.pdf",
            source_document_id: "doc-tables",
          },
        },
      },
    ]);
    expect(result).toMatchObject({
      filename: "lot-cvc-dpgf.pdf",
      row_count: 2,
      source_format: "pdf",
    });
  });

  it("rejects reviewed PDF tables when sourceKind stays on tabular", async () => {
    const { supabase, state } = createImportCreationSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      createImportFromJsonBody({
        sourceKind: "tabular",
        validation: {
          approvedTables: [{ sourcePage: 5, tableIndex: 0 }],
        },
        tables: [
          {
            page: 5,
            headers: ["Code article", "Description", "Qt"],
            rows: [{ cells: ["A-001", "Cable cuivre", "12"] }],
          },
        ],
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: 'Le payload DPGF PDF doit definir sourceKind="tabular_pdf".',
    });

    expect(state.importInsertPayloads).toEqual([]);
    expect(state.rawRowBatches).toEqual([]);
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

  it("rejects PDF row envelopes when sourceKind is missing", async () => {
    const { supabase, state } = createImportCreationSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      createImportFromJsonBody({
        validation: {
          approvedTables: [{ sourcePage: 2, tableIndex: 0 }],
        },
        rows: [
          {
            cells: {
              Code: "A-001",
            },
            provenance: {
              sourcePage: 2,
              tableIndex: 0,
              sourceFileName: "lot-cvc-dpgf.pdf",
            },
          },
        ],
      })
    ).rejects.toMatchObject({
      status: 400,
      code: "BAD_REQUEST",
      message: 'Le payload DPGF PDF doit definir sourceKind="tabular_pdf".',
    });

    expect(state.importInsertPayloads).toEqual([]);
    expect(state.rawRowBatches).toEqual([]);
  });

  it("rejects invalid sourceKind values instead of falling back to tabular", async () => {
    const { supabase, state } = createImportCreationSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      createImportFromJsonBody({
        sourceKind: "tabular-pdf",
        validation: {
          approvedTables: [{ sourcePage: 2, tableIndex: 0 }],
        },
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
      message: "sourceKind invalide. Utiliser 'tabular' ou 'tabular_pdf'.",
    });

    expect(state.importInsertPayloads).toEqual([]);
    expect(state.rawRowBatches).toEqual([]);
  });

  it("rejects non-string sourceKind values instead of falling back to tabular", async () => {
    const { supabase, state } = createImportCreationSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      createImportFromJsonBody({
        sourceKind: {
          kind: "tabular_pdf",
        },
        validation: {
          approvedTables: [{ sourcePage: 2, tableIndex: 0 }],
        },
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
      message: "sourceKind invalide. Utiliser 'tabular' ou 'tabular_pdf'.",
    });

    expect(state.importInsertPayloads).toEqual([]);
    expect(state.rawRowBatches).toEqual([]);
  });

  it("preserves per-page tableIndex values in the PDF review payload", async () => {
    extractionMocks.extractTabularPdfTablesFromFile.mockResolvedValue([
      {
        source_page: 1,
        table_index: 0,
        title: "Page 1",
        headers: ["Code", "Description"],
        rows: [{ row_index: 0, cells: ["A-001", "Cable"] }],
      },
      {
        source_page: 2,
        table_index: 1,
        title: "Page 2",
        headers: ["Code", "Description"],
        rows: [{ row_index: 0, cells: ["A-002", "Gaine"] }],
      },
    ]);

    const result = await reviewTabularPdfImportFile({
      file: new File(["%PDF-1.7"], "lot-cvc.pdf", {
        type: "application/pdf",
      }),
    });

    expect(result.tables).toEqual([
      expect.objectContaining({
        page: 1,
        tableIndex: 0,
      }),
      expect.objectContaining({
        page: 2,
        tableIndex: 1,
      }),
    ]);
    expect(result.review.suggested_approved_tables).toEqual([
      { sourcePage: 1, tableIndex: 0 },
      { sourcePage: 2, tableIndex: 1 },
    ]);
  });
});

describe("createImportFromMultipartFormData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("imports a NIRVANA-style DPGF PDF into canonical raw rows", async () => {
    const { supabase, state } = createImportCreationSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    extractionMocks.extractTabularPdfTablesFromFile.mockResolvedValue([
      {
        source_page: 1,
        table_index: 0,
        title: "NIRVANA - Lot CVC - DPGF",
        headers: ["N°", "Designation des ouvrages", "Unite", "Qte", "P.U. HT", "Total HT"],
        rows: [
          {
            row_index: 0,
            cells: [
              "CVC-001",
              "Reseau eau glacee tube acier DN50",
              "ml",
              "42,5",
              "128,40",
              "5 457,00",
            ],
          },
          {
            row_index: 1,
            cells: [
              "CVC-002",
              "Calorifuge reseau primaire",
              "ml",
              "42,5",
              "24,00",
              "1 020,00",
            ],
          },
        ],
      },
      {
        source_page: 2,
        table_index: 0,
        title: "NIRVANA - Synthese hors DPGF",
        headers: [""],
        rows: [{ row_index: 0, cells: [""] }],
      },
    ]);

    const file = new File(["%PDF-1.7 NIRVANA"], "NIRVANA - DPGF lot CVC.pdf", {
      type: "application/pdf",
    });
    const formData = new FormData();
    formData.append("file", file);
    formData.append("sourceDocumentId", "nirvana-doc-2026-07");

    const result = await createImportFromMultipartFormData(formData);

    expect(extractionMocks.extractTabularPdfTablesFromFile).toHaveBeenCalledWith(file);
    expect(state.storageUploads).toHaveLength(1);
    expect(state.storageUploads[0]).toMatchObject({
      bucket: "dpgf-imports",
      file,
      options: {
        contentType: "application/pdf",
        upsert: false,
      },
    });
    expect(state.importInsertPayloads[0]).toMatchObject({
      filename: "NIRVANA-DPGF-lot-CVC.pdf",
      source_format: "pdf",
      parse_mode: "server",
      status: "parsing",
      file_size_bytes: file.size,
    });
    expect(state.rawRowBatches).toHaveLength(1);
    expect(state.rawRowBatches[0]).toEqual([
      {
        import_id: "import-created",
        row_index: 0,
        payload: {
          "N°": "CVC-001",
          "Designation des ouvrages": "Reseau eau glacee tube acier DN50",
          Unite: "ml",
          Qte: "42,5",
          "P.U. HT": "128,40",
          "Total HT": "5 457,00",
          _timax_provenance: {
            source_page: 1,
            table_index: 0,
            source_file_name: "NIRVANA - DPGF lot CVC.pdf",
            source_document_id: "nirvana-doc-2026-07",
          },
        },
      },
      {
        import_id: "import-created",
        row_index: 1,
        payload: {
          "N°": "CVC-002",
          "Designation des ouvrages": "Calorifuge reseau primaire",
          Unite: "ml",
          Qte: "42,5",
          "P.U. HT": "24,00",
          "Total HT": "1 020,00",
          _timax_provenance: {
            source_page: 1,
            table_index: 0,
            source_file_name: "NIRVANA - DPGF lot CVC.pdf",
            source_document_id: "nirvana-doc-2026-07",
          },
        },
      },
    ]);
    expect(result).toMatchObject({
      id: "import-created",
      status: "completed",
      row_count: 2,
      filename: "NIRVANA-DPGF-lot-CVC.pdf",
      source_format: "pdf",
    });
  });
});
