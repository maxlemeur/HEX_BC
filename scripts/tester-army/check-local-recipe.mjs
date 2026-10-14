// These configuration failures were defined before the recipe implementation.
// Only offline CLI entry points run; no native stack, Auth or browser is used.
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.join(root, ".e2e/retro-runtime/checks", randomUUID());
await mkdir(output, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const rel = (file) => path.relative(root, file).replaceAll("\\", "/");
const base = {
  schemaVersion: "army-local-recipe-1", campaign: "offline-contract",
  approvalReference: "offline-configuration-check-only",
  backendOrigin: "http://127.0.0.1:45001", appOrigin: "http://localhost:3107",
  native: { configPath: ".e2e/absent-native-config.json", configSha256: "0".repeat(64),
    nodePath: "/usr/bin/node", distribution: "Ubuntu-24.04" },
  owner: { userId: "a1111111-1111-4111-8111-111111111111", tenantId: "a2222222-2222-4222-8222-222222222222",
    membershipId: "a3333333-3333-4333-8333-333333333333", laborRoleId: "a4444444-4444-4444-8444-444444444444" },
};
const cases = [
  { name: "recipe-help", args: ["scripts/tester-army/local-recipe.mjs", "--help"], expected: 0, text: "plan" },
  { name: "build-help", args: ["scripts/tester-army/build-local.mjs", "--help"], expected: 0, text: "--execute" },
  { name: "missing-config", args: ["scripts/tester-army/local-recipe.mjs", "plan"], expected: 3, text: "Explicit --config" },
  { name: "remote-origin", config: { ...base, backendOrigin: "https://example.invalid" }, expected: 3, text: "loopback" },
  { name: "app-hydration-origin", config: { ...base, appOrigin: "http://127.0.0.1:3107" }, expected: 3, text: "localhost" },
  { name: "secret-metadata", config: { ...base, password: "synthetic-forbidden-config-value" }, expected: 3, text: "non-secret" },
  { name: "incomplete-native-pair", config: { ...base, native: { ...base.native, configSha256: undefined } }, expected: 3, text: "SHA-256" },
  { name: "outside-owned-config", args: ["scripts/tester-army/local-recipe.mjs", "plan", "--config", "package.json"], expected: 3, text: "ignored" },
  { name: "unknown-stage", args: ["scripts/tester-army/local-recipe.mjs", "repair", "--config", "unused"], expected: 3, text: "Unknown" },
];
const env = { ...process.env };
for (const key of Object.keys(env)) if (/SUPABASE|^PG|DATABASE_URL|PASSWORD|SECRET|TOKEN|_KEY|^E2E_|PROXY/i.test(key)) delete env[key];
const checks = [];
for (const entry of cases) {
  let args = entry.args;
  if (entry.config) {
    const file = path.join(output, `${entry.name}.json`);
    await writeFile(file, JSON.stringify(entry.config, null, 2) + "\n", { flag: "wx" });
    args = ["scripts/tester-army/local-recipe.mjs", "plan", "--config", rel(file)];
  }
  const result = spawnSync(process.execPath, args, { cwd: root, env, windowsHide: true,
    encoding: "utf8", timeout: 20_000, maxBuffer: 1024 * 1024 });
  const outputText = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  await writeFile(path.join(output, `${entry.name}.log`), outputText, { flag: "wx" });
  checks.push({ name: entry.name, command: { executable: process.execPath, args },
    exitCode: result.status, signal: result.signal, expectedExitCode: entry.expected,
    expectedMessage: entry.text, passed: result.status === entry.expected && outputText.includes(entry.text),
    outputSha256: hash(outputText) });
}
// Optional actual historical profiles are explicit input, never a hardcoded
// prerequisite. This exercises the real loader without contacting the backend.
const historicalArgs = process.argv.slice(2);
for (let index = 0; index < historicalArgs.length; index += 2) {
  if (historicalArgs[index] !== "--historical-profile" || !historicalArgs[index + 1]?.startsWith(".e2e/")) throw new Error("Use --historical-profile <explicit-owned-profile> pairs only.");
  const profile = historicalArgs[index + 1];
  const code = 'import {loadCoverageProfile} from "./scripts/tester-army/coverage-profile.mjs"; const value=await loadCoverageProfile(process.cwd(),{configuredPath:process.argv[1]}); console.log(JSON.stringify({status:"profile-loaded-offline",scenarioSet:value.metadata.scenarioSet,evidenceCount:value.evidence.length,databaseAccess:false}));';
  const args = ["--input-type=module", "-e", code, profile];
  const result = spawnSync(process.execPath, args, { cwd: root, env: process.env, windowsHide: true, encoding: "utf8", timeout: 45_000, maxBuffer: 1024 * 1024 });
  const outputText = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  const name = `historical-profile-${index / 2}`;
  await writeFile(path.join(output, `${name}.log`), outputText, { flag: "wx" });
  checks.push({ name, profile, profileSha256: hash(await readFile(path.join(root, profile))),
    command: { executable: process.execPath, args }, exitCode: result.status, expectedExitCode: 0,
    passed: result.status === 0 && outputText.includes('"status":"profile-loaded-offline"'), outputSha256: hash(outputText) });
}
const receipt = { schemaVersion: "army-local-recipe-offline-checks-1", status: checks.every((c) => c.passed) ? "passed" : "failed",
  createdAt: new Date().toISOString(), node: process.version, platform: process.platform,
  command: { executable: process.execPath, args: process.argv.slice(1) }, readerSha256: hash(await readFile(fileURLToPath(import.meta.url))),
  checks, limits: ["Offline CLI refusals only; no database, Auth, seed, build, browser or business qualification."] };
const bytes = JSON.stringify(receipt, null, 2) + "\n";
await writeFile(path.join(output, "receipt.json"), bytes, { flag: "wx" });
console.log(JSON.stringify({ status: receipt.status, receipt: rel(path.join(output, "receipt.json")), sha256: hash(bytes),
  checks: checks.map(({ name, passed }) => ({ name, passed })) }));
if (receipt.status !== "passed") process.exitCode = 1;
