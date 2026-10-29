import { randomUUID } from "node:crypto";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { nativeTest as test, expect, loginWithUi, localClient } from "../takeoff/native-ui";
import { buildAffaireIntakeStoragePath } from "@/lib/affaires/intake";

// Observable regression: an empty estimate exposes sending/purchasing and opening
// its documents leaves the hub. The right drawer must preserve the URL, document
// selection, focus on close and a real classification saved under the local RLS.
test("Parcours opens its real documents in a right drawer and preserves classification", {
  session: "army", trace: "off", tags: ["critical", "local"], timeout: 180_000,
}, async ({ ui: page }) => {
  await loginWithUi(page);
  const response = await page.request.post("/api/estimates", { data: {
    project: { name: `${page.army.runPrefix}-Parcours-drawer` }, version: { title: "Dossier fictif" },
  } });
  expect(response.status()).toBe(201);
  const payload = await response.json() as { data: { project: { id: string }; version: { id: string } } };
  const projectId = payload.data.project.id;
  const { client, userId } = await localClient();
  const project = await client.from("estimate_projects").select("tenant_id").eq("id", projectId).single();
  expect(project.error).toBeNull();
  const tenantId = project.data!.tenant_id;
  const uploadId = randomUUID();
  const documentId = randomUUID();
  const fileName = "Plan fictif du rez-de-chaussée — parcours.pdf";
  const storagePath = buildAffaireIntakeStoragePath({ tenantId, projectId, uploadId, documentId, fileName });
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("Plan fictif - parcours du dossier", { x: 40, y: 750, size: 16, font });
  const bytes = await pdf.save();
  expect((await client.from("affaire_intake_uploads").insert({
    id: uploadId, tenant_id: tenantId, project_id: projectId, created_by: userId,
    status: "ready", completed_at: new Date().toISOString(),
  })).error).toBeNull();
  expect((await client.from("affaire_intake_documents").insert({
    id: documentId, tenant_id: tenantId, project_id: projectId, created_by: userId,
    upload_id: uploadId, storage_path: storagePath, file_name: fileName,
    mime_type: "application/pdf", size_bytes: bytes.length, upload_status: "uploaded",
    classification_status: "ambiguous", document_kind: "plans", confidence: 0.42,
    classification_source: "heuristic", classified_at: new Date().toISOString(), issues: [],
    extracted_metadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
  })).error).toBeNull();
  expect((await client.storage.from("affaire-intake").upload(storagePath, bytes, { contentType: "application/pdf" })).error).toBeNull();

  const href = `/dashboard/affaires/${projectId}?view=overview`;
  await page.goto(href);
  await expect(page.getByRole("heading", { name: "Pilotage de l'affaire", exact: true })).toBeVisible();
  await expect(page.getByText("Finish line", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Préparer l'envoi", exact: true })).toHaveCount(0);
  await expect(page.getByText("Préparation des achats", { exact: true })).toHaveCount(0);
  const trigger = page.getByRole("button", { name: "Ouvrir les documents", exact: true });
  await trigger.click();
  const drawer = page.getByRole("dialog", { name: "Documents du dossier", exact: true });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("button", { name: fileName, exact: true })).toBeVisible();
  await drawer.getByRole("combobox", { name: `Catégorie de ${fileName}`, exact: true }).selectOption({ value: "plans" });
  await drawer.getByRole("checkbox", { name: `Sélectionner ${fileName}`, exact: true }).check();
  const geometry = await page.browser.evaluate(() => {
    const box = document.querySelector(".affaire-documents-drawer")!.getBoundingClientRect();
    return { right: box.right, height: box.height, width: box.width, viewport: [innerWidth, innerHeight], path: location.pathname + location.search };
  });
  expect(Math.abs(geometry.right - geometry.viewport[0])).toBeLessThan(2);
  expect(Math.abs(geometry.height - geometry.viewport[1])).toBeLessThan(2);
  expect(geometry.width).toBeGreaterThan(geometry.viewport[0] * 0.7);
  expect(geometry.path).toBe(href);
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("checkbox", { name: `Sélectionner ${fileName}`, exact: true })).toBeChecked();
  await drawer.getByRole("button", { name: "Valider", exact: true }).click();
  await expect(drawer.getByText("1 document enregistré.", { exact: true })).toBeVisible();
  const stored = await client.from("affaire_intake_documents").select("classification_status,document_kind")
    .eq("id", documentId).single();
  expect(stored.data).toEqual({ classification_status: "classified", document_kind: "plans" });
  await drawer.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Ouvrir les documents", exact: true }).click();
  await page.getByRole("dialog", { name: "Documents du dossier", exact: true }).getByRole("button", { name: /Validés/ }).click();
  await expect(page.getByRole("dialog", { name: "Documents du dossier", exact: true }).getByRole("button", { name: fileName, exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(`/dashboard/affaires/${projectId}?intakeDocument=${documentId}#intake`);
  const linkedDrawer = page.getByRole("dialog", { name: "Documents du dossier", exact: true });
  await expect(linkedDrawer).toBeVisible();
  await expect(linkedDrawer.getByRole("button", { name: fileName, exact: true })).toBeVisible();
  expect(await page.browser.evaluate(() => document.querySelector(".document-desk-active")?.getAttribute("data-document-id") ?? null)).toBe(documentId);
});
