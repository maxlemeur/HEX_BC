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
import { ownedWorkerJobOwner, ownedWorkerSelection, readVectorViewerDrawing, signUpWorkerOwner, startOwnedWorker } from "./worker-support";

armyTest("TKAW01 an affaire without a version reviews the controlled worker's measurements and keeps no estimate", {
  session: "army", trace: "off", tags: ["critical", "takeoff-worker", "local"], timeout: 180_000,
}, async ({ app, screen, browser, army }) => {
  const ui = { app, screen, browser, army };
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
  // A confirmation pins the member's ChatGPT selection; the admission script connects this profile on the worker host.
  const snapshot = { ...createTakeoffPreparationSnapshot({ preparation, revision: 1, confirmedAt, confirmedBy: userId }),
    execution_selection: await ownedWorkerSelection() };
  expect(snapshot.readiness.can_launch).toBe(true);
  expect((await setup.from("takeoff_preparations").insert({ tenant_id: tenantId, project_id: projectId, revision: 1, draft: preparation,
    confirmed_snapshot: snapshot, confirmed_at: confirmedAt, confirmed_by: userId, updated_by: userId })).error).toBeNull();

  const admit = (operationId: string) => startOwnedTakeoffAdmission(owner, ui.army.runPrefix, projectId, planSetId, operationId);
  const operationId = randomUUID();
  const launched = await admit(operationId).done;
  expect(launched).toMatchObject({ receipt: { project_id: projectId, estimate_version_id: null, status: "pending" } });
  const jobId = launched.receipt!.id;
  expect(await admit(operationId).done).toEqual(launched);
  const direct = await user.from("takeoff_jobs").insert({ id: randomUUID(), tenant_id: tenantId, project_id: projectId,
    plan_set_id: planSetId, created_by: userId, level: "C", preparation_snapshot: snapshot, ...await ownedWorkerJobOwner() });
  expect(direct.error).toMatchObject({ code: "42501", message: "TAKEOFF_JOB_ADMISSION_RPC_REQUIRED" });
  const deleteReferenced = await apiRequest<{ error: { code: string } }>(ui.browser, "DELETE", `/api/takeoff/plan-sets/${planSetId}`);
  expect([deleteReferenced.status, deleteReferenced.body.error.code]).toEqual([400, "BAD_REQUEST"]);
  const completed = await startOwnedWorker(ui, { projectId, versionId: null }, jobId, "success", {
    owner, vectors: true, rules: true, affaireWithoutVersion: true, providerItems: [
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

armyTest("TKAW02 the takeoff of an affaire without a version creates its first draft at the confirmation only, once", {
  session: "army", trace: "off", tags: ["critical", "takeoff-worker", "local"], timeout: 240_000,
}, async ({ app, screen, browser, army }) => {
  const ui = { app, screen, browser, army };
  await ui.app.open("/dashboard/affaires");
  const owner = await signUpWorkerOwner(ui, "AWS");
  const { tenantId, userId } = owner;
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const workerKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (process.env.E2E_ARMY_TAKEOFF_WORKER !== "1" || !["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname)
    || backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST || !workerKey) {
    throw new Error("An owned local worker stack is required.");
  }
  const setup = createClient(backend.origin, workerKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const projectId = randomUUID();
  const planSetId = randomUUID();
  const planFileId = randomUUID();
  const name = "plan-fictif-envoi-R-1.pdf";
  const filePath = `${tenantId}/${planSetId}/${planFileId}/${name}`;
  const bytes = await buildVectorPlanPdf();
  const hash = createHash("sha256").update(bytes).digest("hex");
  expect((await setup.from("estimate_projects").insert({ id: projectId, tenant_id: tenantId, user_id: userId,
    name: `${ui.army.runPrefix} envoi sans devis` })).error).toBeNull();
  expect((await setup.from("plan_sets").insert({ id: planSetId, tenant_id: tenantId, project_id: projectId, name: "Plans fictifs" })).error).toBeNull();
  expect((await setup.storage.from("plan-files").upload(filePath, bytes, { contentType: "application/pdf" })).error).toBeNull();
  const plan = await setup.from("plan_files").insert({ id: planFileId, tenant_id: tenantId, plan_set_id: planSetId, file_name: name,
    file_path: filePath, file_type: "application/pdf", file_size_bytes: bytes.length, page_count: 1 })
    .select("id,plan_set_id,file_path,file_name,file_size_bytes,file_hash,page_count,updated_at").single();
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
  // A confirmation pins the member's ChatGPT selection; the admission script connects this profile on the worker host.
  const snapshot = { ...createTakeoffPreparationSnapshot({ preparation, revision: 1, confirmedAt, confirmedBy: userId }),
    execution_selection: await ownedWorkerSelection() };
  expect((await setup.from("takeoff_preparations").insert({ tenant_id: tenantId, project_id: projectId, revision: 1, draft: preparation,
    confirmed_snapshot: snapshot, confirmed_at: confirmedAt, confirmed_by: userId, updated_by: userId })).error).toBeNull();
  const launched = await startOwnedTakeoffAdmission(owner, ui.army.runPrefix, projectId, planSetId, randomUUID()).done;
  const jobId = launched.receipt!.id;
  const completed = await startOwnedWorker(ui, { projectId, versionId: null }, jobId, "success", {
    owner, vectors: true, rules: true, affaireWithoutVersion: true, providerItems: [
      { designation: "ARMY envoi tube", quantity: 12.5, unit: "m", source_page: 1, confidence: 0.99, evidence: "Tube row, page 1" },
      { designation: "ARMY envoi vanne", quantity: 3, unit: "u", source_page: 1, confidence: 0.99, evidence: "Valve row, page 1" },
    ],
  }).done;
  const state = () => querySql(`select count(*) from public.estimate_versions where project_id = '${projectId}';
    select count(*) from public.estimate_items i join public.estimate_versions v on v.id = i.version_id
      where v.project_id = '${projectId}' and i.item_type = 'line';
    select count(*) from public.takeoff_send_receipts where job_id = '${jobId}';`);
  const full = takeoffReviewHref({ projectId, jobId });

  // The preview writes nothing: opened, closed, the page reloaded and opened again, the affaire still has no estimate.
  await ui.app.open(full);
  const openSend = async () => {
    await ui.screen.getByRole("button", "Envoyer au tableau de chiffrage", { exact: true }).click();
    const dialog = ui.screen.getByRole("dialog", "Envoyer au tableau de chiffrage", { exact: true });
    await expect(dialog.getByText("Créer le premier brouillon et y envoyer 2 lignes", { exact: true })).toBeVisible({ timeout: 30_000 });
    return dialog;
  };
  let dialog = await openSend();
  await expect(dialog.getByText("Section proposée : « Métré — Plans fictifs », créée à la confirmation.", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/vérifiés pour ce nouveau devis, qui ne porte encore aucun autre métré/)).toBeVisible();
  await expect(dialog.getByRole("list", "Lignes envoyées", { exact: true })).toContainText("ARMY envoi vanne");
  // What the estimator confirms is what the estimate will hold: the tube measured 12.5 m enters as 13 m (a length is
  // rounded up once to the metre, by the send itself run and rolled back); the measures sent still read 12.5.
  const written = dialog.getByRole("list", "Lignes du devis après l’envoi", { exact: true });
  await expect(written.getByRole("listitem", "ARMY envoi tube", { exact: true })).toContainText(/13 ml?$/);
  await expect(written.getByRole("listitem", "ARMY envoi vanne", { exact: true })).toContainText(/3 u$/);
  await expect(dialog.getByRole("list", "Lignes envoyées", { exact: true })).toContainText("12,5 m");
  const previewScreenshot = await ui.app.screenshot("takeoff-affaire-send-preview");
  await dialog.getByRole("button", "Annuler", { exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await state()).toEqual(["0", "0", "0"]);
  // The targeted review offers the same send, from the same preview.
  await ui.app.open(takeoffReviewHref({ projectId, jobId, targeted: true }));
  await expect(ui.screen.getByRole("heading", "Revue ciblée", { exact: true })).toBeVisible();
  dialog = await openSend();
  await dialog.getByRole("button", "Annuler", { exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await state()).toEqual(["0", "0", "0"]);
  await ui.app.open(full);
  await ui.browser.reload();
  dialog = await openSend();
  expect(await state()).toEqual(["0", "0", "0"]);

  // A refused confirmation writes nothing at all, not even the default categories and labour roles a first draft gets:
  // they come after the send commits. Their count is read before the first refusal.
  const defaults = () => querySql(`select count(*) from public.estimate_categories where tenant_id = '${tenantId}';
    select count(*) from public.labor_roles where tenant_id = '${tenantId}';`);
  const defaultsBefore = await defaults();

  // A line's evidence revised between the preview and the confirmation, its quantity unchanged: refused, previewed again.
  const valve = completed.items.find((item) => item.designation === "ARMY envoi vanne");
  if (!valve) throw new Error("The controlled measure was not persisted.");
  const before = await apiRequest<{ data: TakeoffJobDetailResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}`);
  const line = before.body.data.items.data.find((item) => item.id === valve.id)!;
  const revised = await apiRequest<{ data: { succeeded: number } }>(ui.browser, "PATCH", `/api/takeoff/jobs/${jobId}/items`, {
    items: [{ item_id: line.id, updated_at: line.updated_at, fields: { evidence: "Valve row, page 1 (repère revu)" } }] });
  expect(revised.status).toEqual(200);
  await dialog.getByRole("button", "Créer le brouillon et envoyer", { exact: true }).click();
  await expect(dialog.getByText(/depuis l’aperçu/).first()).toBeVisible({ timeout: 30_000 });
  expect(await state()).toEqual(["0", "0", "0"]);
  expect(await defaults()).toEqual(defaultsBefore);

  // A confirmation refused by the send itself, past every check of the server (its fingerprint matches), writes nothing
  // at all either: not the version nor its lines, nor the defaults. The refusal is forced at the send's last write, its
  // receipt, once.
  await expect(dialog.getByText("Créer le premier brouillon et y envoyer 2 lignes", { exact: true })).toBeVisible({ timeout: 30_000 });
  const refusal = `army_send_refusal_${jobId.replaceAll("-", "")}`;
  await querySql(`create sequence public.${refusal}_seq;
    create function public.${refusal}() returns trigger language plpgsql set search_path = '' as $$
    begin
      if new.job_id = '${jobId}' and nextval('public.${refusal}_seq') = 1 then
        raise exception 'TAKEOFF_SEND_PREVIEW_STALE' using errcode = '40001', detail = '{"reason": "estimate_changed"}';
      end if;
      return new;
    end $$;
    create trigger ${refusal} before insert on public.takeoff_send_receipts for each row execute function public.${refusal}();`);
  try {
    await dialog.getByRole("button", "Créer le brouillon et envoyer", { exact: true }).click();
    await expect(dialog.getByText("Le devis ou les métrés qu’il porte ont changé depuis l’aperçu : vérifiez le nouvel aperçu puis confirmez.",
      { exact: true })).toBeVisible({ timeout: 30_000 });
    expect(await querySql(`select is_called from public.${refusal}_seq;`)).toEqual(["t"]);
  } finally {
    await querySql(`drop trigger if exists ${refusal} on public.takeoff_send_receipts; drop function if exists public.${refusal}();
      drop sequence if exists public.${refusal}_seq;`);
  }
  expect(await state()).toEqual(["0", "0", "0"]);
  expect(await defaults()).toEqual(defaultsBefore);

  // Confirmed on the new preview: V1 of the tenant's engine, its section, the two lines without price, the job sent.
  await expect(dialog.getByText("Créer le premier brouillon et y envoyer 2 lignes", { exact: true })).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole("button", "Créer le brouillon et envoyer", { exact: true }).click();
  await expect(ui.browser).toHaveURL(/\/dashboard\/estimates\/[0-9a-f-]{36}\/edit/, { timeout: 60_000 });
  expect(await state()).toEqual(["1", "2", "1"]);
  const [created] = await querySql(`select jsonb_build_object('version', v.id, 'number', v.version_number, 'status', v.status,
      'engine', v.calc_engine_version, 'policy', coalesce((select p.new_estimate_calc_engine from public.tenant_calc_policies p
        where p.tenant_id = v.tenant_id), 3),
      -- Each line's takeoff line, as the receipt links them (an engine 2 line carries no takeoff_item_id of its own).
      'lines', (select jsonb_agg(jsonb_build_array(i.title, i.quantity::float8, i.unit_price_ht_cents, i.source_job_id,
        (select link ->> 'takeoff_item_id' from public.takeoff_send_receipts r cross join jsonb_array_elements(r.result -> 'item_links') link
          where r.job_id = i.source_job_id and link ->> 'estimate_item_id' = i.id::text)) order by i.title)
        from public.estimate_items i where i.version_id = v.id and i.item_type = 'line'),
      'section', (select s.title from public.estimate_items s where s.version_id = v.id and s.item_type = 'section'),
      'job', (select jsonb_build_array(j.estimate_version_id, j.status) from public.takeoff_jobs j where j.id = '${jobId}'),
      'receipt', (select jsonb_build_object('request_id', r.request_id, 'fingerprint', r.preview_fingerprint, 'version', r.target_version_id,
        'parts', jsonb_array_length(r.write_plan -> 'parts')) from public.takeoff_send_receipts r where r.job_id = '${jobId}'))
    from public.estimate_versions v where v.project_id = '${projectId}';`);
  const sent = JSON.parse(created) as { version: string; number: number; status: string; engine: number; policy: number;
    lines: Array<[string, number, number, string, string]>; section: string; job: [string, string];
    receipt: { request_id: string; fingerprint: string; version: string; parts: number } };
  const pipe = completed.items.find((item) => item.designation === "ARMY envoi tube")!;
  expect(sent).toMatchObject({ number: 1, status: "draft", section: "Métré — Plans fictifs", job: [sent.version, "applied"],
    receipt: { version: sent.version, parts: 2 } });
  expect(sent.engine).toEqual(sent.policy);
  expect(sent.lines).toEqual([["ARMY envoi tube", 13, 0, jobId, pipe.id], ["ARMY envoi vanne", 3, 0, jobId, valve.id]]);

  // A timeout after the commit, then « Réessayer »: the same request returns the receipt; nothing is created again.
  const replay = await apiRequest<{ data: { replayed: boolean; version_id: string } }>(ui.browser, "POST", `/api/takeoff/jobs/${jobId}/send-to-estimate`, {
    request_id: sent.receipt.request_id, fingerprint: sent.receipt.fingerprint, destination: { kind: "first_draft" }, section: { kind: "new" } });
  expect([replay.status, replay.body.data.replayed, replay.body.data.version_id]).toEqual([200, true, sent.version]);
  const again = await apiRequest<{ error: { code: string } }>(ui.browser, "POST", `/api/takeoff/jobs/${jobId}/send-to-estimate`, {
    request_id: randomUUID(), fingerprint: sent.receipt.fingerprint, destination: { kind: "first_draft" }, section: { kind: "new" } });
  expect(again.status).toEqual(409);
  expect(await state()).toEqual(["1", "2", "1"]);
  const detail = await apiRequest<{ data: TakeoffJobDetailResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}`);
  expect(detail.body.data.job).toMatchObject({ id: jobId, estimate_version_id: sent.version, status: "applied" });

  // A director who read the takeoff before the send keeps it after: its lines, and the plan it attested (drawn from
  // the verified bytes, a director reading no plan object directly).
  const director = await signUpWorkerOwner(ui, "AWSR");
  await querySql(`update public.tenant_memberships set is_default = false where user_id = '${director.userId}';
    insert into public.tenant_memberships (tenant_id,user_id,role,is_default) values ('${tenantId}','${director.userId}','director',true);`);
  const directorDetail = await apiRequest<{ data: TakeoffJobDetailResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}`);
  expect([directorDetail.status, directorDetail.body.data.job.estimate_version_id, directorDetail.body.data.items.data.length])
    .toEqual([200, sent.version, detail.body.data.items.data.length]);
  const directorPlan = await ui.browser.evaluate(async ({ job, file }) => {
    const response = await fetch(`/api/takeoff/jobs/${job}/vector-plans/${file}`);
    return { status: response.status, sha256: response.ok ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
      await response.arrayBuffer())), (byte) => byte.toString(16).padStart(2, "0")).join("") : null };
  }, { job: jobId, file: planFileId });
  expect(directorPlan).toEqual({ status: 200, sha256: hash });
  await ui.app.open(full);
  await expect(ui.screen.getByRole("heading", "Revue des exceptions & preuves", { exact: true })).toBeVisible();
  await expect(ui.screen.getByRole("region", "Lecture vectorielle du plan")).toBeVisible();
  expect((await readVectorViewerDrawing(ui)).inked).toBeGreaterThan(0);
  await recordEvidence(ui.army, "TKAW02-affaire-first-draft-send", { projectId, jobId, sent, replay: replay.body.data,
    again: again.status, director: { detail: directorDetail.status, plan: directorPlan.status }, screenshots: [previewScreenshot] });
});
