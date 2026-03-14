import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  fetchAffaireRegisterOwnerOptions,
  updateAffaireRegisterEntryFollowUp,
} from "@/lib/affaires/register-server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const ENTRY_ID = "55555555-5555-4555-8555-555555555555";
const NOW = "2026-03-14T10:00:00.000Z";

type RegisterEntryRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  version_id: string | null;
  source_document_id: string | null;
  kind: "missing_piece";
  code: string;
  text: string;
  severity: "info" | "warning" | "critical";
  status: "open";
  origin_kind: "system";
  scope_type: "project";
  scope_id: string | null;
  scope_ref: string | null;
  scope_label: string;
  source_file_name: string;
  sync_key: string;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_by: string;
  updated_by: string;
  created_at: string;
  updated_at: string;
  created_by_profile: null;
  updated_by_profile: null;
};

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

function createEntryRow(overrides: Partial<RegisterEntryRow> = {}) {
  const base = createBaseEntryRow();
  return {
    ...base,
    ...overrides,
    metadata: overrides.metadata ?? base.metadata,
  };
}

function createBaseEntryRow(): RegisterEntryRow {
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
    source_file_name: "dpgf.pdf",
    sync_key: "missing_piece:missing_dpgf",
    is_active: true,
    metadata: {
      severityDecision: {
        mode: "canonical",
        canonicalSeverity: "critical",
        overriddenSeverity: null,
        updatedAt: NOW,
        updatedByUserId: USER_ID,
        comment: null,
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

function createUpdatedEntryRow() {
  return {
    ...createEntryRow(),
    severity: "warning" as const,
    metadata: {
      severityDecision: {
        mode: "manual",
        canonicalSeverity: "critical",
        overriddenSeverity: "warning",
        updatedAt: NOW,
        updatedByUserId: USER_ID,
        comment: "Mode budget assume.",
      },
      followUp: {
        ownerUserId: OWNER_ID,
        ownerName: "Marie Curie",
        dueDate: "2026-03-20",
        updatedAt: NOW,
        updatedByUserId: USER_ID,
        comment: "Mode budget assume.",
      },
    },
  };
}

function createSupabaseMock(options?: {
  initialEntryRow?: ReturnType<typeof createEntryRow>;
  updatedEntryRow?: ReturnType<typeof createEntryRow>;
}) {
  const eventPayloads: unknown[] = [];
  const updatePayloads: unknown[] = [];
  let registerEntriesCall = 0;
  const initialEntryRow = options?.initialEntryRow ?? createEntryRow();
  const updatedEntryRow = options?.updatedEntryRow ?? createUpdatedEntryRow();

  const supabase = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_ID } },
      })),
    },
    from: vi.fn((table: string) => {
      if (table === "tenant_memberships") {
        const state: {
          eqFilters: Record<string, unknown>;
          inFilters: Record<string, unknown[]>;
        } = {
          eqFilters: {},
          inFilters: {},
        };
        const builder = {
          select: vi.fn(),
          eq: vi.fn(),
          in: vi.fn(),
          order: vi.fn(),
          limit: vi.fn(),
          then: undefined as
            | ((onfulfilled?: (value: unknown) => unknown) => Promise<unknown>)
            | undefined,
        };
        builder.select.mockReturnValue(builder);
        builder.eq.mockImplementation((column: string, value: unknown) => {
          state.eqFilters[column] = value;
          return builder;
        });
        builder.in.mockImplementation((column: string, values: unknown[]) => {
          state.inFilters[column] = values;
          return builder;
        });
        builder.order.mockReturnValue(builder);
        builder.limit.mockReturnValue(builder);
        builder.then = (onfulfilled) => {
          const payload =
            state.eqFilters.user_id === USER_ID
              ? {
                  data: [
                    {
                      tenant_id: TENANT_ID,
                      role: "admin",
                      is_default: true,
                      created_at: NOW,
                    },
                  ],
                  error: null,
                }
              : {
                  data: [
                    { user_id: USER_ID, role: "admin" },
                    { user_id: OWNER_ID, role: "engineer" },
                  ],
                  error: null,
                };
          return Promise.resolve(payload).then(onfulfilled);
        };
        return builder;
      }

      if (table === "profiles") {
        const builder = {
          select: vi.fn(),
          in: vi.fn(),
          then: undefined as
            | ((onfulfilled?: (value: unknown) => unknown) => Promise<unknown>)
            | undefined,
        };
        builder.select.mockReturnValue(builder);
        builder.in.mockReturnValue(builder);
        builder.then = (onfulfilled) =>
          Promise.resolve({
            data: [
              { id: USER_ID, full_name: "Ada Lovelace" },
              { id: OWNER_ID, full_name: "Marie Curie" },
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
            data: initialEntryRow,
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
            data: updatedEntryRow,
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

describe("affaire register follow-up contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists assignable register owners from the active tenant", async () => {
    const { supabase } = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    await expect(
      fetchAffaireRegisterOwnerOptions({
        projectId: PROJECT_ID,
      })
    ).resolves.toEqual([
      { userId: USER_ID, label: "Ada Lovelace", role: "admin" },
      { userId: OWNER_ID, label: "Marie Curie", role: "engineer" },
    ]);
  });

  it("updates severity, owner and due date with a single tracked event", async () => {
    const { supabase, eventPayloads, updatePayloads } = createSupabaseMock();
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await updateAffaireRegisterEntryFollowUp({
      projectId: PROJECT_ID,
      entryId: ENTRY_ID,
      severity: "warning",
      ownerUserId: OWNER_ID,
      dueDate: "2026-03-20",
      comment: "Mode budget assume.",
    });

    expect(updatePayloads[0]).toMatchObject({
      severity: "warning",
      updated_by: USER_ID,
      metadata: expect.objectContaining({
        severityDecision: expect.objectContaining({
          mode: "manual",
          canonicalSeverity: "critical",
          overriddenSeverity: "warning",
          updatedByUserId: USER_ID,
          comment: "Mode budget assume.",
        }),
        followUp: expect.objectContaining({
          ownerUserId: OWNER_ID,
          ownerName: "Marie Curie",
          dueDate: "2026-03-20",
          updatedByUserId: USER_ID,
          comment: "Mode budget assume.",
        }),
        businessImpact: [
          "affects_hub_readiness",
          "affects_structure_generation",
        ],
      }),
    });
    expect(eventPayloads[0]).toMatchObject({
      event_type: "follow_up_updated",
      reason: "Mode budget assume.",
      before_payload: expect.objectContaining({
        severity: "critical",
        followUp: null,
      }),
      after_payload: expect.objectContaining({
        severity: "warning",
        followUp: expect.objectContaining({
          ownerUserId: OWNER_ID,
          dueDate: "2026-03-20",
        }),
      }),
    });
    expect(result.entry.severity).toBe("warning");
    expect(result.entry.severityDecision).toMatchObject({
      mode: "manual",
      canonicalSeverity: "critical",
      overriddenSeverity: "warning",
    });
    expect(result.entry.followUp).toMatchObject({
      ownerUserId: OWNER_ID,
      ownerName: "Marie Curie",
      dueDate: "2026-03-20",
    });
  });

  it("preserves canonical severity when editing follow-up fields on overridden entries", async () => {
    const initialEntryRow = createEntryRow({
      severity: "warning",
      metadata: {
        severityDecision: {
          mode: "manual",
          canonicalSeverity: "critical",
          overriddenSeverity: "warning",
          updatedAt: NOW,
          updatedByUserId: USER_ID,
          comment: "Mode budget assume.",
        },
      },
    });
    const updatedEntryRow = createEntryRow({
      severity: "warning",
      metadata: {
        severityDecision: {
          mode: "manual",
          canonicalSeverity: "critical",
          overriddenSeverity: "warning",
          updatedAt: NOW,
          updatedByUserId: USER_ID,
          comment: "Mode budget assume.",
        },
        followUp: {
          ownerUserId: OWNER_ID,
          ownerName: "Marie Curie",
          dueDate: "2026-03-20",
          updatedAt: NOW,
          updatedByUserId: USER_ID,
          comment: "Owner assigned.",
        },
      },
    });
    const { supabase, updatePayloads } = createSupabaseMock({
      initialEntryRow,
      updatedEntryRow,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await updateAffaireRegisterEntryFollowUp({
      projectId: PROJECT_ID,
      entryId: ENTRY_ID,
      ownerUserId: OWNER_ID,
      dueDate: "2026-03-20",
      comment: "Owner assigned.",
    });

    expect(updatePayloads[0]).toMatchObject({
      severity: "warning",
      metadata: expect.objectContaining({
        severityDecision: expect.objectContaining({
          mode: "manual",
          canonicalSeverity: "critical",
          overriddenSeverity: "warning",
        }),
      }),
    });
    expect(result.entry.severityDecision).toMatchObject({
      mode: "manual",
      canonicalSeverity: "critical",
      overriddenSeverity: "warning",
    });
  });

  it("restores the stored canonical severity when clearing a manual override", async () => {
    const initialEntryRow = createEntryRow({
      severity: "warning",
      metadata: {
        severityDecision: {
          mode: "manual",
          canonicalSeverity: "critical",
          overriddenSeverity: "warning",
          updatedAt: NOW,
          updatedByUserId: USER_ID,
          comment: "Mode budget assume.",
        },
      },
    });
    const updatedEntryRow = createEntryRow({
      severity: "critical",
      metadata: {
        severityDecision: {
          mode: "canonical",
          canonicalSeverity: "critical",
          overriddenSeverity: null,
          updatedAt: NOW,
          updatedByUserId: USER_ID,
          comment: "Retour au systeme.",
        },
      },
    });
    const { supabase, updatePayloads } = createSupabaseMock({
      initialEntryRow,
      updatedEntryRow,
    });
    vi.mocked(createSupabaseServerClient).mockResolvedValue(supabase as never);

    const result = await updateAffaireRegisterEntryFollowUp({
      projectId: PROJECT_ID,
      entryId: ENTRY_ID,
      severity: null,
      comment: "Retour au systeme.",
    });

    expect(updatePayloads[0]).toMatchObject({
      severity: "critical",
      metadata: expect.objectContaining({
        severityDecision: expect.objectContaining({
          mode: "canonical",
          canonicalSeverity: "critical",
          overriddenSeverity: null,
        }),
      }),
    });
    expect(result.entry.severity).toBe("critical");
    expect(result.entry.severityDecision).toMatchObject({
      mode: "canonical",
      canonicalSeverity: "critical",
      overriddenSeverity: null,
    });
  });
});
