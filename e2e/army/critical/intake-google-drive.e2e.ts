import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "e2e";
import { localClient } from "../takeoff/native-ui";
import { localDriveStore } from "./google-drive-local-store";
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
  const first = await store.persistDriveCopy(access, file, source);
  expect(first.status).toBe("imported");
  expect((await store.persistDriveCopy(access, file, source)).status).toBe("already_imported");
  // Simulate the exact lost-ack state against real Storage RLS, then rearm
  // an upload the existing worker may have finalized before transfer completed.
  const pending = await client.from("affaire_intake_documents").update({ upload_status: "pending" }).eq("id", first.documentId);
  expect(pending.error).toBeNull();
  const failedParent = await client.from("affaire_intake_uploads").update({ status: "failed", completed_at: new Date().toISOString() }).eq("id", first.uploadId);
  expect(failedParent.error).toBeNull();
  expect((await store.persistDriveCopy(access, file, source)).status).toBe("imported");
  const resumedParent = await client.from("affaire_intake_uploads").select("status,completed_at").eq("id", first.uploadId).single();
  expect(resumedParent.data).toEqual({ status: "queued", completed_at: null });
  const second = await store.persistDriveCopy(access, file, { ...source, revision: "2" });
  expect(second.documentId).not.toBe(first.documentId);
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
    await screen.getByRole("button", "Ajouter DPGF", { exact: true }).click();
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
  await recordEvidence(army, "DRV02-private-copy-provenance", { ids, documentIds: documents.data!.map((document) => document.id),
    sha256, revisions: ["1", "2"], exactStoredBytesVerified: true, replayCreatesNoCopy: true,
    boundary: "Real local RLS, Storage and HTTP/UI provenance. Fictional source metadata; no Google or OAuth, no worker extraction (classification settled under owner RLS)." });
});
