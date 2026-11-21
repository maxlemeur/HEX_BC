import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readChatGptStore } from "@/lib/ai/chatgpt-local-store";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PLAN_FILES_BUCKET } from "@/lib/storage/buckets";
import { AFFAIRE_INTAKE_PLAN_SET_METADATA } from "@/lib/takeoff/default-import-plan-set";
import { evaluateTakeoffLaunchRequests } from "@/lib/takeoff/launch-request-server";
import { runLocalTakeoffAttempts } from "@/lib/takeoff/local-dispatch";
import { createSupabaseFake, filterValue, type FakeQuery } from "@/lib/takeoff/metre-m3.test-utils";
import { takeoffPreparationSourceSchema } from "@/lib/takeoff/preparation";
import { buildDeducedTakeoffPreparation } from "@/lib/takeoff/preparation-from-dossier";
import { loadPreparation } from "@/lib/takeoff/preparation-server";

// The automatic start on the authorised Mac: the loop that evaluates and admits a request has no member's session (a
// request would fail here: next/headers throws), reads the payer's subscription on this Mac, and names what stops it.
vi.mock("next/headers", () => ({ headers: () => { throw new Error("The Mac's loop has no HTTP request."); } }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/ai/chatgpt-local-auth", () => ({
  isLocalChatGptEnabled: () => true, hasLocalChatGptPlanAccess: () => true, assertLocalChatGptHost: vi.fn(),
}));
vi.mock("@/lib/ai/chatgpt-local-store", () => ({ getChatGptHostId: vi.fn().mockResolvedValue("urn:uuid:aaaaaaaa-0000-4000-8000-000000000099"), readChatGptStore: vi.fn() }));
vi.mock("@/lib/takeoff/feature-flags", () => ({
  isTakeoffEnabled: vi.fn().mockResolvedValue(true),
  getTakeoffLevelCProcessingConfigForTenant: vi.fn().mockResolvedValue({ maxPdfPages: 200 }),
}));
vi.mock("@/lib/takeoff/local-dispatch", () => ({ runLocalTakeoffAttempts: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/takeoff/preparation-server", () => ({ loadPreparation: vi.fn(), assertConfirmedTakeoffPreparation: vi.fn() }));
vi.mock("@/lib/pdf/page-render-server", () => ({ renderPdfPages: vi.fn().mockResolvedValue({ pages: [{ regionText: "" }] }) }));

const HOST = "urn:uuid:aaaaaaaa-0000-4000-8000-000000000099";
const TENANT = "aaaaaaaa-0000-4000-8000-000000000010";
const PROJECT = "aaaaaaaa-0000-4000-8000-000000000020";
const PAYER = "aaaaaaaa-0000-4000-8000-000000000001";
const REQUEST = "aaaaaaaa-0000-4000-8000-000000000030";
const PLAN_SET = "aaaaaaaa-0000-4000-8000-000000000040";
const PLAN_FILE = "aaaaaaaa-0000-4000-8000-000000000050";
const DOCUMENT = "aaaaaaaa-0000-4000-8000-000000000060";
const BYTES = new TextEncoder().encode("%PDF-1.4 plan fictif du rez-de-chaussée");
const SELECTION = { profileId: "profil-fictif", model: "modele-fictif", reasoningEffort: null, hostId: HOST };
const FILE_PATH = `${TENANT}/${PLAN_SET}/${PLAN_FILE}/plan-rdc.pdf`;

function dossier(input: { classification?: string; copy?: "same" | "older" | "none"; executionHost?: string } = {}) {
  const document = {
    id: DOCUMENT, tenant_id: TENANT, project_id: PROJECT, upload_id: "aaaaaaaa-0000-4000-8000-000000000070", created_by: PAYER,
    storage_path: `${TENANT}/dossier/plan-rdc.pdf`, deletion_token: null, plan_copy_generation: "generation-2",
    file_name: "Plan RDC.pdf", mime_type: "application/pdf", size_bytes: BYTES.byteLength, upload_status: "uploaded",
    rejection_reason: null, classification_status: input.classification ?? "classified", document_kind: "plans",
    document_priority: "primary", confidence: 0.92, issues: [], extracted_metadata: {}, classification_source: "heuristic",
    classified_by: null, classified_at: "2026-11-21T08:00:00Z", manually_overridden_at: null, source_provider: null,
  };
  const copy = { id: PLAN_FILE, file_path: FILE_PATH, file_name: "plan-rdc.pdf", file_size_bytes: BYTES.byteLength,
    metadata: { source: "affaire-intake", intake_document_id: DOCUMENT, intake_storage_path: document.storage_path,
      intake_generation: input.copy === "older" ? "generation-1" : "generation-2" } };
  const admitted: unknown[] = [];
  const recorded: unknown[] = [];
  const fake = createSupabaseFake({
    tables: {
      takeoff_launch_requests: () => ({ data: { id: REQUEST, origin: "automatic", payer_id: PAYER,
        execution_host_id: input.executionHost ?? HOST, mandate_selection: SELECTION }, error: null }),
      affaire_briefs: () => ({ data: { status: "confirme" }, error: null }),
      affaire_intake_documents: () => ({ data: [document], error: null, count: 1 }),
      plan_sets: () => ({ data: [{ id: PLAN_SET, estimate_version_id: null, name: "Plans import", metadata: AFFAIRE_INTAKE_PLAN_SET_METADATA,
        updated_at: "2026-11-21T08:00:00Z", plan_files: [{ count: input.copy === "none" ? 0 : 1 }] }], error: null, count: 1 }),
      plan_files: (query: FakeQuery) => {
        const rows = input.copy === "none" ? [] : [{ ...copy, file_type: "application/pdf", page_count: 1 }];
        return { data: filterValue(query, "plan_set_id") === PLAN_SET ? rows : [], error: null, count: rows.length };
      },
      tenant_memberships: () => ({ data: { role: "engineer" }, error: null }),
      estimate_projects: () => ({ data: { user_id: PAYER, is_archived: false }, error: null }),
    },
    storage: { [PLAN_FILES_BUCKET]: () => ({ data: new Blob([BYTES]), error: null }) },
    rpc: {
      claim_takeoff_launch_evaluations: () => ({ data: [{ request_id: REQUEST, tenant_id: TENANT, project_id: PROJECT,
        origin: "automatic", payer_id: PAYER, mark: 7 }], error: null }),
      record_takeoff_launch_evaluation: (args) => { recorded.push(args); return { data: "blocked", error: null }; },
      admit_takeoff_launch_request: (args) => {
        admitted.push(args);
        return { data: [{ outcome: "admitted", job_id: (args as { p_job: { id: string } }).p_job.id, reason_code: null }], error: null };
      },
    },
  });
  vi.mocked(createServiceRoleClient).mockReturnValue(fake.client as never);
  const source = takeoffPreparationSourceSchema.parse({
    document_id: PLAN_FILE, document_name: "Plan RDC.pdf", kind: "plan", revision: null, source_version: "fixture-version",
    pages: [], active: true, confirmed: true, plan_set_id: PLAN_SET, file_path: FILE_PATH, page_count: 1,
    source_updated_at: "2026-11-21T08:00:00Z", mime_type: "application/pdf",
  });
  vi.mocked(loadPreparation).mockResolvedValue({
    draft: buildDeducedTakeoffPreparation({ sources: [source], planSetId: PLAN_SET }), revision: null, availableSources: [source],
  } as never);
  return { fake, admitted, recorded };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: "profil-fictif",
    profiles: [{ id: "profil-fictif", model: "modele-fictif", reasoningEffort: null }] } as never);
});

describe("evaluateTakeoffLaunchRequests", () => {
  it("admits the request on the Mac of the mandate, without a member's session, with its sealed plans", async () => {
    const { admitted, recorded } = dossier();
    const [result] = await evaluateTakeoffLaunchRequests();
    expect(result).toMatchObject({ requestId: REQUEST, outcome: "admitted" });
    expect(recorded).toEqual([]);
    expect(admitted).toHaveLength(1);
    const call = admitted[0] as { p_mark: number; p_manifest: Record<string, unknown>; p_snapshot: Record<string, unknown>; p_job: Record<string, unknown> };
    expect(call.p_mark).toBe(7);
    expect(call.p_manifest).toMatchObject({
      format_version: 1, intent: "initial", order: { kind: "free_extraction", version: 1, list: null },
      units: [{ key: "grouped", plans: [PLAN_FILE] }],
      plans: [{ entry_key: PLAN_FILE, logical_id: DOCUMENT, intake_document_id: DOCUMENT, plan_file_id: PLAN_FILE,
        generation: "generation-2", content_sha256: createHash("sha256").update(BYTES).digest("hex"), pages: [] }],
    });
    expect(call.p_snapshot).toMatchObject({ confirmed_by: PAYER, execution_selection: SELECTION,
      preparation: { destination: { kind: "analysis_only", estimate_version_id: null }, processing: { level: "C", provider: "chatgpt" } } });
    expect(call.p_job).toMatchObject({ plan_set_id: PLAN_SET, execution_host_id: HOST });
    expect(runLocalTakeoffAttempts).toHaveBeenCalledWith(expect.objectContaining({ jobId: call.p_job.id, trigger: "create" }));
  });

  it.each([
    ["a copy never made", "none"],
    ["a copy of an older generation of the piece", "older"],
  ] as const)("names a dossier plan without its working copy (%s) and spends nothing", async (_case, copy) => {
    const { admitted, recorded } = dossier({ copy });
    const [result] = await evaluateTakeoffLaunchRequests();
    expect(result).toMatchObject({ outcome: "blocked", reason: "PLAN_COPY_MISSING" });
    expect(recorded).toEqual([expect.objectContaining({ p_state: "blocked", p_reason: "PLAN_COPY_MISSING",
      p_details: { pieces: [{ id: DOCUMENT, name: "Plan RDC.pdf" }] } })]);
    expect(admitted).toEqual([]);
    expect(runLocalTakeoffAttempts).not.toHaveBeenCalled();
  });

  it("waits while the dossier is still being classified", async () => {
    const { admitted, recorded } = dossier({ classification: "processing" });
    await evaluateTakeoffLaunchRequests();
    expect(recorded).toEqual([expect.objectContaining({ p_state: "not_eligible", p_reason: "DOSSIER_PROCESSING" })]);
    expect(admitted).toEqual([]);
  });

  it("does not spend on a subscription whose model changed since the mandate", async () => {
    const { admitted, recorded } = dossier();
    vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: "profil-fictif",
      profiles: [{ id: "profil-fictif", model: "autre-modele", reasoningEffort: null }] } as never);
    await evaluateTakeoffLaunchRequests();
    expect(recorded).toEqual([expect.objectContaining({ p_state: "blocked", p_reason: "CHATGPT_SELECTION_CHANGED" })]);
    expect(admitted).toEqual([]);
  });

  it("does not spend when the payer's subscription is no longer connected on this Mac", async () => {
    const { admitted, recorded } = dossier();
    vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: null, profiles: [] } as never);
    await evaluateTakeoffLaunchRequests();
    expect(recorded).toEqual([expect.objectContaining({ p_state: "blocked", p_reason: "CHATGPT_NOT_CONNECTED" })]);
    expect(admitted).toEqual([]);
  });

  it("refuses a mandate prepared on another Mac", async () => {
    const { admitted, recorded } = dossier({ executionHost: "urn:uuid:aaaaaaaa-0000-4000-8000-000000000098" });
    await evaluateTakeoffLaunchRequests();
    expect(recorded).toEqual([expect.objectContaining({ p_state: "blocked", p_reason: "MANDATE_REQUIRED" })]);
    expect(admitted).toEqual([]);
  });
});
