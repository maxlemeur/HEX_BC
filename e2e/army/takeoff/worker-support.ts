import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect } from "e2e";

import { createEstimateViaWizard, createLineViaApi, readEstimate, recordEvidence, type ArmyState, type OwnedEstimate } from "../critical/fixtures";
import { createPlanSet, ownedTakeoffJobs, uploadSamplePlan } from "../critical/plans-support";
import { fillTakeoffPreparation, openTakeoffPreparation } from "../critical/preparation-support";

export type WorkerUi = Parameters<typeof createEstimateViaWizard>[0] & { army: ArmyState };
export type WorkerResult = {
  event: "result";
  outcome: { status: string; retryable: boolean; should_requeue: boolean; next_run_at?: string; error_code?: string };
  job: { id: string; status: string; level: string; retryCount: number; errorCode: string | null; nextRetryAt: string | null };
  resultIds: string[];
  results: Array<{ id: string; failed: boolean; errorCode: string | null; extractedJson: unknown; warningCodes: string[] }>;
  items: Array<{ id: string; designation: string; quantity: number; unit: string; source_file_name: string; source_page: number }>;
  providerCalls: number;
};

export function startOwnedWorker(ui: WorkerUi, ids: OwnedEstimate, jobId: string, mode: "success" | "transient" | "terminal" | "hold" = "success") {
  if (process.env.E2E_ARMY_TAKEOFF_WORKER !== "1" || !ui.army.ownedEstimates.some((entry) => entry.projectId === ids.projectId && entry.versionId === ids.versionId)) {
    throw new Error("A dedicated worker profile and this invocation's owned estimate are required.");
  }
  const names = ["PATH", "TMPDIR", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY",
    "E2E_LOGIN_EMAIL", "E2E_LOGIN_PASSWORD", "E2E_ALLOWED_SUPABASE_HOST", "E2E_ARMY_LOCAL_DB_URL", "E2E_ARMY_BASE_URL",
    "E2E_COVERAGE_BACKEND_ORIGIN", "E2E_COVERAGE_NETWORK_LOG", "E2E_ARMY_BLOCK_WORKERS", "E2E_ARMY_TAKEOFF_WORKER"];
  const env = { NODE_ENV: "test" as const, ...Object.fromEntries(names.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]!])) };
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
  await ui.app.open(`/dashboard/estimates/${ids.versionId}/takeoff/new`);
  const source = ui.screen.getByLabel("Fichier source", { exact: true });
  await expect(source).toBeEnabled();
  await source.setInputFiles(filePath);
  await expect(ui.screen.getByText(fileName, { exact: true })).toBeVisible();
  await fillTakeoffPreparation(ui, { sources: [fileName], objective: "extract_quantities", unit: "Unités des lignes sources",
    inclusions: "Toutes les lignes du fichier", levels: "Tous", zones: "Toutes", exclusions: "", processing: { level: "A", provider: "gemini" } }, ui.browser.locator("form").last());
  await expect(ui.screen.getByRole("button", "Confirmer et lancer le métré", { exact: true })).toBeEnabled();
  const [response] = await Promise.all([
    ui.browser.waitForResponse("**/api/takeoff/jobs", { timeout: 30_000 }),
    ui.screen.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click(),
  ]);
  expect(response.status).toBe(201);
  const body = await response.json<{ ok: boolean; data: { id: string; status: string; level: string; dispatch?: { status: string } } }>();
  expect(body.ok).toBe(true);
  expect(body.data).toMatchObject({ status: "pending", level: "A" });
  const jobId = body.data.id;
  await expect(ui.browser).toHaveURL(`/dashboard/estimates/${ids.versionId}/takeoff/${jobId}`);
  await recordEvidence(ui.army, "worker-ui-created", { ids, jobId, fileName, engine: before.version.calc_engine_version,
    dispatch: body.data.dispatch ?? null, boundary: "Real UI upload and dispatch persistence; Edge transport blocked. Owned Node worker uses real DB/Storage/processors and a controlled Gemini boundary." });
  return { ids, jobId, fileName, before };
}

export async function launchWorkerPdf(ui: WorkerUi) {
  if (process.env.E2E_ARMY_BLOCK_WORKERS !== "1") throw new Error("App Edge workers must remain blocked.");
  const ids = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-TKW04`, title: "Plans worker" }, ui.army);
  expect((await readEstimate(ui.browser, ids.versionId)).version.calc_engine_version).toBe(2);
  await createLineViaApi(ui.browser, ids.versionId, `${ui.army.runPrefix} existing base`);
  const plans = await createPlanSet(ui, ui.army, ids, `${ui.army.runPrefix} plans`);
  const file = await uploadSamplePlan(ui, ui.army, plans);
  await ui.app.open(`/dashboard/affaires/${ids.projectId}`);
  await openTakeoffPreparation(ui);
  const dialog = await fillTakeoffPreparation(ui, { sources: [file.file_name], objective: "extract_quantities", unit: "Unités des lignes sources",
    inclusions: "Toutes les lignes du tableau", levels: "Tous", zones: "Toutes", exclusions: "", processing: { level: "B", provider: "gemini" } });
  await dialog.getByRole("button", "Confirmer et lancer le métré", { exact: true }).click();
  const jobs = ownedTakeoffJobs(ui.browser, ids);
  await expect.poll(async () => (await jobs.list()).length).toBe(1);
  const [job] = await jobs.list();
  expect(job).toMatchObject({ estimate_version_id: ids.versionId, status: "pending", level: "B", source_file_name: file.file_name });
  await recordEvidence(ui.army, "TKW04-real-plan-created", { ids, planSetId: plans.id, file, job });
  return { ids, jobId: job.id, fileName: file.file_name };
}
