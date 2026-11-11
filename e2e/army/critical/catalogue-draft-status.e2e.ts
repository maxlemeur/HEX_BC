import { expect } from "e2e";

import {
  apiRequest,
  armyTest,
  createEstimateViaWizard,
  ownEstimate,
  recordEvidence,
} from "./fixtures";

type Envelope<T> = {
  ok: boolean;
  data: T;
  error?: { code: string; message: string; details?: { missing?: string[] } };
};
type Product = { id: string; designation: string; catalogue_status: "draft" | "validated"; supply_type_id: string | null };
type Suggestions = { suggestions: Array<{ product_id: string }> };
type CataloguePage = {
  items: Array<{ id: string; catalogue_status: string; supply_type_id: string | null; _supplyTypeName: string | null }>;
};
type Browser = Parameters<typeof apiRequest>[0];

// TI-690. Failure modes, written before the fix:
// - a draft article is suggested in the estimate editor by its designation;
// - a draft article is suggested through its supplier offer (SKU), a path that bypasses the product search;
// - an incomplete draft can be validated, or the refusal does not say what is missing;
// - validating from the catalogue screen loses the operator's entry or leaves the article a draft;
// - once validated, the article is still missing from the suggestions or still listed among the drafts.
async function suggestedProductIds(browser: Browser, versionId: string, query: string) {
  const response = await apiRequest<Envelope<Suggestions>>(
    browser, "GET", `/api/estimates/${versionId}/suggest-prices?q=${encodeURIComponent(query)}`,
  );
  expect(response.status).toBe(200);
  return response.body.data.suggestions.map((suggestion) => suggestion.product_id);
}

async function cataloguePage(browser: Browser, query: string, status: "draft" | "validated") {
  const response = await apiRequest<Envelope<CataloguePage>>(
    browser, "GET", `/api/catalogue?view=page&q=${encodeURIComponent(query)}&catalogue_status=${status}&size=25`,
  );
  expect(response.status).toBe(200);
  return response.body.data.items;
}

async function created<T>(response: { status: number; body: Envelope<T> }) {
  expect(response.status).toBe(201);
  expect(response.body.ok).toBe(true);
  return response.body.data;
}

armyTest(
  "CAT01 a draft article stays out of estimate suggestions until an administrator validates it",
  { session: "army", tags: ["critical", "catalogue"], timeout: 240_000 },
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const ids = await createEstimateViaWizard(ui, {
      projectName: army.projectName,
      title: `${army.runPrefix} brouillons du catalogue`,
    }, army);
    ownEstimate(army, ids);

    const draftDesignation = `${army.runPrefix} cheville brouillon`;
    const controlDesignation = `${army.runPrefix} cheville de contrôle`;
    const sku = `${army.runPrefix}-SKU`;
    const supplyTypeName = `${army.runPrefix} supportage`;

    const draft = (await created(await apiRequest<Envelope<{ item: Product }>>(browser, "POST", "/api/products", {
      action: "create",
      item: { designation: draftDesignation, reference: null, unit: "u", unit_price_cents: 0, catalogue_status: "draft" },
    }))).item;
    expect(draft.catalogue_status).toBe("draft");
    // A writer that sets no status keeps producing validated articles.
    const control = (await created(await apiRequest<Envelope<{ item: Product }>>(browser, "POST", "/api/products", {
      action: "create",
      item: { designation: controlDesignation, reference: null, unit: "u", unit_price_cents: 500 },
    }))).item;
    expect(control.catalogue_status).toBe("validated");

    const supplier = (await created(await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/suppliers", {
      action: "create", item: { name: `${army.runPrefix} fournisseur`, is_active: true },
    }))).item;
    await created(await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/prices", {
      action: "create",
      item: {
        supplier_id: supplier.id, product_id: draft.id, supplier_sku: sku, unit: "u",
        min_quantity: 1, unit_price_cents: 1234, currency: "EUR", valid_from: new Date().toISOString().slice(0, 10),
      },
    }));

    // By designation: the control article is suggested, the draft is not.
    const byDesignationBefore = await suggestedProductIds(browser, ids.versionId, army.runPrefix);
    expect(byDesignationBefore).toContain(control.id);
    expect(byDesignationBefore).not.toContain(draft.id);
    // By supplier SKU: the only article behind this SKU is the draft.
    expect(await suggestedProductIds(browser, ids.versionId, sku)).toEqual([]);
    // A deliberate search reaches the draft and says what it is.
    const deliberate = await apiRequest<Envelope<{
      suggestions: Array<{ product_id: string; product_catalogue_status?: string }>;
    }>>(browser, "GET",
      `/api/estimates/${ids.versionId}/suggest-prices?q=${encodeURIComponent(army.runPrefix)}&include_drafts=1`);
    expect(deliberate.status).toBe(200);
    expect(
      Object.fromEntries(deliberate.body.data.suggestions.map((entry) => [entry.product_id, entry.product_catalogue_status])),
    ).toEqual({ [draft.id]: "draft", [control.id]: "validated" });

    // An incomplete draft is refused, and the refusal names what is missing.
    const refused = await apiRequest<Envelope<never>>(browser, "POST", "/api/products", {
      action: "update", id: draft.id, item: { catalogue_status: "validated" },
    });
    expect(refused.status).toBe(422);
    expect(refused.body.error?.code).toBe("PRODUCT_VALIDATION_INCOMPLETE");
    expect(refused.body.error?.details?.missing).toEqual(["product_type", "material", "supply_type_id"]);
    expect(refused.body.error?.message).toBe(
      "Pour valider cet article, renseignez : le type d’article, la matière, le type de fourniture.",
    );
    expect((await cataloguePage(browser, army.runPrefix, "draft")).map((item) => item.id)).toEqual([draft.id]);

    const supplyType = (await created(await apiRequest<Envelope<{ item: { id: string; name: string } }>>(
      browser, "POST", "/api/catalogue/supply-types", { name: supplyTypeName },
    ))).item;
    for (const takenName of [supplyTypeName.toUpperCase(), `${supplyTypeName}s`]) {
      const duplicate = await apiRequest<Envelope<never>>(
        browser, "POST", "/api/catalogue/supply-types", { name: takenName },
      );
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error?.message).toBe(`Ce type de fourniture existe déjà : « ${supplyTypeName} ».`);
    }

    // The catalogue screen: the draft is marked, validating it opens the form on what is missing.
    await browser.goto(
      `/dashboard/products?q=${encodeURIComponent(army.runPrefix)}&catalogue_status=draft`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(screen.getByText(draftDesignation, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(screen.getByText("Brouillon", { exact: true }).first()).toBeVisible();
    await expect(screen.getByText(controlDesignation, { exact: true })).toHaveCount(0);

    await screen.getByRole("button", `Actions pour ${draftDesignation}`, { exact: true }).tap();
    await screen.getByRole("menuitem", "Valider", { exact: true }).tap();
    await expect(
      screen.getByText("Pour valider cet article, renseignez : le type d’article, la matière, le type de fourniture.", { exact: true }).first(),
    ).toBeVisible({ timeout: 15_000 });

    const completeAndValidate = screen.getByRole("button", "Enregistrer et valider", { exact: true });
    await expect(completeAndValidate).toBeDisabled({ timeout: 15_000 });
    await screen.getByLabel("Matière", { exact: true }).fill("Supportage");
    await screen.getByLabel("Type d’article", { exact: true }).fill("Cheville mécanique");
    await screen.getByLabel("Type de fourniture", { exact: true }).selectOption({ value: supplyType.id });
    await expect(completeAndValidate).toBeEnabled();
    await completeAndValidate.tap();

    await expect.poll(
      async () => (await cataloguePage(browser, army.runPrefix, "validated")).find((item) => item.id === draft.id),
      { timeout: 30_000 },
    ).toMatchObject({ catalogue_status: "validated", supply_type_id: supplyType.id, _supplyTypeName: supplyTypeName });
    expect(await cataloguePage(browser, army.runPrefix, "draft")).toEqual([]);

    // Validated: suggested by designation and through its supplier offer.
    const byDesignationAfter = await suggestedProductIds(browser, ids.versionId, army.runPrefix);
    expect(byDesignationAfter).toContain(draft.id);
    expect(await suggestedProductIds(browser, ids.versionId, sku)).toEqual([draft.id]);

    await recordEvidence(army, "catalogue-draft-status", {
      ...ids, draftId: draft.id, controlId: control.id, supplyTypeId: supplyType.id,
      refused: refused.body.error, byDesignationBefore, byDesignationAfter,
    });
  },
);
