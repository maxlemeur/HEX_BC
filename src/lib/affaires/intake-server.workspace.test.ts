import { beforeEach, describe, expect, it, vi } from "vitest";

// The HTTP pagination contract is exercised with the real SDK in read-all.test.ts.
// These retained domain tests supply complete query results at the reader boundary.
vi.mock("@/lib/supabase/read-all", () => import("@/test/complete-reads-fixture"));


vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(),
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => ({})) }));
vi.mock("@/lib/affaires/plan-presence", () => ({ hasStoredIntakePlan: vi.fn().mockResolvedValue(true), hasStoredStandalonePlan: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/affaires/intake-plan-sync", () => ({ syncTakeoffPlanSetFromAffaireIntake: vi.fn() }));
vi.mock("@/lib/affaires/register-server", () => ({
  syncAffairePlanGap: vi.fn(), syncAffaireRegisterFromBrief: vi.fn(), syncAffaireRegisterMissingPieces: vi.fn(),
}));

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { fetchAffaireIntakeWorkspace, reconcileAffairePlanPresence, refreshAffaireIntakeFromActiveDocuments } from "@/lib/affaires/intake-server";
import { syncTakeoffPlanSetFromAffaireIntake } from "@/lib/affaires/intake-plan-sync";
import { readLinkedDriveDocument } from "@/lib/affaires/google-drive/content";
import { syncAffairePlanGap } from "@/lib/affaires/register-server";
import { hasStoredStandalonePlan } from "@/lib/affaires/plan-presence";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FIRST_UPLOAD_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LATEST_UPLOAD_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function createProjectRow() {
  return {
    id: PROJECT_ID,
    tenant_id: TENANT_ID,
    user_id: USER_ID,
    name: "Residence Horizon",
    reference: "AFF-001",
    client_name: "Client Demo",
    is_archived: false,
  };
}

function createUploadRow() {
  return {
    id: LATEST_UPLOAD_ID,
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    created_by: USER_ID,
    status: "ready" as const,
    attempt_count: 1,
    next_retry_at: null,
    last_error: null,
    completed_at: "2026-03-12T09:00:00.000Z",
    created_at: "2026-03-12T09:00:00.000Z",
    updated_at: "2026-03-12T09:00:00.000Z",
  };
}

function createDocumentRow(input: {
  id: string;
  uploadId: string;
  fileName: string;
  documentKind: "dpgf" | "plans";
  documentPriority: "primary" | "secondary";
}) {
  return {
    id: input.id,
    tenant_id: TENANT_ID,
    project_id: PROJECT_ID,
    upload_id: input.uploadId,
    created_by: USER_ID,
    storage_path: `affaire-intake/${input.id}`,
    file_name: input.fileName,
    mime_type: "application/pdf",
    size_bytes: 1024,
    upload_status: "uploaded" as const,
    rejection_reason: null,
    classification_status: "classified" as const,
    document_kind: input.documentKind,
    document_priority: input.documentPriority,
    confidence: 0.92,
    issues: [],
    extracted_metadata: {
      projectName: null,
      clientName: null,
      deadlineAt: null,
      detectedLots: [],
      detectedVariants: [],
    },
    classification_source: "ai" as const,
    classified_by: USER_ID,
    classified_at: "2026-03-12T09:00:00.000Z",
    manually_overridden_at: null,
    created_at:
      input.uploadId === FIRST_UPLOAD_ID
        ? "2026-03-11T09:00:00.000Z"
        : "2026-03-12T09:00:00.000Z",
    updated_at:
      input.uploadId === FIRST_UPLOAD_ID
        ? "2026-03-11T09:00:00.000Z"
        : "2026-03-12T09:00:00.000Z",
  };
}

function createSupabaseMock(documents: unknown[]) {
  return {
    from: vi.fn((table: string) => {
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

      if (table === "affaire_intake_uploads") {
        const builder = {
          select: vi.fn(),
          eq: vi.fn(),
          order: vi.fn(),
          limit: vi.fn(),
          maybeSingle: vi.fn(async () => ({
            data: createUploadRow(),
            error: null,
          })),
        };

        builder.select.mockReturnValue(builder);
        builder.eq.mockReturnValue(builder);
        builder.order.mockReturnValue(builder);
        builder.limit.mockReturnValue(builder);

        return builder;
      }

      if (table === "affaire_intake_documents") {
        const builder = {
          select: vi.fn(),
          eq: vi.fn((column: string, value: string) => {
            expect(["project_id", "tenant_id"]).toContain(column);
            expect(value).toBe(column === "project_id" ? PROJECT_ID : TENANT_ID);
            return builder;
          }),
          is: vi.fn((column, value) => { expect(["deleted_at", "deletion_token"]).toContain(column); expect(value).toBeNull(); return builder; }),
          order: vi.fn(() => builder),
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve(resolve({ data: documents, error: null })),
        };

        builder.select.mockReturnValue(builder);

        return builder;
      }

      if (table === "affaire_intake_events") {
        const builder = { select: vi.fn(() => builder), eq: vi.fn(() => builder), in: vi.fn(() => builder), contains: vi.fn(() => builder), order: vi.fn(() => builder), then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve({ data: [], error: null })) };
        return builder;
      }

      if (table === "affaire_briefs") {
        return {
          select: vi.fn(() => {
            const builder = {
              eq: vi.fn(),
              order: vi.fn(() => ({
                maybeSingle: async () => ({
                  data: null,
                  error: null,
                }),
              })),
            };

            builder.eq.mockReturnValue(builder);

            return builder;
          }),
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

describe("fetchAffaireIntakeWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(hasStoredStandalonePlan).mockResolvedValue(false);
  });

  it("gives an authorized director the same plan-presence result as the owner", async () => {
    const serviceClient = {};
    vi.mocked(createServiceRoleClient).mockReturnValue(serviceClient as never);
    vi.mocked(hasStoredStandalonePlan).mockResolvedValue(true);
    const reader = createSupabaseMock([createDocumentRow({ id: "dpgf", uploadId: FIRST_UPLOAD_ID,
      fileName: "dpgf.xlsx", documentKind: "dpgf", documentPriority: "primary" })]);
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      userId: "99999999-9999-4999-8999-999999999999", tenantId: TENANT_ID, tenantRole: "director", supabase: reader,
    } as never);
    const workspace = await fetchAffaireIntakeWorkspace(PROJECT_ID);
    expect(workspace.missingPieces.map((piece) => piece.code)).not.toContain("missing_plans");
    expect(hasStoredStandalonePlan).toHaveBeenCalledWith(expect.objectContaining({ supabase: serviceClient, projectId: PROJECT_ID, tenantId: TENANT_ID }));
  });

  it("keeps an interrupted deletion visible for retry but excludes it from readiness", async () => {
    const reserved = { ...createDocumentRow({ id: "reserved", uploadId: FIRST_UPLOAD_ID,
      fileName: "plan.pdf", documentKind: "plans", documentPriority: "secondary" }), deletion_token: "reservation" };
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      userId: USER_ID, tenantId: TENANT_ID, tenantRole: "admin", supabase: createSupabaseMock([reserved]),
    } as unknown as Awaited<ReturnType<typeof getAuthenticatedContext>>);
    const workspace = await fetchAffaireIntakeWorkspace(PROJECT_ID);
    expect(workspace.documents).toEqual([expect.objectContaining({ documentId: "reserved", isBeingDeleted: true })]);
    expect(workspace.missingPieces.map((piece) => piece.code)).toContain("missing_plans");
  });
});

describe("reconcileAffairePlanPresence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      userId: USER_ID, tenantId: TENANT_ID, tenantRole: "admin", supabase: createSupabaseMock([]),
    } as unknown as Awaited<ReturnType<typeof getAuthenticatedContext>>);
  });

  it("reads plans linked from Google Drive to keep their métré working copy", async () => {
    vi.mocked(syncTakeoffPlanSetFromAffaireIntake).mockResolvedValue({ syncedDocumentCount: 0, removedDocumentCount: 0 });
    vi.mocked(syncAffairePlanGap).mockResolvedValue(false);
    await reconcileAffairePlanPresence(PROJECT_ID);
    expect(syncTakeoffPlanSetFromAffaireIntake).toHaveBeenCalledWith(expect.objectContaining({ readDriveDocument: readLinkedDriveDocument }));
  });

  it("still refreshes the gap before reporting a failed copy repair", async () => {
    vi.mocked(syncTakeoffPlanSetFromAffaireIntake).mockRejectedValue(new Error("copy failed"));
    vi.mocked(syncAffairePlanGap).mockResolvedValue(false);
    await expect(reconcileAffairePlanPresence(PROJECT_ID)).rejects.toThrow("copy failed");
    expect(syncAffairePlanGap).toHaveBeenCalledWith({ projectId: PROJECT_ID, actorUserId: USER_ID });
  });
});

describe("refreshAffaireIntakeFromActiveDocuments", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads plans linked from Google Drive, except for a deletion that must not wait on Drive", async () => {
    const input = { supabase: createSupabaseMock([]) as never, project: createProjectRow(), uploadId: FIRST_UPLOAD_ID, actorUserId: USER_ID };
    await refreshAffaireIntakeFromActiveDocuments(input);
    expect(syncTakeoffPlanSetFromAffaireIntake).toHaveBeenLastCalledWith(expect.objectContaining({ readDriveDocument: readLinkedDriveDocument }));
    await refreshAffaireIntakeFromActiveDocuments({ ...input, readDrive: false });
    expect(syncTakeoffPlanSetFromAffaireIntake).toHaveBeenLastCalledWith(expect.objectContaining({ readDriveDocument: undefined }));
  });
});
