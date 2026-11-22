import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { promisify } from "node:util";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { AFFAIRE_INTAKE_BUCKET, buildAffaireIntakeStoragePath } from "@/lib/affaires/intake";
import { createTakeoffPreparationSnapshot } from "@/lib/takeoff/preparation";
import { buildDeducedTakeoffPreparation } from "@/lib/takeoff/preparation-from-dossier";
import { toPreparationIntakeSource, toPreparationPlanSource } from "@/lib/takeoff/preparation-sources";

import { querySql } from "../local/calculation-gate-support";
import { ownedWorkerSelection, type WorkerOwner, type WorkerUi } from "./worker-support";

// One analysis per plan (lot 3, migration 20261121231238_takeoff_plan_dispatcher.sql) on the owned worker stack: its
// activation for the duration of a journey, a fictional dossier of plans, a member's explicit command run by the server
// (scripts/tester-army/takeoff-request-command.mjs) and a pass of the Mac's dispatcher with a controlled provider
// (scripts/tester-army/takeoff-plan-dispatch.mjs). The takeoff journeys run one at a time (army-shards.json, suite
// « takeoff »): the activation, a database singleton, is set aside again when the journey ends.
const run = promisify(execFile);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function assertOwnedCampaign() {
  if (process.env.E2E_ARMY_TAKEOFF_WORKER !== "1" || process.env.E2E_ARMY_BLOCK_WORKERS !== "1") {
    throw new Error("One analysis per plan requires a dedicated owned worker campaign.");
  }
}

/** The automatic start's and the notices' cut-offs, and the activation of one analysis per plan. */
export async function activateOwnedPlanDispatch() {
  assertOwnedCampaign();
  await querySql(`insert into private.takeoff_completion_activation (active_from) values (clock_timestamp()) on conflict do nothing;
insert into private.takeoff_launch_activation (active_from) values (clock_timestamp()) on conflict do nothing;
insert into private.takeoff_plan_dispatch_activation (active_from) values (clock_timestamp()) on conflict do nothing;`);
}

export async function deactivateOwnedPlanDispatch() {
  assertOwnedCampaign();
  await querySql("delete from private.takeoff_plan_dispatch_activation; delete from private.takeoff_launch_activation;");
}

/** A fictional plan of `pages` pages whose bytes are its own. */
export async function fictionalPlanPdf(label: string, pages: number) {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  for (let page = 1; page <= pages; page += 1) {
    document.addPage([595, 842]).drawText(`${label} — page ${page} (fictif)`, { x: 60, y: 760, size: 18, font });
  }
  return Buffer.from(await document.save());
}

export type SeededPlan = { id: string; name: string; bytes: Buffer; hash: string; pages: number[] };

/**
 * An affaire without a version, its plan set of fictional plans (each `{ name, pages, retained? }`: the pages a member
 * retained, empty for the whole plan; `inactive` set aside), a CCTP of its dossier, and the member's confirmed
 * preparation pinning the owned worker's ChatGPT selection.
 */
export async function seedPlanDossier(ui: WorkerUi, owner: WorkerOwner, plans: Array<{ name: string; pages: number; retained?: number[];
  inactive?: boolean }>, options: { objective?: "estimate" } = {}) {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const session = { auth: { persistSession: false, autoRefreshToken: false } };
  const setup: SupabaseClient = createClient(backend.origin, process.env.SUPABASE_SERVICE_ROLE_KEY!, session);
  const { tenantId, userId } = owner;
  const projectId = randomUUID();
  const planSetId = randomUUID();
  const uploadId = randomUUID();
  const cctpId = randomUUID();
  if ((await setup.from("estimate_projects").insert({ id: projectId, tenant_id: tenantId, user_id: userId,
    name: `${ui.army.runPrefix} analyses par plan` })).error) throw new Error("affaire");
  if ((await setup.from("plan_sets").insert({ id: planSetId, tenant_id: tenantId, project_id: projectId, name: "Plans fictifs" })).error) {
    throw new Error("plan set");
  }
  (ui.army.ownedPlanSets ??= []).push({ projectId, planSetId, tenantId });
  (ui.army.ownedTakeoffAffaires ??= []).push(projectId);
  const seeded: Array<SeededPlan & { inactive: boolean }> = [];
  for (const plan of plans) {
    const id = randomUUID();
    const bytes = await fictionalPlanPdf(`${ui.army.runPrefix} ${plan.name}`, plan.pages);
    const filePath = `${tenantId}/${planSetId}/${id}/${plan.name}`;
    if ((await setup.storage.from("plan-files").upload(filePath, bytes, { contentType: "application/pdf" })).error) throw new Error("plan bytes");
    if ((await setup.from("plan_files").insert({ id, tenant_id: tenantId, plan_set_id: planSetId, file_name: plan.name, file_path: filePath,
      file_type: "application/pdf", file_size_bytes: bytes.length, page_count: plan.pages })).error) throw new Error("plan row");
    seeded.push({ id, name: plan.name, bytes, hash: createHash("sha256").update(bytes).digest("hex"), pages: plan.retained ?? [],
      inactive: plan.inactive === true });
  }
  // A CCTP of the dossier: a common reference of every plan, never a unit.
  const cctp = await fictionalPlanPdf(`${ui.army.runPrefix} CCTP`, 1);
  // Stored where the dossier stores its pieces (tenant, affaire, upload, document, name): the worker reads no other key.
  const cctpPath = buildAffaireIntakeStoragePath({ tenantId, projectId, uploadId, documentId: cctpId, fileName: "cctp.pdf" });
  if ((await setup.from("affaire_intake_uploads").insert({ id: uploadId, project_id: projectId, created_by: userId, status: "ready" })).error) {
    throw new Error("upload");
  }
  if ((await setup.storage.from(AFFAIRE_INTAKE_BUCKET).upload(cctpPath, cctp, { contentType: "application/pdf" })).error) throw new Error("cctp bytes");
  if ((await setup.from("affaire_intake_documents").insert({ id: cctpId, upload_id: uploadId, file_name: "cctp.pdf", upload_status: "uploaded",
    storage_path: cctpPath, classification_status: "classified", document_kind: "cctp", mime_type: "application/pdf",
    size_bytes: cctp.length })).error) throw new Error("cctp row");
  const revision = await confirmPlanPreparation(setup, owner, projectId, planSetId, seeded, cctpId, createHash("sha256").update(cctp).digest("hex"), 1,
    options.objective);
  return { setup, projectId, planSetId, plans: seeded, cctpId, revision,
    confirm: (active: Array<SeededPlan & { inactive: boolean }>, next: number) =>
      confirmPlanPreparation(setup, owner, projectId, planSetId, active, cctpId, createHash("sha256").update(cctp).digest("hex"), next,
        options.objective) };
}

async function confirmPlanPreparation(setup: SupabaseClient, owner: WorkerOwner, projectId: string, planSetId: string,
  plans: Array<SeededPlan & { inactive: boolean }>, cctpId: string, cctpHash: string, revision: number, objective?: "estimate") {
  const files = await setup.from("plan_files").select("id,plan_set_id,file_path,file_name,file_size_bytes,file_hash,page_count,updated_at,metadata")
    .eq("plan_set_id", planSetId);
  const cctp = await setup.from("affaire_intake_documents").select("id,storage_path,file_name,mime_type,size_bytes,document_kind,updated_at,extracted_metadata")
    .eq("id", cctpId).single();
  if (files.error || cctp.error) throw new Error("dossier rows");
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  const sources = [
    ...(files.data ?? []).filter((file) => byId.has(file.id)).map((file) => {
      const plan = byId.get(file.id)!;
      return { ...toPreparationPlanSource(file as never), content_hash: plan.hash, pages: plan.pages, active: !plan.inactive, confirmed: true };
    }),
    { ...toPreparationIntakeSource(cctp.data as never), content_hash: cctpHash, active: true, confirmed: true },
  ];
  const preparation = buildDeducedTakeoffPreparation({ sources, planSetId });
  preparation.sources = preparation.sources.map((source) => sources.find((entry) => entry.document_id === source.document_id) ?? source);
  // An estimate the member chose, with the unit of its quantities and its conventions confirmed, as the options screen
  // records them.
  if (objective) {
    Object.assign(preparation, { objective, objective_confirmed: true, conventions: { ...preparation.conventions, unit_mode: undefined,
      unit: "u", measurement_basis: "documented", confirmed: true } });
  }
  const confirmedAt = new Date().toISOString();
  const snapshot = { ...createTakeoffPreparationSnapshot({ preparation, revision, confirmedAt, confirmedBy: owner.userId }),
    execution_selection: await ownedWorkerSelection() };
  const row = { tenant_id: owner.tenantId, project_id: projectId, revision, draft: preparation, confirmed_snapshot: snapshot,
    confirmed_at: confirmedAt, confirmed_by: owner.userId, updated_by: owner.userId };
  const written = revision === 1 ? await setup.from("takeoff_preparations").insert(row)
    : await setup.from("takeoff_preparations").update(row).eq("project_id", projectId);
  if (written.error) throw new Error(`preparation: ${written.error.message}`);
  return revision;
}

function childEnv(owner: WorkerOwner, extra: Record<string, string> = {}) {
  const names = ["PATH", "TMPDIR", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
    "E2E_ALLOWED_SUPABASE_HOST", "E2E_ARMY_BASE_URL", "E2E_ARMY_BLOCK_WORKERS", "E2E_ARMY_LOCAL_DB_URL",
    "E2E_COVERAGE_BACKEND_ORIGIN", "E2E_COVERAGE_NETWORK_LOG", "E2E_ARMY_TAKEOFF_WORKER", "TAKEOFF_MODULE_ENABLED_BY_DEFAULT"];
  return { ...Object.fromEntries(names.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]])),
    NODE_ENV: "test", MERGEONE_CHATGPT_LOCAL: "1", MERGEONE_TAKEOFF_VECTORS: "0", MERGEONE_TAKEOFF_RULES: "0",
    E2E_LOGIN_EMAIL: owner.email, E2E_LOGIN_PASSWORD: owner.password, ...extra } as NodeJS.ProcessEnv;
}

export type CommandAnswer = { result?: { outcome: string; requestId?: string; jobId?: string | null; state?: string; canceledUnits?: number };
  rejected?: string; status?: number | null; deferred: number };

/** A member's explicit command, run by the server as from the affaire's options. */
export async function runOwnedTakeoffCommand(owner: WorkerOwner, args: string[]) {
  if (!args.every((arg) => arg === "-" || /^[0-9a-z,:-]+$/i.test(arg))) throw new Error("Invalid command argument.");
  const { stdout, stderr } = await run(process.execPath, ["--conditions=react-server", "--import", "tsx",
    "scripts/tester-army/takeoff-request-command.mjs", ...args], { env: childEnv(owner), timeout: 60_000 });
  const line = stdout.split("\n").find((entry) => entry.startsWith("ARMY_COMMAND "));
  if (!line) throw new Error(`Missing owned command result: ${stderr.slice(-1500)}`);
  return JSON.parse(line.slice("ARMY_COMMAND ".length)) as CommandAnswer;
}

export type DispatchAnswer = { event: "result"; pass: { ran: string[]; closed: string[]; nextDueAt: string | null };
  calls: Array<{ jobId: string; startedAt: number; endedAt: number; files: Array<{ mimeType: string; bytes: number; sha256: string }>; mode: string }>;
  maxInFlight: number };

export type OwnedPlanLine = { designation: string; quantity: number; unit: string; source_page: number };

/**
 * A pass of the Mac's dispatcher, its units answered by the controlled provider (`modes` per job, success by default;
 * « release » holds a job's call until `releaseFile` exists; `items` per job, the lines its reading returns).
 */
export async function runOwnedPlanDispatch(ui: WorkerUi, owner: WorkerOwner, projectId: string,
  options: { modes?: Record<string, "success" | "terminal" | "hold" | "release">; delayMs?: number; mailCollector?: string;
    items?: Record<string, OwnedPlanLine[]>; releaseFile?: string;
    /** A job reading against its list: by item label, a measure (page local to the copied PDF) or « omit »; `truncate`. */
    itemAnswers?: Record<string, { items?: Record<string, { quantity: number; unit: string; page: number } | "omit">; truncate?: boolean }> } = {}) {
  if (!UUID.test(projectId) || !ui.army.ownedTakeoffAffaires?.includes(projectId)) throw new Error("An owned affaire is required.");
  const { stdout, stderr } = await run(process.execPath, ["--conditions=react-server", "--import", "tsx",
    "scripts/tester-army/takeoff-plan-dispatch.mjs", projectId, ui.army.runPrefix], { timeout: 120_000, env: childEnv(owner, {
    ARMY_TAKEOFF_PLAN_MODES: JSON.stringify(options.modes ?? {}), ARMY_TAKEOFF_PROVIDER_DELAY_MS: String(options.delayMs ?? 0),
    ARMY_TAKEOFF_PLAN_ITEMS: JSON.stringify(options.items ?? {}), ARMY_TAKEOFF_ITEM_ANSWERS: JSON.stringify(options.itemAnswers ?? {}),
    ...(options.releaseFile ? { ARMY_TAKEOFF_HOLD_RELEASE_FILE: options.releaseFile } : {}),
    ...(options.mailCollector ? {
      E2E_TAKEOFF_MAIL_COLLECTOR_ORIGIN: options.mailCollector,
      RESEND_BASE_URL: options.mailCollector, RESEND_API_KEY: "LOCAL_ONLY_INVALID_RESEND_SENTINEL",
      EMAIL_FROM: "ARMY Métré <metre@fixture.invalid>", EMAIL_DELIVERY_MODE: "redirect",
      EMAIL_REDIRECT_TO: "collecteur@fixture.invalid", MERGEONE_TAKEOFF_EMAIL_ORIGIN: ui.app.baseUrl!,
    } : {}),
  }) });
  const line = stdout.split("\n").find((entry) => entry.startsWith("ARMY_DISPATCH "));
  if (!line) throw new Error(`Missing owned dispatch result: ${stderr.slice(-1500)}`);
  return JSON.parse(line.slice("ARMY_DISPATCH ".length)) as DispatchAnswer;
}

async function readJson<T>(sql: string): Promise<T> {
  const output = await querySql(sql);
  return JSON.parse([...output].reverse().find((line) => line.trim().startsWith("[") || line.trim().startsWith("{")) ?? "[]") as T;
}

export type OwnedPlanRequest = { id: string; state: string; outcome: string | null; reason_code: string | null; units_expected: number | null;
  units_succeeded: number; units_failed: number; units_canceled: number; units_not_started: number; format: number | null;
  units: Array<{ key: string; ordinal: number; plans: string[] }> | null };

export async function readOwnedPlanRequests(projectId: string) {
  if (!UUID.test(projectId)) throw new Error("Invalid fixture affaire.");
  return readJson<OwnedPlanRequest[]>(`select coalesce(json_agg(json_build_object('id', r.id, 'state', r.state, 'outcome', r.outcome,
    'reason_code', r.reason_code, 'units_expected', r.units_expected, 'units_succeeded', r.units_succeeded, 'units_failed', r.units_failed,
    'units_canceled', r.units_canceled, 'units_not_started', r.units_not_started, 'format', (r.manifest ->> 'format_version')::integer,
    'units', r.manifest -> 'units') order by r.created_at), '[]'::json)
    from public.takeoff_launch_requests r where r.project_id = '${projectId}' and r.origin = 'manual';`);
}

export type OwnedPlanJob = { id: string; launch_request_id: string; launch_unit_key: string; status: string; analysis_outcome: string | null;
  error_code: string | null; plans: string[]; pages: number[][]; references: string[] };

export async function readOwnedPlanJobs(projectId: string) {
  if (!UUID.test(projectId)) throw new Error("Invalid fixture affaire.");
  return readJson<OwnedPlanJob[]>(`select coalesce(json_agg(json_build_object('id', j.id, 'launch_request_id', j.launch_request_id,
    'launch_unit_key', j.launch_unit_key, 'status', j.status, 'analysis_outcome', j.analysis_outcome, 'error_code', j.error_code,
    'plans', (select json_agg(s ->> 'document_id') from jsonb_array_elements(j.preparation_snapshot #> '{preparation,sources}') s
      where s ->> 'kind' = 'plan' and s -> 'active' = 'true'::jsonb),
    'pages', (select json_agg(s -> 'pages') from jsonb_array_elements(j.preparation_snapshot #> '{preparation,sources}') s
      where s ->> 'kind' = 'plan' and s -> 'active' = 'true'::jsonb),
    'references', (select coalesce(json_agg(s ->> 'document_id'), '[]'::json) from jsonb_array_elements(j.preparation_snapshot #> '{preparation,sources}') s
      where s ->> 'kind' <> 'plan' and s -> 'active' = 'true'::jsonb))
    order by (j.preparation_snapshot #>> '{launch_unit,ordinal}')::integer, j.created_at), '[]'::json)
    from public.takeoff_jobs j where j.project_id = '${projectId}';`);
}

export async function readOwnedPlanItems(jobId: string) {
  if (!UUID.test(jobId)) throw new Error("Invalid fixture job.");
  return readJson<Array<{ designation: string; source_page: number }>>(`select coalesce(json_agg(json_build_object('designation', i.designation,
    'source_page', i.source_page) order by i.source_page, i.designation), '[]'::json) from public.takeoff_items i where i.job_id = '${jobId}';`);
}

export async function readOwnedRequestNotices(projectId: string) {
  if (!UUID.test(projectId)) throw new Error("Invalid fixture affaire.");
  return readJson<Array<{ subject_kind: string; request_id: string | null; job_id: string | null; outcome: string; plans_read_count: number | null;
    plans_failed_count: number | null; delivery_state: string }>>(`select coalesce(json_agg(json_build_object('subject_kind', n.subject_kind,
    'request_id', n.request_id, 'job_id', n.job_id, 'outcome', n.outcome, 'plans_read_count', n.plans_read_count,
    'plans_failed_count', n.plans_failed_count, 'delivery_state', n.delivery_state)), '[]'::json)
    from public.takeoff_completion_notifications n where n.project_id = '${projectId}';`);
}

export async function readOwnedLedger(requestId: string) {
  if (!UUID.test(requestId)) throw new Error("Invalid fixture request.");
  return readJson<Array<{ job_id: string; state: string; tokens: number }>>(`select coalesce(json_agg(json_build_object('job_id', l.job_id,
    'state', l.state, 'tokens', l.tokens)), '[]'::json) from private.takeoff_launch_usage l where l.request_id = '${requestId}';`);
}
