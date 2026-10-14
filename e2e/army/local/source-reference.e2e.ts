import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { test, type Browser } from "@e2e-dev/web";
import { expect } from "e2e";

import { readEstimate, recordEvidence, restrictCriticalBrowser } from "../critical/fixtures";

type Fixture = { status: string; schemaVersion: string; prefix: string; apiUrl: string; tenantId: string; ownerId: string; projectId: string; versionId: string; documents: { A: string; B: string }; corpusManifestSha256: string };
type Copy = { copyId: string; fileName: string; createdAt: string; state: "verified"; sha256: string; byteSize: number; pageCount: number; verifiedAt: string };
type Preparation = { documentId: string; expectedRevision: number; preparationKey: string };
type Prepared = { versionId: string; reviewRevision: number; copy: Copy; replayed: boolean };
type Confirmation = { copyId: string; expectedRevision: number; idempotencyKey: string; reviewedSha256: string; reason: string };
type Activation = { id: string; copyId: string; revision: number };
type Confirmed = { activation: Activation; currentRevision: number; currentCopyId: string; replayed: boolean };
type Event = { id: string; copyId: string; previousCopyId: string | null; revision: number; reason: string; actorId: string; actorName: string | null; occurredAt: string };
type Review = { versionId: string; projectId: string; revision: number; activeReference: Copy | null; selectedCopy: Copy | null; history: Event[]; nextBeforeRevision: number | null; confirmationReceipt: { canonicalRequest: Confirmation & { actorId: string; versionId: string }; activation: Activation } | null };
type Http = { status: number; cacheControl: string | null; contentType: string | null; body: unknown };
type Corpus = { revision: "A" | "B"; path: string; fileName: string; sha256: string; byteSize: number; pageCount: number };
type PdfRead = { pathname: string; status: number; contentType: string | null; cacheControl: string | null; sha256: string | null; length: string | null; disposition: string | null; nosniff: string | null; ranges: string | null; bytes: number[] };
type Probe = { posts: Array<{ pathname: string; request: Preparation | Confirmation; response: Http; discarded: boolean }>; pdfs: PdfRead[] };
type Recovery = { priorProofSha256: string; copyId: string; preparation: Preparation; restoredIntent: { schemaVersion: number; actorId: string; tenantId: string; versionId: string; preparation: Preparation; copyId: null; confirmation: null }; qualificationBoundary: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function http(browser: Browser, pathname: string, options: { method?: "GET" | "POST"; body?: unknown; rawBody?: string; contentType?: string; anonymous?: boolean } = {}): Promise<Http> {
  if (!/^\/api\/estimates\/[0-9a-f-]{36}\/source-review(?:[/?]|$)/.test(pathname)) throw new Error("Unexpected route outside source review");
  return JSON.parse(await browser.evaluate(async (request) => {
    const response = await fetch(request.pathname, { method: request.method, credentials: request.anonymous ? "omit" : "same-origin", redirect: "error", cache: "no-store", ...(request.body === null ? {} : { headers: { "content-type": request.contentType }, body: request.body }) });
    let body: unknown;
    try { body = await response.json(); } catch { body = { invalidJson: true }; }
    return JSON.stringify({ status: response.status, contentType: response.headers.get("content-type"), cacheControl: response.headers.get("cache-control"), body });
  }, { pathname, method: options.method ?? "GET", anonymous: options.anonymous ?? false, contentType: options.contentType ?? "application/json", body: options.rawBody ?? (options.body === undefined ? null : JSON.stringify(options.body)) })) as Http;
}

function success<T>(response: Http, status: number): T {
  expect(response.status).toBe(status);
  expect(response.cacheControl).toBe("private, no-store");
  expect(response.contentType).toContain("application/json");
  const body = response.body as { ok: boolean; data: T };
  expect(Object.keys(body).sort()).toEqual(["data", "ok"]);
  expect(body.ok).toBe(true);
  return body.data;
}

function failure(response: Http, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.cacheControl).toBe("private, no-store");
  expect(response.contentType).toContain("application/json");
  const body = response.body as { ok: boolean; error: { code: string; message: string } };
  expect(Object.keys(body).sort()).toEqual(["error", "ok"]);
  expect(body.ok).toBe(false);
  expect(Object.keys(body.error).sort()).toEqual(["code", "message"]);
  expect(body.error.code).toBe(code);
  expect(body.error.message.length > 0).toBe(true);
  expect(/storage\/v1|source_locator|destination_locator|SQLSTATE|service_role|Bearer |eyJ[A-Za-z0-9_-]+\./i.test(body.error.message)).toBe(false);
}

function verified(copy: Copy, corpus: Corpus) {
  expect(Object.keys(copy).sort()).toEqual(["byteSize", "copyId", "createdAt", "fileName", "pageCount", "sha256", "state", "verifiedAt"]);
  expect(UUID.test(copy.copyId)).toBe(true);
  expect([copy.state, copy.fileName, copy.pageCount, copy.byteSize, copy.sha256]).toEqual(["verified", corpus.fileName, 3, corpus.byteSize, corpus.sha256]);
  expect(Number.isFinite(Date.parse(copy.createdAt)) && Number.isFinite(Date.parse(copy.verifiedAt))).toBe(true);
}

// A controlled client transport interruption AFTER the real response completes.
// No cookie, authorization header, signed URL or editor session is inspected.
async function installProbe(browser: Browser, base: string, discardConfirmation: boolean) {
  await browser.evaluate((input) => {
    const scope = window as typeof window & { __sourceReferenceProbe?: Probe };
    scope.__sourceReferenceProbe = { posts: [], pdfs: [] };
    const original = window.fetch.bind(window);
    let discard = input.discardConfirmation;
    window.fetch = async (request, init) => {
      const url = new URL(typeof request === "string" ? request : request instanceof URL ? request.href : request.url, location.href);
      const response = await original(request, init);
      if (url.origin !== location.origin || !url.pathname.startsWith(input.base)) return response;
      const method = (init?.method ?? (request instanceof Request ? request.method : "GET")).toUpperCase();
      if (method === "POST") {
        const body = typeof init?.body === "string" ? JSON.parse(init.body) as Preparation | Confirmation : null;
        if (!body) throw new Error("Expected JSON source review request body");
        const discarded = discard && url.pathname === `${input.base}/reference`;
        scope.__sourceReferenceProbe!.posts.push({ pathname: url.pathname, request: body, response: { status: response.status, contentType: response.headers.get("content-type"), cacheControl: response.headers.get("cache-control"), body: await response.clone().json() }, discarded });
        if (discarded) {
          discard = false;
          throw new TypeError("ARMY ignored the completed confirmation response after server persistence");
        }
      }
      if (method === "GET" && /\/copies\/[0-9a-f-]{36}\/content$/.test(url.pathname)) {
        scope.__sourceReferenceProbe!.pdfs.push({ pathname: url.pathname, status: response.status, contentType: response.headers.get("content-type"), cacheControl: response.headers.get("cache-control"), sha256: response.headers.get("x-source-reference-sha256"), length: response.headers.get("content-length"), disposition: response.headers.get("content-disposition"), nosniff: response.headers.get("x-content-type-options"), ranges: response.headers.get("accept-ranges"), bytes: Array.from(new Uint8Array(await response.clone().arrayBuffer())) });
      }
      return response;
    };
    return true;
  }, { base, discardConfirmation });
}

async function probe(browser: Browser): Promise<Probe> {
  return JSON.parse(await browser.evaluate(() => JSON.stringify((window as typeof window & { __sourceReferenceProbe: Probe }).__sourceReferenceProbe))) as Probe;
}

async function preservePdf(value: PdfRead, copy: Copy, corpus: Corpus, prefix: string, label: string) {
  expect(value.status).toBe(200);
  expect([value.contentType, value.cacheControl, value.nosniff, value.ranges]).toEqual(["application/pdf", "private, no-store", "nosniff", "none"]);
  expect(value.pathname.endsWith(`/copies/${copy.copyId}/content`)).toBe(true);
  expect(value.disposition?.startsWith("inline;")).toBe(true);
  expect(value.disposition).toContain(corpus.fileName);
  const bytes = Buffer.from(value.bytes);
  expect([hash(bytes), value.sha256, value.length, bytes.length]).toEqual([corpus.sha256, corpus.sha256, String(corpus.byteSize), corpus.byteSize]);
  expect(bytes.equals(await readFile(path.resolve(".e2e/source-coverage/http-staged", corpus.path)))).toBe(true);
  expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
  const directory = path.resolve(".e2e/army/critical/artifacts/business");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `${prefix}-${label}.pdf`);
  await writeFile(file, bytes, { flag: "wx" });
  return { file, copyId: copy.copyId, sha256: hash(bytes), byteSize: bytes.length, pageCount: 3 };
}

test("source reference UI prepares and confirms A then B with exact PDF bytes and recovery of the same intention", {
  session: "army", tags: ["local", "source-reference"], trace: "off", timeout: 240_000,
}, async ({ app, browser, screen }) => {
  const file = process.env.E2E_SOURCE_REFERENCE_FIXTURE_PATH;
  if (!file || process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:59827") throw new Error("Explicit isolated source-reference fixture required");
  const fixture = JSON.parse(await readFile(file, "utf8")) as Fixture;
  expect([fixture.status, fixture.schemaVersion, fixture.apiUrl]).toEqual(["ready", "source-reference-http-fixture-1", "http://127.0.0.1:59827"]);
  expect([fixture.versionId, fixture.projectId, fixture.ownerId, fixture.tenantId, fixture.documents.A, fixture.documents.B].every((id) => UUID.test(id))).toBe(true);
  const recoveryFile = process.env.E2E_SOURCE_REFERENCE_RECOVERY_INPUT;
  const recoveryInput = recoveryFile ? JSON.parse(await readFile(recoveryFile, "utf8")) as { status: string; phase: string; fixtureSha256: string; recovery: Recovery } : null;
  const recovery = recoveryInput?.recovery ?? null;
  if (recoveryInput) {
    expect([recoveryInput.status, recoveryInput.phase, recoveryInput.fixtureSha256]).toEqual(["verified", "before", hash(await readFile(file))]);
    expect(recovery?.priorProofSha256).toBe(process.env.E2E_SOURCE_REFERENCE_RECOVERY_PROOF_SHA256);
    expect(recovery?.restoredIntent).toEqual({ schemaVersion: 1, actorId: fixture.ownerId, tenantId: fixture.tenantId, versionId: fixture.versionId, preparation: recovery?.preparation, copyId: null, confirmation: null });
    expect([recovery?.preparation.documentId, recovery?.preparation.expectedRevision]).toEqual([fixture.documents.A, 0]);
  }
  const manifestBytes = await readFile(".e2e/source-coverage/http-staged/fixtures/manifest.json");
  expect(hash(manifestBytes)).toBe(fixture.corpusManifestSha256);
  const corpus = (JSON.parse(manifestBytes.toString("utf8")) as { documents: Corpus[] }).documents;
  const a = corpus.find((entry) => entry.revision === "A")!, b = corpus.find((entry) => entry.revision === "B")!;
  expect(a.fileName).toBe(b.fileName); expect(a.sha256 === b.sha256).toBe(false);
  const army = { runPrefix: `${fixture.prefix}-vertical-${randomUUID()}`, projectName: fixture.prefix, ownedEstimates: [{ projectId: fixture.projectId, versionId: fixture.versionId }] };
  const evidence = (label: string, data: unknown) => recordEvidence(army, label, data);
  let screenshotDenied = false;
  async function capture(label: string) {
    const dom = await browser.evaluate(() => ({ pathname: location.pathname, title: document.querySelector("h1")?.textContent ?? null, regions: Array.from(document.querySelectorAll("section[aria-label]")).map((region) => ({ label: region.getAttribute("aria-label"), text: (region.textContent ?? "").replace(/\s+/g, " ").trim() })) }));
    let pixels: { status: string; file?: string; code?: string };
    if (screenshotDenied) pixels = { status: "unavailable", code: "POLICY_DENIED_ALREADY_OBSERVED" };
    else {
      try { pixels = { status: "captured", file: await app.screenshot(label) }; }
      catch (error) {
        const code = typeof error === "object" && error && "code" in error ? String(error.code) : "SCREENSHOT_UNAVAILABLE";
        pixels = { status: "unavailable", code };
        screenshotDenied = code === "POLICY_DENIED";
      }
    }
    await evidence(`source-ui-${label}`, { dom, pixels });
  }
  await restrictCriticalBrowser(browser, app);
  await app.open(`/dashboard/estimates/${fixture.versionId}`);
  const link = screen.getByRole("link", "Référence CCTP", { exact: true });
  await expect(link).toHaveAttribute("href", `/dashboard/estimates/${fixture.versionId}/source-review`);
  await link.tap();
  await expect(screen.getByRole("heading", "Référence CCTP", { exact: true })).toBeVisible();
  await expect(browser).toHaveURL(`/dashboard/estimates/${fixture.versionId}/source-review`);
  const before = await readEstimate(browser, fixture.versionId);
  await evidence("source-vertical-before", before);
  const base = `/api/estimates/${fixture.versionId}/source-review`;
  const empty = { versionId: fixture.versionId, projectId: fixture.projectId, revision: 0, activeReference: null, selectedCopy: null, history: [], nextBeforeRevision: null, confirmationReceipt: null };
  expect(success<Review>(await http(browser, base), 200)).toEqual(empty);

  const preparation: Preparation = { documentId: fixture.documents.A, expectedRevision: 0, preparationKey: randomUUID() };
  const confirmation: Confirmation = { copyId: randomUUID(), expectedRevision: 0, idempotencyKey: randomUUID(), reviewedSha256: a.sha256, reason: "Préflight synthétique" };
  const preflights: unknown[] = [];
  failure(await http(browser, base, { anonymous: true }), 401, "UNAUTHORIZED");
  for (const [suffix, valid] of [["copies", preparation], ["reference", confirmation]] as const) {
    const anonymous = await http(browser, `${base}/${suffix}`, { method: "POST", body: valid, anonymous: true });
    preflights.push({ suffix, label: "anonymous", response: anonymous });
    await evidence(`source-preflight-${suffix}-anonymous`, anonymous);
    failure(anonymous, 401, "UNAUTHORIZED");
    for (const [label, options, status, code] of [
      ["non-json", { rawBody: JSON.stringify(valid), contentType: "text/plain" }, 400, "SOURCE_REVIEW_INVALID_INPUT"],
      ["malformed", { rawBody: "{" }, 400, "SOURCE_REVIEW_INVALID_INPUT"],
      ["unknown-field", { body: { ...valid, actorId: fixture.ownerId } }, 400, "SOURCE_REVIEW_INVALID_INPUT"],
      ["oversized-utf8", { rawBody: JSON.stringify({ ...valid, extra: "é".repeat(4096) }) }, 413, "SOURCE_REVIEW_PAYLOAD_TOO_LARGE"],
    ] as const) {
      const response = await http(browser, `${base}/${suffix}`, { method: "POST", ...options });
      const body = "rawBody" in options ? options.rawBody : JSON.stringify(options.body);
      const result = { suffix, label, byteSize: Buffer.byteLength(body), bodySha256: hash(Buffer.from(body)), response };
      preflights.push(result); await evidence(`source-preflight-${suffix}-${label}`, result);
      if (label === "oversized-utf8") expect(Buffer.byteLength(body) > 8192 && body.length < 8192).toBe(true);
      failure(response, status, code);
    }
    const target = new URL(`${base}/${suffix}`, app.baseUrl!);
    if (target.origin !== "http://localhost:3117") throw new Error("Origin prefilter probe restricted to exact local application");
    // This anonymous Node request proves the prefilter, not browser cookie CSRF.
    const result = await fetch(target, { method: "POST", headers: { origin: "https://army-origin.invalid", "content-type": "application/json" }, body: JSON.stringify(valid), redirect: "error", signal: AbortSignal.timeout(10_000) });
    const response = { status: result.status, cacheControl: result.headers.get("cache-control"), contentType: result.headers.get("content-type"), body: await result.json() };
    preflights.push({ suffix, label: "foreign-origin-anonymous", response });
    await evidence(`source-preflight-${suffix}-origin`, { response, authenticatedCookieOriginQualified: false });
    failure(response, 403, "SOURCE_REVIEW_WRITE_FORBIDDEN");
  }
  expect(success<Review>(await http(browser, base), 200)).toEqual(empty);

  const requests: Array<{ method: string; pathname: string; body: unknown }> = [];
  await browser.route(`**${base}**`, async (route) => {
    const url = new URL(route.request.url);
    if (url.origin !== new URL(app.baseUrl!).origin) throw new Error("Source route escaped the local application");
    requests.push({ method: route.request.method, pathname: url.pathname + url.search, body: route.request.postData ? JSON.parse(route.request.postData) : null });
    await route.continue();
  });
  await installProbe(browser, base, true);
  const current = screen.getByRole("region", "Référence actuelle", { exact: true });
  const candidate = screen.getByRole("region", "Copie préparée", { exact: true });
  const selector = screen.getByLabel("Document CCTP", { exact: true });
  const prepare = screen.getByRole("button", "Préparer une copie", { exact: true });
  await expect(current.getByText("Aucune référence confirmée", { exact: true })).toBeVisible();
  await expect(selector).toHaveValue(""); await expect(prepare).toBeDisabled();
  if (recovery) {
    const stored = JSON.parse(await browser.evaluate((intent) => {
      const key = `source-reference:v1:${intent.tenantId}:${intent.actorId}:${intent.versionId}`;
      if (sessionStorage.getItem(key) !== null) throw new Error("Never overwrite an existing source-reference tab intention");
      sessionStorage.setItem(key, JSON.stringify(intent));
      return JSON.stringify(JSON.parse(sessionStorage.getItem(key)!));
    }, recovery.restoredIntent));
    expect(stored).toEqual(recovery.restoredIntent);
    await evidence("source-restored-pending-intention", { recovery, stored, method: "explicit harness restoration from verified canonical pending reservation; not automatic cross-device recovery" });
    const count = requests.filter((request) => request.method === "POST").length;
    await browser.reload({ timeout: 30_000 });
    const resumePreparation = screen.getByRole("button", "Reprendre la préparation", { exact: true });
    await expect(resumePreparation).toBeEnabled();
    const afterReloadCount = requests.filter((request) => request.method === "POST").length;
    await evidence("source-restored-preparation-reload", { before: count, after: afterReloadCount, requests: [...requests] });
    expect(afterReloadCount).toBe(count);
    await installProbe(browser, base, true);
    await resumePreparation.tap();
  } else {
    await selector.selectOption({ value: fixture.documents.A });
    await prepare.tap();
  }
  await expect.poll(async () => (await probe(browser)).posts.some((entry) => entry.pathname === `${base}/copies` && (entry.request as Preparation).documentId === fixture.documents.A), { timeout: 70_000 }).toBe(true);
  const preparationAProbe = (await probe(browser)).posts.find((entry) => entry.pathname === `${base}/copies`)!;
  await evidence("source-prepare-a-response", preparationAProbe);
  const preparedA = success<Prepared>(preparationAProbe.response, recovery ? 200 : 201);
  await expect(candidate.getByText("Copie prête à consulter", { exact: true })).toBeVisible();
  verified(preparedA.copy, a);
  expect([preparedA.versionId, preparedA.reviewRevision, preparedA.replayed]).toEqual([fixture.versionId, 0, Boolean(recovery)]);
  const prepareA = preparationAProbe.request as Preparation;
  expect([prepareA.documentId, prepareA.expectedRevision]).toEqual([fixture.documents.A, 0]); expect(UUID.test(prepareA.preparationKey)).toBe(true);
  if (recovery) { expect(prepareA).toEqual(recovery.preparation); expect(preparedA.copy.copyId).toBe(recovery.copyId); }
  expect(success<Review>(await http(browser, `${base}?copyId=${preparedA.copy.copyId}`), 200)).toEqual({ ...empty, selectedCopy: preparedA.copy });
  const prepareAReplayResponse = await http(browser, `${base}/copies`, { method: "POST", body: prepareA });
  await evidence("source-prepare-a-exact-replay", prepareAReplayResponse);
  expect(success<Prepared>(prepareAReplayResponse, 200)).toEqual({ ...preparedA, replayed: true });
  failure(await http(browser, `${base}/copies/${preparedA.copy.copyId}/content`, { anonymous: true }), 401, "UNAUTHORIZED");
  const confirm = screen.getByRole("button", "Confirmer la référence", { exact: true });
  await expect(confirm).toBeDisabled();
  await capture("a-prepared-before-confirmation");
  await candidate.getByRole("button", "Consulter la copie", { exact: true }).tap();
  await expect(screen.getByRole("region", "Consultation du CCTP", { exact: true })).toBeVisible();
  await expect(browser.locator('iframe[title="Copie conservée du CCTP"]')).toBeVisible();
  const bytesA = await preservePdf((await probe(browser)).pdfs.at(-1)!, preparedA.copy, a, army.runPrefix, "a-consulted");
  await capture("a-pdf-preview");
  await screen.getByRole("button", "Fermer la consultation", { exact: true }).tap();
  const consulted = screen.getByLabel("J’ai consulté cette copie", { exact: true });
  const reason = screen.getByLabel("Motif de confirmation", { exact: true });
  await consulted.tap(); await expect(confirm).toBeDisabled();
  const reasonA = "Recette synthétique : choix explicite de A après consultation de sa copie conservée.";
  await reason.fill(reasonA); await expect(confirm).toBeEnabled(); await confirm.tap();
  await expect(screen.getByRole("button", "Reprendre la confirmation", { exact: true })).toBeVisible();
  await expect.poll(async () => (await probe(browser)).posts.some((entry) => entry.pathname === `${base}/reference` && entry.discarded), { timeout: 40_000 }).toBe(true);
  const lostProbe = await probe(browser), lost = lostProbe.posts.find((entry) => entry.pathname === `${base}/reference`)!;
  await evidence("source-confirm-a-response-discarded", lost);
  const activeA = success<Confirmed>(lost.response, 201), confirmA = lost.request as Confirmation;
  expect(lost.discarded).toBe(true);
  expect(confirmA).toEqual({ copyId: preparedA.copy.copyId, expectedRevision: 0, idempotencyKey: confirmA.idempotencyKey, reviewedSha256: a.sha256, reason: reasonA });
  expect(UUID.test(confirmA.idempotencyKey) && confirmA.idempotencyKey !== prepareA.preparationKey).toBe(true);
  expect(activeA).toEqual({ activation: { id: activeA.activation.id, copyId: preparedA.copy.copyId, revision: 1 }, currentRevision: 1, currentCopyId: preparedA.copy.copyId, replayed: false });
  const stateA = success<Review>(await http(browser, `${base}?confirmationKey=${confirmA.idempotencyKey}`), 200);
  expect(stateA.revision).toBe(1); expect(stateA.activeReference).toEqual(preparedA.copy); expect(stateA.history).toHaveLength(1);
  expect(stateA.confirmationReceipt).toEqual({ canonicalRequest: { ...confirmA, actorId: fixture.ownerId, versionId: fixture.versionId }, activation: activeA.activation });
  const postsBeforeReload = requests.filter((request) => request.method === "POST").length;
  await browser.reload({ timeout: 30_000 });
  const resume = screen.getByRole("button", "Reprendre la confirmation", { exact: true });
  await expect(resume).toBeEnabled();
  const postsAfterReloadBeforeResume = requests.filter((request) => request.method === "POST").length;
  await evidence("source-confirmation-reload-before-resume", { before: postsBeforeReload, after: postsAfterReloadBeforeResume, requests: [...requests] });
  expect(postsAfterReloadBeforeResume).toBe(postsBeforeReload);
  await installProbe(browser, base, false);
  await resume.tap(); await expect(resume).toBeHidden();
  const replayAProbe = (await probe(browser)).posts.find((entry) => entry.pathname === `${base}/reference`)!;
  const replayA = success<Confirmed>(replayAProbe.response, 200);
  expect(replayAProbe.request).toEqual(confirmA); expect(replayA).toEqual({ ...activeA, replayed: true });
  const changedIntent = await http(browser, `${base}/reference`, { method: "POST", body: { ...confirmA, reason: "Autre contenu sous la même clé" } });
  await evidence("source-confirmation-key-conflict", changedIntent);
  failure(changedIntent, 409, "SOURCE_REVIEW_IDEMPOTENCY_CONFLICT");
  expect(success<Review>(await http(browser, base), 200).history).toEqual(stateA.history);
  const eventA = screen.getByTestId(`source-reference-event-${activeA.activation.id}`);
  await expect(eventA.getByText(reasonA, { exact: true })).toBeVisible();
  await expect(eventA).toContainText(stateA.history[0].actorName || "Auteur non renseigné");
  await expect(eventA).toContainText(new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(stateA.history[0].occurredAt)));
  await evidence("source-recovery-a", { prepareA, confirmA, activeA, replayA, stateA, bytesA, postsBeforeReload, postsAfterReloadBeforeResume, actualReplayRequest: replayAProbe.request, requests: [...requests] });

  await selector.selectOption({ value: fixture.documents.B }); await prepare.tap();
  await expect.poll(async () => (await probe(browser)).posts.some((entry) => entry.pathname === `${base}/copies` && (entry.request as Preparation).documentId === fixture.documents.B), { timeout: 70_000 }).toBe(true);
  const preparationBProbe = (await probe(browser)).posts.find((entry) => entry.pathname === `${base}/copies`)!;
  await evidence("source-prepare-b-response", preparationBProbe);
  const preparedB = success<Prepared>(preparationBProbe.response, 201);
  await expect(candidate.getByText("Copie prête à consulter", { exact: true })).toBeVisible();
  verified(preparedB.copy, b); expect(preparedB.copy.copyId === preparedA.copy.copyId).toBe(false);
  expect([preparedB.versionId, preparedB.reviewRevision, preparedB.replayed]).toEqual([fixture.versionId, 1, false]);
  const beforeB = success<Review>(await http(browser, `${base}?copyId=${preparedB.copy.copyId}`), 200);
  expect([beforeB.revision, beforeB.activeReference, beforeB.selectedCopy, beforeB.history]).toEqual([1, preparedA.copy, preparedB.copy, stateA.history]);
  await expect(current.getByText(a.fileName, { exact: true })).toBeVisible();
  await expect(current.getByText(`Empreinte ${a.sha256.slice(0, 12)}…`, { exact: true })).toBeVisible();
  await expect(confirm).toBeDisabled();
  await candidate.getByRole("button", "Consulter la copie", { exact: true }).tap();
  await expect(screen.getByRole("region", "Consultation du CCTP", { exact: true })).toBeVisible();
  const bytesB = await preservePdf((await probe(browser)).pdfs.at(-1)!, preparedB.copy, b, army.runPrefix, "b-consulted");
  await screen.getByRole("button", "Fermer la consultation", { exact: true }).tap();
  await consulted.tap();
  const reasonB = "Recette synthétique : B conserve 40 mm pour CH-A en zone A après nouvelle consultation.";
  await reason.fill(reasonB); await confirm.tap();
  await expect.poll(async () => (await probe(browser)).posts.some((entry) => entry.pathname === `${base}/reference` && (entry.request as Confirmation).copyId === preparedB.copy.copyId), { timeout: 40_000 }).toBe(true);
  const confirmationBProbe = (await probe(browser)).posts.filter((entry) => entry.pathname === `${base}/reference`).at(-1)!;
  const activeB = success<Confirmed>(confirmationBProbe.response, 201), confirmB = confirmationBProbe.request as Confirmation;
  expect(confirmB).toEqual({ copyId: preparedB.copy.copyId, expectedRevision: 1, idempotencyKey: confirmB.idempotencyKey, reviewedSha256: b.sha256, reason: reasonB });
  expect(confirmB.idempotencyKey === confirmA.idempotencyKey).toBe(false);
  expect(activeB).toEqual({ activation: { id: activeB.activation.id, copyId: preparedB.copy.copyId, revision: 2 }, currentRevision: 2, currentCopyId: preparedB.copy.copyId, replayed: false });
  await expect(screen.getByTestId(`source-reference-event-${activeB.activation.id}`).getByText(reasonB, { exact: true })).toBeVisible();
  const stateB = success<Review>(await http(browser, base), 200);
  expect([stateB.revision, stateB.activeReference]).toEqual([2, preparedB.copy]);
  expect(stateB.history.map((event) => [event.id, event.copyId, event.previousCopyId, event.revision, event.actorId, event.reason])).toEqual([[activeB.activation.id, preparedB.copy.copyId, preparedA.copy.copyId, 2, fixture.ownerId, reasonB], [activeA.activation.id, preparedA.copy.copyId, null, 1, fixture.ownerId, reasonA]]);
  const replayOldA = success<Confirmed>(await http(browser, `${base}/reference`, { method: "POST", body: confirmA }), 200);
  expect(replayOldA).toEqual({ activation: activeA.activation, currentRevision: 2, currentCopyId: preparedB.copy.copyId, replayed: true });
  const postCount = requests.filter((request) => request.method === "POST").length;
  await browser.reload({ timeout: 30_000 });
  await expect(screen.getByTestId(`source-reference-event-${activeB.activation.id}`)).toBeVisible();
  await expect(current.getByText(`Empreinte ${b.sha256.slice(0, 12)}…`, { exact: true })).toBeVisible();
  expect(success<Review>(await http(browser, base), 200)).toEqual(stateB);
  const postsAfterFinalReload = requests.filter((request) => request.method === "POST").length;
  await evidence("source-reload-after-b", { before: postCount, after: postsAfterFinalReload, requests: [...requests] });
  expect(postsAfterFinalReload).toBe(postCount);
  await capture("b-active-and-history");
  await installProbe(browser, base, false);
  await screen.getByTestId(`source-reference-event-${activeA.activation.id}`).getByRole("button", "Consulter cette ancienne copie", { exact: true }).tap();
  await expect(screen.getByRole("region", "Consultation du CCTP", { exact: true })).toBeVisible();
  const historyA = await preservePdf((await probe(browser)).pdfs.at(-1)!, preparedA.copy, a, army.runPrefix, "a-history-after-b");
  const page1 = success<Review>(await http(browser, `${base}?limit=1`), 200);
  const page2 = success<Review>(await http(browser, `${base}?limit=1&cursor=${page1.nextBeforeRevision}`), 200);
  expect(page1.history).toEqual([stateB.history[0]]); expect(page1.nextBeforeRevision).toBe(2);
  expect(page2.history).toEqual([stateB.history[1]]); expect(page2.nextBeforeRevision).toBe(null);
  expect(success<Review>(await http(browser, `${base}?cursor=1`), 200).history).toEqual([]);
  const after = await readEstimate(browser, fixture.versionId);
  await evidence("source-vertical-complete", { fixture, before, after, recovery, preflights, prepareA, preparedA, confirmA, activeA, replayA, beforeB, preparedB, confirmB, activeB, stateB, replayOldA, page1, page2, pdfs: [bytesA, bytesB, historyA], requests, claims: { realUi: true, responseDiscardedAfterServerCommit: true, automaticPostOnReload: false, anonymousRouteChecks: 4, fullRoleMatrix: false, originalMutation: false, cookieCsrf: false, malformedContentLength: false, professionalDocumentValidation: false } });
  expect(after).toEqual(before);
});
