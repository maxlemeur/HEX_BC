// Native attestation gap: a stale body or signature cannot be proven by UI E2E.
// These parser/ACL vectors precede the declaration folding implementation.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { repositoryRoot } from "./local-recipe-common.mjs";

const sql = (body, replace = false, type = "jsonb", authenticated = false) => `${replace ? "create or replace" : "create"} function private.generated_ouvrage_example(value ${type})\nreturns jsonb language sql immutable security invoker set search_path='' as $$\n${body}\n$$;\nrevoke all on function private.generated_ouvrage_example(${type}) from public,anon,authenticated,service_role;\n${authenticated ? `grant execute on function private.generated_ouvrage_example(${type}) to authenticated;` : ""}`;
const sources = [{ name: "20260101000000_base.sql", sql: sql("select value;") },
  { name: "20260102000000_override.sql", sql: sql("select value || '{}'::jsonb;", true) }];
const checks = [
  ["last body per exact signature", (api) => assert.equal(api.foldFunctionDeclarations(sources).functions[0].body, "select value || '{}'::jsonb;")],
  ["input order does not override timestamp order", (api) => assert.equal(api.foldFunctionDeclarations([...sources].reverse()).functions[0].body, "select value || '{}'::jsonb;")],
  ["duplicate declaration in one source refused", (api) => assert.throws(() => api.foldFunctionDeclarations([{ name: sources[0].name, sql: sql("select value;") + sql("select value;", true) }]))],
  ["bare CREATE collision refused", (api) => assert.throws(() => api.foldFunctionDeclarations([sources[0], { name: sources[1].name, sql: sql("select value;") }]))],
  ["distinct signatures never collapse by name", (api) => assert.equal(api.foldFunctionDeclarations([sources[0], { name: sources[1].name, sql: sql("select to_jsonb(value);", false, "text") }]).functions.length, 2)],
  ["ACL of replacement remains explicit", (api) => assert.equal(api.foldFunctionDeclarations([sources[0], { name: sources[1].name, sql: sql("select value;", true, "jsonb", true) }]).functions[0].authenticated, true)],
  ["empty search path and invoker properties retained", (api) => { const row = api.foldFunctionDeclarations(sources).functions[0]; assert.equal(row.definer, false); assert.equal(row.volatility, "i"); assert.deepEqual(row.config, ['search_path=""']); }],
  ["CCTP lock timeout is never dropped from attestation", (api) => assert.deepEqual(api.foldFunctionDeclarations([{ name: sources[0].name, sql: sql("select value;").replace("set search_path=''", "set search_path='' set lock_timeout='2s'") }]).functions[0].config, ['search_path=""', "lock_timeout=2s"])],
  ["unknown argument grammar refused", (api) => assert.throws(() => api.foldFunctionDeclarations([{ name: sources[0].name, sql: sql("select value;", false, "numeric(12,3)") }]))],
];
let api;
try { api = await import("./sql-function-declarations.mjs"); } catch { api = null; }
const results = checks.map(([name, run]) => {
  try { assert.equal(typeof api?.foldFunctionDeclarations, "function", "Declaration folding capability is absent"); run(api); return { name, passed: true, error: null }; }
  catch { return { name, passed: false, error: api ? "Declaration assertion failed" : "Declaration folding capability is absent" }; }
});
const directory = path.join(repositoryRoot, ".e2e/core07-sql/declaration-checks", randomUUID());
await mkdir(directory, { recursive: true });
const ownSource = await readFile(new URL(import.meta.url));
const receipt = { schemaVersion: "sql-function-declarations-check-1", status: results.every((row) => row.passed) ? "verified" : "failed",
  databaseAccess: false, networkAccess: false, sourceSha256: createHash("sha256").update(ownSource).digest("hex"),
  cases: results, limitations: ["Pure declaration parser vectors only; no installed body/ACL or product SQL qualification."] };
await writeFile(path.join(directory, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: receipt.status, passed: results.filter((row) => row.passed).length, failed: results.filter((row) => !row.passed).length,
  receipt: path.relative(repositoryRoot, path.join(directory, "receipt.json")).replaceAll("\\", "/") }));
if (receipt.status !== "verified") process.exitCode = 1;
