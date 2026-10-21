// Offline numeric archive reader; failure modes precede implementation.
import { randomUUID } from "node:crypto";
import { readFile, readdir, lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { loadCoverageProfile } from "./coverage-profile.mjs";
import { repositoryRoot as root, requireValue, sha256, ignoredFile, buildSourceEvidence, relativePath, newEvidenceDirectory } from "./local-recipe-common.mjs";
import { isNumericSelection, numericCases, numericContracts } from "./generated-numeric-plan.mjs";
import { validateNumericResults, validateNumericWitness, validateNumericTyping, validateNumericRed, validateNumericInitial, validateNumericInvalid, validateNumericInvalidDecision,
  validateNumericReviewed, validateNumericApplied, validateNumericReuse, validateNumericExportCells } from "./generated-numeric-reader-support.mjs";
import { assertCctpPrivateBytes, inspectCctpWorkbook, redactCctpMetadata } from "./cctp-reader-support.mjs";
const usage = "node scripts/tester-army/qualify-generated-numeric.mjs <exact .e2e/army/coverage/runs/run-directory>";
if (process.argv.length === 3 && process.argv[2] === "--help") { console.log(usage); process.exit(0); }
requireValue(["24", "26"].includes(process.versions.node.split(".")[0]) && process.argv.length === 3, usage);
const runBase = path.join(root, ".e2e/army/coverage/runs"), requested = path.resolve(root, process.argv[2]);
requireValue(path.dirname(requested) === runBase, "Exact direct numeric run required; no latest selection.");
const output = await newEvidenceDirectory("generated-numeric/qualifications", randomUUID());
const checks = [], check = (condition, name) => { checks.push({ name, passed: Boolean(condition) }); requireValue(condition, name); };
const same = (a, b, name) => check(isDeepStrictEqual(a, b), name);
const receipt = { schemaVersion: "army-generated-numeric-qualification-1", status: "checking", startedAt: new Date().toISOString(),
  command: { executable: process.execPath, args: process.argv.slice(1) }, readerSha256: sha256(await readFile(new URL(import.meta.url))),
  databaseAccess: false, httpAccess: false, browserAccess: false, checks, reached: [],
  limits: ["Selected local numeric journeys only; no complete application, CORE06 transport/race, native concurrency, PDF, production or deployment qualification.",
    "Early observed RED qualifies only its reached keyboard/unit phase, never later persistence/application/reuse."] };
async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    check(!entry.isSymbolicLink(), "no-archive-link"); const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(file)); else { check(entry.isFile(), "regular-archive-file"); files.push(file); }
  }
  return files;
}
try {
  const run = path.dirname(await ignoredFile(relativePath(path.join(requested, "manifest.json")))), files = await walk(run);
  const manifest = JSON.parse(await readFile(path.join(run, "manifest.json"))), report = JSON.parse(await readFile(path.join(run, "report.json")));
  check(manifest.schemaVersion === "miaouffrage-tester-army-1" && manifest.mode === "coverage" && manifest.coverage.scenarioSet === "generated-components", "exact-numeric-manifest");
  const profile = await loadCoverageProfile(root, { configuredPath: manifest.coverage.profile });
  const config = JSON.parse(await readFile(profile.evidence.find((e) => e.name === "profile.json").file));
  check(isNumericSelection(config.componentSelection), "exact-numeric-selection"); const result = validateNumericResults(report, config.componentSelection); check(true, "exact-numeric-results");
  same(manifest.result.summary, report.run.summary, "manifest-report-summary"); same(manifest.result.usage, report.run.usage, "manifest-report-usage");
  check(manifest.result.exitCode === report.run.exitCode && manifest.result.runnerExitCode === report.run.exitCode && manifest.result.status === (result.red ? "failed" : "passed"), "terminal-result");
  check(manifest.source.changedDuringRun === false && manifest.productionBuild.changedDuringRun === false && manifest.tracePaths.length === 0 && manifest.fixtures.authentication.result === "passed", "stable-build-auth-no-traces");
  const optional = new Set(["--headed", "--no-cache", "--debug"]);
  same(manifest.command.args.slice(1).filter((a) => !optional.has(a)), ["run", "--config", "e2e.config.ts", "--tag", "source-coverage", "--exclude-tag", "agent", "--target", "chromium-desktop", "--max-failures", "1"], "unfiltered-numeric-command");
  same(manifest.source.pilotInputsAfter, manifest.source.pilotInputs, "pilot-inputs-stable"); same(manifest.source.untrackedRuntimeInputsAfter, manifest.source.untrackedRuntimeInputs, "runtime-inputs-stable");
  same(manifest.source.workingDiffAfterSha256, manifest.source.workingDiffSha256, "diff-stable");
  const source = await buildSourceEvidence(); same(manifest.source.revision, source.revision, "current-source-revision"); same(manifest.source.workingDiffSha256, source.diffSha256, "current-working-diff");
  for (const list of [manifest.source.pilotInputs, manifest.source.untrackedRuntimeInputs, manifest.productionBuild.inputs]) {
    check(Array.isArray(list) && new Set(list.map((e) => e.path)).size === list.length, "unique-source-inputs");
    for (const input of list) {
      check(typeof input.path === "string" && !path.isAbsolute(input.path) && !input.path.replaceAll("\\", "/").split("/").includes(".."), "owned-source-path");
      check(sha256(await readFile(path.join(root, input.path))) === input.sha256, "current-input-hash");
    }
  }
  for (const name of ["e2e/army/local/generated-ouvrage-numeric-entry.e2e.ts", "e2e/army/local/numeric-entry-support.ts", "scripts/tester-army/generated-numeric-plan.mjs", "scripts/tester-army/generated-numeric-reader-support.mjs", "scripts/tester-army/qualify-generated-numeric.mjs"]) {
    check(manifest.source.pilotInputs.some((e) => e.path === name), "numeric-source-fingerprinted");
  }
  const known = new Set([path.join(run, "manifest.json")]), inside = (file) => file.startsWith(run + path.sep);
  for (const entry of [...manifest.artifacts, ...manifest.coverage.retainedEvidence, manifest.report, ...(manifest.appLog ? [manifest.appLog] : [])]) {
    const file = await ignoredFile(entry.path); check(inside(file) && !known.has(file) && !(await lstat(file)).isSymbolicLink(), "unique-confined-artifact"); known.add(file);
    check(sha256(await readFile(file)) === entry.sha256, "archived-artifact-hash");
  }
  check(files.every((f) => known.has(f)) && known.size === files.length, "complete-run-inventory");
  for (const entry of profile.evidence) check(manifest.coverage.retainedEvidence.some((e) => e.sha256 === entry.sha256), "profile-seed-build-native-chain-retained");
  const witnesses = [];
  for (const file of files) {
    const bytes = await readFile(file); assertCctpPrivateBytes(bytes); check(true, "archive-private-bytes");
    if (file.endsWith(".json")) { const data = JSON.parse(bytes); if (data.schemaVersion === "miaouffrage-army-business-1" && data.data?.schemaVersion === "army-numeric-entry-witness-1") witnesses.push(data.data); }
  }
  const fixture = profile.metadata.generatedFixture, cases = numericCases(config.componentSelection), scenario = (id) => {
    const found = fixture.scenarios.filter((s) => s.label === numericContracts[id].fixtureLabel); check(found.length === 1, "exact-numeric-fixture"); return found[0];
  };
  for (const w of witnesses) { check(cases.includes(w.caseId), "selected-witness-only"); validateNumericWitness(w, scenario(w.caseId)); receipt.reached.push({ caseId: w.caseId, phase: w.phase }); }
  const find = (id, phase) => { const found = witnesses.filter((w) => w.caseId === id && w.phase === phase); check(found.length === 1, `exact-${id}-${phase}`); return found[0]; };
  if (result.red) {
    const failed = report.run.results[1], candidates = witnesses.filter((w) => /^typed-(price|quantity-comma|quantity-point|zero-price|yield|loss)-(prefix|completed)$/.test(w.phase));
    let observed = null;
    for (const w of candidates) { try { observed = validateNumericRed(w, failed, scenario(w.caseId)); } catch { /* Only a concrete matching contradiction is accepted. */ } }
    check(observed !== null, "observed-numeric-business-red"); validateNumericInitial(find(observed.caseId, "baseline").actual.state, scenario(observed.caseId)); check(true, "fresh-before-observed-red");
    receipt.observed = observed; receipt.status = "verified-local-observed-numeric-input-failure";
  } else {
    const typingPhases = { NI01: ["typed-price-prefix", "typed-price-completed", "typed-price-corrected-prefix", "typed-price-corrected-completed"],
      NI02: ["typed-quantity-comma-prefix", "typed-quantity-comma-completed", "typed-quantity-point-prefix", "typed-quantity-point-completed", "typed-zero-price-completed", "typed-yield-prefix", "typed-yield-completed"],
      "NI03-A": ["typed-loss-completed"], "NI03-B": ["typed-loss-prefix", "typed-loss-completed"] };
    const exported = new Set();
    for (const id of cases) {
      const s = scenario(id), c = numericContracts[id]; validateNumericInitial(find(id, "baseline").actual.state, s); check(true, "fresh-numeric-baseline");
      for (const phase of typingPhases[id]) { validateNumericTyping(find(id, phase), s); check(true, "exact-real-keyboard-intermediate"); }
      if (id === "NI01") { validateNumericInvalid(find(id, "invalid-before"), find(id, "invalid-after"), s); check(true, "invalid-input-blocks-without-write");
        for (const [index, submitted] of ["12EUR50", "12€50", "12.50.00,10"].entries()) {
          const malformed = find(id, "malformed-price-" + index).actual;
          check(malformed.method === "fill" && malformed.submitted === submitted && malformed.input === submitted &&
            malformed.ariaInvalid === true && malformed.linkedErrorText?.trim() && malformed.saveEnabled === false && malformed.insertEnabled === false &&
            /DS\s*12[,.]50/.test(malformed.sectionText), "malformed-euro-text-remains-visible-and-blocked");
          same(malformed.state, find(id, "invalid-before").actual.state, "malformed-euro-keeps-server-state-and-ledger");
          same(malformed.counts, find(id, "invalid-before").actual.counts, "malformed-euro-submits-no-write");
        }
        validateNumericInvalidDecision(["invalid-exclude-before", "invalid-excluded", "invalid-restored"].map((phase) => find(id, phase)), find(id, "invalid-after"), s); check(true, "invalid-garbage-human-exclude-restore-without-write");
        const paste = find(id, "price-paste-blur").actual;
        check(paste.method === "fill" && paste.submitted === "12.50" && Number(String(paste.input).replace(",", ".")) === 12.5 && paste.label.includes("€") && /DS\s*12[,.]50/.test(paste.sectionText), "supplementary-paste-euro-value-and-ds"); }
      for (const phase of ["reviewed", "reloaded"]) { validateNumericReviewed(find(id, phase).actual.state, s, c); check(true, "canonical-ordinary-review-persistence"); }
      const parent = find(id, "reloaded-parent").actual;
      check(parent.text?.includes(`Quantité : ${c.parentQuantity}`) && parent.reviewedCandidate?.quantity === c.parentQuantity,
        "numeric-reloaded-parent-preserves-human-reviewed-quantity");
      const primary = find(id, "applied-reload").actual.state;
      for (const phase of ["applied", "applied-reload"]) { validateNumericApplied(find(id, phase).actual.state, s, c, fixture.owner); check(true, "numeric-application-canonical-persistence"); }
      const preview = find(id, "reuse-preview").actual, library = primary.objects.assemblies[0];
      check(preview.assemblyId === library.id && preview.libraryName === library.name && preview.snapshotAssemblyId === primary.objects.snapshots[0].assembly_id &&
        preview.expectedCta === `Ajouter « ${library.name} »` && preview.actualCta?.trim().startsWith(preview.expectedCta), "numeric-own-selected-library-preview");
      for (const phase of ["reuse", "reuse-reload"]) { validateNumericReuse(find(id, phase).actual, c, primary); check(true, "numeric-own-library-api-rls-reuse"); }
      const reuse = find(id, "reuse").actual; check(reuse.status === 200 && reuse.reply?.ok === true && reuse.assemblyId === library.id, "numeric-real-reuse-response");
      const ready = find(id, "reuse-ready").actual;
      check(ready.versionId === reuse.versionId && /^(À jour|Sauvegardé)$/.test(ready.statusText), "numeric-reuse-is-visibly-synchronized-before-reload");
      same(ready.estimate, reuse.state.estimate, "numeric-reuse-needs-no-extra-save-before-reload");
      const reuseStages = ["reuse", "reuse-ready", "reuse-reload"].map((phase) => find(id, phase));
      check(reuseStages.every((w, index) => Number.isSafeInteger(w.observedSequence) && Number.isFinite(Date.parse(w.observedAt)) &&
        (index === 0 || (w.observedSequence > reuseStages[index - 1].observedSequence && Date.parse(w.observedAt) >= Date.parse(reuseStages[index - 1].observedAt)))),
      "numeric-reuse-ready-observed-after-insertion-before-reload");
      const provenance = find(id, "reuse-provenance-ui").actual;
      check(provenance.before?.version?.id === find(id, "reuse-reload").actual.state.estimate.version.id && Array.isArray(provenance.ordinaryBefore) && provenance.observations?.length === c.components.length,
        "actual-numeric-provenance-ui-observations");
      same(provenance.before, provenance.after, "numeric-provenance-ui-api-readonly"); same(provenance.ordinaryBefore, provenance.ordinaryAfter, "numeric-provenance-ui-rls-readonly");
      for (const target of ["primary", "reuse"]) for (const mode of ["standard", "dpgf"]) {
        const w = find(id, `exports-${target}-${mode}`), data = w.actual, api = target === "primary" ? primary.estimate : find(id, "reuse-reload").actual.state.estimate;
        same(w.expected.totals, c.totals, "export-fixed-oracle-totals"); same(w.expected.retainedIndices, c.retainedIndices, "export-fixed-selection");
        const artifacts = manifest.artifacts.filter((e) => e.sha256 === data.sha256); check(artifacts.length === 1 && !exported.has(artifacts[0].path), "distinct-real-xlsx-artifact"); exported.add(artifacts[0].path);
        const bytes = await readFile(await ignoredFile(artifacts[0].path)); await inspectCctpWorkbook(bytes, data.sheets, s.components.filter((_, index) => !c.retainedIndices.includes(index)).map((x) => x.designation));
        validateNumericExportCells(data, api, c.totals); check(true, "real-xlsx-own-api-canonical-cells");
      }
    }
    check(exported.size === profile.metadata.numericDownloads, "all-selected-real-exports");
    receipt.status = "verified-local-selected-numeric-journeys";
  }
  const network = (await readFile(path.join(run, "server-network.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  check(network.length > 0 && network.every((e) => e.allowed !== false) && network.some((e) => e.kind === "guard-installed") &&
    network.filter((e) => e.kind === "guard-installed").every((e) => isDeepStrictEqual(e.allowedOrigins, [profile.metadata.backendOrigin, profile.metadata.appOrigin])), "exact-loopback-network-guard");
  receipt.run = { path: relativePath(run), manifestSha256: sha256(await readFile(path.join(run, "manifest.json"))), selection: config.componentSelection, results: result.count };
} catch (error) { receipt.status = "proof-missing"; receipt.error = error.message; }
receipt.finishedAt = new Date().toISOString(); const safe = redactCctpMetadata(receipt);
await writeFile(path.join(output, "qualification.json"), JSON.stringify(safe, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: safe.status, checks: safe.checks.length, failures: safe.checks.filter((c) => !c.passed).length, qualification: relativePath(path.join(output, "qualification.json")) }));
process.exitCode = safe.status === "proof-missing" ? 1 : 0;
