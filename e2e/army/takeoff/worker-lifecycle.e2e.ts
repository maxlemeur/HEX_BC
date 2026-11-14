import { createHash, randomUUID } from "node:crypto";

import { expect } from "e2e";

import type { TakeoffJobActionResponse, TakeoffJobDetailResponse } from "@/lib/takeoff/types";
import type { TakeoffVectorReadingResponse } from "@/lib/takeoff/vectors/read-contracts";

import { apiRequest, armyTest, createLineViaApi, readEstimate, recordEvidence } from "../critical/fixtures";
import { ownedEstimateContext, querySql } from "../local/calculation-gate-support";
import { signUpDedicatedOwner } from "../local/dedicated-owner";
import { TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS } from "../../../src/lib/takeoff/hypothesis";
import { VECTOR_PLAN } from "./vector-plan-fixture";
import {
  launchWorkerCsv, launchWorkerPdf, launchWorkerVectorPlan, launchWorkerVectorUpload, readVectorViewerDrawing, readVectorViewerFit, readWorkerDecisionsCalls,
  startOwnedWorker, workerDecisionsFixture,
} from "./worker-support";

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
  // TI-681 (docs/metier/regles-metre.md): a sold length is summed per line, then rounded up once to the
  // metre. The 12.5 m of pipe are sold as 13; the count of valves is kept.
  const soldQuantities: Record<string, number> = { "ARMY worker pipe": 13, "ARMY worker valve": 3 };
  for (const item of completed.items) {
    expect(after.items.filter((line) => line.title === item.designation)).toHaveLength(1);
    expect(after.items.find((line) => line.title === item.designation)).toMatchObject({
      quantity: soldQuantities[item.designation], parent_id: target.parent_id, source_job_id: jobId, source_file_name: fileName, source_page: 1,
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

// TI-662 (L3): the vector reading of a level C plan is persisted beside its result, read back by the review
// viewer under the user's session, and invisible to another tenant (API and RLS). Fictional plan, no model.
// Review of PR #147: the room measured on its closed polygon is persisted and drawn with the networks.
// CI of PR #147 (written before the fix): TKW08 and TKW09 seeded their pending jobs as the campaign account, whose
// admission budget (10 per user and tenant in 24 h, never freed) the other takeoff journeys of the stack also spend:
// after one earlier job in its CI shard, TKW09 was refused TAKEOFF_JOB_ADMISSION_LIMIT (it alone was the account's
// 10th admission of the file). Each now runs as its own dedicated owner and spends none of the campaign's budget.
armyTest("TKW08 a vector plan read at level C persists its measured networks and room, shows them in the review and stays invisible to another tenant", options, async (ui) => {
  const { ids, jobId, fileName, tenantId, planFileId, seedJob, owner: jobOwner } = await launchWorkerVectorPlan(ui);
  const completed = await startOwnedWorker(ui, ids, jobId, "success", { vectors: true, owner: jobOwner }).done;
  expect(completed.outcome.status).toBe("completed");
  expect(completed.job).toMatchObject({ status: "completed", level: "C" });
  expect(completed.providerCalls).toBe(1);
  expect(completed.resultIds).toHaveLength(1);
  const [resultId] = completed.resultIds;
  // The level C reading (controlled provider) and the two networks measured on the vectors, side by side; the vector items are
  // excluded by default with their reason, so applying the level C reading never counts a network twice.
  expect(completed.items.map(({ designation, quantity, unit, source_file_name, source_page, is_excluded, exclusion_reason }) =>
    ({ designation, quantity, unit, source_file_name, source_page, is_excluded, exclusion_reason }))).toEqual([
    { designation: "ARMY worker pipe", quantity: 12.5, unit: "m", source_file_name: fileName, source_page: 1, is_excluded: false, exclusion_reason: null },
    { designation: "ARMY worker valve", quantity: 3, unit: "u", source_file_name: fileName, source_page: 1, is_excluded: false, exclusion_reason: null },
    ...VECTOR_PLAN.networks.map((entry) => ({ designation: entry.designation, quantity: entry.length_m, unit: "ml", source_file_name: fileName, source_page: 1,
      is_excluded: true, exclusion_reason: "Lecture vectorielle : à comparer à la lecture du plan, non appliquée par défaut." })),
    // The room: its closed polygon's area (4.00 × 3.50 m), never the printed 13.80 m².
    { designation: VECTOR_PLAN.room.designation, quantity: VECTOR_PLAN.room.area_m2, unit: "m2", source_file_name: fileName, source_page: 1,
      is_excluded: true, exclusion_reason: "Lecture vectorielle : à comparer à la lecture du plan, non appliquée par défaut." },
  ]);
  const vectorItemIds = Object.fromEntries(completed.items.filter((item) => item.unit === "ml").map((item) => [item.designation, item.id]));
  const roomItemId = completed.items.find((item) => item.designation === VECTOR_PLAN.room.designation)!.id;
  expect(completed.vectorPages).toEqual([{ id: expect.any(String), tenantId, resultId, planFileId, sourceFileName: fileName, sourcePage: 1,
    scale: { status: "format", denominator: VECTOR_PLAN.denominator }, detection: 1, classes: ["mur", "EF", "EUV"],
    // Classes read by keywords; without MERGEONE_TAKEOFF_DECISIONS, no Decisions summary (TI-662 L3d).
    sources: ["keyword", "keyword", "keyword"], confidences: [null, null, null], decisions: null }]);
  const [vectorPage] = completed.vectorPages;
  expect([...completed.geometries].sort((left, right) => (left.network ?? "").localeCompare(right.network ?? ""))).toEqual([
    { itemId: roomItemId, tenantId, pageId: vectorPage.id, kind: "surface", network: null, lengthM: null, segments: 0 },
    ...VECTOR_PLAN.networks.map((entry) => ({ itemId: vectorItemIds[entry.designation], tenantId, pageId: vectorPage.id, kind: "network",
      network: entry.network, lengthM: entry.length_m, segments: 1 }))]);

  // The API the viewer reads, under the owner's session.
  const read = await apiRequest<{ ok: boolean; data: TakeoffVectorReadingResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}/vector-pages`);
  expect([read.status, read.body.ok]).toEqual([200, true]);
  // A plan-set job's pages go through their plan file: the job's own source is never signed for them.
  expect(read.body.data.source_download_url).toBeNull();
  expect(read.body.data.pages).toHaveLength(1);
  const [page] = read.body.data.pages;
  expect(page).toMatchObject({ id: vectorPage.id, plan_file_id: planFileId, source_file_name: fileName, source_page: 1 });
  expect(page.reading).toMatchObject({ mode: "layers", size_pt: VECTOR_PLAN.pageSize, location: { zone: "Z2", level: "R+1", source: "file_name" },
    scale: { status: "format", reason: null, denominator: 50, format: { cartouche: "Format A3", page_mm: [420, 297], matches: true } }, detection: 1 });
  expect(page.items.filter((item) => item.geometry.kind === "network").map(({ takeoff_item_id, geometry }) => ({ takeoff_item_id, network: geometry.network,
    material: geometry.material, dn: geometry.dn, length_m: geometry.length_m, zone: geometry.zone, level: geometry.level }))
    .sort((left, right) => (left.network ?? "").localeCompare(right.network ?? ""))).toEqual([
    { takeoff_item_id: vectorItemIds["EF PER DN 16"], network: "EF", material: "per", dn: 16, length_m: 5, zone: "Z2", level: "R+1" },
    { takeoff_item_id: vectorItemIds["EU/EV PVC DN 40"], network: "EUV", material: "pvc", dn: 40, length_m: 3, zone: "Z2", level: "R+1" },
  ]);
  // Centreline of the EF pipe: 100 mm from x = 200 pt at y = 500 pt (PDF), i.e. 341.89 pt from the top, in metres at 1/50.
  const metres = (points: number) => Math.round(((points * 25.4) / 72) * 50) / 1000;
  const ef = page.items.find((item) => item.geometry.network === "EF")!;
  expect(ef.geometry.segments_m).toHaveLength(1);
  const [x0, y0, x1, y1] = ef.geometry.segments_m[0];
  expect([x0, y0, x1, y1].map((value) => Math.round(value * 100) / 100)).toEqual([metres(200), metres(841.89 - 500), metres(200) + 5, metres(841.89 - 500)]
    .map((value) => Math.round(value * 100) / 100));
  // The room: area and outline in metres from the page's top-left corner (80 × 70 mm from x = 650 pt, y = 400 pt), its printed surface as control.
  const room = page.items.find((item) => item.geometry.kind === "surface")!;
  expect(room).toMatchObject({ takeoff_item_id: roomItemId, geometry: { network: null, material: null, dn: null, zone: "Z2", level: "R+1",
    groups: [page.reading.groups.find((group) => group.class === "mur")!.id], segments_m: [], length_m: null, area_m2: VECTOR_PLAN.room.area_m2, transform: null } });
  const left = metres(VECTOR_PLAN.room.x), bottom = metres(841.89 - VECTOR_PLAN.room.y);
  expect(room.geometry.polygon_m!.map((value) => Math.round(value * 100) / 100)).toEqual([left, bottom, left + 4, bottom, left + 4, bottom - 3.5, left, bottom - 3.5, left, bottom]
    .map((value) => Math.round(value * 100) / 100));
  expect(page.reading.surfaces).toEqual([{ room: VECTOR_PLAN.room.room, printed_m2: VECTOR_PLAN.room.printed_m2, polygon_m2: VECTOR_PLAN.room.area_m2, deviation: 0.0145 }]);

  // The review viewer: plan, scale, detection, networks and their toggles.
  await ui.app.open(`/dashboard/estimates/${ids.versionId}/takeoff/${jobId}/review`);
  const viewer = ui.screen.getByRole("region", "Lecture vectorielle du plan", { exact: true });
  await expect(viewer).toBeVisible({ timeout: 30_000 });
  await expect(viewer.getByText("Échelle 1/50 format conforme", { exact: true })).toBeVisible();
  await expect(viewer.getByText("Détection 100 %", { exact: true })).toBeVisible();
  const networks = viewer.getByRole("group", "Réseaux", { exact: true });
  await expect(networks).toContainText("EF 5.00 m");
  await expect(networks).toContainText("EUV 3.00 m");
  await expect(networks).not.toContainText("à revoir");
  await expect(viewer.getByRole("group", "Surfaces", { exact: true })).toContainText("Surfaces (1) 14.00 m²");
  const shown = viewer.getByText(/éléments affichés$/);
  await expect(shown).toHaveText("3 / 3 éléments affichés");
  // The plan itself is drawn under the geometry: a painted canvas, no rendering error, the EF centreline where the PDF draws it.
  await expect(viewer.getByText(/n’a pas pu être (affiché|chargée)|n’est pas disponible/)).toHaveCount(0);
  const drawn = await readVectorViewerDrawing(ui);
  expect(drawn.canvasWidth).toBeGreaterThan(0);
  expect(drawn.inked).toBeGreaterThan(0); // the blue pipes of the PDF, painted by pdfjs
  expect(drawn.lines.map((line) => line.network).sort()).toEqual(["EF", "EUV"]);
  const efLine = drawn.lines.find((line) => line.network === "EF")!;
  // In page fractions: from x = 200 pt over 283.46 pt (100 mm), at 341.89 pt from the top, on a 1190.55 × 841.89 pt page.
  expect([efLine.x1 / drawn.width, (efLine.x2 - efLine.x1) / drawn.width, efLine.y1 / drawn.height, efLine.y2 / drawn.height].map((value) => Math.round(value * 1000) / 1000))
    .toEqual([200 / 1190.55, 283.46 / 1190.55, 341.89 / 841.89, 341.89 / 841.89].map((value) => Math.round(value * 1000) / 1000));
  // The room's outline where the PDF draws it, in page fractions (x over the width, y over the height, from the top).
  expect(drawn.polygons).toHaveLength(1);
  const roomCorners = [650, 441.89, 876.77, 441.89, 876.77, 243.47, 650, 243.47, 650, 441.89];
  expect(drawn.polygons[0].map((value, index) => Math.round((value / (index % 2 === 0 ? drawn.width : drawn.height)) * 1000) / 1000))
    .toEqual(roomCorners.map((value, index) => Math.round((value / (index % 2 === 0 ? 1190.55 : 841.89)) * 1000) / 1000));
  // The page fits its frame, which appears with the reading after the loading message; on a phone the frame narrows
  // and the page fits it again (review of PR #317: the first page kept 0.25 px per point, measured before the frame).
  const fit = async () => { const { plan, frame } = await readVectorViewerFit(ui); return { plan, frame, fits: plan === frame }; };
  await expect.poll(fit).toMatchObject({ fits: true });
  const desktopFit = await fit();
  expect(desktopFit.frame).toBeGreaterThan(400);
  await ui.browser.setViewport({ width: 390, height: 844 });
  await expect.poll(async () => { const now = await fit(); return { ...now, narrower: now.frame > 0 && now.frame < desktopFit.frame }; })
    .toMatchObject({ fits: true, narrower: true });
  await ui.browser.setViewport({ width: 1280, height: 800 });
  await expect.poll(fit).toMatchObject({ fits: true, frame: desktopFit.frame });
  const efToggle = viewer.getByRole("checkbox", "Afficher EF", { exact: true });
  const euvToggle = viewer.getByRole("checkbox", "Afficher EUV", { exact: true });
  const surfacesToggle = viewer.getByRole("checkbox", "Afficher les surfaces", { exact: true });
  const roomPolygon = ui.browser.locator("section[aria-label='Lecture vectorielle du plan'] svg polygon[data-kind='surface']");
  await efToggle.click({ modifiers: ["Alt"] });
  await expect(shown).toHaveText("1 / 3 éléments affichés");
  await expect(efToggle).toBeChecked();
  await expect(euvToggle).not.toBeChecked();
  await expect(surfacesToggle).not.toBeChecked();
  await expect(roomPolygon).toHaveCount(0);
  await euvToggle.click();
  await expect(shown).toHaveText("2 / 3 éléments affichés");
  await surfacesToggle.click();
  await expect(shown).toHaveText("3 / 3 éléments affichés");
  await expect(roomPolygon).toHaveCount(1);
  await efToggle.click();
  await expect(shown).toHaveText("2 / 3 éléments affichés");
  await expect(efToggle).not.toBeChecked();
  await recordEvidence(ui.army, "TKW08-vector-review", { ids, jobId, resultId, vectorPage, geometries: completed.geometries, items: completed.items,
    reading: { scale: page.reading.scale, detection: page.reading.detection, location: page.reading.location },
    boundary: "Owned worker with MERGEONE_TAKEOFF_VECTORS=1, real extraction and persistence; level C provider controlled; fictional vector plan." });

  // Control: the same plan read without MERGEONE_TAKEOFF_VECTORS writes no vector row and no vector item.
  const controlJobId = await seedJob();
  const control = await startOwnedWorker(ui, ids, controlJobId, "success", { owner: jobOwner }).done;
  expect(control.outcome.status).toBe("completed");
  expect(control.job).toMatchObject({ status: "completed", level: "C" });
  expect([control.vectorPages, control.geometries, control.items.map((item) => item.designation)])
    .toEqual([[], [], ["ARMY worker pipe", "ARMY worker valve"]]);
  const controlRead = await apiRequest<{ ok: boolean; data: TakeoffVectorReadingResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${controlJobId}/vector-pages`);
  expect([controlRead.status, controlRead.body.data.pages]).toEqual([200, []]);
  await recordEvidence(ui.army, "TKW08-flag-off-control", { controlJobId, items: control.items, vectorPages: control.vectorPages });

  // Another tenant: its owner sees neither the job nor its vector reading, through the API or the RLS.
  const owner = await ownedEstimateContext(ids.projectId);
  expect(owner).toMatchObject({ tenantId, userId: jobOwner.userId });
  const foreign = await signUpDedicatedOwner(ui.browser, ui.app.baseUrl!, ui.army.runPrefix, { tag: "VEC" });
  expect(foreign.tenantId).not.toBe(tenantId);
  const denied = await apiRequest<{ ok: boolean; data?: unknown; error?: { code: string } }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}/vector-pages`);
  expect([denied.status, denied.body.ok, denied.body.data, denied.body.error?.code]).toEqual([404, false, undefined, "TAKEOFF_JOB_NOT_FOUND"]);
  const deniedFinancial = await apiRequest(ui.browser, "GET", `/api/takeoff/jobs/${jobId}/review-context`);
  expect(deniedFinancial.status).toBe(404);
  const rows = async (userId: string) => {
    const claims = JSON.stringify({ sub: userId, role: "authenticated" });
    const output = await querySql(`BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '${claims}', true) IS NOT NULL;
SELECT 'ARMY_TKW08 ' || jsonb_build_object('pages', (SELECT count(*) FROM public.takeoff_vector_pages WHERE job_id = '${jobId}'::uuid),
  'geometries', (SELECT count(*) FROM public.takeoff_item_geometries WHERE job_id = '${jobId}'::uuid))::text;
ROLLBACK;\n`);
    const line = output.find((entry) => entry.startsWith("ARMY_TKW08 "));
    expect(line).toBeDefined();
    return JSON.parse(line!.slice("ARMY_TKW08 ".length)) as { pages: number; geometries: number };
  };
  expect(await rows(owner.userId)).toEqual({ pages: 1, geometries: 3 });
  expect(await rows(foreign.userId)).toEqual({ pages: 0, geometries: 0 });
  await recordEvidence(ui.army, "TKW08-foreign-tenant", { jobId, foreignTenant: foreign.tenantId, api: denied.status, ownerRows: { pages: 1, geometries: 3 },
    foreignRows: { pages: 0, geometries: 0 } });
});

// TI-662 (review of PR #147): a plan uploaded directly (no plan set) is measured at the page calibration confirmed in
// its preparation, which names it `upload:<SHA-256>`; its review draws the uploaded PDF itself, signed for the
// user's session, and says so when that file is gone. The plan prints no scale. Fictional plan, no model.
armyTest("TKW09 a directly uploaded vector plan is measured at its confirmed calibration and its review draws the uploaded PDF", options, async (ui) => {
  const { ids, jobId, fileName, tenantId, sourcePath, sha256, client, owner } = await launchWorkerVectorUpload(ui);
  const completed = await startOwnedWorker(ui, ids, jobId, "success", { vectors: true, owner }).done;
  expect(completed.outcome.status).toBe("completed");
  expect(completed.job).toMatchObject({ status: "completed", level: "C" });
  const [resultId] = completed.resultIds;
  // Without the calibration the page would be « échelle non vérifiée » (no printed scale) and give no measure.
  expect(completed.vectorPages).toEqual([{ id: expect.any(String), tenantId, resultId, planFileId: null, sourceFileName: fileName, sourcePage: 1,
    scale: { status: "calibrated", denominator: VECTOR_PLAN.denominator }, detection: 1, classes: ["mur", "EF", "EUV"],
    // Classes read by keywords; without MERGEONE_TAKEOFF_DECISIONS, no Decisions summary (TI-662 L3d).
    sources: ["keyword", "keyword", "keyword"], confidences: [null, null, null], decisions: null }]);
  expect(completed.items.filter((item) => item.is_excluded).map(({ designation, quantity, unit }) => ({ designation, quantity, unit }))).toEqual([
    ...VECTOR_PLAN.networks.map((entry) => ({ designation: entry.designation, quantity: entry.length_m, unit: "ml" })),
    { designation: VECTOR_PLAN.room.designation, quantity: VECTOR_PLAN.room.area_m2, unit: "m2" },
  ]);
  expect(completed.geometries.map(({ kind, network, lengthM }) => ({ kind, network, lengthM }))
    .sort((left, right) => (left.network ?? "").localeCompare(right.network ?? ""))).toEqual([
    { kind: "surface", network: null, lengthM: null }, { kind: "network", network: "EF", lengthM: 5 }, { kind: "network", network: "EUV", lengthM: 3 }]);

  // The API the viewer reads: the calibrated page, and the uploaded PDF signed for this session (its bytes, never recorded).
  const read = await apiRequest<{ ok: boolean; data: TakeoffVectorReadingResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}/vector-pages`);
  expect([read.status, read.body.ok]).toEqual([200, true]);
  const [page] = read.body.data.pages;
  expect(page).toMatchObject({ plan_file_id: null, source_file_name: fileName, source_page: 1 });
  expect(page.reading.scale).toMatchObject({ status: "calibrated", reason: null, denominator: 50, cartouche: null,
    calibration: { denominator: 50, source: "conventions.calibration de la préparation" } });
  const signed = read.body.data.source_download_url;
  expect(signed).toEqual(expect.stringContaining(`/storage/v1/object/sign/takeoff-files/${tenantId}/${jobId}/`));
  const downloaded = await fetch(signed!);
  expect(downloaded.status).toBe(200);
  expect(createHash("sha256").update(Buffer.from(await downloaded.arrayBuffer())).digest("hex")).toBe(sha256);

  await ui.app.open(`/dashboard/estimates/${ids.versionId}/takeoff/${jobId}/review`);
  const viewer = ui.screen.getByRole("region", "Lecture vectorielle du plan", { exact: true });
  await expect(viewer).toBeVisible({ timeout: 30_000 });
  await expect(viewer.getByText("Échelle 1/50 calibrée", { exact: true })).toBeVisible();
  const networks = viewer.getByRole("group", "Réseaux", { exact: true });
  await expect(networks).toContainText("EF 5.00 m");
  await expect(networks).toContainText("EUV 3.00 m");
  await expect(viewer.getByText(/éléments affichés$/)).toHaveText("3 / 3 éléments affichés");
  // The uploaded plan is painted under the geometry, without any message.
  const drawn = await readVectorViewerDrawing(ui);
  expect(drawn.canvasWidth).toBeGreaterThan(0);
  expect(drawn.inked).toBeGreaterThan(0);
  expect(drawn.lines.map((line) => line.network).sort()).toEqual(["EF", "EUV"]);
  expect(drawn.polygons).toHaveLength(1);
  await expect(viewer.getByText(/n’a pas pu être (affiché|chargée)|n’est pas disponible/)).toHaveCount(0);
  await recordEvidence(ui.army, "TKW09-vector-upload-review", { ids, jobId, resultId, vectorPages: completed.vectorPages, geometries: completed.geometries,
    scale: page.reading.scale, sourceSha256: sha256, canvas: { width: drawn.canvasWidth, inked: drawn.inked },
    boundary: "Owned worker with MERGEONE_TAKEOFF_VECTORS=1 on a direct upload; preparation confirmed by the product's snapshot builder; fictional plan." });

  // The uploaded file gone, the reading stays readable and the viewer says the plan is unavailable instead of an empty canvas.
  const removed = await client.storage.from("takeoff-files").remove([sourcePath]);
  expect(removed.error).toBeNull();
  const after = await apiRequest<{ ok: boolean; data: TakeoffVectorReadingResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}/vector-pages`);
  expect([after.status, after.body.data.source_download_url, after.body.data.pages.length]).toEqual([200, null, 1]);
  await ui.app.open(`/dashboard/estimates/${ids.versionId}/takeoff/${jobId}/review`);
  await expect(viewer).toBeVisible({ timeout: 30_000 });
  await expect(viewer.getByText("Le plan source de cette page n’est pas disponible ; la géométrie reste visible.", { exact: true })).toBeVisible();
  await expect(viewer.getByText(/éléments affichés$/)).toHaveText("3 / 3 éléments affichés");

  // Another tenant: neither the reading nor a signed URL.
  const foreign = await signUpDedicatedOwner(ui.browser, ui.app.baseUrl!, ui.army.runPrefix, { tag: "VEU" });
  expect(foreign.tenantId).not.toBe(tenantId);
  const denied = await apiRequest<{ ok: boolean; data?: unknown; error?: { code: string } }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}/vector-pages`);
  expect([denied.status, denied.body.ok, denied.body.data, denied.body.error?.code]).toEqual([404, false, undefined, "TAKEOFF_JOB_NOT_FOUND"]);
  await recordEvidence(ui.army, "TKW09-source-missing-and-foreign", { jobId, sourceRemoved: true, sourceDownloadUrl: null, foreignTenant: foreign.tenantId,
    api: denied.status });
});

// TI-662 L3d: with MERGEONE_TAKEOFF_DECISIONS=1, the worker asks Decisions about the one group of the plan no keyword names
// (vector-plan-fixture.ts `decisionsLayer`), answered EU at 0.8 by the provider fixture over the worker's network guard: one
// batch call of one question, the group classified and measured, its source and confidence persisted and shown in the review.
// A failed call is never retried, never fails the job, and leaves the group « à revoir ». Fictional plan, no paid call.
armyTest("TKW10 Decisions classes the unnamed group of a vector plan in the worker, shown with its source; a failed call leaves it à revoir without failing the job", options, async (ui) => {
  const { ids, jobId, fileName, seedJob, owner } = await launchWorkerVectorPlan(ui, { journey: "TKW10", tag: "VDE", decisionsLayer: true });
  const decisions = await workerDecisionsFixture(ui, "TKW10");
  const answered = await startOwnedWorker(ui, ids, jobId, "success", { vectors: true, owner, decisions }).done;
  expect(answered.outcome.status).toBe("completed");
  expect(answered.job).toMatchObject({ status: "completed", level: "C" });
  expect(answered.providerCalls).toBe(1);
  // One call, one question with its own image (TI-704 v2: no legend block on this plan).
  expect(await readWorkerDecisionsCalls(decisions)).toEqual([{ provider: "decisions-fixture", questions: 1, task: "vector-groups", images: 1 }]);
  const [page] = answered.vectorPages;
  expect(answered.vectorPages).toHaveLength(1);
  // Groups longest first: the room's walls (300 mm), EF (100 mm), the unnamed red pipe (80 mm), EU/EV (60 mm).
  expect(page).toMatchObject({ scale: { status: "format", denominator: 50 }, detection: 1, classes: ["mur", "EF", "EU", "EUV"],
    sources: ["keyword", "keyword", "decisions", "keyword"], confidences: [null, null, 0.8, null] });
  expect(page.decisions).toEqual({ prompt_version: "takeoff-vector-groups-v2", rules_version: 3, filtered: {}, ruled: { same_colour: 0, band: 0, propagated: 0 },
    candidates: 1, eligible: 1, left_out: 0, dedicated_left_out: 0,
    calls: { batch: 1, dedicated: 0, failed: 0 }, answered: 1, total_tokens: 1, latency_ms: expect.any(Number), stop: null });
  const exclusion = "Lecture vectorielle : à comparer à la lecture du plan, non appliquée par défaut.";
  // The red pipe is measured at a margin of 0.8: 80 mm at 1/50, without label (no material nor DN), excluded by default like any vector item.
  expect(answered.items.filter((item) => item.unit === "ml").map(({ designation, quantity, is_excluded, exclusion_reason }) => ({ designation, quantity, is_excluded, exclusion_reason })))
    .toEqual([
      { designation: "EF PER DN 16", quantity: 5, is_excluded: true, exclusion_reason: exclusion },
      { designation: "EU", quantity: VECTOR_PLAN.decisions.length_m, is_excluded: true, exclusion_reason: exclusion },
      { designation: "EU/EV PVC DN 40", quantity: 3, is_excluded: true, exclusion_reason: exclusion },
    ]);
  expect(answered.geometries.filter((geometry) => geometry.network === "EU")).toEqual([expect.objectContaining({ kind: "network", lengthM: 4, segments: 1 })]);

  // The API the viewer reads: the group's class, source and confidence, and the page's Decisions summary.
  const read = await apiRequest<{ ok: boolean; data: TakeoffVectorReadingResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}/vector-pages`);
  expect([read.status, read.body.ok, read.body.data.pages.length]).toEqual([200, true, 1]);
  const [readPage] = read.body.data.pages;
  const decided = readPage.reading.groups.find((group) => group.source === "decisions");
  expect(decided).toMatchObject({ class: "EU", confidence: 0.8, near_white: false });
  expect(readPage.items.find((item) => item.geometry.network === "EU")?.geometry.groups).toEqual([decided!.id]);
  expect(readPage.reading.decisions).toMatchObject({ calls: { batch: 1, dedicated: 0, failed: 0 }, stop: null });

  // The review: each network with its source, EU with Decisions' confidence; nothing left « à revoir ».
  await ui.app.open(`/dashboard/estimates/${ids.versionId}/takeoff/${jobId}/review`);
  const viewer = ui.screen.getByRole("region", "Lecture vectorielle du plan", { exact: true });
  await expect(viewer).toBeVisible({ timeout: 30_000 });
  await expect(viewer.getByText("Détection 100 %", { exact: true })).toBeVisible();
  const networks = viewer.getByRole("group", "Réseaux", { exact: true });
  // Each row: the network, its length, then how its class was read.
  await expect(networks).toContainText(/EF\s*5\.00 m\s*mots-clés\s*EU\s*4\.00 m\s*Decisions 80 %\s*EUV\s*3\.00 m\s*mots-clés/);
  await expect(viewer.getByText("Decisions : 1 appel, 1 jeton, 1 réponse", { exact: true })).toBeVisible();
  await expect(viewer.getByText(/à revoir/)).toHaveCount(0);
  await expect(viewer.getByText(/éléments affichés$/)).toHaveText("4 / 4 éléments affichés");
  const drawn = await readVectorViewerDrawing(ui);
  expect(drawn.lines.map((line) => line.network).sort()).toEqual(["EF", "EU", "EUV"]);
  await recordEvidence(ui.army, "TKW10-decisions-answered", { ids, jobId, vectorPage: page, items: answered.items, geometries: answered.geometries,
    boundary: "Owned worker with MERGEONE_TAKEOFF_VECTORS=1 and MERGEONE_TAKEOFF_DECISIONS=1; Decisions answered by the provider fixture installed over the worker's network guard; no paid call; fictional vector plan." });

  // A failed Decisions call: no retry, the job completes, the group stays « à revoir » and is not measured.
  const failing = await workerDecisionsFixture(ui, "TKW10-failed", { fail: true });
  const failedJobId = await seedJob();
  const failed = await startOwnedWorker(ui, ids, failedJobId, "success", { vectors: true, owner, decisions: failing }).done;
  expect(failed.outcome.status).toBe("completed");
  expect(failed.job).toMatchObject({ status: "completed", level: "C" });
  expect(await readWorkerDecisionsCalls(failing)).toEqual([{ provider: "decisions-fixture", questions: 1, task: "vector-groups", images: 1, failed: true }]);
  const [failedPage] = failed.vectorPages;
  // Classified groups first in the page record, then the unclassified one.
  expect(failedPage).toMatchObject({ classes: ["mur", "EF", "EUV", null], sources: ["keyword", "keyword", "keyword", null], confidences: [null, null, null, null] });
  expect(failedPage.decisions).toMatchObject({ candidates: 1, calls: { batch: 1, dedicated: 0, failed: 1 }, answered: 0, total_tokens: 0,
    stop: { reason: "call_failed", message: "Un appel Decisions a échoué, aucun appel n’a été lancé ensuite : les groupes restants sont à revoir.", from_earlier_page: false } });
  expect(failed.items.map((item) => item.designation)).toEqual(["ARMY worker pipe", "ARMY worker valve", "EF PER DN 16", "EU/EV PVC DN 40",
    VECTOR_PLAN.room.designation].sort((left, right) => left.localeCompare(right)));
  expect(failed.geometries.some((geometry) => geometry.network === "EU")).toBe(false);
  await ui.app.open(`/dashboard/estimates/${ids.versionId}/takeoff/${failedJobId}/review`);
  await expect(viewer).toBeVisible({ timeout: 30_000 });
  await expect(viewer.getByText("Un appel Decisions a échoué, aucun appel n’a été lancé ensuite : les groupes restants sont à revoir.", { exact: true })).toBeVisible();
  await expect(viewer.getByText("Decisions : 1 appel, 0 jeton, 0 réponse", { exact: true })).toBeVisible();
  await expect(viewer.getByText("1 groupe de tracés à revoir", { exact: true })).toBeVisible();
  await expect(networks).not.toContainText(/EU\s*4\.00 m/);
  await expect(viewer.getByText(/éléments affichés$/)).toHaveText("3 / 3 éléments affichés");
  await recordEvidence(ui.army, "TKW10-decisions-failed", { failedJobId, fileName, vectorPage: failedPage, items: failed.items,
    boundary: "The provider fixture answers 500 to the one Decisions call; the worker completes the job with its keyword reading." });
});

// TI-682 D11: an hypothesis is never preselected. The real level B processor, the fixed rules on: a weld count a plan
// cannot show arrives excluded with its reason, the valve count beside it stays preselected. The review lists the weld
// until its quantity is entered with what it rests on, which includes it.
armyTest("TKW11 a quantity a plan cannot show arrives excluded with its reason, and the count beside it stays preselected", options, async (ui) => {
  const { ids, jobId } = await launchWorkerPdf(ui);
  const completed = await startOwnedWorker(ui, ids, jobId, "success", { rules: true, providerItems: [
    { designation: "Soudures inox", quantity: 48, unit: "u", source_page: 1, confidence: 0.99, evidence: "Supposées, page 1" },
    { designation: "ARMY worker valve", quantity: 3, unit: "u", source_page: 1, confidence: 0.99, evidence: "Valve row, page 1" },
  ] }).done;
  expect(completed.outcome.status).toBe("completed");
  expect(completed.items.map(({ designation, quantity, is_excluded, exclusion_reason }) => ({ designation, quantity, is_excluded, exclusion_reason }))
    .sort((left, right) => right.designation.localeCompare(left.designation))).toEqual([
    { designation: "Soudures inox", quantity: 48, is_excluded: true, exclusion_reason: TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.non_observable },
    { designation: "ARMY worker valve", quantity: 3, is_excluded: false, exclusion_reason: null },
  ]);
  const weld = completed.items.find((item) => item.designation === "Soudures inox")!;

  await ui.app.open(`/dashboard/affaires/${ids.projectId}/takeoff/${jobId}/review/targeted?versionId=${ids.versionId}&line=${weld.id}`);
  const list = ui.screen.getByRole("listbox", "Lignes à trancher", { exact: true });
  const panel = ui.screen.getByRole("region", "Décision sur la ligne", { exact: true });
  await expect(list.getByRole("option", /^Soudures inox/)).toContainText("Hypothèse");
  await expect(panel).toContainText(TAKEOFF_HYPOTHESIS_EXCLUSION_REASONS.non_observable);
  await expect(panel).toContainText("NON_OBSERVABLE_TO_ENTER");
  await expect(panel.getByRole("button", /^Accepter/)).toBeDisabled();
  await expect(panel.getByRole("button", /^Inclure/)).toHaveCount(0);

  await panel.getByLabel("Quantité à saisir", { exact: true }).click();
  await ui.browser.keyboard.press("Enter");
  const entry = ui.screen.getByRole("dialog", "Justifier la quantité saisie", { exact: true });
  await entry.getByLabel("Justification", { exact: true }).selectOption({ value: "site_survey" });
  const attested = ui.browser.waitForResponse(`**/api/takeoff/jobs/${jobId}/items`);
  await entry.getByRole("button", "Enregistrer la quantité", { exact: true }).click();
  expect((await attested).status).toBe(200);
  await expect(list.getByRole("option", /^Soudures inox/)).toHaveCount(0);
  const stored = await apiRequest<{ ok: boolean; data: TakeoffJobDetailResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}?items_limit=200`);
  expect([stored.status, stored.body.ok]).toEqual([200, true]);
  const entered = stored.body.data.items.data.find((item) => item.id === weld.id);
  expect(entered).toMatchObject({ quantity: 48, is_excluded: false, exclusion_reason: null, quantity_entry_category: "site_survey" });
  await recordEvidence(ui.army, "TKW11-hypothesis-not-preselected", { ids, jobId, arrived: completed.items, entered,
    boundary: "Real level B processor with the fixed rules on; controlled provider answer; the entry goes through the targeted review." });
});
