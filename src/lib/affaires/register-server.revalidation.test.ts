import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requestAffaireRegisterRevalidation } from "@/lib/affaires/register-server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const ENTRY_ID = "44444444-4444-4444-8444-444444444444";
const TRIGGER_DOCUMENT_ID = "55555555-5555-4555-8555-555555555555";
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

function createValidatedEntryRow() {
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
    status: "validated" as const,
    origin_kind: "system" as const,
    scope_type: "project" as const,
    scope_id: null,
    scope_ref: null,
    scope_label: "Affaire test",
    source_file_name: "dpgf.pdf",
    sync_key: "missing_piece:missing_dpgf",
    is_active: true,
    metadata: {},
    created_by: USER_ID,
    updated_by: USER_ID,
    created_at: NOW,
    updated_at: NOW,
    created_by_profile: null,
    updated_by_profile: null,
  };
}

function createRevalidatedEntryRow() {
  return {
    ...createValidatedEntryRow(),
    status: "open" as const,
    metadata: {
      revalidationRequest: {
        status: "required",
        requestedAt: NOW,
        requestedByUserId: USER_ID,
        previousStatus: "validated",
        cause: "addendum_received",
        triggerDocumentId: TRIGGER_DOCUMENT_ID,
        triggerFileName: "additif-lot-c.pdf",
        impactedStages: ["document_review", "submission_readiness"],
        comment: "Verifier le lot C apres additif.",
      },
    },
  };
}

function createSupabaseMock() {
  const eventPayloads: unknown[] = [];
  const updatePayloads: unknown[] = [];
  let registerEntriesCall = 0;

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
          maybeSingle: vi.fn(),
          update: vi.fn(),
          single: vi.fn(),
        };
        builder.select.mockReturnValue(builder);
        builder.eq.mockReturnValue(builder);
        builder.maybeSingle.mockImplementation(async () => {
          if (currentCall !== 0) {
            throw new Error(`Unexpected maybeSingle call #${currentCall}`);
          }
          return {
            data: createValidatedEntryRow(),
            error: null,
          };
        });
        builder.update.mockImplementation((payload: unknown) => {
          updatePayloads.push(payload);
          return builder;
        });
        builder.single.mockImplementation(async () => {
          if (currentCall !== 1) {
            throw new Error(`Unexpected single call #${currentCall}`);
          }
          return {
            data: createRevalidatedEntryRow(),
            error: null,
          };
        });
        return builder;
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  };

  return { supabase, eventPayloads, updatePayloads };
}

describe("requestAffaireRegisterRevalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reopens the entry and traces a revalidation request with impacted stages", async () => {
    const { supabase, eventPayloads, updatePayloads } = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await requestAffaireRegisterRevalidation({
      projectId: PROJECT_ID,
      entryId: ENTRY_ID,
      cause: "addendum_received",
      impactedStages: ["document_review", "submission_readiness"],
      triggerDocumentId: TRIGGER_DOCUMENT_ID,
      triggerFileName: "additif-lot-c.pdf",
      comment: "Verifier le lot C apres additif.",
    });

    expect(updatePayloads[0]).toMatchObject({
      status: "open",
      updated_by: USER_ID,
      metadata: expect.objectContaining({
        revalidationRequest: expect.objectContaining({
          status: "required",
          previousStatus: "validated",
          cause: "addendum_received",
          triggerDocumentId: TRIGGER_DOCUMENT_ID,
          triggerFileName: "additif-lot-c.pdf",
          impactedStages: ["document_review", "submission_readiness"],
          comment: "Verifier le lot C apres additif.",
        }),
      }),
    });
    expect(eventPayloads[0]).toMatchObject({
      event_type: "revalidation_requested",
      reason: "Verifier le lot C apres additif.",
      before_payload: expect.objectContaining({
        status: "validated",
      }),
      after_payload: expect.objectContaining({
        status: "open",
        revalidationRequest: expect.objectContaining({
          previousStatus: "validated",
          cause: "addendum_received",
        }),
      }),
    });
    expect(result.entry.status).toBe("open");
    expect(result.entry.revalidationRequest).toMatchObject({
      status: "required",
      previousStatus: "validated",
      impactedStages: ["document_review", "submission_readiness"],
    });
  });
});
