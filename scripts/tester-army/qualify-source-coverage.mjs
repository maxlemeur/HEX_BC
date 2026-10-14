import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, readFile, readdir, mkdir, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { loadCoverageProfile } from "./coverage-profile.mjs";
import { buildCommands } from "./local-recipe-common.mjs";
import { assertCctpPrivateBytes, cctpScenarioNames, inspectCctpWorkbook, redactCctpMetadata, validateCctpResults, validateCctpScenarios, verifyCctpWorkbookValues } from "./cctp-reader-support.mjs";

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const relative = (file) => path.relative(root, file).replaceAll("\\", "/");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const sha = async (file) => hash(await readFile(file));
const checks = [];
const check = (condition, name) => { checks.push({ name, passed: Boolean(condition) }); if (!condition) throw new Error(name); };
const same = (actual, expected, name) => check(isDeepStrictEqual(actual, expected), name);
const digest = /^[0-9a-f]{64}$/;
const usage = "Usage: node scripts/tester-army/qualify-source-coverage.mjs <exact .e2e/army/coverage/runs/run-directory>";
if (process.argv.length === 3 && process.argv[2] === "--help") { console.log(usage); process.exit(0); }
if (process.argv.length !== 3 || process.argv[2].startsWith("--")) { console.error(usage); process.exit(2); }
const runBase = path.join(root, ".e2e/army/coverage/runs");
const run = path.resolve(root, process.argv[2]);
if (path.dirname(run) !== runBase) { console.error("Supply one exact direct child of the coverage runs directory; no latest-result selection."); process.exit(2); }
async function owned(file, base = root) {
  const unresolved = path.resolve(file), rel = path.relative(base, unresolved);
  check(rel && !rel.startsWith("..") && !path.isAbsolute(rel), "owned-path");
  let current = base;
  for (const segment of rel.split(path.sep)) { current = path.join(current, segment); check(!(await lstat(current)).isSymbolicLink(), "no-path-symlink"); }
  const actual = await realpath(unresolved), inside = path.relative(await realpath(base), actual);
  check(inside && !inside.startsWith("..") && !path.isAbsolute(inside), "confined-realpath"); return actual;
}
async function walk(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    check(!entry.isSymbolicLink(), "no-evidence-symlink"); const file = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await walk(file)); else { check(entry.isFile(), "regular-evidence-file"); found.push(file); }
  }
  return found;
}
async function inputPaths(directory) { return (await walk(directory)).map(relative); }
function git(args) {
  const result = spawnSync("git", ["-c", `safe.directory=${root}`, ...args], { cwd: root, encoding: "buffer", windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  check(result.status === 0, "git-read-success"); return result.stdout;
}
await owned(path.join(root, ".e2e/army/coverage"));
const outputBase = path.join(root, ".e2e/army/coverage/qualifications");
await mkdir(outputBase, { recursive: true }); await owned(outputBase);
const output = path.join(outputBase, `${path.basename(run)}-${randomUUID().slice(0, 8)}`);
await mkdir(output, { recursive: false });
const receipt = {
  schemaVersion: "army-source-coverage-qualification-1", status: "checking",
  startedAt: new Date().toISOString(), command: { executable: process.execPath, args: process.argv.slice(1) },
  readerSha256: await sha(fileURLToPath(import.meta.url)), checks,
  limits: [
    "Eleven selected business journeys and ordinary authentication only; not whole DOS-CAL-01 or whole-application completion.",
    "Synthetic corpus and simulated human decisions; no professional validation or proof of CCTP exhaustiveness.",
    "No native concurrent race, complete role matrix, source deletion, duplication, archival or hours/margin/order mutation qualification is inferred.",
    "A real server response is discarded after commit; this does not qualify every process or Storage crash point.",
    "No pixel review or generated print PDF is inferred from DOM, XLSX downloads or API assertions.",
    "The editor is awaited ready after reload; rapid departure is outside these selected coverage journeys and belongs to the separate NAV qualification.",
  ],
};
try {
  check(process.versions.node.split(".")[0] === "24", "node-24");
  await owned(runBase); await owned(run, runBase);
  const files = await walk(run);
  const manifest = await json(path.join(run, "manifest.json"));
  const report = await json(path.join(run, "report.json"));
  check(manifest.schemaVersion === "miaouffrage-tester-army-1" && manifest.mode === "coverage" && manifest.result?.status === "passed" &&
    manifest.result.exitCode === 0 && manifest.result.runnerExitCode === 0 && Number.isFinite(Date.parse(manifest.finishedAt)), "terminal-coverage-pass");
  validateCctpResults(report, manifest.command.args.slice(1)); check(true, "twelve-exact-results-single-attempt-no-filter");
  same(manifest.result.summary, report.run.summary, "manifest-report-summary"); same(manifest.result.usage, report.run.usage, "manifest-report-usage");
  same(manifest.result.tests, report.run.results.map(({ file, titlePath, targetId, status }) => ({ file, titlePath, targetId, status })), "manifest-report-result-identities");
  check(manifest.source.changedDuringRun === false && manifest.productionBuild.changedDuringRun === false && report.run.usage.modelTokens === 0 && report.run.usage.maxModelCallsInStep === 0 && manifest.tracePaths.length === 0, "stable-source-build-no-model-or-trace");
  same(manifest.source.pilotInputsAfter, manifest.source.pilotInputs, "pilot-inputs-stable");
  same(manifest.source.untrackedRuntimeInputsAfter, manifest.source.untrackedRuntimeInputs, "runtime-inputs-stable");
  same(manifest.source.workingDiffAfterSha256, manifest.source.workingDiffSha256, "diff-stable");
  check(manifest.fixtures.authentication?.result === "passed", "ordinary-auth-passed");
  const declared = [...manifest.artifacts, ...manifest.coverage.retainedEvidence, manifest.report, ...(manifest.appLog ? [manifest.appLog] : [])];
  const locations = new Set();
  same(manifest.report.path, relative(path.join(run, "report.json")), "exact-archived-report-path");
  for (const entry of declared) {
    check(typeof entry.path === "string" && !path.isAbsolute(entry.path) && digest.test(entry.sha256), "artifact-entry-shape");
    const file = await owned(path.resolve(root, entry.path), run);
    check(!locations.has(file), "unique-owned-artifact");
    locations.add(file); check(await sha(file) === entry.sha256, "artifact-sha");
  }
  check(files.every((file) => file === path.join(run, "manifest.json") || locations.has(file)), "complete-archive-inventory");
  const downloads = [];
  for (const result of report.run.results) for (const artifact of result.attempts[0].artifacts ?? []) {
    check(typeof artifact.path === "string" && !path.isAbsolute(artifact.path) && digest.test(artifact.sha256) && !["trace", "video"].includes(artifact.kind), "safe-report-artifact");
    const file = await owned(path.join(run, "artifacts", artifact.path), path.join(run, "artifacts"));
    check(locations.has(file), "report-artifact-inventoried"); same(await sha(file), artifact.sha256, "report-artifact-sha");
    same((await lstat(file)).size, artifact.size, "report-artifact-size");
    if (artifact.kind === "download") downloads.push({ ...artifact, file });
  }
  same(downloads.length, 26, "twenty-six-captured-downloads");
  for (const entries of [manifest.source.pilotInputs, manifest.source.untrackedRuntimeInputs, manifest.productionBuild.inputs]) {
    check(Array.isArray(entries) && new Set(entries.map((e) => e.path)).size === entries.length, "unique-source-inputs");
    for (const entry of entries) {
      check(typeof entry.path === "string" && !path.isAbsolute(entry.path) && digest.test(entry.sha256), "source-input-shape");
      same(await sha(await owned(path.join(root, entry.path))), entry.sha256, "current-input-sha");
    }
  }
  same(manifest.productionBuild.inputs.map((e) => e.path).sort(), [".e2e/army/next/BUILD_ID", ".e2e/army/next/build-manifest.json", ".e2e/army/next/required-server-files.json"].sort(), "complete-build-runtime-inputs");
  const currentPilot = ["e2e.config.ts", "scripts/run-tester-army.mjs", "package-lock.json", "package.json", "next.config.ts", "tsconfig.json",
    ...await inputPaths(path.join(root, "e2e/army")), ...await inputPaths(path.join(root, "scripts/tester-army")),
    ...git(["ls-files", "--others", "--exclude-standard", "-z", "--", "supabase/migrations"]).toString().split("\0").filter(Boolean)];
  same(manifest.source.pilotInputs.map((e) => e.path).sort(), currentPilot.sort(), "complete-current-pilot-input-set");
  const currentRuntime = git(["ls-files", "--others", "--exclude-standard", "-z"]).toString().split("\0").filter((f) => f.startsWith("src/") || f.startsWith("public/"));
  same(manifest.source.untrackedRuntimeInputs.map((e) => e.path).sort(), currentRuntime.sort(), "complete-current-untracked-runtime-set");
  same(git(["rev-parse", "HEAD"]).toString().trim(), manifest.source.revision, "current-revision");
  same(report.run.vcs.commit, manifest.source.revision, "report-source-revision");
  same(report.run.vcs.branch, "main", "run-main-branch"); same(git(["branch", "--show-current"]).toString().trim(), "main", "current-main-branch");
  same(hash(git(["diff", "HEAD", "--binary"])), manifest.source.workingDiffSha256, "current-git-diff-matches-run");
  const evidenceEntry = (name) => {
    const matches = manifest.coverage.evidence.filter((e) => path.basename(e.path) === name);
    check(matches.length === 1, "one-chain-evidence"); return matches[0];
  };
  const evidence = async (name) => json(await owned(path.join(root, evidenceEntry(name).path), run));
  const profile = await evidence("profile.json"), fixture = await evidence("fixture.json"), build = await evidence("build-proof.json");
  const verified = await loadCoverageProfile(root, { configuredPath: evidenceEntry("profile.json").path });
  check(verified.metadata.scenarioSet === "source-coverage", "profile-chain-reloaded"); same(verified.metadata.fixture, fixture, "fixture-chain-reloaded");
  for (const entry of verified.evidence) {
    await owned(entry.file); const archived = evidenceEntry(entry.name); same(archived.sha256, entry.sha256, "chain-evidence-sha");
    check(locations.has(await owned(path.join(root, archived.path), run)), "chain-artifact-inventoried");
  }
  same(verified.evidence.length, manifest.coverage.evidence.length, "exact-chain-evidence-count");
  validateCctpScenarios(fixture); check(true, "eleven-independent-scenarios"); same(manifest.coverage.fixture, fixture, "archived-fixture-identities");
  check(profile.scenarioSet === "source-coverage" && manifest.coverage.scenarioSet === "source-coverage" && manifest.environment === "owned isolated production server", "explicit-production-coverage");
  check(profile.backendOrigin === fixture.apiUrl && profile.backendOrigin === manifest.coverage.backendOrigin && profile.appOrigin === manifest.fixtures.appOrigin && profile.serverMode === "production" && fixture.status === "ready" && fixture.prefix.startsWith("ARMY-COVERAGE-"), "explicit-local-profile-and-fixture");
  const backend = new URL(profile.backendOrigin);
  check(backend.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname), "loopback-only-backend");
  for (const [name, expected] of [["fixture.json", profile.fixtureSha256], ["stack.json", profile.stackReceiptSha256], ["build-proof.json", profile.buildProofSha256]]) same(evidenceEntry(name).sha256, expected, `profile-sha-${name}`);
  check(build.buildId === manifest.productionBuild.id && build.revision === manifest.source.revision && build.backend === profile.backendOrigin && build.sourceChangedDuringBuild === false && build.steps?.length > 0 && build.steps.every((e) => e.exitCode === 0), "profile-build-identity");
  if (build.schemaVersion === "army-local-build-1") { same(build.steps.map((e) => e.args), buildCommands, "three-exact-build-commands"); same(build.inputsAfter, build.inputs, "build-inputs-after-stable"); }
  for (const input of build.inputs) same(await sha(await owned(path.join(root, input.path))), input.sha256, "build-source-sha");
  const sourceDiff = files.filter((f) => path.basename(f) === "source.diff"); same(sourceDiff.length, 1, "one-archived-source-diff"); same(await sha(sourceDiff[0]), manifest.source.workingDiffSha256, "archived-source-diff-sha");
  const business = [];
  for (const file of files.filter((file) => file.includes(`${path.sep}business${path.sep}`) && file.endsWith(".json"))) {
    const entry = await json(file), recorded = Date.parse(entry.recordedAt);
    check(entry.schemaVersion === "miaouffrage-army-business-1" && Number.isFinite(recorded) &&
      recorded >= Date.parse(manifest.startedAt) && recorded <= Date.parse(manifest.finishedAt), "business-shape-current-run");
    business.push({ file, ...entry });
  }
  const find = (scenario, label) => {
    const matches = business.filter((entry) => entry.projectName === `${fixture.prefix}-${scenario}` && path.basename(entry.file) === `${entry.fixturePrefix}-${label}.json`);
    check(matches.length === 1, `unique-${scenario}-${label}`); return matches[0].data;
  };
  const expectedCounts = { total: 8, treatments: { unresolved: 1, priced: 2, included: 1, excluded: 1, other_lot: 1, provisional: 2 }, validities: { unreviewed: 1, current: 7, needs_review: 0 } };
  const corpus = await json(path.join(root, "e2e/fixtures/source-coverage/manifest.json"));
  const forbidden = [...new Set(corpus.documents.flatMap((d) => d.clauses.map((c) => c.text))), "ARMY hypothèse :", "ARMY pièce manquante :", "Recette synthétique E", "Détail et accès à confirmer"];
  const parsedDownloads = new Set();
  const exports = async (name, label, s0) => {
    const captured = find(name, `exports-${label}`);
    same(captured.map((e) => e.mode), ["standard", "dpgf"], `two-export-modes-${name}-${label}`);
    for (const entry of captured) {
      check(typeof entry.path === "string" && digest.test(entry.sha256), "captured-workbook-shape");
      const matching = downloads.filter((d) => entry.path.replaceAll("\\", "/") === path.join(root, ".e2e/army/coverage/artifacts", d.path).replaceAll("\\", "/"));
      check(matching.length === 1 && !parsedDownloads.has(matching[0].file), "one-owned-download-per-capture");
      const download = matching[0]; same(entry.sha256, download.sha256, "workbook-captured-sha");
      const sheets = await inspectCctpWorkbook(await readFile(download.file), entry.sheets, forbidden);
      verifyCctpWorkbookValues(sheets, entry.mode, fixture.scenarios[name], s0.items);
      check(true, `parsed-workbook-values-${name}-${label}-${entry.mode}`); parsedDownloads.add(download.file);
    }
  };
  for (const name of cctpScenarioNames) {
    const s0 = find(name, "s0"), s1 = find(name, "s1-eight-requirements");
    check(isDeepStrictEqual(s0.totals, [71000, 14200, 85200]) && s0.hours === 8 && s0.items.length === 6 && isDeepStrictEqual(s1.counts, expectedCounts), `real-s0-s1-${name}`);
    check(s0.items.every((item) => item.version_id === fixture.scenarios[name].versionId) && new Set(s0.items.map((item) => item.id)).size === 6 &&
      s1.versionId === fixture.scenarios[name].versionId && s1.projectId === fixture.scenarios[name].projectId, `owned-s0-s1-${name}`);
    await exports(name, "s0", s0);
    if (name === "nominal") await exports(name, "s1", s0);
    if (name === "reference") await exports(name, "b", s0);
    const immediate = find(name, "s0-immediate-api"), synchronized = find(name, "s0-already-synchronized");
    const steps = [[48000,9600,57600],[53000,10600,63600],[71000,14200,85200]];
    check(immediate.explicitSaveAfterCreates === false && immediate.immediate.length === 3 && immediate.immediate.every((entry, index) => entry.status === 201 &&
      isDeepStrictEqual(entry.actualTotals, steps[index]) && isDeepStrictEqual(entry.expectedTotals, steps[index]) && s0.items.some((item) => item.id === entry.itemId)), `atomic-s0-creations-${name}`);
    check(synchronized.explicitSaveAfterCreates === false && synchronized.posts.length === 0 && synchronized.samples.length >= 3 &&
      Date.parse(synchronized.observationEndedAt) - Date.parse(synchronized.observationStartedAt) >= 3000 && synchronized.samples.every((sample) => /^(Sauvegardé|À jour)$/.test(sample.status.trim()) && isDeepStrictEqual(sample.totals, [71000,14200,85200])), `already-synchronized-s0-without-repair-${name}`);
    const applied = find(name, "applied-work"), register = find(name, "canonical-register");
    check(applied.applications.length === 1 && applied.snapshots.length === 1 && applied.line.description === "m" && applied.line.h_mo === 5 && register.length === 2 && register.every((entry) => entry.origin_kind === "manual" && entry.status === "open"), `real-provenance-and-register-${name}`);
  }
  same(parsedDownloads.size, downloads.length, "all-downloads-independently-parsed");
  const final = find("nominal", "nominal-complete");
  check(isDeepStrictEqual(final.counts, expectedCounts) && final.finalCoverageSeeded === false && final.component.fact.kind === "component", "nominal-eight-requirements");
  check(isDeepStrictEqual(find("reference", "reference-b-complete").counts.validities, { unreviewed: 1, current: 1, needs_review: 6 }), "only-e4-revalidated-under-b");
  const recovery = find("recovery", "recovery-complete"), lost = find("recovery", "decision-response-discarded");
  check(lost.status === 201 && lost.discarded && recovery.sameEvent && recovery.noAutomaticPosts && recovery.postsBeforeReload === recovery.postsAfterReload && isDeepStrictEqual(recovery.before.history, recovery.after.history), "lost-response-exact-history-preserved");
  for (const fault of ["503", "malformed"]) { const failure = find("read_failure", `unavailable-${fault}`); check(failure.intercepted > 0 && failure.posts === 0, `actual-read-fault-${fault}`); }
  for (const [name, totals, invalid] of [["l2_quantity", [72000,14400,86400], ["E3"]], ["l1_quantity", [75000,15000,90000], ["E1"]],
    ["l4_quantity", [73000,14600,87600], []], ["l2_price", [71800,14360,86160], []]]) {
    const result = find(name, "targeted-invalidation"), money = find(name, "mutation-finances");
    same(money.totals, totals, `mutated-cents-${name}`); same(result.mutation.stale, invalid, `targeted-invalidations-${name}`);
    same(result.final.counts.validities, { unreviewed: 1, current: 7 - invalid.length, needs_review: invalid.length }, `targeted-counts-${name}`);
  }
  const stale = find("stale", "stale-decision-rejected");
  check(stale.response.status === 409 && stale.ordinaryHttpFault === true && isDeepStrictEqual(stale.before.history, stale.after.history), "stale-decision-preserves-history");
  const network = (await readFile(path.join(run, "server-network.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  check(network.some((entry) => entry.kind === "guard-installed") && network.every((entry) => entry.kind === "guard-installed" ||
    entry.allowed === true && [profile.backendOrigin, profile.appOrigin].includes(entry.origin)), "guarded-server-network");
  check(network.filter((entry) => entry.kind === "guard-installed").every((entry) => isDeepStrictEqual(entry.allowedOrigins, [profile.backendOrigin, profile.appOrigin])), "exact-server-network-origins");
  check(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "E2E_LOGIN_EMAIL", "E2E_LOGIN_PASSWORD"].every((key) => process.env[key]), "configured-secret-scan-inputs");
  let scanned = 0;
  for (const file of files) {
    const bytes = await readFile(file), text = bytes.toString("utf8"); scanned++;
    if (file.endsWith(".json")) JSON.parse(text);
    assertCctpPrivateBytes(bytes); check(true, "private-all-archive-bytes");
  }
  receipt.status = "qualified-local-selected-source-coverage";
  receipt.run = { path: relative(run), manifestSha256: await sha(path.join(run, "manifest.json")), reportSha256: await sha(path.join(run, "report.json")), summary: report.run.summary };
  receipt.build = { id: build.buildId, origin: manifest.coverage.buildOriginPlatform, execution: manifest.coverage.executionPlatform };
  receipt.confidentiality = { files: scanned, workbooks: parsedDownloads.size, decodedZipEntries: true, valuesRetained: false,
    scope: "All archived bytes and decoded XLSX entries checked for every configured secret value and URI/JSON encodings, JWTs and raw lease UUID fields; no unknown-secret or pixel disclosure proof." };
  if (receipt.build.origin !== receipt.build.execution) receipt.limits.push("Build and execution platforms differ; no new native-platform production or performance proof.");
} catch (error) {
  receipt.status = "failed"; receipt.error = checks.at(-1)?.passed === false ? checks.at(-1).name : "Required evidence could not be read or verified.";
  if (error?.code === "ENOENT") receipt.error = "Required evidence is missing.";
  process.exitCode = 1;
}
receipt.finishedAt = new Date().toISOString();
const bytes = JSON.stringify(redactCctpMetadata(receipt), null, 2) + "\n";
await writeFile(path.join(output, "qualification.json"), bytes, { flag: "wx" });
await writeFile(path.join(output, "qualification.json.sha256"), hash(bytes) + "\n", { flag: "wx" });
console.log(JSON.stringify(redactCctpMetadata({ status: receipt.status, path: relative(output), sha256: hash(bytes), failedChecks: checks.filter((entry) => !entry.passed).map((entry) => entry.name) })));
