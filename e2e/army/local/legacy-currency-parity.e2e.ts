import { expect } from "e2e";

import {
  apiRequest, armyTest, createEstimateViaWizard, createLineViaApi, readEstimate,
  recordEvidence, saveLineEditsWithShortcut, setLineCoreValues, waitForAutoSave,
} from "../critical/fixtures";
import { signUpDedicatedOwner } from "./dedicated-owner";
import { switchToExpertMode, waitForDraftLease } from "./engine-v3-editor-support";

const options = { session: "army", tags: ["critical", "local", "legacy-currency"], timeout: 300_000 } as const;
type Rate = { id: string; from_currency: string; to_currency: string; rate: number;
  effective_date: string; source: string; is_active: boolean };
type Envelope<T> = { ok: boolean; data: T };

// EST-027 gaps beyond DES02's synthetic list and V3X02's workbook formats:
// real admin CRUD/filtering and settings -> persisted USD -> list -> print.
// Dedicated local tenants keep rate writes and the historical engine-2 policy
// out of the shared campaign account. No application response is substituted.
armyTest("LEGCUR01 admin creates edits deactivates filters and deletes the exact owned exchange rate", options,
  async ({ app, screen, browser, army }) => {
    await app.open("/dashboard/affaires");
    const owner = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "LCUR01" });
    await app.open("/dashboard/admin/currencies");
    await expect(screen.getByRole("heading", "Taux de change", { exact: true })).toBeVisible();
    const create = screen.getByRole("region", "Nouveau taux", { exact: true });
    await expect(create).toBeVisible();
    // The API accepts the existing source enum (manual/api), not arbitrary text.
    const source = "manual";
    const readRates = async (inactive = false) => {
      const response = await apiRequest<Envelope<{ tenant_id: string; items: Rate[] }>>(browser, "GET",
        `/api/currency-rates?from_currency=USD&to_currency=GBP${inactive ? "&include_inactive=true" : ""}`);
      expect(response.status).toBe(200);
      expect(response.body.ok).toBe(true);
      expect(response.body.data.tenant_id).toBe(owner.tenantId);
      return response.body.data.items;
    };
    expect(await readRates(true)).toEqual([]);
    await create.getByLabel("Devise source", { exact: true }).fill("USD");
    await create.getByLabel("Devise cible", { exact: true }).fill("GBP");
    await create.getByLabel("Date d'effet", { exact: true }).fill("2099-12-31");
    await create.getByLabel("Source", { exact: true }).fill(source);
    await create.getByLabel("Taux", { exact: true }).fill("0");
    await create.getByRole("button", "Créer", { exact: true }).click();
    await expect(screen.getByRole("alert").filter({ hasText: "Le taux doit être un nombre positif." }))
      .toHaveText("Le taux doit être un nombre positif.");
    expect(await readRates(true)).toEqual([]);
    await create.getByLabel("Taux", { exact: true }).fill("1.1234");
    const creation = browser.waitForResponse("**/api/currency-rates");
    await create.getByRole("button", "Créer", { exact: true }).click();
    const createdResponse = await creation;
    expect(createdResponse.status).toBe(201);
    const createdBody = await createdResponse.json<Envelope<{ currency_rate: Rate }>>();
    expect(createdBody.ok).toBe(true);
    const created = createdBody.data.currency_rate;
    expect(created).toMatchObject({ from_currency: "USD", to_currency: "GBP", rate: 1.1234,
      effective_date: "2099-12-31", source, is_active: true });
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(screen.getByRole("status").filter({ hasText: "Taux USD/GBP créé." })).toBeVisible();
    expect((await readRates()).map(rate => rate.id)).toEqual([created.id]);

    const row = screen.getByRole("row").filter({ has: screen.getByLabel("Taux USD/GBP", { exact: true }) });
    await expect(row).toHaveCount(1);
    await row.getByLabel("Taux USD/GBP", { exact: true }).fill("1.2345");
    await row.getByRole("checkbox", "Actif", { exact: true }).uncheck();
    const updating = browser.waitForResponse(`**/api/currency-rates/${created.id}`);
    await row.getByRole("button", "Enregistrer", { exact: true }).click();
    const updateResponse = await updating;
    expect(updateResponse.status).toBe(200);
    expect((await updateResponse.json<Envelope<{ currency_rate: Rate }>>()).data.currency_rate)
      .toMatchObject({ id: created.id, rate: 1.2345, source, is_active: false });
    await expect(screen.getByRole("status").filter({ hasText: "Taux USD/GBP mis à jour." })).toBeVisible();
    await expect(row).toHaveCount(0);
    expect(await readRates()).toEqual([]);
    await screen.getByRole("checkbox", "Inclure inactifs", { exact: true }).check();
    await expect(row).toHaveCount(1);
    await expect(row.getByLabel("Taux USD/GBP", { exact: true })).toHaveValue("1.2345");
    await expect(row.getByRole("checkbox", "Inactif", { exact: true })).not.toBeChecked();
    const deactivated = await readRates(true);
    expect(deactivated).toHaveLength(1);
    expect(deactivated[0]).toMatchObject({ id: created.id, rate: 1.2345, is_active: false });
    await browser.reload();
    await expect(screen.getByRole("checkbox", "Inclure inactifs", { exact: true })).not.toBeChecked();
    await expect(row).toHaveCount(0);
    await screen.getByRole("checkbox", "Inclure inactifs", { exact: true }).check();
    await expect(row).toHaveCount(1);
    await row.getByRole("button", "Supprimer", { exact: true }).click();
    const confirmation = screen.getByRole("alertdialog", "Supprimer le taux USD/GBP ?", { exact: true });
    await expect(confirmation).toBeVisible();
    // Opening confirmation must not remove the persisted row.
    expect((await readRates(true)).map(rate => rate.id)).toEqual([created.id]);
    const deletion = browser.waitForResponse(`**/api/currency-rates/${created.id}`);
    await confirmation.getByRole("button", "Supprimer", { exact: true }).click();
    expect((await deletion).status).toBe(200);
    await expect(confirmation).toBeHidden();
    await expect(screen.getByRole("status").filter({ hasText: "Taux USD/GBP supprimé." })).toBeVisible();
    await expect(row).toHaveCount(0);
    expect(await readRates(true)).toEqual([]);
    await recordEvidence(army, "legacy-currency-rate-crud", {
      tenantId: owner.tenantId, created, deactivated, finalRates: [],
      expected: { initial: 1.1234, updated: 1.2345, inactiveHidden: true, deletedId: created.id },
    });
  });

armyTest("LEGCUR02 USD settings and grouped decimal entry persist into the real estimate list and print", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    await app.open("/dashboard/affaires");
    const owner = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "LCUR02" });
    const projectName = `${army.runPrefix} USD`;
    const ids = await createEstimateViaWizard(ui, { projectName, title: `${army.runPrefix} prix USD` }, army);
    expect((await readEstimate(browser, ids.versionId)).version.calc_engine_version).toBe(2);
    await waitForDraftLease(ui);
    await screen.getByRole("tab", "Affichage & contrôle", { exact: true }).click();
    await screen.getByTestId("estimate-editor-display-button", { visible: true }).click();
    await screen.getByTestId("estimate-editor-settings-button", { visible: true }).click();
    const settings = screen.getByRole("dialog", "Paramétrage du devis", { exact: true });
    await expect(settings).toBeVisible();
    await settings.getByLabel("Devise", { exact: true }).selectOption({ value: "USD" });
    await settings.getByRole("button", "Enregistrer le paramétrage", { exact: true }).click();
    await expect.poll(async () => (await readEstimate(browser, ids.versionId)).version.currency).toBe("USD");
    await screen.getByTestId("estimate-editor-drawer-close-button").click();
    const title = `${army.runPrefix} ligne USD`;
    const line = await createLineViaApi(browser, ids.versionId, title, { description: "u", quantity: 1, unit_price_ht_cents: 1000 });
    await browser.reload();
    await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    await waitForDraftLease(ui);
    await setLineCoreValues(ui, title, { quantity: "1", unitPriceHt: "1,234.56" });
    await saveLineEditsWithShortcut(ui, ids.versionId, title, army);
    const saved = await waitForAutoSave(ui, ids.versionId, state => state.items.some(item =>
      item.id === line.id && item.quantity === 1 && item.unit_price_ht_cents === 123456), army);
    expect(saved.version.currency).toBe("USD");
    expect([saved.version.total_ht_cents, saved.version.total_tax_cents, saved.version.total_ttc_cents])
      .toEqual([123456, 24691, 148147]);
    // The old estimates list redirects to Affaires. Prove the user-visible
    // card first, then the expert table, using the same persisted USD amount.
    await app.open("/dashboard/estimates");
    await expect(browser).toHaveURL("/dashboard/affaires");
    await expect(screen.getByRole("heading", "Affaires", { exact: true })).toBeVisible();
    const card = screen.getByRole("list", "Affaires", { exact: true }).getByRole("listitem")
      .filter({ has: screen.getByRole("heading", projectName, { exact: true }) });
    await expect(card).toHaveCount(1);
    const cardText = await card.textContent();
    await recordEvidence(army, "legacy-currency-affaires-card", {
      ...ids, persistedCurrency: saved.version.currency, persistedHtCents: saved.version.total_ht_cents,
      expected: "$1,234.56 HT", actual: cardText,
    });
    await expect(card.getByText("$1,234.56 HT", { exact: true })).toBeVisible();
    await switchToExpertMode(ui);
    const dense = screen.getByRole("region", "Liste des affaires", { exact: true });
    const listRow = dense.getByRole("row").filter({ hasText: projectName });
    await expect(listRow).toHaveCount(1);
    const listText = await listRow.textContent();
    await recordEvidence(army, "legacy-currency-affaires-dense", {
      ...ids, persistedCurrency: saved.version.currency, persistedHtCents: saved.version.total_ht_cents,
      expected: "$1,234.56", actual: listText,
    });
    await expect(listRow.getByRole("cell", "$1,234.56", { exact: true })).toBeVisible();
    await app.open(`/dashboard/estimates/${ids.versionId}/print?price_mode=unit_and_total&detail_level=lines`);
    await expect(screen.getByRole("heading", "Devis", { exact: true })).toBeVisible();
    // The current preview renders the persisted currency directly in the
    // document; it has no currency selector. Assert the actual line and totals.
    await expect(screen.getByText(title, { exact: true })).toBeVisible();
    const printed = await browser.evaluate(() => {
      const clean = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();
      return {
        rows: Array.from(document.querySelectorAll('[aria-label="Lignes du devis"] tbody tr'))
          .map(row => Array.from(row.querySelectorAll("td")).map(cell => clean(cell.textContent))),
        footer: Array.from(document.querySelectorAll("span"))
          .filter(span => ["Total HT", "TVA", "Total TTC"].includes(clean(span.textContent)))
          .map(span => ({ label: clean(span.textContent), value: clean(span.parentElement?.children[1]?.textContent ?? null) })),
      };
    });
    expect(printed.rows.filter(row => row[0] === title)).toEqual([[title, "1", "u", "$1,234.56", "$1,234.56"]]);
    expect(printed.footer).toEqual([{ label: "Total HT", value: "$1,234.56" },
      { label: "TVA", value: "$246.91" }, { label: "Total TTC", value: "$1,481.47" }]);
    const reloaded = await readEstimate(browser, ids.versionId);
    expect(reloaded.items).toEqual(saved.items);
    expect(reloaded.version.currency).toBe("USD");
    await recordEvidence(army, "legacy-currency-usd-persisted-list-print", {
      ...ids, tenantId: owner.tenantId, input: "1,234.56", saved, reloaded, cardText, listText, printed,
      expected: { engine: 2, currency: "USD", priceCents: 123456, totals: [123456, 24691, 148147] },
    });
  });
