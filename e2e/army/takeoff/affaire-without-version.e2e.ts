import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect } from "e2e";

import { createEmptyTakeoffPreparation, createTakeoffPreparationSnapshot } from "@/lib/takeoff/preparation";
import { getPreparationPlanSourceVersion } from "@/lib/takeoff/preparation-sources";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";
import type { TakeoffJobDetailResponse, TakeoffJobListResponse } from "@/lib/takeoff/job-response-contracts";

import { apiRequest, armyTest, recordEvidence } from "../critical/fixtures";
import { querySql } from "../local/calculation-gate-support";
import { assertOwnedAdmissionRecovery, startOwnedTakeoffAdmission } from "./affaire-admission-support";
import { buildVectorPlanPdf } from "./vector-plan-fixture";
import { readVectorViewerDrawing, signUpWorkerOwner, startOwnedWorker } from "./worker-support";

armyTest("TKAW01 an affaire without a version reviews the controlled worker's measurements and keeps no estimate", {
  session: "army", trace: "off", tags: ["critical", "takeoff-worker", "local"], timeout: 180_000,
}, async (ui) => {
  await ui.app.open("/dashboard/affaires");
  const owner = await signUpWorkerOwner(ui, "AWV");
  const { tenantId, userId } = owner;
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const workerKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (process.env.E2E_ARMY_TAKEOFF_WORKER !== "1" || !["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname)
    || backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST || !publicKey || !workerKey) {
    throw new Error("An owned local worker stack is required.");
  }
  const session = { auth: { persistSession: false, autoRefreshToken: false } };
  const user = createClient(backend.origin, publicKey, session);
  const login = await user.auth.signInWithPassword({ email: owner.email, password: owner.password });
  expect(login.data.user?.id).toEqual(userId);
  const setup = createClient(backend.origin, workerKey, session);

  const projectId = randomUUID();
  const anotherProjectId = randomUUID();
  const planSetId = randomUUID();
  const planFileId = randomUUID();
  const versionId = randomUUID();
  const carryOverVersionId = randomUUID();
  const unrelatedVersionId = randomUUID();
  const legacyJobId = randomUUID();
  const name = "plan-fictif-R-1-Z2.pdf";
  const filePath = `${tenantId}/${planSetId}/${planFileId}/${name}`;
  const bytes = await buildVectorPlanPdf();
  const hash = createHash("sha256").update(bytes).digest("hex");

  expect((await setup.from("estimate_projects").insert([
    { id: projectId, tenant_id: tenantId, user_id: userId, name: `${ui.army.runPrefix} sans devis` },
    { id: anotherProjectId, tenant_id: tenantId, user_id: userId, name: `${ui.army.runPrefix} autre affaire` },
  ])).error).toBeNull();
  expect((await setup.from("estimate_versions").insert([
    { id: versionId, project_id: anotherProjectId, version_number: 1 },
    { id: carryOverVersionId, project_id: anotherProjectId, version_number: 2 },
    { id: unrelatedVersionId, project_id: anotherProjectId, version_number: 3 },
  ])).error).toBeNull();
  expect((await setup.from("takeoff_jobs").insert({ id: legacyJobId, estimate_version_id: versionId,
    tenant_id: tenantId, created_by: userId, level: "B", status: "completed", source_file_name: "Plan ancien" })).error).toBeNull();
  expect((await setup.from("takeoff_version_links").insert({
    tenant_id: tenantId, takeoff_job_id: legacyJobId, source_version_id: versionId,
    target_version_id: carryOverVersionId, linked_by: userId,
  })).error).toBeNull();
  expect((await setup.from("plan_sets").insert({ id: planSetId, tenant_id: tenantId, project_id: projectId, name: "Plans fictifs" })).error).toBeNull();
  expect((await setup.storage.from("plan-files").upload(filePath, bytes, { contentType: "application/pdf" })).error).toBeNull();
  const plan = await setup.from("plan_files").insert({ id: planFileId, tenant_id: tenantId, plan_set_id: planSetId, file_name: name,
    file_path: filePath, file_type: "application/pdf", file_size_bytes: bytes.length, page_count: 1 }).select("id,plan_set_id,file_path,file_name,file_size_bytes,file_hash,page_count,updated_at").single();
  expect(plan.error).toBeNull();
  (ui.army.ownedPlanSets ??= []).push({ projectId, planSetId, tenantId });
  (ui.army.ownedTakeoffAffaires ??= []).push(projectId);

  const preparation = createEmptyTakeoffPreparation({ estimateVersionId: null });
  preparation.objective = "measure_length";
  preparation.objective_confirmed = true;
  preparation.scope = { ...preparation.scope, lots: ["Plomberie"], networks: ["EF"], confirmed: true };
  preparation.sources = [{ document_id: planFileId, document_name: name, kind: "plan", revision: "A", source_version: getPreparationPlanSourceVersion(plan.data!),
    content_hash: hash, pages: [1], active: true, confirmed: true, plan_set_id: planSetId, file_path: filePath, page_count: 1,
    logical_document_id: null, source_updated_at: plan.data!.updated_at, mime_type: "application/pdf", page_triage: null }];
  preparation.conventions = { unit: "m", measurement_basis: "dimensioned", calibration: null, purchase: null, confirmed: true };
  preparation.destination = { kind: "analysis_only", estimate_version_id: null, reviewer: null, confirmed: true };
  preparation.processing = { level: "C", provider: "chatgpt" };
  const confirmedAt = new Date().toISOString();
  const snapshot = createTakeoffPreparationSnapshot({ preparation, revision: 1, confirmedAt, confirmedBy: userId });
  expect(snapshot.readiness.can_launch).toBe(true);
  expect((await setup.from("takeoff_preparations").insert({ tenant_id: tenantId, project_id: projectId, revision: 1, draft: preparation,
    confirmed_snapshot: snapshot, confirmed_at: confirmedAt, confirmed_by: userId, updated_by: userId })).error).toBeNull();

  const admit = (operationId: string) => startOwnedTakeoffAdmission(owner, ui.army.runPrefix, projectId, planSetId, operationId);
  const operationId = randomUUID();
  const launched = await admit(operationId).done;
  expect(launched).toMatchObject({ receipt: { project_id: projectId, estimate_version_id: null, status: "pending" } });
  const jobId = launched.receipt!.id;
  expect(await admit(operationId).done).toEqual(launched);
  const completed = await startOwnedWorker(ui, { projectId, versionId: null }, jobId, "success", {
    owner, vectors: true, rules: true, providerItems: [
      { designation: "ARMY worker pipe", quantity: 12.5, unit: "m", source_page: 1, confidence: 0.72, evidence: "Pipe row, page 1" },
      { designation: "ARMY worker valve", quantity: 3, unit: "u", source_page: 1, confidence: 0.99, evidence: "Valve row, page 1" },
    ],
  }).done;

  const full = takeoffReviewHref({ projectId, jobId });
  const targeted = takeoffReviewHref({ projectId, jobId, targeted: true });
  await ui.app.open(`/dashboard/affaires/${projectId}/plans`);
  await expect(ui.screen.getByRole("link", "Ouvrir les métrés", { exact: true })).toBeVisible();
  await ui.app.open(full);
  await expect(ui.screen.getByRole("heading", "Revue des exceptions & preuves", { exact: true })).toBeVisible();
  await expect(ui.screen.getByRole("region", "Lecture vectorielle du plan")).toBeVisible();
  await expect(ui.screen.getByText(/Comparaison au devis disponible à l’envoi/).first()).toBeVisible();
  await expect(ui.screen.getByText("Doublons et couverture entre métrés", { exact: true })).toBeVisible();
  await ui.screen.getByRole("tab", "Assisté : Revue guidée carte par carte", { exact: true }).click();
  const quantity = ui.screen.getByRole("article", "ARMY worker pipe", { exact: true });
  await expect(quantity).toContainText("12.5 m");
  await expect(quantity.getByText("p. 1", { exact: true })).toBeVisible();
  await ui.screen.getByRole("tab", "Validation : Exceptions et couverture", { exact: true }).click();
  await ui.screen.getByRole("button", "Tous les signaux", { exact: true }).click();
  const proof = ui.screen.getByRole("article", "ARMY worker pipe", { exact: true });
  await expect(proof.getByText("Pipe row, page 1", { exact: true })).toBeVisible();
  await expect(proof.getByText(`${name} · page 1`, { exact: true })).toBeVisible();
  const fullScreenshot = await ui.app.screenshot("takeoff-affaire-complete-review");

  await ui.app.open(targeted);
  await expect(ui.screen.getByRole("heading", "Revue ciblée", { exact: true })).toBeVisible();
  await expect(ui.screen.getByText(/Comparaison au devis disponible à l’envoi/).first()).toBeVisible();
  await expect(ui.screen.getByText("Doublons et couverture entre métrés", { exact: true })).toBeVisible();
  const targetLine = ui.screen.getByRole("option", /ARMY worker pipe/);
  await expect(targetLine).toContainText(/12[.,]5 m/);
  await targetLine.click();
  const decision = ui.screen.getByRole("region", "Décision sur la ligne");
  await expect(decision.getByRole("heading", "ARMY worker pipe", { exact: true })).toBeVisible();
  await expect(decision.getByText("Pipe row, page 1", { exact: true })).toBeVisible();
  await expect(decision.getByText("· p. 1", { exact: true })).toBeVisible();
  const targetedScreenshot = await ui.app.screenshot("takeoff-affaire-targeted-review");
  const reading = completed.items.find(item => item.designation === "ARMY worker valve");
  if (!reading) throw new Error("The controlled measure was not persisted.");
  const editable = await apiRequest<{ data: TakeoffJobDetailResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}`);
  const line = editable.body.data.items.data.find(item => item.id === reading.id);
  if (!line) throw new Error("The review cannot address the controlled measure.");
  const edited = await apiRequest<{ data: { succeeded: number } }>(ui.browser, "PATCH", `/api/takeoff/jobs/${jobId}/items`, {
    items: [{ item_id: line.id, updated_at: line.updated_at,
      fields: { is_excluded: true, exclusion_reason: "Contrôle sur le plan fictif." } }],
  });
  expect(edited.status).toEqual(200);
  expect(edited.body.data.succeeded).toEqual(1);
  const impact = await apiRequest<{ error: { code: string } }>(
    ui.browser, "POST", `/api/takeoff/jobs/${jobId}/preview-conversion`, { strategy: "append" },
  );
  expect([impact.status, impact.body.error.code]).toEqual([409, "CONFLICT"]);
  await ui.browser.reload();
  const detail = await apiRequest<{ data: TakeoffJobDetailResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}`);
  const list = await apiRequest<{ data: TakeoffJobListResponse }>(ui.browser, "GET", `/api/takeoff/jobs?project_id=${projectId}`);
  const filtered = await apiRequest<{ data: TakeoffJobListResponse }>(ui.browser, "GET", `/api/takeoff/jobs?project_id=${projectId}&estimate_version_id=${versionId}`);
  const sameAffaire = await apiRequest<{ data: TakeoffJobListResponse }>(ui.browser, "GET", `/api/takeoff/jobs?project_id=${anotherProjectId}&estimate_version_id=${versionId}`);
  expect([detail.status, list.status, filtered.status, sameAffaire.status]).toEqual([200, 200, 200, 200]);
  expect(detail.body.data.job).toMatchObject({ id: jobId, project_id: projectId, estimate_version_id: null, status: "completed" });
  expect(detail.body.data.items.data.find(item => item.designation === "ARMY worker pipe")).toMatchObject({
    quantity: 12.5, unit: "m", evidence: "Pipe row, page 1", source_page: 1,
    rules_stale: false, rules_evaluated_at: expect.any(String),
  });
  expect(detail.body.data.items.data.find(item => item.id === reading.id)).toMatchObject({
    quantity: 3, is_excluded: true, exclusion_reason: "Contrôle sur le plan fictif.",
  });
  expect(list.body.data.jobs.map(job => job.id)).toEqual([jobId]);
  expect(filtered.body.data.jobs).toEqual([]);
  expect(sameAffaire.body.data.jobs.map(job => job.id)).toEqual([legacyJobId]);
  expect(completed.providerCalls).toEqual(1);
  expect(completed.vectorPages.map(page => [page.planFileId, page.sourcePage])).toEqual([[planFileId, 1]]);
  expect(await querySql(`select count(*) from public.estimate_versions where project_id = '${projectId}';
    select count(*) from public.estimate_items where source_job_id = '${jobId}';`)).toEqual(["0", "0"]);

  await ui.app.open(`/dashboard/estimates/${versionId}/takeoff/${legacyJobId}/review`);
  await expect(ui.browser).toHaveURL(takeoffReviewHref({ projectId: anotherProjectId, jobId: legacyJobId, versionId }));
  await expect(ui.screen.getByRole("heading", "Revue des exceptions & preuves", { exact: true })).toBeVisible();
  await ui.app.open(takeoffReviewHref({ projectId: anotherProjectId, jobId: legacyJobId, versionId: carryOverVersionId }));
  await expect(ui.screen.getByRole("heading", "Revue des exceptions & preuves", { exact: true })).toBeVisible();
  const missing = ui.screen.getByText("Extractions introuvables ou accès non autorise.", { exact: true });
  await ui.app.open(takeoffReviewHref({ projectId: anotherProjectId, jobId: legacyJobId, versionId: unrelatedVersionId }));
  await expect(missing).toBeVisible();
  await ui.app.open(takeoffReviewHref({ projectId: anotherProjectId, jobId }));
  await expect(missing).toBeVisible();
  await ui.app.open(takeoffReviewHref({ projectId, jobId, versionId, targeted: true }));
  await expect(missing).toBeVisible();

  const reader = await signUpWorkerOwner(ui, "AWVR");
  const foreign = await apiRequest<{ ok: boolean }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}`);
  expect(foreign.status).toEqual(404);
  const foreignPlan = await apiRequest<{ ok: boolean }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}/vector-plans/${planFileId}`);
  expect(foreignPlan.status).toEqual(404);
  await querySql(`update public.tenant_memberships set is_default = false where user_id = '${reader.userId}';
    insert into public.tenant_memberships (tenant_id,user_id,role,is_default)
    values ('${tenantId}','${reader.userId}','director',true);`);
  await ui.app.open(full);
  await expect(ui.screen.getByRole("heading", "Revue des exceptions & preuves", { exact: true })).toBeVisible();
  await ui.screen.getByRole("tab", "Assisté : Revue guidée carte par carte", { exact: true }).click();
  await expect(ui.screen.getByRole("button", "Tout accepter", { exact: false })).toHaveCount(0);
  await expect(ui.screen.getByRole("region", "Lecture vectorielle du plan")).toBeVisible();
  const directorPlan = await readVectorViewerDrawing(ui);
  expect(directorPlan.inked).toBeGreaterThan(0);
  await ui.app.open(targeted);
  await expect(ui.screen.getByRole("heading", "Revue ciblée", { exact: true })).toBeVisible();
  const readPlan = () => ui.browser.evaluate(async ({ job, file }) => {
    const response = await fetch(`/api/takeoff/jobs/${job}/vector-plans/${file}`);
    const sha256 = response.ok
      ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await response.arrayBuffer())),
        byte => byte.toString(16).padStart(2, "0")).join("") : null;
    return { status: response.status, sha256, cache: response.headers.get("cache-control") };
  }, { job: jobId, file: planFileId });
  expect(await readPlan()).toEqual({ status: 200, sha256: hash, cache: "private, no-store" });
  const rejected = await apiRequest<{ ok: boolean }>(ui.browser, "PATCH", `/api/takeoff/jobs/${jobId}/items`, { items: [] });
  expect(rejected.status).toEqual(403);
  await assertOwnedAdmissionRecovery(owner, admit);
  expect((await user.storage.from("plan-files").update(filePath, await buildVectorPlanPdf({ printedScale: false }),
    { contentType: "application/pdf" })).error).toBeNull();
  expect(await readPlan()).toMatchObject({ status: 404, sha256: null });
  for (const review of [full, targeted]) {
    await ui.app.open(review);
    await expect(ui.screen.getByText(/Le plan d’origine n’est plus disponible/)).toBeVisible();
  }
  await recordEvidence(ui.army, "TKAW01-affaire-without-version", { projectId, jobId, full, targeted, planFileId, completed,
    screenshots: [fullScreenshot, targetedScreenshot],
    versionCount: 0, estimateLineCount: 0, foreign: foreign.status, readOnlyWrite: rejected.status });
});
