import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { strFromU8, unzipSync } from "fflate";
import * as xlsx from "xlsx";

import { apiRequest, readEstimate, recordEvidence, type ArmyState } from "../critical/fixtures";

type Browser = Parameters<typeof apiRequest>[0];
type Envelope<T> = { ok: boolean; data: T; error?: { code: string } };
type Line = {
  label: string; lineId: string; productId: string; priceId: string; reference: string;
  quantity: number; price: number; ht: number; tax: number; ttc: number;
};
type Fixture = {
  status: string; apiUrl: string; prefix: string; projectId: string; versionId: string;
  supplierId: string; deliverySiteId: string; deliverySiteUpdatedAt: string;
  noteOrderId: string; noteItemId: string; quantityOrderId: string; quantityItemId: string;
  unitColumnPresent: boolean; noteItemBefore: Record<string, unknown>; lines: Line[];
  requests: Array<{ pathname: string; method: string }>;
  bulk?: { prefix: string; orders: Array<{ id: string; reference: string; label: string; template: Line;
    itemIds: string[]; itemCount: number; edit_revision: number; total_ht_cents: number; total_tax_cents: number; total_ttc_cents: number }> };
  oversizedOrderId?: string;
  oversized?: { itemIds: string[]; itemCount: number; reference: string };
};
type Item = {
  id: string; designation: string; reference: string | null; quantity: number;
  unit_price_ht_cents: number; line_total_ht_cents: number;
  product_id?: string | null; source_estimate_item_id?: string | null;
  source_selected_supplier_price_id?: string | null; unit?: string | null;
  price_unit?: string | null; tax_rate_bp?: number; line_tax_cents?: number; line_total_ttc_cents?: number;
};
type Order = { id: string; reference: string; status: string; total_ht_cents: number; suppliers: { id: string } | null };
type Preparation = {
  summary: { draftable_lines: number; blocked_lines: number };
  groups: Array<{ supplier_id: string; total_ht_cents: number; total_tax_cents: number; total_ttc_cents: number;
    lines: Array<{ item_id: string; quantity: number; unit: string; unit_price_ht_cents: number;
      line_total_ht_cents: number; line_tax_cents: number; line_total_ttc_cents: number; review_fingerprint: string }> }>;
};
type Created = { idempotency_key: string; replayed: boolean; orders: Array<{
  purchase_order_id: string; total_ht_cents: number; total_tax_cents: number; total_ttc_cents: number;
}> };

// Failure plan was recorded before product edits in docs/testing/purchase-decimals.md.
const fixtureTest = test.extend<{ fixture: Fixture }>({
  fixture: async ({ app, browser }, provide) => {
    const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    if (backend.origin !== "http://127.0.0.1:59827" || backend.username || backend.password) {
      throw new Error("Decimal purchases require the exact isolated backend.");
    }
    const file = process.env.E2E_PURCHASE_DECIMALS_FIXTURE_PATH;
    if (!file) throw new Error("An explicit new decimal campaign fixture is required.");
    const fixture = JSON.parse(await readFile(file, "utf8")) as Fixture;
    fixture.requests = [];
    expect(fixture.status).toBe("ready");
    expect(fixture.apiUrl).toBe(backend.origin);
    expect(fixture.prefix).toMatch(/^ARMY-DECIMAL-/);
    const origin = new URL(app.baseUrl!).origin;
    await browser.route("**/*", async (route) => {
      const url = new URL(route.request.url);
      if (url.origin === origin && (url.pathname.startsWith("/api/purchase-orders") || url.pathname.endsWith("/purchase-order-drafts"))) {
        fixture.requests.push({ pathname: url.pathname + url.search, method: route.request.method });
      }
      if (url.hostname === "api.fontshare.com" && url.pathname === "/v2/css" && route.request.method === "GET") {
        await route.fulfill({ headers: { "content-type": "text/css" }, body: "" });
        return;
      }
      const readOnly = ["GET", "HEAD", "OPTIONS"].includes(route.request.method);
      const auth = url.origin === backend.origin && url.pathname.startsWith("/auth/v1/");
      const lookup = readOnly && url.origin === backend.origin &&
        ["purchase_orders", "purchase_order_items", "suppliers", "delivery_sites"].some((table) => url.pathname === `/rest/v1/${table}`);
      const forbidden = !readOnly && /\/(send|email-dispatch|approve|status|invite|invitations|portal-tokens)(\/|$)/.test(url.pathname);
      if ((url.origin !== origin && !auth && !lookup) || forbidden) {
        await route.abort();
        throw new Error("Decimal campaign rejected a request outside its isolated scope.");
      }
      await route.continue();
    });
    await provide(fixture);
  },
});
const decimalTest = fixtureTest.extend<{ army: ArmyState }>({
  army: async ({ fixture }, provide) => {
    const runPrefix = `ARMY-DECIMAL-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const army = { runPrefix, projectName: fixture.prefix,
      ownedEstimates: [{ projectId: fixture.projectId, versionId: fixture.versionId }] };
    try { await provide(army); }
    finally { await recordEvidence(army, "decimal-fixtures", { fixture, retained: true, emails: "none" }); }
  },
});

async function items(browser: Browser, id: string) {
  const result = await apiRequest<Envelope<{ items: Item[] }>>(browser, "GET", `/api/orders?view=items&order_id=${id}`);
  expect(result.status).toBe(200);
  return result.body.data.items;
}
async function orders(browser: Browser, fixture: Fixture) {
  const result = await apiRequest<Envelope<{ items: Order[] }>>(browser, "GET", "/api/orders");
  expect(result.status).toBe(200);
  return result.body.data.items.filter((order) => order.suppliers?.id === fixture.supplierId).sort((a, b) => a.id.localeCompare(b.id));
}
function expectedItem(line: Line) {
  return { quantity: line.quantity, unit: "m", price_unit: "m", unit_price_ht_cents: line.price,
    tax_rate_bp: 2000, line_total_ht_cents: line.ht, line_tax_cents: line.tax, line_total_ttc_cents: line.ttc };
}
function manualRequest(fixture: Fixture, lines = fixture.lines.filter((line) => line.label !== "integer")) {
  return { supplierId: fixture.supplierId, deliverySiteId: fixture.deliverySiteId,
    expectedDeliveryDate: null, notes: "ARMY decimal manual creation",
    items: lines.map((line) => ({ designation: `${fixture.prefix} manual ${line.label}`, quantity: line.quantity,
      unit: "m", unitPriceCents: line.price, taxRateBp: 2000 })) };
}

function normalized(value: string) { return value.replace(/\s+/g, " ").trim(); }
function money(cents: number) { return normalized(new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100)); }
async function artifactFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Download evidence must not follow symlinks.");
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await artifactFiles(file));
    else result.push(file);
  }
  return result;
}
async function retainDownload(army: ArmyState, browser: Browser, format: string, trigger: () => Promise<void>) {
  const configuredRoot = process.env.E2E_ARMY_ARTIFACT_ROOT;
  if (!configuredRoot) throw new Error("The current run's exact artifact root is required.");
  const root = path.resolve(configuredRoot);
  const scoped = path.relative(path.resolve(".e2e/product-foundation/runs"), root);
  if (!scoped || scoped.startsWith("..") || path.isAbsolute(scoped)) throw new Error("Download root must stay inside the explicit current campaign.");
  const before = new Set(await artifactFiles(root));
  const download = await browser.waitForDownload(trigger);
  // TesterArmy returns an attempt-relative path. Bind it to the unique new
  // artifact from this exact call, never to cwd or a previous campaign file.
  const returnedPath = path.normalize(download.path);
  if (returnedPath.split(path.sep).includes("..")) throw new Error("Unsafe returned download path.");
  const candidates = (await artifactFiles(root)).filter((file) => !before.has(file) &&
    (path.isAbsolute(returnedPath) ? file === returnedPath : file.endsWith(path.sep + returnedPath)));
  if (candidates.length !== 1) throw new Error(`Expected one new artifact for this download; found ${candidates.length}.`);
  const source = candidates[0];
  const bytes = await readFile(source);
  const directory = path.resolve(".e2e/army/critical/artifacts/business", `${army.runPrefix}-exports`);
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `purchase.${format}`);
  await copyFile(source, file);
  return { bytes, evidence: { path: file, filename: download.suggestedFilename,
    runnerArtifactPath: path.relative(root, source).replaceAll("\\", "/"),
    bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") } };
}
function assertExportRows(rows: Array<Record<string, unknown>>, lines: Line[], fixture: Fixture) {
  expect(rows).toHaveLength(lines.length);
  for (const line of lines) {
    const row = rows.find((entry) => entry["Désignation article"] === `${fixture.prefix} manual ${line.label}`)!;
    expect(row).toBeDefined();
    expect(String(row["Quantité"])).toBe(String(line.quantity));
    expect(row["Unité"]).toBe("m");
    expect(row["Unité du prix"]).toBe("m");
    expect(Number(row["P.U. HT (EUR)"])).toBe(line.price / 100);
    expect(Number(row["Total ligne HT (EUR)"])).toBe(line.ht / 100);
    expect(Number(row["TVA ligne (EUR)"])).toBe(line.tax / 100);
    expect(Number(row["Total ligne TTC (EUR)"])).toBe(line.ttc / 100);
    expect(Number(row["Total HT commande (EUR)"])).toBe(16.51);
  }
}
function assertDocumentRows(rows: string[][], lines: Line[], fixture: Fixture, surface: "zip" | "print") {
  for (const line of lines) {
    const cells = rows.find((row) => row.some((cell) => cell.includes(`${fixture.prefix} manual ${line.label}`)))!;
    expect(cells).toBeDefined();
    const quantity = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(line.quantity);
    if (surface === "zip") {
      expect(cells.slice(2)).toEqual([quantity, "m", `${money(line.price)} / m`, money(line.ht), money(line.tax), money(line.ttc)]);
    } else {
      expect(cells).toContain(quantity);
      expect(cells).toContain("m");
      expect(cells).toContain(`${money(line.price)} par m`);
      expect(cells).toContain(money(line.ht));
    }
  }
}

decimalTest("local decimal purchase note-only editing preserves line identity and provenance", {
  session: "army", trace: "off", timeout: 240_000,
}, async ({ app, screen, browser, fixture, army }) => {
  await app.open(`/dashboard/orders/${fixture.noteOrderId}/edit`);
  const beforeSource = await readEstimate(browser, fixture.versionId);
  const before = await items(browser, fixture.noteOrderId);
  expect(before).toEqual([expect.objectContaining({ id: fixture.noteItemId, reference: fixture.lines[0].reference, quantity: 2 })]);
  const note = screen.getByLabel("Instructions complémentaires", { exact: true });
  await expect(note).toHaveValue("ARMY original note");
  await expect(screen.getByLabel("Quantité, ligne 1", { exact: true })).toHaveValue("2");
  await note.fill("ARMY note-only preservation witness");
  const [response] = await Promise.all([
    browser.waitForResponse(`**/api/purchase-orders/${fixture.noteOrderId}`),
    screen.getByRole("button", "Enregistrer", { exact: true }).tap(),
  ]);
  const body = await response.json();
  const after = await items(browser, fixture.noteOrderId);
  const afterSource = await readEstimate(browser, fixture.versionId);
  await recordEvidence(army, "note-only-edit", { before, beforeFullSeed: fixture.noteItemBefore,
    response: { status: response.status, body }, after, beforeSource, afterSource,
    projectionHasSourceFields: !!after[0] && "source_estimate_item_id" in after[0] });
  expect.soft(response.status).toBe(200);
  expect.soft(after).toHaveLength(1);
  expect.soft(after[0]?.id).toBe(fixture.noteItemId);
  expect.soft(after[0]?.reference).toBe(fixture.lines[0].reference);
  // The archived baseline recorded missing source fields separately. The
  // corrected read model must expose them so no persistence claim is inferred.
  expect.soft(after[0]).toMatchObject({ product_id: fixture.lines[0].productId,
    source_estimate_item_id: fixture.lines[0].lineId, source_selected_supplier_price_id: fixture.lines[0].priceId, unit: "m", price_unit: "m" });
  expect.soft(afterSource).toEqual(beforeSource);
  await app.open(`/dashboard/orders/${fixture.noteOrderId}/edit`);
  await expect(note).toHaveValue("ARMY note-only preservation witness");
  await expect(screen.getByLabel("Quantité, ligne 1", { exact: true })).toHaveValue("2");
  await screen.getByLabel("Quantité, ligne 1", { exact: true }).fill("12,5");
  await screen.getByLabel("Prix unitaire HT, ligne 1", { exact: true }).fill("1,23");
  const [correction] = await Promise.all([
    browser.waitForResponse(`**/api/purchase-orders/${fixture.noteOrderId}`),
    screen.getByRole("button", "Enregistrer", { exact: true }).tap(),
  ]);
  expect(correction.status).toBe(200);
  const corrected = await items(browser, fixture.noteOrderId);
  const correctionSource = await readEstimate(browser, fixture.versionId);
  const history = await apiRequest<Envelope<{ events: Array<{ operation: string; before: Item | null; after: Item | null }> }>>(
    browser, "GET", `/api/purchase-orders/${fixture.noteOrderId}/history`);
  await recordEvidence(army, "sourced-correction-history", { corrected, history, beforeSource, correctionSource });
  expect(corrected).toEqual([expect.objectContaining({ ...expectedItem(fixture.lines[1]), id: fixture.noteItemId,
    reference: fixture.lines[0].reference, product_id: fixture.lines[0].productId,
    source_estimate_item_id: fixture.lines[0].lineId, source_selected_supplier_price_id: fixture.lines[0].priceId })]);
  expect(correctionSource).toEqual(beforeSource);
  expect(history.status).toBe(200);
  expect(history.body.data.events.find((event) => event.operation === "update" && event.before?.quantity === 2 && event.after?.quantity === 12.5)).toMatchObject({ operation: "update",
    before: expect.objectContaining({ id: fixture.noteItemId, quantity: 2, unit_price_ht_cents: 1200 }),
    after: expect.objectContaining({ id: fixture.noteItemId, quantity: 12.5, unit_price_ht_cents: 123,
      source_estimate_item_id: fixture.lines[0].lineId }) });
  await app.open(`/dashboard/orders/${fixture.noteOrderId}`);
  await screen.getByText("Historique des lignes", { exact: true }).tap();
  await expect(screen.getByRole("heading", `Ligne modifiée — ${fixture.prefix} note witness`, { exact: true })).toBeVisible();
  await expect(screen.getByRole("row", /Avant 2 m 12,00/)).toBeVisible();
  await expect(screen.getByRole("row", /Après 12,5 m 1,23/)).toBeVisible();

  // A real second write wins between the current editor's read and PUT.
  // The UI receives the real 409; no fabricated success or auth bypass.
  await app.open(`/dashboard/orders/${fixture.noteOrderId}/edit`);
  await expect(note).toHaveValue("ARMY note-only preservation witness");
  await note.fill("ARMY stale editor must not win");
  await browser.evaluate((target) => {
    const scope = window as typeof window & { __decimalRevisionProbe?: { request: unknown; winnerStatus: number; loserStatus: number } };
    const original = window.fetch.bind(window);
    let injected = false;
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (!injected && url.origin === location.origin && url.pathname === target && init?.method === "PUT") {
        injected = true;
        const request = JSON.parse(String(init.body));
        const winner = await original(input, { ...init, body: JSON.stringify({ ...request, notes: "ARMY concurrent winner" }) });
        const loser = await original(input, init);
        scope.__decimalRevisionProbe = { request, winnerStatus: winner.status, loserStatus: loser.status };
        return loser;
      }
      return original(input, init);
    };
    return true;
  }, `/api/purchase-orders/${fixture.noteOrderId}`);
  await screen.getByRole("button", "Enregistrer", { exact: true }).tap();
  await expect(screen.getByRole("button", "Recharger la commande", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Enregistrer", { exact: true })).toBeDisabled();
  const race = await browser.evaluate(() => (window as typeof window & { __decimalRevisionProbe: {
    request: { expectedRevision: number }; winnerStatus: number; loserStatus: number;
  } }).__decimalRevisionProbe);
  const afterRace = await items(browser, fixture.noteOrderId);
  await recordEvidence(army, "revision-conflict-real-editor", { race, afterRace, corrected });
  expect(Number.isSafeInteger(race.request.expectedRevision)).toBe(true);
  expect(race).toMatchObject({ winnerStatus: 200, loserStatus: 409 });
  expect(afterRace).toEqual(corrected);
  await screen.getByRole("button", "Recharger la commande", { exact: true }).tap();
  await expect(note).toHaveValue("ARMY concurrent winner");
  await expect(screen.getByLabel("Quantité, ligne 1", { exact: true })).toHaveValue("12.5");
});

decimalTest("local decimal purchase form persists fractional quantities and exact line cents", {
  session: "army", trace: "off", timeout: 240_000,
}, async ({ app, screen, browser, fixture, army }) => {
  for (const line of fixture.lines.filter((line) => line.label !== "integer")) {
    await app.open(`/dashboard/orders/${fixture.quantityOrderId}/edit`);
    const quantity = screen.getByLabel("Quantité, ligne 1", { exact: true });
    await expect(quantity).toBeVisible();
    await expect(screen.getByLabel("Instructions complémentaires", { exact: true })).toHaveValue("ARMY original note");
    const input = line.label === "eighth" ? "0,125" : String(line.quantity);
    await quantity.fill(input);
    await screen.getByLabel("Prix unitaire HT, ligne 1", { exact: true }).fill(String(line.price / 100));
    const entered = await browser.evaluate(() => (document.querySelector('[aria-label="Quantité, ligne 1"]') as HTMLInputElement).value);
    const [response] = await Promise.all([
      browser.waitForResponse(`**/api/purchase-orders/${fixture.quantityOrderId}`),
      screen.getByRole("button", "Enregistrer", { exact: true }).tap(),
    ]);
    const body = await response.json();
    const persisted = await items(browser, fixture.quantityOrderId);
    await recordEvidence(army, `quantity-${line.label}`, { entered, expected: line,
      response: { status: response.status, body }, persisted });
    expect.soft(entered).toBe(input);
    expect.soft(response.status).toBe(200);
    expect.soft(persisted[0]).toMatchObject({ quantity: line.quantity, unit_price_ht_cents: line.price, line_total_ht_cents: line.ht });
    expect.soft(persisted[0]).toMatchObject({ id: fixture.quantityItemId, ...expectedItem(line) });
    await app.open(`/dashboard/orders/${fixture.quantityOrderId}/edit`);
    await expect(quantity).toBeVisible();
    const reloaded = await browser.evaluate(() => (document.querySelector('[aria-label="Quantité, ligne 1"]') as HTMLInputElement).value);
    await recordEvidence(army, `quantity-${line.label}-reload`, { reloaded, persisted });
    await expect.soft(quantity).toHaveValue(String(line.quantity));
  }
  const beforeInvalid = await items(browser, fixture.quantityOrderId);
  const putCount = () => fixture.requests.filter((request) => request.method === "PUT").length;
  const initialCount = putCount();
  for (const invalid of ["", "0", "-1", "0,0001", "abc", "2147483648"]) {
    const quantity = screen.getByLabel("Quantité, ligne 1", { exact: true });
    await quantity.fill(invalid);
    await expect(quantity).toHaveValue(invalid);
    await expect(screen.getByRole("button", "Enregistrer", { exact: true })).toBeDisabled();
  }
  await recordEvidence(army, "invalid-form-does-not-write", { beforeInvalid,
    afterInvalid: await items(browser, fixture.quantityOrderId), initialCount, finalCount: putCount() });
  expect(putCount()).toBe(initialCount);
  expect(await items(browser, fixture.quantityOrderId)).toEqual(beforeInvalid);
});

decimalTest("local decimal purchase preparation creates exact quantities and replays its receipt", {
  session: "army", trace: "off", timeout: 240_000,
}, async ({ app, screen, browser, fixture, army }) => {
  await app.open(`/dashboard/affaires/${fixture.projectId}`);
  const source = await readEstimate(browser, fixture.versionId);
  const endpoint = `/api/estimates/${fixture.versionId}/purchase-order-drafts`;
  const preview = await apiRequest<Envelope<Preparation>>(browser, "GET", endpoint);
  await recordEvidence(army, "decimal-preparation-preview", { fixture, preview, source });
  expect(preview.status).toBe(200);
  expect(preview.body.data.summary.draftable_lines).toBe(3);
  expect(preview.body.data.groups).toHaveLength(1);
  const group = preview.body.data.groups[0];
  expect(group).toMatchObject({ total_ht_cents: 1636, total_tax_cents: 327, total_ttc_cents: 1963 });
  const lines = fixture.lines.filter((line) => line.label !== "integer");
  for (const line of lines) {
    const reviewed = group.lines.find((candidate) => candidate.item_id === line.lineId)!;
    expect(reviewed).toMatchObject({ item_id: line.lineId, quantity: line.quantity, unit: "m",
      unit_price_ht_cents: line.price, tax_rate_bp: 2000, line_total_ht_cents: line.ht,
      line_tax_cents: line.tax, line_total_ttc_cents: line.ttc });
    expect(reviewed.review_fingerprint).toMatch(/^[a-f0-9]{64}$/);
  }
  await screen.getByLabel("Chantier de livraison", { exact: true }).selectOption({ value: fixture.deliverySiteId });
  const review = screen.getByRole("checkbox", "J’ai vérifié les lignes, les montants et la livraison.", { exact: true });
  const create = screen.getByRole("button", "Créer le brouillon", { exact: true });
  await expect(create).toBeDisabled();
  for (const line of lines) {
    await expect(screen.getByRole("rowheader", `${fixture.prefix} ${line.label} Réf. ${line.reference}`, { exact: true })).toBeVisible();
  }
  await review.check();
  await expect(create).toBeEnabled();
  await browser.evaluate((target) => {
    const scope = window as typeof window & { __decimalRecovery?: {
      count: number; request: unknown; result: unknown; receiptReads: number;
    } };
    scope.__decimalRecovery = { count: 0, request: null, result: null, receiptReads: 0 };
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.origin === location.origin && url.pathname === target) {
        const probe = scope.__decimalRecovery!;
        if (init?.method?.toUpperCase() === "POST") {
          probe.count += 1;
          probe.request = typeof init.body === "string" ? JSON.parse(init.body) : null;
          const response = await original(input, init);
          probe.result = { status: response.status, body: await response.clone().json() };
          if (probe.count === 1) throw new TypeError("ARMY discarded the persisted decimal preparation response");
          return response;
        }
        if (url.searchParams.has("idempotency_key") && (init?.method ?? "GET").toUpperCase() === "GET") {
          probe.receiptReads += 1;
          const response = await original(input, init);
          if (probe.receiptReads === 1) return new Response("{", { status: 200, headers: { "content-type": "application/json" } });
          return response;
        }
      }
      return original(input, init);
    };
    return true;
  }, endpoint);
  await create.tap();
  await expect(screen.getByText("Le résultat de la préparation reste à vérifier. Reprenez cette même demande avant d’en préparer une autre.", { exact: true })).toBeVisible();
  const probe = await browser.evaluate(() => (window as typeof window & { __decimalRecovery: {
    count: number; request: { idempotency_key: string; reviewed_lines: Array<{ item_id: string; review_fingerprint: string }> };
    result: { status: number; body: Envelope<Created> }; receiptReads: number;
  } }).__decimalRecovery);
  const request = probe.request;
  const created = probe.result;
  await recordEvidence(army, "decimal-preparation-created", { request, created, transport: "real response discarded after persistence" });
  expect(created.status).toBe(201);
  expect(probe.count).toBe(1);
  expect(request.reviewed_lines.map((line) => line.item_id).sort()).toEqual(lines.map((line) => line.lineId).sort());
  expect(created.body.data.orders).toHaveLength(1);
  const order = created.body.data.orders[0];
  const persisted = await items(browser, order.purchase_order_id);
  const retry = screen.getByRole("button", "Vérifier et reprendre la préparation", { exact: true });
  await retry.tap();
  await expect(screen.getByText("La réponse de vérification est illisible. Vérifiez à nouveau la préparation.", { exact: true })).toBeVisible();
  expect(fixture.requests.filter((entry) => entry.pathname === endpoint && entry.method === "POST")).toHaveLength(1);
  await retry.tap();
  await expect(screen.getByText("Préparation déjà enregistrée", { exact: true })).toBeVisible();
  await app.open(`/dashboard/affaires/${fixture.projectId}`);
  await expect(screen.getByText("Préparation déjà enregistrée", { exact: true })).toBeVisible();
  expect(fixture.requests.filter((entry) => entry.pathname === endpoint && entry.method === "POST")).toHaveLength(1);
  expect(await items(browser, order.purchase_order_id)).toEqual(persisted);
  await recordEvidence(army, "decimal-recovery-and-reload", { order, persisted, requests: fixture.requests,
    expectedAutomaticPosts: 1, malformedReceiptRecovered: true });
  const replay = await apiRequest<Envelope<Created>>(browser, "POST", endpoint, request);
  const receipt = await apiRequest<Envelope<Created>>(browser, "GET", `${endpoint}?idempotency_key=${request.idempotency_key}`);
  const afterSource = await readEstimate(browser, fixture.versionId);
  await recordEvidence(army, "decimal-preparation-persisted", { created, persisted, replay, receipt, source, afterSource });
  expect(order).toMatchObject({ total_ht_cents: 1636, total_tax_cents: 327, total_ttc_cents: 1963 });
  expect(persisted).toHaveLength(3);
  for (const line of lines) expect(persisted.find((item) => item.source_estimate_item_id === line.lineId)).toMatchObject({
    ...expectedItem(line), reference: line.reference, product_id: line.productId, source_selected_supplier_price_id: line.priceId,
  });
  expect(replay.status).toBe(200);
  expect(replay.body.data.replayed).toBe(true);
  expect(replay.body.data.orders).toEqual(created.body.data.orders);
  expect(receipt.status).toBe(200);
  expect(receipt.body.data.orders).toEqual(created.body.data.orders);
  expect(afterSource).toEqual(source);
});

decimalTest("local decimal manual purchase accepts fractional lines with exact per-line rounding", {
  session: "army", trace: "off", timeout: 240_000,
}, async ({ app, screen, browser, fixture, army }) => {
  await app.open("/dashboard/orders");
  // 0.145 * 100 is 14.499999999999998 in binary floating point; this
  // persisted witness catches a naive Math.round(quantity * cents) fix.
  const lines = [...fixture.lines.filter((line) => line.label !== "integer"),
    { ...fixture.lines[1], label: "binary-half", quantity: 0.145, price: 100, ht: 15, tax: 3, ttc: 18 }];
  const request = manualRequest(fixture, lines);
  const response = await apiRequest<{ id: string }>(browser, "POST", "/api/purchase-orders", request);
  await recordEvidence(army, "decimal-manual-create", { request, response });
  expect(response.status).toBe(200);
  const persisted = await items(browser, response.body.id);
  const savedOrders = await orders(browser, fixture);
  await recordEvidence(army, "decimal-manual-persisted", { response, persisted, savedOrders });
  expect(persisted).toHaveLength(4);
  for (const line of lines) {
    expect(persisted.find((item) => item.designation === `${fixture.prefix} manual ${line.label}`)).toMatchObject(expectedItem(line));
  }
  const order = savedOrders.find((order) => order.id === response.body.id)!;
  expect(order).toMatchObject({ status: "draft", total_ht_cents: 1651 });
  await app.open("/dashboard/orders");
  await screen.getByLabel("Rechercher par référence…", { exact: true }).fill(order.reference);
  await expect(screen.getByRole("status").filter({ hasText: /Affichage de 1 sur \d+ commandes/ })).toBeVisible();
  const exports: unknown[] = [];
  for (const format of ["csv", "xlsx"] as const) {
    await screen.getByRole("button", "Exporter", { exact: true }).tap();
    const saved = await retainDownload(army, browser, format, () => screen.getByRole("button",
      format === "csv" ? "Fichier CSV (.csv)" : "Excel (.xlsx)", { exact: true }).tap());
    const book = xlsx.read(saved.bytes, { type: "buffer", ...(format === "csv" ? { raw: true, FS: ";" } : {}) });
    const sheet = book.Sheets[format === "xlsx" ? "Articles" : book.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet);
    await recordEvidence(army, `decimal-export-${format}`, { ...saved.evidence, rows });
    assertExportRows(rows, lines, fixture);
    if (format === "xlsx") {
      const headers = xlsx.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0];
      const quantityColumn = headers.indexOf("Quantité");
      expect(quantityColumn).toBeGreaterThanOrEqual(0);
      for (let index = 0; index < lines.length; index++) {
        expect(sheet[xlsx.utils.encode_cell({ r: index + 1, c: quantityColumn })].t).toBe("n");
      }
    }
    exports.push(saved.evidence);
  }
  await screen.getByRole("button", `Actions du bon ${order.reference}`, { exact: true }).tap();
  const zip = await retainDownload(army, browser, "zip", () => screen.getByRole("menuitem", "Télécharger le ZIP", { exact: true }).tap());
  const entries = unzipSync(zip.bytes);
  expect(entries["bon-de-commande.html"]).toBeDefined();
  const html = strFromU8(entries["bon-de-commande.html"]);
  const htmlDocument = await browser.evaluate((markup) => {
    const document = new DOMParser().parseFromString(markup, "text/html");
    return { rows: Array.from(document.querySelectorAll("tbody tr"))
      .map((row) => Array.from(row.querySelectorAll("th,td")).map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim())),
    totals: Array.from(document.querySelectorAll(".totals .value")).map((value) => (value.textContent ?? "").replace(/\s+/g, " ").trim()) };
  }, html);
  await recordEvidence(army, "decimal-export-zip", { ...zip.evidence, entries: Object.keys(entries), ...htmlDocument });
  assertDocumentRows(htmlDocument.rows, lines, fixture, "zip");
  expect(htmlDocument.totals).toEqual([money(1651), money(330), money(1981)]);
  await app.open(`/dashboard/orders/${order.id}/print`);
  await expect(screen.getByRole("cell", `${fixture.prefix} manual half`, { exact: true })).toBeVisible();
  const printRows = await browser.evaluate(() => Array.from(document.querySelectorAll("tbody tr"))
    .map((row) => Array.from(row.querySelectorAll<HTMLElement>("th,td")).map((cell) => cell.innerText.replace(/\s+/g, " ").trim())));
  await recordEvidence(army, "decimal-print-preview", { orderId: order.id, rows: printRows, exports,
    expected: { totalHtCents: 1651, totalTaxCents: 330, totalTtcCents: 1981 }, pdfFileGenerated: false });
  assertDocumentRows(printRows, lines, fixture, "print");
  await expect(screen.getByText(money(1651), { exact: true })).toBeVisible();
  await expect(screen.getByText(money(330), { exact: true })).toBeVisible();
  await expect(screen.getByText(money(1981), { exact: true })).toBeVisible();
});

decimalTest("local decimal purchase rejects a mixed valid and zero request without dropping a line", {
  session: "army", trace: "off", timeout: 120_000,
}, async ({ app, browser, fixture, army }) => {
  await app.open("/dashboard/orders");
  const invalids = [0, -1, 0.0001, null, undefined, "", "0.125", "abc", 2147483648];
  for (const [index, quantity] of invalids.entries()) {
    const before = await orders(browser, fixture);
    const base = manualRequest(fixture, [fixture.lines[0], fixture.lines[0]]);
    const request = { ...base, items: [base.items[0], { ...base.items[1], designation: `${fixture.prefix} invalid-${index}`, quantity }] };
    const response = await apiRequest(browser, "POST", "/api/purchase-orders", request);
    const after = await orders(browser, fixture);
    const unexpected = after.filter((order) => !before.some((old) => old.id === order.id));
    const createdItems = await Promise.all(unexpected.map(async (order) => ({ id: order.id, items: await items(browser, order.id) })));
    await recordEvidence(army, `mixed-invalid-${index}`, { request, response, before, after, createdItems });
    expect.soft(response.status).toBe(400);
    expect.soft(after).toEqual(before);
  }
});

decimalTest("local legacy purchase preserves unknown units until explicit audited confirmation", {
  session: "army", trace: "off", timeout: 180_000,
}, async ({ app, screen, browser, fixture, army }) => {
  const file = process.env.E2E_PURCHASE_DECIMALS_LEGACY_FIXTURE_PATH;
  if (!file) throw new Error("An explicit unused pre-migration legacy fixture is required.");
  const legacy = JSON.parse(await readFile(file, "utf8")) as Fixture;
  expect(legacy.status).toBe("ready");
  expect(legacy.apiUrl).toBe(fixture.apiUrl);
  expect(legacy.prefix).toMatch(/^ARMY-DECIMAL-/);
  expect(legacy.unitColumnPresent).toBe(false);
  army.ownedEstimates.push({ projectId: legacy.projectId, versionId: legacy.versionId });
  await app.open(`/dashboard/orders/${legacy.noteOrderId}/edit`);
  const source = await readEstimate(browser, legacy.versionId);
  const before = await items(browser, legacy.noteOrderId);
  expect(before).toEqual([expect.objectContaining({ id: legacy.noteItemId, quantity: 2, unit: null, price_unit: null })]);
  const unit = screen.getByLabel("Unité, ligne 1", { exact: true });
  await expect(unit).toHaveValue("");
  await expect(screen.getByLabel("Instructions complémentaires", { exact: true })).toHaveValue("ARMY original note");
  await screen.getByLabel("Instructions complémentaires", { exact: true }).fill("ARMY legacy note keeps unknown unit");
  const [noteResponse] = await Promise.all([
    browser.waitForResponse(`**/api/purchase-orders/${legacy.noteOrderId}`),
    screen.getByRole("button", "Enregistrer", { exact: true }).tap(),
  ]);
  const afterNote = await items(browser, legacy.noteOrderId);
  await recordEvidence(army, "legacy-note-unit-null", { legacy, before, afterNote, status: noteResponse.status });
  expect(noteResponse.status).toBe(200);
  expect(afterNote).toEqual(before);
  await app.open(`/dashboard/orders/${legacy.noteOrderId}/edit`);
  await expect(unit).toHaveValue("");
  await expect(screen.getByLabel("Instructions complémentaires", { exact: true })).toHaveValue("ARMY legacy note keeps unknown unit");
  await screen.getByLabel("Quantité, ligne 1", { exact: true }).fill("0,125");
  await screen.getByLabel("Prix unitaire HT, ligne 1", { exact: true }).fill("7,77");
  await expect(screen.getByRole("button", "Enregistrer", { exact: true })).toBeDisabled();
  expect(await items(browser, legacy.noteOrderId)).toEqual(before);
  await unit.fill("m");
  await expect(screen.getByRole("button", "Enregistrer", { exact: true })).toBeEnabled();
  const [confirmation] = await Promise.all([
    browser.waitForResponse(`**/api/purchase-orders/${legacy.noteOrderId}`),
    screen.getByRole("button", "Enregistrer", { exact: true }).tap(),
  ]);
  const after = await items(browser, legacy.noteOrderId);
  const history = await apiRequest<Envelope<{ events: Array<{ operation: string; before: Item | null; after: Item | null }> }>>(
    browser, "GET", `/api/purchase-orders/${legacy.noteOrderId}/history`);
  const afterSource = await readEstimate(browser, legacy.versionId);
  await recordEvidence(army, "legacy-confirmed-unit", { status: confirmation.status, before, after, history, source, afterSource });
  expect(confirmation.status).toBe(200);
  expect(after).toEqual([expect.objectContaining({ ...expectedItem(legacy.lines[2]), id: legacy.noteItemId,
    product_id: legacy.lines[0].productId, reference: legacy.lines[0].reference,
    source_estimate_item_id: legacy.lines[0].lineId, source_selected_supplier_price_id: legacy.lines[0].priceId })]);
  expect(afterSource).toEqual(source);
  expect(history.status).toBe(200);
  expect(history.body.data.events.find((event) => event.before?.unit === null && event.after?.unit === "m")).toMatchObject({
    operation: "update", before: expect.objectContaining({ id: legacy.noteItemId, unit: null, price_unit: null, quantity: 2 }),
    after: expect.objectContaining({ id: legacy.noteItemId, unit: "m", price_unit: "m", quantity: 0.125 }) });
  await app.open(`/dashboard/orders/${legacy.noteOrderId}`);
  await screen.getByText("Historique des lignes", { exact: true }).tap();
  await expect(screen.getByRole("row", /Avant 2 Unité à confirmer 12,00/)).toBeVisible();
  await expect(screen.getByRole("row", /Après 0,125 m 7,77/)).toBeVisible();
  await app.open(`/dashboard/orders/${legacy.noteOrderId}/edit`);
  await expect(screen.getByLabel("Quantité, ligne 1", { exact: true })).toHaveValue("0.125");
  await expect(screen.getByLabel("Unité, ligne 1", { exact: true })).toHaveCount(0);
});

function assertBulkRows(rows: Array<Record<string, unknown>>, fixture: Fixture, corrected: boolean) {
  const bulk = fixture.bulk!;
  expect(rows).toHaveLength(1200);
  const expectedReferences = bulk.orders.flatMap((order) => Array.from({ length: 600 }, (_, index) => `${order.reference}-${index + 1}`)).sort();
  expect(rows.map((row) => String(row["Référence article"])).sort()).toEqual(expectedReferences);
  const mismatches: Array<{ reference: unknown; actual: unknown; expected: unknown }> = [];
  for (const order of bulk.orders) {
    const selected = rows.filter((row) => row["Référence commande"] === order.reference);
    const totalHt = order.total_ht_cents + (corrected && order.label === "A" ? 15 - order.template.ht : 0);
    expect(selected).toHaveLength(600);
    expect(selected.reduce((sum, row) => sum + Math.round(Number(row["Total ligne HT (EUR)"]) * 100), 0)).toBe(totalHt);
    for (const row of selected) {
      const line = corrected && row["Référence article"] === `${bulk.orders[0].reference}-1`
        ? { quantity: 0.145, price: 100, ht: 15, tax: 3, ttc: 18 } : order.template;
      const actual = [String(row["Quantité"]), row["Unité"], row["Unité du prix"], Number(row["P.U. HT (EUR)"]),
        Number(row["Total ligne HT (EUR)"]), Number(row["TVA ligne (EUR)"]), Number(row["Total ligne TTC (EUR)"]), Number(row["Total HT commande (EUR)"])];
      const expected = [String(line.quantity), "m", "m", line.price / 100, line.ht / 100, line.tax / 100, line.ttc / 100, totalHt / 100];
      if (JSON.stringify(actual) !== JSON.stringify(expected)) mismatches.push({ reference: row["Référence article"], actual, expected });
    }
  }
  expect(mismatches).toEqual([]);
}

for (const corrected of [false, true]) {
decimalTest(corrected
  ? "local decimal export rereads coherent headers and lines after a concurrent edit"
  : "local decimal export downloads all 1200 selected lines without silent truncation", {
  session: "army", trace: "off", timeout: 300_000,
}, async ({ app, screen, browser, fixture, army }) => {
  const bulk = fixture.bulk;
  if (!bulk || bulk.orders.length !== 2 || bulk.orders.some((order) => order.itemCount !== 600)) {
    throw new Error("Two new dedicated 600-line ARMY export orders are required.");
  }
  await app.open("/dashboard/orders");
  await screen.getByLabel("Rechercher par référence…", { exact: true }).fill(bulk.prefix);
  await expect(screen.getByRole("status").filter({ hasText: /Affichage de 2 sur \d+ commandes/ })).toBeVisible();
  if (corrected) {
    const order = bulk.orders[0];
    const before = await items(browser, order.id);
    expect(before).toHaveLength(600);
    const payload = { expectedRevision: order.edit_revision, supplierId: fixture.supplierId,
      deliverySiteId: fixture.deliverySiteId, expectedDeliveryDate: null, notes: "ARMY export changed after UI list load",
      items: before.map((item) => ({ id: item.id, reference: item.reference, designation: item.designation,
        quantity: item.id === order.itemIds[0] ? 0.145 : item.quantity, unit: item.unit,
        unitPriceCents: item.id === order.itemIds[0] ? 100 : item.unit_price_ht_cents, taxRateBp: 2000 })) };
    const mutation = await browser.evaluate(async (request) => {
      const response = await fetch(request.path, { method: "PUT", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: request.body });
      return { status: response.status, body: await response.json() };
    }, { path: `/api/purchase-orders/${order.id}`, body: JSON.stringify(payload) });
    await recordEvidence(army, "bulk-concurrent-edit", { order, before, payload, mutation });
    expect(mutation.status).toBe(200);
    // No reload: the UI still holds the headers fetched before the real edit.
  }
  for (const format of ["csv", "xlsx"] as const) {
    await screen.getByRole("button", "Exporter", { exact: true }).tap();
    const saved = await retainDownload(army, browser, format, () => screen.getByRole("button",
      format === "csv" ? "Fichier CSV (.csv)" : "Excel (.xlsx)", { exact: true }).tap());
    const book = xlsx.read(saved.bytes, { type: "buffer", ...(format === "csv" ? { raw: true, FS: ";" } : {}) });
    const sheet = book.Sheets[format === "xlsx" ? "Articles" : book.SheetNames[0]];
    const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet);
    await recordEvidence(army, `bulk-${corrected ? "concurrent" : "complete"}-${format}`, { ...saved.evidence, bulk, rows });
    assertBulkRows(rows, fixture, corrected);
    if (format === "xlsx") {
      const headers = xlsx.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0];
      const column = headers.indexOf("Quantité");
      expect(column).toBeGreaterThanOrEqual(0);
      const invalid = rows.flatMap((_, index) => sheet[xlsx.utils.encode_cell({ r: index + 1, c: column })]?.t === "n" ? [] : [index + 1]);
      expect(invalid).toEqual([]);
    }
  }
});
}

decimalTest("local oversized purchase refuses truncated editing detail print and ZIP without losing lines", {
  session: "army", trace: "off", timeout: 180_000,
}, async ({ app, screen, browser, fixture, army }) => {
  const id = fixture.oversizedOrderId;
  if (!id || fixture.oversized?.itemCount !== 1001) throw new Error("A new 1001-line ARMY direct-write witness is required.");
  const message = "Lecture incomplète. Consultez l’export complet depuis la liste des commandes.";
  await app.open(`/dashboard/orders/${id}/edit`);
  const before = await items(browser, id);
  expect(before).toHaveLength(1001);
  expect(before.map((item) => item.id).sort()).toEqual([...fixture.oversized.itemIds].sort());
  await expect(screen.getByRole("alert").filter({ hasText: message })).toHaveText(message);
  await expect(screen.getByRole("button", "Enregistrer", { exact: true })).toHaveCount(0);
  await expect(screen.getByLabel("Quantité, ligne 1", { exact: true })).toHaveCount(0);
  await app.open(`/dashboard/orders/${id}`);
  await expect(screen.getByRole("alert").filter({ hasText: message })).toHaveText(message);
  await expect(screen.getByRole("link", "Imprimer / PDF", { exact: true })).toHaveCount(0);
  await app.open(`/dashboard/orders/${id}/print`);
  await expect(screen.getByRole("alert").filter({ hasText: message })).toHaveText(message);
  await expect(screen.getByRole("table")).toHaveCount(0);
  const zip = await apiRequest<{ error: string }>(browser, "GET", `/api/purchase-orders/${id}/zip`);
  const after = await items(browser, id);
  const mutations = fixture.requests.filter((request) => request.pathname === `/api/purchase-orders/${id}` && request.method !== "GET");
  await recordEvidence(army, "oversized-document-refused", { id, before, zip, after, mutations,
    expected: { count: 1001, zipStatus: 409, message, partialDocument: false, saveAvailable: false } });
  expect(zip.status).toBe(409);
  expect(zip.body).toMatchObject({ error: message });
  expect(mutations).toEqual([]);
  expect(after).toEqual(before);
});
