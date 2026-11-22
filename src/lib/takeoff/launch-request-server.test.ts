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
  launchTakeoffRelaunch, readAutomaticTakeoffPayerNotice, readBriefConfirmationPayerNotice, readDossierChangeSinceAnalysis,
} from "@/lib/takeoff/launch-request-server";
import { launchTakeoffItemRemeasure, planTakeoffItemRemeasure } from "@/lib/takeoff/item-remeasure-server";
import { orderSensitivePosteList } from "@/lib/takeoff/poste-reading.test-fixtures";
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
  getTakeoffLevelCProcessingConfigForTenant: vi.fn().mockResolvedValue({ maxPdfPages: 200, maxTotalTokens: 400000, maxCostCents: 2500,
    thresholdPages: 15, chunkSizePages: 10, overlapPages: 2 }),
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
vi.mock("@/lib/pdf/page-render-server", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/pdf/page-render-server")>(),
  renderPdfPages: vi.fn().mockResolvedValue({ pages: [{ regionText: "" }] }) }));
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
  /** The owner activated the second measuring order (lot 4). */
  listActive?: boolean;
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
      // The copy's source as the database recorded it at its insert: the dossier piece it was made from.
      takeoff_plan_location_sources: (query: FakeQuery) => servedRows(input.copy === "none" ? [] : [{ plan_file_id: PLAN_FILE,
        plan_set_id: PLAN_SET, tenant_id: TENANT, source_kind: "intake_document", source_id: DOCUMENT }], query),
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
      takeoff_item_list_order_is_active: () => ({ data: input.listActive === true, error: null }),
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

/** The list of items a request seals once the second measuring order is active (lot 4), of `items` items. */
function itemListOrder(items: number) {
  return { kind: "item_list" as const, version: 2 as const, list: { revision_id: "aaaaaaaa-0000-4000-8000-0000000000f1", revision: 3,
    content_sha256: "e".repeat(64), item_count: items } };
}

/** The seal of such a list: its order and its items, as `sealedMeasuringOrder` hands them to the bounds. */
function itemListSeal(items: number) {
  return { order: itemListOrder(items), items: Array.from({ length: items }, (_, index) => ({
    id: `bbbbbbbb-0000-4000-8000-${String(index).padStart(12, "0")}`, label: `Poste fictif ${index}`, expectedUnit: "u",
    measurementBasis: null, qualifiers: {}, sections: [], synonyms: [], referenceQuantity: null,
    origin: { kind: "manual" as const, intentId: `i-${index}`, addedBy: PAYER, addedAt: "2026-11-22T08:00:00.000Z", addedInRevision: 1 } })) };
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
  // own job identified by the request and its unit, and the Mac's dispatcher is handed them. Budget task: a request of the
  // free extraction keeps the tenant's envelope and its split by pages, as before the list's budget was sized.
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

  // Lot 4: a request that reads its plans against a list of items is bounded on the whole request before its admission:
  // 1,700 items in batches of 40 make 43 calls on a one-page plan, more than one plan's reading may make. The member is
  // asked to reduce the scope; nothing is admitted, nothing is sampled.
  it("refuses, naming the plan, a request whose reading against the list passes its bounds, and admits nothing", async () => {
    const { admitted, recorded } = dossier({ perPlan: true });
    vi.mocked(sealedMeasuringOrder).mockResolvedValueOnce(itemListSeal(1_700));
    const [result] = await evaluateTakeoffLaunchRequests();
    expect(result).toMatchObject({ requestId: REQUEST, outcome: "blocked", reason: "PLAN_SET_TOO_LARGE", jobId: null });
    expect(admitted).toEqual([]);
    expect(recorded).toEqual([expect.objectContaining({ p_state: "blocked", p_reason: "PLAN_SET_TOO_LARGE", p_details: {
      pieces: [{ id: PLAN_FILE, name: "Plan RDC.pdf" }],
      reading_bounds: { items: 1_700, plans: 1, reading_calls: 43, classifier_calls: 0, minutes: 65, max_request_calls: 480,
        max_plan_calls: 40, max_plan_pages: 154 } } })]);
  });

  // Budget task: the budget of a reading against the list is sized from the calls it is admitted for, twice their
  // reservations: 120 items on a one-page plan are 3 calls, a share and an envelope of 180,000 tokens (the tenant's
  // 400,000 would be the first format's); the cost envelope stays the tenant's.
  it("admits a request whose reading against the list stays within its bounds, its list and its sized budget sealed", async () => {
    const { admitted } = dossier({ perPlan: true });
    vi.mocked(sealedMeasuringOrder).mockResolvedValueOnce(itemListSeal(120));
    const [result] = await evaluateTakeoffLaunchRequests();
    expect(result).toMatchObject({ outcome: "admitted" });
    expect((admitted[0] as { p_manifest: unknown }).p_manifest).toMatchObject({ format_version: 2, order: itemListOrder(120),
      units: [{ key: `plan:${PLAN_FILE}`, budget: { tokens: 180_000, cost_cents: 2500 } }], budget: { tokens: 180_000, cost_cents: 2500 } });
    expect(sealedMeasuringOrder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ perPlan: true }));
  });

  // The second order is active, one analysis per plan is not: the automatic request is grouped and seals the free extraction.
  it("seals the free extraction of a grouped request, whatever the second order's activation says", async () => {
    const { admitted, fake } = dossier({ perPlan: false, listActive: true });
    const [result] = await evaluateTakeoffLaunchRequests();
    expect(result).toMatchObject({ outcome: "admitted" });
    expect((admitted[0] as { p_manifest: unknown }).p_manifest).toMatchObject({ format_version: 1,
      order: { kind: "free_extraction", version: 1, list: null } });
    expect(sealedMeasuringOrder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ perPlan: false }));
    expect(fake.rpcCalls.map((call) => call.fn)).not.toContain("takeoff_item_list_order_is_active");
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

  // The dialog reads the notice when it opens: a read that fails must be told apart from a notice there is none of.
  it("fails, instead of answering « no notice », when the database cannot read it", async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(createSupabaseFake({ rpc: {
      takeoff_payer_may_launch: () => ({ data: true, error: null }),
      takeoff_payer_notice: () => ({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } }),
    } }).client as never);
    await expect(readAutomaticTakeoffPayerNotice(member("engineer"), { id: PROJECT }, "127.0.0.1:3000")).rejects.toThrow();
  });
});

describe("readBriefConfirmationPayerNotice", () => {
  // The member's own session reads the brief as it is now: the notice is for a brief to confirm, as the page's render had it.
  const reader = (brief: { data: unknown; error: unknown }) => ({ userId: PAYER, tenantId: TENANT, tenantRole: "engineer",
    supabase: createSupabaseFake({ tables: { affaire_briefs: () => brief } }).client }) as never;

  it("gives the notice for a brief to confirm, read now", async () => {
    const { calls } = gesture();
    expect(await readBriefConfirmationPayerNotice(reader({ data: { status: "a_confirmer" }, error: null }), { id: PROJECT }, "127.0.0.1:3000"))
      .toEqual({ message: "Une fois les plans prêts, le métré utilisera votre forfait ChatGPT et les réglages de Mon profil.", digest: NOTICE });
    expect(calls("notice")).toEqual([expect.objectContaining({ p_actor: PAYER, p_project_id: PROJECT })]);
  });

  it.each([["already confirmed", { status: "confirme" }], ["not written yet", null]])("gives none for a brief %s", async (_case, row) => {
    const { calls } = gesture();
    expect(await readBriefConfirmationPayerNotice(reader({ data: row, error: null }), { id: PROJECT }, "127.0.0.1:3000")).toBeNull();
    expect(calls("notice")).toEqual([]);
  });

  it("fails when the brief cannot be read", async () => {
    const { calls } = gesture();
    await expect(readBriefConfirmationPayerNotice(reader({ data: null, error: { code: "08006", message: "connection failure" } }),
      { id: PROJECT }, "127.0.0.1:3000")).rejects.toThrow();
    expect(calls("notice")).toEqual([]);
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
  /** A unit's job as the database records it, for each state of a unit (private.takeoff_unit_state). */
  const unitJob = (requestId: string, key: string, state: string, index: number) => ({
    id: `aaaaaaaa-0000-4000-9000-${String(index).padStart(12, "0")}`, launch_request_id: requestId, launch_unit_key: key,
    status: { succeeded: "completed", failed: "failed", canceled: "canceled", not_started: "failed" }[state] ?? "pending",
    analysis_outcome: { succeeded: "success", failed: "failure", canceled: "canceled", not_started: "failure" }[state] ?? null,
    started_at: state === "not_started" || state === "canceled" ? null : "2026-11-21T08:05:00Z",
    error_code: state === "failed" ? "AI_PROVIDER" : state === "not_started" ? "TAKEOFF_WORKER_NOT_STARTED" : null,
    next_retry_at: null, updated_at: "2026-11-21T08:10:00Z" });
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
    refusal: { code: string; message: string } | null = null,
    extra: { tables?: Parameters<typeof createSupabaseFake>[0]["tables"]; rpc?: Parameters<typeof createSupabaseFake>[0]["rpc"] } = {}) {
    const launched: Array<Record<string, unknown>> = [];
    const launchedAll: Array<Record<string, unknown>> = [];
    const planRow = (id: string, name: string, pageCount: number | null) => ({ id, tenant_id: TENANT, plan_set_id: PLAN_SET,
      file_path: `${TENANT}/${PLAN_SET}/${id}/${name}`, file_name: name, file_type: "application/pdf", file_size_bytes: 8,
      page_count: pageCount, metadata: {}, created_at: "2026-11-21T08:00:00Z" });
    const rows = [planRow(PLAN_FILE, "plan-a.pdf", pages.a), planRow(PLAN_B, "plan-b.pdf", pages.b), planRow(PLAN_C, "plan-c.pdf", 2),
      planRow(PLAN_B_COPY, "plan-b-ancien.pdf", 2)];
    const previousId = "aaaaaaaa-0000-4000-8000-0000000000e1";
    const previousUnits = previous ? previous.format === 2
      ? previous.plans.map((id, index) => ({ key: `plan:${id}`, ordinal: index + 1, plans: [id],
        state: previous.read.includes(id) ? "succeeded" : "canceled" }))
      : [{ key: "grouped", ordinal: 1, plans: previous.plans, state: previous.read.length ? "succeeded" : "failed" }] : [];
    // The previous request, with its units' jobs as the walk reads them (one statement for the requests and their jobs).
    const previousRow = previous ? { id: previousId, tenant_id: TENANT, project_id: PROJECT, state: "closed",
      created_at: "2026-11-21T08:30:00Z", manifest: { format_version: previous.format,
        units: previousUnits.map(({ key, ordinal, plans }) => ({ key, ordinal, plans, pages: [] })),
        coverage: { plans_omitted: [] }, plans: previous.plans.map((id) => ({ entry_key: id, plan_file_id: id,
          name: rows.find((row) => row.id === id)!.file_name, intake_document_id: null, generation: null, pages: [] })) },
      takeoff_jobs: previousUnits.map((unit, index) => unitJob(previousId, unit.key, unit.state, index + 1)) } : null;
    const fake = createSupabaseFake({
      tables: { plan_files: (query: FakeQuery) => servedRows(rows, query),
        // The affaire's analysed requests, from the latest: its previous one, if any.
        takeoff_launch_requests: (query: FakeQuery) => servedRows(previousRow ? [previousRow] : [], query),
        // Each copy uploaded to the plan set is its own source.
        takeoff_plan_location_sources: (query: FakeQuery) => servedRows(rows.map((row) => ({ plan_file_id: row.id, plan_set_id: PLAN_SET,
          tenant_id: TENANT, source_kind: "plan_file", source_id: row.id })), query),
        // The affaire's analyses: those of its previous request, if any.
        takeoff_jobs: () => ({ data: previous ? { id: "aaaaaaaa-0000-4000-8000-0000000000bb" } : null, error: null }),
        ...extra.tables },
      storage: { [PLAN_FILES_BUCKET]: () => (bytes ? { data: new Blob([Uint8Array.from(bytes)]), error: null }
        : { data: null, error: { message: "Object not found", statusCode: "404" } }) },
      rpc: {
        replay_manual_takeoff_plan_request: () => ({ data: [], error: null }),
        takeoff_plan_dispatch_is_active: () => ({ data: true, error: null }),
        // Lot 4: the second measuring order is not activated: the free extraction.
        takeoff_item_list_order_is_active: () => ({ data: false, error: null }),
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
        ...extra.rpc,
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
    return { run, runFromDialogue, launched, launchedAll, rows, context };
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
    vi.mocked(sealedMeasuringOrder).mockResolvedValueOnce({ order: list, items: itemListSeal(12).items });
    const sealed = planCommand({ a: 3, b: 3 });
    await expect(sealed.run([PLAN_FILE])).resolves.toMatchObject({ outcome: "admitted" });
    // One call (a 3-page plan, 12 items): its share and the envelope sized from it.
    expect(sealed.launched[0].p_manifest).toMatchObject({ format_version: 2, order: list,
      units: [{ budget: { tokens: 60_000 } }], budget: { tokens: 60_000 } });
    expect(sealedMeasuringOrder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ perPlan: true }));
    vi.mocked(sealedMeasuringOrder).mockResolvedValueOnce({ blocked: "ITEM_LIST_TO_PREPARE" });
    const blocked = planCommand({ a: 3, b: 3 });
    await expect(blocked.run([PLAN_FILE])).rejects.toMatchObject({ status: 409,
      message: "La liste des postes est à préparer : importez ou choisissez la DPGF de l’affaire, puis relancez." });
    expect(blocked.launched).toEqual([]);
  });

  it("refuses a command of plans whose reading against the list passes its bounds, before any unit is admitted", async () => {
    vi.mocked(sealedMeasuringOrder).mockResolvedValueOnce(itemListSeal(1_700));
    const sealed = planCommand({ a: 3, b: 3 });
    await expect(sealed.run([PLAN_FILE])).rejects.toMatchObject({ status: 422, message: "Métré non démarré — les plans « plan-a.pdf » "
      + "dépassent les limites d’une lecture contre la liste des postes. Lecture de 1\u202f700 postes sur 1 plan : 43 appels de "
      + "lecture, environ 1 h 05 sur un Mac. Au plus 480 appels de lecture par demande, 40 par plan et 154 pages par plan : "
      + "réduisez les plans ou les pages à lire." });
    expect(sealed.launched).toEqual([]);
  });

  // Lot 4 PR 4b: a new measure of a selection reads the items asked only, on the plans named, from the affaire's confirmed
  // preparation; its reading is sized on those items, and its order seals them (asked_item_ids, in their canonical order).
  describe("the new measure of a selection", () => {
    const LATEST_JOB = "aaaaaaaa-0000-4000-8000-0000000000e9";
    const remeasured: Array<Record<string, unknown>> = [];
    const setup = (outcome: Record<string, unknown> | { code: string; message: string } = { outcome: "admitted", request_id: REQUEST,
      job_id: "aaaaaaaa-0000-4000-9000-000000000001", stale: null }) => {
      remeasured.length = 0;
      return planCommand({ a: 3, b: 3 }, { format: 2, plans: [PLAN_FILE], read: [PLAN_FILE] }, undefined,
        "aaaaaaaa-0000-4000-8000-0000000000bb", null, {
          tables: { takeoff_preparations: () => ({ data: { revision: 2 }, error: null }),
            takeoff_jobs: () => ({ data: [{ id: LATEST_JOB }], error: null }) },
          rpc: { launch_takeoff_item_remeasure: (args) => {
            remeasured.push(args as Record<string, unknown>);
            return "code" in outcome ? { data: null, error: outcome } : { data: [outcome], error: null };
          } },
        });
    };
    const ids = itemListSeal(1_700).items.map(({ id }) => id);
    const CONFIRMED = { preview_digest: "c".repeat(64), setting: { reasoning_effort: "high" } };

    it("plans the items asked on the plans named, sized on them alone, the other plans left as the preparation has them", async () => {
      vi.mocked(sealedMeasuringOrder).mockResolvedValueOnce(itemListSeal(1_700));
      const { context } = setup();
      const planned = await planTakeoffItemRemeasure(context, { projectId: PROJECT, planKeys: [PLAN_FILE],
        itemIds: [ids[7].toUpperCase(), ids[3], ids[7]], selection: SELECTION });
      if (!("plan" in planned)) throw new Error(`expected a plan: ${planned.refusal}`);
      const { plan } = planned;
      // The whole list of 1,700 items is refused on this plan (above); two of them are read in one paid call or so.
      expect(plan.bounds.items).toBe(2);
      expect(plan.bounds.ok).toBe(true);
      expect(plan.manifest.order).toMatchObject({ kind: "item_list", list: { item_count: 1_700, asked_item_ids: [ids[3], ids[7]] } });
      expect(plan.askedItemIds).toEqual([ids[3], ids[7]]);
      expect(plan.manifest.plans.map(({ plan_file_id: id }) => id)).toEqual([PLAN_FILE]);
      expect(plan.planFileIds).toEqual([PLAN_FILE]);
      expect(plan.snapshot.preparation.sources.filter((source) => source.kind === "plan" && source.active)
        .map((source) => source.document_id)).toEqual([PLAN_FILE]);
      expect(plan.snapshot.confirmed_by).toBe(PAYER);
      expect(plan.snapshot.execution_selection).toEqual(SELECTION);
      expect(plan.preparationRevision).toBe(2);
      expect(plan.predecessorJobId).toBe(LATEST_JOB);
      expect(plan.manifest.budget.tokens).toBeGreaterThan(0);
      expect(plan.manifest.budget.tokens).toBe(plan.bounds.requestBudgetTokens);
    });

    // The twin of the worker's case (poste-reading-job-server.test.ts): the admission and its preview size the items asked
    // in the sealed list's order, as the worker reads them; by identifier they made 33 calls, and the worker 44.
    it("sizes the items asked in the sealed list's order, as the worker reads them: 44 calls, refused before admission", async () => {
      const list = orderSensitivePosteList();
      vi.mocked(sealedMeasuringOrder).mockResolvedValueOnce({ order: itemListOrder(list.length), items: list });
      remeasured.length = 0;
      const { context } = planCommand({ a: 90, b: 3 }, { format: 2, plans: [PLAN_FILE], read: [PLAN_FILE] }, undefined,
        "aaaaaaaa-0000-4000-8000-0000000000bb", null, {
          tables: { takeoff_preparations: () => ({ data: { revision: 2 }, error: null }),
            takeoff_jobs: () => ({ data: [{ id: LATEST_JOB }], error: null }) },
          rpc: { launch_takeoff_item_remeasure: (args) => { remeasured.push(args as Record<string, unknown>); return { data: [], error: null }; } },
        });
      const planned = await planTakeoffItemRemeasure(context, { projectId: PROJECT, planKeys: [PLAN_FILE],
        itemIds: list.map(({ id }) => id).sort(), selection: SELECTION });
      expect(planned).toEqual({ refusal: expect.stringContaining("Lecture de 48 postes sur 1 plan : 44 appels de lecture") });
      expect(remeasured).toEqual([]);
    });

    it("plans the 80 items of the brief in the list's order: 3 batches, as the worker reads them", async () => {
      const byId = Array.from({ length: 80 }, (_, index) => ({ ...itemListSeal(80).items[index], label: index % 2 ? "WC" : "A".repeat(3_000) }));
      const revision = [...byId.filter((_, index) => index % 2 === 0), ...byId.filter((_, index) => index % 2 !== 0)];
      vi.mocked(sealedMeasuringOrder).mockResolvedValueOnce({ order: itemListOrder(80), items: revision });
      const { context } = setup();
      const planned = await planTakeoffItemRemeasure(context, { projectId: PROJECT, planKeys: [PLAN_FILE],
        itemIds: byId.map(({ id }) => id), selection: SELECTION });
      if (!("plan" in planned)) throw new Error(`expected a plan: ${planned.refusal}`);
      expect(planned.plan.bounds.units).toEqual([expect.objectContaining({ fragments: 1, batches: 3, readingCalls: 3 })]);
      expect(planned.plan.askedItemIds).toEqual(byId.map(({ id }) => id).sort());
    });

    it("says the new measure is not open while one analysis per plan is not active, before anything is planned", async () => {
      vi.mocked(sealedMeasuringOrder).mockResolvedValueOnce(itemListSeal(12));
      remeasured.length = 0;
      const { context } = planCommand({ a: 3, b: 3 }, { format: 2, plans: [PLAN_FILE], read: [PLAN_FILE] }, undefined,
        "aaaaaaaa-0000-4000-8000-0000000000bb", null, {
          tables: { takeoff_preparations: () => ({ data: { revision: 2 }, error: null }),
            takeoff_jobs: () => ({ data: [{ id: LATEST_JOB }], error: null }) },
          rpc: { takeoff_plan_dispatch_is_active: () => ({ data: false, error: null }) },
        });
      await expect(planTakeoffItemRemeasure(context, { projectId: PROJECT, planKeys: [PLAN_FILE], itemIds: [ids[1]],
        selection: SELECTION })).resolves.toEqual({ refusal:
        "La nouvelle mesure d’une sélection n’est pas encore ouverte : la lecture plan par plan n’est pas activée sur cette affaire." });
    });

    it("names a selection made on another list or plan as stale, before anything is admitted", async () => {
      vi.mocked(sealedMeasuringOrder).mockResolvedValueOnce(itemListSeal(12));
      const { context } = setup();
      await expect(planTakeoffItemRemeasure(context, { projectId: PROJECT, planKeys: [PLAN_FILE],
        itemIds: ["cccccccc-0000-4000-8000-000000000001"], selection: SELECTION }))
        .resolves.toEqual({ refusal: "Un poste de la sélection n’est plus dans la liste : rafraîchissez la sélection.", stale: true });
      vi.mocked(sealedMeasuringOrder).mockResolvedValueOnce(itemListSeal(12));
      await expect(planTakeoffItemRemeasure(context, { projectId: PROJECT, planKeys: ["cccccccc-0000-4000-8000-000000000002"],
        itemIds: [ids[1]], selection: SELECTION }))
        .resolves.toEqual({ refusal: "Un plan de la sélection ne fait plus partie de la préparation confirmée : rouvrez l’aperçu.", stale: true });
      expect(remeasured).toEqual([]);
    });

    it("admits it with the targets the member saw, then starts its units; or answers stale with the items named", async () => {
      vi.mocked(sealedMeasuringOrder).mockResolvedValueOnce(itemListSeal(12));
      const { context } = setup();
      const planned = await planTakeoffItemRemeasure(context, { projectId: PROJECT, planKeys: [PLAN_FILE], itemIds: [ids[1]],
        selection: SELECTION });
      if (!("plan" in planned)) throw new Error("expected a plan");
      const targets = [{ item_id: ids[1], answers: ["dddddddd-0000-4000-8000-000000000001"] }];
      await expect(launchTakeoffItemRemeasure(context, { projectId: PROJECT, intentKey: "aaaaaaaa-0000-4000-8000-0000000000aa",
        plan: planned.plan, selection: SELECTION, targets, confirmation: CONFIRMED })).resolves.toEqual({ outcome: "admitted", requestId: REQUEST });
      expect(remeasured).toEqual([expect.objectContaining({ p_tenant_id: TENANT, p_project_id: PROJECT, p_actor: PAYER,
        p_intent_key: "aaaaaaaa-0000-4000-8000-0000000000aa", p_predecessor_job_id: LATEST_JOB, p_host: HOST, p_plan_set_id: PLAN_SET,
        p_preparation_revision: 2, p_plan_file_ids: [PLAN_FILE], p_targets: targets, p_selection: SELECTION,
        p_confirmation: CONFIRMED })]);
      const sent = remeasured[0] as { p_manifest: AnyTakeoffLaunchManifest; p_jobs: Array<{ launch_unit_key: string }> };
      expect(sent.p_jobs.map(({ launch_unit_key: key }) => key)).toEqual(sent.p_manifest.units.map(({ key }) => key));
      expect(runLocalTakeoffAttempts).toHaveBeenCalled();

      vi.mocked(sealedMeasuringOrder).mockResolvedValueOnce(itemListSeal(12));
      const stale = setup({ outcome: "stale", request_id: null, job_id: null, stale: [ids[1]] });
      const again = await planTakeoffItemRemeasure(stale.context, { projectId: PROJECT, planKeys: [PLAN_FILE], itemIds: [ids[1]],
        selection: SELECTION });
      if (!("plan" in again)) throw new Error("expected a plan");
      vi.mocked(runLocalTakeoffAttempts).mockClear();
      await expect(launchTakeoffItemRemeasure(stale.context, { projectId: PROJECT, intentKey: "aaaaaaaa-0000-4000-8000-0000000000ab",
        plan: again.plan, selection: SELECTION, targets, confirmation: CONFIRMED })).resolves.toEqual({ outcome: "stale", stale: [ids[1]] });
      expect(runLocalTakeoffAttempts).not.toHaveBeenCalled();
    });

    it("says each refusal of the admission in French, never the database's code", async () => {
      for (const [error, expected] of [
        [{ code: "22023", message: "TAKEOFF_ITEM_REMEASURE_INVALID" }, { status: 422, message: "La demande de nouvelle mesure est invalide : rouvrez l’aperçu." }],
        [{ code: "55000", message: "TAKEOFF_ITEM_REMEASURE_INACTIVE" }, { status: 503 }],
        [{ code: "22023", message: "TAKEOFF_LAUNCH_SEAL_INVALID" }, { status: 409,
          message: "La préparation du métré ou la liste des postes a changé depuis l’aperçu : rouvrez-le avant de confirmer." }],
        [{ code: "42501", message: "TAKEOFF_LAUNCH_PAYER_NOT_ELIGIBLE" }, { status: 403 }],
        [{ code: "23505", message: "TAKEOFF_LAUNCH_INTENT_CONFLICT" }, { status: 409 }],
      ] as const) {
        vi.mocked(sealedMeasuringOrder).mockResolvedValueOnce(itemListSeal(12));
        const { context } = setup(error);
        const planned = await planTakeoffItemRemeasure(context, { projectId: PROJECT, planKeys: [PLAN_FILE], itemIds: [ids[1]],
          selection: SELECTION });
        if (!("plan" in planned)) throw new Error("expected a plan");
        const refused = await launchTakeoffItemRemeasure(context, { projectId: PROJECT, intentKey: "aaaaaaaa-0000-4000-8000-0000000000aa",
          plan: planned.plan, selection: SELECTION, targets: [], confirmation: CONFIRMED }).then(() => null, (caught: unknown) => caught);
        expect(refused).toMatchObject(expected);
        expect(String((refused as Error).message)).not.toMatch(/TAKEOFF_/);
      }
    });
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

  // Budget fix round: a command of one analysis per plan reads each plan in its own job: the page limit of a reading is
  // each plan's, never the plans' together.
  it("refuses a command one of whose plans exceeds the limit of a reading, before any unit is admitted", async () => {
    const { run, launched } = planCommand({ a: 201, b: 3 });
    // Budget closing round: the plan is named.
    await expect(run([PLAN_FILE, PLAN_B])).rejects.toMatchObject({ code: "TAKEOFF_FILE_TOO_LARGE",
      message: expect.stringContaining("« plan-a.pdf »") });
    expect(launched).toEqual([]);
    const together = planCommand({ a: 150, b: 150 });
    await expect(together.run([PLAN_FILE, PLAN_B])).resolves.toMatchObject({ outcome: "admitted" });
    expect(together.launched).toHaveLength(1);
  });

  // Budget closing round: a plan whose row stores no count is counted on its bytes, and that count is checked against the
  // current limit of a reading, the plan named; a count the confirmation once admitted at a higher limit does not stand.
  it("refuses, naming it, a plan whose pages counted on its bytes exceed the current limit of a reading", async () => {
    const document = await PDFDocument.create();
    for (let page = 0; page < 201; page += 1) document.addPage([20, 20]);
    const { run, launched } = planCommand({ a: null, b: 3 }, null, await document.save());
    await expect(run([PLAN_FILE])).rejects.toMatchObject({ code: "TAKEOFF_FILE_TOO_LARGE",
      message: expect.stringContaining("« plan-a.pdf »") });
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
  type Copy = { id: string; name: string; document: string | null; generation: string | null;
    /** An upload to the plan set whose metadata names a dossier piece: the database records the copy itself as its source. */
    strayPiece?: string;
    /** When the database recorded the copy (its insert); by default in the order the copies are first named here. */
    recordedAt?: string };
  function affaireHistory(input: {
    copies: Copy[]; confirmed: string[];
    /** Newest first; `grouped`: one unit holding every plan (format 1), whose state is `states.grouped`. */
    requests: Array<{ id: string; plans: Copy[]; states?: Record<string, string>; notRequested?: Copy[]; grouped?: boolean }>;
    /**
     * The analysis a command replaces: one plan's unit of one of the requests, or an analysis launched outside any request
     * (`requestId` null, no unit) whose snapshot read `snapshotPlans`.
     */
    predecessor: { id: string; requestId: string | null; unitKey: string | null; snapshotPlans?: Copy[] };
    /** The receipts the database holds: by the plans a command's identity names (none by default). */
    receipt?: (planFileIds: string[] | null) => { data: unknown; error: { code: string; message: string } | null };
    /** Copies in the plan set that are not their piece's current copy (an older generation the sync has not reserved yet). */
    stale?: string[];
    /** Dossier pieces removed from the dossier; every other piece is a classified plan of the dossier. */
    removedPieces?: string[];
    /** Every read of the plan set's copies, of their recorded sources or of a copy's current state fails. */
    lookupsFail?: boolean;
    /** Copies the plan set held and the dossier sync removed since (their sources stay recorded). */
    formerCopies?: Copy[];
  }) {
    const launched: Array<Record<string, unknown>> = [];
    const replays: Array<Record<string, unknown>> = [];
    const metadata = (copy: Copy) => (copy.document ? { source: "affaire-intake", intake_document_id: copy.document,
      intake_storage_path: `${TENANT}/dossier/${copy.document}.pdf`, intake_generation: copy.generation }
      : copy.strayPiece ? { intake_document_id: copy.strayPiece } : {});
    const rows = input.copies.map((copy) => ({ id: copy.id, tenant_id: TENANT, plan_set_id: PLAN_SET,
      file_path: `${TENANT}/${PLAN_SET}/${copy.id}/${copy.name}`, file_name: copy.name, file_type: "application/pdf",
      file_size_bytes: 8, page_count: 1, metadata: metadata(copy), created_at: "2026-11-21T08:00:00Z" }));
    const sealed = (plan: Copy) => ({ id: plan.id, name: plan.name, intake_document_id: plan.document, generation: plan.generation });
    let jobIndex = 0;
    const requests = input.requests.map((request, index) => {
      const units = request.grouped ? [{ key: "grouped", ordinal: 1, plans: request.plans.map((plan) => plan.id), pages: [] }]
        : request.plans.map((plan, ordinal) => ({ key: `plan:${plan.id}`, ordinal: ordinal + 1, plans: [plan.id], pages: [] }));
      return { id: request.id, tenant_id: TENANT, project_id: PROJECT, state: "closed",
        created_at: new Date(Date.UTC(2026, 10, 21, 12) - index * 60_000).toISOString(),
        manifest: { format_version: request.grouped ? 1 : 2, units,
          // As the server sealed them before the recorded source decided identity: an upload's metadata piece included.
          plans: request.plans.map((plan) => ({ entry_key: plan.id, plan_file_id: plan.id, name: plan.name,
            logical_id: plan.document ?? plan.strayPiece ?? plan.id, intake_document_id: plan.document ?? plan.strayPiece ?? null,
            generation: plan.generation, pages: [] })),
          coverage: { plans_omitted: (request.notRequested ?? []).map((plan) => ({ ...sealed(plan), reason: "not_requested" })) } },
        takeoff_jobs: units.map((unit) => unitJob(request.id, unit.key,
          request.states?.[request.grouped ? "grouped" : unit.plans[0]!] ?? "succeeded", (jobIndex += 1))) };
    });
    const snapshotOf = (plans: Copy[]) => ({ preparation: { sources: plans.map((plan) => ({ document_id: plan.id,
      document_name: plan.name, kind: "plan", active: true })) } });
    const unitPlan = input.predecessor.unitKey?.startsWith("plan:")
      ? input.requests.flatMap((request) => request.plans).find((plan) => `plan:${plan.id}` === input.predecessor.unitKey) : undefined;
    const jobs = [{ id: input.predecessor.id, tenant_id: TENANT, project_id: PROJECT, launch_request_id: input.predecessor.requestId,
      launch_unit_key: input.predecessor.unitKey, preparation_snapshot: input.predecessor.snapshotPlans
        ? snapshotOf(input.predecessor.snapshotPlans) : unitPlan ? snapshotOf([unitPlan]) : null }];
    // The source of every copy the plan set ever held, as the database recorded it at the copy's insert and keeps it once
    // the copy is gone (takeoff_plan_location_sources).
    const everyCopy = [...input.requests.slice().reverse().flatMap((request) => [...request.plans, ...(request.notRequested ?? [])]),
      ...(input.predecessor.snapshotPlans ?? []), ...(input.formerCopies ?? []), ...input.copies];
    const firstSeen = new Map<string, { copy: Copy; index: number }>();
    everyCopy.forEach((copy, index) => { if (!firstSeen.has(copy.id)) firstSeen.set(copy.id, { copy, index }); });
    // In the database's order of recording (its own timestamps, then the copy), as the queries ask it.
    const registry = [...firstSeen.values()].map(({ copy, index }) => ({ plan_file_id: copy.id, plan_set_id: PLAN_SET,
      tenant_id: TENANT, project_id: PROJECT, source_kind: copy.document ? "intake_document" : "plan_file",
      source_id: copy.document ?? copy.id, recorded_at: copy.recordedAt ?? new Date(Date.UTC(2026, 10, 1) + index * 60_000).toISOString() }))
      .sort((left, right) => left.recorded_at.localeCompare(right.recorded_at) || left.plan_file_id.localeCompare(right.plan_file_id));
    const pieces = [...new Set(everyCopy.flatMap((copy) => (copy.document ? [copy.document] : [])))].map((id) => ({ id,
      tenant_id: TENANT, project_id: PROJECT, upload_status: "uploaded", classification_status: "classified", document_kind: "plans",
      deleted_at: input.removedPieces?.includes(id) ? "2026-11-21T09:00:00Z" : null, deletion_token: null }));
    // A read by identifier (maybeSingle) gets its row; a list, the rows PostgREST serves (newest first here).
    const served = (all: Array<Record<string, unknown>>) => (query: FakeQuery) => {
      const answer = servedRows(all, query);
      return query.cardinality === "many" ? answer : { data: (answer.data as unknown[])[0] ?? null, error: null };
    };
    const failing = { data: null, error: { code: "08006", message: "connection failure" }, count: null };
    const fake = createSupabaseFake({
      tables: {
        plan_files: (query: FakeQuery) => (input.lookupsFail ? failing : servedRows(rows, query)),
        takeoff_launch_requests: served(requests), takeoff_jobs: served(jobs),
        takeoff_plan_location_sources: (query: FakeQuery) => (input.lookupsFail ? failing : servedRows(registry, query)),
        affaire_intake_documents: (query: FakeQuery) => servedRows(pieces, query),
      },
      storage: { [PLAN_FILES_BUCKET]: () => ({ data: null, error: { message: "Object not found", statusCode: "404" } }) },
      rpc: {
        replay_manual_takeoff_plan_request: (args) => {
          replays.push(args as Record<string, unknown>);
          return input.receipt?.((args as { p_plan_file_ids: string[] | null }).p_plan_file_ids) ?? { data: [], error: null };
        },
        takeoff_plan_dispatch_is_active: () => ({ data: true, error: null }),
        takeoff_item_list_order_is_active: () => ({ data: false, error: null }),
        can_access_takeoff_project: () => ({ data: true, error: null }),
        // The database's reader of one request's units, from the same states (the walk should not need it).
        read_takeoff_launch_request_units: (args) => {
          const request = requests.find((entry) => entry.id === (args as { p_request_id: string }).p_request_id)!;
          const states = new Map(input.requests.map((entry) => [entry.id, entry.states ?? {}]));
          return { data: { request_id: request.id, format: request.manifest.format_version === 2 ? "per_plan" : "grouped",
            units: request.manifest.units.map((unit) => ({ key: unit.key, ordinal: unit.ordinal,
              state: states.get(request.id)?.[request.manifest.format_version === 2 ? unit.plans[0]! : "grouped"] ?? "succeeded" })) },
          error: null };
        },
        // The plan-location reader's decision (read_takeoff_plan_location_source): a copy present in the plan set is its
        // piece's current copy unless an older generation; a copy gone is resolved from its recorded source, never current.
        read_takeoff_plan_location_source: (args) => {
          if (input.lookupsFail) return failing;
          const id = (args as { p_plan_file_id: string }).p_plan_file_id;
          const recorded = registry.find((entry) => entry.plan_file_id === id);
          if (!recorded) return { data: [], error: null };
          const present = rows.some((row) => row.id === id);
          const piece = pieces.find((entry) => entry.id === recorded.source_id);
          return { data: [{ source_kind: recorded.source_kind, source_id: recorded.source_id, plan_file_id: id, can_write: true,
            current_copy: present && !input.stale?.includes(id) && (recorded.source_kind === "plan_file" || !piece?.deleted_at) }], error: null };
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
    return { runFromDialogue, run, launched, replays, rows, documents, fake };
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
    // Its receipt was looked up first under the copies the analysis read, before any read of the plan set; none: the
    // command is recorded under the copy it reads.
    expect(history.replays).toEqual([expect.objectContaining({ p_plan_file_ids: [A_BEFORE.id], p_plans_named: false })]);
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

  // A plan with no working copy now (its piece left the dossier, or its copy is missing): the relaunch is refused, saying
  // so (the member cannot confirm the options with a plan that has no copy).
  it.each([
    ["left the dossier", true, "« plan-a.pdf » n’est plus dans les plans de l’affaire : cette analyse ne peut plus être relancée."],
    ["has no copy for now", false, "« plan-a.pdf » n’a pas de copie de travail pour l’instant (manquante ou illisible) : l’analyse "
      + "se relance quand ce plan a de nouveau sa copie."],
  ] as const)("refuses the relaunch of an analysis whose only plan %s, saying so", async (_case, removed, message) => {
    const history = affaireHistory({ copies: [B_COPY], confirmed: [B_COPY.id], requests: [{ id: FIRST_REQUEST, plans: [A_BEFORE, B_COPY] }],
      removedPieces: removed ? [PIECE_A] : [],
      predecessor: { id: JOB_OF_A, requestId: FIRST_REQUEST, unitKey: `plan:${A_BEFORE.id}` } });
    await expect(history.runFromDialogue()).rejects.toMatchObject({ status: 422, message });
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

  // The requests are read from the latest, a thousand a page: here a thousand later requests read A again without
  // success, and only the oldest, on the second page, read it. Its reading is inherited across the page.
  it("finds a plan's last successful reading past the first page of the affaire's requests", async () => {
    const later = Array.from({ length: 1000 }, (_, index) => ({
      id: `aaaaaaaa-0000-4000-8000-00000001${String(index).padStart(4, "0")}`, plans: [A_BEFORE],
      states: { [A_BEFORE.id]: index % 2 ? "canceled" : "failed" }, notRequested: [B_COPY] }));
    const history = affaireHistory({ copies: [A_BEFORE, B_COPY, C_COPY], confirmed: [A_BEFORE.id, B_COPY.id, C_COPY.id],
      requests: [...later, { id: FIRST_REQUEST, plans: [A_BEFORE, B_COPY] }],
      predecessor: { id: JOB_OF_A, requestId: later[0].id, unitKey: `plan:${A_BEFORE.id}` } });
    await expect(history.run([C_COPY.id])).resolves.toMatchObject({ outcome: "admitted" });
    const manifest = history.launched[0].p_manifest as AnyTakeoffLaunchManifest;
    expect(manifest.coverage.plans_omitted).toEqual(expect.arrayContaining([
      { id: A_BEFORE.id, name: "plan-a.pdf", reason: "not_requested", intake_document_id: PIECE_A, generation: "generation-1" }]));
    expect(manifest.coverage.plans_omitted).toHaveLength(2);
    // Two pages of requests: the oldest was on the second.
    expect(history.fake.queries.filter(({ table }) => table === "takeoff_launch_requests").map(({ range }) => range))
      .toEqual([[0, 999], [1000, 1999]]);
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

  // Fix round 1. A command recorded before one analysis per plan (its identity names every plan of the preparation)
  // retried later: its receipt answers first, under the copies the analysis read, before any read of the plan set, even
  // when the analysis's copy was deleted since or the plan set cannot be read.
  it.each([["after its analysis's copy was deleted", false], ["while the plan set's copies cannot be read", true]] as const)(
    "answers a recorded grouped relaunch by its receipt %s", async (_case, lookupsFail) => {
      const history = affaireHistory({ copies: [B_COPY], confirmed: [B_COPY.id], requests: [], lookupsFail,
        predecessor: { id: JOB_OF_A, requestId: null, unitKey: null, snapshotPlans: [A_BEFORE, B_COPY] },
        // M4's identity: the database answers it whatever plans the lookup names (replay_manual_takeoff_plan_request).
        receipt: () => ({ data: [{ outcome: "replayed", request_id: SECOND_REQUEST, job_id: "aaaaaaaa-0000-4000-8000-0000000000b2" }],
          error: null }) });
      await expect(history.runFromDialogue()).resolves.toEqual({ outcome: "replayed", requestId: SECOND_REQUEST,
        jobId: "aaaaaaaa-0000-4000-8000-0000000000b2" });
      expect(history.replays).toEqual([expect.objectContaining({ p_plan_file_ids: [A_BEFORE.id, B_COPY.id].sort(), p_plans_named: false })]);
      expect(history.fake.queries.filter(({ table }) => table === "plan_files" || table === "takeoff_plan_location_sources")).toEqual([]);
      expect(history.fake.rpcCalls.map(({ fn }) => fn)).not.toContain("read_takeoff_plan_location_source");
      expect(assertConfirmedTakeoffPreparation).not.toHaveBeenCalled();
    });

  // The dossier moved A to its second generation before the sync reserved the first copy for its cleanup: that copy is
  // still in the plan set, but it is not A's current copy (the plan-location reader's decision).
  it("relaunches a replaced plan at its current copy while its older copy is still in the plan set", async () => {
    const history = affaireHistory({ copies: [A_BEFORE, A_AFTER, B_COPY], confirmed: [A_AFTER.id, B_COPY.id], stale: [A_BEFORE.id],
      requests: [{ id: FIRST_REQUEST, plans: [A_BEFORE, B_COPY] }],
      predecessor: { id: JOB_OF_A, requestId: FIRST_REQUEST, unitKey: `plan:${A_BEFORE.id}` } });
    await expect(history.runFromDialogue()).resolves.toMatchObject({ outcome: "admitted" });
    expect(history.launched[0]).toMatchObject({ p_plan_file_ids: [A_AFTER.id] });
  });

  // Request 1 reads A and B; a later grouped analysis retains only A and reads it; request 3 reads C: B keeps request 1's
  // reading, whatever the request that ended the walk.
  it("keeps a plan's earlier reading when a later grouped analysis did not read it", async () => {
    const history = affaireHistory({ copies: [A_BEFORE, B_COPY, C_COPY], confirmed: [A_BEFORE.id, B_COPY.id, C_COPY.id],
      requests: [{ id: SECOND_REQUEST, plans: [A_BEFORE], grouped: true }, { id: FIRST_REQUEST, plans: [A_BEFORE, B_COPY] }],
      predecessor: { id: JOB_OF_A, requestId: SECOND_REQUEST, unitKey: "grouped" } });
    await expect(history.run([C_COPY.id])).resolves.toMatchObject({ outcome: "admitted" });
    const manifest = history.launched[0].p_manifest as AnyTakeoffLaunchManifest;
    expect(manifest.coverage.plans_omitted).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: A_BEFORE.id, reason: "not_requested" }),
      { id: B_COPY.id, name: "plan-b.pdf", reason: "not_requested", intake_document_id: PIECE_B, generation: "generation-1" }]));
    expect(manifest.coverage.plans_omitted).toHaveLength(2);
  });

  // An upload to the plan set whose metadata names a dossier piece is a plan of its own (the database records the copy
  // itself as its source): reading it never stands in for that piece's reading.
  const UPLOAD_A: Copy = { id: "aaaaaaaa-0000-4000-8000-000000000055", name: "plan-a-envoi.pdf", document: null, generation: null,
    strayPiece: PIECE_A };
  it("never lets an upload naming a dossier piece in its metadata stand in for that piece's reading", async () => {
    const history = affaireHistory({ copies: [A_BEFORE, UPLOAD_A, C_COPY], confirmed: [A_BEFORE.id, UPLOAD_A.id, C_COPY.id],
      requests: [{ id: FIRST_REQUEST, plans: [A_BEFORE] }],
      predecessor: { id: JOB_OF_A, requestId: FIRST_REQUEST, unitKey: `plan:${A_BEFORE.id}` } });
    await expect(history.run([UPLOAD_A.id])).resolves.toMatchObject({ outcome: "admitted" });
    const manifest = history.launched[0].p_manifest as AnyTakeoffLaunchManifest;
    expect(manifest.plans).toEqual([expect.objectContaining({ plan_file_id: UPLOAD_A.id, intake_document_id: null,
      logical_id: UPLOAD_A.id })]);
    expect(manifest.coverage.plans_omitted).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: A_BEFORE.id, reason: "not_requested", intake_document_id: PIECE_A })]));
  });

  // The walk reads the affaire's analysed requests with their units in one statement, whatever their number: forty later
  // requests named A without reading it, and only the oldest read it.
  it("reads the affaire's analysed requests and their units in one statement, whatever their number", async () => {
    const later = Array.from({ length: 40 }, (_, index) => ({
      id: `aaaaaaaa-0000-4000-8000-0000000002${String(index).padStart(2, "0")}`, plans: [A_BEFORE],
      states: { [A_BEFORE.id]: "failed" } }));
    const history = affaireHistory({ copies: [A_BEFORE, B_COPY, C_COPY], confirmed: [A_BEFORE.id, B_COPY.id, C_COPY.id],
      requests: [...later, { id: FIRST_REQUEST, plans: [A_BEFORE, B_COPY] }],
      predecessor: { id: JOB_OF_A, requestId: later[0].id, unitKey: `plan:${A_BEFORE.id}` } });
    await expect(history.run([C_COPY.id])).resolves.toMatchObject({ outcome: "admitted" });
    expect((history.launched[0].p_manifest as AnyTakeoffLaunchManifest).coverage.plans_omitted.map(({ id }) => id).sort())
      .toEqual([A_BEFORE.id, B_COPY.id].sort());
    expect(history.fake.queries.filter(({ table }) => table === "takeoff_launch_requests")).toHaveLength(1);
    expect(history.fake.rpcCalls.filter(({ fn }) => fn === "read_takeoff_launch_request_units")).toEqual([]);
  });

  // The analysis read A0; the same command was recorded when A's current copy was A1, and is retried after A2 replaced
  // it: its receipt is found under that identity, one of those the chain of replacements went through.
  it("answers a relaunch recorded against a copy replaced since, after a second replacement, by its receipt", async () => {
    const A0: Copy = { ...A_BEFORE, recordedAt: "2026-11-10T08:00:00.000Z" };
    const A1: Copy = { id: "aaaaaaaa-0000-4000-8000-000000000056", name: "plan-a.pdf", document: PIECE_A, generation: "generation-2",
      recordedAt: "2026-11-12T08:00:00.000Z" };
    const A2: Copy = { id: "aaaaaaaa-0000-4000-8000-000000000057", name: "plan-a.pdf", document: PIECE_A, generation: "generation-3",
      recordedAt: "2026-11-14T08:00:00.000Z" };
    const history = affaireHistory({ copies: [A2, B_COPY], confirmed: [A2.id, B_COPY.id], formerCopies: [A1],
      requests: [{ id: FIRST_REQUEST, plans: [A0, B_COPY] }],
      predecessor: { id: JOB_OF_A, requestId: FIRST_REQUEST, unitKey: `plan:${A0.id}` },
      receipt: (ids) => (ids?.length === 1 && ids[0] === A1.id
        ? { data: [{ outcome: "replayed", request_id: SECOND_REQUEST, job_id: "aaaaaaaa-0000-4000-8000-0000000000b3" }], error: null }
        : { data: null, error: { code: "23505", message: "TAKEOFF_LAUNCH_INTENT_CONFLICT" } }) });
    await expect(history.runFromDialogue()).resolves.toEqual({ outcome: "replayed", requestId: SECOND_REQUEST,
      jobId: "aaaaaaaa-0000-4000-8000-0000000000b3" });
    expect(history.launched).toEqual([]);
    expect(assertConfirmedTakeoffPreparation).not.toHaveBeenCalled();
  });

  // A grouped analysis read A and B; A has no working copy now. The relaunch of that group is not admitted: the member is
  // told why, by name, and offered B, which a command naming it then reads alone.
  it.each([["was removed from the dossier", true, "removed"], ["has no copy for now", false, "copy_missing"]] as const)(
    "offers the other plans of an analysis whose plan A %s", async (_case, removed, reason) => {
      const history = affaireHistory({ copies: [B_COPY], confirmed: [B_COPY.id], requests: [], removedPieces: removed ? [PIECE_A] : [],
        predecessor: { id: JOB_OF_A, requestId: null, unitKey: null, snapshotPlans: [A_BEFORE, B_COPY] } });
      await expect(history.runFromDialogue()).resolves.toEqual({ outcome: "plans_to_choose", requestId: null, jobId: null,
        choice: { withoutCopy: [{ name: "plan-a.pdf", reason }], remaining: [{ id: B_COPY.id, name: "plan-b.pdf" }] } });
      expect(history.launched).toEqual([]);
      await expect(history.run([B_COPY.id])).resolves.toMatchObject({ outcome: "admitted" });
      expect(history.launched[0]).toMatchObject({ p_plan_file_ids: [B_COPY.id], p_predecessor_job_id: JOB_OF_A });
    });

  // Review of fix round 1. Request 1 read A and B; B left the dossier; a later grouped analysis read A alone. A command
  // reading C never records B as read before: it is no longer a plan of the plan set, and the dossier is not told
  // « retiré » again for a removal the later analysis already sealed.
  it("never sets aside as read before a plan that is no longer in the plan set", async () => {
    const history = affaireHistory({ copies: [A_BEFORE, C_COPY], confirmed: [A_BEFORE.id, C_COPY.id], removedPieces: [PIECE_B],
      requests: [{ id: SECOND_REQUEST, plans: [A_BEFORE], grouped: true }, { id: FIRST_REQUEST, plans: [A_BEFORE, B_COPY] }],
      predecessor: { id: JOB_OF_A, requestId: SECOND_REQUEST, unitKey: "grouped" } });
    await expect(history.run([C_COPY.id])).resolves.toMatchObject({ outcome: "admitted" });
    const manifest = history.launched[0].p_manifest as AnyTakeoffLaunchManifest;
    expect(manifest.coverage.plans_omitted).toEqual([expect.objectContaining({ id: A_BEFORE.id, reason: "not_requested" })]);
    expect(describeDossierChangeSinceAnalysis(manifest, history.rows, history.documents)).toBeNull();
  });

  // A revision the member set aside in the confirmed preparation stays set aside, even when an earlier analysis read it.
  it("keeps a revision the member set aside as set aside, though an earlier analysis read it", async () => {
    const history = affaireHistory({ copies: [A_BEFORE, B_COPY, C_COPY], confirmed: [B_COPY.id, C_COPY.id],
      requests: [{ id: FIRST_REQUEST, plans: [A_BEFORE, B_COPY] }],
      predecessor: { id: JOB_OF_A, requestId: FIRST_REQUEST, unitKey: `plan:${A_BEFORE.id}` } });
    await expect(history.run([C_COPY.id])).resolves.toMatchObject({ outcome: "admitted" });
    const manifest = history.launched[0].p_manifest as AnyTakeoffLaunchManifest;
    expect(manifest.coverage.plans_omitted).toEqual(expect.arrayContaining([{ id: A_BEFORE.id, name: "plan-a.pdf", reason: "alternate" },
      expect.objectContaining({ id: B_COPY.id, reason: "not_requested" })]));
    expect(manifest.coverage.plans_omitted).toHaveLength(2);
  });

  // A grouped analysis read A, B and C; A has no copy now and C's current copy is not in the member's confirmed options:
  // the member is asked to confirm the options first, never offered B alone without being told about C.
  it("asks to confirm the options before offering the other plans when one of them is not in the confirmed preparation", async () => {
    const C_AFTER: Copy = { id: "aaaaaaaa-0000-4000-8000-000000000058", name: "plan-c.pdf", document: PIECE_C, generation: "generation-2" };
    const history = affaireHistory({ copies: [B_COPY, C_AFTER], confirmed: [B_COPY.id], requests: [], removedPieces: [PIECE_A],
      predecessor: { id: JOB_OF_A, requestId: null, unitKey: null, snapshotPlans: [A_BEFORE, B_COPY, C_COPY] } });
    await expect(history.runFromDialogue()).rejects.toMatchObject({ status: 422,
      message: "Ce plan ne fait pas partie de la préparation confirmée : confirmez les options du métré avec ce plan, puis relancez." });
    expect(history.launched).toEqual([]);
  });

  // The current-copy reader is asked only about the copies the plan set holds: a deleted copy of the piece is never current.
  it("asks the current-copy reader only about copies the plan set holds", async () => {
    const A_GONE: Copy = { id: "aaaaaaaa-0000-4000-8000-000000000059", name: "plan-a.pdf", document: PIECE_A, generation: "generation-0" };
    const history = affaireHistory({ copies: [A_AFTER, B_COPY], confirmed: [A_AFTER.id, B_COPY.id], formerCopies: [A_GONE],
      requests: [{ id: FIRST_REQUEST, plans: [A_BEFORE, B_COPY] }],
      predecessor: { id: JOB_OF_A, requestId: FIRST_REQUEST, unitKey: `plan:${A_BEFORE.id}` } });
    await expect(history.runFromDialogue()).resolves.toMatchObject({ outcome: "admitted" });
    const asked = history.fake.rpcCalls.filter(({ fn }) => fn === "read_takeoff_plan_location_source")
      .map(({ args }) => (args as { p_plan_file_id: string }).p_plan_file_id).sort();
    expect(asked).toEqual([A_BEFORE.id, A_AFTER.id].sort());
  });

  // A conflict under the key: only the identities the command can have had after the analysis it replaces are tried, one
  // per copy recorded since (two copies recorded at once included), never the copies recorded before it.
  it("tries, on a conflict, only the identities a relaunch can have had since its analysis", async () => {
    const A_EARLIER: Copy = { id: "aaaaaaaa-0000-4000-8000-00000000005a", name: "plan-a.pdf", document: PIECE_A, generation: "generation-0",
      recordedAt: "2026-11-01T08:00:00.000Z" };
    const A0: Copy = { ...A_BEFORE, recordedAt: "2026-11-10T08:00:00.000Z" };
    const A1: Copy = { id: "aaaaaaaa-0000-4000-8000-000000000056", name: "plan-a.pdf", document: PIECE_A, generation: "generation-2",
      recordedAt: "2026-11-12T08:00:00.000Z" };
    const A1_TWIN: Copy = { id: "aaaaaaaa-0000-4000-8000-00000000005b", name: "plan-a.pdf", document: PIECE_A, generation: "generation-2",
      recordedAt: "2026-11-12T08:00:00.000Z" };
    const history = affaireHistory({ copies: [A1, B_COPY], confirmed: [A1.id, B_COPY.id], formerCopies: [A_EARLIER, A1_TWIN],
      requests: [{ id: FIRST_REQUEST, plans: [A0, B_COPY] }],
      predecessor: { id: JOB_OF_A, requestId: FIRST_REQUEST, unitKey: `plan:${A0.id}` },
      receipt: () => ({ data: null, error: { code: "23505", message: "TAKEOFF_LAUNCH_INTENT_CONFLICT" } }) });
    await expect(history.runFromDialogue()).rejects.toMatchObject({ status: 409 });
    expect(history.replays.map((replay) => (replay as { p_plan_file_ids: string[] }).p_plan_file_ids)).toEqual(
      [[A0.id], [A1_TWIN.id], [A1.id]]);
  });

  // The copies recorded since are counted per piece: A's replacement recorded before B's own copy is still an identity
  // of the relaunch of a grouped analysis of A and B.
  it("finds a grouped relaunch's receipt under a replacement recorded before another plan's copy", async () => {
    const A0: Copy = { ...A_BEFORE, recordedAt: "2026-11-10T08:00:00.000Z" };
    const A1: Copy = { id: "aaaaaaaa-0000-4000-8000-000000000056", name: "plan-a.pdf", document: PIECE_A, generation: "generation-2",
      recordedAt: "2026-11-12T08:00:00.000Z" };
    const B_LATER: Copy = { ...B_COPY, recordedAt: "2026-11-15T08:00:00.000Z" };
    const history = affaireHistory({ copies: [A1, B_LATER], confirmed: [A1.id, B_LATER.id], requests: [],
      predecessor: { id: JOB_OF_A, requestId: null, unitKey: null, snapshotPlans: [A0, B_LATER] },
      receipt: (ids) => (ids?.join() === [A1.id, B_LATER.id].sort().join()
        ? { data: [{ outcome: "replayed", request_id: SECOND_REQUEST, job_id: "aaaaaaaa-0000-4000-8000-0000000000b4" }], error: null }
        : { data: null, error: { code: "23505", message: "TAKEOFF_LAUNCH_INTENT_CONFLICT" } }) });
    await expect(history.runFromDialogue()).resolves.toMatchObject({ outcome: "replayed", jobId: "aaaaaaaa-0000-4000-8000-0000000000b4" });
  });

  // Closing round. A0 is still in the plan set and in the confirmed options after its dossier generation changed, and
  // its replacement is not available yet: the reader calls A0 stale, so it is never read; it is offered as a plan
  // without copy.
  it("never admits a copy the reader calls stale when its replacement is unavailable", async () => {
    const history = affaireHistory({ copies: [A_BEFORE, B_COPY], confirmed: [A_BEFORE.id, B_COPY.id], stale: [A_BEFORE.id], requests: [],
      predecessor: { id: JOB_OF_A, requestId: null, unitKey: null, snapshotPlans: [A_BEFORE, B_COPY] } });
    await expect(history.runFromDialogue()).resolves.toEqual({ outcome: "plans_to_choose", requestId: null, jobId: null,
      choice: { withoutCopy: [{ name: "plan-a.pdf", reason: "copy_missing" }], remaining: [{ id: B_COPY.id, name: "plan-b.pdf" }] } });
    expect(history.launched).toEqual([]);
  });

  // An earlier grouped analysis read upload U, whose metadata names piece A (its manifest, sealed before the recorded
  // source decided identity, says so): U's reading is its own, and a command reading A keeps it as read before.
  it("never lets a historical upload naming a dossier piece in its metadata stand in for that piece", async () => {
    const history = affaireHistory({ copies: [A_BEFORE, UPLOAD_A, C_COPY], confirmed: [A_BEFORE.id, UPLOAD_A.id, C_COPY.id],
      requests: [{ id: FIRST_REQUEST, plans: [UPLOAD_A], grouped: true }],
      predecessor: { id: JOB_OF_A, requestId: FIRST_REQUEST, unitKey: "grouped" } });
    await expect(history.run([A_BEFORE.id])).resolves.toMatchObject({ outcome: "admitted" });
    const manifest = history.launched[0].p_manifest as AnyTakeoffLaunchManifest;
    expect(manifest.coverage.plans_omitted).toEqual(expect.arrayContaining([{ id: UPLOAD_A.id, name: "plan-a-envoi.pdf",
      reason: "not_requested", intake_document_id: null, generation: null }]));
  });

  // The copies are ordered by the database's own times, below the millisecond: A1 was recorded before B1 within the same
  // millisecond, so the relaunch recorded between them read A1 and B0.
  it("finds a relaunch's receipt under copies recorded within the same millisecond, in the database's order", async () => {
    const A0: Copy = { ...A_BEFORE, recordedAt: "2026-11-10T08:00:00.000000+00:00" };
    const B0: Copy = { ...B_COPY, recordedAt: "2026-11-10T08:00:00.000200+00:00" };
    const A1: Copy = { id: "aaaaaaaa-0000-4000-8000-000000000056", name: "plan-a.pdf", document: PIECE_A, generation: "generation-2",
      recordedAt: "2026-11-12T08:00:00.000100+00:00" };
    const B1: Copy = { id: "aaaaaaaa-0000-4000-8000-00000000005c", name: "plan-b.pdf", document: PIECE_B, generation: "generation-2",
      recordedAt: "2026-11-12T08:00:00.000900+00:00" };
    const history = affaireHistory({ copies: [A1, B1], confirmed: [A1.id, B1.id], requests: [],
      predecessor: { id: JOB_OF_A, requestId: null, unitKey: null, snapshotPlans: [A0, B0] },
      receipt: (ids) => (ids?.join() === [A1.id, B0.id].sort().join()
        ? { data: [{ outcome: "replayed", request_id: SECOND_REQUEST, job_id: "aaaaaaaa-0000-4000-8000-0000000000b5" }], error: null }
        : { data: null, error: { code: "23505", message: "TAKEOFF_LAUNCH_INTENT_CONFLICT" } }) });
    await expect(history.runFromDialogue()).resolves.toMatchObject({ outcome: "replayed", jobId: "aaaaaaaa-0000-4000-8000-0000000000b5" });
  });

  // The registry's history of a piece is read a page at a time: the copy holding the receipt is the newest of more than a
  // thousand recorded since the analysis.
  it("finds a relaunch's receipt past the first thousand copies of its plan", async () => {
    const A0: Copy = { ...A_BEFORE, recordedAt: new Date(Date.UTC(2026, 10, 10)).toISOString() };
    const former = Array.from({ length: 1001 }, (_, index): Copy => ({ id: `aaaaaaaa-0000-4000-9100-${String(index).padStart(12, "0")}`,
      name: "plan-a.pdf", document: PIECE_A, generation: `generation-h${index}`,
      recordedAt: new Date(Date.UTC(2026, 10, 11) + index * 1000).toISOString() }));
    const A1: Copy = { id: "aaaaaaaa-0000-4000-8000-000000000056", name: "plan-a.pdf", document: PIECE_A, generation: "generation-2",
      recordedAt: new Date(Date.UTC(2026, 10, 12)).toISOString() };
    const history = affaireHistory({ copies: [A1], confirmed: [A1.id], formerCopies: former, requests: [],
      predecessor: { id: JOB_OF_A, requestId: null, unitKey: null, snapshotPlans: [A0] },
      receipt: (ids) => (ids?.join() === A1.id
        ? { data: [{ outcome: "replayed", request_id: SECOND_REQUEST, job_id: "aaaaaaaa-0000-4000-8000-0000000000b6" }], error: null }
        : { data: null, error: { code: "23505", message: "TAKEOFF_LAUNCH_INTENT_CONFLICT" } }) });
    await expect(history.runFromDialogue()).resolves.toMatchObject({ outcome: "replayed", jobId: "aaaaaaaa-0000-4000-8000-0000000000b6" });
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
  function command(answer: { data?: unknown; error?: { code: string; message: string } }, options: { listActive?: boolean } = {}) {
    const calls: string[] = [];
    const launched: Array<Record<string, unknown>> = [];
    const service = createSupabaseFake({ rpc: {
      // One analysis per plan not activated: the grouped command (lot 3's command of plans has its own cases above).
      takeoff_plan_dispatch_is_active: () => ({ data: false, error: null }),
      // The receipt, read first under either identity of the command: none.
      replay_manual_takeoff_plan_request: () => ({ data: [], error: null }),
      // Lot 4: the second measuring order, not active unless a case says so.
      takeoff_item_list_order_is_active: () => ({ data: options.listActive === true, error: null }),
      launch_manual_takeoff_request: (args) => {
        calls.push("launch");
        launched.push(args as Record<string, unknown>);
        return { data: answer.data ?? null, error: answer.error ?? null };
      },
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
    return { launch, calls, launched };
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

  // Lot 4: a grouped command (one analysis per plan not active) seals the free extraction, whatever the second order's
  // activation says: the list is answered plan by plan.
  it("seals the free extraction in a grouped command, whatever the second order's activation says", async () => {
    const { launch, calls, launched } = command({ data: [{ outcome: "admitted", request_id: REQUEST, job_id: "aaaaaaaa-0000-4000-8000-0000000000ee" }] },
      { listActive: true });
    await expect(launch("aaaaaaaa-0000-4000-8000-0000000000bb")).resolves.toMatchObject({ outcome: "admitted" });
    expect(calls).toEqual(["launch"]);
    expect(launched[0].p_manifest).toMatchObject({ format_version: 1, order: { kind: "free_extraction", version: 1, list: null } });
    expect(sealedMeasuringOrder).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ perPlan: false }));
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

// Budget fix round: a request read plan by plan, whichever its measuring order, holds the page limit of a reading on each
// plan (what one job reads), never on the dossier's pages together; a grouped request, one job, keeps the aggregate check.
describe("the page limit of a request read plan by plan", () => {
  const planId = (index: number) => `aaaaaaaa-0000-4000-8000-${String(0x500 + index).padStart(12, "0")}`;
  const documentId = (index: number) => `aaaaaaaa-0000-4000-8000-${String(0x600 + index).padStart(12, "0")}`;
  const planName = (index: number) => `Plan zone ${String(index + 1).padStart(2, "0")}.pdf`;
  /** A plan's PDF of `pages` pages, its bytes its own (no two plans are copies of each other). */
  async function planPdf(pages: number, index: number) {
    const document = await PDFDocument.create();
    document.setTitle(`Plan fictif ${index + 1}`);
    for (let page = 0; page < pages; page += 1) document.addPage([20 + index, 20]);
    return document.save();
  }

  /** The dossier of an automatic start with one plan copy per entry of `pages`, each counted on its stored row. */
  async function plansDossier(pages: number[], input: { perPlan: boolean }) {
    const bytes = await Promise.all(pages.map((count, index) => planPdf(count, index)));
    const documents = pages.map((_, index) => ({
      id: documentId(index), tenant_id: TENANT, project_id: PROJECT, upload_id: UPLOAD, created_by: PAYER,
      storage_path: `${TENANT}/${PROJECT}/${UPLOAD}/${documentId(index)}/plan-${index + 1}.pdf`, deletion_token: null,
      plan_copy_generation: "generation-2", file_name: planName(index), mime_type: "application/pdf", size_bytes: bytes[index].byteLength,
      upload_status: "uploaded", rejection_reason: null, classification_status: "classified", document_kind: "plans",
      document_priority: "primary", confidence: 0.92, issues: [], extracted_metadata: {}, classification_source: "heuristic",
      classified_by: null, classified_at: "2026-11-21T08:00:00Z", manually_overridden_at: null, source_provider: null }));
    const copies = pages.map((count, index) => ({ id: planId(index), tenant_id: TENANT, plan_set_id: PLAN_SET,
      file_path: `${TENANT}/${PLAN_SET}/${planId(index)}/plan-${index + 1}.pdf`,
      file_name: `plan-${index + 1}.pdf`, file_size_bytes: bytes[index].byteLength, file_type: "application/pdf", page_count: count,
      metadata: { source: "affaire-intake", intake_document_id: documentId(index), intake_storage_path: documents[index].storage_path,
        intake_generation: "generation-2" } }));
    const admitted: unknown[] = [];
    const recorded: unknown[] = [];
    const fake = createSupabaseFake({
      tables: {
        takeoff_launch_requests: () => ({ data: [], error: null }),
        affaire_briefs: () => ({ data: { status: "confirme" }, error: null }),
        affaire_intake_documents: () => ({ data: documents, error: null, count: documents.length }),
        plan_sets: () => ({ data: [{ id: PLAN_SET, estimate_version_id: null, name: "Plans import", metadata: AFFAIRE_INTAKE_PLAN_SET_METADATA,
          updated_at: "2026-11-21T08:00:00Z", plan_files: [{ count: copies.length }] }], error: null, count: 1 }),
        plan_files: (query: FakeQuery) => filterValue(query, "plan_set_id") === PLAN_SET ? servedRows(copies, query)
          : { data: [], error: null, count: 0 },
        tenant_memberships: () => ({ data: { role: "engineer" }, error: null }),
        estimate_projects: () => ({ data: { user_id: PAYER, is_archived: false }, error: null }),
        takeoff_plan_location_sources: (query: FakeQuery) => servedRows(copies.map((copy, index) => ({ plan_file_id: copy.id,
          plan_set_id: PLAN_SET, tenant_id: TENANT, source_kind: "intake_document", source_id: documentId(index) })), query),
      },
      storage: {
        [PLAN_FILES_BUCKET]: ({ paths }) => {
          const index = copies.findIndex((copy) => copy.file_path === paths[0]);
          return index >= 0 ? { data: new Blob([Uint8Array.from(bytes[index])]), error: null }
            : { data: null, error: { message: "Object not found", statusCode: "404" } };
        },
      },
      rpc: {
        claim_takeoff_launch_evaluations: () => ({ data: [{ request_id: REQUEST, tenant_id: TENANT, project_id: PROJECT, origin: "automatic",
          payer_id: PAYER, mark: 7, mandate_selection: SELECTION, payer_eligible: true }], error: null }),
        record_takeoff_launch_evaluation: (args) => { recorded.push(args); return { data: "blocked", error: null }; },
        record_takeoff_launch_evaluation_failure: () => ({ data: "evaluating", error: null }),
        takeoff_plan_dispatch_is_active: () => ({ data: input.perPlan, error: null }),
        takeoff_item_list_order_is_active: () => ({ data: false, error: null }),
        admit_takeoff_launch_request: (args) => {
          admitted.push(args);
          const job = (args as { p_job: { id: string } | Array<{ id: string }> }).p_job;
          return { data: [{ outcome: "admitted", job_id: Array.isArray(job) ? job[0].id : job.id, reason_code: null }], error: null };
        },
      },
    });
    vi.mocked(createServiceRoleClient).mockReturnValue(fake.client as never);
    const sources = copies.map((copy, index) => takeoffPreparationSourceSchema.parse({ document_id: copy.id, document_name: planName(index),
      kind: "plan", revision: null, source_version: `fixture-version-${index}`, pages: [], active: true, confirmed: false,
      plan_set_id: PLAN_SET, file_path: copy.file_path, page_count: copy.page_count, source_updated_at: "2026-11-21T08:00:00Z",
      mime_type: "application/pdf" }));
    vi.mocked(loadPreparation).mockResolvedValue({ draft: buildDeducedTakeoffPreparation({ sources, planSetId: PLAN_SET }), revision: null,
      availableSources: sources } as never);
    return { admitted, recorded, pieces: copies.map((copy, index) => ({ id: copy.id, name: planName(index) })) };
  }

  /** A member's command naming every plan of a confirmed preparation of one plan copy per entry of `pages`. */
  function plansCommand(pages: number[]) {
    const launched: Array<Record<string, unknown>> = [];
    const rows = pages.map((count, index) => ({ id: planId(index), tenant_id: TENANT, plan_set_id: PLAN_SET,
      file_path: `${TENANT}/${PLAN_SET}/${planId(index)}/plan-${index + 1}.pdf`, file_name: `plan-${index + 1}.pdf`,
      file_type: "application/pdf", file_size_bytes: 8, page_count: count, metadata: {}, created_at: "2026-11-21T08:00:00Z" }));
    const fake = createSupabaseFake({
      tables: { plan_files: (query: FakeQuery) => servedRows(rows, query),
        takeoff_launch_requests: (query: FakeQuery) => servedRows([], query),
        takeoff_plan_location_sources: (query: FakeQuery) => servedRows(rows.map((row) => ({ plan_file_id: row.id, plan_set_id: PLAN_SET,
          tenant_id: TENANT, source_kind: "plan_file", source_id: row.id })), query),
        takeoff_jobs: () => ({ data: null, error: null }) },
      rpc: {
        replay_manual_takeoff_plan_request: () => ({ data: [], error: null }),
        takeoff_plan_dispatch_is_active: () => ({ data: true, error: null }),
        takeoff_item_list_order_is_active: () => ({ data: false, error: null }),
        launch_manual_takeoff_plan_request: (args) => {
          launched.push(args as Record<string, unknown>);
          return { data: [{ outcome: "admitted", request_id: REQUEST, job_id: (args as { p_jobs: Array<{ id: string }> }).p_jobs[0].id }], error: null };
        },
      },
    });
    vi.mocked(createServiceRoleClient).mockReturnValue(fake.client as never);
    const sources = rows.map((row, index) => takeoffPreparationSourceSchema.parse({ document_id: row.id, document_name: planName(index),
      kind: "plan", revision: null, source_version: "fixture-version", pages: [], active: true, confirmed: true, plan_set_id: PLAN_SET,
      file_path: row.file_path, page_count: row.page_count, source_updated_at: "2026-11-21T08:00:00Z", mime_type: "application/pdf",
      content_hash: createHash("sha256").update(row.id).digest("hex") }));
    vi.mocked(assertConfirmedTakeoffPreparation).mockResolvedValue(createTakeoffPreparationSnapshot({
      preparation: buildDeducedTakeoffPreparation({ sources, planSetId: PLAN_SET }), confirmedBy: PAYER,
      confirmedAt: "2026-11-21T08:00:00Z", revision: 2, executionSelection: SELECTION }) as never);
    vi.mocked(getConfirmedTakeoffExecutionOwner).mockResolvedValue({ execution_host_id: HOST } as never);
    const context = { userId: PAYER, tenantId: TENANT, tenantRole: "engineer", supabase: fake.client } as never;
    const run = () => launchTakeoffRelaunch({ context, projectId: PROJECT, planSetId: PLAN_SET, preparationRevision: 2,
      intentKey: "aaaaaaaa-0000-4000-8000-0000000000ad", planFileIds: rows.map((row) => row.id), predecessorJobId: null });
    return { run, launched };
  }

  // The reference dossier of the second order: 15 plans of 20 pages (300 in all), 300 items, the vector classifier on.
  const reference = () => Array.from({ length: 15 }, () => 20);
  /** Its shares: twice its calls' reservations (64 calls on the 3 plans that get the dossier's vector pages, 24 on the others). */
  const referenceShares = [...Array.from({ length: 3 }, () => 64 * 60_000), ...Array.from({ length: 12 }, () => 24 * 60_000)];
  const withClassifier = () => {
    vi.stubEnv("MERGEONE_TAKEOFF_VECTORS", "1");
    vi.stubEnv("MERGEONE_TAKEOFF_DECISIONS", "1");
  };

  it("admits the reference dossier at the automatic start, its 300 pages read plan by plan, its budget sized", async () => {
    withClassifier();
    const { admitted, recorded } = await plansDossier(reference(), { perPlan: true });
    vi.mocked(sealedMeasuringOrder).mockResolvedValueOnce(itemListSeal(300));
    const [result] = await evaluateTakeoffLaunchRequests();
    vi.unstubAllEnvs();
    expect(recorded).toEqual([]);
    expect(result).toMatchObject({ outcome: "admitted" });
    const manifest = (admitted[0] as { p_manifest: { units: Array<{ budget: { tokens: number }; vector_pages: number }>; budget: unknown } }).p_manifest;
    expect(manifest.units.map((unit) => unit.budget.tokens)).toEqual(referenceShares);
    expect(manifest.units.map((unit) => unit.vector_pages)).toEqual([20, 20, 20, ...Array.from({ length: 12 }, () => 0)]);
    expect(manifest.budget).toEqual({ tokens: 28_800_000, cost_cents: 2500 });
  });

  it("admits the reference dossier by a member's command naming its plans, its budget sized", async () => {
    withClassifier();
    const { run, launched } = plansCommand(reference());
    vi.mocked(sealedMeasuringOrder).mockResolvedValueOnce(itemListSeal(300));
    await expect(run()).resolves.toMatchObject({ outcome: "admitted" });
    vi.unstubAllEnvs();
    const manifest = launched[0].p_manifest as { units: Array<{ budget: { tokens: number } }>; budget: unknown };
    expect(manifest.units.map((unit) => unit.budget.tokens)).toEqual(referenceShares);
    expect(manifest.budget).toEqual({ tokens: 28_800_000, cost_cents: 2500 });
  });

  // The free extraction read plan by plan gets the same rule: behind the same activation, nothing changes for a released request.
  it("admits a request of the free extraction read plan by plan whose pages together pass the limit, its budget the tenant's", async () => {
    const { admitted } = await plansDossier(reference(), { perPlan: true });
    const [result] = await evaluateTakeoffLaunchRequests();
    expect(result).toMatchObject({ outcome: "admitted" });
    expect((admitted[0] as { p_manifest: unknown }).p_manifest).toMatchObject({ format_version: 2,
      order: { kind: "free_extraction" }, budget: { tokens: 400000, cost_cents: 2500 } });
  });

  it("refuses, naming it, the one plan whose own pages pass the limit of a reading", async () => {
    const { admitted, recorded, pieces } = await plansDossier([201, 20], { perPlan: true });
    const [result] = await evaluateTakeoffLaunchRequests();
    expect(result).toMatchObject({ outcome: "blocked", reason: "PLAN_SET_TOO_LARGE" });
    expect(admitted).toEqual([]);
    expect(recorded).toEqual([expect.objectContaining({ p_reason: "PLAN_SET_TOO_LARGE", p_details: { pieces: [pieces[0]] } })]);
  });

  it("refuses a grouped request of 300 pages as before: one job reads them all", async () => {
    const { admitted, recorded, pieces } = await plansDossier(reference(), { perPlan: false });
    const [result] = await evaluateTakeoffLaunchRequests();
    expect(result).toMatchObject({ outcome: "blocked", reason: "PLAN_SET_TOO_LARGE" });
    expect(admitted).toEqual([]);
    expect(recorded).toEqual([expect.objectContaining({ p_reason: "PLAN_SET_TOO_LARGE", p_details: { pieces } })]);
  });
});
