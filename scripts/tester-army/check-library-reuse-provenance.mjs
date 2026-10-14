// Reader regressions precede its stricter validator and the product migration.
// docs/testing/assembly-reuse-provenance.md; no network/database/browser.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
const directory = path.resolve(".e2e/core07/provenance-reader-guards", randomUUID()); await mkdir(directory, { recursive: true });
const checks = [];
try {
  const { validateLibraryReuseProvenance } = await import(pathToFileURL(path.resolve("scripts/tester-army/generated-components-reader-support.mjs")));
  const assemblyId = randomUUID(), fragment = randomUUID(), role = randomUUID();
  const library = ["material", "labor"].map((type, i) => ({ id: randomUUID(), assembly_id: assemblyId, title: `source item ${i}`, unit: type === "labor" ? "h" : "u",
    default_quantity: 1, unit_cost_ht_cents: type === "labor" ? 0 : 8000, h_mo: type === "labor" ? 1 : 0, k_fo: type === "labor" ? 0 : 1, k_mo: 0,
    labor_role_id: type === "labor" ? role : null, cost_type: type, source_metadata: { component_id: randomUUID(), sources: [{ sourceFragmentId: fragment, evidenceKind: "fact" }] } }));
  const linesFor = (items) => items.map((item) => ({ id: randomUUID(), title: item.title, description: item.unit, quantity: item.default_quantity,
    unit_price_ht_cents: item.cost_type === "labor" ? 0 : item.unit_cost_ht_cents, h_mo: item.h_mo, k_fo: item.k_fo, k_mo: item.k_mo, labor_role_id: item.labor_role_id,
    source_provider: "assembly_library", source_metadata: { kind: "assembly_library", library_origin: { assembly_id: assemblyId, assembly_item_id: item.id, source_metadata: structuredClone(item.source_metadata) } } }));
  const trial = (name, mutate, refuse = true) => { const items = structuredClone(library), lines = linesFor(items); mutate(lines, items); let error = null;
    try { validateLibraryReuseProvenance(lines, assemblyId, items); } catch (caught) { error = caught.message; }
    checks.push({ name, passed: refuse ? Boolean(error) : !error }); };
  trial("exact-zero-labor-and-distinct-id-positive", () => {}, false);
  trial("paid-labor-has-zero-material-price-positive", (lines, items) => {
    items[1].unit_cost_ht_cents = 4000; items[1].k_mo = 1;
    lines[1].unit_price_ht_cents = 0; lines[1].k_mo = 1;
  }, false);
  trial("paid-labor-must-not-be-copied-as-material-price", (lines, items) => {
    items[1].unit_cost_ht_cents = 4000; items[1].k_mo = 1;
    lines[1].unit_price_ht_cents = 4000; lines[1].k_mo = 1;
  });
  trial("full06-manual-empty-provenance-refused", (lines) => { for (const line of lines) { line.source_provider = "manual"; line.source_metadata = {}; } });
  trial("same-fragments-are-not-item-identity", (lines) => { lines[1].source_metadata.library_origin.assembly_item_id = lines[0].source_metadata.library_origin.assembly_item_id; });
  trial("wrong-leaf-assembly-id", (lines) => { lines[1].source_metadata.library_origin.assembly_id = randomUUID(); });
  trial("flattened-generated-claim", (lines) => { lines[0].source_metadata.snapshot_id = randomUUID(); });
  trial("original-component-id-altered", (lines) => { lines[0].source_metadata.library_origin.source_metadata.component_id = randomUUID(); });
  trial("zero-labor-hour-lost", (lines) => { lines[1].h_mo = 0; });
  trial("legacy-json-copied-exactly-positive", (lines, items) => { items[0].source_metadata = {}; items[1].source_metadata = ["legacy", null]; lines[0].source_metadata.library_origin.source_metadata = {}; lines[1].source_metadata.library_origin.source_metadata = ["legacy", null]; }, false);
} catch (error) { checks.push({ name: "stricter-provenance-reader-capability", passed: false, errorType: error.code ?? error.name }); }
const receipt = { status: checks.every((c) => c.passed) ? "passed" : "failed", databaseAccess: false, httpAccess: false, browserAccess: false,
  command: { executable: process.execPath, args: process.argv.slice(1) }, checks };
await writeFile(path.join(directory, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: receipt.status, passed: checks.filter((c) => c.passed).length, total: checks.length, receipt: path.relative(process.cwd(), path.join(directory, "receipt.json")) }));
process.exitCode = receipt.status === "passed" ? 0 : 1;
