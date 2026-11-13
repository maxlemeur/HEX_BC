import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildAffaireIntakeStoragePath } from "@/lib/affaires/intake";
import { nativeTest as test, expect, localClient, loginWithUi } from "../takeoff/native-ui";
import { recordEvidence } from "./fixtures";

test("Intake content identity prevents batch, repeated, legacy and concurrent duplicates", {
  session: "army", tags: ["critical", "local"], timeout: 180_000,
}, async ({ ui: page }) => {
  await loginWithUi(page);
  const created = await page.request.post("/api/estimates", { data: {
    project: { name: `${page.army.runPrefix}-Content-identity` }, version: { title: "Dossier fictif" },
  } });
  expect(created.status()).toBe(201);
  const { data: { project: { id: projectId } } } = await created.json() as { data: { project: { id: string } } };
  const { client, userId } = await localClient();
  const documents = async () => {
    const result = await client.from("affaire_intake_documents").select("id,file_name,content_sha256,upload_status,storage_path")
      .eq("project_id", projectId).is("deleted_at", null);
    expect(result.error).toBeNull();
    return result.data!;
  };
  const content = "Courrier fictif pour une intervention de plomberie. Version A.";
  const changed = content.replace("Version A", "Version B");
  const payload = (name: string, text = content) => ({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
  const directory = path.resolve(".e2e/army/critical/artifacts/content-identity", page.army.runPrefix);
  const selected = [payload("courrier.txt"), payload("copie-renommee.txt"), payload("courrier.txt", changed), payload("encore-renomme.txt")];
  const paths: string[] = [];
  for (const [index, file] of selected.entries()) {
    const folder = path.join(directory, String(index));
    await mkdir(folder, { recursive: true });
    const filePath = path.join(folder, file.name);
    await writeFile(filePath, file.buffer);
    paths.push(filePath);
  }
  const refusal = "Ce document est déjà présent dans le dossier (contenu identique). Aucun nouvel exemplaire n’a été ajouté.";
  await page.app.open(`/dashboard/affaires/${projectId}?view=dossier`);
  // A real interaction fences hydration before dispatching a hidden-input change.
  await page.getByRole("button", { name: "Modifier la fiche", exact: true }).click();
  await expect(page.getByRole("button", { name: "Annuler", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  // A fresh affaire exposes its picker directly; later additions use the desk dialog.
  await page.getByLabel("Ajouter des pièces à l'affaire", { exact: true }).setInputFiles(paths.slice(0, 3));
  await expect(page.getByText(`copie-renommee.txt — ${refusal}`, { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await documents()).filter(row => row.upload_status === "uploaded").length).toBe(2);
  expect((await documents()).map(row => row.file_name)).toEqual(["courrier.txt", "courrier.txt"]);
  expect(new Set((await documents()).map(row => row.content_sha256)).size).toBe(2);
  await page.getByRole("button", { name: "Ajouter des pièces", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Documents du dossier", exact: true });
  const addDialog = page.getByRole("dialog", { name: "Ajouter des documents", exact: true });
  await addDialog.getByLabel("Ajouter des pièces à l'affaire", { exact: true }).setInputFiles(paths[3]);
  await expect(drawer.getByRole("row", { name: "Ajout de encore-renomme.txt", exact: true }).getByText(refusal, { exact: true })).toBeVisible();
  expect((await documents()).length).toBe(2);

  // Pre-migration pieces have no fingerprint. Compare their stored bytes, including renamed copies.
  const uploadId = randomUUID();
  const documentId = randomUUID();
  const project = await client.from("estimate_projects").select("tenant_id").eq("id", projectId).single();
  expect(project.error).toBeNull();
  const tenantId = project.data!.tenant_id;
  const legacyContent = "Ancien courrier fictif conservé sans empreinte.";
  const bytes = Buffer.from(legacyContent);
  const storagePath = buildAffaireIntakeStoragePath({ tenantId, projectId, uploadId, documentId, fileName: "ancien.txt" });
  expect((await client.from("affaire_intake_uploads").insert({ id: uploadId, project_id: projectId, created_by: userId, status: "ready" })).error).toBeNull();
  expect((await client.from("affaire_intake_documents").insert({ id: documentId, upload_id: uploadId, created_by: userId, file_name: "ancien.txt",
    mime_type: "text/plain", size_bytes: bytes.length, storage_path: storagePath, upload_status: "uploaded", classification_status: "classified" })).error).toBeNull();
  expect((await client.storage.from("affaire-intake").upload(storagePath, bytes, { contentType: "text/plain" })).error).toBeNull();
  const legacyResponse = await page.request.post(`/api/affaires/${projectId}/intake/files`, { multipart: { files: payload("ancien-renomme.txt", legacyContent) } });
  expect(legacyResponse.status()).toBe(201);
  const legacyResult = await legacyResponse.json() as { data: { files: { documentId: string; status: string; rejectionReason: string }[] } };
  expect(legacyResult.data.files).toEqual([expect.objectContaining({ documentId, status: "rejected", rejectionReason: refusal })]);
  expect((await documents()).length).toBe(3);

  const concurrent = await page.browser.evaluate(async ({ projectId }) => {
    return Promise.all(["parallel-a.txt", "parallel-b.txt"].map(async name => {
      const body = new FormData();
      body.append("files", new Blob(["Contenu fictif simultané distinct."], { type: "text/plain" }), name);
      const response = await fetch(`/api/affaires/${projectId}/intake/files`, { method: "POST", body });
      return { status: response.status, body: await response.json() };
    }));
  }, { projectId });
  expect(concurrent.map(result => result.status)).toEqual([201, 201]);
  expect(concurrent.map(result => result.body.data.files[0].status).sort()).toEqual(["rejected", "uploaded"]);
  expect((await documents()).length).toBe(4);
  expect((await documents()).filter(row => row.content_sha256 === createHash("sha256").update("Contenu fictif simultané distinct.").digest("hex"))).toHaveLength(1);
  // An interrupted pre-Storage reservation must not prevent every later retry.
  const interruptedId = randomUUID();
  const interruptedContent = "Transfert fictif interrompu avant le stockage.";
  const interruptedHash = createHash("sha256").update(interruptedContent).digest("hex");
  expect((await client.from("affaire_intake_documents").insert({ id: interruptedId, upload_id: uploadId, created_by: userId, file_name: "interrompu.txt",
    mime_type: "text/plain", size_bytes: Buffer.byteLength(interruptedContent), storage_path: `${storagePath}-interrupted`,
    content_sha256: interruptedHash, upload_status: "pending", classification_status: "queued",
    created_at: new Date(Date.now() - 60 * 60_000).toISOString(),
  })).error).toBeNull();
  const retried = await page.request.post(`/api/affaires/${projectId}/intake/files`, { multipart: { files: payload("repris.txt", interruptedContent) } });
  expect(retried.status()).toBe(201);
  expect((await retried.json() as { data: { files: { status: string }[] } }).data.files[0].status).toBe("uploaded");
  const interrupted = (await documents()).find(row => row.id === interruptedId)!;
  expect(interrupted.upload_status).toBe("rejected");
  const lateWriter = await client.from("affaire_intake_documents").update({ upload_status: "uploaded" })
    .eq("id", interruptedId).eq("upload_status", "pending").select("id").single();
  expect(lateWriter.error).not.toBeNull();
  expect(lateWriter.data).toBeNull();
  expect((await documents()).filter(row => row.content_sha256 === interruptedHash && row.upload_status === "uploaded")).toHaveLength(1);
  await recordEvidence(page.army, "intake-content-identity", { projectId, batch: true, renamed: true, differentBytesSameName: true,
    repeated: true, legacy: true, concurrent: true, interruptedTransfer: true, uploadedDocumentCount: 5, scope: "Owned local stack; real multipart, RLS, Storage and UI feedback." });
});
