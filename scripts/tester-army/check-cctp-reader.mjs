// Reader refusal cases written before its CCTP implementation. These locally
// generated parser vectors never qualify a native stack or browser campaign.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { repositoryRoot as root, relativePath } from "./local-recipe-common.mjs";

const directory = path.join(root, ".e2e/retro-runtime/cctp-reader-checks", randomUUID());
await mkdir(directory, { recursive: true });
const parserOnly = { syntheticOnly: true, qualification: false, databaseAccess: false, browserExecution: false };
// Keep these expected inputs independent of the reader's exported constants.
const titles = [
  "authenticate the existing E2E account without provisioning memberships",
  "SC01-03 eight explicit requirements use real applied work and register without changing 71000/14200/85200 cents or eight hours",
  "SC04 activating B invalidates seven decisions and only a newly verified B citation revalidates E4",
  "SC05 register validation and reopening invalidate only linked provisional decisions",
  "SC06 l2_quantity preserves unrelated decisions and exact stored amounts",
  "SC06 l1_quantity preserves unrelated decisions and exact stored amounts",
  "SC06 l4_quantity preserves unrelated decisions and exact stored amounts",
  "SC06 l2_price preserves unrelated decisions and exact stored amounts",
  "SC08 committed decision response lost then reload replays the same event without an automatic POST",
  "SC09 unavailable workspace never becomes an empty or current coverage decision",
  "SC02 technical edits require a new human completeness declaration before another decision",
  "SC07 rejects a stale decision without changing its current history",
];
const args = ["run", "--config", "e2e.config.ts", "--tag", "source-coverage", "--exclude-tag", "agent", "--target", "chromium-desktop", "--max-failures", "1"];
const report = {
  schemaVersion: "report-1", offlineParserVector: parserOnly,
  run: {
    status: "passed", exitCode: 0,
    results: titles.map((title, index) => ({
      id: `synthetic-result-${index}`, testId: `synthetic-test-${index}`, titlePath: [title],
      selected: true, status: "passed", repeat: 0, platform: "web", targetId: "chromium-desktop", agent: "default",
      kind: index === 0 ? "setup" : "test", file: index === 0 ? "e2e/army/critical/auth.setup.e2e.ts" : "e2e/army/local/source-coverage.e2e.ts",
      attempts: [{ index: 0, status: "passed", cleanup: "complete", artifacts: [] }],
    })),
    summary: { discovered: 12, selected: 12, executed: 12, passed: 12, failed: 0, skipped: 0, flaky: 0 },
    usage: { modelTokens: 0, maxModelCallsInStep: 0, downloads: 26 },
  },
};
const scenarioNames = ["nominal", "reference", "register", "l2_quantity", "l1_quantity", "l4_quantity", "l2_price", "recovery", "read_failure", "stale", "form_change"];
const fixture = {
  schemaVersion: "source-coverage-fixture-1", status: "ready", prefix: `ARMY-COVERAGE-PARSER-${randomUUID()}`,
  offlineParserVector: parserOnly,
  scenarios: Object.fromEntries(scenarioNames.map((name) => [name, {
    designation: "ARMY Réseau CH-A avec calorifuge", projectId: randomUUID(), versionId: randomUUID(),
    sectionA: randomUUID(), sectionB: randomUUID(), draftId: randomUUID(), candidateId: randomUUID(),
    documents: { A: randomUUID(), B: randomUUID() },
  }])),
};
const scenario = fixture.scenarios.nominal;
const names = [scenario.designation, "ARMY Protection parties droites CH-A", "ARMY Protection démontable des raccords CH-A", "ARMY Canalisation ECS-B sans calorifuge"];
const items = [
  { id: scenario.sectionA, item_type: "section", title: "ARMY Réseau CH-A" },
  ...names.slice(0, 3).map((title) => ({ id: randomUUID(), item_type: "line", title })),
  { id: scenario.sectionB, item_type: "section", title: "ARMY Réseau ECS-B" },
  { id: randomUUID(), item_type: "line", title: names[3] },
].map((item) => ({ ...item, version_id: scenario.versionId }));
const standardValues = [["m", 10, 40, 400, 80, 480], ["m", 4, 20, 80, 16, 96], ["u", 2, 25, 50, 10, 60], ["m", 6, 30, 180, 36, 216]];
const dpgfValues = [[10, "m", 40, 0.5, 5, 1, 1], [4, "m", 10, 1, 1, 1, 1], [2, "u", 15, 1, 0.5, 1, 1], [6, "m", 20, 1, 1.5, 1, 1]];
const declaredWorkbooks = [
  { mode: "standard", sheets: {
    Devis: [["Type", "Désignation", "Unité", "Quantité", "PU HT", "Total HT", "TVA", "TTC"], ...items.map((item) => {
      const index = names.indexOf(item.title);
      return index < 0 ? [item.item_type, item.title, null, null, null, null, null, null] : [item.item_type, item.title, ...standardValues[index]];
    })],
    Resume: [["Total HT", 710], ["Total TVA", 142], ["Total TTC", 852], ["Version ID", scenario.versionId]],
  } },
  { mode: "dpgf", sheets: {
    Données: [["Type", "ID", "Désignation", "Quantité", "Unité", "PU", "TVA", "Ratio", "Heures", "Coefficient", "Marge"], ...items.map((item) => {
      const index = names.indexOf(item.title), values = dpgfValues[index];
      return index < 0 ? [item.item_type, item.id, item.title, null, null, null, null, null, null, null, null] :
        [item.item_type, item.id, item.title, ...values.slice(0, 3), 20, ...values.slice(3)];
    })],
    Metadata: [["Version ID", scenario.versionId]],
  } },
];
const workbookVectors = [];
for (const vector of declaredWorkbooks) {
  const workbook = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(vector.sheets)) workbook.addWorksheet(name).addRows(rows);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer()), file = path.join(directory, `${vector.mode}-parser-vector.xlsx`);
  await writeFile(file, bytes, { flag: "wx" });
  workbookVectors.push({ ...vector, bytes, path: relativePath(file), sha256: createHash("sha256").update(bytes).digest("hex") });
}
await writeFile(path.join(directory, "parser-vectors.json"), JSON.stringify({ ...parserOnly, report, fixture, items,
  workbooks: workbookVectors.map(({ mode, sheets, path, sha256 }) => ({ mode, sheets, path, sha256 })) }, null, 2) + "\n", { flag: "wx" });
const results = [];
let support;
async function check(name, action) {
  try { if (name !== "required reader capability") assert.ok(support, "Reader capability unavailable"); await action(); results.push({ name, passed: true }); }
  catch { results.push({ name, passed: false, reason: "Offline reader refusal or required capability failed." }); }
}
await check("required reader capability", async () => { support = await import("./cctp-reader-support.mjs"); });
await check("twelve exact synthetic results accepted only as parser vectors", () => support.validateCctpResults(report, args));
await check("repeat retry excluded filter and duplicate IDs refused", () => {
  for (const change of [(r) => r.run.results[1].repeat = 1, (r) => r.run.results[1].attempts.push(r.run.results[1].attempts[0]),
    (r) => r.run.results[1].selected = false, (r) => r.run.results[1].id = r.run.results[0].id]) {
    const bad = structuredClone(report); change(bad); assert.throws(() => support.validateCctpResults(bad, args));
  }
  assert.throws(() => support.validateCctpResults(report, [...args, "--filter", "SC01"]));
});
await check("eleven independent fixture scenarios required", () => {
  support.validateCctpScenarios(fixture);
  const bad = structuredClone(fixture); delete bad.scenarios.stale; assert.throws(() => support.validateCctpScenarios(bad));
  const alias = structuredClone(fixture); alias.scenarios.stale.documents.B = alias.scenarios.nominal.documents.A;
  assert.throws(() => support.validateCctpScenarios(alias));
});
await check("standard DPGF amounts and all six identities verified", async () => {
  for (const vector of workbookVectors) {
    const sheets = await support.inspectCctpWorkbook(vector.bytes, vector.sheets, [], {});
    support.verifyCctpWorkbookValues(sheets, vector.mode, scenario, items);
  }
  const bad = structuredClone(workbookVectors[0].sheets); bad.Resume.find((r) => r[0] === "Total HT")[1] = 711;
  assert.throws(() => support.verifyCctpWorkbookValues(bad, "standard", scenario, items));
  const ids = structuredClone(workbookVectors[1].sheets); ids.Données[1][1] = randomUUID();
  assert.throws(() => support.verifyCctpWorkbookValues(ids, "dpgf", scenario, items));
});
await check("compressed XML credentials and hidden values refused", async () => {
  const workbook = new ExcelJS.Workbook(); workbook.addWorksheet("Evidence").addRow(["public value", 17]);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  await support.inspectCctpWorkbook(bytes, { Evidence: [["public value", 17]] }, [], { API_KEY: "secret with space" });
  const zip = await JSZip.loadAsync(bytes); zip.file("docProps/custom.xml", "<value>secret%20with%20space</value>");
  const bad = await zip.generateAsync({ type: "nodebuffer" });
  await assert.rejects(support.inspectCctpWorkbook(bad, { Evidence: [["public value", 17]] }, [], { API_KEY: "secret with space" }));
  const hidden = workbook.addWorksheet("Hidden"); hidden.state = "veryHidden"; hidden.addRow(["excluded clause"]);
  await assert.rejects(support.inspectCctpWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), { Evidence: [["public value", 17]], Hidden: [["excluded clause"]] }, ["excluded clause"]));
});
await check("raw binary short provider secret JWT and escaped lease refused", () => {
  const environment = { OPTIONAL_PROVIDER_API_KEY: "demo", E2E_LOGIN_PASSWORD: "synthetic space+credential" };
  for (const text of ["demo", "synthetic%20space%2Bcredential", "synthetic space+credential", "eyJAbc.def.ghi",
    JSON.stringify({ nested: JSON.stringify({ draftLockSessionId: "12345678-1234-4234-8234-123456789abc" }) })]) {
    assert.throws(() => support.assertCctpPrivateBytes(Buffer.concat([Buffer.from([0, 1]), Buffer.from(text), Buffer.from([0])]), environment));
  }
  support.assertCctpPrivateBytes(Buffer.from("public fixture evidence"), environment);
});
// Independent review found two failures. These vectors were added and executed
// RED before the bounded fixes; they do not create a qualifying run archive.
await check("excluded clauses in custom XML and XML entities refused", async () => {
  const workbook = new ExcelJS.Workbook(); workbook.addWorksheet("Evidence").addRow(["public value", 17]);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const clause = "Clause exclue : accès & pièce <attendue>";
  for (const value of [clause, "Clause exclue : acc&#232;s &amp; pi&#xE8;ce &lt;attendue&gt;"]) {
    const zip = await JSZip.loadAsync(bytes); zip.file("docProps/custom.xml", `<value>${value}</value>`);
    await assert.rejects(support.inspectCctpWorkbook(await zip.generateAsync({ type: "nodebuffer" }), { Evidence: [["public value", 17]] }, [clause], {}));
  }
});
await check("early SHA refusal cannot echo a secret filename", async () => {
  const run = path.join(root, ".e2e/army/coverage/runs", `cctp-reader-invalid-vector-${randomUUID()}`);
  await mkdir(path.dirname(run), { recursive: true });
  await mkdir(run, { recursive: false });
  const secret = "SYNTHETIC-PRIVATE-FILENAME-357d5891";
  const file = path.join(run, `${secret}.txt`); await writeFile(file, "Intentionally invalid artifact SHA; no qualification.", { flag: "wx" });
  const reportBytes = Buffer.from(JSON.stringify(report, null, 2) + "\n");
  await writeFile(path.join(run, "report.json"), reportBytes, { flag: "wx" });
  const invalid = {
    schemaVersion: "miaouffrage-tester-army-1", mode: "coverage",
    offlineRefusalFixture: { ...parserOnly, status: "intentionally-invalid-sha" },
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    command: { executable: process.execPath, args: ["e2e", ...args] },
    result: { status: "passed", exitCode: 0, runnerExitCode: 0, summary: report.run.summary, usage: report.run.usage,
      tests: report.run.results.map(({ file, titlePath, targetId, status }) => ({ file, titlePath, targetId, status })) },
    source: { changedDuringRun: false, pilotInputs: [], pilotInputsAfter: [], untrackedRuntimeInputs: [], untrackedRuntimeInputsAfter: [],
      workingDiffSha256: "0".repeat(64), workingDiffAfterSha256: "0".repeat(64) },
    productionBuild: { changedDuringRun: false }, tracePaths: [], fixtures: { authentication: { result: "passed" } },
    coverage: { retainedEvidence: [], evidence: [] },
    artifacts: [{ path: relativePath(file), sha256: "0".repeat(64) }],
    report: { path: relativePath(path.join(run, "report.json")), sha256: createHash("sha256").update(reportBytes).digest("hex") },
  };
  await writeFile(path.join(run, "manifest.json"), JSON.stringify(invalid), { flag: "wx" });
  const result = spawnSync(process.execPath, ["scripts/tester-army/qualify-source-coverage.mjs", relativePath(run)], {
    cwd: root, env: { ...process.env, CCTP_REFUSAL_SECRET: secret }, encoding: "utf8", windowsHide: true,
  });
  assert.equal(result.status, 1);
  const last = result.stdout.trim().split("\n").at(-1), summary = JSON.parse(last);
  assert.equal(summary.status, "failed");
  assert.deepEqual(summary.failedChecks, ["artifact-sha"]);
  const receipt = await readFile(path.join(root, summary.path, "qualification.json"), "utf8");
  const parsed = JSON.parse(receipt); assert.equal(parsed.status, "failed");
  assert.deepEqual(parsed.checks.filter((c) => !c.passed), [{ name: "artifact-sha", passed: false }], "Actual SHA refusal must be reached.");
  await writeFile(path.join(directory, "early-refusal-observation.json"), JSON.stringify({
    ...parserOnly, exitCode: result.status, outputPath: summary.path, failedChecks: summary.failedChecks,
    receiptSha256: createHash("sha256").update(receipt).digest("hex"), secretEchoObserved: (result.stdout + result.stderr + receipt).includes(secret),
  }, null, 2), { flag: "wx" });
  assert.ok(!(result.stdout + result.stderr + receipt).includes(secret), "Synthetic secret leaked through early refusal diagnostics.");
});
const receipt = { schemaVersion: "cctp-reader-offline-check-1", createdAt: new Date().toISOString(),
  databaseAccess: false, browserExecution: false, historicalCampaignQualification: false, parserOnly: true, results,
  vectors: { path: relativePath(path.join(directory, "parser-vectors.json")),
    sha256: createHash("sha256").update(await readFile(path.join(directory, "parser-vectors.json"))).digest("hex") },
  limits: ["Synthetic report, fixture and real XLSX bytes exercise reader parsers only; no current native, UI, Storage or campaign qualification is inferred."] };
const bytes = Buffer.from(JSON.stringify(receipt, null, 2) + "\n");
await writeFile(path.join(directory, "receipt.json"), bytes, { flag: "wx" });
console.log(JSON.stringify({ passed: results.filter((r) => r.passed).length, total: results.length,
  receipt: relativePath(path.join(directory, "receipt.json")), sha256: createHash("sha256").update(bytes).digest("hex") }));
if (results.some((row) => !row.passed)) process.exitCode = 3;
