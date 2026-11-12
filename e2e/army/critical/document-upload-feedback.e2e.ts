import { randomUUID } from "node:crypto";
import path from "node:path";
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
  // that takes longer than that, a refresh asked before the previous one has landed kept the
  // row on « Intégration au dossier… » for good (runs 43124531608 and 43138683467).
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
  const { projectId, integrate } = await createDossier(page);
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
  await recordEvidence(page.army, "document-upload-failures", { projectId, requests, partialRejectionRetained: true, concurrentIntegrationRetained: true, serverErrorVisible: true });
});
