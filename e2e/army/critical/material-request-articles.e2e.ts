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
  id: string; position: number; original_text: string | null; unit: string | null; dimension: string | null;
  product_type: string | null; reference: string | null; material: string | null; status: "draft" | "validated";
  product_id: string | null; product_match: string | null;
};
type Article = { id: string; designation: string; catalogue_status: "draft" | "validated"; created_from_material_request: boolean };
type Detail = { request: { id: string }; lines: Line[]; articles: Record<string, Article> };
type Candidate = { article: { id: string }; via: "reference" | "alias" | "ranked"; warnings: string[] };
type Product = { id: string };

// TI-690, delivery 3. Failure modes, written before the journey was first run against the product:
// - a line is linked without the office's gesture, or the bulk link takes a proposal that only resembles;
// - the technician's reference does not bring its article first, or brings an article of another size;
// - once linked, the line keeps the technician's wording instead of the catalogue's, or loses his words;
// - the usual name is not learned, so the same words are not recognised on the next request;
// - (TI-691, the owner's walk of 2026-11-14) a usual name is learned without the office choosing it: the bulk
//   link taught the technician's word to the whole tenant, silently, at its first use;
// - an article missing from the catalogue cannot be created from the line, is created validated, or
//   is not marked new in the catalogue;
// - unlinking a validated line leaves it validated although it no longer says what was validated, or
//   keeps the article's wording, so the next proposals and usual names start from the wrong words.
armyTest(
  "MR02 request lines are linked to catalogue articles by the office, and a usual name is learned only when the office retains it",
  { session: "army", tags: ["critical", "material-requests"], timeout: 300_000 },
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const ids = await createEstimateViaWizard(ui, {
      projectName: army.projectName,
      title: `${army.runPrefix} rattachement aux articles`,
    }, army);
    ownEstimate(army, ids);
    const base = `/api/affaires/${ids.projectId}/material-requests`;

    // An invented catalogue: a threaded rod with its reference, a copper elbow in two sizes.
    const supplyType = await apiRequest<Envelope<{ item: { id: string; name: string } }>>(
      browser, "POST", "/api/catalogue/supply-types", { name: `${army.runPrefix} quincaillerie` },
    );
    expect(supplyType.status).toBe(201);
    const supplyTypeId = supplyType.body.data.item.id;
    const reference = `${army.runPrefix}-TF12`;
    const product = async (item: Record<string, unknown>) => {
      const response = await apiRequest<Envelope<{ item: Product }>>(browser, "POST", "/api/products", {
        action: "create",
        item: { unit: "u", unit_price_cents: 100, supply_type_id: supplyTypeId, catalogue_status: "validated", ...item },
      });
      expect(response.status).toBe(201);
      return response.body.data.item.id;
    };
    const rod = await product({
      designation: `${army.runPrefix} Tige filetée M12 x 1 m`, reference,
      product_type: "Tige filetée", material: "Acier zingué", dimensions: "M12",
    });
    const elbow28 = await product({
      designation: `${army.runPrefix} Coude 90° cuivre Ø28`, reference: null,
      product_type: "Coude 90° à souder", material: "Cuivre", dimensions: "Ø28",
    });
    const elbow22 = await product({
      designation: `${army.runPrefix} Coude 90° cuivre Ø22`, reference: null,
      product_type: "Coude 90° à souder", material: "Cuivre", dimensions: "Ø22",
    });

    const created = await apiRequest<Envelope<Detail>>(browser, "POST", base, { source_text: "Demande inventée" });
    expect(created.status).toBe(201);
    const requestId = created.body.data.request.id;
    const one = `${base}/${requestId}`;
    const added = await apiRequest<Envelope<{ lines: Line[] }>>(browser, "POST", `${one}/lines`, {
      lines: [
        { original_text: "goujon M12 ref TF12", quantity: 20, unit: "u", product_type: "goujon", dimension: "M12", reference },
        { original_text: "coude cuivre 28", quantity: 10, unit: "u", product_type: "coude 90", dimension: "28", material: "Cuivre" },
        { original_text: "bouchon laiton 3/4", quantity: 4, unit: "u", product_type: "bouchon mâle", dimension: "20/27", material: "Laiton" },
      ],
    });
    expect(added.status).toBe(201);
    const read = async () => {
      const response = await apiRequest<Envelope<Detail>>(browser, "GET", one);
      expect(response.status).toBe(200);
      return response.body.data;
    };
    const line = async (position: number) => (await read()).lines.find((entry) => entry.position === position)!;

    // Proposals only: the reference brings its article first, the elbow its own size, the plug nothing.
    const proposals = await apiRequest<Envelope<{ lines: Record<string, Candidate[]> }>>(browser, "GET", `${one}/candidates`);
    expect(proposals.status).toBe(200);
    const byPosition = Object.fromEntries(
      added.body.data.lines.map((entry) => [entry.position, proposals.body.data.lines[entry.id] ?? []]),
    );
    expect(byPosition[1].map((candidate) => [candidate.article.id, candidate.via, candidate.warnings])).toEqual([[rod, "reference", []]]);
    expect(byPosition[2].map((candidate) => candidate.article.id)).toEqual([elbow28]);
    expect(byPosition[2][0].via).toBe("ranked");
    expect(byPosition[2].map((candidate) => candidate.article.id)).not.toContain(elbow22);
    expect(byPosition[3]).toEqual([]);
    expect((await read()).lines.map((entry) => entry.product_id)).toEqual([null, null, null]);

    // The bulk link takes the reference only; the resemblance waits for the office's own click.
    await browser.goto(`/dashboard/affaires/${ids.projectId}/demandes-materiel/${requestId}`, { waitUntil: "domcontentloaded" });
    const bulk = screen.getByRole("button", "Rattacher les références et noms connus (1)", { exact: true });
    await expect(bulk).toBeVisible({ timeout: 60_000 });
    await bulk.tap();
    await expect.poll(async () => (await line(1)).product_id, { timeout: 30_000 }).toBe(rod);
    const rodLine = await line(1);
    expect([rodLine.product_match, rodLine.product_type, rodLine.material, rodLine.dimension, rodLine.original_text, rodLine.reference])
      .toEqual(["reference", "Tige filetée", "Acier zingué", "M12", "goujon M12 ref TF12", reference]);
    expect((await line(2)).product_id).toBeNull();
    // The bulk link teaches nothing: the technician's « goujon » is not a name of the rod for the whole tenant.
    const untaught = await apiRequest<Envelope<{ items: Array<{ alias: string }> }>>(browser, "GET", `/api/products/${rod}/aliases`);
    expect(untaught.body.data.items).toEqual([]);
    await expect(screen.getByText(/^Nom usuel mémorisé :/)).toHaveCount(0);

    // The office retains the technician's words for the elbow, by a choice it checks at the link.
    const retain = screen.getByLabel("Mémoriser « coude 90 » comme nom usuel, ligne 2", { exact: true });
    await expect(retain).not.toBeChecked();
    await retain.check();
    await screen.getByRole("button", "Rattacher l’article proposé à la ligne 2", { exact: true }).tap();
    await expect.poll(async () => (await line(2)).product_id, { timeout: 30_000 }).toBe(elbow28);
    expect((await line(2)).product_match).toBe("ranked");
    await expect(screen.getByText("Nom usuel mémorisé : « coude 90 »", { exact: true })).toBeVisible({ timeout: 15_000 });

    // The plug is not in the catalogue: the office creates it from the line, as a draft marked new.
    await screen.getByRole("button", "Chercher ou créer l’article, ligne 3", { exact: true }).tap();
    await screen.getByRole("button", "Créer l’article", { exact: true }).last().tap();
    await expect(screen.getByLabel("Type d’article *", { exact: true })).toHaveValue("bouchon mâle", { timeout: 15_000 });
    await screen.getByLabel("Type de fourniture *", { exact: true }).selectOption({ value: supplyTypeId });
    await screen.getByRole("button", "Créer et rattacher", { exact: true }).tap();
    await expect.poll(async () => (await line(3)).product_match, { timeout: 30_000 }).toBe("created");
    const detail = await read();
    const plugId = detail.lines[2].product_id!;
    expect(detail.articles[plugId]).toMatchObject({ catalogue_status: "draft", created_from_material_request: true });

    await browser.goto(`/dashboard/products?q=${encodeURIComponent("bouchon mâle")}&catalogue_status=draft`, { waitUntil: "domcontentloaded" });
    await expect(screen.getByText("Nouveau", { exact: true }).first()).toBeVisible({ timeout: 30_000 });

    // The usual name retained is learned on its article only: the same words are recognised on the next request,
    // and the words the office did not retain are not.
    const aliases = await apiRequest<Envelope<{ items: Array<{ alias: string }> }>>(browser, "GET", `/api/products/${elbow28}/aliases`);
    expect(aliases.status).toBe(200);
    expect(aliases.body.data.items.map((item) => item.alias)).toEqual(["coude 90"]);
    const rodAliases = await apiRequest<Envelope<{ items: Array<{ alias: string }> }>>(browser, "GET", `/api/products/${rod}/aliases`);
    expect(rodAliases.body.data.items).toEqual([]);
    const next = await apiRequest<Envelope<Detail>>(browser, "POST", base, { source_text: "Deuxième demande inventée" });
    const nextAdded = await apiRequest<Envelope<{ lines: Line[] }>>(browser, "POST", `${base}/${next.body.data.request.id}/lines`, {
      lines: [
        { original_text: "coudes cuivre 28", quantity: 5, unit: "u", product_type: "coude 90", dimension: "28", material: "Cuivre" },
        { original_text: "goujons M12", quantity: 5, unit: "u", product_type: "goujon", dimension: "M12" },
      ],
    });
    expect(nextAdded.status).toBe(201);
    const nextProposals = await apiRequest<Envelope<{ lines: Record<string, Candidate[]> }>>(
      browser, "GET", `${base}/${next.body.data.request.id}/candidates`,
    );
    const [learned] = nextProposals.body.data.lines[nextAdded.body.data.lines[0].id];
    expect([learned.article.id, learned.via]).toEqual([elbow28, "alias"]);
    expect((nextProposals.body.data.lines[nextAdded.body.data.lines[1].id] ?? []).map((candidate) => candidate.via)).not.toContain("alias");

    // Unlinking a validated line returns it to draft, with the technician's words again.
    const validated = await apiRequest<Envelope<unknown>>(browser, "POST", `${one}/lines/validate`, { ids: [rodLine.id] });
    expect(validated.status).toBe(200);
    expect((await line(1)).status).toBe("validated");
    const unlinked = await apiRequest<Envelope<{ line: Line }>>(browser, "DELETE", `${one}/lines/${rodLine.id}/article`);
    expect(unlinked.status).toBe(200);
    const back = unlinked.body.data.line;
    expect([back.product_id, back.product_match, back.status, back.product_type, back.material, back.dimension, back.reference])
      .toEqual([null, null, "draft", "goujon", null, "M12", reference]);

    await recordEvidence(army, "material-request-articles", {
      ...ids, requestId, rod, elbow28, plugId, proposals: byPosition, learned,
    });
  },
);
