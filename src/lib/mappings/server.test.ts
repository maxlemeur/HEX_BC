import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import {
  badRequest,
  findDuplicates,
  guessTargetFieldFromColumn,
  listMappings,
  previewImportStructure,
  ok,
  previewMapping,
  saveTemplate,
  suggestMapping,
  toErrorResponse,
  validateMapping,
} from "@/lib/mappings/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const IMPORT_ID = "33333333-3333-4333-8333-333333333333";

function createMembershipBuilder(isTenantAdmin: boolean) {
  const builder = {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockResolvedValue({
    data: [
      {
        tenant_id: TENANT_ID,
        role: isTenantAdmin ? "admin" : "engineer",
      },
    ],
    error: null,
  });

  return builder;
}

function createImportAccessBuilder(importId: string) {
  const builder = {
    eq: vi.fn(),
    single: vi.fn(),
  };

  builder.eq.mockReturnValue(builder);
  builder.single.mockResolvedValue({
    data: { id: importId, row_count: 12 },
    error: null,
  });

  return builder;
}

function createRawRowsBuilder(rows: Array<{ row_index: number; payload: unknown }>) {
  const builder = {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    range: vi.fn(),
  };

  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockImplementation((limit: number) =>
    Promise.resolve({
      data: rows.slice(0, limit),
      error: null,
    })
  );
  builder.range.mockImplementation((from: number, to: number) =>
    Promise.resolve({
      data: rows.slice(from, to + 1),
      error: null,
    })
  );

  return builder;
}

function buildSparseSuggestionRows() {
  return Array.from({ length: 101 }, (_, index) => {
    const rowIndex = index + 1;
    const payload: Record<string, unknown> = {
      "Code article": `A-${String(rowIndex).padStart(3, "0")}`,
      Description: `Ligne ${rowIndex}`,
    };

    if (rowIndex === 101) {
      payload["Champ tardif"] = "hors echantillon";
    }

    return {
      row_index: rowIndex,
      payload,
    };
  });
}

function createMappingsBuilder(mappings: unknown[]) {
  const builder = {
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  builder.in.mockResolvedValue({
    data: mappings,
    error: null,
  });
  builder.eq.mockImplementation((column: string) => {
    if (column === "tenant_id") {
      return builder;
    }

    return Promise.resolve({
      data: mappings,
      error: null,
    });
  });

  return builder;
}

function createTemplatesBuilder(templates: unknown[]) {
  const builder = {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  builder.eq.mockImplementation((column: string) => {
    if (column === "tenant_id") {
      return builder;
    }

    return Promise.resolve({
      data: templates,
      error: null,
    });
  });

  return builder;
}

function createMappingMemoryBuilder(memoryRows: unknown[]) {
  const builder = {
    eq: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
  };

  builder.in.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.eq.mockImplementation((column: string) => {
    if (column === "tenant_id") {
      return builder;
    }

    return Promise.resolve({
      data: memoryRows,
      error: null,
    });
  });

  return builder;
}

function createSupabaseMock(input?: {
  isTenantAdmin?: boolean;
  importId?: string;
  rawRows?: Array<{ row_index: number; payload: unknown }>;
  mappings?: unknown[];
  templates?: unknown[];
  memoryRows?: unknown[];
}) {
  const isTenantAdmin = input?.isTenantAdmin ?? false;
  const importId = input?.importId ?? IMPORT_ID;
  const rawRows = input?.rawRows ?? [];
  const mappings = input?.mappings ?? [];
  const templates = input?.templates ?? [];
  const memoryRows = input?.memoryRows ?? [];

  return {
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
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        return {
          select: vi.fn(() => createMembershipBuilder(isTenantAdmin)),
        };
      }

      if (table === "dpgf_imports") {
        return {
          select: vi.fn(() => createImportAccessBuilder(importId)),
        };
      }

      if (table === "dpgf_rows_raw") {
        return {
          select: vi.fn(() => createRawRowsBuilder(rawRows)),
        };
      }

      if (table === "dpgf_mappings") {
        return {
          select: vi.fn(() => createMappingsBuilder(mappings)),
        };
      }

      if (table === "mapping_templates") {
        return {
          select: vi.fn(() => createTemplatesBuilder(templates)),
        };
      }

      if (table === "mapping_memory") {
        return {
          select: vi.fn(() => createMappingMemoryBuilder(memoryRows)),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
    rpc: vi.fn().mockResolvedValue({
      data: [],
      error: null,
    }),
  };
}

describe("guessTargetFieldFromColumn", () => {
  it("maps known headers to expected target fields", () => {
    expect(guessTargetFieldFromColumn("Type FO")).toBe("supply_type");
    expect(guessTargetFieldFromColumn("Majoration MO")).toBe("h_mo_majoration");
    expect(guessTargetFieldFromColumn("Code article")).toBe("hex_code");
    expect(guessTargetFieldFromColumn("Description")).toBe("designation");
    expect(guessTargetFieldFromColumn("Qt")).toBe("quantity");
    expect(guessTargetFieldFromColumn("Unite")).toBe("unit");
    expect(guessTargetFieldFromColumn("PU HT")).toBe("unit_price_ht");
    expect(guessTargetFieldFromColumn("Montant total")).toBe("total_ht");
    expect(guessTargetFieldFromColumn("Famille produit")).toBe("category");
    expect(guessTargetFieldFromColumn("Reference fournisseur")).toBe("supplier_ref");
    expect(guessTargetFieldFromColumn("Heures main d oeuvre")).toBe("labor_hours");
    expect(guessTargetFieldFromColumn("PR. FO")).toBe("unit_price_ht");
    expect(guessTargetFieldFromColumn("h MO")).toBe("labor_hours");
    expect(guessTargetFieldFromColumn("Qte")).toBe("quantity");
    expect(guessTargetFieldFromColumn("U")).toBe("unit");
    expect(guessTargetFieldFromColumn("commentaire")).toBe("notes");
    expect(guessTargetFieldFromColumn("Note interne")).toBe("notes");
  });

  it("returns null when no heuristic matches", () => {
    expect(guessTargetFieldFromColumn("")).toBeNull();
    expect(guessTargetFieldFromColumn("champ inconnu")).toBeNull();
  });
});

describe("mapping API helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds success response with ok helper", async () => {
    const response = ok({ hello: "world" }, 201);
    const body = (await response.json()) as { ok: boolean; data: { hello: string } };

    expect(response.status).toBe(201);
    expect(body).toEqual({
      ok: true,
      data: { hello: "world" },
    });
  });

  it("keeps status/code/message/details from explicit API errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = toErrorResponse(
      badRequest("Payload invalide", { field: "mapping" }, "BAD_PAYLOAD")
    );
    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
      };
    };

    expect(response.status).toBe(400);
    // K-01: details are no longer exposed to the client
    expect(body).toEqual({
      ok: false,
      error: {
        code: "BAD_PAYLOAD",
        message: "Payload invalide",
      },
    });
    // K-01: details are logged server-side instead
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[mappings] API error details"),
      expect.objectContaining({ field: "mapping" })
    );

    errorSpy.mockRestore();
  });

  it("maps zod parsing failures to VALIDATION_ERROR", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const schema = z.object({
      import_id: z.string().uuid(),
    });

    let zodError: unknown;
    try {
      schema.parse({ import_id: "not-a-uuid" });
    } catch (error) {
      zodError = error;
    }

    const response = toErrorResponse(zodError);
    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
      };
    };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Payload invalide.");
    // K-01: details no longer exposed to client, but logged server-side
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[mappings] API error details"),
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: "import_id" }),
        ]),
      })
    );

    errorSpy.mockRestore();
  });

  it("maps unknown failures to INTERNAL_ERROR and logs them", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = toErrorResponse(new Error("boom"));
    const body = (await response.json()) as {
      ok: boolean;
      error: {
        code: string;
        message: string;
      };
    };

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Une erreur interne est survenue.");
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("exposes validation summary for valid and invalid mappings", async () => {
    const valid = await validateMapping({
      mapping: {
        designation: "designation",
      },
    });
    const invalid = await validateMapping({
      mapping: {
        colA: "hex_code",
        colB: "hex_code",
      },
    });

    expect(valid.is_valid).toBe(true);
    expect(valid.missing_required_fields).toEqual([]);
    expect(valid.duplicate_target_assignments).toEqual([]);

    expect(invalid.is_valid).toBe(false);
    expect(invalid.missing_required_fields).toEqual(["designation"]);
    expect(invalid.duplicate_target_assignments).toEqual([
      {
        target: "hex_code",
        sources: ["colA", "colB"],
      },
    ]);
  });
});

describe("mapping server workflows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists mappings and templates in the authenticated tenant scope", async () => {
    const supabase = createSupabaseMock({
      mappings: [{ id: "map-1" }],
      templates: [{ id: "tpl-1" }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await listMappings({
      importId: IMPORT_ID,
      limit: 50,
    });

    expect(result.mappings).toEqual([{ id: "map-1" }]);
    expect(result.templates).toEqual([{ id: "tpl-1" }]);
  });

  it("builds mapping preview with duplicate detection", async () => {
    const supabase = createSupabaseMock({
      rawRows: [
        {
          row_index: 1,
          payload: {
            Code: "A-001",
            Libelle: "Cable cuivre",
            Qte: 2,
          },
        },
        {
          row_index: 2,
          payload: {
            Code: "a-001",
            Libelle: " cable cuivre ",
            Qte: 4,
          },
        },
        {
          row_index: 3,
          payload: {
            Code: "B-100",
            Libelle: "Disjoncteur",
            Qte: 1,
          },
        },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await previewMapping({
      import_id: IMPORT_ID,
      mapping: {
        Code: "hex_code",
        Libelle: "designation",
        Qte: "quantity",
      },
      limit: 20,
    });

    expect(result.source_columns).toEqual(["Code", "Libelle", "Qte"]);
    expect(result.import_stats).toEqual({
      total_rows: 12,
      source_columns_count: 3,
      mapped_source_columns_count: 3,
      unresolved_source_columns_count: 0,
    });
    expect(result.validation.is_valid).toBe(true);
    expect(result.duplicates.total_groups).toBe(1);
    expect(result.duplicates.total_rows_impacted).toBe(2);
    expect(result.rows).toHaveLength(3);
  });

  it("ignores hidden mapping entries outside import source columns during validation", async () => {
    const supabase = createSupabaseMock({
      rawRows: [
        {
          row_index: 1,
          payload: {
            Code: "A-001",
            Libelle: "Cable cuivre",
          },
        },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await previewMapping({
      import_id: IMPORT_ID,
      mapping: {
        Code: "hex_code",
        Libelle: "designation",
        LegacyCode: "hex_code",
      },
      limit: 20,
    });

    expect(result.validation.is_valid).toBe(true);
    expect(result.validation.duplicate_target_assignments).toEqual([]);
  });

  it("computes preview import stats from the full import when late columns are outside the limit", async () => {
    const supabase = createSupabaseMock({
      rawRows: [
        {
          row_index: 1,
          payload: {
            Code: "A-001",
            Libelle: "Cable cuivre",
          },
        },
        {
          row_index: 2,
          payload: {
            Code: "A-002",
            Libelle: "Disjoncteur",
          },
        },
        {
          row_index: 3,
          payload: {
            Code: "A-003",
            Libelle: "Coffret",
            "Champ tardif": "present apres preview",
          },
        },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await previewMapping({
      import_id: IMPORT_ID,
      mapping: {
        Code: "hex_code",
        Libelle: "designation",
        "Champ tardif": "notes",
      },
      limit: 2,
    });

    expect(result.source_columns).toEqual(["Champ tardif", "Code", "Libelle"]);
    expect(result.import_stats).toEqual({
      total_rows: 12,
      source_columns_count: 3,
      mapped_source_columns_count: 3,
      unresolved_source_columns_count: 0,
    });
    expect(result.rows).toHaveLength(2);
  });

  it("suggests the DPGF source columns while ignoring computed price columns", async () => {
    const supabase = createSupabaseMock({
      rawRows: [
        {
          row_index: 1,
          payload: {
            column_1: "Tube acier",
            Qte: 200,
            U: "ml",
            "PR._FO": 40.74,
            h_MO: 1.2,
            commentaire: "Sous-sol",
            "PRT MO": 12,
            "P.U.": 52.74,
            "Prix total": 10_548,
            _timax_structure: {
              sheet_name: "plb Z3-5",
              source_row_number: 3,
              bold_columns: [],
              merged_columns: [],
              outline_level: null,
              column_order: [
                "column_1",
                "Qte",
                "U",
                "PR._FO",
                "h_MO",
                "commentaire",
                "PRT MO",
                "P.U.",
                "Prix total",
              ],
            },
          },
        },
      ],
      memoryRows: [
        {
          source_column: "P.U.",
          target_field: "unit_price_ht",
          usage_count: 100,
          confidence: 1,
          last_used_at: "2026-08-01T00:00:00.000Z",
        },
        {
          source_column: "PRT MO",
          target_field: "labor_hours",
          usage_count: 100,
          confidence: 1,
          last_used_at: "2026-08-01T00:00:00.000Z",
        },
        {
          source_column: "Prix total",
          target_field: "total_ht",
          usage_count: 100,
          confidence: 1,
          last_used_at: "2026-08-01T00:00:00.000Z",
        },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await suggestMapping({ import_id: IMPORT_ID });

    expect(result.suggestions).toMatchObject({
      column_1: "designation",
      Qte: "quantity",
      U: "unit",
      "PR._FO": "unit_price_ht",
      h_MO: "labor_hours",
      commentaire: "notes",
    });
    expect(result.suggestions["PRT MO"]).toBeUndefined();
    expect(result.suggestions["P.U."]).toBeUndefined();
    expect(result.suggestions["Prix total"]).toBeUndefined();
    expect(result.source_columns).not.toContain("_timax_structure");
    expect(result.sample_values._timax_structure).toBeUndefined();
  });

  it("returns reviewed structure candidates and footer counts", async () => {
    const metadata = {
      sheet_name: "plb Z3-5",
      bold_columns: ["Désignation"],
      merged_columns: [],
      outline_level: null,
      column_order: ["Désignation", "Qte", "U", "PR._FO"],
    };
    const supabase = createSupabaseMock({
      rawRows: [
        {
          row_index: 0,
          payload: {
            Désignation: "Eaux usées",
            Qte: null,
            U: null,
            "PR._FO": null,
            _timax_structure: {
              ...metadata,
              source_row_number: 2,
            },
          },
        },
        {
          row_index: 1,
          payload: {
            Désignation: "Tube hors lot",
            Qte: "—",
            U: "ml",
            "PR._FO": "—",
            _timax_structure: {
              ...metadata,
              bold_columns: [],
              source_row_number: 3,
            },
          },
        },
        {
          row_index: 2,
          payload: {
            Désignation: "TOTAL HT",
            _timax_structure: {
              ...metadata,
              bold_columns: [],
              source_row_number: 4,
            },
          },
        },
        {
          row_index: 3,
          payload: {
            Désignation: "Conditions de validité",
            _timax_structure: {
              ...metadata,
              bold_columns: [],
              source_row_number: 5,
            },
          },
        },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await previewImportStructure({
      import_id: IMPORT_ID,
      mapping: {
        Désignation: "designation",
        Qte: "quantity",
        U: "unit",
        "PR._FO": "unit_price_ht",
      },
    });

    expect(result.candidates).toEqual([
      expect.objectContaining({
        row_index: 0,
        title: "Eaux usées",
        confidence: "high",
        suggested_kind: "section",
      }),
    ]);
    expect(result.footer_row_indexes).toEqual([2, 3]);
    expect(result.summary).toMatchObject({
      zero_price_rows: 1,
      ignored_footer_rows: 2,
    });
  });

  it("merges mapping memory with heuristic suggestions", async () => {
    const supabase = createSupabaseMock({
      rawRows: [
        {
          row_index: 1,
          payload: {
            "Code article": "A-001",
            Description: "Cable cuivre",
            "Champ libre": "x",
          },
        },
      ],
      memoryRows: [
        {
          source_column: "Code article",
          target_field: "hex_code",
          usage_count: 10,
          confidence: 0.9,
          last_used_at: "2026-02-01T00:00:00.000Z",
        },
      ],
      templates: [{ id: "tpl-1" }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await suggestMapping({
      import_id: IMPORT_ID,
    });

    expect(result.source_columns).toEqual(["Champ libre", "Code article", "Description"]);
    expect(result.import_stats).toEqual({
      total_rows: 12,
      source_columns_count: 3,
      mapped_source_columns_count: 2,
      unresolved_source_columns_count: 1,
    });
    expect(result.suggestions["Code article"]).toBe("hex_code");
    expect(result.suggestions.Description).toBe("designation");
    expect(result.templates).toEqual([{ id: "tpl-1" }]);
    expect(result.template_exact_match).toBeNull();
    expect(result.confidence_by_source["Code article"]).toMatchObject({
      target_field: "hex_code",
      origin: "memory",
      band: "high",
    });
    expect(result.confidence_by_source.Description).toMatchObject({
      target_field: "designation",
      origin: "heuristic",
      band: "medium",
    });
    expect(result.auto_validation).toEqual({
      can_auto_validate: false,
      threshold: 0.8,
      required_fields: ["designation"],
      missing_required_fields: [],
      low_confidence_required_fields: ["designation"],
    });
  });

  it("computes suggestion import stats from the full import when late columns are outside the sample", async () => {
    const supabase = createSupabaseMock({
      rawRows: buildSparseSuggestionRows(),
      templates: [{ id: "tpl-1" }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await suggestMapping({
      import_id: IMPORT_ID,
    });

    expect(result.source_columns).toEqual([
      "Champ tardif",
      "Code article",
      "Description",
    ]);
    expect(result.import_stats).toEqual({
      total_rows: 12,
      source_columns_count: 3,
      mapped_source_columns_count: 2,
      unresolved_source_columns_count: 1,
    });
    expect(result.sample_values["Champ tardif"]).toBeUndefined();
    expect(result.suggestions["Code article"]).toBe("hex_code");
    expect(result.suggestions.Description).toBe("designation");
    expect(result.suggestions["Champ tardif"]).toBeUndefined();
  });

  it("keeps import provenance metadata out of mapping suggestions", async () => {
    const supabase = createSupabaseMock({
      rawRows: [
        {
          row_index: 1,
          payload: {
            "Code article": "A-001",
            Description: "Cable cuivre",
            _timax_provenance: {
              source_page: 3,
              table_index: 1,
              source_file_name: "lot-cvc-dpgf.pdf",
            },
          },
        },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await suggestMapping({
      import_id: IMPORT_ID,
    });

    expect(result.source_columns).toEqual(["Code article", "Description"]);
    expect(result.sample_values._timax_provenance).toBeUndefined();
    expect(result.suggestions["Code article"]).toBe("hex_code");
  });

  it("applies an exact template match with full confidence", async () => {
    const supabase = createSupabaseMock({
      rawRows: [
        {
          row_index: 1,
          payload: {
            Code: "A-001",
            Designation: "Cable cuivre",
          },
        },
      ],
      templates: [
        {
          id: "tpl-exact",
          name: "Template exact",
          supplier_name: "ARCUS",
          mapping: {
            Code: "hex_code",
            Designation: "designation",
          },
        },
      ],
      memoryRows: [
        {
          source_column: "Code",
          target_field: "hex_code",
          usage_count: 1,
          confidence: 0.6,
          last_used_at: "2026-03-01T00:00:00.000Z",
        },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await suggestMapping({
      import_id: IMPORT_ID,
    });

    expect(result.suggestions).toEqual({
      Code: "hex_code",
      Designation: "designation",
    });
    expect(result.template_exact_match).toEqual({
      id: "tpl-exact",
      name: "Template exact",
      supplier_name: "ARCUS",
      score: 1,
    });
    expect(result.confidence_by_source.Code).toMatchObject({
      target_field: "hex_code",
      score: 1,
      origin: "template",
      band: "high",
    });
    expect(result.confidence_by_source.Designation).toMatchObject({
      target_field: "designation",
      score: 1,
      origin: "template",
      band: "high",
    });
    expect(result.auto_validation.can_auto_validate).toBe(true);
  });

  it("does not apply exact template match when normalized source columns collide", async () => {
    const supabase = createSupabaseMock({
      rawRows: [
        {
          row_index: 1,
          payload: {
            Code: "A-001",
            code: "A-ALT",
            Designation: "Cable cuivre",
          },
        },
      ],
      templates: [
        {
          id: "tpl-collision",
          name: "Template collision",
          supplier_name: "ARCUS",
          mapping: {
            Code: "hex_code",
            Designation: "designation",
          },
        },
      ],
      memoryRows: [
        {
          source_column: "Code",
          target_field: "hex_code",
          usage_count: 10,
          confidence: 0.95,
          last_used_at: "2026-03-01T00:00:00.000Z",
        },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await suggestMapping({
      import_id: IMPORT_ID,
    });

    expect(result.template_exact_match).toBeNull();
    expect(result.auto_validation.can_auto_validate).toBe(false);
    expect(Object.values(result.confidence_by_source).some((entry) => entry.origin === "template")).toBe(
      false
    );
  });

  it("keeps only the best score when two columns target the same field", async () => {
    const supabase = createSupabaseMock({
      rawRows: [
        {
          row_index: 1,
          payload: {
            "Code article": "A-001",
            Reference: "A-ALT",
          },
        },
      ],
      memoryRows: [
        {
          source_column: "Code article",
          target_field: "hex_code",
          usage_count: 10,
          confidence: 0.95,
          last_used_at: "2026-03-01T00:00:00.000Z",
        },
        {
          source_column: "Référence",
          target_field: "hex_code",
          usage_count: 1,
          confidence: 0.6,
          last_used_at: "2026-03-01T00:00:00.000Z",
        },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await suggestMapping({
      import_id: IMPORT_ID,
    });

    expect(result.suggestions["Code article"]).toBe("hex_code");
    expect(result.suggestions.Reference).toBeUndefined();
  });

  it("uses the atomic RPC to upsert mapping memory when saving a template", async () => {
    const membershipBuilder = createMembershipBuilder(false);
    const mappingTemplatePayload = {
      id: "tpl-atomic",
      created_at: "2026-03-04T00:00:00.000Z",
      updated_at: "2026-03-04T00:00:00.000Z",
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      name: "Template atomique",
      supplier_name: null,
      mapping: {
        Code: "hex_code",
        Designation: "designation",
      },
      is_default: false,
      last_used_at: "2026-03-04T00:00:00.000Z",
    };

    const mappingTemplatesBuilder = {
      upsert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: mappingTemplatePayload,
            error: null,
          }),
        }),
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

        if (table === "mapping_templates") {
          return mappingTemplatesBuilder;
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
      rpc: vi.fn().mockResolvedValue({
        data: [],
        error: null,
      }),
    };

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await saveTemplate({
      name: "Template atomique",
      mapping: {
        Code: "hex_code",
        Designation: "designation",
      },
      is_default: false,
    });

    expect(supabase.rpc).toHaveBeenCalledWith("upsert_mapping_memory_bulk", {
      p_entries: [
        {
          tenant_id: TENANT_ID,
          user_id: USER_ID,
          source_column: "Code",
          target_field: "hex_code",
        },
        {
          tenant_id: TENANT_ID,
          user_id: USER_ID,
          source_column: "Designation",
          target_field: "designation",
        },
      ],
    });
  });

  it("computes duplicate summary for mapped preview rows", async () => {
    const supabase = createSupabaseMock({
      rawRows: [
        {
          row_index: 10,
          payload: {
            Ref: "X1",
            Designation: "Pompe",
          },
        },
        {
          row_index: 11,
          payload: {
            Ref: "x1",
            Designation: "pompe",
          },
        },
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await findDuplicates({
      import_id: IMPORT_ID,
      mapping: {
        Ref: "hex_code",
        Designation: "designation",
      },
      limit: 100,
    });

    expect(result.total_groups).toBe(1);
    expect(result.total_rows_impacted).toBe(2);
    expect(result.scanned_rows).toBe(2);
  });

  it("preserves explicit API errors propagated by workflows", async () => {
    const accessErrorSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: null,
          },
          error: null,
        }),
      },
      from: vi.fn(),
    };
    vi.mocked(createSupabaseServerClient).mockResolvedValue(accessErrorSupabase as never);

    await expect(
      listMappings({
        importId: IMPORT_ID,
        limit: 1,
      })
    ).rejects.toMatchObject({
      status: 401,
      code: "UNAUTHORIZED",
    });
  });
});
