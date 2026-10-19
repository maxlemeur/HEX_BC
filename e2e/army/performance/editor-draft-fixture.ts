import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";

import { rankSuggestions } from "../../../src/lib/estimates/suggestion-scoring";
import type { Database } from "../../../src/types/database";
import { apiRequest, ownEstimate, readEstimate, type ArmyState } from "../critical/fixtures";
import { ownedEstimateContext } from "../local/calculation-gate-support";
import { setTenantCalcPolicy } from "../local/engine-v3-persistence-support";

type Ui = { app: App; browser: Browser; screen: Screen };
type Rule = Database["public"]["Tables"]["estimate_suggestion_rules"]["Row"];
const fixturePath = path.resolve(".e2e/army/performance/fixtures/editor.json");
const workbook = "docs/prd_file/exemple chiffrage OPTIMA/BEING - DPGF HYDRAULIQUE.xlsx";
const TITLES = ["Pose de fenêtres PVC", "Réparations des fenêtres", "PVC", "Cloison", "Enduit", "Isolation thermique", "Menuiserie"];
const KEYWORDS = ["pose de fenetre pvc", "fenêtres", "pose feneetre pvd", "reparation des feneetre", "pvc", "cloison", "enduit", "isolation thermique", "menuiserie"];
const UUID = /^[0-9a-f-]{36}$/i;

/** The existing UI importer preserves the real workbook hierarchy, values and provenance.
 * The temporary policy window affects only this owned local campaign's tenant. It is
 * closed before any measured edit, and no estimate status, access or email is changed. */
export async function editorDraftFixture(ui: Ui, army: ArmyState) {
  try {
    const retained = JSON.parse(await readFile(fixturePath, "utf8"));
    if (retained.schemaVersion !== "dogfood-editor-1" || !retained.runPrefix?.startsWith("ARMY-") ||
      retained.supabaseHost !== process.env.E2E_ALLOWED_SUPABASE_HOST || !UUID.test(retained.projectId) || !UUID.test(retained.versionId)) {
      throw new Error("The retained editor receipt does not identify this owned local fixture.");
    }
    return retained;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await ui.app.open("/dashboard/affaires");
  const created = await apiRequest<{ ok: boolean; data: { project: { id: string }; version: { id: string } } }>(ui.browser, "POST", "/api/estimates", {
    project: { name: `${army.runPrefix} editor performance` },
    version: { title: `${army.runPrefix} performance anchor`, margin_multiplier: 1, discount_bp: 0, tax_rate_bp: 2000, rounding_mode: "none", max_section_depth: 3 },
  });
  expect([created.status, created.body.ok]).toEqual([201, true]);
  const projectId = created.body.data.project.id;
  ownEstimate(army, { projectId, versionId: created.body.data.version.id });
  const owner = await ownedEstimateContext(projectId);
  let versionId = "";
  await setTenantCalcPolicy(owner, { engine: 3, fo: "1.30", mo: "1.20", reason: `${army.runPrefix} editor performance fixture` });
  try {
    await ui.app.open(`/dashboard/affaires/${projectId}?created=1`);
    await ui.screen.getByRole("button", "Importer la DPGF", { exact: true }).tap();
    const launch = ui.screen.getByRole("button", "Lancer l'import", { exact: true });
    await expect(ui.screen.getByText("Glissez-déposez votre fichier DPGF ici", { exact: true })).toBeVisible({ timeout: 30_000 });
    await ui.browser.locator('input[type="file"]:not([multiple])').setInputFiles(path.resolve(workbook));
    await expect(launch).toBeVisible({ timeout: 30_000 });
    await launch.tap();
    const nextMapping = ui.screen.getByRole("button", "Suivant : Aperçu", { exact: true });
    const editMapping = ui.screen.getByRole("button", "Modifier le mapping", { exact: true });
    await expect.poll(async () => await nextMapping.isVisible() || await editMapping.isVisible(), { timeout: 60_000 }).toBe(true);
    if (await editMapping.isVisible()) await editMapping.tap();
    await nextMapping.tap();
    await expect(ui.screen.getByText("Coefficients du classeur proposés : FO 1,3 · MO 1,3", { exact: true })).toBeVisible({ timeout: 120_000 });
    await ui.screen.getByRole("button", "Suivant : Confirmation", { exact: true }).tap();
    await ui.screen.getByRole("button", "Créer le chiffrage", { exact: true }).tap();
    await expect(ui.screen.getByRole("heading", "Devis créé", { exact: true })).toBeVisible({ timeout: 120_000 });
    await ui.screen.getByRole("button", "Continuer", { exact: true }).tap();
    const skipPlans = ui.screen.getByRole("button", "Continuer sans ajouter de plans", { exact: true });
    const editorUrl = /\/dashboard\/estimates\/[0-9a-f-]{36}\/edit(?:[?#].*)?$/i;
    await expect.poll(async () => editorUrl.test(await ui.browser.url()) || await skipPlans.isVisible(), { timeout: 30_000 }).toBe(true);
    if (await skipPlans.isVisible()) await skipPlans.tap();
    await expect(ui.browser).toHaveURL(editorUrl, { timeout: 30_000 });
    versionId = (await ui.browser.url()).match(/\/estimates\/([0-9a-f-]{36})\/edit/i)![1]!;
  } finally {
    await setTenantCalcPolicy(owner, { engine: 2, fo: "1.30", mo: "1.20", reason: `${army.runPrefix} editor performance fixture end` });
  }
  ownEstimate(army, { projectId, versionId });
  const state = await readEstimate(ui.browser, versionId);
  expect(state.items).toHaveLength(2031);
  expect(state.version.calc_engine_version).toBe(3);
  const targetLineId = await ui.browser.evaluate(() => document.querySelector('[data-testid="estimate-line-row"]')?.getAttribute("data-estimate-item-id") ?? null);
  if (!targetLineId) throw new Error("The real OPTIMA editor has no visible target line.");
  for (let index = 0; index < 80; index += 1) {
    const keyword = KEYWORDS[index] ?? `configuration hydraulique ${String(index).padStart(3, "0")}`;
    const response = await apiRequest(ui.browser, "POST", `/api/estimates/${versionId}/suggestion-rules`, {
      name: `ARMY performance rule ${String(index).padStart(2, "0")}`, match_value: keyword,
      // A coefficient patch keeps the suggestion visible on a v3 with an existing unit.
      k_fo: 1.15, position: index, is_active: true,
    });
    expect(response.status).toBe(201);
  }
  const detail = await apiRequest<{ data: { suggestion_rules: Rule[] } }>(ui.browser, "GET", `/api/estimates/${versionId}`);
  const rules = detail.body.data.suggestion_rules;
  const receipt = { schemaVersion: "dogfood-editor-1", runPrefix: army.runPrefix, projectId, versionId,
    supabaseHost: process.env.E2E_ALLOWED_SUPABASE_HOST, targetLineId, expectedItems: state.items.length,
    expectedTotals: [state.version.total_ht_cents, state.version.total_tax_cents, state.version.total_ttc_cents], ruleCount: rules.length,
    workbook: { path: workbook, sha256: createHash("sha256").update(await readFile(workbook)).digest("hex") },
    titles: TITLES.map((title) => ({ title, suggestions: rankSuggestions({ title, rules, limit: 5 })
      .map(({ rule, score }) => ({ value: rule.id, text: `${rule.name} (score ${score.toFixed(2)})` })) })),
  };
  await mkdir(path.dirname(fixturePath), { recursive: true });
  await writeFile(fixturePath, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
  return receipt;
}
