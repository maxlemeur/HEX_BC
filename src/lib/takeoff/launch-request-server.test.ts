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
import {
  assumeTakeoffLaunchRequest, confirmAffaireBriefWithTakeoff, describeDossierChangeSinceAnalysis, evaluateTakeoffLaunchRequests,
  launchTakeoffRelaunch, readAutomaticTakeoffPayerNotice,
} from "@/lib/takeoff/launch-request-server";
import { runLocalTakeoffAttempts } from "@/lib/takeoff/local-dispatch";
import { getConfirmedTakeoffExecutionOwner } from "@/lib/ai/chatgpt-takeoff";
import type { AnyTakeoffLaunchManifest } from "@/lib/takeoff/launch-request";
import { createSupabaseFake, filterValue, servedRows, type FakeQuery } from "@/lib/takeoff/metre-m3.test-utils";
import { loadPreparationReferenceFiles } from "@/lib/takeoff/preparation-reference-loader";
import { createTakeoffPreparationSnapshot, takeoffPreparationSourceSchema } from "@/lib/takeoff/preparation";
import { fictionalPlanPdf } from "@/lib/takeoff/preparation.test-utils";
import { buildDeducedTakeoffPreparation } from "@/lib/takeoff/preparation-from-dossier";
import { toPreparationIntakeSource } from "@/lib/takeoff/preparation-sources";
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
  perPlan?: boolean } = {}) {
  const document = {
    id: DOCUMENT, tenant_id: TENANT, project_id: PROJECT, upload_id: "aaaaaaaa-0000-4000-8000-000000000070", created_by: PAYER,
    storage_path: `${TENANT}/${PROJECT}/${UPLOAD}/${DOCUMENT}/plan-rdc.pdf`, deletion_token: null, plan_copy_generation: "generation-2",
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
        const rows = input.copy === "none" ? [] : [{ ...copy, file_type: "application/pdf", page_count: 1 }];
        return { data: filterValue(query, "plan_set_id") === PLAN_SET ? rows : [], error: null, count: rows.length };
      },
      tenant_memberships: () => ({ data: { role: "engineer" }, error: null }),
      estimate_projects: () => ({ data: { user_id: PAYER, is_archived: false }, error: null }),
    },
    storage: {
      [PLAN_FILES_BUCKET]: () => ({ data: new Blob([BYTES]), error: null }),
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
    pages: [], active: true, confirmed: false, plan_set_id: PLAN_SET, file_path: FILE_PATH, page_count: 1,
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

// The gestures: the brief's confirmation records who pays, on this Mac, or why nobody does; a take-over and a relaunch.
const NOTICE = "a".repeat(64);
function gesture(input: { launchActive?: boolean; reply?: Record<string, unknown>; outcome?: string; replayed?: Record<string, unknown>;
  mayPay?: boolean; action?: string; perPlan?: boolean } = {}) {
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
    replay_manual_takeoff_plan_request: record("replay_plans", input.replayed ? [input.replayed] : []),
    takeoff_plan_dispatch_is_active: () => ({ data: input.perPlan === true, error: null }),
    claim_takeoff_launch_evaluations: () => ({ data: [], error: null }),
  }, tables: {
    // The analysis a command replaces: a plan's unit of one analysis per plan.
    takeoff_jobs: () => ({ data: { launch_unit_key: `plan:${PLAN_FILE}`, preparation_snapshot: null }, error: null }),
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

  it("reads a plan added after the analysis by a command that names it, without a predecessor", async () => {
    const { calls } = gesture({ perPlan: true, replayed: { outcome: "replayed", request_id: REQUEST, job_id: null } });
    await launchTakeoffRelaunch({ context: member("engineer"), projectId: PROJECT, planSetId: PLAN_SET, preparationRevision: 2,
      intentKey: "aaaaaaaa-0000-4000-8000-0000000000ab", planFileIds: [PLAN_FILE.toUpperCase()] });
    expect(calls("replay_plans")).toEqual([expect.objectContaining({ p_intent: "initial", p_predecessor_job_id: null,
      p_plan_file_ids: [PLAN_FILE] })]);
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
  function planCommand(pages: { a: number; b: number }, previousRead: string[] = []) {
    const launched: Array<Record<string, unknown>> = [];
    const planRow = (id: string, name: string, pageCount: number) => ({ id, tenant_id: TENANT, plan_set_id: PLAN_SET,
      file_path: `${TENANT}/${PLAN_SET}/${id}/${name}`, file_name: name, file_type: "application/pdf", file_size_bytes: 8,
      page_count: pageCount, metadata: {}, created_at: "2026-11-21T08:00:00Z" });
    const rows = [planRow(PLAN_FILE, "plan-a.pdf", pages.a), planRow(PLAN_B, "plan-b.pdf", pages.b), planRow(PLAN_C, "plan-c.pdf", 2),
      planRow(PLAN_B_COPY, "plan-b-ancien.pdf", 2)];
    const previous = previousRead.length ? { manifest: { format_version: 1, coverage: { plans_omitted: [] },
      plans: previousRead.map((id) => ({ plan_file_id: id, name: rows.find((row) => row.id === id)!.file_name, intake_document_id: null,
        generation: null })) } } : null;
    const fake = createSupabaseFake({
      tables: { plan_files: (query: FakeQuery) => servedRows(rows, query), takeoff_launch_requests: () => ({ data: previous, error: null }) },
      rpc: {
        replay_manual_takeoff_plan_request: () => ({ data: [], error: null }),
        takeoff_plan_dispatch_is_active: () => ({ data: true, error: null }),
        launch_manual_takeoff_plan_request: (args) => {
          launched.push(args as Record<string, unknown>);
          return { data: [{ outcome: "admitted", request_id: REQUEST, job_id: (args as { p_jobs: Array<{ id: string }> }).p_jobs[0].id }], error: null };
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
      preparationRevision: 2, intentKey: "aaaaaaaa-0000-4000-8000-0000000000ad", planFileIds });
    return { run, launched, rows };
  }

  it("refuses a command whose plans together exceed the plan set's limits, before any unit is admitted", async () => {
    const { run, launched } = planCommand({ a: 150, b: 150 });
    await expect(run([PLAN_FILE, PLAN_B])).rejects.toMatchObject({ code: "TAKEOFF_FILE_TOO_LARGE" });
    expect(launched).toEqual([]);
  });

  // The plans the affaire's previous analysis read, and the plan set's copies set aside, are recorded as such: the
  // dossier does not show them as added since. A plan never read still is.
  it("records the plans a command sets aside, so that the dossier shows only the plans never read as added", async () => {
    const { run, launched, rows } = planCommand({ a: 3, b: 3 }, [PLAN_FILE, PLAN_B]);
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

  it("refuses a relaunch that names no analysis before one analysis per plan is active", async () => {
    gesture();
    await expect(launchTakeoffRelaunch({ context: member("engineer"), projectId: PROJECT, planSetId: PLAN_SET, preparationRevision: 2,
      intentKey: "aaaaaaaa-0000-4000-8000-0000000000ac", planFileIds: [PLAN_FILE] })).rejects.toMatchObject({ status: 422 });
  });
});
