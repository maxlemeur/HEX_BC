// Independent reader failure modes precede implementation; no backend access.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
const directory = path.resolve(".e2e/core07/reader-guards", randomUUID()); await mkdir(directory, { recursive: true });
const checks = [];
try {
  const { validateComponentResults, validateComponentRedObservation, validateComponentApplied } = await import(pathToFileURL(path.resolve("scripts/tester-army/generated-components-reader-support.mjs")));
  const auth = "authenticate the existing E2E account without provisioning memberships", test = "GC01 excluded components survive restoration reload application exports and library reuse";
  const report = { schemaVersion: "report-1", run: { status: "failed", exitCode: 1, summary: { discovered: 2, selected: 2, executed: 2, passed: 1, failed: 1, skipped: 0, flaky: 0 },
    usage: { modelTokens: 0, maxModelCallsInStep: 0, downloads: 0 }, results: [auth, test].map((title, i) => ({ id: String(i), testId: String(i), kind: i ? "test" : "setup", titlePath: [title],
      file: i ? "e2e/army/local/generated-ouvrage-components.e2e.ts" : "e2e/army/critical/auth.setup.e2e.ts", selected: true, status: i ? "failed" : "passed", repeat: 0,
      platform: "web", targetId: "chromium-desktop", attempts: [{ index: 0, status: i ? "failed" : "passed", cleanup: "complete", ...(i ? { error: { code: "ASSERTION_FAILED", message: "Écarter not visible" } } : {}) }] })) } };
  const trial = (name, action, refuses) => { let failed = false; try { action(); } catch { failed = true; } checks.push({ name, passed: failed === refuses }); };
  trial("exact-red-results", () => validateComponentResults(report, "entry"), false);
  trial("setup-failure-is-not-product-red", () => { const r = structuredClone(report); r.run.results[0].status = "failed"; validateComponentResults(r, "entry"); }, true);
  trial("skipped-business-is-not-red", () => { const r = structuredClone(report); r.run.results[1].status = "skipped"; validateComponentResults(r, "entry"); }, true);
  trial("unrelated-failure-is-not-red", () => { const r = structuredClone(report); r.run.results[1].attempts[0].error.message = "API unavailable"; validateComponentResults(r, "entry"); }, true);
  trial("model-call-is-not-exact-proof", () => { const r = structuredClone(report); r.run.usage.modelTokens = 1; validateComponentResults(r, "entry"); }, true);
  trial("full-cannot-borrow-entry", () => validateComponentResults(report, "full"), true);
  const observation = { index: 2, decision: "Écarter", articles: Array.from({ length: 4 }, () => ({ text: "Suggéré", buttons: [{ name: "Supprimer", disabled: false }] })),
    state: { components: Array.from({ length: 4 }, () => ({ status: "suggested" })), applications: [], snapshots: [], assemblies: [], libraryComponents: [] } };
  trial("observed-absence-before-assertion", () => validateComponentRedObservation(observation), false);
  trial("existing-button-is-not-absent", () => { const o = structuredClone(observation); o.articles[2].buttons.push({ name: "Écarter", disabled: false }); validateComponentRedObservation(o); }, true);
  trial("preinserted-rejection-is-not-ui-proof", () => { const o = structuredClone(observation); o.state.components[2].status = "rejected"; validateComponentRedObservation(o); }, true);
  // Real-shaped API/RLS structures: a non-contiguous selection can keep the
  // same total while the component-to-library association is corrupted.
  const scenario = { label: "GC02", draftId: randomUUID(), candidateId: randomUUID(), components: Array.from({ length: 4 }, (_, i) => ({ componentId: randomUUID(), fragmentId: randomUUID(),
    designation: `proposal ${i}`, costType: i % 2 ? "labor" : "material", quantity: i === 3 ? 2 : 1, unit: i % 2 ? "h" : "u", unitCostHtCents: i === 2 ? 8000 : 4000 })) };
  const owner = { laborRoleId: randomUUID() }, applicationId = randomUUID(), snapshotId = randomUUID(), assemblyId = randomUUID();
  const retained = scenario.components.slice(1, 3).map((c) => ({ ...c, unitCostHtCents: c.costType === "labor" ? 0 : 8000, dsCents: c.costType === "labor" ? 0 : 8000,
    sources: [{ sourceFragmentId: c.fragmentId }] }));
  const summary = { componentCount: 2, dsCents: 8000, indicativeTargetPriceCents: 8000 };
  const applied = { estimate: { version: { total_ht_cents: 8000, total_tax_cents: 1600, total_ttc_cents: 9600 }, items: [{ item_type: "line", quantity: 1, h_mo: 1, pu_ht_cents: 8000,
    labor_role_id: owner.laborRoleId, line_total_ht_cents: 8000, line_tax_cents: 1600, line_total_ttc_cents: 9600,
    source_metadata: { kind: "generated_ouvrage", draft_id: scenario.draftId, candidate_id: scenario.candidateId, application_id: applicationId, snapshot_id: snapshotId, assembly_id: assemblyId, subdetail_summary: summary } }] },
    objects: { components: scenario.components.map((c, i) => ({ id: c.componentId, status: [0, 3].includes(i) ? "rejected" : "manual" })), componentSources: Array.from({ length: 4 }, () => ({})),
      applications: [{ id: applicationId }], snapshots: [{ id: snapshotId, components: retained, summary }], assemblies: [{ id: assemblyId }],
      libraryComponents: retained.map((c) => ({ title: c.designation, cost_type: c.costType, unit_cost_ht_cents: c.unitCostHtCents, h_mo: c.costType === "labor" ? 1 : 0,
        labor_role_id: c.costType === "labor" ? owner.laborRoleId : null, source_metadata: { component_id: c.componentId, sources: c.sources } })) } };
  const appliedTrial = (name, mutate, refuse = true) => trial(name, () => { const a = structuredClone(applied); mutate(a); validateComponentApplied(a, scenario, [8000, 1600, 9600], 8000, owner); }, refuse);
  appliedTrial("noncontiguous-zero-labor-positive", () => {}, false);
  appliedTrial("library-component-id-swapped", (a) => { a.objects.libraryComponents[0].source_metadata.component_id = scenario.components[0].componentId; });
  appliedTrial("library-zero-labor-hour-lost", (a) => { a.objects.libraryComponents[0].h_mo = 0; });
  appliedTrial("snapshot-retained-citation-swapped", (a) => { a.objects.snapshots[0].components[0].sources[0].sourceFragmentId = scenario.components[0].fragmentId; });
  appliedTrial("snapshot-zero-cost-labor-cost-altered", (a) => { a.objects.snapshots[0].components[0].unitCostHtCents = 4000; });
} catch (error) { checks.push({ name: "reader-capability", passed: false, errorType: error.code ?? error.name }); }
const receipt = { status: checks.every((r) => r.passed) ? "passed" : "failed", databaseAccess: false, httpAccess: false, browserAccess: false,
  command: { executable: process.execPath, args: process.argv.slice(1) }, checks };
await writeFile(path.join(directory, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: receipt.status, passed: checks.filter((r) => r.passed).length, total: checks.length, receipt: path.relative(process.cwd(), path.join(directory, "receipt.json")) }));
process.exitCode = receipt.status === "passed" ? 0 : 1;
