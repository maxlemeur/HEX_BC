import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryRestApi, type InMemoryRestRequest } from "@/test/in-memory-rest-api";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

vi.mock("@/lib/supabase/service-role", () => ({
  createOptionalServiceRoleClient: vi.fn(),
  createServiceRoleClient: vi.fn(),
}));

vi.mock("@/lib/affaires/register-server", () => ({
  buildAffaireRegisterSubmissionSignalMessage: vi.fn((input: { intro: string }) => input.intro),
  fetchAffaireRegisterGateSummary: vi.fn(),
}));

vi.mock("@/lib/email/send-approval-review-request", () => ({
  sendApprovalReviewRequestNotification: vi.fn(),
}));

vi.mock("@/lib/estimates/approval-v2-snapshot", () => ({
  freezeApprovalV2DraftIfRequired: vi.fn(),
}));

vi.mock("@/lib/estimates/review-cycle-submission", () => ({
  openEstimateReviewCycle: vi.fn(),
}));

import { submitEstimateApproval } from "@/lib/estimates/approval-workflow-server";
import { fetchAffaireRegisterGateSummary } from "@/lib/affaires/register-server";
import { sendApprovalReviewRequestNotification } from "@/lib/email/send-approval-review-request";
import { freezeApprovalV2DraftIfRequired } from "@/lib/estimates/approval-v2-snapshot";
import { openEstimateReviewCycle } from "@/lib/estimates/review-cycle-submission";
import { createOptionalServiceRoleClient } from "@/lib/supabase/service-role";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// Characterises every outcome of submitEstimateApproval through its public entry point, over
// in-memory tables: the rejections (rights, state, validation, concurrency), each approval path,
// and the ordered writes of each success (atomic seams, review email, summary projection, events).

type Row = Record<string, unknown>;
type Role = "admin" | "director" | "engineer";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_TENANT_ID = "23232323-2323-4323-8323-232323232323";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const OWNER_ID = "55555555-5555-4555-8555-555555555555";
const REVIEWER_ID = "66666666-6666-4666-8666-666666666666";
const CYCLE_ID = "77777777-7777-4777-8777-777777777777";
const PREVIOUS_CYCLE_ID = "78787878-7878-4878-8878-787878787878";
const APPROVAL_ID = "88888888-8888-4888-8888-888888888888";
const RULE_ID = "99999999-9999-4999-8999-999999999999";
const MARGIN_RULE_ID = "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a";
const ITEM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NOW = "2026-03-06T09:10:00.000Z";

function membership(userId: string, role: Role, isDefault = true): Row {
  return {
    id: `m-${userId}`,
    tenant_id: TENANT_ID,
    user_id: userId,
    role,
    is_default: isDefault,
    created_at: "2026-03-01T10:00:00.000Z",
    updated_at: "2026-03-01T10:00:00.000Z",
    tenants: { is_active: true, name: "Tenant test" },
    // The fixture filters on flat columns: the active-tenant join filter reads this key.
    "tenants.is_active": true,
  };
}

function versionRow(input: {
  tenantId?: string;
  ownerId?: string;
  totalHtCents?: number;
} = {}): Row {
  const tenantId = input.tenantId ?? TENANT_ID;
  return {
    id: VERSION_ID,
    tenant_id: tenantId,
    status: "draft",
    updated_at: "2026-03-01T09:00:00.000Z",
    content_revision: 1,
    calc_engine_version: 1,
    calc_snapshot_content_revision: null,
    calc_snapshot_context: null,
    version_number: 3,
    project_id: PROJECT_ID,
    title: "Version test",
    total_ht_cents: input.totalHtCents ?? 250000,
    margin_bp: 1200,
    margin_multiplier: 1,
    margin_mode: null,
    discount_bp: 0,
    discount_amount_cents: null,
    gross_ht_cents: null,
    discount_applied_cents: null,
    approval_status: "not_required",
    approval_summary: null,
    approval_evaluated_at: null,
    estimate_projects: {
      id: PROJECT_ID,
      tenant_id: tenantId,
      user_id: input.ownerId ?? USER_ID,
      name: "Affaire test",
      client_name: "Client A",
    },
  };
}

function ruleRow(input: {
  id?: string;
  ruleType?: string;
  threshold?: number;
  action?: string;
  isActive?: boolean;
} = {}): Row {
  return {
    id: input.id ?? RULE_ID,
    created_at: "2026-03-01T09:00:00.000Z",
    updated_at: "2026-03-01T09:00:00.000Z",
    tenant_id: TENANT_ID,
    rule_type: input.ruleType ?? "require_approval",
    scope_type: "global",
    scope_id: null,
    threshold_value: input.threshold ?? 100000,
    action: input.action ?? "require_approval",
    is_active: input.isActive ?? true,
  };
}

function approvalRow(input: {
  id?: string;
  ruleId?: string;
  status?: string;
  cycleId?: string | null;
  createdAt?: string;
} = {}): Row {
  const createdAt = input.createdAt ?? "2026-03-01T10:05:00.000Z";
  return {
    id: input.id ?? APPROVAL_ID,
    created_at: createdAt,
    updated_at: createdAt,
    tenant_id: TENANT_ID,
    version_id: VERSION_ID,
    rule_id: input.ruleId ?? RULE_ID,
    requested_by: OWNER_ID,
    approved_by: null,
    status: input.status ?? "pending",
    decided_at: null,
    approved_content_revision: null,
    review_cycle_id: input.cycleId === undefined ? CYCLE_ID : input.cycleId,
    superseded_at: null,
  };
}

function cycleRow(input: {
  id?: string;
  cycleNumber?: number;
  decision?: string | null;
  decidedAt?: string | null;
} = {}): Row {
  return {
    id: input.id ?? CYCLE_ID,
    created_at: "2026-03-01T10:00:00.000Z",
    updated_at: "2026-03-01T10:00:00.000Z",
    tenant_id: TENANT_ID,
    version_id: VERSION_ID,
    cycle_number: input.cycleNumber ?? 1,
    requested_by: OWNER_ID,
    requested_at: "2026-03-01T10:00:00.000Z",
    submission_message: null,
    assigned_reviewer_id: REVIEWER_ID,
    decided_by: input.decision ? REVIEWER_ID : null,
    decision: input.decision ?? null,
    decided_at: input.decidedAt ?? null,
    carried_over_from_cycle_id: null,
    requested_content_revision: 1,
    superseded_at: null,
    superseded_by: null,
    superseded_by_cycle_id: null,
  };
}

function profiles(): Row[] {
  return [
    { id: USER_ID, full_name: "Nadia Martin", work_email: "nadia@example.com" },
    { id: OWNER_ID, full_name: "Owner", work_email: "owner@example.com" },
    { id: REVIEWER_ID, full_name: "Camille Reviewer", work_email: "reviewer@example.com" },
  ];
}

type Harness = {
  tables: Record<string, Row[]>;
  requests: InMemoryRestRequest[];
  /** Every write in call order: REST writes and RPCs, the atomic submission seam and the email. */
  writes: () => string[];
  /** Every request in call order, reads included: `GET table`, `PATCH table`, `POST rpc/name`, `CALL seam`. */
  trace: () => string[];
  rpcBodies: (name: string) => unknown[];
  /** The bodies of the summary projection: the version update, then its audit events. */
  projectionBodies: () => unknown[];
};

function setup(input: {
  role: Role;
  tables?: Record<string, Row[]>;
  rpcErrors?: Record<string, { message: string; code?: string }>;
  serviceRole?: boolean;
}): Harness {
  const tables: Record<string, Row[]> = {
    tenant_memberships: [
      membership(USER_ID, input.role),
      membership(REVIEWER_ID, "director", false),
    ],
    profiles: profiles(),
    estimate_versions: [versionRow()],
    estimate_items: [],
    estimate_rules: [],
    estimate_approvals: [],
    estimate_review_cycles: [],
    ...input.tables,
  };
  const api = createInMemoryRestApi(tables, {
    "rpc/read_estimate_version_items": () => tables.estimate_items ?? [],
  });
  const rpc = ((name: string, ...args: unknown[]) => {
    const failure = input.rpcErrors?.[name];
    if (failure) {
      api.requests.push({
        table: `rpc/${name}`,
        url: new URL(`https://example.test/rest/v1/rpc/${name}`),
        method: "POST",
        body: args[0] ?? null,
      });
      return Promise.resolve({ data: null, error: { details: "", hint: "", code: "P0001", ...failure } });
    }
    return (api.client.rpc as (...rpcArgs: unknown[]) => unknown)(name, ...args);
  }) as typeof api.client.rpc;
  const from = api.client.from.bind(api.client);

  vi.mocked(createSupabaseServerClient).mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: USER_ID } }, error: null }),
    },
    from,
    rpc,
  } as never);
  vi.mocked(createOptionalServiceRoleClient).mockReturnValue(
    (input.serviceRole === false ? null : { from, rpc }) as never
  );
  vi.mocked(openEstimateReviewCycle).mockImplementation(async (seam) => {
    api.requests.push({
      table: "openEstimateReviewCycle",
      url: new URL("https://example.test/seam"),
      method: "CALL",
      body: seam,
    });
    const cycle = {
      ...cycleRow({ id: CYCLE_ID, cycleNumber: (tables.estimate_review_cycles?.length ?? 0) + 1 }),
      created_at: NOW,
      updated_at: NOW,
      requested_by: seam.actorUserId,
      requested_at: NOW,
      submission_message: seam.submissionMessage?.trim() || null,
      assigned_reviewer_id: seam.assignedReviewerId,
    };
    const approvals = seam.ruleIds.map((ruleId, index) => ({
      ...approvalRow({
        id: `8888888${index + 1}-8888-4888-8888-888888888888`,
        ruleId,
        createdAt: NOW,
      }),
      requested_by: seam.actorUserId,
    }));
    tables.estimate_review_cycles = [...(tables.estimate_review_cycles ?? []), cycle];
    tables.estimate_approvals = [...(tables.estimate_approvals ?? []), ...approvals];
    return { created: true, cycle, approvals } as never;
  });
  vi.mocked(sendApprovalReviewRequestNotification).mockImplementation(async (email) => {
    api.requests.push({
      table: "sendApprovalReviewRequestNotification",
      url: new URL("https://example.test/email"),
      method: "CALL",
      body: email,
    });
    return { message_id: "email-review-1", subject: "Validation requise" };
  });

  return {
    tables,
    requests: api.requests,
    writes: () =>
      api.requests
        .filter((request) => request.method !== "GET" && request.method !== "HEAD")
        .map((request) => {
          const eventType = (request.body as { p_event_type?: string } | null)?.p_event_type;
          return `${request.method} ${request.table}${eventType ? ` ${eventType}` : ""}`;
        }),
    trace: () => api.requests.map((request) => `${request.method} ${request.table}`),
    rpcBodies: (name) =>
      api.requests.filter((request) => request.table === `rpc/${name}`).map((request) => request.body),
    projectionBodies: () =>
      api.requests
        .filter(
          (request) =>
            (request.method === "PATCH" && request.table === "estimate_versions") ||
            request.table === "rpc/log_estimate_version_event"
        )
        .map((request) => request.body),
  };
}

/** The authenticated tenant membership, then the authorised version. */
const ACCESS_READS = ["GET tenant_memberships", "GET estimate_versions"];
/** Items, then the summary, readiness and validator reads, started together before any refusal they feed. */
const SUBMISSION_EVALUATION_READS = [
  "GET rpc/read_estimate_version_items",
  "GET estimate_rules",
  "GET estimate_rules",
  "GET tenant_memberships",
  "GET profiles",
  "GET estimate_approvals",
  "GET estimate_approvals",
  "GET tenant_memberships",
  "GET estimate_versions",
  "GET affaire_briefs",
  "GET estimate_version_zero_drafts",
  "HEAD estimate_items",
];
const EVALUATED_AT = "2026-03-07T08:00:00.000Z";
const THRESHOLD_MESSAGE =
  "Montant HT 2\u202f500\u00a0€ au-dessus du seuil de validation 1\u202f000\u00a0€. Demande d'approbation en attente.";

/** The exact projection of a version over the amount threshold with one pending approval. */
function pendingThresholdProjection(input: {
  trigger: "approval_request" | "approval_decision";
  previousStatus: string;
  approvalId: string;
  approvalCreatedAt: string;
}) {
  const summary = {
    requiresApproval: true,
    reasons: [
      {
        ruleId: RULE_ID,
        label: "Seuil montant HT",
        signalKey: "total_ht_cents",
        thresholdValue: 100000,
        actualValue: 250000,
        sourceState: "ready",
        message: THRESHOLD_MESSAGE,
        action: "require_approval",
        approvalStatus: "pending",
        approvalId: input.approvalId,
        approvalCreatedAt: input.approvalCreatedAt,
        approvalDecidedAt: null,
      },
    ],
    latestDecision: {
      approvalId: input.approvalId,
      status: "pending",
      decidedAt: null,
      createdAt: input.approvalCreatedAt,
      decision: null,
      cycleId: null,
      cycleNumber: null,
      commentCount: 0,
    },
    unavailableSignals: [],
  };
  return [
    { approval_status: "in_review", approval_summary: summary, approval_evaluated_at: EVALUATED_AT },
    {
      p_estimate_version_id: VERSION_ID,
      p_event_type: "approval_rules_evaluated",
      p_created_by: USER_ID,
      p_metadata: {
        trigger: input.trigger,
        previousStatus: input.previousStatus,
        approvalStatus: "in_review",
        evaluatedAt: EVALUATED_AT,
        summary,
      },
      p_occurred_at: EVALUATED_AT,
    },
    {
      p_estimate_version_id: VERSION_ID,
      p_event_type: "approval_status_changed",
      p_created_by: USER_ID,
      p_metadata: {
        previousStatus: input.previousStatus,
        nextStatus: "in_review",
        reasons: [{ ruleId: RULE_ID, approvalStatus: "pending", message: THRESHOLD_MESSAGE }],
      },
      p_occurred_at: EVALUATED_AT,
    },
  ];
}

const SUMMARY_PROJECTION = [
  "PATCH estimate_versions",
  "POST rpc/log_estimate_version_event approval_rules_evaluated",
  "POST rpc/log_estimate_version_event approval_status_changed",
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(EVALUATED_AT));
  vi.mocked(freezeApprovalV2DraftIfRequired).mockReset();
  vi.mocked(freezeApprovalV2DraftIfRequired).mockResolvedValue(false);
  vi.mocked(fetchAffaireRegisterGateSummary).mockReset();
  vi.mocked(fetchAffaireRegisterGateSummary).mockResolvedValue({
    openQuestionsCount: 0,
    criticalOpenEntries: [],
    nonCriticalOpenEntries: [],
    clarifyWithClientEntries: [],
    openAssumptionEntries: [],
    openMissingPieceEntries: [],
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("submitEstimateApproval access boundary", () => {
  it("hides a version of another tenant before any write", async () => {
    const harness = setup({
      role: "admin",
      tables: { estimate_versions: [versionRow({ tenantId: OTHER_TENANT_ID })] },
    });

    await expect(
      submitEstimateApproval({ versionId: VERSION_ID, action: "submit_for_review", ruleIds: [] })
    ).rejects.toMatchObject({ status: 404, code: "NOT_FOUND", message: "Version de chiffrage introuvable." });
    expect(harness.trace()).toEqual(ACCESS_READS);
    expect(freezeApprovalV2DraftIfRequired).not.toHaveBeenCalled();
  });

  it("hides another owner's version from an engineer, whatever the action", async () => {
    for (const action of ["request", "approve"] as const) {
      const harness = setup({
        role: "engineer",
        tables: { estimate_versions: [versionRow({ ownerId: OWNER_ID })] },
      });

      await expect(
        submitEstimateApproval({ versionId: VERSION_ID, action, ruleId: RULE_ID })
      ).rejects.toMatchObject({ status: 404, message: "Version de chiffrage introuvable." });
      expect(harness.trace()).toEqual(ACCESS_READS);
    }
  });
});

describe("submitEstimateApproval submit_for_review", () => {
  it("refuses a director before freezing or writing anything", async () => {
    const harness = setup({ role: "director", tables: { estimate_rules: [ruleRow()] } });

    await expect(
      submitEstimateApproval({ versionId: VERSION_ID, action: "submit_for_review", ruleIds: [] })
    ).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      message: "Action réservée aux demandeurs d'approbation.",
    });
    expect(freezeApprovalV2DraftIfRequired).not.toHaveBeenCalled();
    expect(harness.trace()).toEqual(ACCESS_READS);
  });

  it("refuses a submission while a blocker remains", async () => {
    const harness = setup({
      role: "admin",
      tables: {
        estimate_rules: [ruleRow({ ruleType: "critical_exceptions_max", threshold: 0, action: "block" })],
      },
    });

    await expect(
      submitEstimateApproval({ versionId: VERSION_ID, action: "submit_for_review", ruleIds: [] })
    ).rejects.toMatchObject({
      status: 400,
      message: "Des blocants restent à lever avant la soumission.",
    });
    expect(freezeApprovalV2DraftIfRequired).toHaveBeenCalledOnce();
    expect(harness.trace()).toEqual([...ACCESS_READS, ...SUBMISSION_EVALUATION_READS]);
  });

  it("refuses a reviewer outside the tenant's validators", async () => {
    const harness = setup({ role: "admin", tables: { estimate_rules: [ruleRow()] } });

    await expect(
      submitEstimateApproval({
        versionId: VERSION_ID,
        action: "submit_for_review",
        ruleIds: [],
        assignedReviewerUserId: OWNER_ID,
      })
    ).rejects.toMatchObject({
      status: 400,
      message: "Le validateur assigné n'est pas autorisé dans cette organisation.",
    });
    // The summary and readiness reads started with the validator lookup go on after its refusal:
    // wait for them, so the trace does not depend on how many async steps the refusal crosses.
    await vi.waitFor(() =>
      expect(harness.trace()).toEqual([...ACCESS_READS, ...SUBMISSION_EVALUATION_READS])
    );
  });

  it("refuses a submission when no rule can be requested", async () => {
    const harness = setup({ role: "admin", tables: { estimate_rules: [ruleRow()] } });

    await expect(
      submitEstimateApproval({
        versionId: VERSION_ID,
        action: "submit_for_review",
        ruleIds: [MARGIN_RULE_ID],
      })
    ).rejects.toMatchObject({
      status: 400,
      message: "Aucune règle de validation ne peut être soumise.",
    });
    expect(harness.trace()).toEqual([...ACCESS_READS, ...SUBMISSION_EVALUATION_READS, "GET estimate_review_cycles"]);
  });

  it("refuses a resubmission while a correction item is still pending", async () => {
    const harness = setup({
      role: "admin",
      tables: {
        estimate_rules: [ruleRow()],
        estimate_review_cycles: [
          cycleRow({ id: PREVIOUS_CYCLE_ID, decision: "changes_requested", decidedAt: "2026-03-02T10:00:00.000Z" }),
        ],
        estimate_review_correction_items: [
          {
            id: "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0",
            created_at: "2026-03-02T10:00:00.000Z",
            updated_at: "2026-03-02T10:00:00.000Z",
            tenant_id: TENANT_ID,
            version_id: VERSION_ID,
            cycle_id: PREVIOUS_CYCLE_ID,
            source_comment_id: null,
            scope_type: "project",
            scope_id: null,
            scope_label: "Affaire test",
            comment: "Revoir la marge.",
            status: "pending",
            last_treated_at: null,
            last_treated_by: null,
            last_treatment_note: null,
          },
        ],
      },
    });

    await expect(
      submitEstimateApproval({ versionId: VERSION_ID, action: "submit_for_review", ruleIds: [] })
    ).rejects.toMatchObject({
      status: 400,
      message: "Tous les items de correction doivent être traités avant la resoumission.",
    });
    expect(harness.trace()).toEqual([...ACCESS_READS, ...SUBMISSION_EVALUATION_READS, "GET estimate_review_cycles", "GET estimate_review_correction_items"]);
  });

  it("opens the cycle, emails the reviewer, then projects the summary", async () => {
    const harness = setup({ role: "engineer", tables: { estimate_rules: [ruleRow()] } });

    const result = await submitEstimateApproval({
      versionId: VERSION_ID,
      action: "submit_for_review",
      ruleIds: [],
      submissionMessage: "  Verifier la couverture CFO.  ",
      assignedReviewerUserId: REVIEWER_ID,
    });

    expect(harness.writes()).toEqual([
      "CALL openEstimateReviewCycle",
      "CALL sendApprovalReviewRequestNotification",
      ...SUMMARY_PROJECTION,
    ]);
    expect(harness.projectionBodies()).toEqual(
      pendingThresholdProjection({
        trigger: "approval_request",
        previousStatus: "not_required",
        approvalId: "88888881-8888-4888-8888-888888888888",
        approvalCreatedAt: NOW,
      })
    );
    // The access read and a readiness read; no re-read without a freeze.
    const seamIndex = harness.requests.findIndex((request) => request.table === "openEstimateReviewCycle");
    expect(
      harness.requests
        .slice(0, seamIndex)
        .filter((request) => request.table === "estimate_versions" && request.method === "GET")
    ).toHaveLength(2);
    expect(openEstimateReviewCycle).toHaveBeenCalledWith({
      versionId: VERSION_ID,
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      assignedReviewerId: REVIEWER_ID,
      ruleIds: [RULE_ID],
      submissionMessage: "  Verifier la couverture CFO.  ",
      eventMetadata: {
        requestedRuleLabels: ["Seuil montant HT"],
        assignedReviewerName: "Camille Reviewer",
        assignedReviewerEmail: "reviewer@example.com",
        resubmissionOfCycleId: null,
        resubmissionOfCycleNumber: null,
        correctionChecklistCompleted: null,
        notificationChannels: { inApp: true, email: true },
      },
    });
    expect(sendApprovalReviewRequestNotification).toHaveBeenCalledWith({
      recipientEmail: "reviewer@example.com",
      reviewerName: "Camille Reviewer",
      requesterName: "Nadia Martin",
      projectName: "Affaire test",
      versionNumber: 3,
      submissionMessage: "Verifier la couverture CFO.",
      ruleLabels: ["Seuil montant HT"],
    });
    expect(harness.requests.find((request) => request.method === "PATCH")?.body).toMatchObject({
      approval_status: "in_review",
    });
    expect(result).toEqual({
      approval: expect.objectContaining({ id: "88888881-8888-4888-8888-888888888888", rule_id: RULE_ID }),
      cycle: {
        id: CYCLE_ID,
        cycleNumber: 1,
        requestedAt: NOW,
        submissionMessage: "Verifier la couverture CFO.",
        assignedReviewer: {
          userId: REVIEWER_ID,
          fullName: "Camille Reviewer",
          workEmail: "reviewer@example.com",
        },
      },
      requestedApprovalCount: 1,
      requestedRuleIds: [RULE_ID],
    });
  });

  it("re-reads the version when the draft snapshot is frozen before evaluation", async () => {
    const harness = setup({ role: "admin", tables: { estimate_rules: [ruleRow()] } });
    vi.mocked(freezeApprovalV2DraftIfRequired).mockResolvedValueOnce(true);

    await submitEstimateApproval({
      versionId: VERSION_ID,
      action: "submit_for_review",
      ruleIds: [],
      assignedReviewerUserId: REVIEWER_ID,
    });

    // The access read and a readiness read load the version (2 reads unfrozen); a freeze adds a
    // re-read of the access before the evaluation.
    const seamIndex = harness.requests.findIndex((request) => request.table === "openEstimateReviewCycle");
    const versionReadsBeforeSeam = harness.requests
      .slice(0, seamIndex)
      .filter((request) => request.table === "estimate_versions" && request.method === "GET");
    expect(versionReadsBeforeSeam).toHaveLength(3);
    expect(vi.mocked(freezeApprovalV2DraftIfRequired).mock.calls[0]![1]).toMatchObject({ id: VERSION_ID });
  });

  it("resubmits the rules of a corrected cycle and only the requested ones", async () => {
    const harness = setup({
      role: "admin",
      tables: {
        estimate_rules: [
          ruleRow(),
          ruleRow({ id: MARGIN_RULE_ID, ruleType: "min_margin", threshold: 500, isActive: false }),
        ],
        estimate_review_cycles: [
          cycleRow({ id: PREVIOUS_CYCLE_ID, cycleNumber: 2, decision: "changes_requested", decidedAt: "2026-03-02T10:00:00.000Z" }),
        ],
        estimate_approvals: [
          approvalRow({ id: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1", ruleId: MARGIN_RULE_ID, status: "rejected", cycleId: PREVIOUS_CYCLE_ID }),
          approvalRow({ id: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2", ruleId: RULE_ID, status: "rejected", cycleId: PREVIOUS_CYCLE_ID }),
        ],
        estimate_review_correction_items: [
          {
            id: "c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0",
            created_at: "2026-03-02T10:00:00.000Z",
            updated_at: "2026-03-02T11:00:00.000Z",
            tenant_id: TENANT_ID,
            version_id: VERSION_ID,
            cycle_id: PREVIOUS_CYCLE_ID,
            source_comment_id: null,
            scope_type: "project",
            scope_id: null,
            scope_label: "Affaire test",
            comment: "Revoir la marge.",
            status: "corrected",
            last_treated_at: "2026-03-02T11:00:00.000Z",
            last_treated_by: USER_ID,
            last_treatment_note: null,
          },
        ],
      },
    });

    const result = await submitEstimateApproval({
      versionId: VERSION_ID,
      action: "submit_for_review",
      ruleIds: [MARGIN_RULE_ID, ""],
      assignedReviewerUserId: null,
    });

    expect(openEstimateReviewCycle).toHaveBeenCalledWith({
      versionId: VERSION_ID,
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      assignedReviewerId: REVIEWER_ID,
      ruleIds: [MARGIN_RULE_ID],
      submissionMessage: null,
      eventMetadata: {
        requestedRuleLabels: ["Marge minimum"],
        assignedReviewerName: "Camille Reviewer",
        assignedReviewerEmail: "reviewer@example.com",
        resubmissionOfCycleId: PREVIOUS_CYCLE_ID,
        resubmissionOfCycleNumber: 2,
        correctionChecklistCompleted: true,
        notificationChannels: { inApp: true, email: true },
      },
    });
    expect(result.requestedRuleIds).toEqual([MARGIN_RULE_ID]);
    expect(harness.writes().slice(0, 2)).toEqual([
      "CALL openEstimateReviewCycle",
      "CALL sendApprovalReviewRequestNotification",
    ]);
  });

  it("keeps the submission when the review email fails", async () => {
    const harness = setup({ role: "admin", tables: { estimate_rules: [ruleRow()] } });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(sendApprovalReviewRequestNotification).mockRejectedValueOnce(new Error("SMTP down"));

    const result = await submitEstimateApproval({
      versionId: VERSION_ID,
      action: "submit_for_review",
      ruleIds: [],
      assignedReviewerUserId: REVIEWER_ID,
    });

    expect(result.requestedApprovalCount).toBe(1);
    expect(consoleError).toHaveBeenCalledWith(
      "Failed to send approval review request notification:",
      expect.objectContaining({ message: "SMTP down" })
    );
    expect(harness.writes()).toEqual(["CALL openEstimateReviewCycle", ...SUMMARY_PROJECTION]);
    consoleError.mockRestore();
  });

  it("sends no email to a reviewer without a work email", async () => {
    const harness = setup({ role: "admin", tables: { estimate_rules: [ruleRow()] } });
    harness.tables.profiles = profiles().map((profile) =>
      profile.id === REVIEWER_ID ? { ...profile, work_email: null } : profile
    );

    await submitEstimateApproval({
      versionId: VERSION_ID,
      action: "submit_for_review",
      ruleIds: [],
      assignedReviewerUserId: REVIEWER_ID,
    });

    expect(sendApprovalReviewRequestNotification).not.toHaveBeenCalled();
    expect(vi.mocked(openEstimateReviewCycle).mock.calls[0]![0].eventMetadata).toMatchObject({
      assignedReviewerEmail: null,
      notificationChannels: { inApp: true, email: false },
    });
    expect(harness.writes()).toEqual(["CALL openEstimateReviewCycle", ...SUMMARY_PROJECTION]);
  });
});

describe("submitEstimateApproval request", () => {
  it("requires a rule id", async () => {
    const harness = setup({ role: "admin" });

    await expect(
      submitEstimateApproval({ versionId: VERSION_ID, action: "request", ruleId: "  " })
    ).rejects.toMatchObject({
      status: 400,
      message: "rule_id est obligatoire pour une demande d'approbation.",
    });
    expect(harness.trace()).toEqual(ACCESS_READS);
  });

  it("refuses an unknown rule", async () => {
    const harness = setup({ role: "admin" });

    await expect(
      submitEstimateApproval({ versionId: VERSION_ID, action: "request", ruleId: RULE_ID })
    ).rejects.toMatchObject({ status: 404, message: "Règle introuvable." });
    expect(harness.trace()).toEqual([...ACCESS_READS, "GET estimate_rules"]);
  });

  it("refuses an inactive rule before freezing the draft", async () => {
    const harness = setup({ role: "admin", tables: { estimate_rules: [ruleRow({ isActive: false })] } });

    await expect(
      submitEstimateApproval({ versionId: VERSION_ID, action: "request", ruleId: RULE_ID })
    ).rejects.toMatchObject({ status: 400, message: "La règle ciblee est inactive." });
    expect(freezeApprovalV2DraftIfRequired).not.toHaveBeenCalled();
    expect(harness.trace()).toEqual([...ACCESS_READS, "GET estimate_rules"]);
  });

  it("opens a cycle for one rule with the default validator, without email", async () => {
    const harness = setup({ role: "admin", tables: { estimate_rules: [ruleRow()] } });

    const result = await submitEstimateApproval({
      versionId: VERSION_ID,
      action: "request",
      ruleId: RULE_ID,
    });

    expect(freezeApprovalV2DraftIfRequired).toHaveBeenCalledOnce();
    expect(openEstimateReviewCycle).toHaveBeenCalledWith({
      versionId: VERSION_ID,
      tenantId: TENANT_ID,
      actorUserId: USER_ID,
      assignedReviewerId: REVIEWER_ID,
      ruleIds: [RULE_ID],
      submissionMessage: null,
      eventMetadata: {
        requestedRuleLabels: ["Seuil montant HT"],
        assignedReviewerName: "Camille Reviewer",
        assignedReviewerEmail: "reviewer@example.com",
        notificationChannels: { inApp: true, email: false },
      },
    });
    expect(sendApprovalReviewRequestNotification).not.toHaveBeenCalled();
    expect(harness.writes()).toEqual(["CALL openEstimateReviewCycle", ...SUMMARY_PROJECTION]);
    expect(harness.projectionBodies()).toEqual(
      pendingThresholdProjection({
        trigger: "approval_request",
        previousStatus: "not_required",
        approvalId: "88888881-8888-4888-8888-888888888888",
        approvalCreatedAt: NOW,
      })
    );
    expect(result).toEqual({
      approval: expect.objectContaining({ id: "88888881-8888-4888-8888-888888888888", rule_id: RULE_ID }),
    });
  });
});

describe("submitEstimateApproval decide", () => {
  function decideTables(): Record<string, Row[]> {
    return {
      estimate_rules: [ruleRow()],
      estimate_items: [
        {
          id: ITEM_ID,
          category_id: null,
          item_type: "line",
          title: "Alimentation TGBT",
          parent_id: null,
          position: 1,
        },
      ],
      estimate_review_cycles: [cycleRow()],
      estimate_approvals: [approvalRow()],
      "rpc/decide_estimate_review_cycle": [
        { cycle_id: CYCLE_ID, cycle_number: 1, approval_ids: [APPROVAL_ID], rule_ids: [RULE_ID], comment_count: 2 },
      ],
    };
  }

  it("refuses an engineer before any read of the cycle", async () => {
    const harness = setup({ role: "engineer", tables: decideTables() });

    await expect(
      submitEstimateApproval({ versionId: VERSION_ID, action: "decide", decision: "approved", comments: [] })
    ).rejects.toMatchObject({ status: 403, message: "Action réservée aux rôles de validation." });
    expect(harness.requests.some((request) => request.table === "estimate_review_cycles")).toBe(false);
    expect(harness.trace()).toEqual(ACCESS_READS);
  });

  it("refuses a decision without an open cycle", async () => {
    const harness = setup({
      role: "director",
      tables: { ...decideTables(), estimate_review_cycles: [cycleRow({ decision: "approved", decidedAt: NOW })] },
    });

    await expect(
      submitEstimateApproval({ versionId: VERSION_ID, action: "decide", decision: "approved", comments: [] })
    ).rejects.toMatchObject({ status: 400, message: "Aucun cycle de revue actif n'est disponible." });
    expect(harness.trace()).toEqual([...ACCESS_READS, "GET estimate_review_cycles"]);
  });

  it("refuses a decision without a pending approval", async () => {
    const harness = setup({
      role: "director",
      tables: { ...decideTables(), estimate_approvals: [approvalRow({ status: "approved" })] },
    });

    await expect(
      submitEstimateApproval({ versionId: VERSION_ID, action: "decide", decision: "approved", comments: [] })
    ).rejects.toMatchObject({ status: 400, message: "Aucune approbation en attente n'est disponible." });
    expect(harness.trace()).toEqual([...ACCESS_READS, "GET estimate_review_cycles", "GET estimate_approvals"]);
  });

  it("refuses a comment on a target the version no longer has", async () => {
    const harness = setup({ role: "director", tables: decideTables() });

    await expect(
      submitEstimateApproval({
        versionId: VERSION_ID,
        action: "decide",
        decision: "changes_requested",
        comments: [{ scopeType: "line", scopeId: "c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1", comment: "Revoir." }],
      })
    ).rejects.toMatchObject({
      status: 400,
      message: "Une cible de commentaire n'est plus valide pour cette version.",
    });
    expect(harness.trace()).toEqual([
      ...ACCESS_READS,
      "GET estimate_review_cycles",
      "GET estimate_approvals",
      "GET rpc/read_estimate_version_items",
      "GET estimate_rules",
      "GET estimate_approvals",
      "GET estimate_risk_alerts",
      "GET affaire_register_entries",
    ]);
  });

  it("decides the open cycle atomically with normalized comments, then projects the summary", async () => {
    const harness = setup({ role: "director", tables: decideTables() });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-07T08:00:00.000Z"));

    try {
      const result = await submitEstimateApproval({
        versionId: VERSION_ID,
        action: "decide",
        decision: "changes_requested",
        comments: [
          { scopeType: "project", scopeId: "ignored", comment: "  Revoir la marge.  " },
          { scopeType: "line", scopeId: ` ${ITEM_ID} `, comment: "Chiffrer le TGBT." },
        ],
      });

      expect(harness.rpcBodies("decide_estimate_review_cycle")).toEqual([
        {
          p_cycle_id: CYCLE_ID,
          p_decision: "changes_requested",
          p_comments: [
            { scope_type: "project", scope_id: null, scope_label: "Affaire test", comment: "Revoir la marge." },
            { scope_type: "line", scope_id: ITEM_ID, scope_label: expect.any(String), comment: "Chiffrer le TGBT." },
          ],
        },
      ]);
      expect(harness.writes()[0]).toBe("POST rpc/decide_estimate_review_cycle");
      expect(harness.writes().slice(1).every((write) => !write.includes("decide_"))).toBe(true);
      expect(harness.writes()).toEqual(["POST rpc/decide_estimate_review_cycle", ...SUMMARY_PROJECTION]);
      expect(harness.projectionBodies()).toEqual(
        pendingThresholdProjection({
          trigger: "approval_decision",
          previousStatus: "not_required",
          approvalId: APPROVAL_ID,
          approvalCreatedAt: "2026-03-01T10:05:00.000Z",
        })
      );
      expect(result).toEqual({
        approval: {
          ...approvalRow(),
          status: "rejected",
          approved_by: USER_ID,
          decided_at: "2026-03-07T08:00:00.000Z",
          updated_at: "2026-03-07T08:00:00.000Z",
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("maps an approval with reservations to an approved row", async () => {
    setup({ role: "admin", tables: decideTables() });

    const result = await submitEstimateApproval({
      versionId: VERSION_ID,
      action: "decide",
      decision: "approved_with_reservations",
      comments: [{ scopeType: "project", scopeId: null, comment: "Sous reserve du phasage." }],
    });

    expect(result.approval).toMatchObject({ id: APPROVAL_ID, status: "approved", approved_by: USER_ID });
  });

  it("reports a stale review snapshot as a conflict, without projecting the summary", async () => {
    const harness = setup({
      role: "director",
      tables: decideTables(),
      rpcErrors: { decide_estimate_review_cycle: { message: "ESTIMATE_REVIEW_SNAPSHOT_STALE" } },
    });

    await expect(
      submitEstimateApproval({ versionId: VERSION_ID, action: "decide", decision: "approved", comments: [] })
    ).rejects.toMatchObject({
      status: 409,
      code: "ESTIMATE_REVIEW_SNAPSHOT_STALE",
      message: "Le devis a été modifié depuis sa soumission. Une nouvelle revue est requise.",
    });
    expect(harness.trace()).toEqual([
      ...ACCESS_READS,
      "GET estimate_review_cycles",
      "GET estimate_approvals",
      "GET rpc/read_estimate_version_items",
      "GET estimate_rules",
      "GET estimate_approvals",
      "GET estimate_risk_alerts",
      "GET affaire_register_entries",
      "POST rpc/decide_estimate_review_cycle",
    ]);
  });
});

describe("submitEstimateApproval approve and reject", () => {
  const decided = {
    ...approvalRow(),
    status: "approved",
    approved_by: USER_ID,
    decided_at: NOW,
    approved_content_revision: 1,
  };

  function decisionTables(approval: Row = approvalRow()): Record<string, Row[]> {
    return {
      estimate_rules: [ruleRow()],
      estimate_review_cycles: [cycleRow()],
      estimate_approvals: [approval],
      "rpc/decide_estimate_approval": [decided],
    };
  }

  it("refuses an engineer before reading the approval", async () => {
    const harness = setup({ role: "engineer", tables: decisionTables() });

    await expect(
      submitEstimateApproval({ versionId: VERSION_ID, action: "approve", approvalId: APPROVAL_ID })
    ).rejects.toMatchObject({ status: 403, message: "Action réservée aux rôles de validation." });
    expect(harness.requests.some((request) => request.table === "estimate_approvals")).toBe(false);
    expect(harness.trace()).toEqual(ACCESS_READS);
  });

  it("requires a rule id or an approval id", async () => {
    const harness = setup({ role: "director", tables: decisionTables() });

    await expect(
      submitEstimateApproval({ versionId: VERSION_ID, action: "reject", ruleId: " ", approvalId: "" })
    ).rejects.toMatchObject({
      status: 400,
      message: "rule_id ou approval_id est requis pour une décision.",
    });
    expect(harness.trace()).toEqual(ACCESS_READS);
  });

  it("refuses an unknown approval id", async () => {
    const harness = setup({ role: "director", tables: decisionTables() });

    await expect(
      submitEstimateApproval({
        versionId: VERSION_ID,
        action: "approve",
        approvalId: "f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0",
      })
    ).rejects.toMatchObject({ status: 404, message: "Demande d'approbation introuvable." });
    expect(harness.trace()).toEqual([...ACCESS_READS, "GET estimate_approvals"]);
  });

  it("refuses a rule without a pending approval", async () => {
    const harness = setup({
      role: "director",
      tables: decisionTables(approvalRow({ status: "rejected" })),
    });

    await expect(
      submitEstimateApproval({ versionId: VERSION_ID, action: "approve", ruleId: RULE_ID })
    ).rejects.toMatchObject({ status: 404, message: "Aucune demande d'approbation en attente." });
    expect(harness.trace()).toEqual([...ACCESS_READS, "GET estimate_approvals"]);
  });

  it("refuses an approval that is no longer pending", async () => {
    const harness = setup({
      role: "director",
      tables: decisionTables(approvalRow({ status: "approved" })),
    });

    await expect(
      submitEstimateApproval({ versionId: VERSION_ID, action: "reject", approvalId: APPROVAL_ID })
    ).rejects.toMatchObject({ status: 400, message: "La demande d'approbation n'est plus en attente." });
    expect(harness.trace()).toEqual([...ACCESS_READS, "GET estimate_approvals"]);
  });

  it("approves by approval id atomically, then projects the summary", async () => {
    const harness = setup({ role: "director", tables: decisionTables() });

    const result = await submitEstimateApproval({
      versionId: VERSION_ID,
      action: "approve",
      approvalId: ` ${APPROVAL_ID} `,
      ruleId: MARGIN_RULE_ID,
    });

    expect(harness.rpcBodies("decide_estimate_approval")).toEqual([
      { p_approval_id: APPROVAL_ID, p_status: "approved" },
    ]);
    expect(harness.writes()[0]).toBe("POST rpc/decide_estimate_approval");
    expect(harness.writes()).toEqual(["POST rpc/decide_estimate_approval", ...SUMMARY_PROJECTION]);
    expect(harness.projectionBodies()).toEqual(
      pendingThresholdProjection({
        trigger: "approval_decision",
        previousStatus: "not_required",
        approvalId: APPROVAL_ID,
        approvalCreatedAt: "2026-03-01T10:05:00.000Z",
      })
    );
    expect(result).toEqual({ approval: decided });
  });

  it("rejects the latest pending approval of a rule", async () => {
    const harness = setup({
      role: "admin",
      tables: decisionTables(),
    });
    harness.tables.estimate_approvals = [
      approvalRow({ id: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0", createdAt: "2026-03-01T09:00:00.000Z" }),
      approvalRow(),
    ];

    await submitEstimateApproval({ versionId: VERSION_ID, action: "reject", ruleId: RULE_ID });

    expect(harness.rpcBodies("decide_estimate_approval")).toEqual([
      { p_approval_id: APPROVAL_ID, p_status: "rejected" },
    ]);
    expect(harness.writes()).toEqual(["POST rpc/decide_estimate_approval", ...SUMMARY_PROJECTION]);
    expect(harness.projectionBodies()).toEqual(
      pendingThresholdProjection({
        trigger: "approval_decision",
        previousStatus: "not_required",
        approvalId: APPROVAL_ID,
        approvalCreatedAt: "2026-03-01T10:05:00.000Z",
      })
    );
  });

  it("reports a stale review snapshot as a conflict, without projecting the summary", async () => {
    const harness = setup({
      role: "director",
      tables: decisionTables(),
      rpcErrors: { decide_estimate_approval: { message: "ESTIMATE_REVIEW_SNAPSHOT_STALE" } },
    });

    await expect(
      submitEstimateApproval({ versionId: VERSION_ID, action: "approve", approvalId: APPROVAL_ID })
    ).rejects.toMatchObject({
      status: 409,
      code: "ESTIMATE_REVIEW_SNAPSHOT_STALE",
      message: "Le devis a été modifié depuis sa soumission. Une nouvelle revue est requise.",
    });
    expect(harness.trace()).toEqual([
      ...ACCESS_READS,
      "GET estimate_approvals",
      "POST rpc/decide_estimate_approval",
    ]);
  });
});

describe("submitEstimateApproval after a draft snapshot freeze", () => {
  // The freeze rewrites the stored version: frozen totals and revision, and the stored approval
  // status. Before it, the version sits below the amount threshold.
  function freezeRewritesVersion(harness: Harness) {
    harness.tables.estimate_versions = [versionRow({ totalHtCents: 50000 })];
    vi.mocked(freezeApprovalV2DraftIfRequired).mockImplementationOnce(async () => {
      harness.tables.estimate_versions = [
        {
          ...versionRow({ totalHtCents: 250000 }),
          content_revision: 2,
          calc_snapshot_content_revision: 2,
          approval_status: "required",
        },
      ];
      return true;
    });
  }

  it("evaluates and projects a review submission from the frozen version", async () => {
    const harness = setup({ role: "admin", tables: { estimate_rules: [ruleRow()] } });
    freezeRewritesVersion(harness);

    await submitEstimateApproval({
      versionId: VERSION_ID,
      action: "submit_for_review",
      ruleIds: [],
      assignedReviewerUserId: REVIEWER_ID,
    });

    expect(vi.mocked(freezeApprovalV2DraftIfRequired).mock.calls[0]![1]).toMatchObject({
      total_ht_cents: 50000,
      content_revision: 1,
    });
    // The rule evaluation read the frozen total: below the threshold, no rule could be requested.
    expect(vi.mocked(openEstimateReviewCycle).mock.calls[0]![0].ruleIds).toEqual([RULE_ID]);
    expect(harness.projectionBodies()).toEqual(
      pendingThresholdProjection({
        trigger: "approval_request",
        previousStatus: "required",
        approvalId: "88888881-8888-4888-8888-888888888888",
        approvalCreatedAt: NOW,
      })
    );
  });

  it("projects a single-rule request from the frozen version", async () => {
    const harness = setup({ role: "admin", tables: { estimate_rules: [ruleRow()] } });
    freezeRewritesVersion(harness);

    await submitEstimateApproval({ versionId: VERSION_ID, action: "request", ruleId: RULE_ID });

    expect(vi.mocked(freezeApprovalV2DraftIfRequired).mock.calls[0]![1]).toMatchObject({
      total_ht_cents: 50000,
      content_revision: 1,
    });
    expect(harness.projectionBodies()).toEqual(
      pendingThresholdProjection({
        trigger: "approval_request",
        previousStatus: "required",
        approvalId: "88888881-8888-4888-8888-888888888888",
        approvalCreatedAt: NOW,
      })
    );
  });
});
