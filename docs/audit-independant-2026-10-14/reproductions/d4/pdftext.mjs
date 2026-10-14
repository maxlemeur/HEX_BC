// Lecture seule : extraction texte d'un PDF par lignes (regroupement par coordonnée y).
// Usage : node pdftext.mjs <fichier.pdf> [pageDebut] [pageFin]
import { pathToFileURL } from "node:url";
const pdfjs = await import(pathToFileURL("C:/Users/maxim/Projects/miaouffrage/node_modules/pdfjs-dist/legacy/build/pdf.mjs").href);
import fs from "node:fs";
const [, , file, p0, p1] = process.argv;
const data = new Uint8Array(fs.readFileSync(file));
const doc = await pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
const start = Number(p0 || 1), end = Math.min(Number(p1 || doc.numPages), doc.numPages);
console.log(`# pages=${doc.numPages}`);
for (let p = start; p <= end; p++) {
  const page = await doc.getPage(p);
  const tc = await page.getTextContent();
  const rows = new Map();
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round(it.transform[5]);
    const x = Math.round(it.transform[4]);
    let key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2);
    if (key === undefined) { key = y; rows.set(key, []); }
    rows.get(key).push({ x, s: it.str });
  }
  console.log(`=== page ${p}`);
  for (const y of [...rows.keys()].sort((a, b) => b - a)) {
    const items = rows.get(y).sort((a, b) => a.x - b.x);
    console.log(items.map((i) => `${i.s}`).join(" | "));
  }
}
