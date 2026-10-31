import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// These checks exercise the preflight boundary: a test must not start with a
// stale installation, even when a nested browser driver differs from the lock.
const root = fileURLToPath(new URL("../../", import.meta.url));
const guard = pathToFileURL(path.join(root, "scripts/tester-army/installed-dependencies.mjs")).href;
const temporary = mkdtempSync(path.join(os.tmpdir(), "mergeone-dependency-preflight-"));
const nodeRange = `^${process.versions.node}`;
const packages = {
  "e2e": "0.22.0",
  "@e2e-dev/web": "0.15.4",
  "playwright": "1.64.1",
  "next": "16.4.3",
};

function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture(name) {
  const directory = path.join(temporary, name);
  const manifest = { name: "dependency-preflight-fixture", version: "1.0.0", engines: { node: nodeRange }, devDependencies: packages };
  const entries = Object.fromEntries(Object.entries(packages).map(([dependency, version]) => [
    `node_modules/${dependency}`, { version },
  ]));
  entries["node_modules/playwright-core"] = { version: "1.64.1" };
  entries["node_modules/zod"] = { version: "4.6.7" };
  entries["node_modules/@e2e-dev/web/node_modules/playwright-core"] = { version: "1.64.1" };
  entries["node_modules/platform-optional"] = { version: "1.0.0", optional: true };
  const lock = { name: manifest.name, version: manifest.version, lockfileVersion: 3, packages: { "": manifest, ...entries } };
  writeJson(path.join(directory, "package.json"), manifest);
  writeJson(path.join(directory, "package-lock.json"), lock);
  for (const [entry, detail] of Object.entries(entries)) {
    if (detail.optional) continue;
    writeJson(path.join(directory, entry, "package.json"), { name: entry.split("node_modules/").at(-1), version: detail.version });
  }
  return directory;
}

function run(directory) {
  const marker = path.join(directory, "test-started");
  const program = `import { writeFileSync } from "node:fs";\nimport { assertInstalledDependencies } from ${JSON.stringify(guard)};\nconst receipt = assertInstalledDependencies(process.argv[1]);\nwriteFileSync(process.argv[2], JSON.stringify(receipt));\n`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", program, directory, marker], { encoding: "utf8" });
  return { ...result, marker };
}

try {
  const clean = fixture("clean");
  const passing = run(clean);
  assert.equal(passing.status, 0, passing.stderr);
  const receipt = JSON.parse(readFileSync(passing.marker, "utf8"));
  assert.equal(receipt.node, process.version);
  assert.equal(receipt.packages["e2e"].version, "0.22.0");
  assert.equal(receipt.packages["@e2e-dev/web"].version, "0.15.4");
  assert.equal(receipt.packages["playwright-core"].version, "1.64.1");
  assert.match(receipt.packages["playwright-core"].path, /@e2e-dev\/web\/node_modules\/playwright-core/);

  const dangling = fixture("dangling-source-link");
  mkdirSync(path.join(dangling, "src"), { recursive: true });
  symlinkSync(path.join(dangling, "missing"), path.join(dangling, "src/unused"), "dir");
  const danglingRun = run(dangling);
  assert.equal(danglingRun.status, 0, "an unused dangling link cannot resolve a dependency");

  const cases = [
    ["direct-mismatch", (dir) => writeJson(path.join(dir, "node_modules/next/package.json"), { name: "next", version: "16.4.2" }), /next/],
    ["nested-driver-mismatch", (dir) => writeJson(path.join(dir, "node_modules/@e2e-dev/web/node_modules/playwright-core/package.json"), { name: "playwright-core", version: "1.63.0" }), /playwright-core/],
    ["unlocked-nested-shadow", (dir) => {
      const shadow = path.join(dir, "node_modules/e2e/node_modules/zod/package.json");
      writeJson(shadow, { name: "zod", version: "9.0.0" });
      const fromE2e = createRequire(path.join(dir, "node_modules/e2e/package.json"));
      assert.equal(JSON.parse(readFileSync(fromE2e.resolve("zod/package.json"), "utf8")).version, "9.0.0", "Node must actually resolve the untracked shadow");
    }, /zod/],
    ["source-nested-shadow", (dir) => {
      writeJson(path.join(dir, "src/node_modules/zod/package.json"), { name: "zod", version: "9.0.0" });
      const fromSource = createRequire(path.join(dir, "src/example.js"));
      assert.equal(JSON.parse(readFileSync(fromSource.resolve("zod/package.json"), "utf8")).version, "9.0.0", "Node must actually resolve the source-local shadow");
    }, /src\/node_modules/],
    ["hidden-source-shadow", (dir) => {
      writeJson(path.join(dir, "src/.internal/node_modules/zod/package.json"), { name: "zod", version: "9.0.0" });
      const fromSource = createRequire(path.join(dir, "src/.internal/example.js"));
      assert.equal(JSON.parse(readFileSync(fromSource.resolve("zod/package.json"), "utf8")).version, "9.0.0", "Node must resolve the hidden source shadow");
    }, /src\/\.internal\/node_modules/],
    ["linked-source-shadow", (dir) => {
      writeJson(path.join(dir, "shared/node_modules/zod/package.json"), { name: "zod", version: "9.0.0" });
      mkdirSync(path.join(dir, "src"), { recursive: true });
      symlinkSync(path.join(dir, "shared"), path.join(dir, "src/linked"), "dir");
      const fromSource = createRequire(path.join(dir, "src/linked/example.js"));
      assert.equal(JSON.parse(readFileSync(fromSource.resolve("zod/package.json"), "utf8")).version, "9.0.0", "Node must resolve the linked source shadow");
    }, /src\/linked\/node_modules/],
    ["missing-package", (dir) => rmSync(path.join(dir, "node_modules/e2e"), { recursive: true }), /e2e/],
    ["missing-transitive", (dir) => rmSync(path.join(dir, "node_modules/@e2e-dev/web/node_modules/playwright-core"), { recursive: true }), /playwright-core/],
    ["manifest-lock-drift", (dir) => {
      const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
      manifest.devDependencies.e2e = "0.23.0";
      writeJson(path.join(dir, "package.json"), manifest);
    }, /e2e/],
    ["unsupported-node", (dir) => {
      const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
      manifest.engines.node = "^1000.0.0";
      writeJson(path.join(dir, "package.json"), manifest);
    }, /node/i],
  ];
  for (const [name, alter, expected] of cases) {
    const directory = fixture(name);
    alter(directory);
    const result = run(directory);
    assert.notEqual(result.status, 0, `${name} must reject the installation`);
    assert.match(result.stderr, expected, `${name} must name the offending dependency`);
    assert.throws(() => readFileSync(result.marker), { code: "ENOENT" }, `${name} must stop before the test starts`);
  }
  console.log(`Dependency preflight: ${cases.length + 2} cases passed.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
