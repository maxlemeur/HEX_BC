import { randomUUID } from "node:crypto";
import path from "node:path";
import { PDFDocument } from "pdf-lib";

import { buildAffaireIntakeStoragePath } from "@/lib/affaires/intake";
import { nativeTest as test, expect, localClient, loginWithUi, type NativeUi } from "../takeoff/native-ui";
import { recordEvidence } from "./fixtures";

// TI-722: the affaire page refreshed itself while documents were added or analysed (every 2 s for an
// upload, every 5 s in the documents for up to 2 minutes, once after the plan check). Next 16 hands
// a refresh's data to the router as it streams, and the router shows its updates in order: what a
// save brings to the screen (its saved state, the end of a « Enregistrement… » transition) waited
// until the refresh in flight had landed, on CI for 3 to 9 s. Here every refresh of the page is held
// until the end: the saved state, and the documents the page waits for, must not need any of them.
const options = { session: "army", trace: "off" as const, tags: ["critical", "local"], timeout: 180_000 };

type Kind = "plans" | "cctp";
type Status = "processing" | "classified";

async function createDossier(page: NativeUi, caseId: string) {
  await loginWithUi(page);
  const response = await page.request.post("/api/estimates", { data: {
    project: { name: `${page.army.runPrefix}-${caseId}` }, version: { title: "Dossier fictif" },
  } });
  expect(response.status()).toBe(201);
  const payload = await response.json() as { data: { project: { id: string } } };
  const projectId = payload.data.project.id;
  const { client, userId } = await localClient();
  const project = await client.from("estimate_projects").select("tenant_id").eq("id", projectId).single();
  expect(project.error).toBeNull();
  const tenantId = project.data!.tenant_id;
  const uploads = new Set<string>();
  async function integrate(input: { documentId: string; uploadId: string; fileName: string; kind: Kind; status: Status }) {
    const pdf = await PDFDocument.create();
    pdf.addPage();
    const bytes = await pdf.save();
    const storagePath = buildAffaireIntakeStoragePath({ tenantId, projectId, uploadId: input.uploadId, documentId: input.documentId, fileName: input.fileName });
    if (!uploads.has(input.uploadId)) {
      expect((await client.from("affaire_intake_uploads").insert({ id: input.uploadId, tenant_id: tenantId, project_id: projectId, created_by: userId,
        status: "ready", completed_at: new Date().toISOString() })).error).toBeNull();
      uploads.add(input.uploadId);
    }
    expect((await client.from("affaire_intake_documents").insert({
      id: input.documentId, tenant_id: tenantId, project_id: projectId, created_by: userId, upload_id: input.uploadId, storage_path: storagePath,
      file_name: input.fileName, mime_type: "application/pdf", size_bytes: bytes.length, upload_status: "uploaded", classification_status: input.status,
      document_kind: input.kind, confidence: .9, classification_source: "heuristic", issues: [],
      extracted_metadata: { projectName: null, clientName: null, deadlineAt: null, detectedLots: [], detectedVariants: [] },
    })).error).toBeNull();
    expect((await client.storage.from("affaire-intake").upload(storagePath, bytes, { contentType: "application/pdf" })).error).toBeNull();
  }
  async function classified(documentId: string) {
    expect((await client.from("affaire_intake_documents").update({ classification_status: "classified", classified_at: new Date().toISOString() })
      .eq("id", documentId)).error).toBeNull();
  }
  async function source(documentId: string) {
    const result = await client.from("affaire_intake_documents").select("classification_source").eq("id", documentId).single();
    expect(result.error).toBeNull();
    return result.data!.classification_source;
  }
  return { projectId, integrate, classified, source };
}

// Holds every refresh of the affaire page (a GET carrying the RSC header, prefetches aside) asked
// once start() has been called, and counts the dossier reads, which go through the application's
// API instead of the router. Next applies a history.pushState of the page (the hub opens its
// drawer that way) by preempting the router action in flight: a refresh held before it would no
// longer stand in front of the save, so a journey starts holding once the page has settled.
async function holdPageRefreshes(page: NativeUi, projectId: string) {
  const affairePage = new RegExp(`/dashboard/affaires/${projectId}(?:\\?|$)`);
  const dossierRead = new RegExp(`/api/affaires/${projectId}/intake(?:\\?|$)`);
  const held: string[] = [];
  const forwarded: Promise<void>[] = [];
  let reads = 0;
  let holding = false;
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => { release = resolve; });
  await page.browser.route(affairePage, async (route) => {
    const { headers, method } = route.request;
    if (!holding || method !== "GET" || headers.rsc !== "1" || headers["next-router-prefetch"] || headers["next-router-segment-prefetch"]) return route.fallback();
    held.push(route.request.url);
    // The campaign's own route (restrictCriticalBrowser) still decides once the request is released.
    const handed = released.then(() => route.fallback());
    forwarded.push(handed);
    await handed;
  });
  await page.browser.route(dossierRead, async (route) => {
    if (holding && route.request.method === "GET") reads += 1;
    await route.fallback();
  });
  return {
    start() { holding = true; },
    held,
    reads: () => reads,
    // The page asked the server for news: through a refresh on main, through a dossier read once fixed.
    polled: () => expect.poll(() => held.length + reads, { timeout: 15_000 }).toBeGreaterThan(0),
    async stop() {
      release();
      await Promise.allSettled(forwarded);
      await page.browser.unroute(affairePage);
      await page.browser.unroute(dossierRead);
    },
  };
}

test("POLL01 a document saved while the documents follow an analysis never waits behind a refresh", options, async ({ ui: page }) => {
  const { projectId, integrate, classified, source } = await createDossier(page, "POLL01");
  const saved = { documentId: randomUUID(), fileName: "cctp-lot-plomberie.pdf" };
  const analysed = { documentId: randomUUID(), fileName: "plan-niveau-1.pdf" };
  await integrate({ ...saved, uploadId: randomUUID(), kind: "cctp", status: "classified" });
  // A document still in analysis keeps the documents asking for news. It belongs to a later upload:
  // a document cannot be classified while its own upload still has documents in analysis.
  await integrate({ ...analysed, uploadId: randomUUID(), kind: "plans", status: "processing" });
  const hold = await holdPageRefreshes(page, projectId);
  hold.start();
  try {
    await page.app.open(`/dashboard/affaires/${projectId}?view=documents`);
    const desk = page.getByRole("region", { name: "Dossier de consultation", exact: true });
    await expect(desk.getByRole("button", { name: /^En cours/ })).toBeVisible();
    await hold.polled();
    const heldBeforeSave = hold.held.length;
    await desk.getByRole("button", { name: "Valider", exact: true }).click();
    await expect(desk.getByText("1 document enregistré.", { exact: true })).toBeVisible();
    await expect(desk.getByRole("button", { name: "Validés 1", exact: true })).toBeVisible();
    expect(await source(saved.documentId)).toBe("manual");
    // The end of the analysis reaches the screen while every refresh is still held.
    await classified(analysed.documentId);
    await expect(desk.getByRole("button", { name: /^En cours/ })).toHaveCount(0);
    await expect(desk.getByRole("button", { name: analysed.fileName, exact: true })).toBeVisible();
    expect(hold.reads()).toBeGreaterThan(0);
    // Nothing refreshed the router: neither the polling, nor the plan check, nor the save.
    expect(hold.held).toEqual([]);
    await recordEvidence(page.army, "POLL01-save-during-document-analysis", { projectId, heldBeforeSave, heldTotal: hold.held.length, dossierReads: hold.reads(),
      boundary: "Owned local RLS/storage; every RSC refresh of the affaire page held in the browser; the save is a real Server Action. No AI call." });
  } finally {
    await hold.stop();
  }
});

test("POLL02 a document saved while an upload integrates never waits behind a refresh", options, async ({ ui: page }) => {
  const { projectId, integrate, classified, source } = await createDossier(page, "POLL02");
  const saved = { documentId: randomUUID(), fileName: "cctp-lot-chauffage.pdf" };
  await integrate({ ...saved, uploadId: randomUUID(), kind: "cctp", status: "classified" });
  const added = { documentId: randomUUID(), uploadId: randomUUID(), fileName: "sample-plan.pdf" };
  await page.browser.route(`**/api/affaires/${projectId}/intake/files`, (route) => route.fulfill({ json: { ok: true, data: { uploadId: added.uploadId,
    files: [{ documentId: added.documentId, fileName: added.fileName, status: "uploaded", rejectionReason: null }] } } }));
  const hold = await holdPageRefreshes(page, projectId);
  try {
    await page.app.open(`/dashboard/affaires/${projectId}?view=dossier`);
    await page.getByRole("button", { name: "Ajouter des pièces", exact: true }).click();
    await page.getByRole("dialog", { name: "Ajouter des documents", exact: true })
      .getByLabel("Ajouter des pièces à l'affaire", { exact: true }).setInputFiles(path.resolve("e2e/fixtures/sample-plan.pdf"));
    const drawer = page.getByRole("dialog", { name: "Documents du dossier", exact: true });
    const pendingRow = drawer.getByRole("row", { name: `Ajout de ${added.fileName}`, exact: true });
    await expect(pendingRow.getByText("Intégration au dossier…", { exact: true })).toBeVisible();
    hold.start();
    await hold.polled();
    const heldBeforeSave = hold.held.length;
    await drawer.getByRole("button", { name: "Valider", exact: true }).click();
    await expect(drawer.getByText("1 document enregistré.", { exact: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Validés 1", exact: true })).toBeVisible();
    expect(await source(saved.documentId)).toBe("manual");
    // The integration and the analysis of the upload reach the screen while every refresh is still held.
    await integrate({ ...added, kind: "plans", status: "processing" });
    await expect(pendingRow.getByText("Analyse en cours…", { exact: true })).toBeVisible();
    await classified(added.documentId);
    await expect(pendingRow).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: added.fileName, exact: true })).toBeVisible();
    expect(hold.reads()).toBeGreaterThan(0);
    // Nothing refreshed the router: neither the polling, nor the upload, nor the save.
    expect(hold.held).toEqual([]);
    await recordEvidence(page.army, "POLL02-save-during-upload-integration", { projectId, heldBeforeSave, heldTotal: hold.held.length, dossierReads: hold.reads(),
      boundary: "Owned local RLS/storage; controlled upload response; every RSC refresh of the affaire page held in the browser; the save is a real Server Action. No AI call." });
  } finally {
    await hold.stop();
    await page.browser.unroute(`**/api/affaires/${projectId}/intake/files`);
  }
});
