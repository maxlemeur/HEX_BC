import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  assertDraftStatus: vi.fn(),
  createEstimateItem: vi.fn(),
  getAuthenticatedContext: vi.fn(),
}));

vi.mock("@/lib/takeoff/gemini-client", () => ({
  callGeminiStructured: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

import {
  enrichEstimateItemsWithGeneratedOuvrageProvenance,
  generateOuvragesFromText,
  insertGeneratedOuvrages,
  rejectGeneratedOuvrageDraft,
} from "@/lib/estimates/generated-ouvrages";
import {
  assertDraftStatus,
  createEstimateItem,
  getAuthenticatedContext,
} from "@/lib/estimates/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { callGeminiStructured } from "@/lib/takeoff/gemini-client";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const DRAFT_ID = "55555555-5555-4555-8555-555555555555";
const CANDIDATE_ID = "66666666-6666-4666-8666-666666666666";
const FRAGMENT_ID = "77777777-7777-4777-8777-777777777777";
const APPLICATION_ID = "88888888-8888-4888-8888-888888888888";
const ITEM_ID = "99999999-9999-4999-8999-999999999999";
const FALLBACK_SECTION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function createQueryBuilder<T>(result: { data: T; error: unknown }) {
  const builder = {
    eq: vi.fn(),
    is: vi.fn(),
    neq: vi.fn(),
    gt: vi.fn(),
    in: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
    maybeSingle: vi.fn(),
  } as Record<string, unknown>;

  const self = builder as {
    eq: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    neq: ReturnType<typeof vi.fn>;
    gt: ReturnType<typeof vi.fn>;
    in: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    limit: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    then?: Promise<{ data: T; error: unknown }>["then"];
  };

  self.eq.mockReturnValue(self);
  self.is.mockReturnValue(self);
  self.neq.mockReturnValue(self);
  self.gt.mockReturnValue(self);
  self.in.mockReturnValue(self);
  self.order.mockReturnValue(self);
  self.limit.mockReturnValue(self);
  self.select.mockReturnValue(self);
  self.single.mockResolvedValue(result);
  self.maybeSingle.mockResolvedValue(result);
  self.then = ((onfulfilled, onrejected) =>
    Promise.resolve(result).then(onfulfilled as never, onrejected as never)) as Promise<{
    data: T;
    error: unknown;
  }>["then"];

  return self;
}

function createSupabaseStub(config: Record<string, Partial<Record<string, unknown[]>>>) {
  const counters = new Map<string, number>();
  const history: Array<{
    table: string;
    operation: string;
    builder: ReturnType<typeof createQueryBuilder<unknown>>;
  }> = [];

  function next(table: string, operation: string) {
    const key = `${table}:${operation}`;
    const index = counters.get(key) ?? 0;
    counters.set(key, index + 1);
    const entry = config[table]?.[operation]?.[index];
    if (!entry) {
      throw new Error(`Unexpected ${operation} call on ${table} at index ${index}`);
    }
    history.push({
      table,
      operation,
      builder: entry as ReturnType<typeof createQueryBuilder<unknown>>,
    });
    return entry;
  }

  return {
    __history: history,
    from: vi.fn((table: string) => ({
      select: vi.fn(() => next(table, "select")),
      insert: vi.fn(() => next(table, "insert")),
      update: vi.fn(() => next(table, "update")),
      delete: vi.fn(() => next(table, "delete")),
    })),
  };
}

function createAuthenticatedContext(supabase: ReturnType<typeof createSupabaseStub>) {
  vi.mocked(getAuthenticatedContext).mockResolvedValue({
    supabase: supabase as never,
    tenantId: TENANT_ID,
    tenantRole: "engineer",
    userId: USER_ID,
  });
  vi.mocked(assertDraftStatus).mockImplementation(() => undefined);
}

function createVersionAccessRow() {
  return {
    id: VERSION_ID,
    project_id: PROJECT_ID,
    status: "draft",
    updated_at: "2026-03-07T09:00:00.000Z",
    estimate_projects: {
      id: PROJECT_ID,
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      name: "Affaire EST-381",
      reference: "AFF-381",
      client_name: "Client Test",
      notes: null,
      is_archived: false,
    },
  };
}

function createDraftRow(status: "pending" | "applied" | "discarded" = "pending") {
  return {
    id: DRAFT_ID,
    created_at: "2026-03-07T09:01:00.000Z",
    updated_at: "2026-03-07T09:01:00.000Z",
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    target_version_id: VERSION_ID,
    created_by: USER_ID,
    source_kind: "free_text",
    preferred_lot_id: null,
    status,
    summary: {},
    generation_metadata: {},
    applied_at: status === "pending" ? null : "2026-03-07T09:05:00.000Z",
  };
}

function createFragmentRow() {
  return {
    id: FRAGMENT_ID,
    created_at: "2026-03-07T09:01:00.000Z",
    updated_at: "2026-03-07T09:01:00.000Z",
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    draft_id: DRAFT_ID,
    fragment_order: 0,
    source_kind: "free_text",
    status: "active",
    label: "Texte libre saisi",
    excerpt: "Pose de faux plafond 120 m2.",
    normalized_excerpt: "pose de faux plafond 120 m2.",
    source_document_id: null,
    source_file_name: null,
    source_page_from: null,
    source_page_to: null,
    selection_label: null,
    cctp_section_ref: null,
    metadata: {},
  };
}

function createCandidateRow(
  resolutionStatus: "pending" | "inserted" | "rejected" = "pending"
) {
  return {
    id: CANDIDATE_ID,
    created_at: "2026-03-07T09:02:00.000Z",
    updated_at: "2026-03-07T09:02:00.000Z",
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    target_version_id: VERSION_ID,
    draft_id: DRAFT_ID,
    candidate_order: 0,
    suggested_lot_id: null,
    lot_label: null,
    designation: "Pose de faux plafond",
    normalized_designation: "pose de faux plafond",
    unit: "m2",
    quantity: 120,
    confidence: 0.62,
    ai_status: "plausible",
    resolution_status: resolutionStatus,
    reasoning: "Fallback heuristique base sur le texte source.",
    metadata: {},
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createServiceRoleClient).mockReturnValue({
    rpc: vi.fn().mockResolvedValue({ error: null }),
  } as never);
});

describe("generateOuvragesFromText", () => {
  it("persists a reviewable fallback draft with source fragments and candidate provenance", async () => {
    const supabase = createSupabaseStub({
      estimate_versions: {
        select: [
          createQueryBuilder({ data: createVersionAccessRow(), error: null }),
          createQueryBuilder({ data: [], error: null }),
        ],
      },
      draft_locks: {
        select: [
          createQueryBuilder({
            data: {
              id: "lock-1",
              version_id: VERSION_ID,
              user_id: USER_ID,
              locked_at: "2026-03-07T09:00:00.000Z",
              expires_at: "2099-03-07T09:30:00.000Z",
            },
            error: null,
          }),
        ],
      },
      affaire_briefs: {
        select: [createQueryBuilder({ data: [], error: null })],
      },
      estimate_templates: {
        select: [createQueryBuilder({ data: [], error: null })],
      },
      estimate_assemblies: {
        select: [createQueryBuilder({ data: [], error: null })],
      },
      estimate_generated_ouvrage_drafts: {
        update: [
          createQueryBuilder({ data: { ...createDraftRow(), summary: {}, generation_metadata: {} }, error: null }),
          createQueryBuilder({ data: [], error: null }),
        ],
        insert: [createQueryBuilder({ data: createDraftRow(), error: null })],
      },
      estimate_generated_ouvrage_source_fragments: {
        insert: [createQueryBuilder({ data: [createFragmentRow()], error: null })],
      },
      estimate_generated_ouvrage_candidates: {
        insert: [createQueryBuilder({ data: [createCandidateRow()], error: null })],
      },
      estimate_generated_ouvrage_candidate_sources: {
        insert: [createQueryBuilder({ data: [], error: null })],
      },
    });

    createAuthenticatedContext(supabase);
    vi.mocked(callGeminiStructured).mockRejectedValueOnce(new Error("Gemini down"));

    const result = await generateOuvragesFromText({
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      sourceKind: "free_text",
      sourceText: "Pose de faux plafond 120 m2.",
    });

    expect(result.projectId).toBe(PROJECT_ID);
    expect(result.status).toBe("pending");
    expect(result.summary.totalCandidates).toBe(1);
    expect(result.candidates[0]).toMatchObject({
      designation: "Pose de faux plafond",
      unit: "m2",
      quantity: 120,
      status: "plausible",
      resolutionStatus: "pending",
    });
    expect(result.candidates[0]?.sources[0]).toMatchObject({
      sourceFragmentId: FRAGMENT_ID,
      type: "text",
      label: "Texte libre saisi",
    });
    expect(vi.mocked(callGeminiStructured)).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous pending draft until the new draft is fully materialized", async () => {
    const supabase = createSupabaseStub({
      estimate_versions: {
        select: [
          createQueryBuilder({ data: createVersionAccessRow(), error: null }),
          createQueryBuilder({ data: [], error: null }),
        ],
      },
      draft_locks: {
        select: [
          createQueryBuilder({
            data: {
              id: "lock-1",
              version_id: VERSION_ID,
              user_id: USER_ID,
              locked_at: "2026-03-07T09:00:00.000Z",
              expires_at: "2099-03-07T09:30:00.000Z",
            },
            error: null,
          }),
        ],
      },
      affaire_briefs: {
        select: [createQueryBuilder({ data: [], error: null })],
      },
      estimate_templates: {
        select: [createQueryBuilder({ data: [], error: null })],
      },
      estimate_assemblies: {
        select: [createQueryBuilder({ data: [], error: null })],
      },
      estimate_generated_ouvrage_drafts: {
        insert: [createQueryBuilder({ data: createDraftRow(), error: null })],
        update: [
          createQueryBuilder({
            data: { id: DRAFT_ID },
            error: null,
          }),
        ],
      },
      estimate_generated_ouvrage_source_fragments: {
        insert: [
          createQueryBuilder({
            data: null,
            error: { message: "insert fragments failed", code: "23514" },
          }),
        ],
        update: [createQueryBuilder({ data: [], error: null })],
      },
    });

    createAuthenticatedContext(supabase);

    await expect(
      generateOuvragesFromText({
        projectId: PROJECT_ID,
        versionId: VERSION_ID,
        sourceKind: "free_text",
        sourceText: "Pose de faux plafond 120 m2.",
      })
    ).rejects.toMatchObject({
      message: "Impossible de persister les fragments sources des ouvrages.",
    });

    const draftUpdateHistory = supabase.__history.filter(
      (entry) =>
        entry.table === "estimate_generated_ouvrage_drafts" && entry.operation === "update"
    );

    expect(draftUpdateHistory).toHaveLength(1);
    expect(draftUpdateHistory[0]?.builder.eq).toHaveBeenCalledWith("id", DRAFT_ID);
    expect(draftUpdateHistory[0]?.builder.eq).not.toHaveBeenCalledWith(
      "target_version_id",
      VERSION_ID
    );
  });
});

describe("insertGeneratedOuvrages", () => {
  it("creates estimate items from pending candidates and marks the draft applied", async () => {
    const supabase = createSupabaseStub({
      estimate_versions: {
        select: [createQueryBuilder({ data: createVersionAccessRow(), error: null })],
      },
      draft_locks: {
        select: [
          createQueryBuilder({
            data: {
              id: "lock-1",
              version_id: VERSION_ID,
              user_id: USER_ID,
              locked_at: "2026-03-07T09:00:00.000Z",
              expires_at: "2099-03-07T09:30:00.000Z",
            },
            error: null,
          }),
        ],
      },
      estimate_generated_ouvrage_drafts: {
        select: [createQueryBuilder({ data: createDraftRow(), error: null })],
        update: [
          createQueryBuilder({
            data: { ...createDraftRow("applied"), summary: {}, generation_metadata: {} },
            error: null,
          }),
        ],
      },
      estimate_generated_ouvrage_source_fragments: {
        select: [createQueryBuilder({ data: [createFragmentRow()], error: null })],
      },
      estimate_generated_ouvrage_candidates: {
        select: [createQueryBuilder({ data: [createCandidateRow()], error: null })],
        update: [
          createQueryBuilder({
            data: createCandidateRow("inserted"),
            error: null,
          }),
        ],
      },
      estimate_generated_ouvrage_candidate_sources: {
        select: [
          createQueryBuilder({
            data: [
              {
                id: "link-1",
                created_at: "2026-03-07T09:02:00.000Z",
                tenant_id: TENANT_ID,
                draft_id: DRAFT_ID,
                candidate_id: CANDIDATE_ID,
                source_fragment_id: FRAGMENT_ID,
                source_rank: 0,
                rationale: null,
                metadata: {},
              },
            ],
            error: null,
          }),
        ],
      },
      estimate_generated_ouvrage_applications: {
        select: [createQueryBuilder({ data: [], error: null })],
        insert: [
          createQueryBuilder({
            data: {
              id: APPLICATION_ID,
              created_at: "2026-03-07T09:05:00.000Z",
              updated_at: "2026-03-07T09:05:00.000Z",
              tenant_id: TENANT_ID,
              draft_id: DRAFT_ID,
              candidate_id: CANDIDATE_ID,
              target_version_id: VERSION_ID,
              estimate_item_id: ITEM_ID,
              applied_by: USER_ID,
              applied_payload: {},
            },
            error: null,
          }),
        ],
      },
      estimate_items: {
        select: [createQueryBuilder({ data: [], error: null })],
      },
    });

    createAuthenticatedContext(supabase);
    vi.mocked(createEstimateItem).mockResolvedValueOnce({
      item: {
        id: FALLBACK_SECTION_ID,
      },
    } as never);
    vi.mocked(createEstimateItem).mockResolvedValueOnce({
      item: {
        id: ITEM_ID,
      },
    } as never);

    const result = await insertGeneratedOuvrages({
      versionId: VERSION_ID,
      draftId: DRAFT_ID,
      acceptedCandidates: [
        {
          candidateId: CANDIDATE_ID,
          designation: "Pose de faux plafond",
          unit: "m2",
          quantity: 120,
          lotId: null,
        },
      ],
    });

    expect(vi.mocked(createEstimateItem)).toHaveBeenNthCalledWith(
      1,
      VERSION_ID,
      expect.objectContaining({
        item_type: "section",
        parent_id: null,
        title: "A classer",
        source_provider: "generated_ouvrage",
      })
    );
    expect(vi.mocked(createEstimateItem)).toHaveBeenNthCalledWith(
      2,
      VERSION_ID,
      expect.objectContaining({
        item_type: "line",
        parent_id: FALLBACK_SECTION_ID,
        title: "Pose de faux plafond",
        quantity: 120,
        source_provider: "generated_ouvrage",
      })
    );
    expect(result).toMatchObject({
      ok: true,
      insertedCount: 1,
      draftStatus: "applied",
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
    });
  });

  it("reuses the explicit 'A classer' section when it already exists", async () => {
    const supabase = createSupabaseStub({
      estimate_versions: {
        select: [createQueryBuilder({ data: createVersionAccessRow(), error: null })],
      },
      draft_locks: {
        select: [
          createQueryBuilder({
            data: {
              id: "lock-1",
              version_id: VERSION_ID,
              user_id: USER_ID,
              locked_at: "2026-03-07T09:00:00.000Z",
              expires_at: "2099-03-07T09:30:00.000Z",
            },
            error: null,
          }),
        ],
      },
      estimate_generated_ouvrage_drafts: {
        select: [createQueryBuilder({ data: createDraftRow(), error: null })],
        update: [
          createQueryBuilder({
            data: { ...createDraftRow("applied"), summary: {}, generation_metadata: {} },
            error: null,
          }),
        ],
      },
      estimate_generated_ouvrage_source_fragments: {
        select: [createQueryBuilder({ data: [createFragmentRow()], error: null })],
      },
      estimate_generated_ouvrage_candidates: {
        select: [createQueryBuilder({ data: [createCandidateRow()], error: null })],
        update: [
          createQueryBuilder({
            data: createCandidateRow("inserted"),
            error: null,
          }),
        ],
      },
      estimate_generated_ouvrage_candidate_sources: {
        select: [
          createQueryBuilder({
            data: [
              {
                id: "link-1",
                created_at: "2026-03-07T09:02:00.000Z",
                tenant_id: TENANT_ID,
                draft_id: DRAFT_ID,
                candidate_id: CANDIDATE_ID,
                source_fragment_id: FRAGMENT_ID,
                source_rank: 0,
                rationale: null,
                metadata: {},
              },
            ],
            error: null,
          }),
        ],
      },
      estimate_generated_ouvrage_applications: {
        select: [createQueryBuilder({ data: [], error: null })],
        insert: [
          createQueryBuilder({
            data: {
              id: APPLICATION_ID,
              created_at: "2026-03-07T09:05:00.000Z",
              updated_at: "2026-03-07T09:05:00.000Z",
              tenant_id: TENANT_ID,
              draft_id: DRAFT_ID,
              candidate_id: CANDIDATE_ID,
              target_version_id: VERSION_ID,
              estimate_item_id: ITEM_ID,
              applied_by: USER_ID,
              applied_payload: {},
            },
            error: null,
          }),
        ],
      },
      estimate_items: {
        select: [
          createQueryBuilder({
            data: [{ id: FALLBACK_SECTION_ID, title: "A classer" }],
            error: null,
          }),
        ],
      },
    });

    createAuthenticatedContext(supabase);
    vi.mocked(createEstimateItem).mockResolvedValueOnce({
      item: {
        id: ITEM_ID,
      },
    } as never);

    await insertGeneratedOuvrages({
      versionId: VERSION_ID,
      draftId: DRAFT_ID,
      acceptedCandidates: [
        {
          candidateId: CANDIDATE_ID,
          designation: "Pose de faux plafond",
          unit: "m2",
          quantity: 120,
          lotId: null,
        },
      ],
    });

    expect(vi.mocked(createEstimateItem)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createEstimateItem)).toHaveBeenCalledWith(
      VERSION_ID,
      expect.objectContaining({
        item_type: "line",
        parent_id: FALLBACK_SECTION_ID,
      })
    );
  });

  it("rolls back inserted estimate items when application persistence fails", async () => {
    const supabase = createSupabaseStub({
      estimate_versions: {
        select: [createQueryBuilder({ data: createVersionAccessRow(), error: null })],
      },
      draft_locks: {
        select: [
          createQueryBuilder({
            data: {
              id: "lock-1",
              version_id: VERSION_ID,
              user_id: USER_ID,
              locked_at: "2026-03-07T09:00:00.000Z",
              expires_at: "2099-03-07T09:30:00.000Z",
            },
            error: null,
          }),
        ],
      },
      estimate_generated_ouvrage_drafts: {
        select: [createQueryBuilder({ data: createDraftRow(), error: null })],
      },
      estimate_generated_ouvrage_source_fragments: {
        select: [createQueryBuilder({ data: [createFragmentRow()], error: null })],
      },
      estimate_generated_ouvrage_candidates: {
        select: [createQueryBuilder({ data: [createCandidateRow()], error: null })],
      },
      estimate_generated_ouvrage_candidate_sources: {
        select: [
          createQueryBuilder({
            data: [
              {
                id: "link-1",
                created_at: "2026-03-07T09:02:00.000Z",
                tenant_id: TENANT_ID,
                draft_id: DRAFT_ID,
                candidate_id: CANDIDATE_ID,
                source_fragment_id: FRAGMENT_ID,
                source_rank: 0,
                rationale: null,
                metadata: {},
              },
            ],
            error: null,
          }),
        ],
      },
      estimate_generated_ouvrage_applications: {
        select: [createQueryBuilder({ data: [], error: null })],
        insert: [
          createQueryBuilder({
            data: null,
            error: { message: "application insert failed", code: "23514" },
          }),
        ],
      },
      estimate_items: {
        select: [createQueryBuilder({ data: [], error: null })],
        delete: [createQueryBuilder({ data: [], error: null })],
      },
    });

    createAuthenticatedContext(supabase);
    vi.mocked(createEstimateItem).mockResolvedValueOnce({
      item: {
        id: FALLBACK_SECTION_ID,
      },
    } as never);
    vi.mocked(createEstimateItem).mockResolvedValue({
      item: {
        id: ITEM_ID,
      },
    } as never);

    await expect(
      insertGeneratedOuvrages({
        versionId: VERSION_ID,
        draftId: DRAFT_ID,
        acceptedCandidates: [
          {
            candidateId: CANDIDATE_ID,
            designation: "Pose de faux plafond",
            unit: "m2",
            quantity: 120,
            lotId: null,
          },
        ],
      })
    ).rejects.toMatchObject({
      message: "Impossible de tracer l'application du candidat d'ouvrage.",
    });

    const deleteHistory = supabase.__history.filter(
      (entry) => entry.table === "estimate_items" && entry.operation === "delete"
    );

    expect(deleteHistory).toHaveLength(1);
    expect(deleteHistory[0]?.builder.eq).toHaveBeenCalledWith("version_id", VERSION_ID);
    expect(deleteHistory[0]?.builder.in).toHaveBeenCalledWith("id", [ITEM_ID]);
  });

  it("rejects candidate insertion when the quantity is still unknown", async () => {
    const supabase = createSupabaseStub({
      estimate_versions: {
        select: [createQueryBuilder({ data: createVersionAccessRow(), error: null })],
      },
      draft_locks: {
        select: [
          createQueryBuilder({
            data: {
              id: "lock-1",
              version_id: VERSION_ID,
              user_id: USER_ID,
              locked_at: "2026-03-07T09:00:00.000Z",
              expires_at: "2099-03-07T09:30:00.000Z",
            },
            error: null,
          }),
        ],
      },
      estimate_generated_ouvrage_drafts: {
        select: [createQueryBuilder({ data: createDraftRow(), error: null })],
      },
      estimate_generated_ouvrage_source_fragments: {
        select: [createQueryBuilder({ data: [createFragmentRow()], error: null })],
      },
      estimate_generated_ouvrage_candidates: {
        select: [createQueryBuilder({ data: [createCandidateRow()], error: null })],
      },
      estimate_generated_ouvrage_candidate_sources: {
        select: [createQueryBuilder({ data: [], error: null })],
      },
      estimate_generated_ouvrage_applications: {
        select: [createQueryBuilder({ data: [], error: null })],
      },
    });

    createAuthenticatedContext(supabase);

    await expect(
      insertGeneratedOuvrages({
        versionId: VERSION_ID,
        draftId: DRAFT_ID,
        acceptedCandidates: [
          {
            candidateId: CANDIDATE_ID,
            designation: "Pose de faux plafond",
            unit: "m2",
            quantity: null,
            lotId: null,
          },
        ],
      })
    ).rejects.toMatchObject({
      code: "EST381_CANDIDATE_QUANTITY_REQUIRED",
    });

    expect(vi.mocked(createEstimateItem)).not.toHaveBeenCalled();
  });
});

describe("rejectGeneratedOuvrageDraft", () => {
  it("rejects the last pending candidate and discards the draft", async () => {
    const supabase = createSupabaseStub({
      estimate_generated_ouvrage_drafts: {
        select: [
          createQueryBuilder({ data: createDraftRow(), error: null }),
          createQueryBuilder({ data: createDraftRow(), error: null }),
        ],
        update: [
          createQueryBuilder({
            data: { ...createDraftRow("discarded"), summary: {}, generation_metadata: {} },
            error: null,
          }),
        ],
      },
      estimate_versions: {
        select: [createQueryBuilder({ data: createVersionAccessRow(), error: null })],
      },
      draft_locks: {
        select: [
          createQueryBuilder({
            data: {
              id: "lock-1",
              version_id: VERSION_ID,
              user_id: USER_ID,
              locked_at: "2026-03-07T09:00:00.000Z",
              expires_at: "2099-03-07T09:30:00.000Z",
            },
            error: null,
          }),
        ],
      },
      estimate_generated_ouvrage_source_fragments: {
        select: [createQueryBuilder({ data: [createFragmentRow()], error: null })],
        update: [createQueryBuilder({ data: [], error: null })],
      },
      estimate_generated_ouvrage_candidates: {
        select: [createQueryBuilder({ data: [createCandidateRow()], error: null })],
        update: [
          createQueryBuilder({
            data: createCandidateRow("rejected"),
            error: null,
          }),
        ],
      },
      estimate_generated_ouvrage_candidate_sources: {
        select: [createQueryBuilder({ data: [], error: null })],
      },
      estimate_generated_ouvrage_applications: {
        select: [createQueryBuilder({ data: [], error: null })],
      },
    });

    createAuthenticatedContext(supabase);

    const result = await rejectGeneratedOuvrageDraft({
      draftId: DRAFT_ID,
      candidateId: CANDIDATE_ID,
      reason: "A clarifier avec le client.",
    });

    expect(result).toMatchObject({
      ok: true,
      draftStatus: "discarded",
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
    });
  });

  it("does not resurrect a draft that was already discarded", async () => {
    const discardedDraft = createDraftRow("discarded");
    const supabase = createSupabaseStub({
      estimate_generated_ouvrage_drafts: {
        select: [
          createQueryBuilder({ data: discardedDraft, error: null }),
          createQueryBuilder({ data: discardedDraft, error: null }),
        ],
      },
      estimate_versions: {
        select: [createQueryBuilder({ data: createVersionAccessRow(), error: null })],
      },
      draft_locks: {
        select: [
          createQueryBuilder({
            data: {
              id: "lock-1",
              version_id: VERSION_ID,
              user_id: USER_ID,
              locked_at: "2026-03-07T09:00:00.000Z",
              expires_at: "2099-03-07T09:30:00.000Z",
            },
            error: null,
          }),
        ],
      },
      estimate_generated_ouvrage_source_fragments: {
        select: [createQueryBuilder({ data: [createFragmentRow()], error: null })],
      },
      estimate_generated_ouvrage_candidates: {
        select: [createQueryBuilder({ data: [createCandidateRow()], error: null })],
      },
      estimate_generated_ouvrage_candidate_sources: {
        select: [createQueryBuilder({ data: [], error: null })],
      },
      estimate_generated_ouvrage_applications: {
        select: [createQueryBuilder({ data: [], error: null })],
      },
    });

    createAuthenticatedContext(supabase);

    await expect(
      rejectGeneratedOuvrageDraft({
        draftId: DRAFT_ID,
        candidateId: CANDIDATE_ID,
        reason: "A clarifier avec le client.",
      })
    ).rejects.toMatchObject({
      code: "EST381_DRAFT_DISCARDED",
    });

    const candidateUpdateHistory = supabase.__history.filter(
      (entry) =>
        entry.table === "estimate_generated_ouvrage_candidates" && entry.operation === "update"
    );
    expect(candidateUpdateHistory).toHaveLength(0);
  });
});

describe("enrichEstimateItemsWithGeneratedOuvrageProvenance", () => {
  it("adds generated ouvrage source metadata with applied values and fragments", async () => {
    const supabase = createSupabaseStub({
      estimate_generated_ouvrage_applications: {
        select: [
          createQueryBuilder({
            data: [
              {
                id: APPLICATION_ID,
                created_at: "2026-03-07T09:05:00.000Z",
                updated_at: "2026-03-07T09:05:00.000Z",
                tenant_id: TENANT_ID,
                draft_id: DRAFT_ID,
                candidate_id: CANDIDATE_ID,
                target_version_id: VERSION_ID,
                estimate_item_id: ITEM_ID,
                applied_by: USER_ID,
                applied_payload: {
                  designation: "Pose de faux plafond",
                  unit: "m2",
                  quantity: 120,
                },
              },
            ],
            error: null,
          }),
        ],
      },
      estimate_generated_ouvrage_candidates: {
        select: [createQueryBuilder({ data: [createCandidateRow("inserted")], error: null })],
      },
      estimate_generated_ouvrage_drafts: {
        select: [
          createQueryBuilder({
            data: [
              {
                id: DRAFT_ID,
                created_at: "2026-03-07T09:01:00.000Z",
                generation_metadata: {
                  prompt_version: "est381-generated-ouvrages-v1",
                  used_fallback: true,
                },
              },
            ],
            error: null,
          }),
        ],
      },
      estimate_generated_ouvrage_candidate_sources: {
        select: [
          createQueryBuilder({
            data: [
              {
                id: "link-1",
                created_at: "2026-03-07T09:02:00.000Z",
                tenant_id: TENANT_ID,
                draft_id: DRAFT_ID,
                candidate_id: CANDIDATE_ID,
                source_fragment_id: FRAGMENT_ID,
                source_rank: 0,
                rationale: null,
                metadata: {},
              },
            ],
            error: null,
          }),
        ],
      },
      estimate_generated_ouvrage_source_fragments: {
        select: [createQueryBuilder({ data: [createFragmentRow()], error: null })],
      },
    });

    const result = await enrichEstimateItemsWithGeneratedOuvrageProvenance({
      supabase: supabase as never,
      tenantId: TENANT_ID,
      items: [
        {
          id: ITEM_ID,
          created_at: "2026-03-07T09:00:00.000Z",
          updated_at: "2026-03-07T09:00:00.000Z",
          tenant_id: TENANT_ID,
          version_id: VERSION_ID,
          parent_id: null,
          item_type: "line",
          position: 1,
          title: "Pose de faux plafond",
          description: null,
          quantity: 120,
          unit_price_ht_cents: 0,
          tax_rate_bp: 2000,
          k_fo: null,
          h_mo: null,
          h_mo_majoration: 1,
          k_mo: null,
          h_mo_atelier: null,
          k_mo_atelier: null,
          labor_role_atelier_id: null,
          h_mo_chantier: null,
          k_mo_chantier: null,
          labor_role_chantier_id: null,
          pu_ht_cents: 0,
          labor_role_id: null,
          category_id: null,
          supply_type_id: null,
          selected_supplier_price_id: null,
          line_total_ht_cents: 0,
          line_tax_cents: 0,
          line_total_ttc_cents: 0,
          source_provider: "manual",
          source_job_id: null,
          source_file_name: null,
          source_page: null,
          source_metadata: null,
          source_extracted_at: null,
        },
      ],
    });

    expect(result[0]?.source_provider).toBe("generated_ouvrage");
    expect(result[0]?.source_metadata).toMatchObject({
      kind: "generated_ouvrage",
      candidate_id: CANDIDATE_ID,
      applied_values: {
        designation: "Pose de faux plafond",
        unit: "m2",
        quantity: 120,
      },
      sources: [
        {
          source_fragment_id: FRAGMENT_ID,
          type: "text",
        },
      ],
    });
  });
});
