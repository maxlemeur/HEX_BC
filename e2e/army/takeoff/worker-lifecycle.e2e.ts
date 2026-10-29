import { randomUUID } from "node:crypto";

import { expect } from "e2e";

import type { TakeoffJobActionResponse, TakeoffJobDetailResponse } from "@/lib/takeoff/types";

import { apiRequest, armyTest, createLineViaApi, readEstimate, recordEvidence } from "../critical/fixtures";
import { ownedEstimateContext, querySql } from "../local/calculation-gate-support";
import { launchWorkerCsv, launchWorkerPdf, startOwnedWorker } from "./worker-support";

const options = { session: "army", trace: "off" as const, tags: ["critical", "takeoff-worker", "local"], timeout: 180_000 };

armyTest("TKW01 a stored historical CSV runs the controlled worker once and applies exact quantities through the UI", options, async (ui) => {
  const { ids, jobId, fileName } = await launchWorkerCsv(ui, "TKW01");
  const worker = startOwnedWorker(ui, ids, jobId);
  const completed = await worker.done;
  expect(completed.outcome.status).toBe("completed");
  expect(completed.job.status).toBe("completed");
  expect(completed.providerCalls).toBe(1);
  expect(completed.resultIds).toHaveLength(1);
  expect(completed.items.map(({ designation, quantity, unit, source_file_name, source_page }) =>
    ({ designation, quantity, unit, source_file_name, source_page }))).toEqual([
    { designation: "ARMY worker pipe", quantity: 12.5, unit: "m", source_file_name: fileName, source_page: 1 },
    { designation: "ARMY worker valve", quantity: 3, unit: "u", source_file_name: fileName, source_page: 1 },
  ]);
  const replay = await startOwnedWorker(ui, ids, jobId).done;
  expect(replay.outcome.status).toBe("noop_terminal");
  expect(replay.providerCalls).toBe(0);
  expect(replay.resultIds).toEqual(completed.resultIds);
  expect(replay.items).toEqual(completed.items);

  // The baseline is an API fixture, so it owns and releases its own lease.
  // Do not mount the editor, whose separate UI lease would race the apply flow.
  const target = await createLineViaApi(ui.browser, ids.versionId, `${ui.army.runPrefix} existing line`);
  const released = await apiRequest<{ data: { released: boolean } }>(ui.browser, "DELETE", `/api/estimates/${ids.versionId}/lock`);
  expect(released.status).toBe(200);
  expect(released.body.data.released).toBe(true);
  const before = await readEstimate(ui.browser, ids.versionId);
  await ui.app.open(`/dashboard/estimates/${ids.versionId}/takeoff/${jobId}`);
  const reviewPath = `/dashboard/estimates/${ids.versionId}/takeoff/${jobId}/review`;
  const resultsLink = ui.screen.getByRole("link", "Voir les résultats", { exact: true });
  await expect(resultsLink).toBeVisible();
  await expect(resultsLink).toHaveAttribute("href", reviewPath);
  await resultsLink.click();
  await expect(ui.browser).toHaveURL(reviewPath);
  await expect(ui.screen.getByRole("heading", "Revue d’extraction", { exact: true })).toBeVisible();
  await ui.screen.getByRole("tab", "Assisté : Revue guidée carte par carte", { exact: true }).click();
  for (const item of completed.items) {
    const card = ui.screen.getByRole("article", item.designation, { exact: true });
    await expect(card).toBeVisible();
    await expect(card).toContainText(`${item.quantity} ${item.unit}`);
    await expect(card.getByText(fileName, { exact: true })).toBeVisible();
    await expect(card.getByText(`p. ${item.source_page}`, { exact: true })).toBeVisible();
  }
  await recordEvidence(ui.army, "TKW01-monitor-results-review", {
    ids, jobId, reviewPath, items: completed.items,
    boundary: "The owned worker uses the real processor and a controlled provider response.",
  });
  await ui.app.open(`/dashboard/estimates/${ids.versionId}/takeoff/${jobId}`);
  await ui.screen.getByRole("button", "Appliquer au devis", { exact: true }).click();
  const dialog = ui.screen.getByRole("dialog", "Appliquer au devis", { exact: true });
  await dialog.getByLabel("Section cible", { exact: true }).selectOption({ value: String(target.parent_id) });
  await dialog.getByRole("button", "Suivant", { exact: true }).click();
  await dialog.getByRole("radio", /^Ajouter sans effacer/).check();
  await dialog.getByRole("button", "Suivant", { exact: true }).click();
  await expect(dialog).toContainText("ARMY worker pipe");
  await dialog.getByRole("button", "Suivant", { exact: true }).click();
  const [applied] = await Promise.all([
    ui.browser.waitForResponse(`**/api/takeoff/jobs/${jobId}/apply`),
    dialog.getByRole("button", "Confirmer l'application", { exact: true }).click(),
  ]);
  const application = await applied.json<{ ok: boolean }>();
  await recordEvidence(ui.army, "TKW01-apply-response", { status: applied.status, body: application });
  expect(applied.status).toBe(200);
  expect(application.ok).toBe(true);
  await expect(dialog).toBeHidden();
  await ui.browser.reload();
  const after = await readEstimate(ui.browser, ids.versionId);
  for (const item of completed.items) {
    expect(after.items.filter((line) => line.title === item.designation)).toHaveLength(1);
    expect(after.items.find((line) => line.title === item.designation)).toMatchObject({
      quantity: item.quantity, parent_id: target.parent_id, source_job_id: jobId, source_file_name: fileName, source_page: 1,
    });
  }
  for (const item of before.items) expect(after.items.find((line) => line.id === item.id)).toMatchObject({
    title: item.title, quantity: item.quantity, unit_price_ht_cents: item.unit_price_ht_cents,
  });
  const appliedReplay = await startOwnedWorker(ui, ids, jobId).done;
  expect(appliedReplay.job.status).toBe("applied");
  expect(appliedReplay.providerCalls).toBe(0);
  expect(appliedReplay.resultIds).toEqual(completed.resultIds);
  await recordEvidence(ui.army, "TKW01-worker-application", { ids, jobId, completed, replay, appliedReplay,
    items: after.items.map(({ id, title, quantity, source_job_id }) => ({ id, title, quantity, source_job_id })) });
});

armyTest("TKW02 a historical provider failure persists and cannot be retried", options, async (ui) => {
  const { ids, jobId } = await launchWorkerCsv(ui, "TKW02");
  const failed = await startOwnedWorker(ui, ids, jobId, "transient").done;
  expect(failed.outcome).toMatchObject({ status: "failed_retryable", retryable: true, should_requeue: true });
  expect(failed.job).toMatchObject({ status: "failed", errorCode: "AI_TIMEOUT" });
  expect(failed.job.nextRetryAt).toBeTruthy();
  // The real processor retains one failure diagnostic, never extracted rows.
  expect(failed.resultIds).toHaveLength(1);
  expect(failed.results).toEqual([{ id: failed.resultIds[0], failed: true,
    errorCode: "AI_TIMEOUT", extractedJson: {}, warningCodes: ["PROCESSING_FAILED"] }]);
  expect(failed.items).toEqual([]);
  const retry = await apiRequest<{ error: { code: string } }>(ui.browser, "POST", `/api/takeoff/jobs/${jobId}/retry`);
  expect([retry.status, retry.body.error.code]).toEqual([422, "AI_PROVIDER"]);
  const detail = await apiRequest<{ data: TakeoffJobDetailResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}`);
  expect(detail.body.data.job).toMatchObject({ status: "failed", can_resubmit: false });
  await recordEvidence(ui.army, "TKW02-failure-retry", { ids, jobId, failed, retryStatus: retry.status,
    boundary: "Historical job: retry refused. LOCAL05 exercises concurrent retry of a local ChatGPT job." });
});

armyTest("TKW03 cancel during the real provider boundary prevents late result persistence", options, async (ui) => {
  const { ids, jobId, before } = await launchWorkerCsv(ui, "TKW03");
  const worker = startOwnedWorker(ui, ids, jobId, "hold");
  try {
    expect(await worker.provider).toMatchObject({ jobId, status: "processing" });
    await ui.app.open(`/dashboard/estimates/${ids.versionId}/takeoff`);
    const [canceled] = await Promise.all([
      ui.browser.waitForResponse(`**/api/takeoff/jobs/${jobId}/cancel`),
      ui.screen.getByRole("button", "Annuler", { exact: true }).click(),
    ]);
    expect(canceled.status).toBe(200);
    worker.release();
    const result = await worker.done;
    expect(result.outcome.status).toBe("canceled");
    expect(result.job.status).toBe("canceled");
    expect(result.resultIds).toEqual([]);
    expect(result.items).toEqual([]);
    expect((await readEstimate(ui.browser, ids.versionId)).items).toEqual(before.items);
    const replay = await startOwnedWorker(ui, ids, jobId).done;
    expect(replay.outcome.status).toBe("canceled");
    expect(replay.providerCalls).toBe(0);
    await ui.browser.reload();
    await expect(ui.screen.getByRole("button", "Relancer", { exact: true })).toHaveCount(0);
    await recordEvidence(ui.army, "TKW03-canceled-in-flight", { ids, jobId, result, replay });
  } finally { worker.stop(); }
});

armyTest("TKW04 a retained PDF runs the real level-B processor and exposes persisted page provenance", options, async (ui) => {
  const { ids, jobId, fileName } = await launchWorkerPdf(ui);
  const completed = await startOwnedWorker(ui, ids, jobId).done;
  expect(completed.outcome.status).toBe("completed");
  expect(completed.job).toMatchObject({ status: "completed", level: "B" });
  expect(completed.resultIds).toHaveLength(1);
  expect(completed.items.map(({ designation, quantity, source_file_name, source_page }) => ({ designation, quantity, source_file_name, source_page }))).toEqual([
    { designation: "ARMY worker pipe", quantity: 12.5, source_file_name: fileName, source_page: 1 },
    { designation: "ARMY worker valve", quantity: 3, source_file_name: fileName, source_page: 1 },
  ]);
  await ui.app.open(`/dashboard/estimates/${ids.versionId}/takeoff/${jobId}`);
  await expect(ui.screen.getByRole("button", "Appliquer au devis", { exact: true })).toBeVisible();
  const replay = await startOwnedWorker(ui, ids, jobId).done;
  expect(replay.outcome.status).toBe("noop_terminal");
  expect(replay.providerCalls).toBe(0);
  expect(replay.items).toEqual(completed.items);
  await recordEvidence(ui.army, "TKW04-PDF-worker-persisted", { ids, jobId, completed, replay });
});

armyTest("TKW05 terminal provider failure retains its diagnostic without extracted items or automatic retry", options, async (ui) => {
  const { ids, jobId, before } = await launchWorkerCsv(ui, "TKW05");
  const failed = await startOwnedWorker(ui, ids, jobId, "terminal").done;
  expect(failed.outcome).toMatchObject({ status: "failed_terminal", retryable: false, should_requeue: false });
  expect(failed.job).toMatchObject({ status: "failed", errorCode: "AI_PROVIDER", nextRetryAt: null });
  // The real processor retains one failure diagnostic, never extracted rows.
  expect(failed.resultIds).toHaveLength(1);
  expect(failed.results).toEqual([{ id: failed.resultIds[0], failed: true,
    errorCode: "AI_PROVIDER", extractedJson: {}, warningCodes: ["PROCESSING_FAILED"] }]);
  expect(failed.items).toEqual([]);
  await ui.browser.reload();
  await expect(ui.screen.getByRole("alert").filter({ hasText: "[AI_PROVIDER]ARMY controlled terminal provider failure" }))
    .toHaveText("[AI_PROVIDER]ARMY controlled terminal provider failure");
  await expect(ui.screen.getByText("Démarrage immédiat indisponible, reprise automatique active.", { exact: true })).toHaveCount(0);
  expect((await readEstimate(ui.browser, ids.versionId)).items).toEqual(before.items);
  await recordEvidence(ui.army, "TKW05-terminal-error", { ids, jobId, failed, estimateUnchanged: true });
});

type ActionEnvelope = {
  ok: boolean;
  data: TakeoffJobActionResponse;
  error?: { code: string; details?: { provider_batch_id?: string; provider_batch_state?: string } };
};

armyTest("TKW06 concurrent resubmissions cannot restart a canceled historical job", options, async (ui) => {
  const { ids, jobId } = await launchWorkerCsv(ui, "TKW06");
  const before = await readEstimate(ui.browser, ids.versionId);
  const canceled = await apiRequest<ActionEnvelope>(ui.browser, "POST", `/api/takeoff/jobs/${jobId}/cancel`);
  expect(canceled.status).toBe(200);
  const attempts = await Promise.all([0, 1].map(() =>
    apiRequest<{ error: { code: string } }>(ui.browser, "POST", `/api/takeoff/jobs/${jobId}/resubmit`)));
  expect(attempts.map(response => [response.status, response.body.error.code])).toEqual([[422, "AI_PROVIDER"], [422, "AI_PROVIDER"]]);
  const detail = await apiRequest<{ data: TakeoffJobDetailResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}`);
  expect(detail.body.data.job).toMatchObject({ id: jobId, status: "canceled", retry_count: 0, can_resubmit: false });
  expect((await readEstimate(ui.browser, ids.versionId)).items).toEqual(before.items);
  await recordEvidence(ui.army, "TKW06-historical-resubmit", { ids, jobId, attempts: attempts.map(response => response.status), unchanged: true,
    boundary: "Historical provider is blocked. LOCAL05 exercises concurrent resubmission for a ChatGPT job." });
});

armyTest("TKW07 a historical batch keeps its reference and cannot be requeued", options, async (ui) => {
  const { ids, jobId, fileName } = await launchWorkerCsv(ui, "TKW07");
  await createLineViaApi(ui.browser, ids.versionId, `${ui.army.runPrefix} retained batch estimate line`, { quantity: 2, unit_price_ht_cents: 1250 });
  expect((await apiRequest(ui.browser, "DELETE", `/api/estimates/${ids.versionId}/lock`)).status).toBe(200);
  const before = await readEstimate(ui.browser, ids.versionId);
  expect([before.version.total_ht_cents, before.version.total_tax_cents, before.version.total_ttc_cents]).toEqual([2500, 500, 3000]);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (process.env.E2E_ARMY_BLOCK_WORKERS !== "1" || process.env.E2E_ARMY_TAKEOFF_WORKER !== "1" ||
    !/^ARMY-[A-Za-z0-9-]+$/.test(ui.army.runPrefix) || ![ids.projectId, ids.versionId, jobId].every(value => uuid.test(value)) ||
    !ui.army.ownedEstimates.some(owned => owned.projectId === ids.projectId && owned.versionId === ids.versionId)) {
    throw new Error("Batch scheduling requires this invocation's exact owned worker fixture.");
  }
  let backend: URL, database: URL;
  try {
    backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    database = new URL(process.env.E2E_ARMY_LOCAL_DB_URL ?? "");
  } catch { throw new Error("Batch scheduling requires explicit owned loopback transports; values withheld."); }
  if (backend.protocol !== "http:" || !["postgres:", "postgresql:"].includes(database.protocol) ||
    [backend, database].some(url => !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || ["45585", "33485"].includes(url.port)) ||
    backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST) {
    throw new Error("Batch scheduling cannot target a shared or non-loopback backend.");
  }
  const owner = await ownedEstimateContext(ids.projectId);
  const batchId = `batches/army-${randomUUID()}`;
  const ownedJob = `j.id = '${jobId}'::uuid AND j.tenant_id = '${owner.tenantId}'::uuid
    AND j.estimate_version_id = '${ids.versionId}'::uuid AND j.created_by = '${owner.userId}'::uuid
    AND EXISTS (SELECT 1 FROM public.estimate_versions v JOIN public.estimate_projects p ON p.id = v.project_id
      JOIN public.tenants t ON t.id = p.tenant_id AND t.is_active AND t.name ~ '^ARMY\\y'
      WHERE v.id = j.estimate_version_id AND v.tenant_id = j.tenant_id AND v.calc_engine_version = 2
        AND p.id = '${ids.projectId}'::uuid AND p.user_id = '${owner.userId}'::uuid AND p.name = '${ui.army.runPrefix}-TKW07')`;
  type BatchState = {
    id: string; status: string; retryCount: number; attempts: number; batchId: string; batchState: string; fileName: string;
    dueAt: string | null;
    errorCode: string | null; completedAt: string | null; lastErrorAt: string | null; leaseToken: string | null; leaseExpiresAt: string | null;
    dispatch: { status: string; trigger: string; correlationId: string }; resultIds: string[]; itemIds: string[];
  };
  const readState = async () => {
    const rows = await querySql(`SELECT jsonb_build_object('id', j.id, 'status', j.status, 'retryCount', j.retry_count,
      'attempts', j.provider_reconcile_attempt_count, 'batchId', j.provider_batch_id, 'batchState', j.provider_batch_state,
      'fileName', j.source_file_name, 'errorCode', j.error_code, 'completedAt', j.completed_at, 'lastErrorAt', j.last_error_at,
      'dueAt', j.provider_reconcile_due_at, 'leaseToken', j.provider_reconcile_lease_token, 'leaseExpiresAt', j.provider_reconcile_lease_expires_at,
      'dispatch', jsonb_build_object('status', j.dispatch_status, 'outcome', j.dispatch_outcome, 'trigger', j.dispatch_trigger,
        'correlationId', j.dispatch_correlation_id, 'updatedAt', j.dispatch_updated_at),
      'resultIds', coalesce((SELECT jsonb_agg(r.id ORDER BY r.id) FROM public.takeoff_results r WHERE r.job_id = j.id), '[]'::jsonb),
      'itemIds', coalesce((SELECT jsonb_agg(i.id ORDER BY i.id) FROM public.takeoff_items i WHERE i.job_id = j.id), '[]'::jsonb))
      FROM public.takeoff_jobs j WHERE ${ownedJob} AND current_user = 'postgres';\n`);
    expect(rows).toHaveLength(1);
    return JSON.parse(rows[0]) as BatchState;
  };
  const prepared = await querySql(`BEGIN;
    DO $army_tkw07$ DECLARE affected integer; BEGIN
      IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Native fixture owner required'; END IF;
      UPDATE public.takeoff_jobs j SET status = 'failed', processing_strategy = 'batch', provider_batch_id = '${batchId}',
        provider_batch_state = 'running', provider_batch_updated_at = clock_timestamp(), retry_count = 1,
        completed_at = clock_timestamp() - interval '10 minutes', last_error_at = clock_timestamp() - interval '10 minutes',
        error_code = 'AI_TIMEOUT', error_message = 'ARMY controlled batch scheduling timeout', next_retry_at = null,
        provider_reconcile_due_at = clock_timestamp() - interval '10 minutes', provider_reconcile_attempt_count = 3,
        provider_reconcile_lease_token = null, provider_reconcile_lease_expires_at = null
        WHERE ${ownedJob} AND j.status = 'pending' AND j.processing_lease_token IS NULL;
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 1 THEN RAISE EXCEPTION 'Exactly one owned UI upload must be prepared'; END IF;
    END $army_tkw07$;
    COMMIT;
    SELECT 'ARMY_BATCH_SCHEDULING_PREPARED';\n`);
  expect(prepared).toContain("ARMY_BATCH_SCHEDULING_PREPARED");
  const seeded = await readState();
  expect(seeded).toMatchObject({ id: jobId, status: "failed", retryCount: 1, attempts: 3, batchId, batchState: "running", fileName,
    errorCode: "AI_TIMEOUT", leaseToken: null, leaseExpiresAt: null, resultIds: [], itemIds: [] });
  const refused = [];
  for (const command of ["retry", "resubmit", "reconcile"]) {
    const response = await apiRequest<{ error: { code: string } }>(ui.browser, "POST", `/api/takeoff/jobs/${jobId}/${command}`);
    expect([response.status, response.body.error.code]).toEqual([422, "AI_PROVIDER"]);
    expect(await readState()).toEqual(seeded);
    refused.push({ command, status: response.status });
  }
  const detail = await apiRequest<{ data: TakeoffJobDetailResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}`);
  expect(detail.body.data.job).toMatchObject({ id: jobId, status: "failed", can_reconcile: false, can_resubmit: false });
  expect((await readEstimate(ui.browser, ids.versionId)).items).toEqual(before.items);
  await recordEvidence(ui.army, "TKW07-historical-batch", { ids, jobId, batchId, seeded, refused, unchanged: true,
    boundary: "An owned historical batch reference is preserved; no provider or remote dispatch is invoked." });
});
