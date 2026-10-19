import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { businessCorpus } from "../../fixtures/business/corpus";

import { expect } from "e2e";

import {
  apiRequest, armyTest, createLineViaApi, readEstimate, recordEvidence,
  type ArmyEstimate, type ArmyItem,
} from "../critical/fixtures";
import { connectedApi, connectedEstimate, retainFixture, type ConnectedUi, type Envelope } from "../extended/connected-support";
import { signUpDedicatedOwner } from "./dedicated-owner";
import { querySql } from "./calculation-gate-support";
import { waitForDraftLease } from "./engine-v3-editor-support";

const options = { session: "army", tags: ["critical", "local", "legacy-catalogue"], timeout: 240_000 } as const;
type Product = { id: string; designation: string; reference: string };
type Supplier = { id: string; name: string };
type Offer = { id: string; product_id: string; supplier_id: string; unit_price_cents: number };
type Rule = {
  id: string; name: string; unit: string; category_id: string; labor_role_id: string; k_fo: number; k_mo: number; position: number;
  created_at: string; updated_at: string; usage_count: number; last_used_at: string | null;
};
type EditorData = {
  categories: Array<{ id: string; name: string }>;
  labor_roles: Array<{ id: string; name: string; hourly_rate_cents: number }>;
  suggestion_rules: Rule[];
};

// Uncovered legacy contracts: actual CSV panel state, labelled search and opened
// offer history; the tracked Windows-1252 BDC fixture's guided preview; creation
// of a rule through the settings UI. CAT-C02/C03, V3E03/V3E12/V3E19 retain the
// stronger offer-write, supplier-choice and suggestion/undo/unit-refusal cases.
// TI153's automatic-application expectation is obsolete: today's row offers an
// explicit Apply action, and its Type FO setting stores the category UUID.
async function owner(ui: ConnectedUi, tag: string) {
  await ui.app.open("/dashboard/affaires");
  const result = await signUpDedicatedOwner(ui.browser, ui.app.baseUrl!, ui.army.runPrefix,
    { tag, uiMode: "expert", calcPolicy: "absent" });
  await ui.browser.emulateMedia({ reducedMotion: "reduce" });
  return result;
}

async function offers(ui: ConnectedUi, productId: string) {
  return (await connectedApi<{ items: Offer[] }>(ui, "GET", `/api/prices?view=page&product_id=${productId}&size=25`)).items;
}

async function createV3Fixture(ui: ConnectedUi, label: string) {
  const observation = ui.browser.waitForResponse("**/api/estimates").then(async (response) => {
    const body = await response.json<Envelope<ArmyEstimate>>();
    await recordEvidence(ui.army, "catalogue-v3-creation-response", { status: response.status, ok: body.ok, error: body.error ?? null,
      projectId: body.data?.project.id ?? null, versionId: body.data?.version.id ?? null,
      engine: body.data?.version.calc_engine_version ?? null, expectedEngine: 3, stage: "before any draft lock is acquired" });
    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
  });
  const [creation, observed] = await Promise.allSettled([
    connectedEstimate(ui, label, { expected_calc_engine_version: 3, margin_multiplier: 1 }), observation,
  ]);
  if (observed.status === "rejected") throw observed.reason;
  if (creation.status === "rejected") throw creation.reason;
  expect(creation.value.version.calc_engine_version).toBe(3);
  return creation.value;
}

armyTest("LEGCAT01 owned prices retain real search, CSV collapse, accented history and dialogs without changing an offer", options,
  async (ui) => {
    const identity = await owner(ui, "LGCAT1");
    const anchor = await createV3Fixture(ui, "ancre tarifs possédée");
    ui.army.ownedPriceLookupProjects = [...(ui.army.ownedPriceLookupProjects ?? []), anchor.project.id];
    await ui.app.open("/dashboard/products");
    const designation = `${ui.army.runPrefix} article tarif accentué`;
    const product = (await connectedApi<{ item: Product }>(ui, "POST", "/api/products", {
      action: "create", item: { designation, reference: null, unit: "u", unit_price_cents: 0 },
    })).item;
    await retainFixture(ui.army, "product", product.id, designation);
    const name = `${ui.army.runPrefix} fournisseur tarif`;
    const supplier = (await connectedApi<{ item: Supplier }>(ui, "POST", "/api/suppliers", {
      action: "create", item: { name, is_active: true },
    })).item;
    await retainFixture(ui.army, "supplier", supplier.id, name);
    const offer = (await connectedApi<{ item: Offer }>(ui, "POST", "/api/prices", {
      action: "create", item: { supplier_id: supplier.id, product_id: product.id, unit: "u", min_quantity: 1,
        unit_price_cents: 1234, currency: "EUR", valid_from: new Date().toISOString().slice(0, 10) },
    })).item;
    await retainFixture(ui.army, "offer", offer.id, `${ui.army.runPrefix} offre accentuée`);
    const before = await offers(ui, product.id);
    expect(before.map((item) => item.id)).toEqual([offer.id]);
    await ui.app.open(`/dashboard/prices?product_id=${product.id}`);
    await expect(ui.screen.getByRole("heading", "Prix fournisseurs", { exact: true })).toBeVisible();
    await expect(ui.screen.getByText(/Gérez les tarifs de vos fournisseurs/)).toBeVisible();
    await expect(ui.screen.getByText("Fraîcheur", { exact: true })).toBeVisible();
    await expect(ui.screen.getByText("Mode avancé", { exact: true })).toBeVisible();
    const toggle = ui.browser.locator('button[aria-controls="price-csv-import-panel"]');
    const panel = ui.browser.locator("#price-csv-import-panel");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel("Fichier CSV", { exact: true })).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toHaveCount(0);

    const cards = ui.browser.locator('[aria-label="Offres fournisseurs"] > li');
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText(supplier.name);
    const stats = await ui.browser.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll("main dt"))
      .map((label) => [label.textContent?.trim() ?? "", label.nextElementSibling?.textContent?.trim() ?? null])));
    expect(stats).toMatchObject({ "Total prix": "1", "Fournisseurs couverts": "1" });
    const search = ui.screen.getByRole("searchbox", "Rechercher par fournisseur ou produit…", { exact: true });
    await search.fill(`${ui.army.runPrefix} aucun article`);
    await expect.poll(async () => new URL(await ui.browser.url()).searchParams.get("q")).toBe(`${ui.army.runPrefix} aucun article`);
    await expect(cards).toHaveCount(0);
    await search.fill(supplier.name);
    await expect.poll(async () => new URL(await ui.browser.url()).searchParams.get("q")).toBe(supplier.name);
    await expect(cards).toHaveCount(1);
    await expect(cards).toContainText(supplier.name);

    await ui.screen.getByRole("button", "Ajouter un fournisseur / tarif", { exact: true }).click();
    const create = ui.screen.getByRole("dialog", "Ajouter un fournisseur / tarif", { exact: true });
    await expect(create.getByLabel("Article *", { exact: true })).toBeVisible();
    await expect(create.getByLabel("Fournisseur *", { exact: true })).toBeVisible();
    await expect(create.getByLabel("Prix unitaire HT *", { exact: true })).toBeVisible();
    await create.getByRole("button", "Annuler", { exact: true }).click();
    await expect(create).toBeHidden();
    await cards.getByRole("button", "Voir / modifier l’offre", { exact: true }).click();
    const edit = ui.screen.getByRole("dialog", "Modifier l’offre fournisseur", { exact: true });
    await expect(edit.getByLabel("Prix unitaire HT *", { exact: true })).toHaveValue("12,34");
    await expect(edit.getByRole("button", "Enregistrer l’offre", { exact: true })).toBeEnabled();
    await edit.getByRole("button", "Annuler", { exact: true }).click();
    await expect(edit).toBeHidden();
    await cards.getByText("Conditions et historique du tarif", { exact: true }).click();
    await expect(cards.getByText(/^Mis à jour le /)).toBeVisible();
    const response = ui.browser.waitForResponse("**/api/prices?**");
    await ui.screen.getByRole("button", "Actualiser", { exact: true }).click();
    expect((await response).status).toBe(200);
    await expect(cards).toHaveCount(1);
    const after = await offers(ui, product.id);
    expect(after).toEqual(before);
    await recordEvidence(ui.army, "legacy-prices-interface", { identity, product, supplier, offer, stats, before, after });
  });

armyTest("LEGCAT02 the tracked BDC CSV is uploaded, decoded and previewed with exact counts and a canonical trace", options,
  async (ui) => {
    const identity = await owner(ui, "LGCAT2");
    const anchor = await createV3Fixture(ui, "ancre import possédée");
    ui.army.ownedPriceLookupProjects = [...(ui.army.ownedPriceLookupProjects ?? []), anchor.project.id];
    const corpus = businessCorpus();
    const fixture = corpus.bdc.path;
    const bytes = await readFile(fixture);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    expect(sha256).toBe(corpus.bdc.sha256);
    await ui.app.open("/dashboard/prices");
    await ui.browser.locator('button[aria-controls="price-csv-import-panel"]').click();
    const panel = ui.browser.locator("#price-csv-import-panel");
    await panel.getByLabel("Fichier CSV", { exact: true }).setInputFiles(fixture);
    await expect(panel.getByRole("button", "Analyser", { exact: true })).toBeEnabled();
    const importResponse = ui.browser.waitForResponse("**/api/imports");
    await panel.getByRole("button", "Analyser", { exact: true }).click();
    const imported = await importResponse;
    expect(imported.status).toBe(201);
    const canonical = await imported.json<Envelope<{ id: string; filename: string; project_id: string | null }>>();
    expect(canonical.ok).toBe(true);
    expect(canonical.data).toMatchObject({ filename: path.basename(fixture), project_id: null });
    expect(canonical.data.id).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(panel.getByText("Format BDC détecté", { exact: true })).toBeVisible();
    await expect(panel.getByText("Encodage : windows-1252", { exact: true })).toBeVisible();
    await expect(panel.getByText("Trace canonique liée", { exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", "Étape 4 — Importer", { exact: true })).toBeVisible();
    const summary = await ui.browser.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll("#price-csv-import-panel dt"))
      .map((label) => [label.textContent?.trim() ?? "", label.nextElementSibling?.textContent?.trim() ?? null])));
    // Both explicit corpora retain 539 nonempty rows; 127 carry
    // supplier prices, 412 have none. This new tenant has no known suppliers or
    // products, so the 127 candidates need resolution; no bulk write is claimed.
    expect(summary).toEqual({ "Total détecté": "539", "Importables": "0", "Ignorées (hors périmètre)": "412", "À corriger": "127" });
    await expect(panel.getByRole("button", "Importer les lignes prêtes", { exact: true })).toBeDisabled();
    await expect(panel.getByRole("region", "Aperçu des lignes du fichier", { exact: true }).getByRole("row")).toHaveCount(11);
    await recordEvidence(ui.army, "legacy-guided-bdc-preview", { identity, corpus: corpus.identity, fixture: { path: fixture, bytes: bytes.length, sha256 },
      canonicalImport: canonical.data, summary, confirmedPriceImports: 0, limit: "Upload, canonical trace and guided preview only; no confirmation or supplier creation." });
  });

armyTest("LEGCAT03 settings create a real labor role and suggestion rule; explicit application persists unit and exact resource IDs", options,
  async (ui) => {
    const identity = await owner(ui, "LGCAT3");
    const createdEstimate = await createV3Fixture(ui, "règle UI");
    const ids = { projectId: createdEstimate.project.id, versionId: createdEstimate.version.id };
    const line = await createLineViaApi(ui.browser, ids.versionId, `${ui.army.runPrefix} planches bois`, {
      quantity: 2, unit_code: null, description: null, category_id: null, labor_role_id: null,
      unit_price_ht_cents: 1000, pricing_status: "priced", h_mo_per_unit: null, k_fo: 1, k_mo: 1,
    });
    const release = await apiRequest(ui.browser, "DELETE", `/api/estimates/${ids.versionId}/lock`);
    expect(release.status).toBe(200);
    await ui.app.open(`/dashboard/estimates/${ids.versionId}/edit`);
    await waitForDraftLease(ui);
    const before = await readEstimate(ui.browser, ids.versionId);
    expect(before.version.calc_engine_version).toBe(3);
    const detail = await connectedApi<EditorData>(ui, "GET", `/api/estimates/${ids.versionId}`);
    const category = detail.categories.find((item) => item.name === "Materiaux");
    expect(category, "Wizard prepares the real default materials category").toBeDefined();
    await ui.screen.getByRole("button", "Ouvrir les paramètres", { exact: true }).click();
    const drawer = ui.screen.getByRole("dialog", "Paramétrage du devis", { exact: true });
    const roleName = `${ui.army.runPrefix} ouvrier bois`;
    await drawer.getByLabel("Nom du rôle", { exact: true }).fill(roleName);
    await drawer.getByLabel("Taux horaire (EUR)", { exact: true }).fill("45");
    const roleForm = ui.browser.locator(".estimate-role-form").filter({ has: ui.screen.getByLabel("Nom du rôle", { exact: true }) });
    const [roleResult] = await Promise.all([
      ui.browser.waitForResponse(`**/api/estimates/${ids.versionId}/labor-roles`),
      roleForm.getByRole("button", "Ajouter", { exact: true }).click(),
    ]);
    expect(roleResult.status).toBe(201);
    const role = (await roleResult.json<Envelope<{ labor_role: { id: string; name: string; hourly_rate_cents: number } }>>()).data.labor_role;
    expect(role).toMatchObject({ name: roleName, hourly_rate_cents: 4500 });
    const ruleName = `${ui.army.runPrefix} règle bois`;
    for (const [label, value] of [["Nom de règle", ruleName], ["Mots-clés (virgules)", "bois"], ["Unité", "m2"],
      ["K FO", "1.2"], ["K MO", "0.5"], ["Priorité", "1"]]) await drawer.getByLabel(label, { exact: true }).fill(value);
    await drawer.getByLabel("Type FO", { exact: true }).selectOption({ value: category!.id });
    await drawer.getByLabel("Rôle MO", { exact: true }).selectOption({ value: role.id });
    const ruleForm = ui.browser.locator(".estimate-role-form").filter({ has: ui.screen.getByLabel("Nom de règle", { exact: true }) });
    const [ruleResult] = await Promise.all([
      ui.browser.waitForResponse(`**/api/estimates/${ids.versionId}/suggestion-rules`),
      ruleForm.getByRole("button", "Ajouter", { exact: true }).click(),
    ]);
    expect(ruleResult.status).toBe(201);
    const rulePayload = await ruleResult.json<Envelope<{ suggestion_rule: Rule }>>();
    expect(rulePayload.ok).toBe(true);
    const created = await connectedApi<EditorData>(ui, "GET", `/api/estimates/${ids.versionId}`);
    const rule = created.suggestion_rules.find((item) => item.name === ruleName);
    expect(rule).toMatchObject({ unit: "m2", category_id: category!.id, labor_role_id: role.id, k_fo: 1.2, k_mo: 0.5, position: 1 });
    expect(rule!.usage_count).toBe(0);
    expect(rule!.last_used_at).toBe(null);
    await drawer.getByTestId("estimate-editor-drawer-close-button").click();
    await expect(drawer).toBeHidden();
    const suggestion = ui.browser.locator(".estimate-suggestion").filter({ hasText: ruleName });
    await expect(suggestion).toHaveCount(1);
    // Creating a rule must not silently change existing line inputs.
    expect((await readEstimate(ui.browser, ids.versionId)).items.find((item) => item.id === line.id)).toMatchObject({ unit_code: null, category_id: null, k_fo: 1, k_mo: 1, labor_role_id: null });
    await suggestion.getByRole("button", "Appliquer", { exact: true }).click();
    const expected = { unit_code: "m2", category_id: category!.id, labor_role_id: role.id, k_fo: 1.2, k_mo: 0.5 };
    await expect.poll(async () => {
      const current = (await readEstimate(ui.browser, ids.versionId)).items.find((item) => item.id === line.id)!;
      return Object.fromEntries(Object.keys(expected).map((key) => [key, current[key]]));
    }, { timeout: 90_000 }).toEqual(expected);
    const syncStatus = ui.screen.getByTestId("estimate-page-toolbar-autosave-status");
    try {
      // Persistence can precede the editor's acknowledgement, and settings use
      // the existing 60-second cadence. Don't race the real leave protection.
      await expect(syncStatus).toHaveText(/^(À jour|Sauvegardé)$/, { timeout: 90_000 });
    } finally {
      await recordEvidence(ui.army, "legacy-rule-before-reload", { ids, badge: await syncStatus.textContent(), expected });
    }
    let nativeDialogs = 0;
    const stopDialogs = await ui.browser.onDialog(async (dialog) => {
      nativeDialogs++;
      await dialog.accept();
    });
    try {
      await ui.browser.reload();
    } finally {
      await stopDialogs();
      await recordEvidence(ui.army, "legacy-rule-reload-dialogs", { ids, nativeDialogs });
    }
    expect(nativeDialogs, "Acknowledged suggestion changes must reload without a native dialog").toBe(0);
    await expect(ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    const after = await readEstimate(ui.browser, ids.versionId);
    const persisted: ArmyItem = after.items.find((item) => item.id === line.id)!;
    expect(persisted).toMatchObject(expected);
    expect(after.items.filter((item) => item.item_type === "line").map((item) => item.id)).toEqual([line.id]);
    await expect(ui.browser.locator(`[data-cell-id="${line.id}::unit"] input`)).toHaveValue("m2 — mètre carré");
    const reopened = await connectedApi<EditorData>(ui, "GET", `/api/estimates/${ids.versionId}`);
    const appliedRule = reopened.suggestion_rules.find((item) => item.id === rule!.id);
    expect(appliedRule).toBeDefined();
    // Applying the rule records real feedback; every configuration/identity
    // field must persist, while usage metadata must reflect exactly one Apply.
    const configuration = (value: Rule) => Object.fromEntries(Object.entries(value)
      .filter(([field]) => !["usage_count", "last_used_at", "updated_at"].includes(field)));
    expect(configuration(appliedRule!)).toEqual(configuration(rule!));
    expect(appliedRule!.usage_count).toBe(1);
    expect(typeof appliedRule!.last_used_at).toBe("string");
    expect(Date.parse(appliedRule!.last_used_at!)).toBeGreaterThanOrEqual(Date.parse(rule!.created_at));
    expect(Date.parse(appliedRule!.updated_at)).toBeGreaterThanOrEqual(Date.parse(rule!.updated_at));
    expect(Date.parse(appliedRule!.last_used_at!)).toBeLessThanOrEqual(Date.parse(appliedRule!.updated_at));
    expect(reopened.labor_roles.find((item) => item.id === role.id)).toMatchObject({ name: roleName, hourly_rate_cents: 4500 });
    await recordEvidence(ui.army, "legacy-rule-settings-application", { identity, ids, category, role, rule, appliedRule, before, after,
      application: "explicit real row Apply button", expected });
  });

armyTest("LEGCAT04 real stale catalogue alternatives and the nonoptimal supplier warning retain exact selected offer identity", options,
  async (ui) => {
    const identity = await owner(ui, "LGCAT4");
    await ui.app.open("/dashboard/products");
    const designation = `${ui.army.runPrefix} tube inox catalogue`;
    const product = (await connectedApi<{ item: Product }>(ui, "POST", "/api/products", {
      action: "create", item: { designation, reference: null, unit: "u", unit_price_cents: 0 },
    })).item;
    await retainFixture(ui.army, "product", product.id, designation);
    const suppliers: Supplier[] = [];
    for (const label of ["économique", "retenu"]) {
      const name = `${ui.army.runPrefix} fournisseur ${label}`;
      const supplier = (await connectedApi<{ item: Supplier }>(ui, "POST", "/api/suppliers", {
        action: "create", item: { name, is_active: true },
      })).item;
      await retainFixture(ui.army, "supplier", supplier.id, name);
      suppliers.push(supplier);
    }
    for (const id of [identity.tenantId, identity.userId, product.id, ...suppliers.map((item) => item.id)]) {
      expect(id).toMatch(/^[0-9a-f-]{36}$/i);
    }
    // Age is a real input of this read/UI contract. Insert only these owned
    // tenant's new, currently valid offers with historical update timestamps; don't alter the clock,
    // disable a trigger, mock a response, or rewrite an existing catalogue row.
    const seeded = await querySql(`BEGIN;
      INSERT INTO public.supplier_catalog_items (tenant_id, supplier_id, product_id, supplier_sku, created_by)
      SELECT '${identity.tenantId}', s.id, p.id,
        CASE WHEN s.id = '${suppliers[0].id}' THEN 'LEG-1000' ELSE 'LEG-1200' END, '${identity.userId}'
      FROM public.suppliers s JOIN public.products p ON p.tenant_id = s.tenant_id
      WHERE s.tenant_id = '${identity.tenantId}' AND p.id = '${product.id}'
        AND s.id IN ('${suppliers[0].id}', '${suppliers[1].id}');
      WITH inserted AS (
      INSERT INTO public.supplier_pricebook
        (tenant_id, supplier_id, product_id, supplier_sku, unit, min_quantity, unit_price_cents,
         currency, valid_from, valid_to, is_active, created_by, created_at, updated_at)
      SELECT '${identity.tenantId}', s.id, p.id,
        CASE WHEN s.id = '${suppliers[0].id}' THEN 'LEG-1000' ELSE 'LEG-1200' END,
        'u', 1, CASE WHEN s.id = '${suppliers[0].id}' THEN 1000 ELSE 1200 END,
        'EUR', CURRENT_DATE, (CURRENT_DATE + INTERVAL '6 months')::date, true, '${identity.userId}',
        CASE WHEN s.id = '${suppliers[0].id}' THEN TIMESTAMPTZ '2020-01-01 00:00:00+00' ELSE TIMESTAMPTZ '2020-02-01 00:00:00+00' END,
        CASE WHEN s.id = '${suppliers[0].id}' THEN TIMESTAMPTZ '2020-01-01 00:00:00+00' ELSE TIMESTAMPTZ '2020-02-01 00:00:00+00' END
      FROM public.suppliers s JOIN public.products p ON p.tenant_id = s.tenant_id
      WHERE s.tenant_id = '${identity.tenantId}' AND p.id = '${product.id}'
        AND s.id IN ('${suppliers[0].id}', '${suppliers[1].id}')
      RETURNING id, product_id, supplier_id, supplier_catalog_item_id, unit_price_cents, updated_at, valid_from, valid_to
    ) SELECT coalesce(jsonb_agg(inserted ORDER BY unit_price_cents), '[]'::jsonb) FROM inserted;
    COMMIT;`);
    const seededOffers = JSON.parse(seeded.at(-1) ?? "[]") as Array<Offer & {
      supplier_catalog_item_id: string; updated_at: string; valid_from: string; valid_to: string;
    }>;
    expect(seededOffers).toHaveLength(2);
    expect(seededOffers.map((item) => item.unit_price_cents)).toEqual([1000, 1200]);
    for (const offer of seededOffers) {
      expect(offer.updated_at).toMatch(offer.unit_price_cents === 1000 ? /^2020-01-01/ : /^2020-02-01/);
      await retainFixture(ui.army, "supplier-catalog-item", offer.supplier_catalog_item_id, `${ui.army.runPrefix} catalogue ${offer.unit_price_cents}`);
      await retainFixture(ui.army, "dated-offer", offer.id, `${ui.army.runPrefix} tarif ${offer.unit_price_cents}`);
    }
    const createdEstimate = await createV3Fixture(ui, "comparaison datée");
    const ids = { projectId: createdEstimate.project.id, versionId: createdEstimate.version.id };
    expect((await readEstimate(ui.browser, ids.versionId)).version.sale_coefficient_fo).toBe(1.3);
    ui.army.ownedPriceLookupProjects = [ids.projectId];
    const line = await createLineViaApi(ui.browser, ids.versionId, designation, {
      product_id: product.id, selected_supplier_price_id: seededOffers[0].id, quantity: 3, unit_code: "u", description: null,
      unit_price_ht_cents: 1000, pricing_status: "priced", h_mo_per_unit: null, k_fo: 1, k_mo: 1,
    });
    const suggestions = await connectedApi<{ suggestions: Array<{
      product_id: string; supplier_price_id: string; is_stale: boolean; adjusted_unit_price_cents: number;
      alternatives: Array<{ kind: string; supplier_price_id: string; is_stale: boolean; adjusted_unit_price_cents: number }>;
    }> }>(ui, "GET", `/api/estimates/${ids.versionId}/suggest-prices?q=${encodeURIComponent(designation)}`);
    const suggestion = suggestions.suggestions.find((item) => item.product_id === product.id);
    expect(suggestion).toBeDefined();
    // The primary candidate is the most recent at equal relevance; best_price
    // is a separately named alternative. These two historical dates make that
    // distinction deterministic while both real offers remain stale.
    expect(suggestion).toMatchObject({ is_stale: true, supplier_price_id: seededOffers[1].id, adjusted_unit_price_cents: 1200 });
    expect(suggestion!.alternatives.find((item) => item.kind === "best_price"))
      .toMatchObject({ supplier_price_id: seededOffers[0].id, adjusted_unit_price_cents: 1000, is_stale: true });
    expect(suggestion!.alternatives.length).toBeGreaterThan(0);
    expect([...new Set([suggestion!.supplier_price_id, ...suggestion!.alternatives.map((item) => item.supplier_price_id)])].sort())
      .toEqual(seededOffers.map((item) => item.id).sort());
    expect(suggestion!.alternatives.every((item) => item.is_stale)).toBe(true);
    const release = await apiRequest(ui.browser, "DELETE", `/api/estimates/${ids.versionId}/lock`);
    expect(release.status).toBe(200);
    await ui.app.open(`/dashboard/estimates/${ids.versionId}/edit`);
    await waitForDraftLease(ui);
    const row = ui.browser.locator(`[data-estimate-item-id="${line.id}"]`);
    const comparisonResponse = ui.browser.waitForResponse(`**/api/estimates/${ids.versionId}/supplier-comparisons`);
    await row.getByRole("button", `Changer d’offre pour ${designation}`, { exact: true }).click();
    const response = await comparisonResponse;
    expect(response.status).toBe(200);
    const comparison = await response.json<Envelope<{ comparisons: Array<{
      item_id: string; best_supplier_price_id: string; alternatives: Array<{ supplier_price_id: string; is_stale: boolean }>;
    }> }>>();
    expect(comparison.ok).toBe(true);
    const comparedLine = comparison.data.comparisons.find((item) => item.item_id === line.id);
    expect(comparedLine).toBeDefined();
    expect(new Set(comparedLine!.alternatives.map((item) => item.supplier_price_id))).toEqual(new Set(seededOffers.map((item) => item.id)));
    const dialog = ui.screen.getByRole("dialog", "Comparer fournisseurs", { exact: true });
    const cheaper = dialog.getByRole("article").filter({ hasText: suppliers[0].name });
    const costlier = dialog.getByRole("article").filter({ hasText: suppliers[1].name });
    await expect(cheaper.getByText("Meilleur prix", { exact: true })).toBeVisible();
    await expect(costlier.getByText("Prix ancien", { exact: true })).toBeVisible();
    await expect(costlier).toContainText(/Total fourniture.*36,00/);
    await costlier.getByRole("button", "Retenir cette offre", { exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await readEstimate(ui.browser, ids.versionId)).items.find((item) => item.id === line.id)?.selected_supplier_price_id,
      { timeout: 90_000 }).toBe(seededOffers[1].id);
    await row.getByRole("button", `Details de la ligne ${designation}`, { exact: true }).click();
    await expect(ui.screen.getByText("Meilleur prix fournisseur disponible", { exact: true })).toBeVisible();
    await ui.browser.keyboard.press("Escape");
    await ui.browser.reload();
    await expect(ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    const after = await readEstimate(ui.browser, ids.versionId);
    expect(after.items.find((item) => item.id === line.id)).toMatchObject({
      product_id: product.id, selected_supplier_price_id: seededOffers[1].id, unit_price_ht_cents: 1200,
      quantity: 3, unit_code: "u", line_total_ht_cents: 4680,
    });
    expect(after.version.total_ht_cents).toBe(4680);
    await row.getByRole("button", `Changer d’offre pour ${designation}`, { exact: true }).click();
    await expect(costlier.getByRole("button", "Offre retenue", { exact: true })).toBeDisabled();
    await expect(cheaper.getByText("Meilleur prix", { exact: true })).toBeVisible();
    await dialog.getByRole("button", "Fermer", { exact: true }).click();
    await row.getByRole("button", `Details de la ligne ${designation}`, { exact: true }).click();
    await expect(ui.screen.getByText("Meilleur prix fournisseur disponible", { exact: true })).toBeVisible();
    await recordEvidence(ui.army, "legacy-stale-nonoptimal-offer", { identity, ids, product, suppliers, seededOffers,
      suggestions, comparison: comparison.data, selectedOfferId: seededOffers[1].id, cheaperOfferId: seededOffers[0].id, after });
  });
