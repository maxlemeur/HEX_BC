// Offline reader refusals recorded before implementation; no app or database.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
const directory = path.resolve(".e2e/generated-numeric/reader-guards", randomUUID());
await mkdir(directory, { recursive: true });
const checks = [];
const trial = (name, fn, refused = true) => { let rejects = false; try { fn(); } catch { rejects = true; } checks.push({ name, passed: rejects === refused }); };
try {
  const { numericContracts, numericTitles } = await import(pathToFileURL(path.resolve("scripts/tester-army/generated-numeric-plan.mjs")));
  const { validateNumericResults, validateNumericTyping, validateNumericRed, validateNumericInvalid, validateNumericInvalidDecision, validateNumericApplied, validateNumericExportCells } = await import(pathToFileURL(path.resolve("scripts/tester-army/generated-numeric-reader-support.mjs")));
  const report = { schemaVersion: "report-1", run: { status: "failed", exitCode: 1, summary: { discovered: 2, selected: 2, executed: 2, passed: 1, failed: 1, skipped: 0, flaky: 0 },
    usage: { modelTokens: 0, maxModelCallsInStep: 0, downloads: 0 }, results: ["authenticate the existing E2E account without provisioning memberships", numericTitles.NI01].map((t, i) => ({
      id: `result-${i}`, testId: `test-${i}`, kind: i ? "test" : "setup", titlePath: [t], file: i ? "e2e/army/local/generated-ouvrage-numeric-entry.e2e.ts" : "e2e/army/critical/auth.setup.e2e.ts",
      selected: true, repeat: 0, status: i ? "failed" : "passed", platform: "web", targetId: "chromium-desktop", attempts: [{ index: 0, status: i ? "failed" : "passed", cleanup: "complete",
        steps: i ? [{ api: "locator.pressSequentially", status: "passed", label: 'getByLabel("Coût unitaire HT")' }] : [], ...(i ? { error: { code: "ASSERTION_FAILED", category: "test", phase: "body", message: "expect.toHaveValue failed 12," } } : {}) }] })) } };
  trial("auth-and-known-product-assertion", () => validateNumericResults(report, "numeric-price"), false);
  for (const [name, mutate] of [["setup-not-red", (r) => { r.run.results[0].status = "failed"; }], ["skip-not-red", (r) => { r.run.summary.skipped = 1; }],
    ["retry-not-proof", (r) => { r.run.results[1].attempts.push(r.run.results[1].attempts[0]); }], ["model-not-exact", (r) => { r.run.usage.modelTokens = 1; }],
    ["network-not-product-red", (r) => { r.run.results[1].attempts[0].error.code = "ACTION_FAILED"; }]]) {
    trial(name, () => { const r = structuredClone(report); mutate(r); validateNumericResults(r, "numeric-price"); });
  }
  trial("all-cannot-borrow-isolated-results", () => validateNumericResults(report, "numeric-all"));
  trial("unknown-selection", () => validateNumericResults(report, "numeric-latest"));
  const s = { label: "GC01", projectId: randomUUID(), versionId: randomUUID(), draftId: randomUUID(), candidateId: randomUUID(), components: Array.from({ length: 4 }, () => ({ componentId: randomUUID() })) };
  const w = { schemaVersion: "army-numeric-entry-witness-1", caseId: "NI01", phase: "typed-price-prefix", fixture: { label: s.label, projectId: s.projectId, versionId: s.versionId,
    draftId: s.draftId, candidateId: s.candidateId, componentIds: s.components.map((c) => c.componentId) }, expected: { input: "12," },
    actual: { input: "12", label: "Coût unitaire HT (€)", method: "pressSequentially", submitted: "12,", focused: true, fieldIndex: 0, sectionText: "DS 0,12 €" } };
  trial("real-prefix-loss-is-red", () => validateNumericRed(w, report.run.results[1], s), false);
  trial("unrelated-http-assertion-is-not-input-red", () => { const r = structuredClone(report.run.results[1]); r.titlePath = [numericTitles.NI03]; r.attempts[0].error.message = "expect.toBe failed expected 200 observed 500";
    r.attempts[0].steps[0].label = 'getByLabel("Pertes")'; const ns = { ...s, label: "GC03" }, nw = { ...w, caseId: "NI03-A", phase: "typed-loss-completed", fixture: { ...w.fixture, label: "GC03" }, expected: { input: "5" },
      actual: { ...w.actual, input: "5", submitted: "5", label: "Pertes (bp)" } }; validateNumericRed(nw, r, ns); });
  for (const [name, mutate] of [["fill-not-typing", (o) => { o.actual.method = "fill"; }], ["wrong-field", (o) => { o.actual.fieldIndex = 1; }],
    ["invented-expected-prefix", (o) => { o.expected.input = "99,"; }], ["unfocused-input", (o) => { o.actual.focused = false; }],
    ["same-value-not-red", (o) => { o.actual.input = "12,"; }], ["wrong-fixture", (o) => { o.fixture.versionId = randomUUID(); }]]) {
    trial(name, () => { const o = structuredClone(w); mutate(o); validateNumericRed(o, report.run.results[1], s); });
  }
  trial("correct-prefix-is-green", () => { const o = structuredClone(w); o.actual.input = "12,"; validateNumericTyping(o, s, numericContracts.NI01); }, false);
  const state = { estimate: { version: { id: s.versionId }, items: [] }, objects: { components: s.components.map((component) => ({ id: component.componentId })) }, calls: [] };
  const before = { ...w, phase: "invalid-before", actual: { input: "12,50", saveEnabled: true, state, updateCalls: 0, insertCalls: 0 } };
  const after = { ...w, phase: "invalid-after", actual: { input: "12,50x", saveEnabled: false, insertEnabled: false, ariaInvalid: true, errorText: "Prix invalide", state, updateCalls: 0, insertCalls: 0 } };
  trial("invalid-blocks-real-enabled-transition", () => validateNumericInvalid(before, after, s), false);
  trial("already-disabled-is-not-block-proof", () => { const b = structuredClone(before); b.actual.saveEnabled = false; validateNumericInvalid(b, after, s); });
  trial("invalid-database-change-refused", () => { const a = structuredClone(after); a.actual.state.objects.components.push({ unit_cost_ht_cents: 0 }); validateNumericInvalid(before, a, s); });
  const exclusion = ["invalid-exclude-before", "invalid-excluded", "invalid-restored"].map((phase, index) => ({ ...after, phase, observedSequence: index + 1, observedAt: `2026-10-13T01:00:00.00${index}Z`,
    actual: { ...after.actual, excludedCount: index === 1 ? 4 : 3, fieldDisabled: index === 1, fieldReadOnly: false, saveEnabled: index === 1,
      saveLabel: index === 1 ? "Enregistrer les décisions" : "Revalider le sous-détail", excludeEnabled: index !== 1, restoreEnabled: index === 1 } }));
  trial("invalid-component-can-be-excluded-and-restored", () => validateNumericInvalidDecision(exclusion, after, s), false);
  for (const [name, mutate] of [["invalid-decision-order-refused", (a) => { a.reverse(); }], ["invalid-raw-input-loss-refused", (a) => { a[1].actual.input = "12"; }],
    ["excluded-garbage-blocking-decisions-refused", (a) => { a[1].actual.saveEnabled = false; }], ["garbage-decision-save-refused", (a) => { a[2].actual.state.calls.push({ name: "update" }); }]]) {
    trial(name, () => { const a = structuredClone(exclusion); mutate(a); validateNumericInvalidDecision(a, after, s); });
  }
  trial("all-contract-downloads", () => assert.equal(Object.values(numericContracts).reduce((n, c) => n + c.downloads, 0), 16), false);
  const c = numericContracts.NI02, ns = { ...s, label: "GC02", components: s.components.map((x, i) => ({ ...x, fragmentId: randomUUID(), designation: `proposal ${i}` })) };
  const owner = { laborRoleId: randomUUID() }, applicationId = randomUUID(), snapshotId = randomUUID(), assemblyId = randomUUID();
  const retained = c.components.map((x) => ({ ...x, componentId: ns.components[x.index].componentId, designation: ns.components[x.index].designation, status: "manual",
    dsCents: x.costType === "labor" ? 0 : 5000, sources: [{ sourceFragmentId: ns.components[x.index].fragmentId }] }));
  const line = { id: randomUUID(), item_type: "line", quantity: 2, h_mo: 0.5, unit_price_ht_cents: 2500, k_fo: 1, k_mo: 0, h_mo_majoration: 1, pu_ht_cents: 2500,
    title: "numeric parent", description: "u", line_total_ht_cents: 5000, line_tax_cents: 1000, line_total_ttc_cents: 6000,
    source_metadata: { kind: "generated_ouvrage", draft_id: ns.draftId, candidate_id: ns.candidateId, application_id: applicationId, snapshot_id: snapshotId, assembly_id: assemblyId,
      subdetail_summary: { componentCount: 2, dsCents: 5000 } } };
  const applied = { estimate: { version: { id: ns.versionId, total_ht_cents: 5000, total_tax_cents: 1000, total_ttc_cents: 6000 }, items: [line] }, calls: [], objects: { subdetails: [{ status: "applied" }],
    components: ns.components.map((x, i) => { const nc = c.components.find((v) => v.index === i); return { id: x.componentId, status: nc ? "manual" : "rejected", cost_type: nc?.costType ?? "material", quantity: nc?.quantity ?? 1,
      unit: "u", unit_cost_ht_cents: nc?.unitCostHtCents ?? 4000, loss_coeff_bp: 0, yield_value: nc?.yieldValue ?? null, yield_unit: nc?.yieldUnit ?? null, metadata: nc ? {} : { rejected_from_status: "suggested" } }; }),
    componentSources: ns.components.map((x) => ({ component_id: x.componentId, source_fragment_id: x.fragmentId, source_rank: 0 })), applications: [{ id: applicationId }],
    snapshots: [{ id: snapshotId, assembly_id: assemblyId, components: retained, summary: { componentCount: 2, dsCents: 5000, indicativeTargetPriceCents: 5000 } }], assemblies: [{ id: assemblyId }],
    libraryComponents: c.components.map((x) => ({ id: randomUUID(), assembly_id: assemblyId, title: ns.components[x.index].designation, cost_type: x.costType, unit: x.unit,
      default_quantity: x.quantity, unit_cost_ht_cents: x.unitCostHtCents, h_mo: x.hours, k_fo: x.costType === "material" ? 1 : 0, k_mo: 0, labor_role_id: x.costType === "labor" ? owner.laborRoleId : null,
      source_metadata: { component_id: ns.components[x.index].componentId, sources: [{ sourceFragmentId: ns.components[x.index].fragmentId }] } })) } };
  trial("canonical-zero-labor-and-library", () => validateNumericApplied(applied, ns, c, owner), false);
  for (const [name, mutate] of [["zero-labor-hours-lost", (a) => { a.objects.libraryComponents[1].h_mo = 0; }],
    ["same-total-wrong-library-component", (a) => { a.objects.libraryComponents[1].source_metadata.component_id = ns.components[0].componentId; }],
    ["same-total-wrong-cent-input", (a) => { a.objects.components[0].unit_cost_ht_cents = 40; }],
    ["snapshot-includes-rejected", (a) => { a.objects.snapshots[0].components.push({ componentId: ns.components[2].componentId, status: "rejected" }); }],
    ["source-fragment-swapped", (a) => { a.objects.libraryComponents[0].source_metadata.sources[0].sourceFragmentId = ns.components[1].fragmentId; }],
    ["reviewed-not-applied-proof", (a) => { a.objects.subdetails[0].status = "reviewed"; }]]) {
    trial(name, () => { const a = structuredClone(applied); mutate(a); validateNumericApplied(a, ns, c, owner); });
  }
  const exportData = { mode: "standard", versionId: ns.versionId, api: applied.estimate, sheets: { Devis: [[null, line.title, "u", 2, 25, 50, 10, 60]], Resume: [["Total HT", 50], ["Total TVA", 10], ["Total TTC", 60]] } };
  trial("export-own-api-cells", () => validateNumericExportCells(exportData, applied.estimate, c.totals), false);
  trial("export-other-version-refused", () => { const e = structuredClone(exportData); e.versionId = randomUUID(); validateNumericExportCells(e, applied.estimate, c.totals); });
  trial("export-declared-cents-refused", () => { const e = structuredClone(exportData); e.sheets.Devis[0][4] = 2500; validateNumericExportCells(e, applied.estimate, c.totals); });
} catch (error) { checks.push({ name: "numeric-reader-capability", passed: false, errorType: error.code ?? error.name }); }
const file = path.join(directory, "receipt.json"), source = await readFile(new URL(import.meta.url));
const git = (args) => { const r = spawnSync("git", ["-c", `safe.directory=${process.cwd()}`, ...args], { cwd: process.cwd(), env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }); if (r.status !== 0) { const error = new Error("Guard source evidence unavailable"); error.code = r.error?.code ?? "GIT_SOURCE_UNAVAILABLE"; throw error; } return r.stdout; };
const inputPaths = ["scripts/tester-army/check-generated-numeric-reader.mjs", "scripts/tester-army/generated-numeric-plan.mjs", "scripts/tester-army/generated-numeric-reader-support.mjs", "scripts/tester-army/qualify-generated-numeric.mjs"];
const inputs = await Promise.all(inputPaths.map(async (p) => { try { return { path: p, sha256: createHash("sha256").update(await readFile(p)).digest("hex") }; } catch (error) { if (error.code === "ENOENT") return { path: p, missing: true }; throw error; } }));
let sourceEvidence = {};
try { sourceEvidence = { revision: git(["rev-parse", "HEAD"]).toString().trim(), workingDiffSha256: createHash("sha256").update(git(["diff", "HEAD", "--binary"])).digest("hex") }; }
catch (error) { checks.push({ name: "read-only-git-source-evidence", passed: false, errorType: error.code ?? error.name }); }
const receipt = { status: checks.every((c) => c.passed) ? "passed" : "failed", command: { executable: process.execPath, args: process.argv.slice(1) },
  sourceSha256: createHash("sha256").update(source).digest("hex"), ...sourceEvidence,
  inputs, environment: { node: process.version, platform: process.platform, scope: "offline-synthetic-contract-vectors" }, databaseAccess: false, browserAccess: false, httpAccess: false, checks };
await writeFile(file, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: receipt.status, passed: checks.filter((c) => c.passed).length, total: checks.length, receipt: path.relative(process.cwd(), file) }));
process.exitCode = receipt.status === "passed" ? 0 : 1;
