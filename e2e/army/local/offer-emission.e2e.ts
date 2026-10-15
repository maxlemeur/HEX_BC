import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expect, secrets, type App, type Screen } from "e2e";
import type { Browser } from "@e2e-dev/web";

import { apiRequest, createEstimateViaWizard, readEstimate, setLineCoreValues, type ArmyItem, type ArmyState } from "../critical/fixtures";
import { allowOfferLaborRoleUpdate, allowOfferLifecycleTransition, offerTest, recordOfferEvidence } from "./offer-emission-fixtures";

// Failure modes precede this harness in docs/testing/offer-emission-business-cases.md.
const options = { session: "army", trace: "off" as const, tags: ["offer-emission"], timeout: 360000 };
type OfferUi = { app: App; screen: Screen; browser: Browser; army: ArmyState };
type Receipt = { id: string; pdf: { sha256: string; bytes: number }; delivery: string };
type Packet = { id: string; payload: { html: string; text: string; attachments: { filename: string; content: string }[] } };
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const totals = (version: Record<string, unknown>) => [version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents];

async function expectEstimateSummaryStatus(ui: OfferUi, label: string) {
  await expect.poll(async () => ui.browser.evaluate(() => {
    const terms = Array.from(document.querySelectorAll("dt"))
      .filter((term) => term.textContent?.trim() === "Statut");
    const badges = terms.flatMap((term) =>
      Array.from(term.parentElement?.querySelectorAll(":scope > dd > span") ?? []));
    return {
      termCount: terms.length,
      labels: badges.map((badge) => badge.textContent?.trim() ?? ""),
      visible: badges.map((badge) => badge.getClientRects().length > 0
        && getComputedStyle(badge).visibility === "visible"),
    };
  }), { timeout: 30000 }).toEqual({ termCount: 1, labels: [label], visible: [true] });
}

type PdfReadDiagnosticEvent = {
  phase: string;
  elapsedMs: number;
  method?: string;
  path?: string;
  status?: number;
  errorName?: string;
  stack?: string;
  pageInstance?: number;
  dialogInstance?: number;
  modalError?: string;
  editorError?: string;
  submitting?: boolean;
  recoveryVisible?: boolean;
  editorReadBarrierVisible?: boolean;
};
type PdfReadDiagnosticWindow = Window & {
  __armyOfferPdfReadDiagnostic?: { events: PdfReadDiagnosticEvent[]; restore: () => void };
  __armyOfferPdfReadInternal?: Record<string, string | number | boolean>[];
  __armyOfferPdfReadTap?: (phase: number, registration: number, currentRegistration: number, flags: number) => void;
};

async function startPdfReadDiagnostic(browser: Browser, ownerPath: string) {
  await browser.evaluate((ownerPath) => {
    const target = window as PdfReadDiagnosticWindow;
    target.__armyOfferPdfReadDiagnostic?.restore();
    const events: PdfReadDiagnosticEvent[] = [];
    const started = performance.now();
    target.__armyOfferPdfReadInternal = [];
    const previousTap = target.__armyOfferPdfReadTap;
    const phases = ["unknown", "register", "dispose", "queue-submit", "require-read", "notify-before", "notify-after"];
    const tap = (phase: number, registration: number, currentRegistration: number, flags: number) => {
      const sink = target.__armyOfferPdfReadInternal;
      if (!sink || sink.length >= 64) return;
      sink.push({ phase: phases[phase] ?? "unknown", elapsedMs: Math.round(performance.now() - started),
        registration, currentRegistration, scopeId: 0, active: (flags & 1) !== 0,
        hasObserver: (flags & 2) !== 0, currentMapMatch: (flags & 4) !== 0, readRequired: (flags & 8) !== 0 });
    };
    target.__armyOfferPdfReadTap = tap;
    const record = (event: Omit<PdfReadDiagnosticEvent, "elapsedMs">) => {
      if (events.length < 64) events.push({ ...event, elapsedMs: Math.round(performance.now() - started) });
    };
    const originalFetch = window.fetch;
    const wrappedFetch: typeof window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href);
      const tracked = url.origin === window.location.origin &&
        [ownerPath, `${ownerPath}/pdf`, `${ownerPath}/batch`, `${ownerPath}/lock`, `${ownerPath}/pdf/layout`].includes(url.pathname);
      if (!tracked) return originalFetch.call(window, input, init);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      // Only the owned path and stack frames: never request bodies, headers or query strings.
      record({ phase: "fetch-start", method, path: url.pathname,
        stack: (new Error().stack ?? "").split("\n").slice(1, 8).join("\n")
          .replace(/[?#][^\s)]+/g, "").slice(0, 2400) });
      try {
        const response = await originalFetch.call(window, input, init);
        record({ phase: "fetch-response", method, path: url.pathname, status: response.status });
        return response;
      } catch (error) {
        record({ phase: "fetch-rejected", method, path: url.pathname, errorName: error instanceof Error ? error.name : "unknown" });
        throw error;
      }
    };
    window.fetch = wrappedFetch;
    const instances = new WeakMap<Element, number>();
    let instanceSequence = 0;
    const instance = (element: Element | null) => {
      if (!element) return 0;
      const known = instances.get(element);
      if (known) return known;
      instances.set(element, ++instanceSequence);
      return instanceSequence;
    };
    let lastDomState = "";
    const observeDom = () => {
      const page = document.querySelector('[data-testid="estimate-editor-page"]');
      const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((element) =>
        element.querySelector("h2")?.textContent === "Préparer le devis PDF") ?? null;
      const modalAlert = dialog?.querySelector('[role="alert"]')?.textContent ?? "";
      const editorAlert = page?.querySelector('[data-testid="estimate-editor-alert-action-error"]')?.textContent ?? "";
      const generate = Array.from(dialog?.querySelectorAll("button") ?? []).find((button) =>
        button.textContent?.includes("Générer et télécharger"));
      const state = { pageInstance: instance(page), dialogInstance: instance(dialog),
        modalError: modalAlert.includes("la lecture du devis a échoué") ? "read-required" : modalAlert ? "other" : "none",
        editorError: editorAlert.includes("la lecture du devis a échoué") ? "read-required"
          : editorAlert.includes("Impossible de relire le chiffrage") ? "transient-read" : editorAlert ? "other" : "none",
        recoveryVisible: Boolean(page?.querySelector('[data-testid="estimate-editor-alert-batch-recovery"]')),
        editorReadBarrierVisible: page?.querySelector('[data-testid="estimate-page-toolbar-autosave-status"]')?.textContent === "Résultat à vérifier",
        submitting: generate?.disabled === true };
      const signature = JSON.stringify(state);
      if (signature !== lastDomState) { record({ phase: "dom-state", ...state }); lastDomState = signature; }
    };
    const observer = new MutationObserver(observeDom);
    observer.observe(document.body, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ["disabled", "aria-busy"] });
    observeDom();
    const hotUpdates = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name.includes("hot-update")) record({ phase: "dev-hot-update-resource" });
      }
    });
    hotUpdates.observe({ type: "resource", buffered: false });
    target.__armyOfferPdfReadDiagnostic = { events, restore: () => {
      observeDom(); observer.disconnect(); hotUpdates.disconnect();
      if (window.fetch === wrappedFetch) window.fetch = originalFetch;
      if (target.__armyOfferPdfReadTap === tap) {
        if (previousTap) target.__armyOfferPdfReadTap = previousTap;
        else delete target.__armyOfferPdfReadTap;
      }
    } };
    return true;
  }, ownerPath);
}

async function finishPdfReadDiagnostic(browser: Browser) {
  return browser.evaluate(() => {
    const target = window as PdfReadDiagnosticWindow;
    const diagnostic = target.__armyOfferPdfReadDiagnostic;
    diagnostic?.restore();
    const events = diagnostic?.events ?? [];
    const internalEvents = target.__armyOfferPdfReadInternal ?? [];
    delete target.__armyOfferPdfReadDiagnostic;
    delete target.__armyOfferPdfReadInternal;
    return { events, internalEvents };
  });
}

async function closePdfActionsMenu(ui: OfferUi) {
  const expanded = await ui.browser.evaluate(() => {
    const buttons = document.querySelectorAll('[data-testid="estimate-page-toolbar-more-actions-button"]');
    if (buttons.length !== 1) throw new Error("Expected exactly one estimate toolbar actions toggle.");
    return buttons[0].getAttribute("aria-expanded") === "true";
  });
  if (expanded) await ui.screen.getByTestId("estimate-page-toolbar-more-actions-button").click();
  await expect(ui.screen.getByTestId("estimate-page-toolbar-more-actions-menu")).toHaveCount(0);
  await expect(ui.screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText("Résultat à vérifier");
}

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
  if (caseId === "OF01") {
    await modal.getByLabel("Destinataire *", { exact: true }).fill("army-of01@offer.invalid");
    await modal.getByLabel("Objet *", { exact: true }).fill("OF01 offre commerciale");
    await modal.getByLabel("Message *", { exact: true }).fill("Veuillez consulter notre proposition et son PDF contractuel.");
  }
  await modal.getByRole("button", "Annuler", { exact: true }).click();
  expect(sendPosts).toBe(0);
  expect(await receiptNames()).toEqual(before);
  await recordOfferEvidence(ui.army, `${caseId}-cancel-${resend ? "resend" : "initial"}`, { beforeReceipts: before.length, afterReceipts: before.length, sendPosts });
  await open.click();
  if (caseId === "OF01") {
    await expect(modal.getByLabel("Destinataire *", { exact: true })).toHaveValue("army-of01@offer.invalid");
    await expect(modal.getByLabel("Objet *", { exact: true })).toHaveValue("OF01 offre commerciale");
    await expect(modal.getByLabel("Message *", { exact: true })).toHaveValue("Veuillez consulter notre proposition et son PDF contractuel.");
    await recordOfferEvidence(ui.army, "OF01-reopen-preserves-envelope", { retainedFields: ["recipient", "subject", "message"], sendPostsBeforeConfirm: sendPosts });
  }
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
  const token = target.pathname.match(/^\/portal\/([0-9a-f-]{36})$/i)?.[1] ?? "ARMY-unused-capability-placeholder";
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

offerTest("OF00 actual confirmation emits the same frozen PDF", options, async (ui) => {
  const p = await prepare(ui, "OF00");
  await send(ui, "OF00", p.ids.versionId);
});

offerTest("OF04 manual issue and lifecycle preserve its final PDF without email", options, async (ui) => {
  const p = await prepare(ui, "OF04");
  const pdfBefore = await apiRequest<{ ok: boolean; data: { status: string; sha256_hash?: string; file_size_bytes?: number } }>(
    ui.browser, "GET", `/api/estimates/${p.ids.versionId}/pdf?format=json`,
  );
  expect(pdfBefore.status).toBe(200);
  expect(pdfBefore.body.ok).toBe(true);
  expect(pdfBefore.body.data.status).toBe("ready");
  const stateBefore = await readEstimate(ui.browser, p.ids.versionId);
  let expectedConcurrency = stateBefore.version.updated_at;
  const receiptsBefore = await receiptNames();
  const networkFile = process.env.E2E_OFFER_NETWORK_LOG;
  if (!networkFile) throw new Error("OF04 missing server network witness.");
  const networkBefore = (await readFile(networkFile, "utf8")).trim().split(/\r?\n/).filter(Boolean).map((entry) => JSON.parse(entry) as { role: string });
  const statusEndpoint = new URL(`/api/estimates/${p.ids.versionId}/status`, ui.app.baseUrl!).href;
  const sendEndpoint = new URL(`/api/estimates/${p.ids.versionId}/send`, ui.app.baseUrl!).href;
  let sendPosts = 0;
  const statusRequests: { method: string; hasOwnPageSessionHeader: boolean; pageSessionSha256: string | null; concurrencyMatches: boolean }[] = [];
  const leaseRequests: { method: string; forced: boolean; pageSessionSha256: string | null }[] = [];
  await ui.browser.route(sendEndpoint, async (route) => { if (route.request.method === "POST") sendPosts++; await route.fallback(); });
  await ui.browser.route(statusEndpoint, async (route) => {
    if (route.request.method === "PATCH") {
      const headers = route.request.headers;
      const session = headers["x-estimate-draft-lock-session-id"] ?? "";
      statusRequests.push({ method: route.request.method,
        hasOwnPageSessionHeader: /^[0-9a-f-]{36}$/i.test(session),
        pageSessionSha256: session ? digest(session) : null,
        concurrencyMatches: headers["if-match"] === expectedConcurrency });
    }
    await route.fallback();
  });
  const leasePattern = new RegExp(`/api/estimates/${p.ids.versionId}/lock(?:\\?.*)?$`);
  await ui.browser.route(leasePattern, async (route) => {
    const params = new URL(route.request.url).searchParams;
    const session = route.request.headers["x-estimate-draft-lock-session-id"] ?? "";
    leaseRequests.push({ method: route.request.method,
      forced: ["true", "1"].includes(params.get("force") ?? ""),
      pageSessionSha256: session ? digest(session) : null });
    await route.fallback();
  });
  try {
    // Observe any page-mount acquisition as well as click-time acquisition.
    // Installing the witness after prepare must not miss a legitimate UI lease.
    await ui.browser.reload();
    await expect(ui.screen.getByRole("button", "Marquer envoyé", { exact: true })).toBeEnabled();
    const [response] = await Promise.all([
      ui.browser.waitForResponse(statusEndpoint, { timeout: 120000 }),
      ui.screen.getByRole("button", "Marquer envoyé", { exact: true }).click(),
    ]);
    const reply = await response.json<{ ok: boolean; error?: { code?: string } }>();
    const actual = await readEstimate(ui.browser, p.ids.versionId);
    const networkAfter = (await readFile(networkFile, "utf8")).trim().split(/\r?\n/).filter(Boolean).map((entry) => JSON.parse(entry) as { role: string });
    const collectorCallsBefore = networkBefore.filter((entry) => entry.role === "collector").length;
    const collectorCallsAfter = networkAfter.filter((entry) => entry.role === "collector").length;
    await recordOfferEvidence(ui.army, "OF04-manual-observed", {
      versionId: p.ids.versionId, responseStatus: response.status, ok: reply.ok, errorCode: reply.error?.code ?? null,
      actualStatus: actual.version.status, sealPayloadVersion: actual.version.seal_payload_version ?? null,
      sealHashPresent: typeof actual.version.seal_hash === "string" && /^[a-f0-9]{64}$/i.test(actual.version.seal_hash),
      totals: totals(actual.version), statusRequests, leaseRequests, sendPosts,
      collectorCallsBefore, collectorCallsAfter,
      receiptCountBefore: receiptsBefore.length, receiptCountAfter: (await receiptNames()).length,
      complementaryProof: { status: "not-performed-by-browser", documentClientContract: "root independent local read on retained owned version required",
        emailRowsAndCapabilityRows: "root independent counts required; zero collector is not zero DB rows" },
    });
    expect(response.status).toBe(200);
    expect(reply.ok).toBe(true);
    expect(statusRequests.length).toBe(1);
    expect(statusRequests[0].hasOwnPageSessionHeader).toBe(true);
    expect(statusRequests[0].concurrencyMatches).toBe(true);
    expect(leaseRequests.some((request) => ["POST", "PATCH"].includes(request.method)
      && request.pageSessionSha256 === statusRequests[0].pageSessionSha256)).toBe(true);
    expect(leaseRequests.some((request) => request.forced)).toBe(false);
    expect(actual.version.status).toBe("sent");
    expect(actual.version.seal_payload_version).toBe(5);
    expect(typeof actual.version.seal_hash === "string" && /^[a-f0-9]{64}$/i.test(actual.version.seal_hash)).toBe(true);
    expect(totals(actual.version)).toEqual([2000, 400, 2400]);
    expect(sendPosts).toBe(0);
    expect(collectorCallsAfter).toBe(collectorCallsBefore);
    expect(await receiptNames()).toEqual(receiptsBefore);
    await ui.browser.reload();
    await expect(ui.browser.locator('[data-seal-state="valid"]')).toHaveCount(1);
    await expectEstimateSummaryStatus(ui, "Envoyé");
    const reloaded = await readEstimate(ui.browser, p.ids.versionId);
    expect(reloaded.version.status).toBe("sent");
    expect(reloaded.version.seal_payload_version).toBe(5);
    expect(totals(reloaded.version)).toEqual([2000, 400, 2400]);
    const pdfAfter = await apiRequest<typeof pdfBefore.body>(ui.browser, "GET", `/api/estimates/${p.ids.versionId}/pdf?format=json`);
    expect(pdfAfter.status).toBe(200);
    expect(pdfAfter.body.ok).toBe(true);
    expect(pdfAfter.body.data.status).toBe("ready");
    expect(typeof pdfAfter.body.data.sha256_hash === "string" && /^[a-f0-9]{64}$/i.test(pdfAfter.body.data.sha256_hash)).toBe(true);
    expect(typeof pdfAfter.body.data.file_size_bytes === "number" && Number.isSafeInteger(pdfAfter.body.data.file_size_bytes)
      && pdfAfter.body.data.file_size_bytes > 0).toBe(true);
    await recordOfferEvidence(ui.army, "OF04-manual-reloaded", { versionId: p.ids.versionId,
      actualStatus: reloaded.version.status, sealPayloadVersion: reloaded.version.seal_payload_version,
      totals: totals(reloaded.version), pdfSha256: pdfAfter.body.data.sha256_hash, pdfSizeBytes: pdfAfter.body.data.file_size_bytes,
      previewPdfSha256: pdfBefore.body.data.sha256_hash, previewPdfSizeBytes: pdfBefore.body.data.file_size_bytes,
      finalPdfRegenerated: pdfAfter.body.data.sha256_hash !== pdfBefore.body.data.sha256_hash,
      validSealBadge: true, noSendPosts: sendPosts === 0, noNewCollectorReceipts: (await receiptNames()).length === receiptsBefore.length,
      complementaryProofComplete: false });
    const sealedHash = reloaded.version.seal_hash;
    let lifecycleState = reloaded;
    for (const transition of [
      { button: "Marquer accepté", status: "accepted" as const, badge: "Accepté" },
      { button: "Archiver", status: "archived" as const, badge: "Archivé" },
    ]) {
      expectedConcurrency = lifecycleState.version.updated_at;
      allowOfferLifecycleTransition(ui.army, p.ids.versionId, transition.status);
      const requestCountBefore = statusRequests.length;
      const [lifecycleResponse] = await Promise.all([
        ui.browser.waitForResponse(statusEndpoint, { timeout: 120000 }),
        ui.screen.getByRole("button", transition.button, { exact: true }).click(),
      ]);
      const lifecycleReply = await lifecycleResponse.json<{ ok: boolean; error?: { code?: string } }>();
      const changed = await readEstimate(ui.browser, p.ids.versionId);
      const lifecycleNetwork = (await readFile(networkFile, "utf8")).trim().split(/\r?\n/).filter(Boolean).map((entry) => JSON.parse(entry) as { role: string });
      await recordOfferEvidence(ui.army, `OF04-lifecycle-${transition.status}`, { versionId: p.ids.versionId,
        responseStatus: lifecycleResponse.status, ok: lifecycleReply.ok, errorCode: lifecycleReply.error?.code ?? null,
        expectedStatus: transition.status, actualStatus: changed.version.status, totals: totals(changed.version),
        sealPayloadVersion: changed.version.seal_payload_version ?? null, sealHashUnchanged: changed.version.seal_hash === sealedHash,
        statusRequests, sendPosts, receiptCountBefore: receiptsBefore.length, receiptCountAfter: (await receiptNames()).length,
        collectorCallsBefore, collectorCallsAfter: lifecycleNetwork.filter((entry) => entry.role === "collector").length,
        complementaryProofComplete: false });
      expect(lifecycleResponse.status).toBe(200);
      expect(lifecycleReply.ok).toBe(true);
      expect(statusRequests.length).toBe(requestCountBefore + 1);
      expect(statusRequests[requestCountBefore].concurrencyMatches).toBe(true);
      expect(changed.version.status).toBe(transition.status);
      expect(changed.version.seal_payload_version).toBe(5);
      expect(changed.version.seal_hash).toBe(sealedHash);
      expect(totals(changed.version)).toEqual([2000, 400, 2400]);
      expect(sendPosts).toBe(0);
      expect(lifecycleNetwork.filter((entry) => entry.role === "collector").length).toBe(collectorCallsBefore);
      expect(await receiptNames()).toEqual(receiptsBefore);
      await ui.browser.reload();
      await expect(ui.browser.locator('[data-seal-state="valid"]')).toHaveCount(1);
      await expectEstimateSummaryStatus(ui, transition.badge);
      lifecycleState = await readEstimate(ui.browser, p.ids.versionId);
      expect(lifecycleState.version.status).toBe(transition.status);
      expect(lifecycleState.version.seal_payload_version).toBe(5);
      expect(lifecycleState.version.seal_hash).toBe(sealedHash);
      expect(totals(lifecycleState.version)).toEqual([2000, 400, 2400]);
      const lifecyclePdf = await apiRequest<typeof pdfBefore.body>(ui.browser, "GET", `/api/estimates/${p.ids.versionId}/pdf?format=json`);
      expect(lifecyclePdf.status).toBe(200);
      expect(lifecyclePdf.body.ok).toBe(true);
      expect(lifecyclePdf.body.data.status).toBe("ready");
      expect(lifecyclePdf.body.data.sha256_hash).toBe(pdfAfter.body.data.sha256_hash);
      expect(lifecyclePdf.body.data.file_size_bytes).toBe(pdfAfter.body.data.file_size_bytes);
      await recordOfferEvidence(ui.army, `OF04-lifecycle-${transition.status}-reloaded`, { versionId: p.ids.versionId,
        status: lifecycleState.version.status, sealPayloadVersion: lifecycleState.version.seal_payload_version,
        sealHashUnchanged: lifecycleState.version.seal_hash === sealedHash, totals: totals(lifecycleState.version),
        pdfSha256: lifecyclePdf.body.data.sha256_hash, pdfSizeBytes: lifecyclePdf.body.data.file_size_bytes,
        validSealBadge: true, complementaryProofComplete: false });
    }
  } finally {
    await ui.browser.unroute(statusEndpoint);
    await ui.browser.unroute(sendEndpoint);
    await ui.browser.unroute(leasePattern);
  }
});

offerTest("OF0L another page lease prevents confirmation without takeover", options, async (ui) => {
  const p = await prepare(ui, "OF0L");
  const foreignSession = randomUUID();
  const leaseHeaders = { "x-estimate-draft-lock-session-id": foreignSession };
  const endpoint = new URL(`/api/estimates/${p.ids.versionId}/send`, ui.app.baseUrl!).href;
  let posts = 0;
  const leaseRequests: { method: string; force: boolean }[] = [];
  await ui.browser.route(new RegExp(`/api/estimates/${p.ids.versionId}/lock(?:\\?.*)?$`), async (route) => {
    const force = new URL(route.request.url).searchParams.get("force");
    leaseRequests.push({ method: route.request.method, force: force === "true" || force === "1" });
    await route.fallback();
  });
  await ui.browser.route(endpoint, async (route) => { if (route.request.method === "POST") posts++; await route.fallback(); });
  const before = await receiptNames();
  const lease = await apiRequest(ui.browser, "POST", `/api/estimates/${p.ids.versionId}/lock`, {}, leaseHeaders);
  expect(lease.status).toBe(201);
  try {
    await ui.screen.getByRole("button", "Envoyer par email", { exact: true }).click();
    const modal = ui.screen.getByRole("dialog", "Envoyer le devis par email", { exact: true });
    await modal.getByLabel("Destinataire *", { exact: true }).fill("army-lock@offer.invalid");
    await modal.getByLabel("Message *", { exact: true }).fill("ARMY contrôle du bail concurrent.");
    await expect(modal.getByText(/autre page|autre utilisateur/)).toBeVisible();
    await expect(modal.getByRole("button", "Envoyer", { exact: true })).toBeDisabled();
    const retained = await apiRequest(ui.browser, "PATCH", `/api/estimates/${p.ids.versionId}/lock`, {}, leaseHeaders);
    expect(retained.status).toBe(200);
    expect(posts).toBe(0);
    expect(leaseRequests.some((request) => request.force)).toBe(false);
    expect(await receiptNames()).toEqual(before);
    await recordOfferEvidence(ui.army, "OF0L-protected", { leaseStatus: lease.status, retainedStatus: retained.status, posts, receiptCountBefore: before.length, receiptCountAfter: before.length, leaseRequests });
    await modal.getByRole("button", "Annuler", { exact: true }).click();
  } finally {
    const release = await apiRequest(ui.browser, "DELETE", `/api/estimates/${p.ids.versionId}/lock`, {}, leaseHeaders);
    expect(release.status).toBe(200);
  }
});

offerTest("OF01 actual email CTA opens anonymously on its offer", options, async (ui) => {
  const p = await prepare(ui, "OF01");
  const result = await send(ui, "OF01", p.ids.versionId);
  const observed = await openAnonymous(ui, ui.army, "OF01", result, p.originalName);
  expect(observed.originalNamePresent).toBe(true);
  expect(observed.total24Present).toBe(true);
  await ui.browser.reload();
  await expect(ui.browser).toHaveURL(/\/portal\//);
});

offerTest("OF03 public HTML and RSC preserve sales presentation without private calculation data", options, async (ui) => {
  const p = await prepare(ui, "OF03");
  const result = await send(ui, "OF03", p.ids.versionId);
  const observed = await openAnonymous(ui, ui.army, "OF03", result, p.originalName);
  expect(observed.originalNamePresent).toBe(true);
  expect(observed.total24Present).toBe(true);
  if (!p.originalTerms) throw new Error("OF03 missing original CGV witness.");
  const forbiddenKeys = ["unit_price_ht_cents", "unitPriceHtCents", "k_fo", "kFo", "k_mo", "kMo", "h_mo", "hMo",
    "h_mo_majoration", "hMoMajoration", "h_mo_atelier", "hMoAtelier", "h_mo_chantier", "hMoChantier",
    "k_mo_atelier", "kMoAtelier", "k_mo_chantier", "kMoChantier", "labor_role_id", "labor_role_atelier_id", "labor_role_chantier_id",
    "laborRoleId", "laborRoleAtelierId", "laborRoleChantierId", "laborRateById", "isLaborSplitEnabled",
    "hourly_rate_cents", "hourlyRateCents", "margin_multiplier", "marginMultiplier",
    "margin_bp", "marginBp", "margin_mode", "marginMode", "margin_tiers", "marginTiers", "discount_bp", "discountBp",
    "discount_steps", "discountSteps", "global_coefficient", "globalCoefficient", "selected_supplier_price_id",
    "selectedSupplierPriceId", "supply_type_id", "category_id", "source_metadata", "costSubtotalCents", "cost_subtotal_cents",
    "costTotalCents", "unit_cost_ht_cents", "unitCostHtCents", "calc_snapshot_context", "calcSnapshotContext",
    "calculationContext", "snapshot_pu_ht_cents", "snapshot_fo_ht_cents", "snapshot_mo_ht_cents",
    "snapshot_mo_atelier_ht_cents", "snapshot_mo_chantier_ht_cents"];
  const witness = await ui.browser.evaluate(async (expected) => {
    const digestText = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const inspect = (value: string) => {
      const normalized = value.replace(/\\+"/g, '"').replace(/&quot;/g, '"');
      return expected.forbiddenKeys.filter((key) => new RegExp(`["']${key}["']\\s*:`).test(normalized));
    };
    const region = document.querySelector('[role="region"][aria-label="Document du devis"]');
    const regionText = region instanceof HTMLElement ? region.innerText : "";
    const rows = Array.from(region?.querySelectorAll("table tbody tr") ?? []);
    const selected = rows.filter((row) => row.textContent?.includes(expected.lineTitle));
    const cells = Array.from(selected[0]?.querySelectorAll("td") ?? []).map((cell) => (cell.textContent ?? "").trim().replace(/\s+/g, " "));
    const headers = Array.from(region?.querySelectorAll("table thead th") ?? []).map((cell) => (cell.textContent ?? "").trim().replace(/\s+/g, " "));
    const cellFor = (label: RegExp) => cells[headers.findIndex((header) => label.test(header))] ?? "";
    const sale20 = (value: string) => /^20[,.]00(?:\s*€)?$/.test(value);
    const html = await fetch(location.href, { credentials: "omit", redirect: "error" });
    const htmlBody = await html.text();
    const rsc = await fetch(location.href, { credentials: "omit", redirect: "error", headers: { RSC: "1" } });
    const rscBody = await rsc.text();
    const internal = await fetch(`/api/estimates/${expected.versionId}`, { credentials: "omit", redirect: "error" });
    const internalBody = await internal.json().catch(() => null) as { ok?: boolean; data?: unknown; error?: { code?: string } } | null;
    return {
      regionPresent: region !== null, lineCount: selected.length,
      quantityOne: /^1(?:[,.]0+)?$/.test(cellFor(/^(Qt[eé]|Quantit)/i)), unitU: cellFor(/^U(?:\.|nité)?$/i) === "u",
      unitSale20: sale20(cellFor(/P\.U\.\s*HT|Prix unitaire/i)), totalSale20: sale20(cellFor(/^Total HT$/i)),
      hasUnitSaleHeader: headers.some((header) => /P\.U\.\s*HT|Prix unitaire/i.test(header)),
      hasTotalHtHeader: headers.some((header) => /Total HT/i.test(header)),
      privateColumnLabelsPresent: headers.some((header) => /coût|débours|marge|taux horaire|heures/i.test(header)),
      originalTermsTitlePresent: regionText.includes(expected.termsTitle),
      originalTermsVersionPresent: new RegExp(`(?:version|conditions\\s*:)\\s*${expected.termsVersion}\\b`, "i").test(regionText),
      html: { status: html.status, type: html.headers.get("content-type"), bytes: new TextEncoder().encode(htmlBody).byteLength,
        sha256: await digestText(htmlBody), privateKeysFound: inspect(htmlBody) },
      rsc: { status: rsc.status, type: rsc.headers.get("content-type"), bytes: new TextEncoder().encode(rscBody).byteLength,
        sha256: await digestText(rscBody), privateKeysFound: inspect(rscBody) },
      dom: { sha256: await digestText(document.documentElement.outerHTML), privateKeysFound: inspect(document.documentElement.outerHTML) },
      internalApi: { status: internal.status, ok: internalBody?.ok ?? null, errorCode: internalBody?.error?.code ?? null,
        returnsData: internalBody?.data !== undefined && internalBody.data !== null },
    };
  }, { originalName: p.originalName, lineTitle: `${ui.army.runPrefix}-OF03-prestation`, versionId: p.ids.versionId,
    termsTitle: p.originalTerms.title, termsVersion: p.originalTerms.version, forbiddenKeys });
  await recordOfferEvidence(ui.army, "OF03-public-boundaries", { versionId: p.ids.versionId, pdfSha256: result.receipt.pdf.sha256,
    requestedPdfLayout: p.requestedPdfLayout, originalTerms: p.originalTerms, witness,
    complementaryProof: { fullOriginalDocumentAndTermsEquality: "root bounded local Doc1 read required; no full stored snapshot copied to this artifact" } });
  expect(witness.regionPresent).toBe(true);
  expect(witness.lineCount).toBe(1);
  expect(witness.quantityOne).toBe(true);
  expect(witness.unitU).toBe(true);
  expect(witness.unitSale20).toBe(true);
  expect(witness.totalSale20).toBe(true);
  expect(witness.hasUnitSaleHeader).toBe(true);
  expect(witness.hasTotalHtHeader).toBe(true);
  expect(witness.privateColumnLabelsPresent).toBe(false);
  expect(witness.originalTermsTitlePresent).toBe(true);
  expect(witness.originalTermsVersionPresent).toBe(true);
  expect(witness.html.status).toBe(200);
  expect(witness.html.type?.includes("text/html")).toBe(true);
  expect(witness.rsc.status).toBe(200);
  expect(witness.rsc.type?.includes("text/x-component")).toBe(true);
  expect(witness.html.privateKeysFound).toEqual([]);
  expect(witness.rsc.privateKeysFound).toEqual([]);
  expect(witness.dom.privateKeysFound).toEqual([]);
  expect(witness.internalApi).toEqual({ status: 401, ok: false, errorCode: "UNAUTHORIZED", returnsData: false });
  await ui.browser.reload();
  await expect(ui.browser).toHaveURL(/\/portal\//);
  await expect(ui.screen.getByRole("region", "Document du devis", { exact: true })).toContainText(`${ui.army.runPrefix}-OF03-prestation`);
  await expect(ui.screen.getByRole("region", "Document du devis", { exact: true })).toContainText(p.originalTerms.title);
});

offerTest("OF02 resend retains the original commercial identity and PDF", options, async (ui) => {
  const p = await prepare(ui, "OF02");
  const first = await send(ui, "OF02", p.ids.versionId);
  await ui.app.open(`/dashboard/affaires/${p.ids.projectId}`);
  await ui.screen.getByRole("button", "Modifier la fiche", { exact: true }).click();
  const newName = `${ui.army.runPrefix}-OF02-MODIFIE`;
  await ui.screen.getByLabel(/Nom du projet/).fill(newName);
  await ui.screen.getByLabel("Client", { exact: true }).fill("ARMY client modifié");
  await ui.screen.getByLabel("Référence", { exact: true }).fill("ARMY-REF-MODIFIEE");
  await ui.screen.getByLabel("Adresse du chantier", { exact: true }).fill("ARMY chantier modifié");
  await ui.screen.getByRole("button", "Enregistrer", { exact: true }).click();
  await expect(ui.screen.getByLabel(/Nom du projet/)).toHaveCount(0);
  await ui.browser.reload();
  await expect(ui.screen.getByRole("heading", newName, { exact: true })).toBeVisible();
  const current = await readEstimate(ui.browser, p.ids.versionId);
  expect(current.project.name).toBe(newName);
  await recordOfferEvidence(ui.army, "OF02-current-project", { projectId: p.ids.projectId, originalName: p.originalName, currentName: current.project.name });
  await ui.app.open(`/dashboard/estimates/${p.ids.versionId}`);
  const second = await send(ui, "OF02", p.ids.versionId, true);
  const comparison = { samePdf: first.receipt.pdf.sha256 === second.receipt.pdf.sha256,
    originalNameInHtml: second.packet.payload.html.includes(p.originalName), currentNameInHtml: second.packet.payload.html.includes(newName),
    originalNameInText: second.packet.payload.text.includes(p.originalName.toUpperCase()), currentNameInText: second.packet.payload.text.includes(newName.toUpperCase()) };
  await recordOfferEvidence(ui.army, "OF02-commercial-comparison", { first: first.receipt, second: second.receipt, expectedName: p.originalName, comparison });
  expect(comparison.samePdf).toBe(true);
  expect(comparison.originalNameInHtml).toBe(true);
  expect(comparison.currentNameInHtml).toBe(false);
  expect(comparison.originalNameInText).toBe(true);
  expect(comparison.currentNameInText).toBe(false);
});

type PdfLeaseObservation = { sequence: number; kind: "lock" | "pdf"; method: string; forced: boolean; sessionSha256: string | null };

async function observePdfLease(ui: OfferUi, versionId: string) {
  const observations: PdfLeaseObservation[] = [];
  const pattern = new RegExp(`/api/estimates/${versionId}/(?:lock|pdf)(?:[?].*)?$`);
  await ui.browser.route(pattern, async (route) => {
    const url = new URL(route.request.url);
    const session = route.request.headers["x-estimate-draft-lock-session-id"] ?? "";
    observations.push({ sequence: observations.length + 1, kind: url.pathname.endsWith("/lock") ? "lock" : "pdf",
      method: route.request.method, forced: ["1", "true"].includes(url.searchParams.get("force") ?? ""),
      sessionSha256: session ? digest(session) : null });
    await route.fallback();
  });
  return { observations, close: () => ui.browser.unroute(pattern) };
}

async function waitForPdfReady(ui: OfferUi, versionId: string) {
  await expect.poll(async () => ui.browser.evaluate(async (id) => {
    const response = await fetch(`/api/estimates/${id}/pdf?format=json`, { credentials: "same-origin" });
    const body = await response.json();
    return response.status === 200 && body.ok === true && body.data?.status === "ready";
  }, versionId), { timeout: 120000 }).toBe(true);
}

offerTest("PDFL1 Affaire prepares PDF using its own page lease", options, async (ui) => {
  const p = await prepare(ui, "PDFL1");
  const witness = await observePdfLease(ui, p.ids.versionId);
  try {
    await ui.app.open(`/dashboard/affaires/${p.ids.projectId}`);
    await ui.screen.getByRole("button", "Préparer le PDF", { exact: true }).click();
    const modal = ui.screen.getByRole("dialog", "Préparer le devis PDF", { exact: true });
    const confirm = modal.getByRole("button", "Générer et télécharger", { exact: true });
    await expect(confirm).toBeEnabled();
    const endpoint = new URL(`/api/estimates/${p.ids.versionId}/pdf?force=1`, ui.app.baseUrl!).href;
    const [reply] = await Promise.all([ui.browser.waitForResponse(endpoint, { timeout: 120000 }), confirm.click()]);
    expect([200, 202]).toContain(reply.status);
    await waitForPdfReady(ui, p.ids.versionId);
    await expect(modal).not.toBeVisible();
    const acquired = witness.observations.find((entry) => entry.kind === "lock" && entry.method === "POST");
    const generation = witness.observations.find((entry) => entry.kind === "pdf" && entry.method === "POST");
    expect(acquired?.sessionSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(generation?.sessionSha256).toBe(acquired?.sessionSha256);
    expect(witness.observations.some((entry) => entry.kind === "lock" && entry.forced)).toBe(false);
    const state = await readEstimate(ui.browser, p.ids.versionId);
    expect(totals(state.version)).toEqual([2000, 400, 2400]);
    await recordOfferEvidence(ui.army, "PDFL1-own-lease", { ids: p.ids, pdfStatus: reply.status,
      ready: true, totals: totals(state.version), observations: witness.observations });
  } finally { await witness.close(); }
});

offerTest("PDFL2 another page identity blocks PDF without forced takeover", options, async (ui) => {
  const p = await prepare(ui, "PDFL2");
  const headers = { "x-estimate-draft-lock-session-id": randomUUID() };
  const lease = await apiRequest(ui.browser, "POST", `/api/estimates/${p.ids.versionId}/lock`, {}, headers);
  expect(lease.status).toBe(201);
  const witness = await observePdfLease(ui, p.ids.versionId);
  const receiptsBefore = (await receiptNames()).length;
  try {
    await ui.app.open(`/dashboard/affaires/${p.ids.projectId}`);
    await ui.screen.getByRole("button", "Préparer le PDF", { exact: true }).click();
    const modal = ui.screen.getByRole("dialog", "Préparer le devis PDF", { exact: true });
    await expect(modal.getByRole("alert")).toContainText(/autre|déjà ouvert|disponible/i);
    await expect(modal.getByRole("button", "Générer et télécharger", { exact: true })).toBeDisabled();
    expect(witness.observations.some((entry) => entry.kind === "pdf" && entry.method === "POST")).toBe(false);
    expect(witness.observations.some((entry) => entry.kind === "lock" && entry.forced)).toBe(false);
    const retained = await apiRequest(ui.browser, "PATCH", `/api/estimates/${p.ids.versionId}/lock`, {}, headers);
    expect(retained.status).toBe(200);
    expect((await receiptNames()).length).toBe(receiptsBefore);
    await recordOfferEvidence(ui.army, "PDFL2-blocked", { ids: p.ids, retainedStatus: retained.status,
      observations: witness.observations, receiptCountBefore: receiptsBefore, receiptCountAfter: receiptsBefore });
    await modal.getByRole("button", "Annuler", { exact: true }).click();
  } finally {
    await witness.close();
    const released = await apiRequest(ui.browser, "DELETE", `/api/estimates/${p.ids.versionId}/lock`, {}, headers);
    expect(released.status).toBe(200);
  }
});

offerTest("PDFL3 PDF lease renews while an actual status read is held", options, async (ui) => {
  const p = await prepare(ui, "PDFL3");
  const witness = await observePdfLease(ui, p.ids.versionId);
  const statusUrl = new URL(`/api/estimates/${p.ids.versionId}/pdf?format=json`, ui.app.baseUrl!).href;
  let statusHeld = false;
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  await ui.browser.route(statusUrl, async (route) => {
    if (!statusHeld && route.request.method === "GET") { statusHeld = true; await released; }
    await route.fallback();
  });
  try {
    await ui.app.open(`/dashboard/affaires/${p.ids.projectId}`);
    await ui.screen.getByRole("button", "Préparer le PDF", { exact: true }).click();
    const modal = ui.screen.getByRole("dialog", "Préparer le devis PDF", { exact: true });
    const confirm = modal.getByRole("button", "Générer et télécharger", { exact: true });
    await expect(confirm).toBeEnabled();
    const endpoint = new URL(`/api/estimates/${p.ids.versionId}/pdf?force=1`, ui.app.baseUrl!).href;
    const [reply] = await Promise.all([ui.browser.waitForResponse(endpoint, { timeout: 120000 }), confirm.click()]);
    expect(reply.status).toBe(202);
    await expect.poll(() => statusHeld, { timeout: 30000 }).toBe(true);
    const postSequence = witness.observations.find((entry) => entry.kind === "pdf" && entry.method === "POST")!.sequence;
    await expect.poll(() => witness.observations.some((entry) => entry.kind === "lock" && entry.method === "PATCH"
      && entry.sequence > postSequence), { timeout: 30000 }).toBe(true);
    await expect(modal).toBeVisible();
    await expect(confirm).toBeDisabled();
    expect(witness.observations.some((entry) => entry.kind === "lock" && entry.method === "DELETE")).toBe(false);
    const refused = await apiRequest(ui.browser, "POST", `/api/estimates/${p.ids.versionId}/lock`, {},
      { "x-estimate-draft-lock-session-id": randomUUID() });
    expect(refused.status).toBe(409);
    release();
    await waitForPdfReady(ui, p.ids.versionId);
    await expect(modal).not.toBeVisible();
    await recordOfferEvidence(ui.army, "PDFL3-polling-lease", { ids: p.ids, actualPostStatus: reply.status,
      heldRealStatusRead: statusHeld, conflictingAcquireStatus: refused.status, observations: witness.observations });
  } finally { release(); await ui.browser.unroute(statusUrl); await witness.close(); }
});

offerTest("PDFL4 read-only print layout never acquires a draft lease", options, async (ui) => {
  const p = await prepare(ui, "PDFL4");
  const headers = { "x-estimate-draft-lock-session-id": randomUUID() };
  const lease = await apiRequest(ui.browser, "POST", `/api/estimates/${p.ids.versionId}/lock`, {}, headers);
  expect(lease.status).toBe(201);
  const witness = await observePdfLease(ui, p.ids.versionId);
  try {
    await ui.app.open(`/dashboard/estimates/${p.ids.versionId}/print`);
    await ui.screen.getByRole("button", "Mise en page / imprimer", { exact: true }).click();
    const modal = ui.screen.getByRole("dialog", "Préparer le devis PDF", { exact: true });
    const confirm = modal.getByRole("button", "Appliquer et imprimer", { exact: true });
    await expect(confirm).toBeEnabled();
    await modal.getByRole("button", /Devis synthétique/).click();
    await confirm.click();
    await expect(modal).not.toBeVisible();
    expect(witness.observations.filter((entry) => entry.kind === "lock")).toHaveLength(0);
    expect(witness.observations.some((entry) => entry.kind === "pdf" && entry.method === "POST")).toBe(false);
    const retained = await apiRequest(ui.browser, "PATCH", `/api/estimates/${p.ids.versionId}/lock`, {}, headers);
    expect(retained.status).toBe(200);
    await recordOfferEvidence(ui.army, "PDFL4-print-read-only", { ids: p.ids, foreignLeaseRetained: retained.status === 200,
      observationsBeforeIndependentRenewal: witness.observations.slice(0, -1), physicalPrinterProof: false });
  } finally {
    await witness.close();
    const released = await apiRequest(ui.browser, "DELETE", `/api/estimates/${p.ids.versionId}/lock`, {}, headers);
    expect(released.status).toBe(200);
  }
});

offerTest("PDFL5 closing PDF preserves the parent editor lease", options, async (ui) => {
  const p = await prepare(ui, "PDFL5");
  await ui.app.open(`/dashboard/estimates/${p.ids.versionId}/edit`);
  await expect(ui.screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible();
  const witness = await observePdfLease(ui, p.ids.versionId);
  try {
    await ui.screen.getByTestId("estimate-page-toolbar-more-actions-button").click();
    await ui.screen.getByRole("button", "Préparer le PDF", { exact: true }).click();
    const modal = ui.screen.getByRole("dialog", "Préparer le devis PDF", { exact: true });
    await expect(modal.getByRole("button", "Générer et télécharger", { exact: true })).toBeEnabled();
    await modal.getByRole("button", "Annuler", { exact: true }).click();
    await expect(modal).not.toBeVisible();
    const retained = await ui.browser.evaluate(async (versionId) => {
      const scope = globalThis as typeof globalThis & { __miaouffrageEstimateDraftLockSessions?: Map<string, string> };
      const session = scope.__miaouffrageEstimateDraftLockSessions?.get(versionId);
      if (!session) return { status: 0, current: false };
      const response = await fetch(`/api/estimates/${versionId}/lock`, { method: "PATCH", credentials: "same-origin",
        headers: { "x-estimate-draft-lock-session-id": session } });
      const body = await response.json();
      return { status: response.status, current: body.ok === true && body.data?.lock?.is_current_session === true };
    }, p.ids.versionId);
    expect(retained).toEqual({ status: 200, current: true });
    expect(witness.observations.some((entry) => entry.kind === "lock" && entry.method === "DELETE")).toBe(false);
    await recordOfferEvidence(ui.army, "PDFL5-parent-lease", { ids: p.ids, retained, observations: witness.observations });
  } finally { await witness.close(); }
});

offerTest("PDFL6 PDF freeze reconciles editor tokens and real line snapshots before the next save", options, async (ui) => {
  const p = await prepare(ui, "PDFL6");
  await ui.app.open(`/dashboard/estimates/${p.ids.versionId}/edit`);
  await expect(ui.screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible();
  const before = await readEstimate(ui.browser, p.ids.versionId);
  await recordOfferEvidence(ui.army, "PDFL6-before", { ids: p.ids, calcEngineVersion: before.version.calc_engine_version,
    updatedAt: before.version.updated_at, contentRevision: before.version.content_revision,
    snapshotRevision: before.version.calc_snapshot_content_revision, totals: totals(before.version) });
  if (before.version.calc_engine_version !== 2) throw new Error("PDFL6 missing prerequisite: actual engine2 draft required.");
  expect(totals(before.version)).toEqual([2000, 400, 2400]);
  const line = before.items.find((item) => item.item_type === "line")!;
  expect(line.quantity).toBe(1);
  const title = `${ui.army.runPrefix}-PDFL6-pending-title`;
  await ui.screen.getByTestId("estimate-line-title-input").fill(title);
  await ui.browser.keyboard.press("Tab");
  await ui.screen.getByTestId("estimate-page-toolbar-more-actions-button").click();
  await ui.screen.getByRole("button", "Préparer le PDF", { exact: true }).click();
  const modal = ui.screen.getByRole("dialog", "Préparer le devis PDF", { exact: true });
  const generate = modal.getByRole("button", "Générer et télécharger", { exact: true });
  await expect(generate).toBeEnabled();
  const endpoint = new URL(`/api/estimates/${p.ids.versionId}/pdf?force=1`, ui.app.baseUrl!).href;
  const [generation] = await Promise.all([ui.browser.waitForResponse(endpoint, { timeout: 120000 }), generate.click()]);
  await recordOfferEvidence(ui.army, "PDFL6-generation-reply", { status: generation.status });
  expect([200, 202]).toContain(generation.status);
  await waitForPdfReady(ui, p.ids.versionId);
  await expect(modal).not.toBeVisible();
  // Deliberately no navigation/reload between generation and the next edit.
  const afterPdf = await readEstimate(ui.browser, p.ids.versionId);
  const frozenLine = afterPdf.items.find((item) => item.id === line.id)!;
  expect(frozenLine).toMatchObject({ title, quantity: 1, line_total_ht_cents: 2000,
    line_tax_cents: 400, line_total_ttc_cents: 2400, snapshot_pu_ht_cents: 2000,
    snapshot_fo_ht_cents: 2000, snapshot_mo_ht_cents: 0 });
  expect(totals(afterPdf.version)).toEqual([2000, 400, 2400]);
  expect(afterPdf.version.calc_snapshot_content_revision).toBe(afterPdf.version.content_revision);
  expect(afterPdf.version.updated_at).not.toBe(before.version.updated_at);
  await expect(ui.screen.getByLabel(`Quantité pour ${title}`, { exact: true })).toHaveValue("1");
  const saveUrl = new URL(`/api/estimates/${p.ids.versionId}/batch`, ui.app.baseUrl!).href;
  const saveReply = ui.browser.waitForResponse(saveUrl, { timeout: 60000 });
  await ui.screen.getByLabel(`Quantité pour ${title}`, { exact: true }).fill("2");
  await ui.browser.keyboard.press("Tab");
  await ui.browser.keyboard.press("Control+s");
  const saved = await saveReply;
  await recordOfferEvidence(ui.army, "PDFL6-next-save-reply", { status: saved.status,
    baselineAfterPdf: { updatedAt: afterPdf.version.updated_at, contentRevision: afterPdf.version.content_revision } });
  expect(saved.status).toBe(200);
  await expect.poll(async () => totals((await readEstimate(ui.browser, p.ids.versionId)).version), { timeout: 45000 }).toEqual([4000, 800, 4800]);
  await expect(ui.screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/^(À jour|Sauvegardé)$/);
  const persisted = await readEstimate(ui.browser, p.ids.versionId);
  expect(persisted.items.find((item) => item.id === line.id)).toMatchObject({ title, quantity: 2,
    line_total_ht_cents: 4000, line_tax_cents: 800, line_total_ttc_cents: 4800 });
  await ui.browser.reload();
  await expect(ui.screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible();
  const reloaded = await readEstimate(ui.browser, p.ids.versionId);
  expect(totals(reloaded.version)).toEqual([4000, 800, 4800]);
  expect(reloaded.items.find((item) => item.id === line.id)).toMatchObject({ title, quantity: 2,
    line_total_ht_cents: 4000, line_tax_cents: 800, line_total_ttc_cents: 4800 });
  await expect(ui.screen.getByLabel(`Quantité pour ${title}`, { exact: true })).toHaveValue("2");
  await recordOfferEvidence(ui.army, "PDFL6-reconciled", { ids: p.ids, lineId: line.id,
    afterPdf: { updatedAt: afterPdf.version.updated_at, contentRevision: afterPdf.version.content_revision,
      snapshotRevision: afterPdf.version.calc_snapshot_content_revision, totals: totals(afterPdf.version) },
    final: { quantity: 2, totals: totals(reloaded.version), titlePreserved: true }, savedStatus: saved.status,
    noReloadBeforeNextSave: true });
});
// Append to the existing local suite after GO, before the read-recovery fix.
offerTest("PDFL7 interrupted post-freeze read blocks stale writes and recovers pending edits without a new PDF POST", options, async (ui) => {
  const p = await prepare(ui, "PDFL7");
  await ui.app.open(`/dashboard/estimates/${p.ids.versionId}/edit`);
  await expect(ui.screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible();
  const before = await readEstimate(ui.browser, p.ids.versionId);
  if (before.version.calc_engine_version !== 2) throw new Error("PDFL7 missing prerequisite: actual engine2 draft required.");
  const line = before.items.find((item) => item.item_type === "line")!;
  expect(totals(before.version)).toEqual([2000, 400, 2400]);
  await ui.screen.getByTestId("estimate-page-toolbar-more-actions-button").click();
  const toggle = ui.screen.getByTestId("estimate-page-toolbar-autosave-toggle");
  const restoreAutoSave = !((await toggle.textContent()) ?? "").includes("Désactivée");
  if (restoreAutoSave) await toggle.click();
  await expect(toggle).toContainText("Désactivée");
  await ui.screen.getByTestId("estimate-page-toolbar-more-actions-button").click();
  const title = `${ui.army.runPrefix}-PDFL7-pending-title`;
  await ui.screen.getByTestId("estimate-line-title-input").fill(title);
  await ui.browser.keyboard.press("Tab");
  const pdfUrl = new URL(`/api/estimates/${p.ids.versionId}/pdf?force=1`, ui.app.baseUrl!).href;
  const ownerUrl = new URL(`/api/estimates/${p.ids.versionId}`, ui.app.baseUrl!).href;
  const batchUrl = new URL(`/api/estimates/${p.ids.versionId}/batch`, ui.app.baseUrl!).href;
  let pdfPosts = 0;
  let batchPosts = 0;
  let readAborts = 0;
  let abortReads = true;
  let bodyFailed = false;
  await ui.browser.route(pdfUrl, async (route) => {
    if (route.request.method === "POST") pdfPosts += 1;
    await route.fallback();
  });
  await ui.browser.route(batchUrl, async (route) => {
    if (route.request.method === "POST") batchPosts += 1;
    await route.fallback();
  });
  await ui.browser.route(ownerUrl, async (route) => {
    if (route.request.method === "GET" && pdfPosts > 0 && abortReads) {
      readAborts += 1;
      await route.abort();
      return;
    }
    await route.fallback();
  });
  try {
    await ui.screen.getByTestId("estimate-page-toolbar-more-actions-button").click();
    await ui.screen.getByRole("button", "Préparer le PDF", { exact: true }).click();
    const modal = ui.screen.getByRole("dialog", "Préparer le devis PDF", { exact: true });
    const generate = modal.getByRole("button", "Générer et télécharger", { exact: true });
    await expect(generate).toBeEnabled();
    await startPdfReadDiagnostic(ui.browser, new URL(ownerUrl).pathname);
    const [generation] = await Promise.all([ui.browser.waitForResponse(pdfUrl, { timeout: 120000 }), generate.click()]);
    expect(generation.status).toBe(202);
    await expect.poll(() => readAborts, { timeout: 30000 }).toBeGreaterThan(0);
    await expect(modal.getByRole("alert")).toContainText("la lecture du devis a échoué");
    await modal.getByRole("button", "Annuler", { exact: true }).click();
    await closePdfActionsMenu(ui);
    const recovery = ui.screen.getByTestId("estimate-editor-alert-batch-recovery");
    await expect(recovery).toContainText("la lecture du devis a échoué");
    await expect(recovery.getByRole("button", "Reprendre cette opération", { exact: true })).toHaveCount(0);
    const batchPostsAtFailure = batchPosts;
    const quantity = ui.screen.getByLabel(`Quantité pour ${title}`, { exact: true });
    await quantity.fill("2");
    await ui.browser.keyboard.press("Tab");
    await ui.browser.keyboard.press("Control+s");
    await expect(ui.screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText("Résultat à vérifier");
    await expect(quantity).toHaveValue("2");
    expect(batchPosts).toBe(batchPostsAtFailure);
    const firstAborts = readAborts;
    await recovery.getByRole("button", "Vérifier le résultat", { exact: true }).click();
    await expect.poll(() => readAborts, { timeout: 30000 }).toBeGreaterThan(firstAborts);
    await expect(recovery).toBeVisible();
    await expect(quantity).toHaveValue("2");
    expect(batchPosts).toBe(batchPostsAtFailure);
    expect(pdfPosts).toBe(1);
    abortReads = false;
    const [reread] = await Promise.all([ui.browser.waitForResponse(ownerUrl, { timeout: 60000 }),
      recovery.getByRole("button", "Vérifier le résultat", { exact: true }).click()]);
    expect(reread.status).toBe(200);
    await expect(recovery).toHaveCount(0);
    await expect(quantity).toHaveValue("2");
    expect(pdfPosts).toBe(1);
    const saveReply = ui.browser.waitForResponse(batchUrl, { timeout: 60000 });
    await ui.browser.keyboard.press("Control+s");
    const saved = await saveReply;
    expect(saved.status).toBe(200);
    await expect.poll(async () => totals((await readEstimate(ui.browser, p.ids.versionId)).version), { timeout: 45000 }).toEqual([4000, 800, 4800]);
    const persisted = await readEstimate(ui.browser, p.ids.versionId);
    expect(persisted.items.find((item) => item.id === line.id)).toMatchObject({ title, quantity: 2,
      line_total_ht_cents: 4000, line_tax_cents: 800, line_total_ttc_cents: 4800 });
    await ui.browser.reload();
    await expect(ui.screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible();
    const reloaded = await readEstimate(ui.browser, p.ids.versionId);
    expect(totals(reloaded.version)).toEqual([4000, 800, 4800]);
    expect(reloaded.items.find((item) => item.id === line.id)).toMatchObject({ title, quantity: 2,
      line_total_ht_cents: 4000, line_tax_cents: 800, line_total_ttc_cents: 4800 });
    await recordOfferEvidence(ui.army, "PDFL7-read-recovery", { ids: p.ids, lineId: line.id, generationStatus: generation.status,
      actualReadAborts: readAborts, recoveredReadStatus: reread.status, pdfPosts, blockedBatchPosts: batchPostsAtFailure,
      finalSaveStatus: saved.status, finalTotals: totals(reloaded.version), pendingQuantityPreserved: true, noReloadBeforeSave: true });
  } catch (error) {
    bodyFailed = true;
    throw error;
  } finally {
    abortReads = false;
    const cleanupErrors: string[] = [];
    try {
      await recordOfferEvidence(ui.army, "PDFL7-read-lifecycle", { ids: p.ids,
        ...await finishPdfReadDiagnostic(ui.browser), limit: 64,
        contents: "Owned request method/path/status/stack; DOM instance numbers and fixed error categories; no bodies/headers/query/token/sessionID" });
    } catch { cleanupErrors.push("diagnostic-unavailable"); }
    for (const url of [pdfUrl, ownerUrl, batchUrl]) {
      try { await ui.browser.unroute(url); } catch { cleanupErrors.push("unroute-failed"); }
    }
    let modalClosed = false;
    let toolbarAvailable = false;
    let preferenceRestored = !restoreAutoSave;
    try {
      const modal = ui.screen.getByRole("dialog", "Préparer le devis PDF", { exact: true });
      if (await modal.isVisible()) {
        const cancel = modal.getByRole("button", "Annuler", { exact: true });
        if (await cancel.isEnabled()) {
          await cancel.click();
          await expect(modal).not.toBeVisible();
        } else { cleanupErrors.push("modal-still-submitting"); }
      }
      modalClosed = !(await modal.isVisible());
      if (modalClosed) {
        const toolbar = ui.screen.getByTestId("estimate-page-toolbar-more-actions-button");
        toolbarAvailable = await toolbar.isVisible();
        if (restoreAutoSave && toolbarAvailable) {
          const toggle = ui.screen.getByTestId("estimate-page-toolbar-autosave-toggle");
          if (!(await toggle.isVisible())) await toolbar.click();
          await toggle.click();
          preferenceRestored = true;
        }
      }
    } catch { cleanupErrors.push("preference-restore-failed"); }
    try {
      await recordOfferEvidence(ui.army, "PDFL7-cleanup", { restoreAutoSaveRequested: restoreAutoSave,
        modalClosed, toolbarAvailable, preferenceRestored, cleanupErrors, primaryBodyFailed: bodyFailed });
    } catch (error) { if (!bodyFailed) throw error; }
    if (!bodyFailed && cleanupErrors.length > 0) throw new Error(`PDFL7 cleanup failed: ${cleanupErrors.join(", ")}`);
  }
});

offerTest("PDFL8 interrupted PDF read blocks catalogue edits of a newly created ARMY labor role", options, async (ui) => {
  const p = await prepare(ui, "PDFL8");
  await ui.app.open(`/dashboard/estimates/${p.ids.versionId}/edit`);
  await expect(ui.screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible();
  const before = await readEstimate(ui.browser, p.ids.versionId);
  if (before.version.calc_engine_version !== 2 || typeof before.version.tenant_id !== "string") throw new Error("PDFL8 missing prerequisite: owned engine2/tenant draft required.");
  expect(totals(before.version)).toEqual([2000, 400, 2400]);
  const roleName = `${ui.army.runPrefix}-PDFL8-MO`;
  await ui.screen.getByRole("button", /^Marge :/).click();
  const drawer = ui.screen.getByRole("dialog", "Paramétrage du devis", { exact: true, visible: true });
  await expect(drawer).toHaveCount(1);
  const roleForm = ui.browser.locator('[role="dialog"][aria-label="Paramétrage du devis"] .estimate-role-form')
    .filter({ has: ui.screen.getByLabel("Nom du rôle", { exact: true, visible: true }) });
  await expect(roleForm).toHaveCount(1);
  await drawer.getByLabel("Nom du rôle", { exact: true }).fill(roleName);
  await drawer.getByLabel("Taux horaire (EUR)", { exact: true }).fill("0");
  const rolesUrl = new URL(`/api/estimates/${p.ids.versionId}/labor-roles`, ui.app.baseUrl!).href;
  const [created] = await Promise.all([ui.browser.waitForResponse(rolesUrl, { timeout: 60000 }),
    roleForm.getByRole("button", "Ajouter", { exact: true }).click()]);
  expect(created.status).toBe(201);
  const createdRole = await created.json<{ ok: boolean; data: { labor_role: { id: string; tenant_id: string; name: string; hourly_rate_cents: number } } }>();
  expect(createdRole.ok).toBe(true);
  const role = createdRole.data.labor_role;
  expect(role).toMatchObject({ name: roleName, tenant_id: before.version.tenant_id, hourly_rate_cents: 0 });
  allowOfferLaborRoleUpdate(ui.army, p.ids.versionId, role, before.version.tenant_id);
  await ui.screen.getByTestId("estimate-editor-drawer-close-button").click();
  const roleUrl = new URL(`${rolesUrl}/${role.id}`).href;
  const pdfUrl = new URL(`/api/estimates/${p.ids.versionId}/pdf?force=1`, ui.app.baseUrl!).href;
  const ownerUrl = new URL(`/api/estimates/${p.ids.versionId}`, ui.app.baseUrl!).href;
  let pdfPosts = 0;
  let roleWrites = 0;
  let abortReads = true;
  await ui.browser.route(pdfUrl, async (route) => { if (route.request.method === "POST") pdfPosts++; await route.fallback(); });
  await ui.browser.route(roleUrl, async (route) => { if (["POST", "PATCH", "PUT", "DELETE"].includes(route.request.method)) roleWrites++; await route.fallback(); });
  await ui.browser.route(ownerUrl, async (route) => {
    if (pdfPosts > 0 && abortReads && route.request.method === "GET") { await route.abort(); return; }
    await route.fallback();
  });
  const probeRole = () => ui.browser.evaluate(async (input) => {
    const response = await fetch(`/api/estimates/${input.versionId}?army_role_probe=1`, { credentials: "same-origin" });
    const body = await response.json();
    const roles = body.data?.laborRoles ?? body.data?.labor_roles ?? [];
    const role = roles.find((entry: { id: string }) => entry.id === input.roleId);
    return { status: response.status, rate: role?.hourly_rate_cents ?? null, name: role?.name ?? null,
      totals: [body.data?.version?.total_ht_cents, body.data?.version?.total_tax_cents, body.data?.version?.total_ttc_cents] };
  }, { versionId: p.ids.versionId, roleId: role.id });
  try {
    await ui.screen.getByTestId("estimate-page-toolbar-more-actions-button").click();
    await ui.screen.getByRole("button", "Préparer le PDF", { exact: true }).click();
    const modal = ui.screen.getByRole("dialog", "Préparer le devis PDF", { exact: true });
    const generate = modal.getByRole("button", "Générer et télécharger", { exact: true });
    await expect(generate).toBeEnabled();
    const [generation] = await Promise.all([ui.browser.waitForResponse(pdfUrl, { timeout: 120000 }), generate.click()]);
    expect(generation.status).toBe(202);
    await expect(modal.getByRole("alert")).toContainText("la lecture du devis a échoué");
    await modal.getByRole("button", "Annuler", { exact: true }).click();
    await closePdfActionsMenu(ui);
    await ui.screen.getByRole("button", /^Marge :/).click();
    const rate = drawer.getByLabel(`Taux horaire du rôle ${roleName} (EUR)`, { exact: true });
    // A regressed candidate may mutate only this newly created ARMY role.
    if (!(await rate.isDisabled())) { await rate.fill("75.00"); await rate.press("Tab"); }
    const sourceBlocked = await probeRole();
    await recordOfferEvidence(ui.army, "PDFL8-blocked-role", { ids: p.ids, roleId: role.id,
      roleName, sourceBlocked, attemptedWrites: roleWrites, createdByActualUi: true, unrelatedRolesTouched: false });
    await expect(rate).toBeDisabled();
    await expect(rate).toHaveValue("0.00");
    await expect(drawer.getByLabel(`Libellé du rôle ${roleName}`, { exact: true })).toBeDisabled();
    await expect(drawer.getByLabel(`Rôle ${roleName} actif`, { exact: true })).toBeDisabled();
    expect(roleWrites).toBe(0);
    expect(sourceBlocked).toEqual({ status: 200, rate: 0, name: roleName, totals: [2000, 400, 2400] });
    await ui.screen.getByTestId("estimate-editor-drawer-close-button").click();
    abortReads = false;
    const recovery = ui.screen.getByTestId("estimate-editor-alert-batch-recovery");
    const [reread] = await Promise.all([ui.browser.waitForResponse(ownerUrl, { timeout: 60000 }),
      recovery.getByRole("button", "Vérifier le résultat", { exact: true }).click()]);
    expect(reread.status).toBe(200);
    await expect(recovery).toHaveCount(0);
    await ui.screen.getByRole("button", /^Marge :/).click();
    await expect(rate).toBeEnabled();
    const patchReply = ui.browser.waitForResponse(roleUrl, { timeout: 60000 });
    await rate.fill("1.00");
    await rate.press("Tab");
    const updated = await patchReply;
    expect(updated.status).toBe(200);
    await expect.poll(async () => (await probeRole()).rate, { timeout: 30000 }).toBe(100);
    expect(roleWrites).toBe(1);
    expect(pdfPosts).toBe(1);
    await ui.screen.getByTestId("estimate-editor-drawer-close-button").click();
    await ui.browser.reload();
    const sourceAfter = await probeRole();
    expect(sourceAfter).toEqual({ status: 200, rate: 100, name: roleName, totals: [2000, 400, 2400] });
    await recordOfferEvidence(ui.army, "PDFL8-recovered-role", { ids: p.ids, roleId: role.id,
      sourceAfter, recoveredReadStatus: reread.status, actualPatchStatus: updated.status, pdfPosts, roleWrites,
      roleUnassignedToEstimateLines: true, fixtureRoleRetained: true });
  } finally {
    abortReads = false;
    await ui.browser.unroute(pdfUrl);
    await ui.browser.unroute(ownerUrl);
    await ui.browser.unroute(roleUrl);
  }
});


// EF failures and SDK fallback precede this code in the staged precode plan.
type EfCase = "EF01" | "EF02" | "EF03";
type EfProbeEvent = {
  originalIfMatchPresent: boolean; originalIfMatchMatchesGet: boolean;
  originalOwnSessionPresent: boolean; originalOwnSessionSha256: string | null;
  sentIfMatchMatchesInjected: boolean; sentOwnSessionPresent: boolean;
  bodyPreserved: boolean; methodPreserved: boolean; credentialsPreserved: boolean;
  signalPreserved: boolean; idempotencyPreserved: boolean;
};
type EfProbeWindow = Window & {
  __armyEmailHeaderProbe?: { events: EfProbeEvent[]; restore: () => boolean };
};

function efSourceFingerprint(state: Awaited<ReturnType<typeof readEstimate>>) {
  return digest(JSON.stringify({ version: state.version,
    items: [...state.items].sort((left, right) => left.id.localeCompare(right.id)) }));
}

function efOlderMicrosecondToken(original: string) {
  const match = original.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{1,6})(Z|[+-]\d{2}:\d{2})$/);
  if (!match || !Number.isFinite(Date.parse(original))) throw new Error("EF02 missing fixture: exact fractional owner timestamp required.");
  const fraction = Number(match[2].padEnd(6, "0"));
  if (fraction % 1000 === 0) throw new Error("EF02 missing fixture: older1µs in same JS millisecond unavailable at this boundary.");
  const older = `${match[1]}.${String(fraction - 1).padStart(6, "0")}${match[3]}`;
  if (older === original || !Number.isFinite(Date.parse(older)) || Date.parse(older) !== Date.parse(original)) {
    throw new Error("EF02 missing fixture: exact older1µs must retain original JS millisecond.");
  }
  return older;
}

async function efInstallHeaderProbe(browser: Browser, endpoint: string, originalToken: string, injectedToken: string, dropSession: boolean) {
  await browser.evaluate(({ endpoint, originalToken, injectedToken, dropSession }) => {
    const scope = window as EfProbeWindow;
    scope.__armyEmailHeaderProbe?.restore();
    const originalFetch = window.fetch;
    const events: EfProbeEvent[] = [];
    let attempts = 0;
    const wrapped: typeof window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (url.href !== endpoint || method !== "POST" || attempts++ > 0) return originalFetch.call(window, input, init);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const originalIfMatch = headers.get("if-match") ?? "";
      const session = headers.get("x-estimate-draft-lock-session-id") ?? "";
      const idempotency = headers.get("idempotency-key");
      headers.set("if-match", injectedToken);
      if (dropSession) headers.delete("x-estimate-draft-lock-session-id");
      const forwarded = { ...init, headers };
      const sessionHash = session ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(session))))
        .map((byte) => byte.toString(16).padStart(2, "0")).join("") : null;
      events.push({ originalIfMatchPresent: originalIfMatch.length > 0, originalIfMatchMatchesGet: originalIfMatch === originalToken,
        originalOwnSessionPresent: /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(session), originalOwnSessionSha256: sessionHash,
        sentIfMatchMatchesInjected: headers.get("if-match") === injectedToken, sentOwnSessionPresent: headers.has("x-estimate-draft-lock-session-id"),
        bodyPreserved: forwarded.body === init?.body, methodPreserved: forwarded.method === init?.method,
        credentialsPreserved: forwarded.credentials === init?.credentials, signalPreserved: forwarded.signal === init?.signal,
        idempotencyPreserved: headers.get("idempotency-key") === idempotency });
      return originalFetch.call(window, input, forwarded);
    };
    const probe = { events, restore: () => {
      const own = window.fetch === wrapped;
      if (own) window.fetch = originalFetch;
      if (scope.__armyEmailHeaderProbe === probe) delete scope.__armyEmailHeaderProbe;
      return own;
    } };
    scope.__armyEmailHeaderProbe = probe;
    window.fetch = wrapped;
    return true;
  }, { endpoint, originalToken, injectedToken, dropSession });
}

async function efReadAndRestoreProbe(browser: Browser) {
  return browser.evaluate(() => {
    const scope = window as EfProbeWindow;
    const probe = scope.__armyEmailHeaderProbe;
    const events = probe?.events ?? [];
    return { present: !!probe, restored: probe ? probe.restore() : false, events };
  });
}

async function efExerciseFirstSend(ui: OfferUi, caseId: EfCase) {
  const prepared = await prepare(ui, caseId);
  const before = await readEstimate(ui.browser, prepared.ids.versionId);
  const originalToken = before.version.updated_at;
  const beforeFingerprint = efSourceFingerprint(before);
  const injectedToken = caseId === "EF02" ? efOlderMicrosecondToken(originalToken) : originalToken;
  const endpoint = new URL(`/api/estimates/${prepared.ids.versionId}/send`, ui.app.baseUrl!).href;
  const leasePattern = new RegExp(`/api/estimates/${prepared.ids.versionId}/lock(?:\\?.*)?$`);
  const beforeReceipts = await receiptNames();
  const requests: { ifMatchPresent: boolean; ifMatchSha256: string | null; matchesOriginalGet: boolean; matchesInjected: boolean;
    ownSessionPresent: boolean; ownSessionSha256: string | null }[] = [];
  const leases: { method: string; forced: boolean; sessionSha256: string | null }[] = [];
  await recordOfferEvidence(ui.army, `${caseId}-before-open`, { ids: prepared.ids, status: before.version.status, totals: totals(before.version),
    sourceFingerprint: beforeFingerprint, originalUpdatedAtSha256: digest(originalToken), originalReadBeforeModal: true,
    injectedUpdatedAtSha256: digest(injectedToken), microsecondDifference: caseId === "EF02" ? 1 : 0,
    sameJsMillisecond: Date.parse(injectedToken) === Date.parse(originalToken), zeroDbCountsQualified: false });
  await ui.browser.route(endpoint, async (route) => {
    if (route.request.method === "POST") {
      const token = route.request.headers["if-match"] ?? "";
      const session = route.request.headers["x-estimate-draft-lock-session-id"] ?? "";
      requests.push({ ifMatchPresent: token.length > 0, ifMatchSha256: token ? digest(token) : null,
        matchesOriginalGet: token === originalToken, matchesInjected: token === injectedToken,
        ownSessionPresent: /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(session), ownSessionSha256: session ? digest(session) : null });
    }
    // Observe the REAL request and its REAL response. No assertion/abort/mock here.
    await route.fallback();
  });
  await ui.browser.route(leasePattern, async (route) => {
    const force = new URL(route.request.url).searchParams.get("force");
    const session = route.request.headers["x-estimate-draft-lock-session-id"] ?? "";
    leases.push({ method: route.request.method, forced: force === "true" || force === "1", sessionSha256: session ? digest(session) : null });
    await route.fallback();
  });
  const modal = ui.screen.getByRole("dialog", "Envoyer le devis par email", { exact: true });
  let primaryBodyFailed = true;
  let probeRestored = caseId === "EF01";
  const cleanupErrors: string[] = [];
  try {
    if (caseId !== "EF01") await efInstallHeaderProbe(ui.browser, endpoint, originalToken, injectedToken, caseId === "EF03");
    await ui.screen.getByRole("button", "Envoyer par email", { exact: true }).click();
    await expect(modal).toBeVisible();
    await modal.getByLabel("Destinataire *", { exact: true }).fill(`army-${caseId.toLowerCase()}@offer.invalid`);
    await modal.getByLabel("Objet *", { exact: true }).fill(`${caseId} contrôle bail et concurrence`);
    await modal.getByLabel("Message *", { exact: true }).fill("ARMY vérification des données réellement confirmées.");
    await expect(modal.getByRole("button", "Envoyer", { exact: true })).toBeEnabled();
    const [response] = await Promise.all([ui.browser.waitForResponse(endpoint, { timeout: 120000 }),
      modal.getByRole("button", "Envoyer", { exact: true }).click()]);
    const reply = await response.json<{ ok: boolean; error?: { code?: string }; data?: { message_id?: string } }>();
    const after = await readEstimate(ui.browser, prepared.ids.versionId);
    const receiptsAfter = await receiptNames();
    const probe = caseId === "EF01" ? { present: false, restored: false, events: [] as EfProbeEvent[] } : await efReadAndRestoreProbe(ui.browser);
    probeRestored = caseId === "EF01" || probe.restored;
    const requestSession = caseId === "EF03" ? probe.events[0]?.originalOwnSessionSha256 : requests[0]?.ownSessionSha256;
    const leaseMatches = !!requestSession && leases.some((lease) => ["POST", "PATCH"].includes(lease.method) && lease.sessionSha256 === requestSession);
    const fingerprintAfter = efSourceFingerprint(after);
    await recordOfferEvidence(ui.army, `${caseId}-actual-response`, { ids: prepared.ids, responseStatus: response.status, ok: reply.ok,
      errorCode: reply.error?.code ?? null, statusAfter: after.version.status, totalsAfter: totals(after.version),
      sourceFingerprintBefore: beforeFingerprint, sourceFingerprintAfter: fingerprintAfter, sourceUnchanged: fingerprintAfter === beforeFingerprint,
      receiptCountBefore: beforeReceipts.length, receiptCountAfter: receiptsAfter.length, requests, leases, leaseMatches,
      headerProbe: probe, originalReadBeforeModal: true, microsecondDifference: caseId === "EF02" ? 1 : 0,
      sameJsMillisecond: Date.parse(injectedToken) === Date.parse(originalToken),
      complementaryProof: { databaseIntentAndCapabilityCounts: "root independent native read required", zeroDbCountsQualified: false } });
    // All assertions follow the actual HTTP/body and preserved failure witness.
    expect(requests.length).toBe(1);
    expect(leaseMatches).toBe(true);
    expect(leases.some((lease) => lease.forced)).toBe(false);
    expect(probeRestored).toBe(true);
    if (caseId === "EF01") {
      expect(response.status).toBe(200);
      expect(reply.ok).toBe(true);
      expect(requests[0].matchesOriginalGet).toBe(true);
      expect(requests[0].ownSessionPresent).toBe(true);
      expect(after.version.status).toBe("sent");
      expect(after.version.seal_payload_version).toBe(5);
      expect(totals(after.version)).toEqual([2000, 400, 2400]);
      expect(receiptsAfter.length).toBe(beforeReceipts.length + 1);
    } else {
      expect(probe.events.length).toBe(1);
      expect(probe.events[0]).toMatchObject({ originalOwnSessionPresent: true, bodyPreserved: true, methodPreserved: true,
        credentialsPreserved: true, signalPreserved: true, idempotencyPreserved: true, sentIfMatchMatchesInjected: true });
      expect(requests[0].matchesInjected).toBe(true);
      expect(response.status).toBe(409);
      expect(reply.ok).toBe(false);
      expect(reply.error?.code).toBe(caseId === "EF02" ? "VERSION_CONFLICT" : "LOCK_REQUIRED");
      expect(requests[0].ownSessionPresent).toBe(caseId === "EF02");
      expect(requests[0].matchesOriginalGet).toBe(caseId === "EF03");
      expect(after.version.status).toBe("draft");
      expect(totals(after.version)).toEqual([2000, 400, 2400]);
      expect(fingerprintAfter).toBe(beforeFingerprint);
      expect(receiptsAfter).toEqual(beforeReceipts);
    }
    primaryBodyFailed = false;
  } finally {
    try { const restored = await efReadAndRestoreProbe(ui.browser); if (restored.present && !restored.restored) cleanupErrors.push("fetch-identity-changed"); }
    catch { cleanupErrors.push("fetch-restore-unavailable"); }
    try { if (await modal.count() === 1 && await modal.isVisible()) await modal.getByRole("button", "Annuler", { exact: true }).click(); }
    catch { cleanupErrors.push("modal-close-unavailable"); }
    try { await ui.browser.unroute(endpoint); await ui.browser.unroute(leasePattern); }
    catch { cleanupErrors.push("route-cleanup-unavailable"); }
    await recordOfferEvidence(ui.army, `${caseId}-cleanup`, { primaryBodyFailed, probeRestored, cleanupErrors, zeroDbCountsQualified: false });
    if (!primaryBodyFailed && cleanupErrors.length > 0) throw new Error("EF cleanup incomplete; proof not qualified.");
  }
}

offerTest("EF01 first normal send carries exact original CAS and own page session", options, async (ui) => {
  await efExerciseFirstSend(ui, "EF01");
});
offerTest("EF02 older one microsecond with same JS millisecond rejects before intent", options, async (ui) => {
  await efExerciseFirstSend(ui, "EF02");
});
offerTest("EF03 exact original CAS without own page-session header rejects before intent", options, async (ui) => {
  await efExerciseFirstSend(ui, "EF03");
});

// EF04 failure modes and memory-only SDK fallback precede this staged appendix.
type Ef04RequestWitness = {
  originalCas: boolean;
  ownSessionPresent: boolean;
  ownSessionSha256: string | null;
  requestKeyPresent: boolean;
  requestKeySha256: string | null;
};
type Ef04ProbeEvent = {
  originalCas: boolean; originalOwnSessionPresent: boolean;
  originalOwnSessionSha256: string | null;
  originalKeyPresent: boolean; originalKeySha256: string | null;
  sentKeySha256: string; keyChanged: boolean; otherHeadersPreserved: boolean;
  bodyPreserved: boolean; methodPreserved: boolean; credentialsPreserved: boolean;
  signalPreserved: boolean;
};
type Ef04ProbeWindow = Window & {
  __armyEmailCrossVersionProbe?: { events: Ef04ProbeEvent[]; restore: () => boolean };
};

async function ef04InstallKeyProbe(browser: Browser, endpoint: string, originalToken: string, firstRequestKey: string) {
  return browser.evaluate(async ({ endpoint, originalToken, firstRequestKey }) => {
    const scope = window as Ef04ProbeWindow;
    if (scope.__armyEmailCrossVersionProbe) return { installed: false };
    const originalFetch = window.fetch;
    const events: Ef04ProbeEvent[] = [];
    let privateKey = firstRequestKey;
    const sha = async (value: string) => Array.from(new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const sentKeySha256 = await sha(privateKey);
    let attempted = false;
    const wrapped: typeof window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (url.href !== endpoint || method !== "POST" || attempted) return originalFetch.call(window, input, init);
      attempted = true;
      const originalHeaders = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const headers = new Headers(originalHeaders);
      const originalKey = originalHeaders.get("idempotency-key") ?? "";
      const session = originalHeaders.get("x-estimate-draft-lock-session-id") ?? "";
      headers.set("idempotency-key", privateKey);
      const forwarded = { ...init, headers };
      const withoutKey = (values: Headers) => JSON.stringify([...values.entries()]
        .filter(([name]) => name !== "idempotency-key").sort(([left], [right]) => left.localeCompare(right)));
      events.push({ originalCas: originalHeaders.get("if-match") === originalToken,
        originalOwnSessionPresent: /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(session),
        originalOwnSessionSha256: session ? await sha(session) : null,
        originalKeyPresent: /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(originalKey),
        originalKeySha256: originalKey ? await sha(originalKey) : null,
        sentKeySha256, keyChanged: originalKey !== privateKey,
        otherHeadersPreserved: withoutKey(originalHeaders) === withoutKey(headers),
        bodyPreserved: forwarded.body === init?.body, methodPreserved: forwarded.method === init?.method,
        credentialsPreserved: forwarded.credentials === init?.credentials, signalPreserved: forwarded.signal === init?.signal });
      return originalFetch.call(window, input, forwarded);
    };
    const probe = { events, restore: () => {
      const own = window.fetch === wrapped;
      if (own) window.fetch = originalFetch;
      privateKey = "";
      if (scope.__armyEmailCrossVersionProbe === probe) delete scope.__armyEmailCrossVersionProbe;
      return own;
    } };
    scope.__armyEmailCrossVersionProbe = probe;
    window.fetch = wrapped;
    return { installed: true };
  }, { endpoint, originalToken, firstRequestKey });
}

async function ef04ReadAndRestoreProbe(browser: Browser) {
  return browser.evaluate(() => {
    const probe = (window as Ef04ProbeWindow).__armyEmailCrossVersionProbe;
    return { present: !!probe, events: probe?.events ?? [], restored: probe ? probe.restore() : false };
  });
}

offerTest("EF04 another draft request key rejects before freezing its source", options, async (ui) => {
  const first = await prepare(ui, "EF04-A");
  const firstBefore = await readEstimate(ui.browser, first.ids.versionId);
  const firstEndpoint = new URL(`/api/estimates/${first.ids.versionId}/send`, ui.app.baseUrl!).href;
  const firstRequests: Ef04RequestWitness[] = [];
  // The observed first request UUID is kept only in this private local variable.
  // SDK routes expose real headers; evidence receives only hashes/booleans.
  let firstRequestKey: string | null = null;
  await ui.browser.route(firstEndpoint, async (route) => {
    if (route.request.method === "POST") {
      const key = route.request.headers["idempotency-key"] ?? "";
      const session = route.request.headers["x-estimate-draft-lock-session-id"] ?? "";
      firstRequestKey ??= key;
      firstRequests.push({ originalCas: route.request.headers["if-match"] === firstBefore.version.updated_at,
        ownSessionPresent: /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(session),
        ownSessionSha256: session ? digest(session) : null,
        requestKeyPresent: /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(key), requestKeySha256: key ? digest(key) : null });
    }
    await route.fallback();
  });
  const modal = ui.screen.getByRole("dialog", "Envoyer le devis par email", { exact: true });
  let secondEndpoint: string | null = null;
  let secondLeasePattern: RegExp | null = null;
  let primaryBodyFailed = true;
  let probeRestored = false;
  const cleanupErrors: string[] = [];
  try {
    const receiptsBeforeFirst = await receiptNames();
    await ui.screen.getByRole("button", "Envoyer par email", { exact: true }).click();
    await expect(modal).toBeVisible();
    await modal.getByLabel("Destinataire *", { exact: true }).fill("army-ef04-a@offer.invalid");
    await modal.getByLabel("Objet *", { exact: true }).fill("EF04 première offre normale");
    await modal.getByLabel("Message *", { exact: true }).fill("ARMY première émission réelle conservée.");
    await expect(modal.getByRole("button", "Envoyer", { exact: true })).toBeEnabled();
    const [firstResponse] = await Promise.all([ui.browser.waitForResponse(firstEndpoint, { timeout: 120000 }),
      modal.getByRole("button", "Envoyer", { exact: true }).click()]);
    const firstReply = await firstResponse.json<{ ok: boolean; error?: { code?: string }; data?: { message_id?: string } }>();
    const firstAfter = await readEstimate(ui.browser, first.ids.versionId);
    const firstFingerprint = efSourceFingerprint(firstAfter);
    const receiptsAfterFirst = await receiptNames();
    await recordOfferEvidence(ui.army, "EF04-first-actual-response", { firstIds: first.ids, firstOriginalName: first.originalName,
      responseStatus: firstResponse.status, ok: firstReply.ok, errorCode: firstReply.error?.code ?? null,
      requests: firstRequests, statusAfter: firstAfter.version.status, totalsAfter: totals(firstAfter.version),
      sealPayloadVersion: firstAfter.version.seal_payload_version, sourceFingerprint: firstFingerprint,
      receiptCountBefore: receiptsBeforeFirst.length, receiptCountAfter: receiptsAfterFirst.length,
      messageIdSha256: firstReply.data?.message_id ? digest(firstReply.data.message_id) : null,
      firstRequestWrapped: false, zeroDbCountsQualified: false });
    expect(firstResponse.status).toBe(200);
    expect(firstReply.ok).toBe(true);
    expect(firstRequests.length).toBe(1);
    expect(firstRequests[0]).toMatchObject({ originalCas: true, ownSessionPresent: true, requestKeyPresent: true });
    expect(firstAfter.version.status).toBe("sent");
    expect(firstAfter.version.seal_payload_version).toBe(5);
    expect(totals(firstAfter.version)).toEqual([2000, 400, 2400]);
    expect(receiptsAfterFirst.length).toBe(receiptsBeforeFirst.length + 1);
    if (!firstRequestKey || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(firstRequestKey)) {
      throw new Error("EF04 missing setup: actual first request UUID not captured.");
    }
    const firstKeySha256 = digest(firstRequestKey);
    await expect(modal).not.toBeVisible();
    await ui.browser.unroute(firstEndpoint);

    const second = await prepare(ui, "PDFL-EF04-B");
    const secondBefore = await readEstimate(ui.browser, second.ids.versionId);
    const secondFingerprintBefore = efSourceFingerprint(secondBefore);
    const originalToken = secondBefore.version.updated_at;
    const needsFinancialSnapshot = secondBefore.version.calc_snapshot_content_revision !== secondBefore.version.content_revision
      || secondBefore.version.calc_snapshot_context == null;
    secondEndpoint = new URL(`/api/estimates/${second.ids.versionId}/send`, ui.app.baseUrl!).href;
    secondLeasePattern = new RegExp(`/api/estimates/${second.ids.versionId}/lock(?:\\?.*)?$`);
    const secondRequests: Ef04RequestWitness[] = [];
    const secondLeases: { method: string; forced: boolean; sessionSha256: string | null }[] = [];
    const receiptsBeforeSecond = await receiptNames();
    await recordOfferEvidence(ui.army, "EF04-second-before-open", { firstIds: first.ids, secondIds: second.ids,
      firstOriginalName: first.originalName, secondOriginalName: second.originalName,
      firstSourceFingerprint: firstFingerprint, secondSourceFingerprint: secondFingerprintBefore,
      secondStatus: secondBefore.version.status, secondTotals: totals(secondBefore.version),
      calcEngineVersion: secondBefore.version.calc_engine_version, contentRevision: secondBefore.version.content_revision,
      snapshotRevision: secondBefore.version.calc_snapshot_content_revision,
      snapshotContextPresent: secondBefore.version.calc_snapshot_context != null, needsFinancialSnapshot,
      secondOriginalUpdatedAtSha256: digest(originalToken), firstRequestKeySha256: firstKeySha256,
      receiptCount: receiptsBeforeSecond.length, originalReadBeforeModal: true, zeroDbCountsQualified: false });
    expect(second.ids.versionId).not.toBe(first.ids.versionId);
    expect(second.ids.projectId).not.toBe(first.ids.projectId);
    expect(secondBefore.version.status).toBe("draft");
    expect(secondBefore.version.calc_engine_version).toBe(2);
    expect(Number.isInteger(secondBefore.version.content_revision)).toBe(true);
    if (!needsFinancialSnapshot) throw new Error("EF04 missing setup: second draft must genuinely need its engine2 financial snapshot.");
    expect(totals(secondBefore.version)).toEqual([2000, 400, 2400]);
    expect(receiptsBeforeSecond).toEqual(receiptsAfterFirst);
    await ui.browser.route(secondEndpoint, async (route) => {
      if (route.request.method === "POST") {
        const session = route.request.headers["x-estimate-draft-lock-session-id"] ?? "";
        const key = route.request.headers["idempotency-key"] ?? "";
        secondRequests.push({ originalCas: route.request.headers["if-match"] === originalToken,
          ownSessionPresent: /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(session),
          ownSessionSha256: session ? digest(session) : null,
          requestKeyPresent: /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(key), requestKeySha256: key ? digest(key) : null });
      }
      // Never abort/assert/mock or override the request in this observer.
      await route.fallback();
    });
    await ui.browser.route(secondLeasePattern, async (route) => {
      const force = new URL(route.request.url).searchParams.get("force");
      const session = route.request.headers["x-estimate-draft-lock-session-id"] ?? "";
      secondLeases.push({ method: route.request.method, forced: force === "true" || force === "1", sessionSha256: session ? digest(session) : null });
      await route.fallback();
    });
    const installed = await ef04InstallKeyProbe(ui.browser, secondEndpoint, originalToken, firstRequestKey);
    firstRequestKey = null;
    if (!installed.installed) throw new Error("EF04 missing setup: own fetch probe not installed.");
    await ui.screen.getByRole("button", "Envoyer par email", { exact: true }).click();
    await expect(modal).toBeVisible();
    await modal.getByLabel("Destinataire *", { exact: true }).fill("army-ef04-b@offer.invalid");
    await modal.getByLabel("Objet *", { exact: true }).fill("EF04 deuxième brouillon sans mutation");
    await modal.getByLabel("Message *", { exact: true }).fill("ARMY refus de réutiliser une clé provenant d’un autre devis.");
    await expect(modal.getByRole("button", "Envoyer", { exact: true })).toBeEnabled();
    const [secondResponse] = await Promise.all([ui.browser.waitForResponse(secondEndpoint, { timeout: 120000 }),
      modal.getByRole("button", "Envoyer", { exact: true }).click()]);
    const secondReply = await secondResponse.json<{ ok: boolean; error?: { code?: string } }>();
    const secondAfter = await readEstimate(ui.browser, second.ids.versionId);
    const firstAfterSecond = await readEstimate(ui.browser, first.ids.versionId);
    const secondFingerprintAfter = efSourceFingerprint(secondAfter);
    const firstFingerprintAfter = efSourceFingerprint(firstAfterSecond);
    const receiptsAfterSecond = await receiptNames();
    const probe = await ef04ReadAndRestoreProbe(ui.browser);
    probeRestored = probe.restored;
    const leaseMatches = !!secondRequests[0]?.ownSessionSha256 && secondLeases.some((lease) =>
      ["POST", "PATCH"].includes(lease.method) && lease.sessionSha256 === secondRequests[0].ownSessionSha256);
    // Preserve the real response and source-change RED before every assertion.
    await recordOfferEvidence(ui.army, "EF04-second-actual-response", { firstIds: first.ids, secondIds: second.ids,
      firstOriginalName: first.originalName, secondOriginalName: second.originalName,
      responseStatus: secondResponse.status, ok: secondReply.ok, errorCode: secondReply.error?.code ?? null,
      firstRequestKeySha256: firstKeySha256, requests: secondRequests, leases: secondLeases, leaseMatches, probe,
      firstSourceFingerprintBefore: firstFingerprint, firstSourceFingerprintAfter: firstFingerprintAfter,
      firstSourceUnchanged: firstFingerprintAfter === firstFingerprint, firstStatusAfter: firstAfterSecond.version.status,
      firstTotalsAfter: totals(firstAfterSecond.version), secondStatusAfter: secondAfter.version.status,
      secondTotalsAfter: totals(secondAfter.version), secondSourceFingerprintBefore: secondFingerprintBefore,
      secondSourceFingerprintAfter: secondFingerprintAfter, secondSourceUnchanged: secondFingerprintAfter === secondFingerprintBefore,
      receiptCountBeforeSecond: receiptsBeforeSecond.length, receiptCountAfterSecond: receiptsAfterSecond.length,
      receiptSetUnchanged: JSON.stringify(receiptsBeforeSecond) === JSON.stringify(receiptsAfterSecond), originalReadBeforeModal: true,
      complementaryProof: { databaseIntentAndCapabilityCounts: "root independent native read required", zeroDbCountsQualified: false } });
    expect(secondRequests.length).toBe(1);
    expect(secondRequests[0]).toMatchObject({ originalCas: true, ownSessionPresent: true, requestKeyPresent: true, requestKeySha256: firstKeySha256 });
    expect(leaseMatches).toBe(true);
    expect(secondLeases.some((lease) => lease.forced)).toBe(false);
    expect(probeRestored).toBe(true);
    expect(probe.events.length).toBe(1);
    expect(probe.events[0]).toMatchObject({ originalCas: true, originalOwnSessionPresent: true, originalKeyPresent: true,
      sentKeySha256: firstKeySha256, keyChanged: true, otherHeadersPreserved: true,
      bodyPreserved: true, methodPreserved: true, credentialsPreserved: true, signalPreserved: true });
    expect(probe.events[0].originalOwnSessionSha256).toBe(secondRequests[0].ownSessionSha256);
    expect(probe.events[0].originalKeySha256).not.toBe(firstKeySha256);
    expect(secondResponse.status).toBe(409);
    expect(secondReply.ok).toBe(false);
    expect(secondReply.error?.code).toBe("ESTIMATE_EMAIL_DISPATCH_CONFLICT");
    expect(secondAfter.version.status).toBe("draft");
    expect(totals(secondAfter.version)).toEqual([2000, 400, 2400]);
    expect(secondFingerprintAfter).toBe(secondFingerprintBefore);
    expect(firstAfterSecond.version.status).toBe("sent");
    expect(totals(firstAfterSecond.version)).toEqual([2000, 400, 2400]);
    expect(firstFingerprintAfter).toBe(firstFingerprint);
    expect(receiptsAfterSecond).toEqual(receiptsBeforeSecond);
    primaryBodyFailed = false;
  } finally {
    firstRequestKey = null;
    try { const restored = await ef04ReadAndRestoreProbe(ui.browser); if (restored.present && !restored.restored) cleanupErrors.push("fetch-identity-changed"); }
    catch { cleanupErrors.push("fetch-restore-unavailable"); }
    try { if (await modal.count() === 1 && await modal.isVisible()) await modal.getByRole("button", "Annuler", { exact: true }).click(); }
    catch { cleanupErrors.push("modal-close-unavailable"); }
    try {
      await ui.browser.unroute(firstEndpoint);
      if (secondEndpoint) await ui.browser.unroute(secondEndpoint);
      if (secondLeasePattern) await ui.browser.unroute(secondLeasePattern);
    } catch { cleanupErrors.push("route-cleanup-unavailable"); }
    await recordOfferEvidence(ui.army, "EF04-cleanup", { primaryBodyFailed, probeRestored, cleanupErrors,
      privateKeyReferenceCleared: firstRequestKey === null, zeroDbCountsQualified: false });
    if (!primaryBodyFailed && cleanupErrors.length > 0) throw new Error("EF04 cleanup incomplete; proof not qualified.");
  }
});

type Ef05ProbeEvent = {
  originalCas: boolean; sentCas: boolean; originalOwnSessionPresent: boolean;
  originalOwnSessionSha256: string | null; replacementSessionSha256: string;
  sessionChanged: boolean; otherHeadersPreserved: boolean; idempotencyPreserved: boolean;
  bodyPreserved: boolean; methodPreserved: boolean; credentialsPreserved: boolean; signalPreserved: boolean;
};
type Ef05ProbeWindow = Window & {
  __armyEmailForeignSessionProbe?: { events: Ef05ProbeEvent[]; restore: () => boolean };
};

async function ef05InstallReplacementProbe(browser: Browser, endpoint: string, originalToken: string) {
  return browser.evaluate(({ endpoint, originalToken }) => {
    const scope = window as Ef05ProbeWindow;
    if (scope.__armyEmailForeignSessionProbe) return { installed: false };
    const originalFetch = window.fetch;
    const events: Ef05ProbeEvent[] = [];
    let attempted = false;
    const sha = async (value: string) => Array.from(new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
      .map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const wrapped: typeof window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (url.href !== endpoint || method !== "POST" || attempted) return originalFetch.call(window, input, init);
      attempted = true;
      const originalHeaders = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const headers = new Headers(originalHeaders);
      const originalSession = originalHeaders.get("x-estimate-draft-lock-session-id") ?? "";
      let replacementSession = crypto.randomUUID();
      if (replacementSession === originalSession) replacementSession = crypto.randomUUID();
      headers.set("x-estimate-draft-lock-session-id", replacementSession);
      const forwarded = { ...init, headers };
      const withoutSession = (values: Headers) => JSON.stringify([...values.entries()]
        .filter(([name]) => name !== "x-estimate-draft-lock-session-id").sort(([left], [right]) => left.localeCompare(right)));
      events.push({ originalCas: originalHeaders.get("if-match") === originalToken,
        sentCas: headers.get("if-match") === originalToken,
        originalOwnSessionPresent: /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(originalSession),
        originalOwnSessionSha256: originalSession ? await sha(originalSession) : null,
        replacementSessionSha256: await sha(replacementSession), sessionChanged: replacementSession !== originalSession,
        otherHeadersPreserved: withoutSession(originalHeaders) === withoutSession(headers),
        idempotencyPreserved: originalHeaders.get("idempotency-key") === headers.get("idempotency-key"),
        bodyPreserved: forwarded.body === init?.body, methodPreserved: forwarded.method === init?.method,
        credentialsPreserved: forwarded.credentials === init?.credentials, signalPreserved: forwarded.signal === init?.signal });
      return originalFetch.call(window, input, forwarded);
    };
    const probe = { events, restore: () => {
      const own = window.fetch === wrapped;
      if (own) window.fetch = originalFetch;
      if (scope.__armyEmailForeignSessionProbe === probe) delete scope.__armyEmailForeignSessionProbe;
      return own;
    } };
    scope.__armyEmailForeignSessionProbe = probe;
    window.fetch = wrapped;
    return { installed: true };
  }, { endpoint, originalToken });
}

async function ef05ReadAndRestoreProbe(browser: Browser) {
  return browser.evaluate(() => {
    const probe = (window as Ef05ProbeWindow).__armyEmailForeignSessionProbe;
    return { present: !!probe, events: probe?.events ?? [], restored: probe ? probe.restore() : false };
  });
}

offerTest("EF05 valid foreign page session rejects before intent", options, async (ui) => {
  const prepared = await prepare(ui, "EF05");
  const before = await readEstimate(ui.browser, prepared.ids.versionId);
  const originalToken = before.version.updated_at;
  const beforeFingerprint = efSourceFingerprint(before);
  const beforeReceipts = await receiptNames();
  const endpoint = new URL(`/api/estimates/${prepared.ids.versionId}/send`, ui.app.baseUrl!).href;
  const leasePattern = new RegExp(`/api/estimates/${prepared.ids.versionId}/lock(?:\\?.*)?$`);
  const requests: Ef04RequestWitness[] = [];
  const leases: { method: string; forced: boolean; sessionSha256: string | null }[] = [];
  await recordOfferEvidence(ui.army, "EF05-before-open", { ids: prepared.ids, originalName: prepared.originalName,
    status: before.version.status, totals: totals(before.version), sourceFingerprint: beforeFingerprint,
    calcEngineVersion: before.version.calc_engine_version,
    originalUpdatedAtSha256: digest(originalToken), originalReadBeforeModal: true, zeroDbCountsQualified: false });
  if (before.version.calc_engine_version !== 2) throw new Error("EF05 missing setup: actual engine2 draft required.");
  await ui.browser.route(endpoint, async (route) => {
    if (route.request.method === "POST") {
      const session = route.request.headers["x-estimate-draft-lock-session-id"] ?? "";
      const key = route.request.headers["idempotency-key"] ?? "";
      requests.push({ originalCas: route.request.headers["if-match"] === originalToken,
        ownSessionPresent: /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(session),
        ownSessionSha256: session ? digest(session) : null,
        requestKeyPresent: /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(key), requestKeySha256: key ? digest(key) : null });
    }
    await route.fallback();
  });
  await ui.browser.route(leasePattern, async (route) => {
    const force = new URL(route.request.url).searchParams.get("force");
    const session = route.request.headers["x-estimate-draft-lock-session-id"] ?? "";
    leases.push({ method: route.request.method, forced: force === "true" || force === "1", sessionSha256: session ? digest(session) : null });
    await route.fallback();
  });
  const modal = ui.screen.getByRole("dialog", "Envoyer le devis par email", { exact: true });
  let primaryBodyFailed = true;
  let probeRestored = false;
  const cleanupErrors: string[] = [];
  try {
    const installed = await ef05InstallReplacementProbe(ui.browser, endpoint, originalToken);
    if (!installed.installed) throw new Error("EF05 missing setup: own fetch probe not installed.");
    await ui.screen.getByRole("button", "Envoyer par email", { exact: true }).click();
    await expect(modal).toBeVisible();
    await modal.getByLabel("Destinataire *", { exact: true }).fill("army-ef05@offer.invalid");
    await modal.getByLabel("Objet *", { exact: true }).fill("EF05 session étrangère refusée");
    await modal.getByLabel("Message *", { exact: true }).fill("ARMY contrôle de la session réellement autorisée à confirmer.");
    await expect(modal.getByRole("button", "Envoyer", { exact: true })).toBeEnabled();
    const [response] = await Promise.all([ui.browser.waitForResponse(endpoint, { timeout: 120000 }),
      modal.getByRole("button", "Envoyer", { exact: true }).click()]);
    const reply = await response.json<{ ok: boolean; error?: { code?: string } }>();
    const after = await readEstimate(ui.browser, prepared.ids.versionId);
    const afterFingerprint = efSourceFingerprint(after);
    const afterReceipts = await receiptNames();
    const probe = await ef05ReadAndRestoreProbe(ui.browser);
    probeRestored = probe.restored;
    const originalLeaseMatches = !!probe.events[0]?.originalOwnSessionSha256 && leases.some((lease) =>
      ["POST", "PATCH"].includes(lease.method) && lease.sessionSha256 === probe.events[0].originalOwnSessionSha256);
    const submittedLeaseMatches = !!requests[0]?.ownSessionSha256 && leases.some((lease) =>
      ["POST", "PATCH"].includes(lease.method) && lease.sessionSha256 === requests[0].ownSessionSha256);
    await recordOfferEvidence(ui.army, "EF05-actual-response", { ids: prepared.ids, originalName: prepared.originalName,
      responseStatus: response.status, ok: reply.ok, errorCode: reply.error?.code ?? null,
      statusAfter: after.version.status, totalsAfter: totals(after.version), requests, leases, originalLeaseMatches, submittedLeaseMatches, probe,
      sourceFingerprintBefore: beforeFingerprint, sourceFingerprintAfter: afterFingerprint, sourceUnchanged: afterFingerprint === beforeFingerprint,
      receiptCountBefore: beforeReceipts.length, receiptCountAfter: afterReceipts.length,
      receiptSetUnchanged: JSON.stringify(beforeReceipts) === JSON.stringify(afterReceipts), originalReadBeforeModal: true,
      complementaryProof: { databaseIntentAndCapabilityCounts: "root independent native read required", zeroDbCountsQualified: false } });
    expect(requests.length).toBe(1);
    expect(requests[0]).toMatchObject({ originalCas: true, ownSessionPresent: true, requestKeyPresent: true });
    expect(probeRestored).toBe(true);
    expect(probe.events.length).toBe(1);
    expect(probe.events[0]).toMatchObject({ originalCas: true, sentCas: true, originalOwnSessionPresent: true, sessionChanged: true,
      otherHeadersPreserved: true, idempotencyPreserved: true, bodyPreserved: true, methodPreserved: true,
      credentialsPreserved: true, signalPreserved: true });
    expect(originalLeaseMatches).toBe(true);
    expect(submittedLeaseMatches).toBe(false);
    expect(requests[0].ownSessionSha256).toBe(probe.events[0].replacementSessionSha256);
    expect(probe.events[0].originalOwnSessionSha256).not.toBe(requests[0].ownSessionSha256);
    expect(leases.some((lease) => lease.forced)).toBe(false);
    expect(response.status).toBe(409);
    expect(reply.ok).toBe(false);
    expect(reply.error?.code).toBe("LOCK_REQUIRED");
    expect(after.version.status).toBe("draft");
    expect(totals(after.version)).toEqual([2000, 400, 2400]);
    expect(afterFingerprint).toBe(beforeFingerprint);
    expect(afterReceipts).toEqual(beforeReceipts);
    primaryBodyFailed = false;
  } finally {
    try { const restored = await ef05ReadAndRestoreProbe(ui.browser); if (restored.present && !restored.restored) cleanupErrors.push("fetch-identity-changed"); }
    catch { cleanupErrors.push("fetch-restore-unavailable"); }
    try { if (await modal.count() === 1 && await modal.isVisible()) await modal.getByRole("button", "Annuler", { exact: true }).click(); }
    catch { cleanupErrors.push("modal-close-unavailable"); }
    try { await ui.browser.unroute(endpoint); await ui.browser.unroute(leasePattern); }
    catch { cleanupErrors.push("route-cleanup-unavailable"); }
    await recordOfferEvidence(ui.army, "EF05-cleanup", { primaryBodyFailed, probeRestored, cleanupErrors, zeroDbCountsQualified: false });
    if (!primaryBodyFailed && cleanupErrors.length > 0) throw new Error("EF05 cleanup incomplete; proof not qualified.");
  }
});

// NF02 failures and oracles are defined before product changes in the root precode plan.
offerTest("NF02 first offer prepares PDF in email before human confirmation", options, async (ui) => {
  const p = await prepare(ui, "PDFL-NF02");
  const before = await readEstimate(ui.browser, p.ids.versionId);
  const beforeReceipts = await receiptNames();
  const gating = await apiRequest<{ ok: boolean; data: { gating: {
    blockingFlags: { key: string; severity: string }[];
    warningFlags: { key: string; severity: string }[];
  } } }>(ui.browser, "GET", `/api/estimates/${p.ids.versionId}/gating`);
  const pdfBefore = await apiRequest<{ ok: boolean; error?: { code: string; details?: { status: string } } }>(
    ui.browser, "GET", `/api/estimates/${p.ids.versionId}/pdf?format=json`);
  const flags = {
    blocking: (gating.body.data?.gating?.blockingFlags ?? []).map(({ key, severity }) => ({ key, severity })).sort((a, b) => a.key.localeCompare(b.key)),
    warning: (gating.body.data?.gating?.warningFlags ?? []).map(({ key, severity }) => ({ key, severity })).sort((a, b) => a.key.localeCompare(b.key)),
  };
  await recordOfferEvidence(ui.army, "NF02-before-open", { ids: p.ids, originalName: p.originalName,
    status: before.version.status, totals: totals(before.version), flags,
    gatingStatus: gating.status, pdfStatus: pdfBefore.status, pdfState: pdfBefore.body.error?.details?.status, pdfErrorCode: pdfBefore.body.error?.code,
    originalUpdatedAtSha256: digest(before.version.updated_at), receiptCount: beforeReceipts.length,
    sourceFingerprint: efSourceFingerprint(before), zeroDbCountsQualified: false });
  expect(gating.status).toBe(200);
  expect(gating.body.ok).toBe(true);
  expect(flags.blocking).toEqual([{ key: "no_pdf_generated", severity: "blocking" }]);
  expect(pdfBefore.status).toBe(404);
  expect(pdfBefore.body.ok).toBe(false);
  expect(pdfBefore.body.error?.code).toBe("PDF_NOT_READY");
  expect(pdfBefore.body.error?.details?.status).toBe("missing");
  expect(before.version.status).toBe("draft");
  expect(before.version.calc_engine_version).toBe(2);
  expect(totals(before.version)).toEqual([2000, 400, 2400]);

  const endpoint = new URL(`/api/estimates/${p.ids.versionId}/send`, ui.app.baseUrl!).href;
  const pdfEndpoint = new URL(`/api/estimates/${p.ids.versionId}/pdf?force=1`, ui.app.baseUrl!).href;
  const requests: { originalCas: boolean; updatedAtSha256: string; sessionSha256: string | null; requestKeySha256: string | null }[] = [];
  const pdfRequests: { layout: unknown; ownSessionPresent: boolean }[] = [];
  let expectedToken = before.version.updated_at;
  const leasePattern = new RegExp(`/api/estimates/${p.ids.versionId}/lock(?:\\?.*)?$`);
  const leases: { method: string; forced: boolean; sessionSha256: string | null }[] = [];
  await ui.browser.route(leasePattern, async (route) => {
    const force = new URL(route.request.url).searchParams.get("force");
    const session = route.request.headers["x-estimate-draft-lock-session-id"] ?? "";
    leases.push({ method: route.request.method, forced: force === "1" || force === "true", sessionSha256: session ? digest(session) : null });
    await route.fallback();
  });
  await ui.browser.route(endpoint, async (route) => {
    if (route.request.method === "POST") {
      const session = route.request.headers["x-estimate-draft-lock-session-id"] ?? "";
      const key = route.request.headers["idempotency-key"] ?? "";
      requests.push({ originalCas: route.request.headers["if-match"] === expectedToken, updatedAtSha256: digest(route.request.headers["if-match"] ?? ""),
        sessionSha256: session ? digest(session) : null, requestKeySha256: key ? digest(key) : null });
    }
    await route.fallback();
  });
  await ui.browser.route(pdfEndpoint, async (route) => {
    if (route.request.method === "POST") {
      const body = JSON.parse(route.request.postData ?? "null") as { layout?: unknown } | null;
      pdfRequests.push({ layout: body?.layout ?? null,
        ownSessionPresent: /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(route.request.headers["x-estimate-draft-lock-session-id"] ?? "") });
    }
    await route.fallback();
  });
  const modal = ui.screen.getByRole("dialog", "Envoyer le devis par email", { exact: true });
  const layout = ui.screen.getByRole("dialog", "Préparer le devis PDF", { exact: true });
  let primaryBodyFailed = true;
  try {
    await ui.screen.getByRole("button", "Envoyer par email", { exact: true }).click();
    await expect(modal).toBeVisible();
    await modal.getByLabel("Destinataire *", { exact: true }).fill("army-nf02@offer.invalid");
    await modal.getByLabel("Objet *", { exact: true }).fill("NF02 première offre vérifiée");
    await modal.getByLabel("Message *", { exact: true }).fill("Veuillez vérifier notre proposition commerciale préparée.");
    const action = modal.getByRole("button", "Préparer le PDF", { exact: true });
    await recordOfferEvidence(ui.army, "NF02-pdf-action-actual", { ids: p.ids,
      pdfActionCount: await action.count(), sendPosts: requests.length,
      collectorUnchanged: JSON.stringify(await receiptNames()) === JSON.stringify(beforeReceipts),
      flags, zeroDbCountsQualified: false });
    await expect(action).toBeVisible();
    await action.click();
    await expect(layout).toBeVisible();
    await layout.getByRole("button", "Annuler", { exact: true }).click();
    await expect(layout).not.toBeVisible();
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel("Destinataire *", { exact: true })).toHaveValue("army-nf02@offer.invalid");
    await expect(modal.getByLabel("Objet *", { exact: true })).toHaveValue("NF02 première offre vérifiée");
    await expect(modal.getByLabel("Message *", { exact: true })).toHaveValue("Veuillez vérifier notre proposition commerciale préparée.");
    await recordOfferEvidence(ui.army, "NF02-layout-cancel", { ids: p.ids, sendPosts: requests.length,
      pdfPosts: pdfRequests.length, collectorUnchanged: JSON.stringify(await receiptNames()) === JSON.stringify(beforeReceipts) });
    expect(requests.length).toBe(0);
    expect(pdfRequests.length).toBe(0);
    expect(await receiptNames()).toEqual(beforeReceipts);

    await action.click();
    await expect(layout).toBeVisible();
    await layout.getByRole("button", /Devis détaillé/).click();
    const confirm = layout.getByRole("button", "Générer et télécharger", { exact: true });
    await expect(confirm).toBeEnabled();
    const terms = layout.getByRole("checkbox", /Joindre les CGV/);
    if (await terms.isChecked()) await terms.uncheck();
    await expect(terms).not.toBeChecked();
    const [generation] = await Promise.all([ui.browser.waitForResponse(pdfEndpoint, { timeout: 120000 }), confirm.click()]);
    await expect(layout).not.toBeVisible({ timeout: 120000 });
    await expect(modal).not.toBeVisible({ timeout: 30000 });
    await expect(ui.screen.getByRole("button", "Envoyer par email", { exact: true })).toBeEnabled();
    const prepared = await readEstimate(ui.browser, p.ids.versionId);
    const preview = await ui.browser.evaluate(async (id) => {
      const response = await fetch(`/api/estimates/${id}/pdf?format=json`, { credentials: "same-origin" });
      const body = await response.json();
      if (response.status !== 200 || !body.ok || body.data?.status !== "ready" || !body.data.download_url) {
        return { status: response.status, ready: false, storageStatus: null, bytes: 0, sha256: null, expectedSha256: body.data?.sha256_hash ?? null, prefix: false };
      }
      const download = await fetch(body.data.download_url, { credentials: "omit" });
      const bytes = new Uint8Array(await download.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
      return { status: response.status, ready: true, storageStatus: download.status, bytes: bytes.length,
        sha256, expectedSha256: body.data.sha256_hash, prefix: new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-" };
    }, p.ids.versionId);
    await recordOfferEvidence(ui.army, "NF02-prepared-before-confirm", { ids: p.ids, originalName: p.originalName,
      generationStatus: generation.status, preview, pdfRequests, sendPosts: requests.length,
      status: prepared.version.status, totals: totals(prepared.version),
      preparedUpdatedAtSha256: digest(prepared.version.updated_at),
      collectorUnchanged: JSON.stringify(await receiptNames()) === JSON.stringify(beforeReceipts), zeroDbCountsQualified: false });
    expect([200, 202].includes(generation.status)).toBe(true);
    expect(preview).toMatchObject({ status: 200, ready: true, storageStatus: 200, prefix: true });
    expect(preview.bytes > 0).toBe(true);
    expect(preview.sha256).toBe(preview.expectedSha256);
    expect(pdfRequests.length).toBe(1);
    expect(pdfRequests[0]).toMatchObject({ ownSessionPresent: true,
      layout: { preset: "client_detailed", detailLevel: "lines", priceMode: "unit_and_total", includeTerms: false } });
    expect(requests.length).toBe(0);
    expect(await receiptNames()).toEqual(beforeReceipts);
    expect(prepared.version.status).toBe("draft");
    expect(totals(prepared.version)).toEqual([2000, 400, 2400]);

    // Explicit reopening, with no page navigation/reload or timestamp injection.
    expectedToken = prepared.version.updated_at;
    await ui.screen.getByRole("button", "Envoyer par email", { exact: true }).click();
    await expect(modal).toBeVisible();
    await expect(modal.getByLabel("Destinataire *", { exact: true })).toHaveValue("army-nf02@offer.invalid");
    await expect(modal.getByLabel("Objet *", { exact: true })).toHaveValue("NF02 première offre vérifiée");
    await expect(modal.getByLabel("Message *", { exact: true })).toHaveValue("Veuillez vérifier notre proposition commerciale préparée.");
    await expect(modal.getByRole("button", "Envoyer", { exact: true })).toBeEnabled();
    const [response] = await Promise.all([ui.browser.waitForResponse(endpoint, { timeout: 120000 }),
      modal.getByRole("button", "Envoyer", { exact: true }).click()]);
    const reply = await response.json<{ ok: boolean; data?: { message_id: string }; error?: { code: string } }>();
    const sent = await readEstimate(ui.browser, p.ids.versionId);
    await recordOfferEvidence(ui.army, "NF02-send-actual", { ids: p.ids, originalName: p.originalName,
      responseStatus: response.status, ok: reply.ok, errorCode: reply.error?.code ?? null,
      versionStatus: sent.version.status, totals: totals(sent.version), requests, leases, preparedUpdatedAtSha256: digest(expectedToken),
      receiptCountBefore: beforeReceipts.length, receiptCountAfter: (await receiptNames()).length,
      zeroDbCountsQualified: false });
    expect(response.status).toBe(200);
    expect(reply.ok).toBe(true);
    expect(requests.length).toBe(1);
    expect(requests[0].originalCas).toBe(true);
    expect(requests[0].updatedAtSha256).toBe(digest(expectedToken));
    expect(leases.some((lease) => ["POST", "PATCH"].includes(lease.method) && lease.sessionSha256 === requests[0].sessionSha256)).toBe(true);
    expect(leases.some((lease) => lease.forced)).toBe(false);
    expect(requests[0].sessionSha256).not.toBeNull();
    expect(requests[0].requestKeySha256).not.toBeNull();
    expect(sent.version.status).toBe("sent");
    expect(totals(sent.version)).toEqual([2000, 400, 2400]);
    const result = await collected(reply.data!.message_id);
    const finalPdf = await apiRequest<{ ok: boolean; data: { status: string; sha256_hash: string } }>(
      ui.browser, "GET", `/api/estimates/${p.ids.versionId}/pdf?format=json`);
    await recordOfferEvidence(ui.army, "NF02-final-receipt", { ids: p.ids, originalName: p.originalName,
      receipt: result.receipt, finalPdfStatus: finalPdf.status, finalPdfState: finalPdf.body.data.status,
      finalPdfSha256: finalPdf.body.data.sha256_hash, previewSha256: preview.sha256,
      requestKeySha256: requests[0].requestKeySha256, sessionSha256: requests[0].sessionSha256,
      totals: totals(sent.version), zeroDbCountsQualified: false });
    expect(finalPdf.status).toBe(200);
    expect(finalPdf.body.data.status).toBe("ready");
    expect(finalPdf.body.data.sha256_hash).toBe(result.receipt.pdf.sha256);
    expect((await receiptNames()).length).toBe(beforeReceipts.length + 1);
    primaryBodyFailed = false;
  } finally {
    const cleanupErrors: string[] = [];
    for (const [name, pattern] of [["send", endpoint], ["pdf", pdfEndpoint], ["lease", leasePattern]] as const) {
      try { await ui.browser.unroute(pattern); } catch { cleanupErrors.push(name); }
    }
    await recordOfferEvidence(ui.army, "NF02-cleanup", { primaryBodyFailed, cleanupErrors, routesRemoved: cleanupErrors.length === 0, zeroDbCountsQualified: false });
    if (!primaryBodyFailed && cleanupErrors.length) throw new Error("NF02 route cleanup failed; run not qualified.");
  }
});

// NF04 observes the enabled PDF action during a real held send; never clicks it.
offerTest("NF04 PDF preparation is disabled while the real email is submitting", options, async (ui) => {
  const p = await prepare(ui, "NF04");
  const before = await readEstimate(ui.browser, p.ids.versionId);
  const beforeReceipts = await receiptNames();
  const endpoint = new URL(`/api/estimates/${p.ids.versionId}/send`, ui.app.baseUrl!).href;
  const pdfPattern = new RegExp(`/api/estimates/${p.ids.versionId}/pdf(?:\\?.*)?$`);
  const requests: { originalCas: boolean; updatedAtSha256: string; sessionSha256: string | null; requestKeySha256: string | null }[] = [];
  let pdfPosts = 0;
  let holdActive = false;
  let released = false;
  let holdStartedAt: number | null = null;
  let holdReleasedAt: number | null = null;
  let releaseReason: "finally" | "safety-timeout" | null = null;
  let safetyTimer: ReturnType<typeof setTimeout> | undefined;
  let releasePromise!: () => void;
  const heldRequest = new Promise<void>((resolve) => { releasePromise = resolve; });
  const releaseHold = (reason: "finally" | "safety-timeout") => {
    if (released) return;
    released = true;
    holdActive = false;
    holdReleasedAt = Date.now();
    releaseReason = reason;
    if (safetyTimer !== undefined) clearTimeout(safetyTimer);
    releasePromise();
  };
  await ui.browser.route(endpoint, async (route) => {
    if (route.request.method === "POST") {
      const session = route.request.headers["x-estimate-draft-lock-session-id"] ?? "";
      const key = route.request.headers["idempotency-key"] ?? "";
      requests.push({ originalCas: route.request.headers["if-match"] === before.version.updated_at,
        updatedAtSha256: digest(route.request.headers["if-match"] ?? ""),
        sessionSha256: session ? digest(session) : null, requestKeySha256: key ? digest(key) : null });
      if (!released) {
        holdActive = true;
        holdStartedAt ??= Date.now();
        safetyTimer ??= setTimeout(() => releaseHold("safety-timeout"), 12000);
        await heldRequest;
      }
    }
    await route.fallback();
  });
  await ui.browser.route(pdfPattern, async (route) => {
    if (route.request.method === "POST") pdfPosts += 1;
    await route.fallback();
  });
  const modal = ui.screen.getByRole("dialog", "Envoyer le devis par email", { exact: true });
  let responsePromise: ReturnType<typeof ui.browser.waitForResponse> | undefined;
  let primaryError: unknown = null;
  let primaryBodyFailed = true;
  let normalEmissionVerified = false;
  const cleanupErrors: string[] = [];
  try {
    await ui.screen.getByRole("button", "Envoyer par email", { exact: true }).click();
    await expect(modal).toBeVisible();
    await modal.getByLabel("Destinataire *", { exact: true }).fill("army-nf04@offer.invalid");
    await modal.getByLabel("Objet *", { exact: true }).fill("NF04 émission normale pendant attente UI");
    await modal.getByLabel("Message *", { exact: true }).fill("Proposition confirmée sans nouvelle préparation concurrente.");
    const confirm = modal.getByRole("button", "Envoyer", { exact: true });
    await expect(confirm).toBeEnabled();
    responsePromise = ui.browser.waitForResponse(endpoint, { timeout: 120000 });
    void responsePromise.catch(() => undefined);
    await confirm.click();
    await expect.poll(() => holdActive, { timeout: 5000 }).toBe(true);
    const action = modal.getByRole("button", "Préparer le PDF", { exact: true });
    const actionCount = await action.count();
    const actionDisabled = actionCount === 1 ? await action.isDisabled() : null;
    const submitDisabled = await confirm.isDisabled();
    const duringReceipts = await receiptNames();
    await recordOfferEvidence(ui.army, "NF04-held-submit-actual", { ids: p.ids, originalName: p.originalName,
      holdActive, holdAgeMs: holdStartedAt === null ? null : Date.now() - holdStartedAt,
      safetyLimitMs: 12000, sendPosts: requests.length, requests, submitDisabled,
      pdfActionCount: actionCount, pdfActionDisabled: actionDisabled, pdfPosts,
      collectorUnchanged: JSON.stringify(duringReceipts) === JSON.stringify(beforeReceipts),
      pdfClickedDuringHold: false, zeroDbCountsQualified: false });
    expect(holdActive).toBe(true);
    expect(requests.length).toBe(1);
    expect(requests[0].originalCas).toBe(true);
    expect(submitDisabled).toBe(true);
    expect(pdfPosts).toBe(0);
    expect(duringReceipts).toEqual(beforeReceipts);
    await expect(action).toBeDisabled({ timeout: 2000 });
    primaryBodyFailed = false;
  } catch (error) {
    primaryError = error;
  } finally {
    releaseHold("finally");
    try {
      if (responsePromise) {
        const response = await responsePromise;
        const reply = await response.json<{ ok: boolean; data?: { message_id: string }; error?: { code: string } }>();
        const sent = await readEstimate(ui.browser, p.ids.versionId);
        const afterReceipts = await receiptNames();
        const holdDurationMs = holdStartedAt === null || holdReleasedAt === null ? null : holdReleasedAt - holdStartedAt;
        await recordOfferEvidence(ui.army, "NF04-released-send-actual", { ids: p.ids, originalName: p.originalName,
          responseStatus: response.status, ok: reply.ok, errorCode: reply.error?.code ?? null,
          versionStatus: sent.version.status, totals: totals(sent.version), requests, pdfPosts,
          receiptCountBefore: beforeReceipts.length, receiptCountAfter: afterReceipts.length,
          holdDurationMs, releaseReason, primaryBodyFailed, zeroDbCountsQualified: false });
        expect(response.status).toBe(200);
        expect(reply.ok).toBe(true);
        expect(sent.version.status).toBe("sent");
        expect(totals(sent.version)).toEqual([2000, 400, 2400]);
        expect(requests.length).toBe(1);
        expect(pdfPosts).toBe(0);
        expect(afterReceipts.length).toBe(beforeReceipts.length + 1);
        expect(holdDurationMs !== null && holdDurationMs <= 15000).toBe(true);
        const result = await collected(reply.data!.message_id);
        await recordOfferEvidence(ui.army, "NF04-final-receipt", { ids: p.ids, receipt: result.receipt,
          pdfClickedDuringHold: false, zeroDbCountsQualified: false });
        normalEmissionVerified = true;
      }
    } catch (error) {
      primaryError ??= error;
    } finally {
      for (const [name, pattern] of [["send", endpoint], ["pdf", pdfPattern]] as const) {
        try { await ui.browser.unroute(pattern); } catch { cleanupErrors.push(name); }
      }
      await recordOfferEvidence(ui.army, "NF04-cleanup", { ids: p.ids, primaryBodyFailed, normalEmissionVerified,
        holdReleased: released, releaseReason, cleanupErrors, routesRemoved: cleanupErrors.length === 0,
        pdfClickedDuringHold: false, zeroDbCountsQualified: false });
    }
  }
  if (primaryError) throw primaryError;
  if (!normalEmissionVerified || cleanupErrors.length) throw new Error("NF04 normal emission or route cleanup incomplete; run not qualified.");
});
// Append only after root GO. No existing EF/OF/PDFL body is changed.
// Failure modes and setup limits were written in this packet's plan.md first.
function nf03Source(state: Awaited<ReturnType<typeof readEstimate>>) {
  const { updated_at, approval_status, approval_summary, approval_evaluated_at, ...commercial } = state.version;
  const items = [...state.items].sort((left, right) => left.id.localeCompare(right.id));
  return {
    ids: { projectId: state.project.id, versionId: state.version.id }, projectName: state.project.name,
    status: state.version.status, calcEngineVersion: state.version.calc_engine_version,
    totals: totals(state.version), contentRevision: state.version.content_revision,
    snapshotRevision: state.version.calc_snapshot_content_revision,
    snapshotContextPresent: state.version.calc_snapshot_context !== null && state.version.calc_snapshot_context !== undefined,
    updatedAtSha256: digest(updated_at),
    approvalFieldPresent: Object.hasOwn(state.version, "approval_evaluated_at"),
    approvalEvaluatedAtNull: approval_evaluated_at === null,
    approvalEvaluatedAtPresent: typeof approval_evaluated_at === "string" && approval_evaluated_at.length > 0,
    approvalStatus: approval_status ?? null, approvalSummarySha256: digest(JSON.stringify(approval_summary ?? null)),
    sourceFingerprint: efSourceFingerprint(state),
    commercialFingerprint: digest(JSON.stringify({ version: commercial, items })),
    itemsFingerprint: digest(JSON.stringify(items)),
  };
}

async function nf03Gating(ui: OfferUi, versionId: string) {
  return ui.browser.evaluate(async (id) => {
    const response = await fetch(`/api/estimates/${id}/gating`, { credentials: "same-origin", redirect: "error" });
    const text = await response.text();
    const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const body = JSON.parse(text) as { ok?: boolean; data?: { gating?: { blockingFlags?: { key?: unknown }[]; warningFlags?: { key?: unknown }[] } }; error?: { code?: string } };
    const flags = body.data?.gating;
    const valid = (rows: unknown): rows is { key: string }[] => Array.isArray(rows) && rows.every((row) => row && typeof row.key === "string" && /^[a-z0-9_]+$/.test(row.key));
    const shapeValid = valid(flags?.blockingFlags) && valid(flags?.warningFlags);
    return { responseStatus: response.status, ok: body.ok ?? null, errorCode: body.error?.code ?? null,
      responseBytes: new TextEncoder().encode(text).byteLength, responseSha256: sha, codesShapeValid: shapeValid,
      blockingFlags: valid(flags?.blockingFlags) ? flags.blockingFlags.map((flag) => flag.key).sort() : null,
      warningFlags: valid(flags?.warningFlags) ? flags.warningFlags.map((flag) => flag.key).sort() : null };
  }, versionId);
}

offerTest("NF03 first Affaire opening after editor PDF sends its original projection without reload", options, async (ui) => {
  const originalName = `${ui.army.runPrefix}-NF03-ORIGINAL`;
  const ids = await createEstimateViaWizard(ui, { projectName: originalName, title: "NF03 première ouverture Affaire" }, ui.army);
  const base = new URL(ui.app.baseUrl!).origin;
  const sendUrl = new URL(`/api/estimates/${ids.versionId}/send`, base).href;
  const pdfUrl = new URL(`/api/estimates/${ids.versionId}/pdf?force=1`, base).href;
  const leasePattern = new RegExp(`/api/estimates/${ids.versionId}/lock(?:\\?.*)?$`);
  const pagePattern = new RegExp(`/dashboard/(?:affaires/${ids.projectId}|estimates/${ids.versionId}(?:/edit)?)(?:\\?.*)?$`);
  const requests: { ifMatchPresent: boolean; ifMatchSha256: string | null; matchesBeforeAffaire: boolean; matchesCurrentAfterAffaire: boolean;
    ownSessionPresent: boolean; ownSessionSha256: string | null; requestKeyPresent: boolean; requestKeySha256: string | null;
    envelopeMatchesVisible: boolean; bodySha256: string; explicitAffaireOpenCount: number; priorPageRequests: number }[] = [];
  const leases: { method: string; forced: boolean; sessionSha256: string | null }[] = [];
  const pdfRequests: { method: string; sessionPresent: boolean; sessionSha256: string | null }[] = [];
  const pages: { path: string; method: string; rsc: boolean; prefetch: boolean; phase: string }[] = [];
  let beforeAffaireTimestamp = "", currentAfterAffaireTimestamp = "", explicitAffaireOpenCount = 0;
  let pagePhase = "initial-editor", primaryBodyFailed = false;
  const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
  await ui.browser.route(sendUrl, async (route) => {
    if (route.request.method === "POST") {
      const headers = route.request.headers;
      const timestamp = headers["if-match"] ?? "";
      const session = headers["x-estimate-draft-lock-session-id"] ?? "";
      const key = headers["idempotency-key"] ?? "";
      const body = route.request.postData ?? "";
      let envelopeMatchesVisible = false;
      try {
        const value = JSON.parse(body) as { to?: unknown; cc?: unknown; subject?: unknown; message?: unknown };
        envelopeMatchesVisible = value.to === "army-nf03@offer.invalid" && value.subject === "NF03 première offre Affaire" && value.message === "ARMY confirmation depuis la première projection Affaire." &&
          (value.cc === undefined || (Array.isArray(value.cc) && value.cc.length === 0));
      } catch { /* Forward the real malformed body unchanged and retain its hash. */ }
      requests.push({ ifMatchPresent: timestamp.length > 0, ifMatchSha256: timestamp ? digest(timestamp) : null,
        matchesBeforeAffaire: timestamp.length > 0 && timestamp === beforeAffaireTimestamp,
        matchesCurrentAfterAffaire: timestamp.length > 0 && timestamp === currentAfterAffaireTimestamp,
        ownSessionPresent: uuid.test(session), ownSessionSha256: session ? digest(session) : null,
        requestKeyPresent: uuid.test(key), requestKeySha256: key ? digest(key) : null,
        envelopeMatchesVisible, bodySha256: digest(body), explicitAffaireOpenCount, priorPageRequests: pages.length });
    }
    await route.fallback();
  });
  await ui.browser.route(leasePattern, async (route) => {
    const url = new URL(route.request.url), session = route.request.headers["x-estimate-draft-lock-session-id"] ?? "";
    let forceBody = false;
    try { forceBody = JSON.parse(route.request.postData ?? "{}").force === true; } catch { /* Preserve real body. */ }
    leases.push({ method: route.request.method, forced: ["true", "1"].includes(url.searchParams.get("force") ?? "") || forceBody, sessionSha256: session ? digest(session) : null });
    await route.fallback();
  });
  await ui.browser.route(pdfUrl, async (route) => {
    const session = route.request.headers["x-estimate-draft-lock-session-id"] ?? "";
    pdfRequests.push({ method: route.request.method, sessionPresent: uuid.test(session), sessionSha256: session ? digest(session) : null });
    await route.fallback();
  });
  await ui.browser.route(pagePattern, async (route) => {
    const url = new URL(route.request.url);
    pages.push({ path: url.pathname, method: route.request.method, rsc: route.request.headers.rsc === "1",
      prefetch: route.request.headers["next-router-prefetch"] === "1" || route.request.headers.purpose === "prefetch", phase: pagePhase });
    await route.fallback();
  });
  try {
    // UI preparation ends before prepare()'s detail/Affaire navigation.
    const itemUrl = new URL(`/api/estimates/${ids.versionId}/items`, base).href;
    const [parentReply] = await Promise.all([ui.browser.waitForResponse(itemUrl, { timeout: 60000 }), ui.screen.getByTestId("estimate-editor-add-root-section-button").click()]);
    const parent = await parentReply.json<{ ok: boolean; data: { item: ArmyItem } }>();
    await recordOfferEvidence(ui.army, "NF03-section-created", { ids, responseStatus: parentReply.status, ok: parent.ok, sectionId: parent.data.item.id });
    expect(parentReply.status).toBe(201); expect(parent.ok).toBe(true);
    await expect(ui.browser.locator(`[data-estimate-item-id="${parent.data.item.id}"]`)).toHaveCount(1);
    await ui.screen.getByRole("button", "Ajouter dans Nouveau lot", { exact: true }).click();
    const [lineReply] = await Promise.all([ui.browser.waitForResponse(itemUrl, { timeout: 60000 }), ui.screen.getByTestId("estimate-section-add-line-button").click()]);
    const line = await lineReply.json<{ ok: boolean; data: { item: ArmyItem } }>();
    await recordOfferEvidence(ui.army, "NF03-line-created", { ids, responseStatus: lineReply.status, ok: line.ok, lineId: line.data.item.id, parentId: line.data.item.parent_id });
    expect(lineReply.status).toBe(201); expect(line.ok).toBe(true); expect(line.data.item.parent_id).toBe(parent.data.item.id);
    const title = `${ui.army.runPrefix}-NF03-prestation`;
    await ui.screen.getByTestId("estimate-line-title-input").fill(title); await ui.browser.keyboard.press("Tab");
    await ui.screen.getByLabel(`Unité pour ${title}`, { exact: true }).fill("u"); await ui.browser.keyboard.press("Tab");
    await setLineCoreValues(ui, title, { quantity: "1", unitPriceHt: "20.00" }); await ui.browser.keyboard.press("Control+s");
    await expect.poll(async () => totals((await readEstimate(ui.browser, ids.versionId)).version), { timeout: 45000 }).toEqual([2000, 400, 2400]);
    await expect(ui.screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/^(À jour|Sauvegardé)$/);
    const beforePdf = await readEstimate(ui.browser, ids.versionId);
    await recordOfferEvidence(ui.army, "NF03-before-editor-pdf", { source: nf03Source(beforePdf), lineId: line.data.item.id, lineTitle: title, pages, receiptCount: (await receiptNames()).length });
    if (!Object.hasOwn(beforePdf.version, "approval_evaluated_at") || beforePdf.version.approval_evaluated_at !== null) throw new Error("NF03 missing prerequisite: approval_evaluated_at must really be NULL before editor PDF, without resetting it.");
    expect(beforePdf.project.name).toBe(originalName); expect(beforePdf.version.calc_engine_version).toBe(2); expect(beforePdf.version.status).toBe("draft");
    await expect(ui.browser).toHaveURL(new RegExp(`/dashboard/estimates/${ids.versionId}/edit(?:[?#].*)?$`));
    await ui.screen.getByTestId("estimate-page-toolbar-more-actions-button").click();
    await ui.screen.getByRole("button", "Préparer le PDF", { exact: true }).click();
    const pdfModal = ui.screen.getByRole("dialog", "Préparer le devis PDF", { exact: true });
    await expect(pdfModal.getByRole("button", "Générer et télécharger", { exact: true })).toBeEnabled();
    const [generation] = await Promise.all([ui.browser.waitForResponse(pdfUrl, { timeout: 120000 }), pdfModal.getByRole("button", "Générer et télécharger", { exact: true }).click()]);
    const generated = await generation.json<{ ok?: boolean; error?: { code?: string } }>();
    await recordOfferEvidence(ui.army, "NF03-editor-pdf-http", { ids, responseStatus: generation.status, ok: generated.ok ?? null, errorCode: generated.error?.code ?? null, pdfRequests, leases, receiptCount: (await receiptNames()).length });
    expect([200, 202]).toContain(generation.status); expect(generated.ok).toBe(true);
    await waitForPdfReady(ui, ids.versionId); await expect(pdfModal).not.toBeVisible();
    // No detail, Affaire or reload here: these owner GETs do not replace UI props.
    const pdfState = await apiRequest<{ ok: boolean; data: { status: string; sha256_hash?: string; file_size_bytes?: number } }>(ui.browser, "GET", `/api/estimates/${ids.versionId}/pdf?format=json`);
    const beforeGating = await nf03Gating(ui, ids.versionId);
    const beforeAffaire = await readEstimate(ui.browser, ids.versionId);
    beforeAffaireTimestamp = beforeAffaire.version.updated_at;
    const receiptsBefore = await receiptNames();
    await recordOfferEvidence(ui.army, "NF03-before-first-affaire", { source: nf03Source(beforeAffaire), originalName, lineId: line.data.item.id, lineTitle: title,
      pdf: { responseStatus: pdfState.status, ok: pdfState.body.ok, status: pdfState.body.data.status, sha256: pdfState.body.data.sha256_hash ?? null, bytes: pdfState.body.data.file_size_bytes ?? null },
      gating: beforeGating, pages, pdfRequests, leases, receiptCount: receiptsBefore.length, explicitAffaireOpenCount, noReloadBeforeFirstAffaire: true, nativeCountsQualified: false });
    if (!Object.hasOwn(beforeAffaire.version, "approval_evaluated_at") || beforeAffaire.version.approval_evaluated_at !== null) throw new Error("NF03 missing prerequisite: approval_evaluated_at is already evaluated before the first Affaire opening; no reset or blocked prefetch permitted.");
    if (beforeGating.responseStatus !== 200 || beforeGating.ok !== true || !beforeGating.codesShapeValid || beforeGating.blockingFlags?.length !== 0) throw new Error("NF03 missing prerequisite: real post-PDF gating must permit the nominal send; preserve actual blocker codes without override.");
    expect(pdfState.status).toBe(200); expect(pdfState.body.ok).toBe(true); expect(pdfState.body.data.status).toBe("ready");
    expect(typeof pdfState.body.data.sha256_hash === "string" && /^[a-f0-9]{64}$/.test(pdfState.body.data.sha256_hash)).toBe(true);
    expect(typeof pdfState.body.data.file_size_bytes === "number" && pdfState.body.data.file_size_bytes > 0).toBe(true);
    expect(pdfRequests.filter((request) => request.method === "POST").length).toBe(1); expect(pdfRequests.find((request) => request.method === "POST")?.sessionPresent).toBe(true);
    expect(receiptsBefore.length).toBe(0);
    pagePhase = "first-affaire"; explicitAffaireOpenCount++;
    await ui.app.open(`/dashboard/affaires/${ids.projectId}`);
    const open = ui.screen.getByTestId("affaire-finish-line-email").getByRole("button", "Préparer l'envoi", { exact: true });
    await expect(open).toBeVisible();
    const afterAffaire = await readEstimate(ui.browser, ids.versionId), afterGating = await nf03Gating(ui, ids.versionId);
    currentAfterAffaireTimestamp = afterAffaire.version.updated_at;
    const beforeSource = nf03Source(beforeAffaire), afterSource = nf03Source(afterAffaire);
    const sendEnabled = !(await open.isDisabled());
    await recordOfferEvidence(ui.army, "NF03-first-affaire-loaded", { ids, before: beforeSource, after: afterSource, gating: afterGating, sendEnabled, pages, explicitAffaireOpenCount,
      approvalProjectionAdvancedUpdatedAt: currentAfterAffaireTimestamp !== beforeAffaireTimestamp,
      commercialAndItemsConserved: beforeSource.commercialFingerprint === afterSource.commercialFingerprint,
      tokenObservation: "Normal outgoing Affaire If-Match observed at POST; no React/Flight parser or replacement.", nativeCountsQualified: false });
    if (!afterSource.approvalEvaluatedAtPresent) throw new Error("NF03 missing prerequisite: first Affaire load did not persist its approval projection; no race qualification.");
    if (afterGating.responseStatus !== 200 || afterGating.ok !== true || !afterGating.codesShapeValid || afterGating.blockingFlags?.length !== 0) throw new Error("NF03 missing prerequisite: actual first-open Affaire gating has blockers; no send override.");
    expect(beforeSource.commercialFingerprint).toBe(afterSource.commercialFingerprint); expect(sendEnabled).toBe(true);
    await open.click();
    const modal = ui.screen.getByRole("dialog", "Envoyer le devis par email", { exact: true });
    await modal.getByLabel("Destinataire *", { exact: true }).fill("army-nf03@offer.invalid");
    await modal.getByLabel("Objet *", { exact: true }).fill("NF03 première offre Affaire");
    await modal.getByLabel("Message *", { exact: true }).fill("ARMY confirmation depuis la première projection Affaire.");
    const networkFile = process.env.E2E_OFFER_NETWORK_LOG;
    if (!networkFile) throw new Error("NF03 missing owned app network witness.");
    const eventsBefore = (await readFile(networkFile, "utf8")).split(/\r?\n/).filter(Boolean).map((row) => JSON.parse(row) as { kind: string; pid: number; role: string; allowed?: boolean });
    const installed = eventsBefore.filter((row) => row.kind === "guard-installed" && row.pid !== process.pid);
    await recordOfferEvidence(ui.army, "NF03-before-confirmation", { ids, source: afterSource, gating: afterGating, leases, pages, explicitAffaireOpenCount, networkGuardInstalled: installed.length > 0,
      receiptCount: (await receiptNames()).length, noReloadBeforeConfirm: true, outgoingHeadersUnmodified: true });
    expect(installed.length > 0).toBe(true);
    await expect(modal.getByRole("button", "Envoyer", { exact: true })).toBeEnabled();
    pagePhase = "sending";
    const [response] = await Promise.all([ui.browser.waitForResponse(sendUrl, { timeout: 120000 }), modal.getByRole("button", "Envoyer", { exact: true }).click()]);
    const reply = await response.json<{ ok: boolean; data?: { message_id?: string }; error?: { code?: string } }>();
    const after = await readEstimate(ui.browser, ids.versionId), receiptsAfter = await receiptNames();
    const eventsAfter = (await readFile(networkFile, "utf8")).split(/\r?\n/).filter(Boolean).map((row) => JSON.parse(row) as { kind: string; pid: number; role: string });
    await recordOfferEvidence(ui.army, "NF03-actual-response", { ids, originalName, responseStatus: response.status, ok: reply.ok, errorCode: reply.error?.code ?? null,
      requests, leases, beforeAffaire: beforeSource, currentAfterAffaire: afterSource, after: nf03Source(after), pages, explicitAffaireOpenCount,
      sealPayloadVersion: after.version.seal_payload_version ?? null, sealHashPresent: typeof after.version.seal_hash === "string" && /^[a-f0-9]{64}$/.test(after.version.seal_hash),
      receiptCountBefore: receiptsBefore.length, receiptCountAfter: receiptsAfter.length, newReceiptCount: receiptsAfter.filter((name) => !receiptsBefore.includes(name)).length,
      messageIdSha256: typeof reply.data?.message_id === "string" ? digest(reply.data.message_id) : null,
      collectorCallsBefore: eventsBefore.filter((row) => row.role === "collector").length, collectorCallsAfter: eventsAfter.filter((row) => row.role === "collector").length,
      noReloadBeforeConfirm: true, outgoingHeadersUnmodified: true, complementaryProof: { nativeCountsQualified: false, documentSealAndCapability: "root independent exclusive native qualification required" } });
    // A genuine stale first projection retains this HTTP/body/source/collector RED.
    expect(response.status).toBe(200); expect(reply.ok).toBe(true); expect(requests.length).toBe(1);
    expect(requests[0].ifMatchPresent).toBe(true); expect(requests[0].matchesCurrentAfterAffaire).toBe(true);
    expect(requests[0].ownSessionPresent).toBe(true); expect(requests[0].requestKeyPresent).toBe(true); expect(requests[0].envelopeMatchesVisible).toBe(true);
    expect(leases.some((lease) => ["POST", "PATCH"].includes(lease.method) && lease.sessionSha256 === requests[0].ownSessionSha256)).toBe(true);
    expect(leases.some((lease) => lease.forced)).toBe(false); expect(explicitAffaireOpenCount).toBe(1);
    expect(after.version.status).toBe("sent"); expect(after.version.seal_payload_version).toBe(5); expect(totals(after.version)).toEqual([2000, 400, 2400]);
    expect(receiptsAfter.filter((name) => !receiptsBefore.includes(name)).length).toBe(1);
    const receipt = await collected(reply.data!.message_id!);
    await recordOfferEvidence(ui.army, "NF03-collector-bound", { ids, receipt: receipt.receipt, messageIdSha256: digest(reply.data!.message_id!), pdfSha256: digest(receipt.pdf),
      actualBase64PdfMatches: digest(Buffer.from(receipt.packet.payload.attachments[0].content, "base64")) === digest(receipt.pdf), nativeCountsQualified: false });
  } catch (error) { primaryBodyFailed = true; throw error; }
  finally {
    const errors: string[] = [];
    try {
      const modal = ui.screen.getByRole("dialog", "Envoyer le devis par email", { exact: true });
      if ((await modal.count()) === 1) await modal.getByRole("button", "Annuler", { exact: true }).click();
    } catch (error) { errors.push(error instanceof Error ? error.name : "UnknownError"); }
    for (const route of [sendUrl, leasePattern, pdfUrl, pagePattern]) {
      try { await ui.browser.unroute(route); } catch (error) { errors.push(error instanceof Error ? error.name : "UnknownError"); }
    }
    try { await recordOfferEvidence(ui.army, "NF03-cleanup", { ids, primaryBodyFailed, cleanupErrors: errors, observerOverridesUsed: false, explicitAffaireOpenCount, nativeCountsQualified: false }); }
    catch (error) { if (!primaryBodyFailed) throw error; }
    if (!primaryBodyFailed && errors.length > 0) throw new Error("NF03 cleanup failed; no qualification.");
  }
});
