import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { credentials, expect, secrets, type App, type Screen } from "e2e";
import type { Browser } from "@e2e-dev/web";

import { apiRequest, createEstimateViaWizard, readEstimate, setLineCoreValues, type ArmyItem, type ArmyState } from "../critical/fixtures";
import { admitCollectedReconciliation, admitCollectedResendDecision, offerTest, recordOfferEvidence } from "./resend-portal-fixtures";
import { expireOwnedCollectedPortal, observeOwnedOffer } from "./offer-emission-state";

// Failure modes precede this harness in docs/testing/offer-emission-business-cases.md.
const options = { session: "army", trace: "off" as const, tags: ["resend-portal"], timeout: 360000 };
type OfferUi = { app: App; screen: Screen; browser: Browser; army: ArmyState };
type Receipt = { id: string; pdf: { sha256: string; bytes: number }; delivery: string };
type Packet = { id: string; payload: { to: string | string[]; subject: string; html: string; text: string; attachments: { filename: string; content: string }[] } };
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const totals = (version: Record<string, unknown>) => [version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents];

function collectorDirectory() {
  const configured = process.env.E2E_OFFER_COLLECTOR_DIRECTORY;
  if (!configured) throw new Error("Explicit private collector directory required.");
  return path.resolve(configured, "receipts");
}

async function receiptNames() {
  return (await readdir(collectorDirectory())).filter((name) => /^[a-f0-9]{64}$/.test(name)).sort();
}

async function collected(messageId: string) {
  let match: { directory: string; receipt: Receipt } | undefined;
  for (const name of await receiptNames()) {
    const directory = path.join(collectorDirectory(), name);
    const receipt = JSON.parse(await readFile(path.join(directory, "public/receipt.json"), "utf8")) as Receipt;
    if (receipt.id === messageId) {
      if (match) throw new Error("Duplicate provider ID in collector.");
      match = { directory, receipt };
    }
  }
  if (!match) throw new Error("Successful app response has no committed local receipt.");
  const packet = JSON.parse(await readFile(path.join(match.directory, "private/payload.json"), "utf8")) as Packet;
  const pdf = await readFile(path.join(match.directory, "private/attachment.pdf"));
  expect(packet.id).toBe(messageId);
  expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  expect(digest(pdf)).toBe(match.receipt.pdf.sha256);
  expect(digest(Buffer.from(packet.payload.attachments[0].content, "base64"))).toBe(match.receipt.pdf.sha256);
  expect(match.receipt.delivery).toBe("local-collection-only");
  const links = [...packet.payload.html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .filter((link) => link[2].replace(/<[^>]*>/g, "").trim() === "Consulter le devis");
  expect(links.length).toBe(1);
  const portalUrl = links[0][1].replace(/&amp;/g, "&");
  // Raw HTML, URL, token and PDF remain private; public witnesses expose hashes/booleans.
  return { ...match, packet, pdf, portalUrl };
}

async function prepare(ui: OfferUi, caseId: string) {
  let originalTerms: { title: string; version: number } | null = null;
  let requestedPdfLayout: Record<string, unknown> | null = null;
  const originalName = `${ui.army.runPrefix}-${caseId}-ORIGINAL`;
  const ids = await createEstimateViaWizard(ui, { projectName: originalName, title: `${caseId} émission réelle` }, ui.army);
  const itemUrl = new URL(`/api/estimates/${ids.versionId}/items`, ui.app.baseUrl!).href;
  const [parentResponse] = await Promise.all([
    ui.browser.waitForResponse(itemUrl, { timeout: 60000 }),
    ui.screen.getByTestId("estimate-editor-add-root-section-button").click(),
  ]);
  expect(parentResponse.status).toBe(201);
  const parent = await parentResponse.json<{ ok: boolean; data: { item: ArmyItem } }>();
  expect(parent.ok).toBe(true);
  await expect(ui.browser.locator(`[data-estimate-item-id="${parent.data.item.id}"]`)).toHaveCount(1);
  const add = ui.screen.getByRole("button", "Ajouter dans Nouveau lot", { exact: true });
  await expect(add).toBeEnabled();
  await add.click();
  const [lineResponse] = await Promise.all([
    ui.browser.waitForResponse(itemUrl, { timeout: 60000 }),
    ui.screen.getByTestId("estimate-section-add-line-button").click(),
  ]);
  expect(lineResponse.status).toBe(201);
  const line = await lineResponse.json<{ ok: boolean; data: { item: ArmyItem } }>();
  expect(line.data.item.parent_id).toBe(parent.data.item.id);
  const title = `${ui.army.runPrefix}-${caseId}-prestation`;
  await ui.screen.getByTestId("estimate-line-title-input").fill(title);
  await ui.browser.keyboard.press("Tab");
  await ui.screen.getByLabel(`Unité pour ${title}`, { exact: true }).fill("u");
  await ui.browser.keyboard.press("Tab");
  await setLineCoreValues(ui, title, { quantity: "1", unitPriceHt: "20.00" });
  await ui.browser.keyboard.press("Control+s");
  await expect.poll(async () => totals((await readEstimate(ui.browser, ids.versionId)).version), { timeout: 45000 }).toEqual([2000, 400, 2400]);
  await expect(ui.screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/^(À jour|Sauvegardé)$/);
  const baseline = await readEstimate(ui.browser, ids.versionId);
  // Full owner API rows contain private costs/roles. Retain only the commercial
  // witness here, including when a later public-portal privacy assertion fails.
  await recordOfferEvidence(ui.army, `${caseId}-prepared`, { ids, originalName,
    versionStatus: baseline.version.status, totals: totals(baseline.version),
    lineId: line.data.item.id, lineTitle: title, quantity: 1, unit: "u" });
  await ui.app.open(`/dashboard/estimates/${ids.versionId}`);
  await expect(ui.screen.getByRole("button", "Envoyer par email", { exact: true })).toBeVisible();
  if (caseId !== "OF0L" && !caseId.startsWith("PDFL")) {
    await ui.app.open(`/dashboard/affaires/${ids.projectId}`);
    await ui.screen.getByRole("button", "Préparer le PDF", { exact: true }).click();
    const layout = ui.screen.getByRole("dialog", "Préparer le devis PDF", { exact: true });
    await expect(layout).toBeVisible();
    const endpoint = new URL(`/api/estimates/${ids.versionId}/pdf?force=1`, ui.app.baseUrl!).href;
    if (caseId === "OF03") {
      const configuration = await apiRequest<{ ok: boolean; data: { terms: { available: boolean; title: string | null; version: number | null } } }>(
        ui.browser, "GET", `/api/estimates/${ids.versionId}/pdf/layout`,
      );
      expect(configuration.status).toBe(200);
      expect(configuration.body.ok).toBe(true);
      if (configuration.body.data.terms.available !== true || !configuration.body.data.terms.title
        || typeof configuration.body.data.terms.version !== "number") {
        throw new Error("OF03 missing prerequisite: available original CGV with a title/version.");
      }
      originalTerms = { title: configuration.body.data.terms.title, version: configuration.body.data.terms.version };
      await layout.getByRole("button", /Devis détaillé/).click();
      const includeTerms = layout.getByRole("checkbox", /Joindre les CGV/);
      await expect.poll(async () => (await includeTerms.isChecked()) || !(await includeTerms.isDisabled()), { timeout: 30000 }).toBe(true);
      if (!(await includeTerms.isChecked())) await includeTerms.check();
      await expect(includeTerms).toBeChecked();
      await ui.browser.route(endpoint, async (route) => {
        if (route.request.method === "POST") {
          const payload = JSON.parse(route.request.postData ?? "null") as { layout?: Record<string, unknown> } | null;
          requestedPdfLayout = payload?.layout ?? null;
        }
        await route.fallback();
      });
    }
    const [generation] = await Promise.all([ui.browser.waitForResponse(endpoint, { timeout: 120000 }),
      layout.getByRole("button", "Générer et télécharger", { exact: true }).click()]);
    expect([200, 202].includes(generation.status)).toBe(true);
    await expect.poll(async () => ui.browser.evaluate(async (id) => {
      const response = await fetch(`/api/estimates/${id}/pdf?format=json`, { credentials: "same-origin" });
      const body = await response.json();
      return response.status === 200 && body.ok === true && body.data?.status === "ready";
    }, ids.versionId), { timeout: 120000 }).toBe(true);
    if (caseId === "OF03") {
      await ui.browser.unroute(endpoint);
      expect(requestedPdfLayout).toMatchObject({ preset: "client_detailed", detailLevel: "lines", priceMode: "unit_and_total", includeTerms: true });
    }
    await recordOfferEvidence(ui.army, `${caseId}-pdf-prerequisite`, { versionId: ids.versionId, generationStatus: generation.status, ready: true,
      source: "actual affaire PDF preparation UI", originalTerms, requestedPdfLayout });
    await expect(layout).not.toBeVisible();
    await ui.app.open(`/dashboard/estimates/${ids.versionId}`);
    await expect(ui.screen.getByRole("button", "Envoyer par email", { exact: true })).toBeVisible();
  }
  return { ids, originalName, baseline, originalTerms, requestedPdfLayout };
}

async function send(ui: OfferUi, caseId: string, versionId: string, resend = false) {
  const before = await receiptNames();
  const endpoint = new URL(`/api/estimates/${versionId}/send`, ui.app.baseUrl!).href;
  let sendPosts = 0;
  await ui.browser.route(endpoint, async (route) => {
    if (route.request.method === "POST") sendPosts += 1;
    await route.fallback();
  });
  const open = ui.screen.getByRole("button", resend ? "Renvoyer par email" : "Envoyer par email", { exact: true });
  await open.click();
  const modal = ui.screen.getByRole("dialog", "Envoyer le devis par email", { exact: true });
  await expect(modal).toBeVisible();
  await modal.getByRole("button", "Annuler", { exact: true }).click();
  expect(sendPosts).toBe(0);
  expect(await receiptNames()).toEqual(before);
  await recordOfferEvidence(ui.army, `${caseId}-cancel-${resend ? "resend" : "initial"}`, { beforeReceipts: before.length, afterReceipts: before.length, sendPosts });
  await open.click();
  await modal.getByLabel("Destinataire *", { exact: true }).fill(`army-${caseId.toLowerCase()}@offer.invalid`);
  await modal.getByLabel("Objet *", { exact: true }).fill(`${caseId} offre commerciale`);
  await modal.getByLabel("Message *", { exact: true }).fill("Veuillez consulter notre proposition et son PDF contractuel.");
  const networkFile = process.env.E2E_OFFER_NETWORK_LOG;
  if (!networkFile) throw new Error("App preload network witness required before confirmation.");
  const networkEntries = JSON.parse(`[${(await readFile(networkFile, "utf8")).trim().split(/\r?\n/).join(",")}]`) as { kind: string; pid: number; allowed: boolean; role: string }[];
  const installed = networkEntries.filter((entry) => entry.kind === "guard-installed" && entry.pid !== process.pid);
  await recordOfferEvidence(ui.army, `${caseId}-preload-${resend ? "resend" : "initial"}`, { installed, beforeSendPosts: sendPosts });
  expect(installed.length > 0).toBe(true);
  const [response] = await Promise.all([
    ui.browser.waitForResponse(endpoint, { timeout: 120000 }),
    modal.getByRole("button", "Envoyer", { exact: true }).click(),
  ]);
  const reply = await response.json<{ ok: boolean; data?: { message_id: string }; error?: { code: string; message: string; details?: unknown } }>();
  const state = await readEstimate(ui.browser, versionId);
  const networkAfter = JSON.parse(`[${(await readFile(networkFile, "utf8")).trim().split(/\r?\n/).join(",")}]`) as { kind: string; pid: number; allowed: boolean; role: string }[];
  await recordOfferEvidence(ui.army, `${caseId}-send-${resend ? "resend" : "initial"}`, {
    responseStatus: response.status, ok: reply.ok, errorCode: reply.error?.code ?? null,
    providerError: reply.error?.details ?? null, sendPosts, receiptCountBefore: before.length,
    receiptCountAfter: (await receiptNames()).length, versionStatus: state.version.status,
    totals: totals(state.version), collectorCalls: networkAfter.filter((entry) => entry.role === "collector"),
  });
  // Preserve the actual precondition failure before asserting; no seeded sent/token.
  expect(response.status).toBe(200);
  expect(reply.ok).toBe(true);
  expect(sendPosts).toBe(1);
  expect(state.version.status).toBe("sent");
  expect(totals(state.version)).toEqual([2000, 400, 2400]);
  const result = await collected(reply.data!.message_id);
  const pdfState = await ui.browser.evaluate(async (id) => {
    const response = await fetch(`/api/estimates/${id}/pdf?format=json`, { credentials: "same-origin" });
    const body = await response.json();
    return { status: response.status, body };
  }, versionId) as { status: number; body: { ok: boolean; data: { status: string; sha256_hash: string } } };
  await recordOfferEvidence(ui.army, `${caseId}-receipt-${resend ? "resend" : "initial"}`, {
    receipt: result.receipt, pdfState, portalPathKind: new URL(result.portalUrl).pathname.startsWith("/portal/") ? "portal" : "other",
    portalUrlSha256: digest(result.portalUrl),
  });
  expect(pdfState.status).toBe(200);
  expect(pdfState.body.ok).toBe(true);
  expect(pdfState.body.data.status).toBe("ready");
  expect(pdfState.body.data.sha256_hash).toBe(result.receipt.pdf.sha256);
  await ui.browser.unroute(endpoint);
  return result;
}

async function openAnonymous(ui: OfferUi, army: ArmyState, caseId: string, result: Awaited<ReturnType<typeof collected>>, originalName: string) {
  const pointer = process.env.E2E_OFFER_SECRET_POINTER;
  if (!pointer) throw new Error("Explicit private capability pointer required.");
  const target = new URL(result.portalUrl);
  if (target.origin !== new URL(ui.app.baseUrl!).origin) throw new Error("Collected CTA points outside the owned app.");
  const token = target.pathname.match(/^\/portal\/([0-9a-f-]{36})$/i)?.[1] ?? (() => { throw new Error("Actual collected resend token required."); })();
  await mkdir(path.dirname(path.resolve(pointer)), { recursive: true });
  await writeFile(pointer, `${JSON.stringify({ portalUrl: result.portalUrl, portalToken: token })}\n`, { mode: 0o600 });
  await ui.app.clearState();
  const bridge = new URL("/__army_offer_secret_bridge", ui.app.baseUrl!).href;
  await ui.browser.route(bridge, async (route) => route.fulfill({ headers: { "content-type": "text/html; charset=utf-8" }, body:
    '<!doctype html><html><head><meta charset="utf-8"></head><body><form onsubmit="event.preventDefault();location.assign(document.getElementById(\'target\').value)"><label for="target">Lien privé collecté</label><input id="target"><label for="token">Capacité privée</label><input id="token"><button type="submit">Ouvrir le lien collecté</button></form></body></html>' }));
  await ui.app.open("/__army_offer_secret_bridge");
  await ui.screen.getByLabel("Lien privé collecté", { exact: true }).fill(secrets.get("portalUrl"));
  await ui.screen.getByLabel("Capacité privée", { exact: true }).fill(secrets.get("portalToken"));
  await ui.screen.getByRole("button", "Ouvrir le lien collecté", { exact: true }).click();
  await expect.poll(async () => new URL(await ui.browser.url()).pathname !== "/__army_offer_secret_bridge", { timeout: 30000 }).toBe(true);
  await expect.poll(async () => ui.browser.evaluate(() => document.readyState !== "loading" && document.body.innerText.trim().length > 0), { timeout: 30000 }).toBe(true);
  // A privacy RED must not copy the very leaked costs/rows into an SDK result or
  // public artifact. The real body is inspected here; only bounded facts leave.
  const observed = await ui.browser.evaluate(async (expectedName) => {
    const text = document.body.innerText;
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))))
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return { pathname: location.pathname.replace(/\/portal\/[^/]+/, "/portal/[redacted]"),
      loginHeading: !!Array.from(document.querySelectorAll("h1,h2")).find((node) => node.textContent?.trim() === "Connexion"),
      originalNamePresent: text.includes(expectedName), total24Present: /24[,.]00\s*€/.test(text),
      visibleTextSha256: hash, visibleTextBytes: new TextEncoder().encode(text).byteLength };
  }, originalName);
  await recordOfferEvidence(army, `${caseId}-anonymous`, { portalUrlSha256: digest(result.portalUrl), observed });
  await expect(ui.browser).toHaveURL(/\/portal\//);
  await expect(ui.screen.getByRole("heading", "Connexion", { exact: true })).not.toBeVisible();
  return observed;
}

async function actualPortalPdf(ui: OfferUi) {
  const witness = await ui.browser.evaluate(async () => {
    const link = Array.from(document.querySelectorAll("a")).find((node) => node.textContent?.trim() === "Télécharger le PDF original du devis");
    if (!link) return { found: false, status: 0, bytes: 0, sha256: null, pdf: false };
    // Signed URL is consumed inside the browser and never returned/logged.
    const response = await fetch(link.href, { redirect: "error" });
    const bytes = new Uint8Array(await response.arrayBuffer());
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((value) => value.toString(16).padStart(2, "0")).join("");
    return { found: true, status: response.status, bytes: bytes.length, sha256: hash,
      pdf: new TextDecoder("ascii").decode(bytes.slice(0, 5)) === "%PDF-" };
  });
  expect(witness).toMatchObject({ found: true, status: 200, pdf: true });
  return witness;
}

async function ownerLogin(ui: OfferUi) {
  await ui.app.clearState();
  await ui.app.open("/login");
  const show = ui.screen.getByRole("button", "Afficher le mot de passe", { exact: true });
  const hide = ui.screen.getByRole("button", "Masquer le mot de passe", { exact: true });
  await expect.poll(async () => {
    if (await hide.isVisible()) return true;
    if (await show.isVisible()) await show.tap();
    return await hide.isVisible();
  }, { timeout: 30000 }).toBe(true);
  await hide.tap();
  const account = credentials.user("army");
  await ui.screen.getByLabel("Email", { exact: true }).fill(account.username);
  await ui.screen.getByLabel(/Mot de passe/).fill(account.password);
  await ui.screen.getByRole("button", "Se connecter", { exact: true }).tap();
  await expect(ui.browser).toHaveURL(/\/dashboard(?:\/.*)?$/, { timeout: 45000 });
}

async function collectorHttpEvents() {
  const configured = process.env.E2E_OFFER_COLLECTOR_HTTP_LOG;
  if (!configured) throw new Error("Separate local collector HTTP witness required.");
  const text = await readFile(configured, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { method: string; status: number; route: string });
}

for (const [caseId, decision, portalLabel, expectedParent] of [
  ["RSA", "accept", "Accepté", "accepted"],
  ["RSR", "reject", "Refusé", "archived"],
] as const) {
  offerTest(`${caseId} ${decision === "accept" ? "accepts" : "rejects"} the NEW collected resend portal and retains original PDF`, options, async (ui) => {
    const prepared = await prepare(ui, caseId);
    const first = await send(ui, caseId, prepared.ids.versionId);
    await ui.app.open(`/dashboard/estimates/${prepared.ids.versionId}`);
    const second = await send(ui, caseId, prepared.ids.versionId, true);
    expect(second.receipt.id).not.toBe(first.receipt.id);
    expect(second.portalUrl).not.toBe(first.portalUrl);
    expect(second.receipt.pdf).toMatchObject({ sha256: first.receipt.pdf.sha256, bytes: first.receipt.pdf.bytes });
    const baseline = await readEstimate(ui.browser, prepared.ids.versionId);
    expect(baseline.version.status).toBe("sent");
    expect(baseline.version.seal_payload_version).toBe(5);
    const sealHash = baseline.version.seal_hash;
    if (typeof sealHash !== "string" || !/^[a-f0-9]{64}$/i.test(sealHash)) throw new Error("Original emitted seal5 missing prerequisite.");
    expect(totals(baseline.version)).toEqual([2000, 400, 2400]);
    const reason = decision === "reject" ? `${ui.army.runPrefix}-${caseId}-refus synthétique` : null;
    await admitCollectedResendDecision(ui.army, { ...prepared.ids, receiptDirectory: second.directory,
      providerId: second.receipt.id, initialProviderId: first.receipt.id, portalUrl: second.portalUrl,
      initialPortalUrl: first.portalUrl, decision, reason });
    const campaign = process.env.E2E_OFFER_RUN_DIRECTORY;
    if (!campaign) throw new Error("Owned campaign pointer absent.");
    const pointerFile = path.join(campaign, "private", `resend-${caseId}.json`);
    // Tokens/URLs remain private and are NEVER arguments of browser assertions.
    await writeFile(pointerFile, `${JSON.stringify({ schemaVersion: 1, caseId, fixturePrefix: ui.army.runPrefix,
      ids: prepared.ids, originalName: prepared.originalName, decision, expectedParent, reason,
      initial: { providerId: first.receipt.id, portalUrl: first.portalUrl, receiptDirectory: first.directory, pdf: first.receipt.pdf },
      resend: { providerId: second.receipt.id, portalUrl: second.portalUrl, receiptDirectory: second.directory, pdf: second.receipt.pdf },
      baseline: { sealHash, sealPayloadVersion: 5, contentRevision: baseline.version.content_revision,
        snapshotRevision: baseline.version.calc_snapshot_content_revision, totals: totals(baseline.version) },
      notification: decision === "accept" ? "missing-idempotency-key-expect-local400-no-delivery-proof" : "not-requested" }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    const anonymous = await openAnonymous(ui, ui.army, caseId, second, prepared.originalName);
    expect(anonymous.originalNamePresent).toBe(true);
    expect(anonymous.total24Present).toBe(true);
    const anonymousInternal = await ui.browser.evaluate(async (versionId) => (await fetch(`/api/estimates/${versionId}`, { credentials: "same-origin" })).status, prepared.ids.versionId);
    expect(anonymousInternal).toBe(401);
    const downloadedBefore = await actualPortalPdf(ui);
    expect(downloadedBefore.sha256).toBe(first.receipt.pdf.sha256);
    expect(downloadedBefore.bytes).toBe(first.receipt.pdf.bytes);
    const notificationsBefore = await collectorHttpEvents();
    await ui.screen.getByRole("button", decision === "accept" ? "Accepter le devis" : "Refuser le devis", { exact: true }).click();
    const modal = ui.screen.getByRole("dialog", decision === "accept" ? "Accepter le devis" : "Refuser le devis", { exact: true });
    await expect(modal).toBeVisible();
    if (decision === "accept") {
      // Signature is optional; no signature Storage mutation is admitted.
      await modal.getByRole("checkbox", "J’accepte ce devis et ses conditions", { exact: true }).check();
    } else {
      await modal.getByLabel(/Motif du refus/).fill(reason!);
    }
    const endpoint = new RegExp(`/api/portal/[a-f0-9-]{36}/${decision}$`, "i");
    const [response] = await Promise.all([ui.browser.waitForResponse(endpoint, { timeout: 45000 }),
      modal.getByRole("button", decision === "accept" ? "Confirmer l’acceptation" : "Confirmer le refus", { exact: true }).click()]);
    const result = await response.json<{ status?: string }>();
    await recordOfferEvidence(ui.army, `${caseId}-decision-reply`, { ids: prepared.ids, decision, status: response.status,
      actualDecision: result.status, anonymousInternal, downloadedBefore, sourceReceiptProviderId: second.receipt.id,
      sourcePortalUrlSha256: digest(second.portalUrl), notificationDeliveryQualified: false });
    expect(response.status).toBe(200);
    expect(result.status).toBe(decision === "accept" ? "accepted" : "rejected");
    await expect(modal).not.toBeVisible();
    await ui.browser.reload();
    await expect(ui.screen.getByText(portalLabel, { exact: true })).toBeVisible();
    await expect(ui.screen.getByRole("button", "Accepter le devis", { exact: true })).not.toBeVisible();
    await expect(ui.screen.getByRole("button", "Refuser le devis", { exact: true })).not.toBeVisible();
    const downloadedAfter = await actualPortalPdf(ui);
    expect(downloadedAfter).toEqual(downloadedBefore);
    await admitCollectedResendDecision(ui.army, { ...prepared.ids, receiptDirectory: second.directory,
      providerId: second.receipt.id, initialProviderId: first.receipt.id, portalUrl: second.portalUrl,
      initialPortalUrl: first.portalUrl, decision, reason });
    const repeated = await ui.browser.evaluate(async (input) => {
      const capability = location.pathname.match(/^\/portal\/([a-f0-9-]{36})$/i)?.[1];
      if (!capability) throw new Error("The collected portal must be open.");
      const response = await fetch(`/api/portal/${capability}/${input.decision}`, { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input.decision === "accept" ? { accepted_terms: true } : { reason: input.reason }) });
      return { status: response.status, body: await response.json() };
    }, { decision, reason });
    expect(repeated.status).toBe(409);
    const notificationResponses = (await collectorHttpEvents()).slice(notificationsBefore.length).filter((event) => event.route === "emails" && event.method === "POST");
    expect(notificationResponses.map((event) => event.status)).toEqual(decision === "accept" ? [400] : []);
    // The business decision succeeds; confirmation delivery is deliberately
    // UNQUALIFIED. Installed SDK honors the loopback env. The current accept
    // request lacks the idempotency key, so the unchanged principal refuses400
    // before its PDF contract. This is an actual HTTP oracle to execute, not
    // proof supplied by the offline constructor/serialization diagnostic.
    await ownerLogin(ui);
    const persisted = await readEstimate(ui.browser, prepared.ids.versionId);
    expect(persisted.version.status).toBe(expectedParent);
    expect(persisted.version.seal_hash).toBe(sealHash);
    expect(persisted.version.seal_payload_version).toBe(5);
    expect(persisted.version.content_revision).toBe(baseline.version.content_revision);
    expect(persisted.version.calc_snapshot_content_revision).toBe(baseline.version.calc_snapshot_content_revision);
    expect(totals(persisted.version)).toEqual([2000, 400, 2400]);
    await ui.app.open(`/dashboard/estimates/${prepared.ids.versionId}`);
    await ui.browser.reload();
    const reloaded = await readEstimate(ui.browser, prepared.ids.versionId);
    expect(reloaded.version.status).toBe(expectedParent);
    expect(reloaded.version.seal_hash).toBe(sealHash);
    expect(reloaded.items.map((item) => ({ id: item.id, title: item.title, quantity: item.quantity,
      ht: item.line_total_ht_cents, tax: item.line_tax_cents, ttc: item.line_total_ttc_cents })))
      .toEqual(baseline.items.map((item) => ({ id: item.id, title: item.title, quantity: item.quantity,
        ht: item.line_total_ht_cents, tax: item.line_tax_cents, ttc: item.line_total_ttc_cents })));
    const persistedOffer = await observeOwnedOffer(ui.army, prepared.ids.versionId);
    expect(persistedOffer.dispatches.filter((entry) => [first.receipt.id, second.receipt.id].includes(entry.provider_id ?? "")))
      .toHaveLength(2);
    expect(persistedOffer.capabilities.filter((entry) => entry.status === (decision === "accept" ? "accepted" : "rejected"))).toHaveLength(1);
    await recordOfferEvidence(ui.army, `${caseId}-resend-portal-retained`, { ids: prepared.ids, decision, expectedParent,
      initialProviderId: first.receipt.id, resendProviderId: second.receipt.id, pdf: second.receipt.pdf,
      downloadedAfter, sealHash, sealPayloadVersion: 5, revisionRetained: true, fixtureRetained: true,
      notificationResponses, notificationDeliveryQualified: false, repeated, persistedOffer,
      sourcePointer: `private/resend-${caseId}.json` });
  });
}

type Fault = "rejected" | "retryable" | "accepted-unknown";
async function setCollectorFault(ui: OfferUi, recipient: string, responses: Fault[]) {
  const run = path.resolve(process.env.E2E_OFFER_RUN_DIRECTORY ?? "");
  const file = process.env.E2E_OFFER_FAULT_PLAN;
  if (file !== path.join(run, "private", "collector-faults.json") || !recipient.startsWith(ui.army.runPrefix)
    || !recipient.endsWith("@offer.invalid")) throw new Error("An exact owned collector fault plan is required.");
  await writeFile(file, `${JSON.stringify({ schemaVersion: 1, id: randomUUID(), recipient, responses })}\n`, { mode: 0o600 });
}

async function collectorAttempts() {
  const file = process.env.E2E_OFFER_ATTEMPT_LOG;
  if (!file || file !== path.join(process.env.E2E_OFFER_RUN_DIRECTORY!, "public", "collector-attempts.jsonl")) {
    throw new Error("The owned collector attempt witness is required.");
  }
  return (await readFile(file, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  })).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as {
    keySha256: string; payloadSha256: string; fault: Fault | null;
  });
}

async function submitIncident(ui: OfferUi, versionId: string, recipient: string, caseId: string) {
  await ui.screen.getByRole("button", /^(Envoyer par email|Reprendre l’envoi)$/).click();
  const modal = ui.screen.getByRole("dialog", "Envoyer le devis par email", { exact: true });
  await expect(modal).toBeVisible();
  await modal.getByLabel("Destinataire *", { exact: true }).fill(recipient);
  await modal.getByLabel("Objet *", { exact: true }).fill(`${caseId} offre commerciale`);
  await modal.getByLabel("Message *", { exact: true }).fill("Veuillez consulter notre proposition et son PDF contractuel.");
  const [response] = await Promise.all([
    ui.browser.waitForResponse(new URL(`/api/estimates/${versionId}/send`, ui.app.baseUrl!).href, { timeout: 120000 }),
    modal.getByRole("button", "Envoyer", { exact: true }).click(),
  ]);
  const body = await response.json<{ ok: boolean; data?: { message_id: string }; error?: { code: string; message: string } }>();
  if (!body.ok) {
    await expect(modal.getByText(body.error!.message, { exact: true })).toBeVisible();
    await modal.getByRole("button", "Annuler", { exact: true }).click();
  } else await expect(modal).not.toBeVisible();
  return { status: response.status, body };
}

for (const [caseId, faults, expectedCode, firstStatus] of [
  ["EIR", ["rejected"], "ESTIMATE_EMAIL_PROVIDER_REJECTED", "failed"],
  ["EIT", ["retryable", "retryable", "retryable"], "ESTIMATE_EMAIL_RETRYABLE", "queued"],
] as const) {
  offerTest(`${caseId} retries the actual failed email with the correct persisted envelope and one receipt`, options, async (ui) => {
    const prepared = await prepare(ui, caseId);
    const recipient = `${ui.army.runPrefix}-${caseId}@offer.invalid`;
    const beforeReceipts = await receiptNames();
    const beforeAttempts = (await collectorAttempts()).length;
    await setCollectorFault(ui, recipient, [...faults]);
    const rejected = await submitIncident(ui, prepared.ids.versionId, recipient, caseId);
    const first = await observeOwnedOffer(ui.army, prepared.ids.versionId);
    await recordOfferEvidence(ui.army, `${caseId}-first`, { rejected, first, attempts: (await collectorAttempts()).slice(beforeAttempts) });
    expect(rejected.body.error?.code).toBe(expectedCode);
    expect(first.dispatches).toHaveLength(1);
    expect(first.dispatches[0].status).toBe(firstStatus);
    expect(await receiptNames()).toEqual(beforeReceipts);
    expect((await collectorAttempts()).slice(beforeAttempts).map((entry) => entry.fault)).toEqual([...faults]);
    const failedVersion = await readEstimate(ui.browser, prepared.ids.versionId);
    expect(failedVersion.version.status).toBe(firstStatus === "failed" ? "draft" : "sending");
    if (firstStatus === "failed") expect(failedVersion.version.seal_hash).toBe(null);

    await setCollectorFault(ui, recipient, []);
    await ui.app.open(`/dashboard/estimates/${prepared.ids.versionId}`);
    const retried = await submitIncident(ui, prepared.ids.versionId, recipient, caseId);
    const after = await observeOwnedOffer(ui.army, prepared.ids.versionId);
    const attempts = (await collectorAttempts()).slice(beforeAttempts);
    await recordOfferEvidence(ui.army, `${caseId}-retry`, { retried, first, after, attempts });
    expect(retried.status).toBe(200);
    expect(retried.body.ok).toBe(true);
    expect((await receiptNames()).length).toBe(beforeReceipts.length + 1);
    expect(after.dispatches).toHaveLength(firstStatus === "failed" ? 2 : 1);
    const sent = after.dispatches.find((entry) => entry.status === "sent")!;
    expect(sent.provider_id).toBe(retried.body.data!.message_id);
    if (firstStatus === "failed") {
      expect(sent.requestSha256).not.toBe(first.dispatches[0].requestSha256);
      expect(sent.providerKeySha256).not.toBe(first.dispatches[0].providerKeySha256);
    } else {
      expect(sent.id).toBe(first.dispatches[0].id);
      expect(sent.requestSha256).toBe(first.dispatches[0].requestSha256);
      expect(new Set(attempts.map((entry) => entry.keySha256)).size).toBe(1);
      expect(new Set(attempts.map((entry) => entry.payloadSha256)).size).toBe(1);
    }
    const receipt = await collected(retried.body.data!.message_id);
    expect(sent.document_sha256).toBe(receipt.receipt.pdf.sha256);
    await ui.browser.reload();
    const persisted = await readEstimate(ui.browser, prepared.ids.versionId);
    expect(persisted.version.status).toBe("sent");
    expect(totals(persisted.version)).toEqual([2000, 400, 2400]);
  });
}

offerTest("EIU reconciles an ambiguous collected delivery through the admin UI without sending again", options, async (ui) => {
  const prepared = await prepare(ui, "EIU");
  const recipient = `${ui.army.runPrefix}-EIU@offer.invalid`;
  const beforeReceipts = await receiptNames();
  const beforeAttempts = (await collectorAttempts()).length;
  await setCollectorFault(ui, recipient, ["accepted-unknown"]);
  const ambiguous = await submitIncident(ui, prepared.ids.versionId, recipient, "EIU");
  const unknown = await observeOwnedOffer(ui.army, prepared.ids.versionId);
  await recordOfferEvidence(ui.army, "EIU-unknown", { ambiguous, unknown });
  expect(ambiguous.body.error?.code).toBe("ESTIMATE_EMAIL_DELIVERY_UNKNOWN");
  expect(unknown.dispatches).toHaveLength(1);
  expect(unknown.dispatches[0].status).toBe("unknown");
  const added = (await receiptNames()).filter((name) => !beforeReceipts.includes(name));
  expect(added).toHaveLength(1);
  const directory = path.join(collectorDirectory(), added[0]);
  const receipt = JSON.parse(await readFile(path.join(directory, "public", "receipt.json"), "utf8")) as Receipt;
  const before = await readEstimate(ui.browser, prepared.ids.versionId);
  expect(before.version.status).toBe("sending");
  await ui.app.open(`/dashboard/estimates/${prepared.ids.versionId}`);
  await expect(ui.screen.getByTestId("estimate-email-dispatch-problem")).toContainText("indéterminé");
  const refusedReplay = await submitIncident(ui, prepared.ids.versionId, recipient, "EIU");
  expect(refusedReplay.body.error?.code).toBe("ESTIMATE_EMAIL_DELIVERY_UNKNOWN");
  expect((await collectorAttempts()).length).toBe(beforeAttempts + 1);
  const mark = ui.screen.getByRole("button", "Marquer envoyé", { exact: true });
  await expect(mark).toBeDisabled();
  await admitCollectedReconciliation(ui.army, { versionId: prepared.ids.versionId, dispatchId: unknown.dispatches[0].id,
    providerId: receipt.id, receiptDirectory: directory });
  await ui.screen.getByRole("textbox", "Identifiant du message chez le fournisseur email", { exact: true }).fill(receipt.id);
  const [reconciled] = await Promise.all([
    ui.browser.waitForResponse(new URL(`/api/estimates/${prepared.ids.versionId}/email-dispatch/reconcile`, ui.app.baseUrl!).href),
    mark.click(),
  ]);
  expect(reconciled.status).toBe(200);
  await expect(ui.screen.getByTestId("estimate-email-dispatch-problem")).toHaveCount(0);
  await ui.browser.reload();
  const after = await observeOwnedOffer(ui.army, prepared.ids.versionId);
  const persisted = await readEstimate(ui.browser, prepared.ids.versionId);
  expect(after.dispatches).toHaveLength(1);
  expect(after.dispatches[0]).toMatchObject({ id: unknown.dispatches[0].id, status: "sent", provider_id: receipt.id,
    document_sha256: receipt.pdf.sha256 });
  expect(persisted.version.status).toBe("sent");
  expect(persisted.version.seal_hash).toBe(before.version.seal_hash);
  expect(totals(persisted.version)).toEqual([2000, 400, 2400]);
  expect((await collectorAttempts()).length).toBe(beforeAttempts + 1);
  expect((await receiptNames()).length).toBe(beforeReceipts.length + 1);
  await recordOfferEvidence(ui.army, "EIU-reconciled", { refusedReplay, after, noProviderReplay: true, sameSeal: true });
});

offerTest("RSX refuses an expired real resend capability without exposing or deciding the offer", options, async (ui) => {
  const prepared = await prepare(ui, "RSX");
  const first = await send(ui, "RSX", prepared.ids.versionId);
  await ui.app.open(`/dashboard/estimates/${prepared.ids.versionId}`);
  const second = await send(ui, "RSX", prepared.ids.versionId, true);
  const before = await readEstimate(ui.browser, prepared.ids.versionId);
  const expiry = await expireOwnedCollectedPortal(ui.army, prepared.ids.versionId, second.portalUrl);
  await admitCollectedResendDecision(ui.army, { ...prepared.ids, receiptDirectory: second.directory,
    providerId: second.receipt.id, initialProviderId: first.receipt.id, portalUrl: second.portalUrl,
    initialPortalUrl: first.portalUrl, decision: "accept", reason: null });
  await openAnonymous(ui, ui.army, "RSX", second, prepared.originalName);
  await expect(ui.screen.getByRole("heading", "Devis expiré", { exact: true })).toBeVisible();
  await expect(ui.screen.getByText(prepared.originalName, { exact: true })).toHaveCount(0);
  await expect(ui.screen.getByRole("button", "Accepter le devis", { exact: true })).toHaveCount(0);
  const refused = await ui.browser.evaluate(async () => {
    const capability = location.pathname.match(/^\/portal\/([a-f0-9-]{36})\/expired$/i)?.[1];
    if (!capability) throw new Error("The expired portal must be open.");
    const response = await fetch(`/api/portal/${capability}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accepted_terms: true }) });
    return { status: response.status, body: await response.json() };
  });
  expect(refused.status).toBe(404);
  await ownerLogin(ui);
  const persisted = await readEstimate(ui.browser, prepared.ids.versionId);
  expect(persisted.version.status).toBe("sent");
  expect(persisted.version.seal_hash).toBe(before.version.seal_hash);
  expect(totals(persisted.version)).toEqual(totals(before.version));
  await recordOfferEvidence(ui.army, "RSX-expired", { expiry, refused, persistedOffer: await observeOwnedOffer(ui.army, prepared.ids.versionId) });
});

offerTest("RSC commits only one of two competing anonymous decisions on the same collected resend", options, async (ui) => {
  const prepared = await prepare(ui, "RSC");
  const first = await send(ui, "RSC", prepared.ids.versionId);
  await ui.app.open(`/dashboard/estimates/${prepared.ids.versionId}`);
  const second = await send(ui, "RSC", prepared.ids.versionId, true);
  const before = await readEstimate(ui.browser, prepared.ids.versionId);
  const reason = `${ui.army.runPrefix}-RSC-refus concurrent`;
  await admitCollectedResendDecision(ui.army, { ...prepared.ids, receiptDirectory: second.directory,
    providerId: second.receipt.id, initialProviderId: first.receipt.id, portalUrl: second.portalUrl,
    initialPortalUrl: first.portalUrl, decision: "accept", reason: null,
    competingDecision: { decision: "reject", reason } });
  await openAnonymous(ui, ui.army, "RSC", second, prepared.originalName);
  const decisions = await ui.browser.evaluate(async (reason) => {
    const capability = location.pathname.match(/^\/portal\/([a-f0-9-]{36})$/i)?.[1];
    if (!capability) throw new Error("The collected portal must be open.");
    return Promise.all((["accept", "reject"] as const).map(async (decision) => {
      const response = await fetch(`/api/portal/${capability}/${decision}`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(decision === "accept" ? { accepted_terms: true } : { reason }) });
      return { decision, status: response.status, body: await response.json() as { status?: string } };
    }));
  }, reason);
  expect(decisions.map((entry) => entry.status).sort()).toEqual([200, 409]);
  const winner = decisions.find((entry) => entry.status === 200)!;
  await ui.browser.reload();
  await expect(ui.screen.getByText(winner.decision === "accept" ? "Accepté" : "Refusé", { exact: true })).toBeVisible();
  await expect(ui.screen.getByRole("button", "Accepter le devis", { exact: true })).toHaveCount(0);
  await ownerLogin(ui);
  const persisted = await readEstimate(ui.browser, prepared.ids.versionId);
  expect(persisted.version.status).toBe(winner.decision === "accept" ? "accepted" : "archived");
  expect(persisted.version.seal_hash).toBe(before.version.seal_hash);
  expect(totals(persisted.version)).toEqual(totals(before.version));
  const observed = await observeOwnedOffer(ui.army, prepared.ids.versionId);
  expect(observed.capabilities.filter((entry) => ["accepted", "rejected"].includes(entry.status))).toHaveLength(1);
  await recordOfferEvidence(ui.army, "RSC-one-decision", { decisions, observed, sameSeal: true });
});

