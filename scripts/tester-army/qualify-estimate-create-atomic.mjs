import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, readdir, mkdir, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { sdkEvidenceDirectory } from "./local-recipe-common.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const relative = (file) => path.relative(root, file).replaceAll("\\", "/");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const sha = async (file) => hash(await readFile(file));
const checks = [];
const check = (condition, name) => { checks.push({ name, passed: Boolean(condition) }); if (!condition) throw new Error(name); };
const run = process.argv[2] ? await realpath(path.resolve(root, process.argv[2])) : "";
if (process.argv.length !== 3 || !run.startsWith(path.join(root, ".e2e/army/coverage/runs") + path.sep)) throw new Error("Supply one exact terminal coverage run; no latest-result selection.");
const output = path.join(root, ".e2e/army/coverage/atomic-qualifications", `${path.basename(run)}-${randomUUID().slice(0, 8)}`);
await mkdir(output, { recursive: true });
const receipt = {
  schemaVersion: "army-estimate-create-atomic-qualification-1", status: "checking",
  startedAt: new Date().toISOString(), command: { executable: process.execPath, args: process.argv.slice(1) },
  readerSha256: await sha(fileURLToPath(import.meta.url)), checks,
  limits: [
    "Three selected API creation journeys plus ordinary UI login; no full application qualification.",
    "V2 no-discount nominal only for reload and XLSX/DPGF; draft compatibility is not publication eligibility.",
    "Native rollback/concurrency/context proofs remain separate; HTTP reads do not establish isolation.",
    "CORE-06 rapid departure remains unqualified; the editor is awaited ready after reload.",
    "No pixel, print PDF, production, role matrix or performance qualification.",
  ],
};
try {
  const manifest = await json(path.join(run, "manifest.json"));
  const report = await json(path.join(run, "report.json"));
  const expectedTitles = [
    "authenticate the existing E2E account without provisioning memberships",
    "CA01 each API creation immediately persists exact V2 totals, then reload and exports need no repair",
    "CA02 V2 and legacy V1 keep chapters, omitted draft fields and positive hours without a role",
    "CA03 API creation calculates from PostgreSQL quantity, coefficient and hour-majoration precision",
  ];
  check(manifest.mode === "coverage" && manifest.result.status === "passed" && manifest.result.exitCode === 0 && report.run.status === "passed", "terminal-coverage-pass");
  check(isDeepStrictEqual(report.run.results.map((entry) => entry.titlePath.join(" > ")), expectedTitles) && report.run.results.every((entry) => entry.status === "passed") &&
    ["discovered", "selected", "executed", "passed"].every((key) => report.run.summary[key] === expectedTitles.length) && ["failed", "skipped", "flaky"].every((key) => report.run.summary[key] === 0) &&
    // e2e 0.20 counts interrupted tests apart; earlier reports counted them as failed.
    (report.run.summary.interrupted ?? 0) === 0, "four-exact-results-no-exclusions");
  check(manifest.source.changedDuringRun === false && manifest.productionBuild.changedDuringRun === false && report.run.usage.modelTokens === 0 && report.run.usage.maxModelCallsInStep === 0 && manifest.tracePaths.length === 0, "stable-source-build-no-model-or-trace");
  const declared = [...manifest.artifacts, ...manifest.coverage.retainedEvidence, manifest.report, ...(manifest.appLog ? [manifest.appLog] : [])];
  const locations = new Set();
  for (const entry of declared) {
    const file = await realpath(path.resolve(root, entry.path));
    check(file.startsWith(run + path.sep) && !locations.has(file), `owned-artifact-${entry.path}`);
    locations.add(file); check(await sha(file) === entry.sha256, `artifact-sha-${entry.path}`);
  }
  const walk = async (directory) => {
    const found = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      check(!entry.isSymbolicLink(), "no-evidence-symlink");
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) found.push(...await walk(file)); else found.push(file);
    }
    return found;
  };
  const files = await walk(run);
  check(files.every((file) => file === path.join(run, "manifest.json") || locations.has(file)), "complete-archive-inventory");
  for (const entry of [...manifest.source.pilotInputs, ...manifest.source.untrackedRuntimeInputs, ...manifest.productionBuild.inputs]) check(await sha(path.join(root, entry.path)) === entry.sha256, `current-input-${entry.path}`);
  const diff = spawnSync("git", ["-c", `safe.directory=${root}`, "diff", "HEAD", "--binary"], { cwd: root, encoding: "buffer", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  check(diff.status === 0 && hash(diff.stdout) === manifest.source.workingDiffSha256, "current-git-diff-matches-run");
  const profileFile = manifest.coverage.evidence.find((entry) => entry.path.endsWith("/profile.json"));
  const profile = await json(path.join(root, profileFile.path));
  const fixture = manifest.coverage.fixture;
  check(profile.backendOrigin === fixture.apiUrl && profile.backendOrigin === manifest.coverage.backendOrigin && profile.appOrigin === manifest.fixtures.appOrigin && profile.serverMode === "production" && fixture.status === "ready" && fixture.prefix.startsWith("ARMY-CREATE-ATOMIC-") && profile.scenarioSet === "create-atomic" && manifest.coverage.scenarioSet === "create-atomic", "explicit-local-profile-and-fixture");
  const backend = new URL(profile.backendOrigin);
  check(backend.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname), "loopback-only-backend");
  const buildFile = manifest.coverage.evidence.find((entry) => entry.path.endsWith("/build-proof.json"));
  const build = await json(path.join(root, buildFile.path));
  check(await sha(path.join(root, buildFile.path)) === profile.buildProofSha256 && build.buildId === manifest.productionBuild.id && build.backend === profile.backendOrigin && build.sourceChangedDuringBuild === false && build.steps.every((entry) => entry.exitCode === 0), "profile-build-identity");
  for (const input of build.inputs) check(await sha(path.join(root, input.path)) === input.sha256, `build-source-${input.path}`);
  const installedFile = manifest.coverage.evidence.find((entry) => entry.path.endsWith("/atomic-application.json"));
  const stackFile = manifest.coverage.evidence.find((entry) => entry.path.endsWith("/stack.json"));
  check(Boolean(installedFile) && Boolean(stackFile), "explicit-installed-atomic-proof");
  const installed = await json(path.join(root, installedFile.path)), stack = await json(path.join(root, stackFile.path));
  check(await sha(path.join(root, installedFile.path)) === profile.atomicApplicationSha256 && await sha(path.join(root, stackFile.path)) === profile.stackReceiptSha256 &&
    installed.status === "verified" && installed.phase === "commit_verified" && installed.apiUrl === profile.backendOrigin && stack.status === "ready" && stack.apiUrl === profile.backendOrigin && installed.stackDirectory === stack.stackDirectory &&
    installed.target.dbPort === stack.ports["54322"] && /^\d{14}_atomic_create_estimate_item\.sql$/.test(installed.migration.file), "installed-atomic-stack-identity");
  check(await sha(path.join(root, "supabase/migrations", installed.migration.file)) === installed.migration.sha256, "installed-atomic-source-sha");
  const correctionFile = manifest.coverage.evidence.find((entry) => entry.path.endsWith("/atomic-correction.json"));
  check(Boolean(correctionFile), "explicit-normalized-tenant-correction");
  const correction = await json(path.join(root, correctionFile.path));
  const pgTapFile = manifest.coverage.evidence.find((entry) => entry.path.endsWith("/atomic-pgtap.json"));
  check(Boolean(pgTapFile), "explicit-post-correction-pgtap-receipt");
  const pgTap = await json(path.join(root, pgTapFile.path));
  check(await sha(path.join(root, pgTapFile.path)) === profile.atomicPgTapSha256 && pgTap.status === "verified" && pgTap.exitCode === 0 && pgTap.rollbackVerified === true &&
    pgTap.stackReceiptSha256 === correction.transportReceiptSha256 && pgTap.target.systemIdentifier === installed.target.systemIdentifier && pgTap.target.dbPort === installed.target.dbPort &&
    pgTap.transportReceiptSha256 === profile.stackReceiptSha256 && stack.pgTapPassed === true && pgTap.files === stack.pgTap.files && pgTap.tests === stack.pgTap.tests, "post-correction-pgtap-transport-chain");
  check(await sha(path.join(root, correctionFile.path)) === profile.atomicCorrectionSha256 && correction.status === "verified" && correction.phase === "commit_verified" && correction.historyVerified === true &&
    correction.target.systemIdentifier === installed.target.systemIdentifier && correction.target.dbPort === installed.target.dbPort &&
    correction.artifacts.find((entry) => entry.name === "3-stack.json")?.sha256 === installed.transportReceiptSha256 && /^\d{14}_guard_normalized_estimate_calculation_tenant\.sql$/.test(correction.migration.file), "atomic-installation-correction-chain");
  check(await sha(path.join(root, "supabase/migrations", correction.migration.file)) === correction.migration.sha256 && stack.migrationInventory.some((entry) => entry.name === correction.migration.file && entry.sha256 === correction.migration.sha256), "corrected-atomic-source-inventory");
  receipt.installation = { file: installedFile.path, sha256: profile.atomicApplicationSha256, migration: installed.migration, correction: { file: correctionFile.path, sha256: profile.atomicCorrectionSha256, migration: correction.migration }, pgTap: { file: pgTapFile.path, sha256: profile.atomicPgTapSha256 }, stackSha256: profile.stackReceiptSha256 };
  const business = [];
  for (const file of files.filter((file) => file.includes(`${path.sep}business${path.sep}`) && file.endsWith(".json"))) business.push({ file, ...await json(file) });
  const find = (label) => {
    const matches = business.filter((entry) => path.basename(entry.file) === `${entry.fixturePrefix}-${label}.json`);
    check(matches.length === 1, `unique-${label}`); return matches[0].data;
  };
  const totals = (version) => [version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents];
  const immediate = (observation) => {
    const { response, state, expectedTotals, expectedHours, label } = observation;
    const lines = state.items.filter((item) => item.item_type === "line");
    check(response.status === 201 && response.body.ok === true && response.body.data.version.id === state.version.id && response.body.data.version.updated_at === state.version.updated_at, `${label}-committed-response-token`);
    check(state.items.some((item) => item.id === response.body.data.item.id) && state.items.every((item) => item.version_id === state.version.id), `${label}-owned-line-identities`);
    check(isDeepStrictEqual(totals(state.version), expectedTotals), `${label}-immediate-header`);
    check(isDeepStrictEqual(["line_total_ht_cents", "line_tax_cents", "line_total_ttc_cents"].map((field) => lines.reduce((sum, item) => sum + Number(item[field]), 0)), expectedTotals), `${label}-line-header-coherence`);
    check(lines.reduce((sum, item) => sum + Number(item.h_mo ?? 0), 0) === expectedHours, `${label}-retained-hours`);
  };
  check(fixture.schemaVersion === "estimate-create-atomic-fixture-1" && fixture.legacyV1.versionId !== fixture.legacySplitV1.versionId, "dedicated-atomic-fixture");
  const fixtureFile = manifest.coverage.evidence.find((entry) => entry.path.endsWith("/fixture.json"));
  check(await sha(path.join(root, fixtureFile.path)) === profile.fixtureSha256 && isDeepStrictEqual(await json(path.join(root, fixtureFile.path)), fixture), "profile-fixture-sha-and-identity");
  check(manifest.command.args[manifest.command.args.indexOf("--max-failures") + 1] === "3", "three-failure-limit-no-filter");
  const nominal = find("ca01-immediate-summary");
  check(nominal.editorOpened === false && nominal.explicitSave === false && nominal.observations.length === 6, "nominal-api-before-editor");
  check(isDeepStrictEqual(nominal.observations.slice(2).map((entry) => entry.expectedTotals), [[40000,8000,48000],[48000,9600,57600],[53000,10600,63600],[71000,14200,85200]]) &&
    isDeepStrictEqual(nominal.observations.slice(2).map((entry) => entry.expectedHours), [5,6,6.5,8]), "fixed-nominal-oracle");
  nominal.observations.forEach(immediate);
  const final = nominal.observations.at(-1).state;
  for (const phase of ["opened", "reloaded"]) {
    const value = find(`ca01-${phase}`);
    check(isDeepStrictEqual(totals(value.state.version), [71000,14200,85200]) && isDeepStrictEqual(value.state.items, final.items) && value.writes.length === 0 && value.dialogs.length === 0, `unrepaired-${phase}`);
  }
  const noRepair = find("ca01-no-repair-observation");
  check(noRepair.versionId === nominal.versionId && noRepair.writes.length === 0 && noRepair.dialogs.length === 0, "no-bulk-through-reload-and-downloads");
  check(report.run.usage.downloads === 2, "two-real-downloads");
  const evidenceDirectory = sdkEvidenceDirectory(report);
  for (const mode of ["standard", "dpgf"]) {
    const exported = find(`ca01-export-${mode}`);
    const downloadRelative = path.relative(path.join(root, ".e2e/army/coverage", evidenceDirectory), path.resolve(exported.artifact.path));
    check(downloadRelative && !downloadRelative.startsWith("..") && !path.isAbsolute(downloadRelative) && downloadRelative.split(path.sep).includes("downloads"), `owned-${mode}-download-path`);
    const downloadFile = await realpath(path.join(run, evidenceDirectory, downloadRelative));
    const matches = declared.filter((entry) => entry.sha256 === exported.artifact.sha256 && path.resolve(root, entry.path) === downloadFile);
    check(matches.length === 1 && exported.versionId === nominal.versionId, `real-${mode}-download-sha`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(downloadFile);
    const actualSheets = {};
    for (const sheet of workbook.worksheets) {
      actualSheets[sheet.name] = [];
      sheet.eachRow((row) => actualSheets[sheet.name].push(Array.from({ length: sheet.columnCount }, (_, index) => {
        const cell = row.getCell(index + 1); return typeof cell.value === "number" ? cell.value : cell.text || null;
      })));
    }
    check(isDeepStrictEqual(actualSheets, exported.sheets), `parsed-${mode}-download-matches-evidence`);
    if (mode === "standard") {
      for (const [label, value] of [["Total HT",710],["Total TVA",142],["Total TTC",852]]) check(isDeepStrictEqual(exported.sheets.Resume.filter((row) => row[0] === label).map((row) => row[1]), [value]), `export-${label}`);
      for (const line of final.items.filter((item) => item.item_type === "line")) {
        const rows = exported.sheets.Devis.filter((row) => String(row[1]).trim() === line.title);
        check(rows.length === 1 && isDeepStrictEqual(rows[0].slice(2,8), [line.description,line.quantity,line.pu_ht_cents/100,line.line_total_ht_cents/100,line.line_tax_cents/100,line.line_total_ttc_cents/100]), `export-row-${line.id}`);
      }
    } else {
      const ids = final.items.map((item) => item.id).sort();
      check(isDeepStrictEqual(exported.sheets.Données.filter((row) => ids.includes(row[1])).map((row) => row[1]).sort(), ids), "dpgf-six-original-identities");
    }
  }
  const compatibility = find("ca02-both-engine-observations");
  const compatibilityLabels = [2,1].flatMap((engine) => ["section","omitted","hours-no-role","chapter-after-lines"].map((label) => `ca02-v${engine}-${label}`)).concat(["ca02-v1-split-off","ca02-v1-split-on-parent","ca02-v1-split-on","ca02-v1-split-on-chapter"]);
  check(compatibility.editorOpened === false && compatibility.explicitSave === false && compatibility.publicationAttempted === false && isDeepStrictEqual(compatibility.observations.map((entry) => entry.label), compatibilityLabels), "twelve-explicit-compatibility-observations-remain-draft");
  compatibility.observations.forEach(immediate);
  for (const engine of [1,2]) {
    const omitted = find(`ca02-v${engine}-omitted-immediate`), noRole = find(`ca02-v${engine}-hours-no-role-immediate`);
    const item = omitted.response.body.data.item;
    check(!["title","quantity","unit_price_ht_cents"].some((key) => key in omitted.request) && isDeepStrictEqual([item.title,item.quantity,item.unit_price_ht_cents,item.h_mo,item.labor_role_id], ["Nouvelle ligne",1,0,0,null]), `v${engine}-omitted-fields-defaults`);
    check(omitted.state.version.calc_engine_version === engine && noRole.state.version.calc_engine_version === engine && noRole.response.body.data.item.h_mo === 1 && noRole.response.body.data.item.labor_role_id === null, `v${engine}-positive-hours-without-role`);
  }
  for (const [enabled, expected] of [[false,6000],[true,14000]]) {
    const suffix = enabled ? "on" : "off", flag = find(`ca02-split-${suffix}`), value = find(`ca02-v1-split-${suffix}-immediate`);
    check(flag.status === 200 && flag.body.data.tenant_id === fixture.owner.tenantId && flag.body.data.flag.enabled === enabled && value.state.version.calc_engine_version === 1 && value.response.body.data.item.line_total_ht_cents === expected, `legacy-tenant-split-${suffix}`);
  }
  const precision = find("ca03-precision-observations");
  check(precision.editorOpened === false && precision.explicitSave === false && precision.observations.length === 3 && isDeepStrictEqual(precision.observations.map((entry) => entry.expectedTotals), [[100100,20020,120120],[200200,40040,240240],[600240,120048,720288]]), "fixed-precision-oracle");
  precision.observations.forEach(immediate);
  check(precision.observations[0].response.body.data.item.quantity === 1.001 && precision.observations[1].response.body.data.item.k_fo === 1.001 && precision.observations[2].response.body.data.item.h_mo_majoration === 1.0001, "stored-postgresql-precision");
  const network = (await readFile(path.join(run, "server-network.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  check(network.some((entry) => entry.kind === "guard-installed") && network.every((entry) => entry.allowed !== false), "guarded-server-network");
  const secrets = ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "E2E_LOGIN_EMAIL", "E2E_LOGIN_PASSWORD"].map((key) => process.env[key]);
  check(secrets.every((value) => value && value.length > 0), "configured-secret-scan-inputs");
  let texts = 0;
  for (const file of files.filter((file) => /\.(json|jsonl|ts|tsx|js|mjs|cjs|sql|log|txt|md|diff)$/.test(file))) {
    const text = await readFile(file, "utf8"); texts++;
    if (file.endsWith(".json")) JSON.parse(text);
    check(!secrets.some((secret) => text.includes(secret)) && !/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text), `private-${relative(file)}`);
  }
  receipt.status = "qualified-local-estimate-create-atomic";
  receipt.run = { path: relative(run), manifestSha256: await sha(path.join(run, "manifest.json")), reportSha256: await sha(path.join(run, "report.json")), summary: report.run.summary };
  receipt.build = { id: build.buildId, origin: manifest.coverage.buildOriginPlatform, execution: manifest.coverage.executionPlatform };
  receipt.confidentiality = { texts, valuesRetained: false };
  if (receipt.build.origin !== receipt.build.execution) receipt.limits.push("Build and execution platforms differ; no new native-platform production or performance proof.");
} catch (error) { receipt.status = "failed"; receipt.error = error.message; process.exitCode = 1; }
receipt.finishedAt = new Date().toISOString();
const bytes = JSON.stringify(receipt, null, 2) + "\n";
await writeFile(path.join(output, "qualification.json"), bytes, { flag: "wx" });
await writeFile(path.join(output, "qualification.json.sha256"), hash(bytes) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: receipt.status, path: relative(output), sha256: hash(bytes), failedChecks: checks.filter((entry) => !entry.passed).map((entry) => entry.name) }));
