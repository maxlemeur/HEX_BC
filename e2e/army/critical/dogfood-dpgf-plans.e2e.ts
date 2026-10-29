import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect } from "e2e";

import { armyTest, createEstimateViaWizard, readEstimate, recordEvidence } from "./fixtures";
import { readPlanFiles, readPlanSets } from "./plans-support";
import { localClient } from "../takeoff/native-ui";
import { buildAffaireIntakeStoragePath } from "../../../src/lib/affaires/intake";

// Verify the app and the authenticated fixture point at the same owned local
// database before any test creates an affair, including when invoked directly.
async function requireOwnedApplication(ui: Parameters<typeof createEstimateViaWizard>[0]) {
  const appOrigin = new URL(ui.app.baseUrl!);
  if (appOrigin.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(appOrigin.hostname) ||
      appOrigin.origin !== new URL(process.env.E2E_ARMY_BASE_URL!).origin) throw new Error("Dogfood requires the owned local application.");
  const local = await localClient();
  const membership = await local.client.from("tenant_memberships").select("tenant_id").eq("user_id", local.userId).eq("is_default", true).single();
  if (membership.error || !membership.data) throw new Error("Owned local tenant could not be verified.");
  await ui.app.open("/dashboard/affaires");
  const actor = await ui.browser.evaluate(async () => {
    const response = await fetch("/api/tenants/memberships");
    const payload = await response.json();
    return { status: response.status, userId: payload.data?.current_user_id ?? null, tenantId: payload.data?.tenant?.id ?? null };
  });
  if (actor.status !== 200 || actor.userId !== local.userId || actor.tenantId !== membership.data.tenant_id) {
    throw new Error("The application is not authenticated against the owned local test tenant.");
  }
  return local;
}

type OwnedClient = Awaited<ReturnType<typeof localClient>>["client"];

// Seeds one stored dossier copy as the local upload leaves it, without running the
// classifier: a ready lot, its document row, then the bytes under the RLS-checked path.
// Drive pieces are links read from Google, which the owned campaign never calls.
async function seedStoredIntakeCopy(client: OwnedClient, input: {
  tenantId: string; projectId: string; userId: string; file: File; bytes: Buffer;
  classification: { classification_status: "ambiguous" | "classified"; document_kind: "a_classer" | "dpgf"; confidence: number };
}) {
  const uploadId = randomUUID();
  const documentId = randomUUID();
  const now = new Date().toISOString();
  const storagePath = buildAffaireIntakeStoragePath({ tenantId: input.tenantId, projectId: input.projectId, uploadId, documentId, fileName: input.file.name });
  const upload = await client.from("affaire_intake_uploads").insert({
    id: uploadId, tenant_id: input.tenantId, project_id: input.projectId, created_by: input.userId, status: "ready", completed_at: now,
  });
  if (upload.error) throw new Error(`Owned intake upload failed: ${upload.error.code}`);
  const document = await client.from("affaire_intake_documents").insert({
    id: documentId, tenant_id: input.tenantId, project_id: input.projectId, upload_id: uploadId, created_by: input.userId,
    storage_path: storagePath, file_name: input.file.name, mime_type: input.file.type, size_bytes: input.bytes.length,
    upload_status: "uploaded", issues: [], classification_source: "heuristic", classified_at: now, ...input.classification,
    extracted_metadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
  });
  if (document.error) throw new Error(`Owned intake document failed: ${document.error.code}`);
  const stored = await client.storage.from("affaire-intake").upload(storagePath, input.bytes, { contentType: input.file.type });
  if (stored.error) throw new Error(`Owned intake copy failed: ${stored.error.message}`);
  return { uploadId, documentId, storagePath };
}

armyTest("DOG01 stored dossier DPGF feeds structured import and uploaded plans reconcile the dossier", {
  session: "army", trace: "off", tags: ["critical", "dpgf", "plan-center", "local"], timeout: 240_000,
}, async (ui) => {
  const { army, app, browser, screen } = ui;
  const { client, userId } = await requireOwnedApplication(ui);
  const ids = await createEstimateViaWizard(ui, { projectName: `${army.runPrefix}-DOG01`, title: "Dossier fictif" }, army);
  const project = await client.from("estimate_projects").select("id,tenant_id,name,user_id,is_archived").eq("id", ids.projectId).single();
  expect(project.error).toBeNull();
  const bytes = await readFile(path.resolve("public/exemple-dpgf.xlsx"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const file = new File([bytes], "exemple-dpgf.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const copy = await seedStoredIntakeCopy(client, { tenantId: project.data!.tenant_id, projectId: ids.projectId, userId, file, bytes,
    classification: { classification_status: "ambiguous", document_kind: "a_classer", confidence: 0.4 } });
  (army.ownedIntakeCopies ??= []).push({ projectId: ids.projectId, storagePath: copy.storagePath });

  // Exercise the normal classification refresh so the pre-existing missing-plan
  // entry is created through the application, not fabricated by the test.
  await app.open(`/dashboard/affaires/${ids.projectId}?intakeDocument=${copy.documentId}#intake`);
  await screen.getByRole("button", `Détails de ${file.name}`, { exact: true }).click();
  const details = screen.getByRole("dialog", "Document et détails", { exact: true });
  await details.getByRole("button", "Reclasser", { exact: true }).click();
  await details.getByLabel("Nouvelle catégorie", { exact: true }).selectOption({ value: "dpgf" });
  await details.getByRole("button", "Valider", { exact: true }).click();
  // The document desk keeps the dialog open while classification is pending.
  await expect(details.getByRole("button", "Supprimer la copie", { exact: true })).toBeEnabled();
  await details.getByRole("button", "Fermer", { exact: true }).click();
  await expect(details).toBeHidden();
  const activeGaps = async () => {
    const result = await client.from("affaire_register_entries").select("code").eq("project_id", ids.projectId)
      .eq("kind", "missing_piece").eq("is_active", true);
    if (result.error) throw result.error;
    return result.data.map((entry) => entry.code).sort();
  };
  await expect.poll(activeGaps).toContain("missing_plans");

  const denied = await browser.evaluate(async ({ projectId, documentId }) => {
    const wrongDocument = await fetch(`/api/affaires/${projectId}/intake/files/${crypto.randomUUID()}`);
    const wrongProject = await fetch(`/api/affaires/${crypto.randomUUID()}/intake/files/${documentId}`);
    return [wrongDocument.status, wrongProject.status];
  }, { projectId: ids.projectId, documentId: copy.documentId });
  expect(denied).toEqual([404, 404]);

  await screen.getByRole("button", "Importer cette DPGF", { exact: true }).click();
  await expect(screen.getByRole("button", "Lancer l'import", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(screen.getByText(/DPGF du dossier.*exemple-dpgf\.xlsx/)).toBeVisible();
  const selectedDpgfScreenshot = await app.screenshot("DOG01-dpgf-selection");
  let submitted = 0;
  await browser.route(`**/api/affaires/${ids.projectId}/intake/files/${copy.documentId}`, async route => {
    if (route.request.method === "POST") submitted += 1;
    await route.fallback();
  });
  // Closing a deep-linked drawer can restore focus to the skip link. Focusing
  // that accessible link must not push the whole page down or swallow a click.
  await screen.getByRole("link", "Aller au contenu principal", { exact: true }).focus();
  const mainTop = await browser.evaluate(() => document.querySelector("main")!.getBoundingClientRect().top);
  await screen.getByRole("button", "Lancer l'import", { exact: true }).click();
  await expect.poll(() => submitted).toBe(1);
  expect(await browser.evaluate(() => document.querySelector("main")!.getBoundingClientRect().top)).toBe(mainTop);
  const nextMapping = screen.getByRole("button", "Suivant : Aperçu", { exact: true });
  const editMapping = screen.getByRole("button", "Modifier le mapping", { exact: true });
  await expect.poll(async () => (await nextMapping.isVisible()) || (await editMapping.isVisible()), { timeout: 30_000 }).toBe(true);
  if (await editMapping.isVisible()) await editMapping.click();
  await expect(nextMapping).toBeEnabled();

  const imports = await client.from("dpgf_imports").select("id,filename,status,row_count,project_id").eq("project_id", ids.projectId);
  expect(imports.error).toBeNull();
  expect(imports.data).toHaveLength(1);
  expect(imports.data![0]).toMatchObject({ filename: file.name, status: "completed", row_count: 8 });
  const raw = await client.from("dpgf_rows_raw").select("row_index,payload").eq("import_id", imports.data![0].id).order("row_index");
  expect(raw.error).toBeNull();
  expect(raw.data).toHaveLength(8);
  expect(raw.data![0].payload).toMatchObject({ Designation: "Terrassement general", Quantite: 150 });
  expect(raw.data![0].payload).toMatchObject({ _timax_provenance: { source_document_id: copy.documentId, source_file_name: file.name } });
  await nextMapping.click();
  await screen.getByRole("button", "Suivant : Confirmation", { exact: true }).click();
  await screen.getByRole("button", "Créer le chiffrage", { exact: true }).click();
  await expect(screen.getByRole("heading", "Devis créé", { exact: true })).toBeVisible({ timeout: 45_000 });
  await screen.getByRole("button", "Continuer", { exact: true }).click();
  await expect(screen.getByRole("heading", "Ajouter les plans", { exact: true })).toBeVisible();
  await expect.poll(async () => (await readPlanSets(browser, ids.projectId)).length).toBe(1);
  const [set] = await readPlanSets(browser, ids.projectId);
  expect(set.tenant_id).toBe(project.data!.tenant_id);
  (army.ownedPlanSets ??= []).push({ projectId: ids.projectId, planSetId: set.id, tenantId: set.tenant_id });

  // Metadata alone must not make an interrupted upload count as a plan.
  const incomplete = await browser.evaluate(async (setId) => {
    const response = await fetch(`/api/takeoff/plan-sets/${setId}/files`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file_name: "incomplet.pdf", file_type: "application/pdf", file_size_bytes: 200 }) });
    const payload = await response.json();
    return { status: response.status, id: payload.data?.plan_file?.id as string };
  }, set.id);
  expect(incomplete.status).toBe(201);
  const reconcileStatus = await browser.evaluate(async (setId) => (await fetch(`/api/takeoff/plan-sets/${setId}/files/reconcile`, { method: "POST" })).status, set.id);
  expect(reconcileStatus).toBe(200);
  expect(await activeGaps()).toContain("missing_plans");
  const cleanupStatus = await browser.evaluate(async ({ setId, fileId }) => (await fetch(`/api/takeoff/plan-sets/${setId}/files/${fileId}`, { method: "DELETE" })).status,
    { setId: set.id, fileId: incomplete.id });
  expect(cleanupStatus).toBe(200);

  await browser.locator('input[name="plan-files"]').setInputFiles(path.resolve("e2e/fixtures/sample-plan.pdf"));
  await expect.poll(activeGaps, { timeout: 30_000 }).not.toContain("missing_plans");
  const remaining = await activeGaps();
  expect(remaining).toContain("missing_cctp");
  const sets = await readPlanSets(browser, ids.projectId);
  expect(sets).toHaveLength(1);
  const plans = await readPlanFiles(browser, set.id);
  expect(plans).toHaveLength(1);
  expect(plans[0].file_name).toBe("sample-plan.pdf");
  await browser.evaluate(() => {
    [...document.querySelectorAll("span")].find((element) => element.textContent?.trim() === "sample-plan.pdf")?.scrollIntoView({ block: "center" });
    return true;
  });
  const uploadedPlanScreenshot = await app.screenshot("DOG01-plan-uploaded");
  const planRecord = await client.from("plan_files").select("file_path").eq("id", plans[0].id).single();
  const stored = await client.storage.from("plan-files").download(planRecord.data!.file_path);
  expect(stored.error).toBeNull();
  expect(createHash("sha256").update(Buffer.from(await stored.data!.arrayBuffer())).digest("hex"))
    .toBe(createHash("sha256").update(await readFile(path.resolve("e2e/fixtures/sample-plan.pdf"))).digest("hex"));
  await screen.getByRole("button", "Terminer et acceder au dossier", { exact: true }).click();
  await app.open(`/dashboard/affaires/${ids.projectId}/plans`);
  await screen.getByRole("heading", "Plans import", { exact: true }).click();
  await screen.getByRole("button", "Supprimer sample-plan.pdf", { exact: true }).click();
  await screen.getByRole("alertdialog", /Supprimer le fichier/i).getByRole("button", "Supprimer", { exact: true }).click();
  await expect.poll(activeGaps, { timeout: 30_000 }).toContain("missing_plans");

  const versions = await client.from("estimate_versions").select("id,version_number").eq("project_id", ids.projectId).order("version_number", { ascending: false });
  expect(versions.error).toBeNull();
  const estimate = await readEstimate(browser, versions.data![0].id);
  expect(estimate.items.filter((item) => item.item_type === "line")).toHaveLength(8);
  await recordEvidence(army, "DOG01-dossier-dpgf-plan", { ids, sourceSha256: sha256, importId: imports.data![0].id,
    rawRows: raw.data?.length, planSetId: set.id, planFileId: plans[0].id, remainingGaps: remaining, denied,
    screenshots: [selectedDpgfScreenshot, uploadedPlanScreenshot],
    scope: "Fictional stored dossier copy in the owned native stack; no Google OAuth or AI provider call. Stack destroyed after the campaign." });
});

armyTest("DOG02 concurrent preparation returns one canonical import plan set", {
  session: "army", trace: "off", tags: ["critical", "plan-center", "local"], timeout: 120_000,
}, async (ui) => {
  await requireOwnedApplication(ui);
  const ids = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-DOG02`, title: "Plans concurrents" }, ui.army);
  const result = await ui.browser.evaluate(async ({ projectId }) => {
    const body = JSON.stringify({ project_id: projectId, name: "Plans import",
      metadata: { source: "import-flow", default_import_plan_set: true } });
    return Promise.all([1, 2].map(async () => {
      const response = await fetch("/api/takeoff/plan-sets", { method: "POST", headers: { "Content-Type": "application/json" }, body });
      const payload = await response.json();
      return { status: response.status, id: payload.data?.plan_set?.id };
    }));
  }, ids);
  expect(result.map((entry) => entry.status)).toEqual([201, 201]);
  expect(result[0].id).toBe(result[1].id);
  expect(await readPlanSets(ui.browser, ids.projectId)).toHaveLength(1);
  await recordEvidence(ui.army, "DOG02-concurrent-plan-set", { ids, results: result, expectedSetCount: 1 });
});

armyTest("DOG03 stored tabular PDF requires approval of the exact reviewed bytes", {
  session: "army", trace: "off", tags: ["critical", "dpgf", "pdf", "local"], timeout: 120_000,
}, async (ui) => {
  const { client, userId } = await requireOwnedApplication(ui);
  const ids = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-DOG03`, title: "DPGF PDF fictive" }, ui.army);
  const project = await client.from("estimate_projects").select("id,tenant_id,name,user_id,is_archived").eq("id", ids.projectId).single();
  expect(project.error).toBeNull();
  const bytes = await readFile(path.resolve("e2e/fixtures/us22_live_tabular.pdf"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const file = new File([bytes], "dpgf-fictive.pdf", { type: "application/pdf" });
  const copy = await seedStoredIntakeCopy(client, { tenantId: project.data!.tenant_id, projectId: ids.projectId, userId, file, bytes,
    classification: { classification_status: "classified", document_kind: "dpgf", confidence: 1 } });
  await ui.app.open(`/dashboard/affaires/${ids.projectId}`);
  const review = await ui.browser.evaluate(async ({ projectId, documentId }) => {
    const response = await fetch(`/api/affaires/${projectId}/intake/files/${documentId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "review_pdf" }) });
    const payload = await response.json();
    return { status: response.status, digest: payload.data?.source_sha256 as string, suggested: payload.data?.review?.suggested_approved_tables as Array<{ sourcePage: number; tableIndex: number }> };
  }, { projectId: ids.projectId, documentId: copy.documentId });
  expect(review.status).toBe(200);
  expect(review.digest).toBe(sha256);
  expect(review.suggested.length).toBeGreaterThan(0);
  const changed = Buffer.from(bytes);
  changed[changed.length - 1] ^= 1;
  const storage = client.storage.from("affaire-intake");
  expect((await storage.upload(copy.storagePath, changed, { contentType: "application/pdf", upsert: true })).error).toBeNull();
  const submit = (digest: string) => ui.browser.evaluate(async ({ projectId, documentId, digest, approvedTables }) => {
    const response = await fetch(`/api/affaires/${projectId}/intake/files/${documentId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import", sourceSha256: digest, approvedTables }) });
    const payload = await response.json();
    return { status: response.status, id: (payload.data?.id ?? null) as string | null };
  }, { projectId: ids.projectId, documentId: copy.documentId, digest, approvedTables: review.suggested });
  expect((await submit(review.digest)).status).toBe(409);
  expect((await storage.upload(copy.storagePath, bytes, { contentType: "application/pdf", upsert: true })).error).toBeNull();
  const imported = await submit(review.digest);
  expect(imported.status).toBe(201);
  const record = await client.from("dpgf_imports").select("id,row_count,parse_mode,storage_path").eq("project_id", ids.projectId).single();
  expect(record.error).toBeNull();
  expect(record.data!.row_count).toBeGreaterThan(0);
  expect(record.data!.parse_mode).toBe("server");
  expect(record.data!.storage_path).toBeTruthy();
  const raw = await client.from("dpgf_rows_raw").select("payload").eq("import_id", record.data!.id).limit(1).single();
  expect(raw.error).toBeNull();
  expect(raw.data!.payload).toMatchObject({ _timax_provenance: { source_document_id: copy.documentId, source_file_name: file.name } });
  const stored = await client.storage.from("dpgf-imports").download(record.data!.storage_path!);
  expect(stored.error).toBeNull();
  expect(createHash("sha256").update(Buffer.from(await stored.data!.arrayBuffer())).digest("hex")).toBe(sha256);
  await recordEvidence(ui.army, "DOG03-reviewed-pdf", { ids, sourceSha256: sha256, importId: record.data!.id, rowCount: record.data!.row_count, changedCopyRejected: true });
});

armyTest("DOG04 intake plan copy is recoverable and removed through its source", {
  session: "army", trace: "off", tags: ["critical", "plan-center", "local"], timeout: 120_000,
}, async (ui) => {
  const { client, userId } = await requireOwnedApplication(ui);
  const ids = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-DOG04`, title: "Plan du dossier" }, ui.army);
  const project = await client.from("estimate_projects").select("id,tenant_id,name,user_id,is_archived").eq("id", ids.projectId).single();
  expect(project.error).toBeNull();
  const bytes = await readFile(path.resolve("e2e/fixtures/sample-plan.pdf"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const file = new File([bytes], "plan-fictif.pdf", { type: "application/pdf" });
  const copy = await seedStoredIntakeCopy(client, { tenantId: project.data!.tenant_id, projectId: ids.projectId, userId, file, bytes,
    classification: { classification_status: "ambiguous", document_kind: "a_classer", confidence: 0.4 } });
  await ui.app.open(`/dashboard/affaires/${ids.projectId}`);
  await ui.screen.getByRole("button", "Ouvrir les documents", { exact: true }).click();
  await ui.screen.getByRole("button", `Détails de ${file.name}`, { exact: true }).click();
  const details = ui.screen.getByRole("dialog", "Document et détails", { exact: true });
  await details.getByRole("button", "Reclasser", { exact: true }).click();
  await details.getByLabel("Nouvelle catégorie", { exact: true }).selectOption({ value: "plans" });
  await details.getByRole("button", "Valider", { exact: true }).click();
  // The document desk keeps the dialog open while classification is pending.
  await expect(details.getByRole("button", "Supprimer la copie", { exact: true })).toBeEnabled();
  await details.getByRole("button", "Fermer", { exact: true }).click();
  await expect(details).toBeHidden();
  await expect.poll(async () => (await readPlanSets(ui.browser, ids.projectId)).length, { timeout: 30_000 }).toBe(1);
  const [set] = await readPlanSets(ui.browser, ids.projectId);
  await expect.poll(async () => (await readPlanFiles(ui.browser, set.id)).length, { timeout: 30_000 }).toBe(1);
  const [plan] = await readPlanFiles(ui.browser, set.id);
  const saved = await client.from("plan_files").select("file_path,metadata").eq("id", plan.id).single();
  expect(saved.error).toBeNull();
  expect(saved.data!.metadata).toMatchObject({ source: "affaire-intake", intake_document_id: copy.documentId });
  const downloaded = await client.storage.from("plan-files").download(saved.data!.file_path);
  expect(downloaded.error).toBeNull();
  expect(createHash("sha256").update(Buffer.from(await downloaded.data!.arrayBuffer())).digest("hex")).toBe(sha256);
  const refused = await ui.browser.evaluate(async ({ setId, fileId }) => (await fetch(`/api/takeoff/plan-sets/${setId}/files/${fileId}`, { method: "DELETE" })).status,
    { setId: set.id, fileId: plan.id });
  expect(refused).toBe(409);
  await ui.screen.getByRole("dialog", "Documents du dossier", { exact: true }).getByRole("button", /^Validés/).click();
  await ui.screen.getByRole("button", `Détails de ${file.name}`, { exact: true }).click();
  await ui.screen.getByRole("button", "Supprimer la copie", { exact: true }).click();
  await ui.screen.getByRole("button", "Confirmer la suppression", { exact: true }).click();
  await expect.poll(async () => (await client.from("affaire_intake_documents").select("deleted_at").eq("id", copy.documentId).single()).data?.deleted_at ?? null, { timeout: 30_000 }).not.toBeNull();
  expect((await client.from("plan_files").select("id").eq("id", plan.id)).data).toEqual([]);
  expect((await client.storage.from("plan-files").download(saved.data!.file_path)).data).toBeNull();
  await recordEvidence(ui.army, "DOG04-intake-plan-copy", { ids, documentId: copy.documentId, setId: set.id, fileId: plan.id, sha256, directDeletionRefused: true, sourceDeletionSucceeded: true });
});
