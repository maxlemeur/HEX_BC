// Admission failure defined before correction: the product selects the first
// active owner/tenant labor role by position, then id. No database/process seed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { repositoryRoot as root, relativePath, sha256 } from "./local-recipe-common.mjs";
import * as planModule from "./cctp-seed-plan.mjs";

const directory = path.join(root, ".e2e/retro-runtime/cctp-rmo-checks", randomUUID()); await mkdir(directory, { recursive: true });
const owner = { userId: "a1111111-1111-4111-8111-111111111111", tenantId: "a2222222-2222-4222-8222-222222222222", laborRoleId: "b4444444-4444-4444-8444-444444444444" };
const role = { id: owner.laborRoleId, user_id: owner.userId, tenant_id: owner.tenantId, position: 1, is_active: true, hourly_rate_cents: 4000 };
const cases = [
  { name: "active exact selected role", roles: [role], accept: true },
  { name: "inactive role refuses", roles: [{ ...role, is_active: false }], accept: false },
  { name: "another owner role refuses", roles: [{ ...role, user_id: "c1111111-1111-4111-8111-111111111111" }], accept: false },
  { name: "earlier active role wins and planned second refuses", roles: [role, { ...role, id: "a3333333-3333-4333-8333-333333333333", position: 0, hourly_rate_cents: 3000 }], accept: false },
  { name: "same position uuid ordering wins and planned second refuses", roles: [role, { ...role, id: "a3333333-3333-4333-8333-333333333333", hourly_rate_cents: 3000 }], accept: false },
  { name: "unrelated and inactive earlier roles do not change actual selection", roles: [{ ...role, id: "a3333333-3333-4333-8333-333333333333", position: 0, is_active: false }, { ...role, id: "a5555555-5555-4555-8555-555555555555", user_id: "c1111111-1111-4111-8111-111111111111", position: 0 }, role], accept: true },
];
const vector = path.join(directory, "vectors.json"); await writeFile(vector, JSON.stringify({ owner, cases }), { flag: "wx" });
const results = [];
for (const entry of cases) {
  let passed = false;
  try {
    assert.equal(typeof planModule.assertCctpLaborSelection, "function", "Required admission oracle absent");
    if (entry.accept) planModule.assertCctpLaborSelection(entry.roles, owner);
    else assert.throws(() => planModule.assertCctpLaborSelection(entry.roles, owner));
    passed = true;
  } catch { /* Capability missing before implementation is never a valid refusal. */ }
  results.push({ name: entry.name, language: "javascript", passed });
}
const python = path.join(directory, "probe.py");
await writeFile(python, `import importlib.util,json,sys\nfrom pathlib import Path\nspec=importlib.util.spec_from_file_location('cctp_native_seed',Path(sys.argv[1]))\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\nv=json.loads(Path(sys.argv[2]).read_text())\nresults=[]\nfor c in v['cases']:\n    passed=False\n    if callable(getattr(m,'validate_labor_selection',None)):\n        try:\n            m.validate_labor_selection(c['roles'],v['owner'])\n            passed=c['accept']\n        except RuntimeError:\n            passed=not c['accept']\n    results.append({'name':c['name'],'language':'python','passed':passed})\nprint(json.dumps(results))\n`, { flag: "wx" });
const env = { ...process.env };
for (const key of Object.keys(env)) if (/SUPABASE|^PG|DATABASE_URL|PASSWORD|SECRET|TOKEN|_KEY|^E2E_|PROXY/i.test(key)) delete env[key];
const invocation = spawnSync("python", [python, path.join(root, "scripts/tester-army/seed-source-coverage-native.py"), vector], { cwd: root, env, windowsHide: true, encoding: "utf8", timeout: 10_000 });
assert.equal(invocation.status, 0, "Offline Python admission harness must execute before interpreting results");
results.push(...JSON.parse(invocation.stdout));
const receipt = { schemaVersion: "cctp-rmo-admission-check-1", command: [process.execPath, ...process.argv.slice(1)], createdAt: new Date().toISOString(),
  databaseAccess: false, httpAccess: false, browserExecution: false, results,
  limits: ["Authorization input vectors only; no native query, mutation, RLS or browser proof is inferred.", "SQL and ordinary transports must select and recheck this exact effective role in the actual coordinated recipe."] };
const file = path.join(directory, "receipt.json"); await writeFile(file, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ passed: results.filter((r) => r.passed).length, total: results.length, receipt: relativePath(file), sha256: sha256(await readFile(file)) }));
if (results.some((r) => !r.passed)) process.exitCode = 3;
