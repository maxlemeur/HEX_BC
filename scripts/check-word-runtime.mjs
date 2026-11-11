import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { zipSync, strToU8 } from "fflate";

// Only the packages actually traced by Next are available to each probe.
const root = process.cwd();
const dist = process.env.PERFORMANCE_BUILD_DIR?.trim() || (process.env.E2E_ARMY === "1" ? ".build/tester-army/next" : ".next");
const routes = ["api/affaires/[projectId]/intake/files/route.js.nft.json", "dashboard/affaires/[projectId]/page.js.nft.json"];
const temporary = await mkdtemp(path.join(os.tmpdir(), "mergeone-word-runtime-"));
const sample = zipSync({
  "[Content_Types].xml": strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
  "word/document.xml": strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>ARMY Word runtime fictif</w:t></w:r></w:p></w:body></w:document>'),
}, { level: 0 });
try {
  for (const [index, route] of routes.entries()) {
    const trace = path.join(root, dist, "server/app", route);
    const files = JSON.parse(await readFile(trace, "utf8")).files;
    const isolated = path.join(temporary, String(index));
    await mkdir(isolated, { recursive: true });
    for (const file of files) {
      const source = path.resolve(path.dirname(trace), file);
      const relative = path.relative(root, source);
      if (!/^node_modules\/(word-extractor|saxes|xmlchars|yauzl|fd-slicer|pend|buffer-crc32)\//.test(relative.split(path.sep).join("/"))) continue;
      const destination = path.join(isolated, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(source, destination);
    }
    await writeFile(path.join(isolated, "sample.docx"), sample);
    await writeFile(path.join(isolated, "probe.cjs"), `
const assert = require('node:assert/strict');
const path = require('node:path');
assert(require.resolve('word-extractor').startsWith(path.join(process.cwd(),'node_modules')));
const Word = require('word-extractor');
new Word().extract('sample.docx').then(doc => {
  assert.equal(doc.getBody().trim(), 'ARMY Word runtime fictif');
  console.log('word-runtime-ok');
}).catch(() => { process.exitCode=1; });
`);
    const result = spawnSync(process.execPath, ["--max-old-space-size=128", "probe.cjs"], {
      cwd: isolated, env: { PATH: process.env.PATH ?? "" }, encoding: "utf8", timeout: 15_000, maxBuffer: 10000,
    });
    assert.equal(result.status, 0, `Word runtime absent from ${route}`);
    assert.equal(result.stdout.trim(), "word-runtime-ok");
  }
  console.log(`Traced Word runtime passed for ${routes.length} intake routes.`);
} finally { await rm(temporary, { recursive: true, force: true }); }
