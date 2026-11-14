import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: vi.fn() }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => ({})) }));
// The bytes behind a plan are checked by plan-presence, tested on its own: here affaire 2 of each portfolio has its
// intake plan and affaire 4 a standalone plan file, which the portfolio read must hand over for it to count.
vi.mock("@/lib/affaires/plan-presence", () => ({
  hasStoredIntakePlan: vi.fn(async ({ projectId }: { projectId: string }) => projectId.endsWith("2")),
  hasStoredStandalonePlan: vi.fn(async ({ projectId, rows }: { projectId: string; rows?: unknown[] }) =>
    rows ? rows.length > 0 : projectId.endsWith("4")),
  readStandalonePlanRowsByProject: vi.fn(async ({ projectIds }: { projectIds: string[] }) => new Map(projectIds
    .filter((projectId) => projectId.endsWith("4")).map((projectId) => [projectId, [{ id: `plan-${projectId}` }]]))),
}));
vi.mock("@/lib/affaires/intake-decisions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/affaires/intake-decisions")>()),
  getIntakeAnalysisAvailability: vi.fn(async () => undefined),
}));

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { fetchAffaireIntakeManagerSignals, fetchAffaireIntakeWorkspace } from "@/lib/affaires/intake-server";
import { hasStoredIntakePlan, hasStoredStandalonePlan, readStandalonePlanRowsByProject } from "@/lib/affaires/plan-presence";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { createInMemoryRestApi } from "@/test/in-memory-rest-api";

const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "99999999-9999-4999-8999-999999999999";

function project(index: number, copy = 0) {
  return `aaaaaaaa-aaaa-4aaa-8${String(copy).padStart(3, "0")}-${String(index).padStart(12, "0")}`;
}

const projectRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, tenant_id: TENANT_ID, user_id: USER_ID, name: `Affaire ${id.slice(-2)}`, reference: null,
  client_name: null, is_archived: false, ...overrides,
});
const uploadRow = (projectId: string, suffix: string, createdAt: string, overrides: Record<string, unknown> = {}) => ({
  id: `upload-${projectId}-${suffix}`, tenant_id: TENANT_ID, project_id: projectId, created_by: USER_ID, status: "ready",
  attempt_count: 1, next_retry_at: null, last_error: null, completed_at: createdAt, created_at: createdAt,
  updated_at: createdAt, ...overrides,
});
const documentRow = (projectId: string, suffix: string, overrides: Record<string, unknown> = {}) => ({
  id: `document-${projectId}-${suffix}`, tenant_id: TENANT_ID, project_id: projectId, upload_id: `upload-${projectId}-a`,
  created_by: USER_ID, storage_path: `${projectId}/${suffix}.pdf`, deletion_token: null, plan_copy_generation: null,
  file_name: `${suffix}.pdf`, mime_type: "application/pdf", size_bytes: 1024, upload_status: "uploaded",
  rejection_reason: null, classification_status: "classified", document_kind: "dpgf", document_priority: "primary",
  confidence: 0.92, issues: [], extracted_metadata: {}, classification_source: "ai", classified_by: USER_ID,
  classified_at: "2026-03-12T09:00:00.000Z", manually_overridden_at: null, source_provider: null,
  drive_connection_id: null, drive_file_id: null, drive_folder_id: null, drive_folder_name: null, drive_revision: null,
  deleted_at: null, created_at: `2026-03-12T09:00:0${suffix.length % 10}.000Z`, updated_at: "2026-03-12T09:00:00.000Z",
  ...overrides,
});
const briefRow = (projectId: string, status: "a_confirmer" | "confirme") => ({
  id: `brief-${projectId}`, tenant_id: TENANT_ID, project_id: projectId, upload_id: null, created_by: USER_ID,
  updated_by: USER_ID, confirmed_by: null, status, summary: "Résumé", project_object: "Objet", scope: [], lots: [],
  received_pieces: [], assumptions: [], vigilance_points: [], missing_elements: [], generation_metadata: {},
  last_generated_at: null, confirmed_at: null, created_at: "2026-03-12T09:00:00.000Z",
  updated_at: "2026-03-12T09:00:00.000Z",
});

/** One portfolio covering every branch of the per-affaire reader; `copy` repeats it under other project ids. */
function portfolio(copy = 0) {
  const p = (index: number) => project(index, copy);
  return {
    estimate_projects: [
      projectRow(p(1)), projectRow(p(2)), projectRow(p(3)), projectRow(p(4)), projectRow(p(5)),
      projectRow(p(6), { is_archived: true }), projectRow(p(7), { user_id: OTHER_USER_ID }), projectRow(p(9)),
    ],
    affaire_intake_uploads: [
      uploadRow(p(2), "a", "2026-03-12T09:00:00.000Z"),
      uploadRow(p(3), "a", "2026-03-12T09:00:00.000Z"),
      uploadRow(p(4), "a", "2026-03-12T09:00:00.000Z"),
      uploadRow(p(5), "a", "2026-03-10T09:00:00.000Z"),
      uploadRow(p(5), "b", "2026-03-12T09:00:00.000Z"),
      uploadRow(p(7), "a", "2026-03-12T09:00:00.000Z"),
      // Only the latest upload opens a dossier: an unreadable one leaves it closed, whatever came before.
      uploadRow(p(9), "a", "2026-03-10T09:00:00.000Z"),
      uploadRow(p(9), "b", "2026-03-12T09:00:00.000Z", { status: "unknown_status" }),
    ],
    affaire_intake_documents: [
      documentRow(p(2), "dpgf"),
      documentRow(p(2), "plans", { document_kind: "plans", document_priority: "secondary" }),
      documentRow(p(3), "doubt", { classification_status: "ambiguous", document_kind: "a_classer", confidence: 0.3 }),
      documentRow(p(4), "dpgf"),
      // A reserved deletion stays out of readiness; a deleted row is not read at all.
      documentRow(p(5), "reserved", { document_kind: "plans", deletion_token: "reservation" }),
      documentRow(p(5), "deleted", { deleted_at: "2026-03-12T10:00:00.000Z" }),
      documentRow(p(5), "cctp", { document_kind: "cctp" }),
      documentRow(p(9), "doubt", { classification_status: "ambiguous", document_kind: "a_classer", confidence: 0.3 }),
    ],
    affaire_briefs: [briefRow(p(2), "confirme"), briefRow(p(3), "a_confirmer")],
    affaire_brief_source_links: [],
  };
}

function merge(...parts: ReturnType<typeof portfolio>[]) {
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const part of parts) {
    for (const [table, rows] of Object.entries(part)) tables[table] = [...(tables[table] ?? []), ...rows];
  }
  return tables;
}

function backend(tables: Record<string, Record<string, unknown>[]>, role: "engineer" | "admin" | "director" = "engineer") {
  const fake = createInMemoryRestApi(tables);
  const context = { userId: USER_ID, tenantId: TENANT_ID, tenantRole: role, supabase: fake.client };
  vi.mocked(getAuthenticatedContext).mockResolvedValue(context as never);
  return { ...fake, context: context as never };
}

/** What the manager queue used to read for one affaire, through the hub's own reader. */
async function perAffaireSignal(projectId: string) {
  try {
    const workspace = await fetchAffaireIntakeWorkspace(projectId);
    return {
      briefStatus: workspace.briefDraft?.status ?? null,
      readiness: {
        reviewDocumentsCount: workspace.readiness?.reviewDocumentsCount,
        confirmedMissingPiecesCount: workspace.readiness?.confirmedMissingPiecesCount,
        confirmedCriticalMissingPiecesCount: workspace.readiness?.confirmedCriticalMissingPiecesCount,
      },
    };
  } catch {
    return null;
  }
}

describe("fetchAffaireIntakeManagerSignals", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["engineer", "admin", "director"] as const)("gives each affaire the signals its own hub reads, as %s", async (role) => {
    const { context } = backend(merge(portfolio()), role);
    const projectIds = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => project(index));

    const signals = await fetchAffaireIntakeManagerSignals({ context, projectIds });

    for (const projectId of projectIds) {
      expect(signals.get(projectId) ?? null, projectId).toEqual(await perAffaireSignal(projectId));
    }
    // The fixture must exercise the branches, not seven empty dossiers.
    expect(signals.get(project(1))).toEqual({ briefStatus: null, readiness: {
      reviewDocumentsCount: 0, confirmedMissingPiecesCount: 0, confirmedCriticalMissingPiecesCount: 0 } });
    expect(signals.get(project(2))?.briefStatus).toBe("confirme");
    expect(signals.get(project(3))?.readiness.reviewDocumentsCount).toBe(1);
    expect(signals.get(project(4))?.readiness.confirmedMissingPiecesCount)
      .toBeLessThan(signals.get(project(5))!.readiness.confirmedMissingPiecesCount);
    expect(signals.has(project(6))).toBe(false);
    expect(signals.has(project(7))).toBe(role !== "engineer");
    expect(signals.has(project(8))).toBe(false);
    expect(signals.get(project(9))?.readiness.reviewDocumentsCount).toBe(0);
  });

  it("reads with the server client only the plan files of dossiers the caller may read", async () => {
    const serviceClient = {};
    vi.mocked(createServiceRoleClient).mockReturnValue(serviceClient as never);
    const { context } = backend(merge(portfolio()));

    await fetchAffaireIntakeManagerSignals({ context, projectIds: [1, 2, 3, 4, 5, 6, 7, 8, 9].map((index) => project(index)) });

    // Affaire 7 belongs to someone else, 6 is archived, 8 unknown; 1 and 9 have no open dossier.
    expect(vi.mocked(readStandalonePlanRowsByProject).mock.calls).toEqual([[{
      supabase: serviceClient, tenantId: TENANT_ID, projectIds: [2, 3, 4, 5].map((index) => project(index)),
    }]]);
    expect(hasStoredStandalonePlan).toHaveBeenCalledWith(expect.objectContaining({
      projectId: project(4), rows: [{ id: `plan-${project(4)}` }],
    }));
    expect(hasStoredStandalonePlan).toHaveBeenCalledWith(expect.objectContaining({ projectId: project(3), rows: [] }));
  });

  it("stops checking stored plans once the deadline has passed and leaves those affaires unqualified", async () => {
    const { context } = backend(merge(portfolio()));

    const signals = await fetchAffaireIntakeManagerSignals({
      context, projectIds: [1, 2, 3, 4, 5, 9].map((index) => project(index)), deadlineAt: Date.now() - 1,
    });

    // Affaires without an open dossier cost no further request and stay qualified.
    expect([...signals.keys()].sort()).toEqual([project(1), project(9)]);
    expect(hasStoredIntakePlan).not.toHaveBeenCalled();
    expect(hasStoredStandalonePlan).not.toHaveBeenCalled();
  });

  it("reads a portfolio ten times larger with the same number of requests", async () => {
    const small = backend(merge(portfolio()));
    await fetchAffaireIntakeManagerSignals({
      context: small.context, projectIds: [1, 2, 3, 4, 5, 6, 7, 9].map((index) => project(index)),
    });

    const copies = Array.from({ length: 10 }, (_, copy) => copy);
    const large = backend(merge(...copies.map((copy) => portfolio(copy))));
    const projectIds = copies.flatMap((copy) => [1, 2, 3, 4, 5, 6, 7, 9].map((index) => project(index, copy)));
    const signals = await fetchAffaireIntakeManagerSignals({ context: large.context, projectIds });

    expect(signals.size).toBe(60);
    expect(large.requests.map((request) => request.table).sort()).toEqual(
      small.requests.map((request) => request.table).sort()
    );
    expect(large.requests.length).toBeLessThanOrEqual(5);
  });
});
