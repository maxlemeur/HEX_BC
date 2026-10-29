import { beforeEach, describe, expect, it, vi } from "vitest";

// Pagination faults are covered with the real SDK in read-all.test.ts.
vi.mock("@/lib/supabase/read-all", () => import("@/test/complete-reads-fixture"));


vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/affaires/import-flow-server", () => ({
  fetchMappedRowsForImport: vi.fn(),
}));
vi.mock("@/lib/takeoff/gemini-client", () => ({
  callGeminiStructured: vi.fn(),
}));

import { fetchMappedRowsForImport } from "@/lib/affaires/import-flow-server";
import {
  applyEstimateStructureDraft,
  generateEstimateStructureDraft,
  inferDpgfPath,
  withEstimateAiGenerationLease,
} from "@/lib/estimates/structure-drafts";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { callGeminiStructured } from "@/lib/takeoff/gemini-client";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const DRAFT_ID = "55555555-5555-4555-8555-555555555555";
const ROOT_NODE_ID = "66666666-6666-4666-8666-666666666666";
const CHILD_NODE_ID = "77777777-7777-4777-8777-777777777777";
const EXISTING_SECTION_ID = "88888888-8888-4888-8888-888888888888";
const OTHER_ROOT_SECTION_ID = "99999999-9999-4999-8999-999999999999";
const OTHER_CHILD_SECTION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function createMembershipBuilder() {
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
        role: "engineer",
        is_default: true,
        created_at: "2026-03-06T09:00:00.000Z",
      },
    ],
    error: null,
  });

  return builder;
}

function createVersionAccessBuilder(calcEngineVersion?: number) {
  const builder = {
    eq: vi.fn(),
    single: vi.fn(),
  };

  builder.eq.mockReturnValue(builder);
  builder.single
    .mockResolvedValueOnce({
      data: {
        id: VERSION_ID,
        project_id: PROJECT_ID,
        status: "draft",
        margin_multiplier: 1,
        tax_rate_bp: 2000,
        updated_at: "2026-03-06T09:00:00.000Z",
        ...(calcEngineVersion === undefined ? {} : { calc_engine_version: calcEngineVersion }),
        estimate_projects: {
          id: PROJECT_ID,
          tenant_id: TENANT_ID,
          user_id: USER_ID,
          name: "Projet test",
          reference: null,
          client_name: null,
          notes: null,
          is_archived: false,
        },
      },
      error: null,
    })
    .mockResolvedValueOnce({
      data: {
        id: VERSION_ID,
        updated_at: "2026-03-06T09:05:00.000Z",
      },
      error: null,
    });

  return builder;
}

function createDraftLockBuilder() {
  const builder = {
    eq: vi.fn(),
    gt: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: {
        id: "lock-1",
        version_id: VERSION_ID,
        user_id: USER_ID,
        locked_at: "2026-03-06T09:00:00.000Z",
        expires_at: "2099-03-06T09:30:00.000Z",
      },
      error: null,
    }),
  };

  builder.eq.mockReturnValue(builder);
  builder.gt.mockReturnValue(builder);
  return builder;
}

function createDraftBuilder() {
  const builder = {
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: DRAFT_ID,
        tenant_id: TENANT_ID,
        project_id: PROJECT_ID,
        target_version_id: VERSION_ID,
        created_by: USER_ID,
        status: "pending",
        strategy: "hybrid",
        summary: {},
        source_overview: [],
        generation_metadata: {},
        applied_at: null,
        created_at: "2026-03-06T09:01:00.000Z",
        updated_at: "2026-03-06T09:01:00.000Z",
      },
      error: null,
    }),
  };

  builder.eq.mockReturnValue(builder);
  return builder;
}

function createDraftNodesBuilder() {
  const builder = {
    eq: vi.fn(),
    order: vi.fn(),
  };

  const ordered = vi
    .fn()
    .mockResolvedValueOnce({
      data: [
        {
          id: ROOT_NODE_ID,
          tenant_id: TENANT_ID,
          draft_id: DRAFT_ID,
          parent_node_id: null,
          order_index: 0,
          hierarchy_level: 1,
          label: "Lot cible",
          normalized_label: "lot cible",
          confidence: 0.9,
          default_action: "merge",
          duplicate_match_item_id: EXISTING_SECTION_ID,
          duplicate_match_path: "Lot cible",
          provenance: [],
          facts: [],
          hypotheses: [],
          inferences: [],
          created_at: "2026-03-06T09:01:00.000Z",
          updated_at: "2026-03-06T09:01:00.000Z",
        },
        {
          id: CHILD_NODE_ID,
          tenant_id: TENANT_ID,
          draft_id: DRAFT_ID,
          parent_node_id: ROOT_NODE_ID,
          order_index: 0,
          hierarchy_level: 2,
          label: "Sous lot IA",
          normalized_label: "sous lot ia",
          confidence: 0.82,
          default_action: "create",
          duplicate_match_item_id: null,
          duplicate_match_path: null,
          provenance: [],
          facts: [],
          hypotheses: [],
          inferences: [],
          created_at: "2026-03-06T09:01:00.000Z",
          updated_at: "2026-03-06T09:01:00.000Z",
        },
      ],
      error: null,
    });

  builder.eq.mockReturnValue(builder);
  builder.order
    .mockReturnValueOnce({
      order: ordered,
    })
    .mockReturnValueOnce({
      order: ordered,
    });

  return builder;
}

function buildEstimateSectionRow(input: {
  id: string;
  parentId: string | null;
  position: number;
  title: string;
}) {
  return {
    id: input.id,
    tenant_id: TENANT_ID,
    version_id: VERSION_ID,
    parent_id: input.parentId,
    item_type: "section",
    position: input.position,
    title: input.title,
    description: null,
    quantity: null,
    unit_price_ht_cents: null,
    tax_rate_bp: null,
    k_fo: null,
    h_mo: null,
    h_mo_majoration: 1,
    k_mo: null,
    h_mo_atelier: null,
    k_mo_atelier: 1,
    labor_role_atelier_id: null,
    h_mo_chantier: null,
    k_mo_chantier: 1,
    labor_role_chantier_id: null,
    pu_ht_cents: null,
    labor_role_id: null,
    category_id: null,
    supply_type_id: null,
    selected_supplier_price_id: null,
    line_total_ht_cents: null,
    line_tax_cents: null,
    line_total_ttc_cents: null,
    source_provider: "manual",
    source_job_id: null,
    source_file_name: null,
    source_page: null,
    created_at: "2026-03-06T09:00:00.000Z",
    updated_at: "2026-03-06T09:00:00.000Z",
  };
}

function createEstimateItemsBuilder(
  rows = [
    buildEstimateSectionRow({
      id: EXISTING_SECTION_ID,
      parentId: null,
      position: 1,
      title: "Lot cible",
    }),
  ]
) {
  const builder = {
    eq: vi.fn(),
    order: vi.fn(),
  };

  const ordered = vi
    .fn()
    .mockResolvedValue({
      data: rows,
      error: null,
    });

  builder.eq.mockReturnValue(builder);
  builder.order
    .mockReturnValueOnce({
      order: ordered,
    })
    .mockReturnValueOnce({
      order: ordered,
    });

  return builder;
}

function createApplySupabaseMock(options?: {
  calcEngineVersion?: number;
  estimateItems?: Array<ReturnType<typeof buildEstimateSectionRow> | Record<string, unknown>>;
  rpcResponse?: {
    data: unknown;
    error: {
      code?: string | null;
      message?: string | null;
      details?: string | null;
    } | null;
  };
}) {
  const membershipBuilder = createMembershipBuilder();
  const versionBuilder = createVersionAccessBuilder(options?.calcEngineVersion);
  const draftLockBuilder = createDraftLockBuilder();
  const draftBuilder = createDraftBuilder();
  const draftNodesBuilder = createDraftNodesBuilder();
  const estimateItemsBuilder = createEstimateItemsBuilder(
    options?.estimateItems as ReturnType<typeof buildEstimateSectionRow>[] | undefined
  );
  const estimateItemsInsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const estimateItemsUpdateEq = vi.fn();
  const estimateItemsUpdateBuilder = {
    eq: estimateItemsUpdateEq,
  };
  estimateItemsUpdateEq.mockReturnValue(estimateItemsUpdateBuilder);
  const estimateItemsUpdate = vi
    .fn()
    .mockReturnValue(estimateItemsUpdateBuilder);

  const draftApplicationsInsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const draftStatusUpdateEq = vi.fn();
  const draftStatusUpdateBuilder = {
    eq: draftStatusUpdateEq,
  };
  draftStatusUpdateEq.mockReturnValue(draftStatusUpdateBuilder);
  const draftStatusUpdate = vi.fn().mockReturnValue(draftStatusUpdateBuilder);

  const versionTouchUpdateEq = vi.fn();
  const versionTouchUpdateBuilder = {
    eq: versionTouchUpdateEq,
  };
  versionTouchUpdateEq.mockReturnValue(versionTouchUpdateBuilder);
  const versionTouchUpdate = vi.fn().mockReturnValue(versionTouchUpdateBuilder);

  const rpc = vi.fn().mockResolvedValue(
    options?.rpcResponse ?? {
      data: [
        {
          created_count: 1,
          updated_count: 0,
          application_count: 2,
        },
      ],
      error: null,
    }
  );

  const supabase = {
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
          select: vi.fn(() => membershipBuilder),
        };
      }

      if (table === "estimate_versions") {
        return {
          select: vi.fn(() => versionBuilder),
          update: versionTouchUpdate,
        };
      }

      if (table === "draft_locks") {
        return {
          select: vi.fn(() => draftLockBuilder),
        };
      }

      if (table === "estimate_structure_drafts") {
        return {
          select: vi.fn(() => draftBuilder),
          update: draftStatusUpdate,
        };
      }

      if (table === "estimate_structure_draft_nodes") {
        return {
          select: vi.fn(() => draftNodesBuilder),
        };
      }

      if (table === "estimate_items") {
        return {
          select: vi.fn(() => estimateItemsBuilder),
          insert: estimateItemsInsert,
          update: estimateItemsUpdate,
        };
      }

      if (table === "estimate_structure_draft_applications") {
        return {
          insert: draftApplicationsInsert,
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
    rpc,
  };

  return {
    supabase,
    rpc,
    estimateItemsInsert,
    estimateItemsUpdate,
    draftApplicationsInsert,
    draftStatusUpdate,
    versionTouchUpdate,
  };
}

function createGenerateEstimateItemsBuilder(
  rows: ReturnType<typeof buildEstimateSectionRow>[] = []
) {
  const builder = {
    eq: vi.fn(),
    order: vi.fn(),
  };

  const ordered = vi.fn().mockResolvedValue({
    data: rows,
    error: null,
  });

  builder.eq.mockReturnValue(builder);
  builder.order
    .mockReturnValueOnce({
      order: ordered,
    })
    .mockReturnValueOnce({
      order: ordered,
    });

  return builder;
}

function createListBuilder<T>(rows: T[]) {
  const builder = {
    eq: vi.fn(),
    neq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  };

  builder.eq.mockReturnValue(builder);
  builder.neq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockResolvedValue({
    data: rows,
    error: null,
  });

  return builder;
}

function createOrderedListBuilder<T>(rows: T[]) {
  const builder = {
    eq: vi.fn(),
    order: vi.fn(),
  };

  const resolved = Promise.resolve({
    data: rows,
    error: null,
  });

  builder.eq.mockReturnValue(builder);
  builder.order
    .mockReturnValueOnce(builder)
    .mockReturnValueOnce(resolved);

  return builder;
}

function createMaybeSingleBuilder<T>(row: T | null) {
  const builder = {
    eq: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(),
  };

  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);
  builder.limit.mockReturnValue(builder);
  builder.maybeSingle.mockResolvedValue({
    data: row,
    error: null,
  });

  return builder;
}

function createEqChainBuilder() {
  const builder = {
    eq: vi.fn(),
  };

  builder.eq.mockReturnValue(builder);
  return builder;
}

function createGenerateStructureSupabaseMock(options?: {
  assemblies?: Array<{
    id: string;
    name: string;
    description: string | null;
  }>;
  cctpDocuments?: Array<{
    id: string;
    file_name: string;
    upload_status?: "uploaded" | "pending" | "rejected";
    classification_status?:
      | "queued"
      | "processing"
      | "classified"
      | "ambiguous"
      | "failed";
    document_priority: "primary" | "secondary" | null;
    extracted_metadata: {
      projectName: string | null;
      clientName: string | null;
      deadlineAt: string | null;
      detectedLots: string[];
      detectedVariants: string[];
    };
  }>;
  projectNotes?: string | null;
  existingItems?: ReturnType<typeof buildEstimateSectionRow>[];
  leaseClaimed?: boolean;
  calcEngineVersion?: number;
}) {
  const membershipBuilder = createMembershipBuilder();
  const versionAccessBuilder = {
    eq: vi.fn(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: VERSION_ID,
        project_id: PROJECT_ID,
        status: "draft",
        margin_multiplier: 1,
        tax_rate_bp: 2000,
        updated_at: "2026-03-06T09:00:00.000Z",
        ...(options?.calcEngineVersion === undefined ? {} : { calc_engine_version: options.calcEngineVersion }),
        estimate_projects: {
          id: PROJECT_ID,
          tenant_id: TENANT_ID,
          user_id: USER_ID,
          name: "Projet test",
          reference: null,
          client_name: null,
          notes: options?.projectNotes ?? null,
          is_archived: false,
        },
      },
      error: null,
    }),
  };
  versionAccessBuilder.eq.mockReturnValue(versionAccessBuilder);

  const historyVersionsBuilder = createListBuilder<
    { id: string; version_number: number; title: string | null }
  >([]);
  const draftLockBuilder = createDraftLockBuilder();
  const estimateItemsBuilder = createGenerateEstimateItemsBuilder(
    options?.existingItems ?? []
  );
  const dpgfImportsBuilder = createMaybeSingleBuilder<{
    id: string;
    filename: string;
    status: string;
    created_at: string;
    parse_mode: string;
    row_count: number | null;
  }>(null);
  const templatesBuilder = createListBuilder<
    { id: string; name: string; description: string | null; updated_at: string | null }
  >([]);
  const assembliesBuilder = createListBuilder(
    (options?.assemblies ?? []).map((assembly) => ({
      ...assembly,
      updated_at: "2026-03-06T09:00:00.000Z",
    }))
  );
  const affaireBriefsBuilder = createMaybeSingleBuilder<{
    id: string;
    project_id: string;
    status: string;
    summary: string;
    project_object: string;
    scope: unknown;
    lots: unknown;
    received_pieces: unknown;
    assumptions: unknown;
    vigilance_points: unknown;
    missing_elements: unknown;
  }>(null);
  const affaireIntakeDocumentsBuilder = createOrderedListBuilder(
    (options?.cctpDocuments ?? []).map((document) => ({
      ...document,
      document_kind: "cctp",
      upload_status: document.upload_status ?? "uploaded",
      classification_status: document.classification_status ?? "classified",
    }))
  );
  const discardPendingBuilder = createEqChainBuilder();
  const draftStatusUpdate = vi.fn().mockReturnValue(discardPendingBuilder);
  const draftInsertSingle = vi.fn().mockResolvedValue({
    data: {
      id: DRAFT_ID,
      created_at: "2026-03-06T09:01:00.000Z",
    },
    error: null,
  });
  const draftInsertSelectBuilder = {
    single: draftInsertSingle,
  };
  const draftInsertBuilder = {
    select: vi.fn().mockReturnValue(draftInsertSelectBuilder),
  };
  const draftInsert = vi.fn().mockReturnValue(draftInsertBuilder);
  const draftNodesInsert = vi.fn().mockResolvedValue({ data: null, error: null });
  const estimateVersionsSelect = vi
    .fn()
    .mockReturnValueOnce(versionAccessBuilder)
    .mockReturnValueOnce(historyVersionsBuilder);
  const rpc = vi.fn(async (functionName: string) => {
    if (functionName === "acquire_estimate_ai_generation_lease") {
      return {
        data: [
          {
            claimed: options?.leaseClaimed ?? true,
            retry_after_seconds: options?.leaseClaimed === false ? 600 : 0,
          },
        ],
        error: null,
      };
    }
    if (functionName === "complete_estimate_ai_generation_lease") {
      return { data: true, error: null };
    }
    throw new Error(`Unexpected RPC ${functionName}`);
  });

  const supabase = {
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
          select: vi.fn(() => membershipBuilder),
        };
      }

      if (table === "estimate_versions") {
        return {
          select: estimateVersionsSelect,
        };
      }

      if (table === "draft_locks") {
        return {
          select: vi.fn(() => draftLockBuilder),
        };
      }

      if (table === "estimate_items") {
        return {
          select: vi.fn(() => estimateItemsBuilder),
        };
      }

      if (table === "dpgf_imports") {
        return {
          select: vi.fn(() => dpgfImportsBuilder),
        };
      }

      if (table === "estimate_templates") {
        return {
          select: vi.fn(() => templatesBuilder),
        };
      }

      if (table === "estimate_assemblies") {
        return {
          select: vi.fn(() => assembliesBuilder),
        };
      }

      if (table === "affaire_briefs") {
        return {
          select: vi.fn(() => affaireBriefsBuilder),
        };
      }

      if (table === "affaire_intake_documents") {
        return {
          select: vi.fn(() => affaireIntakeDocumentsBuilder),
        };
      }

      if (table === "estimate_structure_drafts") {
        return {
          update: draftStatusUpdate,
          insert: draftInsert,
        };
      }

      if (table === "estimate_structure_draft_nodes") {
        return {
          insert: draftNodesInsert,
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
    rpc,
  };

  return {
    supabase,
    draftNodesInsert,
    rpc,
  };
}

describe("inferDpgfPath", () => {
  it("keeps the supported fourth hierarchy segment", () => {
    expect(inferDpgfPath("Clos couvert > Charpente > Couverture > Etancheite")).toEqual([
      "Clos couvert",
      "Charpente",
      "Couverture",
      "Etancheite",
    ]);
  });
});

describe("generateEstimateStructureDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchMappedRowsForImport).mockResolvedValue([]);
  });

  it("rejects a replayed generation before the Gemini provider sink", async () => {
    const { supabase, draftNodesInsert, rpc } = createGenerateStructureSupabaseMock({
      assemblies: [
        {
          id: "assembly-1",
          name: "Electricite",
          description: "Bloc standard",
        },
      ],
      leaseClaimed: false,
    });

    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      generateEstimateStructureDraft(VERSION_ID, { strategy: "hybrid" })
    ).rejects.toMatchObject({
      code: "ESTIMATE_AI_GENERATION_BUDGET_EXCEEDED",
      status: 409,
    });

    expect(vi.mocked(callGeminiStructured)).not.toHaveBeenCalled();
    expect(draftNodesInsert).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("withEstimateAiGenerationLease", () => {
  it("allows one legitimate operation and closes concurrent requests and replays", async () => {
    let consumed = false;
    let releaseRun: () => void = () => {
      throw new Error("Generation gate was not initialized.");
    };
    const providerSink = vi.fn(async () => "generated");
    const rpc = vi.fn(async (functionName: string) => {
      if (functionName === "acquire_estimate_ai_generation_lease") {
        if (consumed) {
          return {
            data: [{ claimed: false, retry_after_seconds: 600 }],
            error: null,
          };
        }
        consumed = true;
        return {
          data: [{ claimed: true, retry_after_seconds: 0 }],
          error: null,
        };
      }
      if (functionName === "complete_estimate_ai_generation_lease") {
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC ${functionName}`);
    });
    const supabase = { rpc };
    const gate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });

    const first = withEstimateAiGenerationLease({
      supabase: supabase as never,
      versionId: VERSION_ID,
      operation: "structure_draft",
      run: async () => {
        await gate;
        return providerSink();
      },
    });

    await expect(
      withEstimateAiGenerationLease({
        supabase: supabase as never,
        versionId: VERSION_ID,
        operation: "structure_draft",
        run: providerSink,
      })
    ).rejects.toMatchObject({
      code: "ESTIMATE_AI_GENERATION_BUDGET_EXCEEDED",
    });

    releaseRun();
    await expect(first).resolves.toBe("generated");

    await expect(
      withEstimateAiGenerationLease({
        supabase: supabase as never,
        versionId: VERSION_ID,
        operation: "structure_draft",
        run: providerSink,
      })
    ).rejects.toMatchObject({
      code: "ESTIMATE_AI_GENERATION_BUDGET_EXCEEDED",
    });
    expect(providerSink).toHaveBeenCalledTimes(1);
  });
});

describe("applyEstimateStructureDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects an explicit merge target when it is outside the compatible parent scope", async () => {
    const { supabase, rpc } = createApplySupabaseMock({
      estimateItems: [
        buildEstimateSectionRow({
          id: EXISTING_SECTION_ID,
          parentId: null,
          position: 1,
          title: "Lot cible",
        }),
        buildEstimateSectionRow({
          id: OTHER_ROOT_SECTION_ID,
          parentId: null,
          position: 2,
          title: "Autre lot",
        }),
        buildEstimateSectionRow({
          id: OTHER_CHILD_SECTION_ID,
          parentId: OTHER_ROOT_SECTION_ID,
          position: 1,
          title: "Sous lot hors parent",
        }),
      ],
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      applyEstimateStructureDraft(VERSION_ID, DRAFT_ID, {
        mode: "merge_existing",
        selected_root_node_ids: [ROOT_NODE_ID],
        overrides: [
          {
            node_id: CHILD_NODE_ID,
            action: "merge",
            merge_into_item_id: OTHER_CHILD_SECTION_ID,
          },
        ],
      })
    ).rejects.toMatchObject({
      message:
        "La cible de fusion sélectionnée n'est pas compatible avec le parent final.",
    });

    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("applyEstimateStructureDraft on a v3 (lot 3.2, entrée 2)", () => {
  const input = { mode: "merge_existing" as const, selected_root_node_ids: [ROOT_NODE_ID], overrides: [] };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never falls back to direct writes on a v3 when the RPC is missing", async () => {
    const { supabase, estimateItemsInsert, draftApplicationsInsert } = createApplySupabaseMock({
      calcEngineVersion: 3,
      rpcResponse: { data: null, error: { code: "PGRST202", message: "Could not find the function public.apply_estimate_structure_draft" } },
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(applyEstimateStructureDraft(VERSION_ID, DRAFT_ID, input))
      .rejects.toMatchObject({ code: "ESTIMATE_ENGINE_UNAVAILABLE", status: 409 });
    expect(estimateItemsInsert).not.toHaveBeenCalled();
    expect(draftApplicationsInsert).not.toHaveBeenCalled();
  });
});
