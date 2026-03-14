import { describe, expect, it } from "vitest";

import { syncAffaireRegisterMissingPieces } from "@/lib/affaires/register-server";

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

function createInactiveExistingRow() {
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
    status: "validated" as const,
    origin_kind: "system" as const,
    scope_type: "project" as const,
    scope_id: null,
    scope_ref: null,
    scope_label: "Affaire test",
    source_file_name: "plans.pdf",
    sync_key: "missing_piece:missing_plans",
    is_active: false,
    metadata: {
      clientClarificationRequest: {
        status: "clarify_with_client",
        requestedAt: NOW,
        requestedByUserId: USER_ID,
        previousStatus: "open",
        comment: "Ancienne clarification",
      },
      continuationDecision: {
        status: "accepted_with_hypothesis",
        hypothesisEntryId: "55555555-5555-4555-8555-555555555555",
        hypothesisText: "Ancienne hypothese",
        acceptedAt: NOW,
        acceptedByUserId: USER_ID,
        comment: "Ancienne continuation",
      },
      continuationSource: {
        entryId: ENTRY_ID,
      },
      revalidationRequest: {
        status: "required",
        requestedAt: NOW,
        requestedByUserId: USER_ID,
        previousStatus: "validated",
        cause: "addendum_received",
        triggerDocumentId: null,
        triggerFileName: null,
        impactedStages: ["submission_readiness"],
        comment: "Ancienne revalidation",
      },
      custom: "kept",
    } satisfies Record<string, unknown>,
    created_by: USER_ID,
    updated_by: USER_ID,
    created_at: NOW,
    updated_at: NOW,
  };
}

describe("syncAffaireRegisterMissingPieces", () => {
  it("drops stale workflow metadata when reactivating an inactive sync key", async () => {
    const eventPayloads: unknown[] = [];
    const upsertPayloads: Array<Record<string, unknown>> = [];
    const existingRow = createInactiveExistingRow();
    let registerEntriesCall = 0;

    const supabase = {
      from: (table: string) => {
        if (table === "affaire_register_events") {
          return {
            insert: async (payload: unknown) => {
              eventPayloads.push(payload);
              return { error: null };
            },
          };
        }

        if (table === "affaire_register_entries") {
          const currentCall = registerEntriesCall++;
          const builder = {
            select: (_columns: string) => builder,
            eq: (_column: string, _value: unknown) => builder,
            in: (_column: string, _values: unknown[]) =>
              Promise.resolve({
                data: currentCall === 0 ? [existingRow] : [],
                error: null,
              }),
            upsert: (payload: Record<string, unknown>[]) => {
              upsertPayloads.push(...payload);
              return builder;
            },
            then: undefined as
              | ((onfulfilled?: (value: unknown) => unknown) => Promise<unknown>)
              | undefined,
          };

          builder.then = (onfulfilled) =>
            Promise.resolve({
              data:
                currentCall === 1
                  ? upsertPayloads.map((payload) => ({
                      ...existingRow,
                      ...payload,
                      metadata: payload.metadata,
                      status: payload.status,
                      is_active: true,
                      updated_by: payload.updated_by ?? null,
                    }))
                  : null,
              error: null,
            }).then(onfulfilled);

          return builder;
        }

        throw new Error(`Unexpected table ${table}`);
      },
    };

    await syncAffaireRegisterMissingPieces({
      supabase: supabase as never,
      project: createProjectRow(),
      missingPieces: [
        {
          code: "missing_plans",
          label: "Plans manquants",
          severity: "critical",
        },
      ],
      actorUserId: USER_ID,
    });

    expect(upsertPayloads).toHaveLength(1);
    expect(upsertPayloads[0]).toMatchObject({
      project_id: PROJECT_ID,
      sync_key: "missing_piece:missing_plans",
      status: "open",
      is_active: true,
      updated_by: USER_ID,
      metadata: {
        custom: "kept",
        businessImpact: [
          "affects_hub_readiness",
          "blocks_submission",
          "affects_takeoff",
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
      },
    });
    expect(upsertPayloads[0]?.metadata).not.toHaveProperty("clientClarificationRequest");
    expect(upsertPayloads[0]?.metadata).not.toHaveProperty("continuationDecision");
    expect(upsertPayloads[0]?.metadata).not.toHaveProperty("continuationSource");
    expect(upsertPayloads[0]?.metadata).not.toHaveProperty("revalidationRequest");

    expect(eventPayloads).toHaveLength(1);
    expect(eventPayloads[0]).toMatchObject({
      entry_id: ENTRY_ID,
      actor_user_id: USER_ID,
      event_type: "reactivated",
      reason: "intake.missing_pieces_sync",
      before_payload: {
        status: "validated",
        is_active: false,
      },
      after_payload: {
        status: "open",
        is_active: true,
      },
    });
  });
});
