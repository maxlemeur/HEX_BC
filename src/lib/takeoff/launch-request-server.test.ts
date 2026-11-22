import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET as getPlanLocations } from "@/app/api/takeoff/jobs/[jobId]/plan-locations/route";
import { GET as getVectorPlan } from "@/app/api/takeoff/jobs/[jobId]/vector-plans/[fileId]/route";
import { renderPdfPages } from "@/lib/pdf/page-render-server";
import { getAuthenticatedTakeoffContext, getTakeoffJobDetailByIdOrThrow } from "@/lib/takeoff/job-read-server";
import { describeTakeoffLaunchReason, type TakeoffLaunchManifest, type TakeoffLaunchPiece, type TakeoffLaunchReason } from "@/lib/takeoff/launch-request";
import type { TakeoffPreparationSnapshot } from "@/lib/takeoff/preparation";

import { readChatGptStore } from "@/lib/ai/chatgpt-local-store";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { AFFAIRE_INTAKE_BUCKET } from "@/lib/affaires/intake";
import { PLAN_FILES_BUCKET } from "@/lib/storage/buckets";
import { AFFAIRE_INTAKE_PLAN_SET_METADATA } from "@/lib/takeoff/default-import-plan-set";
import { assertLocalChatGptHost, isLocalChatGptEnabled } from "@/lib/ai/chatgpt-local-auth";
import { getConfirmedTakeoffExecutionOwner } from "@/lib/ai/chatgpt-takeoff";
import { resolvePlanSetSourceFile } from "@/lib/takeoff/job-creation-repository";
import {
  assumeTakeoffLaunchRequest, confirmAffaireBriefWithTakeoff, describeDossierChangeSinceAnalysis, evaluateTakeoffLaunchRequests,
  launchTakeoffRelaunch, readAutomaticTakeoffPayerNotice, readDossierChangeSinceAnalysis,
} from "@/lib/takeoff/launch-request-server";
import { runLocalTakeoffAttempts } from "@/lib/takeoff/local-dispatch";
import type { AnyTakeoffLaunchManifest } from "@/lib/takeoff/launch-request";
import { createSupabaseFake, filterValue, servedRows, type FakeQuery } from "@/lib/takeoff/metre-m3.test-utils";
import { loadPreparationReferenceFiles } from "@/lib/takeoff/preparation-reference-loader";
import { createTakeoffPreparationSnapshot, takeoffPreparationSourceSchema } from "@/lib/takeoff/preparation";
import { fictionalPlanPdf } from "@/lib/takeoff/preparation.test-utils";
import { buildDeducedTakeoffPreparation } from "@/lib/takeoff/preparation-from-dossier";
import { toPreparationIntakeSource } from "@/lib/takeoff/preparation-sources";
import { assertConfirmedTakeoffPreparation, loadPreparation } from "@/lib/takeoff/preparation-server";
import { sealedMeasuringOrder } from "@/lib/takeoff/item-list-seal-server";

// The automatic start on the authorised Mac: the loop that evaluates and admits a request has no member's session (a
// request would fail here: next/headers throws), reads the payer's subscription on this Mac, and names what stops it.
vi.mock("next/headers", () => ({ headers: () => { throw new Error("The Mac's loop has no HTTP request."); } }));
vi.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: vi.fn() }));
vi.mock("@/lib/ai/chatgpt-local-auth", () => ({
  isLocalChatGptEnabled: vi.fn(() => true), hasLocalChatGptPlanAccess: () => true, assertLocalChatGptHost: vi.fn(),
  ensureLocalChatGptAuthorization: vi.fn().mockResolvedValue(null),
}));
// After the response: run at once here, as the Mac's own loop runs it (it has no response).
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()),
  after: vi.fn((task: () => unknown) => { void task(); }) }));
vi.mock("@/lib/takeoff/dispatch-state", () => ({ persistTakeoffDispatchOutcome: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/takeoff/preparation-repository", () => ({ assertPreparationProjectAccess: vi.fn() }));
vi.mock("@/lib/ai/chatgpt-local-store", () => ({ getChatGptHostId: vi.fn().mockResolvedValue("urn:uuid:aaaaaaaa-0000-4000-8000-000000000099"), readChatGptStore: vi.fn() }));
vi.mock("@/lib/takeoff/feature-flags", () => ({
  takeoffModuleDefault: vi.fn(() => true),
  getTakeoffLevelCProcessingConfigForTenant: vi.fn().mockResolvedValue({ maxPdfPages: 200, maxTotalTokens: 400000, maxCostCents: 2500 }),
}));
vi.mock("@/lib/takeoff/local-dispatch", () => ({ runLocalTakeoffAttempts: vi.fn().mockResolvedValue(undefined) }));
// The preparation as the dossier gives it is fixed here; its sealing is the real one a confirmation uses.
vi.mock("@/lib/takeoff/preparation-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/takeoff/preparation-server")>()), loadPreparation: vi.fn(), assertConfirmedTakeoffPreparation: vi.fn(),
}));
// The review's readers, behind their routes: the member's session is fixed here.
vi.mock("@/lib/takeoff/job-read-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/takeoff/job-read-server")>()), getAuthenticatedTakeoffContext: vi.fn(), getTakeoffJobDetailByIdOrThrow: vi.fn(),
}));
// A command reads its member's subscription as pinned at the confirmation (its own tests: chatgpt-takeoff.test.ts).
vi.mock("@/lib/ai/chatgpt-takeoff", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/chatgpt-takeoff")>()), getConfirmedTakeoffExecutionOwner: vi.fn() }));
vi.mock("@/lib/pdf/page-render-server", () => ({ renderPdfPages: vi.fn().mockResolvedValue({ pages: [{ regionText: "" }] }) }));
// The measuring order a command seals (lot 4): the real reading (the second order not active, the free extraction) unless a
// case answers otherwise.
vi.mock("@/lib/takeoff/item-list-seal-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/takeoff/item-list-seal-server")>();
  return { ...actual, sealedMeasuringOrder: vi.fn(actual.sealedMeasuringOrder) };
});
// The member's own subscription and the plan set's source, as a manual launch reads them: real unless a test names them.
vi.mock("@/lib/ai/chatgpt-takeoff", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/chatgpt-takeoff")>();
  return { ...actual, getConfirmedTakeoffExecutionOwner: vi.fn(actual.getConfirmedTakeoffExecutionOwner) };
});
vi.mock("@/lib/takeoff/job-creation-repository", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/takeoff/job-creation-repository")>();
  return { ...actual, resolvePlanSetSourceFile: vi.fn(actual.resolvePlanSetSourceFile) };
});

const HOST = "urn:uuid:aaaaaaaa-0000-4000-8000-000000000099";
const TENANT = "aaaaaaaa-0000-4000-8000-000000000010";
const PROJECT = "aaaaaaaa-0000-4000-8000-000000000020";
const PAYER = "aaaaaaaa-0000-4000-8000-000000000001";
const REQUEST = "aaaaaaaa-0000-4000-8000-000000000030";
const PLAN_SET = "aaaaaaaa-0000-4000-8000-000000000040";
const PLAN_FILE = "aaaaaaaa-0000-4000-8000-000000000050";
const DOCUMENT = "aaaaaaaa-0000-4000-8000-000000000060";
const BYTES = new Uint8Array(fictionalPlanPdf("plan fictif du rez-de-chaussée"));
const SELECTION = { profileId: "profil-fictif", model: "modele-fictif", reasoningEffort: null, hostId: HOST, authorizationId: "autorisation-1" };
const FILE_PATH = `${TENANT}/${PLAN_SET}/${PLAN_FILE}/plan-rdc.pdf`;

/** A reference of the dossier (a CCTP, a DPGF) with its bytes, retained by default by the automatic start. */
type DossierReference = { id: string; name: string; kind: "cctp" | "dpgf"; mime: string; bytes: Uint8Array;
  /** The Storage key its row records, when not its own; the storage holds the bytes there. */
  storedAt?: string; missing?: boolean; recordedSize?: number };
const UPLOAD = "aaaaaaaa-0000-4000-8000-000000000070";
/** A dossier piece's Storage key as the dossier writes it: tenant, affaire, upload, document, name. */
const referenceKey = (reference: Pick<DossierReference, "id" | "name" | "storedAt">) =>
  reference.storedAt ?? `${TENANT}/${PROJECT}/${UPLOAD}/${reference.id}/${reference.name}`;

function dossier(input: { classification?: string; copy?: "same" | "older" | "legacy" | "none"; executionHost?: string; running?: boolean;
  references?: DossierReference[];
  /** The owner activated one analysis per plan. */
  perPlan?: boolean;
  /** The plan copy's bytes, and the page count its row stores (null: not counted yet). */
  bytes?: Uint8Array; storedPageCount?: number | null } = {}) {
  const planBytes = input.bytes ?? BYTES;
  const storedPageCount = input.storedPageCount === undefined ? 1 : input.storedPageCount;
  const document = {
    id: DOCUMENT, tenant_id: TENANT, project_id: PROJECT, upload_id: "aaaaaaaa-0000-4000-8000-000000000070", created_by: PAYER,
    storage_path: `${TENANT}/${PROJECT}/${UPLOAD}/${DOCUMENT}/plan-rdc.pdf`, deletion_token: null, plan_copy_generation: "generation-2",
    file_name: "Plan RDC.pdf", mime_type: "application/pdf", size_bytes: planBytes.byteLength, upload_status: "uploaded",
    rejection_reason: null, classification_status: input.classification ?? "classified", document_kind: "plans",
    document_priority: "primary", confidence: 0.92, issues: [], extracted_metadata: {}, classification_source: "heuristic",
    classified_by: null, classified_at: "2026-11-21T08:00:00Z", manually_overridden_at: null, source_provider: null,
  };
  // A copy made before generations were recorded (legacy) names the classification it was made from instead.
  const copy = { id: PLAN_FILE, file_path: FILE_PATH, file_name: "plan-rdc.pdf", file_size_bytes: planBytes.byteLength,
    metadata: { source: "affaire-intake", intake_document_id: DOCUMENT, intake_storage_path: document.storage_path,
      ...(input.copy === "legacy" ? { intake_classified_at: document.classified_at }
        : { intake_generation: input.copy === "older" ? "generation-1" : "generation-2" }) } };
  const referenceDocuments = (input.references ?? []).map((reference) => ({ ...document, id: reference.id, upload_id: UPLOAD,
    storage_path: referenceKey(reference), plan_copy_generation: null, file_name: reference.name, mime_type: reference.mime,
    size_bytes: reference.recordedSize ?? reference.bytes.byteLength, document_kind: reference.kind }));
  const admitted: unknown[] = [];
  const recorded: unknown[] = [];
  const fake = createSupabaseFake({
    tables: {
      takeoff_launch_requests: (query: FakeQuery) => filterValue(query, "state") === "admitted"
        ? { data: input.running ? [{ id: "aaaaaaaa-0000-4000-8000-000000000031" }] : [], error: null }
        : { data: [], error: null },
      affaire_briefs: () => ({ data: { status: "confirme" }, error: null }),
      affaire_intake_documents: () => ({ data: [document, ...referenceDocuments], error: null, count: 1 + referenceDocuments.length }),
      plan_sets: () => ({ data: [{ id: PLAN_SET, estimate_version_id: null, name: "Plans import", metadata: AFFAIRE_INTAKE_PLAN_SET_METADATA,
        updated_at: "2026-11-21T08:00:00Z", plan_files: [{ count: input.copy === "none" ? 0 : 1 }] }], error: null, count: 1 }),
      plan_files: (query: FakeQuery) => {
        const rows = input.copy === "none" ? [] : [{ ...copy, file_type: "application/pdf", page_count: storedPageCount }];
        return { data: filterValue(query, "plan_set_id") === PLAN_SET ? rows : [], error: null, count: rows.length };
      },
      tenant_memberships: () => ({ data: { role: "engineer" }, error: null }),
      estimate_projects: () => ({ data: { user_id: PAYER, is_archived: false }, error: null }),
    },
    storage: {
      [PLAN_FILES_BUCKET]: () => ({ data: new Blob([Uint8Array.from(planBytes)]), error: null }),
      [AFFAIRE_INTAKE_BUCKET]: ({ paths }) => {
        const reference = (input.references ?? []).find((entry) => (entry.storedAt ?? referenceKey(entry)) === paths[0]);
        return reference && !reference.missing ? { data: new Blob([Uint8Array.from(reference.bytes)]), error: null }
          : { data: null, error: { message: "Object not found", statusCode: "404" } };
      },
    },
    rpc: {
      // The claim hands this Mac only its own mandates, of a tenant whose module is on, with the mandate's selection.
      claim_takeoff_launch_evaluations: (args) => ({ data: (args as { p_module_default: boolean }).p_module_default
        ? [{ request_id: REQUEST, tenant_id: TENANT, project_id: PROJECT, origin: "automatic", payer_id: PAYER, mark: 7,
          mandate_selection: SELECTION, payer_eligible: true }] : [], error: null }),
      record_takeoff_launch_evaluation: (args) => { recorded.push(args); return { data: "blocked", error: null }; },
      record_takeoff_launch_evaluation_failure: () => ({ data: "evaluating", error: null }),
      takeoff_plan_dispatch_is_active: () => ({ data: input.perPlan === true, error: null }),
      // Lot 4: the second measuring order is not activated; the request seals the free extraction, as before.
      takeoff_item_list_order_is_active: () => ({ data: false, error: null }),
      admit_takeoff_launch_request: (args) => {
        admitted.push(args);
        const job = (args as { p_job: { id: string } | Array<{ id: string }> }).p_job;
        return { data: [{ outcome: "admitted", job_id: Array.isArray(job) ? job[0].id : job.id, reason_code: null }], error: null };
      },
    },
  });
  vi.mocked(createServiceRoleClient).mockReturnValue(fake.client as never);
  const source = takeoffPreparationSourceSchema.parse({
    document_id: PLAN_FILE, document_name: "Plan RDC.pdf", kind: "plan", revision: null, source_version: "fixture-version",
    // As the dossier's reader gives it (toPreparationPlanSource): no member confirmed it.
    pages: [], active: true, confirmed: false, plan_set_id: PLAN_SET, file_path: FILE_PATH, page_count: storedPageCount,
    source_updated_at: "2026-11-21T08:00:00Z", mime_type: "application/pdf",
  });
  const references = referenceDocuments.map((row) => toPreparationIntakeSource({ ...row, updated_at: "2026-11-21T08:00:00Z" }));
  vi.mocked(loadPreparation).mockResolvedValue({
    draft: buildDeducedTakeoffPreparation({ sources: [source, ...references], planSetId: PLAN_SET }), revision: null,
    availableSources: [source, ...references],
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

  // Lot 3: once the owner activated one analysis per plan, the same seal is admitted as one unit per plan, each with its
  // own job identified by the request and its unit, and the Mac's dispatcher is handed them.
  it("admits one unit per plan with its job once one analysis per plan is active", async () => {
    const { admitted } = dossier({ perPlan: true });
    const [result] = await evaluateTakeoffLaunchRequests();
    expect(result).toMatchObject({ requestId: REQUEST, outcome: "admitted" });
    const call = admitted[0] as { p_manifest: Record<string, unknown>; p_job: Array<Record<string, unknown>> };
    expect(call.p_manifest).toMatchObject({ format_version: 2, dispatch: { order: "display_name", version: 1 },
      units: [{ key: `plan:${PLAN_FILE}`, ordinal: 1, plans: [PLAN_FILE], budget: { tokens: 400000, cost_cents: 2500 }, vector_pages: 1 }],
      budget: { tokens: 400000, cost_cents: 2500 } });
    expect(call.p_job).toEqual([expect.objectContaining({ launch_unit_key: `plan:${PLAN_FILE}`, plan_set_id: PLAN_SET,
      execution_host_id: HOST, id: expect.stringMatching(/^[0-9a-f-]{36}$/) })]);
    expect(result.jobId).toBe(call.p_job[0].id);
    expect(runLocalTakeoffAttempts).toHaveBeenCalledWith(expect.objectContaining({ jobId: call.p_job[0].id }));
  });

  // A whole plan whose stored page count is unknown: the sealing counts its pages on its bytes, and its unit gets them.
  it("allots a whole plan the pages its sealing counted, its stored count unknown", async () => {
    const document = await PDFDocument.create();
    for (let page = 0; page < 40; page += 1) document.addPage([20, 20]);
    const { admitted } = dossier({ perPlan: true, bytes: await document.save(), storedPageCount: null });
    const [result] = await evaluateTakeoffLaunchRequests();
    expect(result).toMatchObject({ outcome: "admitted" });
    const call = admitted[0] as { p_manifest: { units: Array<Record<string, unknown>> } };
    expect(call.p_manifest.units).toEqual([expect.objectContaining({ page_count: 40, vector_pages: 40 })]);
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

async function pdfOfPages(count: number) {
  const pdf = await PDFDocument.create();
  for (let page = 0; page < count; page += 1) pdf.addPage([20, 20]);
  return new Uint8Array(await pdf.save());
}
const CCTP = "aaaaaaaa-0000-4000-8000-000000000061";
const DPGF = "aaaaaaaa-0000-4000-8000-000000000062";
type Admission = { p_manifest: TakeoffLaunchManifest; p_snapshot: TakeoffPreparationSnapshot; p_job: { id: string } };

// Written before the shared sealing (lot 2, before the automatic start is activated): the seal only hashed a
// reference's bytes, so the worker refused, after the admission, a reference it could not read, and the affaire's only
// automatic start was spent on it.
describe("the automatic seal of the dossier's pieces", () => {
  it("leaves out, named in its coverage, a CCTP of more than 200 selected pages under 20 MB, and starts on the plans", async () => {
    const cctp = await pdfOfPages(201);
    expect(cctp.byteLength).toBeLessThan(20 * 1024 * 1024);
    const { admitted } = dossier({ references: [{ id: CCTP, name: "CCTP lot plomberie.pdf", kind: "cctp", mime: "application/pdf", bytes: cctp }] });
    const [result] = await evaluateTakeoffLaunchRequests();
    expect(result).toMatchObject({ outcome: "admitted" });
    const call = admitted[0] as Admission;
    expect(call.p_manifest.references).toEqual([]);
    expect(call.p_manifest.coverage.references_omitted).toEqual([{ id: CCTP, name: "CCTP lot plomberie.pdf", reason: "limit" }]);
    expect(call.p_snapshot.preparation.sources.find((source) => source.document_id === CCTP)).toMatchObject({ active: false });
  });

  it.each([
    ["a corrupt PDF", { id: CCTP, name: "CCTP abîmé.pdf", kind: "cctp", mime: "application/pdf", bytes: new TextEncoder().encode("%PDF-1.4 fichier tronqué") }],
    ["an invalid workbook", { id: DPGF, name: "DPGF.xlsx", kind: "dpgf", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes: new TextEncoder().encode("ceci n'est pas un classeur") }],
  ] as const)("leaves out %s the worker could not read, named as invalid, and starts on the plans", async (_case, reference) => {
    const { admitted } = dossier({ references: [reference] });
    const [result] = await evaluateTakeoffLaunchRequests();
    expect(result).toMatchObject({ outcome: "admitted" });
    const call = admitted[0] as Admission;
    expect(call.p_manifest.references).toEqual([]);
    expect(call.p_manifest.coverage.references_omitted).toEqual([{ id: reference.id, name: reference.name, reason: "invalid" }]);
  });

  // A piece's row belongs to the affaire; its Storage object must be the one the dossier wrote for it in that affaire.
  it("never reads, with the server's own client, a reference whose Storage key is another affaire's object", async () => {
    const foreign = `${TENANT}/aaaaaaaa-0000-4000-8000-000000000099/${UPLOAD}/${CCTP}/cctp.txt`;
    const { admitted, fake } = dossier({ references: [{ id: CCTP, name: "CCTP.txt", kind: "cctp", mime: "text/plain",
      bytes: new TextEncoder().encode("CCTP d'une autre affaire"), storedAt: foreign }] });
    const [result] = await evaluateTakeoffLaunchRequests();
    expect(result).toMatchObject({ outcome: "admitted" });
    const call = admitted[0] as Admission;
    expect(call.p_manifest.references).toEqual([]);
    expect(call.p_manifest.coverage.references_omitted).toEqual([{ id: CCTP, name: "CCTP.txt", reason: "outside_affaire" }]);
    expect(fake.storageCalls.filter((entry) => entry.paths[0] === foreign)).toEqual([]);
  });

  it("keeps a usable reference after one whose stored file is missing, its size never reserved", async () => {
    const big = 19 * 1024 * 1024;
    const DPGF_TEXT = "aaaaaaaa-0000-4000-8000-000000000065";
    const { admitted } = dossier({ references: [
      { id: CCTP, name: "CCTP absent.pdf", kind: "cctp", mime: "application/pdf", bytes: new Uint8Array(1), recordedSize: big, missing: true },
      { id: DPGF_TEXT, name: "DPGF.txt", kind: "dpgf", mime: "text/plain", bytes: new TextEncoder().encode("x".repeat(2 * 1024 * 1024)) },
    ] });
    await evaluateTakeoffLaunchRequests();
    const call = admitted[0] as Admission;
    expect(call.p_manifest.references.map((reference) => reference.document_id)).toEqual([DPGF_TEXT]);
    expect(call.p_manifest.coverage.references_omitted).toEqual([{ id: CCTP, name: "CCTP absent.pdf", reason: "unreadable" }]);
  });

  it("keeps the references the worker reads: a CCTP of 200 pages and a DPGF in text", async () => {
    const { admitted } = dossier({ references: [
      { id: CCTP, name: "CCTP lot plomberie.pdf", kind: "cctp", mime: "application/pdf", bytes: await pdfOfPages(200) },
      { id: DPGF, name: "DPGF.csv", kind: "dpgf", mime: "text/csv", bytes: new TextEncoder().encode("Désignation;Quantité\nTube cuivre;12\n") },
    ] });
    await evaluateTakeoffLaunchRequests();
    const call = admitted[0] as Admission;
    expect(call.p_manifest.references.map((reference) => reference.document_id)).toEqual([CCTP, DPGF]);
    expect(call.p_manifest.coverage.references_omitted).toEqual([]);
  });

  // The worker reads a plan without its title block: a page the renderer cannot draw leaves the index unread, as a
  // member's confirmation seals it.
  it("admits a plan whose title block cannot be rendered, its index left to the dossier", async () => {
    const { admitted } = dossier();
    vi.mocked(renderPdfPages).mockRejectedValueOnce(new Error("rendu impossible"));
    const [result] = await evaluateTakeoffLaunchRequests();
    expect(result).toMatchObject({ outcome: "admitted" });
    expect((admitted[0] as Admission).p_snapshot.preparation.sources.find((source) => source.document_id === PLAN_FILE))
      .toMatchObject({ plan_identity: null, active: true });
  });

  // The worker opens every plan with pdf-lib and fails a plan it cannot open.
  it("stops, naming it, on a dossier plan the worker could not open, and spends nothing", async () => {
    const { admitted, recorded, fake } = dossier();
    const corrupt = new TextEncoder().encode("%PDF-1.4 plan tronque");
    const plans = fake.client.storage.from(PLAN_FILES_BUCKET);
    vi.spyOn(plans, "info").mockResolvedValue({ data: { size: corrupt.byteLength }, error: null } as never);
    vi.spyOn(plans, "download").mockResolvedValue({ data: new Blob([corrupt]), error: null } as never);
    vi.mocked(fake.client.storage.from).mockReturnValue(plans as never);
    const [result] = await evaluateTakeoffLaunchRequests();
    expect(result).toMatchObject({ outcome: "blocked", reason: "PLAN_COPY_MISSING" });
    expect(recorded).toEqual([expect.objectContaining({ p_state: "blocked", p_reason: "PLAN_COPY_MISSING",
      p_details: { pieces: [{ id: PLAN_FILE, name: "Plan RDC.pdf" }] } })]);
    expect(admitted).toEqual([]);
    expect(runLocalTakeoffAttempts).not.toHaveBeenCalled();
  });

  // A version the members' revision choice set aside is never opened by the worker.
  it("starts on the retained version when the version set aside could not be opened", async () => {
    const { admitted, fake } = dossier();
    const BROKEN = "aaaaaaaa-0000-4000-8000-000000000051";
    const brokenPath = `${TENANT}/${PLAN_SET}/${BROKEN}/distribution-rev-b.pdf`;
    const corrupt = new TextEncoder().encode("%PDF-1.4 plan tronque");
    const retained = takeoffPreparationSourceSchema.parse({ document_id: PLAN_FILE, document_name: "Distribution rev A.pdf", kind: "plan",
      revision: "A", source_version: "fixture-version", pages: [], active: true, confirmed: false, plan_set_id: PLAN_SET,
      file_path: FILE_PATH, page_count: 1, source_updated_at: "2026-11-21T08:00:00Z", mime_type: "application/pdf" });
    const setAside = { ...retained, document_id: BROKEN, document_name: "Distribution rev B.pdf", revision: "B", file_path: brokenPath,
      source_version: "fixture-version-b" };
    const draft = buildDeducedTakeoffPreparation({ sources: [retained, setAside], planSetId: PLAN_SET });
    draft.plan_revision_decisions = [{ left: { document_id: PLAN_FILE, content_hash: createHash("sha256").update(BYTES).digest("hex") },
      right: { document_id: BROKEN, content_hash: createHash("sha256").update(corrupt).digest("hex") }, choice: "left" }];
    vi.mocked(loadPreparation).mockResolvedValue({ draft, revision: 3, availableSources: [retained, setAside] } as never);
    const bytesOf = (path: string) => (path === brokenPath ? corrupt : BYTES);
    const plans = fake.client.storage.from(PLAN_FILES_BUCKET);
    vi.spyOn(plans, "info").mockImplementation(async (path: string) => ({ data: { size: bytesOf(path).byteLength }, error: null }) as never);
    vi.spyOn(plans, "download").mockImplementation(async (path: string) => ({ data: new Blob([Uint8Array.from(bytesOf(path))]), error: null }) as never);
    vi.mocked(fake.client.storage.from).mockReturnValue(plans as never);
    const [result] = await evaluateTakeoffLaunchRequests();
    expect(result).toMatchObject({ outcome: "admitted" });
    const call = admitted[0] as Admission;
    expect(call.p_manifest.plans.map((plan) => plan.plan_file_id)).toEqual([PLAN_FILE]);
    expect(call.p_manifest.coverage.plans_omitted).toEqual([{ id: BROKEN, name: "Distribution rev B.pdf", reason: "alternate" }]);
  });

  // The worker refuses plans past its page budget, counted on their real pages: a dossier's copy records none.
  it("stops, naming it, on a retained plan whose real pages pass the analysis's budget, and spends nothing", async () => {
    const { admitted, recorded, fake } = dossier();
    const large = await pdfOfPages(201);
    const plans = fake.client.storage.from(PLAN_FILES_BUCKET);
    vi.spyOn(plans, "info").mockResolvedValue({ data: { size: large.byteLength }, error: null } as never);
    vi.spyOn(plans, "download").mockResolvedValue({ data: new Blob([Uint8Array.from(large)]), error: null } as never);
    vi.mocked(fake.client.storage.from).mockReturnValue(plans as never);
    const [result] = await evaluateTakeoffLaunchRequests();
    expect(result).toMatchObject({ outcome: "blocked", reason: "PLAN_SET_TOO_LARGE" });
    const [evaluation] = recorded as Array<{ p_reason: TakeoffLaunchReason; p_details: { pieces: TakeoffLaunchPiece[] } }>;
    expect(evaluation.p_details.pieces).toEqual([{ id: PLAN_FILE, name: "Plan RDC.pdf" }]);
    expect(describeTakeoffLaunchReason(evaluation.p_reason, evaluation.p_details.pieces)).toContain("« Plan RDC.pdf »");
    expect(admitted).toEqual([]);
    expect(runLocalTakeoffAttempts).not.toHaveBeenCalled();
  });

  it("names the plan larger than a plan may be when it stops on it, and never downloads it", async () => {
    const { admitted, recorded, fake } = dossier();
    const plans = fake.client.storage.from(PLAN_FILES_BUCKET);
    vi.spyOn(plans, "info").mockResolvedValue({ data: { size: 50 * 1024 * 1024 + 1 }, error: null } as never);
    const download = vi.spyOn(plans, "download");
    vi.mocked(fake.client.storage.from).mockReturnValue(plans as never);
    await evaluateTakeoffLaunchRequests();
    expect(recorded).toEqual([expect.objectContaining({ p_state: "blocked", p_reason: "PLAN_SET_TOO_LARGE",
      p_details: { pieces: [{ id: PLAN_FILE, name: "Plan RDC.pdf" }] } })]);
    expect(download).not.toHaveBeenCalled();
    expect(admitted).toEqual([]);
  });

  // What the seal keeps, the worker reads: its references loaded from the snapshot the automatic start admitted, within
  // the same bounds (150 + 50 pages attached; a third PDF past 200 pages and an invalid workbook left out).
  it("admits only references the worker then loads from the admitted snapshot", async () => {
    const CCTP_B = "aaaaaaaa-0000-4000-8000-000000000063";
    const CCTP_C = "aaaaaaaa-0000-4000-8000-000000000064";
    const references: DossierReference[] = [
      { id: CCTP, name: "CCTP lot plomberie.pdf", kind: "cctp", mime: "application/pdf", bytes: await pdfOfPages(150) },
      { id: CCTP_B, name: "CCTP lot chauffage.pdf", kind: "cctp", mime: "application/pdf", bytes: await pdfOfPages(50) },
      { id: CCTP_C, name: "CCTP lot ventilation.pdf", kind: "cctp", mime: "application/pdf", bytes: await pdfOfPages(1) },
      { id: DPGF, name: "DPGF.xlsx", kind: "dpgf", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        bytes: new TextEncoder().encode("ceci n'est pas un classeur") },
    ];
    const { admitted } = dossier({ references });
    await evaluateTakeoffLaunchRequests();
    const call = admitted[0] as Admission;
    expect(call.p_manifest.coverage.references_omitted.map(({ id, reason }) => [id, reason]))
      .toEqual([[CCTP_C, "limit"], [DPGF, "invalid"]]);
    const rows = references.map((reference) => ({ id: reference.id, tenant_id: TENANT, project_id: PROJECT, file_name: reference.name,
      upload_id: UPLOAD, storage_path: referenceKey(reference), size_bytes: reference.bytes.byteLength, mime_type: reference.mime,
      document_kind: reference.kind, updated_at: "2026-11-21T08:00:00Z", extracted_metadata: {}, upload_status: "uploaded",
      deleted_at: null, deletion_token: null }));
    const worker = createSupabaseFake({
      tables: { affaire_intake_documents: (query: FakeQuery) => servedRows(rows, query) },
      storage: { [AFFAIRE_INTAKE_BUCKET]: ({ paths }) => {
        const reference = references.find((entry) => referenceKey(entry) === paths[0])!;
        return { data: new Blob([Uint8Array.from(reference.bytes)]), error: null };
      } },
    });
    const loaded = await loadPreparationReferenceFiles({ supabase: worker.client as never, snapshot: call.p_snapshot,
      job: { id: call.p_job.id, tenant_id: TENANT, project_id: PROJECT, estimate_version_id: null } as never });
    expect(loaded.files).toHaveLength(2);
    expect(loaded.sourceHints.map((hint) => hint.match(/"document_id":"([^"]+)"/)?.[1])).toEqual([CCTP, CCTP_B]);
  });

  // The review serves a plan's locations and its original PDF only for a source its preparation attested: the job of an
  // automatic start is reviewed as a confirmed one.
  it("attests the plans it sealed: the review routes serve their locations and original PDF", async () => {
    const { admitted } = dossier();
    await evaluateTakeoffLaunchRequests();
    const call = admitted[0] as Admission;
    expect(call.p_snapshot.preparation.sources.filter((source) => source.active)
      .map(({ document_id, confirmed }) => ({ document_id, confirmed }))).toEqual([{ document_id: PLAN_FILE, confirmed: true }]);

    const jobId = call.p_job.id;
    const member = createSupabaseFake({
      tables: {
        takeoff_jobs: () => ({ data: { plan_set_id: PLAN_SET, preparation_snapshot: call.p_snapshot, estimate_version_id: null }, error: null }),
        plan_files: () => ({ data: { id: PLAN_FILE, plan_set_id: PLAN_SET, file_name: "plan-rdc.pdf", file_path: FILE_PATH,
          file_size_bytes: BYTES.byteLength, page_count: 1, metadata: {} }, error: null }),
        takeoff_plan_locations: () => ({ data: [], error: null, count: 0 }),
      },
      rpc: { read_takeoff_plan_location_source: () => ({ data: [{ source_kind: "intake_document", source_id: DOCUMENT,
        plan_file_id: PLAN_FILE, current_copy: true, can_write: true }], error: null }) },
    });
    const service = createSupabaseFake({ storage: { [PLAN_FILES_BUCKET]: ({ method }) => ({ data: method === "info" ? { size: BYTES.byteLength }
      : new Blob([BYTES]), error: null }) } });
    vi.mocked(createServiceRoleClient).mockReturnValue(service.client as never);
    vi.mocked(getAuthenticatedTakeoffContext).mockResolvedValue({ supabase: member.client, tenantId: TENANT, userId: PAYER,
      tenantRole: "engineer" } as never);
    vi.mocked(getTakeoffJobDetailByIdOrThrow).mockResolvedValue({ id: jobId, project_id: PROJECT } as never);
    vi.mocked(renderPdfPages).mockResolvedValue({ status: "complete", pageCount: 1, missingPages: [],
      pages: [{ page: 1, regionText: "", failed: false }] } as never);

    const locations = await getPlanLocations(new Request(`http://localhost/api/takeoff/jobs/${jobId}/plan-locations`), { params: Promise.resolve({ jobId }) });
    expect(locations.status).toBe(200);
    expect((await locations.json()).data).toMatchObject({ without_preparation: false,
      plans: [{ plan_file_id: PLAN_FILE, status: "current", revision: { content_hash: createHash("sha256").update(BYTES).digest("hex") } }] });
    const original = await getVectorPlan(new Request(`http://localhost/api/takeoff/jobs/${jobId}/vector-plans/${PLAN_FILE}`),
      { params: Promise.resolve({ jobId, fileId: PLAN_FILE }) });
    expect(original.status).toBe(200);
    expect(new Uint8Array(await original.arrayBuffer())).toEqual(BYTES);
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

// The dossier change the affaire's zone shows after an analysis: compared with the plan set the request analysed (a
// relaunch on another set than the dossier's never reads as the dossier's plans added and its own removed), and naming a
// plan only to a member who may read its copy or its dossier piece.
describe("readDossierChangeSinceAnalysis", () => {
  const SET_B = "aaaaaaaa-0000-4000-8000-000000000041";
  const PLAN_B = "aaaaaaaa-0000-4000-8000-000000000051";
  const PLAN_C = "aaaaaaaa-0000-4000-8000-000000000052";
  const document = { id: DOCUMENT, upload_id: null, storage_path: `${TENANT}/dossier/plan-rdc.pdf`, plan_copy_generation: "generation-3",
    file_name: "Plan RDC.pdf", mime_type: "application/pdf", size_bytes: 10, upload_status: "uploaded", classification_status: "classified",
    document_kind: "plans", document_priority: "primary", classified_at: "2026-11-21T09:00:00Z", source_provider: null, deleted_at: null };
  const dossierCopy = { id: PLAN_FILE, plan_set_id: PLAN_SET, file_path: FILE_PATH, file_name: "plan-rdc.pdf", file_size_bytes: 10,
    metadata: { source: "affaire-intake", intake_document_id: DOCUMENT, intake_storage_path: document.storage_path, intake_generation: "generation-2" } };
  const planB = { id: PLAN_B, plan_set_id: SET_B, file_path: `${TENANT}/${SET_B}/${PLAN_B}/plan-b.pdf`, file_name: "Plan B.pdf",
    file_size_bytes: 10, metadata: {} };
  const planC = { ...planB, id: PLAN_C, file_path: `${TENANT}/${SET_B}/${PLAN_C}/plan-c.pdf`, file_name: "Plan C.pdf" };
  const sealedPlan = (plan: typeof planB | typeof dossierCopy, intake: { id: string; generation: string } | null) => ({
    entry_key: plan.id, name: plan.file_name, logical_id: intake?.id ?? plan.id, intake_document_id: intake?.id ?? null,
    plan_file_id: plan.id, generation: intake?.generation ?? null, content_sha256: "c".repeat(64), pages: [], page_count: 1 });

  function read(input: { analysed: "dossier" | "b"; files: Array<typeof planB | typeof dossierCopy>; owner?: boolean; readable?: readonly string[];
    /** The request's analysis no longer exists (its draft was deleted). */
    jobGone?: boolean }) {
    const manifest = { format_version: 1, intent: "reread_plans", units: [{ key: "grouped", plans: [] }], references: [],
      plans: input.analysed === "b" ? [sealedPlan(planB, null)] : [sealedPlan(dossierCopy, { id: DOCUMENT, generation: "generation-2" })],
      coverage: { plans_retained: 1, plans_omitted: [], references_omitted: [] } };
    const service = createSupabaseFake({ tables: {
      // The preparation the request sealed names the plan set of each source it read.
      takeoff_launch_requests: () => ({ data: { manifest, preparation_snapshot: { preparation: { sources: [
        { document_id: manifest.plans[0]!.plan_file_id, kind: "plan", active: true, plan_set_id: input.analysed === "b" ? SET_B : PLAN_SET },
      ] } } }, error: null }),
      takeoff_jobs: (query: FakeQuery) => ({ data: filterValue(query, "launch_request_id") === REQUEST && !input.jobGone
        ? { plan_set_id: input.analysed === "b" ? SET_B : PLAN_SET } : null, error: null }),
      plan_sets: () => ({ data: [
        { id: PLAN_SET, estimate_version_id: null, name: "Plans import", metadata: AFFAIRE_INTAKE_PLAN_SET_METADATA,
          updated_at: "2026-11-21T08:00:00Z", plan_files: [{ count: 1 }] },
        { id: SET_B, estimate_version_id: null, name: "Plans B", metadata: {}, updated_at: "2026-11-21T08:30:00Z", plan_files: [{ count: 1 }] },
      ], error: null, count: 2 }),
      plan_files: (query: FakeQuery) => {
        const rows = input.files.filter((file) => file.plan_set_id === filterValue(query, "plan_set_id"));
        return { data: rows, error: null, count: rows.length };
      },
      affaire_intake_documents: () => ({ data: [document], error: null, count: 1 }),
    } });
    vi.mocked(createServiceRoleClient).mockReturnValue(service.client as never);
    // The member's own session: their policies say which plan files and dossier pieces they read.
    const readable = new Set(input.readable ?? []);
    const rows = (query: FakeQuery) => ({ data: ((filterValue(query, "id") as string[] | undefined) ?? [])
      .filter((id) => readable.has(id)).map((id) => ({ id })), error: null });
    const session = createSupabaseFake({
      tables: { plan_files: rows, affaire_intake_documents: rows },
      rpc: { can_access_takeoff_project: () => ({ data: input.owner ?? false, error: null }) },
    });
    return readDossierChangeSinceAnalysis({ supabase: session.client as never, tenantId: TENANT }, PROJECT, REQUEST);
  }

  it("reports no change right after a relaunch on another plan set than the dossier's", async () => {
    await expect(read({ analysed: "b", files: [dossierCopy, planB], owner: true })).resolves.toBeNull();
  });

  it("compares the plan set the request sealed once its analysis is gone", async () => {
    await expect(read({ analysed: "b", files: [dossierCopy, planB], owner: true, jobGone: true })).resolves.toBeNull();
  });

  it("reports a plan added to the analysed set since, and nothing of the dossier's own set", async () => {
    await expect(read({ analysed: "b", files: [dossierCopy, planB, planC], owner: true })).resolves.toEqual({
      added: [{ id: PLAN_C, name: "Plan C.pdf" }], replaced: [], removed: [] });
  });

  // Neither the name nor the identifier of a source the member may not read: an opaque « hidden » key and « Plan N ».
  it.each([
    ["the affaire's owner or an administrator", { owner: true }, { id: DOCUMENT, name: "Plan RDC.pdf" }],
    ["a member who reads the dossier piece", { readable: [DOCUMENT] }, { id: DOCUMENT, name: "Plan RDC.pdf" }],
    ["a member who reads neither the piece nor its copy", { readable: [] }, { id: "hidden:replaced:1", name: "Plan 1" }],
  ] as const)("names the dossier's replaced piece to %s", async (_case, rights, piece) => {
    await expect(read({ analysed: "dossier", files: [dossierCopy], ...rights })).resolves.toEqual({
      added: [], replaced: [piece], removed: [] });
  });

  it("names a removed plan only to a member who may read its copy", async () => {
    await expect(read({ analysed: "b", files: [dossierCopy], readable: [] })).resolves.toEqual({
      added: [], replaced: [], removed: [{ id: "hidden:removed:1", name: "Plan 1" }] });
  });
});

// The gestures: the brief's confirmation records who pays, on this Mac, or why nobody does; a take-over and a relaunch.
const NOTICE = "a".repeat(64);
function gesture(input: { launchActive?: boolean; reply?: Record<string, unknown>; outcome?: string; replayed?: Record<string, unknown>;
  mayPay?: boolean; action?: string; perPlan?: boolean } = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const record = (fn: string, data: unknown) => (args: unknown) => { calls.push({ fn, args: args as Record<string, unknown> }); return { data, error: null }; };
  const row = { request_id: REQUEST, state: "evaluating", reason_code: null, payer_id: PAYER, ...input.reply };
  const fake = createSupabaseFake({ rpc: {
    takeoff_launch_is_active: () => ({ data: input.launchActive !== false, error: null }),
    takeoff_item_list_order_is_active: () => ({ data: false, error: null }),
    // The one payer rule (the database's): the member of `member()` may pay unless a reader.
    takeoff_payer_may_launch: (args) => ({ data: (args as { p_user_id: string }).p_user_id === PAYER && input.mayPay !== false, error: null }),
    takeoff_launch_request_action: () => ({ data: input.action ?? "none", error: null }),
    confirm_affaire_brief_takeoff: record("confirm", [{ outcome: input.outcome ?? "confirmed", ...row }]),
    take_on_takeoff_launch_request: record("take_on", [{ outcome: input.outcome ?? "mandated", mandate_revision: 2, ...row }]),
    takeoff_payer_notice: record("notice", NOTICE),
    replay_manual_takeoff_request: record("replay", input.replayed ? [input.replayed] : []),
    replay_manual_takeoff_plan_request: record("replay_plans", input.replayed ? [input.replayed] : []),
    takeoff_plan_dispatch_is_active: () => ({ data: input.perPlan === true, error: null }),
    claim_takeoff_launch_evaluations: () => ({ data: [], error: null }),
  }, tables: {
    // The analysis a command replaces: a plan's unit of one analysis per plan, whose copy is still in the plan set.
    takeoff_jobs: () => ({ data: { launch_unit_key: `plan:${PLAN_FILE}`, preparation_snapshot: null, launch_request_id: null },
      error: null }),
    plan_files: () => ({ data: [{ id: PLAN_FILE, metadata: {} }], error: null, count: 1 }),
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

  // The receipt is read first, whatever the activation: the database answers it under either identity a command naming no
  // plan can have had (all the plans of the preparation, or those of the analysis it replaces, derived here: not named, so
  // that a retry naming plans under the same key is another command).
  it("answers a replayed click with its recorded answer before reading the preparation", async () => {
    const { calls } = gesture({ replayed: { outcome: "already_running", request_id: REQUEST, job_id: "aaaaaaaa-0000-4000-8000-0000000000cc" } });
    expect(await relaunch()).toEqual({ outcome: "already_running", requestId: REQUEST, jobId: "aaaaaaaa-0000-4000-8000-0000000000cc" });
    expect(calls("replay_plans")).toEqual([expect.objectContaining({ p_intent_key: "aaaaaaaa-0000-4000-8000-0000000000aa",
      p_predecessor_job_id: "aaaaaaaa-0000-4000-8000-0000000000bb", p_plan_set_id: PLAN_SET, p_preparation_revision: 2,
      p_plan_file_ids: [PLAN_FILE], p_plans_named: false })]);
    expect(assertConfirmedTakeoffPreparation).not.toHaveBeenCalled();
  });

  // A lost answer replays whatever the activation: a command naming its plans, repeated after one analysis per plan was
  // withdrawn, gets its receipt, not a refusal for naming plans.
  it("answers a command naming its plans, repeated after a withdrawal, by its receipt", async () => {
    const { calls } = gesture({ perPlan: false, replayed: { outcome: "replayed", request_id: REQUEST, job_id: "aaaaaaaa-0000-4000-8000-0000000000cc" } });
    await expect(launchTakeoffRelaunch({ context: member("engineer"), projectId: PROJECT, planSetId: PLAN_SET, preparationRevision: 2,
      intentKey: "aaaaaaaa-0000-4000-8000-0000000000ab", planFileIds: [PLAN_FILE], predecessorJobId: "aaaaaaaa-0000-4000-8000-0000000000bb" }))
      .resolves.toEqual({ outcome: "replayed", requestId: REQUEST, jobId: "aaaaaaaa-0000-4000-8000-0000000000cc" });
    expect(calls("replay_plans")).toEqual([expect.objectContaining({ p_plan_file_ids: [PLAN_FILE], p_plans_named: true })]);
    expect(assertConfirmedTakeoffPreparation).not.toHaveBeenCalled();
  });

  // Lot 3: once one analysis per plan is active, a relaunch reads by default only the plan of the analysis it replaces,
  // and its identity names that plan; its replay is still answered before any preparation is read.
  it("answers a replayed relaunch of one plan by the plans it reads, before reading the preparation", async () => {
    const { calls } = gesture({ perPlan: true, replayed: { outcome: "replayed", request_id: REQUEST, job_id: "aaaaaaaa-0000-4000-8000-0000000000cc" } });
    expect(await relaunch()).toEqual({ outcome: "replayed", requestId: REQUEST, jobId: "aaaaaaaa-0000-4000-8000-0000000000cc" });
    expect(calls("replay_plans")).toEqual([expect.objectContaining({ p_intent: "reread_plans", p_plan_file_ids: [PLAN_FILE],
      p_predecessor_job_id: "aaaaaaaa-0000-4000-8000-0000000000bb" })]);
    expect(calls("replay")).toEqual([]);
    expect(assertConfirmedTakeoffPreparation).not.toHaveBeenCalled();
  });

  it("refuses an address that cannot use the subscription before the command is recorded or admitted", async () => {
    const { calls } = gesture();
    vi.mocked(assertLocalChatGptHost).mockImplementationOnce(() => { throw new Error("refused"); });
    await expect(launchTakeoffRelaunch({ context: member("engineer"), projectId: PROJECT, planSetId: PLAN_SET, preparationRevision: 2,
      intentKey: "aaaaaaaa-0000-4000-8000-0000000000aa", predecessorJobId: null, host: "autre-poste.example:3000" }))
      .rejects.toMatchObject({ status: 422, message: expect.stringContaining("cette adresse ne peut pas utiliser le forfait ChatGPT") });
    expect(calls("replay")).toEqual([]);
    expect(calls("replay_plans")).toEqual([]);
    expect(assertConfirmedTakeoffPreparation).not.toHaveBeenCalled();
  });

  // A plan added after the analysis is read by a command that names it and the analysis it extends: never a first analysis
  // (« initial ») on an affaire that has one.
  it("reads a plan added after the analysis by a command that names it and the analysis it extends", async () => {
    const { calls } = gesture({ perPlan: true, replayed: { outcome: "replayed", request_id: REQUEST, job_id: null } });
    await launchTakeoffRelaunch({ context: member("engineer"), projectId: PROJECT, planSetId: PLAN_SET, preparationRevision: 2,
      intentKey: "aaaaaaaa-0000-4000-8000-0000000000ab", planFileIds: [PLAN_FILE.toUpperCase()],
      predecessorJobId: "aaaaaaaa-0000-4000-8000-0000000000bb" });
    expect(calls("replay_plans")).toEqual([expect.objectContaining({ p_intent: "reread_plans",
      p_predecessor_job_id: "aaaaaaaa-0000-4000-8000-0000000000bb", p_plan_file_ids: [PLAN_FILE], p_plans_named: true })]);
  });


  // Lot 3: the dossier's limits are checked on every plan a command reads before its units are admitted (two plans of 150
  // pages each pass one at a time under 200 pages, not together), and the plans it sets aside are recorded as such.
  const PLAN_B = "aaaaaaaa-0000-4000-8000-000000000051";
  const PLAN_C = "aaaaaaaa-0000-4000-8000-000000000052";
  const PLAN_B_COPY = "aaaaaaaa-0000-4000-8000-000000000053";
  /**
   * The member's confirmed preparation of plans A, B and C, with B's former revision set aside, and the affaire's previous
   * analysis, which read `previousRead`.
   */
  /**
   * `previous`: the affaire's latest analysis, its plans and those of its units read (succeeded); grouped (lot 2) or one
   * unit per plan.
   */
  function planCommand(pages: { a: number | null; b: number }, previous: { format: 1 | 2; plans: string[]; read: string[] } | null = null,
    bytes?: Uint8Array, predecessorJobId: string | null = "aaaaaaaa-0000-4000-8000-0000000000bb",
    refusal: { code: string; message: string } | null = null) {
    const launched: Array<Record<string, unknown>> = [];
    const launchedAll: Array<Record<string, unknown>> = [];
    const planRow = (id: string, name: string, pageCount: number | null) => ({ id, tenant_id: TENANT, plan_set_id: PLAN_SET,
      file_path: `${TENANT}/${PLAN_SET}/${id}/${name}`, file_name: name, file_type: "application/pdf", file_size_bytes: 8,
      page_count: pageCount, metadata: {}, created_at: "2026-11-21T08:00:00Z" });
    const rows = [planRow(PLAN_FILE, "plan-a.pdf", pages.a), planRow(PLAN_B, "plan-b.pdf", pages.b), planRow(PLAN_C, "plan-c.pdf", 2),
      planRow(PLAN_B_COPY, "plan-b-ancien.pdf", 2)];
    const previousRow = previous ? { id: "aaaaaaaa-0000-4000-8000-0000000000e1", manifest: { format_version: previous.format,
      coverage: { plans_omitted: [] }, plans: previous.plans.map((id) => ({ plan_file_id: id, name: rows.find((row) => row.id === id)!.file_name,
        intake_document_id: null, generation: null })) } } : null;
    const previousUnits = previous ? { request_id: previousRow!.id, format: previous.format === 2 ? "per_plan" : "grouped",
      units: previous.format === 2
        ? previous.plans.map((id, index) => ({ key: `plan:${id}`, ordinal: index + 1, state: previous.read.includes(id) ? "succeeded" : "canceled" }))
        : [{ key: "grouped", ordinal: 1, state: previous.read.length ? "succeeded" : "failed" }] } : null;
    const fake = createSupabaseFake({
      tables: { plan_files: (query: FakeQuery) => servedRows(rows, query),
        // The affaire's analysed requests, from the latest: its previous one, if any.
        takeoff_launch_requests: (query: FakeQuery) => ({ data: query.cardinality === "many" ? (previousRow ? [previousRow] : [])
          : previousRow, error: null }),
        // The affaire's analyses: those of its previous request, if any.
        takeoff_jobs: () => ({ data: previous ? { id: "aaaaaaaa-0000-4000-8000-0000000000bb" } : null, error: null }) },
      storage: { [PLAN_FILES_BUCKET]: () => (bytes ? { data: new Blob([Uint8Array.from(bytes)]), error: null }
        : { data: null, error: { message: "Object not found", statusCode: "404" } }) },
      rpc: {
        replay_manual_takeoff_plan_request: () => ({ data: [], error: null }),
        takeoff_plan_dispatch_is_active: () => ({ data: true, error: null }),
        // Lot 4: the second measuring order is not activated: the free extraction.
        takeoff_item_list_order_is_active: () => ({ data: false, error: null }),
        read_takeoff_launch_request_units: () => ({ data: previousUnits, error: null }),
        launch_manual_takeoff_plan_request: (args) => {
          launched.push(args as Record<string, unknown>);
          if (refusal) return { data: null, error: refusal };
          return { data: [{ outcome: "admitted", request_id: REQUEST, job_id: (args as { p_jobs: Array<{ id: string }> }).p_jobs[0].id }], error: null };
        },
        // A first analysis of every plan of the preparation: M4's entry point, the request's units as its jobs.
        launch_manual_takeoff_request: (args) => {
          launchedAll.push(args as Record<string, unknown>);
          if (refusal) return { data: null, error: refusal };
          return { data: [{ outcome: "admitted", request_id: REQUEST, job_id: (args as { p_job: Array<{ id: string }> }).p_job[0].id }], error: null };
        },
      },
    });
    vi.mocked(createServiceRoleClient).mockReturnValue(fake.client as never);
    const sources = rows.map((row) => takeoffPreparationSourceSchema.parse({ document_id: row.id, document_name: row.file_name,
      kind: "plan", revision: null, source_version: "fixture-version", pages: [], active: row.id !== PLAN_B_COPY, confirmed: true,
      plan_set_id: PLAN_SET, file_path: row.file_path, page_count: row.page_count, source_updated_at: "2026-11-21T08:00:00Z",
      mime_type: "application/pdf", content_hash: createHash("sha256").update(row.id).digest("hex") }));
    const preparation = buildDeducedTakeoffPreparation({ sources: sources.filter((source) => source.active), planSetId: PLAN_SET });
    preparation.sources.push({ ...sources.find((source) => source.document_id === PLAN_B_COPY)!, alternate_of: PLAN_B });
    vi.mocked(assertConfirmedTakeoffPreparation).mockResolvedValue(createTakeoffPreparationSnapshot({ preparation, confirmedBy: PAYER,
      confirmedAt: "2026-11-21T08:00:00Z", revision: 2, executionSelection: SELECTION }) as never);
    vi.mocked(getConfirmedTakeoffExecutionOwner).mockResolvedValue({ execution_host_id: HOST } as never);
    const context = { userId: PAYER, tenantId: TENANT, tenantRole: "engineer", supabase: fake.client } as never;
    const run = (planFileIds: string[]) => launchTakeoffRelaunch({ context, projectId: PROJECT, planSetId: PLAN_SET,
      preparationRevision: 2, intentKey: "aaaaaaaa-0000-4000-8000-0000000000ad", planFileIds, predecessorJobId });
    // The affaire zone's dialogue (LaunchMetreDialog, relaunchTakeoffAction): its key, its preparation and the analysis it
    // replaces, never any plan.
    const runFromDialogue = () => launchTakeoffRelaunch({ context, projectId: PROJECT, planSetId: PLAN_SET, preparationRevision: 2,
      intentKey: "aaaaaaaa-0000-4000-8000-0000000000af", predecessorJobId });
    return { run, runFromDialogue, launched, launchedAll, rows };
  }

  // The first analysis of a confirmed dossier, launched from the affaire's zone once one analysis per plan is active: the
  // dialogue names no plan, so every plan its preparation retains is read, each as its own unit.
  it("starts a first analysis from the dialogue's payload with every plan the preparation retains", async () => {
    const { runFromDialogue, launchedAll, launched } = planCommand({ a: 3, b: 3 }, null, undefined, null);
    await expect(runFromDialogue()).resolves.toMatchObject({ outcome: "admitted", requestId: REQUEST });
    expect(launched).toEqual([]);
    expect(launchedAll).toHaveLength(1);
    expect(launchedAll[0]).toMatchObject({ p_intent: "initial", p_predecessor_job_id: null });
    const manifest = launchedAll[0].p_manifest as AnyTakeoffLaunchManifest;
    expect(manifest.format_version).toBe(2);
    expect(manifest.plans.map((plan) => plan.plan_file_id).sort()).toEqual([PLAN_FILE, PLAN_B, PLAN_C].sort());
    expect((launchedAll[0].p_job as Array<{ launch_unit_key: string }>).map((job) => job.launch_unit_key))
      .toEqual(manifest.units.map((unit) => unit.key));
  });

  // The database decides the order of its refusals (20261121193413): an automatic start that can still begin comes before
  // the affaire's existing analysis; the server never answers first.
  it("answers the database's refusal of a first analysis, in the database's order", async () => {
    const pending = planCommand({ a: 3, b: 3 }, { format: 2, plans: [PLAN_FILE], read: [PLAN_FILE] }, undefined, null,
      { code: "55000", message: "TAKEOFF_LAUNCH_AUTOMATIC_PENDING" });
    await expect(pending.run([PLAN_FILE])).rejects.toMatchObject({ status: 409,
      message: "Le métré automatique de l’affaire peut encore démarrer : prenez-le en charge depuis l’état du métré de l’affaire." });
    expect(pending.launched).toHaveLength(1);
    const exists = planCommand({ a: 3, b: 3 }, { format: 2, plans: [PLAN_FILE], read: [PLAN_FILE] }, undefined, null,
      { code: "22023", message: "TAKEOFF_LAUNCH_ANALYSIS_EXISTS" });
    await expect(exists.run([PLAN_FILE])).rejects.toMatchObject({ status: 409,
      message: "L’affaire a déjà une analyse : rechargez l’affaire pour relancer celle qu’elle montre." });
  });

  // A plan whose stored count is unknown and whose bytes cannot be read is refused by name, as the automatic seal refuses
  // it: weighed as one page, a whole PDF would take a share it cannot read with.
  it("refuses a command whose plan of unknown count cannot be read, naming the plan", async () => {
    const { run, launched } = planCommand({ a: null, b: 3 });
    await expect(run([PLAN_FILE])).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("« plan-a.pdf »") });
    expect(launched).toEqual([]);
  });

  // A plan the earlier analysis never read (its unit cancelled before its reading) is not set aside as read.
  it("sets aside only the plans whose unit an earlier analysis actually read", async () => {
    const { run, launched, rows } = planCommand({ a: 3, b: 3 }, { format: 2, plans: [PLAN_FILE, PLAN_B], read: [PLAN_FILE] });
    expect(await run([PLAN_C])).toMatchObject({ outcome: "admitted" });
    const manifest = launched[0].p_manifest as AnyTakeoffLaunchManifest;
    expect(manifest.coverage.plans_omitted).toEqual([{ id: PLAN_B_COPY, name: "plan-b-ancien.pdf", reason: "alternate" },
      expect.objectContaining({ id: PLAN_FILE, reason: "not_requested" })]);
    expect(describeDossierChangeSinceAnalysis(manifest, rows, [])?.added).toEqual([{ id: PLAN_B, name: "plan-b.pdf" }]);
  });

  // Counterexample: an affaire without any analysis may start its first one by a command (« initial »).
  // A command of one analysis per plan seals the measuring order as a grouped one does (lot 4, #447): the affaire's list of
  // items once the second order is active, or a refusal while that list is to prepare; the free extraction before it.
  it("seals the list of items in a command of plans once the second order is active, and refuses it while the list is to prepare", async () => {
    const list = { kind: "item_list" as const, version: 2 as const, list: { revision_id: "aaaaaaaa-0000-4000-8000-0000000000f1",
      revision: 3, content_sha256: "e".repeat(64), item_count: 12 } };
    vi.mocked(sealedMeasuringOrder).mockResolvedValueOnce({ order: list });
    const sealed = planCommand({ a: 3, b: 3 });
    await expect(sealed.run([PLAN_FILE])).resolves.toMatchObject({ outcome: "admitted" });
    expect(sealed.launched[0].p_manifest).toMatchObject({ format_version: 2, order: list });
    vi.mocked(sealedMeasuringOrder).mockResolvedValueOnce({ blocked: "ITEM_LIST_TO_PREPARE" });
    const blocked = planCommand({ a: 3, b: 3 });
    await expect(blocked.run([PLAN_FILE])).rejects.toMatchObject({ status: 409,
      message: "La liste des postes est à préparer : importez ou choisissez la DPGF de l’affaire, puis relancez." });
    expect(blocked.launched).toEqual([]);
  });

  it("lets a command start the first analysis of an affaire that has none", async () => {
    const { run, launched } = planCommand({ a: 3, b: 3 }, null, undefined, null);
    expect(await run([PLAN_FILE])).toMatchObject({ outcome: "admitted" });
    expect(launched[0]).toMatchObject({ p_intent: "initial", p_predecessor_job_id: null });
  });

  it("weighs a plan of unknown count by the pages counted on its bytes", async () => {
    const document = await PDFDocument.create();
    for (let page = 0; page < 12; page += 1) document.addPage([20, 20]);
    const { run, launched } = planCommand({ a: null, b: 3 }, null, await document.save());
    expect(await run([PLAN_FILE])).toMatchObject({ outcome: "admitted" });
    expect((launched[0].p_manifest as { units: Array<Record<string, unknown>> }).units)
      .toEqual([expect.objectContaining({ page_count: 12, vector_pages: 12 })]);
  });

  it("refuses a command whose plans together exceed the plan set's limits, before any unit is admitted", async () => {
    const { run, launched } = planCommand({ a: 150, b: 150 });
    await expect(run([PLAN_FILE, PLAN_B])).rejects.toMatchObject({ code: "TAKEOFF_FILE_TOO_LARGE" });
    expect(launched).toEqual([]);
  });

  // The plans the affaire's previous analysis read, and the plan set's copies set aside, are recorded as such: the
  // dossier does not show them as added since. A plan never read still is.
  it("records the plans a command sets aside, so that the dossier shows only the plans never read as added", async () => {
    const { run, launched, rows } = planCommand({ a: 3, b: 3 }, { format: 1, plans: [PLAN_FILE, PLAN_B], read: [PLAN_FILE, PLAN_B] });
    expect(await run([PLAN_FILE])).toMatchObject({ outcome: "admitted" });
    const manifest = launched[0].p_manifest as AnyTakeoffLaunchManifest;
    expect(manifest.coverage.plans_omitted).toEqual([{ id: PLAN_B_COPY, name: "plan-b-ancien.pdf", reason: "alternate" },
      expect.objectContaining({ id: PLAN_B, reason: "not_requested" })]);
    expect(describeDossierChangeSinceAnalysis(manifest, rows, [])).toEqual({ added: [{ id: PLAN_C, name: "plan-c.pdf" }],
      replaced: [], removed: [] });
    // Counterexample: the plan set aside leaves the dossier afterwards, which is still a change of the dossier.
    expect(describeDossierChangeSinceAnalysis(manifest, rows.filter((row) => row.id !== PLAN_B), [])).toEqual({
      added: [{ id: PLAN_C, name: "plan-c.pdf" }], replaced: [], removed: [{ id: PLAN_B, name: "plan-b.pdf" }] });
  });

  // An affaire's analyses over time, once one analysis per plan is active. `copies`: the plan set's working copies now,
  // each of a dossier piece at its generation (or uploaded to the set: no piece); `requests`: its earlier requests, newest
  // first, each with the plans it sealed (their copy, piece and generation), the state of each plan's unit (read unless
  // named) and the plans it set aside as read before it; the member's confirmed preparation reads `confirmed`.
  type Copy = { id: string; name: string; document: string | null; generation: string | null };
  function affaireHistory(input: {
    copies: Copy[]; confirmed: string[];
    requests: Array<{ id: string; plans: Copy[]; states?: Record<string, string>; notRequested?: Copy[] }>;
    /**
     * The analysis a command replaces: one plan's unit of one of the requests, or an analysis launched outside any request
     * (`requestId` null, no unit) whose snapshot read `snapshotPlans`.
     */
    predecessor: { id: string; requestId: string | null; unitKey: string | null; snapshotPlans?: Copy[] };
    /** The receipts the database holds: by the plans a command's identity names (none by default). */
    receipt?: (planFileIds: string[] | null) => { data: unknown; error: { code: string; message: string } | null };
  }) {
    const launched: Array<Record<string, unknown>> = [];
    const replays: Array<Record<string, unknown>> = [];
    const metadata = (copy: Copy) => (copy.document ? { source: "affaire-intake", intake_document_id: copy.document,
      intake_storage_path: `${TENANT}/dossier/${copy.document}.pdf`, intake_generation: copy.generation } : {});
    const rows = input.copies.map((copy) => ({ id: copy.id, tenant_id: TENANT, plan_set_id: PLAN_SET,
      file_path: `${TENANT}/${PLAN_SET}/${copy.id}/${copy.name}`, file_name: copy.name, file_type: "application/pdf",
      file_size_bytes: 8, page_count: 1, metadata: metadata(copy), created_at: "2026-11-21T08:00:00Z" }));
    const sealed = (plan: Copy) => ({ id: plan.id, name: plan.name, intake_document_id: plan.document, generation: plan.generation });
    const requests = input.requests.map((request) => ({ id: request.id, tenant_id: TENANT, project_id: PROJECT, state: "closed",
      manifest: { format_version: 2, plans: request.plans.map((plan) => ({ entry_key: plan.id, plan_file_id: plan.id, name: plan.name,
        logical_id: plan.document ?? plan.id, intake_document_id: plan.document, generation: plan.generation })),
      coverage: { plans_omitted: (request.notRequested ?? []).map((plan) => ({ ...sealed(plan), reason: "not_requested" })) } } }));
    const jobs = [{ id: input.predecessor.id, tenant_id: TENANT, project_id: PROJECT, launch_request_id: input.predecessor.requestId,
      launch_unit_key: input.predecessor.unitKey, preparation_snapshot: input.predecessor.snapshotPlans
        ? { preparation: { sources: input.predecessor.snapshotPlans.map((plan) => ({ document_id: plan.id, kind: "plan", active: true })) } }
        : null }];
    // The source of every copy the plan set ever held, as the database recorded it at the copy's insert and keeps it once
    // the copy is gone (takeoff_plan_location_sources).
    const everyCopy = [...input.copies, ...input.requests.flatMap((request) => [...request.plans, ...(request.notRequested ?? [])]),
      ...(input.predecessor.snapshotPlans ?? [])];
    const registry = [...new Map(everyCopy.map((copy) => [copy.id, { plan_file_id: copy.id, plan_set_id: PLAN_SET, tenant_id: TENANT,
      project_id: PROJECT, source_kind: copy.document ? "intake_document" : "plan_file", source_id: copy.document ?? copy.id }])).values()];
    // A read by identifier (maybeSingle) gets its row; a list, the rows PostgREST serves (newest first here).
    const served = (all: Array<Record<string, unknown>>) => (query: FakeQuery) => {
      const answer = servedRows(all, query);
      return query.cardinality === "many" ? answer : { data: (answer.data as unknown[])[0] ?? null, error: null };
    };
    const fake = createSupabaseFake({
      tables: { plan_files: (query: FakeQuery) => servedRows(rows, query), takeoff_launch_requests: served(requests),
        takeoff_jobs: served(jobs), takeoff_plan_location_sources: (query: FakeQuery) => servedRows(registry, query) },
      storage: { [PLAN_FILES_BUCKET]: () => ({ data: null, error: { message: "Object not found", statusCode: "404" } }) },
      rpc: {
        replay_manual_takeoff_plan_request: (args) => {
          replays.push(args as Record<string, unknown>);
          return input.receipt?.((args as { p_plan_file_ids: string[] | null }).p_plan_file_ids) ?? { data: [], error: null };
        },
        takeoff_plan_dispatch_is_active: () => ({ data: true, error: null }),
        takeoff_item_list_order_is_active: () => ({ data: false, error: null }),
        read_takeoff_launch_request_units: (args) => {
          const request = input.requests.find((entry) => entry.id === (args as { p_request_id: string }).p_request_id)!;
          return { data: { request_id: request.id, format: "per_plan", units: request.plans.map((plan, index) => ({
            key: `plan:${plan.id}`, ordinal: index + 1, state: request.states?.[plan.id] ?? "succeeded" })) }, error: null };
        },
        launch_manual_takeoff_plan_request: (args) => {
          launched.push(args as Record<string, unknown>);
          return { data: [{ outcome: "admitted", request_id: REQUEST, job_id: (args as { p_jobs: Array<{ id: string }> }).p_jobs[0].id }],
            error: null };
        },
      },
    });
    vi.mocked(createServiceRoleClient).mockReturnValue(fake.client as never);
    const sources = rows.map((row) => takeoffPreparationSourceSchema.parse({ document_id: row.id, document_name: row.file_name,
      kind: "plan", revision: null, source_version: "fixture-version", pages: [], active: input.confirmed.includes(row.id),
      confirmed: true, plan_set_id: PLAN_SET, file_path: row.file_path, page_count: 1, source_updated_at: "2026-11-21T08:00:00Z",
      mime_type: "application/pdf", content_hash: createHash("sha256").update(row.id).digest("hex") }));
    const preparation = buildDeducedTakeoffPreparation({ sources: sources.filter((source) => source.active), planSetId: PLAN_SET });
    preparation.sources.push(...sources.filter((source) => !source.active));
    vi.mocked(assertConfirmedTakeoffPreparation).mockResolvedValue(createTakeoffPreparationSnapshot({ preparation, confirmedBy: PAYER,
      confirmedAt: "2026-11-21T08:00:00Z", revision: 3, executionSelection: SELECTION }) as never);
    vi.mocked(getConfirmedTakeoffExecutionOwner).mockResolvedValue({ execution_host_id: HOST } as never);
    const context = { userId: PAYER, tenantId: TENANT, tenantRole: "engineer", supabase: fake.client } as never;
    // The affaire zone's dialogue (LaunchMetreDialog, relaunchTakeoffAction): its key, its preparation and the analysis it
    // replaces, never any plan.
    const runFromDialogue = () => launchTakeoffRelaunch({ context, projectId: PROJECT, planSetId: PLAN_SET, preparationRevision: 3,
      intentKey: "aaaaaaaa-0000-4000-8000-0000000000a1", predecessorJobId: input.predecessor.id });
    const run = (planFileIds: string[]) => launchTakeoffRelaunch({ context, projectId: PROJECT, planSetId: PLAN_SET,
      preparationRevision: 3, intentKey: "aaaaaaaa-0000-4000-8000-0000000000a2", planFileIds, predecessorJobId: input.predecessor.id });
    // The dossier's pieces now, at the generation of their current copy.
    const documents = [...new Map(input.copies.filter((copy) => copy.document).map((copy) => [copy.document!, {
      id: copy.document!, file_name: copy.name, plan_copy_generation: copy.generation, storage_path: `${TENANT}/dossier/${copy.document}.pdf`,
    }])).values()];
    return { runFromDialogue, run, launched, replays, rows, documents };
  }
  const PIECE_A = "aaaaaaaa-0000-4000-8000-000000000061";
  const PIECE_B = "aaaaaaaa-0000-4000-8000-000000000062";
  const PIECE_C = "aaaaaaaa-0000-4000-8000-000000000063";
  const A_BEFORE: Copy = { id: PLAN_FILE, name: "plan-a.pdf", document: PIECE_A, generation: "generation-1" };
  const A_AFTER: Copy = { id: "aaaaaaaa-0000-4000-8000-000000000054", name: "plan-a.pdf", document: PIECE_A, generation: "generation-2" };
  const B_COPY: Copy = { id: PLAN_B, name: "plan-b.pdf", document: PIECE_B, generation: "generation-1" };
  const C_COPY: Copy = { id: PLAN_C, name: "plan-c.pdf", document: PIECE_C, generation: "generation-1" };
  const FIRST_REQUEST = "aaaaaaaa-0000-4000-8000-0000000000e1";
  const SECOND_REQUEST = "aaaaaaaa-0000-4000-8000-0000000000e2";
  const JOB_OF_A = "aaaaaaaa-0000-4000-8000-0000000000b1";

  // The dossier replaced plan A after its analysis: its piece has a new working copy (a new generation, a new identifier) and
  // the member confirmed the options with it. The dialogue's relaunch of A's analysis reads A at its current copy.
  it("relaunches, from the dialogue's payload, a plan the dossier replaced after its analysis at its current copy", async () => {
    const history = affaireHistory({ copies: [A_AFTER, B_COPY], confirmed: [A_AFTER.id, B_COPY.id],
      requests: [{ id: FIRST_REQUEST, plans: [A_BEFORE, B_COPY] }],
      predecessor: { id: JOB_OF_A, requestId: FIRST_REQUEST, unitKey: `plan:${A_BEFORE.id}` } });
    await expect(history.runFromDialogue()).resolves.toMatchObject({ outcome: "admitted", requestId: REQUEST });
    expect(history.launched).toHaveLength(1);
    expect(history.launched[0]).toMatchObject({ p_intent: "reread_plans", p_predecessor_job_id: JOB_OF_A, p_plan_file_ids: [A_AFTER.id] });
    const manifest = history.launched[0].p_manifest as AnyTakeoffLaunchManifest;
    expect(manifest.plans).toEqual([expect.objectContaining({ plan_file_id: A_AFTER.id, intake_document_id: PIECE_A,
      generation: "generation-2" })]);
    // B stays the first analysis's; A's former copy is not set aside as read, its new copy is read.
    expect(manifest.coverage.plans_omitted).toEqual([{ id: B_COPY.id, name: "plan-b.pdf", reason: "not_requested",
      intake_document_id: PIECE_B, generation: "generation-1" }]);
    expect(describeDossierChangeSinceAnalysis(manifest, history.rows, history.documents)).toBeNull();
    // Its identity names the copy it reads: the receipt was looked up under it.
    expect(history.replays).toEqual([expect.objectContaining({ p_plan_file_ids: [A_AFTER.id], p_plans_named: false })]);
  });

  // A command sent before the replacement whose answer was lost: its retry after the replacement replays its receipt
  // (recorded under the copy it then read), and admits nothing more.
  it("answers a relaunch sent before its plan's replacement, retried after it, by its receipt", async () => {
    const history = affaireHistory({ copies: [A_AFTER, B_COPY], confirmed: [A_AFTER.id, B_COPY.id],
      requests: [{ id: FIRST_REQUEST, plans: [A_BEFORE, B_COPY] }],
      predecessor: { id: JOB_OF_A, requestId: FIRST_REQUEST, unitKey: `plan:${A_BEFORE.id}` },
      receipt: (planFileIds) => (planFileIds?.[0] === A_BEFORE.id
        ? { data: [{ outcome: "replayed", request_id: SECOND_REQUEST, job_id: "aaaaaaaa-0000-4000-8000-0000000000b2" }], error: null }
        : { data: null, error: { code: "23505", message: "TAKEOFF_LAUNCH_INTENT_CONFLICT" } }) });
    await expect(history.runFromDialogue()).resolves.toEqual({ outcome: "replayed", requestId: SECOND_REQUEST,
      jobId: "aaaaaaaa-0000-4000-8000-0000000000b2" });
    expect(history.launched).toEqual([]);
    expect(assertConfirmedTakeoffPreparation).not.toHaveBeenCalled();
    // Under neither identity, another command under that key stays a conflict.
    const other = affaireHistory({ copies: [A_AFTER, B_COPY], confirmed: [A_AFTER.id, B_COPY.id],
      requests: [{ id: FIRST_REQUEST, plans: [A_BEFORE, B_COPY] }],
      predecessor: { id: JOB_OF_A, requestId: FIRST_REQUEST, unitKey: `plan:${A_BEFORE.id}` },
      receipt: () => ({ data: null, error: { code: "23505", message: "TAKEOFF_LAUNCH_INTENT_CONFLICT" } }) });
    await expect(other.runFromDialogue()).rejects.toMatchObject({ status: 409 });
    expect(other.launched).toEqual([]);
  });

  // An analysis launched outside any request (a grouped one, before the activation) is resolved the same way: each copy's
  // piece is the one the database recorded for it, kept once the copy is gone.
  it("relaunches, from the dialogue's payload, an analysis outside any request at the current copies of its plans", async () => {
    const history = affaireHistory({ copies: [A_AFTER, B_COPY], confirmed: [A_AFTER.id, B_COPY.id], requests: [],
      predecessor: { id: JOB_OF_A, requestId: null, unitKey: null, snapshotPlans: [A_BEFORE, B_COPY] } });
    await expect(history.runFromDialogue()).resolves.toMatchObject({ outcome: "admitted" });
    expect(history.launched[0]).toMatchObject({ p_plan_file_ids: [B_COPY.id, A_AFTER.id] });
    expect((history.launched[0].p_manifest as AnyTakeoffLaunchManifest).plans.map((plan) => plan.plan_file_id).sort())
      .toEqual([B_COPY.id, A_AFTER.id].sort());
  });

  // A plan that left the dossier has no current copy at all: the relaunch is refused, saying so (the member cannot
  // confirm the options with a plan that is gone).
  it("refuses the relaunch of a plan whose piece left the dossier, saying so", async () => {
    const history = affaireHistory({ copies: [B_COPY], confirmed: [B_COPY.id], requests: [{ id: FIRST_REQUEST, plans: [A_BEFORE, B_COPY] }],
      predecessor: { id: JOB_OF_A, requestId: FIRST_REQUEST, unitKey: `plan:${A_BEFORE.id}` } });
    await expect(history.runFromDialogue()).rejects.toMatchObject({ status: 422,
      message: "Un plan de l’analyse à relancer n’est plus dans le dossier de l’affaire : cette analyse ne peut plus être relancée telle quelle." });
    expect(history.launched).toEqual([]);
  });

  // A plan's last successful reading is inherited from any earlier request, not only the latest: request 1 read A and B,
  // request 2 read A again and did not read it, request 3 reads C. A is not reported as added, and keeps its generation.
  it.each(["failed", "canceled", "not_started"])(
    "keeps, as read before, the earlier reading of a plan whose later reading %s", async (state) => {
      const history = affaireHistory({ copies: [A_BEFORE, B_COPY, C_COPY], confirmed: [A_BEFORE.id, B_COPY.id, C_COPY.id],
        requests: [
          { id: SECOND_REQUEST, plans: [A_BEFORE], states: { [A_BEFORE.id]: state }, notRequested: [B_COPY] },
          { id: FIRST_REQUEST, plans: [A_BEFORE, B_COPY] },
        ],
        predecessor: { id: JOB_OF_A, requestId: SECOND_REQUEST, unitKey: `plan:${A_BEFORE.id}` } });
      await expect(history.run([C_COPY.id])).resolves.toMatchObject({ outcome: "admitted" });
      const manifest = history.launched[0].p_manifest as AnyTakeoffLaunchManifest;
      expect(manifest.coverage.plans_omitted).toEqual(expect.arrayContaining([
        { id: A_BEFORE.id, name: "plan-a.pdf", reason: "not_requested", intake_document_id: PIECE_A, generation: "generation-1" },
        { id: B_COPY.id, name: "plan-b.pdf", reason: "not_requested", intake_document_id: PIECE_B, generation: "generation-1" },
      ]));
      expect(manifest.coverage.plans_omitted).toHaveLength(2);
      expect(describeDossierChangeSinceAnalysis(manifest, history.rows, history.documents)).toBeNull();
      // Counterexample: once the dossier replaces A, the change is told against the generation that was read.
      const replaced = history.documents.map((document) => (document.id === PIECE_A
        ? { ...document, plan_copy_generation: "generation-2" } : document));
      expect(describeDossierChangeSinceAnalysis(manifest, history.rows, replaced)).toEqual({ added: [], removed: [],
        replaced: [{ id: PIECE_A, name: "plan-a.pdf" }] });
    });

  // The requests are read from the latest, a page at a time, as far back as a plan lacks a successful reading: here
  // eleven later requests read A again without success, and only the oldest, past the first page, read it.
  it("finds a plan's last successful reading past the first page of the affaire's requests", async () => {
    const later = Array.from({ length: 11 }, (_, index) => ({
      id: `aaaaaaaa-0000-4000-8000-0000000001${String(index).padStart(2, "0")}`, plans: [A_BEFORE],
      states: { [A_BEFORE.id]: index % 2 ? "canceled" : "failed" }, notRequested: [B_COPY] }));
    const history = affaireHistory({ copies: [A_BEFORE, B_COPY, C_COPY], confirmed: [A_BEFORE.id, B_COPY.id, C_COPY.id],
      requests: [...later, { id: FIRST_REQUEST, plans: [A_BEFORE, B_COPY] }],
      predecessor: { id: JOB_OF_A, requestId: later[0].id, unitKey: `plan:${A_BEFORE.id}` } });
    await expect(history.run([C_COPY.id])).resolves.toMatchObject({ outcome: "admitted" });
    const manifest = history.launched[0].p_manifest as AnyTakeoffLaunchManifest;
    expect(manifest.coverage.plans_omitted).toEqual(expect.arrayContaining([
      { id: A_BEFORE.id, name: "plan-a.pdf", reason: "not_requested", intake_document_id: PIECE_A, generation: "generation-1" }]));
    expect(manifest.coverage.plans_omitted).toHaveLength(2);
  });

  // The reading that counts is the latest that succeeded: a later successful reading of the same plan, at its new copy,
  // replaces the earlier one (never both).
  it("inherits the latest successful reading of a plan, at the copy it read", async () => {
    const history = affaireHistory({ copies: [A_AFTER, B_COPY, C_COPY], confirmed: [A_AFTER.id, B_COPY.id, C_COPY.id],
      requests: [
        { id: SECOND_REQUEST, plans: [A_AFTER], notRequested: [B_COPY] },
        { id: FIRST_REQUEST, plans: [A_BEFORE, B_COPY] },
      ],
      predecessor: { id: JOB_OF_A, requestId: SECOND_REQUEST, unitKey: `plan:${A_AFTER.id}` } });
    await expect(history.run([C_COPY.id])).resolves.toMatchObject({ outcome: "admitted" });
    const manifest = history.launched[0].p_manifest as AnyTakeoffLaunchManifest;
    expect(manifest.coverage.plans_omitted).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: A_AFTER.id, reason: "not_requested", generation: "generation-2" }),
      expect.objectContaining({ id: B_COPY.id, reason: "not_requested" }),
    ]));
    expect(manifest.coverage.plans_omitted).toHaveLength(2);
    expect(describeDossierChangeSinceAnalysis(manifest, history.rows, history.documents)).toBeNull();
  });

  it("refuses plans named one by one before one analysis per plan is active", async () => {
    const { calls } = gesture();
    await expect(launchTakeoffRelaunch({ context: member("engineer"), projectId: PROJECT, planSetId: PLAN_SET, preparationRevision: 2,
      intentKey: "aaaaaaaa-0000-4000-8000-0000000000ac", planFileIds: [PLAN_FILE], predecessorJobId: null }))
      .rejects.toMatchObject({ status: 422, message: expect.stringContaining("sans choisir de plans") });
    // Its receipt was looked up first: none.
    expect(calls("replay_plans")).toEqual([expect.objectContaining({ p_plan_file_ids: [PLAN_FILE], p_plans_named: true })]);
    expect(calls("replay")).toEqual([]);
  });

  // Past the replay: the member's confirmed preparation sealed, then the database's command decides.
  function command(answer: { data?: unknown; error?: { code: string; message: string } }) {
    const calls: string[] = [];
    const service = createSupabaseFake({ rpc: {
      // One analysis per plan not activated: the grouped command (lot 3's command of plans has its own cases above).
      takeoff_plan_dispatch_is_active: () => ({ data: false, error: null }),
      // The receipt, read first under either identity of the command: none.
      replay_manual_takeoff_plan_request: () => ({ data: [], error: null }),
      // Lot 4: the command reads whether the second measuring order is active (it is not: the free extraction).
      takeoff_item_list_order_is_active: () => ({ data: false, error: null }),
      launch_manual_takeoff_request: () => { calls.push("launch"); return { data: answer.data ?? null, error: answer.error ?? null }; },
    }, tables: {
      // The analysis a relaunch replaces: a grouped one, read for the plans its receipt may name.
      takeoff_jobs: () => ({ data: { launch_unit_key: "grouped", preparation_snapshot: null }, error: null }),
    } });
    vi.mocked(createServiceRoleClient).mockReturnValue(service.client as never);
    const session = createSupabaseFake({ tables: { plan_files: () => ({ data: [], error: null, count: 0 }) } });
    const plan = takeoffPreparationSourceSchema.parse({ document_id: PLAN_FILE, document_name: "Plan RDC.pdf", kind: "plan",
      revision: null, source_version: "fixture-version", pages: [], active: true, confirmed: true, plan_set_id: PLAN_SET,
      file_path: FILE_PATH, page_count: 1, source_updated_at: "2026-11-21T08:00:00Z", mime_type: "application/pdf", content_hash: "d".repeat(64) });
    vi.mocked(assertConfirmedTakeoffPreparation).mockResolvedValue({ execution_selection: SELECTION, preparation_revision: 2,
      preparation: { sources: [plan] } } as never);
    vi.mocked(getConfirmedTakeoffExecutionOwner).mockResolvedValueOnce({ execution_host_id: HOST } as never);
    vi.mocked(resolvePlanSetSourceFile).mockResolvedValueOnce({ sourceFileName: "Plan RDC.pdf", sourceFileType: "application/pdf",
      sourceFileSizeBytes: 10 } as never);
    const launch = (predecessorJobId: string | null) => launchTakeoffRelaunch({ context: { userId: PAYER, tenantId: TENANT,
      tenantRole: "engineer", supabase: session.client } as never, projectId: PROJECT, planSetId: PLAN_SET, preparationRevision: 2,
      intentKey: "aaaaaaaa-0000-4000-8000-0000000000aa", predecessorJobId });
    return { launch, calls };
  }

  // The database refuses a manual launch while the affaire's automatic start can still begin (it is taken on from the
  // zone), and a first analysis of an affaire that has one: the member reads why, as a refusal that ends the command.
  it.each([
    ["the affaire's automatic start can still begin", { code: "55000", message: "TAKEOFF_LAUNCH_AUTOMATIC_PENDING" }, null,
      "Le métré automatique de l’affaire peut encore démarrer : prenez-le en charge depuis l’état du métré de l’affaire."],
    ["the affaire already has an analysis", { code: "22023", message: "TAKEOFF_LAUNCH_ANALYSIS_EXISTS" }, null,
      "L’affaire a déjà une analyse : rechargez l’affaire pour relancer celle qu’elle montre."],
  ] as const)("refuses a launch the database refuses because %s, and starts nothing", async (_case, error, predecessor, message) => {
    const { launch, calls } = command({ error });
    await expect(launch(predecessor)).rejects.toMatchObject({ status: 409, message });
    expect(calls).toEqual(["launch"]);
    expect(runLocalTakeoffAttempts).not.toHaveBeenCalled();
  });

  // Two commands of one affaire crossing in the database (a deadlock or a serialization failure, rolled back): the member is
  // told to try again, and the command's key is kept for that (a server-side answer, never a refusal).
  it.each([["a deadlock", "40P01", "deadlock detected"], ["a serialization failure", "40001", "could not serialize access"]] as const)(
    "answers %s with a retryable French message", async (_case, code, message) => {
      const { launch } = command({ error: { code, message } });
      await expect(launch("aaaaaaaa-0000-4000-8000-0000000000bb")).rejects.toMatchObject({ status: 503, retryable: true,
        message: "Le métré de l’affaire est occupé par une autre opération. Réessayez dans un instant." });
    });

  // An analysis launched outside any request that has not ended: the command is answered with it, without a request.
  it("answers with the analysis outside any request that still runs, and starts nothing", async () => {
    const legacy = "aaaaaaaa-0000-4000-8000-0000000000dd";
    const { launch } = command({ data: [{ outcome: "already_running", request_id: null, job_id: legacy }] });
    await expect(launch("aaaaaaaa-0000-4000-8000-0000000000bb")).resolves.toEqual({ outcome: "already_running", requestId: null, jobId: legacy });
    expect(runLocalTakeoffAttempts).not.toHaveBeenCalled();
  });

  it("names a first analysis of the affaire « initial », with no analysis to replace", async () => {
    const { calls } = gesture({ replayed: { outcome: "replayed", request_id: REQUEST, job_id: "aaaaaaaa-0000-4000-8000-0000000000cc" } });
    await launchTakeoffRelaunch({ context: member("engineer"), projectId: PROJECT, planSetId: PLAN_SET, preparationRevision: 2,
      intentKey: "aaaaaaaa-0000-4000-8000-0000000000aa", predecessorJobId: null });
    expect(calls("replay_plans")).toEqual([expect.objectContaining({ p_intent: "initial", p_predecessor_job_id: null,
      p_plan_file_ids: null, p_plans_named: false })]);
  });

});
