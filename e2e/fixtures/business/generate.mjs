// Reproducible fictional inputs. No original workbook or customer data is read.
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packages = process.env.ARTIFACT_TOOL_NODE_MODULES;
if (!packages) throw new Error("ARTIFACT_TOOL_NODE_MODULES must identify the bundled document runtime packages.");
const requireArtifact = createRequire(path.join(path.resolve(packages), ".business-fixture-resolver.cjs"));
const { Workbook, SpreadsheetFile } = await import(pathToFileURL(requireArtifact.resolve("@oai/artifact-tool")).href);
const JSZip = requireArtifact("jszip");
const directory = path.dirname(fileURLToPath(import.meta.url));
const previewDirectory = path.resolve(".e2e/army/hygiene-fixtures/previews");
const headers = ["N°", "Désignation", "Uté", "Qté", "Prix\nUnitaire", "Prix\nTotal", "PR Fourniture unitaire",
  "PR Total\nfourniture", "Tps pose unitaire", "Tps pose unitaire majoré", "Tps pose total",
  "Coeff FO", "Coeff MO", "Majoration MO", "Taux horaire"];
const specifications = [
  { name: "HYDRAULIQUE", filename: "optima-hydraulique-fictif.xlsx", sections: 130, priced: 785, filler: 1036,
    withoutQuantity: 46, statuses: [["HL", 61], ["inc", 9], ["CP", 1], ["NC", 7], ["PM", 1]] },
  { name: "PLOMBERIE", filename: "optima-plomberie-fictif.xlsx", sections: 231, priced: 656, filler: 81,
    withoutQuantity: 24, statuses: [["HL", 74], ["NC", 4], ["SO", 3], ["PM", 1]] },
];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
// ExcelJS's installed SAX readers match unprefixed element names. Artifact Tool
// uses the equivalent x: prefix. Normalize only that XML namespace spelling;
// values, formulas, cached results, styles and relationships remain authored by Artifact Tool.
async function normalizeSpreadsheetNamespace(destination) {
  const zip = await JSZip.loadAsync(await fs.readFile(destination));
  for (const entry of Object.values(zip.files)) {
    if (entry.dir || !/^xl\/(?:workbook\.xml|styles\.xml|sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(entry.name)) continue;
    const xml = await entry.async("string");
    zip.file(entry.name, xml.replace(/(<\/?)x:/g, "$1")
      .replace('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"',
        'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'));
  }
  await fs.writeFile(destination, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}
const manifest = { schemaVersion: "fictional-business-corpus-1", origin: "generated; no private inputs", files: [] };
await fs.mkdir(previewDirectory, { recursive: true });

for (const specification of specifications) {
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add(specification.name);
  const rows = [headers, [null, null, null, 0, null, null, null, null, null, null, null, 1.3, 1.3, 0, 40]];
  const statusTokens = specification.statuses.flatMap(([token, count]) => Array(count).fill(token));
  const sectionRows = [];
  const formulaRuns = [];
  let priced = 0;
  let status = 0;
  let filler = 0;
  for (let section = 0; section < specification.sections; section += 1) {
    if (section > 0) rows.push([null, `Sous-total fictif ${section}`, ...Array(13).fill(null)]);
    rows.push([null, `Section fictive ${String(section + 1).padStart(3, "0")}`, ...Array(13).fill(null)]);
    sectionRows.push(rows.length);
    const pricedEnd = Math.floor(specification.priced * (section + 1) / specification.sections);
    const firstPricedRow = rows.length + 1;
    while (priced < pricedEnd) {
      const quantity = 1 + priced % 5;
      const supply = (211 + 37 * (priced % 17)) / 100;
      const hours = (1 + priced % 5) / 8;
      rows.push([null, `Ligne fictive ${String(priced + 1).padStart(4, "0")}`, ["u", "ml", "m2"][priced % 3],
        quantity, null, null, supply, null, hours, null, null, null, null, null, null]);
      priced += 1;
    }
    if (firstPricedRow <= rows.length) formulaRuns.push([firstPricedRow, rows.length]);
    const statusEnd = Math.floor(statusTokens.length * (section + 1) / specification.sections);
    while (status < statusEnd) {
      rows.push([null, `Statut fictif ${String(status + 1).padStart(3, "0")}`, statusTokens[status],
        status < specification.withoutQuantity ? null : 1 + status % 3,
        0, 0, 7.25, 0, 0.375, 0, 0, null, null, null, null]);
      status += 1;
    }
    const fillerEnd = Math.floor(specification.filler * (section + 1) / specification.sections);
    while (filler < fillerEnd) {
      rows.push([null, `Réserve fictive ${String(filler + 1).padStart(4, "0")}`, "u", null,
        0, 0, 0, 0, 0, 0, 0, null, null, null, null]);
      filler += 1;
    }
  }
  rows.push([null, "Total fictif HT", ...Array(13).fill(null)]);
  sheet.getRange(`A1:O${rows.length}`).values = rows;
  sheet.showGridLines = false;
  sheet.getRange(`A1:O${rows.length}`).format.font = { name: "Arial", size: 10 };
  sheet.getRange("A1:O1").format = { font: { bold: true, color: "#FFFFFF" }, fill: "#334155", wrapText: true, rowHeight: 44 };
  sheet.getRange("A:A").format.columnWidth = 5;
  sheet.getRange("B:B").format.columnWidth = 32;
  sheet.getRange("C:C").format.columnWidth = 8;
  sheet.getRange("D:O").format.columnWidth = 17;
  sheet.getRange(`D2:O${rows.length}`).setNumberFormat("0.000");
  sheet.freezePanes.freezeRows(1);
  for (const row of sectionRows) sheet.getRange(`B${row}`).format.font = { bold: true };
  for (const [start, end] of formulaRuns) {
    const rowNumbers = Array.from({ length: end - start + 1 }, (_, index) => start + index);
    sheet.getRange(`E${start}:F${end}`).formulas = rowNumbers.map((row) =>
      [`=G${row}*$L$2+J${row}*$M$2*$O$2`, `=ROUND(D${row}*E${row},2)`]);
    sheet.getRange(`H${start}:H${end}`).formulas = rowNumbers.map((row) => [`=D${row}*G${row}`]);
    sheet.getRange(`J${start}:K${end}`).formulas = rowNumbers.map((row) => [`=I${row}*(1+$N$2)`, `=D${row}*J${row}`]);
  }
  workbook.recalculate();
  const inspected = await workbook.inspect({ kind: "table", range: `${specification.name}!D4:K5`, include: "values,formulas", tableMaxRows: 2, tableMaxCols: 8, maxChars: 1600 });
  if (!inspected.ndjson) throw new Error("Fixture inspection returned no table.");
  const errors = await workbook.inspect({ kind: "match", searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!",
    options: { useRegex: true, maxResults: 3 }, maxChars: 1000 });
  // Inspection is retained locally; the application parser regression verifies the exported results.
  await fs.writeFile(path.join(previewDirectory, `${specification.name}-inspection.txt`), `${inspected.ndjson}\n${errors.ndjson}\n`);
  const preview = await workbook.render({ sheetName: specification.name, range: "A1:G10", scale: 1, format: "png" });
  await fs.writeFile(path.join(previewDirectory, `${specification.name}.png`), new Uint8Array(await preview.arrayBuffer()));
  const output = await SpreadsheetFile.exportXlsx(workbook);
  const destination = path.join(directory, specification.filename);
  await output.save(destination);
  await normalizeSpreadsheetNamespace(destination);
  try {
    await fs.rename(`${destination}.inspect.ndjson`, path.join(previewDirectory, `${specification.name}-export-inspection.ndjson`));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const bytes = await fs.readFile(destination);
  manifest.files.push({ file: specification.filename, bytes: bytes.length, sha256: digest(bytes),
    semanticSha256: digest(JSON.stringify({ rows, formulaRuns, sectionRows })) });
  console.log(`${specification.filename}: ${bytes.length} bytes, ${specification.sections} sections, ${specification.priced} priced lines`);
}

const csvRows = [["ID", "Materiau", "Dimension", "Caracteristique", "Precision", "Unite", "F1_nom", "F1_prix", "F1_ref", "F1_URL", "Devise"]];
for (let index = 0; index < 539; index += 1) {
  csvRows.push([`FICTIF-${String(index + 1).padStart(4, "0")}`, "Élément fictif", `DN ${10 + index % 9 * 5}`, "Finition inventée", "Recette publique", "u",
    index < 127 ? `Fournisseur fictif ${1 + index % 2}` : "",
    index < 127 ? ((1137 + 29 * index) / 100).toFixed(2).replace(".", ",") : "",
    index < 127 ? `REF-FICTIVE-${index + 1}` : "", index < 127 ? `https://supplier.example.invalid/article/${index + 1}` : "", "EUR"]);
}
const csvBytes = Buffer.from(csvRows.map((row) => row.join(";")).join("\r\n") + "\r\n", "latin1");
await fs.writeFile(path.join(directory, "bdc-fictif.csv"), csvBytes);
manifest.files.push({ file: "bdc-fictif.csv", bytes: csvBytes.length, sha256: digest(csvBytes) });
await fs.writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log("bdc-fictif.csv: Windows-1252, 539 rows, 127 supplier prices, 412 unpriced");
