// Independent offline reader. Admission failures were defined before implementation.
import { randomUUID } from "node:crypto";
import { readFile, readdir, mkdir, lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { loadCoverageProfile } from "./coverage-profile.mjs";
import { repositoryRoot as root, requireValue, sha256, ignoredFile, buildSourceEvidence, relativePath } from "./local-recipe-common.mjs";
import { validateComponentResults, validateComponentRedObservation, validateComponentApplied, validateComponentReuse, validateLibraryReuseProvenance } from "./generated-components-reader-support.mjs";
import { assertCctpPrivateBytes, inspectCctpWorkbook, redactCctpMetadata } from "./cctp-reader-support.mjs";
import { validateAssemblyTotalsResults, validateAssemblyTotalsBusiness } from "./assembly-totals-reader-support.mjs";
import { validateNumericExportCells } from "./generated-numeric-reader-support.mjs";
const usage = "node scripts/tester-army/qualify-generated-components.mjs <exact .e2e/army/coverage/runs/run-directory>";
if (process.argv.length === 3 && process.argv[2] === "--help") { console.log(usage); process.exit(0); }
requireValue(process.versions.node.startsWith("24.") && process.argv.length === 3, usage);
const runBase = path.join(root, ".e2e/army/coverage/runs"), requested = path.resolve(root, process.argv[2]);
requireValue(path.dirname(requested) === runBase, "Exact direct run required; no latest selection.");
const output = path.join(root, ".e2e/core07/qualifications", randomUUID()); await mkdir(output, { recursive: true });
const checks = [];
const check = (condition, name) => { checks.push({ name, passed: Boolean(condition) }); requireValue(condition, name); };
const same = (a, b, name) => check(isDeepStrictEqual(a, b), name);
const receipt = { schemaVersion: "army-generated-components-qualification-1", status: "checking", startedAt: new Date().toISOString(),
  command: { executable: process.execPath, args: process.argv.slice(1) }, readerSha256: sha256(await readFile(new URL(import.meta.url))), databaseAccess: false, httpAccess: false, browserAccess: false, checks,
  limits: ["Selected local component journeys only; no complete application, native races, print-PDF, production or deployment qualification.",
    "The entry RED is observed missing Écarter after successful Auth; it does not prove behavior after exclusion.", "GC04 uses a blocked first UI transport and real subsequent server actions in one ordinary session, not independent-session concurrency."] };
const walk = async (directory) => {
  const found = []; for (const e of await readdir(directory, { withFileTypes: true })) {
    check(!e.isSymbolicLink(), "no-archive-link"); const file = path.join(directory, e.name);
    if (e.isDirectory()) found.push(...await walk(file)); else { check(e.isFile(), "regular-archive-file"); found.push(file); }
  } return found;
};
try {
  const run = path.dirname(await ignoredFile(relativePath(path.join(requested, "manifest.json")))), files = await walk(run), manifest = JSON.parse(await readFile(path.join(run, "manifest.json"))), report = JSON.parse(await readFile(path.join(run, "report.json")));
  check(manifest.schemaVersion === "miaouffrage-tester-army-1" && manifest.mode === "coverage" && manifest.coverage.scenarioSet === "generated-components", "exact-component-manifest");
  const profile = await loadCoverageProfile(root, { configuredPath: manifest.coverage.profile });
  const profileBytes = await readFile(profile.evidence.find((e) => e.name === "profile.json").file), config = JSON.parse(profileBytes);
  const assemblyTotals = config.componentSelection === "assembly-totals";
  const result = assemblyTotals ? validateAssemblyTotalsResults(report) : validateComponentResults(report, config.componentSelection); check(true, "exact-component-results");
  same(manifest.result.summary, report.run.summary, "manifest-report-summary"); same(manifest.result.usage, report.run.usage, "manifest-report-usage");
  check(manifest.result.exitCode === report.run.exitCode && manifest.result.runnerExitCode === report.run.exitCode && manifest.result.status === (result.red ? "failed" : "passed"), "terminal-result");
  check(manifest.source.changedDuringRun === false && manifest.productionBuild.changedDuringRun === false && manifest.tracePaths.length === 0 && manifest.fixtures.authentication.result === "passed", "stable-build-auth-no-traces");
  const allowed = new Set(["--headed", "--no-cache", "--debug"]);
  same(manifest.command.args.slice(1).filter((a) => !allowed.has(a)), ["run", "--config", "e2e.config.ts", "--tag", "source-coverage", "--exclude-tag", "agent", "--target", "chromium-desktop", "--max-failures", "1"], "unfiltered-command");
  same(manifest.source.pilotInputsAfter, manifest.source.pilotInputs, "pilot-inputs-stable"); same(manifest.source.untrackedRuntimeInputsAfter, manifest.source.untrackedRuntimeInputs, "runtime-inputs-stable");
  same(manifest.source.workingDiffAfterSha256, manifest.source.workingDiffSha256, "diff-stable");
  const source = await buildSourceEvidence(); same(manifest.source.revision, source.revision, "current-source-revision"); same(manifest.source.workingDiffSha256, source.diffSha256, "current-working-diff");
  for (const list of [manifest.source.pilotInputs, manifest.source.untrackedRuntimeInputs, manifest.productionBuild.inputs]) {
    check(Array.isArray(list) && new Set(list.map((e) => e.path)).size === list.length, "unique-source-inputs");
    for (const input of list) check(sha256(await readFile(path.join(root, input.path))) === input.sha256, "current-input-hash");
  }
  const known = new Set([path.join(run, "manifest.json")]);
  const inside = (f) => f.startsWith(run + path.sep);
  for (const e of [...manifest.artifacts, ...manifest.coverage.retainedEvidence, manifest.report, ...(manifest.appLog ? [manifest.appLog] : [])]) {
    const file = await ignoredFile(e.path); check(inside(file) && !known.has(file) && !(await lstat(file)).isSymbolicLink(), "unique-confined-artifact"); known.add(file);
    check(sha256(await readFile(file)) === e.sha256, "archived-artifact-hash");
  }
  check(files.every((f) => known.has(f)) && known.size === files.length, "complete-run-inventory");
  for (const e of profile.evidence) check(manifest.coverage.retainedEvidence.some((a) => a.sha256 === e.sha256), "current-profile-chain-retained");
  const business = [];
  for (const file of files) {
    const bytes = await readFile(file); assertCctpPrivateBytes(bytes); check(true, "archive-private-bytes");
    if (file.endsWith(".json")) { const data = JSON.parse(bytes); if (data.schemaVersion === "miaouffrage-army-business-1") business.push({ file, ...data }); }
  }
  const find = (label) => { const found = business.filter((e) => path.basename(e.file) === `${e.fixturePrefix}-${label}.json`); check(found.length === 1, `exact-business-${label}`); return found[0].data; };
  const fixture = profile.metadata.generatedFixture;
  const initial = find("GC01-initial");
  same(initial.estimate.items.map((r) => r.id), [fixture.scenarios[0].sectionId], "fresh-one-section");
  same([initial.estimate.version.total_ht_cents, initial.estimate.version.total_tax_cents, initial.estimate.version.total_ttc_cents], [0, 0, 0], "fresh-financial-zero");
  check(initial.objects.components.length === 4 && initial.objects.components.every((r) => r.status === "suggested") && ["applications", "snapshots", "assemblies", "libraryComponents"].every((k) => initial.objects[k].length === 0), "fresh-proposals-no-final-result");
  if (assemblyTotals) {
    validateAssemblyTotalsBusiness(find, fixture); check(true, "exact-immediate-assembly-footer-api-rls-ui-reload");
    const exported = new Set();
    for (const [index, id] of ["AT01", "AT02"].entries()) for (const target of ["primary", "target"]) for (const mode of ["standard", "dpgf"]) {
      const source = fixture.scenarios[index], data = target === "primary" ? find(id + "-exports-primary-" + mode).actual : find(source.label + "-assembly-total-exports-" + mode);
      const api = target === "primary" ? find(id + "-applied-reload").actual.state.estimate : find(id + "-reload").actual.api;
      const expected = target === "primary" ? [1250, 250, 1500] : index ? [2925, 585, 3510] : [3250, 650, 3900];
      const artifact = manifest.artifacts.filter((entry) => entry.sha256 === data.sha256); check(artifact.length === 1 && !exported.has(artifact[0].path), "distinct-real-AT-xlsx"); exported.add(artifact[0].path);
      await inspectCctpWorkbook(await readFile(await ignoredFile(artifact[0].path)), data.sheets, source.components.slice(1).map((component) => component.designation));
      validateNumericExportCells(data, api, expected); check(true, "exact-AT-xlsx-own-api-cells");
    }
    check(exported.size === 8, "all-eight-real-AT-exports"); receipt.status = "verified-local-assembly-fixed-and-v2-discount";
  } else if (result.red) {
    const observed = find("GC01-decision-2-exclude-0"); validateComponentRedObservation(observed); check(true, "observed-real-missing-action");
    check(initial.calls.length === 0 && business.every((e) => !path.basename(e.file).includes("application-reply")), "no-application-in-red");
    receipt.status = "verified-local-observed-missing-component-decision";
  } else {
    const s = fixture.scenarios[0];
    for (const label of ["first-read-after-apply", "applied-reload"]) { validateComponentApplied(find(`GC01-${label}`), s, [8000, 1600, 9600], 8000, fixture.owner); check(true, `GC01-${label}`); }
    validateComponentReuse(find("GC01-reuse-final"), s, [8000, 1600, 9600]); check(true, "GC01-real-library-reuse");
    const rejected = find("GC01-excluded-reload").objects.components;
    same(rejected.filter((r) => r.status === "rejected").map((r) => [r.id, r.metadata.rejected_from_status]).sort(), s.components.slice(2).map((c) => [c.componentId, "suggested"]).sort(), "GC01-origin-after-reload");
    const restored = find("GC01-restored-reload").objects.components; check(restored.find((r) => r.id === s.components[2].componentId).status === "suggested" && restored.find((r) => r.id === s.components[3].componentId).status === "rejected", "GC01-explicit-origin-restoration");
    const merge = find("GC01-incompatible-merge-observed"); same(merge.mergeAfter.estimate, merge.mergeBefore.estimate, "GC01-refused-merge-financial-invariance");
    same(merge.mergeAfter.objects, merge.mergeBefore.objects, "GC01-refused-merge-proposal-invariance");
    check(merge.reviewBefore.records.length === 1 && merge.reviewAfter.records.length === 1 && /^[0-9a-f]{64}$/.test(merge.reviewBefore.records[0].reviewToken) &&
      merge.reviewBefore.records[0].reviewToken === merge.reviewAfter.records[0].reviewToken && merge.reviewAfter.records[0].status === "reviewed" &&
      merge.postsBefore === merge.postsAfter && merge.insertionEnabled === true, "GC01-refused-merge-keeps-real-token-and-insertion");
    for (const [tag, submitted, componentDs, totalDs, badge] of [
      ["same", "1.0004", /DS\s*40[,.]00/, /DS\s*80[,.]00/, "Suggéré"],
      ["half-up", "1.0005", /DS\s*40[,.]04/, /DS\s*80[,.]04/, "Saisi manuellement"],
      ["restored", "1", /DS\s*40[,.]00/, /DS\s*80[,.]00/, "Suggéré"],
    ]) {
      const precision = find(`GC01-normalized-quantity-${tag}-observed`);
      same(precision.before.estimate, precision.after.estimate, "GC01-unsaved-precision-financial-invariance");
      same(precision.before.objects, precision.after.objects, "GC01-unsaved-precision-proposal-invariance");
      check(precision.submitted === submitted && typeof precision.observedInput === "string" && precision.observedInput.trim() &&
        [Number(submitted), tag === "half-up" ? 1.001 : 1].includes(Number(precision.observedInput)) && typeof precision.costInput === "string" && precision.costInput.trim() && Number(precision.costInput.replace(",", ".")) === 40 &&
        componentDs.test(precision.componentText) && totalDs.test(precision.summaryText) && precision.componentText.includes(badge) &&
        precision.reviewBefore.records.length === 1 && precision.reviewAfter.records.length === 1 && /^[0-9a-f]{64}$/.test(precision.reviewBefore.records[0].reviewToken) &&
        precision.reviewAfter.records[0].reviewToken === precision.reviewBefore.records[0].reviewToken && precision.postsBefore === precision.postsAfter &&
        (tag !== "same" || precision.insertionEnabled === true), "GC01-decimal-precision-visible-state-and-token");
    }
    const invalidBaseline = find("GC01-invalid-quantity-baseline");
    check(invalidBaseline.insertionEnabled === true && invalidBaseline.saveDisabled === true && invalidBaseline.saveLabel?.trim() === "Sous-détail déjà validé",
      "GC01-equivalent-canonical-input-keeps-valid-review-without-redundant-save");
    const invalid = find("GC01-invalid-quantity-observed"); same(invalid.before.estimate, invalid.after.estimate, "GC01-invalid-quantity-financial-invariance");
    check(invalidBaseline.reviewToken === invalid.reviewBefore.records[0].reviewToken, "GC01-invalid-baseline-current-review-token");
    same(invalid.before.objects, invalid.after.objects, "GC01-invalid-quantity-proposal-invariance");
    check(invalid.submitted === "1000000000" && typeof invalid.inputBefore === "string" && invalid.inputAfter === "1000000000" && invalid.ariaInvalid === "true" && invalid.saveDisabled === true &&
      invalid.quantityError?.matchedReferences > 0 && /invalide|maximum|limite|dépass|stockage|hors|corrig/i.test(invalid.quantityError.errorText) && invalid.errorHeadings.length === 0 &&
      /DS\s*40[,.]00/.test(invalid.componentText) && /DS\s*80[,.]00/.test(invalid.summaryText) && invalid.componentText.includes("Suggéré") && invalid.insertionEnabled === false &&
      invalid.reviewBefore.records.length === 1 && invalid.reviewAfter.records.length === 1 && /^[0-9a-f]{64}$/.test(invalid.reviewBefore.records[0].reviewToken) &&
      invalid.reviewAfter.records[0].reviewToken === invalid.reviewBefore.records[0].reviewToken && invalid.postsBefore === invalid.postsAfter,
    "GC01-invalid-quantity-preserves-raw-and-blocks-without-write-or-crash");
    same(invalid.before.calls, invalid.after.calls, "GC01-invalid-quantity-action-ledger-invariance");
    const corrected = find("GC01-invalid-quantity-corrected");
    same(corrected.state.estimate, invalid.before.estimate, "GC01-corrected-quantity-financial-invariance");
    same(corrected.state.objects, invalid.before.objects, "GC01-corrected-quantity-proposal-invariance");
    same(corrected.state.calls, invalid.before.calls, "GC01-corrected-quantity-ledger-invariance");
    check(corrected.saveDisabled === false && corrected.insertionEnabled === false &&
      [Number(invalid.inputBefore.replace(",", ".")), 1].includes(Number(corrected.correctedInput.replace(",", "."))), "GC01-raw-quantity-explicitly-corrected-before-next-witness");
    for (const [label, count] of [["GC01-overflow-merge-observed", 5], ["GC01-overflow-derived-hours-observed", 4]]) {
      const overflow = find(label);
      if (count === 5) same(overflow.localAfter, overflow.localBefore, "GC01-structural-overflow-preserves-local-composition");
      else same(overflow.localAfter.articles.map((article) => article.fields.filter((field) => field.label !== "Rendement")),
        overflow.localBefore.articles.map((article) => article.fields.filter((field) => field.label !== "Rendement")), "GC01-invalid-yield-preserves-other-raw-fields");
      same(overflow.before.calls, overflow.after.calls, "GC01-overflow-action-ledger-invariance");
      same(overflow.after.estimate, overflow.before.estimate, "GC01-overflow-preserves-financial-state");
      same(overflow.after.objects, overflow.before.objects, "GC01-overflow-preserves-proposed-objects");
      check(overflow.localBefore.articles.length === count && overflow.localAfter.articles.length === count && (count !== 5 || overflow.toastTexts.includes("Quantité ou rendement invalide (maximum 999999999.999).")) &&
        overflow.errorHeadings.length === 0 && overflow.postsAfter === overflow.postsBefore && overflow.reviewBefore.records.length === 1 && overflow.reviewAfter.records.length === 1 &&
        /^[0-9a-f]{64}$/.test(overflow.reviewBefore.records[0].reviewToken) && overflow.reviewBefore.records[0].reviewToken === overflow.reviewAfter.records[0].reviewToken,
      "GC01-overflow-is-a-controlled-refusal-without-save-or-crash");
      if (count === 5) {
        check(overflow.operandQuantity === 600000000 && overflow.operandCost === 0 && overflow.newLocalCopyExpectedId === null &&
          overflow.localBefore.articles[0].text.includes("600000000") && overflow.localBefore.articles[1].fields.some((f) => f.label.trim() === "Quantité" && f.value === "600000000") &&
          overflow.localBefore.articles[1].fields.some((f) => f.label.trim() === "Coût unitaire HT (€)" && typeof f.value === "string" && f.value.trim() && Number(f.value.replace(",", ".")) === 0), "GC01-merge-exact-valid-operands");
      } else {
        check(overflow.parentQuantity === 2 && /Quantité\s*:\s*2/.test(overflow.parentText) && overflow.submittedYield === "600000000" && overflow.unit === "u" && overflow.yieldUnit === "h/u" &&
          overflow.yieldAfterInput === "600000000" && overflow.ariaInvalid === "true" && overflow.saveDisabled === true && overflow.insertionEnabled === false &&
          overflow.yieldError?.matchedReferences > 0 && /invalide|maximum|limite|dépass|stockage|hors|corrig/i.test(overflow.yieldError.errorText) &&
          /DS\s*80[,.]00/.test(overflow.localAfter.text) && /MO\s*1\s*h/.test(overflow.localAfter.text) &&
          overflow.localBefore.articles[1].text.includes("Saisi manuellement") && overflow.localAfter.articles[1].text.includes("Saisi manuellement") && overflow.localBefore.articles[1].fields.some((f) => f.label.trim() === "Unité" && f.value === "u") &&
          overflow.localBefore.articles[1].fields.some((f) => f.label.trim() === "Unité rendement" && f.value === "h/u"), "GC01-derived-hours-exact-parent-and-yield");
      }
    }
    const cleanup = find("GC01-overflow-ui-cleanup-observed");
    check(cleanup.local.articles.length === 4 && /Quantité\s*:\s*1/.test(cleanup.parentText) && /DS\s*80[,.]00/.test(cleanup.local.text) &&
      cleanup.postsBefore === cleanup.postsAfter, "GC01-temporary-composition-cleared-without-save");
    same(cleanup.state.objects, find("GC01-overflow-merge-observed").before.objects, "GC01-temporary-composition-never-persisted");
    const totalHours = find("GC01-overflow-total-hours-observed");
    same(totalHours.after.objects, totalHours.before.objects, "GC01-total-hours-keeps-persisted-proposals");
    same(totalHours.after.estimate, totalHours.before.estimate, "GC01-total-hours-keeps-financial-state");
    check(totalHours.individualHours === 600000000 && totalHours.individualCost === 0 && totalHours.combinedHours === 1200000000 && totalHours.local.articles.length === 5 &&
      [1, 2].every((i) => /600000000\s+h/.test(totalHours.local.articles[i].text)) && totalHours.local.articles[2].fields.some((f) => f.label.trim() === "Coût unitaire HT (€)" && typeof f.value === "string" && f.value.trim() && Number(f.value.replace(",", ".")) === 0) &&
      totalHours.local.text.includes("MO à corriger") && totalHours.local.text.includes("Les heures calculées dépassent la limite de stockage. Corrigez la quantité ou le rendement avant validation.") &&
      totalHours.saveDisabled === true && totalHours.errorHeadings.length === 0 && totalHours.postsBefore === totalHours.postsAfter, "GC01-total-hours-refuses-validation-without-save-or-crash");
    const totalCleared = find("GC01-overflow-total-hours-cleared"); check(totalCleared.local.articles.length === 4 && /MO\s*1\s*h/.test(totalCleared.local.text) &&
      totalCleared.postsBefore === totalCleared.postsAfter, "GC01-total-hours-copy-only-removed-and-original-restored");
    same(totalCleared.state.objects, totalHours.before.objects, "GC01-total-hours-temporary-composition-never-persisted");
    const equivalent = find("GC01-restored-equivalent-content-before-save");
    check(equivalent.designation === s.components[2].designation && equivalent.text.includes("Suggéré") && equivalent.factsBefore === equivalent.factsAfter &&
      typeof equivalent.costAfter === "string" && equivalent.costAfter.trim() && Number(equivalent.costAfter.replace(",", ".")) === 80, "GC01-equivalent-content-restores-suggested-before-save");
    const equivalentStored = restored.find((r) => r.id === s.components[2].componentId); check(equivalentStored.unit_cost_ht_cents === 8000 &&
      isDeepStrictEqual(equivalentStored.facts, [s.components[2].designation]), "GC01-equivalent-content-persists-exact-proposal");
    const workbooks = [];
    const validateExports = async (scenario, prefix, retainedIndices, expectedApi) => {
      if (prefix === "exports-reuse") {
        const preview = find(`${scenario.label}-reuse-library-preview`), applied = find(`${scenario.label}-${scenario.label === "GC01" ? "applied-reload" : "zero-labor-applied"}`).objects;
        check(applied.assemblies.length === 1 && applied.snapshots.length === 1 && preview.assemblyId === applied.assemblies[0].id &&
          preview.libraryName === applied.assemblies[0].name && preview.snapshotAssemblyId === applied.snapshots[0].assembly_id && preview.snapshotAssemblyId === preview.assemblyId &&
          preview.expectedCta === `Ajouter « ${preview.libraryName} »` && typeof preview.actualCta === "string" && preview.actualCta.trim().startsWith(preview.expectedCta),
        "reuse-selected-exact-existing-library-id-name-and-cta");
        const inserted = find(`${scenario.label}-reuse-provenance-insert`), reloaded = find(`${scenario.label}-reuse-provenance-reload`);
        check(inserted.status === 200 && inserted.insertResponse.ok === true && inserted.assemblyId === preview.assemblyId && reloaded.assemblyId === preview.assemblyId, "reuse-real-insertion-provenance-envelope");
        same(inserted.libraryItems, applied.libraryComponents, "reuse-insertion-exact-library-source-items"); same(reloaded.libraryItems, applied.libraryComponents, "reuse-reload-exact-library-source-items");
        for (const rows of [inserted.insertResponse.data.items, inserted.immediate.items, reloaded.after.items, reloaded.ordinaryRows]) {
          validateLibraryReuseProvenance(rows.filter((row) => row.item_type === "line"), preview.assemblyId, applied.libraryComponents); check(true, "reuse-exact-source-wrapper-api-and-ordinary-rls");
        }
        const ready = find(`${scenario.label}-reuse-ready`);
        check(ready.assemblyId === preview.assemblyId && /^(À jour|Sauvegardé)$/.test(ready.statusText), "reuse-is-visibly-synchronized-before-reload");
        same(ready.ready, inserted.immediate, "reuse-needs-no-extra-save-before-reload");
        same([inserted.immediate.version.total_ht_cents, inserted.immediate.version.total_tax_cents, inserted.immediate.version.total_ttc_cents], [8000, 1600, 9600], "reuse-financial-footer-is-persisted-immediately");
        const provenanceUi = find(`${scenario.label}-reuse-provenance-ui-readonly`); same(provenanceUi.before, provenanceUi.after, "reuse-provenance-ui-is-api-readonly");
        same(provenanceUi.ordinaryBefore, provenanceUi.ordinaryAfter, "reuse-provenance-ui-is-rls-readonly");
        same(provenanceUi.observations.map((o) => o.lineId).sort(), expectedApi.items.filter((row) => row.item_type === "line").map((row) => row.id).sort(), "reuse-provenance-ui-observes-two-exact-lines");
        for (const observation of provenanceUi.observations) check(observation.truthText.includes("Bibliothèque d'ouvrages") && observation.truthText.includes("Qté à confirmer") &&
          observation.truthText.includes("Confiance non mesurée") && observation.truthTitle.includes("La provenance d'origine ne mesure pas la confiance dans la quantité du devis actuel.") &&
          !/\d+\s*%/.test(observation.truthTitle) && /bibliothèque/i.test(observation.badgeText) && observation.popoverText.includes("Origine : bibliothèque d'ouvrages") &&
          observation.popoverText.includes("La provenance d'origine est conservée. Vérifiez la quantité et les exigences du devis actuel.") &&
          observation.libraryHref === "/dashboard/estimates/assemblies" && !/[0-9a-f]{8}-[0-9a-f-]{27}|Origine\s*:\s*IA|snapshot|application IA/i.test(observation.popoverText),
        "reuse-provenance-ui-requires-current-quantity-review-without-ai-attribution-or-uuids");
      }
      const expectedTotals = [8000, 1600, 9600], lines = expectedApi.items.filter((r) => r.item_type === "line");
      for (const mode of ["standard", "dpgf"]) {
        const data = find(`${scenario.label}-${prefix}-${mode}`), declared = data.sheets;
        same(data.api, expectedApi, "export-own-api-snapshot"); same(data.retainedIndices, retainedIndices, "export-own-component-selection");
        check(data.versionId === expectedApi.version.id, "export-own-version");
        const candidates = manifest.artifacts.filter((e) => e.sha256 === data.sha256); check(candidates.length === 1, "exact-real-xlsx-artifact");
        const bytes = await readFile(await ignoredFile(candidates[0].path));
        await inspectCctpWorkbook(bytes, declared, scenario.components.filter((_, i) => !retainedIndices.includes(i)).map((c) => c.designation));
        if (mode === "standard") {
          for (const line of lines) {
            const rows = declared.Devis.filter((r) => String(r[1]).trim() === line.title); check(rows.length === 1, "standard-own-line-once");
            same(rows[0].slice(2, 8), [line.description, line.quantity, Number(line.pu_ht_cents) / 100, Number(line.line_total_ht_cents) / 100, Number(line.line_tax_cents) / 100, Number(line.line_total_ttc_cents) / 100], "standard-own-api-cells");
          }
          for (const [i, label] of ["Total HT", "Total TVA", "Total TTC"].entries()) same(declared.Resume.filter((r) => r[0] === label).map((r) => r[1]), [expectedTotals[i] / 100], "standard-total-cell");
        } else {
          for (const line of lines) {
            const rows = declared.Données.filter((r) => r[1] === line.id); check(rows.length === 1, "dpgf-own-line-once");
            same([rows[0][3], rows[0][4], rows[0][5], rows[0][7], rows[0][8], rows[0][9], rows[0][10]], [line.quantity, line.description,
              Number(line.unit_price_ht_cents) / 100, line.k_fo ?? 1, line.h_mo ?? 0, line.k_mo ?? 1, line.h_mo_majoration ?? 1], "dpgf-own-api-base-and-allocation-cells");
          }
          if (prefix === "exports" && scenario.label === "GC01") {
            const row = declared.Données.find((r) => r[1] === lines[0].id);
            same([row[3], row[4], row[5], row[7], row[8], row[9], row[10]], [1, "u", 80, 0.5, 1, 1, 1], "dpgf-primary-exact-allocation");
          }
        }
        workbooks.push({ scenario: scenario.label, prefix, mode, sha256: data.sha256 });
      }
    };
    await validateExports(s, "exports", [0, 1], find("GC01-applied-reload").estimate);
    await validateExports(s, "exports-reuse", [0, 1], find("GC01-reuse-final").after);
    receipt.workbooks = workbooks;
    if (config.componentSelection === "full") {
      const zero = fixture.scenarios[1]; validateComponentApplied(find("GC02-zero-labor-applied"), zero, [8000, 1600, 9600], 8000, fixture.owner); validateComponentReuse(find("GC02-reuse-final"), zero, [8000, 1600, 9600]); check(true, "GC02-zero-cost-hour-identity-reuse");
      await validateExports(zero, "exports-reuse", [1, 2], find("GC02-reuse-final").after);
      const all = find("GC03-all-excluded-refused"); same([all.estimate.version.total_ht_cents, all.estimate.version.total_tax_cents, all.estimate.version.total_ttc_cents], [0, 0, 0], "GC03-zero-financial-state");
      check(all.objects.drafts[0].status === "pending" && all.objects.subdetails[0].status === "pending_review" && all.objects.components.length === 4 &&
        all.objects.components.every((r) => r.status === "rejected") && ["applications", "snapshots", "assemblies", "libraryComponents"].every((k) => all.objects[k].length === 0), "GC03-four-decisions-persist-without-final-result");
      const allScenario = fixture.scenarios[2]; same(all.objects.components.map((r) => r.id).sort(), allScenario.components.map((c) => c.componentId).sort(), "GC03-original-component-identities");
      for (const [index, c] of allScenario.components.entries()) {
        const component = all.objects.components.find((r) => r.id === c.componentId);
        check(component.designation === c.designation && component.cost_type === c.costType && component.quantity === c.quantity && component.unit === c.unit &&
          component.unit_cost_ht_cents === c.unitCostHtCents && component.loss_coeff_bp === 0 && component.yield_value === null && component.yield_unit === null &&
          component.source_fragment_id === c.fragmentId && component.component_order === index && component.confidence === 1 && component.metadata.rejected_from_status === "suggested" &&
          isDeepStrictEqual(component.facts, [c.designation]) && isDeepStrictEqual(component.hypotheses, []) && isDeepStrictEqual(component.inferences, []), "GC03-exact-original-proposal-values-and-origin");
        const sources = all.objects.componentSources.filter((r) => r.component_id === c.componentId); check(sources.length === 1 && sources[0].source_fragment_id === c.fragmentId &&
          sources[0].source_rank === 0 && sources[0].evidence_kind === "fact" && sources[0].note === c.designation, "GC03-exact-original-component-citation");
      }
      const stale = find("GC04-stale-refusal"); same(stale.after.estimate, stale.before.estimate, "GC04-current-estimate-preserved");
      check(stale.refused.records.length === 1 && stale.refused.records[0].ok === false && stale.refused.records[0].error.code === "GENERATED_OUVRAGE_REVIEW_CHANGED" &&
        ["applications", "snapshots", "assemblies", "libraryComponents"].every((k) => stale.after.objects[k].length === 0), "GC04-real-stale-intention-refused");
    }
    receipt.status = config.componentSelection === "full" ? "verified-local-full-component-contract" : "verified-local-entry-component-journey";
  }
  receipt.run = { path: relativePath(run), manifestSha256: sha256(await readFile(path.join(run, "manifest.json"))), selection: config.componentSelection, results: result.count };
} catch (error) { receipt.status = "failed"; receipt.error = error.message; }
receipt.finishedAt = new Date().toISOString();
const safe = redactCctpMetadata(receipt); await writeFile(path.join(output, "qualification.json"), JSON.stringify(safe, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: safe.status, checks: safe.checks.length, failures: safe.checks.filter((c) => !c.passed).length, qualification: relativePath(path.join(output, "qualification.json")) }));
process.exitCode = safe.status === "failed" ? 1 : 0;
