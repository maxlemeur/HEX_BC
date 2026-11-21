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

const serviceRpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ rpc: serviceRpc }),
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

// The column mapping of the fixtures and a mapped row as the mapping writer stores it: the raw row and the mapping
// applied to it.
const COLUMNS = { Designation: "designation", Qte: "quantity", U: "unit", PU: "unit_price_ht" } as const;
function storedRow(index: number, raw: Record<string, string | number | null>, columns: Record<string, string> = COLUMNS) {
  return {
    id: `mapped-${index}`,
    payload: {
      raw_row_id: `raw-${index}`,
      row_index: index,
      raw_row: raw,
      mapped_row: Object.fromEntries(Object.entries(columns).flatMap(([source, target]) =>
        source in raw ? [[target, raw[source]]] : [])),
    },
  };
}

function createImportSelectBuilder(projectId: string | null, rowCount = 1) {
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
        row_count: rowCount,
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
    data: mappingId ? { id: mappingId, column_mapping: COLUMNS } : null,
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
        storedRow(1, { Designation: "Poste A", Qte: "1", PU: "100" }),
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
        storedRow(1, { Designation: "Poste A", Qte: "1", PU: "100" }),
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

// Lot 4 (the affaire's item list): what a confirmation records is bound to the rows its mapping made.
describe("confirmUnifiedImportFlow — the rows and decisions a confirmation records", () => {
  const FOOTER_SHEET = [
    { Designation: "Tube acier", Qte: 12, U: "ml", PU: 10 },
    { Designation: "Sous-total HT", Qte: null, U: null, PU: 120 },
    { Designation: "PSE 1 : robinet thermostatique", Qte: 4, U: "u", PU: 45 },
    { Designation: "Total HT", Qte: null, U: null, PU: 300 },
  ];
  const mappingCreated = { mapping: { id: "mapping-created", column_mapping: COLUMNS } };

  function stub(rows: ReturnType<typeof storedRow>[], rowCount = rows.length) {
    const supabase = createSupabaseStub({
      membershipBuilder: createMembershipBuilder(),
      importBuilder: createImportSelectBuilder(PROJECT_ID, rowCount),
      projectBuilder: createProjectSelectBuilder(true),
      mappedRowsBuilder: createMappedRowsBuilder(rows),
      versionContextBuilder: createVersionContextBuilder(null, 1, 2000),
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);
    return supabase;
  }
  const confirm = (createEstimate: boolean) => confirmUnifiedImportFlow({
    importId: IMPORT_ID, projectId: PROJECT_ID, mapping: { ...COLUMNS }, createEstimate,
    structurePlan: { decisions: [] },
  });
  const MAPPING_CHANGED = "Le mappage a changé dans un autre onglet : rechargez-le et vérifiez-le avant de confirmer.";

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createMapping).mockResolvedValue(mappingCreated as never);
    serviceRpc.mockResolvedValue({ data: "confirmation-1", error: null });
    vi.mocked(persistCanonicalEstimateV2).mockResolvedValue({
      project: { id: PROJECT_ID },
      version: { id: VERSION_ID, total_ht_cents: 12000, total_tax_cents: 2400, total_ttc_cents: 14400 },
      insertedLineCount: 1, insertedSectionCount: 0, rootSectionId: null,
    } as never);
  });

  it("refuses rows another tab's mapping made, before anything is created", async () => {
    // Tab A finished writing its rows under its own mapping (no unit column) after tab B created the latest mapping.
    stub([storedRow(0, FOOTER_SHEET[0], { Designation: "designation", Qte: "quantity", PU: "unit_price_ht" })]);
    await expect(confirm(true)).rejects.toThrow(MAPPING_CHANGED);
    expect(persistCanonicalEstimateV2).not.toHaveBeenCalled();
  });

  it("refuses a replacement still being written: fewer rows than the import holds", async () => {
    stub([storedRow(0, FOOTER_SHEET[0]), storedRow(1, FOOTER_SHEET[1])], 4);
    await expect(confirm(true)).rejects.toThrow(MAPPING_CHANGED);
    stub([storedRow(0, FOOTER_SHEET[0]), storedRow(1, FOOTER_SHEET[1])], 4);
    await expect(confirm(false)).rejects.toThrow(MAPPING_CHANGED);
    expect(persistCanonicalEstimateV2).not.toHaveBeenCalled();
    expect(serviceRpc).not.toHaveBeenCalled();
  });

  it("gives the French reason when the confirmation's lock finds other rows, not a generic failure", async () => {
    stub(FOOTER_SHEET.map((raw, index) => storedRow(index, raw)));
    vi.mocked(persistCanonicalEstimateV2).mockRejectedValueOnce(new Error("ESTIMATE_CANONICAL_V2_PERSIST_FAILED", {
      cause: { code: "40001", message: "DPGF_IMPORT_CONFIRMATION_ROWS_CHANGED" },
    }));
    await expect(confirm(true)).rejects.toThrow(MAPPING_CHANGED);
  });

  it("records the rows checked and the footer rows the import left out, with their reason", async () => {
    stub(FOOTER_SHEET.map((raw, index) => storedRow(index, raw)));
    await confirm(true);
    expect(vi.mocked(persistCanonicalEstimateV2).mock.calls[0]?.[0].importConfirmation).toEqual({
      mappingId: "mapping-created",
      decisions: [],
      exclusions: [
        { rowIndex: 1, reason: "footer" }, { rowIndex: 2, reason: "footer" }, { rowIndex: 3, reason: "footer" },
      ],
      mappedRowIds: ["mapped-0", "mapped-1", "mapped-2", "mapped-3"],
    });
  });

  it("does not report a mapping-only confirmation whose decisions were refused after the mapping committed", async () => {
    stub(FOOTER_SHEET.map((raw, index) => storedRow(index, raw)));
    serviceRpc.mockResolvedValueOnce({ data: null, error: { code: "57014", message: "canceling statement" } });
    await expect(confirm(false)).rejects.toThrow(
      "Le mappage est enregistré, mais pas les choix de structure de l’import : confirmez de nouveau pour les enregistrer."
    );
    expect(createMapping).toHaveBeenCalledTimes(1);

    // Confirming again is the same gesture: the same mapping written again, then its record.
    stub(FOOTER_SHEET.map((raw, index) => storedRow(index, raw)));
    const result = await confirm(false);
    expect(result.mode).toBe("mapping_only");
    expect(serviceRpc).toHaveBeenCalledTimes(2);
    expect(serviceRpc.mock.calls[1]).toEqual(serviceRpc.mock.calls[0]);
    expect(serviceRpc.mock.calls[1]?.[1]).toMatchObject({
      p_mapping_id: "mapping-created", p_decisions: [],
      p_exclusions: [
        { rowIndex: 1, reason: "footer" }, { rowIndex: 2, reason: "footer" }, { rowIndex: 3, reason: "footer" },
      ],
      p_mapped_row_ids: ["mapped-0", "mapped-1", "mapped-2", "mapped-3"],
    });
  });

  it("does not report a mapping-only confirmation when the service client throws after the mapping committed", async () => {
    stub(FOOTER_SHEET.map((raw, index) => storedRow(index, raw)));
    serviceRpc.mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(confirm(false)).rejects.toThrow("confirmez de nouveau pour les enregistrer");
  });
});
