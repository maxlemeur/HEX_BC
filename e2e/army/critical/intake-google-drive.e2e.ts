import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { expect } from "e2e";
import { localClient } from "../takeoff/native-ui";
import { localDriveStore } from "./google-drive-local-store";
import { relativeOutputPath } from "../local/sdk-results";
import { armyTest, createEstimateViaWizard, readEstimate, recordEvidence } from "./fixtures";

// Failure to cover: selecting a folder omits descendants or later pages, duplicates
// existing links, or lets a selection exceed the API's 20-file limit.
armyTest("DRV03 selects Drive folders across pages and preserves the 20-file limit", {
  session: "army", trace: "off", tags: ["critical", "google-drive", "local"], timeout: 120_000,
}, async (ui) => {
  const { army, app, screen, browser } = ui;
  const ids = await createEstimateViaWizard(ui, { projectName: `${army.runPrefix}-DRV03`, title: "Dossier complet" }, army);
  const folder = (id: string, name: string) => ({ id, name, mimeType: "application/vnd.google-apps.folder" });
  const file = (index: number, parent: string) => ({ id: `file_${index}`, name: `plan-${index}.pdf`, mimeType: "application/pdf", size: "100", version: "1", parents: [parent] });
  const batches: Array<Array<{ id: string; folderId?: string }>> = [];
  const account = { id: "22222222-2222-4222-8222-222222222222", email: "fixture@example.invalid", displayName: "Compte fictif", status: "active", writeEnabled: false, grantVersion: "33333333-3333-4333-8333-333333333333", connectedAt: "2026-10-29T12:00:00Z" };
  const state = { enabled: true, projectName: "Dossier complet", connections: [account], folder: null, links: [] };
  await browser.route(`**/api/affaires/${ids.projectId}/intake/google-drive`, async (route) => {
    if (route.request.method === "GET") {
      await route.fulfill({ json: { ok: true, data: state } });
      return;
    }
    const request = JSON.parse(route.request.postData ?? "{}");
    if (request.action === "list") {
      const id = request.location.folderId as string;
      const files = id === "root" ? [folder("parent", "Projet"), folder("other", "Autre")]
        : id === "parent" && !request.pageToken ? [folder("child", "Plans"), ...Array.from({ length: 10 }, (_, i) => file(i, "parent"))]
        : id === "parent" ? Array.from({ length: 10 }, (_, i) => file(i + 10, "parent"))
        : id === "other" ? [file(21, "other")]
        : [file(20, "child"), { id: "native", name: "Document Google", mimeType: "application/vnd.google-apps.document" }];
      await route.fulfill({ json: { ok: true, data: { listing: { location: request.location, folder: folder(id, id === "parent" ? "Projet" : id), files, ...(id === "parent" && !request.pageToken ? { nextPageToken: "next" } : {}) } } } });
      return;
    }
    if (request.action === "link_files") {
      batches.push(request.files);
      await route.fulfill({ json: { ok: true, data: { results: request.files.map((item: { id: string }) => ({ fileId: item.id, name: item.id, status: "linked", message: "Lien enregistré." })), uploads: [] } } });
      return;
    }
    throw new Error(`Unexpected Drive action: ${request.action}`);
  });
  await app.open(`/dashboard/affaires/${ids.projectId}`);
  await screen.getByRole("button", "Choisir dans Drive", { exact: true }).click();
  await screen.getByRole("checkbox", "Sélectionner le dossier Projet", { exact: true }).click();
  await expect(screen.getByText("21 fichier(s) sélectionné(s)", { exact: true })).toBeVisible();
  await expect(screen.getByText(/1 fichier.*ignoré/)).toBeVisible();
  await screen.getByRole("checkbox", "Sélectionner le dossier Autre", { exact: true }).click();
  await expect(screen.getByText("22 fichier(s) sélectionné(s)", { exact: true })).toBeVisible();
  await screen.getByRole("checkbox", "Sélectionner le dossier Autre", { exact: true }).click();
  await expect(screen.getByRole("button", "Lier à l’affaire", { exact: true })).toBeDisabled();
  await screen.getByRole("button", "Ouvrir le dossier Projet", { exact: true }).click();
  await screen.getByRole("button", "Ouvrir le dossier Plans", { exact: true }).click();
  await screen.getByRole("checkbox", "Sélectionner plan-20.pdf", { exact: true }).click();
  await expect(screen.getByText("20 fichier(s) sélectionné(s)", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Lier à l’affaire", { exact: true }).click();
  await expect(screen.getByText("Vos fichiers sont liés à l’affaire", { exact: true })).toBeVisible();
  expect(batches.map((batch) => batch.length)).toEqual([20]);
  expect(new Set(batches.flat().map((item) => item.id)).size).toBe(20);
  expect(batches.flat().every((item) => item.folderId === "parent")).toBe(true);
  await recordEvidence(army, "DRV03-folder-selection", { batches, scope: "Fictional Drive route; browser selection and pagination only." });
});

armyTest("DRV01 Google Drive POC stays disabled until OAuth approval and links no documents", {
  session: "army", trace: "off", tags: ["critical", "google-drive", "local"], timeout: 120_000,
}, async (ui) => {
  const { army, app, screen, browser } = ui;
  const ids = await createEstimateViaWizard(ui, { projectName: `${army.runPrefix}-DRV01`, title: "Dossier fictif Drive" }, army);
  await app.open(`/dashboard/affaires/${ids.projectId}`);
  // A fresh affaire offers Drive beside the computer in its next step.
  await screen.getByRole("button", "Choisir dans Drive", { exact: true }).click();
  await expect(screen.getByText("Connexion réelle en attente de validation OAuth pour ce POC. Aucun accès Google activé.", { exact: true })).toBeVisible();
  await expect(screen.getByRole("link", "Ajouter un compte Google", { exact: true })).toHaveCount(0);
  const blocked = await browser.evaluate(async (projectId) => {
    const call = async (body: unknown) => {
      const response = await fetch(`/api/affaires/${projectId}/intake/google-drive`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      return { status: response.status, code: (await response.json()).error?.code };
    };
    // Adding an account goes back to the affaire with an outcome code only.
    const start = await fetch(`/api/google-drive/oauth/start?returnTo=${encodeURIComponent(`/dashboard/affaires/${projectId}`)}`);
    return {
      list: await call({ action: "list", connectionId: "00000000-0000-4000-8000-000000000001", location: { kind: "folder", folderId: "root" } }),
      // A browser-held Google token is no longer part of the contract.
      token: await call({ action: "list", folderId: "root", token: "fixture-disabled-no-credential" }),
      start: new URL(start.url).search,
    };
  }, ids.projectId);
  expect(blocked).toEqual({ list: { status: 503, code: "DRIVE_DISABLED" }, token: { status: 400, code: "VALIDATION_ERROR" }, start: "?drive=disabled" });
  await browser.reload();
  await screen.getByRole("button", "Choisir dans Drive", { exact: true }).click();
  await expect(screen.getByText("Fichiers Drive liés à l’affaire", { exact: true })).toHaveCount(0);
  expect((await readEstimate(browser, ids.versionId)).items).toEqual([]);
  await recordEvidence(army, "DRV01-drive-disabled", { ids, blocked, scope: "Real local HTTP/UI only; no Google access, OAuth or linked file." });
});


armyTest("DRV02 fictional Drive links persist under real RLS without any stored copy and stay listed across visits", {
  session: "army", trace: "off", tags: ["critical", "google-drive", "local"], timeout: 120_000,
}, async (ui) => {
  const { army, app, screen, browser } = ui;
  const ids = await createEstimateViaWizard(ui, { projectName: `${army.runPrefix}-DRV02`, title: "Liens Drive fictifs" }, army);
  const { client, userId } = await localClient();
  const project = await client.from("estimate_projects").select("id,tenant_id,name,user_id,is_archived")
    .eq("id", ids.projectId).single();
  expect(project.error).toBeNull();
  const store = await localDriveStore(army.runPrefix);
  const access = { context: { supabase: client, tenantId: project.data!.tenant_id, userId }, project: project.data! } as Parameters<typeof store.linkDriveFiles>[0];
  const wrongTenant = { ...access, context: { ...access.context, tenantId: "00000000-0000-4000-8000-000000000001" } };
  // A fictional account, saved as the OAuth callback does: through the service role, for the member
  // it verified. The member cannot register an account by name, read its sealed token or call the worker's read.
  const account = { p_tenant_id: project.data!.tenant_id, p_user_id: userId, p_google_account_id: `fixture_${army.runPrefix}`,
    p_email: "drive-fixture@example.invalid", p_display_name: "Compte Drive fictif", p_refresh_token_ciphertext: "v1.fixture.sealed.token" };
  expect((await client.rpc("save_google_drive_connection", account)).error?.code).toBe("42501");
  const server = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const saved = await server.rpc("save_google_drive_connection", account);
  expect(saved.error).toBeNull();
  const connectionId = saved.data as string;
  const tokenRead = await client.rpc("google_drive_connection_secret", { p_connection_id: connectionId });
  expect(tokenRead.error).not.toBeNull();
  expect((await client.from("google_drive_connections").select("id,email,status").eq("id", connectionId)).data)
    .toEqual([{ id: connectionId, email: "drive-fixture@example.invalid", status: "active" }]);
  const folder = { id: "fixture_folder", name: "Dossier Drive fictif" };
  const file = { id: "fixture_plan", name: "plan-poc-fictif.pdf", mimeType: "application/pdf", size: "2048", version: "1", parents: [folder.id] };
  const first = await store.linkDriveFiles(access, { connectionId, files: [{ file, folder }] });
  expect(first.results.map(({ fileId, status }) => ({ fileId, status }))).toEqual([{ fileId: file.id, status: "linked" }]);
  const upload = await client.from("affaire_intake_uploads").select("status,last_error").eq("id", first.uploadId!).single();
  expect(upload.data).toEqual({ status: "queued", last_error: null });
  const documents = async () => (await client.from("affaire_intake_documents")
    .select("id,storage_path,upload_status,source_provider,drive_connection_id,drive_file_id,drive_folder_id,drive_folder_name,drive_revision,deleted_at")
    .eq("project_id", ids.projectId).order("created_at")).data!;
  const [linked] = await documents();
  expect(linked).toMatchObject({ storage_path: null, upload_status: "uploaded", source_provider: "google_drive", drive_connection_id: connectionId,
    drive_file_id: file.id, drive_folder_id: folder.id, drive_folder_name: folder.name, drive_revision: "1", deleted_at: null });
  // Selecting the same file again links nothing more.
  const replay = await store.linkDriveFiles(access, { connectionId, files: [{ file, folder }] });
  expect(replay.uploadId).toBeNull();
  expect(replay.results.map(({ status }) => status)).toEqual(["already_linked"]);
  expect(await documents()).toHaveLength(1);
  const folderLink = await store.saveDriveFolderLink(access, connectionId, { id: folder.id, name: folder.name, mimeType: "application/vnd.google-apps.folder" });
  expect(folderLink).toMatchObject({ folderId: folder.id, folderName: folder.name, connectionId, url: `https://drive.google.com/drive/folders/${folder.id}` });
  expect(await store.readDriveLinks(wrongTenant)).toEqual([]);
  expect(await store.readDriveFolderLink(wrongTenant)).toBeNull();
  // An uncertain Drive document can be opened from the review illustration before classification.
  expect((await client.from("affaire_intake_documents").update({ classification_status: "ambiguous", document_kind: "a_classer", confidence: 0.2 })
    .eq("project_id", ids.projectId)).error).toBeNull();
  expect((await client.from("affaire_intake_uploads").update({ status: "ready" }).eq("project_id", ids.projectId)).error).toBeNull();
  await app.open(`/dashboard/affaires/${ids.projectId}`);
  await expect(screen.getByRole("link", { name: `Ouvrir ${file.name} dans Google Drive`, exact: true }))
    .toHaveAttribute("href", `https://drive.google.com/file/d/${file.id}/view`);
  // No worker runs here: settle the link as the classifier would once it has read the file in Drive.
  expect((await client.from("affaire_intake_documents").update({ classification_status: "classified", document_kind: "plans", confidence: 0.9 })
    .eq("project_id", ids.projectId)).error).toBeNull();
  expect((await client.from("affaire_intake_uploads").update({ status: "ready" }).eq("project_id", ids.projectId)).error).toBeNull();
  // A Drive plan keeps one métré working copy, which the plan sync makes after reading the file with the
  // linker's account. No Google here: the member writes that copy as the sync does, a reservation then
  // its bytes, under the real RLS and Storage guards.
  const source = (await client.from("affaire_intake_documents").select("upload_id,classified_at,plan_copy_generation").eq("id", linked.id).single()).data!;
  const planSet = await client.from("plan_sets").insert({ tenant_id: project.data!.tenant_id, project_id: ids.projectId, name: "Plans import" }).select("id").single();
  expect(planSet.error).toBeNull();
  const copyId = randomUUID().replace(/^(.{14})4/, "$15");
  const copyPath = `${project.data!.tenant_id}/${planSet.data!.id}/${copyId}/plan-poc-fictif.pdf`;
  const copyBytes = new TextEncoder().encode("%PDF-1.4\n% copie de travail fictive\n%%EOF\n");
  expect((await client.from("plan_files").insert({ id: copyId, tenant_id: project.data!.tenant_id, plan_set_id: planSet.data!.id, file_path: copyPath,
    file_name: "plan-poc-fictif.pdf", file_type: "application/pdf", file_size_bytes: copyBytes.byteLength,
    metadata: { source: "affaire-intake", intake_document_id: linked.id, intake_upload_id: source.upload_id, intake_storage_path: null,
      intake_drive_file_id: file.id, intake_classified_at: source.classified_at, intake_generation: source.plan_copy_generation } })).error).toBeNull();
  expect((await client.storage.from("plan-files").upload(copyPath, copyBytes, { contentType: "application/pdf", upsert: false })).error).toBeNull();
  const hasStoredPlan = async () => (await server.rpc("affaire_has_stored_plan", { p_project_id: ids.projectId })).data;
  expect(await hasStoredPlan()).toBe(true);
  const openDriveLinks = async () => {
    await screen.getByRole("button", { name: "Google Drive", exact: true }).click();
    await screen.getByText("Fichiers Drive liés à l’affaire", { exact: true }).click();
  };
  await app.open(`/dashboard/affaires/${ids.projectId}`);
  await openDriveLinks();
  await expect(screen.getByRole("link", file.name, { exact: true })).toHaveCount(1);
  await expect(screen.getByRole("link", folder.name, { exact: true })).toBeVisible();
  // Back on the affaire later: the link and the affaire's Drive folder are still there.
  await browser.reload();
  await openDriveLinks();
  await expect(screen.getByRole("link", file.name, { exact: true })).toHaveCount(1);
  await browser.reload();
  const settleMotion = async () => browser.evaluate(async () => {
    await Promise.all(document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => undefined)));
    return true;
  });
  await screen.getByRole("group", "Afficher les documents", { exact: true }).getByRole("button", /^Tous/).click();
  await expect(screen.getByRole("button", { name: `Détails de ${file.name}`, exact: true })).toHaveCount(1);
  await browser.evaluate(() => { document.querySelector("[data-document-id]")?.scrollIntoView({ block: "center" }); return true; });
  await settleMotion();
  const dossierScreenshot = await relativeOutputPath(await app.screenshot("TI652-dossier-drive-links"));
  await screen.getByRole("button", { name: `Détails de ${file.name}`, exact: true }).click();
  await expect(screen.getByText(/Fichier lié depuis Google Drive/)).toBeVisible();
  await screen.getByText("Fichier dans Google Drive", { exact: true }).click();
  await expect(screen.getByText("Le fichier reste dans Google Drive. MergeOne conserve son lien et peut garder une copie pour le métré ou l’import DPGF. Une modification dans Drive n’est pas réanalysée automatiquement.", { exact: true })).toBeVisible();
  await expect(screen.getByText("Pour le métré, un plan PDF lié garde une copie de travail, retirée avec le lien.", { exact: true })).toBeVisible();
  await settleMotion();
  const linkScreenshot = await relativeOutputPath(await app.screenshot("TI652-document-drive-link"));
  await screen.getByRole("button", { name: "Retirer le lien", exact: true }).click();
  await expect(screen.getByText(`Le lien vers « ${file.name} » sera retiré du dossier de l’affaire, avec la copie de travail du plan pour le métré. Le fichier reste dans Google Drive. Les lignes de chiffrage et les références historiques existantes restent conservées.`, { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "Annuler", exact: true }).click();
  expect((await documents())[0].deleted_at).toBeNull();
  await screen.getByRole("button", { name: "Retirer le lien", exact: true }).click();
  await screen.getByRole("button", { name: "Confirmer le retrait", exact: true }).click();
  // The removal refreshes the dossier before the dialog closes; the hidden page behind it proves nothing.
  await expect.poll(async () => Boolean((await documents())[0].deleted_at)).toBe(true);
  await expect(screen.getByText("Retirer ce lien Google Drive de l’affaire ?", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("button", { name: `Détails de ${file.name}`, exact: true })).toHaveCount(0);
  const [tombstone] = await documents();
  expect(tombstone).toMatchObject({ storage_path: null, upload_status: "rejected", drive_file_id: file.id });
  expect(tombstone.deleted_at).toBeTruthy();
  expect(await store.readDriveLinks(access)).toEqual([]);
  // The working copy went with the link: neither its row nor its bytes remain, and the plan no longer counts.
  expect((await client.from("plan_files").select("id").eq("id", copyId)).data).toEqual([]);
  expect((await client.storage.from("plan-files").download(copyPath)).data).toBeNull();
  expect(await hasStoredPlan()).toBe(false);
  let foreignMessage = "";
  try { await store.deleteIntakeDocumentCopy(wrongTenant, linked.id); } catch (error) { foreignMessage = (error as Error).message; }
  expect(foreignMessage).toBe("Document introuvable dans cette affaire. Actualisez le dossier.");
  // The same Drive file can be linked again after its removal: a new piece, still without a copy.
  const relinked = await store.linkDriveFiles(access, { connectionId, files: [{ file, folder }] });
  expect(relinked.results.map(({ status }) => status)).toEqual(["linked"]);
  expect((await documents()).filter((document) => !document.deleted_at)).toMatchObject([{ storage_path: null, drive_file_id: file.id }]);
  // The dossier DPGF import reads a Drive piece on the server: with Drive off it says so, a removed link is gone.
  const relinkedId = (await documents()).find((document) => !document.deleted_at)!.id;
  expect((await client.from("affaire_intake_documents").update({ classification_status: "classified", document_kind: "dpgf", confidence: 0.9 })
    .eq("id", relinkedId)).error).toBeNull();
  const dpgfRead = await browser.evaluate(async ({ projectId, live, removed }) => {
    const read = async (documentId: string) => {
      const response = await fetch(`/api/affaires/${projectId}/intake/files/${documentId}`, { cache: "no-store" });
      return { status: response.status, cache: response.headers.get("cache-control"), code: (await response.json()).error?.code ?? null };
    };
    return { live: await read(live), removed: await read(removed) };
  }, { projectId: ids.projectId, live: relinkedId, removed: linked.id });
  expect(dpgfRead).toEqual({ live: { status: 503, cache: "private, no-store", code: "DRIVE_DISABLED" },
    removed: { status: 404, cache: "private, no-store", code: "NOT_FOUND" } });
  // Removing the account keeps the affaire's pieces, which then name no account.
  expect((await client.from("google_drive_connections").delete().eq("id", connectionId)).error).toBeNull();
  expect((await store.readDriveLinks(access)).map(({ source }) => source.connectionAvailable)).toEqual([false]);
  expect((await readEstimate(browser, ids.versionId)).items).toEqual([]);
  await recordEvidence(army, "DRV02-drive-links", { ids, documentIds: (await documents()).map((document) => document.id),
    dossierScreenshot, linkScreenshot, noStoredCopy: true, replayLinksOnce: true, folderRemembered: true, removalConfirmedInUi: true, relinkAfterRemoval: true, dpgfRead,
    planWorkingCopy: { countedAsPlan: true, removedWithLink: true },
    boundary: "Real local RLS and HTTP/UI. Fictional Drive metadata and sealed token; no Google or OAuth, no worker read (classification settled under owner RLS); the métré working copy is written by the member as the plan sync does, without a Drive read." });
});
