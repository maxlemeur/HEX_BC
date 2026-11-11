import { expect } from "e2e";

import { apiRequest, armyTest, readEstimate, recordEvidence, saveLineEditsWithShortcut } from "../critical/fixtures";
import { connectedApi } from "../extended/connected-support";
import { querySql } from "./calculation-gate-support";
import {
  fillCell, prepareV3Draft, seedLines, showStandardColumns, waitForDraftLease, type Envelope, type Ui,
} from "./engine-v3-editor-support";
import { generatePdf, pdfText, storedPdfBytes } from "./engine-v3-emission-support";

// TI-541. Observable failures this journey prevents:
//  - an offer negotiated for one job site can only be used by writing it into the catalogue, where it would move the
//    reference price and the offers of every other quote;
//  - a cost typed for the quote has no source, or loses it when the quote is reopened, copied or issued;
//  - the supplier of that cost leaks onto the customer's PDF;
//  - the user cannot read how the supply cost of a line is built, or a K FO change moves the labour or the catalogue.
// Expected amounts, written by hand before the first run (sale coefficients FO 1,30 and MO 1,20, tuyauteur 40 €/h):
//   tube seeded: 10.00 × K FO 1.13 × sale 1.30 + labour 24.00 = 38.69, total 386.90.
//   fitting seeded: 10.00 × K FO 1.02 × sale 1.30 = 13.26, total 53.04.
//   tube site/transport included: 9.00 × K FO 1.10 × sale 1.30 + 24.00 = 36.87, total 368.70.
//   manual K FO 0.90: tube 9.00 × 0.90 × 1.30 + 24.00 = 34.53, total 345.30;
//   fitting 10.00 × 0.90 × 1.30 = 11.70, total 46.80. Combined frozen net = 392.10.
//   quote            : 346,40 + 47,28 = 393,68
const options = { session: "army", tags: ["critical", "local", "site-cost"], timeout: 420_000 } as const;

const saveSettled = (ui: Ui) =>
  expect(ui.screen.getByTestId("estimate-page-toolbar-autosave-status")).toHaveText(/^(Sauvegardé|À jour)$/, { timeout: 30_000 });

armyTest("SC54101 a site cost replaces the catalogue base for one quote, keeps its source and leaves the catalogue reference price as it was",
  options, async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser, army };
    const record = (label: string, data: unknown) => recordEvidence(army, label, data);
    const draft = await prepareV3Draft(ui, army, "SC541");
    const title = (name: string) => `${army.runPrefix} ${name}`;
    const siteSupplier = title("Négoce Fictif");

    // 1. Catalogue: one tube at 10,00 € of reference with two supplier offers, transport excluded.
    const product = (await connectedApi<{ item: { id: string } }>(ui, "POST", "/api/products", {
      action: "create", item: { designation: title("tube PVC SC541"), product_type: "Tube", unit: "u", unit_price_cents: 1000 },
    })).item;
    const offers: Array<{ id: string }> = [];
    for (const [name, unit_price_cents] of [["A", 1000], ["B", 1100]] as const) {
      const supplier = (await connectedApi<{ item: { id: string } }>(ui, "POST", "/api/suppliers", {
        action: "create", item: { name: title(`SC541 fournisseur ${name}`), is_active: true },
      })).item;
      const offer = (await connectedApi<{ item: { id: string; updated_at: string } }>(ui, "POST", "/api/prices", {
        action: "create", item: { supplier_id: supplier.id, product_id: product.id, unit: "u", min_quantity: 1,
          unit_price_cents, currency: "EUR", valid_from: new Date().toISOString().slice(0, 10) },
      })).item;
      await connectedApi(ui, "POST", "/api/catalogue/reference-price", {
        action: "set-transport", product_id: product.id, offer_id: offer.id, transport_mode: "excluded", expected_updated_at: offer.updated_at,
      });
      offers.push(offer);
    }
    await querySql(`insert into public.supply_types(tenant_id,code,name,default_fo_provision)
      values ('${draft.owner.tenantId}', 'tube', 'Tube', 1.130);`);
    const details = await connectedApi<{ supply_types: Array<{ id: string; code: string }> }>(ui, "GET", `/api/estimates/${draft.versionId}`);
    const tube = details.supply_types.find((type) => type.code === "tube")?.id;
    expect(tube).toMatch(/^[0-9a-f-]{36}$/);

    // The catalogue as it stands before any site cost: the product, its offers, its suppliers and the reference
    // price the catalogue proposes for 10 units.
    const measureCatalogue = async () => {
      const [rows] = await querySql(`select jsonb_build_object(
          'product', (select to_jsonb(p) from public.products p where p.id = '${product.id}'),
          'offers', (select coalesce(jsonb_agg(to_jsonb(s) order by s.id), '[]'::jsonb) from public.supplier_pricebook s
            where s.tenant_id = '${draft.owner.tenantId}'),
          'suppliers', (select coalesce(jsonb_agg(s.name order by s.name), '[]'::jsonb) from public.suppliers s
            where s.tenant_id = '${draft.owner.tenantId}'),
          'validations', (select count(*) from public.product_reference_price_validations v where v.product_id = '${product.id}')
        )::text;`);
      const proposal = await connectedApi<{ proposal: Record<string, unknown> }>(ui, "GET",
        `/api/catalogue/reference-price?product_id=${product.id}&quantity=10&transport_mode=excluded`);
      return { tables: JSON.parse(rows) as { offers: unknown[]; suppliers: string[] }, proposal: proposal.proposal };
    };
    const catalogueBefore = await measureCatalogue();
    expect(catalogueBefore.tables.offers).toHaveLength(2);

    // 2. A quote with the catalogue tube on its retained offer, and a fitting typed by hand.
    const base = { unit_code: "u", pricing_status: "priced", labor_role_id: draft.tuyauteurId, k_fo: 1, k_mo: 1, tax_rate_bp: 2000 };
    const [tubeLine, fitting] = await seedLines(ui, army, draft, "sc541", [
      { ...base, title: title("tube du chantier"), quantity: 10, unit_price_ht_cents: 1000, h_mo_per_unit: 0.5,
        product_id: product.id, selected_supplier_price_id: offers[0].id, supply_type_id: tube },
      { ...base, title: title("raccord saisi"), quantity: 4, unit_price_ht_cents: 1000, h_mo_per_unit: 0 },
    ]);
    expect([tubeLine, fitting].map((row) => [Number(row.fo_provision), row.pu_ht_cents, row.line_total_ht_cents]))
      .toEqual([[1, 3869, 38690], [1, 1326, 5304]]);

    await app.open(`/dashboard/estimates/${draft.versionId}/edit`);
    await waitForDraftLease(ui);
    await showStandardColumns(ui);
    const lineOf = async (versionId: string, id: string) => (await readEstimate(browser, versionId)).items.find((item) => item.id === id);
    const costOf = async (lineTitle: string) => {
      const group = screen.getByRole("group", `Coût de fourniture de ${lineTitle}`, { exact: true });
      if (!(await group.isVisible())) await screen.getByRole("button", `Details de la ligne ${lineTitle}`, { exact: true }).click();
      await expect(group).toBeVisible();
      return group;
    };

    // 3. The detail reads its saved base and the single effective K FO.
    let cost = await costOf(tubeLine.title!);
    await expect(cost.getByTestId("estimate-line-fo-cost-detail"))
      .toHaveText("Offre fournisseur 10,00 € × K FO 1,13 = 11,30 € de coût FO ; × coef. de vente FO 1,3 = 14,69 €");
    await expect(cost.getByTestId("estimate-line-site-cost-source")).toHaveCount(0);

    // 4. The offer negotiated for this job site is typed on the line, with its source.
    await cost.getByRole("button", `Saisir un coût chantier pour ${tubeLine.title}`, { exact: true }).click();
    const form = screen.getByRole("form", `Coût chantier pour ${tubeLine.title}`, { exact: true });
    await form.getByLabel("Coût unitaire HT (€)", { exact: true }).fill("9");
    await form.getByLabel("Fournisseur", { exact: true }).fill(siteSupplier);
    await form.getByLabel("Référence de l’offre", { exact: true }).fill("OF-2611-07");
    await form.getByLabel("Date de l’offre", { exact: true }).fill("2026-11-03");
    await form.getByLabel("Pièce (facultatif)", { exact: true }).fill("Offre PDF du 03/11");
    await form.getByLabel("Transport", { exact: true }).selectOption({ value: "included" });
    const formScreenshot = await app.screenshot("SC54101-site-cost-form");
    await form.getByRole("button", "Enregistrer le coût chantier", { exact: true }).click();
    await saveLineEditsWithShortcut(ui, draft.versionId, tubeLine.title!, army);
    const sourceText = `${siteSupplier} · offre OF-2611-07 · 03/11/2026 · Offre PDF du 03/11`;
    const site = { supplier: siteSupplier, offer_reference: "OF-2611-07", offer_date: "2026-11-03", document: "Offre PDF du 03/11" };
    const siteState = (line: Awaited<ReturnType<typeof lineOf>>) => {
      const origin = line?.fo_price_origin as { kind?: string; transport_mode?: string | null; site?: unknown } | null | undefined;
      return [line?.unit_price_ht_cents, line?.product_id, line?.selected_supplier_price_id, origin?.kind, origin?.transport_mode,
        origin?.site, Number(line?.fo_provision), line?.pu_ht_cents, line?.line_total_ht_cents];
    };
    // Transport included: the configured automatic K FO is 1.10 for the tube, with neutral retired provision.
    await expect.poll(async () => siteState(await lineOf(draft.versionId, tubeLine.id)))
      .toEqual([900, product.id, null, "site", "included", site, 1, 3687, 36870]);
    await saveSettled(ui);
    cost = await costOf(tubeLine.title!);
    await expect(cost.getByTestId("estimate-line-fo-cost-detail"))
      .toHaveText("Coût chantier 9,00 € × K FO 1,1 = 9,90 € de coût FO ; × coef. de vente FO 1,3 = 12,87 €");
    await expect(cost.getByTestId("estimate-line-site-cost-source")).toHaveText(`Source du coût chantier : ${sourceText}`);
    const siteScreenshot = await app.screenshot("SC54101-site-cost");
    await browser.keyboard.press("Escape");

    // 5. Manual K FO 0.90 replaces the whole supply factor; labour and saved source stay unchanged.
    for (const line of [tubeLine, fitting]) {
      await fillCell(ui, `Coefficient fourniture K FO pour ${line.title}`, "0,9");
      await saveLineEditsWithShortcut(ui, draft.versionId, line.title!, army);
      await expect.poll(async () => Number((await lineOf(draft.versionId, line.id))?.k_fo)).toBe(0.9);
      await saveSettled(ui);
    }
    const afterKfo = await readEstimate(browser, draft.versionId);
    const savedTube = afterKfo.items.find((item) => item.id === tubeLine.id);
    const savedFitting = afterKfo.items.find((item) => item.id === fitting.id);
    expect(siteState(savedTube)).toEqual([900, product.id, null, "site", "included", site, 1, 3453, 34530]);
    expect([Number(savedTube?.h_mo_per_unit), savedTube?.labor_role_id]).toEqual([0.5, draft.tuyauteurId]);
    expect([savedFitting?.unit_price_ht_cents, Number(savedFitting?.fo_provision), savedFitting?.pu_ht_cents, savedFitting?.line_total_ht_cents])
      .toEqual([1000, 1, 1170, 4680]);
    cost = await costOf(fitting.title!);
    await expect(cost.getByTestId("estimate-line-fo-cost-detail"))
      .toHaveText("Saisie manuelle 10,00 € × K FO 0,9 = 9,00 € de coût FO ; × coef. de vente FO 1,3 = 11,70 €");
    await browser.keyboard.press("Escape");

    // 6. The catalogue is as it was: same product row, same offers, same suppliers, same proposed reference price.
    const catalogueAfter = await measureCatalogue();
    expect(catalogueAfter).toEqual(catalogueBefore);
    expect(catalogueAfter.tables.suppliers).not.toContain(siteSupplier);

    // 7. Reopened, the line still says where its cost comes from.
    await browser.reload();
    await waitForDraftLease(ui);
    cost = await costOf(tubeLine.title!);
    await expect(cost.getByTestId("estimate-line-fo-cost-detail"))
      .toHaveText("Coût chantier 9,00 € × K FO 0,9 = 8,10 € de coût FO ; × coef. de vente FO 1,3 = 10,53 €");
    await expect(cost.getByTestId("estimate-line-site-cost-source")).toHaveText(`Source du coût chantier : ${sourceText}`);
    await expect(cost.getByRole("button", `Modifier le coût chantier pour ${tubeLine.title}`, { exact: true })).toBeVisible();
    const reopenedScreenshot = await app.screenshot("SC54101-site-cost-reopened");
    await browser.keyboard.press("Escape");

    // 8. Issued: the frozen quote keeps the source, and the customer's PDF never names the supplier of the cost.
    await app.open("/dashboard/affaires");
    await generatePdf(browser, record, "sc541", draft.versionId);
    const frozen = await readEstimate(browser, draft.versionId);
    expect([frozen.version.total_ht_cents, frozen.version.calc_snapshot_content_revision]).toEqual([39210, frozen.version.content_revision]);
    expect(siteState(frozen.items.find((item) => item.id === tubeLine.id))).toEqual([900, product.id, null, "site", "included", site, 1, 3453, 34530]);
    const pdf = await pdfText(await storedPdfBytes(browser, draft.versionId));
    for (const printedRow of [`${tubeLine.title} 10 u 34,53 € 345,30 €`, `${fitting.title} 4 u 11,70 € 46,80 €`, "Total HT net 392,10 €"]) {
      expect(pdf.text).toContain(printedRow);
    }
    for (const internal of [siteSupplier, "OF-2611-07", "Coût chantier"]) expect(pdf.text).not.toContain(internal);

    // 9. A new version copied from this quote keeps the site cost and its source; the catalogue still has not moved.
    const duplicated = await apiRequest<Envelope<{ version_id: string }>>(browser, "POST", `/api/estimates/${draft.versionId}/duplicate`);
    expect([duplicated.status, duplicated.body.ok]).toEqual([201, true]);
    const copy = await readEstimate(browser, duplicated.body.data.version_id);
    const copiedTube = copy.items.find((item) => item.title === tubeLine.title);
    expect(siteState(copiedTube)).toEqual([900, product.id, null, "site", "included", site, 1, 3453, 34530]);
    expect(copiedTube?.fo_price_origin).toEqual(savedTube?.fo_price_origin);
    expect(await measureCatalogue()).toEqual(catalogueBefore);
    await record("sc541-outcome", { product, offers, catalogueBefore, catalogueAfter, savedTube, savedFitting, copiedTube,
      pdf: { sha256: pdf.sha256, text: pdf.text }, screenshots: [formScreenshot, siteScreenshot, reopenedScreenshot] });
  });

// TI-541, answer of the business owner on 11 November 2026: a POSE SEULE line takes neither losses nor transport, even
// when it carries a small supply needed for the fitting (supports), and such a supply can come from a site offer.
// Observable failures this journey prevents:
//  - the small supply of a fitting service is raised by the provision of a supplied line (1 % and more);
//  - the screen and the SQL engine disagree on that provision, so the line cannot be saved (D12);
//  - a site cost cannot be typed on a POSE SEULE line, or the provision does not come back when the line leaves it.
// Expected amounts, written by hand before the first run (sale coefficients FO 1,30 and MO 1,20, tuyauteur 40 €/h,
// 3 h of fitting = 3 × 40 × 1,20 = 144,00):
//   seeded: 10.00 × K FO 1.02 × 1.30 + 144.00 = 157.26, total 2201.64.
//   POSE SEULE                 : 10,00 × 1 × 1,30 = 13,00 ; + 144,00 = 157,00 ; × 14 = 2 198,00
//   POSE SEULE, site cost 8,00 : 8,00 × 1 × 1,30 = 10,40 ; + 144,00 = 154,40 ; × 14 = 2 161,60
//   supplied again: 8.00 × K FO 1.02 × 1.30 + 144.00 = 154.608, PU 154.61, total 2164.54.
armyTest("PS54102 a POSE SEULE line with a small supply takes no provision, accepts a site cost, and takes the provision back when it leaves POSE SEULE",
  options, async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser, army };
    const record = (label: string, data: unknown) => recordEvidence(army, label, data);
    const draft = await prepareV3Draft(ui, army, "PS541");
    const title = (name: string) => `${army.runPrefix} ${name}`;
    const siteSupplier = title("Négoce Fictif");
    const [wc] = await seedLines(ui, army, draft, "ps541", [
      { unit_code: "ens", pricing_status: "priced", labor_role_id: draft.tuyauteurId, k_fo: 1, k_mo: 1, tax_rate_bp: 2000,
        title: title("pose WC avec supportage"), quantity: 14, unit_price_ht_cents: 1000, h_mo_per_unit: 3 },
    ]);
    expect([wc.line_nature, Number(wc.fo_provision), wc.pu_ht_cents, wc.line_total_ht_cents]).toEqual(["supply_and_labor", 1, 15726, 220164]);

    await app.open(`/dashboard/estimates/${draft.versionId}/edit`);
    await waitForDraftLease(ui);
    await showStandardColumns(ui);
    const stateOf = async () => {
      const estimate = await readEstimate(browser, draft.versionId);
      const line = estimate.items.find((item) => item.id === wc.id);
      const origin = line?.fo_price_origin as { kind?: string } | null | undefined;
      return [line?.line_nature, line?.unit_price_ht_cents, origin?.kind ?? null, Number(line?.fo_provision), line?.pu_ht_cents,
        line?.line_total_ht_cents, estimate.version.total_ht_cents];
    };
    const openDetails = async () => {
      const group = screen.getByRole("group", `Coût de fourniture de ${wc.title}`, { exact: true });
      if (!(await group.isVisible())) await screen.getByRole("button", `Details de la ligne ${wc.title}`, { exact: true }).click();
      await expect(group).toBeVisible();
      return group;
    };
    const chooseNature = async (value: string) => {
      await openDetails();
      await screen.getByRole("combobox", new RegExp(`nature de ligne pour ${wc.title}$`), { visible: true }).selectOption({ value });
      await saveLineEditsWithShortcut(ui, draft.versionId, wc.title!, army);
    };

    // 1. Noted POSE SEULE, the line keeps its small supply and loses the provision: the save passes the SQL engine.
    await chooseNature("pose_only");
    await expect.poll(stateOf).toEqual(["pose_only", 1000, null, 1, 15700, 219800, 219800]);
    await saveSettled(ui);
    let cost = await openDetails();
    await expect(cost.getByTestId("estimate-line-fo-cost-detail"))
      .toHaveText("Saisie manuelle 10,00 € × K FO 1 = 10,00 € de coût FO ; × coef. de vente FO 1,3 = 13,00 €");

    // 2. The supports come from an offer for this job site: the site cost is typed on the POSE SEULE line.
    await cost.getByRole("button", `Saisir un coût chantier pour ${wc.title}`, { exact: true }).click();
    const form = screen.getByRole("form", `Coût chantier pour ${wc.title}`, { exact: true });
    await form.getByLabel("Coût unitaire HT (€)", { exact: true }).fill("8");
    await form.getByLabel("Fournisseur", { exact: true }).fill(siteSupplier);
    await form.getByLabel("Date de l’offre", { exact: true }).fill("2026-11-03");
    await form.getByRole("button", "Enregistrer le coût chantier", { exact: true }).click();
    await saveLineEditsWithShortcut(ui, draft.versionId, wc.title!, army);
    await expect.poll(stateOf).toEqual(["pose_only", 800, "site", 1, 15440, 216160, 216160]);
    await saveSettled(ui);
    cost = await openDetails();
    await expect(cost.getByTestId("estimate-line-fo-cost-detail"))
      .toHaveText("Coût chantier 8,00 € × K FO 1 = 8,00 € de coût FO ; × coef. de vente FO 1,3 = 10,40 €");
    const poseScreenshot = await app.screenshot("PS54102-pose-seule-site-cost");
    // A small supply on a POSE SEULE line is not an inconsistency (TI-539): nothing on this line blocks sending.
    const gating = await apiRequest<Envelope<{ gating: { blockingFlags: Array<{ key: string; item_ids: string[] }> } }>>(
      browser, "GET", `/api/estimates/${draft.versionId}/gating`);
    expect([gating.status, gating.body.ok]).toEqual([200, true]);
    expect(gating.body.data.gating.blockingFlags.filter((flag) => flag.item_ids.includes(wc.id)).map((flag) => flag.key)).toEqual([]);

    // 3. Back to a supplied and fitted line, the site cost stays and the automatic supply K FO comes back.
    await chooseNature("supply_and_labor");
    await expect.poll(stateOf).toEqual(["supply_and_labor", 800, "site", 1, 15461, 216454, 216454]);
    await saveSettled(ui);

    // 4. Reopened, the saved line is the one the screen showed.
    await browser.reload();
    await waitForDraftLease(ui);
    cost = await openDetails();
    await expect(cost.getByTestId("estimate-line-fo-cost-detail"))
      .toHaveText("Coût chantier 8,00 € × K FO 1,02 = 8,16 € de coût FO ; × coef. de vente FO 1,3 = 10,61 €");
    expect(await stateOf()).toEqual(["supply_and_labor", 800, "site", 1, 15461, 216454, 216454]);
    await record("ps541-outcome", { line: (await readEstimate(browser, draft.versionId)).items.find((item) => item.id === wc.id),
      screenshots: [poseScreenshot] });
  });
