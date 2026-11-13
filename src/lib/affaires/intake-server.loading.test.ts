import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => ({})) }));
vi.mock("@/lib/affaires/plan-presence", () => ({
  hasStoredIntakePlan: vi.fn(), hasStoredStandalonePlan: vi.fn(),
}));
vi.mock("@/lib/affaires/intake-decisions", () => ({
  classifyAutonomousAffaireDocument: vi.fn(), getIntakeDecisionsCapability: vi.fn(),
  getIntakeAnalysisAvailability: vi.fn(), isIntakeDecisionsSelected: vi.fn(),
}));

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { getIntakeAnalysisAvailability } from "@/lib/affaires/intake-decisions";
import { fetchAffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import { hasStoredStandalonePlan } from "@/lib/affaires/plan-presence";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UPLOAD_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DOCUMENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const availability = { available: false, provider: "chatgpt" as const, message: "ARMY disconnected" };

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

// The actual PostgREST SDK and complete-read helper run against controllable HTTP
// responses. Gates model independent slow I/O; no query builder or business result
// is reimplemented by the test, and no wall-clock performance threshold is used.
function fixture(options: {
  uploadGate?: Promise<void>;
  documentsGate?: Promise<void>;
  briefGate?: Promise<void>;
  noUpload?: boolean;
  denied?: boolean;
  documentError?: boolean;
  briefError?: boolean;
} = {}) {
  const requests: string[] = [];
  const client = createClient("http://127.0.0.1:54321", "army-fictional-anon", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
      const table = url.pathname.split("/").at(-1)!;
      requests.push(table);
      const method = init?.method ?? (input instanceof Request ? input.method : "GET");
      expect(method).toBe("GET");
      let data: unknown;
      let status = 200;
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (table === "estimate_projects") {
        data = { id: PROJECT_ID, tenant_id: TENANT_ID,
          user_id: options.denied ? "99999999-9999-4999-8999-999999999999" : USER_ID,
          name: "ARMY loading", reference: "ARMY-LOAD", client_name: "ARMY fictional", is_archived: false };
      } else if (table === "affaire_intake_uploads") {
        await options.uploadGate;
        data = options.noUpload ? null : { id: UPLOAD_ID, tenant_id: TENANT_ID, project_id: PROJECT_ID,
          created_by: USER_ID, status: "ready", attempt_count: 1 };
      } else if (table === "affaire_intake_documents") {
        await options.documentsGate;
        if (options.documentError) {
          status = 500;
          data = { code: "XX001", message: "ARMY documents unavailable", details: "", hint: "" };
        } else {
          data = [{ id: DOCUMENT_ID, tenant_id: TENANT_ID, project_id: PROJECT_ID, upload_id: UPLOAD_ID,
            file_name: "ARMY-dpgf.xlsx", mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            size_bytes: 1024, upload_status: "uploaded", classification_status: "classified",
            document_kind: "dpgf", document_priority: "primary", confidence: 0.92, issues: [],
            classification_source: "ai", extracted_metadata: {}, storage_path: "army/loading.xlsx" }];
          headers["content-range"] = "0-0/1";
        }
      } else if (table === "affaire_briefs") {
        await options.briefGate;
        status = options.briefError ? 500 : 200;
        data = options.briefError
          ? { code: "XX001", message: "ARMY brief unavailable", details: "", hint: "" }
          : null;
      } else {
        throw new Error(`Unexpected HTTP resource: ${table}`);
      }
      return new Response(JSON.stringify(data), { status, headers });
    } },
  });
  vi.mocked(getAuthenticatedContext).mockResolvedValue({
    supabase: client, userId: USER_ID, tenantId: TENANT_ID, tenantRole: "engineer", isTenantAdmin: false,
  } as unknown as Awaited<ReturnType<typeof getAuthenticatedContext>>);
  return { requests };
}

describe("affaire workspace independent reads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getIntakeAnalysisAvailability).mockResolvedValue(availability);
    vi.mocked(hasStoredStandalonePlan).mockResolvedValue(true);
  });

  it("reads the brief while the upload waits, then starts independent dossier reads without waiting for the brief", async () => {
    const upload = gate();
    const documents = gate();
    const brief = gate();
    const f = fixture({ uploadGate: upload.promise, documentsGate: documents.promise, briefGate: brief.promise });
    const pending = fetchAffaireIntakeWorkspace(PROJECT_ID);
    let completed = false;
    const cleanup = pending.then(() => { completed = true; }, () => { completed = true; });
    try {
      await expect.poll(() => f.requests.includes("affaire_intake_uploads")).toBe(true);
      await expect.poll(() => f.requests.includes("affaire_briefs"), { timeout: 500 }).toBe(true);
      expect(f.requests).not.toContain("affaire_intake_documents");
      expect(getIntakeAnalysisAvailability).not.toHaveBeenCalled();
      upload.release();
      await expect.poll(() => f.requests.includes("affaire_intake_documents")).toBe(true);
      await expect.poll(() => ({
        briefStarted: f.requests.includes("affaire_briefs"),
        availabilityStarted: vi.mocked(getIntakeAnalysisAvailability).mock.calls.length > 0,
      }), { timeout: 500 }).toEqual({ briefStarted: true, availabilityStarted: true });
      expect(hasStoredStandalonePlan).not.toHaveBeenCalled();
      expect(completed).toBe(false);

      documents.release();
      await expect.poll(() => vi.mocked(hasStoredStandalonePlan).mock.calls.length, { timeout: 500 }).toBe(1);
      expect(completed).toBe(false);
      brief.release();
      const workspace = await pending;
      expect(workspace.documents).toEqual([expect.objectContaining({ documentId: DOCUMENT_ID, fileName: "ARMY-dpgf.xlsx" })]);
      expect(workspace.missingPieces.map((piece) => piece.code)).not.toContain("missing_plans");
      expect(workspace.analysisAvailability).toEqual(availability);
      expect(workspace.briefDraft).toBeNull();
    } finally {
      upload.release();
      documents.release();
      brief.release();
      await cleanup;
    }
  });

  it("keeps the no-upload branch limited to its brief", async () => {
    const upload = gate();
    const f = fixture({ noUpload: true, uploadGate: upload.promise });
    const pending = fetchAffaireIntakeWorkspace(PROJECT_ID);
    const cleanup = pending.catch(() => undefined);
    try {
      await expect.poll(() => f.requests.includes("affaire_briefs"), { timeout: 500 }).toBe(true);
    } finally {
      upload.release();
      await cleanup;
    }
    const workspace = await pending;
    expect(workspace).toMatchObject({ projectId: PROJECT_ID, uploadId: null, documents: [], missingPieces: [], briefDraft: null });
    expect(f.requests.toSorted()).toEqual(["estimate_projects", "affaire_intake_uploads", "affaire_briefs"].toSorted());
    expect(getIntakeAnalysisAvailability).not.toHaveBeenCalled();
    expect(hasStoredStandalonePlan).not.toHaveBeenCalled();
  });

  it("does not start dossier or availability reads when project access is refused", async () => {
    const f = fixture({ denied: true });
    await expect(fetchAffaireIntakeWorkspace(PROJECT_ID)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(f.requests).toEqual(["estimate_projects"]);
    expect(getIntakeAnalysisAvailability).not.toHaveBeenCalled();
    expect(hasStoredStandalonePlan).not.toHaveBeenCalled();
  });

  it("preserves the document-read error without treating unread documents as an empty dossier", async () => {
    fixture({ documentError: true });
    await expect(fetchAffaireIntakeWorkspace(PROJECT_ID)).rejects.toMatchObject({
      status: 500, code: "INTERNAL_ERROR", message: "Impossible de charger les documents intake.",
    });
    expect(hasStoredStandalonePlan).not.toHaveBeenCalled();
  });

  it("preserves a rejected brief instead of returning a partial workspace", async () => {
    fixture({ briefError: true });
    await expect(fetchAffaireIntakeWorkspace(PROJECT_ID)).rejects.toMatchObject({
      status: 500, code: "INTERNAL_ERROR", message: "Impossible de charger le brief affaire.",
    });
  });
});
