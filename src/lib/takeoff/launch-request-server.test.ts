import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { readChatGptStore } from "@/lib/ai/chatgpt-local-store";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { PLAN_FILES_BUCKET } from "@/lib/storage/buckets";
import { AFFAIRE_INTAKE_PLAN_SET_METADATA } from "@/lib/takeoff/default-import-plan-set";
import { assertLocalChatGptHost, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import {
  assumeTakeoffLaunchRequest, confirmAffaireBriefWithTakeoff, describeDossierChangeSinceAnalysis, evaluateTakeoffLaunchRequests,
  launchTakeoffRelaunch, readAutomaticTakeoffPayerNotice,
} from "@/lib/takeoff/launch-request-server";
import { runLocalTakeoffAttempts } from "@/lib/takeoff/local-dispatch";
import { createSupabaseFake, filterValue, type FakeQuery } from "@/lib/takeoff/metre-m3.test-utils";
import { takeoffPreparationSourceSchema } from "@/lib/takeoff/preparation";
import { buildDeducedTakeoffPreparation } from "@/lib/takeoff/preparation-from-dossier";
import { assertConfirmedTakeoffPreparation, loadPreparation } from "@/lib/takeoff/preparation-server";

// The automatic start on the authorised Mac: the loop that evaluates and admits a request has no member's session (a
// request would fail here: next/headers throws), reads the payer's subscription on this Mac, and names what stops it.
vi.mock("next/headers", () => ({ headers: () => { throw new Error("The Mac's loop has no HTTP request."); } }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/ai/chatgpt-local-auth", () => ({
  isLocalChatGptEnabled: vi.fn(() => true), hasLocalChatGptPlanAccess: () => true, assertLocalChatGptHost: vi.fn(),
  ensureLocalChatGptAuthorization: vi.fn().mockResolvedValue(null),
}));
// After the response: run at once here, as the Mac's own loop runs it (it has no response).
vi.mock("next/server", () => ({ after: vi.fn((task: () => unknown) => { void task(); }) }));
vi.mock("@/lib/takeoff/dispatch-state", () => ({ persistTakeoffDispatchOutcome: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/takeoff/preparation-repository", () => ({ assertPreparationProjectAccess: vi.fn() }));
vi.mock("@/lib/ai/chatgpt-local-store", () => ({ getChatGptHostId: vi.fn().mockResolvedValue("urn:uuid:aaaaaaaa-0000-4000-8000-000000000099"), readChatGptStore: vi.fn() }));
vi.mock("@/lib/takeoff/feature-flags", () => ({
  takeoffModuleDefault: vi.fn(() => true),
  getTakeoffLevelCProcessingConfigForTenant: vi.fn().mockResolvedValue({ maxPdfPages: 200, maxTotalTokens: 400000, maxCostCents: 2500 }),
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
const SELECTION = { profileId: "profil-fictif", model: "modele-fictif", reasoningEffort: null, hostId: HOST, authorizationId: "autorisation-1" };
const FILE_PATH = `${TENANT}/${PLAN_SET}/${PLAN_FILE}/plan-rdc.pdf`;

function dossier(input: { classification?: string; copy?: "same" | "older" | "legacy" | "none"; executionHost?: string; running?: boolean } = {}) {
  const document = {
    id: DOCUMENT, tenant_id: TENANT, project_id: PROJECT, upload_id: "aaaaaaaa-0000-4000-8000-000000000070", created_by: PAYER,
    storage_path: `${TENANT}/dossier/plan-rdc.pdf`, deletion_token: null, plan_copy_generation: "generation-2",
    file_name: "Plan RDC.pdf", mime_type: "application/pdf", size_bytes: BYTES.byteLength, upload_status: "uploaded",
    rejection_reason: null, classification_status: input.classification ?? "classified", document_kind: "plans",
    document_priority: "primary", confidence: 0.92, issues: [], extracted_metadata: {}, classification_source: "heuristic",
    classified_by: null, classified_at: "2026-11-21T08:00:00Z", manually_overridden_at: null, source_provider: null,
  };
  // A copy made before generations were recorded (legacy) names the classification it was made from instead.
  const copy = { id: PLAN_FILE, file_path: FILE_PATH, file_name: "plan-rdc.pdf", file_size_bytes: BYTES.byteLength,
    metadata: { source: "affaire-intake", intake_document_id: DOCUMENT, intake_storage_path: document.storage_path,
      ...(input.copy === "legacy" ? { intake_classified_at: document.classified_at }
        : { intake_generation: input.copy === "older" ? "generation-1" : "generation-2" }) } };
  const admitted: unknown[] = [];
  const recorded: unknown[] = [];
  const fake = createSupabaseFake({
    tables: {
      takeoff_launch_requests: (query: FakeQuery) => filterValue(query, "state") === "admitted"
        ? { data: input.running ? [{ id: "aaaaaaaa-0000-4000-8000-000000000031" }] : [], error: null }
        : { data: [], error: null },
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
      // The claim hands this Mac only its own mandates, of a tenant whose module is on, with the mandate's selection.
      claim_takeoff_launch_evaluations: (args) => ({ data: (args as { p_module_default: boolean }).p_module_default
        ? [{ request_id: REQUEST, tenant_id: TENANT, project_id: PROJECT, origin: "automatic", payer_id: PAYER, mark: 7,
          mandate_selection: SELECTION, payer_eligible: true }] : [], error: null }),
      record_takeoff_launch_evaluation: (args) => { recorded.push(args); return { data: "blocked", error: null }; },
      record_takeoff_launch_evaluation_failure: () => ({ data: "evaluating", error: null }),
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
  return { fake, admitted, recorded, document, copy };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isLocalChatGptEnabled).mockReturnValue(true);
  vi.mocked(assertLocalChatGptHost).mockImplementation((host) => host ?? "");
  vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: "profil-fictif",
    profiles: [{ id: "profil-fictif", model: "modele-fictif", reasoningEffort: null, authorizationId: "autorisation-1" }] } as never);
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
      budget: { tokens: 400000, cost_cents: 2500 },
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
      profiles: [{ id: "profil-fictif", model: "autre-modele", reasoningEffort: null, authorizationId: "autorisation-1" }] } as never);
    await evaluateTakeoffLaunchRequests();
    expect(recorded).toEqual([expect.objectContaining({ p_state: "blocked", p_reason: "CHATGPT_SELECTION_CHANGED" })]);
    expect(admitted).toEqual([]);
  });

  // A disconnection withdraws the mandate: its reason is the revocation, for the payer's gesture (no longer « not
  // connected », which a later connection alone would have seemed to lift).
  it("does not spend when the payer's subscription is no longer connected on this Mac", async () => {
    const { admitted, recorded } = dossier();
    vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: null, profiles: [] } as never);
    await evaluateTakeoffLaunchRequests();
    expect(recorded).toEqual([expect.objectContaining({ p_state: "blocked", p_reason: "CHATGPT_ACCESS_REVOKED" })]);
    expect(admitted).toEqual([]);
  });

  it("never revives a mandate through a reconnection, even while the dossier is still being classified", async () => {
    const { admitted, recorded } = dossier({ classification: "processing" });
    // The same profile, model and effort, under the authorization of a new connection.
    vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: "profil-fictif",
      profiles: [{ id: "profil-fictif", model: "modele-fictif", reasoningEffort: null, authorizationId: "autorisation-2" }] } as never);
    await evaluateTakeoffLaunchRequests();
    expect(recorded).toEqual([expect.objectContaining({ p_state: "blocked", p_reason: "CHATGPT_ACCESS_REVOKED" })]);
    expect(admitted).toEqual([]);
  });

  it("asks the claim with the server's module default, and admits with it", async () => {
    const { fake } = dossier();
    await evaluateTakeoffLaunchRequests();
    expect(fake.rpcCalls.filter((call) => ["claim_takeoff_launch_evaluations", "admit_takeoff_launch_request"].includes(call.fn))
      .map((call) => (call.args as { p_module_default?: boolean }).p_module_default)).toEqual([true, true]);
  });

  it("waits, before reading any plan, while another request of the affaire runs", async () => {
    const { fake, admitted, recorded } = dossier({ running: true });
    await evaluateTakeoffLaunchRequests();
    expect(recorded).toEqual([expect.objectContaining({ p_state: "blocked", p_reason: "ANOTHER_ANALYSIS_RUNNING" })]);
    expect(fake.storageCalls).toEqual([]);
    expect(admitted).toEqual([]);
  });

  it("gives the lease back and counts the failure when an evaluation stops on an error", async () => {
    const { fake, admitted } = dossier();
    vi.mocked(loadPreparation).mockRejectedValue(new Error("lecture impossible"));
    await evaluateTakeoffLaunchRequests();
    expect(admitted).toEqual([]);
    expect(fake.rpcCalls.map((call) => call.fn)).toContain("record_takeoff_launch_evaluation_failure");
  });
});

// After an analysis, the dossier against the plans it sealed: the same kind of generation sealed and compared, a copy made
// before generations were recorded included.
describe("describeDossierChangeSinceAnalysis", () => {
  it.each([["a copy of the piece's generation", "same"], ["a copy made before generations were recorded", "legacy"]] as const)(
    "reports no change right after the analysis of %s", async (_case, kind) => {
      const { admitted, document, copy } = dossier({ copy: kind });
      await evaluateTakeoffLaunchRequests();
      const { p_manifest: manifest } = admitted[0] as { p_manifest: never };
      expect(describeDossierChangeSinceAnalysis(manifest, [copy], [document])).toBeNull();
    });

  it.each([["a copy of the piece's generation", "same"], ["a copy made before generations were recorded", "legacy"]] as const)(
    "reports the piece replaced once the dossier holds its new generation, its old %s still in the set", async (_case, kind) => {
      const { admitted, document, copy } = dossier({ copy: kind });
      await evaluateTakeoffLaunchRequests();
      const { p_manifest: manifest } = admitted[0] as { p_manifest: never };
      const replaced = { ...document, plan_copy_generation: "generation-3", classified_at: "2026-11-21T09:00:00Z" };
      expect(describeDossierChangeSinceAnalysis(manifest, [copy], [replaced])).toEqual({ added: [], removed: [],
        replaced: [{ id: DOCUMENT, name: "Plan RDC.pdf" }] });
    });
});

// The gestures: the brief's confirmation records who pays, on this Mac, or why nobody does; a take-over and a relaunch.
const NOTICE = "a".repeat(64);
function gesture(input: { launchActive?: boolean; reply?: Record<string, unknown>; outcome?: string; replayed?: Record<string, unknown>;
  mayPay?: boolean; action?: string } = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const record = (fn: string, data: unknown) => (args: unknown) => { calls.push({ fn, args: args as Record<string, unknown> }); return { data, error: null }; };
  const row = { request_id: REQUEST, state: "evaluating", reason_code: null, payer_id: PAYER, ...input.reply };
  const fake = createSupabaseFake({ rpc: {
    takeoff_launch_is_active: () => ({ data: input.launchActive !== false, error: null }),
    // The one payer rule (the database's): the member of `member()` may pay unless a reader.
    takeoff_payer_may_launch: (args) => ({ data: (args as { p_user_id: string }).p_user_id === PAYER && input.mayPay !== false, error: null }),
    takeoff_launch_request_action: () => ({ data: input.action ?? "none", error: null }),
    confirm_affaire_brief_takeoff: record("confirm", [{ outcome: input.outcome ?? "confirmed", ...row }]),
    take_on_takeoff_launch_request: record("take_on", [{ outcome: input.outcome ?? "mandated", mandate_revision: 2, ...row }]),
    takeoff_payer_notice: record("notice", NOTICE),
    replay_manual_takeoff_request: record("replay", input.replayed ? [input.replayed] : []),
    claim_takeoff_launch_evaluations: () => ({ data: [], error: null }),
  } });
  vi.mocked(createServiceRoleClient).mockReturnValue(fake.client as never);
  return { calls: (fn: string) => calls.filter((call) => call.fn === fn).map((call) => call.args) };
}
// The member's verified session claims: the confirmation evaluates the released brief policy under them.
const CLAIMS = { sub: PAYER, role: "authenticated", aud: "authenticated", app_metadata: {} };
const getClaims = vi.fn();
const member = (tenantRole: string) => ({ userId: PAYER, tenantId: TENANT, tenantRole, supabase: { auth: { getClaims } } }) as never;
const confirm = (tenantRole: string, notice: string | null = NOTICE) =>
  confirmAffaireBriefWithTakeoff({ context: member(tenantRole), projectId: PROJECT, expectedUpdatedAt: "2026-11-21T08:00:00Z", notice, host: "127.0.0.1:3000" });

describe("confirmAffaireBriefWithTakeoff", () => {
  beforeEach(() => getClaims.mockResolvedValue({ data: { claims: CLAIMS }, error: null }));

  it("lets the database decide who may confirm under the member's verified session claims", async () => {
    const { calls } = gesture();
    await confirm("engineer");
    expect(calls("confirm")).toEqual([expect.objectContaining({ p_actor: PAYER, p_actor_claims: CLAIMS })]);
  });

  it("passes no claims when the session cannot be verified, which the database refuses", async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error("expired") });
    const { calls } = gesture();
    await confirm("engineer");
    expect(calls("confirm")).toEqual([expect.objectContaining({ p_actor_claims: null })]);
  });

  it("confirms with the notice that was shown and the selection of Mon profil on this Mac", async () => {
    const { calls } = gesture();
    const result = await confirm("engineer");
    expect(calls("confirm")).toEqual([expect.objectContaining({ p_actor: PAYER, p_expected_updated_at: "2026-11-21T08:00:00Z",
      p_notice: NOTICE, p_host: HOST, p_selection: SELECTION })]);
    expect(calls("confirm")[0]).not.toHaveProperty("p_blocked_reason");
    expect(result).toMatchObject({ outcome: "confirmed", takeoff: { state: "evaluating", reason: null } });
  });

  // The cut-offs and the module are the database's decision (takeoff-launch-round-two.test.sql); the server passes its
  // module default and the notice as the dialog showed it.
  it("passes the server's module default to the confirmation", async () => {
    const { calls } = gesture();
    await confirm("engineer");
    expect(calls("confirm")).toEqual([expect.objectContaining({ p_module_default: true, p_notice: NOTICE })]);
  });

  it("tells the member the request's reason and the gesture it allows", async () => {
    gesture({ reply: { state: "blocked", reason_code: "MANDATE_REQUIRED", payer_id: null }, action: "take_on" });
    const result = await confirm("engineer", null);
    expect(result.takeoff).toMatchObject({ reason: "MANDATE_REQUIRED", action: "take_on", actionLabel: "Prendre en charge avec mon forfait",
      message: expect.stringContaining("aucun forfait ChatGPT") });
  });

  it("never reads a reader's subscription: the request waits for an operator", async () => {
    const { calls } = gesture({ reply: { state: "blocked", reason_code: "OPERATOR_REQUIRED", payer_id: null }, mayPay: false });
    const result = await confirm("director", null);
    expect(readChatGptStore).not.toHaveBeenCalled();
    expect(calls("confirm")).toEqual([expect.objectContaining({ p_blocked_reason: "MANDATE_REQUIRED" })]);
    expect(result.takeoff).toMatchObject({ reason: "OPERATOR_REQUIRED", message: "Métré non démarré — prise en charge par un métreur requise" });
  });

  it.each([
    ["the hosted application", () => vi.mocked(isLocalChatGptEnabled).mockReturnValue(false), "LOCAL_RUNTIME_REQUIRED"],
    ["another address", () => vi.mocked(assertLocalChatGptHost).mockImplementation(() => { throw new Error("refused"); }), "HOST_NOT_AUTHORISED"],
    ["no ChatGPT connection", () => vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: null, profiles: [] } as never), "CHATGPT_NOT_CONNECTED"],
    ["no model chosen", () => vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: "profil-fictif",
      profiles: [{ id: "profil-fictif", model: null, reasoningEffort: null, authorizationId: "autorisation-1" }] } as never), "CHATGPT_MODEL_MISSING"],
  ] as const)("confirms without a mandate from %s, with the reason", async (_case, arrange, reason) => {
    arrange();
    const { calls } = gesture({ reply: { state: "blocked", reason_code: reason, payer_id: PAYER } });
    await confirm("engineer");
    expect(calls("confirm")).toEqual([expect.objectContaining({ p_blocked_reason: reason })]);
    expect(calls("confirm")[0]).not.toHaveProperty("p_selection");
  });

  it("answers a stale form as a conflict", async () => {
    gesture({ outcome: "conflict" });
    expect(await confirm("engineer")).toEqual({ outcome: "conflict", takeoff: null });
  });
});

describe("readAutomaticTakeoffPayerNotice", () => {
  it("gives the operator the notice and the digest of what it was shown with", async () => {
    const { calls } = gesture();
    expect(await readAutomaticTakeoffPayerNotice(member("engineer"), { id: PROJECT }, "127.0.0.1:3000"))
      .toEqual({ message: "Une fois les plans prêts, le métré utilisera votre forfait ChatGPT et les réglages de Mon profil.", digest: NOTICE });
    expect(calls("notice")).toEqual([expect.objectContaining({ p_actor: PAYER, p_selection: SELECTION })]);
  });

  it("shows nothing to a member who may not pay, and never reads their subscription", async () => {
    gesture({ mayPay: false });
    expect(await readAutomaticTakeoffPayerNotice(member("director"), { id: PROJECT })).toBeNull();
    expect(readChatGptStore).not.toHaveBeenCalled();
  });
});

const takeOn = () => assumeTakeoffLaunchRequest({ context: member("engineer"), projectId: PROJECT, requestId: REQUEST, seenRevision: 1,
  action: "take_on", host: "127.0.0.1:3000" });

describe("assumeTakeoffLaunchRequest", () => {
  it("takes the request on with the member's own subscription on this Mac, naming the revision and action it saw", async () => {
    const { calls } = gesture();
    await takeOn();
    expect(calls("take_on")).toEqual([expect.objectContaining({ p_actor: PAYER, p_request_id: REQUEST, p_seen_revision: 1,
      p_action: "take_on", p_selection: SELECTION })]);
  });

  it("refuses, in French, a gesture whose subscription cannot pay, and records nothing", async () => {
    vi.mocked(readChatGptStore).mockResolvedValue({ selectedId: null, profiles: [] } as never);
    const { calls } = gesture();
    await expect(takeOn()).rejects.toMatchObject({ status: 422, message: expect.stringContaining("forfait ChatGPT non connecté") });
    expect(calls("take_on")).toEqual([]);
  });

  it("refuses a gesture from a view whose mandate moved since", async () => {
    gesture({ outcome: "moved" });
    await expect(takeOn()).rejects.toMatchObject({ status: 409, message: expect.stringContaining("a changé depuis votre lecture") });
  });

  it("refuses, in French, a gesture the database refuses because the takeoff module is off", async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(createSupabaseFake({ rpc: {
      take_on_takeoff_launch_request: () => { return { data: null, error: { message: "TAKEOFF_LAUNCH_MODULE_DISABLED", code: "55000" } }; },
    } }).client as never);
    await expect(takeOn()).rejects.toMatchObject({ status: 403, message: "Le module Takeoff est désactivé pour ce tenant." });
  });
});

describe("launchTakeoffRelaunch", () => {
  const relaunch = () => launchTakeoffRelaunch({ context: member("engineer"), projectId: PROJECT, planSetId: PLAN_SET,
    preparationRevision: 2, intentKey: "aaaaaaaa-0000-4000-8000-0000000000aa", predecessorJobId: "aaaaaaaa-0000-4000-8000-0000000000bb" });

  it("answers a replayed click with its recorded answer before reading the preparation", async () => {
    const { calls } = gesture({ replayed: { outcome: "already_running", request_id: REQUEST, job_id: "aaaaaaaa-0000-4000-8000-0000000000cc" } });
    expect(await relaunch()).toEqual({ outcome: "already_running", requestId: REQUEST, jobId: "aaaaaaaa-0000-4000-8000-0000000000cc" });
    expect(calls("replay")).toEqual([expect.objectContaining({ p_intent_key: "aaaaaaaa-0000-4000-8000-0000000000aa",
      p_predecessor_job_id: "aaaaaaaa-0000-4000-8000-0000000000bb", p_plan_set_id: PLAN_SET, p_preparation_revision: 2 })]);
    expect(assertConfirmedTakeoffPreparation).not.toHaveBeenCalled();
  });

  it("names a first analysis of the affaire « initial », with no analysis to replace", async () => {
    const { calls } = gesture({ replayed: { outcome: "replayed", request_id: REQUEST, job_id: "aaaaaaaa-0000-4000-8000-0000000000cc" } });
    await launchTakeoffRelaunch({ context: member("engineer"), projectId: PROJECT, planSetId: PLAN_SET, preparationRevision: 2,
      intentKey: "aaaaaaaa-0000-4000-8000-0000000000aa", predecessorJobId: null });
    expect(calls("replay")).toEqual([expect.objectContaining({ p_intent: "initial", p_predecessor_job_id: null })]);
  });

});
