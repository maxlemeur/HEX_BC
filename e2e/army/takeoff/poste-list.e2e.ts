import { createHash } from "node:crypto";

import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import * as XLSX from "xlsx";

import { recordEvidence } from "../critical/fixtures";
import { describe, expect, fixtureFile, localClient, nativeTest as test } from "./native-ui";

const options = { session: "army", trace: "off" as const, tags: ["critical", "local", "import-formats"], timeout: 180_000 };
const headers = ["N", "Designation", "Unite", "Qte", "PU HT", "Total HT"];
const firstLine = ["A01", "Lavabo en céramique", "u", "2", "11,15", "22,30"];
const secondLine = ["B01", "Lavabo en céramique", "u", "3", "11,15", "33,45"];
const unquantifiedLine = ["B02", "Attente de raccordement", "u", "", "11,15", ""];
const firstSection = ["", "Bâtiment A", "", "", "", ""];
const secondSection = ["", "Bâtiment B", "", "", "", ""];
const subtotal = ["", "Sous-total", "", "", "", "55,75"];

async function bareAffaire(name: string) {
  const { client, userId } = await localClient();
  const membership = await client.from("tenant_memberships").select("tenant_id")
    .eq("user_id", userId).eq("is_default", true).single();
  if (membership.error) throw new Error("The fixture needs the local owner's tenant.");
  const project = await client.from("estimate_projects").insert({
    tenant_id: membership.data.tenant_id, user_id: userId, name,
  }).select("id").single();
  if (project.error) throw new Error(`The versionless affaire fixture failed: ${project.error.code}`);
  return { client, projectId: project.data.id as string };
}

async function fixtureBytes(format: "csv" | "xls" | "xlsx" | "pdf") {
  if (format === "pdf") {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const x = [35, 95, 305, 355, 410, 496];
    for (const rows of [
      [firstLine, ["A02", "Raccord cuivre", "u", "1", "9,00", "9,00"]],
      [secondLine, ["B02", "Vanne laiton", "u", "1", "7,00", "7,00"], subtotal],
    ]) {
      const page = pdf.addPage([595, 842]);
      page.drawText("DPGF - Plomberie", { x: 38, y: 780, font, size: 12 });
      [headers, ...rows].forEach((row, index) => row.forEach((value, column) => {
        if (value) page.drawText(value, { x: x[column], y: 740 - index * 22, font, size: 9 });
      }));
    }
    return pdf.save();
  }

  const rows = [headers, firstSection, firstLine, secondSection, secondLine, unquantifiedLine, subtotal];
  if (format === "csv") return Buffer.from("\ufeff" + rows.map((row) => row.join(";")).join("\n"), "utf8");

  if (format === "xlsx") {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("Notice").addRow(["Notice"]);
    const sheet = workbook.addWorksheet("DPGF");
    rows.forEach((row, index) => { sheet.getRow(index + 3).values = row; });
    return new Uint8Array(await workbook.xlsx.writeBuffer() as unknown as ArrayBuffer);
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "DPGF");
  return Buffer.from(XLSX.write(workbook, { bookType: "biff8", type: "buffer" }));
}

async function readStoredDpgf(client: Awaited<ReturnType<typeof bareAffaire>>["client"], projectId: string) {
  const source = await client.from("dpgf_imports").select("id").eq("project_id", projectId).single();
  expect(source.error).toBeNull();
  const importId = source.data!.id;
  const [raw, mappings, mapped] = await Promise.all([
    client.from("dpgf_rows_raw").select("*").eq("import_id", importId).order("row_index"),
    client.from("dpgf_mappings").select("*").eq("import_id", importId),
    client.from("dpgf_rows_mapped").select("*").eq("import_id", importId),
  ]);
  expect([raw.error, mappings.error, mapped.error]).toEqual([null, null, null]);
  expect(raw.data!.length).toBeGreaterThan(0);
  expect(mappings.data).toHaveLength(1);
  expect(mapped.data).toHaveLength(raw.data!.length);
  return { raw: raw.data!, mappings: mappings.data!, mapped: mapped.data! };
}

describe("Aperçu des postes à mesurer", () => {
  test("POSTE affiche le gabarit de plomberie avant tout devis", options, async ({ ui }) => {
    const { app, screen, army } = ui;
    const { client, projectId } = await bareAffaire(`${army.runPrefix}-POSTE-gabarit`);
    await app.open(`/dashboard/affaires/${projectId}`);
    await screen.getByRole("link", "Ouvrir les métrés", { exact: true }).click();
    const table = screen.getByRole("table", "Postes à mesurer", { exact: true });

    await expect(screen.getByText("Gabarit indicatif de plomberie · 23 postes")).toBeVisible();
    for (const family of ["Réseaux", "Appareils sanitaires", "Robinetterie", "Calorifuge"]) {
      await expect(table.getByRole("cell", `Plomberie / ${family}`, { exact: true }).first()).toBeVisible();
    }
    const versions = await client.from("estimate_versions").select("id").eq("project_id", projectId);
    expect(versions.data).toEqual([]);
    await recordEvidence(army, "POSTE-gabarit", { projectId, versions: versions.data, posts: 23 });
  });

  test("POSTE demande de préparer la DPGF importée sans correspondances", options, async ({ ui }) => {
    const { app, screen, army } = ui;
    const { projectId } = await bareAffaire(`${army.runPrefix}-POSTE-a-preparer`);
    const href = `/dashboard/affaires/${projectId}/takeoff`;
    await app.open(href);
    const upload = await ui.request.post("/api/imports", { multipart: {
      project_id: projectId,
      file: { name: "sans-correspondances.csv", mimeType: "text/csv", buffer: Buffer.from(await fixtureBytes("csv")) },
    } });
    expect(upload.ok()).toBe(true);

    await app.open(href);
    await expect(screen.getByText("DPGF à préparer.", { exact: false })).toBeVisible();
    await expect(screen.getByRole("table", "Postes à mesurer", { exact: true })).toHaveCount(0);
  });

  for (const format of ["csv", "xls", "xlsx", "pdf"] as const) {
    test(`POSTE ${format} restitue les deux lignes homonymes du DPGF avant le devis`, options, async ({ ui }) => {
      const { app, browser, screen, army } = ui;
      const { client, projectId } = await bareAffaire(`${army.runPrefix}-POSTE-${format}`);
      const filename = `postes-plomberie.${format}`;
      const bytes = await fixtureBytes(format);
      const file = fixtureFile(ui, filename, bytes);
      const href = `/dashboard/affaires/${projectId}/takeoff`;
      await app.open(`/dashboard/affaires/${projectId}?created=1`);
      await screen.getByRole("button", "Importer la DPGF", { exact: true }).first().click();
      await browser.locator('input[type="file"]').setInputFiles(file);
      if (format === "pdf") {
        await screen.getByRole("button", "Valider les tableaux et lancer l'import", { exact: true }).click();
      } else {
        await screen.getByRole("button", "Lancer l'import", { exact: true }).click();
      }
      const next = screen.getByRole("button", "Suivant : Aperçu", { exact: true });
      const edit = screen.getByRole("button", "Modifier le mapping", { exact: true });
      await expect.poll(async () => await next.isVisible() || await edit.isVisible()).toBe(true);
      if (await edit.isVisible()) await edit.click();

      for (const [source, target] of [
        [/^Champ cible pour N$/, "hex_code"],
        [/^Champ cible pour Designation$/, "designation"],
        [/^Champ cible pour Unite$/, "unit"],
        [/^Champ cible pour Qte$/, "quantity"],
        [/^Champ cible pour PU[ _]HT$/, "unit_price_ht"],
        [/^Champ cible pour Total[ _]HT$/, "total_ht"],
      ] as const) {
        await screen.getByRole("combobox", source).selectOption({ value: target });
      }
      await next.click();
      if (format !== "pdf") {
        for (const label of ["Bâtiment A", "Bâtiment B"]) {
          await screen.getByRole("combobox", `Type de ${label}`, { exact: true }).selectOption({ value: "section" });
        }
      }
      await screen.getByRole("button", "Suivant : Confirmation", { exact: true }).click();
      await screen.getByRole("button", "Retour au hub", { exact: true }).click();
      await expect(screen.getByRole("heading", "Mapping enregistré", { exact: true })).toBeVisible();

      const stored = await readStoredDpgf(client, projectId);
      if (format === "csv") {
        const expectedRows = [firstSection, firstLine, secondSection, secondLine, unquantifiedLine, subtotal];
        expect(stored.raw.map(({ row_index, payload }) => ({ row_index, payload }))).toEqual(
          expectedRows.map((cells, row_index) => ({
            row_index,
            payload: Object.fromEntries(headers.map((header, index) => [header.replace(" ", "_"), cells[index] || null])),
          }))
        );
      }
      await recordEvidence(army, `POSTE-stockage-${format}`, stored);

      await app.open(href);
      const table = screen.getByRole("table", "Postes à mesurer", { exact: true });
      const homonyms = table.getByRole("row").filter({ hasText: "Lavabo en céramique" });
      await expect(homonyms).toHaveCount(2);
      const sourceLocations = format === "pdf" ? ["Page 1", "Page 2"]
        : format === "csv" ? ["Enregistrement importé 2", "Enregistrement importé 4"]
          : ["Ligne du tableau 3", "Ligne du tableau 5"];
      await expect(homonyms.nth(0)).toContainText(sourceLocations[0]);
      await expect(homonyms.nth(1)).toContainText(sourceLocations[1]);
      await expect(homonyms.nth(0).getByRole("cell", "2", { exact: true })).toBeVisible();
      await expect(homonyms.nth(1).getByRole("cell", "3", { exact: true })).toBeVisible();
      if (format !== "pdf") {
        await expect(homonyms.nth(0)).toContainText("Bâtiment A");
        await expect(homonyms.nth(1)).toContainText("Bâtiment B");
        await expect(table.getByRole("row").filter({ hasText: "Attente de raccordement" })
          .getByRole("cell", "—", { exact: true })).toBeVisible();
      }
      await expect(table.getByRole("row").filter({ hasText: /Sous-total|55,75/ })).toHaveCount(0);
      if (format === "pdf") {
        await screen.getByText("Détail de la lecture des lignes sources", { exact: true }).click();
        await expect(screen.getByText(/55,75|Sous-total/)).toHaveCount(0);
        await expect(screen.getByText(/Page 2.*Total ou pied de tableau/)).toBeVisible();
      }
      if (format === "xlsx") await expect(homonyms.nth(0)).toContainText("DPGF");

      const ids = [await homonyms.nth(0).getAttribute("id"), await homonyms.nth(1).getAttribute("id")];
      expect(ids[0]).not.toBe(ids[1]);
      await browser.reload();
      await expect(homonyms).toHaveCount(2);
      expect([await homonyms.nth(0).getAttribute("id"), await homonyms.nth(1).getAttribute("id")]).toEqual(ids);
      const versions = await client.from("estimate_versions").select("id").eq("project_id", projectId);
      expect(versions.data).toEqual([]);
      await recordEvidence(army, `POSTE-${format}`, {
        projectId, filename, sha256: createHash("sha256").update(bytes).digest("hex"),
        sourceLocations, ids, versions: versions.data,
      });
    });
  }
});
