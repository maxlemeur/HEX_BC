import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect } from "e2e";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { createEmptyTakeoffPreparation, createTakeoffPreparationSnapshot, type TakeoffPreparationSource } from "@/lib/takeoff/preparation";
import { getPreparationPlanSourceVersion } from "@/lib/takeoff/preparation-sources";
import type { TakeoffJobPlanLocations, TakeoffPlanFileLocation } from "@/lib/takeoff/plan-location-contracts";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";
import type { TakeoffVectorReadingResponse } from "@/lib/takeoff/vectors/read-contracts";

import { apiRequest, armyTest, recordEvidence } from "../critical/fixtures";
import { querySql } from "../local/calculation-gate-support";
import { startOwnedTakeoffAdmission } from "./affaire-admission-support";
import { buildVectorPlanPdf } from "./vector-plan-fixture";
import { ownedWorkerHostId, signUpWorkerOwner, startOwnedWorker } from "./worker-support";

// Lot 3, « Localisation canonique »: the building and the level of a plan revision are read from what the plan shows,
// corrected once on the plan, and found again in the plan centre, the review and a relaunch of the same revision. Three
// fictional plans: A's title block says « BÂTIMENT A / NIVEAU L00 » while its name says BAT-B and R+1; B has two sheets,
// R+1 and R+2; C prints no text. No AI call: the controlled provider of the owned worker.

const A_NAME = "P-101_BAT-B_R+1.pdf";
const B_NAME = "P-102_colonnes.pdf";
const C_NAME = "P-103_sans-texte.pdf";
const D_NAME = "P-101_BAT-B_R+1_indice-B.pdf";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function buildSheetsPdf(sheets: string[][]) {
  const doc = await PDFDocument.create();
  doc.setTitle("ARMY plan fictif");
  doc.setCreationDate(new Date("2026-01-01T00:00:00Z"));
  doc.setModificationDate(new Date("2026-01-01T00:00:00Z"));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of sheets) {
    const page = doc.addPage([1190.55, 841.89]);
    page.drawLine({ start: { x: 200, y: 500 }, end: { x: 600, y: 500 }, thickness: 1 });
    lines.forEach((line, index) => page.drawText(line, { x: 980, y: 160 - index * 14, size: 9, font }));
  }
  return doc.save({ useObjectStreams: false });
}

armyTest("TKPL01 a plan's building and level show their source, are corrected once and found again on the plan, in the review and after a relaunch", {
  session: "army", trace: "off", tags: ["critical", "takeoff-worker", "local"], timeout: 300_000,
}, async (ui) => {
  await ui.app.open("/dashboard/affaires");
  const owner = await signUpWorkerOwner(ui, "LOC");
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
  const ids = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
  const bytes = {
    a: await buildVectorPlanPdf({ titleBlock: ["PLAN DE PLOMBERIE FICTIF", "BÂTIMENT A", "NIVEAU L00"] }),
    b: await buildSheetsPdf([["BÂTIMENT A", "NIVEAU R+1"], ["BÂTIMENT A", "NIVEAU R+2"]]),
    c: await buildSheetsPdf([[]]),
  };
  const plans = [
    { key: "a" as const, name: A_NAME, pages: 1 }, { key: "b" as const, name: B_NAME, pages: 2 }, { key: "c" as const, name: C_NAME, pages: 1 },
  ].map((plan) => ({ ...plan, id: ids[plan.key], path: `${tenantId}/${planSetId}/${ids[plan.key]}/${plan.key}.pdf` }));

  expect((await setup.from("estimate_projects").insert({ id: projectId, tenant_id: tenantId, user_id: userId,
    name: `${ui.army.runPrefix} localisation` })).error).toBeNull();
  expect((await setup.from("plan_sets").insert({ id: planSetId, tenant_id: tenantId, project_id: projectId, name: "Plans localisés" })).error).toBeNull();
  (ui.army.ownedPlanSets ??= []).push({ projectId, planSetId, tenantId });
  (ui.army.ownedTakeoffAffaires ??= []).push(projectId);
  const stored = new Map<string, { updated_at: string; file_hash: string | null; file_size_bytes: number; page_count: number | null }>();
  for (const plan of plans) {
    expect((await setup.storage.from("plan-files").upload(plan.path, bytes[plan.key], { contentType: "application/pdf" })).error).toBeNull();
    const row = await setup.from("plan_files").insert({ id: plan.id, tenant_id: tenantId, plan_set_id: planSetId, file_name: `${plan.key}.pdf`,
      file_path: plan.path, file_type: "application/pdf", file_size_bytes: bytes[plan.key].length, page_count: plan.pages,
      metadata: { original_file_name: plan.name } }).select("id,plan_set_id,file_path,file_name,file_size_bytes,file_hash,page_count,updated_at").single();
    expect(row.error).toBeNull();
    stored.set(plan.id, row.data!);
  }

  // A preparation confirmed on A and B: the analysis attests these two revisions.
  const preparation = createEmptyTakeoffPreparation({ estimateVersionId: null });
  preparation.objective = "measure_length";
  preparation.objective_confirmed = true;
  preparation.scope = { ...preparation.scope, lots: ["Plomberie"], networks: ["EF"], buildings: ["A", "B"], confirmed: true };
  // Every plan of the set is a known source (M1 attests the whole set); C is set aside.
  preparation.sources = plans.map((plan): TakeoffPreparationSource => ({
    document_id: plan.id, document_name: plan.name, kind: "plan", revision: "A",
    source_version: getPreparationPlanSourceVersion({ ...stored.get(plan.id)!, id: plan.id, plan_set_id: planSetId, file_path: plan.path, file_name: `${plan.key}.pdf` }),
    content_hash: sha256(bytes[plan.key]), pages: [], active: plan.key !== "c", confirmed: true, plan_set_id: planSetId, file_path: plan.path,
    page_count: plan.pages, logical_document_id: null, source_updated_at: stored.get(plan.id)!.updated_at, mime_type: "application/pdf", page_triage: null }));
  preparation.conventions = { unit: "m", measurement_basis: "dimensioned", calibration: null, purchase: null, confirmed: true };
  preparation.destination = { kind: "analysis_only", estimate_version_id: null, reviewer: null, confirmed: true };
  preparation.processing = { level: "C", provider: "chatgpt" };
  const confirmedAt = new Date().toISOString();
  const snapshot = { ...createTakeoffPreparationSnapshot({ preparation, revision: 1, confirmedAt, confirmedBy: userId }),
    execution_selection: { profileId: "army", model: "army", reasoningEffort: null, hostId: await ownedWorkerHostId() } };
  expect(snapshot.readiness.can_launch).toBe(true);
  expect((await setup.from("takeoff_preparations").insert({ tenant_id: tenantId, project_id: projectId, revision: 1, draft: preparation,
    confirmed_snapshot: snapshot, confirmed_at: confirmedAt, confirmed_by: userId, updated_by: userId })).error).toBeNull();

  // 1. What each plan shows, read from its bytes, with its source: the title block, the file name, nothing, several values.
  await ui.app.open(`/dashboard/affaires/${projectId}/plans`);
  await ui.screen.getByRole("heading", "Plans localisés", { exact: true }).click();
  const dialog = ui.screen.getByRole("dialog", "Localisation du plan");
  const field = (name: "building" | "level") => ui.screen.getByTestId(`plan-location-summary-${name}`);
  const openLocation = async (name: string) => {
    await ui.screen.getByRole("button", `Bâtiment et niveau de ${name}`, { exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(field("building")).toBeVisible({ timeout: 45_000 });
  };
  const closeLocation = async () => {
    await dialog.getByRole("button", "Fermer", { exact: true }).click();
    await expect(dialog).toBeHidden();
  };
  await openLocation(A_NAME);
  await expect(field("building")).toHaveAttribute("data-state", "proposed");
  await expect(field("building")).toContainText("A");
  await expect(field("building")).toContainText("Lu dans le cartouche, page 1 · à vérifier");
  await expect(field("building")).toContainText("Autre lecture : B (nom du fichier)");
  await expect(field("level")).toHaveAttribute("data-state", "proposed");
  await expect(field("level")).toContainText("L00");
  await expect(field("level")).toContainText("Autre lecture : R+1 (nom du fichier)");
  const firstReading = await apiRequest<{ data: TakeoffPlanFileLocation }>(ui.browser, "GET", `/api/takeoff/plan-sets/${planSetId}/files/${ids.a}/location`);
  expect(firstReading.status).toBe(200);
  expect(firstReading.body.data).toMatchObject({ revision: { source_kind: "plan_file", source_id: ids.a, content_hash: sha256(bytes.a) },
    annotation: null, carry_over: null, can_edit: true, location: { building: { value: "A", origin: "title_block", pages: [1] },
      level: { value: "L00", origin: "title_block", pages: [1] } } });
  await closeLocation();
  await openLocation(B_NAME);
  await expect(field("building")).toContainText("Lu dans le cartouche, pages 1, 2 · à vérifier");
  await expect(field("level")).toHaveAttribute("data-state", "multiple");
  await expect(field("level")).toContainText("Plusieurs niveaux");
  await expect(field("level")).toContainText("R+1 (cartouche, page 1), R+2 (cartouche, page 2)");
  await closeLocation();
  await openLocation(C_NAME);
  for (const name of ["building", "level"] as const) {
    await expect(field(name)).toHaveAttribute("data-state", "unknown");
    await expect(field(name)).toContainText("À préciser");
  }
  await expect(dialog.getByText("Sans texte lisible dans le cartouche : page 1.", { exact: false })).toBeVisible();
  await closeLocation();

  // 2. The operator keeps the building and corrects the level once, on the plan.
  await openLocation(A_NAME);
  await dialog.getByLabel("Niveau", { exact: true }).fill("L01");
  await dialog.getByRole("button", "Enregistrer", { exact: true }).click();
  await expect(dialog.getByTestId("plan-location-notice")).toContainText("Localisation enregistrée pour cette version du plan.");
  await expect(field("building")).toHaveAttribute("data-state", "confirmed");
  await expect(field("level")).toHaveAttribute("data-state", "corrected");
  await expect(field("level")).toContainText("L01");
  await expect(field("level")).toContainText(/Corrigé par .+ le /);
  const rows = async () => (await setup.from("takeoff_plan_locations").select("id,source_kind,source_id,content_hash,revision,building,level,carried_from_id,created_by,updated_by")
    .eq("project_id", projectId).order("created_at")).data ?? [];
  expect(await rows()).toEqual([{ id: expect.any(String), source_kind: "plan_file", source_id: ids.a, content_hash: sha256(bytes.a), revision: 1,
    building: "A", level: "L01", carried_from_id: null, created_by: userId, updated_by: userId }]);
  // The label lives beside the plan: the plan file, its version and the preparation are untouched.
  const planAfter = await setup.from("plan_files").select("updated_at").eq("id", ids.a).single();
  expect(planAfter.data?.updated_at).toBe(stored.get(ids.a)!.updated_at);

  // 3. Found again after a reload of the plan centre.
  await ui.browser.reload();
  await ui.screen.getByRole("heading", "Plans localisés", { exact: true }).click();
  await openLocation(A_NAME);
  await expect(field("level")).toContainText("L01");
  await expect(dialog.getByLabel("Niveau", { exact: true })).toHaveValue("L01");

  // 4. Two tabs on the same revision: the one that saved second gets a conflict and sees the winner.
  const otherTab = await apiRequest<{ data: TakeoffPlanFileLocation }>(ui.browser, "PUT", `/api/takeoff/plan-sets/${planSetId}/files/${ids.a}/location`,
    { content_hash: sha256(bytes.a), expected_revision: 1, building: "A", level: "L02" });
  expect([otherTab.status, otherTab.body.data.annotation?.revision, otherTab.body.data.annotation?.level]).toEqual([200, 2, "L02"]);
  await dialog.getByLabel("Niveau", { exact: true }).fill("L03");
  await dialog.getByRole("button", "Enregistrer", { exact: true }).click();
  await expect(dialog.getByTestId("plan-location-notice")).toContainText("a été enregistrée entre-temps");
  await expect(dialog.getByTestId("plan-location-notice")).toContainText("niveau L03) n’a pas été enregistrée");
  await expect(field("level")).toContainText("L02");
  await expect(dialog.getByLabel("Niveau", { exact: true })).toHaveValue("L02");
  const stale = await apiRequest<{ error: { code: string; details: { reason: string } } }>(ui.browser, "PUT",
    `/api/takeoff/plan-sets/${planSetId}/files/${ids.a}/location`, { content_hash: sha256(bytes.a), expected_revision: 1, building: "A", level: "L04" });
  expect([stale.status, stale.body.error.details.reason]).toEqual([409, "TAKEOFF_PLAN_LOCATION_CONFLICT"]);
  expect((await rows()).map((row) => [row.revision, row.level])).toEqual([[2, "L02"]]);
  await closeLocation();

  // 5. The analysis of A and B: its review shows the correction of the revision it read; the worker's raw reading stays.
  const admit = (operationId: string) => startOwnedTakeoffAdmission(owner, ui.army.runPrefix, projectId, planSetId, operationId);
  const launched = await admit(randomUUID()).done;
  const jobId = launched.receipt!.id;
  const completed = await startOwnedWorker(ui, { projectId, versionId: null }, jobId, "success", { owner, vectors: true, providerItems: [
    { designation: "ARMY tube localisé", quantity: 4, unit: "m", source_page: 1, confidence: 0.9, evidence: "Tube, page 1" },
  ] }).done;
  expect(completed.job).toMatchObject({ status: "completed" });
  const rawVector = await apiRequest<{ data: TakeoffVectorReadingResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}/vector-pages`);
  const rawPage = rawVector.body.data.pages.find((page) => page.plan_file_id === ids.a);
  expect(rawPage).toBeDefined();
  await ui.app.open(takeoffReviewHref({ projectId, jobId }));
  const panel = ui.screen.getByTestId("takeoff-plan-locations");
  await expect(panel).toBeVisible({ timeout: 60_000 });
  const showLocations = () => ui.screen.getByRole("button", "Afficher le bâtiment et le niveau des plans", { exact: true }).click();
  await showLocations();
  const reviewRow = (name: string) => ui.browser.locator("[data-testid='takeoff-plan-location']").filter({ hasText: name });
  await expect(reviewRow(A_NAME)).toContainText("L02");
  await expect(reviewRow(A_NAME)).toContainText(/Corrigé par .+ le /);
  await expect(reviewRow(B_NAME)).toContainText("Plusieurs niveaux");
  await expect(reviewRow(C_NAME)).toHaveCount(0);
  const reviewScreenshot = await ui.app.screenshot("takeoff-plan-location-review");

  // 6. A relaunch on the same revision finds the same correction, with nothing asked.
  const relaunched = await admit(randomUUID()).done;
  const relaunchId = relaunched.receipt!.id;
  expect(relaunchId).not.toBe(jobId);
  const again = await apiRequest<{ data: TakeoffJobPlanLocations }>(ui.browser, "GET", `/api/takeoff/jobs/${relaunchId}/plan-locations`);
  expect(again.body.data.plans.find((plan) => plan.plan_file_id === ids.a)).toMatchObject({ status: "current",
    revision: { source_id: ids.a, content_hash: sha256(bytes.a) }, annotation: { revision: 2, level: "L02" }, carry_over: null,
    location: { level: { value: "L02", state: "corrected", origin: "operator" } } });

  // 7. A new revision of A arrives as another file, and the preparation retains it over A: A's correction is only a
  // proposal to check on it, never carried silently; one validation keeps it. A's own revision is untouched.
  const dId = randomUUID();
  const dPath = `${tenantId}/${planSetId}/${dId}/d.pdf`;
  const nextA = await buildVectorPlanPdf({ titleBlock: ["PLAN DE PLOMBERIE FICTIF", "BÂTIMENT A", "NIVEAU L00", "INDICE B"] });
  expect((await setup.storage.from("plan-files").upload(dPath, nextA, { contentType: "application/pdf" })).error).toBeNull();
  expect((await setup.from("plan_files").insert({ id: dId, tenant_id: tenantId, plan_set_id: planSetId, file_name: "d.pdf", file_path: dPath,
    file_type: "application/pdf", file_size_bytes: nextA.length, page_count: 1, metadata: { original_file_name: D_NAME } })).error).toBeNull();
  const decided = { ...preparation, plan_revision_decisions: [{ left: { document_id: ids.a, content_hash: sha256(bytes.a) },
    right: { document_id: dId, content_hash: sha256(nextA) }, choice: "right" as const }] };
  expect((await setup.from("takeoff_preparations").update({ revision: 2, draft: decided, confirmed_snapshot: null, confirmed_at: null,
    confirmed_by: null, updated_by: userId }).eq("project_id", projectId).eq("revision", 1)).error).toBeNull();
  await ui.app.open(`/dashboard/affaires/${projectId}/plans`);
  await ui.screen.getByRole("heading", "Plans localisés", { exact: true }).click();
  await openLocation(D_NAME);
  await expect(field("level")).toHaveAttribute("data-state", "proposed");
  await expect(field("level")).toContainText("L02");
  await expect(field("level")).toContainText("Repris de la correction d’une version précédente");
  await expect(field("level")).toContainText("Autre lecture : L00 (cartouche, page 1)");
  await expect(dialog.getByText(/Le contenu du plan a changé/)).toBeVisible();
  await expect(dialog.getByText(new RegExp(A_NAME.replaceAll(/[.+]/g, "\\$&")))).toBeVisible();
  const proposal = await apiRequest<{ data: TakeoffPlanFileLocation }>(ui.browser, "GET", `/api/takeoff/plan-sets/${planSetId}/files/${dId}/location`);
  expect(proposal.body.data).toMatchObject({ revision: { source_id: dId, content_hash: sha256(nextA) }, annotation: null,
    carry_over: { revision: 2, level: "L02", same_source: false, content_hash: sha256(bytes.a) } });
  expect((await rows()).length).toBe(1);
  await dialog.getByRole("button", "Valider pour cette version", { exact: true }).click();
  await expect(dialog.getByTestId("plan-location-notice")).toContainText("Localisation enregistrée pour cette version du plan.");
  await expect(field("level")).toHaveAttribute("data-state", "corrected");
  const generations = await rows();
  expect(generations.map((row) => [row.source_id, row.content_hash, row.revision, row.level]))
    .toEqual([[ids.a, sha256(bytes.a), 2, "L02"], [dId, sha256(nextA), 1, "L02"]]);
  expect(generations[1].carried_from_id).toBe(generations[0].id);
  await closeLocation();
  // The other plan with no decision on it (B) receives nothing from A.
  const untouched = await apiRequest<{ data: TakeoffPlanFileLocation }>(ui.browser, "GET", `/api/takeoff/plan-sets/${planSetId}/files/${ids.b}/location`);
  expect(untouched.body.data).toMatchObject({ annotation: null, carry_over: null });
  // The first analysis read A: its review keeps A's own correction and offers nothing from the newer revision.
  const history = await apiRequest<{ data: TakeoffJobPlanLocations }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}/plan-locations`);
  expect(history.body.data.plans.find((plan) => plan.plan_file_id === ids.a)).toMatchObject({ status: "current", reading_issue: null,
    revision: { content_hash: sha256(bytes.a) }, annotation: { revision: 2, level: "L02" }, carry_over: null });
  // A correction made after the analysis leaves the worker's own reading as it was persisted.
  const unchangedVector = await apiRequest<{ data: TakeoffVectorReadingResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}/vector-pages`);
  expect(unchangedVector.body.data.pages.find((page) => page.plan_file_id === ids.a)?.reading).toEqual(rawPage?.reading);

  // 8. A reader opens the plan and the review and changes nothing.
  const reader = await signUpWorkerOwner(ui, "LOCR");
  await querySql(`update public.tenant_memberships set is_default = false where user_id = '${reader.userId}';
    insert into public.tenant_memberships (tenant_id,user_id,role,is_default) values ('${tenantId}','${reader.userId}','director',true);`);
  await ui.app.open(`/dashboard/affaires/${projectId}/plans`);
  await ui.screen.getByRole("heading", "Plans localisés", { exact: true }).click();
  await openLocation(A_NAME);
  await expect(field("level")).toContainText("L02");
  await expect(dialog.getByText("Lecture seule : seuls les opérateurs de l’affaire corrigent la localisation d’un plan.", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Niveau", { exact: true })).toHaveCount(0);
  const readerWrite = await apiRequest<{ error: { code: string } }>(ui.browser, "PUT", `/api/takeoff/plan-sets/${planSetId}/files/${ids.a}/location`,
    { content_hash: sha256(bytes.a), expected_revision: 2, building: "A", level: "L09" });
  expect([readerWrite.status, readerWrite.body.error.code]).toEqual([403, "FORBIDDEN"]);
  await closeLocation();
  await ui.app.open(takeoffReviewHref({ projectId, jobId }));
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await showLocations();
  await expect(reviewRow(A_NAME)).toContainText("L02");
  await expect(reviewRow(A_NAME)).toContainText(/Corrigé par .+ le /);
  await expect(reviewRow(A_NAME).getByRole("button", /Corriger/)).toHaveCount(0);
  expect((await rows()).map((row) => [row.revision, row.level, row.updated_by])).toEqual([[2, "L02", userId], [1, "L02", userId]]);
  expect(await querySql(`select count(*) from public.takeoff_plan_location_events where project_id = '${projectId}';`)).toEqual(["3"]);

  await recordEvidence(ui.army, "TKPL01-plan-location", { projectId, planSetId, ids, jobId, relaunchId,
    firstReading: firstReading.body.data.location, conflict: stale.status, readerWrite: readerWrite.status,
    generations, rawVectorLocation: rawPage?.reading, screenshot: reviewScreenshot,
    boundary: "Owned stack, owned worker with the controlled provider; fictional PDFs; no AI call, no e-mail." });
});
