import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({
  getAuthenticatedContext: vi.fn(),
}));

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { fetchAffaireIntakeWorkspace } from "@/lib/affaires/intake-server";

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
            expect(column).toBe("project_id");
            expect(value).toBe(PROJECT_ID);
            return builder;
          }),
          order: vi.fn(() => builder),
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve(resolve({ data: documents, error: null })),
        };

        builder.select.mockReturnValue(builder);

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
  });

  it("returns project-scoped documents while keeping the latest upload marker", async () => {
    vi.mocked(getAuthenticatedContext).mockResolvedValue({
      userId: USER_ID,
      tenantId: TENANT_ID,
      tenantRole: "admin",
      supabase: createSupabaseMock([
        createDocumentRow({
          id: "doc-primary-dpgf",
          uploadId: FIRST_UPLOAD_ID,
          fileName: "dpgf-a.xlsx",
          documentKind: "dpgf",
          documentPriority: "primary",
        }),
        createDocumentRow({
          id: "doc-secondary-dpgf",
          uploadId: LATEST_UPLOAD_ID,
          fileName: "dpgf-b.xlsx",
          documentKind: "dpgf",
          documentPriority: "secondary",
        }),
      ]),
    } as unknown as Awaited<ReturnType<typeof getAuthenticatedContext>>);

    const workspace = await fetchAffaireIntakeWorkspace(PROJECT_ID);

    expect(workspace.uploadId).toBe(LATEST_UPLOAD_ID);
    expect(workspace.documents.map((document) => document.documentId)).toEqual([
      "doc-primary-dpgf",
      "doc-secondary-dpgf",
    ]);
    expect(workspace.documents.map((document) => document.documentPriority)).toEqual([
      "primary",
      "secondary",
    ]);
    expect(workspace.readiness).toMatchObject({
      reviewDocumentsCount: 0,
      missingPiecesCount: 3,
      criticalMissingPiecesCount: 1,
      dominantAction: "missing",
      hubReadinessImpact: "critical",
    });
  });
});
