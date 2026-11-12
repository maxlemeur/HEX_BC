import { expect } from "e2e";

import {
  apiRequest,
  armyTest,
  createEstimateViaWizard,
  ownEstimate,
  recordEvidence,
} from "./fixtures";

type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type Line = {
  id: string; position: number; status: "draft" | "validated"; product_id: string | null; supplier_id: string | null;
};
type Detail = { request: { id: string }; lines: Line[] };
type Proposal = { supplier_id: string; supplier_name: string; reason: string; supplier_sku: string | null };
type SupplierItem = { supplier_id: string; supplier_sku: string | null; is_active: boolean; has_price: boolean };

// TI-691, lot 2 « l'achat », delivery 1. Failure modes, written before the journey was first run against the product:
// - a line with an article is proposed no supplier, or not in the owner's order: the supplier the technician named,
//   then the article's exception, then the supply type's preferred supplier (then the last purchase);
// - the proposal does not say why, or not the article's reference at that supplier;
// - the article's supplier and its reference cannot be recorded from its form without a price, or its exception is lost;
// - a supplier is set without the office's gesture, or the bulk gesture sets another one than proposed;
// - setting the supplier of a validated line returns it to draft.
// The last purchase is not exercised here: an order counts once confirmed or received, and that status is
// changed from the order screen through the database client, not an application API; the campaign guard also
// refuses status mutations. The ranking after the other three is covered by the server's own tests.
armyTest(
  "MR03 each request line is proposed its supplier in the owner's order, retained in one gesture, and stays validated",
  { session: "army", tags: ["critical", "material-requests"], timeout: 300_000 },
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const ids = await createEstimateViaWizard(ui, {
      projectName: army.projectName,
      title: `${army.runPrefix} fournisseurs des lignes`,
    }, army);
    ownEstimate(army, ids);
    const base = `/api/affaires/${ids.projectId}/material-requests`;

    // Invented suppliers: one named by the technician, one exception of an article, one preferred for a type.
    const supplier = async (name: string) => {
      const response = await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/suppliers", {
        action: "create", item: { name, is_active: true },
      });
      expect(response.status).toBe(201);
      return response.body.data.item.id;
    };
    const alphaName = `${army.runPrefix} Négoce Alpha`;
    const betaName = `${army.runPrefix} Comptoir Bêta`;
    const gammaName = `${army.runPrefix} Dépôt Gamma`;
    const alpha = await supplier(alphaName);
    const beta = await supplier(betaName);
    const gamma = await supplier(gammaName);

    const typeName = `${army.runPrefix} inox`;
    const supplyType = await apiRequest<Envelope<{ item: { id: string } }>>(
      browser, "POST", "/api/catalogue/supply-types", { name: typeName },
    );
    expect(supplyType.status).toBe(201);
    const supplyTypeId = supplyType.body.data.item.id;
    const preferredForType = await apiRequest<Envelope<unknown>>(
      browser, "PATCH", `/api/catalogue/supply-types/${supplyTypeId}`, { preferred_supplier_id: gamma },
    );
    expect(preferredForType.status).toBe(200);
    const types = await apiRequest<Envelope<{ items: Array<{ id: string; preferred_supplier_id: string | null }> }>>(
      browser, "GET", "/api/catalogue/supply-types",
    );
    expect(types.body.data.items.find((item) => item.id === supplyTypeId)?.preferred_supplier_id).toBe(gamma);

    const product = async (item: Record<string, unknown>) => {
      const response = await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/products", {
        action: "create",
        item: {
          unit: "u", unit_price_cents: 100, supply_type_id: supplyTypeId, catalogue_status: "validated",
          material: "Inox 316L", dimensions: "DN 50", ...item,
        },
      });
      expect(response.status).toBe(201);
      return response.body.data.item.id;
    };
    const elbowReference = `${army.runPrefix}-CD50`;
    const teeReference = `${army.runPrefix}-TE50`;
    const elbow = await product({ designation: `${army.runPrefix} Coude 90° inox DN 50`, reference: elbowReference, product_type: "Coude 90°" });
    const tee = await product({ designation: `${army.runPrefix} Té égal inox DN 50`, reference: teeReference, product_type: "Té égal" });

    // The elbow's supplier, its reference there without a price, and its exception: from the article form.
    const sku = `${army.runPrefix}-CB-9050`;
    await browser.goto(`/dashboard/products?product_id=${elbow}`, { waitUntil: "domcontentloaded" });
    await expect(screen.getByRole("heading", "Fournisseurs de l’article", { exact: true })).toBeVisible({ timeout: 60_000 });
    await screen.getByRole("button", "Ajouter un fournisseur", { exact: true }).tap();
    await screen.getByLabel("Fournisseur à ajouter", { exact: true }).selectOption({ value: beta });
    await screen.getByLabel("Référence chez ce fournisseur", { exact: true }).fill(sku);
    await screen.getByRole("button", "Ajouter ce fournisseur", { exact: true }).tap();
    await expect(screen.getByText(`Réf. ${sku}`, { exact: true })).toBeVisible({ timeout: 15_000 });
    await screen.getByLabel("Fournisseur privilégié pour cet article", { exact: true }).selectOption({ value: beta });
    await expect(screen.getByText("Fournisseur privilégié enregistré.", { exact: true })).toBeVisible({ timeout: 15_000 });
    const items = await apiRequest<Envelope<{ items: SupplierItem[] }>>(browser, "GET", `/api/products/${elbow}/supplier-items`);
    expect(items.status).toBe(200);
    expect(items.body.data.items.map((item) => [item.supplier_id, item.supplier_sku, item.is_active, item.has_price]))
      .toEqual([[beta, sku, true, false]]);

    // A request without a supplier named: the elbow, the tee, and a second tee for another zone, validated.
    const created = await apiRequest<Envelope<Detail>>(browser, "POST", base, { source_text: "Demande inventée" });
    expect(created.status).toBe(201);
    const requestId = created.body.data.request.id;
    const one = `${base}/${requestId}`;
    const added = await apiRequest<Envelope<{ lines: Line[] }>>(browser, "POST", `${one}/lines`, {
      lines: [
        { original_text: "10 coudes inox 50", quantity: 10, unit: "u", product_type: "Coude 90°", dimension: "DN 50", material: "Inox 316L", reference: elbowReference },
        { original_text: "4 tés inox 50", quantity: 4, unit: "u", product_type: "Té égal", dimension: "DN 50", material: "Inox 316L", reference: teeReference },
        { original_text: "2 tés inox 50 R+1", quantity: 2, unit: "u", product_type: "Té égal", dimension: "DN 50", material: "Inox 316L", reference: teeReference, zone: "R+1" },
      ],
    });
    expect(added.status).toBe(201);
    const read = async () => {
      const response = await apiRequest<Envelope<Detail>>(browser, "GET", one);
      expect(response.status).toBe(200);
      return response.body.data.lines;
    };

    await browser.goto(`/dashboard/affaires/${ids.projectId}/demandes-materiel/${requestId}`, { waitUntil: "domcontentloaded" });
    const link = screen.getByRole("button", "Rattacher les références et noms connus (3)", { exact: true });
    await expect(link).toBeVisible({ timeout: 60_000 });
    await link.tap();
    await expect.poll(async () => (await read()).map((line) => line.product_id), { timeout: 30_000 }).toEqual([elbow, tee, tee]);
    const thirdId = added.body.data.lines[2].id;
    const validated = await apiRequest<Envelope<unknown>>(browser, "POST", `${one}/lines/validate`, { ids: [thirdId] });
    expect(validated.status).toBe(200);

    // The article's exception wins over its type's supplier; a line whose article has none gets the type's.
    const proposals = await apiRequest<Envelope<{ lines: Record<string, Proposal | null> }>>(browser, "GET", `${one}/supplier-proposals`);
    expect(proposals.status).toBe(200);
    const byPosition = added.body.data.lines.map((line) => {
      const proposal = proposals.body.data.lines[line.id];
      return proposal ? [proposal.supplier_id, proposal.reason, proposal.supplier_sku] : null;
    });
    expect(byPosition).toEqual([[beta, "article", sku], [gamma, "supply_type", null], [gamma, "supply_type", null]]);
    expect((await read()).map((line) => line.supplier_id)).toEqual([null, null, null]);

    // The screen says why, and one gesture retains them all; the validated line stays validated.
    await browser.goto(`/dashboard/affaires/${ids.projectId}/demandes-materiel/${requestId}`, { waitUntil: "domcontentloaded" });
    await expect(screen.getByText(`${betaName} · exception de l’article`, { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(screen.getByText(`Réf. fournisseur : ${sku}`, { exact: true })).toBeVisible();
    await expect(screen.getByText(`${gammaName} · fournisseur du type ${typeName}`, { exact: true })).toHaveCount(2);
    await screen.getByRole("button", "Retenir les fournisseurs proposés (3)", { exact: true }).tap();
    await expect(screen.getByText("3 fournisseurs retenus.", { exact: true })).toBeVisible({ timeout: 30_000 });
    const retained = await read();
    expect(retained.map((line) => [line.supplier_id, line.status])).toEqual([
      [beta, "draft"], [gamma, "draft"], [gamma, "validated"],
    ]);
    await expect(screen.getByText(`Réf. fournisseur : ${sku}`, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(screen.getByRole("button", "Retenir les fournisseurs proposés (0)", { exact: true })).toBeDisabled();

    // A request whose header names a supplier: the technician's choice comes before the article's exception.
    const named = await apiRequest<Envelope<Detail>>(browser, "POST", base, {
      source_text: "Deuxième demande inventée", presumed_supplier_id: alpha,
    });
    expect(named.status).toBe(201);
    const namedId = named.body.data.request.id;
    const namedLines = await apiRequest<Envelope<{ lines: Line[] }>>(browser, "POST", `${base}/${namedId}/lines`, {
      lines: [{ original_text: "6 coudes inox 50", quantity: 6, unit: "u", product_type: "Coude 90°", dimension: "DN 50", material: "Inox 316L", reference: elbowReference }],
    });
    expect(namedLines.status).toBe(201);
    await browser.goto(`/dashboard/affaires/${ids.projectId}/demandes-materiel/${namedId}`, { waitUntil: "domcontentloaded" });
    const namedLink = screen.getByRole("button", "Rattacher les références et noms connus (1)", { exact: true });
    await expect(namedLink).toBeVisible({ timeout: 60_000 });
    await namedLink.tap();
    await expect(screen.getByText(`${alphaName} · nommé par le technicien`, { exact: true })).toBeVisible({ timeout: 30_000 });
    const namedProposals = await apiRequest<Envelope<{ lines: Record<string, Proposal | null> }>>(
      browser, "GET", `${base}/${namedId}/supplier-proposals`,
    );
    const namedLine = namedLines.body.data.lines[0].id;
    expect([namedProposals.body.data.lines[namedLine]?.supplier_id, namedProposals.body.data.lines[namedLine]?.reason])
      .toEqual([alpha, "technician"]);

    await recordEvidence(army, "material-request-suppliers", {
      ...ids, requestId, namedId, suppliers: { alpha, beta, gamma }, supplyTypeId, elbow, tee,
      proposals: byPosition, named: namedProposals.body.data.lines[namedLine],
    });
  },
);
