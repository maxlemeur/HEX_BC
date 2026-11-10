import { randomUUID } from "node:crypto";
import { expect } from "e2e";
import { armyTest, readEstimate, recordEvidence, apiRequest, saveLineEditsWithShortcut } from "../critical/fixtures";
import { connectedApi } from "../extended/connected-support";
import { type Ui, prepareV3Draft, seedLines, showStandardColumns, waitForDraftLease, lockVersion, releaseVersion } from "./engine-v3-editor-support";
import { querySql } from "./calculation-gate-support";

const options = { session: "army", tags: ["critical", "local", "fo-provision"], timeout: 240_000 } as const;

// The API can already read a saved line while the editor still waits for the answer of that save, and
// an editor with a save in flight refuses to be left (beforeunload): the reload then never starts and
// the navigation is aborted. Leave the editor once its toolbar reports the save.
const saveSettled = (ui: Ui) =>
  expect(ui.screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/^(Sauvegardé|À jour)$/, { timeout: 30_000 });

armyTest("FO53401 catalogue families and transport are retained once before margin, then manual price clears the origin", options,
  async (ui) => {
    const draft = await prepareV3Draft(ui, ui.army, "FO534");
    const product = (await connectedApi<{ item: { id: string } }>(ui, "POST", "/api/products", {
      action: "create", item: { designation: `${ui.army.runPrefix} tube PVC FO534`, product_type: "Tube", unit: "u", unit_price_cents: 10000 },
    })).item;
    const offers: Array<{ id: string; updated_at: string }> = [];
    for (const transport_mode of ["excluded", "included"] as const) {
      const supplier = (await connectedApi<{ item: { id: string } }>(ui, "POST", "/api/suppliers", {
        action: "create", item: { name: `${ui.army.runPrefix} FO534 ${transport_mode}`, is_active: true },
      })).item;
      const offer = (await connectedApi<{ item: { id: string; updated_at: string } }>(ui, "POST", "/api/prices", {
        action: "create", item: { supplier_id: supplier.id, product_id: product.id, unit: "u", min_quantity: 1,
          unit_price_cents: transport_mode === "included" ? 10000 : 9000, currency: "EUR", valid_from: new Date().toISOString().slice(0, 10) },
      })).item;
      await connectedApi(ui, "POST", "/api/catalogue/reference-price", {
        action: "set-transport", product_id: product.id, offer_id: offer.id, transport_mode, expected_updated_at: offer.updated_at,
      });
      offers[transport_mode === "included" ? 0 : 1] = offer;
    }
    await querySql(`insert into public.supply_types(tenant_id,code,name,default_fo_provision)
      values ('${draft.owner.tenantId}', 'tube', 'Tube', 1.030);`);
    const details = await connectedApi<{ supply_types: Array<{ id: string; code: string }> }>(ui, "GET", `/api/estimates/${draft.versionId}`);
    const tube = details.supply_types.find(type => type.code === "tube")?.id;
    expect(tube).toMatch(/^[0-9a-f-]{36}$/);
    const base = { unit_code: "u", pricing_status: "priced", quantity: 10, unit_price_ht_cents: 10000,
      h_mo_per_unit: 0.5, labor_role_id: draft.tuyauteurId, k_fo: 1, k_mo: 1, tax_rate_bp: 2000 };
    const rows = await seedLines(ui, ui.army, draft, "fo534", [
      { ...base, title: `${ui.army.runPrefix} transport inclus`, product_id: product.id, selected_supplier_price_id: offers[0].id },
      { ...base, title: `${ui.army.runPrefix} transport exclu`, product_id: product.id, selected_supplier_price_id: offers[1].id, supply_type_id: tube, unit_price_ht_cents: 9000 },
      { ...base, title: `${ui.army.runPrefix} tube sans offre`, supply_type_id: tube },
      { ...base, title: `${ui.army.runPrefix} sans type`, quantity: 1 },
    ]);
    await recordEvidence(ui.army, "fo534-before-assertions", { product, offers, tube, rows });
    expect(rows.map(row => [row.supply_type_id, Number(row.fo_provision), row.pu_ht_cents, row.line_total_ht_cents]))
      .toEqual([[tube, 1.01, 15530, 155300], [tube, 1.03, 14451, 144510], [tube, 1.03, 15790, 157900], [null, 1.01, 15530, 15530]]);
    await ui.app.open(`/dashboard/estimates/${draft.versionId}/edit`);
    await waitForDraftLease(ui);
    await expect(ui.screen.getByText("Type FO à préciser", { exact: true })).toBeVisible();
    await showStandardColumns(ui);
    const row = ui.browser.locator(`[data-estimate-item-id="${rows[0].id}"]`);
    const designation = `${ui.army.runPrefix} tube PVC FO534`;
    const primary = ui.browser.locator(".estimate-catalogue-suggestion__primary").filter({ hasText: designation });
    const chooseOffer = async (mode: "included" | "excluded") => {
      await expect(primary).toBeVisible();
      if (await primary.filter({ hasText: `FO534 ${mode}` }).isVisible()) await primary.click();
      else {
        await ui.browser.locator(".estimate-catalogue-suggestion__offers summary").click();
        await ui.browser.locator(".estimate-catalogue-suggestion__alternative").filter({ hasText: `FO534 ${mode}` }).click();
      }
    };
    await row.getByTestId("estimate-line-title-input").fill(designation);
    await chooseOffer("excluded");
    await expect(ui.screen.getByLabel(`Prix d’achat unitaire HT pour ${designation}`, { exact: true })).toHaveValue("90.00");
    await saveLineEditsWithShortcut(ui, draft.versionId, designation, ui.army);
    await expect.poll(async () => {
      const selected = (await readEstimate(ui.browser, draft.versionId)).items.find(item => item.id === rows[0].id);
      return [selected?.selected_supplier_price_id, selected?.supply_type_id, selected?.fo_provision, selected?.unit_price_ht_cents];
    }).toEqual([offers[1].id, tube, 1.03, 9000]);
    await expect(ui.browser.locator(`[data-estimate-item-id="${rows[0].id}"] [data-estimate-column="fo_provision"]`)).toHaveText("1,03");
    await row.getByTestId("estimate-line-title-input").click();
    await chooseOffer("included");
    await saveLineEditsWithShortcut(ui, draft.versionId, designation, ui.army);
    await expect.poll(async () => {
      const selected = (await readEstimate(ui.browser, draft.versionId)).items.find(item => item.id === rows[0].id);
      return [selected?.selected_supplier_price_id, selected?.fo_provision, selected?.unit_price_ht_cents];
    }).toEqual([offers[0].id, 1.01, 10000]);
    await expect(ui.browser.locator(`[data-estimate-item-id="${rows[0].id}"] [data-estimate-column="fo_provision"]`)).toHaveText("1,01");
    await saveSettled(ui);
    await ui.browser.reload();
    await waitForDraftLease(ui);
    expect((await readEstimate(ui.browser, draft.versionId)).items.find(row => row.id === rows[0].id)?.fo_provision).toBe(1.01);
    // Real race: load the suggestion, then change the offer before selecting it.
    await row.getByTestId("estimate-line-title-input").click();
    await expect(primary).toBeVisible();
    const latestOffers = await connectedApi<{ items: Array<{ id: string; updated_at: string }> }>(ui, "GET",
      `/api/prices?view=page&product_id=${product.id}&size=25`);
    const latestIncluded = latestOffers.items.find(offer => offer.id === offers[0].id)!;
    await connectedApi(ui, "POST", "/api/catalogue/reference-price", {
      action: "set-transport", product_id: product.id, offer_id: offers[0].id, transport_mode: "excluded",
      expected_updated_at: latestIncluded.updated_at,
    });
    await chooseOffer("included");
    await saveLineEditsWithShortcut(ui, draft.versionId, designation, ui.army);
    await expect.poll(async () => {
      const selected = (await readEstimate(ui.browser, draft.versionId)).items.find(item => item.id === rows[0].id);
      return [selected?.fo_provision, (selected?.fo_price_origin as { transport_mode?: string } | null)?.transport_mode];
    }).toEqual([1.03, "excluded"]);
    await expect(ui.browser.locator(`[data-estimate-item-id="${rows[0].id}"] [data-estimate-column="fo_provision"]`)).toHaveText("1,03");
    await expect(ui.browser.locator(`[data-estimate-item-id="${rows[0].id}"] [data-estimate-column="fo_provision"]`))
      .toHaveAttribute("title", /Transport FO : Hors transport/);

    // The article picker is also an explicit refresh of the same source and price.
    const refreshOffers = await connectedApi<{ items: Array<{ id: string; updated_at: string }> }>(ui, "GET",
      `/api/prices?view=page&product_id=${product.id}&size=25`);
    await connectedApi(ui, "POST", "/api/catalogue/reference-price", {
      action: "set-transport", product_id: product.id, offer_id: offers[0].id, transport_mode: "included",
      expected_updated_at: refreshOffers.items.find(offer => offer.id === offers[0].id)!.updated_at,
    });
    await ui.screen.getByRole("button", `Plus d'actions pour ${designation}`, { exact: true }).click();
    await ui.screen.getByRole("menuitem", "Associer ou remplacer l’article", { exact: true }).click();
    await ui.screen.getByLabel("Rechercher dans le catalogue", { exact: true }).fill(designation);
    await ui.browser.locator('[role="dialog"] button').filter({ hasText: designation }).click();
    await ui.screen.getByLabel(`Prix d’achat unitaire HT pour ${designation}`, { exact: true }).press("ControlOrMeta+s");
    await expect.poll(async () => {
      const selected = (await readEstimate(ui.browser, draft.versionId)).items.find(item => item.id === rows[0].id);
      return [selected?.fo_provision, (selected?.fo_price_origin as { transport_mode?: string } | null)?.transport_mode];
    }).toEqual([1.01, "included"]);

    await saveSettled(ui);
    await ui.app.open("/dashboard/affaires");
    await lockVersion(ui.browser, draft.versionId);
    const before = await readEstimate(ui.browser, draft.versionId);
    const update = await apiRequest(ui.browser, "POST", `/api/estimates/${draft.versionId}/batch`, {
      operation_key: randomUUID(), operations: [{ op: "update", id: rows[0].id, data: { unit_price_ht_cents: 20000 } }],
    }, { "if-match": before.version.updated_at });
    expect(update.status).toBe(200);
    const after = (await readEstimate(ui.browser, draft.versionId)).items.find(row => row.id === rows[0].id)!;
    expect(after).toMatchObject({ product_id: product.id, fo_provision: 1.03, fo_price_origin: null, unit_price_ht_cents: 20000,
      h_mo_per_unit: 0.5, pu_ht_cents: 29180, line_total_ht_cents: 291800 });
    const duplicated = await apiRequest(ui.browser, "POST", `/api/estimates/${draft.versionId}/sections/${draft.sectionId}/duplicate`, {});
    expect(duplicated.status).toBe(201);
    const manualCopies = (await readEstimate(ui.browser, draft.versionId)).items.filter(item => item.item_type === "line" && item.title === after.title);
    expect(manualCopies).toHaveLength(2);
    expect(manualCopies.map(item => [item.unit_price_ht_cents, item.fo_provision, item.fo_price_origin]))
      .toEqual([[20000, 1.03, null], [20000, 1.03, null]]);
    await releaseVersion(ui.browser, draft.versionId);
    await recordEvidence(ui.army, "fo534-manual-origin-cleared", { after, manualCopies });
  });

armyTest("FO53402 reference transport, exact insulation family, exports and section copies retain the saved price origin", options,
  async (ui) => {
    const draft = await prepareV3Draft(ui, ui.army, "FO534REF");
    await querySql(`insert into public.supply_types(tenant_id,code,name,default_fo_provision) values
      ('${draft.owner.tenantId}','calorifuge','Calorifuge',1.030),
      ('${draft.owner.tenantId}','isolant','Isolant',1.030);`);
    const designation = `${ui.army.runPrefix} isolant FO534`;
    const product = (await connectedApi<{ item: { id: string } }>(ui, "POST", "/api/products", {
      action: "create", item: { designation, product_type: "Isolant", unit: "u", unit_price_cents: 10000 },
    })).item;
    const validate = async (transport_mode: "included" | "excluded") => {
      const { proposal } = await connectedApi<{ proposal: { fingerprint: string } }>(ui, "GET",
        `/api/catalogue/reference-price?product_id=${product.id}&quantity=1&transport_mode=${transport_mode}`);
      await connectedApi(ui, "POST", "/api/catalogue/reference-price", {
        action: "validate", product_id: product.id, quantity: 1, transport_mode, fingerprint: proposal.fingerprint,
        manual_price_cents: 10000, justification: "ARMY reference FO534 sans offre fournisseur",
      });
    };
    await validate("included");
    const details = await connectedApi<{ supply_types: Array<{ id: string; code: string }> }>(ui, "GET", `/api/estimates/${draft.versionId}`);
    const isolant = details.supply_types.find(type => type.code === "isolant")!.id;
    const [blank] = await seedLines(ui, ui.army, draft, "reference", [{ title: `${ui.army.runPrefix} nouvelle fourniture`,
      unit_code: "u", quantity: 10, pricing_status: "priced", unit_price_ht_cents: 0, h_mo_per_unit: 0, k_fo: 1, k_mo: 1 }]);
    await ui.app.open(`/dashboard/estimates/${draft.versionId}/edit`);
    await waitForDraftLease(ui);
    await ui.browser.locator(`[data-estimate-item-id="${blank.id}"]`).getByTestId("estimate-line-title-input").fill(designation);
    await ui.browser.locator(".estimate-catalogue-suggestion__primary").filter({ hasText: designation }).click();
    await saveLineEditsWithShortcut(ui, draft.versionId, designation, ui.army);
    await expect.poll(async () => {
      const line = (await readEstimate(ui.browser, draft.versionId)).items.find(item => item.id === blank.id);
      return [line?.supply_type_id, line?.fo_provision, line?.unit_price_ht_cents, line?.pu_ht_cents, line?.line_total_ht_cents];
    }).toEqual([isolant, 1.01, 10000, 13130, 131300]);
    const saved = (await readEstimate(ui.browser, draft.versionId)).items.find(item => item.id === blank.id)!;
    expect(saved.fo_price_origin).toMatchObject({ kind: "reference", source_id: product.id, transport_mode: "included" });
    const csv = await ui.browser.evaluate(async versionId => {
      const response = await fetch(`/api/estimates/${versionId}/export?format=csv`, { credentials: "same-origin" });
      return { status: response.status, text: await response.text() };
    }, draft.versionId);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain("Transport FO");
    expect(csv.text).toContain("Inclus");
    await validate("excluded");
    await ui.browser.reload();
    await waitForDraftLease(ui);
    const reopened = (await readEstimate(ui.browser, draft.versionId)).items.find(item => item.id === blank.id)!;
    expect([reopened.fo_price_origin, reopened.fo_provision, reopened.unit_price_ht_cents])
      .toEqual([saved.fo_price_origin, 1.01, 10000]);
    // An ordinary quantity edit keeps the saved included transport, although
    // the catalogue now says excluded; only a new explicit price pick refreshes it.
    await ui.screen.getByLabel(`Quantité pour ${designation}`, { exact: true }).fill("20");
    await ui.browser.keyboard.press("Tab");
    await saveLineEditsWithShortcut(ui, draft.versionId, designation, ui.army);
    await expect.poll(async () => {
      const line = (await readEstimate(ui.browser, draft.versionId)).items.find(item => item.id === blank.id);
      return [line?.quantity, line?.fo_price_origin, line?.fo_provision, line?.pu_ht_cents, line?.line_total_ht_cents];
    }).toEqual([20, saved.fo_price_origin, 1.01, 13130, 262600]);
    await saveSettled(ui);
    await ui.app.open("/dashboard/affaires");
    await lockVersion(ui.browser, draft.versionId);
    const duplicate = await apiRequest(ui.browser, "POST", `/api/estimates/${draft.versionId}/sections/${draft.sectionId}/duplicate`, {});
    expect(duplicate.status).toBe(201);
    const copied = (await readEstimate(ui.browser, draft.versionId)).items.filter(item => item.item_type === "line" && item.title === designation);
    expect(copied).toHaveLength(2);
    expect(copied.map(item => [item.fo_provision, item.fo_price_origin])).toEqual(copied.map(() => [1.01, saved.fo_price_origin]));
    await releaseVersion(ui.browser, draft.versionId);
    await recordEvidence(ui.army, "fo534-reference-snapshot-copy", { product, saved, reopened, copied, csv });
  });
