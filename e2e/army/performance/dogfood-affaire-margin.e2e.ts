import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { test } from "@e2e-dev/web";
import { expect } from "e2e";

import { apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence, type ArmyVersion } from "../critical/fixtures";
import { ownedEstimateContext } from "../local/calculation-gate-support";
import { seedV2Lines } from "../local/engine-v3-creators-support";
import { assertOwnedLocalBackend, switchToExpertMode } from "../local/engine-v3-editor-support";
import { setTenantCalcPolicy } from "../local/engine-v3-persistence-support";

type Created = { ok: boolean; data: { project: { id: string }; version: ArmyVersion } };
type MarginReceipt = { schemaVersion: "dogfood-margin-v3-1"; projectId: string; versionId: string; runPrefix: string; backendOrigin: string };
const receiptPath = path.resolve(".e2e/army/performance/fixtures/empty-margin.json");

function ownedOrigin() {
  assertOwnedLocalBackend();
  if (process.env.E2E_DOGFOOD_OWNED_STACK !== "1") throw new Error("This margin regression requires the explicitly owned disposable stack.");
  return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
}

// Correction-focused E2E for review P2: calling the API-only margin facade from
// the hub drops its standalone engine-3 notice when no analysis is calculable.
// The imported large-draft benchmark cannot expose this empty-v3 branch.
// HFS02/V3C14's existing contract: a priced historical version keeps the hub
// active; only Expert mode mounts its margin card. A completely new affaire
// intentionally keeps the upload/manual start and shows no analysis card.
armyTest("dogfood remaining margin: an empty v3 keeps its exact notice and historical inputs",
  { session: "army", tags: ["performance", "remaining-performance"], requires: ["browser"], timeout: 180_000 },
  async ({ app, browser, screen, army }) => {
    const backendOrigin = ownedOrigin();
    await app.open("/dashboard/affaires");
    const projectName = `${army.runPrefix} empty margin`;
    const anchor = await apiRequest<Created>(browser, "POST", "/api/estimates", {
      project: { name: projectName }, version: { title: `${army.runPrefix} margin anchor`, margin_multiplier: 1,
        margin_mode: "fixed", discount_bp: 0, tax_rate_bp: 2000, rounding_mode: "none", max_section_depth: 1 },
    });
    expect([anchor.status, anchor.body.ok]).toEqual([201, true]);
    const projectId = anchor.body.data.project.id;
    ownEstimate(army, { projectId, versionId: anchor.body.data.version.id });
    const ui = { app, browser, screen };
    await seedV2Lines(ui, anchor.body.data.version.id, [{ title: `${army.runPrefix} historical priced line`, description: "u",
      line_nature: "supply_only", quantity: 1, unit_price_ht_cents: 1000, tax_rate_bp: 2000,
      k_fo: 1, h_mo: 0, h_mo_majoration: 1, k_mo: 1 }]);
    const historical = await readEstimate(browser, anchor.body.data.version.id);
    expect(historical.items.filter((item) => item.item_type === "line").map((item) =>
      [item.quantity, item.unit_price_ht_cents, item.line_total_ht_cents])).toEqual([[1, 1000, 1000]]);
    const owner = await ownedEstimateContext(projectId);
    let created: { status: number; body: Created } | null = null;
    try {
      await setTenantCalcPolicy(owner, { engine: 3, fo: "1.30", mo: "1.20", reason: `${army.runPrefix} empty margin regression` });
      created = await apiRequest<Created>(browser, "POST", "/api/estimates", { project_id: projectId,
        version: { title: `${army.runPrefix} empty v3`, expected_calc_engine_version: 3, margin_multiplier: 1,
          margin_mode: "fixed", discount_bp: 0, tax_rate_bp: 2000, rounding_mode: "none", max_section_depth: 1 },
      });
    } finally {
      await setTenantCalcPolicy(owner, { engine: 2, fo: "1.30", mo: "1.20", reason: `${army.runPrefix} empty margin regression end` });
    }
    expect([created?.status, created?.body.ok, created?.body.data.version.calc_engine_version]).toEqual([201, true, 3]);
    const version = created!.body.data.version;
    ownEstimate(army, { projectId, versionId: version.id });
    const before = await readEstimate(browser, version.id);
    const values = { engine: before.version.calc_engine_version, status: before.version.status,
      lines: before.items.filter((item) => item.item_type === "line").length,
      totals: [before.version.total_ht_cents, before.version.total_tax_cents, before.version.total_ttc_cents] };
    expect(values).toEqual({ engine: 3, status: "draft", lines: 0, totals: [0, 0, 0] });
    await switchToExpertMode(ui);
    await app.open(`/dashboard/affaires/${projectId}`);
    await expect(screen.getByRole("heading", projectName, { exact: true })).toBeVisible();
    await expect(screen.getByRole("heading", "Résumé financier", { exact: true })).toBeVisible();
    const notice = `Évolution de la marge indisponible pour le moteur de calcul 3 : V${Number(version.version_number)}.`;
    await expect(screen.getByTestId("margin-evolution-v3-notice")).toHaveText(notice);
    await expect(browser.locator("#financial")).toContainText(/0,00\s*€/);
    const after = await readEstimate(browser, version.id);
    expect([after.version.calc_engine_version, after.version.status, after.items.filter((item) => item.item_type === "line").length,
      after.version.total_ht_cents, after.version.total_tax_cents, after.version.total_ttc_cents]).toEqual([3, "draft", 0, 0, 0, 0]);
    const historicalAfter = await readEstimate(browser, anchor.body.data.version.id);
    expect(historicalAfter.items).toEqual(historical.items);
    await recordEvidence(army, "empty-margin-v3-notice", { projectId, versionId: version.id, notice, values,
      allowedReadSideEffects: "owned approval projection and audit; exact money and line count retained" });
    const receipt: MarginReceipt = { schemaVersion: "dogfood-margin-v3-1", projectId, versionId: version.id, runPrefix: army.runPrefix, backendOrigin };
    await mkdir(path.dirname(receiptPath), { recursive: true });
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  });

// The separate sessionless test gets a fresh browser context. clearState would
// reopen the public home page, whose third-party effects are outside this owned
// journey and correctly blocked by the campaign's existing network guard.
test("dogfood remaining margin: a fresh anonymous context cannot read the rendered owned v3",
  { tags: ["performance", "remaining-performance"], requires: ["browser"], timeout: 90_000 },
  async ({ app, browser, screen }) => {
    const backendOrigin = ownedOrigin();
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as MarginReceipt;
    if (receipt.schemaVersion !== "dogfood-margin-v3-1" || receipt.backendOrigin !== backendOrigin || !receipt.runPrefix?.startsWith("ARMY-") ||
      ![receipt.projectId, receipt.versionId].every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) {
      throw new Error("The margin receipt does not identify this owned local fixture.");
    }
    await app.open("/login");
    const denied = await browser.evaluate(async (versionId) => {
      const response = await fetch(`/api/estimates/${versionId}`, { credentials: "omit" });
      const body = await response.json();
      return { status: response.status, ok: body.ok, code: body.error?.code ?? null };
    }, receipt.versionId);
    expect(denied).toEqual({ status: 401, ok: false, code: "UNAUTHORIZED" });
    await app.open(`/dashboard/affaires/${receipt.projectId}`);
    await expect(browser).toHaveURL("/login");
    await expect(screen.getByRole("heading", "Connexion", { exact: true })).toBeVisible();
    const evidence = path.resolve(".e2e/army/performance/artifacts/metrics/empty-margin-anonymous.json");
    await mkdir(path.dirname(evidence), { recursive: true });
    await writeFile(evidence, JSON.stringify({ receipt, denied, redirect: "/login", context: "fresh anonymous browser after authenticated margin render" }, null, 2) + "\n");
  });
