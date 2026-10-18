import { expect } from "e2e";

import { apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence, type ArmyItem } from "../critical/fixtures";
import { expectStoredTotalsMatchLines } from "../critical/version-totals-support";
import { ownedEstimateContext } from "./calculation-gate-support";
import { assertOwnedLocalBackend, createdData, insertLegacyV1Draft, setUiMode, type Envelope } from "./legacy-v1-draft-support";

// Stored version totals after a supplier preselection on a legacy V1 draft, in a suite a CI
// workflow runs (docs/testing/version-totals-after-preselection.md, T2). OZ04 asserts the same
// path in the calc-v3 "offers" phase, which no workflow runs; the critical P1 journey is the V2
// guard. The public creation schema only makes V2 drafts, so the V1 draft is inserted in SQL by
// the native owner of the owned stack, as engine-v3-fail-closed does for v3. The preselection is
// in Expert mode only: the journey switches the shared account's profile and restores it. For that
// reason it belongs to the nightly full selection (one worker), not to the critical CI selection
// (two workers, files in parallel), whose Expert journeys run as dedicated owners
// (bulk-edit-sync-sources, dedicated-owner.ts).
const options = { session: "army", tags: ["critical", "local", "version-totals"], timeout: 240_000 } as const;

// Fixed margin x1, 20 % VAT, no discount, no rounding: 3 u at 10,00 € (seeded, consistent),
// then at the 12,34 € offer: 37,02 € HT, 7,40 € VAT (740,4 c rounded), 44,42 € TTC.
const SEEDED: [number, number, number] = [3000, 600, 3600];
const EXPECTED: [number, number, number] = [3702, 740, 4442];

armyTest("V1PT01 a supplier preselection on a legacy V1 draft stores the version totals with its lines", options,
  async ({ app, screen, browser, army }) => {
    assertOwnedLocalBackend();
    await app.open("/dashboard/affaires");
    // An owned project made by the ordinary creation path; its V2 draft stays version 1.
    const created = await createdData(await apiRequest<Envelope<{ project: { id: string }; version: { id: string } }>>(
      browser, "POST", "/api/estimates", {
        project: { name: army.projectName },
        version: {
          title: `${army.runPrefix} v2 anchor`, margin_mode: "fixed", margin_multiplier: 1, margin_bp: 0, tax_rate_bp: 2000,
          rounding_mode: "none", rounding_step_cents: 1, max_section_depth: 1, currency: "EUR",
        },
      }));
    const projectId = created.project.id;
    ownEstimate(army, { projectId, versionId: created.version.id });
    const owner = await ownedEstimateContext(projectId);

    const designation = `${army.runPrefix} V1 article`;
    const product = (await createdData(await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/products", {
      action: "create", item: { designation, reference: null, unit: "u", unit_price_cents: 1000 },
    }))).item;
    const supplier = (await createdData(await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/suppliers", {
      action: "create", item: { name: `${army.runPrefix} V1 fournisseur`, is_active: true },
    }))).item;
    const offer = (await createdData(await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/prices", {
      action: "create", item: {
        supplier_id: supplier.id, product_id: product.id, supplier_sku: `${army.runPrefix}-V1`, unit: "u",
        min_quantity: 1, unit_price_cents: 1234, currency: "EUR", valid_from: new Date().toISOString().slice(0, 10),
      },
    }))).item;
    const draft = await insertLegacyV1Draft({ projectId, tenantId: owner.tenantId, userId: owner.userId }, {
      title: designation, description: "u", productId: product.id, lineNature: "supply_only",
      quantity: 3, unitPriceCents: 1000, hMo: 0, laborRoleId: null, puHtCents: 1000,
    }, SEEDED);
    const estimate = { projectId, versionId: draft.versionId };
    ownEstimate(army, estimate);
    // Only the two read-only catalogue lookups of this owned project are allowed.
    army.ownedPriceLookupProjects = [projectId];

    const before = await readEstimate(browser, draft.versionId);
    const lineOf = (items: ArmyItem[]) => items.find((item) => item.id === draft.lineId);
    await recordEvidence(army, "v1-preselection-fixtures", {
      ...draft, anchorVersionId: created.version.id, productId: product.id, supplierId: supplier.id, offerId: offer.id,
      insertedBy: "postgres (owned native stack)", referenceCents: 1000, offerCents: 1234, quantity: 3, seeded: SEEDED,
      before: {
        engine: before.version.calc_engine_version ?? null, versionNumber: before.version.version_number ?? null,
        totals: [before.version.total_ht_cents, before.version.total_tax_cents, before.version.total_ttc_cents],
        line: lineOf(before.items) ?? null,
      },
    });
    expect(before.version.calc_engine_version, "legacy V1 draft").toBe(1);
    expect([before.version.total_ht_cents, before.version.total_tax_cents, before.version.total_ttc_cents]).toEqual(SEEDED);
    expect(lineOf(before.items)).toMatchObject({ product_id: product.id, unit_price_ht_cents: 1000, line_total_ht_cents: SEEDED[0] });

    const initialMode = await setUiMode(owner.userId, "expert");
    try {
      await app.open(`/dashboard/estimates/${draft.versionId}/edit`);
      await expect(screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
      const price = screen.getByLabel(`Prix d’achat unitaire HT pour ${designation}`, { exact: true });
      await expect(price).toHaveValue("10.00");
      await screen.getByRole("tab", /^Affichage & contrôle(?: \d+)?$/).click();
      await screen.getByTestId("estimate-editor-display-button", { visible: true }).click();
      const preselect = screen.getByTestId("estimate-editor-supplier-preselection-button");
      await expect(preselect).toBeEnabled({ timeout: 30_000 });
      await preselect.click();
      const dialog = screen.getByRole("dialog", /Présélection fournisseurs/);
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Sélectionner toutes les présélections fournisseurs", { exact: true }).check();
      await dialog.getByRole("button", "Appliquer la sélection", { exact: true }).click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      // The line and the version totals are written by one call: once the line is read back on
      // the offer, the totals are read once, without waiting for any later save.
      await expect.poll(async () => {
        const item = lineOf((await readEstimate(browser, draft.versionId)).items);
        return { price: item?.unit_price_ht_cents, selected: item?.selected_supplier_price_id ?? null };
      }, { timeout: 30_000, interval: 500 }).toEqual({ price: 1234, selected: offer.id });
      await expect(price).toHaveValue("12.34");
      await expectStoredTotalsMatchLines({ app, screen, browser }, army, {
        estimate, projectName: army.projectName, step: "v1-preselection", expected: EXPECTED,
      });
    } finally {
      const restoredFrom = await setUiMode(owner.userId, initialMode);
      await recordEvidence(army, "v1-preselection-restored", { initialMode, restoredFrom });
    }
  });
