import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "e2e";
import { localClient } from "../takeoff/native-ui";
import { localDriveStore } from "./google-drive-local-store";
import { relativeOutputPath } from "../local/sdk-results";
import { armyTest, createEstimateViaWizard, readEstimate, recordEvidence } from "./fixtures";

armyTest("DRV01 Google Drive POC stays disabled until OAuth approval and imports no documents", {
  session: "army", trace: "off", tags: ["critical", "google-drive", "local"], timeout: 120_000,
}, async (ui) => {
  const { army, app, screen, browser } = ui;
  const ids = await createEstimateViaWizard(ui, { projectName: `${army.runPrefix}-DRV01`, title: "Dossier fictif Drive" }, army);
  await app.open(`/dashboard/affaires/${ids.projectId}`);
  await screen.getByText("Ajouter depuis Google Drive", { exact: true }).click();
  await expect(screen.getByText("Connexion réelle en attente de validation OAuth pour ce POC. Aucun accès Google activé.", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Connecter Google Drive", { exact: true })).toHaveCount(0);
  const blocked = await browser.evaluate(async (projectId) => {
    const response = await fetch(`/api/affaires/${projectId}/intake/google-drive`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "list", folderId: "root", token: "fixture-disabled-no-credential" }),
    });
    const payload = await response.json();
    return { status: response.status, code: payload.error?.code };
  }, ids.projectId);
  expect(blocked).toEqual({ status: 503, code: "DRIVE_DISABLED" });
  await browser.reload();
  await screen.getByText("Ajouter depuis Google Drive", { exact: true }).click();
  await expect(screen.getByText("Copies Google Drive et versions importées", { exact: true })).toHaveCount(0);
  expect((await readEstimate(browser, ids.versionId)).items).toEqual([]);
  await recordEvidence(army, "DRV01-drive-disabled", { ids, blocked, scope: "Real local HTTP/UI only; no Google access, OAuth or imported copy." });
});


armyTest("DRV02 fictional Drive copies persist in real private Storage with provenance replay and versions", {
  session: "army", trace: "off", tags: ["critical", "google-drive", "local"], timeout: 120_000,
}, async (ui) => {
  const { army, app, screen, browser } = ui;
  const ids = await createEstimateViaWizard(ui, { projectName: `${army.runPrefix}-DRV02`, title: "Copies Drive fictives" }, army);
  const { client, userId } = await localClient();
  const project = await client.from("estimate_projects").select("id,tenant_id,name,user_id,is_archived")
    .eq("id", ids.projectId).single();
  expect(project.error).toBeNull();
  const store = await localDriveStore(army.runPrefix);
  const access = { context: { supabase: client, tenantId: project.data!.tenant_id, userId }, project: project.data! } as Parameters<typeof store.persistDriveCopy>[0];
  const bytes = await readFile(path.resolve("e2e/fixtures/sample-plan.pdf"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const file = new File([bytes], "plan-poc-fictif.pdf", { type: "application/pdf" });
  const source = { provider: "google_drive" as const, folderId: "fixture_folder", fileId: "fixture_plan",
    sourceName: file.name, sourceMimeType: file.type, revision: "1", sourceModifiedTime: null,
    sourceUrl: "https://drive.google.com/file/d/fixture_plan/view", sha256, importedAt: new Date().toISOString(),
    importedBy: userId, tenantId: project.data!.tenant_id, projectId: ids.projectId };
  const lot = (revision: string) => store.driveBatchUploadId(project.data!.tenant_id, ids.projectId, [{ id: source.fileId, version: revision }]);
  const parent = async (uploadId: string) => (await client.from("affaire_intake_uploads").select("status,completed_at").eq("id", uploadId).single()).data;
  const first = await store.persistDriveCopy(access, file, source, lot("1"));
  expect(first.status).toBe("imported");
  expect(first.uploadId).toBe(lot("1"));
  // The caller arms the lot once, after its last copy: persisting a copy never queues it.
  expect(await parent(first.uploadId)).toMatchObject({ status: "failed" });
  await store.requeueDriveUpload(access, first.uploadId);
  expect(await parent(first.uploadId)).toEqual({ status: "queued", completed_at: null });
  expect((await store.persistDriveCopy(access, file, source, lot("1"))).status).toBe("already_imported");
  // Simulate the exact lost-ack state against real Storage RLS, then rearm
  // an upload the existing worker may have finalized before transfer completed.
  const pending = await client.from("affaire_intake_documents").update({ upload_status: "pending" }).eq("id", first.documentId);
  expect(pending.error).toBeNull();
  const failedParent = await client.from("affaire_intake_uploads").update({ status: "failed", completed_at: new Date().toISOString() }).eq("id", first.uploadId);
  expect(failedParent.error).toBeNull();
  expect((await store.persistDriveCopy(access, file, source, lot("1"))).status).toBe("imported");
  expect(await parent(first.uploadId)).toMatchObject({ status: "failed" });
  await store.requeueDriveUpload(access, first.uploadId);
  expect(await parent(first.uploadId)).toEqual({ status: "queued", completed_at: null });
  const second = await store.persistDriveCopy(access, file, { ...source, revision: "2" }, lot("2"));
  expect(second.documentId).not.toBe(first.documentId);
  await store.requeueDriveUpload(access, second.uploadId);
  const documents = await client.from("affaire_intake_documents").select("id,storage_path,upload_status,size_bytes")
    .eq("project_id", ids.projectId).order("id");
  expect(documents.error).toBeNull(); expect(documents.data).toHaveLength(2);
  for (const document of documents.data!) {
    expect(document.upload_status).toBe("uploaded");
    const copy = await client.storage.from("affaire-intake").download(document.storage_path!);
    expect(copy.error).toBeNull();
    expect(createHash("sha256").update(Buffer.from(await copy.data!.arrayBuffer())).digest("hex")).toBe(sha256);
  }
  const forged = await client.from("affaire_intake_events").insert({ id: randomUUID(), upload_id: second.uploadId,
    document_id: first.documentId, actor_user_id: userId, event_type: "document.uploaded", after_payload: { drive: source } });
  expect(forged.error).toBeNull();
  const history = await store.readDriveHistory(access);
  expect(history).toHaveLength(2);
  expect(history.map((entry) => entry.source.revision).sort()).toEqual(["1", "2"]);
  expect(history.every((entry) => entry.source.sha256 === sha256 && entry.source.importedBy === userId)).toBe(true);
  const wrongTenant = { ...access, context: { ...access.context, tenantId: "00000000-0000-4000-8000-000000000001" } };
  expect(await store.readDriveHistory(wrongTenant)).toEqual([]);
  // No worker runs here: settle both copies as the existing classifier would, so the
  // affaire leaves "Analyse en cours" and offers its real entry to add the missing DPGF.
  const classified = await client.from("affaire_intake_documents")
    .update({ classification_status: "classified", document_kind: "plans", confidence: 0.9 }).eq("project_id", ids.projectId);
  expect(classified.error).toBeNull();
  const openDriveHistory = async () => {
    await screen.getByText("Ajouter depuis Google Drive", { exact: true }).click();
    await screen.getByText("Copies Google Drive et versions importées", { exact: true }).click();
  };
  await app.open(`/dashboard/affaires/${ids.projectId}`);
  await openDriveHistory();
  await expect(screen.getByRole("link", file.name, { exact: true })).toHaveCount(2);
  await browser.reload();
  await openDriveHistory();
  await expect(screen.getByRole("link", file.name, { exact: true })).toHaveCount(2);
  expect((await readEstimate(browser, ids.versionId)).items).toEqual([]);
  const planSetId = randomUUID(), planFileId = randomUUID();
  const planPath = `${project.data!.tenant_id}/${planSetId}/${planFileId}/${file.name}`;
  expect((await client.from("plan_sets").insert({ id: planSetId, tenant_id: project.data!.tenant_id, project_id: ids.projectId, name: "Drive deletion fixture", created_by: userId })).error).toBeNull();
  expect((await client.from("plan_files").insert({ id: planFileId, tenant_id: project.data!.tenant_id, plan_set_id: planSetId, file_path: planPath, file_name: file.name, file_type: file.type, file_size_bytes: file.size, created_by: userId, metadata: { source: "affaire-intake", intake_document_id: second.documentId, intake_storage_path: documents.data!.find((document) => document.id === second.documentId)!.storage_path } })).error).toBeNull();
  expect((await client.storage.from("plan-files").upload(planPath, file, { contentType: file.type })).error).toBeNull();
  // Settle the same owned fixture upload before exercising real UI deletion.
  expect((await client.from("affaire_intake_uploads").update({ status: "ready" }).eq("project_id", ids.projectId)).error).toBeNull();
  await browser.reload();
  await expect(screen.getByRole("button", { name: `Détails de ${file.name}`, exact: true })).toHaveCount(2);
  await expect(screen.getByText("Dossier documentaire", { exact: false })).toBeVisible();
  const settleMotion = async () => browser.evaluate(async () => {
    await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => undefined)));
    return true;
  });
  await browser.evaluate(() => { document.querySelector("[data-document-id]")?.scrollIntoView({ block: "center" }); return true; });
  await settleMotion();
  const dossierScreenshot = await relativeOutputPath(await app.screenshot("TI652-dossier-documents"));
  await screen.getByRole("button", { name: `Détails de ${file.name}`, exact: true }).nth(1).click();
  await screen.getByText("Provenance Google Drive", { exact: true }).click();
  await expect(screen.getByText("Fichier source", { exact: true })).toBeVisible();
  await settleMotion();
  const provenanceScreenshot = await relativeOutputPath(await app.screenshot("TI652-document-provenance"));
  await screen.getByRole("button", { name: "Supprimer la copie", exact: true }).click();
  await screen.getByRole("button", { name: "Annuler", exact: true }).click();
  expect((await client.from("affaire_intake_documents").select("deleted_at").eq("id", second.documentId).single()).data?.deleted_at).toBeNull();
  await screen.getByRole("button", { name: "Supprimer la copie", exact: true }).click();
  await screen.getByRole("button", { name: "Confirmer la suppression", exact: true }).click();
  await expect(screen.getByRole("button", { name: `Détails de ${file.name}`, exact: true })).toHaveCount(1);
  const tombstone = await client.from("affaire_intake_documents").select("deleted_at,storage_path,upload_status").eq("id", second.documentId).single();
  expect(tombstone.data?.deleted_at).toBeTruthy();
  expect(tombstone.data?.storage_path).toBeNull();
  expect(tombstone.data?.upload_status).toBe("rejected");
  const removedPath = documents.data!.find((document) => document.id === second.documentId)!.storage_path!;
  expect((await client.storage.from("affaire-intake").download(removedPath)).data).toBeNull();
  expect(await store.readDriveHistory(access)).toHaveLength(1);
  expect((await client.storage.from("plan-files").download(planPath)).data).toBeNull();
  expect((await client.from("plan_files").select("id").eq("id", planFileId)).data).toEqual([]);
  await browser.reload();
  await expect(screen.getByRole("button", { name: `Détails de ${file.name}`, exact: true })).toHaveCount(1);
  // The original stored revision remains byte-identical; deletion is per copy.
  const keptPath = documents.data!.find((document) => document.id === first.documentId)!.storage_path!;
  expect((await client.storage.from("affaire-intake").download(keptPath)).error).toBeNull();
  let foreignMessage = "";
  try { await store.deleteIntakeDocumentCopy(wrongTenant, first.documentId); } catch (error) { foreignMessage = (error as Error).message; }
  expect(foreignMessage).toBe("Document introuvable dans cette affaire. Actualisez le dossier.");
  expect((await store.persistDriveCopy(access, file, { ...source, revision: "2" }, lot("2"))).status).toBe("imported");
  expect(await store.readDriveHistory(access)).toHaveLength(2);
  const restored = await client.from("affaire_intake_documents").select("storage_path").eq("id", second.documentId).single();
  expect(restored.data!.storage_path === removedPath).toBe(false);
  expect((await client.storage.from("affaire-intake").download(removedPath)).data).toBeNull();
  expect((await client.storage.from("affaire-intake").download(restored.data!.storage_path!)).error).toBeNull();
  await recordEvidence(army, "DRV02-private-copy-provenance", { ids, documentIds: documents.data!.map((document) => document.id),
    dossierScreenshot, provenanceScreenshot, sha256, revisions: ["1", "2"], exactStoredBytesVerified: true, replayCreatesNoCopy: true, deletionConfirmedInStorageAndUi: true, reimportAfterDeletion: true,
    boundary: "Real local RLS, Storage and HTTP/UI provenance. Fictional source metadata; no Google or OAuth, no worker extraction (classification settled under owner RLS)." });
});
