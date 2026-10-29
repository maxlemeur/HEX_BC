import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Reproduce the Node worker's dependency lookup using only files that Next
// traced for each import route. A full local node_modules masks missing files.
const root = process.cwd();
const distDir = process.env.PERFORMANCE_BUILD_DIR?.trim() || (process.env.E2E_ARMY === "1" ? ".e2e/army/next" : ".next");
const routes = [
  "api/imports/route.js.nft.json",
  "api/affaires/[projectId]/intake/files/[documentId]/route.js.nft.json",
];
const temporary = await mkdtemp(path.join(os.tmpdir(), "mergeone-xlsx-runtime-"));
const probe = `
const { Worker } = require("node:worker_threads");
const worker = new Worker(\`
  const fs = require("node:fs");
  const { parentPort } = require("node:worker_threads");
  const XLSX = require("xlsx");
  const ExcelJS = require("exceljs");
  (async () => {
    const bytes = fs.readFileSync("sample.xlsx");
    const workbook = XLSX.read(bytes, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 });
    const styled = new ExcelJS.Workbook();
    await styled.xlsx.load(bytes);
    parentPort.postMessage({ rows: rows.length, sheets: styled.worksheets.length });
  })().catch(error => { throw error; });
\`, { eval: true });
worker.once("message", result => { console.log(JSON.stringify(result)); });
worker.once("error", error => { console.error(error.message); process.exitCode = 1; });
`;

try {
  for (const [index, route] of routes.entries()) {
    const trace = path.join(root, distDir, "server/app", route);
    const manifest = JSON.parse(await readFile(trace, "utf8"));
    const isolated = path.join(temporary, String(index));
    await mkdir(isolated, { recursive: true });
    let copied = 0;
    for (const file of manifest.files) {
      const source = path.resolve(path.dirname(trace), file);
      const relative = path.relative(root, source);
      if (!relative.startsWith(`node_modules${path.sep}`)) continue;
      const destination = path.join(isolated, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
      copied++;
    }
    assert(copied > 0, `${route} did not trace any runtime packages`);
    await copyFile(path.join(root, "public/exemple-dpgf.xlsx"), path.join(isolated, "sample.xlsx"));
    await writeFile(path.join(isolated, "probe.cjs"), probe);
    const output = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["probe.cjs"], {
        cwd: isolated, env: { PATH: process.env.PATH ?? "", TMPDIR: os.tmpdir() },
        stdio: ["ignore", "pipe", "pipe"], timeout: 30_000,
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", chunk => { stdout += chunk; });
      child.stderr.on("data", chunk => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", code => code === 0 ? resolve(stdout) : reject(new Error(`${route}: ${stderr || `exit ${code}`}`)));
    });
    const result = JSON.parse(output.trim());
    assert(result.rows > 1 && result.sheets > 0, `${route} could not read the example workbook`);
  }
  console.log(`Traced XLSX worker runtime passed for ${routes.length} import routes.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
