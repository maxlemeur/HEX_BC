import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import * as xlsx from "xlsx";

import { parseEuroToCents } from "../../../src/lib/money";
import { querySql } from "../local/calculation-gate-support";
import { sdkResultsRoot } from "../local/sdk-results";

type Fixture = {
  apiUrl: string; tenantId: string; userId: string; prefix: string;
  suppliers: string[]; sites: string[]; orderIds: string[];
};
type Order = { id: string; reference: string; devis_count: number; total_ht_cents: number };
type Directory = {
  items?: Order[]; suppliers?: Array<{ id: string; name: string }>;
  delivery_sites?: Array<{ id: string; name: string }>;
  pagination?: { page: number; size: number; totalItems: number; totalPages: number };
  orders?: Order[]; itemsByOrderId?: Record<string, unknown[]>;
};
const ORDER_COUNT = 1005;
const LOOKUP_COUNT = 1001;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const literal = (value: unknown) => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;

// Observable failure plan, before implementation: the API/UI must not load or
// render the entire tenant to show a page; the 1001st order and lookup must stay
// searchable/filterable; count must include >1000 attached quotes without
// downloading their identities; sorting/filtering and exports cover the whole
// matching set, including orders outside the visible page. Idle lists must not
// poll every 30 s. No production or shared backend is accepted by this fixture.
async function fixture(): Promise<Fixture> {
  if (process.env.E2E_DOGFOOD_OWNED_STACK !== "1") throw new Error("The owned dogfood stack marker is required.");
  const readyPath = process.env.E2E_DOGFOOD_FIXTURE_PATH;
  if (!readyPath) throw new Error("An explicit owned dogfood fixture is required.");
  const ready = JSON.parse(await readFile(readyPath, "utf8")) as Pick<Fixture, "apiUrl" | "tenantId" | "userId">;
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (backend.origin !== ready.apiUrl || backend.protocol !== "http:" || backend.hostname !== "127.0.0.1" ||
    backend.origin !== process.env.E2E_COVERAGE_BACKEND_ORIGIN || backend.username || backend.password ||
    !uuid.test(ready.tenantId) || !uuid.test(ready.userId)) throw new Error("The explicit owned local identity differs.");
  const filename = path.join(path.dirname(readyPath), "orders-performance-fixture.json");
  let previous: Fixture | null = null;
  try { previous = JSON.parse(await readFile(filename, "utf8")) as Fixture; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (previous) {
    if (previous.apiUrl !== ready.apiUrl || previous.tenantId !== ready.tenantId || previous.userId !== ready.userId ||
      previous.orderIds.length !== ORDER_COUNT || previous.suppliers.length !== LOOKUP_COUNT ||
      previous.sites.length !== LOOKUP_COUNT || !/^ARMY-ORDERS-PERF-[a-f0-9]{8}$/.test(previous.prefix)) {
      throw new Error("The reused orders performance fixture identity differs.");
    }
    return previous;
  }
  const fixture: Fixture = { ...ready, prefix: `ARMY-ORDERS-PERF-${randomUUID().slice(0, 8)}`,
    suppliers: Array.from({ length: LOOKUP_COUNT }, () => randomUUID()),
    sites: Array.from({ length: LOOKUP_COUNT }, () => randomUUID()),
    orderIds: Array.from({ length: ORDER_COUNT }, () => randomUUID()) };
  const delimiter = `$army_${randomUUID().replaceAll("-", "")}$`;
  const result = await querySql(`BEGIN;
DO ${delimiter}
DECLARE ctx jsonb := ${literal(fixture)};
BEGIN
  IF current_database() <> 'postgres' OR current_user <> 'postgres' OR NOT EXISTS (
    SELECT 1 FROM public.tenants t JOIN public.tenant_memberships m ON m.tenant_id=t.id
    WHERE t.id=(ctx->>'tenantId')::uuid AND t.is_active AND t.name ~ '^ARMY\\y'
      AND m.user_id=(ctx->>'userId')::uuid AND m.role='admin'
  ) THEN RAISE EXCEPTION 'The owned ARMY admin identity differs'; END IF;
  INSERT INTO public.suppliers(id,tenant_id,name)
    SELECT value::uuid,(ctx->>'tenantId')::uuid,ctx->>'prefix'||' supplier '||lpad(ordinality::text,4,'0')
    FROM jsonb_array_elements_text(ctx->'suppliers') WITH ORDINALITY;
  INSERT INTO public.delivery_sites(id,tenant_id,name)
    SELECT value::uuid,(ctx->>'tenantId')::uuid,ctx->>'prefix'||' site '||lpad(ordinality::text,4,'0')
    FROM jsonb_array_elements_text(ctx->'sites') WITH ORDINALITY;
  INSERT INTO public.purchase_orders(id,tenant_id,user_id,supplier_id,delivery_site_id,reference,created_at,status,expected_delivery_date)
    SELECT value::uuid,(ctx->>'tenantId')::uuid,(ctx->>'userId')::uuid,
      (ctx->'suppliers'->>((ordinality-1)%${LOOKUP_COUNT})::int)::uuid,
      (ctx->'sites'->>((ordinality-1)%${LOOKUP_COUNT})::int)::uuid,
      ctx->>'prefix'||' '||lpad(ordinality::text,4,'0'),
      '2026-10-19T12:00:00Z'::timestamptz+ordinality*interval '1 second',
      'draft','2026-11-01'
    FROM jsonb_array_elements_text(ctx->'orderIds') WITH ORDINALITY;
  INSERT INTO public.purchase_order_items(tenant_id,purchase_order_id,position,designation,quantity,unit,price_unit,unit_price_ht_cents,tax_rate_bp)
    SELECT (ctx->>'tenantId')::uuid,value::uuid,0,ctx->>'prefix'||' item '||lpad(ordinality::text,4,'0'),1,'u','u',ordinality::int,2000
    FROM jsonb_array_elements_text(ctx->'orderIds') WITH ORDINALITY;
  INSERT INTO public.purchase_order_devis(tenant_id,purchase_order_id,user_id,name,original_filename,storage_path,file_size_bytes,mime_type,position)
    SELECT (ctx->>'tenantId')::uuid,value::uuid,(ctx->>'userId')::uuid,'Fixture quote '||quote,'fixture.pdf',
      'purchase-orders/'||value||'/fixture-'||quote||'.pdf',1,'application/pdf',quote-1
    FROM jsonb_array_elements_text(ctx->'orderIds') WITH ORDINALITY CROSS JOIN generate_series(1,3) quote
    WHERE ordinality<${ORDER_COUNT};
END ${delimiter};
COMMIT;
SELECT 'ORDERS_PERFORMANCE_COMMITTED';
`);
  if (!result.includes("ORDERS_PERFORMANCE_COMMITTED")) throw new Error("The fixture commit is ambiguous; no retry.");
  await writeFile(filename, JSON.stringify(fixture, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  return fixture;
}

test("dogfood remaining orders: bounded global list, exact quotes, lookups and complete export",
  { tags: ["performance", "remaining-performance"], session: "army", requires: ["browser"], timeout: 300_000 },
  async ({ app, browser, screen }) => {
    const seeded = await fixture();
    const samples: Array<Record<string, unknown>> = [];
    const failures: string[] = [];
    const checks = (condition: boolean, label: string) => { if (!condition) failures.push(label); };
    const read = async (parameters: Record<string, string>) => {
      const response = await browser.evaluate(async (query) => {
        const start = performance.now();
        const response = await fetch(`/api/orders?${new URLSearchParams(query)}`);
        const body = await response.text();
        return { status: response.status, body,
          bytes: new TextEncoder().encode(body).length, durationMs: performance.now() - start };
      }, { view: "page", ...parameters });
      const body = JSON.parse(response.body) as { ok: boolean; data?: Directory };
      samples.push({ query: parameters, status: response.status, bytes: response.bytes,
        durationMs: response.durationMs, rows: body.data?.items?.length,
        pagination: body.data?.pagination });
      checks(response.status === 200 && body.ok, `The directory query must succeed: ${JSON.stringify(parameters)}.`);
      return body.data ?? {};
    };
    const origin = new URL(app.baseUrl!).origin;
    let listReads = 0;
    await app.open("/dashboard/affaires");
    await browser.route("**/*", async (route) => {
      const url = new URL(route.request.url);
      if (url.origin === origin && url.pathname === "/api/orders" && route.request.method === "GET") listReads++;
      if (url.origin === origin && !["GET", "HEAD", "OPTIONS"].includes(route.request.method)) {
        throw new Error("The read-only orders performance journey rejected an application mutation.");
      }
      await route.fallback();
    });
    let csvEvidence: Record<string, unknown> | null = null;
    let idleEvidence: { observedMs: number; readsBefore: number; readsAfter: number; extraReads: number } | null = null;
    try {
      await app.open("/dashboard/orders");
      await browser.setViewport({ width: 1440, height: 900 });
      await expect(screen.getByRole("heading", "Bons de commande", { exact: true })).toBeVisible();
      const legacy = await read({ view: "list" });
      const legacyFixtureIds = (legacy.items ?? []).filter(order => order.reference.startsWith(`${seeded.prefix} `)).map(order => order.id);
      checks(legacyFixtureIds.length === ORDER_COUNT &&
        JSON.stringify([...legacyFixtureIds].sort()) === JSON.stringify([...seeded.orderIds].sort()),
      "The compatible default list must retain every exact fixture identity, including all five beyond the old row ceiling.");
      const anonymous = await browser.evaluate(async () => {
        const response = await fetch("/api/orders?view=export", { credentials: "omit" });
        return { status: response.status, body: await response.text() };
      });
      checks(anonymous.status === 401 && !JSON.parse(anonymous.body).data, "An anonymous caller must not receive directory/export data.");
      const first = await read({ q: seeded.prefix, page: "1", size: "50", sort: "reference", direction: "asc" });
      checks(first.items?.length === 50, "The first API page must contain exactly 50 orders.");
      checks(first.pagination?.totalItems === ORDER_COUNT, "The exact total must include all 1005 orders.");
      checks(first.items?.[0]?.id === seeded.orderIds[0], "Ascending reference sort must cover the entire inventory.");
      checks(first.items?.every(order => order.devis_count === 3) ?? false, "All three quotes per visible order must be counted exactly.");
      const last = await read({ q: seeded.prefix, page: "21", size: "50", sort: "reference", direction: "asc" });
      checks(last.items?.length === 5 && last.items.at(-1)?.id === seeded.orderIds.at(-1), "The final five orders beyond PostgREST's row ceiling must be reachable.");
      const tail = await read({ q: `${seeded.prefix} 0001` });
      checks(tail.items?.length === 1 && tail.items[0].id === seeded.orderIds[0], "Reference search must find the oldest order outside the first 1000.");
      const without = await read({ q: seeded.prefix, has_devis: "without" });
      checks(without.items?.length === 1 && without.items[0].id === seeded.orderIds.at(-1), "Without-quote filter must run before pagination.");
      const lookups = await read({ view: "lookups" });
      checks(lookups.suppliers?.some(item => item.id === seeded.suppliers.at(-1)) ?? false, "The 1001st supplier lookup must remain available.");
      checks(lookups.delivery_sites?.some(item => item.id === seeded.sites.at(-1)) ?? false, "The 1001st delivery-site lookup must remain available.");
      const supplier = await read({ q: seeded.prefix, supplier_id: seeded.suppliers.at(-1)! });
      checks(supplier.items?.length === 1 && supplier.items[0].id === seeded.orderIds[1000], "Supplier filtering must cover orders outside the visible page.");
      const search = screen.getByRole("searchbox", "Rechercher par référence…", { exact: true });
      await search.fill(`${seeded.prefix} 0001`);
      await expect.soft(browser.locator('[aria-label="Tableau des bons de commande"] a').filter({ hasText: `${seeded.prefix} 0001` })).toBeVisible();
      await search.fill(seeded.prefix);
      await expect(browser.locator('[aria-label="Tableau des bons de commande"] tbody > tr').first()).toBeVisible();
      if (first.pagination) {
        await expect(browser.locator('section[aria-label="Bons de commande"]')).toHaveAttribute("aria-busy", "false");
        await screen.getByRole("navigation", "Pagination des commandes", { exact: true }).getByRole("button", "Suivant", { exact: true }).tap();
        await expect(browser.locator('section[aria-label="Bons de commande"]')).toHaveAttribute("aria-busy", "false");
        checks(await browser.locator('[aria-label="Tableau des bons de commande"] tbody > tr').count() === 50, "The UI must mount only one 50-order page.");
      }
      await screen.getByRole("button", "Exporter", { exact: true }).tap();
      const download = await browser.waitForDownload(() => screen.getByRole("button", "Fichier CSV (.csv)", { exact: true }).tap());
      // The performance wrapper uses its own SDK root. Preserve the same
      // absolute-path, realpath and attempt ownership guards as critical exports.
      expect(path.isAbsolute(download.absolutePath), "SDK download must have an absolute path").toBe(true);
      const resultRoot = await realpath(sdkResultsRoot(".e2e/army/performance/results"));
      const filename = await realpath(download.absolutePath);
      const relative = path.relative(resultRoot, filename).split(path.sep).join("/");
      expect(relative.startsWith("../") || path.isAbsolute(relative), "Download must remain inside this run").toBe(false);
      expect(relative, "Download must belong to a retained attempt").toMatch(/^[^/]+\/(?:rerun-\d+\/)?attempt-\d+\/.+/);
      const bytes = await readFile(filename);
      const workbook = xlsx.read(bytes, { type: "buffer", raw: true });
      const rows = xlsx.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]]);
      const references = rows.map(row => String(row["Référence commande"]));
      checks(rows.length === ORDER_COUNT && new Set(references).size === ORDER_COUNT, "CSV export must include all 1005 matching orders, including every page.");
      const expectedReferences = Array.from({ length: ORDER_COUNT }, (_, index) => `${seeded.prefix} ${String(index + 1).padStart(4, "0")}`);
      checks(JSON.stringify([...references].sort()) === JSON.stringify(expectedReferences), "CSV must retain every exact reference of the complete selection.");
      const actualRows = [...rows].sort((a, b) => String(a["Référence commande"]).localeCompare(String(b["Référence commande"])))
        .map(row => ({
          reference: String(row["Référence commande"]), designation: String(row["Désignation article"]),
          itemReference: String(row["Référence article"] ?? ""), quantity: Number(row["Quantité"]),
          unit: String(row["Unité"]), priceUnit: String(row["Unité du prix"]),
          unitPriceCents: parseEuroToCents(String(row["P.U. HT (EUR)"])),
          lineHtCents: parseEuroToCents(String(row["Total ligne HT (EUR)"])),
          taxCents: parseEuroToCents(String(row["TVA ligne (EUR)"])),
          ttcCents: parseEuroToCents(String(row["Total ligne TTC (EUR)"])),
          orderHtCents: parseEuroToCents(String(row["Total HT commande (EUR)"])),
          supplier: String(row["Fournisseur"]), site: String(row["Chantier"]), status: String(row["Statut"]),
        }));
      const expectedRows = expectedReferences.map((reference, index) => {
        const ordinal = index + 1;
        const taxCents = Math.floor((ordinal + 2) / 5);
        const lookupOrdinal = String(index % LOOKUP_COUNT + 1).padStart(4, "0");
        return { reference, designation: `${seeded.prefix} item ${String(ordinal).padStart(4, "0")}`,
          itemReference: "", quantity: 1, unit: "u", priceUnit: "u", unitPriceCents: ordinal,
          lineHtCents: ordinal, taxCents, ttcCents: ordinal + taxCents, orderHtCents: ordinal,
          supplier: `${seeded.prefix} supplier ${lookupOrdinal}`, site: `${seeded.prefix} site ${lookupOrdinal}`, status: "Brouillon" };
      });
      checks(JSON.stringify(actualRows) === JSON.stringify(expectedRows),
        "Every exported reference, line designation, quantity, unit, supplier, site, status and monetary value must match all 1005 real fixtures exactly.");
      const firstMismatch = expectedRows.findIndex((row, index) => JSON.stringify(row) !== JSON.stringify(actualRows[index]));
      csvEvidence = { path: filename, sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length, rows: rows.length, uniqueReferences: new Set(references).size,
        checkedBusinessRows: actualRows.length,
        firstMismatch: firstMismatch < 0 ? null : { index: firstMismatch, expected: expectedRows[firstMismatch], actual: actualRows[firstMismatch] ?? null },
        expectedBusinessRowsSha256: createHash("sha256").update(JSON.stringify(expectedRows)).digest("hex"),
        actualBusinessRowsSha256: createHash("sha256").update(JSON.stringify(actualRows)).digest("hex") };
      const readsBeforeIdle = listReads;
      const idleStartedAt = performance.now();
      // An elapsed observation window is necessary to detect the old 30 s
      // polling timer; this does not synchronize a UI action with a sleep.
      // Keep it in the test process so no 30 s browser-operation deadline is used.
      await new Promise(resolve => setTimeout(resolve, 31_000));
      idleEvidence = { observedMs: performance.now() - idleStartedAt, readsBefore: readsBeforeIdle,
        readsAfter: listReads, extraReads: listReads - readsBeforeIdle };
      checks(idleEvidence.observedMs > 30_000 && idleEvidence.extraReads === 0,
        "An idle order directory must not poll during the measured 31-second observation window.");
    } finally {
      const root = path.resolve(process.env.E2E_ARMY_OUTPUT_DIR ?? ".e2e/army/performance");
      await mkdir(path.join(root, "artifacts"), { recursive: true });
      await writeFile(path.join(root, "artifacts", "orders-performance.json"), JSON.stringify({
        sourceRevision: process.env.E2E_SOURCE_REVISION ?? "see run manifest", sourceDiff: process.env.E2E_SOURCE_DIFF_SHA256 ?? "see run manifest",
        fixture: { ...seeded, orders: ORDER_COUNT, attachedQuotes: (ORDER_COUNT - 1) * 3, lookupCount: LOOKUP_COUNT },
        expected: { pageRows: 50, totalItems: ORDER_COUNT, allSelectionCsvRows: ORDER_COUNT, idlePollingReads: 0 },
        samples, csvEvidence, idleEvidence, failures,
        scope: "Real owned local Supabase, authenticated directory/filter/sort/detail/export APIs and rendered UI. Fixture quote metadata only; no storage object or download assertion for those quotes.",
        limits: "Local browser and loopback database timings; not field percentiles. First fixture creation is reused for before/after runs. No emails, application writes, deployment or remote database changes.",
      }, null, 2) + "\n");
    }
    expect(failures).toEqual([]);
  });
