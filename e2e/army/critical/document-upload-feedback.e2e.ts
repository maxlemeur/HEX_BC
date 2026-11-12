import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, open, rm, writeFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";

import { buildAffaireIntakeStoragePath } from "@/lib/affaires/intake";
import { nativeTest as test, expect, localClient, loginWithUi, type NativeUi } from "../takeoff/native-ui";
import { recordEvidence } from "./fixtures";

const options = { session: "army", trace: "off" as const, tags: ["critical", "local"], timeout: 180_000 };
const fileName = "sample-plan.pdf";

async function createDossier(page: NativeUi) {
  await loginWithUi(page);
  const response = await page.request.post("/api/estimates", { data: {
    project: { name: `${page.army.runPrefix}-Upload-feedback` }, version: { title: "Dossier fictif" },
  } });
  expect(response.status()).toBe(201);
  const payload = await response.json() as { data: { project: { id: string } } };
  const projectId = payload.data.project.id;
  const { client, userId } = await localClient();
  const project = await client.from("estimate_projects").select("tenant_id").eq("id", projectId).single();
  expect(project.error).toBeNull();
  const tenantId = project.data!.tenant_id;
  async function integrate(documentId: string, uploadId: string, classificationStatus: "processing" | "classified" = "classified") {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = await pdf.save();
    const storagePath = buildAffaireIntakeStoragePath({ tenantId, projectId, uploadId, documentId, fileName });
    expect((await client.from("affaire_intake_uploads").insert({ id: uploadId, tenant_id: tenantId, project_id: projectId, created_by: userId, status: "ready", completed_at: new Date().toISOString() })).error).toBeNull();
    expect((await client.from("affaire_intake_documents").insert({
      id: documentId, tenant_id: tenantId, project_id: projectId, created_by: userId, upload_id: uploadId, storage_path: storagePath,
      file_name: fileName, mime_type: "application/pdf", size_bytes: bytes.length, upload_status: "uploaded", classification_status: classificationStatus,
      document_kind: "plans", confidence: .9, classification_source: "heuristic", issues: [],
      extracted_metadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
    })).error).toBeNull();
    expect((await client.storage.from("affaire-intake").upload(storagePath, bytes, { contentType: "application/pdf" })).error).toBeNull();
  }
  await integrate(randomUUID(), randomUUID());
  await page.app.open(`/dashboard/affaires/${projectId}?view=dossier`);
  await page.getByRole("button", { name: "Ajouter des pièces", exact: true }).click();
  return { projectId, client, integrate };
}

test("Document upload keeps a nonblocking loader through response, integration and analysis", options, async ({ ui: page }) => {
  const { projectId, client, integrate } = await createDossier(page);
  const uploadId = randomUUID();
  const documentId = randomUUID();
  let release = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.browser.route(`**/api/affaires/${projectId}/intake/files`, async (route) => {
    await pending;
    await route.fulfill({ json: { ok: true, data: { uploadId, files: [{ documentId, fileName, status: "uploaded", rejectionReason: null }] } } });
  });
  const addDialog = page.getByRole("dialog", { name: "Ajouter des documents", exact: true });
  await addDialog.getByLabel("Ajouter des pièces à l'affaire", { exact: true }).setInputFiles(path.resolve("e2e/fixtures/sample-plan.pdf"));
  const drawer = page.getByRole("dialog", { name: "Documents du dossier", exact: true });
  const pendingRow = drawer.getByRole("row", { name: `Ajout de ${fileName}`, exact: true });
  await expect(addDialog).not.toBeVisible();
  await expect(pendingRow.getByText("Chargement en cours…", { exact: true })).toBeVisible();
  await drawer.getByLabel("Rechercher un document", { exact: true }).fill("aucun résultat");
  await expect(pendingRow).toBeVisible();
  await drawer.getByLabel("Rechercher un document", { exact: true }).fill("");
  await expect(drawer.getByRole("button", { name: fileName, exact: true })).toBeEnabled();
  await drawer.getByRole("combobox", { name: `Catégorie de ${fileName}`, exact: true }).selectOption({ value: "cctp" });
  await drawer.getByRole("checkbox", { name: `Sélectionner ${fileName}`, exact: true }).check();
  await drawer.getByLabel("Rechercher un document", { exact: true }).fill("sample-plan");
  await drawer.getByRole("button", { name: /^Validés/ }).click();
  await expect(pendingRow).toBeVisible();
  await page.keyboard.press("Escape");
  const navigation = page.getByRole("navigation", { name: "Navigation de l'affaire", exact: true });
  await navigation.getByRole("button", { name: "Chiffrage", exact: true }).click();
  await expect(page.getByText(`${fileName} — Chargement en cours…`, { exact: true })).toBeVisible();
  await navigation.getByRole("button", { name: "Dossier", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter des pièces", exact: true }).click();
  // Reopening add must preserve both the upload and unsaved work in the desk.
  await expect(addDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pendingRow).toBeVisible();
  await expect(drawer.getByLabel("Rechercher un document", { exact: true })).toHaveValue("sample-plan");
  await expect(drawer.getByRole("button", { name: /^Validés/ })).toHaveAttribute("aria-pressed", "true");
  await drawer.getByRole("button", { name: /^Tous/ }).click();
  await expect(drawer.getByRole("combobox", { name: `Catégorie de ${fileName}`, exact: true })).toHaveValue("cctp");
  await expect(drawer.getByRole("checkbox", { name: `Sélectionner ${fileName}`, exact: true })).toBeChecked();
  // The dossier is refreshed every two seconds while a document integrates. Behind a server
  // that takes longer than that, a refresh asked before the previous one has landed keeps the
  // row on « Intégration au dossier… » for good.
  let slowedRefreshes = 0;
  const dossierPage = new RegExp(`/dashboard/affaires/${projectId}(?:\\?|$)`);
  await page.browser.route(dossierPage, async (route) => {
    if (route.request.headers.rsc === "1") {
      slowedRefreshes += 1;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    await route.fallback();
  });
  release();
  await expect(pendingRow.getByText("Intégration au dossier…", { exact: true })).toBeVisible();
  // An older stored document with this name must not finish the new upload.
  await expect(pendingRow).toBeVisible();
  await integrate(documentId, uploadId, "processing");
  await expect(pendingRow.getByText("Analyse en cours…", { exact: true })).toBeVisible({ timeout: 20_000 });
  expect(slowedRefreshes).toBeGreaterThan(0);
  await page.browser.unroute(dossierPage);
  expect((await client.from("affaire_intake_documents").update({ classification_status: "classified", classified_at: new Date().toISOString() }).eq("id", documentId)).error).toBeNull();
  await expect(pendingRow).toHaveCount(0, { timeout: 20_000 });
  await drawer.getByRole("button", { name: /^Tous/ }).click();
  await expect(drawer.getByRole("button", { name: fileName, exact: true })).toHaveCount(2);
  await recordEvidence(page.army, "document-upload-integration", { projectId, uploadId, documentId, duplicateNames: true, nonblocking: true,
    scope: "Owned local RLS/storage; controlled upload response and real server workspace refresh. No AI call." });
});

test("Document upload preserves partial rejection and concurrent network failures without blocking the dossier", options, async ({ ui: page }) => {
  // Opening the dossier checks its plans and refreshes it, because the plan integrated by
  // createDossier is new to it. An upload that started while that refresh was still in flight
  // froze the dossier on its old documents for good (runs 43124531608, 43138683467 and
  // 43145180005), so the refresh is held here until the upload has been answered.
  let refreshAsked = () => {};
  const refreshInFlight = new Promise<void>((resolve) => { refreshAsked = resolve; });
  let releaseRefresh = () => {};
  const refreshHeld = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  const anyDossierPage = /\/dashboard\/affaires\/[0-9a-f-]{36}(?:\?|$)/;
  await page.browser.route(anyDossierPage, async (route) => {
    const { headers } = route.request;
    if (headers.rsc === "1" && !headers["next-router-prefetch"] && !headers["next-router-segment-prefetch"]) {
      refreshAsked();
      await refreshHeld;
    }
    await route.fallback();
  });
  const { projectId, integrate } = await createDossier(page);
  expect(await Promise.race([
    refreshInFlight.then(() => "asked"),
    new Promise<string>((resolve) => setTimeout(() => resolve("not asked within 15 s"), 15_000)),
  ]), "refresh of the dossier after its plan check").toBe("asked");
  const uploadId = randomUUID();
  const documentId = randomUUID();
  let requests = 0;
  let release = () => {};
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.browser.route(`**/api/affaires/${projectId}/intake/files`, async (route) => {
    requests++;
    if (requests === 1) {
      await route.fulfill({ json: { ok: true, data: { uploadId, files: [
        { documentId, fileName, status: "uploaded", rejectionReason: null },
        { documentId: randomUUID(), fileName: "dpgf-minimal.csv", status: "rejected", rejectionReason: "Fichier refusé (fixture)." },
      ] } } });
    } else {
      await pending;
      await route.fulfill({ status: 503, json: { error: { message: "Transfert interrompu (fixture)." } } });
    }
  });
  const addDialog = page.getByRole("dialog", { name: "Ajouter des documents", exact: true });
  await addDialog.getByLabel("Ajouter des pièces à l'affaire", { exact: true }).setInputFiles([
    path.resolve("e2e/fixtures/sample-plan.pdf"), path.resolve("e2e/fixtures/dpgf-minimal.csv"),
  ]);
  const drawer = page.getByRole("dialog", { name: "Documents du dossier", exact: true });
  await expect(drawer.getByText("Fichier refusé (fixture).", { exact: true })).toBeVisible();
  releaseRefresh();
  await page.browser.unroute(anyDossierPage);
  await drawer.getByRole("button", { name: "Ajouter des fichiers", exact: true }).click();
  await addDialog.getByLabel("Ajouter des pièces à l'affaire", { exact: true }).setInputFiles(path.resolve("e2e/fixtures/word/intake-word.docx"));
  const secondRow = drawer.getByRole("row", { name: "Ajout de intake-word.docx", exact: true });
  await expect(secondRow.getByText("Chargement en cours…", { exact: true })).toBeVisible();
  await integrate(documentId, uploadId);
  await expect(drawer.getByRole("row", { name: `Ajout de ${fileName}`, exact: true })).toHaveCount(0, { timeout: 20_000 });
  await expect(secondRow).toBeVisible();
  release();
  await expect(secondRow.getByText("Transfert interrompu (fixture).", { exact: true })).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Ajouter des fichiers", exact: true })).toBeEnabled();
  await secondRow.getByRole("button", { name: "Masquer", exact: true }).click();
  await expect(secondRow).toHaveCount(0);
  await expect(drawer.getByText("Fichier refusé (fixture).", { exact: true })).toBeVisible();
  await recordEvidence(page.army, "document-upload-failures", { projectId, requests, partialRejectionRetained: true, concurrentIntegrationRetained: true, serverErrorVisible: true,
    uploadAnsweredDuringDossierRefresh: true });
});

// Real requests through Next's proxy: small fixtures alone never exposed its
// default 10 MiB truncation, or a selection exceeding the route's 100 MiB / 20 files.
test("Document upload accepts mixed selections above 100 MiB with 50 MiB files and rejects oversized pieces", { ...options, timeout: 240_000 }, async ({ ui: page }) => {
  const { projectId, client } = await createDossier(page);
  const directory = path.resolve(".build/intake-fixtures", page.army.runPrefix);
  await mkdir(directory, { recursive: true });
  const limit = 50 * 1024 * 1024;
  const largeNames = ["maquette-A.rvt", "maquette-B.rvt"];
  const oversized = "trop-grand.rvt";
  const notes = Array.from({ length: 21 }, (_, index) => `note-${index}.txt`);
  try {
    for (const [index, name] of [...largeNames, oversized].entries()) {
      const handle = await open(path.join(directory, name), "w");
      try {
        await handle.write(`Maquette fictive opaque ${index}`);
        await handle.truncate(limit + (name === oversized ? 1 : 0));
      } finally { await handle.close(); }
    }
    for (const name of notes) await writeFile(path.join(directory, name), `Annexe fictive ${name}`);
    const pdf = path.join(directory, "plan-selection.pdf");
    const generatedPdf = await PDFDocument.create();
    generatedPdf.addPage();
    generatedPdf.setTitle("Plan fictif sélection mixte");
    await writeFile(pdf, await generatedPdf.save());
    const workbook = path.resolve("e2e/fixtures/business/optima-plomberie-fictif.xlsx");
    const expectedNames = [...largeNames, path.basename(pdf), path.basename(workbook), ...notes].sort();
    const picker = page.getByRole("dialog", { name: "Ajouter des documents", exact: true })
      .getByLabel("Ajouter des pièces à l'affaire", { exact: true });
    await picker.setInputFiles([...largeNames, oversized, ...notes].map(name => path.join(directory, name)).concat([pdf, workbook]));
    const drawer = page.getByRole("dialog", { name: "Documents du dossier", exact: true });
    await expect(drawer.getByText(`"${oversized}" depasse 50 Mo.`, { exact: true })).toBeVisible();
    const documents = async () => {
      const result = await client.from("affaire_intake_documents").select("id,file_name,size_bytes,upload_status,upload_id,storage_path")
        .eq("project_id", projectId).neq("file_name", fileName);
      if (result.error) throw new Error(result.error.code);
      return result.data;
    };
    // Assert persisted originals before asynchronous classification finishes.
    await expect.poll(async () => {
      const found = await documents();
      return found.length === expectedNames.length && found.every(doc => doc.upload_status === "uploaded" && doc.storage_path);
    }, { timeout: 120_000 }).toBe(true);
    const all = await client.from("affaire_intake_documents").select("id,file_name,size_bytes,upload_status,upload_id,storage_path").eq("project_id", projectId);
    expect(all.error).toBeNull();
    const uploaded = all.data!.filter(doc => largeNames.includes(doc.file_name) || notes.includes(doc.file_name) || doc.file_name === path.basename(workbook) || doc.file_name === path.basename(pdf));
    expect(uploaded.map(doc => doc.file_name).sort()).toEqual(expectedNames);
    const additions = uploaded.filter(doc => doc.file_name !== fileName);
    expect(additions.every(doc => doc.upload_status === "uploaded" && doc.storage_path)).toBe(true);
    expect(additions.filter(doc => largeNames.includes(doc.file_name)).map(doc => doc.size_bytes)).toEqual([limit, limit]);
    expect(new Set(additions.map(doc => doc.upload_id)).size).toBe(3);
    expect(all.data!.some(doc => doc.file_name === oversized)).toBe(false);
    for (const name of largeNames.concat(notes, path.basename(workbook))) {
      await expect(drawer.getByRole("button", { name: `Détails de ${name}`, exact: true })).toBeVisible({ timeout: 30_000 });
    }
    await page.browser.reload();
    await page.app.open(`/dashboard/affaires/${projectId}?intakeDocument=${additions[0].id}#intake`);
    await expect(page.getByRole("dialog", { name: "Documents du dossier", exact: true })
      .getByRole("button", { name: `Détails de ${largeNames[0]}`, exact: true })).toBeVisible();
    await recordEvidence(page.army, "mixed-upload-large-selection", { projectId, files: additions, expectedNames,
      maxFileBytes: limit, oversizedRejected: true, realProxyAndStorage: true, batchCount: 3 });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Document upload continues remaining batches after an earlier batch fails", options, async ({ ui: page }) => {
  const { projectId, client } = await createDossier(page);
  const directory = path.resolve(".build/intake-fixtures", page.army.runPrefix);
  await mkdir(directory, { recursive: true });
  const names = Array.from({ length: 21 }, (_, index) => `annexe-${index}.txt`);
  let requests = 0;
  await page.browser.route(`**/api/affaires/${projectId}/intake/files`, async (route) => {
    requests++;
    if (requests === 1) await route.fulfill({ status: 503, json: { error: { message: "Premier lot interrompu (fixture)." } } });
    else await route.fallback();
  });
  try {
    for (const name of names) await writeFile(path.join(directory, name), `Annexe fictive ${name}`);
    await page.getByRole("dialog", { name: "Ajouter des documents", exact: true })
      .getByLabel("Ajouter des pièces à l'affaire", { exact: true }).setInputFiles(names.map(name => path.join(directory, name)));
    const drawer = page.getByRole("dialog", { name: "Documents du dossier", exact: true });
    for (const name of names.slice(0, 20)) {
      await expect(drawer.getByRole("row", { name: `Ajout de ${name}`, exact: true })
        .getByText("Premier lot interrompu (fixture).", { exact: true })).toBeVisible();
    }
    await expect.poll(async () => {
      const result = await client.from("affaire_intake_documents").select("file_name,upload_status,storage_path")
        .eq("project_id", projectId).neq("file_name", fileName);
      if (result.error) throw new Error(result.error.code);
      return result.data;
    }, { timeout: 30_000 }).toEqual([{ file_name: names[20], upload_status: "uploaded", storage_path: expect.any(String) }]);
    expect(requests).toBe(2);
    await expect(drawer.getByRole("button", { name: `Détails de ${names[20]}`, exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(drawer.getByRole("button", { name: "Ajouter des fichiers", exact: true })).toBeEnabled();
    await recordEvidence(page.army, "mixed-upload-partial-batch-failure", { projectId, requests, failedFiles: names.slice(0, 20), successfulFile: names[20],
      boundary: "First response simulated 503; second batch uses real route and Storage." });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
