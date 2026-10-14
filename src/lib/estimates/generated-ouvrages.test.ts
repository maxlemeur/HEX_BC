import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/estimates/server", () => ({
  assertDraftStatus: vi.fn(),
  createEstimateItem: vi.fn(),
}));

vi.mock("@/lib/estimates/batch-preparation", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/estimates/batch-preparation")>(),
  prepareEstimateBatch: vi.fn(),
}));

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(),
}));

vi.mock("@/lib/takeoff/gemini-client", () => ({
  callGeminiStructured: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: vi.fn(),
}));

import {
  generateOuvragesFromText,
  insertGeneratedOuvrages,
  rejectGeneratedOuvrageDraft,
} from "@/lib/estimates/generated-ouvrages";
import {
  assertDraftStatus,
  createEstimateItem,
} from "@/lib/estimates/server";
import { prepareEstimateBatch } from "@/lib/estimates/batch-preparation";
import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { callGeminiStructured } from "@/lib/takeoff/gemini-client";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const DRAFT_ID = "55555555-5555-4555-8555-555555555555";
const CANDIDATE_ID = "66666666-6666-4666-8666-666666666666";
const FRAGMENT_ID = "77777777-7777-4777-8777-777777777777";
const FALLBACK_SECTION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SUBDETAIL_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOCK_SESSION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

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
    payload?: unknown;
  }> = [];

  function next(table: string, operation: string, payload?: unknown) {
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
      payload,
    });
    return entry;
  }

  return {
    __history: history,
    rpc: vi.fn<(...args: [string, Record<string, unknown>]) => Promise<{ data: unknown; error: unknown }>>(),
    from: vi.fn((table: string) => ({
      select: vi.fn((payload?: unknown) => next(table, "select", payload)),
      insert: vi.fn((payload?: unknown) => next(table, "insert", payload)),
      update: vi.fn((payload?: unknown) => next(table, "update", payload)),
      delete: vi.fn((payload?: unknown) => next(table, "delete", payload)),
    })),
  };
}

function createAuthenticatedContext(supabase: ReturnType<typeof createSupabaseStub>) {
  vi.mocked(getAuthenticatedContext).mockResolvedValue({
    supabase: supabase as never,
    tenantId: TENANT_ID,
    tenantRole: "engineer",
    userId: USER_ID,
    isTenantAdmin: false,
    membership: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      role: "engineer",
      is_default: true,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    },
  });
  vi.mocked(assertDraftStatus).mockImplementation(() => undefined);
}

function createVersionAccessRow() {
  return {
    id: VERSION_ID,
    project_id: PROJECT_ID,
    status: "draft",
    updated_at: "2026-03-07T09:00:00.000Z",
    margin_multiplier: 1.3,
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

function createLaborRoleRow() {
  return {
    id: "10101010-1010-4010-8010-101010101010",
    name: "Poseur faux plafond",
    hourly_rate_cents: 1500,
    position: 1,
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

function createSubdetailDraftRow(
  status: "pending_review" | "reviewed" | "applied" = "reviewed",
  reviewedCandidate?: {
    designation?: string;
    unit?: string | null;
    quantity?: number | null;
  },
  reviewedDsCents = 162_000
) {
  return {
    id: SUBDETAIL_ID,
    created_at: "2026-03-07T09:03:00.000Z",
    updated_at: "2026-03-07T09:04:00.000Z",
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    target_version_id: VERSION_ID,
    draft_id: DRAFT_ID,
    parent_work_id: CANDIDATE_ID,
    created_by: USER_ID,
    status,
    summary: {
      ds_cents: reviewedDsCents,
      indicative_target_price_cents: Math.round(reviewedDsCents * 1.3),
      confidence: 0.72,
      pricing_source: "heuristic_review_draft",
      facts: ["Ouvrage parent: Pose de faux plafond"],
      hypotheses: ["Coût materiau indicatif estime par heuristique métier à confirmer."],
      inferences: ["Presence de pose -> besoin de main d'oeuvre."],
      risk_signals: [],
    },
    generation_metadata: {
      margin_multiplier: 1.3,
      reviewed_candidate: {
        designation: reviewedCandidate?.designation ?? "Pose de faux plafond",
        unit: reviewedCandidate?.unit ?? "m2",
        quantity: reviewedCandidate?.quantity ?? 120,
      },
    },
    applied_at: status === "applied" ? "2026-03-07T09:05:00.000Z" : null,
  };
}

function createSubdetailItemRows() {
  return [
    {
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      created_at: "2026-03-07T09:03:00.000Z",
      updated_at: "2026-03-07T09:03:00.000Z",
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      draft_id: DRAFT_ID,
      subdetail_id: SUBDETAIL_ID,
      parent_work_id: CANDIDATE_ID,
      source_fragment_id: FRAGMENT_ID,
      component_order: 0,
      status: "suggested",
      cost_type: "material",
      designation: "Pose de faux plafond",
      unit: "m2",
      quantity: 1,
      unit_cost_ht_cents: 81_000,
      loss_coeff_bp: 0,
      yield_value: null,
      yield_unit: null,
      confidence: 0.7,
      source_label: "Texte libre saisi",
      facts: ["Ouvrage parent: Pose de faux plafond"],
      hypotheses: [],
      inferences: [],
      metadata: { risk_signals: [] },
    },
    {
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      created_at: "2026-03-07T09:03:00.000Z",
      updated_at: "2026-03-07T09:03:00.000Z",
      tenant_id: TENANT_ID,
      project_id: PROJECT_ID,
      draft_id: DRAFT_ID,
      subdetail_id: SUBDETAIL_ID,
      parent_work_id: CANDIDATE_ID,
      source_fragment_id: FRAGMENT_ID,
      component_order: 1,
      status: "suggested",
      cost_type: "labor",
      designation: "Main d'oeuvre - Pose de faux plafond",
      unit: "h",
      quantity: 54,
      unit_cost_ht_cents: 1500,
      loss_coeff_bp: 0,
      yield_value: 0.45,
      yield_unit: "h/m2",
      confidence: 0.65,
      source_label: "Texte libre saisi",
      facts: [],
      hypotheses: ["Rendement MO estime à partir du type d'ouvrage et doit être validé."],
      inferences: ["Presence de pose -> besoin de main d'oeuvre."],
      metadata: { risk_signals: [] },
    },
  ];
}

function createSubdetailItemSourceRows() {
  return [
    {
      id: "12121212-1212-4212-8212-121212121212",
      created_at: "2026-03-07T09:03:30.000Z",
      tenant_id: TENANT_ID,
      draft_id: DRAFT_ID,
      subdetail_id: SUBDETAIL_ID,
      parent_work_id: CANDIDATE_ID,
      component_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      source_fragment_id: FRAGMENT_ID,
      source_rank: 0,
      evidence_kind: "fact",
      note: "Source primaire du besoin parent",
      metadata: {},
    },
  ];
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
              session_id: LOCK_SESSION_ID,
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

    supabase.rpc.mockResolvedValue({ data: {
      ok: true, versionId: VERSION_ID, draftId: DRAFT_ID,
      status: "pending", discardedDraftIds: [],
    }, error: null });
    createAuthenticatedContext(supabase);
    vi.mocked(callGeminiStructured).mockRejectedValueOnce(new Error("Gemini down"));

    const result = await generateOuvragesFromText({
      projectId: PROJECT_ID,
      versionId: VERSION_ID,
      draftLockSessionId: LOCK_SESSION_ID,
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
    for (const table of ["estimate_templates", "estimate_assemblies"]) {
      const libraryQuery = supabase.__history.find(
        (entry) => entry.table === table && entry.operation === "select"
      );
      expect(libraryQuery?.builder.eq).toHaveBeenCalledWith("created_by", USER_ID);
      expect(libraryQuery?.builder.eq).not.toHaveBeenCalledWith("user_id", USER_ID);
    }
    expect(vi.mocked(callGeminiStructured)).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("close_generated_ouvrage_generation", {
      p_version_id: VERSION_ID, p_draft_id: DRAFT_ID,
      p_draft_lock_session_id: LOCK_SESSION_ID, p_mode: "complete",
    });
    expect(supabase.__history.filter((entry) => entry.table === "estimate_generated_ouvrage_drafts"
      && entry.operation === "update")).toHaveLength(1);
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
              session_id: LOCK_SESSION_ID,
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
      },
      estimate_generated_ouvrage_source_fragments: {
        insert: [
          createQueryBuilder({
            data: null,
            error: { message: "insert fragments failed", code: "23514" },
          }),
        ],
      },
    });

    supabase.rpc.mockResolvedValue({ data: {
      ok: true, versionId: VERSION_ID, draftId: DRAFT_ID,
      status: "discarded", discardedDraftIds: [DRAFT_ID],
    }, error: null });
    createAuthenticatedContext(supabase);

    await expect(
      generateOuvragesFromText({
        projectId: PROJECT_ID,
        versionId: VERSION_ID,
        draftLockSessionId: LOCK_SESSION_ID,
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

    expect(draftUpdateHistory).toHaveLength(0);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith("close_generated_ouvrage_generation", {
      p_version_id: VERSION_ID, p_draft_id: DRAFT_ID,
      p_draft_lock_session_id: LOCK_SESSION_ID, p_mode: "failed",
    });
    expect(supabase.__history.filter((entry) => entry.table === "estimate_generated_ouvrage_source_fragments"
      && entry.operation === "update")).toHaveLength(0);
  });
});

describe("insertGeneratedOuvrages", () => {
  // Retained regressions adapted before the atomic implementation. RPC stubs
  // exercise preparation/output handling; native WFC02 proves transactionality.
  const OPERATION_KEY = "13131313-1313-4313-8313-131313131313";
  const REVIEW_TOKEN = "a".repeat(64);
  const EXPECTED_UPDATED_AT = "2026-03-07T09:00:00.000Z";

  function request(quantity: number | null = 120) {
    return {
      versionId: VERSION_ID,
      draftId: DRAFT_ID,
      draftLockSessionId: LOCK_SESSION_ID,
      operationKey: OPERATION_KEY,
      expectedUpdatedAt: EXPECTED_UPDATED_AT,
      acceptedCandidates: [{ candidateId: CANDIDATE_ID, designation: "Pose de faux plafond",
        unit: "m2", quantity, lotId: null, reviewToken: REVIEW_TOKEN }],
    };
  }

  function setup(options: {
    existingFallback?: boolean;
    manualLaborQuantity?: number;
    commitError?: { code: string; message: string };
  } = {}) {
    const reviewedItems = createSubdetailItemRows().map((item) =>
      item.cost_type === "labor" && options.manualLaborQuantity !== undefined
        ? { ...item, status: "manual", quantity: options.manualLaborQuantity }
        : item);
    const ds = options.manualLaborQuantity === undefined ? 162_000 : 81_000 + options.manualLaborQuantity * 1500;
    const snapshot = {
      draft: createDraftRow(), candidate: createCandidateRow(),
      subdetailDraft: createSubdetailDraftRow("reviewed", undefined, ds),
      items: reviewedItems, itemSources: createSubdetailItemSourceRows(),
      candidateSources: [{ id: "14141414-1414-4414-8414-141414141414",
        created_at: "2026-03-07T09:02:00.000Z", tenant_id: TENANT_ID,
        draft_id: DRAFT_ID, candidate_id: CANDIDATE_ID, source_fragment_id: FRAGMENT_ID,
        source_rank: 0, rationale: null, metadata: {} }],
      fragments: [createFragmentRow()], reviewToken: REVIEW_TOKEN,
    };
    const supabase = createSupabaseStub({
      estimate_versions: { select: [createQueryBuilder({ data: createVersionAccessRow(), error: null })] },
      draft_locks: { select: [createQueryBuilder({ data: {
        id: "lock-1", version_id: VERSION_ID, user_id: USER_ID, session_id: LOCK_SESSION_ID,
        locked_at: EXPECTED_UPDATED_AT, expires_at: "2099-03-07T09:30:00.000Z",
      }, error: null })] },
      labor_roles: { select: [createQueryBuilder({ data: [{ ...createLaborRoleRow(),
        tenant_id: TENANT_ID, user_id: USER_ID, is_active: true }], error: null })] },
      estimate_items: { select: [createQueryBuilder({ data: options.existingFallback
        ? [{ id: FALLBACK_SECTION_ID, title: "À classer", item_type: "section", parent_id: null, position: 1 }]
        : [], error: null })] },
    });
    supabase.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
      if (name === "get_generated_ouvrage_application_receipt") return { data: null, error: null };
      if (name === "read_generated_ouvrage_review") return { data: snapshot, error: null };
      if (name !== "commit_generated_ouvrages") throw new Error(`Unexpected RPC ${name}`);
      if (options.commitError) return { data: null, error: options.commitError };
      const candidates = args.p_prepared_candidates as Array<Record<string, string>>;
      return { error: null, data: {
        ok: true, insertedCount: candidates.length, draftStatus: "applied",
        projectId: PROJECT_ID, versionId: VERSION_ID,
        applications: candidates.map((candidate) => ({ candidateId: candidate.candidateId,
          subdetailId: candidate.subdetailId, assemblyId: candidate.assemblyId,
          estimateItemId: candidate.estimateItemId, applicationId: candidate.applicationId,
          snapshotId: candidate.snapshotId })),
        version: { id: VERSION_ID, updatedAt: "2026-03-07T09:06:00.000Z" },
        totals: { totalHtCents: 210600, totalTaxCents: 0, totalTtcCents: 210600 },
        receipt: { operationKey: OPERATION_KEY, actorId: USER_ID, versionId: VERSION_ID,
          draftId: DRAFT_ID, expectedUpdatedAt: EXPECTED_UPDATED_AT,
          acceptedCandidates: args.p_accepted_candidates, committedAt: "2026-03-07T09:06:00.000Z" },
        replayed: false,
        currentVersion: { id: VERSION_ID, updatedAt: "2026-03-07T09:06:00.000Z", status: "draft" },
      } };
    });
    createAuthenticatedContext(supabase);
    vi.mocked(prepareEstimateBatch).mockImplementation(async (input) => ({
      createdIds: input.createdIds ?? [], itemUpdates: [],
      versionPatch: { total_ht_cents: 210600, total_tax_cents: 0, total_ttc_cents: 210600 },
      calculationContext: { labor_roles: [], margin_tiers: [], labor_split_flag: null },
      expectedAidPolicy: null,
    }));
    return { supabase, snapshot };
  }

  function prepared(supabase: ReturnType<typeof createSupabaseStub>) {
    const commit = supabase.rpc.mock.calls.find(([name]) => name === "commit_generated_ouvrages");
    expect(commit).toBeDefined();
    const args = commit![1] as Record<string, unknown>;
    return (args.p_prepared_candidates as Array<Record<string, unknown>>)[0];
  }

  it("creates estimate items from pending candidates and marks the draft applied", async () => {
    const { supabase } = setup();
    const result = await insertGeneratedOuvrages(request());
    const operations = vi.mocked(prepareEstimateBatch).mock.calls[0][0].operations;
    expect(operations).toHaveLength(2);
    expect(operations[0]).toMatchObject({ op: "create", data: {
      item_type: "section", parent_id: null, title: "À classer", source_provider: "generated_ouvrage",
    } });
    const candidate = prepared(supabase);
    expect(operations[1]).toMatchObject({ op: "create", data: {
      item_type: "line", parent_id: candidate.resolvedLotId, title: "Pose de faux plafond",
      quantity: 120, unit_price_ht_cents: 1350, h_mo: 54,
      labor_role_id: createLaborRoleRow().id, source_provider: "generated_ouvrage", k_fo: 0.5, k_mo: 1,
    } });
    expect(candidate.estimateItemMapping).toMatchObject({ mode: "legacy_labor_allocated",
      hMo: 54, laborRoleId: createLaborRoleRow().id, laborDsCents: 81_000, nonLaborDsCents: 81_000 });
    expect(result).toMatchObject({ ok: true, insertedCount: 1, draftStatus: "applied",
      projectId: PROJECT_ID, versionId: VERSION_ID, replayed: false,
      receipt: { operationKey: OPERATION_KEY, acceptedCandidates: request().acceptedCandidates } });
    expect(createEstimateItem).not.toHaveBeenCalled();
    expect(supabase.__history.every((entry) => entry.operation === "select")).toBe(true);
  });

  it("derives inserted labor hours from a manual reviewed quantity even when yield metadata is still present", async () => {
    const { supabase } = setup({ existingFallback: true, manualLaborQuantity: 36 });
    await insertGeneratedOuvrages(request());
    const operations = vi.mocked(prepareEstimateBatch).mock.calls[0][0].operations;
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ op: "create", data: { item_type: "line", h_mo: 36,
      labor_role_id: createLaborRoleRow().id, unit_price_ht_cents: 1125, k_fo: 0.6, k_mo: 1 } });
    expect(prepared(supabase).estimateItemMapping).toMatchObject({ hMo: 36, laborDsCents: 54_000,
      laborTrace: [expect.objectContaining({ quantity: 36, derivedHours: 36, hoursSource: "quantity" })] });
  });

  it("keeps exact decimal yield hours in the canonical application plan", async () => {
    const { supabase, snapshot } = setup({ existingFallback: true });
    snapshot.candidate.quantity = 1.005;
    snapshot.subdetailDraft.generation_metadata.reviewed_candidate.quantity = 1.005;
    snapshot.subdetailDraft.summary.ds_cents = 1500;
    snapshot.subdetailDraft.summary.indicative_target_price_cents = 1950;
    snapshot.items = snapshot.items.filter((item) => item.cost_type === "labor");
    for (const item of snapshot.items) {
      item.quantity = 1;
      item.unit = "h/m2";
      item.yield_value = 0.1;
      item.yield_unit = "h/m2";
      item.unit_cost_ht_cents = 1500;
    }
    snapshot.itemSources = [];

    await insertGeneratedOuvrages(request(1.005));

    expect(prepared(supabase).estimateItemMapping).toMatchObject({
      hMo: 0.101, kMo: 9.901, kFo: 0, unitPriceHtCents: 1493,
      laborDsCents: 1500, nonLaborDsCents: 0,
      laborTrace: [expect.objectContaining({ derivedHours: 0.101, hoursSource: "yield" })],
    });
    expect(prepared(supabase).componentProjections).toEqual([
      expect.objectContaining({ hMo: 0.101, kMo: 9.901, dsCents: 1500 }),
    ]);
  });

  it("reuses the explicit 'À classer' section when it already exists", async () => {
    const { supabase } = setup({ existingFallback: true });
    await insertGeneratedOuvrages(request());
    const operations = vi.mocked(prepareEstimateBatch).mock.calls[0][0].operations;
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ op: "create", data: {
      item_type: "line", parent_id: FALLBACK_SECTION_ID,
    } });
    expect(prepared(supabase).resolvedLotId).toBe(FALLBACK_SECTION_ID);
  });

  it("reports a known application persistence refusal without direct writes or compensating deletes", async () => {
    const { supabase } = setup({ commitError: { code: "23514", message: "GENERATED_OUVRAGE_APPLY_REJECTED" } });
    await expect(insertGeneratedOuvrages(request())).rejects.toMatchObject({ code: "GENERATED_OUVRAGE_APPLY_REJECTED" });
    expect(supabase.rpc.mock.calls.filter(([name]) => name === "commit_generated_ouvrages")).toHaveLength(1);
    expect(supabase.__history.every((entry) => entry.operation === "select")).toBe(true);
    expect(createEstimateItem).not.toHaveBeenCalled();
  });

  it("rejects candidate insertion when the quantity is still unknown", async () => {
    const { supabase } = setup();
    await expect(insertGeneratedOuvrages(request(null))).rejects.toMatchObject({ code: "EST381_CANDIDATE_QUANTITY_REQUIRED" });
    expect(prepareEstimateBatch).not.toHaveBeenCalled();
    expect(supabase.rpc.mock.calls.some(([name]) => name === "commit_generated_ouvrages")).toBe(false);
    expect(createEstimateItem).not.toHaveBeenCalled();
  });

  it("rejects insertion when the reviewed subdetail no longer matches accepted values", async () => {
    const { supabase } = setup();
    await expect(insertGeneratedOuvrages(request(80))).rejects.toMatchObject({ code: "EST383_SUBDETAIL_STALE" });
    expect(prepareEstimateBatch).not.toHaveBeenCalled();
    expect(supabase.rpc.mock.calls.some(([name]) => name === "commit_generated_ouvrages")).toBe(false);
    expect(createEstimateItem).not.toHaveBeenCalled();
  });
});


describe("rejectGeneratedOuvrageDraft", () => {
  it("rejects the last pending candidate and discards the draft", async () => {
    const supabase = createSupabaseStub({});
    supabase.rpc.mockResolvedValue({ data: { ok: true,
      projectId: PROJECT_ID, versionId: VERSION_ID, draftStatus: "discarded" }, error: null });
    createAuthenticatedContext(supabase);
    const result = await rejectGeneratedOuvrageDraft({ versionId: VERSION_ID,
      draftId: DRAFT_ID, candidateId: CANDIDATE_ID, draftLockSessionId: LOCK_SESSION_ID,
      reason: "À clarifier avec le client." });
    expect(result).toMatchObject({ ok: true, draftStatus: "discarded", projectId: PROJECT_ID, versionId: VERSION_ID });
    expect(supabase.__history).toHaveLength(0);
  });

  it("does not resurrect a draft that was already discarded", async () => {
    const supabase = createSupabaseStub({});
    supabase.rpc.mockResolvedValue({ data: null, error: { code: "23514", message: "EST381_DRAFT_DISCARDED" } });
    createAuthenticatedContext(supabase);
    await expect(rejectGeneratedOuvrageDraft({ versionId: VERSION_ID, draftId: DRAFT_ID,
      candidateId: CANDIDATE_ID, draftLockSessionId: LOCK_SESSION_ID,
      reason: "À clarifier avec le client." })).rejects.toMatchObject({ code: "EST381_DRAFT_DISCARDED" });
    expect(supabase.__history).toHaveLength(0);
  });
});
