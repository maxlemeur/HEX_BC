import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import {
  buildEstimateApprovalDecisionJournalCsv,
  listEstimateApprovalDecisionJournal,
} from "@/lib/estimates/rules-engine";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const VERSION_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";

function createMembershipBuilder(role: "admin" | "director" | "engineer" = "admin") {
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
        role,
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
  builder.single.mockResolvedValue({
    data: {
      id: VERSION_ID,
      tenant_id: TENANT_ID,
      status: "draft",
      project_id: PROJECT_ID,
      total_ht_cents: 350000,
      margin_bp: 1200,
      margin_multiplier: 1,
      discount_bp: 0,
      approval_status: "in_review",
      approval_summary: {},
      approval_evaluated_at: "2026-03-06T09:30:00.000Z",
      estimate_projects: {
        id: PROJECT_ID,
        tenant_id: TENANT_ID,
        user_id: USER_ID,
        name: "Affaire test",
        client_name: "Client A",
      },
    },
    error: null,
  });

  return builder;
}

function createEventsBuilder() {
  const builder = {
    data: [
      {
        id: "event-1",
        estimate_version_id: VERSION_ID,
        event_type: "approval_decided",
        metadata: {
          decision: "approved_with_reservations",
          approvalOutcome: "approved",
          cycleId: "cycle-2",
          cycleNumber: 2,
          commentCount: 1,
          scopeCount: 1,
          perimeterLabel: "Lot CFO",
          comments: [
            {
              scopeType: "lot",
              scopeId: "lot-1",
              scopeLabel: "Lot CFO",
              comment: "Confirmer la variante avant envoi.",
            },
          ],
          scopes: [
            {
              scopeType: "lot",
              scopeId: "lot-1",
              scopeLabel: "Lot CFO",
            },
          ],
          rulesTriggered: [
            {
              ruleId: "rule-1",
              label: "Seuil montant HT",
              signalKey: "total_ht_cents",
              message: "Le montant HT depasse le seuil.",
              thresholdValue: 300000,
              actualValue: 350000,
              sourceState: "ready",
              approvalStatus: "pending",
            },
          ],
        },
        created_by: USER_ID,
        occurred_at: "2026-03-06T10:00:00.000Z",
        created_at: "2026-03-06T10:00:00.000Z",
        profiles: {
          full_name: "Nadia Directeur",
        },
      },
      {
        id: "event-2",
        estimate_version_id: VERSION_ID,
        event_type: "approval_decided",
        metadata: {
          decision: "rejected",
          approvalOutcome: "rejected",
          cycleId: "cycle-1",
          cycleNumber: 1,
          commentCount: 0,
          scopeCount: 1,
          perimeterLabel: "Seuil montant HT",
          scopes: [
            {
              scopeType: "approval_rule",
              scopeId: "rule-1",
              scopeLabel: "Seuil montant HT",
            },
          ],
          rulesTriggered: [
            {
              ruleId: "rule-1",
              label: "Seuil montant HT",
              signalKey: "total_ht_cents",
              message: "Le montant HT depasse le seuil.",
              thresholdValue: 300000,
              actualValue: 340000,
              sourceState: "ready",
              approvalStatus: "pending",
            },
          ],
        },
        created_by: "99999999-9999-4999-8999-999999999999",
        occurred_at: "2026-03-05T16:00:00.000Z",
        created_at: "2026-03-05T16:00:00.000Z",
        profiles: {
          full_name: "Laurent Direction",
        },
      },
    ],
    error: null,
    eq: vi.fn(),
    order: vi.fn(),
  };

  builder.eq.mockReturnValue(builder);
  builder.order.mockReturnValue(builder);

  return builder;
}

describe("approval decision journal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists decision events with filters while keeping all available authors", async () => {
    const membershipBuilder = createMembershipBuilder();
    const versionBuilder = createVersionAccessBuilder();
    const eventsBuilder = createEventsBuilder();

    vi.mocked(createSupabaseServerClient).mockResolvedValue({
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

        if (table === "estimate_version_events") {
          return {
            select: vi.fn(() => eventsBuilder),
          };
        }

        throw new Error(`Unexpected table: ${table}`);
      }),
    } as never);

    const result = await listEstimateApprovalDecisionJournal({
      versionId: VERSION_ID,
      actorUserId: USER_ID,
      decision: "approved_with_reservations",
    });

    expect(result.availableAuthors).toEqual([
      {
        userId: "99999999-9999-4999-8999-999999999999",
        actorName: "Laurent Direction",
      },
      {
        userId: USER_ID,
        actorName: "Nadia Directeur",
      },
    ]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      id: "event-1",
      decision: "approved_with_reservations",
      perimeterLabel: "Lot CFO",
      commentCount: 1,
    });
    expect(result.events[0]?.comments[0]).toMatchObject({
      scopeLabel: "Lot CFO",
      comment: "Confirmer la variante avant envoi.",
    });
  });

  it("builds a csv export with decision details", () => {
    const csv = buildEstimateApprovalDecisionJournalCsv({
      events: [
        {
          id: "event-1",
          estimateVersionId: VERSION_ID,
          occurredAt: "2026-03-06T10:00:00.000Z",
          createdAt: "2026-03-06T10:00:00.000Z",
          actorUserId: USER_ID,
          actorName: "Nadia Directeur",
          decision: "approved_with_reservations",
          approvalOutcome: "approved",
          cycleId: "cycle-2",
          cycleNumber: 2,
          commentCount: 1,
          scopeCount: 1,
          perimeterLabel: "Lot CFO",
          scopes: [
            {
              scopeType: "lot",
              scopeId: "lot-1",
              scopeLabel: "Lot CFO",
            },
          ],
          comments: [
            {
              scopeType: "lot",
              scopeId: "lot-1",
              scopeLabel: "Lot CFO",
              comment: "Confirmer la variante avant envoi.",
            },
          ],
          rulesTriggered: [
            {
              ruleId: "rule-1",
              label: "Seuil montant HT",
              signalKey: "total_ht_cents",
              message: "Le montant HT depasse le seuil.",
              thresholdValue: 300000,
              actualValue: 350000,
              sourceState: "ready",
              approvalStatus: "pending",
            },
          ],
        },
      ],
    });

    expect(csv).toContain("date_decision;decision;auteur");
    expect(csv).toContain("Approuvee sous reserve");
    expect(csv).toContain("Lot CFO: Confirmer la variante avant envoi.");
    expect(csv).toContain("Seuil montant HT");
  });
});
