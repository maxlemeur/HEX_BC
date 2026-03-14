import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { fetchAffaireRegisterReviewExport } from "@/lib/affaires/register-server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-03-14T11:00:00.000Z";

function createProjectRow() {
  return {
    id: PROJECT_ID,
    tenant_id: TENANT_ID,
    user_id: USER_ID,
    name: "Hydro Express",
    reference: "AFF-HEX-42",
    client_name: "Client test",
    is_archived: false,
  };
}

function createEntryRows() {
  return [
    {
      id: "55555555-5555-4555-8555-555555555555",
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      version_id: VERSION_ID,
      source_document_id: null,
      kind: "assumption",
      code: null,
      text: "Hypothese de phasage a valider",
      severity: "warning",
      status: "open",
      origin_kind: "manual",
      scope_type: "project",
      scope_id: null,
      scope_ref: null,
      scope_label: "Hydro Express",
      source_file_name: "note-client.pdf",
      sync_key: null,
      is_active: true,
      metadata: {
        businessImpact: ["affects_hub_readiness"],
      },
      created_by: USER_ID,
      updated_by: USER_ID,
      created_at: NOW,
      updated_at: NOW,
      created_by_profile: null,
      updated_by_profile: null,
    },
    {
      id: "66666666-6666-4666-8666-666666666666",
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      version_id: VERSION_ID,
      source_document_id: null,
      kind: "missing_piece",
      code: "missing_plans",
      text: "Plans manquants",
      severity: "critical",
      status: "clarify_with_client",
      origin_kind: "system",
      scope_type: "project",
      scope_id: null,
      scope_ref: null,
      scope_label: "Hydro Express",
      source_file_name: null,
      sync_key: "missing_piece:missing_plans",
      is_active: true,
      metadata: {
        businessImpact: [
          "affects_hub_readiness",
          "blocks_submission",
          "requires_client_answer",
        ],
        clientClarificationRequest: {
          status: "clarify_with_client",
          requestedAt: NOW,
          requestedByUserId: USER_ID,
          previousStatus: "open",
          comment: "Relancer le client sur les plans.",
        },
      },
      created_by: USER_ID,
      updated_by: USER_ID,
      created_at: NOW,
      updated_at: NOW,
      created_by_profile: null,
      updated_by_profile: null,
    },
    {
      id: "77777777-7777-4777-8777-777777777777",
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      version_id: VERSION_ID,
      source_document_id: null,
      kind: "assumption",
      code: null,
      text: "Poste volontairement exclu du perimetre",
      severity: "warning",
      status: "rejected",
      origin_kind: "manual",
      scope_type: "project",
      scope_id: null,
      scope_ref: null,
      scope_label: "Hydro Express",
      source_file_name: "memo-exclusions.pdf",
      sync_key: null,
      is_active: true,
      metadata: {
        businessImpact: ["affects_hub_readiness"],
      },
      created_by: USER_ID,
      updated_by: USER_ID,
      created_at: NOW,
      updated_at: NOW,
      created_by_profile: null,
      updated_by_profile: null,
    },
  ];
}

function createSupabaseMock() {
  const entries = createEntryRows();

  const supabase = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_ID } },
      })),
    },
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        const builder = {
          select: vi.fn(),
          eq: vi.fn(),
          order: vi.fn(),
          limit: vi.fn(),
          then: undefined as
            | ((onfulfilled?: (value: unknown) => unknown) => Promise<unknown>)
            | undefined,
        };
        builder.select.mockReturnValue(builder);
        builder.eq.mockReturnValue(builder);
        builder.order.mockReturnValue(builder);
        builder.limit.mockReturnValue(builder);
        builder.then = (onfulfilled) =>
          Promise.resolve({
            data: [
              {
                tenant_id: TENANT_ID,
                role: "admin",
                is_default: true,
                created_at: NOW,
              },
            ],
            error: null,
          }).then(onfulfilled);
        return builder;
      }

      if (table === "estimate_projects") {
        const builder = {
          select: vi.fn(),
          eq: vi.fn(),
          maybeSingle: vi.fn(async () => ({
            data: createProjectRow(),
            error: null,
          })),
        };
        builder.select.mockReturnValue(builder);
        builder.eq.mockReturnValue(builder);
        return builder;
      }

      if (table === "affaire_register_entries") {
        let orderCount = 0;
        const builder = {
          select: vi.fn(),
          eq: vi.fn(),
          or: vi.fn(),
          order: vi.fn(),
        };
        builder.select.mockReturnValue(builder);
        builder.eq.mockReturnValue(builder);
        builder.or.mockReturnValue(builder);
        builder.order.mockImplementation(() => {
          orderCount += 1;
          if (orderCount < 2) {
            return builder;
          }

          return {
            data: entries,
            error: null,
          };
        });
        return builder;
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  };

  return { supabase };
}

describe("fetchAffaireRegisterReviewExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds a review-ready export snapshot from active register entries", async () => {
    const { supabase } = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await fetchAffaireRegisterReviewExport({
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
    });

    expect(result.projectLabel).toBe("Hydro Express");
    expect(result.projectReference).toBe("AFF-HEX-42");
    expect(result.clientName).toBe("Client test");
    expect(result.summary).toMatchObject({
      rowCount: 3,
      criticalCount: 1,
      blockingCount: 1,
      clarificationCount: 1,
      hypothesisCount: 1,
      exclusionCount: 1,
      missingPieceCount: 0,
    });
    expect(result.groups.map((group) => group.key)).toEqual([
      "hypothesis",
      "exclusion",
      "clarification",
    ]);
    expect(result.reviewNote).toContain("Revue interne registre - Hydro Express");
    expect(result.reviewNote).toContain("Exclusions: 1");
    expect(result.csvContent).toContain("Hypotheses;Hypothese");
    expect(result.csvContent).toContain("Exclusions;Hypothese");
    expect(result.csvContent).toContain("Clarifications client;Piece manquante");
  });
});
