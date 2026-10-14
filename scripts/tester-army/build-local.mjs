// Production build recipe extracted from the qualified local campaign helper.
// Outputs remain ignored; no database, server or browser is started here.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, writeFile, copyFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { assertRecipeHost, buildCommands, buildSourceEvidence, loopbackOrigin, newEvidenceDirectory, redactOutput, relativePath, repositoryRoot as root, requireValue, sha256 } from "./local-recipe-common.mjs";

/** Immutable production output; dev, cache and compiler diagnostics are not runtime inputs. */
export async function buildOutputEvidence() {
  const directory = path.join(root, ".e2e/army/next");
  requireValue(path.relative(directory, await realpath(directory)) === "", "Production build directory must not be redirected.");
  const ignored = new Set(["cache", "dev", "diagnostics", "types", "trace", "trace-build"]);
  const inputs = [];
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      if (folder === directory && ignored.has(entry.name)) continue;
      // Next writes response-cache HTML/RSC here after next start serves a route.
      if (folder === path.join(directory, "server") && entry.name === "route-cache") continue;
      requireValue(!entry.isSymbolicLink(), "Production build output must not contain symlinks.");
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        const bytes = await readFile(file);
        inputs.push({ path: relativePath(file), bytes: bytes.length, sha256: sha256(bytes) });
      }
    }
  }
  await visit(directory);
  inputs.sort((left, right) => left.path.localeCompare(right.path, "en"));
  requireValue(["BUILD_ID", "required-server-files.json", "build-manifest.json"].every((name) =>
    inputs.some((input) => input.path === `.e2e/army/next/${name}`)) &&
    ["server/", "static/"].every((prefix) => inputs.some((input) => input.path.startsWith(`.e2e/army/next/${prefix}`))),
  "Complete production server/static output is required.");
  return { distDir: ".e2e/army/next", inputs, digest: sha256(JSON.stringify(inputs)) };
}

/** Offer startup configuration is additional to the shared application build closure. */
export async function offerBuildProfileEvidence() {
  return Promise.all([".nvmrc", "e2e.offer.config.ts", "e2e/army/local/offer-emission.config.ts"].map(async (file) =>
    ({ path: file, sha256: sha256(await readFile(path.join(root, file))) })));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.join() === "--help") {
    console.log("node --env-file=<explicit-local-backend.env> scripts/tester-army/build-local.mjs --execute | --validate-only. OpenAPI, isolated Webpack build and existing performance budgets; output is ignored.");
    return;
  }
  assertRecipeHost();
  requireValue(args.length === 1 && ["--execute", "--validate-only"].includes(args[0]), "Explicit --execute or --validate-only is required.");
  const backend = loopbackOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL);
  requireValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() && process.env.E2E_ALLOWED_SUPABASE_HOST === backend.hostname,
    "Explicit local backend env and allowed host are required; no env-file fallback.");
  const source = await buildSourceEvidence(), inputs = source.inputs;
  const offerProfileInputs = await offerBuildProfileEvidence();
  if (args[0] === "--validate-only") {
    console.log(JSON.stringify({ status: "validated-offline", backend: backend.origin, inputCount: inputs.length, buildExecuted: false }));
    return;
  }
  const directory = await newEvidenceDirectory("army/recipes/builds", `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`);
  await mkdir(path.join(root, ".e2e/army"), { recursive: true });
  await writeFile(path.join(root, ".e2e/army/tsconfig.json"), JSON.stringify({ extends: "../../tsconfig.json",
    compilerOptions: { paths: { "@/*": ["../../src/*"] } },
    include: ["../../next-env.d.ts", "../../src/**/*.ts", "../../src/**/*.tsx", "next/types/**/*.ts", "next/dev/types/**/*.ts"], exclude: ["../../node_modules"] }, null, 2) + "\n");
  const manifest = { schemaVersion: "army-local-build-1", startedAt: new Date().toISOString(),
    revision: source.revision, diffSha256: source.diffSha256,
    command: { executable: process.execPath, args: process.argv.slice(1) }, inputs, offerProfileInputs, backend: backend.origin,
    node: process.version, platform: process.platform, steps: [] };
  const env = { ...process.env, E2E_ARMY: "1", PERFORMANCE_BUILD_DIR: ".e2e/army/next", NEXT_TELEMETRY_DISABLED: "1" };
  let log = "", exitCode = 0;
  for (const commandArgs of buildCommands) {
    const result = spawnSync(process.execPath, commandArgs, { cwd: root, env, windowsHide: true,
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
    log += redactOutput(`${result.stdout ?? ""}\n${result.stderr ?? ""}`, env);
    manifest.steps.push({ args: commandArgs, exitCode: result.status, signal: result.signal });
    if (result.status !== 0) { exitCode = result.status ?? 1; break; }
  }
  manifest.finishedAt = new Date().toISOString();
  const sourceAfter = await buildSourceEvidence();
  manifest.inputsAfter = sourceAfter.inputs;
  manifest.offerProfileInputsAfter = await offerBuildProfileEvidence();
  manifest.sourceChangedDuringBuild = !isDeepStrictEqual(source, sourceAfter) ||
    !isDeepStrictEqual(offerProfileInputs, manifest.offerProfileInputsAfter);
  manifest.logSha256 = sha256(log);
  if (exitCode === 0) {
    manifest.buildId = (await readFile(path.join(root, ".e2e/army/next/BUILD_ID"), "utf8")).trim();
    manifest.compiledOutput = await buildOutputEvidence();
  }
  await writeFile(path.join(directory, "build.log"), log, { flag: "wx" });
  await copyFile(fileURLToPath(import.meta.url), path.join(directory, "build-local.mjs"));
  await copyFile(path.join(root, "scripts/tester-army/local-recipe-common.mjs"), path.join(directory, "local-recipe-common.mjs"));
  const bytes = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(path.join(directory, "manifest.json"), bytes, { flag: "wx" });
  console.log(JSON.stringify({ status: exitCode === 0 && !manifest.sourceChangedDuringBuild ? "built" : "failed",
    manifest: relativePath(path.join(directory, "manifest.json")), sha256: sha256(bytes), buildId: manifest.buildId,
    exitCode, sourceChangedDuringBuild: manifest.sourceChangedDuringBuild }));
  process.exitCode = manifest.sourceChangedDuringBuild ? 1 : exitCode;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(redactOutput(error.message)); process.exitCode = 3; });
}
