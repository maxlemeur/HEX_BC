import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect } from "e2e";
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
    expect(doc.issues).toEqual(expect.arrayContaining([expect.stringContaining("Aperçu et métré non disponibles")]));
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
