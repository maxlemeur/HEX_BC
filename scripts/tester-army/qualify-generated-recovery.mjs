import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { loadCoverageProfile } from "./coverage-profile.mjs";

// Reader failure modes are defined before implementation in
// docs/testing/local-recipe-reader.md. This script performs no network or SQL.
const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const relative = (file) => path.relative(root, file).replaceAll("\\", "/");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (file) => JSON.parse(await readFile(file, "utf8"));
const sha = async (file) => hash(await readFile(file));
const digest = /^[0-9a-f]{64}$/;
const checks = [];
const check = (condition, name) => {
  checks.push({ name, passed: Boolean(condition) });
  if (!condition) throw new Error(name);
};
const same = (actual, expected, name) => check(isDeepStrictEqual(actual, expected), name);
const usage = "Usage: node scripts/tester-army/qualify-generated-recovery.mjs <exact .e2e/army/coverage/runs/run-directory>";
if (process.argv.length === 3 && process.argv[2] === "--help") {
  console.log(usage);
  process.exit(0);
}
if (process.argv.length !== 3 || process.argv[2].startsWith("--")) {
  console.error(usage);
  process.exit(2);
}

async function owned(file, base = root) {
  const unresolved = path.resolve(file), rel = path.relative(base, unresolved);
  check(rel && !rel.startsWith("..") && !path.isAbsolute(rel), "owned-path");
  let current = base;
  for (const segment of rel.split(path.sep)) {
    current = path.join(current, segment);
    check(!(await lstat(current)).isSymbolicLink(), "no-path-symlink");
  }
  const actual = await realpath(unresolved), inside = path.relative(await realpath(base), actual);
  check(inside && !inside.startsWith("..") && !path.isAbsolute(inside), "confined-realpath");
  return actual;
}
async function walk(directory) {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    check(!entry.isSymbolicLink(), "no-archive-symlink");
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...await walk(file));
    else { check(entry.isFile(), "regular-archive-file"); found.push(file); }
  }
  return found;
}
async function inputPaths(directory) {
  const entries = await readdir(directory, { withFileTypes: true }), files = [];
  for (const entry of entries) {
    check(!entry.isSymbolicLink(), "no-input-inventory-symlink");
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await inputPaths(file));
    else if (entry.isFile()) files.push(relative(file));
  }
  return files;
}
function git(args) {
  const result = spawnSync("git", ["-c", `safe.directory=${root}`, ...args], {
    cwd: root, encoding: "buffer", windowsHide: true, maxBuffer: 32 * 1024 * 1024,
  });
  check(result.status === 0, "git-read-success");
  return result.stdout;
}

const runBase = path.join(root, ".e2e", "army", "coverage", "runs");
const requested = path.resolve(root, process.argv[2]);
if (path.dirname(requested) !== runBase) {
  console.error("Supply an exact direct child of the coverage runs directory; no latest selection.");
  process.exit(2);
}
const outputBase = path.join(root, ".e2e", "army", "coverage", "generated-recovery-qualifications");
await mkdir(outputBase, { recursive: true });
await owned(outputBase);
const output = path.join(outputBase, `${path.basename(requested)}-${randomUUID().slice(0, 8)}`);
await mkdir(output, { recursive: false });
const receipt = {
  schemaVersion: "army-generated-recovery-qualification-1", status: "checking", startedAt: new Date().toISOString(),
  command: { executable: process.execPath, args: process.argv.slice(1) },
  readerSha256: await sha(fileURLToPath(import.meta.url)), checks,
  limits: [
    "Seven selected ordinary Auth and GO01-GO06 results only; not complete application qualification.",
    "Lost/malformed responses are controlled client transport faults after real server actions, not process-crash proof.",
    "No automatic application is asserted only within the recorded 3-second windows.",
    "GO03 changes a real review in the same ordinary browser session; independent sessions and SQL races require separate native evidence.",
    "GO06 exercises the real local fallback with model keys disabled, and its captured catalogue context; model-enabled generation is not qualified.",
    "Native SQL, pgTAP, concurrency, role/tenant transitions, physical Storage, performance, exports and deployment remain scoped to separate evidence.",
    "CORE06 rapid page departure remains unqualified; these journeys await editor readiness.",
  ],
};
try {
  check(process.versions.node.split(".")[0] === "24", "node-24");
  await owned(runBase);
  const run = await owned(requested, runBase), files = await walk(run);
  const manifest = await json(path.join(run, "manifest.json"));
  const report = await json(path.join(run, "report.json"));
  check(manifest.schemaVersion === "miaouffrage-tester-army-1" && manifest.mode === "coverage" &&
    manifest.result?.status === "passed" && manifest.result.exitCode === 0 && report.schemaVersion === "report-1" &&
    report.run?.status === "passed" && report.run.exitCode === 0 && Number.isFinite(Date.parse(manifest.finishedAt)), "terminal-pass");
  same(manifest.result.summary, report.run.summary, "manifest-report-summary"); same(manifest.result.usage, report.run.usage, "manifest-report-usage");
  same(manifest.result.runnerExitCode, 0, "runner-exit-zero");
  same(manifest.result.tests, report.run.results.map(({ file, titlePath, targetId, status }) => ({ file, titlePath, targetId, status })), "manifest-report-result-identities");
  const titles = [
    "authenticate the existing E2E account without provisioning memberships",
    "GO01 generated application lost committed response survives reload and exact explicit recovery",
    "GO02 generated application malformed committed response survives reload and exact explicit recovery",
    "GO03 stale human review refuses application and stale save before explicit reload of the current reviewed content",
    "GO05 a lost real refusal can be durably abandoned after review changes without enabling the old intent",
    "GO04 edited reviewed cost blocks insertion until revalidation and partial selection survives reload",
    "GO06 two real local fallback generations discard the previous pending draft only after replacement and resume the current draft",
  ];
  same(report.run.results.map((entry) => entry.titlePath.join(" > ")).sort(), [...titles].sort(), "seven-exact-titles");
  for (const key of ["id", "testId"]) check(new Set(report.run.results.map((entry) => entry[key])).size === 7, `unique-result-${key}`);
  check(report.run.results.every((entry) => entry.selected === true && entry.status === "passed" && entry.repeat === 0 &&
    entry.platform === "web" && entry.targetId === "chromium-desktop" && entry.agent === "default" &&
    entry.file === (entry.kind === "setup" ? "e2e/army/critical/auth.setup.e2e.ts" : "e2e/army/local/estimate-generated-recovery.e2e.ts") &&
    entry.attempts?.length === 1 && entry.attempts[0].index === 0 && entry.attempts[0].status === "passed" &&
    entry.attempts[0].cleanup === "complete" && !entry.skip && !entry.attempts[0].error && !entry.attempts[0].secondaryErrors?.length), "single-passed-attempt-no-retry");
  check(report.run.results.filter((entry) => entry.kind === "setup").length === 1 &&
    report.run.results[0].titlePath[0] === titles[0] &&
    ["discovered", "selected", "executed", "passed"].every((key) => report.run.summary[key] === 7) &&
    ["failed", "skipped", "flaky"].every((key) => report.run.summary[key] === 0), "seven-passed-no-exclusions");
  const args = manifest.command.args.slice(1), allowedFlags = new Set(["--headed", "--no-cache", "--debug"]);
  same(args.filter((arg) => !allowedFlags.has(arg)), ["run", "--config", "e2e.config.ts", "--tag", "source-coverage",
    "--exclude-tag", "agent", "--target", "chromium-desktop", "--max-failures", "1"], "unfiltered-fail-fast-one");
  check(manifest.source.changedDuringRun === false && manifest.productionBuild.changedDuringRun === false &&
    report.run.usage.modelTokens === 0 && report.run.usage.maxModelCallsInStep === 0 && report.run.usage.downloads === 0 &&
    manifest.tracePaths?.length === 0 && manifest.fixtures.authentication?.result === "passed", "stable-model-zero-no-trace");
  same(manifest.source.pilotInputsAfter, manifest.source.pilotInputs, "pilot-inputs-stable");
  same(manifest.source.untrackedRuntimeInputsAfter, manifest.source.untrackedRuntimeInputs, "runtime-inputs-stable");
  same(manifest.source.workingDiffAfterSha256, manifest.source.workingDiffSha256, "diff-stable");
  const locations = new Set();
  same(manifest.report.path, relative(path.join(run, "report.json")), "exact-archived-report-path");
  for (const entry of [...manifest.artifacts, ...manifest.coverage.retainedEvidence, manifest.report, ...(manifest.appLog ? [manifest.appLog] : [])]) {
    check(typeof entry.path === "string" && !path.isAbsolute(entry.path) && digest.test(entry.sha256), "artifact-entry-shape");
    const file = await owned(path.join(root, entry.path), run);
    check(!locations.has(file), "unique-artifact-location"); locations.add(file);
    same(await sha(file), entry.sha256, `artifact-sha-${path.basename(file)}`);
  }
  check(files.every((file) => file === path.join(run, "manifest.json") || locations.has(file)), "complete-archive-inventory");
  for (const result of report.run.results) for (const artifact of result.attempts[0].artifacts ?? []) {
    check(typeof artifact.path === "string" && !path.isAbsolute(artifact.path) && digest.test(artifact.sha256) &&
      !["trace", "video"].includes(artifact.kind), "report-artifact-safe");
    const file = await owned(path.join(run, "artifacts", artifact.path), path.join(run, "artifacts"));
    check(locations.has(file), "report-artifact-inventoried"); same(await sha(file), artifact.sha256, "report-artifact-sha");
    same((await lstat(file)).size, artifact.size, "report-artifact-size");
  }
  for (const entries of [manifest.source.pilotInputs, manifest.source.untrackedRuntimeInputs, manifest.productionBuild.inputs]) {
    check(Array.isArray(entries) && new Set(entries.map((entry) => entry.path)).size === entries.length, "unique-source-inputs");
    for (const entry of entries) {
      check(typeof entry.path === "string" && !path.isAbsolute(entry.path) && digest.test(entry.sha256), "source-input-shape");
      same(await sha(await owned(path.join(root, entry.path))), entry.sha256, `current-input-${entry.path}`);
    }
  }
  same(manifest.productionBuild.inputs.map((entry) => entry.path).sort(), [".e2e/army/next/BUILD_ID", ".e2e/army/next/build-manifest.json", ".e2e/army/next/required-server-files.json"].sort(), "complete-build-runtime-inputs");
  const currentPilot = ["e2e.config.ts", "scripts/run-tester-army.mjs", "package-lock.json", "package.json", "next.config.ts", "tsconfig.json",
    ...await inputPaths(path.join(root, "e2e", "army")), ...await inputPaths(path.join(root, "scripts", "tester-army")),
    ...git(["ls-files", "--others", "--exclude-standard", "-z", "--", "supabase/migrations"]).toString().split("\0").filter(Boolean)];
  same(manifest.source.pilotInputs.map((entry) => entry.path).sort(), currentPilot.sort(), "complete-current-pilot-input-set");
  const currentRuntime = git(["ls-files", "--others", "--exclude-standard", "-z"]).toString().split("\0")
    .filter((file) => file.startsWith("src/") || file.startsWith("public/"));
  same(manifest.source.untrackedRuntimeInputs.map((entry) => entry.path).sort(), currentRuntime.sort(), "complete-current-untracked-runtime-set");
  same(git(["rev-parse", "HEAD"]).toString().trim(), manifest.source.revision, "current-revision");
  same(report.run.vcs.commit, manifest.source.revision, "report-source-revision");
  same(report.run.vcs.branch, "main", "run-main-branch"); same(git(["branch", "--show-current"]).toString().trim(), "main", "current-main-branch");
  same(hash(git(["diff", "HEAD", "--binary"])), manifest.source.workingDiffSha256, "current-diff-matches-run");
  const evidenceEntry = (name) => {
    const matches = manifest.coverage.evidence.filter((entry) => path.basename(entry.path) === name);
    check(matches.length === 1, `one-chain-${name}`); return matches[0];
  };
  const evidence = async (name) => json(await owned(path.join(root, evidenceEntry(name).path), run));
  const profile = await evidence("profile.json"), fixture = await evidence("fixture.json"), generated = await evidence("generated-fixture.json"), build = await evidence("build-proof.json");
  const previous = process.env.E2E_COVERAGE_PROFILE_PATH;
  try {
    process.env.E2E_COVERAGE_PROFILE_PATH = evidenceEntry("profile.json").path;
    const verified = await loadCoverageProfile(root);
    check(verified.metadata.scenarioSet === "generated-recovery", "profile-chain-reloaded");
    same(verified.metadata.fixture, fixture, "owner-fixture-reloaded"); same(verified.metadata.generatedFixture, generated, "generated-fixture-reloaded");
    for (const entry of verified.evidence) {
      await owned(entry.file);
      const archived = evidenceEntry(entry.name); same(archived.sha256, entry.sha256, `chain-sha-${entry.name}`);
      check(locations.has(await owned(path.join(root, archived.path), run)), "chain-artifact-inventoried");
    }
    same(verified.evidence.length, manifest.coverage.evidence.length, "exact-chain-evidence-count");
  } finally {
    if (previous === undefined) delete process.env.E2E_COVERAGE_PROFILE_PATH; else process.env.E2E_COVERAGE_PROFILE_PATH = previous;
  }
  check(profile.scenarioSet === "generated-recovery" && manifest.coverage.scenarioSet === "generated-recovery" &&
    profile.serverMode === "production" && manifest.environment === "owned isolated production server", "explicit-production-recovery");
  same(manifest.coverage.fixture, fixture, "archived-owner-identities"); same(manifest.coverage.generatedFixture, generated, "archived-generated-identities");
  for (const [name, expected] of [["fixture.json", profile.fixtureSha256], ["generated-fixture.json", profile.generatedFixtureSha256],
    ["stack.json", profile.stackReceiptSha256], ["build-proof.json", profile.buildProofSha256]]) same(evidenceEntry(name).sha256, expected, `profile-sha-${name}`);
  same(build.buildId, manifest.productionBuild.id, "matching-build-id"); same(build.revision, manifest.source.revision, "build-source-revision");
  same([build.backend, generated.apiUrl, fixture.apiUrl, manifest.coverage.backendOrigin], Array(4).fill(profile.backendOrigin), "exact-backend-origins");
  same(manifest.fixtures.appOrigin, profile.appOrigin, "exact-app-origin");
  check(build.sourceChangedDuringBuild === false && build.steps?.length > 0 && build.steps.every((entry) => entry.exitCode === 0), "successful-build");
  check(["scripts/validate-openapi-runner.mjs", "scripts/check-performance-budgets.ts"].every((name) => build.steps.some((entry) => entry.args.includes(name))) &&
    build.steps.some((entry) => entry.args.includes("build") && entry.args.some((arg) => arg.endsWith("next/dist/bin/next"))), "openapi-build-budgets-executed");
  for (const input of build.inputs) same(await sha(await owned(path.join(root, input.path))), input.sha256, `build-source-${input.path}`);
  const sourceDiff = files.filter((file) => path.basename(file) === "source.diff");
  same(sourceDiff.length, 1, "one-archived-source-diff"); same(await sha(sourceDiff[0]), manifest.source.workingDiffSha256, "archived-source-diff-sha");
  const business = [];
  for (const file of files.filter((entry) => entry.includes(`${path.sep}business${path.sep}`) && entry.endsWith(".json"))) {
    const value = await json(file);
    const recorded = Date.parse(value.recordedAt);
    check(value.schemaVersion === "miaouffrage-army-business-1" && Number.isFinite(recorded) &&
      recorded >= Date.parse(manifest.startedAt) && recorded <= Date.parse(manifest.finishedAt), "business-shape-current-run");
    business.push({ file, value });
  }
  const find = (label) => {
    const matches = business.filter(({ file, value }) => path.basename(file) === `${value.fixturePrefix}-${label}.json`);
    check(matches.length === 1, `one-business-${label}`); return matches[0].value.data;
  };
  const totals = (version) => [version.total_ht_cents, version.total_tax_cents, version.total_ttc_cents];
  const stable = (rows) => rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !["updated_at", "created_at"].includes(key)))).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const scenario = (label) => generated.scenarios.find((entry) => entry.label === label);
  const inserts = (ledger) => ledger.calls.filter((entry) => entry.action === "insertGeneratedOuvrages");
  const noFinancial = (state, s, name) => {
    same([state.estimate.version.id, state.estimate.version.project_id], [s.versionId, s.projectId], `${name}-version-project`);
    same(totals(state.estimate.version), [0, 0, 0], `${name}-zero-totals`); same(state.estimate.items.map((row) => row.id), [s.sectionId], `${name}-only-original-section`);
    for (const key of ["applications", "snapshots", "assemblies", "libraryComponents"]) same(state.objects[key], [], `${name}-no-${key}`);
  };
  const applied = (state, s, expected, candidates, name) => {
    same(totals(state.estimate.version), expected, `${name}-exact-totals`);
    same(state.estimate.version.id, s.versionId, `${name}-version`);
    same(state.estimate.version.project_id, s.projectId, `${name}-project`);
    same(state.estimate.items.filter((row) => row.item_type === "section").map((row) => row.id), [s.sectionId], `${name}-section`);
    const lines = state.estimate.items.filter((row) => row.item_type === "line"); same(lines.length, candidates.length, `${name}-line-count`);
    for (const key of ["applications", "snapshots", "assemblies", "libraryComponents"]) {
      same(state.objects[key].length, candidates.length, `${name}-${key}-count`);
      same(new Set(state.objects[key].map((row) => row.id)).size, candidates.length, `${name}-${key}-unique`);
    }
    for (const c of candidates) {
      const application = state.objects.applications.find((row) => row.candidate_id === c.candidateId);
      check(application, `${name}-candidate-application`);
      same([application.tenant_id, application.draft_id, application.target_version_id, application.applied_by],
        [generated.owner.tenantId, s.draftId, s.versionId, generated.owner.userId], `${name}-application-scope`);
      const line = lines.find((row) => row.id === application.estimate_item_id), snapshot = state.objects.snapshots.find((row) => row.estimate_item_id === line?.id);
      check(line && snapshot, `${name}-line-snapshot`);
      const quantity = c.lineQuantity ?? 1, cost = c.unitCostHtCents;
      same([line.title, line.description, line.parent_id, line.source_provider], [c.designation, "u", s.sectionId, "generated_ouvrage"], `${name}-line-provenance`);
      same([line.quantity, line.unit_price_ht_cents, line.pu_ht_cents, line.h_mo, line.tax_rate_bp, line.line_total_ht_cents, line.line_tax_cents, line.line_total_ttc_cents],
        [quantity, cost, cost, 0, 2000, quantity * cost, quantity * cost / 5, quantity * cost * 6 / 5], `${name}-line-money`);
      same(snapshot.parent_work_id, c.candidateId, `${name}-snapshot-candidate`);
      same([snapshot.tenant_id, snapshot.project_id, snapshot.target_version_id, snapshot.draft_id, snapshot.applied_by],
        [generated.owner.tenantId, s.projectId, s.versionId, s.draftId, generated.owner.userId], `${name}-snapshot-scope`);
      same([snapshot.summary.componentCount, snapshot.summary.dsCents, snapshot.summary.indicativeTargetPriceCents], [1, cost, cost], `${name}-snapshot-rollup`);
      same(snapshot.components.length, 1, `${name}-snapshot-components`);
      const component = snapshot.components[0];
      same([component.componentId, component.designation, component.unit, component.quantity, component.costType, component.unitCostHtCents, component.lossCoeffBp, component.yieldValue, component.yieldUnit, component.dsCents],
        [c.componentId, c.componentDesignation, "u", 1, "material", cost, 0, null, null, cost], `${name}-snapshot-component`);
      const assembly = state.objects.assemblies.find((row) => row.id === snapshot.assembly_id), library = state.objects.libraryComponents.filter((row) => row.assembly_id === assembly?.id);
      check(assembly, `${name}-assembly-linked`); same(library.length, 1, `${name}-library-linked`);
      same([assembly.source_metadata.kind, assembly.source_metadata.draft_id, assembly.source_metadata.candidate_id, assembly.source_metadata.source_fragment_ids],
        ["generated_ouvrage", s.draftId, c.candidateId, [c.fragmentId]], `${name}-library-provenance`);
      same(application.applied_payload.source_fragment_ids, [c.fragmentId], `${name}-application-source`);
      same([assembly.ds_cents, assembly.indicative_target_price_cents, assembly.avg_time_hours, assembly.unit], [cost, cost, null, "u"], `${name}-assembly-values`);
      same([library[0].title, library[0].unit, library[0].default_quantity, library[0].cost_type, library[0].unit_cost_ht_cents, library[0].k_fo, library[0].k_mo, library[0].h_mo, library[0].labor_role_id, library[0].loss_coeff_bp, library[0].yield_value, library[0].yield_unit],
        [c.componentDesignation, "u", 1, "material", cost, 1, 0, 0, null, 0, null, null], `${name}-library-values`);
      const reviewed = state.objects.components.find((row) => row.id === c.componentId);
      check(reviewed, `${name}-reviewed-component`);
      same([reviewed.subdetail_id, reviewed.parent_work_id, reviewed.quantity, reviewed.unit, reviewed.cost_type, reviewed.unit_cost_ht_cents, reviewed.loss_coeff_bp],
        [c.subdetailId, c.candidateId, 1, "u", "material", cost, 0], `${name}-reviewed-values`);
      same(state.objects.candidates.find((row) => row.id === c.candidateId)?.resolution_status, "inserted", `${name}-candidate-inserted`);
      same(state.objects.subdetails.find((row) => row.id === c.subdetailId)?.status, "applied", `${name}-subdetail-applied`);
    }
  };
  const validIntent = (pending, request, name) => {
    check(pending?.workflow === "generated-ouvrage" && !("draftLockSessionId" in pending.body), `${name}-durable-without-lease`);
    same(pending.body, request, `${name}-exact-pending-body`);
  };
  const positive = (outcome, state, s, request, name) => {
    check(outcome.ok === true && !("outcome" in outcome) && outcome.versionId === s.versionId && outcome.projectId === s.projectId &&
      outcome.insertedCount === request.acceptedCandidates.length && outcome.applications.length === request.acceptedCandidates.length, `${name}-positive-contract`);
    const r = outcome.receipt;
    same([r.operationKey, r.actorId, r.versionId, r.draftId, r.expectedUpdatedAt, r.acceptedCandidates],
      [request.operationKey, generated.owner.userId, s.versionId, s.draftId, request.expectedUpdatedAt, request.acceptedCandidates], `${name}-receipt-body`);
    check(Number.isFinite(Date.parse(r.committedAt)), `${name}-commit-time`);
    same([outcome.totals.totalHtCents, outcome.totals.totalTaxCents, outcome.totals.totalTtcCents], totals(state.estimate.version), `${name}-response-money`);
    same(outcome.draftStatus, state.objects.drafts[0].status, `${name}-response-draft-status`);
    same(new Set(outcome.applications.map((row) => row.candidateId)).size, request.acceptedCandidates.length, `${name}-response-unique-candidates`);
    for (const mapping of outcome.applications) {
      const a = state.objects.applications.find((row) => row.id === mapping.applicationId), snapshot = state.objects.snapshots.find((row) => row.id === mapping.snapshotId);
      check(a && snapshot && state.objects.assemblies.some((row) => row.id === mapping.assemblyId), `${name}-returned-chain-exists`);
      same([a.candidate_id, a.estimate_item_id, snapshot.parent_work_id, snapshot.estimate_item_id, snapshot.assembly_id],
        [mapping.candidateId, mapping.estimateItemId, mapping.candidateId, mapping.estimateItemId, mapping.assemblyId], `${name}-returned-chain-identities`);
      same(state.objects.subdetails.find((row) => row.id === mapping.subdetailId)?.parent_work_id, mapping.candidateId, `${name}-returned-review-identity`);
    }
  };
  for (const label of ["lost", "malformed", "stale", "partial", "abandon"]) {
    const initial = find(`${label}-initial`), s = scenario(label);
    same(initial.fixtureSha256, profile.generatedFixtureSha256, `${label}-fixture-sha`); same(initial.scenario, s, `${label}-fixture-scenario`);
    same(initial.initial.items.map((row) => row.id), [s.sectionId], `${label}-empty-start`);
    same([initial.initial.version.calc_engine_version, initial.initial.version.discount_bp, ...totals(initial.initial.version)], [2, 0, 0, 0, 0], `${label}-canonical-empty-version`);
    const ledger = find(`${label}-request-ledger`); same(ledger.bulk, [], `${label}-no-bulk`);
    check(ledger.calls.every((call) => !("draftLockSessionId" in call.request)), `${label}-lease-not-archived`);
    for (const call of inserts(ledger)) {
      const request = call.request;
      check(call.sessionPresent === true && request.versionId === s.versionId && request.draftId === s.draftId &&
        typeof request.operationKey === "string" && request.operationKey.length > 0 && Number.isFinite(Date.parse(request.expectedUpdatedAt)) &&
        request.acceptedCandidates?.length === 1, `${label}-apply-request-scope`);
      const accepted = request.acceptedCandidates[0], candidate = s.candidates.find((row) => row.candidateId === accepted.candidateId);
      check(candidate && digest.test(accepted.reviewToken), `${label}-exact-reviewed-candidate`);
      same([accepted.designation, accepted.unit, accepted.quantity, accepted.lotId], [candidate.designation, "u", 1, s.sectionId], `${label}-exact-human-placement`);
    }
  }
  for (const [code, label] of [["GO01", "lost"], ["GO02", "malformed"]]) {
    const s = scenario(label), c = s.candidates[0], first = find(`${code}-actual-completed-response`), initial = find(`${code}-first-get-after-server-response`);
    check(first.action === "insertGeneratedOuvrages" && first.status === 200 && first.records.length === 1 && first.records[0].ok === true &&
      first.discarded === (label === "lost") && first.changedRecords === (label === "malformed" ? 1 : 0), `${code}-real-committed-fault`);
    applied(initial, s, [1000, 200, 1200], [c], `${code}-immediate`); same(initial.objects.drafts[0].status, "applied", `${code}-draft-applied`);
    positive(first.records[0], initial, s, first.request, `${code}-initial-response`);
    const reload = find(`${code}-reload-no-application`); check(reload.beforeReloadPosts === 1 && reload.afterReloadPosts === 1 && reload.windowMs >= 3000, `${code}-no-auto-application`);
    validIntent(reload.pendingBefore, first.request, code); same(reload.pendingAfter, reload.pendingBefore, `${code}-pending-survives-reload`);
    const replay = find(`${code}-replay-result`), resumed = find(`${code}-first-get-after-replay`);
    check(replay.status === 200 && replay.wireResult.length === 1 && replay.wireResult[0].ok === true && replay.result.length === 1 && replay.result[0].replayed === true, `${code}-explicit-positive-replay`);
    same(replay.applicationCalls.length, code === "GO01" ? 2 : 1, `${code}-explicit-application-count`);
    check(replay.applicationCalls.every((call) => call.sessionPresent === true), `${code}-current-lease`);
    applied(resumed, s, [1000, 200, 1200], [c], `${code}-resumed`);
    positive(replay.result[0], resumed, s, first.request, `${code}-replay-response`);
    for (const table of ["applications", "snapshots", "assemblies", "libraryComponents"]) same(stable(resumed.objects[table]), stable(initial.objects[table]), `${code}-stable-${table}`);
    if (code === "GO01") {
      same(replay.applicationCalls[1].request, first.request, "GO01-same-replay-intention");
      const calls = inserts(find("lost-request-ledger")); same(calls.length, 3, "GO01-three-explicit-apply-actions");
      same(calls[2].request, first.request, "GO01-historical-apply-same-intention");
      const old = find("GO01-historical-receipt"); check(old.old.records.length === 1 && old.old.records[0].replayed === true && old.receipt.records.length === 1 && old.receipt.records[0].ok === true, "GO01-old-receipt-replay");
      same(old.old.records[0].totals, { totalHtCents: 1000, totalTaxCents: 200, totalTtcCents: 1200 }, "GO01-historical-totals");
      same(old.final.estimate.items, old.newer.estimate.items, "GO01-newer-items-preserved"); same(totals(old.final.estimate.version), [2000, 400, 2400], "GO01-newer-footer-preserved");
      same(old.old.records[0].currentVersion.updatedAt, old.final.estimate.version.updated_at, "GO01-current-revision-returned");
    } else {
      const malformed = find("GO02-malformed-receipt-retained"), closures = find(`${label}-request-ledger`).calls.filter((call) => call.action === "abandonGeneratedOuvrageApplication");
      check(malformed.observed.status === 200 && malformed.observed.changedRecords === 1 && malformed.applicationPosts === 1, "GO02-malformed-receipt-not-absence");
      same(malformed.pending, reload.pendingBefore, "GO02-malformed-read-retains-intention"); same(closures.length, 1, "GO02-one-explicit-abandon");
      same(closures[0].request, first.request, "GO02-abandon-original-intention"); check(replay.result[0].ok === true && !("outcome" in replay.result[0]), "GO02-abandon-keeps-positive-result");
    }
    applied(find(`${code}-final-reload`), s, code === "GO01" ? [2000, 400, 2400] : [1000, 200, 1200], [{ ...c, lineQuantity: code === "GO01" ? 2 : 1 }], `${code}-final-reload`);
  }
  const stale = scenario("stale"), second = find("GO03-second-authorized-review"), changed = find("GO03-concurrent-review-before-apply"), refused = find("stale-application-response-1"), after = find("GO03-first-get-after-stale-apply"), save = find("GO03-stale-save-preserves-current-review");
  check(second.sameBrowserSession === true && second.independentSessionClaim === false && second.concurrent.status === 200 && second.concurrent.records.length === 1 && second.concurrent.records[0].status === "reviewed" &&
    digest.test(second.original.records[0].reviewToken) && second.concurrent.records[0].reviewToken !== second.original.records[0].reviewToken, "GO03-real-current-review");
  check(refused.status === 200 && refused.records.length === 1 && refused.records[0].ok === false && refused.records[0].error.code === "GENERATED_OUVRAGE_REVIEW_CHANGED", "GO03-stale-apply-refused");
  noFinancial(after, stale, "GO03-refused"); same(after.estimate.items, changed.estimate.items, "GO03-no-item-write"); same(after.objects.components[0].unit_cost_ht_cents, 1200, "GO03-current-cost-preserved");
  same(stable(save.objects.components), stable(changed.objects.components), "GO03-stale-save-preserves-components"); same(save.objects.components[0].unit_cost_ht_cents, 1200, "GO03-stale-save-preserves-cost");
  const staleSaveResponse = find("GO03-stale-save-response");
  check(staleSaveResponse.status === 200 && staleSaveResponse.records.length === 1 && staleSaveResponse.records[0].ok === false &&
    staleSaveResponse.records[0].error.status === 409 && staleSaveResponse.records[0].error.code === "GENERATED_OUVRAGE_REVIEW_CHANGED", "GO03-stale-save-real-review-refusal");
  const staleFinal = find("GO03-current-review-applied");
  applied(staleFinal, stale, [1200, 240, 1440], [{ ...stale.candidates[0], unitCostHtCents: 1200 }], "GO03-current-apply");
  const staleCalls = inserts(find("stale-request-ledger")); check(staleCalls.length === 2 && staleCalls[0].request.operationKey !== staleCalls[1].request.operationKey, "GO03-fresh-application-key");
  positive(find("stale-application-response-2").records[0], staleFinal, stale, staleCalls[1].request, "GO03-current-response");
  const partialScenario = scenario("partial"), [a, b] = partialScenario.candidates, dirty = find("GO04-dirty-local-review-not-applied"), partial = find("GO04-first-partial-commit"), partialReload = find("GO04-partial-reloaded"), completed = find("GO04-second-commit");
  check(dirty.objects.components.find((row) => row.id === a.componentId)?.unit_cost_ht_cents === 1000 && dirty.objects.applications.length === 0 && inserts(dirty).length === 0, "GO04-local-edit-not-silently-applied");
  applied(partial, partialScenario, [1500, 300, 1800], [{ ...a, unitCostHtCents: 1500 }], "GO04-partial"); same(partial.objects.drafts[0].status, "partially_applied", "GO04-partial-draft");
  same(partial.objects.candidates.find((row) => row.id === b.candidateId)?.resolution_status, "pending", "GO04-second-pending");
  same(partialReload.estimate.items, partial.estimate.items, "GO04-reload-items");
  for (const table of ["applications", "snapshots", "assemblies", "libraryComponents"]) same(stable(partialReload.objects[table]), stable(partial.objects[table]), `GO04-reload-${table}`);
  applied(completed, partialScenario, [3500, 700, 4200], [{ ...a, unitCostHtCents: 1500 }, b], "GO04-complete"); same(completed.objects.drafts[0].status, "applied", "GO04-complete-draft");
  const firstLine = partial.objects.applications[0].estimate_item_id;
  const originalLine = partial.estimate.items.find((row) => row.id === firstLine), currentLine = completed.estimate.items.find((row) => row.id === firstLine);
  check(Date.parse(currentLine.updated_at) >= Date.parse(originalLine.updated_at), "GO04-first-line-technical-date");
  same({ ...currentLine, updated_at: originalLine.updated_at }, originalLine, "GO04-first-line-preserved");
  for (const table of ["applications", "snapshots", "assemblies", "libraryComponents"]) for (const original of partial.objects[table]) same(completed.objects[table].find((row) => row.id === original.id), original, `GO04-first-${table}-preserved`);
  same(inserts(find("partial-request-ledger")).length, 2, "GO04-two-explicit-applications");
  const partialCalls = inserts(find("partial-request-ledger"));
  positive(find("partial-application-response-1").records[0], partial, partialScenario, partialCalls[0].request, "GO04-partial-response");
  positive(find("partial-application-response-2").records[0], completed, partialScenario, partialCalls[1].request, "GO04-completed-response");
  applied(find("GO04-final-reload"), partialScenario, [3500, 700, 4200], [{ ...a, unitCostHtCents: 1500 }, b], "GO04-final-reload");
  const abandonedScenario = scenario("abandon"), lost = find("GO05-refusal-response-lost"), noAuto = find("GO05-no-auto-application"), refusal = find("GO05-refused-replay-retains-intention"), closure = find("GO05-durable-abandonment"), tombstoneReplay = find("GO05-tombstone-replay");
  check(lost.lost.discarded === true && lost.lost.records.length === 1 && lost.lost.records[0].ok === false && lost.lost.records[0].error.code === "GENERATED_OUVRAGE_REVIEW_CHANGED", "GO05-lost-real-refusal");
  noFinancial(lost.empty, abandonedScenario, "GO05-first-refusal"); check(noAuto.windowMs >= 3000 && noAuto.posts === 1, "GO05-no-automatic-application"); validIntent(noAuto.pending, lost.lost.request, "GO05");
  check(refusal.refused.length === 1 && refusal.refused[0].ok === false && refusal.refused[0].error.code === "GENERATED_OUVRAGE_REVIEW_CHANGED", "GO05-exact-retry-refused");
  same(refusal.pending, noAuto.pending, "GO05-retry-retains-intention"); noFinancial(find("GO05-first-get-after-refused-replay"), abandonedScenario, "GO05-refused-replay");
  check(closure.status === 200 && closure.closed.length === 1 && closure.closed[0].ok === true && closure.closed[0].data.ok === true && closure.closed[0].data.outcome === "abandoned", "GO05-durable-tombstone");
  const tombstone = closure.closed[0].data.receipt;
  same(Object.fromEntries(Object.keys(lost.lost.request).map((key) => [key, tombstone[key]])), lost.lost.request, "GO05-tombstone-original-body");
  check(tombstone.actorId === generated.owner.userId && Number.isFinite(Date.parse(tombstone.abandonedAt)), "GO05-tombstone-actor-time"); noFinancial(closure.abandoned, abandonedScenario, "GO05-abandoned");
  check(tombstoneReplay.read.records.length === 1 && tombstoneReplay.read.records[0].ok === true && tombstoneReplay.oldApply.records.length === 1 && tombstoneReplay.oldApply.records[0].outcome === "abandoned", "GO05-old-intent-cannot-return-positive");
  same(tombstoneReplay.read.records[0].data.receipt, tombstone, "GO05-read-tombstone"); same(tombstoneReplay.oldApply.records[0].receipt, tombstone, "GO05-old-apply-tombstone");
  noFinancial(tombstoneReplay.beforeNew, abandonedScenario, "GO05-old-replay");
  const abandonCalls = inserts(find("abandon-request-ledger")); same(abandonCalls.length, 4, "GO05-four-explicit-application-actions");
  same(abandonCalls[1].request, lost.lost.request, "GO05-retry-same-body"); same(abandonCalls[2].request, lost.lost.request, "GO05-post-closure-same-body");
  check(abandonCalls[3].request.operationKey !== lost.lost.request.operationKey, "GO05-new-key-after-closure");
  const abandonFinal = find("GO05-new-intention-after-closure");
  applied(abandonFinal, abandonedScenario, [1400, 280, 1680], [{ ...abandonedScenario.candidates[0], unitCostHtCents: 1400 }], "GO05-new-apply");
  positive(find("abandon-application-response-4").records[0], abandonFinal, abandonedScenario, abandonCalls[3].request, "GO05-new-response");

  const generation = generated.generation, catalogue = find("GO06-library-context-before-generation").catalogue;
  const generationState = (label) => {
    const value = find(label); same(totals(value.estimate.version), [0, 0, 0], `${label}-zero-footer`);
    same([value.estimate.version.id, value.estimate.version.project_id], [generation.versionId, generation.projectId], `${label}-generation-identity`);
    same(value.estimate.items.map((row) => row.id).sort(), [generation.sectionA, generation.sectionB].sort(), `${label}-only-two-sections`);
    for (const key of ["subdetails", "applications", "snapshots", "assemblies"]) same(value.rows[key], [], `${label}-no-${key}`);
    return value;
  };
  const emptyGeneration = generationState("GO06-empty-before-generation");
  for (const key of ["drafts", "candidates", "fragments", "candidateSources"]) same(emptyGeneration.rows[key], [], `GO06-start-no-${key}`);
  const generationResults = [], generationStates = [];
  for (const [index, sourceText] of ["Fourniture tube cuivre 10 m", "Fourniture isolant thermique 6 m"].entries()) {
    const response = find(`GO06-real-generation-response-${index + 1}`), state = generationState(`GO06-first-get-after-generation-${index + 1}`);
    check(response.status === 200 && response.results.length === 1 && response.results[0].candidates.length === 1, `GO06-real-response-${index + 1}`);
    const result = response.results[0], candidate = result.candidates[0], current = state.rows.drafts.find((row) => row.id === result.draftId);
    generationResults.push(result); generationStates.push(state);
    same([candidate.designation, candidate.unit, candidate.quantity], index === 0 ? ["Fourniture tube cuivre", "m", 10] : ["Fourniture isolant thermique", "m", 6], `GO06-fallback-values-${index + 1}`);
    same(state.rows.drafts.length, index + 1, `GO06-draft-count-${index + 1}`); check(current?.status === "pending", `GO06-current-pending-${index + 1}`);
    same([current.generation_metadata.used_fallback, current.generation_metadata.model, current.generation_metadata.token_count, current.generation_metadata.cost_cents], [true, null, null, null], `GO06-fallback-metadata-${index + 1}`);
    const fragments = state.rows.fragments.filter((row) => row.draft_id === result.draftId), primary = fragments.filter((row) => row.metadata?.origin === "input");
    check(primary.length === 1 && primary[0].excerpt === sourceText && primary[0].status === "active", `GO06-primary-source-${index + 1}`);
    const links = state.rows.candidateSources.filter((row) => row.draft_id === result.draftId); same(links.length, 1, `GO06-source-link-count-${index + 1}`);
    same([links[0].tenant_id, links[0].draft_id, links[0].candidate_id, links[0].source_fragment_id, links[0].source_rank], [generated.owner.tenantId, result.draftId, candidate.candidateId, primary[0].id, 0], `GO06-real-primary-link-${index + 1}`);
    same(candidate.sources, [{ sourceFragmentId: primary[0].id, sourceDocumentId: primary[0].source_document_id, type: "text", label: primary[0].label, excerpt: sourceText,
      sourceFileName: primary[0].source_file_name, sourcePageFrom: primary[0].source_page_from, sourcePageTo: primary[0].source_page_to, selectionLabel: primary[0].selection_label }], `GO06-candidate-source-${index + 1}`);
    const context = fragments.filter((row) => row.id !== primary[0].id);
    check(context.length <= 6 && (!catalogue.length || context.length > 0), `GO06-context-count-${index + 1}`);
    for (const fragment of context) check(fragment.source_kind === "library" && fragment.status === "active" &&
      catalogue.filter((entry) => fragment.metadata?.[entry.kind] === entry.id && fragment.label === entry.label && fragment.excerpt === entry.excerpt).length === 1, `GO06-context-owned-${index + 1}`);
    same(current.generation_metadata.source_fragment_count, fragments.length, `GO06-source-fragment-count-${index + 1}`);
    same(new Set(fragments.map((row) => row.id)).size, fragments.length, `GO06-unique-fragments-${index + 1}`);
  }
  const beforeSecond = generationState("GO06-before-second-submit"); same(beforeSecond.rows.drafts[0].status, "pending", "GO06-first-pending-before-second");
  check(beforeSecond.rows.fragments.every((row) => row.status === "active"), "GO06-first-sources-active-before-second");
  check(generationResults[0].draftId !== generationResults[1].draftId, "GO06-distinct-drafts");
  same(generationStates[1].rows.drafts.find((row) => row.id === generationResults[0].draftId)?.status, "discarded", "GO06-first-discarded-after-completion");
  const exactFragments = (rows) => rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "updated_at"))).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  same(exactFragments(generationStates[1].rows.fragments.filter((row) => row.draft_id === generationResults[0].draftId)),
    exactFragments(generationStates[0].rows.fragments.map((row) => ({ ...row, status: "discarded" }))), "GO06-first-fragments-retained-discarded");
  const finalGeneration = generationState("GO06-replacement-reloaded-and-resumed"), resumedGeneration = find("GO06-real-resume-provenance");
  check(resumedGeneration.status === 200 && resumedGeneration.records.length === 1 && resumedGeneration.records[0].ok === true, "GO06-real-resume");
  const resumedDraft = resumedGeneration.records[0].data; same(resumedDraft.draftId, generationResults[1].draftId, "GO06-resumed-current-draft");
  same(resumedDraft.candidates.length, 1, "GO06-resumed-one-candidate");
  same(resumedDraft.candidates[0].candidateId, generationResults[1].candidates[0].candidateId, "GO06-resumed-current-candidate");
  same(resumedDraft.candidates[0].sources, generationResults[1].candidates[0].sources, "GO06-resumed-exact-sources");
  const currentCandidate = finalGeneration.rows.candidates.find((row) => row.id === generationResults[1].candidates[0].candidateId);
  check(currentCandidate, "GO06-current-candidate-retained"); same([currentCandidate.designation, currentCandidate.unit, currentCandidate.quantity, currentCandidate.resolution_status, currentCandidate.suggested_lot_id], ["Fourniture isolant thermique", "m", 6, "pending", generation.sectionB], "GO06-current-values-after-resume");
  for (const [index, result] of generationResults.entries()) same(finalGeneration.rows.candidateSources.filter((row) => row.draft_id === result.draftId), generationStates[index].rows.candidateSources.filter((row) => row.draft_id === result.draftId), `GO06-links-persist-${index + 1}`);
  const modelProof = find("GO06-no-model-proof"), generationLedger = find("GO06-request-ledger");
  same(modelProof.calls, generationLedger.calls, "GO06-ledger-consistent"); same(modelProof.bulk, [], "GO06-no-bulk"); same(generationLedger.bulk, [], "GO06-ledger-no-bulk");
  check(generationLedger.calls.length === 2 && generationLedger.calls.every((call) => call.action === "generateOuvragesFromText" && call.sessionPresent === true && !("draftLockSessionId" in call.request)), "GO06-two-real-generation-actions");
  const network = (await readFile(path.join(run, "server-network.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  check(network.length > 0 && network.some((entry) => entry.kind === "guard-installed") && network.every((entry) => entry.kind === "guard-installed" ||
    (entry.allowed === true && [profile.backendOrigin, profile.appOrigin].includes(entry.origin))), "GO06-real-network-guard-no-external-attempt");
  check(network.filter((entry) => entry.kind === "guard-installed").every((entry) => isDeepStrictEqual(entry.allowedOrigins, [profile.backendOrigin, profile.appOrigin])) && modelProof.guardInstalled === true && modelProof.denied.length === 0 && modelProof.modelCounterAloneIsInsufficient === true, "GO06-no-model-evidence");
  same(modelProof.generationMetadata, finalGeneration.rows.drafts.map((row) => ({ id: row.id, metadata: row.generation_metadata })), "GO06-model-metadata-original");

  const secretValues = [...new Set(Object.entries(process.env).filter(([key, value]) => value &&
    (/PASSWORD|SECRET|TOKEN|(?:^|_)KEY(?:_|$)|APIKEY|CREDENTIAL|AUTHORIZATION/i.test(key) || /^E2E_.*EMAIL$/i.test(key)))
    .flatMap(([, value]) => [value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)]))];
  check(["NEXT_PUBLIC_SUPABASE_ANON_KEY", "E2E_LOGIN_PASSWORD", "E2E_LOGIN_EMAIL"].every((key) => process.env[key]), "configured-privacy-values-available");
  let scanned = 0;
  for (const file of files) {
    const bytes = await readFile(file), text = bytes.toString("utf8"); scanned++;
    check(!secretValues.some((secret) => bytes.includes(Buffer.from(secret))) && !/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text) &&
      !/(?:draftLockSessionId|session_id|sessionId)(?:\\*["'])?\s*:\s*(?:\\*["'])?[0-9a-f]{8}-[0-9a-f-]{27}/i.test(text), "privacy-no-credentials-jwt-lease");
  }
  Object.assign(receipt, { status: "qualified-local-selected-generated-recovery", run: relative(run), manifestSha256: await sha(path.join(run, "manifest.json")),
    reportSha256: await sha(path.join(run, "report.json")), sourceRevision: manifest.source.revision, buildId: build.buildId, profileSha256: evidenceEntry("profile.json").sha256,
    fixtureSha256: profile.generatedFixtureSha256, backendOrigin: profile.backendOrigin, nativeChain: profile.nativeRecipePath ? "native-recipe" : "historical-generated-installation",
    executionPlatform: manifest.runtime.platform, buildOriginPlatform: profile.buildOriginPlatform, privacyFilesScanned: scanned,
    privacyScope: "All archived bytes checked for configured secret values and their URI/JSON encodings; decoded text also checked for JWTs and raw lease UUID fields. This cannot detect an unknown secret or pixel-only disclosure." });
} catch (error) {
  receipt.status = "failed";
  // Never echo parsed values, environment, source content or a raw path error.
  receipt.error = checks.at(-1)?.passed === false ? checks.at(-1).name : "Required evidence could not be read or verified.";
  if (error?.code === "ENOENT") receipt.error = "Required evidence is missing.";
}
receipt.finishedAt = new Date().toISOString();
const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
await writeFile(path.join(output, "qualification.json"), bytes, { flag: "wx" });
await writeFile(path.join(output, "qualification.sha256"), `${hash(bytes)}  qualification.json\n`, { flag: "wx" });
console.log(JSON.stringify({ status: receipt.status, path: relative(output), sha256: hash(bytes), failedChecks: checks.filter((entry) => !entry.passed).map((entry) => entry.name) }));
if (receipt.status === "failed") process.exitCode = 1;
