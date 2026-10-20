import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Real deployment regression: a full node_modules checkout hides missing traced
// dependencies. Reconstruct only the PDF route's traced packages, outside the
// checkout, and render a real PDF there. No auth, database or providers are used.
const root = process.cwd();
const distDir = process.env.PERFORMANCE_BUILD_DIR?.trim() || (process.env.E2E_ARMY === "1" ? ".e2e/army/next" : ".next");
const trace = path.resolve(root, process.argv[2] ?? path.join(distDir, "server/app/api/estimates/[versionId]/pdf/route.js.nft.json"));
const reportPath = process.argv[3] ? path.resolve(process.argv[3]) : null;
const rawTrace = await readFile(trace);
const manifest = JSON.parse(rawTrace);
const temporary = await mkdtemp(path.join(os.tmpdir(), "mergeone-pdf-runtime-"));
const started = performance.now();
const report = { trace: path.relative(root, trace), traceSha256: createHash("sha256").update(rawTrace).digest("hex"),
  copiedFiles: 0, result: "failed", elapsedMs: 0 };

try {
  if (!process.argv[2]) {
    const appDirectory = path.resolve(root, distDir, "server/app");
    const fontsDirectory = path.resolve(root, "node_modules/pdfkit/js/standard-fonts");
    const requiredFonts = (await readdir(fontsDirectory, { recursive: true })).filter(file => file.endsWith(".cjs"));
    let checkedTraces = 0;
    for (const file of await readdir(appDirectory, { recursive: true })) {
      if (!file.endsWith(".nft.json")) continue;
      const candidate = path.join(appDirectory, file);
      const files = JSON.parse(await readFile(candidate, "utf8")).files;
      const sources = new Set(files.map(file => path.resolve(path.dirname(candidate), file)));
      if (![...sources].some(file => file.includes(`${path.sep}node_modules${path.sep}pdfkit${path.sep}`))) continue;
      for (const font of requiredFonts) assert(sources.has(path.join(fontsDirectory, font)), `${file} omits PDFKit font ${font}`);
      checkedTraces++;
    }
    assert(checkedTraces > 0, "The application must trace its PDF renderer.");
    report.checkedTraces = checkedTraces;
  }
  for (const file of manifest.files) {
    const source = path.resolve(path.dirname(trace), file);
    const relative = path.relative(root, source);
    if (!relative.startsWith(`node_modules${path.sep}`)) continue;
    const destination = path.join(temporary, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);
    report.copiedFiles++;
  }
  assert(report.copiedFiles > 0, "The PDF route must trace its runtime packages.");
  const probe = path.join(temporary, "probe.mjs");
  await writeFile(probe, `
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import React from "react";
import { Document, Page, Text, renderToBuffer } from "@react-pdf/renderer";
const fonts = ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique",
  "Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique",
  "Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"];
const document = React.createElement(Document, null, React.createElement(Page, { size: "A4" },
  ...fonts.map(font => React.createElement(Text, { key: font, style: { fontFamily: font, fontSize: 12 } },
    "ARMY PDF runtime " + font + " 260,00 EUR"))));
const buffer = await renderToBuffer(document);
assert.equal(buffer.subarray(0, 5).toString(), "%PDF-");
assert(buffer.byteLength > 1000, "A real nonempty PDF must be rendered.");
assert(buffer.subarray(-30).toString().includes("%%EOF"), "The PDF must be complete.");
console.log(JSON.stringify({ fonts: fonts.length, pdfBytes: buffer.byteLength,
  pdfSha256: createHash("sha256").update(buffer).digest("hex") }));
`);
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [probe], {
      cwd: temporary, env: { PATH: process.env.PATH ?? "", TMPDIR: os.tmpdir() },
      stdio: ["ignore", "pipe", "pipe"], timeout: 30_000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(stderr || `PDF runtime exited ${code}.`)));
  });
  Object.assign(report, JSON.parse(output.trim().split("\n").at(-1)), { result: "passed" });
  console.log(`Traced PDF runtime passed: ${report.fonts} fonts, ${report.pdfBytes} PDF bytes.`);
} catch (error) {
  report.error = error instanceof Error ? error.message : String(error);
  console.error(report.error);
  process.exitCode = 1;
} finally {
  report.elapsedMs = performance.now() - started;
  if (reportPath) await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  await rm(temporary, { recursive: true, force: true });
}
