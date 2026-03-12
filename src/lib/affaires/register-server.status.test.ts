import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { updateAffaireRegisterEntryStatus } from "@/lib/affaires/register-server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const ENTRY_ID = "44444444-4444-4444-8444-444444444444";
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

function createOpenEntryRow() {
  return {
    id: ENTRY_ID,
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    version_id: null,
    source_document_id: null,
    kind: "missing_piece" as const,
    code: "missing_plans",
    text: "Plans manquants",
    severity: "critical" as const,
    status: "open" as const,
    origin_kind: "system" as const,
    scope_type: "project" as const,
    scope_id: null,
    scope_ref: null,
    scope_label: "Affaire test",
    source_file_name: "plans.pdf",
    sync_key: "missing_piece:missing_plans",
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

function createClarifiedEntryRow() {
  return {
    ...createOpenEntryRow(),
    status: "clarify_with_client" as const,
    metadata: {
      clientClarificationRequest: {
        status: "clarify_with_client",
        requestedAt: NOW,
        requestedByUserId: USER_ID,
        previousStatus: "open",
        comment: "Verifier le perimetre client.",
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
            data: createOpenEntryRow(),
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
            data: createClarifiedEntryRow(),
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

describe("updateAffaireRegisterEntryStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("annotates client clarification requests and emits a dedicated event", async () => {
    const { supabase, eventPayloads, updatePayloads } = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await updateAffaireRegisterEntryStatus({
      projectId: PROJECT_ID,
      entryId: ENTRY_ID,
      status: "clarify_with_client",
      comment: "Verifier le perimetre client.",
    });

    expect(updatePayloads[0]).toMatchObject({
      status: "clarify_with_client",
      updated_by: USER_ID,
      metadata: expect.objectContaining({
        clientClarificationRequest: expect.objectContaining({
          status: "clarify_with_client",
          requestedByUserId: USER_ID,
          previousStatus: "open",
          comment: "Verifier le perimetre client.",
        }),
      }),
    });
    expect(eventPayloads[0]).toMatchObject({
      event_type: "clarify_with_client_requested",
      reason: "Verifier le perimetre client.",
      after_payload: expect.objectContaining({
        status: "clarify_with_client",
        clientClarificationRequest: expect.objectContaining({
          previousStatus: "open",
        }),
      }),
    });
    expect(result.entry.status).toBe("clarify_with_client");
    expect(result.entry.clientClarificationRequest).toMatchObject({
      status: "clarify_with_client",
      previousStatus: "open",
      comment: "Verifier le perimetre client.",
    });
  });
});
