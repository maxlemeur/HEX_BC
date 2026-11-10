import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect } from "e2e";

import { createEmptyTakeoffPreparation, createTakeoffPreparationSnapshot } from "@/lib/takeoff/preparation";
import type { VectorPageDecisions } from "@/lib/takeoff/vectors/persistence";

import { createEstimateViaWizard, createLineViaApi, readEstimate, recordEvidence, type ArmyState, type OwnedEstimate } from "../critical/fixtures";
import { createPlanSet, ownedTakeoffJobs, readPlanFiles, uploadSamplePlan } from "../critical/plans-support";
import { signUpDedicatedOwner, type DedicatedOwner } from "../local/dedicated-owner";
import { localTakeoffWorkerClient } from "./fixtures";
import { localClient } from "./native-ui";
import { buildVectorPlanPdf } from "./vector-plan-fixture";

export type WorkerUi = Parameters<typeof createEstimateViaWizard>[0] & { army: ArmyState };
export type WorkerResult = {
  event: "result";
  outcome: { status: string; retryable: boolean; should_requeue: boolean; next_run_at?: string; error_code?: string };
  job: { id: string; status: string; level: string; retryCount: number; errorCode: string | null; nextRetryAt: string | null };
  resultIds: string[];
  results: Array<{ id: string; failed: boolean; errorCode: string | null; extractedJson: unknown; warningCodes: string[] }>;
  items: Array<{ id: string; designation: string; quantity: number; unit: string; source_file_name: string; source_page: number;
    is_excluded: boolean; exclusion_reason: string | null }>;
  providerCalls: number;
  /** TI-662: the persisted vector reading, read by the worker's service role. */
  vectorPages: Array<{ id: string; tenantId: string; resultId: string; planFileId: string | null; sourceFileName: string | null; sourcePage: number;
    scale: { status: string; denominator: number | null }; detection: number | null; classes: Array<string | null>;
    sources: Array<string | null>; confidences: Array<number | null>; decisions: VectorPageDecisions | null }>;
  geometries: Array<{ itemId: string; tenantId: string; pageId: string; kind: string; network: string | null; lengthM: number | null; segments: number }>;
};

/**
 * A disposable owner for a takeoff worker journey (TI-662): its own account and tenant `ARMY <tag> <run>`, this browser
 * context signed in as it. The admission rule (bound_takeoff_job_admission) admits 10 pending jobs per user and tenant in
 * 24 h, a ledger that completing, cancelling or deleting a job never frees: on the campaign account, the jobs of every
 * other takeoff journey of the stack count, so a journey that seeds its jobs as this owner depends on none of them.
 * Its password goes only to this journey's own worker child, which signs in as the job's owner.
 */
export type WorkerOwner = DedicatedOwner & { password: string };

export async function signUpWorkerOwner(ui: WorkerUi, tag: string): Promise<WorkerOwner> {
  const password = `Army-${randomUUID()}-W1!`;
  return { ...await signUpDedicatedOwner(ui.browser, ui.app.baseUrl!, ui.army.runPrefix, { tag, password }), password };
}

/**
 * TI-662 L3d: Decisions for the owned worker's vector groups, answered by e2e/army/local/chatgpt-provider-fixture.mjs, which
 * the worker child installs over its network guard (never a paid call). `control` is the fixture's control file
 * ({ fail: true } answers 500), `transportLog` the JSONL of its calls.
 */
export type WorkerDecisions = { control: string; transportLog: string };

/** The control file and the empty call log of a journey's Decisions fixture, in its run's artifacts. */
export async function workerDecisionsFixture(ui: WorkerUi, journey: string, control: { fail?: boolean } = {}): Promise<WorkerDecisions> {
  const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", ui.army.runPrefix);
  await mkdir(directory, { recursive: true });
  const fixture = { control: path.join(directory, `${journey}-decisions-control.json`), transportLog: path.join(directory, `${journey}-decisions.jsonl`) };
  await writeFile(fixture.control, JSON.stringify(control));
  await writeFile(fixture.transportLog, "");
  return fixture;
}

/** The fixture's Decisions calls since `from` (a line count), never a forbidden provider. */
export async function readWorkerDecisionsCalls(fixture: WorkerDecisions, from = 0) {
  const lines = (await readFile(fixture.transportLog, "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(lines.filter((entry) => entry.provider === "forbidden")).toEqual([]);
  return lines.slice(from).filter((entry) => entry.provider === "decisions-fixture");
}

export function startOwnedWorker(ui: WorkerUi, ids: OwnedEstimate, jobId: string, mode: "success" | "transient" | "terminal" | "hold" = "success",
  options: { vectors?: boolean; rules?: boolean; owner?: WorkerOwner; decisions?: WorkerDecisions;
    providerItems?: Array<{ designation: string; quantity: number; unit: string; source_page: number; confidence: number; evidence: string }> } = {}) {
  if (process.env.E2E_ARMY_TAKEOFF_WORKER !== "1" || !ui.army.ownedEstimates.some((entry) => entry.projectId === ids.projectId && entry.versionId === ids.versionId)) {
    throw new Error("A dedicated worker profile and this invocation's owned estimate are required.");
  }
  const names = ["PATH", "TMPDIR", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
    "E2E_LOGIN_EMAIL", "E2E_LOGIN_PASSWORD", "E2E_ALLOWED_SUPABASE_HOST", "E2E_ARMY_LOCAL_DB_URL", "E2E_ARMY_BASE_URL",
    "E2E_COVERAGE_BACKEND_ORIGIN", "E2E_COVERAGE_NETWORK_LOG", "E2E_ARMY_BLOCK_WORKERS", "E2E_ARMY_TAKEOFF_WORKER"];
  const env = { NODE_ENV: "test" as const, ...Object.fromEntries(names.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]!])),
    // TI-662: the vector reading is opt-in per worker; only the journey that asserts it turns it on.
    ...(options.vectors ? { MERGEONE_TAKEOFF_VECTORS: "1" } : {}),
    // TI-664: the fixed rules' inputs are written by the worker only when they are on (MERGEONE_TAKEOFF_RULES).
    ...(options.rules ? { MERGEONE_TAKEOFF_RULES: "1" } : {}),
    ...(options.providerItems ? { ARMY_TAKEOFF_PROVIDER_ITEMS: JSON.stringify(options.providerItems) } : {}),
    // TI-662 L3d: Decisions for its vector groups, only with the vector reading, the takeoff opt-in and the fixture's key.
    ...(options.vectors && options.decisions ? { MERGEONE_TAKEOFF_DECISIONS: "1", MERGEONE_OPENAI_DECISIONS: "1", OPENAI_DECISIONS_API_KEY: "army-decisions-fixture",
      ARMY_DECISIONS_CONTROL: options.decisions.control, ARMY_CHATGPT_TRANSPORT_LOG: options.decisions.transportLog } : {}),
    // The worker child signs in as the job's owner: a journey's dedicated owner, else the campaign account.
    ...(options.owner ? { E2E_LOGIN_EMAIL: options.owner.email, E2E_LOGIN_PASSWORD: options.owner.password } : {}) };
  const child = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/tester-army/takeoff-worker-attempt.mjs",
    ids.projectId, ids.versionId, jobId, ui.army.runPrefix, mode], { cwd: process.cwd(), env, stdio: ["pipe", "pipe", "pipe"] });
  let resolveProvider!: (value: { event: string; jobId: string; status: string }) => void;
  let rejectProvider!: (error: Error) => void;
  const provider = new Promise<{ event: string; jobId: string; status: string }>((resolve, reject) => { resolveProvider = resolve; rejectProvider = reject; });
  void provider.catch(() => undefined);
  let result: WorkerResult | null = null;
  let buffer = "";
  let diagnostic = "";
  const timer = setTimeout(() => child.kill("SIGTERM"), 65_000);
  child.stdout.on("data", (bytes: Buffer) => {
    buffer += bytes.toString("utf8");
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith("ARMY_WORKER ")) continue;
      const event = JSON.parse(line.slice(12)) as WorkerResult & { status: string; jobId: string };
      if (event.event === "result") result = event;
      else resolveProvider(event);
    }
  });
  child.stderr.on("data", (bytes: Buffer) => { diagnostic = (diagnostic + bytes.toString("utf8")).slice(-3000); });
  const done = new Promise<WorkerResult>((resolve, reject) => {
    child.on("error", (error) => { clearTimeout(timer); rejectProvider(error); reject(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0 || !result) {
        const error = new Error(`Owned worker failed (${code ?? signal}): ${diagnostic}`);
        rejectProvider(error); reject(error); return;
      }
      resolve(result);
    });
  });
  void done.catch(() => undefined);
  if (mode !== "hold") child.stdin.end();
  return { provider, done, release: () => child.stdin.end("release\n"), stop: () => { child.stdin.end(); if (child.exitCode === null) child.kill("SIGTERM"); } };
}

export async function launchWorkerCsv(ui: WorkerUi, title: string) {
  if (process.env.E2E_ARMY_BLOCK_WORKERS !== "1") throw new Error("App Edge workers must remain blocked.");
  const ids = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-${title}`, title }, ui.army);
  const before = await readEstimate(ui.browser, ids.versionId);
  expect(before.version.calc_engine_version).toBe(2);
  const fileName = `${ui.army.runPrefix}-worker.csv`;
  const directory = path.resolve(".e2e/army/critical/artifacts/fixtures");
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, fileName);
  await writeFile(filePath, "designation;quantity;unit\nARMY worker pipe;12.5;m\nARMY worker valve;3;u\n");
  const { client, tenantId } = await localTakeoffWorkerClient(ui.army, ids.versionId);
  const { userId } = await localClient();
  const jobId = randomUUID();
  const sourcePath = `${tenantId}/${jobId}/${fileName}`;
  const bytes = await readFile(filePath);
  const uploaded = await client.storage.from("takeoff-files").upload(sourcePath, bytes, { contentType: "text/csv" });
  expect(uploaded.error).toBeNull();
  const inserted = await client.from("takeoff_jobs").insert({ id: jobId, tenant_id: tenantId, estimate_version_id: ids.versionId,
    created_by: userId, level: "A", status: "pending", source_file_name: fileName, source_file_path: sourcePath,
    source_file_type: "text/csv", source_file_size_bytes: bytes.length, execution_provider: "gemini" }).select("id").single();
  expect(inserted.error).toBeNull();
  await ui.app.open(`/dashboard/estimates/${ids.versionId}/takeoff/${jobId}`);
  await expect(ui.browser).toHaveURL(`/dashboard/estimates/${ids.versionId}/takeoff/${jobId}`);
  await recordEvidence(ui.army, "worker-ui-created", { ids, jobId, fileName, engine: before.version.calc_engine_version,
    boundary: "Historical pending job and stored CSV are seeded on the owned stack. The worker uses real DB/Storage/processors and a controlled provider; local ChatGPT upload is covered separately." });
  return { ids, jobId, fileName, before };
}

export async function launchWorkerPdf(ui: WorkerUi) {
  if (process.env.E2E_ARMY_BLOCK_WORKERS !== "1") throw new Error("App Edge workers must remain blocked.");
  const ids = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-TKW04`, title: "Plans worker" }, ui.army);
  expect((await readEstimate(ui.browser, ids.versionId)).version.calc_engine_version).toBe(2);
  await createLineViaApi(ui.browser, ids.versionId, `${ui.army.runPrefix} existing base`);
  const plans = await createPlanSet(ui, ui.army, ids, `${ui.army.runPrefix} plans`);
  const file = await uploadSamplePlan(ui, ui.army, plans);
  const { client, tenantId } = await localTakeoffWorkerClient(ui.army, ids.versionId);
  const { userId } = await localClient();
  const jobId = randomUUID();
  const plan = await client.from("plan_files").select("file_path").eq("id", file.id).single();
  expect(plan.error).toBeNull();
  const inserted = await client.from("takeoff_jobs").insert({ id: jobId, tenant_id: tenantId, estimate_version_id: ids.versionId,
    plan_set_id: plans.id, created_by: userId, level: "B", status: "pending", source_file_name: file.file_name,
    source_file_path: plan.data!.file_path, source_file_type: file.file_type, source_file_size_bytes: file.file_size_bytes,
    execution_provider: "gemini" }).select("id").single();
  expect(inserted.error).toBeNull();
  const jobs = ownedTakeoffJobs(ui.browser, ids);
  const [job] = await jobs.list();
  expect(job).toMatchObject({ estimate_version_id: ids.versionId, status: "pending", level: "B", source_file_name: file.file_name });
  await recordEvidence(ui.army, "TKW04-real-plan-created", { ids, planSetId: plans.id, file, job });
  return { ids, jobId: job.id, fileName: file.file_name };
}

// TI-662: a level C job on a fictional vector plan (vector-plan-fixture.ts) uploaded through the plans UI; TKW10 adds
// the layer Decisions classifies, under its own owner.
export async function launchWorkerVectorPlan(ui: WorkerUi, { journey = "TKW08", tag = "VPL", decisionsLayer = false }:
  { journey?: string; tag?: string; decisionsLayer?: boolean } = {}) {
  if (process.env.E2E_ARMY_BLOCK_WORKERS !== "1") throw new Error("App Edge workers must remain blocked.");
  const owner = await signUpWorkerOwner(ui, tag);
  const ids = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-${journey}`, title: "Plan vectoriel" }, ui.army);
  expect((await readEstimate(ui.browser, ids.versionId)).version.calc_engine_version).toBe(2);
  const plans = await createPlanSet(ui, ui.army, ids, `${ui.army.runPrefix} plans vectoriels`);
  // « R+1 » is the name the user sees and the worker reads the level from; plan_files.file_name keeps the
  // sanitized Storage basename (« R-1 », plan-file-display-name.ts), which must never be read as a level.
  const fileName = "plan-vectoriel-R+1-Z2.pdf";
  const storedName = "plan-vectoriel-R-1-Z2.pdf";
  const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", ui.army.runPrefix);
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, fileName);
  const bytes = await buildVectorPlanPdf({ decisionsLayer });
  await writeFile(filePath, bytes);
  await ui.screen.getByRole("heading", plans.name, { exact: true }).click();
  const [uploaded] = await Promise.all([
    ui.browser.waitForResponse(`**/storage/v1/object/upload/sign/plan-files/${plans.tenant_id}/${plans.id}/**`, { timeout: 60_000 }),
    ui.browser.locator("input[type='file'][accept*='pdf']").first().setInputFiles(filePath),
  ]);
  expect(uploaded.status).toBe(200);
  await expect(ui.screen.getByRole("button", `Supprimer ${fileName}`, { exact: true })).toBeVisible();
  const [file] = await readPlanFiles(ui.browser, plans.id);
  expect(file).toMatchObject({ plan_set_id: plans.id, file_name: storedName, file_type: "application/pdf", file_size_bytes: bytes.length });
  const { client, tenantId } = await localTakeoffWorkerClient(ui.army, ids.versionId, owner.email, owner.password);
  expect(tenantId).toBe(owner.tenantId);
  const userId = owner.userId;
  const plan = await client.from("plan_files").select("file_path").eq("id", file.id).single();
  expect(plan.error).toBeNull();
  // A pending level C job on this plan file; the journey seeds a second one as its flag-off control.
  const seedJob = async () => {
    const id = randomUUID();
    const inserted = await client.from("takeoff_jobs").insert({ id, tenant_id: tenantId, estimate_version_id: ids.versionId,
      plan_set_id: plans.id, created_by: userId, level: "C", status: "pending", source_file_name: fileName,
      source_file_path: plan.data!.file_path, source_file_type: file.file_type, source_file_size_bytes: file.file_size_bytes,
      execution_provider: "gemini" }).select("id").single();
    expect(inserted.error).toBeNull();
    return id;
  };
  const jobId = await seedJob();
  const [job] = await ownedTakeoffJobs(ui.browser, ids).list();
  expect(job).toMatchObject({ id: jobId, estimate_version_id: ids.versionId, status: "pending", level: "C", source_file_name: fileName });
  await recordEvidence(ui.army, `${journey}-vector-plan-created`, { ids, planSetId: plans.id, file, job, tenantId, owner: owner.userId,
    boundary: "Fictional vector PDF uploaded through the plans UI by the journey's dedicated owner; its pending level C jobs are seeded on the owned stack." });
  return { ids, jobId, fileName, tenantId, planSetId: plans.id, planFileId: file.id, seedJob, owner };
}

// TI-662 (review of PR #147): a level C job on the fictional vector plan uploaded directly (no plan set), its page
// calibrated in the confirmed preparation. The plan prints no scale: only that calibration (100 mm on paper are
// 5 m, 1/50) gives it one. The preparation names the upload `upload:<SHA-256 of its bytes>`, as TakeoffUploadForm
// does; it is built by the product's own snapshot builder and seeded with the job on the owned stack.
export async function launchWorkerVectorUpload(ui: WorkerUi) {
  if (process.env.E2E_ARMY_BLOCK_WORKERS !== "1") throw new Error("App Edge workers must remain blocked.");
  const owner = await signUpWorkerOwner(ui, "VUP");
  const ids = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-TKW09`, title: "Plan vectoriel téléversé" }, ui.army);
  const fileName = "plan-vectoriel-R+1-Z2.pdf";
  const bytes = Buffer.from(await buildVectorPlanPdf({ printedScale: false }));
  const hash = createHash("sha256").update(bytes).digest("hex");
  const { client, tenantId } = await localTakeoffWorkerClient(ui.army, ids.versionId, owner.email, owner.password);
  expect(tenantId).toBe(owner.tenantId);
  const userId = owner.userId;
  const preparation = createEmptyTakeoffPreparation({ estimateVersionId: ids.versionId });
  preparation.objective = "measure_length";
  preparation.objective_confirmed = true;
  preparation.scope = { ...preparation.scope, lots: ["Plomberie"], networks: ["EF", "EU/EV"], confirmed: true };
  preparation.sources = [{ document_id: `upload:${hash}`, document_name: fileName, kind: "plan", revision: "A", source_version: hash,
    content_hash: hash, pages: [1], active: true, confirmed: true, plan_set_id: null, file_path: null, page_count: null,
    logical_document_id: null, source_updated_at: null, mime_type: "application/pdf", page_triage: null }];
  preparation.conventions = { unit: "m", measurement_basis: "calibrated", purchase: null, confirmed: true,
    calibration: { document_id: `upload:${hash}`, page: 1, reference_length: 5, reference_unit: "m", measured_span: 100, measured_span_unit: "paper_mm" } };
  preparation.destination = { ...preparation.destination, kind: "estimate_review", reviewer: "Réviseur ARMY", confirmed: true };
  preparation.processing = { level: "C", provider: "auto" };
  const confirmedAt = new Date().toISOString();
  const snapshot = createTakeoffPreparationSnapshot({ preparation, confirmedBy: userId, confirmedAt, revision: 1 });
  const prepared = await client.from("takeoff_preparations").insert({ tenant_id: tenantId, project_id: ids.projectId, revision: 1,
    draft: preparation, confirmed_snapshot: snapshot, confirmed_at: confirmedAt, confirmed_by: userId, updated_by: userId } as never);
  expect(prepared.error).toBeNull();
  const jobId = randomUUID();
  const sourcePath = `${tenantId}/${jobId}/${fileName}`;
  // The review reads this owned upload through its signed URL: the campaign's network guard allows exactly that path.
  (ui.army.ownedTakeoffUploads ??= []).push({ projectId: ids.projectId, tenantId, jobId });
  const uploaded = await client.storage.from("takeoff-files").upload(sourcePath, bytes, { contentType: "application/pdf" });
  expect(uploaded.error).toBeNull();
  const inserted = await client.from("takeoff_jobs").insert({ id: jobId, tenant_id: tenantId, estimate_version_id: ids.versionId,
    created_by: userId, level: "C", status: "pending", source_file_name: fileName, source_file_path: sourcePath,
    source_file_type: "application/pdf", source_file_size_bytes: bytes.length, execution_provider: "gemini",
    preparation_snapshot: snapshot } as never).select("id").single();
  expect(inserted.error).toBeNull();
  const [job] = await ownedTakeoffJobs(ui.browser, ids).list();
  expect(job).toMatchObject({ id: jobId, estimate_version_id: ids.versionId, status: "pending", level: "C", source_file_name: fileName });
  await recordEvidence(ui.army, "TKW09-vector-upload-created", { ids, jobId, tenantId, owner: owner.userId, sha256: hash,
    calibration: preparation.conventions.calibration,
    boundary: "Fictional vector PDF without printed scale stored as a direct upload by the journey's dedicated owner; its confirmed preparation and pending level C job are seeded on the owned stack." });
  return { ids, jobId, fileName, tenantId, sourcePath, sha256: hash, client, owner };
}

/** What the review viewer draws: the painted canvas (bluish pixels: the blue pipes), the centrelines and room polygons of its SVG. */
export async function readVectorViewerDrawing(ui: WorkerUi) {
  return ui.browser.evaluate(async () => {
    const section = document.querySelector("section[aria-label='Lecture vectorielle du plan']");
    const deadline = Date.now() + 20_000;
    let inked = 0, canvasWidth = 0;
    while (Date.now() < deadline) {
      const canvas = section?.querySelector("canvas");
      const context = canvas && canvas.width > 0 ? canvas.getContext("2d") : null;
      if (canvas && context) {
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        inked = 0;
        // Bluish pixels only (antialiased thin strokes are lighter): black text and a white page do not count.
        for (let index = 0; index < pixels.length; index += 4) if (pixels[index + 3] > 0 && pixels[index + 2] - pixels[index] > 60) inked += 1;
        canvasWidth = canvas.width;
        if (inked > 0) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    const svg = section?.querySelector("svg[aria-label='Géométrie mesurée']");
    const lines = [...(svg?.querySelectorAll("g[data-network] line") ?? [])].map((line) => ({ network: line.parentElement?.getAttribute("data-network") ?? null,
      x1: Number(line.getAttribute("x1")), y1: Number(line.getAttribute("y1")), x2: Number(line.getAttribute("x2")), y2: Number(line.getAttribute("y2")) }));
    const polygons = [...(svg?.querySelectorAll("polygon[data-kind='surface']") ?? [])]
      .map((polygon) => (polygon.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number));
    return { canvasWidth, inked, width: Number(svg?.getAttribute("width")), height: Number(svg?.getAttribute("height")), lines, polygons };
  });
}
