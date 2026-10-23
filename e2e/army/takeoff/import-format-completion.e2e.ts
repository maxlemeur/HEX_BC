import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PDFDocument, StandardFonts } from "pdf-lib";
import * as XLSX from "xlsx";
import { expect } from "e2e";

import { apiRequest, armyTest, createEstimateViaWizard, ownEstimate, readEstimate, recordEvidence } from "../critical/fixtures";

const headers = ["N°", "Designation des ouvrages", "Unité", "Qte", "P.U. HT", "Total HT"];
const rows = [
  ["A-001", "Tube cuivre", "m", "2,5", "12,50", "31,25"],
  ["A-002", "Vanne laiton", "u", "1", "65,00", "65,00"],
  ["A-003", "Reserve zero", "u", "0", "7,25", "0,00"],
];
const mapping = Object.fromEntries(headers.map((header, index) => [header, ["hex_code", "designation", "unit", "quantity", "unit_price_ht", "total_ht"][index]]));
const expected = [
  { title: "Tube cuivre", quantity: 2.5, price: 1250, total: 3125 },
  { title: "Vanne laiton", quantity: 1, price: 6500, total: 6500 },
  { title: "Reserve zero", quantity: 0, price: 725, total: 0 },
];

export async function tabularPdfBytes() {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([595, 842]);
  page.drawText("ARMY - DPGF lot plomberie", { x: 40, y: 780, font, size: 12 });
  const columns = [40, 100, 300, 360, 420, 500];
  [headers, ...rows].forEach((row, index) => row.forEach((cell, column) => {
    page.drawText(cell, { x: columns[column], y: 740 - index * 20, font, size: 9 });
  }));
  return Buffer.from(await document.save());
}

for (const format of ["pdf", "xls"] as const) {
  armyTest(`IFC ${format} traverses review mapping confirmation and reload with exact business values and source provenance`, {
    session: "army", trace: "off", tags: ["critical", "import-formats", "local"], timeout: 180_000,
  }, async (ui) => {
    const { army, app, screen, browser } = ui;
    const ids = await createEstimateViaWizard(ui, { projectName: `${army.runPrefix}-IFC-${format}`, title: "Import format source" }, army);
    const before = await readEstimate(browser, ids.versionId);
    const filename = `${army.runPrefix}-dpgf.${format}`;
    const directory = path.resolve(".e2e/army/critical/artifacts/fixtures");
    await mkdir(directory, { recursive: true });
    let bytes: Buffer;
    if (format === "pdf") bytes = await tabularPdfBytes();
    else {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...rows]), "DPGF");
      bytes = Buffer.from(XLSX.write(workbook, { bookType: "biff8", type: "buffer" }));
      expect(bytes.subarray(0, 8).toString("hex")).toBe("d0cf11e0a1b11ae1");
    }
    const filePath = path.join(directory, filename);
    await writeFile(filePath, bytes);
    await recordEvidence(army, `IFC-${format}-input`, { filename, format, sha256: createHash("sha256").update(bytes).digest("hex"), headers, rows, expected });
    await app.open(`/dashboard/affaires/${ids.projectId}?created=1`);
    await screen.getByRole("button", "Importer la DPGF", { exact: true }).click();
    await browser.locator('input[type="file"]').setInputFiles(filePath);
    if (format === "pdf") {
      const confirmTables = screen.getByRole("button", "Valider les tableaux et lancer l'import", { exact: true });
      await expect(confirmTables).toBeEnabled();
      const importsBeforeApproval = await apiRequest<{ data: unknown[] }>(browser, "GET", `/api/imports?project_id=${ids.projectId}`);
      expect(importsBeforeApproval.body.data).toEqual([]);
      const table = screen.getByRole("checkbox");
      await expect(table).toHaveCount(1);
      await table.uncheck();
      await expect(confirmTables).toBeDisabled();
      await table.check();
      await confirmTables.click();
    } else await screen.getByRole("button", "Lancer l'import", { exact: true }).click();
    const next = screen.getByRole("button", "Suivant : Aperçu", { exact: true });
    const edit = screen.getByRole("button", "Modifier le mapping", { exact: true });
    await expect.poll(async () => await next.isVisible() || await edit.isVisible()).toBe(true);
    if (await edit.isVisible()) await edit.click();
    const sourceHeaders = format === "xls"
      ? ["N", "Designation_des_ouvrages", "Unite", "Qte", "P.U._HT", "Total_HT"]
      : headers;
    for (const [index, target] of Object.values(mapping).entries()) {
      await screen.getByRole("combobox", `Champ cible pour ${sourceHeaders[index]}`, { exact: true })
        .selectOption({ value: target });
    }
    await next.click();
    const imported = await apiRequest<{ data: Array<{ id: string; filename: string; project_id: string; row_count: number }> }>(
      browser, "GET", `/api/imports?project_id=${ids.projectId}`);
    expect(imported.body.data).toHaveLength(1);
    const source = imported.body.data[0];
    expect(source).toMatchObject({ filename, project_id: ids.projectId, row_count: 3 });
    await screen.getByRole("button", "Suivant : Confirmation", { exact: true }).click();
    await screen.getByRole("button", "Créer le chiffrage", { exact: true }).click();
    await expect(screen.getByRole("heading", "Devis créé", { exact: true })).toBeVisible({ timeout: 45_000 });
    await screen.getByRole("button", "Continuer", { exact: true }).click();
    const skipPlans = screen.getByRole("button", "Continuer sans ajouter de plans", { exact: true });
    await expect.poll(async () => /\/estimates\/[0-9a-f-]{36}\/edit/.test(await browser.url()) || await skipPlans.isVisible()).toBe(true);
    if (await skipPlans.isVisible()) await skipPlans.click();
    await expect(browser).toHaveURL(/\/estimates\/[0-9a-f-]{36}\/edit/);
    const versionId = (await browser.url()).match(/\/estimates\/([0-9a-f-]{36})\/edit/)![1];
    ownEstimate(army, { projectId: ids.projectId, versionId });
    expect(versionId).not.toBe(ids.versionId);
    const saved = await readEstimate(browser, versionId);
    expect(saved.version).toMatchObject({ total_ht_cents: 9625, total_tax_cents: 1925, total_ttc_cents: 11550 });
    const lines = saved.items.filter((item) => item.item_type === "line");
    expect(lines).toHaveLength(3);
    for (const entry of expected) {
      const line = lines.find((item) => item.title === entry.title);
      expect(line).toMatchObject({ quantity: entry.quantity, unit_price_ht_cents: entry.price, line_total_ht_cents: entry.total,
        source_provider: "dpgf", source_file_name: filename, source_page: format === "pdf" ? 1 : null });
      expect(line?.source_metadata).toMatchObject({ import_id: source.id, mapping_id: expect.any(String), mapped_row_id: expect.any(String) });
      if (format === "pdf") expect(line?.source_metadata).toMatchObject({
        _timax_provenance: { source_page: 1, table_index: 0, source_file_name: filename },
      });
      else expect(line?.source_metadata).toMatchObject({ sheet_name: "DPGF" });
    }
    expect((await readEstimate(browser, ids.versionId)).items).toEqual(before.items);
    await browser.reload();
    const reloaded = await readEstimate(browser, versionId);
    expect(reloaded.items).toEqual(saved.items);
    expect([reloaded.version.total_ht_cents, reloaded.version.total_tax_cents, reloaded.version.total_ttc_cents]).toEqual([9625, 1925, 11550]);
    for (const entry of expected) await expect(screen.getByLabel(`Quantité pour ${entry.title}`, { exact: true })).toBeVisible();
    await recordEvidence(army, `IFC-${format}-persisted`, { ids, versionId, importId: source.id, lines,
      totals: [9625, 1925, 11550], originalVersionUnchanged: true, unchangedAfterReload: true });
  });
}
