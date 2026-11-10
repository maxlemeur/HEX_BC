import { createHash } from "node:crypto";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "e2e";
import { PDFDocument } from "pdf-lib";
import { circle, dxfBytes, insert, layer, line, lwpolyline, text } from "@/lib/cad/dxf.test-utils";
import { BOILER_ROOM, SKETCHED_ROOM, documentXml, fcstd } from "@/lib/cad/fcstd.test-utils";
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
    // A DXF is read in the browser once opened, a DWG once the server has converted it; an RVT is only kept.
    const notice = file.name.endsWith(".dxf") ? "Original DXF conservé" : file.name.endsWith(".DWG") ? "Original DWG conservé" : "Aperçu et métré non disponibles";
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

armyTest("CAD03 converts a DWG of the dossier and reads it: layers, quantities and a scaled PDF for the métré", {
  session: "army", trace: "off", tags: ["critical", "intake-cad", "local"], timeout: 300_000,
}, async (ui) => {
  const { army, app, browser, screen } = ui;
  const ids = await createEstimateViaWizard(ui, { projectName: `${army.runPrefix}-CAD03`, title: "Plan DWG" }, army);
  const { client } = await localClient();
  const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", army.runPrefix);
  await mkdir(directory, { recursive: true });
  // LibreDWG's own sample drawing (src/test/fixtures/cad/NOTICE.md) as saved in the 2018 and in the 2000 format, and the
  // first bytes of a DWG saved by AutoCAD R12.
  const fileName = "tables-libredwg.dwg", olderName = "tables-libredwg-2000.dwg", oldName = "format-r12.dwg", plotName = "tables-libredwg (tracé 1-5000).pdf";
  await copyFile(path.resolve("src/test/fixtures/cad/libredwg-example-2018.dwg"), path.join(directory, fileName));
  await copyFile(path.resolve("src/test/fixtures/cad/libredwg-example-2000.dwg"), path.join(directory, olderName));
  await writeFile(path.join(directory, oldName), Buffer.concat([Buffer.from("AC1009"), Buffer.alloc(4090)]));
  await app.open(`/dashboard/affaires/${ids.projectId}`);
  // A real client interaction proves hydration before setting the hidden file input.
  await screen.getByRole("button", "Modifier la fiche", { exact: true }).click();
  await expect(screen.getByRole("button", "Annuler", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Annuler", { exact: true }).click();
  await browser.locator('input[type="file"][aria-label="Ajouter des pièces à l\'affaire"]').first()
    .setInputFiles([fileName, olderName, oldName].map(name => path.join(directory, name)));
  const stored = async (name: string) => {
    const result = await client.from("affaire_intake_documents").select("id,mime_type,storage_path,upload_status,issues")
      .eq("project_id", ids.projectId).eq("file_name", name);
    if (result.error) throw new Error(`Owned CAD read failed: ${result.error.code}`);
    return result.data.filter(doc => doc.upload_status === "uploaded");
  };
  await expect.poll(async () => (await stored(fileName)).length + (await stored(olderName)).length + (await stored(oldName)).length, { timeout: 60_000 }).toBe(3);
  const [original] = await stored(fileName), [older] = await stored(olderName), [old] = await stored(oldName);
  // The notice comes with the classification, a moment after the deposit.
  await expect.poll(async () => (await stored(fileName))[0]?.issues ?? [], { timeout: 60_000 })
    .toEqual(expect.arrayContaining([expect.stringContaining("Original DWG conservé")]));

  // The server converts the DWG, and the browser reads its DXF like any other.
  await app.open(`/dashboard/affaires/${ids.projectId}?intakeDocument=${original.id}#intake`);
  await expect(screen.getByRole("dialog", "Documents du dossier", { exact: true })).toBeVisible();
  await expect(screen.getByText("3 calques · 103,63 m de tracé · 10 blocs", { exact: true })).toBeVisible({ timeout: 120_000 });
  const inked = () => browser.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".document-cad-stage-large > canvas") ?? document.querySelector<HTMLCanvasElement>(".document-cad-stage > canvas");
    const pixels = canvas?.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let at = 0; pixels && at < pixels.length; at += 4) if (pixels[at + 3] > 0 && pixels[at] + pixels[at + 1] + pixels[at + 2] < 720) count += 1;
    return count;
  });
  await expect.poll(inked, { timeout: 15_000 }).toBeGreaterThan(200);
  const compact = await app.screenshot("cad03-preview");

  await screen.getByRole("button", "Calques et quantités", { exact: true }).click();
  await expect(screen.getByRole("heading", "Quantités lues", { exact: true })).toBeVisible();
  await expect(screen.getByText("DWG AutoCAD 2018, converti par LibreDWG · 3 calques · 103,63 m de tracé · 10 blocs", { exact: true })).toBeVisible();
  // The spaces of a French number are not those of the keyboard.
  const totals = () => browser.evaluate(() => Object.fromEntries([...document.querySelectorAll(".document-cad-panel dl > div")]
    .map(row => [row.querySelector("dt")?.textContent ?? "", (row.querySelector("dd")?.textContent ?? "").replace(/\s/g, " ")])));
  // AutoCAD's own DXF of this drawing gives the same blocks, block tracé, contours and hatch; its tracé is 103,94 m,
  // the two splines being kept by their fit points in a DWG, which the viewer says.
  expect(await totals()).toEqual({ "Tracé": "103,63 m", "Tracé des blocs": "6 019,55 m", "Contours fermés": "133,6 m²", "Hachures": "0,12 m²", "Blocs posés": "10" });
  await expect(screen.getByText("2 splines sont tracées par leurs points de passage : leur longueur est approchée.", { exact: true })).toBeVisible();
  await expect.poll(inked, { timeout: 15_000 }).toBeGreaterThan(200);
  await expect.poll(() => browser.evaluate(() => getComputedStyle(document.querySelector(".document-cad-dialog") ?? document.body).opacity)).toBe("1");
  const large = await app.screenshot("cad03-layers-and-quantities");
  await screen.getByRole("checkbox", /Tavolo 2/).uncheck();
  await expect.poll(async () => (await totals())["Tracé"]).toBe("88,55 m");
  await screen.getByRole("button", "Tout afficher", { exact: true }).click();
  await expect.poll(async () => (await totals())["Tracé"]).toBe("103,63 m");

  // The plotted PDF of the converted drawing joins the dossier, to scale.
  await screen.getByRole("button", "Ajouter le tracé PDF au dossier", { exact: true }).click();
  await expect(screen.getByText(`« ${plotName} » est dans le dossier : 1/5000 sur une feuille de 703 × 586 mm.`, { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => (await stored(plotName)).length, { timeout: 60_000 }).toBe(1);
  const [plot] = await stored(plotName);
  const download = await client.storage.from("affaire-intake").download(plot.storage_path!);
  expect(download.error).toBeNull();
  const pages = (await PDFDocument.load(await download.data!.arrayBuffer())).getPages();
  expect(pages).toHaveLength(1);
  const { width, height } = pages[0].getSize();
  expect(Math.abs(width - 703 * 72 / 25.4)).toBeLessThan(0.5);
  expect(Math.abs(height - 586 * 72 / 25.4)).toBeLessThan(0.5);

  // The same drawing saved in the 2000 format is read with the same quantities: LibreDWG reads it, and its DXF is written from that reading.
  await app.open(`/dashboard/affaires/${ids.projectId}?intakeDocument=${older.id}#intake`);
  await expect(screen.getByRole("dialog", "Documents du dossier", { exact: true })).toBeVisible();
  await expect(screen.getByText("3 calques · 103,63 m de tracé · 10 blocs", { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect.poll(inked, { timeout: 15_000 }).toBeGreaterThan(200);
  await screen.getByRole("button", "Calques et quantités", { exact: true }).click();
  await expect(screen.getByText("DWG AutoCAD 2000, converti par LibreDWG · 3 calques · 103,63 m de tracé · 10 blocs", { exact: true })).toBeVisible();
  expect(await totals()).toEqual({ "Tracé": "103,63 m", "Tracé des blocs": "6 019,55 m", "Contours fermés": "133,6 m²", "Hachures": "0,12 m²", "Blocs posés": "10" });
  await expect.poll(inked, { timeout: 15_000 }).toBeGreaterThan(200);
  await expect.poll(() => browser.evaluate(() => getComputedStyle(document.querySelector(".document-cad-dialog") ?? document.body).opacity)).toBe("1");
  const olderFormat = await app.screenshot("cad03-format-2000");

  // The conversion is the dossier's: it answers who reads the affaire, says what it does not convert, and nothing else.
  const drawing = (documentId: string) => `/api/affaires/${ids.projectId}/intake/files/${documentId}/drawing`;
  const answers = await browser.evaluate(async ([converted, read, refused, plotted]) => {
    const ask = async (url: string, credentials: RequestCredentials = "same-origin") => {
      const response = await fetch(url, { credentials });
      const body = await response.text();
      return { status: response.status, type: response.headers.get("content-type"), cache: response.headers.get("cache-control"),
        start: body.slice(0, 16), code: response.ok ? null : (JSON.parse(body) as { error?: { code?: string } }).error?.code ?? null };
    };
    return { converted: await ask(converted), read: await ask(read), anonymous: await ask(converted, "omit"), refused: await ask(refused), plotted: await ask(plotted) };
  }, [drawing(original.id), drawing(older.id), drawing(old.id), drawing(plot.id)]);
  expect(answers.converted).toMatchObject({ status: 200, type: expect.stringContaining("text/plain"), cache: "private, no-store", code: null });
  // LibreDWG signs the DXF it writes on its first two lines.
  expect(answers.converted.start.replace(/\s+/g, " ")).toMatch(/^999 LibreDWG/);
  // The DXF of an older format is not LibreDWG's own: it starts with the header the conversion writes.
  expect(answers.read).toMatchObject({ status: 200, type: expect.stringContaining("text/plain"), cache: "private, no-store", code: null });
  expect(answers.read.start.replace(/\s+/g, " ")).toMatch(/^0 SECTION 2 HEAD/);
  expect(answers.anonymous.status).toBe(401);
  expect(answers.refused).toMatchObject({ status: 422, code: "DWG_CONVERSION_OLD_FORMAT", cache: "private, no-store" });
  expect(answers.plotted).toMatchObject({ status: 400, code: "CAD_DRAWING_NOT_DWG" });

  // A DWG the converter does not take keeps what its file says, with the way out.
  await app.open(`/dashboard/affaires/${ids.projectId}?intakeDocument=${old.id}#intake`);
  await expect(screen.getByRole("dialog", "Documents du dossier", { exact: true })).toBeVisible();
  await expect(screen.getByText("Format DWG AutoCAD R11/R12", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByText("Ce DWG est enregistré dans un format antérieur à AutoCAD R13, que MergeOne ne convertit pas. Enregistrez-le au format DWG 2000 ou plus récent, ou en DXF, puis déposez-le à nouveau.", { exact: true })).toBeVisible();
  const refused = await app.screenshot("cad03-old-format");
  await recordEvidence(army, "cad-dwg", { original: fileName, sha256: createHash("sha256").update(await client.storage.from("affaire-intake").download(original.storage_path!).then(async file => Buffer.from(await file.data!.arrayBuffer()))).digest("hex"),
    plot: plotName, sheet_mm: [703, 586], scale: "1/5000",
    totals: { length_m: 103.63, blockLength_m: 6019.55, closedArea_m2: 133.6, hatchArea_m2: 0.12, blocks: 10 },
    screenshots: [compact, large, olderFormat, refused].map(file => path.basename(file)),
    scope: "LibreDWG's sample DWG (AutoCAD 2018) converted on the server in a locked process and read in the browser: layers, quantities, plotted PDF. The same drawing saved in the 2000 format is read by LibreDWG in the same locked process, its DXF written from that reading, with the same quantities. A DWG in the R12 format is refused by name. No RVT geometry." });
});

// The image a model carries: 64 × 48 pixels, a blue rectangle on grey, made for this journey.
const FICTIONAL_THUMBNAIL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAUElEQVR42u3YMQ0AIBAEwTeDMowhkIICAa8CkksmWQPTbu1zoysAAAAAAACAAMCY638AAAAAAAAAAAAAAAAAAAAAAAAA6QBzFwAAAAAA4EUNNR3xf74aap4AAAAASUVORK5CYII=", "base64");

armyTest("CAD04 reads a FreeCAD model of the dossier: objects with their dimensions, sketches measured and plotted", {
  session: "army", trace: "off", tags: ["critical", "intake-cad", "local"], timeout: 300_000,
}, async (ui) => {
  const { army, app, browser, screen } = ui;
  const ids = await createEstimateViaWizard(ui, { projectName: `${army.runPrefix}-CAD04`, title: "Maquette FreeCAD fictive" }, army);
  const { client } = await localClient();
  const directory = path.resolve(".e2e/army/critical/artifacts/fixtures", army.runPrefix);
  await mkdir(directory, { recursive: true });
  // Two fictional documents written in the shape FreeCAD saves, no real model: a boiler room with two sketches
  // (its walls, 4 m by 2 m, and a hole of 250 mm in radius), and the same room without a sketch but with its image.
  const fileName = "chaufferie-fictive.FCStd", plainName = "ballon-fictif.fcstd", plotName = "chaufferie-fictive (tracé 1-20).pdf";
  const bytes = fcstd(documentXml(SKETCHED_ROOM));
  await writeFile(path.join(directory, fileName), bytes);
  await writeFile(path.join(directory, plainName), fcstd(documentXml(BOILER_ROOM), { "thumbnails/Thumbnail.png": FICTIONAL_THUMBNAIL }));
  await app.open(`/dashboard/affaires/${ids.projectId}`);
  // A real client interaction proves hydration before setting the hidden file input.
  await screen.getByRole("button", "Modifier la fiche", { exact: true }).click();
  await expect(screen.getByRole("button", "Annuler", { exact: true })).toBeVisible();
  await screen.getByRole("button", "Annuler", { exact: true }).click();
  const upload = browser.locator('input[type="file"][aria-label="Ajouter des pièces à l\'affaire"]').first();
  await expect(upload).toHaveAttribute("accept", /\.fcstd/);
  await upload.setInputFiles([fileName, plainName].map(name => path.join(directory, name)));
  const stored = async (name: string) => {
    const result = await client.from("affaire_intake_documents").select("id,mime_type,storage_path,upload_status,document_kind,issues")
      .eq("project_id", ids.projectId).eq("file_name", name);
    if (result.error) throw new Error(`Owned CAD read failed: ${result.error.code}`);
    return result.data.filter(doc => doc.upload_status === "uploaded");
  };
  await expect.poll(async () => (await stored(fileName)).length + (await stored(plainName)).length, { timeout: 60_000 }).toBe(2);
  // The notice comes with the classification, a moment after the deposit.
  await expect.poll(async () => (await stored(fileName))[0]?.issues ?? [], { timeout: 60_000 })
    .toEqual(expect.arrayContaining([expect.stringContaining("Original FreeCAD conservé")]));
  const [original] = await stored(fileName), [plain] = await stored(plainName);
  expect(original).toMatchObject({ mime_type: "application/octet-stream", document_kind: "plans" });
  // The dossier keeps the archive as it was deposited.
  const kept = await client.storage.from("affaire-intake").download(original.storage_path!);
  expect(kept.error).toBeNull();
  expect(createHash("sha256").update(Buffer.from(await kept.data!.arrayBuffer())).digest("hex")).toBe(createHash("sha256").update(bytes).digest("hex"));

  // The sketches are read in the browser and drawn in the preview of the dossier, one layer a sketch.
  await app.open(`/dashboard/affaires/${ids.projectId}?intakeDocument=${original.id}#intake`);
  await expect(screen.getByRole("dialog", "Documents du dossier", { exact: true })).toBeVisible();
  await expect(screen.getByText("2 calques · 13,57 m de tracé", { exact: true })).toBeVisible({ timeout: 60_000 });
  const inked = () => browser.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".document-cad-stage-large > canvas") ?? document.querySelector<HTMLCanvasElement>(".document-cad-stage > canvas");
    const pixels = canvas?.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let at = 0; pixels && at < pixels.length; at += 4) if (pixels[at + 3] > 0 && pixels[at] + pixels[at + 1] + pixels[at + 2] < 720) count += 1;
    return count;
  });
  await expect.poll(inked, { timeout: 15_000 }).toBeGreaterThan(200);
  const compact = await app.screenshot("cad04-sketches-preview");

  await screen.getByRole("button", "Calques et quantités", { exact: true }).click();
  await expect(screen.getByRole("heading", "Quantités lues", { exact: true })).toBeVisible();
  await expect(screen.getByText(/^Esquisses de la maquette FreeCAD 1\.0 · /)).toBeVisible();
  const totals = () => browser.evaluate(() => Object.fromEntries([...document.querySelectorAll(".document-cad-panel dl > div")]
    .map(row => [row.querySelector("dt")?.textContent ?? "", row.querySelector("dd")?.textContent ?? ""])));
  expect(await totals()).toEqual({ "Tracé": "13,57 m", "Contours fermés": "0,2 m²" });
  // What the model holds is listed beside its sketches: the pipe's length is the one FreeCAD wrote, 4 250,5 mm.
  const table = (label: string) => browser.evaluate((name) => [...document.querySelectorAll(`.document-cad-dialog table[aria-label="${name}"] tbody tr`)]
    .map(row => [...row.querySelectorAll("td")].map(cell => (cell.textContent ?? "").replace(/\s/gu, " "))), label);
  expect(await table("Objets par nature")).toEqual([["SketchObject", "2", ""], ["Box", "1", "0,8 m"], ["Pipe Segment", "1", "4,25 m"], ["Wall", "1", ""], ["Wire", "1", ""]]);
  expect(await table("Objets et dimensions")).toEqual(expect.arrayContaining([["Départ chauffage", "Pipe Segment", "Diamètre 33,7 mm · Longueur 4 250,5 mm"]]));
  await expect.poll(inked, { timeout: 15_000 }).toBeGreaterThan(200);
  // The picture is taken once the window has finished opening.
  await expect.poll(() => browser.evaluate(() => getComputedStyle(document.querySelector(".document-cad-dialog") ?? document.body).opacity)).toBe("1");
  const large = await app.screenshot("cad04-sketches-and-objects");
  // A sketch is a layer: hiding the holes leaves the four walls.
  await screen.getByRole("checkbox", /Réservations/).uncheck();
  await expect.poll(async () => (await totals())["Tracé"]).toBe("12 m");
  await screen.getByRole("button", "Tout afficher", { exact: true }).click();
  await expect.poll(async () => (await totals())["Tracé"]).toBe("13,57 m");

  // The sketches are plotted to scale like any drawing, and the PDF joins the dossier.
  await screen.getByRole("button", "Ajouter le tracé PDF au dossier", { exact: true }).click();
  await expect(screen.getByText(`« ${plotName} » est dans le dossier : 1/20 sur une feuille de 220 × 210 mm.`, { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByText("Le plan n’annonce pas d’échelle : c’est la plus grande qui tient sur une feuille A0.", { exact: true })).toBeVisible();
  await expect.poll(async () => (await stored(plotName)).length, { timeout: 60_000 }).toBe(1);
  const [plot] = await stored(plotName);
  expect(plot.mime_type).toBe("application/pdf");
  const download = await client.storage.from("affaire-intake").download(plot.storage_path!);
  expect(download.error).toBeNull();
  const pages = (await PDFDocument.load(await download.data!.arrayBuffer())).getPages();
  expect(pages).toHaveLength(1);
  // 220 × 210 mm in points: at 1/20 the room of 4 m is 200 mm wide on the sheet.
  const { width, height } = pages[0].getSize();
  expect(Math.abs(width - 220 * 72 / 25.4)).toBeLessThan(0.5);
  expect(Math.abs(height - 210 * 72 / 25.4)).toBeLessThan(0.5);

  // A model without a sketch shows the image it carries, and lists its objects in the large view.
  await app.open(`/dashboard/affaires/${ids.projectId}?intakeDocument=${plain.id}#intake`);
  await expect(screen.getByRole("dialog", "Documents du dossier", { exact: true })).toBeVisible();
  await expect(screen.getByText("Maquette FreeCAD 1.0", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(screen.getByText("4 objets", { exact: true })).toBeVisible();
  await expect.poll(() => browser.evaluate(() => document.querySelector<HTMLImageElement>(".document-cad-summary img")?.naturalWidth ?? 0), { timeout: 15_000 }).toBe(64);
  await screen.getByRole("button", "Objets et dimensions", { exact: true }).click();
  await expect(screen.getByRole("heading", "Objets de la maquette", { exact: true })).toBeVisible();
  expect(await table("Objets par nature")).toEqual([["Box", "1", "0,8 m"], ["Pipe Segment", "1", "4,25 m"], ["Wall", "1", ""], ["Wire", "1", ""]]);
  expect(await table("Objets et dimensions")).toEqual(expect.arrayContaining([["Mur étanche", "Wall", "Surface horizontale 1,2 m² · Volume 3 m³ · Angle 90°"]]));
  await expect.poll(() => browser.evaluate(() => getComputedStyle(document.querySelector(".document-cad-dialog") ?? document.body).opacity)).toBe("1");
  const objects = await app.screenshot("cad04-model-objects");
  await recordEvidence(army, "cad-freecad", { originals: [fileName, plainName], plot: plotName, sheet_mm: [220, 210], scale: "1/20",
    totals: { sketches: 2, length_m: 13.57, objects: 6 }, screenshots: [compact, large, objects].map(file => path.basename(file)),
    scope: "Fictional FreeCAD documents read in the browser: objects with the dimensions the file gives, sketches drawn and measured by layer, and their plotted PDF added to the dossier. No solid is measured." });
});
