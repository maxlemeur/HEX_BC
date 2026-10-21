// Real offline CLI regression for the observed Windows/WSL esbuild mismatch.
// No SQL/Auth/HTTP/Storage/process-seed is invoked.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { repositoryRoot as root, ignoredFile, relativePath, sha256, requireValue, redactOutput } from "./local-recipe-common.mjs";

const args = process.argv.slice(2);
requireValue(process.platform === "win32" && /^v(?:24|26)\./.test(process.version) && args.length === 4 && args[0] === "--plan" && args[2] === "--distribution" &&
  /^[a-zA-Z0-9][a-zA-Z0-9.-]{1,60}$/.test(args[3]), "Use --plan <exact ignored plan> --distribution <explicit WSL distribution> from Windows Node 24 or 26; offline only.");
const planFile = await ignoredFile(args[1]), bytes = await readFile(planFile), plan = JSON.parse(bytes);
const nativeFile = await ignoredFile(plan.nativeRecipePath), native = JSON.parse(await readFile(nativeFile));
requireValue(sha256(await readFile(nativeFile)) === plan.nativeRecipeSha256, "Named native qualification SHA differs.");
const configFile = await ignoredFile(native.configPath), configBytes = await readFile(configFile), config = JSON.parse(configBytes);
requireValue(sha256(configBytes) === native.configSha256 && /^\/[a-zA-Z0-9_./-]+$/.test(config.nodePath), "Exact native Node path/configuration required.");
const directory = path.join(root, ".e2e/retro-runtime/cctp-plan-portability-checks", randomUUID()); await mkdir(directory, { recursive: true });
const env = { ...process.env };
for (const key of Object.keys(env)) if (/SUPABASE|^PG|DATABASE_URL|PASSWORD|SECRET|TOKEN|_KEY|^E2E_|PROXY|^NODE_OPTIONS$|^NODE_PATH$|^ESBUILD_BINARY_PATH$|^WSLENV$/i.test(key)) delete env[key];
const results = [];
async function run(name, platform, file, expectedRecords) {
  const args = ["scripts/tester-army/cctp-seed-plan.mjs", "--validate", "--plan", relativePath(file), "--plan-sha", sha256(await readFile(file))];
  const executable = platform === "windows" ? process.execPath : "wsl.exe";
  const command = platform === "windows" ? args : ["-d", process.argv[5], "--", config.nodePath, ...args];
  const child = spawnSync(executable, command, { cwd: root, env, windowsHide: true, encoding: "utf8", timeout: 60_000, maxBuffer: 1024 * 1024 });
  const log = `${redactOutput(child.stdout, process.env)}\n${redactOutput(child.stderr, process.env)}`;
  await writeFile(path.join(directory, `${name}.log`), log, { flag: "wx" });
  let parsed = null; try { parsed = JSON.parse(child.stdout); } catch { /* Absence is failure for the positive path. */ }
  const passed = expectedRecords ? child.status === 0 && parsed?.status === "validated-offline" && parsed.databaseAccess === false && isDeepStrictEqual(parsed.records, expectedRecords)
    : results.find((r) => r.name === "same-plan-linux")?.passed === true && child.status === 3 && /CCTP exact plan refused/.test(child.stderr);
  results.push({ name, platform, command: { executable, args: command }, exitCode: child.status, signal: child.signal,
    expected: expectedRecords ? "176 exact records, offline only" : "explicit refusal before backend access", passed, logSha256: sha256(log) });
}
await run("same-plan-windows", "windows", planFile, plan.records);
await run("same-plan-linux", "linux", planFile, plan.records);
const invalid = structuredClone(plan); invalid.scenarios[0].sources[0].storagePath = "outside/planned.pdf";
const invalidFile = path.join(directory, "invalid-path-plan.json"); await writeFile(invalidFile, JSON.stringify(invalid), { flag: "wx" });
await run("invalid-path-linux", "linux", invalidFile, null);
const receipt = { schemaVersion: "cctp-plan-portability-check-1", status: results.every((r) => r.passed) ? "passed" : "failed", createdAt: new Date().toISOString(),
  command: [process.execPath, ...process.argv.slice(1)], planPath: relativePath(planFile), planSha256: sha256(bytes), nativeNodePath: config.nodePath,
  configSha256: native.configSha256, databaseAccess: false, httpAccess: false, browserExecution: false, results,
  sources: await Promise.all(["scripts/tester-army/cctp-seed-plan.mjs", "src/lib/affaires/intake.ts", "scripts/tester-army/check-cctp-plan-portability.mjs"].map(async (file) => ({ path: file, sha256: sha256(await readFile(path.join(root, file))) }))),
  limits: ["Exact plan CLI portability and refusal only; no native SQL, Auth, Storage, seed or browser qualification.", "No runtime installation or historical ignored executable is used."] };
const file = path.join(directory, "receipt.json"); await writeFile(file, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: receipt.status, passed: results.filter((r) => r.passed).length, total: results.length, receipt: relativePath(file), sha256: sha256(await readFile(file)) }));
if (receipt.status !== "passed") process.exitCode = 3;
