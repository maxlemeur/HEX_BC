import { beforeEach, describe, expect, it, vi } from "vitest";

// The HTTP pagination contract is exercised with the real SDK in read-all.test.ts.
// These retained domain tests supply complete query results at the reader boundary.
vi.mock("@/lib/supabase/read-all", () => import("@/test/complete-reads-fixture"));


vi.mock("@/lib/ai/structured-ai", async (actual) => ({
  ...await actual<typeof import("@/lib/ai/structured-ai")>(), callStructuredAi: vi.fn(),
}));
vi.mock("@/lib/ai/access/openai-api", async (actual) => ({
  ...await actual<typeof import("@/lib/ai/access/openai-api")>(), openAiApiKeyAccess: vi.fn(),
}));
vi.mock("@/lib/ai/request-settings-server", async (actual) => ({
  ...await actual<typeof import("@/lib/ai/request-settings-server")>(),
  readAiRequestOptions: vi.fn(async () => ({ defaultSource: "personal_api_key", options: {} })),
  resolveAiRequest: vi.fn(),
}));
vi.mock("@/lib/affaires/intake-brief-store", async (actual) => ({
  ...await actual<typeof import("@/lib/affaires/intake-brief-store")>(), persistAffaireBriefDraft: vi.fn(),
}));

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(),
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => ({})) }));
vi.mock("@/lib/affaires/plan-presence", () => ({ hasStoredIntakePlan: vi.fn().mockResolvedValue(true), hasStoredStandalonePlan: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/affaires/intake-plan-sync", () => ({ syncTakeoffPlanSetFromAffaireIntake: vi.fn() }));
vi.mock("@/lib/affaires/register-sync-server", () => ({
  syncAffairePlanGap: vi.fn(), syncAffaireRegisterFromBrief: vi.fn(), syncAffaireRegisterMissingPieces: vi.fn(),
}));

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { fetchAffaireIntakeWorkspace } from "@/lib/affaires/intake-workspace-server";
import { reconcileAffairePlanPresence, refreshAffaireBriefFromDocuments, refreshAffaireIntakeFromActiveDocuments } from "@/lib/affaires/intake-derived-state-server";
import { syncTakeoffPlanSetFromAffaireIntake } from "@/lib/affaires/intake-plan-sync";
import { readLinkedDriveDocument } from "@/lib/affaires/google-drive/content";
import { syncAffairePlanGap } from "@/lib/affaires/register-sync-server";
import { hasStoredStandalonePlan } from "@/lib/affaires/plan-presence";
import { callStructuredAi } from "@/lib/ai/structured-ai";
import { readAiRequestOptions, resolveAiRequest } from "@/lib/ai/request-settings-server";
import { openAiApiKeyAccess } from "@/lib/ai/access/openai-api";
import { persistAffaireBriefDraft } from "@/lib/affaires/intake-brief-store";
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

function createSupabaseMock(documents: unknown[], onlyDeposits = false) {
  return {
    rpc: async (name: string) => {
      expect(name).toBe("intake_current_brief_active");
      return { data: false, error: null };
    },
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
          // The batches whose analysis has not ended: none here.
          in: vi.fn(), is: vi.fn(), not: vi.fn(), neq: vi.fn(),
          order: vi.fn(),
          limit: vi.fn(),
          maybeSingle: vi.fn(async () => ({
            data: createUploadRow(),
            error: null,
          })),
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve(resolve({ data: [], error: null })),
        };

        builder.select.mockReturnValue(builder);
        builder.eq.mockReturnValue(builder);
        builder.in.mockReturnValue(builder);
        builder.is.mockReturnValue(builder);
        builder.not.mockReturnValue(builder);
        builder.neq.mockReturnValue({ limit: () => Promise.resolve({ data: onlyDeposits ? [] : [createUploadRow()], error: null }) });
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

  it("opens a hand-classified first deposit without reading a linked plan in the background", async () => {
    vi.mocked(syncTakeoffPlanSetFromAffaireIntake).mockResolvedValue({ syncedDocumentCount: 1, removedDocumentCount: 0 });
    const plan = { ...createDocumentRow({ id: "plan", uploadId: FIRST_UPLOAD_ID, fileName: "Plan.pdf",
      documentKind: "plans", documentPriority: "primary" }), classification_source: "manual",
      storage_path: null, source_provider: "google_drive", drive_file_id: "fictional-plan" };
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      userId: USER_ID, tenantId: TENANT_ID, tenantRole: "admin", supabase: createSupabaseMock([plan], true),
    } as unknown as Awaited<ReturnType<typeof getAuthenticatedContext>>);
    await reconcileAffairePlanPresence(PROJECT_ID);
    expect(syncTakeoffPlanSetFromAffaireIntake).not.toHaveBeenCalled();
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
    vi.mocked(createServiceRoleClient).mockReturnValue({ rpc: async (name: string) => ({ error: null,
      data: name === "read_affaire_intake_brief_inputs" ? { project: createProjectRow(), documents: [],
        missing_piece_codes: ["missing_plans"], revision: "empty", brief_updated_at: null } : name !== "intake_current_brief_active" }) } as never);
    const input = { supabase: createSupabaseMock([]) as never, project: createProjectRow(), uploadId: FIRST_UPLOAD_ID, actorUserId: USER_ID };
    await refreshAffaireIntakeFromActiveDocuments(input);
    expect(syncTakeoffPlanSetFromAffaireIntake).toHaveBeenLastCalledWith(expect.objectContaining({ readDriveDocument: readLinkedDriveDocument }));
    await refreshAffaireIntakeFromActiveDocuments({ ...input, readDrive: false });
    expect(syncTakeoffPlanSetFromAffaireIntake).toHaveBeenLastCalledWith(expect.objectContaining({ readDriveDocument: undefined }));
  });
});

it.each(["édition", "suppression", "reprise historique", "reconnexion Drive"])(
  "recomputes the historical brief on the plan after %s without consulting the current payer preference",
  async (origin) => {
    const owner = { userId: USER_ID, tenantId: TENANT_ID };
    const project = createProjectRow();
    const document = createDocumentRow({ id: "aaaa0000-9999-4000-8000-000000000001", uploadId: FIRST_UPLOAD_ID,
      fileName: "Fictif.pdf", documentKind: "plans", documentPriority: "primary" });
    const draft = { summary: { text: "Brief fictif", sourceDocumentIds: [document.id] },
      projectObject: { text: "Dossier fictif", sourceDocumentIds: [document.id] },
      scope: [], lots: [], receivedPieces: [], assumptions: [], vigilancePoints: [], missingElements: [] };
    const service = { rpc: vi.fn(async (name: string) => {
      if (name === "read_affaire_intake_brief_inputs") {
        return { data: { project, documents: [document], missing_piece_codes: [], revision: "historical", brief_updated_at: null } };
      }
      if (name === "intake_current_brief_active") return { data: false };
      if (name === "intake_payer_can_write") return { data: true };
      throw new Error(`Unexpected query ${name}`);
    }) };
    vi.clearAllMocks();
    vi.mocked(createServiceRoleClient).mockReturnValue(service as never);
    vi.mocked(callStructuredAi).mockResolvedValue({ data: draft, model: "plan-fictif", reasoningEffort: "high" } as never);
    const supabase = createSupabaseMock([document]) as never;
    const input = { supabase, project, uploadId: FIRST_UPLOAD_ID };
    if (origin === "édition" || origin === "suppression") {
      await refreshAffaireIntakeFromActiveDocuments({ ...input, actorUserId: USER_ID, readDrive: origin !== "suppression" });
    } else {
      await refreshAffaireBriefFromDocuments({ ...input, documents: [], aiOwner: owner, renewLease: vi.fn(),
        claim: { uploadId: FIRST_UPLOAD_ID, tenantId: TENANT_ID, projectId: PROJECT_ID, leaseToken: "historical", attemptCount: 2 } });
    }
    expect(callStructuredAi).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ prompt: expect.any(String) }), owner);
    expect(openAiApiKeyAccess).not.toHaveBeenCalled();
    expect(readAiRequestOptions).not.toHaveBeenCalled();
    expect(resolveAiRequest).not.toHaveBeenCalled();
    expect(persistAffaireBriefDraft).toHaveBeenCalledWith(expect.objectContaining({
      aiReceipt: { source: "chatgpt_plan", model: "plan-fictif", reasoningEffort: "high" },
    }));
  },
);
