import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));
vi.mock("@/lib/estimates/structure-drafts", () => ({
  generateEstimateStructureDraft: vi.fn(),
  withEstimateAiGenerationLease: vi.fn(),
}));
vi.mock("@/lib/takeoff/gemini-client", () => ({
  callGeminiStructured: vi.fn(),
}));

import {
  enrichEstimateItemsWithVersionZeroProvenance,
  materializeVersionZeroDraft,
} from "@/lib/estimates/version-zero-drafts";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const TENANT_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const DRAFT_ID = "66666666-6666-4666-8666-666666666666";
const LOT_ID = "77777777-7777-4777-8777-777777777777";
const ACCEPTED_LINE_ID = "88888888-8888-4888-8888-888888888888";
const EDITED_LINE_ID = "99999999-9999-4999-8999-999999999999";
const REJECTED_LINE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCEPTED_ITEM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EDITED_ITEM_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MANUAL_ITEM_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const GENERATED_AT = "2026-07-31T08:00:00.000Z";
const MATERIALIZED_AT = "2026-07-31T09:00:00.000Z";

type DraftStatus =
  | "ia_a_revoir"
  | "ready_for_version"
  | "materialized"
  | "discarded"
  | "superseded";
type ReviewStatus = "pending" | "accepted" | "edited" | "rejected";
type LockState = "owned" | "missing" | "foreign";
type VersionZeroLineRow = ReturnType<typeof makeLine>;
type VersionZeroLotRow = ReturnType<typeof makeLot>;
type VersionZeroApplicationRow = ReturnType<typeof makeApplication>;

type HarnessScenario = {
  lockState?: LockState;
  draftStatus?: DraftStatus;
  itemCount?: number;
  lots?: VersionZeroLotRow[];
  lines?: VersionZeroLineRow[];
  applications?: VersionZeroApplicationRow[];
};

type QueryFilter = {
  operator: "eq" | "gt" | "in";
  column: string;
  value: unknown;
};

type QueryCall = {
  table: string;
  operation: "select" | "insert" | "update" | "delete";
  columns: string;
  filters: QueryFilter[];
  orders: Array<{ column: string; ascending: boolean }>;
  limit: number | null;
  cardinality: "many" | "single" | "maybeSingle";
  payload?: unknown;
};

type QueryResult = {
  data: unknown;
  error: null;
  count?: number | null;
};

type ResolveQuery = (call: QueryCall) => QueryResult;

class ScenarioQuery implements PromiseLike<QueryResult> {
  constructor(
    readonly call: QueryCall,
    private readonly resolveQuery: ResolveQuery
  ) {}

  select(columns = "*", _options?: unknown) {
    void _options;
    this.call.operation = "select";
    this.call.columns = columns;
    return this;
  }

  insert(payload: unknown) {
    this.call.operation = "insert";
    this.call.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.call.operation = "update";
    this.call.payload = payload;
    return this;
  }

  delete() {
    this.call.operation = "delete";
    return this;
  }

  eq(column: string, value: unknown) {
    this.call.filters.push({ operator: "eq", column, value });
    return this;
  }

  gt(column: string, value: unknown) {
    this.call.filters.push({ operator: "gt", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.call.filters.push({ operator: "in", column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }) {
    this.call.orders.push({
      column,
      ascending: options?.ascending ?? true,
    });
    return this;
  }

  limit(value: number) {
    this.call.limit = value;
    return this;
  }

  single() {
    this.call.cardinality = "single";
    return this;
  }

  maybeSingle() {
    this.call.cardinality = "maybeSingle";
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.resolveQuery(this.call)).then(onfulfilled, onrejected);
  }
}

function makeLot() {
  return {
    id: LOT_ID,
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    version_id: VERSION_ID,
    draft_id: DRAFT_ID,
    lot_key: "electricite",
    lot_order: 0,
    lot_label: "Electricite",
    status: "generated" as const,
    confidence: 0.81,
    provenance: { items: ["CCTP.pdf"] },
    risk_signals: ["Coordination a confirmer"],
    metadata: {
      facts: ["Lot explicite"],
      hypotheses: [],
      inferences: ["Decomposition necessaire"],
      missing_signals: [],
    },
    created_at: GENERATED_AT,
    updated_at: GENERATED_AT,
  };
}

function makeLine(input: {
  id: string;
  order: number;
  reviewStatus: ReviewStatus;
  proposedTitle: string;
  proposedDescription?: string | null;
  proposedQuantity?: number | null;
  proposedUnit?: string | null;
  editedTitle?: string | null;
  editedDescription?: string | null;
  editedQuantity?: number | null;
  editedUnit?: string | null;
  confidence?: number;
  provenance?: string[];
}) {
  return {
    id: input.id,
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    version_id: VERSION_ID,
    draft_id: DRAFT_ID,
    lot_id: LOT_ID,
    line_order: input.order,
    review_status: input.reviewStatus,
    proposed_title: input.proposedTitle,
    proposed_description: input.proposedDescription ?? null,
    proposed_quantity: input.proposedQuantity ?? null,
    proposed_unit: input.proposedUnit ?? null,
    edited_title: input.editedTitle ?? null,
    edited_description: input.editedDescription ?? null,
    edited_quantity: input.editedQuantity ?? null,
    edited_unit: input.editedUnit ?? null,
    confidence: input.confidence ?? 0.82,
    provenance: { items: input.provenance ?? ["CCTP.pdf p. 4"] },
    facts: ["Reseau identifie"],
    hypotheses: ["Acces confirme"],
    inferences: ["Pose incluse"],
    missing_signals: ["Calepinage absent"],
    metadata: { risk_signals: ["Quantite a valider"] },
    materialized_estimate_item_id: null,
    created_at: GENERATED_AT,
    updated_at: GENERATED_AT,
  };
}

function makeApplication(input: {
  estimateItemId: string;
  lineId: string;
  order: number;
}) {
  return {
    id: "application-" + input.order,
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    version_id: VERSION_ID,
    draft_id: DRAFT_ID,
    lot_id: LOT_ID,
    line_id: input.lineId,
    estimate_item_id: input.estimateItemId,
    parent_section_item_id: null,
    applied_by: USER_ID,
    application_order: input.order,
    applied_payload: {},
    created_at: MATERIALIZED_AT,
    updated_at: MATERIALIZED_AT,
  };
}

function defaultAcceptedLine() {
  return makeLine({
    id: ACCEPTED_LINE_ID,
    order: 0,
    reviewStatus: "accepted",
    proposedTitle: "Cable cuivre",
    proposedDescription: "Fourniture et pose",
    proposedQuantity: 12,
    proposedUnit: "ml",
  });
}

function createSupabaseHarness(scenario: HarnessScenario = {}) {
  const queries: QueryCall[] = [];
  const state = {
    draftStatus: scenario.draftStatus ?? ("ready_for_version" as DraftStatus),
    materializedAt:
      scenario.draftStatus === "materialized" ? MATERIALIZED_AT : null,
  };
  const lots = scenario.lots ?? [makeLot()];
  const lines = scenario.lines ?? [defaultAcceptedLine()];
  const applications = scenario.applications ?? [];

  const resolveQuery: ResolveQuery = (call) => {
    let data: unknown;
    let count: number | null | undefined;

    switch (call.table) {
      case "tenant_memberships":
        data = [
          {
            tenant_id: TENANT_ID,
            role: "engineer",
            is_default: true,
            created_at: GENERATED_AT,
          },
        ];
        break;
      case "estimate_versions":
        data = [
          {
            id: VERSION_ID,
            project_id: PROJECT_ID,
            status: "draft",
            margin_multiplier: 1.2,
            tax_rate_bp: 2000,
            updated_at: GENERATED_AT,
            estimate_projects: {
              id: PROJECT_ID,
              tenant_id: TENANT_ID,
              user_id: USER_ID,
              name: "Projet V0",
              reference: null,
              client_name: null,
              notes: null,
              is_archived: false,
            },
          },
        ];
        break;
      case "draft_locks":
        data =
          scenario.lockState === "missing"
            ? []
            : [
                {
                  id: "lock-v0",
                  version_id: VERSION_ID,
                  user_id:
                    scenario.lockState === "foreign" ? OTHER_USER_ID : USER_ID,
                  locked_at: GENERATED_AT,
                  expires_at: "2099-07-31T10:00:00.000Z",
                },
              ];
        break;
      case "estimate_items":
        data = null;
        count = scenario.itemCount ?? 0;
        break;
      case "estimate_version_zero_drafts":
        data = [
          {
            id: DRAFT_ID,
            tenant_id: TENANT_ID,
            project_id: PROJECT_ID,
            version_id: VERSION_ID,
            brief_id: null,
            created_by: USER_ID,
            status: state.draftStatus,
            summary: { summary_text: "V0 a relire" },
            generation_metadata: { model: "test" },
            selected_lots: ["Electricite"],
            materialized_at: state.materializedAt,
            materialized_by: state.materializedAt ? USER_ID : null,
            superseded_by_draft_id: null,
            created_at: GENERATED_AT,
            updated_at: GENERATED_AT,
          },
        ];
        break;
      case "estimate_version_zero_lots":
        data = lots;
        break;
      case "estimate_version_zero_lines":
        data = lines;
        break;
      case "estimate_version_zero_applications":
        data = applications;
        break;
      default:
        throw new Error("Unexpected table query: " + call.table);
    }

    if (call.cardinality !== "many") {
      const rows = Array.isArray(data) ? data : data === null ? [] : [data];
      data = rows[0] ?? null;
    }

    return { data, error: null, count };
  };

  const from = vi.fn((table: string) => {
    const call: QueryCall = {
      table,
      operation: "select",
      columns: "*",
      filters: [],
      orders: [],
      limit: null,
      cardinality: "many",
    };
    queries.push(call);
    return new ScenarioQuery(call, resolveQuery);
  });
  const rpc = vi.fn(async (_name: string, _payload: unknown) => {
    void _name;
    void _payload;
    state.draftStatus = "materialized";
    state.materializedAt = MATERIALIZED_AT;
    return {
      data: [{ draft_id: DRAFT_ID }],
      error: null,
    };
  });
  const authGetUser = vi.fn().mockResolvedValue({
    data: { user: { id: USER_ID } },
    error: null,
  });
  const supabase = {
    auth: { getUser: authGetUser },
    from,
    rpc,
  };

  return { supabase, queries, rpc, authGetUser };
}

function installHarness(scenario: HarnessScenario = {}) {
  const harness = createSupabaseHarness(scenario);
  vi.mocked(createSupabaseServerClient).mockResolvedValue(
    harness.supabase as never
  );
  return harness;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(MATERIALIZED_AT));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("materializeVersionZeroDraft", () => {
  it("materializes accepted and edited lines with their provenance in one RPC", async () => {
    const acceptedLine = defaultAcceptedLine();
    const editedLine = makeLine({
      id: EDITED_LINE_ID,
      order: 1,
      reviewStatus: "edited",
      proposedTitle: "Ancien tableau",
      proposedDescription: "Description initiale",
      proposedQuantity: 1,
      proposedUnit: "u",
      editedTitle: "Tableau principal revise",
      editedDescription: "Description validee",
      editedQuantity: 2.5,
      editedUnit: "ens",
      confidence: 0.64,
      provenance: ["Note technique.pdf p. 8"],
    });
    const rejectedLine = makeLine({
      id: REJECTED_LINE_ID,
      order: 2,
      reviewStatus: "rejected",
      proposedTitle: "Option rejetee",
    });
    const harness = installHarness({
      lines: [rejectedLine, editedLine, acceptedLine],
    });

    const result = await materializeVersionZeroDraft({
      versionId: VERSION_ID,
      draftId: DRAFT_ID,
    });

    expect(harness.rpc).toHaveBeenCalledTimes(1);
    const [rpcName, rpcPayload] = harness.rpc.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(rpcName).toBe("materialize_estimate_version_zero_draft");

    const sectionItems = rpcPayload.p_section_items as Array<Record<string, unknown>>;
    const lineItems = rpcPayload.p_line_items as Array<Record<string, unknown>>;
    const applicationRows = rpcPayload.p_application_rows as Array<
      Record<string, unknown>
    >;
    const lineLinks = rpcPayload.p_line_links as Array<Record<string, unknown>>;

    expect(sectionItems).toHaveLength(1);
    expect(sectionItems[0]).toMatchObject({
      position: 1,
      title: "Electricite",
      source_provider: "version_zero_draft",
    });
    expect(lineItems.map((item) => item.title)).toEqual([
      "Cable cuivre",
      "Tableau principal revise",
    ]);
    expect(lineItems.every((item) => item.parent_id === sectionItems[0].id)).toBe(
      true
    );
    expect(lineItems[1]).toMatchObject({
      description: "Description validee",
      quantity: 2.5,
      unit_price_ht_cents: 0,
      pu_ht_cents: 0,
      line_total_ht_cents: 0,
      source_provider: "version_zero_draft",
      source_metadata: {
        applications: [
          {
            draft_id: DRAFT_ID,
            lot_id: LOT_ID,
            line_id: EDITED_LINE_ID,
            lot_label: "Electricite",
            review_status: "edited",
            confidence: 0.64,
            proposed: {
              title: "Ancien tableau",
              description: "Description initiale",
              quantity: 1,
              unit: "u",
            },
            edited: {
              title: "Tableau principal revise",
              description: "Description validee",
              quantity: 2.5,
              unit: "ens",
            },
            effective: {
              title: "Tableau principal revise",
              description: "Description validee",
              quantity: 2.5,
              unit: "ens",
            },
            provenance: ["Note technique.pdf p. 8"],
            facts: ["Reseau identifie"],
            hypotheses: ["Acces confirme"],
            inferences: ["Pose incluse"],
            missing_signals: ["Calepinage absent"],
            risk_signals: ["Quantite a valider"],
          },
        ],
      },
    });
    expect(applicationRows.map((row) => row.line_id)).toEqual([
      ACCEPTED_LINE_ID,
      EDITED_LINE_ID,
    ]);
    expect(applicationRows.map((row) => row.application_order)).toEqual([0, 1]);
    expect(applicationRows.map((row) => row.estimate_item_id)).toEqual(
      lineItems.map((item) => item.id)
    );
    expect(applicationRows[1]).toMatchObject({
      applied_payload: {
        lot_label: "Electricite",
        review_status: "edited",
        confidence: 0.64,
        effective: {
          title: "Tableau principal revise",
          description: "Description validee",
          quantity: 2.5,
          unit: "ens",
        },
      },
    });
    expect(lineLinks).toEqual([
      {
        line_id: ACCEPTED_LINE_ID,
        materialized_estimate_item_id: lineItems[0].id,
      },
      {
        line_id: EDITED_LINE_ID,
        materialized_estimate_item_id: lineItems[1].id,
      },
    ]);
    expect(JSON.stringify(rpcPayload)).not.toContain(REJECTED_LINE_ID);
    expect(result.draft.status).toBe("materialized");
    expect(harness.queries.every((query) => query.operation === "select")).toBe(
      true
    );
  });

  it("rejects pending review before calling the materialization RPC", async () => {
    const harness = installHarness({
      draftStatus: "ia_a_revoir",
      lines: [
        makeLine({
          id: ACCEPTED_LINE_ID,
          order: 0,
          reviewStatus: "pending",
          proposedTitle: "Ligne a relire",
        }),
      ],
    });

    await expect(
      materializeVersionZeroDraft({
        versionId: VERSION_ID,
        draftId: DRAFT_ID,
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "EST384_PENDING_LINES",
      details: { draftId: DRAFT_ID, pendingCount: 1 },
    });

    expect(harness.rpc).not.toHaveBeenCalled();
    expect(harness.queries.every((query) => query.operation === "select")).toBe(
      true
    );
  });

  it("rejects a terminal draft before later reads or the RPC", async () => {
    const harness = installHarness({
      draftStatus: "materialized",
      itemCount: 3,
    });

    await expect(
      materializeVersionZeroDraft({
        versionId: VERSION_ID,
        draftId: DRAFT_ID,
      })
    ).rejects.toMatchObject({
      status: 409,
      code: "EST384_DRAFT_NOT_REVIEWABLE",
      details: { draftId: DRAFT_ID, status: "materialized" },
    });

    expect(harness.rpc).not.toHaveBeenCalled();
    expect(harness.authGetUser).toHaveBeenCalledTimes(1);
    expect(harness.queries.map((query) => query.table)).toEqual([
      "tenant_memberships",
      "estimate_versions",
      "draft_locks",
      "estimate_version_zero_drafts",
    ]);
  });

  it.each([
    {
      label: "missing",
      lockState: "missing" as const,
      expected: {
        status: 409,
        code: "LOCK_REQUIRED",
        details: { lock: null },
      },
    },
    {
      label: "owned by another user",
      lockState: "foreign" as const,
      expected: {
        status: 409,
        code: "CONFLICT",
        details: {
          lock: {
            version_id: VERSION_ID,
            user_id: OTHER_USER_ID,
            is_owner: false,
          },
        },
      },
    },
  ])("rejects a $label draft lock before later reads", async ({ lockState, expected }) => {
    const harness = installHarness({ lockState });

    await expect(
      materializeVersionZeroDraft({
        versionId: VERSION_ID,
        draftId: DRAFT_ID,
      })
    ).rejects.toMatchObject(expected);

    expect(harness.rpc).not.toHaveBeenCalled();
    expect(harness.queries.map((query) => query.table)).toEqual([
      "tenant_memberships",
      "estimate_versions",
      "draft_locks",
    ]);
  });
});

describe("enrichEstimateItemsWithVersionZeroProvenance", () => {
  it.each([
    {
      label: "there is no V0 item",
      sourceProvider: "manual",
      expectedTables: [] as string[],
    },
    {
      label: "no application matches the V0 item",
      sourceProvider: "version_zero_draft",
      expectedTables: ["estimate_version_zero_applications"],
    },
  ])("returns the input directly when $label", async ({ sourceProvider, expectedTables }) => {
    const harness = createSupabaseHarness({ applications: [] });
    const items = [
      {
        id: ACCEPTED_ITEM_ID,
        source_provider: sourceProvider,
        source_metadata: { preserved: true },
      },
    ];

    const result = await enrichEstimateItemsWithVersionZeroProvenance({
      supabase: harness.supabase as never,
      tenantId: TENANT_ID,
      items: items as never,
    });

    expect(result).toBe(items);
    expect(harness.queries.map((query) => query.table)).toEqual(expectedTables);
  });

  it("preserves item order and metadata with four bounded queries", async () => {
    const acceptedLine = defaultAcceptedLine();
    const editedLine = makeLine({
      id: EDITED_LINE_ID,
      order: 1,
      reviewStatus: "edited",
      proposedTitle: "Tableau provisoire",
      proposedDescription: "Avant revue",
      proposedQuantity: 1,
      proposedUnit: "u",
      editedTitle: "Tableau final",
      editedDescription: "Apres revue",
      editedQuantity: 2,
      editedUnit: "ens",
      confidence: 0.61,
      provenance: ["Schema.pdf p. 2"],
    });
    const harness = createSupabaseHarness({
      draftStatus: "materialized",
      lines: [acceptedLine, editedLine],
      applications: [
        makeApplication({
          estimateItemId: EDITED_ITEM_ID,
          lineId: EDITED_LINE_ID,
          order: 1,
        }),
        makeApplication({
          estimateItemId: ACCEPTED_ITEM_ID,
          lineId: ACCEPTED_LINE_ID,
          order: 0,
        }),
      ],
    });
    const items = [
      {
        id: MANUAL_ITEM_ID,
        source_provider: "manual",
        source_metadata: { origin: "manual" },
      },
      {
        id: EDITED_ITEM_ID,
        source_provider: "version_zero_draft",
        source_metadata: { preserved: "value", applications: [{ stale: true }] },
      },
      {
        id: ACCEPTED_ITEM_ID,
        source_provider: "version_zero_draft",
        source_metadata: null,
      },
    ];

    const result = await enrichEstimateItemsWithVersionZeroProvenance({
      supabase: harness.supabase as never,
      tenantId: TENANT_ID,
      items: items as never,
    });

    expect(result.map((item) => item.id)).toEqual([
      MANUAL_ITEM_ID,
      EDITED_ITEM_ID,
      ACCEPTED_ITEM_ID,
    ]);
    expect(result[0]).toBe(items[0]);
    expect(result[1].source_metadata).toMatchObject({
      preserved: "value",
      applications: [
        {
          draft_id: DRAFT_ID,
          lot_id: LOT_ID,
          lot_label: "Electricite",
          application_order: 1,
          review_status: "edited",
          confidence: 0.61,
          generated_at: GENERATED_AT,
          materialized_at: MATERIALIZED_AT,
          proposed: {
            title: "Tableau provisoire",
            description: "Avant revue",
            quantity: 1,
            unit: "u",
          },
          edited: {
            title: "Tableau final",
            description: "Apres revue",
            quantity: 2,
            unit: "ens",
          },
          effective: {
            title: "Tableau final",
            description: "Apres revue",
            quantity: 2,
            unit: "ens",
          },
          provenance: ["Schema.pdf p. 2"],
          facts: ["Reseau identifie"],
          hypotheses: ["Acces confirme"],
          inferences: ["Pose incluse"],
          missing_signals: ["Calepinage absent"],
          risk_signals: ["Quantite a valider"],
        },
      ],
    });
    expect(result[2].source_metadata).toMatchObject({
      applications: [
        {
          application_order: 0,
          review_status: "accepted",
          proposed: {
            title: "Cable cuivre",
            description: "Fourniture et pose",
            quantity: 12,
            unit: "ml",
          },
          effective: {
            title: "Cable cuivre",
            description: "Fourniture et pose",
            quantity: 12,
            unit: "ml",
          },
        },
      ],
    });
    expect(harness.queries.map((query) => query.table)).toEqual([
      "estimate_version_zero_applications",
      "estimate_version_zero_drafts",
      "estimate_version_zero_lots",
      "estimate_version_zero_lines",
    ]);
    expect(harness.queries[0].filters).toContainEqual({
      operator: "in",
      column: "estimate_item_id",
      value: [EDITED_ITEM_ID, ACCEPTED_ITEM_ID],
    });
  });
});
