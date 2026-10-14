// Rend les pages d'un PDF en PNG (pdfjs-dist + @napi-rs/canvas du dépôt), pour contrôle visuel.
// Usage : node render-pdf.mjs <fichier.pdf> <dossier sortie> [échelle]
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repo = "C:/Users/maxim/Projects/miaouffrage";
const require = createRequire(path.join(repo, "package.json"));
const { createCanvas } = require("@napi-rs/canvas");
const pdfjs = await import("file:///" + repo + "/node_modules/pdfjs-dist/legacy/build/pdf.mjs");

const [file, outDir, scaleArg] = process.argv.slice(2);
const scale = Number(scaleArg ?? 1.3);
fs.mkdirSync(outDir, { recursive: true });
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)) }).promise;
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  fs.writeFileSync(path.join(outDir, `page-${String(p).padStart(2, "0")}.png`), canvas.toBuffer("image/png"));
}
console.log(`${doc.numPages} pages rendues`);
