// Admission failures before any seed: docs/testing/generated-ouvrage-components-e2e.md.
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
const directory = path.resolve(".e2e/core07/guards", randomUUID());
await mkdir(directory, { recursive: true });
const checks = [], receipt = { status: "checking", databaseAccess: false, httpAccess: false, browserAccess: false,
  command: { executable: process.execPath, args: process.argv.slice(1) }, checks };
try {
  const { newComponentsPlan, validateComponentsPlan } = await import(pathToFileURL(path.resolve("scripts/tester-army/generated-components-plan.mjs")));
  const config = { campaign: "components-offline", prefix: "ARMY-GENERATED-COMPONENTS-OFFLINE", apiUrl: "http://127.0.0.1:45585", approvalReference: "offline-admission-only",
    owner: Object.fromEntries(["userId", "tenantId", "membershipId", "laborRoleId"].map((key) => [key, randomUUID()])),
    ownerFixturePath: ".e2e/offline/owner.json", ownerFixtureSha256: "1".repeat(64), stackReceiptPath: ".e2e/offline/stack.json", stackReceiptSha256: "2".repeat(64),
    nativeRecipePath: ".e2e/offline/native.json", nativeRecipeSha256: "3".repeat(64), nativeDistribution: "Ubuntu-24.04",
    nativeSupportSha256: "4".repeat(64), nativeHelperSha256: "5".repeat(64), nativePrimitivesSha256: "6".repeat(64), nativeNodePath: "/offline/node", selection: "entry" };
  const good = newComponentsPlan(config);
  const trial = (name, mutate, refuse = true) => {
    const value = structuredClone(good); mutate(value);
    let error = null; try { validateComponentsPlan(value); } catch (caught) { error = caught.message; }
    checks.push({ name, passed: refuse ? Boolean(error) : !error, refused: Boolean(error) });
  };
  trial("pending-only-positive", () => {}, false);
  trial("full-explicit-positive", (p) => { p.selection = "full"; }, false);
  trial("unknown-selection", (p) => { p.selection = "latest"; });
  trial("remote-origin", (p) => { p.apiUrl = "https://not-local.example"; });
  trial("reused-component-id", (p) => { p.scenarios[1].components[0].componentId = p.scenarios[0].components[0].componentId; });
  trial("rejected-before-ui", (p) => { p.records.find((r) => r.table === "estimate_generated_ouvrage_subdetail_items").row.status = "rejected"; });
  trial("reviewed-before-ui", (p) => { p.records.find((r) => r.table === "estimate_generated_ouvrage_subdetail_drafts").row.status = "reviewed"; });
  trial("line-before-application", (p) => { p.records.find((r) => r.table === "estimate_items").row.item_type = "line"; });
  trial("labor-hours-drift", (p) => { p.scenarios[0].components[1].quantity = 2; });
  trial("labor-cost-drift", (p) => { p.scenarios[0].components[3].unitCostHtCents = 8000; });
  trial("owner-role-reused-as-component", (p) => { p.scenarios[0].components[0].componentId = p.owner.laborRoleId; });
  trial("no-native-chain", (p) => { delete p.nativeRecipeSha256; });
  trial("final-result-record", (p) => { p.records.push({ table: "estimate_generated_ouvrage_applications", row: { id: randomUUID() } }); });
  receipt.status = checks.every((c) => c.passed) ? "passed" : "failed";
} catch (error) { checks.push({ name: "admission-capability", passed: false, errorType: error.code ?? error.name }); receipt.status = "failed"; }
await writeFile(path.join(directory, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: receipt.status, passed: checks.filter((c) => c.passed).length, total: checks.length, receipt: path.relative(process.cwd(), path.join(directory, "receipt.json")) }));
process.exitCode = receipt.status === "passed" ? 0 : 1;
