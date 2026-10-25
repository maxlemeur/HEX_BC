import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LOCAL_JOURNEY_COLLECTORS, LOCAL_JOURNEYS_OUTSIDE_SELECTIONS } from "./journey-preflight.mjs";

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
// What the fixture CLI plants in the 0.20 app log, navigation events and trace page.
const browserLeaks = ["aGFybmVzcy1zaWduYXR1cmU", "eyJzdWIiOiJoYXJuZXNz", "opaque-console-token", "pkce-harness-secret", "hash-harness-secret", "refresh-harness-secret", "json-harness-secret", secret, "current-token", "harness@example.invalid", "signed-download-harness-token"];
const results = [];

// Mirrors the e2e 0.20 output layout: the SDK empties results/ when tests start,
// files each test under results/<file>-<title>-<id16>/ (attempt-<n>/ evidence,
// trace.md beside it) and never touches the journeys' artifacts/.
const fixtureCli = `
const fs = require("node:fs/promises");
const path = require("node:path");
(async () => {
  const critical = process.env.E2E_ARMY_SUITE === "critical";
  const output = path.join(process.cwd(), ".e2e/army", critical ? "critical" : "coverage");
  if (process.argv[2] === "list") { process.stdout.write(JSON.stringify({pairs:[]})); return; }
  const manifest = JSON.parse(await fs.readFile(path.join(output,"manifest.json"),"utf8"));
  const scenario = process.env.HARNESS_SCENARIO;
  if (process.env.HARNESS_CORPUS_CHANGE) await fs.appendFile(path.join(process.cwd(),process.env.HARNESS_CORPUS_CHANGE),"\\n");
  if (scenario === "collision") {
    const archive = path.join(output,"runs",manifest.startedAt.replace(/[:.]/g,"-")+"-setup-failed");
    await fs.mkdir(archive,{recursive:true}); await fs.writeFile(path.join(archive,"manifest.json"),"existing-owner-bytes");
  }
  if (scenario === "destination-link") await fs.symlink(process.env.HARNESS_OUTSIDE,path.join(output,"runs"),"junction");
  if (scenario === "source-link") await fs.symlink(process.env.HARNESS_OUTSIDE,path.join(output,"profile-"+manifest.startedAt.replace(/[:.]/g,"-"),"foreign"),"junction");
  if (!["no-logs","source-link","destination-link","log-link"].includes(scenario)) {
    await fs.mkdir(path.join(output,"logs"),{recursive:true});
    await fs.appendFile(path.join(output,"logs/app.log"),"CURRENT "+process.env.E2E_LOGIN_PASSWORD+" Bearer arbitrary-token?token=current-token\\n");
    if (process.env.E2E_COVERAGE_NETWORK_LOG) await fs.writeFile(process.env.E2E_COVERAGE_NETWORK_LOG,JSON.stringify({kind:critical ? "guard-installed" : "current-network",password:process.env.E2E_LOGIN_PASSWORD})+"\\n");
  }
  process.stdout.write("setup stdout "+process.env.E2E_LOGIN_PASSWORD+"\\n");
  process.stdout.write(JSON.stringify({details:JSON.stringify({session_id:"11111111-2222-4333-8444-555555555555"})})+"\\n");
  process.stderr.write("setup stderr Bearer opaque-current-token\\n");
  if (scenario === "large-output") process.stdout.write("current-line\\n".repeat(900000));
  if (scenario === "fresh" || scenario.startsWith("critical-") || scenario === "coverage-leaks") {
    const sdk = path.join(output,"results");
    if (path.resolve(process.env.E2E_ARMY_ARTIFACT_ROOT || ".") !== sdk) { process.exitCode=4; return; }
    await fs.rm(sdk,{recursive:true,force:true});
    const attempt = async (segment) => { const dir = path.join(sdk,segment,"attempt-1"); await fs.mkdir(dir,{recursive:true}); return dir; };
    const at = new Date().toISOString();
    if (scenario === "fresh") {
      const results=[{file:"e2e/army/critical/auth.setup.e2e.ts",titlePath:["fixture auth report"],targetId:"chromium-desktop",status:"passed"},{file:"e2e/army/local/fixture.e2e.ts",titlePath:["fixture business report"],targetId:"chromium-desktop",status:"passed"}];
      await attempt("auth-setup-fixture-auth-report-0000000000000001");
      const business = await attempt("fixture-fixture-business-report-0000000000000002");
      await fs.mkdir(path.join(business,"downloads")); await fs.writeFile(path.join(business,"downloads/001-export.xlsx"),"PK harness-only download\\n");
      await fs.mkdir(path.join(output,"artifacts/business"),{recursive:true}); await fs.writeFile(path.join(output,"artifacts/business/ARMY-HARNESS-current.json"),"{\\"scope\\":\\"harness-only\\"}\\n");
      await fs.writeFile(path.join(output,"report.json"),JSON.stringify({run:{startedAt:at,status:"passed",results,summary:{discovered:2,selected:2,executed:2,passed:2,failed:0,interrupted:0,skipped:0,flaky:0},usage:{modelTokens:0,maxModelCallsInStep:0}}},null,2)+"\\n");
      return;
    }
    // Synthetic values only: what the 0.20 app log and navigation events can carry.
    const leaks = [
      "GET http://127.0.0.1:45585/storage/v1/object/sign/x?token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYXJuZXNzLWZ1bGwifQ.aGFybmVzcy1zaWduYXR1cmU 400",
      "console cut eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYXJuZXNzLWN1dA",
      "console Authorization: Bearer opaque-console-token",
      "GET http://localhost:3107/auth/callback?code=pkce-harness-secret&next=/ 500",
      "navigated to http://localhost:3107/auth#access_token=hash-harness-secret&refresh_token=refresh-harness-secret",
      "console "+JSON.stringify({refresh_token:"json-harness-secret"}),
      "console password "+process.env.E2E_LOGIN_PASSWORD,
    ];
    const appLog = leaks.map((text) => ({source:"console",level:"error",text,at}));
    const steps = [{events:[{kind:"navigation",text:leaks[4]}]}];
    const tests=[["e2e/army/critical/auth.setup.e2e.ts","authenticate","auth-setup-authenticate-0000000000000011"],["e2e/army/critical/access-boundaries.e2e.ts","access boundaries","access-boundaries-access-boundaries-0000000000000012"],["e2e/army/critical/estimate-integrity.e2e.ts","business","estimate-integrity-business-0000000000000013"]];
    const results=tests.map(([file,title]) => ({file,titlePath:[title],targetId:"chromium-desktop",status:"passed",attempts:[{index:0,status:"passed",steps,appLog,artifacts:[]}]}));
    for (const [, , segment] of tests) await attempt(segment);
    // SDK 0.21 failure snapshots can contain the visible account identifier
    // even with authenticated traces off (observed in candidate-1).
    await fs.writeFile(path.join(sdk,"estimate-integrity-business-0000000000000013","attempt-1","screen-at-failure.txt"),"Visible account "+process.env.E2E_LOGIN_EMAIL+"\\n"+leaks.join("\\n")+"\\n");
    await fs.mkdir(path.join(output,"artifacts/business"),{recursive:true});
    await fs.writeFile(path.join(output,"artifacts/business/download-proof.json"),JSON.stringify({download_url:"http://127.0.0.1/storage/v1/object/sign/pdf?token=signed-download-harness-token",expectedCents:101,account:process.env.E2E_LOGIN_EMAIL})+"\\n");
    // Coverage keeps trace "off": its report.json still carries the app log.
    if (critical && scenario !== "critical-no-trace") await fs.writeFile(path.join(sdk,"access-boundaries-access-boundaries-0000000000000012","trace.md"),"# access boundaries\\n\\n"+leaks.map((line) => "- "+line).join("\\n")+"\\n");
    await fs.writeFile(path.join(output,"report.json"),JSON.stringify({run:{startedAt:at,status:"passed",results,summary:{discovered:3,selected:3,executed:3,passed:3,failed:0,interrupted:0,skipped:0,flaky:0},usage:{modelTokens:0,maxModelCallsInStep:0}}},null,2)+"\\n");
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
  await cp(path.join(root, "scripts/tester-army/local-recipe-common.mjs"), path.join(cwd, "scripts/tester-army/local-recipe-common.mjs"));
  await cp(path.join(root, "scripts/tester-army/shared-write-guard.mjs"), path.join(cwd, "scripts/tester-army/shared-write-guard.mjs"));
  await writeFile(path.join(cwd, "scripts/tester-army/coverage-profile.mjs"), 'export async function loadCoverageProfile(){if(process.env.E2E_ARMY_BASE_URL?.startsWith("invalid-"))throw new Error("profile setup failed for password "+process.env.E2E_LOGIN_PASSWORD);return {env:{},metadata:{scenarioSet:"harness-only",fixture:{scope:"no business/auth"}},evidence:[]};}\n');
  await mkdir(path.join(cwd, "node_modules/@next/env"), { recursive: true });
  await writeFile(path.join(cwd, "node_modules/@next/env/index.js"), "module.exports={loadEnvConfig(){}};\n");
  await mkdir(path.join(cwd, "node_modules/e2e/dist/cli"), { recursive: true });
  await writeFile(path.join(cwd, "node_modules/e2e/dist/cli/bin.js"), fixtureCli);
  await mkdir(path.join(cwd, "e2e/army"), { recursive: true });
  for (const file of ["e2e.config.ts", "next.config.ts", "tsconfig.json", "package.json", "package-lock.json"]) await writeFile(path.join(cwd, file), file.endsWith(".json") ? "{}\n" : "export {};\n");
  // The real wrapper imports and executes the journey preflight before setup.
  // Mount its actual collectors and documented exclusions; the fixture CLI
  // still owns all test execution, without a browser or backend.
  const preflightInputs = new Set(["scripts/tester-army/journey-files.mjs", "scripts/tester-army/journey-preflight.mjs",
    ...LOCAL_JOURNEY_COLLECTORS, ...Object.entries(LOCAL_JOURNEYS_OUTSIDE_SELECTIONS).flat()]);
  for (const file of preflightInputs) {
    await mkdir(path.dirname(path.join(cwd, file)), { recursive: true });
    await cp(path.join(root, file), path.join(cwd, file));
  }
  await writeFile(path.join(cwd, ".gitignore"), ".e2e/\nnode_modules/\n");
  await mkdir(path.join(cwd, ".e2e/army/next"), { recursive: true });
  await mkdir(output, { recursive: true });
  for (const file of ["BUILD_ID", "required-server-files.json", "build-manifest.json"]) await writeFile(path.join(cwd, ".e2e/army/next", file), file === "BUILD_ID" ? "HARNESS\n" : "{}\n");
  const gitCommands = [["init", "--quiet", "--initial-branch=main"], ["add", "."], ["-c", "user.name=Setup Archive Harness", "-c", "user.email=harness@example.invalid", "commit", "--quiet", "-m", "test fixture only"]].map(args => command(cwd, "git", args));
  assert.ok(gitCommands.every(item => item.exitCode === 0), "ephemeral Git fixture must be captured");
  await cp(path.join(root, "scripts/tester-army/business-corpus-selection.ts"),
    path.join(cwd, "scripts/tester-army/business-corpus-selection.ts"));
  const outside = path.join(directory, `${name}-outside`);
  await mkdir(outside); await writeFile(path.join(outside, "app.log"), "outside-owner-bytes\n");
  return { cwd, output, outside, gitCommands };
}
async function execute(f, scenario, extras = {}, mode = "coverage") {
  const result = command(f.cwd, process.execPath, ["scripts/run-tester-army.mjs", mode], { ...environment, E2E_LOGIN_EMAIL: "harness@example.invalid", E2E_LOGIN_PASSWORD: secret, NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon-key", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:45585", E2E_ALLOWED_SUPABASE_HOST: "127.0.0.1", HARNESS_SCENARIO: scenario, HARNESS_OUTSIDE: f.outside, ...extras });
  const invocation = `${scenario}-${randomUUID()}`;
  await writeFile(path.join(f.cwd, `${invocation}-stdout.log`), result.stdout);
  await writeFile(path.join(f.cwd, `${invocation}-stderr.log`), result.stderr);
  const output = mode.startsWith("critical") ? path.join(f.cwd, ".e2e/army/critical") : f.output;
  return { ...result, invocation, manifest: JSON.parse(await readFile(path.join(output, "manifest.json"), "utf8")) };
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
  assert.ok(!(await readdir(archive)).includes("report.json")); assert.ok(!(await readdir(archive)).includes("artifacts")); assert.ok(!(await readdir(archive)).includes("results"));
  assert.equal(manifest.evidenceRoots, undefined); assert.equal(manifest.artifacts, undefined); assert.equal(manifest.tracePaths, undefined);
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
  const oldResult = path.join(f.output, "results/old-test-0000000000000000");
  await mkdir(path.join(oldResult, "attempt-1"), { recursive: true }); await writeFile(path.join(oldResult, "attempt-1/old.json"), '{"marker":"STALE-RESULT"}'); await writeFile(path.join(oldResult, "trace.md"), "STALE-TRACE\n");
  const run = await execute(f, "stale"); assert.equal(run.exitCode, 1); const { archive } = await failedManifest(f); const staleText = await allText(archive);
  for (const marker of ["STALE-ARTIFACT", "STALE-RESULT", "STALE-TRACE"]) assert.ok(!staleText.includes(marker), `${marker} must not become this run's evidence`);
  assert.equal(run.manifest.artifacts, undefined); assert.equal(run.manifest.tracePaths, undefined);
  await assert.rejects(readFile(path.join(f.output, "artifacts/old.json")), { code: "ENOENT" }, "business evidence is cleared before a non-discovery run");
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
  await mkdir(path.join(f.output, "artifacts/business"), { recursive: true }); await writeFile(path.join(f.output, "artifacts/business/ARMY-OLD-stale.json"), '{"marker":"STALE-BUSINESS"}\n');
  const run = await execute(f, "fresh"); assert.equal(run.exitCode, 0, run.stderr); assert.equal(run.manifest.result.status, "passed"); assert.equal((await failures(f)).length, 0);
  const archiveDirectory = path.join(f.cwd, run.manifest.archive.path);
  const archived = JSON.parse(await readFile(path.join(archiveDirectory, "manifest.json"), "utf8")); assert.equal(archived.report.sha256, digest(await readFile(path.join(f.cwd, archived.report.path)))); assert.equal(archived.result.summary.passed, 2);
  assert.deepEqual(run.manifest.evidenceRoots, { sdk: ".e2e/army/coverage/results", business: ".e2e/army/coverage/artifacts" });
  assert.deepEqual(run.manifest.artifacts.map(entry => entry.path), [".e2e/army/coverage/results/fixture-fixture-business-report-0000000000000002/attempt-1/downloads/001-export.xlsx", ".e2e/army/coverage/artifacts/business/ARMY-HARNESS-current.json"], "SDK results and this run's business evidence only");
  assert.deepEqual(run.manifest.tracePaths, []);
  assert.deepEqual(archived.evidenceRoots, { sdk: `${run.manifest.archive.path}/results`, business: `${run.manifest.archive.path}/artifacts` });
  for (const entry of archived.artifacts) assert.equal(entry.sha256, digest(await readFile(path.join(f.cwd, entry.path))), "archived evidence must match its fingerprint");
  assert.ok(!(await allText(archiveDirectory)).includes("STALE-BUSINESS"));
});
await test("critical-results-layout-and-scrub", async f => {
  const output = path.join(f.cwd, ".e2e/army/critical");
  await mkdir(path.join(output, "artifacts/chromium-desktop/old/trace"), { recursive: true }); await writeFile(path.join(output, "artifacts/chromium-desktop/old/trace/trace.zip"), "STALE-ZIP");
  const leaks = [...browserLeaks, "STALE-ZIP"];
  const clean = (text, label) => { for (const leak of leaks) assert.ok(!text.includes(leak), `${label} must not retain ${leak.slice(0, 12)}`); };
  const run = await execute(f, "critical-fresh", {}, "critical"); assert.equal(run.exitCode, 0, run.stderr); assert.equal(run.manifest.result.status, "passed");
  const trace = ".e2e/army/critical/results/access-boundaries-access-boundaries-0000000000000012/trace.md";
  const network = ".e2e/army/critical/artifacts/server-network.jsonl";
  assert.deepEqual(run.manifest.tracePaths, [trace]); assert.ok(run.manifest.artifacts.every(entry => entry.path.startsWith(".e2e/army/critical/results/") || entry.path.endsWith("artifacts/business/download-proof.json") || entry.path === network), "only current SDK and business proofs");
  const networkText = await readFile(path.join(f.cwd, network), "utf8");
  clean(networkText, "server network log");
  assert.ok(networkText.trim().split(/\r?\n/).map(line => JSON.parse(line)).some(entry => entry.kind === "guard-installed"), "the current server guard receipt is retained");
  const reportBytes = await readFile(path.join(output, "report.json")); assert.equal(run.manifest.report.sha256, digest(reportBytes), "the hash covers the scrubbed report");
  const report = JSON.parse(reportBytes.toString()); assert.equal(report.run.results.length, 3); assert.ok(report.run.results[1].attempts[0].appLog[0].text.includes("<redacted"));
  clean(reportBytes.toString(), "report.json"); clean(await readFile(path.join(f.cwd, trace), "utf8"), "trace.md");
  const screen = ".e2e/army/critical/results/estimate-integrity-business-0000000000000013/attempt-1/screen-at-failure.txt";
  clean(await readFile(path.join(f.cwd, screen), "utf8"), "screen-at-failure.txt");
  assert.ok(run.manifest.confidentiality.reportValuesRedacted > 0); assert.equal(run.manifest.confidentiality.tracePagesRewritten, 1);
  assert.equal(run.manifest.confidentiality.failureScreensRewritten, 1);
  const business = JSON.parse(await readFile(path.join(output, "artifacts/business/download-proof.json"), "utf8"));
  clean(JSON.stringify(business), "business JSON"); assert.equal(business.expectedCents, 101);
  const archiveDirectory = path.join(f.cwd, run.manifest.archive.path);
  assert.deepEqual((await readdir(archiveDirectory)).sort(), ["artifacts", "logs", "manifest.json", "report.json", "results"], "current business proofs are archived");
  clean(await allText(archiveDirectory), "archive");
  const archived = JSON.parse(await readFile(path.join(archiveDirectory, "manifest.json"), "utf8"));
  assert.deepEqual(archived.tracePaths, [`${run.manifest.archive.path}/results/access-boundaries-access-boundaries-0000000000000012/trace.md`]);
  for (const entry of archived.artifacts) assert.equal(entry.sha256, digest(await readFile(path.join(f.cwd, entry.path))), "archived evidence must match its fingerprint");
  await assert.rejects(readFile(path.join(output, "artifacts/chromium-desktop/old/trace/trace.zip")), { code: "ENOENT" });
  const missing = await execute(f, "critical-no-trace", {}, "critical"); assert.equal(missing.exitCode, 3); assert.equal(missing.manifest.result.status, "evidence_unavailable"); assert.match(missing.manifest.result.error, /did not retain their traces/);
});
await test("coverage-browser-scrub", async f => {
  const clean = (text, label) => { for (const leak of browserLeaks) assert.ok(!text.includes(leak), `${label} must not retain ${leak.slice(0, 12)}`); };
  const run = await execute(f, "coverage-leaks"); assert.equal(run.exitCode, 0, run.stderr); assert.equal(run.manifest.result.status, "passed");
  const reportBytes = await readFile(path.join(f.output, "report.json")); assert.equal(run.manifest.report.sha256, digest(reportBytes), "the hash covers the scrubbed report");
  clean(reportBytes.toString(), "coverage report.json"); assert.deepEqual(run.manifest.tracePaths, []);
  assert.equal(run.manifest.confidentiality.valuesRetained, false); assert.ok(run.manifest.confidentiality.browserEvidence.reportValuesRedacted > 0, "the 0.20 app-log rules must apply to coverage too");
  const archiveDirectory = path.join(f.cwd, run.manifest.archive.path); clean(await allText(archiveDirectory), "coverage archive");
  const archived = JSON.parse(await readFile(path.join(archiveDirectory, "manifest.json"), "utf8")); assert.equal(archived.report.sha256, digest(await readFile(path.join(f.cwd, archived.report.path))));
});
await test("list-keeps-business-evidence", async f => {
  await mkdir(path.join(f.output, "artifacts/business"), { recursive: true }); await writeFile(path.join(f.output, "artifacts/business/keep.json"), '{"marker":"KEEP-BUSINESS"}\n');
  const run = await execute(f, "list", {}, "coverage-list"); assert.equal(run.exitCode, 0, run.stderr); assert.equal(run.manifest.result.status, "collected");
  assert.equal(await readFile(path.join(f.output, "artifacts/business/keep.json"), "utf8"), '{"marker":"KEEP-BUSINESS"}\n', "discovery must not clear business evidence");
});
// A writing mode on a remote Supabase needs the per-run acknowledgement of its
// host (shared-write-guard.mjs); one that only a .env file supplies does not count.
await test("shared-write-refusal", async f => {
  const remote = { NEXT_PUBLIC_SUPABASE_URL: "https://shared-project.supabase.co", E2E_ALLOWED_SUPABASE_HOST: "shared-project.supabase.co" };
  const refused = await execute(f, "critical-fresh", remote, "critical");
  assert.notEqual(refused.exitCode, 0); assert.equal(refused.manifest.result.status, "evidence_unavailable");
  assert.match(refused.manifest.result.error, /E2E_ARMY_SHARED_WRITE_HOST=shared-project\.supabase\.co/); assert.equal(refused.manifest.report, undefined);
  await writeFile(path.join(f.cwd, "node_modules/@next/env/index.js"), 'module.exports={loadEnvConfig(){process.env.E2E_ARMY_SHARED_WRITE_HOST="shared-project.supabase.co";}};\n');
  const fromEnvFile = await execute(f, "critical-fresh", remote, "critical");
  assert.notEqual(fromEnvFile.exitCode, 0); assert.match(fromEnvFile.manifest.result.error, /never delete their data/);
});
// A browser cannot observe whether its wrapper records source changes. Copy a
// real public input after the fixture Git commit, then mutate it in the real
// child process: neither git diff nor the src/public untracked scan sees it.
for (const [label, file] of [
  ["business-ts", "e2e/fixtures/business/corpus.ts"],
  ["business-xlsx", "e2e/fixtures/business/optima-hydraulique-fictif.xlsx"],
  ["corpus-selection-ts", "scripts/tester-army/business-corpus-selection.ts"],
]) {
  await test(`changed-untracked-${label}`, async f => {
    const target = path.join(f.cwd, file);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.join(root, file), target);
    const before = await readFile(target);
    assert.notEqual(command(f.cwd, "git", ["ls-files", "--error-unmatch", file]).exitCode, 0, "the corpus input must be untracked");
    const run = await execute(f, "critical-fresh", { HARNESS_CORPUS_CHANGE: file }, "critical");
    const after = await readFile(target);
    assert.notDeepEqual(after, before, "the child must actually change this corpus input");
    assert.equal(run.manifest.source.changedDuringRun, true, "changed corpus inputs must invalidate native qualification");
    assert.equal(run.manifest.source.pilotInputs.find(entry => entry.path === file)?.sha256, digest(before));
    assert.equal(run.manifest.source.pilotInputsAfter.find(entry => entry.path === file)?.sha256, digest(after));
  });
}
assert.deepEqual(await readFile(path.join(root, "scripts/run-tester-army.mjs")), workspaceRunnerBytes, "workspace runner must remain frozen during check");
if (helperBytes) assert.deepEqual(await readFile(helperPath), helperBytes, "helper must remain frozen during check");
const receipt = { schemaVersion: "miaouffrage-setup-archive-check-1", finishedAt: new Date().toISOString(), scope: "isolated real wrapper/child/filesystem; no browser, auth, database or product qualification", source: { baseline, runnerSha256: digest(runnerBytes), helperSha256: helperBytes ? digest(helperBytes) : null, fixtureCliSha256: digest(fixtureCli) }, directory: relative(directory), results, passed: results.filter(item => item.status === "passed").length, failed: results.filter(item => item.status === "failed").length };
const file = path.join(directory, "receipt.json"); const bytes = `${JSON.stringify(receipt, null, 2)}\n`; await writeFile(file, bytes, { flag: "wx" });
console.log(JSON.stringify({ receipt: relative(file), sha256: digest(bytes), passed: receipt.passed, failed: receipt.failed, failures: results.filter(item => item.status === "failed").map(({ name, error }) => ({ name, error })) }));
process.exitCode = receipt.failed ? 1 : 0;
