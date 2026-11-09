import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "e2e";
import { PDFDocument } from "pdf-lib";
import { circle, dxfBytes, insert, layer, line, lwpolyline, text } from "@/lib/cad/dxf.test-utils";
import { armyTest, createEstimateViaWizard, recordEvidence } from "../critical/fixtures";
import { localClient } from "../takeoff/native-ui";

armyTest("CAD01 accepts DWG DXF RVT originals without claiming extraction", {
  session: "army", trace: "off", tags: ["critical", "intake-cad", "local"], timeout: 180_000,
}, async (ui) => {
  const { army, app, browser, screen } = ui;
  const ids = await createEstimateViaWizard(ui, { projectName: `${army.runPrefix}-CAD01`, title: "Originaux CAO/BIM" }, army);
  const { client } = await localClient();
  const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", army.runPrefix);
  await mkdir(directory, { recursive: true });
  // Transport fixtures only: no claim that these synthetic bytes are valid CAD models.
  const files = [
    { name: "reseaux.DWG", bytes: Buffer.from("AC1032\0fixture-original") },
    { name: "reseaux.dxf", bytes: Buffer.from("0\nSECTION\n2\nHEADER\n0\nENDSEC\n0\nEOF\n") },
    { name: "maquette.rvt", bytes: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 1]) },
  ];
  for (const file of files) await writeFile(path.join(directory, file.name), file.bytes);
  await app.open(`/dashboard/affaires/${ids.projectId}`);
  // A real client interaction proves hydration before setting the hidden file input.
  await screen.getByRole("button", "Modifier la fiche", { exact: true }).click();
  await expect(screen.getByRole("button", "Annuler", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Annuler", { exact: true }).click();
  const upload = browser.locator('input[type="file"][aria-label="Ajouter des pièces à l\'affaire"]').first();
  await expect(upload).toHaveAttribute("accept", /\.dwg.*\.dxf.*\.rvt/);
  await upload.setInputFiles(files.map(file => path.join(directory, file.name)));
  const documents = async () => {
    const result = await client.from("affaire_intake_documents")
      .select("id,file_name,mime_type,storage_path,upload_status,classification_status,classification_source,document_kind,issues")
      .eq("project_id", ids.projectId);
    if (result.error) throw new Error(`Owned CAD read failed: ${result.error.code}`);
    return result.data;
  };
  await expect.poll(async () => (await documents()).filter(doc => doc.upload_status === "uploaded"
    && doc.classification_status === "ambiguous").length, { timeout: 60_000 }).toBe(3);
  const rows = await documents();
  for (const file of files) {
    const doc = rows.find(row => row.file_name === file.name)!;
    expect(doc).toMatchObject({ mime_type: "application/octet-stream", document_kind: "plans", classification_source: "heuristic" });
    // A DXF is read in the browser once opened; a DWG or an RVT is only kept.
    const notice = file.name.endsWith(".dxf") ? "Original DXF conservé" : "Aperçu et métré non disponibles";
    expect(doc.issues).toEqual(expect.arrayContaining([expect.stringContaining(notice)]));
    const stored = await client.storage.from("affaire-intake").download(doc.storage_path!);
    expect(stored.error).toBeNull();
    expect(createHash("sha256").update(Buffer.from(await stored.data!.arrayBuffer())).digest("hex"))
      .toBe(createHash("sha256").update(file.bytes).digest("hex"));
    const source = `/api/affaires/${ids.projectId}/intake/files/${doc.id}/preview`;
    const response = await browser.evaluate(async (url) => {
      const preview = await fetch(url);
      const download = await fetch(`${url}?download=1`);
      return { previewStatus: preview.status, downloadStatus: download.status,
        disposition: download.headers.get("content-disposition"),
        bytes: Array.from(new Uint8Array(await download.arrayBuffer())) };
    }, source);
    expect(response.previewStatus).toBe(400);
    expect(response.downloadStatus).toBe(200);
    expect(response.disposition).toContain("attachment;");
    expect(response.bytes).toEqual([...file.bytes]);
  }
  await recordEvidence(army, "cad-originals", { files: rows.map(doc => ({ name: doc.file_name, status: doc.classification_status })),
    scope: "Synthetic binary transport, persistence and download; no native CAD parsing or model validation." });
});

// A fictional plumbing plan in millimetres: 20 m of drains, 12 m of supply, three basins of one block, and its scale written on it.
const FICTIONAL_PLAN = dxfBytes({
  layers: [layer("0"), layer("EU-Evacuations", 1), layer("EF-Alimentation", 5), layer("Appareils", 3), layer("Cartouche", 7)],
  blocks: [{ name: "LAVABO", entities: [circle("0", 0, 0, 250)] }],
  entities: [
    lwpolyline("EU-Evacuations", [[0, 0], [12000, 0], [12000, 8000]]),
    line("EF-Alimentation", 0, 2000, 9000, 2000),
    line("EF-Alimentation", 9000, 2000, 9000, 5000),
    insert("Appareils", "LAVABO", 3000, 2000),
    insert("Appareils", "LAVABO", 6000, 2000),
    insert("Appareils", "LAVABO", 9000, 5000),
    text("Cartouche", 0, -1500, 250, "Plan fictif - Echelle 1/50"),
  ],
});

armyTest("CAD02 reads a DXF of the dossier: layers, quantities and a scaled PDF for the métré", {
  session: "army", trace: "off", tags: ["critical", "intake-cad", "local"], timeout: 240_000,
}, async (ui) => {
  const { army, app, browser, screen } = ui;
  const ids = await createEstimateViaWizard(ui, { projectName: `${army.runPrefix}-CAD02`, title: "Plan DXF fictif" }, army);
  const { client } = await localClient();
  const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", army.runPrefix);
  await mkdir(directory, { recursive: true });
  const fileName = "reseaux-fictifs.dxf", plotName = "reseaux-fictifs (tracé 1-50).pdf";
  await writeFile(path.join(directory, fileName), FICTIONAL_PLAN);
  await app.open(`/dashboard/affaires/${ids.projectId}`);
  // A real client interaction proves hydration before setting the hidden file input.
  await screen.getByRole("button", "Modifier la fiche", { exact: true }).click();
  await expect(screen.getByRole("button", "Annuler", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Annuler", { exact: true }).click();
  await browser.locator('input[type="file"][aria-label="Ajouter des pièces à l\'affaire"]').first().setInputFiles(path.join(directory, fileName));
  const stored = async (name: string) => {
    const result = await client.from("affaire_intake_documents").select("id,mime_type,storage_path,upload_status")
      .eq("project_id", ids.projectId).eq("file_name", name);
    if (result.error) throw new Error(`Owned CAD read failed: ${result.error.code}`);
    return result.data.filter(doc => doc.upload_status === "uploaded");
  };
  await expect.poll(async () => (await stored(fileName)).length, { timeout: 60_000 }).toBe(1);
  const [original] = await stored(fileName);

  // The drawing is read in the browser and drawn in the preview of the dossier.
  await app.open(`/dashboard/affaires/${ids.projectId}?intakeDocument=${original.id}#intake`);
  await expect(screen.getByRole("dialog", "Documents du dossier", { exact: true })).toBeVisible();
  await expect(screen.getByText("4 calques · 32 m de tracé · 3 blocs", { exact: true })).toBeVisible({ timeout: 60_000 });
  const inked = () => browser.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".document-cad-stage-large > canvas") ?? document.querySelector<HTMLCanvasElement>(".document-cad-stage > canvas");
    const pixels = canvas?.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let at = 0; pixels && at < pixels.length; at += 4) if (pixels[at + 3] > 0 && pixels[at] + pixels[at + 1] + pixels[at + 2] < 720) count += 1;
    return count;
  });
  await expect.poll(inked, { timeout: 15_000 }).toBeGreaterThan(200);
  const compact = await app.screenshot("cad02-preview");

  await screen.getByRole("button", "Calques et quantités", { exact: true }).click();
  await expect(screen.getByRole("heading", "Quantités lues", { exact: true })).toBeVisible();
  const totals = () => browser.evaluate(() => Object.fromEntries([...document.querySelectorAll(".document-cad-panel dl > div")]
    .map(row => [row.querySelector("dt")?.textContent ?? "", row.querySelector("dd")?.textContent ?? ""])));
  expect(await totals()).toEqual({ "Tracé": "32 m", "Tracé des blocs": "4,71 m", "Contours fermés": "0,59 m²", "Blocs posés": "3" });
  await expect.poll(inked, { timeout: 15_000 }).toBeGreaterThan(200);
  // The picture is taken once the window has finished opening.
  await expect.poll(() => browser.evaluate(() => getComputedStyle(document.querySelector(".document-cad-dialog") ?? document.body).opacity)).toBe("1");
  const large =await app.screenshot("cad02-layers-and-quantities");
  // Hiding a layer takes its length out of what is read, and showing it again brings it back.
  await screen.getByRole("checkbox", /EF-Alimentation/).uncheck();
  await expect.poll(async () => (await totals())["Tracé"]).toBe("20 m");
  await screen.getByRole("button", "Tout afficher", { exact: true }).click();
  await expect.poll(async () => (await totals())["Tracé"]).toBe("32 m");

  // The plotted PDF joins the dossier at the scale the plan announces.
  await screen.getByRole("button", "Ajouter le tracé PDF au dossier", { exact: true }).click();
  await expect(screen.getByText(`« ${plotName} » est dans le dossier : 1/50 sur une feuille de 260 × 224 mm.`, { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByText("L’échelle est celle que le plan annonce.", { exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(plotName)).length, { timeout: 60_000 }).toBe(1);
  const [plot] = await stored(plotName);
  expect(plot.mime_type).toBe("application/pdf");
  const download = await client.storage.from("affaire-intake").download(plot.storage_path!);
  expect(download.error).toBeNull();
  const pages = (await PDFDocument.load(await download.data!.arrayBuffer())).getPages();
  expect(pages).toHaveLength(1);
  // 260 × 224 mm in points: at 1/50 a millimetre of the sheet is 50 mm of the plan.
  const { width, height } = pages[0].getSize();
  expect(Math.abs(width - 260 * 72 / 25.4)).toBeLessThan(0.5);
  expect(Math.abs(height - 224 * 72 / 25.4)).toBeLessThan(0.5);
  await recordEvidence(army, "cad-drawing", { original: fileName, plot: plotName, sheet_mm: [260, 224], scale: "1/50",
    totals: { length_m: 32, blockLength_m: 4.71, blocks: 3 }, screenshots: [compact, large].map(file => path.basename(file)),
    scope: "Fictional DXF read in the browser: layers, quantities, and its plotted PDF added to the dossier. No DWG or RVT geometry." });
});
