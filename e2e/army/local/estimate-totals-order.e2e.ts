import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { readEstimate, recordEvidence, resolveDownload, restrictCriticalBrowser } from "../critical/fixtures";
import { isolatedLocalBackend } from "./isolated-backend";

// Failure oracle documented before implementation in
// docs/testing/generated-ouvrage-resume.md: position,id differs from UUID order.
test("canonical save uses publication line order for discount allocation and exact VAT", {
  session: "army", tags: ["critical", "totals-order"], timeout: 120_000,
}, async ({ app, screen, browser }) => {
  const file = process.env.E2E_TOTALS_ORDER_FIXTURE_PATH;
  if (!file || process.env.NEXT_PUBLIC_SUPABASE_URL !== isolatedLocalBackend()) throw new Error("Explicit isolated order witness required");
  const f = JSON.parse(await readFile(file, "utf8")) as { status: string; apiUrl: string; prefix: string; projectId: string; versionId: string; lineA: string; lineB: string };
  expect(f.status).toBe("ready"); expect(f.apiUrl).toBe(isolatedLocalBackend()); expect(f.lineB < f.lineA).toBe(true);
  const army = { runPrefix: f.prefix, projectName: f.prefix, ownedEstimates: [{ projectId: f.projectId, versionId: f.versionId }] };
  await restrictCriticalBrowser(browser, app);
  await app.open(`/dashboard/estimates/${f.versionId}/edit`);
  await expect(screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible({ timeout: 45_000 });
  const before = await readEstimate(browser, f.versionId);
  expect(before.version.discount_bp).toBe(1667);
  expect(before.items.filter((i) => i.item_type === "line").sort((a, b) => a.position - b.position).map((i) => [i.id, i.position, i.tax_rate_bp])).toEqual([[f.lineA, 1, 2000], [f.lineB, 2, 0]]);
  // Real UI price change creates a pending save. The seed starts A at 2c;
  // the asserted allocation uses A=3c and B=3c after this edit.
  const price = screen.getByLabel(`Prix d’achat unitaire HT pour ${f.prefix} A`, { exact: true });
  await price.fill("0,03"); await price.press("Tab");
  const saveAt = new Date().toISOString();
  await browser.keyboard.press("Control+s");
  await expect.poll(async () => {
    const { version } = await readEstimate(browser, f.versionId);
    return [version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents];
  }, { timeout: 30_000, interval: 500 }).toEqual([5, 0, 5]);
  const saved = await readEstimate(browser, f.versionId);
  await recordEvidence(army, "position-tax-saved", { saveAt, expected: [5, 0, 5], totals: [saved.version.total_ht_cents, saved.version.total_tax_cents, saved.version.total_ttc_cents], lines: saved.items.filter((i) => i.item_type === "line").map((i) => ({ id: i.id, position: i.position, price: i.unit_price_ht_cents, taxRate: i.tax_rate_bp })), directTotalsWrite: false });
  expect(saved.items.filter((i) => i.item_type === "line").map((i) => i.unit_price_ht_cents)).toEqual([3, 3]);
  await expect(screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/Sauvegardé|À jour/);
  const dialogs: string[] = [];
  const dispose = await browser.onDialog(async (dialog) => { dialogs.push(dialog.message); await dialog.dismiss(); });
  try { await browser.reload({ timeout: 15_000 }); } finally { await dispose(); }
  expect(dialogs).toHaveLength(0);
  const reloaded = await readEstimate(browser, f.versionId);
  expect([reloaded.version.total_ht_cents, reloaded.version.total_tax_cents, reloaded.version.total_ttc_cents]).toEqual([5, 0, 5]);
  await screen.getByRole("button", "Exporter", { exact: true }).tap();
  const download = await browser.waitForDownload(() => screen.getByRole("button", "Excel (.xlsx)", { exact: true }).tap(), { timeout: 45_000 });
  // Anchored to this run's <seg>/[rerun-<n>/]attempt-<n>/ directory, like the critical exports.
  const absolutePath = await resolveDownload(download);
  const bytes = await readFile(absolutePath), workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(absolutePath);
  const summary = workbook.getWorksheet("Resume"); expect(Boolean(summary)).toBe(true);
  const footer: Record<string, ExcelJS.CellValue> = {};
  summary!.eachRow((row) => { footer[row.getCell(1).text] = row.getCell(2).value; });
  const actual = Object.fromEntries(["Total HT", "Total TVA", "Total TTC"].map((label) => [label, footer[label]]));
  await recordEvidence(army, "position-tax-export", { artifact: { path: absolutePath, sha256: createHash("sha256").update(bytes).digest("hex") }, actual, expected: { "Total HT": 0.05, "Total TVA": 0, "Total TTC": 0.05 } });
  expect(actual).toEqual({ "Total HT": 0.05, "Total TVA": 0, "Total TTC": 0.05 });
  // Distinct ordinary HTTP subcase: reorder the same persisted identities and
  // deliberately send old totals. Canonical totals must use the merged order.
  const current = await readEstimate(browser, f.versionId);
  const swapped = JSON.parse(await browser.evaluate(async (input) => {
    const sessionId = sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${input.versionId}`);
    if (!sessionId) throw new Error("Real editor lock session required");
    const response = await fetch(`/api/estimates/${input.versionId}/items/bulk`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "If-Match": input.updatedAt, "x-estimate-draft-lock-session-id": sessionId }, body: JSON.stringify({ updated_at: input.updatedAt, updates: [{ id: input.lineA, position: 2 }, { id: input.lineB, position: 1 }], version_patch: { total_ht_cents: 5, total_tax_cents: 0, total_ttc_cents: 5 } }) });
    const payload = await response.json();
    return JSON.stringify({ status: response.status, ok: payload.ok === true, totals: payload.data?.totals ?? null, errorCode: payload.error?.code ?? null });
  }, { versionId: f.versionId, lineA: f.lineA, lineB: f.lineB, updatedAt: current.version.updated_at })) as { status: number; ok: boolean; totals: { total_ht_cents: number; total_tax_cents: number; total_ttc_cents: number } };
  await recordEvidence(army, "position-tax-http-response-before-assertion", { sentPositions: [{ id: f.lineA, position: 2 }, { id: f.lineB, position: 1 }], sentStaleTotals: [5, 0, 5], response: swapped });
  expect(swapped.status).toBe(200); expect(swapped.ok).toBe(true);
  expect(swapped.totals).toEqual({ total_ht_cents: 5, total_tax_cents: 1, total_ttc_cents: 6 });
  await browser.reload({ timeout: 15_000 });
  const reordered = await readEstimate(browser, f.versionId);
  await recordEvidence(army, "position-tax-http-reorder", { transport: "ordinary authenticated HTTP; separate from UI save", sentStaleTotals: [5, 0, 5], response: swapped, totals: [reordered.version.total_ht_cents, reordered.version.total_tax_cents, reordered.version.total_ttc_cents], lines: reordered.items.filter((i) => i.item_type === "line").map((i) => ({ id: i.id, position: i.position })) });
  expect([reordered.version.total_ht_cents, reordered.version.total_tax_cents, reordered.version.total_ttc_cents]).toEqual([5, 1, 6]);
  expect(reordered.items.filter((i) => i.item_type === "line").sort((a, b) => a.position - b.position).map((i) => [i.id, i.position])).toEqual([[f.lineB, 1], [f.lineA, 2]]);
  await screen.getByRole("button", "Exporter", { exact: true }).tap();
  const swappedDownload = await browser.waitForDownload(() => screen.getByRole("button", "Excel (.xlsx)", { exact: true }).tap(), { timeout: 45_000 });
  const swappedPath = await resolveDownload(swappedDownload), swappedBytes = await readFile(swappedPath), swappedWorkbook = new ExcelJS.Workbook();
  await swappedWorkbook.xlsx.readFile(swappedPath);
  const swappedFooter: Record<string, ExcelJS.CellValue> = {};
  swappedWorkbook.getWorksheet("Resume")!.eachRow((row) => { swappedFooter[row.getCell(1).text] = row.getCell(2).value; });
  const swappedActual = Object.fromEntries(["Total HT", "Total TVA", "Total TTC"].map((label) => [label, swappedFooter[label]]));
  await recordEvidence(army, "position-tax-reordered-export", { artifact: { path: swappedPath, sha256: createHash("sha256").update(swappedBytes).digest("hex") }, actual: swappedActual });
  expect(swappedActual).toEqual({ "Total HT": 0.05, "Total TVA": 0.01, "Total TTC": 0.06 });
});
