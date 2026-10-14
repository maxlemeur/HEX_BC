import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// CLI refusal/discovery checks only. No ready fixture is invented or provisioned.
const root = fileURLToPath(new URL("../../", import.meta.url));
const proofArgument = process.argv[2];
if (process.argv.length !== 3 || !proofArgument?.startsWith(".e2e/")) throw new Error("Supply the exact existing local build manifest for the wrong-hash check.");
const proofFile = path.resolve(root, proofArgument);
if (!proofFile.startsWith(path.join(root, ".e2e") + path.sep)) throw new Error("Build proof must stay in this checkout.");
await readFile(proofFile);
const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
if (backend.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname)) throw new Error("Explicit existing local backend environment required.");
const directory = path.join(root, ".e2e/source-coverage/infrastructure-checks", `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
await mkdir(directory, { recursive: true });
const sha = (data) => createHash("sha256").update(data).digest("hex");
const rel = (file) => path.relative(root, file).replaceAll("\\", "/");
const base = { schemaVersion: "army-source-coverage-profile-1", scope: "source-coverage", approvalReference: "root-authorized-cli-refusal-and-discovery-only", serverMode: "production", backendOrigin: backend.origin, appOrigin: "http://localhost:3107", buildProofPath: proofArgument, buildProofSha256: "0".repeat(64) };
const profile = async (name, data) => { const file = path.join(directory, name); await writeFile(file, JSON.stringify(data, null, 2) + "\n", { flag: "wx" }); return rel(file); };
const remoteProfile = await profile("remote-origin.json", { ...base, backendOrigin: "https://forbidden.example.invalid" });
const wrongHashProfile = await profile("wrong-build-hash.json", base);
const discoveryProfile = await profile("discovery-only.json", { ...base, buildProofPath: undefined, buildProofSha256: undefined });
const env = { ...process.env, E2E_ARMY_BASE_URL: base.appOrigin, E2E_ALLOWED_SUPABASE_HOST: backend.hostname, GIT_OPTIONAL_LOCKS: "0" };
const git = spawnSync("git", ["-c", `safe.directory=${root}`, "rev-parse", "HEAD"], { cwd: root, env, encoding: "utf8", windowsHide: true });
if (git.status !== 0) throw new Error("Cannot record source revision.");
const checks = [];
const cases = [
  { name: "missing-profile", value: null, mode: "coverage", expected: "E2E_COVERAGE_PROFILE_PATH is required" },
  { name: "non-loopback-origin", value: remoteProfile, mode: "coverage", expected: "explicit loopback HTTP origin" },
  { name: "path-outside-checkout", value: "..", mode: "coverage", expected: "escaped its owned directory" },
  { name: "wrong-build-sha", value: wrongHashProfile, mode: "coverage", expected: "SHA-256 differs" },
  { name: "discovery-without-credentials", value: discoveryProfile, mode: "coverage-list", expected: null },
];
for (const entry of cases) {
  const childEnv = { ...env };
  if (entry.value) childEnv.E2E_COVERAGE_PROFILE_PATH = entry.value;
  else delete childEnv.E2E_COVERAGE_PROFILE_PATH;
  if (entry.mode === "coverage-list") for (const key of Object.keys(childEnv)) if (/PASSWORD|SERVICE_ROLE|ANON_KEY|E2E_.*EMAIL/.test(key)) delete childEnv[key];
  const args = ["scripts/run-tester-army.mjs", entry.mode];
  const result = spawnSync(process.execPath, args, { cwd: root, env: childEnv, encoding: "utf8", windowsHide: true, timeout: 90_000, maxBuffer: 8 * 1024 * 1024 });
  const safe = (value) => Object.entries(process.env).filter(([key, val]) => val && /PASSWORD|SERVICE_ROLE|ANON_KEY|E2E_.*EMAIL/.test(key)).reduce((text, [, secret]) => text.replaceAll(secret, "[REDACTED]"), value ?? "");
  const stdout = safe(result.stdout), stderr = safe(result.stderr);
  await writeFile(path.join(directory, `${entry.name}.stdout.log`), stdout, { flag: "wx" });
  await writeFile(path.join(directory, `${entry.name}.stderr.log`), stderr, { flag: "wx" });
  const manifestFile = path.join(root, ".e2e/army/coverage/manifest.json");
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  await copyFile(manifestFile, path.join(directory, `${entry.name}.manifest.json`));
  const passed = entry.expected
    ? result.status === 3 && manifest.result.status === "evidence_unavailable" && manifest.result.error.includes(entry.expected) && !manifest.report && !manifest.source.revision
    : result.status === 0 && manifest.result.status === "collected" && manifest.coverage.fixtureStage === "not-verified-discovery-only" && manifest.fixtures.credentials === "none" && !manifest.report && !manifest.productionBuild;
  if (entry.mode === "coverage-list" && manifest.discovery) await copyFile(path.resolve(root, manifest.discovery.path), path.join(directory, "discovery.json"));
  checks.push({ name: entry.name, command: { executable: process.execPath, args }, exitCode: result.status, signal: result.signal, passed, expected: entry.expected ?? "collected only, no credentials, ready fixture, server, browser or DB", actual: manifest.result, stdoutSha256: sha(stdout), stderrSha256: sha(stderr) });
  if (!passed) break;
}
const sources = ["scripts/run-tester-army.mjs", "scripts/tester-army/coverage-profile.mjs", "scripts/tester-army/coverage-evidence.mjs", "scripts/tester-army/coverage-network-guard.mjs", "e2e.config.ts", "e2e/army/local/source-coverage.e2e.ts", "e2e/army/local/source-coverage-support.ts"];
const receipt = { schemaVersion: "coverage-cli-checks-1", status: checks.length === cases.length && checks.every((entry) => entry.passed) ? "passed" : "failed", createdAt: new Date().toISOString(), node: process.version, platform: process.platform, revision: git.stdout.trim(), sources: await Promise.all(sources.map(async (file) => ({ path: file, sha256: sha(await readFile(path.join(root, file))) }))), checks, limits: ["CLI refusal and static collection only; no business fixture readiness, authentication, server, browser, DB or product qualification.", "No provisioning or local migration executed."] };
const body = JSON.stringify(receipt, null, 2) + "\n";
await writeFile(path.join(directory, "receipt.json"), body, { flag: "wx" });
await writeFile(path.join(directory, "receipt.json.sha256"), sha(body) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: receipt.status, path: rel(directory), checks: checks.map(({ name, passed, exitCode }) => ({ name, passed, exitCode })), sha256: sha(body) }));
if (receipt.status !== "passed") process.exitCode = 1;
