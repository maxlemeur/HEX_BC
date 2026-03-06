import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import {
  applyEstimateStructureDraft,
  enrichEstimateItemsWithAiStructureProvenance,
  inferDpgfPath,
} from "@/lib/estimates/structure-drafts";
import { createSupabaseServerClient } from "@/lib/supabase/server";

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

function createVersionAccessBuilder() {
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
  estimateItems?: ReturnType<typeof buildEstimateSectionRow>[];
}) {
  const membershipBuilder = createMembershipBuilder();
  const versionBuilder = createVersionAccessBuilder();
  const draftLockBuilder = createDraftLockBuilder();
  const draftBuilder = createDraftBuilder();
  const draftNodesBuilder = createDraftNodesBuilder();
  const estimateItemsBuilder = createEstimateItemsBuilder(options?.estimateItems);
  const rpc = vi.fn().mockResolvedValue({
    data: [
      {
        created_count: 1,
        updated_count: 0,
        application_count: 2,
      },
    ],
    error: null,
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
          select: vi.fn(() => versionBuilder),
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
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
    rpc,
  };

  return {
    supabase,
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

describe("applyEstimateStructureDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("commits planned writes through the transactional RPC", async () => {
    const { supabase, rpc } = createApplySupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await applyEstimateStructureDraft(VERSION_ID, DRAFT_ID, {
      mode: "merge_existing",
      selected_root_node_ids: [ROOT_NODE_ID],
      overrides: [],
    });

    expect(result.created_count).toBe(1);
    expect(result.merged_count).toBe(1);
    expect(result.created_item_ids).toHaveLength(1);

    expect(rpc).toHaveBeenCalledWith(
      "apply_estimate_structure_draft",
      expect.objectContaining({
        p_draft_id: DRAFT_ID,
        p_target_version_id: VERSION_ID,
        p_applied_by: USER_ID,
        p_created_items: expect.arrayContaining([
          expect.objectContaining({
            parent_id: EXISTING_SECTION_ID,
            title: "Sous lot IA",
            item_type: "section",
          }),
        ]),
        p_application_rows: expect.arrayContaining([
          expect.objectContaining({
            draft_node_id: ROOT_NODE_ID,
            estimate_item_id: EXISTING_SECTION_ID,
            applied_action: "merge",
          }),
          expect.objectContaining({
            draft_node_id: CHILD_NODE_ID,
            applied_action: "create",
          }),
        ]),
      })
    );
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
        "La cible de fusion selectionnee n'est pas compatible avec le parent final.",
    });

    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("enrichEstimateItemsWithAiStructureProvenance", () => {
  it("adds provenance for merged sections even when source_provider stays manual", async () => {
    const applicationsBuilder = {
      eq: vi.fn(),
      in: vi.fn().mockResolvedValue({
        data: [
          {
            draft_id: DRAFT_ID,
            draft_node_id: ROOT_NODE_ID,
            estimate_item_id: EXISTING_SECTION_ID,
            applied_action: "merge",
            created_at: "2026-03-06T09:02:00.000Z",
          },
        ],
        error: null,
      }),
    };
    applicationsBuilder.eq.mockReturnValue(applicationsBuilder);

    const draftNodesBuilder = {
      eq: vi.fn(),
      in: vi.fn().mockResolvedValue({
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
            confidence: 0.91,
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
        ],
        error: null,
      }),
    };
    draftNodesBuilder.eq.mockReturnValue(draftNodesBuilder);

    const draftsBuilder = {
      eq: vi.fn(),
      in: vi.fn().mockResolvedValue({
        data: [
          {
            id: DRAFT_ID,
            created_at: "2026-03-06T09:01:00.000Z",
            generation_metadata: {
              model: "gemini-3-pro-preview",
              used_fallback: false,
            },
          },
        ],
        error: null,
      }),
    };
    draftsBuilder.eq.mockReturnValue(draftsBuilder);

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "estimate_structure_draft_applications") {
          return {
            select: vi.fn(() => applicationsBuilder),
          };
        }

        if (table === "estimate_structure_draft_nodes") {
          return {
            select: vi.fn(() => draftNodesBuilder),
          };
        }

        if (table === "estimate_structure_drafts") {
          return {
            select: vi.fn(() => draftsBuilder),
          };
        }

        throw new Error(`Unexpected table ${table}`);
      }),
    };

    const result = await enrichEstimateItemsWithAiStructureProvenance({
      supabase: supabase as never,
      tenantId: TENANT_ID,
      items: [
        {
          id: EXISTING_SECTION_ID,
          tenant_id: TENANT_ID,
          version_id: VERSION_ID,
          parent_id: null,
          item_type: "section",
          position: 1,
          title: "Lot cible",
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
          source_metadata: null,
          source_extracted_at: null,
          created_at: "2026-03-06T09:00:00.000Z",
          updated_at: "2026-03-06T09:00:00.000Z",
        },
      ],
    });

    expect(result[0]?.source_metadata).toMatchObject({
      kind: "ai_structure",
      application_count: 1,
    });
    expect(result[0]?.source_file_name).toBe("Structure IA");
  });
});
