// Offline refusal regressions, written before the CCTP recipe implementation.
// Oracle vectors below are synthetic parser inputs, never native qualifications.
import assert from "node:assert/strict";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { repositoryRoot as root, sha256, relativePath } from "./local-recipe-common.mjs";
import { verifyNativeRecipe } from "./local-native-proof.mjs";

const directory = path.join(root, ".e2e/retro-runtime/cctp-recipe-checks", randomUUID());
await mkdir(directory, { recursive: true });
const results = [];
async function check(name, action) {
  try { await action(); results.push({ name, passed: true }); }
  catch (error) { results.push({ name, passed: false, error: error.name === "AssertionError" ? error.message : "Required offline capability refused or unavailable" }); }
}
// This input cannot qualify any native campaign. Its only purpose is proving
// that missing CCTP attestation refuses before config/artifact/SQL evidence.
const refusalFile = path.join(directory, "missing-cctp-attestation.json");
const refusalBytes = JSON.stringify({ schemaVersion: "cctp-native-refusal-vector-1", parserOnly: true, qualification: false, scenarioSet: "generated-recovery" });
await writeFile(refusalFile, refusalBytes, { flag: "wx" });
await check("generated-only input cannot qualify CCTP", async () => {
  await assert.rejects(verifyNativeRecipe(relativePath(refusalFile), sha256(refusalBytes), { scenarioSet: "source-coverage" }),
    { message: "CCTP installed attestation is required separately from generated qualification." });
});
await check("unknown recipe scenario refuses before stage", async () => {
  // Deliberately no native/owner/backend fields: the scenario guard must refuse
  // before they are read, and no login or stage can start from this vector.
  const config = { schemaVersion: "army-local-recipe-1", campaign: `cctp-check-${randomUUID()}`,
    approvalReference: "offline parser refusal only", scenarioSet: "misspelled-coverage" };
  const file = path.join(directory, "invalid-config.json"); await writeFile(file, JSON.stringify(config), { flag: "wx" });
  const run = spawnSync(process.execPath, ["scripts/tester-army/local-recipe.mjs", "plan", "--config", relativePath(file)], { cwd: root, env: process.env, encoding: "utf8", windowsHide: true });
  await writeFile(path.join(directory, "invalid-plan-output.txt"), run.stdout + run.stderr, { flag: "wx" });
  assert.equal(run.status, 3); assert.match(run.stderr, /Unknown local recipe scenarioSet/);
});
let contract;
await check("CCTP declaration oracle is durable", async () => {
  contract = await import("./cctp-native-contract.mjs");
  const definitions = await contract.cctpDefinitions();
  assert.equal(definitions.functions.filter((row) => row.authenticated).length, 7);
  assert.equal(definitions.functions.filter((row) => row.service).length, 4);
  assert.equal(definitions.tables.length, 8); assert.equal(definitions.cases.length, 34);
});
async function vectors() {
  assert.ok(contract, "CCTP oracle unavailable");
  const definitions = await contract.cctpDefinitions();
  const functions = definitions.functions.map((row, index) => ({ ...row, oid: 100000 + index, owner: "postgres", publicExecute: false, anon: false }));
  const tables = definitions.tables.flatMap((table) => ["anon", "authenticated", "service_role"].map((role) => ({ table, role, rls: true, owner: "postgres", usagePrivate: false, tableAny: false })));
  const result = { allPassed: true, fixturePrefix: "dc510000", physicalStorageProof: false, concurrencyExecuted: false,
    cases: definitions.cases.map((name) => ({ case: name, passed: true, error: null })) };
  return { definitions, functions: { functions, tables }, result };
}
await check("exact body ACL vectors and mandatory abort accepted as parser inputs only", async () => {
  const v = await vectors(); contract.verifyCctpFunctions(v.functions, v.definitions);
  contract.verifyCctpRegression(`ERROR: P9001: SOURCE_COVERAGE_PROOF:${JSON.stringify(v.result)}\n`, v.result, 3, v.definitions);
});
await check("changed body and swapped role refused", async () => {
  const v = await vectors(); const bad = structuredClone(v.functions); bad.functions[0].body += " altered";
  assert.throws(() => contract.verifyCctpFunctions(bad, v.definitions));
  const rpc = v.functions.functions.find((row) => row.service); rpc.service = false; rpc.authenticated = true;
  assert.throws(() => contract.verifyCctpFunctions(v.functions, v.definitions));
});
await check("missing duplicate signature and private table privilege refused", async () => {
  const v = await vectors(); const bad = structuredClone(v.functions); bad.functions.pop();
  assert.throws(() => contract.verifyCctpFunctions(bad, v.definitions));
  bad.functions.push(bad.functions[0]); assert.throws(() => contract.verifyCctpFunctions(bad, v.definitions));
  const wrong = structuredClone(v.functions); wrong.functions[0].signature += ",uuid";
  assert.throws(() => contract.verifyCctpFunctions(wrong, v.definitions));
  v.functions.tables[0].tableAny = true; assert.throws(() => contract.verifyCctpFunctions(v.functions, v.definitions));
});
await check("incomplete failed duplicate cases and missing abort refused", async () => {
  const v = await vectors();
  for (const change of [(r) => r.cases.pop(), (r) => r.cases[0].passed = false, (r) => r.cases[1].case = r.cases[0].case]) {
    const bad = structuredClone(v.result); change(bad);
    assert.throws(() => contract.verifyCctpRegression(`ERROR: P9001: SOURCE_COVERAGE_PROOF:${JSON.stringify(bad)}\n`, bad, 3, v.definitions));
  }
  assert.throws(() => contract.verifyCctpRegression(`SOURCE_COVERAGE_PROOF:${JSON.stringify(v.result)}\n`, v.result, 0, v.definitions));
});
await check("native preservation rejects deletion hidden by additions", async () => {
  const { validateCctpDelta } = await import("./cctp-seed-proof.mjs");
  const before = [{ schema: "public", name: "example", rows: 1, hashes: { old: 1 } }];
  assert.throws(() => validateCctpDelta(before, [{ schema: "public", name: "example", rows: 2, hashes: { new: 2 } }], { "public.example": { new: 1 } }));
  validateCctpDelta(before, [{ schema: "public", name: "example", rows: 2, hashes: { old: 1, new: 1 } }], { "public.example": { new: 1 } });
});
await check("seed plan requires eleven independent scenarios and tracked corpus", async () => {
  const { newCctpPlan, validateCctpPlan } = await import("./cctp-seed-plan.mjs");
  const owner = Object.fromEntries(["userId", "tenantId", "membershipId", "laborRoleId"].map((key) => [key, randomUUID()]));
  const plan = await newCctpPlan({ campaign: "parser-vector", owner, prefix: "ARMY-COVERAGE-parser-vector", apiUrl: "http://127.0.0.1:45585", approvalReference: "offline vectors only" });
  await validateCctpPlan(plan);
  const bad = structuredClone(plan); bad.scenarios[1].projectId = bad.scenarios[0].projectId; await assert.rejects(validateCctpPlan(bad));
  const missing = structuredClone(plan); missing.scenarios.pop(); await assert.rejects(validateCctpPlan(missing));
  const pathMismatch = structuredClone(plan); pathMismatch.scenarios[0].sources[0].storagePath = "unplanned/object.pdf";
  await assert.rejects(validateCctpPlan(pathMismatch));
  plan.corpusSha256 = "0".repeat(64); await assert.rejects(validateCctpPlan(plan));
});
await check("compressed XLSX cell bytes and declared sheets must agree", async () => {
  const ExcelJS = (await import("exceljs")).default;
  const { inspectCctpWorkbook } = await import("./cctp-reader-support.mjs");
  const workbook = new ExcelJS.Workbook(); workbook.addWorksheet("Evidence").addRow(["observable cell", 17]);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer()); await writeFile(path.join(directory, "parser-vector.xlsx"), bytes, { flag: "wx" });
  const sheets = { Evidence: [["observable cell", 17]] };
  await inspectCctpWorkbook(bytes, sheets, []);
  await assert.rejects(inspectCctpWorkbook(bytes, { Evidence: [["observable cell", 18]] }, []));
  await assert.rejects(inspectCctpWorkbook(bytes, sheets, ["observable cell"]));
});
await check("all bytes and nested escaped lease values are private", async () => {
  const { assertCctpPrivateBytes } = await import("./cctp-reader-support.mjs");
  const environment = { E2E_LOGIN_PASSWORD: "synthetic space+credential", LOCAL_API_KEY: "demo" };
  for (const bytes of [Buffer.from([0, 1, ...Buffer.from("demo"), 0]), Buffer.from("synthetic%20space%2Bcredential"),
    Buffer.from(JSON.stringify({ details: JSON.stringify({ session_id: "12345678-1234-4234-8234-123456789abc" }) }))]) {
    assert.throws(() => assertCctpPrivateBytes(bytes, environment));
  }
  assertCctpPrivateBytes(Buffer.from("public fixture evidence"), environment);
});
const receipt = { schemaVersion: "cctp-recipe-offline-check-1", createdAt: new Date().toISOString(), databaseAccess: false, browserExecution: false,
  refusalVector: { path: relativePath(refusalFile), sha256: sha256(refusalBytes), qualification: false, usedOnlyForMissingAttestationRefusal: true }, results,
  limits: ["Synthetic vectors qualify only parsers/refusals; no native/TAP/Storage/UI PASS is inferred.", "Actual native transaction, upload, ordinary RLS and twelve browser cases require a later exclusive execution."] };
await writeFile(path.join(directory, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ passed: results.filter((r) => r.passed).length, total: results.length, receipt: relativePath(path.join(directory, "receipt.json")), sha256: sha256(await readFile(path.join(directory, "receipt.json"))) }));
if (results.some((row) => !row.passed)) process.exitCode = 3;
