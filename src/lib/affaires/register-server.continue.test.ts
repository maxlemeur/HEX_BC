import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { continueAffaireRegisterWithHypothesis } from "@/lib/affaires/register-server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const ENTRY_ID = "44444444-4444-4444-8444-444444444444";
const HYPOTHESIS_ID = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-03-13T10:00:00.000Z";

function createProjectRow() {
  return {
    id: PROJECT_ID,
    tenant_id: TENANT_ID,
    user_id: USER_ID,
    name: "Affaire test",
    reference: "AFF-TEST",
    client_name: "Client test",
    is_archived: false,
  };
}

function createMissingPieceRow(metadata: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    version_id: null,
    source_document_id: null,
    kind: "missing_piece" as const,
    code: "missing_dpgf",
    text: "DPGF manquant",
    severity: "critical" as const,
    status: "open" as const,
    origin_kind: "system" as const,
    scope_type: "project" as const,
    scope_id: null,
    scope_ref: null,
    scope_label: "Affaire test",
    source_file_name: null,
    sync_key: "missing_piece:missing_dpgf",
    is_active: true,
    metadata,
    created_by: USER_ID,
    updated_by: USER_ID,
    created_at: NOW,
    updated_at: NOW,
    created_by_profile: null,
    updated_by_profile: null,
  };
}

function createHypothesisRow() {
  return {
    id: HYPOTHESIS_ID,
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    version_id: null,
    source_document_id: null,
    kind: "assumption" as const,
    code: "missing_dpgf",
    text: "Continuation acceptee sans dpgf manquant. Hypothese documentaire a confirmer avant remise.",
    severity: "critical" as const,
    status: "open" as const,
    origin_kind: "manual" as const,
    scope_type: "project" as const,
    scope_id: null,
    scope_ref: null,
    scope_label: "Affaire test",
    source_file_name: null,
    sync_key: null,
    is_active: true,
    metadata: {
      continuationSource: {
        kind: "missing_piece",
        entryId: ENTRY_ID,
        code: "missing_dpgf",
        text: "DPGF manquant",
      },
    },
    created_by: USER_ID,
    updated_by: USER_ID,
    created_at: NOW,
    updated_at: NOW,
    created_by_profile: null,
    updated_by_profile: null,
  };
}

function createSupabaseMock() {
  const eventPayloads: unknown[] = [];
  const hypothesisInsertPayloads: unknown[] = [];
  const sourceUpdatePayloads: unknown[] = [];
  let registerEntriesCall = 0;

  const supabase = {
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user: { id: USER_ID },
        },
      })),
    },
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        const builder = {
          select: vi.fn(),
          eq: vi.fn(),
          order: vi.fn(),
          limit: vi.fn(),
          then: undefined as ((onfulfilled?: (value: unknown) => unknown) => Promise<unknown>) | undefined,
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

      if (table === "affaire_register_events") {
        return {
          insert: vi.fn(async (payload: unknown) => {
            eventPayloads.push(payload);
            return { error: null };
          }),
        };
      }

      if (table === "affaire_register_entries") {
        const currentCall = registerEntriesCall++;
        const builder = {
          select: vi.fn(),
          eq: vi.fn(),
          or: vi.fn(),
          order: vi.fn(),
          maybeSingle: vi.fn(),
          insert: vi.fn(),
          update: vi.fn(),
          single: vi.fn(),
          then: undefined as ((onfulfilled?: (value: unknown) => unknown) => Promise<unknown>) | undefined,
        };
        builder.select.mockReturnValue(builder);
        builder.eq.mockReturnValue(builder);
        builder.or.mockReturnValue(builder);
        builder.order.mockReturnValue(builder);
        builder.maybeSingle.mockImplementation(async () => {
          if (currentCall !== 0) {
            throw new Error(`Unexpected maybeSingle call on affaire_register_entries #${currentCall}`);
          }
          return {
            data: createMissingPieceRow(),
            error: null,
          };
        });
        builder.then = (onfulfilled) =>
          Promise.resolve({
            data: currentCall === 1 ? [] : null,
            error: null,
          }).then(onfulfilled);
        builder.insert.mockImplementation((payload: unknown) => {
          hypothesisInsertPayloads.push(payload);
          return builder;
        });
        builder.update.mockImplementation((payload: unknown) => {
          sourceUpdatePayloads.push(payload);
          return builder;
        });
        builder.single.mockImplementation(async () => {
          if (currentCall === 2) {
            return {
              data: createHypothesisRow(),
              error: null,
            };
          }

          if (currentCall === 3) {
            return {
              data: createMissingPieceRow({
                continuationDecision: {
                  status: "accepted_with_hypothesis",
                  hypothesisEntryId: HYPOTHESIS_ID,
                  hypothesisText:
                    "Continuation acceptee sans dpgf manquant. Hypothese documentaire a confirmer avant remise.",
                  acceptedAt: NOW,
                  acceptedByUserId: USER_ID,
                  comment: "Budget exploratoire maintenu.",
                },
              }),
              error: null,
            };
          }

          throw new Error(`Unexpected single() call on affaire_register_entries #${currentCall}`);
        });

        return builder;
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  };

  return { supabase, eventPayloads, hypothesisInsertPayloads, sourceUpdatePayloads };
}

describe("continueAffaireRegisterWithHypothesis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a continuation hypothesis and annotates the source missing piece", async () => {
    const {
      supabase,
      eventPayloads,
      hypothesisInsertPayloads,
      sourceUpdatePayloads,
    } = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await continueAffaireRegisterWithHypothesis({
      projectId: PROJECT_ID,
      entryId: ENTRY_ID,
      comment: "Budget exploratoire maintenu.",
    });

    expect(hypothesisInsertPayloads[0]).toMatchObject({
      project_id: PROJECT_ID,
      kind: "assumption",
      text: "Continuation acceptee sans dpgf manquant. Hypothese documentaire a confirmer avant remise.",
      severity: "critical",
      metadata: expect.objectContaining({
        businessImpact: [
          "affects_hub_readiness",
          "blocks_submission",
        ],
        structuredLocation: {
          scopeType: "project",
          scopeId: null,
          scopeRef: null,
          scopeLabel: "Affaire test",
          versionId: null,
          sourceDocumentId: null,
          sourceFileName: null,
        },
      }),
    });
    expect(sourceUpdatePayloads[0]).toMatchObject({
      updated_by: USER_ID,
      metadata: expect.objectContaining({
        businessImpact: [
          "affects_hub_readiness",
          "blocks_submission",
          "affects_structure_generation",
        ],
        structuredLocation: {
          scopeType: "project",
          scopeId: null,
          scopeRef: null,
          scopeLabel: "Affaire test",
          versionId: null,
          sourceDocumentId: null,
          sourceFileName: null,
        },
        continuationDecision: expect.objectContaining({
          status: "accepted_with_hypothesis",
          hypothesisEntryId: HYPOTHESIS_ID,
          comment: "Budget exploratoire maintenu.",
        }),
      }),
    });
    expect(eventPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "created",
          reason: "manual.continue_with_hypothesis",
        }),
        expect.objectContaining({
          event_type: "continued_with_hypothesis",
          reason: "Budget exploratoire maintenu.",
        }),
      ])
    );
    expect(result.entry.continuationDecision).toMatchObject({
      status: "accepted_with_hypothesis",
      hypothesisEntryId: HYPOTHESIS_ID,
      comment: "Budget exploratoire maintenu.",
    });
    expect(result.hypothesisEntry).toMatchObject({
      id: HYPOTHESIS_ID,
      kind: "assumption",
    });
  });
});
