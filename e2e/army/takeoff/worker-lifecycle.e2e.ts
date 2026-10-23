import { randomUUID } from "node:crypto";

import { expect } from "e2e";

import type { TakeoffJobActionResponse, TakeoffJobDetailResponse } from "@/lib/takeoff/types";

import { apiRequest, armyTest, createLineViaApi, readEstimate, recordEvidence } from "../critical/fixtures";
import { ownedEstimateContext, querySql } from "../local/calculation-gate-support";
import { launchWorkerCsv, launchWorkerPdf, startOwnedWorker } from "./worker-support";

const options = { session: "army", trace: "off" as const, tags: ["critical", "takeoff-worker", "local"], timeout: 180_000 };

armyTest("TKW01 real CSV upload runs the owned worker once and applies exact quantities through the UI", options, async (ui) => {
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

armyTest("TKW02 provider failure persists and a real manual retry completes the same job without duplicate results", options, async (ui) => {
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
  await ui.app.open(`/dashboard/estimates/${ids.versionId}/takeoff`);
  const retry = ui.screen.getByRole("button", "Relancer", { exact: true });
  // Wait on the actual persisted retry schedule; do not modify time or job state.
  await expect.poll(() => Date.now() >= Date.parse(failed.job.nextRetryAt!), { timeout: 20_000 }).toBe(true);
  // Eligibility is server-owned and includes its real retry backoff.
  await expect.poll(async () => {
    const response = await apiRequest<{ data: { jobs: Array<{ id: string; can_resubmit?: boolean }> } }>(
      ui.browser, "GET", `/api/takeoff/jobs?estimate_version_id=${ids.versionId}`);
    return response.body.data.jobs.find((job) => job.id === jobId)?.can_resubmit;
  }, { timeout: 20_000 }).toBe(true);
  await ui.browser.reload();
  await expect(retry).toBeEnabled();
  const [retried] = await Promise.all([
    ui.browser.waitForResponse(`**/api/takeoff/jobs/${jobId}/retry`),
    retry.click(),
  ]);
  expect(retried.status).toBe(200);
  const retryBody = await retried.json<{ data: { job: { id: string; status: string }; dispatch: { status: string; persisted: boolean } } }>();
  expect(retryBody.data.job).toMatchObject({ id: jobId, status: "pending" });
  expect(retryBody.data.dispatch).toMatchObject({ status: "queued_for_recovery", persisted: true });
  const duplicate = await apiRequest<{ ok: boolean }>(ui.browser, "POST", `/api/takeoff/jobs/${jobId}/retry`);
  expect(duplicate.status).toBe(409);
  const completed = await startOwnedWorker(ui, ids, jobId).done;
  expect(completed.outcome.status).toBe("completed");
  expect(completed.job.retryCount).toBe(1);
  expect(completed.resultIds).toHaveLength(1);
  expect(completed.resultIds).not.toEqual(failed.resultIds);
  expect(completed.results[0]).toMatchObject({ failed: false, errorCode: null });
  expect(completed.items).toHaveLength(2);
  await ui.browser.reload();
  await expect(ui.screen.getByRole("link", "Revue", { exact: true })).toBeVisible();
  await recordEvidence(ui.army, "TKW02-failure-retry", { ids, jobId, failed, retry: retryBody.data, duplicateStatus: duplicate.status, completed });
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

armyTest("TKW06 concurrent resubmissions of a canceled UI upload reset the same job once, then one owned worker completes without changing the estimate", options, async (ui) => {
  const { ids, jobId, fileName } = await launchWorkerCsv(ui, "TKW06");
  await createLineViaApi(ui.browser, ids.versionId, `${ui.army.runPrefix} retained estimate line`, { quantity: 2, unit_price_ht_cents: 1250 });
  const released = await apiRequest(ui.browser, "DELETE", `/api/estimates/${ids.versionId}/lock`);
  expect(released.status).toBe(200);
  const before = await readEstimate(ui.browser, ids.versionId);
  expect([before.version.total_ht_cents, before.version.total_tax_cents, before.version.total_ttc_cents]).toEqual([2500, 500, 3000]);

  await ui.app.open(`/dashboard/estimates/${ids.versionId}/takeoff`);
  const [canceled] = await Promise.all([
    ui.browser.waitForResponse(`**/api/takeoff/jobs/${jobId}/cancel`),
    ui.screen.getByRole("button", "Annuler", { exact: true }).click(),
  ]);
  expect(canceled.status).toBe(200);
  const cancelBody = await canceled.json<ActionEnvelope>();
  expect(cancelBody.data).toMatchObject({ command: "cancel", outcome: "applied", job: { id: jobId, status: "canceled", retry_count: 0 } });
  const submissions = await Promise.all([0, 1].map(() =>
    apiRequest<ActionEnvelope>(ui.browser, "POST", `/api/takeoff/jobs/${jobId}/resubmit`)));
  expect(submissions.map(response => response.status).sort()).toEqual([200, 409]);
  const applied = submissions.find(response => response.status === 200)!;
  const refused = submissions.find(response => response.status === 409)!;
  expect(applied.body.ok).toBe(true);
  expect(applied.body.data).toMatchObject({
    command: "resubmit", outcome: "applied", job: { id: jobId, status: "pending", retry_count: 1 },
    dispatch: { status: "queued_for_recovery", persisted: true },
  });
  expect([refused.body.ok, refused.body.error?.code]).toEqual([false, "CONFLICT"]);
  const queued = await apiRequest<{ ok: boolean; data: TakeoffJobDetailResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}`);
  expect([queued.status, queued.body.ok]).toEqual([200, true]);
  expect(queued.body.data.job).toMatchObject({
    id: jobId, status: "pending", retry_count: 1, dispatch_trigger: "retry",
    dispatch_correlation_id: applied.body.data.dispatch!.correlation_id,
  });
  expect(["queued", "trigger_failed"]).toContain(queued.body.data.job.dispatch_status);
  expect(queued.body.data.result).toBeNull();
  expect(queued.body.data.items.data).toEqual([]);

  const completed = await startOwnedWorker(ui, ids, jobId).done;
  expect(completed.outcome.status).toBe("completed");
  expect(completed.job).toMatchObject({ id: jobId, status: "completed", retryCount: 1 });
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
  expect(replay.results).toEqual(completed.results);
  expect(replay.items).toEqual(completed.items);
  await ui.browser.reload();
  const persisted = await apiRequest<{ ok: boolean; data: TakeoffJobDetailResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}`);
  expect(persisted.status).toBe(200);
  expect(persisted.body.data.job).toMatchObject({ id: jobId, status: "completed", retry_count: 1 });
  expect(persisted.body.data.items.data.map(item => item.id).sort()).toEqual(completed.items.map(item => item.id).sort());
  const after = await readEstimate(ui.browser, ids.versionId);
  expect(after.items).toEqual(before.items);
  expect([after.version.total_ht_cents, after.version.total_tax_cents, after.version.total_ttc_cents]).toEqual([2500, 500, 3000]);
  await recordEvidence(ui.army, "TKW06-concurrent-resubmit", {
    ids, jobId, cancel: cancelBody.data, submissions, queued: queued.body.data.job, completed, replay,
    estimateTotals: [2500, 500, 3000], estimateUnchanged: true, retainedItemIds: after.items.map(item => item.id),
  });
});

armyTest("TKW07 a failed batch reconcile resets scheduling once and preserves its provider reference, while a live lease makes a later reconcile a no-op", options, async (ui) => {
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
  const protectedBatch = [];
  // While failed, both commands reach the active-provider-batch guard rather than
  // merely the processing-status guard. Neither may orphan the existing batch.
  for (const command of ["retry", "resubmit"]) {
    const refused = await apiRequest<ActionEnvelope>(ui.browser, "POST", `/api/takeoff/jobs/${jobId}/${command}`);
    expect([refused.status, refused.body.ok, refused.body.error?.code]).toEqual([409, false, "CONFLICT"]);
    expect(refused.body.error?.details).toMatchObject({ provider_batch_id: batchId, provider_batch_state: "running" });
    protectedBatch.push({ phase: "failed-live-batch", command, status: refused.status, code: refused.body.error?.code });
  }
  expect(await readState()).toEqual(seeded);
  const [requestClockBefore] = await querySql("SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;\n");
  const reconcileWindowStartMs = Number(requestClockBefore);
  // PostgreSQL and the app run on this native host. Allow at most 1 s of clock skew.
  const reconcileClockToleranceMs = 1000;
  expect(Date.parse(seeded.dueAt!)).toBeLessThan(reconcileWindowStartMs - 5 * 60_000);
  const reconcile = await apiRequest<ActionEnvelope>(ui.browser, "POST", `/api/takeoff/jobs/${jobId}/reconcile`);
  expect([reconcile.status, reconcile.body.ok]).toEqual([200, true]);
  expect(reconcile.body.data).toMatchObject({ command: "reconcile", outcome: "applied",
    job: { id: jobId, status: "processing", retry_count: 1, provider_batch_id: batchId, provider_batch_state: "running", provider_reconcile_attempt_count: 0 },
    dispatch: { status: "queued_for_recovery", persisted: true } });
  const resumed = await readState();
  const [requestClockAfter] = await querySql("SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;\n");
  const reconcileWindowEndMs = Number(requestClockAfter);
  expect(Date.parse(resumed.dueAt!)).toBeGreaterThanOrEqual(reconcileWindowStartMs - reconcileClockToleranceMs);
  expect(Date.parse(resumed.dueAt!)).toBeLessThanOrEqual(reconcileWindowEndMs + reconcileClockToleranceMs);
  expect(resumed).toMatchObject({ id: jobId, status: "processing", retryCount: 1, attempts: 0, batchId, batchState: "running", fileName,
    errorCode: null, completedAt: null, lastErrorAt: null, leaseToken: null, leaseExpiresAt: null, resultIds: [], itemIds: [],
    dispatch: { trigger: "reconcile", correlationId: reconcile.body.data.dispatch!.correlation_id } });
  expect(["queued", "trigger_failed"]).toContain(resumed.dispatch.status);
  for (const command of ["retry", "resubmit"]) {
    const refused = await apiRequest<ActionEnvelope>(ui.browser, "POST", `/api/takeoff/jobs/${jobId}/${command}`);
    expect([refused.status, refused.body.ok, refused.body.error?.code]).toEqual([409, false, "CONFLICT"]);
    protectedBatch.push({ phase: "processing-live-batch", command, status: refused.status, code: refused.body.error?.code });
  }
  expect(await readState()).toEqual(resumed);

  const leaseToken = randomUUID();
  const leased = await querySql(`BEGIN;
    DO $army_tkw07$ DECLARE affected integer; BEGIN
      IF current_user <> 'postgres' THEN RAISE EXCEPTION 'Native fixture owner required'; END IF;
      UPDATE public.takeoff_jobs j SET provider_reconcile_lease_token = '${leaseToken}'::uuid,
        provider_reconcile_lease_expires_at = clock_timestamp() + interval '10 minutes'
        WHERE ${ownedJob} AND j.status = 'processing' AND j.provider_batch_id = '${batchId}'
          AND j.provider_reconcile_attempt_count = 0 AND j.provider_reconcile_lease_token IS NULL;
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected <> 1 THEN RAISE EXCEPTION 'Exactly one owned resumed batch must receive its lease'; END IF;
    END $army_tkw07$;
    COMMIT;
    SELECT 'ARMY_BATCH_LEASE_PREPARED';\n`);
  expect(leased).toContain("ARMY_BATCH_LEASE_PREPARED");
  const liveLease = await readState();
  expect(liveLease.leaseToken).toBe(leaseToken);
  expect(Date.parse(liveLease.leaseExpiresAt!)).toBeGreaterThan(Date.now() + 5 * 60_000);
  const noop = await apiRequest<ActionEnvelope>(ui.browser, "POST", `/api/takeoff/jobs/${jobId}/reconcile`);
  expect([noop.status, noop.body.ok]).toEqual([200, true]);
  expect(noop.body.data).toMatchObject({ command: "reconcile", outcome: "noop", job: { id: jobId, status: "processing", provider_reconcile_attempt_count: 0 } });
  expect(noop.body.data.dispatch).toBeUndefined();
  const persisted = await readState();
  expect(persisted).toEqual(liveLease);
  await ui.browser.reload();
  const detail = await apiRequest<{ ok: boolean; data: TakeoffJobDetailResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}`);
  expect(detail.status).toBe(200);
  expect(detail.body.data.job).toMatchObject({ id: jobId, status: "processing", provider_batch_id: batchId, provider_batch_state: "running", retry_count: 1 });
  expect(detail.body.data.result).toBeNull();
  expect(detail.body.data.items.data).toEqual([]);
  const after = await readEstimate(ui.browser, ids.versionId);
  expect(after.items).toEqual(before.items);
  expect([after.version.total_ht_cents, after.version.total_tax_cents, after.version.total_ttc_cents]).toEqual([2500, 500, 3000]);
  await recordEvidence(ui.army, "TKW07-batch-scheduling-only", {
    ids, jobId, batchId, seeded, reconcile: reconcile.body.data, resumed, protectedBatch, liveLease, noop: noop.body.data, persisted,
    reconcileWindow: { startMs: reconcileWindowStartMs, endMs: reconcileWindowEndMs, clockToleranceMs: reconcileClockToleranceMs },
    estimateTotals: [2500, 500, 3000], estimateUnchanged: true,
    boundary: "Local owned UI upload only. Fictitious batch reference; scheduling, durable dispatch and lease protection exercised without invoking a provider or processor. TKW01-06 cover the real controlled processors separately.",
  });
});
