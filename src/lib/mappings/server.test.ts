import { beforeEach, describe, expect, it, vi } from "vitest";

// Pagination faults are covered with the real SDK in read-all.test.ts.
vi.mock("@/lib/supabase/read-all", () => import("@/test/complete-reads-fixture"));

import * as XLSX from "xlsx";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { parseImportFile } from "@/lib/imports/parser";
import { normalizeHeaderValue } from "@/lib/imports/tabular-normalization";
import { parseWorkbook } from "@/workers/xlsx-parser.worker";
import { findDuplicates, findPerUnitDurationsMappedToLineHours, guessTargetFieldFromColumn, listMappings, previewImportStructure, previewMapping, suggestMapping, validateMapping } from "@/lib/mappings/server";
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

describe("mapping API helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

// Sub-lot 2.3 (F17, U-03, D11): the column heuristic is shared by CSV, XLS, XLSX and PDF
// imports, while only the XLSX OPTIMA journey runs in Army. Each header is read raw and as the
// key the upload stores. Failure modes: docs/testing/estimate-input-import-2.3.md. Red before 2.3.
// An accepted outcome is an exact target, null, or a role prefix ending in "_*": "control_*"
// (a check column, never a value), "param_*" (a workbook parameter) or "unsupported_*"
// (recognised and reported as not supported).
type AcceptedGuess = Array<string | null>;

const OPTIMA_HEADERS: Array<[string, AcceptedGuess]> = [
  ["N°", [null]],
  ["Désignation", ["designation"]],
  ["Uté", ["unit"]],
  ["Qté", ["quantity"]],
  ["Prix\nUnitaire", ["control_*"]],
  ["Prix\nTotal", ["control_*"]],
  ["PR Fourniture unitaire", ["unit_price_ht"]],
  ["PR Total\nfourniture", ["control_*", "total_ht"]],
  ["Tps pose unitaire", ["labor_hours_per_unit"]],
  ["Tps pose unitaire majoré", ["control_*"]],
  ["Tps pose total", ["control_*"]],
  ["Coeff FO", ["param_*"]],
  ["Coeff MO", ["param_*"]],
  // Without the OPTIMA profile the unit of a bare "Majoration MO" stays to be chosen.
  ["Majoration MO", [null, "h_mo_majoration"]],
  ["Taux horaire", ["param_*"]],
];

const CLIENT_B_HEADERS: Array<[string, AcceptedGuess]> = [
  ["Description", ["designation"]],
  ["Famille Achat", ["category"]],
  ["FO / MO", [null]],
  ["LOT", [null]],
  ["n° LOT", [null]],
  ["U", ["unit"]],
  ["COMMENTAIRES STT ", ["notes"]],
  ["Qté Atelier ", ["unsupported_*"]],
  ["Qté Chantier ", ["unsupported_*"]],
  ["PU FO ", ["control_*"]],
  ["PU MO Atelier ", ["control_*", "unsupported_*"]],
  ["PU MO Chantier ", ["control_*", "unsupported_*"]],
  ["TOTAL FO ", ["control_*", "total_ht"]],
  ["Total MO Atelier ", ["control_*", "unsupported_*"]],
  ["Total MO Chantier ", ["control_*", "unsupported_*"]],
  ["TOTAL HT ", ["control_*", "total_ht"]],
];

function isAcceptedGuess(target: string | null, accepted: AcceptedGuess) {
  return accepted.some((entry) => entry === target || (
    typeof entry === "string" && entry.endsWith("_*") && typeof target === "string" &&
    target.startsWith(entry.slice(0, -1))
  ));
}

function guessRawAndUploaded(header: string) {
  return {
    raw: guessTargetFieldFromColumn(header),
    uploaded: guessTargetFieldFromColumn(normalizeHeaderValue(header, 0)),
  };
}

describe("2.3 column heuristic on real OPTIMA and client B headers (F17, U-03)", () => {
  it.each([
    ...OPTIMA_HEADERS.map(([header, accepted]) => ({ source: "OPTIMA", header, accepted })),
    ...CLIENT_B_HEADERS.map(([header, accepted]) => ({ source: "client B", header, accepted })),
  ])("$source $header", ({ header, accepted }) => {
    const guesses = guessRawAndUploaded(header);
    expect({
      raw: isAcceptedGuess(guesses.raw, accepted) ? "accepted" : guesses.raw,
      uploaded: isAcceptedGuess(guesses.uploaded, accepted) ? "accepted" : guesses.uploaded,
    }).toEqual({ raw: "accepted", uploaded: "accepted" });
  });

  it.each(["Prix Unitaire", "Prix\nUnitaire", "PR Fourniture unitaire", "Tps pose unitaire", "Tps pose unitaire majoré", "Prix unitaire HT"])(
    "%j never becomes the unit",
    (header) => {
      expect(Object.values(guessRawAndUploaded(header))).not.toContain("unit");
    },
  );

  it.each(["Uté", "UTE", "Ute"])("%j is the unit", (header) => {
    expect(guessRawAndUploaded(header)).toEqual({ raw: "unit", uploaded: "unit" });
  });

  // A generic DPGF unit price is a sale price to check, not the supply cost (D11).
  it.each(["Prix unitaire", "PU", "P.U."])("generic %j is proposed as a control price", (header) => {
    const guesses = guessRawAndUploaded(header);
    expect([guesses.raw, guesses.uploaded].map((target) => isAcceptedGuess(target, ["control_*"]))).toEqual([true, true]);
  });

  it.each(["PR FO", "PR. FO"])("%j stays the supply cost", (header) => {
    expect(guessRawAndUploaded(header)).toEqual({ raw: "unit_price_ht", uploaded: "unit_price_ht" });
  });

  // The editor export writes "Majoration MO (%)" (100 = neutral). Both upload parsers (server
  // and browser worker) store a key without the unit, so a re-import multiplied the labour
  // cost by 100 (C-11).
  it("keeps the declared percent unit of an exported majoration through both upload parsers", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Désignation", "Majoration MO (%)"],
      ["Ligne exportée", 112.5],
    ]), "Lignes");
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const server = await parseImportFile(new File([buffer], "export.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }), { headerRowNumber: 1 });
    const worker = await parseWorkbook(buffer, 1);
    const majorationKeys = [...server.headers, ...Object.keys(worker[0] ?? {})].filter((key) => /majoration/i.test(key));
    expect({
      raw: guessTargetFieldFromColumn("Majoration MO (%)"),
      uploaded: majorationKeys.map((key) => guessTargetFieldFromColumn(key)),
    }).toEqual({ raw: "h_mo_majoration_percent", uploaded: ["h_mo_majoration_percent", "h_mo_majoration_percent"] });
  });
});

// 2.3 review (D11): « prix d'achat » and « prix de revient » name the supply cost explicitly; the
// generic « Prix unitaire → contrôle » rule caught them, so the column was never imported.
describe("2.3 explicit purchase prices stay the supply cost (D11)", () => {
  it.each(["Prix d'achat unitaire", "Prix d’achat unitaire HT", "Prix de revient unitaire", "PR unitaire", "Coût d'achat unitaire"])(
    "%j is the supply cost",
    (header) => {
      expect(guessRawAndUploaded(header)).toEqual({ raw: "unit_price_ht", uploaded: "unit_price_ht" });
    },
  );

  it.each(["Prix d'achat total", "Prix de revient total"])("%j is not a unit cost", (header) => {
    expect(Object.values(guessRawAndUploaded(header))).not.toContain("unit_price_ht");
  });
});

// 2.3 review: a template saved before 2.3 for OPTIMA columns maps « Tps pose unitaire » to line
// hours and « Majoration MO » to the undeclared majoration. An exact template match used to win
// over the declared profile, so C-01 went on silently for those users. A template that agrees
// with the profile still wins.
describe("2.3 declared profile against a saved template", () => {
  const OPTIMA_SUBSET = ["Designation", "Ute", "Qte", "PR_Fourniture_unitaire", "Tps_pose_unitaire", "Majoration_MO", "Coeff_MO"];
  const rawRows = [{
    row_index: 1,
    payload: Object.fromEntries(OPTIMA_SUBSET.map((column, index) => [column, column === "Designation" ? "Ligne OPTIMA" : index])),
  }];
  const PROFILE_MAPPING = {
    Designation: "designation", Ute: "unit", Qte: "quantity", PR_Fourniture_unitaire: "unit_price_ht",
    Tps_pose_unitaire: "labor_hours_per_unit", Majoration_MO: "h_mo_majoration_additive", Coeff_MO: "param_coeff_mo",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applies the profile over a template that contradicts it", async () => {
    const supabase = createSupabaseMock({
      rawRows,
      templates: [{
        id: "tpl-legacy-optima", name: "OPTIMA (avant 2.3)", supplier_name: null,
        mapping: { ...PROFILE_MAPPING, Tps_pose_unitaire: "labor_hours", Majoration_MO: "h_mo_majoration", Coeff_MO: "notes" },
      }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await suggestMapping({ import_id: IMPORT_ID });

    expect(result.template_exact_match).toBeNull();
    expect(result.suggestions).toEqual(PROFILE_MAPPING);
    expect(result.confidence_by_source.Tps_pose_unitaire?.origin).toBe("profile");
  });

  it("keeps a template that agrees with the profile", async () => {
    const supabase = createSupabaseMock({
      rawRows,
      templates: [{ id: "tpl-optima", name: "OPTIMA", supplier_name: null, mapping: PROFILE_MAPPING }],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await suggestMapping({ import_id: IMPORT_ID });

    expect(result.template_exact_match?.id).toBe("tpl-optima");
    expect(result.suggestions).toEqual(PROFILE_MAPPING);
    expect(result.confidence_by_source.Tps_pose_unitaire?.origin).toBe("template");
  });

  // The preview names a per-unit duration read as line hours (chosen by hand or by a template).
  it("names per-unit durations mapped to the line hours", () => {
    expect(findPerUnitDurationsMappedToLineHours({ Tps_pose_unitaire: "labor_hours", Designation: "designation" })).toEqual(["Tps_pose_unitaire"]);
    expect(findPerUnitDurationsMappedToLineHours({ "Tps pose unitaire majoré": "labor_hours" })).toEqual(["Tps pose unitaire majoré"]);
    expect(findPerUnitDurationsMappedToLineHours({ "Heures MO": "labor_hours", "Tps pose total": "notes" })).toEqual([]);
    expect(findPerUnitDurationsMappedToLineHours({ Tps_pose_unitaire: "labor_hours_per_unit" })).toEqual([]);
  });
});

// 2.3 review: Excel stores a cell shown « 115 % » as 1,15. Both upload parsers stored the raw
// fraction, so « Majoration MO (%) » imported ×0,0115 and a 20 % VAT read 0,2 %. A cell whose
// number format scales by 100 is now stored as its percent text; a literal "%" in a format
// (0"%") does not scale and keeps the number.
describe("2.3 percent-formatted cells through both upload parsers", () => {
  it("stores the percent text a percent-formatted cell shows", async () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Désignation", "Majoration MO (%)", "TVA", "Remise", "Repère"],
      ["Ligne pourcentage", 1.15, 0.2, 0.125, 115],
    ]);
    sheet.B2!.z = "0%";
    sheet.C2!.z = "0.0%";
    sheet.D2!.z = "0.00 %";
    sheet.E2!.z = '0"%"';
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "Lignes");
    const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const server = await parseImportFile(new File([buffer], "pourcentages.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }), { headerRowNumber: 1 });
    const worker = await parseWorkbook(buffer, 1);
    const expected = { Majoration_MO_pct: "115 %", TVA: "20 %", Remise: "12,5 %", Repere: 115 };
    for (const row of [server.rows[0], worker[0]]) {
      expect(Object.fromEntries(Object.keys(expected).map((key) => [key, row?.[key]]))).toEqual(expected);
    }
  });
});
