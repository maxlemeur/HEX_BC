import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/read-all", () => import("@/test/complete-reads-fixture"));
vi.mock("@/lib/auth/tenant-context", () => ({ getAuthenticatedContext: vi.fn() }));
vi.mock("@/lib/ai/structured-ai", () => ({ callStructuredAi: vi.fn() }));
vi.mock("@/lib/affaires/intake-plan-sync", () => ({ syncTakeoffPlanSetFromAffaireIntake: vi.fn() }));
vi.mock("@/lib/affaires/plan-presence", () => ({
  hasStoredIntakePlan: vi.fn().mockResolvedValue(true), hasStoredStandalonePlan: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn(() => ({})) }));
vi.mock("@/lib/affaires/register-server", () => ({
  syncAffairePlanGap: vi.fn(), syncAffaireRegisterFromBrief: vi.fn(), syncAffaireRegisterMissingPieces: vi.fn(),
}));

import { getAuthenticatedContext } from "@/lib/auth/tenant-context";
import { callStructuredAi } from "@/lib/ai/structured-ai";
import { reclassifyAffaireDocument } from "@/lib/affaires/intake-server";
import { syncTakeoffPlanSetFromAffaireIntake } from "@/lib/affaires/intake-plan-sync";
import { AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE } from "@/lib/affaires/intake";

const tenantId = "22222222-2222-4222-8222-222222222222";
const userId = "11111111-1111-4111-8111-111111111111";
const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const uploadId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const documentId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const briefId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const classifiedAt = "2026-11-01T10:00:00.000Z";
type Row = Record<string, unknown>;

function harness(options: { conflict?: boolean; document?: Row; brief?: Row | null; role?: string; owner?: string } = {}) {
  const document: Row = {
    id: documentId, tenant_id: tenantId, project_id: projectId, upload_id: uploadId, created_by: userId,
    storage_path: `${tenantId}/${projectId}/plan.pdf`, file_name: "plan-fictif.pdf", mime_type: "application/pdf", size_bytes: 4000,
    upload_status: "uploaded", classification_status: "classified", document_kind: "plans", document_priority: "secondary",
    confidence: 0.99, issues: [], classification_source: "ai", classified_by: null, classified_at: classifiedAt,
    manually_overridden_at: null, created_at: classifiedAt, updated_at: classifiedAt,
    plan_copy_generation: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    extracted_metadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
    ...options.document,
  };
  const brief: Row = {
    id: briefId, project_id: projectId, tenant_id: tenantId, upload_id: uploadId, created_by: userId, updated_by: userId,
    status: "confirme", summary: "Synthèse confirmée par le client", project_object: "Périmètre conservé",
    scope: ["Périmètre validé"], lots: [], received_pieces: ["Plan fictif"], assumptions: [], vigilance_points: [],
    missing_elements: [], generation_metadata: { resolved_plan_gap_indexes: [0] },
    confirmed_at: classifiedAt, confirmed_by: userId, last_generated_at: classifiedAt, created_at: classifiedAt, updated_at: classifiedAt,
    ...(options.brief ?? {}),
  };
  const tables: Record<string, Row[]> = {
    estimate_projects: [{ id: projectId, tenant_id: tenantId, user_id: options.owner ?? userId, name: "Affaire fictive", reference: null, client_name: null, is_archived: false }],
    affaire_intake_documents: [document], affaire_briefs: options.brief === null ? [] : [brief], affaire_intake_events: [], affaire_brief_source_links: [],
  };
  const calls: string[] = [];
  const supabase = { from: (table: string) => {
    const rows = tables[table];
    if (!rows) throw new Error(`Unexpected table: ${table}`);
    let operation = "select";
    let values: Row | Row[] = {};
    const filters: Array<(row: Row) => boolean> = [];
    const execute = (single: boolean) => {
      calls.push(`${operation}:${table}`);
      let matching = rows.filter((row) => filters.every((filter) => filter(row)));
      if (operation === "update") {
        if (options.conflict && table === "affaire_intake_documents") matching = [];
        matching.forEach((row) => Object.assign(row, values));
      } else if (operation === "insert") {
        matching = (Array.isArray(values) ? values : [values]).map((value) => ({ id: briefId, created_at: classifiedAt, updated_at: classifiedAt, ...value }));
        rows.push(...matching);
      } else if (operation === "delete") {
        matching.forEach((row) => rows.splice(rows.indexOf(row), 1));
      }
      return Promise.resolve({ data: single ? matching[0] ?? null : matching, error: null });
    };
    const query = {
      select: () => query, order: () => query,
      eq: (key: string, value: unknown) => { filters.push((row) => row[key] === value); return query; },
      is: (key: string, value: unknown) => { filters.push((row) => (row[key] ?? null) === value); return query; },
      in: (key: string, list: unknown[]) => { filters.push((row) => list.includes(row[key])); return query; },
      update: (input: Row) => { operation = "update"; values = input; return query; },
      insert: (input: Row | Row[]) => { operation = "insert"; values = input; return query; },
      delete: () => { operation = "delete"; return query; },
      maybeSingle: () => execute(true), single: () => execute(true),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => execute(false).then(resolve, reject),
    };
    return query;
  } };
  vi.mocked(getAuthenticatedContext).mockResolvedValue({ userId, tenantId, tenantRole: options.role ?? "admin", supabase } as never);
  return { document, brief, calls, tables };
}

describe("human classification confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(callStructuredAi).mockResolvedValue({ data: null } as never);
    vi.mocked(syncTakeoffPlanSetFromAffaireIntake).mockResolvedValue({ syncedDocumentCount: 0, removedDocumentCount: 0 });
  });

  it("confirms an unchanged plan without regenerating the brief or invalidating its working copy", async () => {
    const state = harness();
    const originalBrief = structuredClone(state.brief);
    await reclassifyAffaireDocument({ projectId, documentId, category: "plans" });
    expect(state.document).toMatchObject({ classification_source: "manual", classified_by: userId, confidence: 1,
      classified_at: classifiedAt, plan_copy_generation: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" });
    expect(state.document.manually_overridden_at).toEqual(expect.any(String));
    expect(state.brief).toEqual(originalBrief);
    expect(callStructuredAi).not.toHaveBeenCalled();
    expect(syncTakeoffPlanSetFromAffaireIntake).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      documents: [expect.objectContaining({ classified_at: classifiedAt })],
    }));
    expect(state.tables.affaire_intake_events).toEqual([expect.objectContaining({ actor_user_id: userId, document_id: documentId, event_type: "document.reclassified" })]);
    expect(state.calls).toHaveLength(9);
  });

  it.each([null, { last_generated_at: "2026-10-31T10:00:00.000Z" }])("repairs a missing or outdated brief without invalidating current plan copies: %j", async (brief) => {
    const state = harness({ brief });
    await reclassifyAffaireDocument({ projectId, documentId, category: "plans" });
    expect(callStructuredAi).toHaveBeenCalledTimes(1);
    expect(syncTakeoffPlanSetFromAffaireIntake).toHaveBeenCalledTimes(1);
    expect(state.document.classified_at).toBe(classifiedAt);
    expect(state.tables.affaire_briefs).toHaveLength(1);
  });

  it("still repairs missing copies behind a current brief and refreshes the derived data afterward", async () => {
    const state = harness();
    vi.mocked(syncTakeoffPlanSetFromAffaireIntake).mockResolvedValue({ syncedDocumentCount: 1, removedDocumentCount: 0 });
    await reclassifyAffaireDocument({ projectId, documentId, category: "plans" });
    expect(syncTakeoffPlanSetFromAffaireIntake).toHaveBeenCalledTimes(1);
    expect(callStructuredAi).toHaveBeenCalledTimes(1);
    expect(state.document.classified_at).toBe(classifiedAt);
  });

  it.each([
    { category: "annexes" as const, document: {} },
    { category: "plans" as const, document: { classification_status: "ambiguous" } },
    { category: "plans" as const, document: { issues: [AFFAIRE_INTAKE_REANALYSIS_PENDING_ISSUE] } },
  ])("still reconciles derived data for a substantive change: %j", async (input) => {
    const state = harness({ document: input.document });
    await reclassifyAffaireDocument({ projectId, documentId, category: input.category });
    expect(syncTakeoffPlanSetFromAffaireIntake).toHaveBeenCalledTimes(1);
    expect(callStructuredAi).toHaveBeenCalledTimes(1);
    expect(state.document.classified_at).not.toBe(classifiedAt);
  });

  it("does not confirm a document changed by a concurrent writer", async () => {
    const state = harness({ conflict: true });
    await expect(reclassifyAffaireDocument({ projectId, documentId, category: "plans" })).rejects.toThrow("Le document a changé");
    expect(state.document.classification_source).toBe("ai");
    expect(state.tables.affaire_intake_events).toEqual([]);
    expect(callStructuredAi).not.toHaveBeenCalled();
  });

  it("keeps the same authorization boundary for the quicker confirmation", async () => {
    const state = harness({ role: "director", owner: "99999999-9999-4999-8999-999999999999" });
    await expect(reclassifyAffaireDocument({ projectId, documentId, category: "plans" })).rejects.toThrow("Accès refusé");
    expect(state.document.classification_source).toBe("ai");
    expect(state.tables.affaire_intake_events).toEqual([]);
  });
});
