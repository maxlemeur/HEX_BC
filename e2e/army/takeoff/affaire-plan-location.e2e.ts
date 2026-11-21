import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect } from "e2e";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { buildAffaireIntakeStoragePath } from "@/lib/affaires/intake";
import { createEmptyTakeoffPreparation, createTakeoffPreparationSnapshot, type TakeoffPreparationSource } from "@/lib/takeoff/preparation";
import { getPreparationPlanSourceVersion } from "@/lib/takeoff/preparation-sources";
import type { PlanLocationField } from "@/lib/takeoff/plan-location";
import type { TakeoffJobPlanLocations, TakeoffPlanFileLocation } from "@/lib/takeoff/plan-location-contracts";
import { takeoffReviewHref } from "@/lib/takeoff/review-href";
import type { TakeoffVectorReadingResponse } from "@/lib/takeoff/vectors/read-contracts";

import { apiRequest, armyTest, recordEvidence } from "../critical/fixtures";
import { querySql } from "../local/calculation-gate-support";
import { callServerAction, serverActionId } from "../local/engine-v3-creators-support";
import { startOwnedTakeoffAdmission } from "./affaire-admission-support";
import { buildVectorPlanPdf } from "./vector-plan-fixture";
import { ownedWorkerSelection, signUpWorkerOwner, startOwnedWorker } from "./worker-support";

// Lot 3, « Localisation canonique »: the building and the level of a plan revision are read from what the plan shows,
// corrected once on the plan, and found again in the plan centre, the review and a relaunch of the same revision. Three
// fictional plans: A's title block says « BÂTIMENT A / NIVEAU L00 » while its name says BAT-B and R+1; B has two sheets,
// R+1 and R+2; C prints no text (a scan) while its name says BAT-C and R+3. No AI call: the controlled provider of the
// owned worker.

const A_NAME = "P-101_BAT-B_R+1.pdf";
const B_NAME = "P-102_colonnes.pdf";
const C_NAME = "P-103_BAT-C_R+3_scan.pdf";
const D_NAME = "P-101_BAT-B_R+1_indice-B.pdf";
const E_NAME = "P-104_BAT-E.pdf";
const PIECE_NAME = "P-201_plan-dossier.pdf";
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const valueOf = (value: string) => ({ choice: "value" as const, value });

/** The service client of the owned local stack the runner started: never a shared one. */
function ownedLocalClient() {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  const workerKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (process.env.E2E_ARMY_TAKEOFF_WORKER !== "1" || !["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname)
    || backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST || !workerKey) {
    throw new Error("An owned local worker stack is required.");
  }
  return createClient(backend.origin, workerKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

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
  const setup = ownedLocalClient();

  const projectId = randomUUID();
  const planSetId = randomUUID();
  const ids = { a: randomUUID(), b: randomUUID(), c: randomUUID(), e: randomUUID() };
  // E is another plan, unrelated to A and never corrected: it must never receive A's correction.
  const bytes = {
    a: await buildVectorPlanPdf({ titleBlock: ["PLAN DE PLOMBERIE FICTIF", "BÂTIMENT A", "NIVEAU L00"] }),
    b: await buildSheetsPdf([["BÂTIMENT A", "NIVEAU R+1"], ["BÂTIMENT A", "NIVEAU R+2"]]),
    c: await buildSheetsPdf([[]]),
    e: await buildSheetsPdf([["BÂTIMENT E", "NIVEAU R+4"]]),
  };
  const plans = [
    { key: "a" as const, name: A_NAME, pages: 1 }, { key: "b" as const, name: B_NAME, pages: 2 }, { key: "c" as const, name: C_NAME, pages: 1 },
    { key: "e" as const, name: E_NAME, pages: 1 },
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
  // Every plan of the set is a known source (M1 attests the whole set); C and E are set aside.
  preparation.sources = plans.map((plan): TakeoffPreparationSource => ({
    document_id: plan.id, document_name: plan.name, kind: "plan", revision: "A",
    source_version: getPreparationPlanSourceVersion({ ...stored.get(plan.id)!, id: plan.id, plan_set_id: planSetId, file_path: plan.path, file_name: `${plan.key}.pdf` }),
    content_hash: sha256(bytes[plan.key]), pages: [], active: plan.key === "a" || plan.key === "b", confirmed: true, plan_set_id: planSetId, file_path: plan.path,
    page_count: plan.pages, logical_document_id: null, source_updated_at: stored.get(plan.id)!.updated_at, mime_type: "application/pdf", page_triage: null }));
  preparation.conventions = { unit: "m", measurement_basis: "dimensioned", calibration: null, purchase: null, confirmed: true };
  preparation.destination = { kind: "analysis_only", estimate_version_id: null, reviewer: null, confirmed: true };
  preparation.processing = { level: "C", provider: "chatgpt" };
  const confirmedAt = new Date().toISOString();
  const snapshot = { ...createTakeoffPreparationSnapshot({ preparation, revision: 1, confirmedAt, confirmedBy: userId }),
    execution_selection: await ownedWorkerSelection() };
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
  // A scan's title block is not read, and its original name never stands in for it. Both fields stay to be
  // specified, with the name's values shown beside them only (the earlier rule proposed C and R+3 from the name).
  await openLocation(C_NAME);
  for (const name of ["building", "level"] as const) {
    await expect(field(name)).toHaveAttribute("data-state", "unknown");
    await expect(field(name)).toContainText("À préciser");
    await expect(field(name)).toContainText("Cartouche non lu");
  }
  await expect(field("building")).toContainText("Autre lecture : C (nom du fichier)");
  await expect(field("level")).toContainText("Autre lecture : R+3 (nom du fichier)");
  await expect(dialog.getByText("Cartouche non lu : aucun texte lisible sur 1 page", { exact: false })).toBeVisible();
  const scan = await apiRequest<{ data: TakeoffPlanFileLocation }>(ui.browser, "GET", `/api/takeoff/plan-sets/${planSetId}/files/${ids.c}/location`);
  expect(scan.body.data).toMatchObject({ reading: { title_block_read: false, building: [{ value: "C", source: "file_name", pages: [] }],
    level: [{ value: "R+3", source: "file_name", pages: [] }] }, location: { building: { value: null, state: "unknown", origin: null },
    level: { value: null, state: "unknown", origin: null } } });
  await closeLocation();

  // 2. The operator corrects the level once, on the plan. The building nobody touched stays the plan's reading, to be
  // checked: editing one field confirms nothing of the other.
  await openLocation(A_NAME);
  const choice = (name: PlanLocationField, label: string) =>
    dialog.getByTestId(`plan-location-choice-${name}`).getByRole("radio", label, { exact: true });
  await dialog.getByLabel("Niveau", { exact: true }).fill("L01");
  await dialog.getByRole("button", "Enregistrer", { exact: true }).click();
  await expect(dialog.getByTestId("plan-location-notice")).toContainText("Localisation enregistrée pour cette version du plan.");
  await expect(field("building")).toHaveAttribute("data-state", "proposed");
  await expect(field("building")).toContainText("Lu dans le cartouche, page 1 · à vérifier");
  await expect(field("level")).toHaveAttribute("data-state", "corrected");
  await expect(field("level")).toContainText("L01");
  await expect(field("level")).toContainText(/Corrigé par .+ le /);
  const rows = async () => (await setup.from("takeoff_plan_locations")
    .select("id,source_kind,source_id,content_hash,revision,building_choice,building,level_choice,level,building_carried,level_carried,carried_from_id,carried_from_revision,created_by,updated_by")
    .eq("project_id", projectId).order("created_at")).data ?? [];
  expect(await rows()).toEqual([{ id: expect.any(String), source_kind: "plan_file", source_id: ids.a, content_hash: sha256(bytes.a), revision: 1,
    building_choice: "reading", building: null, level_choice: "value", level: "L01", building_carried: false, level_carried: false,
    carried_from_id: null, carried_from_revision: null, created_by: userId, updated_by: userId }]);
  // Confirming the building the plan shows is its own act on that field: « Valeur saisie », prefilled with that value.
  await choice("building", "Valeur saisie").click();
  await expect(dialog.getByLabel("Bâtiment", { exact: true })).toHaveValue("A");
  await dialog.getByRole("button", "Enregistrer", { exact: true }).click();
  await expect(field("building")).toHaveAttribute("data-state", "confirmed");
  await expect(field("building")).toContainText(/Confirmé par .+ le /);
  expect((await rows()).map((row) => [row.revision, row.building_choice, row.building, row.level])).toEqual([[2, "value", "A", "L01"]]);
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
    { content_hash: sha256(bytes.a), expected_revision: 2, building: valueOf("A"), level: valueOf("L02") });
  expect([otherTab.status, otherTab.body.data.annotation?.revision, otherTab.body.data.annotation?.level.value]).toEqual([200, 3, "L02"]);
  // Each field keeps who set it and at which generation; the building, unchanged, keeps generation 2.
  expect(otherTab.body.data.annotation).toMatchObject({ building: { choice: "value", value: "A", set_by: userId, set_revision: 2 },
    level: { choice: "value", value: "L02", set_by: userId, set_revision: 3 } });
  await dialog.getByLabel("Niveau", { exact: true }).fill("L03");
  await dialog.getByRole("button", "Enregistrer", { exact: true }).click();
  await expect(dialog.getByTestId("plan-location-notice")).toContainText("a été enregistrée entre-temps");
  await expect(dialog.getByTestId("plan-location-notice")).toContainText("niveau L03) n’a pas été enregistrée");
  await expect(field("level")).toContainText("L02");
  await expect(dialog.getByLabel("Niveau", { exact: true })).toHaveValue("L02");
  const stale = await apiRequest<{ error: { code: string; details: { reason: string } } }>(ui.browser, "PUT",
    `/api/takeoff/plan-sets/${planSetId}/files/${ids.a}/location`, { content_hash: sha256(bytes.a), expected_revision: 2, building: valueOf("A"),
      level: valueOf("L04") });
  expect([stale.status, stale.body.error.details.reason]).toEqual([409, "TAKEOFF_PLAN_LOCATION_CONFLICT"]);
  expect((await rows()).map((row) => [row.revision, row.level])).toEqual([[3, "L02"]]);
  await closeLocation();

  // 4b. On B, the operator leaves the building to the plan's reading and marks the level « À préciser ».
  // B's two readings stay visible; its level is unknown wherever B is shown (here, the review, a relaunch).
  await openLocation(B_NAME);
  await choice("building", "Lecture du plan (A)").click();
  await choice("level", "À préciser").click();
  await dialog.getByRole("button", "Enregistrer", { exact: true }).click();
  await expect(dialog.getByTestId("plan-location-notice")).toContainText("Localisation enregistrée pour cette version du plan.");
  await expect(field("building")).toHaveAttribute("data-state", "proposed");
  await expect(field("building")).toContainText("Lu dans le cartouche, pages 1, 2 · à vérifier");
  await expect(field("level")).toHaveAttribute("data-state", "unknown");
  await expect(field("level")).toContainText("À préciser");
  await expect(field("level")).toContainText(/Marqué à préciser par .+ le /);
  await expect(field("level")).toContainText("Autre lecture : R+1 (cartouche, page 1), R+2 (cartouche, page 2)");
  const marked = await apiRequest<{ data: TakeoffPlanFileLocation }>(ui.browser, "GET", `/api/takeoff/plan-sets/${planSetId}/files/${ids.b}/location`);
  expect(marked.body.data).toMatchObject({ annotation: { revision: 1, building: { choice: "reading", value: null, set_by: userId, set_revision: 1 },
    level: { choice: "unknown", value: null, set_by: userId, set_revision: 1 } },
    location: { building: { value: "A", state: "proposed", origin: "title_block" }, level: { value: null, state: "unknown", origin: "operator",
      candidates: [{ value: "R+1", source: "title_block", pages: [1] }, { value: "R+2", source: "title_block", pages: [2] }] } } });
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
  // The worker's own reading, known before any correction (as TKW08 pins it): the location it takes from
  // the name the preparation attests, R+1, and never the level corrected on the plan (L02, then a later one).
  const workerLocation = { zone: null, level: "R+1", source: "file_name" };
  expect(rawPage?.reading.location).toEqual(workerLocation);
  await ui.app.open(takeoffReviewHref({ projectId, jobId }));
  const panel = ui.screen.getByTestId("takeoff-plan-locations");
  await expect(panel).toBeVisible({ timeout: 60_000 });
  const showLocations = () => ui.screen.getByRole("button", "Afficher le bâtiment et le niveau des plans", { exact: true }).click();
  await showLocations();
  const reviewRow = (name: string) => ui.browser.locator("[data-testid='takeoff-plan-location']").filter({ hasText: name });
  await expect(reviewRow(A_NAME)).toContainText("L02");
  await expect(reviewRow(A_NAME)).toContainText(/Corrigé par .+ le /);
  // B's level was marked « À préciser » (4b): the review shows it so, the readings beside it.
  await expect(reviewRow(B_NAME)).toContainText("À préciser");
  await expect(reviewRow(B_NAME)).toContainText(/Marqué à préciser par .+ le /);
  await expect(reviewRow(B_NAME)).toContainText("Autre lecture : R+1 (cartouche, page 1), R+2 (cartouche, page 2)");
  await expect(reviewRow(C_NAME)).toHaveCount(0);
  const reviewScreenshot = await ui.app.screenshot("takeoff-plan-location-review");

  // 6. A relaunch on the same revision finds the same correction, with nothing asked.
  const relaunched = await admit(randomUUID()).done;
  const relaunchId = relaunched.receipt!.id;
  expect(relaunchId).not.toBe(jobId);
  const again = await apiRequest<{ data: TakeoffJobPlanLocations }>(ui.browser, "GET", `/api/takeoff/jobs/${relaunchId}/plan-locations`);
  expect(again.body.data.plans.find((plan) => plan.plan_file_id === ids.a)).toMatchObject({ status: "current",
    revision: { source_id: ids.a, content_hash: sha256(bytes.a) }, annotation: { revision: 3, level: { value: "L02", set_revision: 3 } },
    carry_over: null, location: { level: { value: "L02", state: "corrected", origin: "operator" } } });
  expect(again.body.data.plans.find((plan) => plan.plan_file_id === ids.b)).toMatchObject({ status: "current",
    location: { level: { value: null, state: "unknown", origin: "operator" } } });

  // 7. A new revision of A arrives as another file, and the preparation retains it over A: A's correction is only a
  // proposal to check on it, never carried silently; one validation keeps it. A's own revision is untouched.
  const dId = randomUUID();
  const dPath = `${tenantId}/${planSetId}/${dId}/d.pdf`;
  const nextA = await buildVectorPlanPdf({ titleBlock: ["PLAN DE PLOMBERIE FICTIF", "BÂTIMENT A", "NIVEAU L00", "INDICE B"] });
  expect((await setup.storage.from("plan-files").upload(dPath, nextA, { contentType: "application/pdf" })).error).toBeNull();
  const dRow = await setup.from("plan_files").insert({ id: dId, tenant_id: tenantId, plan_set_id: planSetId, file_name: "d.pdf", file_path: dPath,
    file_type: "application/pdf", file_size_bytes: nextA.length, page_count: 1, metadata: { original_file_name: D_NAME } })
    .select("id,plan_set_id,file_path,file_name,file_size_bytes,file_hash,page_count,updated_at").single();
  expect(dRow.error).toBeNull();
  const dSource: TakeoffPreparationSource = { document_id: dId, document_name: D_NAME, kind: "plan", revision: "B",
    source_version: getPreparationPlanSourceVersion(dRow.data!), content_hash: sha256(nextA), pages: [], active: true, confirmed: true,
    plan_set_id: planSetId, file_path: dPath, page_count: 1, logical_document_id: null, source_updated_at: dRow.data!.updated_at,
    mime_type: "application/pdf", page_triage: null };
  // The decision is the preparation's own, saved as the application saves it, and read through the
  // preparation's validator among the plans it can retain. A decision whose fingerprint does not name D's bytes retains
  // nothing; neither does a correct one while the member has set A aside (the earlier reader accepted that pair): no
  // proposal on D in either case.
  await ui.app.open(`/dashboard/affaires/${projectId}/takeoff`);
  const saveAction = await serverActionId("saveTakeoffPreparationAction");
  const decide = (rightHash: string, expectedRevision: number, aRetained = true) => callServerAction(ui.browser, saveAction, { projectId,
    expectedRevision, draft: { ...preparation,
      sources: [...preparation.sources.map((source) => source.document_id === ids.a ? { ...source, active: aRetained } : source), dSource],
      plan_revision_decisions: [{ left: { document_id: ids.a, content_hash: sha256(bytes.a) }, right: { document_id: dId, content_hash: rightHash },
        choice: "right" }] } });
  const dLocation = async () => (await apiRequest<{ data: TakeoffPlanFileLocation }>(ui.browser, "GET",
    `/api/takeoff/plan-sets/${planSetId}/files/${dId}/location`)).body.data;
  const noProposal = { annotation: null, carry_over: null, location: { level: { value: "L00", state: "proposed", origin: "title_block" } } };
  expect(await decide(sha256(bytes.a), 1)).toMatchObject({ ok: true, status: 200 });
  expect(await dLocation()).toMatchObject(noProposal);
  expect(await decide(sha256(nextA), 2, false)).toMatchObject({ ok: true, status: 200 });
  expect(await dLocation()).toMatchObject(noProposal);
  expect(await decide(sha256(nextA), 3)).toMatchObject({ ok: true, status: 200 });
  await ui.app.open(`/dashboard/affaires/${projectId}/plans`);
  await ui.screen.getByRole("heading", "Plans localisés", { exact: true }).click();
  await openLocation(D_NAME);
  await expect(field("level")).toHaveAttribute("data-state", "proposed");
  await expect(field("level")).toContainText("L02");
  await expect(field("level")).toContainText("Repris de la correction d’une version précédente");
  await expect(field("level")).toContainText("Autre lecture : L00 (cartouche, page 1)");
  await expect(dialog.getByText(/Le contenu du plan a changé/)).toBeVisible();
  await expect(dialog.getByText(new RegExp(A_NAME.replaceAll(/[.+]/g, "\\$&")))).toBeVisible();
  expect(await dLocation()).toMatchObject({ revision: { source_id: dId, content_hash: sha256(nextA) }, annotation: null,
    carry_over: { revision: 3, building: { value: "A" }, level: { value: "L02" }, same_source: false, content_hash: sha256(bytes.a) } });
  expect((await rows()).filter((row) => row.source_id === dId)).toEqual([]);
  // A carry names the generation of the correction offered; one named at an older generation of A is a
  // visible conflict, and nothing is written.
  const origin = (await rows()).find((row) => row.source_id === ids.a)!;
  const moved = await apiRequest<{ error: { code: string; details: { reason: string } } }>(ui.browser, "PUT",
    `/api/takeoff/plan-sets/${planSetId}/files/${dId}/location`, { content_hash: sha256(nextA), expected_revision: 0, building: valueOf("A"),
      level: valueOf("L02"), carried_from: { id: origin.id, revision: 1, fields: ["building", "level"] } });
  expect([moved.status, moved.body.error.details.reason]).toEqual([409, "TAKEOFF_PLAN_LOCATION_ORIGIN_MOVED"]);
  expect((await rows()).filter((row) => row.source_id === dId)).toEqual([]);
  // The same through the dialogue, which still shows L02 when another tab changes A's level to L03: the save is refused,
  // the form shows A's current value and says the proposal changed; the next validation carries L03, never L02 as typed.
  const aMoved = await apiRequest<{ data: TakeoffPlanFileLocation }>(ui.browser, "PUT", `/api/takeoff/plan-sets/${planSetId}/files/${ids.a}/location`,
    { content_hash: sha256(bytes.a), expected_revision: 3, building: valueOf("A"), level: valueOf("L03") });
  expect([aMoved.status, aMoved.body.data.annotation?.revision]).toEqual([200, 4]);
  await dialog.getByRole("button", "Valider pour cette version", { exact: true }).click();
  await expect(dialog.getByTestId("plan-location-notice")).toContainText("La correction de la version précédente a changé");
  await expect(dialog.getByTestId("plan-location-notice")).toContainText("niveau L02) n’a pas été enregistrée");
  await expect(field("level")).toContainText("L03");
  await expect(dialog.getByLabel("Niveau", { exact: true })).toHaveValue("L03");
  expect((await rows()).filter((row) => row.source_id === dId)).toEqual([]);
  await dialog.getByRole("button", "Valider pour cette version", { exact: true }).click();
  await expect(dialog.getByTestId("plan-location-notice")).toContainText("Localisation enregistrée pour cette version du plan.");
  await expect(field("level")).toHaveAttribute("data-state", "corrected");
  const generations = await rows();
  expect(generations.map((row) => [row.source_id, row.content_hash, row.revision, row.building_choice, row.level_choice, row.level]))
    .toEqual([[ids.a, sha256(bytes.a), 4, "value", "value", "L03"], [ids.b, sha256(bytes.b), 1, "reading", "unknown", null],
      [dId, sha256(nextA), 1, "value", "value", "L03"]]);
  // Pinned: the origin and the generation it was offered at, and each field carried from it.
  expect(generations[2]).toMatchObject({ carried_from_id: origin.id, carried_from_revision: 4, building_carried: true, level_carried: true });
  await closeLocation();
  // The other plan with no decision on it (B) receives nothing from A: no proposal, and its own choices of 4b, never A's
  // values (its annotation was null before 4b marked its level « À préciser »).
  const untouched = await apiRequest<{ data: TakeoffPlanFileLocation }>(ui.browser, "GET", `/api/takeoff/plan-sets/${planSetId}/files/${ids.b}/location`);
  expect(untouched.body.data).toMatchObject({ carry_over: null, annotation: { revision: 1, carried_from_id: null,
    building: { choice: "reading", value: null }, level: { choice: "unknown", value: null } },
    location: { level: { value: null, state: "unknown", origin: "operator" } } });
  // E, unrelated and never corrected, checked once A has corrections: nothing of A is offered, its own reading stands.
  const unrelated = await apiRequest<{ data: TakeoffPlanFileLocation }>(ui.browser, "GET", `/api/takeoff/plan-sets/${planSetId}/files/${ids.e}/location`);
  expect(unrelated.body.data).toMatchObject({ annotation: null, carry_over: null,
    location: { building: { value: "E", state: "proposed", origin: "title_block" }, level: { value: "R+4", state: "proposed", origin: "title_block" } } });
  // The first analysis read A: its review keeps A's own correction and offers nothing from the newer revision.
  const history = await apiRequest<{ data: TakeoffJobPlanLocations }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}/plan-locations`);
  expect(history.body.data.plans.find((plan) => plan.plan_file_id === ids.a)).toMatchObject({ status: "current", reading_issue: null,
    revision: { content_hash: sha256(bytes.a) }, annotation: { revision: 4, level: { value: "L03" } }, carry_over: null });
  // A's corrections were made before the worker ran and since, D's since: the worker's own reading is as it was
  // persisted, still the value known before any correction.
  const unchangedVector = await apiRequest<{ data: TakeoffVectorReadingResponse }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}/vector-pages`);
  const unchangedPage = unchangedVector.body.data.pages.find((page) => page.plan_file_id === ids.a);
  expect(unchangedPage?.reading).toEqual(rawPage?.reading);
  expect(unchangedPage?.reading.location).toEqual(workerLocation);

  // 8. A director of the affaire's tenant reads it and changes nothing. The stored corrections and their history are read
  // like the affaire; reading a plan's bytes (its title block) needs the plan to be visible, as it is here (the plan
  // centre of an affaire they read, the plans of an analysis they read). What this proves: they see the correction, the
  // form is read only and a write is refused (403). The SQL tests cover the tables' reads and a member without the affaire.
  const reader = await signUpWorkerOwner(ui, "LOCR");
  await querySql(`update public.tenant_memberships set is_default = false where user_id = '${reader.userId}';
    insert into public.tenant_memberships (tenant_id,user_id,role,is_default) values ('${tenantId}','${reader.userId}','director',true);`);
  await ui.app.open(`/dashboard/affaires/${projectId}/plans`);
  await ui.screen.getByRole("heading", "Plans localisés", { exact: true }).click();
  await openLocation(A_NAME);
  await expect(field("level")).toContainText("L03");
  await expect(dialog.getByText("Lecture seule : seuls les opérateurs de l’affaire corrigent la localisation d’un plan.", { exact: true })).toBeVisible();
  await expect(dialog.getByLabel("Niveau", { exact: true })).toHaveCount(0);
  const readerWrite = await apiRequest<{ error: { code: string } }>(ui.browser, "PUT", `/api/takeoff/plan-sets/${planSetId}/files/${ids.a}/location`,
    { content_hash: sha256(bytes.a), expected_revision: 4, building: valueOf("A"), level: valueOf("L09") });
  expect([readerWrite.status, readerWrite.body.error.code]).toEqual([403, "FORBIDDEN"]);
  await closeLocation();
  await ui.app.open(takeoffReviewHref({ projectId, jobId }));
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await showLocations();
  await expect(reviewRow(A_NAME)).toContainText("L03");
  await expect(reviewRow(A_NAME)).toContainText(/Corrigé par .+ le /);
  await expect(reviewRow(A_NAME).getByRole("button", /Corriger/)).toHaveCount(0);
  expect((await rows()).map((row) => [row.revision, row.level, row.updated_by])).toEqual([[4, "L03", userId], [1, null, userId], [1, "L03", userId]]);
  expect(await querySql(`select count(*) from public.takeoff_plan_location_events where project_id = '${projectId}';`)).toEqual(["6"]);

  await recordEvidence(ui.army, "TKPL01-plan-location", { projectId, planSetId, ids, jobId, relaunchId,
    firstReading: firstReading.body.data.location, conflict: stale.status, readerWrite: readerWrite.status,
    generations, rawVectorLocation: rawPage?.reading.location, originMoved: moved.status, screenshot: reviewScreenshot,
    boundary: "Owned stack, owned worker with the controlled provider; fictional PDFs; no AI call, no e-mail." });
});

// The dossier replaces a plan's copy while its location is open. A reclassification of the piece
// rotates its copy generation, and the dossier sync (the application's own route) removes the copy and makes another of
// the same bytes. The save made through the removed copy says so and the dialogue shows the current copy with what
// applies to it; the analysis that read the removed copy finds the piece's correction and opens its current copy.
// Fictional PDF; the reclassification is written with the service role (no classifier runs); no AI call.
armyTest("TKPL02 a dossier plan replaced while its location is open: the member is told, sees the current copy and what applies to it, and the earlier analysis still finds it", {
  session: "army", trace: "off", tags: ["critical", "takeoff-worker", "local"], timeout: 300_000,
}, async (ui) => {
  await ui.app.open("/dashboard/affaires");
  const owner = await signUpWorkerOwner(ui, "LOCD");
  const { tenantId, userId } = owner;
  const setup = ownedLocalClient();
  const projectId = randomUUID();
  const uploadId = randomUUID();
  const documentId = randomUUID();
  const bytes = await buildVectorPlanPdf({ titleBlock: ["PLAN DE PLOMBERIE FICTIF", "BÂTIMENT A", "NIVEAU L00"] });
  const storagePath = buildAffaireIntakeStoragePath({ tenantId, projectId, uploadId, documentId, fileName: PIECE_NAME });
  expect((await setup.from("estimate_projects").insert({ id: projectId, tenant_id: tenantId, user_id: userId,
    name: `${ui.army.runPrefix} dossier localisé` })).error).toBeNull();
  (ui.army.ownedTakeoffAffaires ??= []).push(projectId);
  const classifiedAt = new Date().toISOString();
  expect((await setup.from("affaire_intake_uploads").insert({ id: uploadId, tenant_id: tenantId, project_id: projectId, created_by: userId,
    status: "ready", completed_at: classifiedAt })).error).toBeNull();
  expect((await setup.storage.from("affaire-intake").upload(storagePath, bytes, { contentType: "application/pdf" })).error).toBeNull();
  expect((await setup.from("affaire_intake_documents").insert({ id: documentId, tenant_id: tenantId, project_id: projectId, upload_id: uploadId,
    created_by: userId, storage_path: storagePath, file_name: PIECE_NAME, mime_type: "application/pdf", size_bytes: bytes.length,
    upload_status: "uploaded", classification_status: "classified", document_kind: "plans", confidence: 0.95, issues: [],
    classification_source: "heuristic", classified_at: classifiedAt,
    extracted_metadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] } })).error).toBeNull();
  const copies = async () => (await setup.from("plan_files").select("id,plan_set_id,file_path,file_name,file_size_bytes,file_hash,page_count,updated_at")
    .eq("tenant_id", tenantId).contains("metadata", { intake_document_id: documentId })).data ?? [];
  const reconcile = async () => {
    const synced = await apiRequest<{ data: { changed: boolean } }>(ui.browser, "POST", `/api/affaires/${projectId}/intake/reconcile-plans`);
    expect([synced.status, synced.body.data.changed]).toEqual([200, true]);
  };

  // 1. The dossier sync copies the piece into the affaire's plans; an analysis reads that copy.
  await reconcile();
  const [first, ...extraFirst] = await copies();
  expect([first, extraFirst]).toEqual([expect.objectContaining({ file_size_bytes: bytes.length }), []]);
  const planSetId = first.plan_set_id;
  (ui.army.ownedPlanSets ??= []).push({ projectId, planSetId, tenantId });
  const preparation = createEmptyTakeoffPreparation({ estimateVersionId: null });
  preparation.objective = "measure_length";
  preparation.objective_confirmed = true;
  preparation.scope = { ...preparation.scope, lots: ["Plomberie"], networks: ["EF"], buildings: ["A"], confirmed: true };
  preparation.sources = [{ document_id: first.id, document_name: PIECE_NAME, kind: "plan", revision: "A",
    source_version: getPreparationPlanSourceVersion(first), content_hash: sha256(bytes), pages: [], active: true, confirmed: true,
    plan_set_id: planSetId, file_path: first.file_path, page_count: first.page_count, logical_document_id: null,
    source_updated_at: first.updated_at, mime_type: "application/pdf", page_triage: null }];
  preparation.conventions = { unit: "m", measurement_basis: "dimensioned", calibration: null, purchase: null, confirmed: true };
  preparation.destination = { kind: "analysis_only", estimate_version_id: null, reviewer: null, confirmed: true };
  preparation.processing = { level: "C", provider: "chatgpt" };
  const confirmedAt = new Date().toISOString();
  const snapshot = { ...createTakeoffPreparationSnapshot({ preparation, revision: 1, confirmedAt, confirmedBy: userId }),
    execution_selection: await ownedWorkerSelection() };
  expect(snapshot.readiness.can_launch).toBe(true);
  expect((await setup.from("takeoff_preparations").insert({ tenant_id: tenantId, project_id: projectId, revision: 1, draft: preparation,
    confirmed_snapshot: snapshot, confirmed_at: confirmedAt, confirmed_by: userId, updated_by: userId })).error).toBeNull();
  const launched = await startOwnedTakeoffAdmission(owner, ui.army.runPrefix, projectId, planSetId, randomUUID()).done;
  const jobId = launched.receipt!.id;
  const completed = await startOwnedWorker(ui, { projectId, versionId: null }, jobId, "success", { owner, providerItems: [
    { designation: "ARMY tube du dossier", quantity: 2, unit: "m", source_page: 1, confidence: 0.9, evidence: "Tube, page 1" },
  ] }).done;
  expect(completed.job).toMatchObject({ status: "completed" });

  // 2. The member opens the plan's location and corrects its level, on the dossier piece's revision.
  await ui.app.open(`/dashboard/affaires/${projectId}/plans`);
  await ui.screen.getByRole("heading", "Plans import", { exact: true }).click();
  const dialog = ui.screen.getByRole("dialog", "Localisation du plan");
  const field = (name: PlanLocationField) => ui.screen.getByTestId(`plan-location-summary-${name}`);
  const notice = dialog.getByTestId("plan-location-notice");
  await ui.screen.getByRole("button", `Bâtiment et niveau de ${PIECE_NAME}`, { exact: true }).click();
  await expect(field("level")).toContainText("L00", { timeout: 45_000 });
  await dialog.getByLabel("Niveau", { exact: true }).fill("L01");
  await dialog.getByRole("button", "Enregistrer", { exact: true }).click();
  await expect(notice).toContainText("Localisation enregistrée pour cette version du plan.");
  const rows = async () => (await setup.from("takeoff_plan_locations").select("source_kind,source_id,content_hash,revision,level,plan_file_id")
    .eq("project_id", projectId).order("created_at")).data ?? [];
  expect(await rows()).toEqual([{ source_kind: "intake_document", source_id: documentId, content_hash: sha256(bytes), revision: 1, level: "L01",
    plan_file_id: first.id }]);

  // 3. With the dialogue still open, the piece is reclassified: the sync removes its copy and makes another.
  expect((await setup.from("affaire_intake_documents").update({ classified_at: new Date(Date.parse(classifiedAt) + 60_000).toISOString(),
    classification_source: "manual" }).eq("id", documentId)).error).toBeNull();
  await reconcile();
  const [second, ...extraSecond] = await copies();
  expect([second.id === first.id, second.file_size_bytes, extraSecond]).toEqual([false, bytes.length, []]);

  // 4. The save made through the removed copy is refused, says the plan was replaced and opens its current copy, where
  // the piece's correction (same bytes) applies; the value typed is not written.
  await dialog.getByLabel("Niveau", { exact: true }).fill("L02");
  await dialog.getByRole("button", "Enregistrer", { exact: true }).click();
  await expect(notice).toContainText("Ce plan a été remplacé dans le dossier : sa version actuelle est affichée, avec ce qui s’y applique.");
  await expect(notice).toContainText("Votre saisie (bâtiment selon la lecture du plan, niveau L02) n’a pas été enregistrée.");
  await expect(field("level")).toContainText("L01");
  await expect(field("level")).toContainText(/Corrigé par .+ le /);
  await expect(dialog.getByLabel("Niveau", { exact: true })).toHaveValue("L01");
  expect((await rows()).map((row) => [row.revision, row.level, row.plan_file_id])).toEqual([[1, "L01", first.id]]);
  // The route says the same to any caller of the removed copy, reading or writing, and names the current copy.
  type Refusal = { error: { code: string; details: { reason: string; replacement: unknown } } };
  const removedPath = `/api/takeoff/plan-sets/${planSetId}/files/${first.id}/location`;
  const staleRead = await apiRequest<Refusal>(ui.browser, "GET", removedPath);
  const staleWrite = await apiRequest<Refusal>(ui.browser, "PUT", removedPath,
    { content_hash: sha256(bytes), expected_revision: 1, building: valueOf("A"), level: valueOf("L09") });
  for (const refused of [staleRead, staleWrite]) {
    expect([refused.status, refused.body.error.details]).toEqual([409, expect.objectContaining({ reason: "TAKEOFF_PLAN_LOCATION_SOURCE_STALE",
      replacement: { plan_set_id: planSetId, plan_file_id: second.id } })]);
  }
  expect((await rows()).map((row) => row.revision)).toEqual([1]);

  // 5. The current copy is corrected from the same dialogue.
  await dialog.getByLabel("Niveau", { exact: true }).fill("L02");
  await dialog.getByRole("button", "Enregistrer", { exact: true }).click();
  await expect(notice).toContainText("Localisation enregistrée pour cette version du plan.");
  await expect(field("level")).toContainText("L02");
  expect((await rows()).map((row) => [row.revision, row.level, row.plan_file_id])).toEqual([[2, "L02", second.id]]);
  await dialog.getByRole("button", "Fermer", { exact: true }).click();
  await expect(dialog).toBeHidden();

  // 6. The analysis read the removed copy: its review shows the piece's correction, says the plan was replaced and opens
  // its current copy.
  const history = await apiRequest<{ data: TakeoffJobPlanLocations }>(ui.browser, "GET", `/api/takeoff/jobs/${jobId}/plan-locations`);
  expect(history.body.data).toMatchObject({ can_edit: true, plans: [{ plan_file_id: first.id, status: "unavailable",
    replacement: { plan_set_id: planSetId, plan_file_id: second.id },
    revision: { source_kind: "intake_document", source_id: documentId, content_hash: sha256(bytes) },
    annotation: { revision: 2, level: { choice: "value", value: "L02" } }, location: { level: { value: "L02", state: "corrected" } } }] });
  await ui.app.open(takeoffReviewHref({ projectId, jobId }));
  await expect(ui.screen.getByTestId("takeoff-plan-locations")).toBeVisible({ timeout: 60_000 });
  await ui.screen.getByRole("button", "Afficher le bâtiment et le niveau des plans", { exact: true }).click();
  const reviewRow = ui.browser.locator("[data-testid='takeoff-plan-location']").filter({ hasText: PIECE_NAME });
  await expect(reviewRow).toContainText("L02");
  await expect(reviewRow).toContainText("Ce plan a été remplacé dans le dossier depuis cette analyse");
  await reviewRow.getByRole("button", `Corriger le bâtiment et le niveau de ${PIECE_NAME}`, { exact: true }).click();
  await expect(field("level")).toContainText("L02", { timeout: 45_000 });
  await expect(dialog.getByLabel("Niveau", { exact: true })).toHaveValue("L02");
  const reviewScreenshot = await ui.app.screenshot("takeoff-plan-location-replaced-review");

  await recordEvidence(ui.army, "TKPL02-plan-location-replaced", { projectId, planSetId, documentId, firstCopy: first.id, secondCopy: second.id,
    jobId, staleRead: staleRead.status, staleWrite: staleWrite.status, history: history.body.data.plans, screenshot: reviewScreenshot,
    boundary: "Owned stack, owned worker with the controlled provider; fictional PDF; reclassification written with the service role; no AI call, no e-mail." });
});
