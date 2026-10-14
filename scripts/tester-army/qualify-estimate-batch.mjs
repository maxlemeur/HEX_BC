import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, readdir, mkdir, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { loadCoverageProfile } from "./coverage-profile.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const relative = (file) => path.relative(root, file).replaceAll("\\", "/");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const sha = async (file) => hash(await readFile(file));
const checks = [];
const check = (condition, name) => { checks.push({ name, passed: Boolean(condition) }); if (!condition) throw new Error(name); };
const same = (actual, expected, name) => check(isDeepStrictEqual(actual, expected), name);
const run = process.argv[2] ? await realpath(path.resolve(root, process.argv[2])) : "";
if (process.argv.length !== 3 || !run.startsWith(path.join(root, ".e2e/army/coverage/runs") + path.sep)) throw new Error("Supply one exact terminal run; no latest-result selection.");
const output = path.join(root, ".e2e/army/coverage/batch-qualifications", `${path.basename(run)}-${randomUUID().slice(0, 8)}`);
await mkdir(output, { recursive: true });
const receipt = {
  schemaVersion: "army-estimate-batch-qualification-1", status: "checking", startedAt: new Date().toISOString(),
  command: { executable: process.execPath, args: process.argv.slice(1) }, readerSha256: await sha(fileURLToPath(import.meta.url)), checks,
  limits: [
    "Five selected business journeys and ordinary authentication only; not full application or generated-workflow qualification.",
    "Loss and malformed response are client transport faults after a real server response, not native process-crash proof.",
    "Paste uses a synthetic DOM ClipboardEvent and a controlled second request with an invalid parent; not operating-system clipboard or spontaneous database failure.",
    "Native rollback, concurrent transactions, role/tenant transitions and unavailable session storage remain separate proof obligations.",
    "Native installation and any current pgTAP are limited to the exact linked profile receipts; predecessor results are historical and no concurrent-transaction proof is inferred from these UI journeys.",
    "CORE-06 rapid departure remains unqualified; editor readiness is awaited before navigation.",
    "No pixel, print PDF, performance, remote or deployment qualification.",
  ],
};
try {
  const manifest = await json(path.join(run, "manifest.json"));
  const report = await json(path.join(run, "report.json"));
  const titles = [
    "authenticate the existing E2E account without provisioning memberships",
    "WFC01 failed ordinary batch preserves both V2 allocations and footer before reload and exports",
    "BC01 ordinary CtrlS recovers lost committed batch response with exact intent and no automatic replay",
    "BC02 ordinary CtrlS recovers malformed committed batch response with exact intent and no automatic replay",
    "BC03 delete and real UI undo preserve split labor fields and default majoration through the create client",
    "BC04 partial paste retains the committed first 100 rows after a real second-chunk refusal without compensating DELETE",
  ];
  check(manifest.mode === "coverage" && manifest.result.status === "passed" && manifest.result.exitCode === 0 && report.run.status === "passed", "terminal-pass");
  same(report.run.results.map((entry) => entry.titlePath.join(" > ")), titles, "six-exact-titles");
  check(report.run.results.every((entry) => entry.status === "passed") && ["discovered", "selected", "executed", "passed"].every((key) => report.run.summary[key] === 6) && ["failed", "skipped", "flaky"].every((key) => report.run.summary[key] === 0), "six-passed-no-exclusions");
  check(manifest.source.changedDuringRun === false && manifest.productionBuild.changedDuringRun === false && report.run.usage.modelTokens === 0 && report.run.usage.maxModelCallsInStep === 0 && manifest.tracePaths.length === 0, "stable-source-build-model-zero-trace-off");
  check(!manifest.command.args.some((value) => String(value).startsWith("--grep")) && manifest.command.args[manifest.command.args.indexOf("--max-failures") + 1] === "1", "unfiltered-fail-fast-one");
  const locations = new Set();
  for (const entry of [...manifest.artifacts, ...manifest.coverage.retainedEvidence, manifest.report, ...(manifest.appLog ? [manifest.appLog] : [])]) {
    const file = await realpath(path.resolve(root, entry.path));
    check(file.startsWith(run + path.sep) && !locations.has(file), `owned-artifact-${entry.path}`);
    locations.add(file); same(await sha(file), entry.sha256, `artifact-sha-${entry.path}`);
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
  for (const entry of [...manifest.source.pilotInputs, ...manifest.source.untrackedRuntimeInputs, ...manifest.productionBuild.inputs]) same(await sha(path.join(root, entry.path)), entry.sha256, `current-input-${entry.path}`);
  const diff = spawnSync("git", ["-c", `safe.directory=${root}`, "diff", "HEAD", "--binary"], { cwd: root, encoding: "buffer", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  check(diff.status === 0 && hash(diff.stdout) === manifest.source.workingDiffSha256, "current-git-diff-matches-run");
  const evidence = async (name) => {
    const matches = manifest.coverage.evidence.filter((entry) => path.basename(entry.path) === name);
    check(matches.length === 1, `one-${name}`); return json(path.join(root, matches[0].path));
  };
  const profile = await evidence("profile.json"), fixture = await evidence("fixture.json"), build = await evidence("build-proof.json"), stack = await evidence("stack.json");
  const previousProfile = process.env.E2E_COVERAGE_PROFILE_PATH;
  try {
    process.env.E2E_COVERAGE_PROFILE_PATH = manifest.coverage.evidence.find((entry) => path.basename(entry.path) === "profile.json").path;
    // Reuse the same read-only chain verifier against the archived profile.
    // Every original proof it reads must also exist, byte-identical, in this run.
    const verified = await loadCoverageProfile(root);
    for (const entry of verified.evidence) {
      const archived = manifest.coverage.evidence.filter((value) => path.basename(value.path) === entry.name);
      check(archived.length === 1, `one-chain-evidence-${entry.name}`);
      same(archived[0].sha256, entry.sha256, `chain-sha-${entry.name}`);
      check(locations.has(await realpath(path.join(root, archived[0].path))), `inventoried-chain-${entry.name}`);
    }
    same(verified.evidence.length, manifest.coverage.evidence.length, "exact-chain-evidence-count");
    check(verified.metadata.scenarioSet === "batch-atomic", "installed-batch-chain-verified");
  } finally {
    if (previousProfile === undefined) delete process.env.E2E_COVERAGE_PROFILE_PATH;
    else process.env.E2E_COVERAGE_PROFILE_PATH = previousProfile;
  }
  for (const [name, digest] of [["fixture.json", profile.fixtureSha256], ["build-proof.json", profile.buildProofSha256], ["stack.json", profile.stackReceiptSha256]]) {
    const entry = manifest.coverage.evidence.find((value) => path.basename(value.path) === name);
    same(await sha(path.join(root, entry.path)), digest, `profile-sha-${name}`);
  }
  const origin = new URL(profile.backendOrigin);
  check(origin.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname), "loopback-backend");
  check(profile.scenarioSet === "batch-atomic" && manifest.coverage.scenarioSet === "batch-atomic" && fixture.status === "ready" && fixture.schemaVersion === "estimate-create-atomic-fixture-1" && profile.serverMode === "production", "explicit-batch-profile");
  check([fixture.apiUrl, manifest.coverage.backendOrigin, build.backend, stack.apiUrl].every((value) => value === profile.backendOrigin) && stack.status === "ready" && stack.runtime === "native" && profile.appOrigin === manifest.fixtures.appOrigin, "exact-native-target");
  same(fixture, manifest.coverage.fixture, "fixture-identities");
  check(build.buildId === manifest.productionBuild.id && build.sourceChangedDuringBuild === false && build.steps.length > 0 && build.steps.every((entry) => entry.exitCode === 0), "matching-successful-build");
  for (const entry of build.inputs) same(await sha(path.join(root, entry.path)), entry.sha256, `build-source-${entry.path}`);
  const business = [];
  for (const file of files.filter((entry) => entry.includes(`${path.sep}business${path.sep}`) && entry.endsWith(".json"))) business.push({ file, value: await json(file) });
  const find = (label) => {
    const matches = business.filter(({ file, value }) => path.basename(file) === `${value.fixturePrefix}-${label}.json`);
    check(matches.length === 1, `one-business-${label}`); return matches[0].value.data;
  };
  const totals = (value) => [value.total_ht_cents, value.total_tax_cents, value.total_ttc_cents];
  const ids = (state) => state.items.map((item) => item.id).sort();
  const unchangedItems = (actual, before, name) => {
    const omit = (item) => Object.fromEntries(Object.entries(item).filter(([key]) => !["updated_at", "created_at"].includes(key)));
    same(actual.map(omit).sort((a, b) => a.id.localeCompare(b.id)), before.map(omit).sort((a, b) => a.id.localeCompare(b.id)), name);
  };
  const wfc = find("wfc01-after-batch-before-assertions");
  check(wfc.response.status === 200 && wfc.response.body.ok === true && wfc.response.body.data.committed === false && wfc.editorOpened === false && wfc.explicitSave === false, "wfc01-real-refusal-before-editor");
  check(wfc.response.body.data.results.some((entry) => entry.index === 1 && entry.op === "update" && entry.status === "error" && entry.code === "NOT_FOUND"), "wfc01-late-operation-refusal");
  same(totals(wfc.before.version), [5, 0, 5], "wfc01-before-footer"); same(totals(wfc.after.version), [5, 0, 5], "wfc01-after-footer");
  unchangedItems(wfc.after.items, wfc.before.items, "wfc01-full-item-preservation");
  for (const phase of ["opened", "reloaded"]) {
    const value = find(`wfc01-${phase}`);
    same(totals(value.state.version), [5, 0, 5], `wfc01-${phase}-footer`); unchangedItems(value.state.items, wfc.before.items, `wfc01-${phase}-items`);
    check(value.repairs.length === 0 && value.dialogs.length === 0 && (phase !== "reloaded" || value.originAfter > value.originBefore), `wfc01-${phase}-no-repair`);
  }
  const noRepair = find("wfc01-no-repair-observation"); check(noRepair.repairs.length === 0 && noRepair.dialogs.length === 0, "wfc01-no-repair-through-exports");
  same(report.run.usage.downloads, 2, "two-real-wfc-downloads");
  for (const mode of ["standard", "dpgf"]) {
    const exported = find(`wfc01-export-${mode}`);
    const rel = path.relative(path.join(root, ".e2e/army/coverage/artifacts"), path.resolve(exported.artifact.path));
    check(rel && !rel.startsWith("..") && !path.isAbsolute(rel) && rel.split(path.sep).includes("downloads"), `owned-${mode}-download`);
    const file = await realpath(path.join(run, "artifacts", rel)); check(locations.has(file), `inventoried-${mode}-download`); same(await sha(file), exported.artifact.sha256, `download-${mode}-sha`);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.readFile(file);
    const sheets = Object.fromEntries(workbook.worksheets.map((sheet) => {
      const rows = []; sheet.eachRow((row) => rows.push(Array.from({ length: sheet.columnCount }, (_, index) => {
        const cell = row.getCell(index + 1); return typeof cell.value === "number" ? cell.value : cell.text || null;
      }))); return [sheet.name, rows];
    }));
    same(sheets, exported.sheets, `reparsed-${mode}-cells`);
    if (mode === "standard") {
      for (const [label, expected] of [["Total HT", 0.05], ["Total TVA", 0], ["Total TTC", 0.05]]) same(sheets.Resume.filter((row) => row[0] === label).map((row) => row[1]), [expected], `standard-${label}`);
      for (const item of wfc.before.items.filter((entry) => entry.item_type === "line")) {
        const rows = sheets.Devis.filter((row) => String(row[1]).trim() === item.title);
        check(rows.length === 1, `one-standard-row-${item.id}`);
        same(rows[0].slice(2, 8), ["u", 1, item.pu_ht_cents / 100, item.line_total_ht_cents / 100, 0, item.line_total_ttc_cents / 100], `standard-values-${item.id}`);
      }
    } else {
      const expectedIds = ids(wfc.before);
      same(sheets.Données.filter((row) => expectedIds.includes(String(row[1]))).map((row) => row[1]).sort(), expectedIds, "dpgf-all-original-identities");
    }
  }
  for (const [code, fault] of [["BC01", "lost"], ["BC02", "malformed"]]) {
    const first = find(`${code}-completed-response-before-ui`), reload = find(`${code}-reload-no-post`), resumed = find(`${code}-explicit-replay`), ledger = find(`${code}-request-ledger`);
    check(first.first.fault === fault && first.first.response.status === 200 && first.first.response.body.ok === true && first.first.response.body.data.committed === true, `${code}-real-commit-before-fault`);
    same(totals(first.persisted.version), [3000, 600, 3600], `${code}-persisted-before-recovery`);
    check(reload.beforeReloadPosts === 1 && reload.afterReloadPosts === 1 && reload.windowMs >= 3000, `${code}-reload-no-automatic-post`);
    check(resumed.status === 200 && resumed.replay.data.replayed === true && resumed.requests.length === 2, `${code}-explicit-replay`);
    same(resumed.requests[1].body, first.first.request, `${code}-same-body-and-key`); same(resumed.requests[1].ifMatch, first.first.ifMatch, `${code}-same-original-cas`);
    same(ids(resumed.resumed), ids(first.persisted), `${code}-stable-identities`); same(totals(resumed.resumed.version), [3000, 600, 3600], `${code}-recovered-footer`);
    check(!ledger.requests.some((entry) => entry.pathname.endsWith("/items/bulk")), `${code}-no-second-footer-bulk`);
  }
  const old = find("BC01-old-replay-and-body-conflict");
  same(find("BC01-explicit-replay").bufferedQuantity, "4", "newer-local-buffer-survives-recovery");
  const malformed = find("BC02-malformed-receipt");
  check(malformed.malformedReads === 1 && malformed.postsAfterMalformedRead === 1 && malformed.beforeReloadPosts === 1 && malformed.absentReceiptClaimVisible === false, "malformed-receipt-read-is-not-absence-or-replay");
  check(old.old.status === 200 && old.old.body.data.replayed === true && old.refused.status === 409 && old.refused.body.error.code === "ESTIMATE_BATCH_IDEMPOTENCY_CONFLICT", "old-replay-and-different-body-refused");
  same(old.final.items, old.newer.items, "newer-items-survive-old-replay"); same(totals(old.final.version), [4000, 800, 4800], "newer-footer-survives-old-replay");
  const initial = find("BC03-before-delete").initial;
  const splitFields = ["h_mo_atelier", "k_mo_atelier", "labor_role_atelier_id", "h_mo_chantier", "k_mo_chantier", "labor_role_chantier_id", "h_mo_majoration"];
  same(totals(initial.version), [27100, 5420, 32520], "split-initial-footer");
  for (const index of [1, 2]) {
    const value = find(`BC03-undo-${index}`);
    check(value.posts.length === 1 && value.restored.id !== value.original.id, `undo-${index}-real-create-client`);
    same(splitFields.map((field) => value.posts[0].body[field]), splitFields.map((field) => value.original[field]), `undo-${index}-emitted-split-fields`);
    same(splitFields.map((field) => value.restored[field]), splitFields.map((field) => value.original[field]), `undo-${index}-stored-split-fields`);
    same(totals(value.state.version), [27100, 5420, 32520], `undo-${index}-footer`);
  }
  const splitReload = find("BC03-reloaded"); same(totals(splitReload.final.version), [27100, 5420, 32520], "undo-reload-footer");
  for (const item of initial.items.filter((entry) => entry.item_type === "line")) {
    const restored = splitReload.final.items.filter((entry) => entry.title === item.title); check(restored.length === 1, "one-restored-title");
    same(splitFields.map((field) => restored[0][field]), splitFields.map((field) => item[field]), "restored-split-after-reload");
  }
  const paste = find("BC04-completed-chunks"), pasteSettled = find("BC04-settled-ui"), pasteReload = find("BC04-reloaded");
  check(paste.replies.length === 2 && paste.replies[0].request.operations.length === 100 && paste.replies[1].request.operations.length === 1 && paste.replies[0].response.body.data.committed === true && paste.replies[1].response.body.data.committed === false && paste.replies[1].fault === "second-parent", "real-partial-paste-boundary");
  same(paste.replies[1].request.operation_key, paste.replies[1].sent.operation_key, "fault-retains-second-intent-key");
  const lines = paste.state.items.filter((item) => item.item_type === "line");
  check(lines.length === 100 && lines.every((item) => item.quantity === 1 && item.unit_price_ht_cents === 100 && item.line_total_ht_cents === 100 && item.line_tax_cents === 20), "one-hundred-real-paste-lines");
  same(totals(paste.state.version), [10000, 2000, 12000], "partial-paste-footer"); same(pasteReload.reloaded.items, paste.state.items, "partial-paste-reload-identities-and-values");
  same(pasteSettled.settled.items, paste.state.items, "partial-paste-settled-items");
  same(totals(pasteSettled.settled.version), [10000, 2000, 12000], "partial-paste-settled-footer");
  check(pasteSettled.windowMs >= 3000 && pasteSettled.writesBeforeWindow === 2 && pasteSettled.writesAfterWindow === 2 &&
    !pasteSettled.requests.some((entry) => entry.pathname.endsWith("/items/bulk") || entry.method === "DELETE"), "partial-paste-no-repair-in-observed-window");
  same(totals(pasteReload.reloaded.version), [10000, 2000, 12000], "partial-paste-reload-footer");
  check(!pasteReload.requests.some((entry) => entry.method === "DELETE"), "partial-paste-never-compensates-by-delete");
  const secrets = Object.entries(process.env).filter(([key, value]) => /PASSWORD|SECRET|TOKEN|KEY/.test(key) && value && value.length > 15).map(([, value]) => value);
  check(secrets.length > 0, "configured-secrets-loaded-for-scan");
  let scanned = 0;
  for (const file of files.filter((entry) => /\.(json|txt|log|md|[cm]?js|tsx?)$/i.test(entry))) {
    const text = await readFile(file, "utf8"); scanned++;
    check(!secrets.some((secret) => text.includes(secret)) && !/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text), `privacy-${relative(file)}`);
  }
  Object.assign(receipt, { status: "qualified-local-selected-estimate-batch", run: relative(run), manifestSha256: await sha(path.join(run, "manifest.json")), buildId: build.buildId, fixtureSha256: profile.fixtureSha256, backendOrigin: profile.backendOrigin, executionPlatform: manifest.runtime.platform, buildOriginPlatform: profile.buildOriginPlatform, privacyTextFilesScanned: scanned });
} catch (error) { receipt.status = "failed"; receipt.error = error instanceof Error ? error.message : "Qualification failed"; }
receipt.finishedAt = new Date().toISOString();
const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
await writeFile(path.join(output, "qualification.json"), bytes, { flag: "wx" });
await writeFile(path.join(output, "qualification.sha256"), `${hash(bytes)}  qualification.json\n`, { flag: "wx" });
console.log(JSON.stringify({ status: receipt.status, path: relative(output), sha256: hash(bytes), failedChecks: checks.filter((entry) => !entry.passed).map((entry) => entry.name) }));
if (receipt.status === "failed") process.exitCode = 1;
