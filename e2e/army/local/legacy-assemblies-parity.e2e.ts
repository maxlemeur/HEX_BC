import { expect } from "e2e";

import {
  apiRequest, armyTest, createEstimateViaWizard, readEstimate, recordEvidence, type ArmyItem,
} from "../critical/fixtures";
import { signUpDedicatedOwner } from "./dedicated-owner";
import { waitForDraftLease } from "./engine-v3-editor-support";

const options = { session: "army", tags: ["critical", "local", "legacy-assemblies"], timeout: 300_000 } as const;
type LibraryItem = { id: string; title: string; unit: string; default_quantity: number;
  unit_cost_ht_cents: number; k_fo: number; k_mo: number; h_mo: number; cost_type: string };
type Assembly = { id: string; name: string; reference_code: string; unit: string; items: LibraryItem[]; members: unknown[] };
type Envelope<T> = { ok: boolean; data: T };

// TI-182's missing connection: DES03 only submits a component fixture, and AT01
// inserts an already generated library item. This journey creates an ordinary
// library entry through its real page, reloads/searches it, then inserts that
// exact server-created entry. Empty designation must neither close nor write.
armyTest("LEGASM01 a real library creation survives search and inserts its exact owned component and totals", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    await app.open("/dashboard/affaires");
    const owner = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "LASM01" });
    const ids = await createEstimateViaWizard(ui, {
      projectName: `${army.runPrefix} bibliothèque`, title: `${army.runPrefix} insertion ouvrage`,
    }, army);
    const baseline = await readEstimate(browser, ids.versionId);
    expect(baseline.version.calc_engine_version).toBe(2);
    expect(baseline.items).toEqual([]);
    const name = `${army.runPrefix} ouvrage tube`;
    const lineTitle = `${army.runPrefix} tube PVC`;
    const reference = `${army.runPrefix}-TUBE`;
    const creationRequests: string[] = [];
    await browser.route("**/api/estimates/assemblies", async route => {
      if (route.request.method === "POST") creationRequests.push(route.request.method);
      await route.fallback();
    });
    await app.open("/dashboard/estimates/assemblies");
    await screen.getByRole("button", "Nouvel ouvrage", { exact: true }).click();
    const editor = screen.getByRole("dialog", "Nouvel ouvrage", { exact: true });
    await expect(editor).toBeVisible();
    await editor.getByLabel("Nom de l'ouvrage *", { exact: true }).fill(name);
    await editor.getByRole("button", "Enregistrer", { exact: true }).click();
    await expect(editor.getByRole("alert")).toHaveText("La désignation de la ligne 1 est obligatoire.");
    await expect(editor).toBeVisible();
    expect(creationRequests).toEqual([]);
    const absent = await apiRequest<Envelope<{ assemblies: Array<{ id: string }> }>>(browser, "GET",
      `/api/estimates/assemblies?search=${encodeURIComponent(name)}`);
    expect(absent.status).toBe(200);
    expect(absent.body.ok).toBe(true);
    expect(absent.body.data.assemblies).toEqual([]);

    await editor.getByLabel("Code / référence", { exact: true }).fill(reference);
    await editor.getByLabel("Unité de l'ouvrage", { exact: true }).fill("ml");
    await editor.getByLabel("Désignation *", { exact: true }).fill(lineTitle);
    await editor.getByLabel("Unité", { exact: true }).fill("ml");
    await editor.getByLabel("Quantité par défaut", { exact: true }).fill("2.5");
    await editor.getByLabel("Prix de revient FO (€)", { exact: true }).fill("12.34");
    const creating = browser.waitForResponse("**/api/estimates/assemblies");
    await editor.getByRole("button", "Enregistrer", { exact: true }).click();
    const creation = await creating;
    expect(creation.status).toBe(201);
    const body = await creation.json<Envelope<{ assembly: Assembly }>>();
    expect(body.ok).toBe(true);
    const assembly = body.data.assembly;
    expect(assembly.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(assembly).toMatchObject({ name, reference_code: reference, unit: "ml", members: [] });
    expect(assembly.items).toHaveLength(1);
    expect(assembly.items[0]).toMatchObject({ title: lineTitle, unit: "ml", default_quantity: 2.5,
      unit_cost_ht_cents: 1234, k_fo: 1, k_mo: 1, h_mo: 0, cost_type: "material" });
    expect(creationRequests).toEqual(["POST"]);
    await expect(editor).toBeHidden();
    await expect(screen.getByRole("status").filter({ hasText: "Ouvrage créé." })).toBeVisible();
    const reread = await apiRequest<Envelope<{ assembly: Assembly }>>(browser, "GET", `/api/estimates/assemblies/${assembly.id}`);
    expect(reread.status).toBe(200);
    expect(reread.body.ok).toBe(true);
    expect(reread.body.data.assembly).toEqual(assembly);

    await browser.reload();
    await screen.getByRole("searchbox", "Rechercher", { exact: true }).fill(name);
    const library = screen.getByRole("region", "Bibliothèque d'ouvrages", { exact: true });
    await expect(library.getByRole("row").filter({ hasText: name })).toHaveCount(1);
    await expect(library).toContainText(name);
    await screen.getByRole("searchbox", "Rechercher", { exact: true }).fill(`${army.runPrefix} ouvrage absent`);
    await expect(library.getByRole("row").filter({ hasText: name })).toHaveCount(0);
    await screen.getByRole("searchbox", "Rechercher", { exact: true }).fill(name);
    await expect(library.getByRole("row").filter({ hasText: name })).toHaveCount(1);

    await app.open(`/dashboard/estimates/${ids.versionId}/edit`);
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    await waitForDraftLease(ui);
    await screen.getByRole("tab", "Insérer", { exact: true }).click();
    await screen.getByTestId("estimate-editor-insert-button", { visible: true }).click();
    await screen.getByTestId("estimate-editor-assemblies-button", { visible: true }).click();
    const picker = screen.getByRole("dialog", "Ajouter un ouvrage", { exact: true });
    await expect(picker).toBeVisible();
    await picker.getByLabel("Rechercher", { exact: true }).fill(name);
    await picker.getByRole("button", name, { exact: false }).click();
    await expect(picker.getByRole("region", "Composants de l’ouvrage", { exact: true })).toContainText(lineTitle);
    const insert = picker.getByRole("button", `Ajouter « ${name} »`, { exact: false });
    await expect(insert).toBeEnabled();
    const insertion = browser.waitForResponse(`**/api/estimates/assemblies/${assembly.id}/insert?versionId=${ids.versionId}`);
    await insert.click();
    const insertedResponse = await insertion;
    expect(insertedResponse.status).toBe(200);
    const receipt = await insertedResponse.json<Envelope<{ items: ArmyItem[] }>>();
    expect(receipt.ok).toBe(true);
    expect(receipt.data.items).toHaveLength(2);
    await expect(picker).toBeHidden();
    const inserted = await readEstimate(browser, ids.versionId);
    expect(inserted.items).toHaveLength(2);
    const sections = inserted.items.filter(item => item.item_type === "section");
    const lines = inserted.items.filter(item => item.item_type === "line");
    expect(sections).toHaveLength(1);
    expect(lines).toHaveLength(1);
    expect(sections[0]).toMatchObject({ title: name, parent_id: null });
    expect(lines[0]).toMatchObject({ title: lineTitle, parent_id: sections[0].id, quantity: 2.5,
      description: "ml", unit_price_ht_cents: 1234, k_fo: 1, h_mo: 0, k_mo: 1,
      line_total_ht_cents: 3085, line_tax_cents: 617, line_total_ttc_cents: 3702,
      source_provider: "assembly_library" });
    expect(lines[0].source_metadata).toMatchObject({ kind: "assembly_library",
      library_origin: { assembly_id: assembly.id, assembly_item_id: assembly.items[0].id } });
    expect([inserted.version.total_ht_cents, inserted.version.total_tax_cents, inserted.version.total_ttc_cents])
      .toEqual([3085, 617, 3702]);
    expect(receipt.data.items.map(item => item.id).sort()).toEqual(inserted.items.map(item => item.id).sort());
    await expect(screen.getByTestId("estimate-section-title-input")).toHaveValue(name);
    await expect(screen.getByTestId("estimate-line-title-input")).toHaveValue(lineTitle);
    await expect(screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/^(À jour|Sauvegardé)$/);
    await browser.reload();
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    const reloaded = await readEstimate(browser, ids.versionId);
    expect(reloaded.items).toEqual(inserted.items);
    expect([reloaded.version.total_ht_cents, reloaded.version.total_tax_cents, reloaded.version.total_ttc_cents])
      .toEqual([3085, 617, 3702]);
    await expect(screen.getByTestId("estimate-section-title-input")).toHaveValue(name);
    await expect(screen.getByTestId("estimate-line-title-input")).toHaveValue(lineTitle);
    await recordEvidence(army, "legacy-assembly-created-searched-inserted", {
      ...ids, tenantId: owner.tenantId, assembly, creationRequests, receipt: receipt.data, inserted, reloaded,
      expected: { quantity: 2.5, unit: "ml", unitCostCents: 1234, totals: [3085, 617, 3702] },
    });
  });
