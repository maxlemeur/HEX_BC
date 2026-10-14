import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = path.join(root, ".e2e/retro-runtime/setup-archive-checks", randomUUID());
await mkdir(directory, { recursive: true });
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const relative = (file) => path.relative(root, file).split(path.sep).join("/");
const workspaceRunnerBytes = await readFile(path.join(root, "scripts/run-tester-army.mjs"));
if (process.argv.slice(2).some(value => value !== "--preimage")) throw new Error("Only --preimage selects the retained original wrapper.");
const baseline = process.argv.includes("--preimage");
const runnerBytes = baseline ? await readFile(path.join(root, ".e2e/retro-runtime/setup-archive-change-20261012/run-tester-army.preimage.mjs")) : workspaceRunnerBytes;
const helperPath = path.join(root, "scripts/tester-army/setup-failure-archive.mjs");
const helperBytes = await readFile(helperPath).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|TEMP|TMP|HOME|USERPROFILE)$/i.test(key)));
const secret = "synthetic-setup-password-a75a2df7";
const results = [];

const fixtureCli = `
const fs = require("node:fs/promises");
const path = require("node:path");
(async () => {
  const output = path.join(process.cwd(), ".e2e/army/coverage");
  const manifest = JSON.parse(await fs.readFile(path.join(output,"manifest.json"),"utf8"));
  const scenario = process.env.HARNESS_SCENARIO;
  if (scenario === "collision") {
    const archive = path.join(output,"runs",manifest.startedAt.replace(/[:.]/g,"-")+"-setup-failed");
    await fs.mkdir(archive,{recursive:true}); await fs.writeFile(path.join(archive,"manifest.json"),"existing-owner-bytes");
  }
  if (scenario === "destination-link") await fs.symlink(process.env.HARNESS_OUTSIDE,path.join(output,"runs"),"junction");
  if (scenario === "source-link") await fs.symlink(process.env.HARNESS_OUTSIDE,path.join(output,"profile-"+manifest.startedAt.replace(/[:.]/g,"-"),"foreign"),"junction");
  if (!["no-logs","source-link","destination-link","log-link"].includes(scenario)) {
    await fs.mkdir(path.join(output,"logs"),{recursive:true});
    await fs.appendFile(path.join(output,"logs/app.log"),"CURRENT "+process.env.E2E_LOGIN_PASSWORD+" Bearer arbitrary-token?token=current-token\\n");
    await fs.writeFile(process.env.E2E_COVERAGE_NETWORK_LOG,JSON.stringify({kind:"current-network",password:process.env.E2E_LOGIN_PASSWORD})+"\\n");
  }
  process.stdout.write("setup stdout "+process.env.E2E_LOGIN_PASSWORD+"\\n");
  process.stdout.write(JSON.stringify({details:JSON.stringify({session_id:"11111111-2222-4333-8444-555555555555"})})+"\\n");
  process.stderr.write("setup stderr Bearer opaque-current-token\\n");
  if (scenario === "large-output") process.stdout.write("current-line\\n".repeat(900000));
  if (scenario === "fresh") {
    const results=[{file:"e2e/army/critical/auth.setup.e2e.ts",titlePath:["fixture auth report"],targetId:"chromium-desktop",status:"passed"},{file:"e2e/army/local/fixture.e2e.ts",titlePath:["fixture business report"],targetId:"chromium-desktop",status:"passed"}];
    await fs.mkdir(path.join(output,"artifacts"),{recursive:true}); await fs.writeFile(path.join(output,"artifacts/current.json"),"{\\"scope\\":\\"harness-only\\"}\\n");
    await fs.writeFile(path.join(output,"report.json"),JSON.stringify({run:{startedAt:new Date().toISOString(),status:"passed",results,summary:{discovered:2,selected:2,executed:2,passed:2,failed:0,skipped:0,flaky:0},usage:{modelTokens:0,maxModelCallsInStep:0}}}));
    return;
  }
  process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=2;});
`;

function command(cwd, executable, args, env = environment) {
  const result = spawnSync(executable, args, { cwd, env, encoding: "utf8", windowsHide: true, timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error) throw result.error;
  return { executable, args, cwd: relative(cwd), exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
}
async function fixture(name) {
  const cwd = path.join(directory, name);
  const output = path.join(cwd, ".e2e/army/coverage");
  await mkdir(path.join(cwd, "scripts/tester-army"), { recursive: true });
  await writeFile(path.join(cwd, "scripts/run-tester-army.mjs"), runnerBytes);
  if (helperBytes) await writeFile(path.join(cwd, "scripts/tester-army/setup-failure-archive.mjs"), helperBytes);
  await cp(path.join(root, "scripts/tester-army/coverage-evidence.mjs"), path.join(cwd, "scripts/tester-army/coverage-evidence.mjs"));
  await writeFile(path.join(cwd, "scripts/tester-army/coverage-profile.mjs"), 'export async function loadCoverageProfile(){if(process.env.E2E_ARMY_BASE_URL?.startsWith("invalid-"))throw new Error("profile setup failed for password "+process.env.E2E_LOGIN_PASSWORD);return {env:{},metadata:{scenarioSet:"harness-only",fixture:{scope:"no business/auth"}},evidence:[]};}\n');
  await mkdir(path.join(cwd, "node_modules/@next/env"), { recursive: true });
  await writeFile(path.join(cwd, "node_modules/@next/env/index.js"), "module.exports={loadEnvConfig(){}};\n");
  await mkdir(path.join(cwd, "node_modules/e2e/dist/cli"), { recursive: true });
  await writeFile(path.join(cwd, "node_modules/e2e/dist/cli/bin.js"), fixtureCli);
  await mkdir(path.join(cwd, "e2e/army"), { recursive: true });
  for (const file of ["e2e.config.ts", "next.config.ts", "tsconfig.json", "package.json", "package-lock.json"]) await writeFile(path.join(cwd, file), file.endsWith(".json") ? "{}\n" : "export {};\n");
  await writeFile(path.join(cwd, ".gitignore"), ".e2e/\nnode_modules/\n");
  await mkdir(path.join(cwd, ".e2e/army/next"), { recursive: true });
  await mkdir(output, { recursive: true });
  for (const file of ["BUILD_ID", "required-server-files.json", "build-manifest.json"]) await writeFile(path.join(cwd, ".e2e/army/next", file), file === "BUILD_ID" ? "HARNESS\n" : "{}\n");
  const gitCommands = [["init", "--quiet", "--initial-branch=main"], ["add", "."], ["-c", "user.name=Setup Archive Harness", "-c", "user.email=harness@example.invalid", "commit", "--quiet", "-m", "test fixture only"]].map(args => command(cwd, "git", args));
  assert.ok(gitCommands.every(item => item.exitCode === 0), "ephemeral Git fixture must be captured");
  const outside = path.join(directory, `${name}-outside`);
  await mkdir(outside); await writeFile(path.join(outside, "app.log"), "outside-owner-bytes\n");
  return { cwd, output, outside, gitCommands };
}
async function execute(f, scenario, extras = {}) {
  const result = command(f.cwd, process.execPath, ["scripts/run-tester-army.mjs", "coverage"], { ...environment, E2E_LOGIN_EMAIL: "harness@example.invalid", E2E_LOGIN_PASSWORD: secret, NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon-key", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:45585", E2E_ALLOWED_SUPABASE_HOST: "127.0.0.1", HARNESS_SCENARIO: scenario, HARNESS_OUTSIDE: f.outside, ...extras });
  const invocation = `${scenario}-${randomUUID()}`;
  await writeFile(path.join(f.cwd, `${invocation}-stdout.log`), result.stdout);
  await writeFile(path.join(f.cwd, `${invocation}-stderr.log`), result.stderr);
  return { ...result, invocation, manifest: JSON.parse(await readFile(path.join(f.output, "manifest.json"), "utf8")) };
}
async function failures(f) { return (await readdir(path.join(f.output, "runs")).catch(error => { if (error.code === "ENOENT") return []; throw error; })).filter(name => name.endsWith("-setup-failed")); }
async function allText(directory) { let text = ""; for (const entry of await readdir(directory, { withFileTypes: true })) { const file = path.join(directory, entry.name); assert.ok(!entry.isSymbolicLink(), "archive must not contain a link"); text += entry.isDirectory() ? await allText(file) : await readFile(file, "utf8"); } return text; }
async function failedManifest(f) {
  const names = await failures(f); assert.equal(names.length, 1, "failed setup must have its own immutable archive");
  const archive = path.join(f.output, "runs", names[0]);
  const manifest = JSON.parse(await readFile(path.join(archive, "manifest.json"), "utf8"));
  assert.equal(manifest.result.status, "evidence_unavailable"); assert.notEqual(manifest.result.exitCode, 0);
  assert.equal(manifest.report, undefined); assert.equal(manifest.result.tests, undefined); assert.equal(manifest.result.summary, undefined);
  assert.equal(manifest.fixtures.authentication?.attempted, undefined, "no Auth execution can be inferred from an unavailable report");
  assert.ok(!(await readdir(archive)).includes("report.json")); assert.ok(!(await readdir(archive)).includes("artifacts"));
  for (const entry of manifest.failureEvidence.files) assert.equal(entry.sha256, digest(await readFile(path.join(f.cwd, entry.path))), "retained byte hashes must match");
  return { archive, manifest };
}
async function test(name, body) {
  const f = await fixture(name);
  try { await body(f); results.push({ name, status: "passed", directory: relative(f.cwd) }); }
  catch (error) { results.push({ name, status: "failed", directory: relative(f.cwd), error: error.message }); }
}

await test("absent-and-second-invocation", async f => {
  await mkdir(path.join(f.output, "logs")); await writeFile(path.join(f.output, "logs/app.log"), `PREVIOUS INVOCATION ${secret}\n`);
  const run = await execute(f, "missing"); assert.equal(run.exitCode, 1);
  const { archive, manifest } = await failedManifest(f); const before = await readFile(path.join(archive, "manifest.json"));
  assert.ok(manifest.failureEvidence.files.some(entry => entry.kind === "inputs" && entry.path.endsWith("source/scripts/run-tester-army.mjs")), "available nested source bytes must be retained");
  const text = await allText(archive); assert.ok(text.includes("setup stdout")); assert.ok(text.includes("setup stderr")); assert.ok(text.includes("CURRENT")); assert.ok(text.includes("current-network")); assert.ok(!text.includes("PREVIOUS INVOCATION")); assert.ok(!text.includes(secret)); assert.ok(!text.includes("opaque-current-token")); assert.ok(!text.includes("current-token"));
  assert.ok(!text.includes("11111111-2222-4333-8444-555555555555"), "nested serialized session identifiers must be removed");
  await execute(f, "no-logs"); assert.equal((await failures(f)).length, 2); assert.deepEqual(await readFile(path.join(archive, "manifest.json")), before);
  const large = await execute(f, "large-output"); assert.equal(large.exitCode, 1);
  const largeManifest = JSON.parse(await readFile(path.join(f.cwd, large.manifest.failureArchive.path, "manifest.json"), "utf8"));
  assert.equal(largeManifest.failureEvidence.runnerOutputTruncated, true, "real output above the cap must be declared truncated");
  const streams = largeManifest.failureEvidence.files.filter(entry => entry.kind.startsWith("runner-"));
  assert.ok(streams.reduce((sum, entry) => sum + entry.bytes, 0) <= 8 * 1024 * 1024, "retained runner output must stay bounded");
  const stdout = await readFile(path.join(f.cwd, streams.find(entry => entry.kind === "runner-stdout").path), "utf8");
  assert.ok(stdout.includes("current-line")); assert.ok(stdout.endsWith("\n")); assert.ok(!stdout.includes(secret));
});
await test("stale-report-and-artifacts", async f => {
  await writeFile(path.join(f.output, "report.json"), JSON.stringify({ run: { startedAt: "2000-01-01T00:00:00Z", results: [{ status: "passed", file: "auth.setup.e2e.ts" }] } }));
  await mkdir(path.join(f.output, "artifacts")); await writeFile(path.join(f.output, "artifacts/old.json"), '{"marker":"STALE-ARTIFACT"}');
  const run = await execute(f, "stale"); assert.equal(run.exitCode, 1); const { archive } = await failedManifest(f); assert.ok(!(await allText(archive)).includes("STALE-ARTIFACT"));
  const recentAt = new Date().toISOString();
  await writeFile(path.join(f.output, "report.json"), JSON.stringify({ run: { startedAt: recentAt, status: "passed", results: [{ status: "passed", file: "e2e/army/critical/auth.setup.e2e.ts", titlePath: ["STALE-RECENT-AUTH"], targetId: "chromium-desktop" }], summary: { discovered: 1, selected: 1, executed: 1, passed: 1, failed: 0, skipped: 0, flaky: 0 }, usage: { modelTokens: 0, maxModelCallsInStep: 0 } } }));
  const recent = await execute(f, "stale"); assert.equal(recent.exitCode, 1);
  assert.ok(Date.parse(recent.manifest.startedAt) - Date.parse(recentAt) < 1000, "recent stale report must exercise the existing one-second tolerance");
  assert.equal(recent.manifest.report, undefined, "unchanged recent report must not become current evidence");
  assert.equal(recent.manifest.fixtures.authentication?.attempted, undefined, "old recent authentication must never be inferred");
  assert.equal((await failures(f)).length, 2);
});
await test("missing-optional-proofs", async f => {
  await execute(f, "no-logs"); const { manifest } = await failedManifest(f); assert.ok(manifest.failureEvidence.unavailable.some(item => item.kind === "app-log")); assert.ok(manifest.failureEvidence.unavailable.some(item => item.kind === "network"));
});
await test("preflight-error-secret", async f => {
  const run = await execute(f, "no-logs", { E2E_ARMY_BASE_URL: `invalid-${secret}` }); assert.notEqual(run.exitCode, 0); const { archive } = await failedManifest(f); assert.ok(!(await allText(archive)).includes(secret)); assert.ok(!JSON.stringify(run.manifest).includes(secret));
});
await test("exclusive-existing-archive", async f => {
  const run = await execute(f, "collision"); const names = await failures(f); assert.equal(names.length, 1); assert.equal(await readFile(path.join(f.output, "runs", names[0], "manifest.json"), "utf8"), "existing-owner-bytes"); assert.equal(run.manifest.failureArchive.status, "unavailable"); assert.notEqual(run.exitCode, 0);
});
await test("destination-junction", async f => {
  const run = await execute(f, "destination-link"); assert.equal(run.manifest.failureArchive.status, "unavailable"); assert.deepEqual(await readdir(f.outside), ["app.log"]); assert.equal(await readFile(path.join(f.outside, "app.log"), "utf8"), "outside-owner-bytes\n");
});
await test("source-junction", async f => {
  await execute(f, "source-link"); const { archive, manifest } = await failedManifest(f); assert.ok(!(await allText(archive)).includes("outside-owner-bytes")); assert.ok(manifest.failureEvidence.unavailable.some(item => item.reason === "unsafe-path")); assert.equal(await readFile(path.join(f.outside, "app.log"), "utf8"), "outside-owner-bytes\n");
});
await test("application-log-junction", async f => {
  await symlink(f.outside, path.join(f.output, "logs"), "junction"); await execute(f, "log-link"); const { archive } = await failedManifest(f); assert.ok(!(await allText(archive)).includes("outside-owner-bytes")); assert.equal(await readFile(path.join(f.outside, "app.log"), "utf8"), "outside-owner-bytes\n");
});
await test("fresh-success-contract", async f => {
  const run = await execute(f, "fresh"); assert.equal(run.exitCode, 0); assert.equal(run.manifest.result.status, "passed"); assert.equal((await failures(f)).length, 0);
  const archived = JSON.parse(await readFile(path.join(f.cwd, run.manifest.archive.path, "manifest.json"), "utf8")); assert.equal(archived.report.sha256, digest(await readFile(path.join(f.cwd, archived.report.path)))); assert.equal(archived.result.summary.passed, 2); assert.ok(archived.artifacts.length > 0);
});
assert.deepEqual(await readFile(path.join(root, "scripts/run-tester-army.mjs")), workspaceRunnerBytes, "workspace runner must remain frozen during check");
if (helperBytes) assert.deepEqual(await readFile(helperPath), helperBytes, "helper must remain frozen during check");
const receipt = { schemaVersion: "miaouffrage-setup-archive-check-1", finishedAt: new Date().toISOString(), scope: "isolated real wrapper/child/filesystem; no browser, auth, database or product qualification", source: { baseline, runnerSha256: digest(runnerBytes), helperSha256: helperBytes ? digest(helperBytes) : null, fixtureCliSha256: digest(fixtureCli) }, directory: relative(directory), results, passed: results.filter(item => item.status === "passed").length, failed: results.filter(item => item.status === "failed").length };
const file = path.join(directory, "receipt.json"); const bytes = `${JSON.stringify(receipt, null, 2)}\n`; await writeFile(file, bytes, { flag: "wx" });
console.log(JSON.stringify({ receipt: relative(file), sha256: digest(bytes), passed: receipt.passed, failed: receipt.failed, failures: results.filter(item => item.status === "failed").map(({ name, error }) => ({ name, error })) }));
process.exitCode = receipt.failed ? 1 : 0;
