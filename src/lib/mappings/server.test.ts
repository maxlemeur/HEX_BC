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
  ok,
  previewMapping,
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
    data: { id: importId },
    error: null,
  });

  return builder;
}

function createRawRowsBuilder(rows: Array<{ row_index: number; payload: unknown }>) {
  const builder = {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockResolvedValue({
    data: rows,
    error: null,
  });

  return builder;
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
        code: "hex_code",
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
    expect(result.validation.is_valid).toBe(true);
    expect(result.duplicates.total_groups).toBe(1);
    expect(result.duplicates.total_rows_impacted).toBe(2);
    expect(result.rows).toHaveLength(3);
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
    expect(result.suggestions["Code article"]).toBe("hex_code");
    expect(result.suggestions.Description).toBe("designation");
    expect(result.templates).toEqual([{ id: "tpl-1" }]);
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
