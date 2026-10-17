import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";

import { readEstimate, recordEvidence, type ArmyState, type OwnedEstimate } from "./fixtures";

type Ui = { app: App; screen: Screen; browser: Browser };
export type StoredTotals = [ht: number, tax: number, ttc: number];
type StoredTotalsInput = { estimate: OwnedEstimate; step: string; expected: StoredTotals };

// "12,34 €" as Intl fr-FR prints it: its group and currency separators (U+202F, U+00A0) match \s.
function euroPattern(cents: number) {
  const units = String(Math.trunc(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, "\\s");
  return `${units},${String(cents % 100).padStart(2, "0")}\\s€`;
}

// One API read: the persisted lines summed, and the stored version totals.
async function readStoredTotals(browser: Browser, versionId: string) {
  const snapshot = await readEstimate(browser, versionId);
  const lines = snapshot.items.filter((item) => item.item_type === "line");
  const sum = (key: "line_total_ht_cents" | "line_tax_cents" | "line_total_ttc_cents") =>
    lines.reduce((total, item) => total + (item[key] ?? 0), 0);
  const fromLines: StoredTotals = [sum("line_total_ht_cents"), sum("line_tax_cents"), sum("line_total_ttc_cents")];
  const stored: StoredTotals = [snapshot.version.total_ht_cents, snapshot.version.total_tax_cents, snapshot.version.total_ttc_cents];
  const evidence = {
    versionId, updatedAt: snapshot.version.updated_at,
    calcEngineVersion: snapshot.version.calc_engine_version ?? null, marginMode: snapshot.version.margin_mode,
    fromLines, stored,
    lines: lines.map((item) => ({
      id: item.id, title: item.title, quantity: item.quantity, price: item.unit_price_ht_cents,
      selected: item.selected_supplier_price_id ?? null,
      totals: [item.line_total_ht_cents, item.line_tax_cents, item.line_total_ttc_cents],
    })),
  };
  return { fromLines, stored, evidence };
}

function expectTotals(read: { fromLines: StoredTotals; stored: StoredTotals }, expected: StoredTotals) {
  expect(read.fromLines, "persisted lines").toEqual(expected);
  expect(read.stored, "stored version totals right after the write, without any other save").toEqual(expected);
}

/**
 * Contract: docs/testing/version-totals-after-preselection.md. The stored version totals feed the
 * affaires list and hub, approvals, Direction and documents. Right after a committed line write,
 * before any later save could reconcile them, they must equal the persisted lines: one API read,
 * no polling. No navigation: the editor stays mounted, so a journey that goes on in the same
 * session keeps its in-memory sync baseline (bulk-edit-sync P1 guards that baseline).
 */
export async function expectStoredTotals(browser: Browser, army: ArmyState, input: StoredTotalsInput) {
  const { estimate, step, expected } = input;
  const read = await readStoredTotals(browser, estimate.versionId);
  await recordEvidence(army, `${step}-stored-totals`, { projectId: estimate.projectId, expected, ...read.evidence });
  expectTotals(read, expected);
}

/**
 * The same API oracle, then the hub and the list (Expert mode, desktop dense table) must show the
 * same HT. Leaves the browser on the affaires list: only as a journey's last step.
 */
export async function expectStoredTotalsMatchLines(
  { app, screen, browser }: Ui,
  army: ArmyState,
  input: StoredTotalsInput & { projectName: string },
) {
  const { estimate, projectName, step, expected } = input;
  const read = await readStoredTotals(browser, estimate.versionId);

  await app.open(`/dashboard/affaires/${estimate.projectId}`);
  // The KPI labels are rendered uppercase: rendered text is matched case-insensitively.
  const hub = browser.locator("#financial");
  await expect(hub).toContainText(/HT version courante/i, { timeout: 30_000 });
  const hubText = await hub.textContent();
  await app.open(`/dashboard/affaires?q=${encodeURIComponent(projectName)}`);
  const listText = await screen.getByRole("row").filter({ hasText: projectName }).textContent();

  await recordEvidence(army, `${step}-stored-totals`, {
    projectId: estimate.projectId, expected, ...read.evidence, hubText, listText,
  });
  expectTotals(read, expected);
  expect(hubText, "affaire hub HT").toMatch(new RegExp(`HT version courante\\s*${euroPattern(expected[0])}`, "i"));
  expect(listText, "affaires list HT").toMatch(new RegExp(`(?:^|\\s)${euroPattern(expected[0])}(?:\\s|$)`));
}
