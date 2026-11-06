import { writeFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "e2e";

import { apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence, saveLineEditsWithShortcut } from "../critical/fixtures";
import {
  checkpoint, fillCell, lockVersion, openV3Editor, prepareV3Draft, releaseVersion, seedLines,
  showStandardColumns, switchToExpertMode, type Envelope,
} from "./engine-v3-editor-support";
import { generatePdf, pdfText, storedPdfBytes } from "./engine-v3-emission-support";

// Independent half-up decimal calculation in cents. PU is rounded before multiplication by Q.
// 2.375 × 3,803 = 9,032 gross. The other two priced lines contribute 4,668 and 150.
// Discount 3.75% = 519, then round down by 31. Net tax bases: 8,673 at 10%, 4,627 at 20%.
armyTest("V3FRA01 fractional quantities reconcile in the editor, its duplicate and the downloaded PDF",
  { session: "army", tags: ["critical", "local", "engine-v3"], timeout: 300_000 }, async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const draft = await prepareV3Draft(ui, army, "V3FRA01");
    const lines = await seedLines(ui, army, draft, "fractional", [
      { title: "Tube posé", quantity: 2, unit_code: "ml", unit_price_ht_cents: 1234, h_mo_per_unit: 0.375,
        k_fo: 1.125, k_mo: 1.1, labor_role_id: draft.tuyauteurId, pricing_status: "priced", tax_rate_bp: 1000 },
      { title: "Tube fourni", quantity: 3.555, unit_code: "ml", unit_price_ht_cents: 1000, pricing_status: "priced", tax_rate_bp: 2000 },
      { title: "Pose seule", quantity: 0.125, unit_code: "ml", h_mo_per_unit: 0.25, labor_role_id: draft.tuyauteurId, pricing_status: "priced", tax_rate_bp: 2000 },
      { title: "Prestation incluse", quantity: 4.675, unit_code: "ml", pricing_status: "included", tax_rate_bp: 1000 },
    ]);
    await lockVersion(browser, draft.versionId);
    const before = await readEstimate(browser, draft.versionId);
    const settings = await apiRequest(browser, "PATCH", `/api/estimates/${draft.versionId}`, {
      discount_bp: 375, discount_amount_cents: null, rounding_mode: "down", rounding_step_cents: 100,
      expected_content_revision: before.version.content_revision,
    }, { "if-match": before.version.updated_at });
    expect(settings.status).toBe(200);
    await releaseVersion(browser, draft.versionId);

    await switchToExpertMode(ui);
    await openV3Editor(ui, army, draft, "fractional");
    await showStandardColumns(ui);
    await fillCell(ui, "Quantité pour Tube posé", "2,375");
    await saveLineEditsWithShortcut(ui, draft.versionId, "Tube posé", army);

    const version = { totals: [13300, 1792, 15092] as [number, number, number], gross: 13850, applied: 519, commercialRounding: 31 };
    const expectedLines = [
      { quantity: 2.375, pu: 3803, net: 8673, tax: 867 },
      { quantity: 3.555, pu: 1313, net: 4483, tax: 896 },
      { quantity: 0.125, pu: 1200, net: 144, tax: 29 },
      { quantity: 4.675, pu: null, net: 0, tax: 0 },
    ];
    await checkpoint(ui, army, "fractional-saved", draft.versionId, {
      api: { version, lines: Object.fromEntries(lines.map((item, index) => [item.id, expectedLines[index]])) },
      screen: {
        chips: ["Total HT : 133,00 €", "Remise commerciale : -5,19 €", "Arrondi commercial : -0,31 €",
          "TVA 10 % : 8,67 €", "TVA 20 % : 9,25 €", "TVA : 17,92 €", "TTC à payer : 150,92 €"],
        rows: [{ id: lines[0].id, title: "Tube posé", pu: "38,03" },
          { id: lines[1].id, title: "Tube fourni", pu: "13,13" },
          { id: lines[2].id, title: "Pose seule", pu: "12,00" }],
      },
    });

    const copy = await apiRequest<Envelope<{ version_id: string }>>(browser, "POST", `/api/estimates/${draft.versionId}/duplicate`);
    expect([copy.status, copy.body.ok]).toEqual([201, true]);
    const versionId = copy.body.data.version_id;
    expect(versionId).not.toBe(draft.versionId);
    ownEstimate(army, { projectId: draft.projectId, versionId });
    await app.open("/dashboard/affaires");
    const record = (label: string, data: unknown) => recordEvidence(army, label, data);
    await generatePdf(browser, record, "fractional-copy", versionId);
    const frozen = await readEstimate(browser, versionId);
    expect(frozen.project.id).toBe(draft.projectId);
    expect(frozen.version).toMatchObject({ id: versionId, project_id: draft.projectId,
      calc_engine_version: 3, total_ht_cents: 13300, total_tax_cents: 1792, total_ttc_cents: 15092,
      calc_snapshot_content_revision: frozen.version.content_revision });
    expect(frozen.version.calc_snapshot_context).toMatchObject({ cost_subtotal_cents: 10965, tax_breakdown: [
      { rate_bp: 1000, base_cents: 8673, tax_cents: 867 }, { rate_bp: 2000, base_cents: 4627, tax_cents: 925 },
    ] });
    const rows = frozen.items.filter(i => i.item_type === "line").sort((a, b) => a.position - b.position);
    expect(rows.map(i => [i.quantity, i.snapshot_pu_ht_cents, i.line_total_ht_cents, i.line_tax_cents]))
      .toEqual(expectedLines.map(i => [i.quantity, i.pu, i.net, i.tax]));
    const bytes = await storedPdfBytes(browser, versionId);
    const pdf = await pdfText(bytes);
    const evidence = await record("fractional-pdf", { versionId, sourceVersionId: draft.versionId,
      sha256: pdf.sha256, text: pdf.text, snapshot: frozen.version.calc_snapshot_context });
    await writeFile(path.join(path.dirname(evidence.path), `${army.runPrefix}-fractional.pdf`), bytes);
    for (const row of [
      "Tube posé 2,375 ml 38,03 € 90,32 €", "Tube fourni 3,555 ml 13,13 € 46,68 €",
      "Pose seule 0,125 ml 12,00 € 1,50 €", "Prestation incluse 4,675 ml - Inclus",
      "Total HT brut 138,50 €", "Remise commerciale (3,75 %) -5,19 €", "Arrondi commercial -0,31 €",
      "Total HT net 133,00 €", "TVA 10 % sur 86,73 € 8,67 €", "TVA 20 % sur 46,27 € 9,25 €",
      "Total TTC 150,92 €",
    ]) expect(pdf.text).toContain(row);
  });
