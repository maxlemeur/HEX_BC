import { createHash, randomUUID } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { copyFile, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { sanitizeCoverageEvidence } from "./coverage-evidence.mjs";
import { COLLECTOR_SENTINEL, startCollector } from "./offer-collector.mjs";
import { probeOfferGuard } from "./check-offer-network-guard.mjs";
import { buildOutputEvidence, offerBuildProfileEvidence } from "./build-local.mjs";
import { assertRecipeHost, buildCommands, buildSourceEvidence, readProof, requireValue, sha256 } from "./local-recipe-common.mjs";
import { assertInstalledDependencies } from "./installed-dependencies.mjs";

// This runner owns new local-only evidence; it never seeds users, tokens or statuses.
const root = process.cwd();

export function offerServerMode() {
  const value = process.env.E2E_OFFER_SERVER_MODE ?? "dev";
  requireValue(value === "dev" || value === "production", "E2E_OFFER_SERVER_MODE must be dev or production.");
  return value;
}

/** Opt-in uses only a fresh, owned build manifest and its exact current compiled output. */
export async function validateOfferProductionBuild() {
  if (offerServerMode() !== "production") return null;
  assertRecipeHost();
  const manifestPath = process.env.E2E_OFFER_BUILD_MANIFEST;
  requireValue(typeof manifestPath === "string" && /^\.e2e\/army\/recipes\/builds\/[^/]+\/manifest\.json$/.test(manifestPath),
    "E2E_OFFER_BUILD_MANIFEST must name an owned recipes/builds manifest.");
  const proof = await readProof(manifestPath, process.env.E2E_OFFER_BUILD_MANIFEST_SHA256);
  const relativeBuild = path.relative(path.resolve(".e2e/army/recipes/builds"), proof.file);
  requireValue(!path.isAbsolute(relativeBuild) && !relativeBuild.startsWith(".."), "Production build manifest escaped recipes/builds.");
  const build = proof.data;
  requireValue(build.schemaVersion === "army-local-build-1" && build.sourceChangedDuringBuild === false &&
    build.backend === "http://127.0.0.1:45585" && process.env.NEXT_PUBLIC_SUPABASE_URL === build.backend &&
    build.platform === process.platform && build.node === process.version &&
    typeof build.buildId === "string" && build.buildId.length > 0 &&
    Array.isArray(build.steps) && build.steps.every((step) => step.exitCode === 0) &&
    isDeepStrictEqual(build.steps.map((step) => step.args), buildCommands),
  "Production offer requires an unchanged successful build for this exact local backend/runtime.");
  requireValue(build.compiledOutput?.distDir === ".e2e/army/next" &&
    Array.isArray(build.compiledOutput.inputs) && build.compiledOutput.inputs.length > 0 &&
    build.compiledOutput.digest === sha256(JSON.stringify(build.compiledOutput.inputs)),
  "Production offer requires a complete compiled-output closure; old manifests are refused.");
  const current = await buildSourceEvidence();
  const profile = await offerBuildProfileEvidence();
  requireValue(isDeepStrictEqual(build.inputs, current.inputs) && isDeepStrictEqual(build.inputsAfter, current.inputs) &&
    build.revision === current.revision && build.diffSha256 === current.diffSha256 &&
    isDeepStrictEqual(build.offerProfileInputs, profile) && isDeepStrictEqual(build.offerProfileInputsAfter, profile),
  "Production offer build sources differ from the current complete source closure.");
  requireValue(sha256(await readFile(path.join(path.dirname(proof.file), "build.log"))) === build.logSha256 &&
    (await readFile(".e2e/army/next/BUILD_ID", "utf8")).trim() === build.buildId,
  "Production offer build log or installed BUILD_ID differs from its manifest.");
  const output = await buildOutputEvidence();
  requireValue(isDeepStrictEqual(output, build.compiledOutput), "Production offer compiled output differs from its build closure.");
  const required = JSON.parse(await readFile(".e2e/army/next/required-server-files.json", "utf8"));
  requireValue(required.config?.distDir === ".e2e/army/next", "Production offer build must use the isolated Army dist directory.");
  return { manifest: manifestPath, sha256: proof.sha256, buildId: build.buildId,
    sourceDigest: sha256(JSON.stringify(current.inputs)), profileDigest: sha256(JSON.stringify(profile)), compiledOutputDigest: output.digest,
    compiledInputCount: output.inputs.length, distDir: output.distDir };
}

async function main() {
// These providers are unused in this deterministic recipe. Drop their inherited
// placeholder keys before redaction so their filenames stay reproducible.
delete process.env.LMSTUDIO_API_KEY;
delete process.env.OLLAMA_API_KEY;
const sha = (value) => createHash("sha256").update(value).digest("hex");
const relative = (file) => path.relative(root, file).replaceAll("\\", "/");
const git = (...args) => execFileSync("git", args, { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const mode = process.argv[2];
if (mode === "--validate-production-build") {
  requireValue(process.argv.length === 3 && offerServerMode() === "production", "Offline validation requires production mode and no selection.");
  const productionBuild = await validateOfferProductionBuild();
  console.log(JSON.stringify({ status: "validated-offline", serverMode: "production", productionBuild, appStarted: false, collectorStarted: false }));
  return;
}
const selection = process.argv[3] ?? "OF00";
if (!["--list", "--execute"].includes(mode) || !["OF00", "OF01", "OF02", "OF03", "OF04", "OF0L", "OF0[012]", "OF0[012L]", "OF0[01234L]", "PDFL1", "PDFL2", "PDFL3", "PDFL4", "PDFL5", "PDFL6", "PDFL7", "PDFL8", "PDFL[1-6]", "PDFL[1-7]", "PDFL[1-8]", "EF01", "EF02", "EF03", "EF04", "EF05", "NF02", "NF03", "NF04"].includes(selection)) {
  throw new Error("Use --list|--execute OF00|OF01|OF02|OF03|OF04|OF0L|OF0[01234L]|PDFL1…PDFL8|PDFL[1-8]|EF01|EF02|EF03|EF04|EF05|NF02|NF03|NF04.");
}
const toolchain = assertInstalledDependencies(root);
const selectedGrep = selection.startsWith("PDFL") || selection.startsWith("EF") || selection.startsWith("NF") ? `^${selection}(?:\\s|$)` : selection;
if (!["24", "26"].includes(process.versions.node.split(".")[0])) throw new Error("Node 24 or 26 required.");
if (git("branch", "--show-current").trim() !== "main") throw new Error("Existing main checkout required.");
const serverMode = offerServerMode();
const productionBuild = await validateOfferProductionBuild();
const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
if (backend.origin !== "http://127.0.0.1:45585" || backend.href !== `${backend.origin}/`) throw new Error("This authorized recipe targets the verified local API45585 only.");
if (!["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "E2E_LOGIN_EMAIL", "E2E_LOGIN_PASSWORD"].every((key) => process.env[key])) {
  throw new Error("Explicit local backend/account environment files required.");
}
if (!process.env.E2E_LOGIN_EMAIL.endsWith(".invalid")) throw new Error("Dedicated .invalid test account required.");
const appOrigin = "http://localhost:3176";
const sandboxTermsEnabled = process.env.E2E_OFFER_SANDBOX_TERMS === "1" && serverMode === "production" &&
  ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_TARGET_ENV"].every((name) => process.env[name] === undefined);
if (process.env.E2E_OFFER_SANDBOX_TERMS === "1" && !sandboxTermsEnabled) throw new Error("Sandbox draft terms require the explicit native production offer profile without hosting markers.");
const startedAt = new Date().toISOString();
const campaign = path.resolve(".e2e/army/offer/runs", `${startedAt.replace(/[:.]/g, "-")}-${randomUUID()}`);
const publicDirectory = path.join(campaign, "public");
await mkdir(publicDirectory, { recursive: true });
await mkdir(path.join(campaign, "private"));
const inputs = async () => {
  const names = git("ls-files", "-co", "--exclude-standard", "-z", "--", "src", "e2e", "scripts", "docs", "supabase", "public", "CONTEXT.md", "AGENTS.md", "e2e.config.ts", "e2e.offer.config.ts", "next.config.ts", "next-env.d.ts", "tsconfig.json", "openapi.json", "package.json", "package-lock.json", ".nvmrc").split("\0").filter(Boolean);
  names.push(...(await buildSourceEvidence()).inputs.filter((file) => !file.missing).map((file) => file.path));
  const files = [];
  for (const name of [...new Set(names)].sort()) {
    try { files.push({ path: name.replaceAll("\\", "/"), sha256: sha(await readFile(name)) }); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return { revision: git("rev-parse", "HEAD").trim(), status: git("status", "--short", "--branch").trim().split(/\r?\n/), diffSha256: sha(git("diff", "--binary")), files, digest: sha(JSON.stringify(files)) };
};
const before = await inputs();
await writeFile(path.join(publicDirectory, "source-before.json"), `${JSON.stringify(before, null, 2)}\n`);
const manifest = { schemaVersion: "local-offer-recipe-1", startedAt, mode, selection, node: process.version, toolchain,
  command: [process.execPath, ...process.execArgv.map((arg) => arg.startsWith("--env-file") ? "--env-file=[explicit-private-profile]" : arg), ...process.argv.slice(1)],
  environment: { appOrigin, backendOrigin: backend.origin, account: "ordinary dedicated local login; profile/roles unchanged", externalDelivery: false,
    serverMode, runtime: serverMode === "production" ? "owned exact production build; next start" : "webpack dev; not production-build proof",
    productionBuild, sandboxTerms: { enabled: sandboxTermsEnabled, fallbackSource: sandboxTermsEnabled ? "estimate-cgv-b2b-draft-v3" : null,
      fallbackLegallyReviewed: sandboxTermsEnabled ? false : null, qualification: "local-sandbox-only; active reviewed tenant template stays first" },
    trace: "off", retries: 0, workers: 1 },
  sourceBefore: { path: relative(path.join(publicDirectory, "source-before.json")), sha256: sha(await readFile(path.join(publicDirectory, "source-before.json"))), digest: before.digest },
  sourceArchive: { status: "not-frozen", files: 0 },
  result: { status: "preparing", exitCode: null }, artifacts: [] };
const persist = async () => writeFile(path.join(publicDirectory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await persist();
const sensitive = Object.entries(process.env).filter(([key, value]) => value && /(?:PASSWORD|API_KEY|SERVICE_ROLE_KEY|ANON_KEY)$/.test(key)).map(([, value]) => value);
const redact = (value) => {
  let text = value;
  for (const secret of sensitive) text = text.replaceAll(secret, "[REDACTED]");
  return text.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED-JWT]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/\/portal\/[0-9a-f-]{36}/gi, "/portal/[REDACTED]")
    .replace(/([?&](?:password|access_token|refresh_token|token|code|apikey|api_key)=)[^&\s"']*/gi, "$1[REDACTED]")
    .replace(/("(?:password|access_token|refresh_token|session_id|sessionId|draftLockSessionId)"\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2");
};
const walk = async (directory, includePrivate = false) => {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Symlink in owned evidence refused.");
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && (includePrivate || entry.name !== "private")) files.push(...await walk(file, includePrivate));
    else if (entry.isFile()) files.push(file);
  }
  return files;
};
let collector;
let output = "";
let exitCode = 1;
let runnerChild;
let interrupted = false;
let stopTimer;
const stopOwnedRunner = () => {
  interrupted = true;
  if (!runnerChild || runnerChild.exitCode !== null || runnerChild.signalCode !== null) return;
  if (process.platform === "win32" && runnerChild.pid) {
    // Windows kill signals do not provide a graceful Node shutdown. Stop the exact
    // process tree created above before its parent can exit and orphan Next.
    try { execFileSync("taskkill", ["/PID", String(runnerChild.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); }
    catch { /* Already exited; finally still archives the interrupted run. */ }
    return;
  }
  runnerChild.kill("SIGINT");
  stopTimer ??= setTimeout(() => {
    if (!runnerChild || runnerChild.exitCode !== null || runnerChild.signalCode !== null) return;
    if (process.platform === "win32") {
      try { execFileSync("taskkill", ["/PID", String(runnerChild.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" }); }
      catch { /* Already exited; finally still archives the interrupted run. */ }
    } else runnerChild.kill("SIGKILL");
  }, 20000);
};
process.on("SIGINT", stopOwnedRunner);
process.on("SIGTERM", stopOwnedRunner);
try {
  if (mode === "--execute") {
    const preflight = createServer();
    await new Promise((resolve, reject) => { preflight.once("error", reject); preflight.listen(3176, "localhost", resolve); });
    await new Promise((resolve, reject) => preflight.close((error) => error ? reject(error) : resolve()));
    const response = await fetch(`${backend.origin}/auth/v1/health`, { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Local Auth prerequisite not healthy.");
    const probe = await probeOfferGuard({ directory: path.join(campaign, "guard-probe"), appOrigin, backendOrigin: backend.origin });
    manifest.networkProbe = probe;
    await persist();
    if (probe.status !== "pass") throw new Error("Current offer server guard qualification missing.");
  }
  for (const file of before.files) {
    const bytes = await readFile(path.resolve(file.path));
    if (sha(bytes) !== file.sha256) throw new Error("Source changed while freezing local recipe inputs.");
    const target = path.join(campaign, "source-inputs", file.path);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  manifest.sourceArchive = { status: "complete", files: before.files.length };
  await persist();
  await mkdir(path.join(campaign, "collector"));
  collector = await startCollector({ directory: path.join(campaign, "collector") });
  manifest.environment.collectorOrigin = collector.origin;
  const env = { ...process.env, E2E_OFFER_SERVER_MODE: serverMode, E2E_ARMY_SUITE: "offer", E2E_ARMY_BASE_URL: appOrigin,
    E2E_OFFER_SANDBOX_TERMS: sandboxTermsEnabled ? "1" : "",
    E2E_OFFER_APP_ORIGIN: appOrigin, E2E_OFFER_BACKEND_ORIGIN: backend.origin,
    E2E_OFFER_COLLECTOR_ORIGIN: collector.origin, E2E_OFFER_COLLECTOR_DIRECTORY: collector.directory,
    E2E_OFFER_RUN_DIRECTORY: campaign, E2E_OFFER_SECRET_POINTER: path.join(campaign, "private/portal-pointer.json"),
    E2E_OFFER_NETWORK_LOG: path.join(publicDirectory, "server-network.jsonl"),
    RESEND_BASE_URL: collector.origin, RESEND_API_KEY: COLLECTOR_SENTINEL, EMAIL_FROM: "ARMY Local <offer@army.invalid>",
    NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL: "", NEXT_TELEMETRY_DISABLED: "1", E2E_TELEMETRY_DISABLED: "1",
    PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? "C:/Users/thann/AppData/Local/ms-playwright",
  };
  delete env.NODE_OPTIONS;
  delete env.LMSTUDIO_API_KEY;
  delete env.OLLAMA_API_KEY;
  const args = [path.resolve("node_modules/e2e/dist/cli/bin.js"), mode === "--execute" ? "run" : "list",
    "--config", "e2e.offer.config.ts", "--target", "chromium-desktop", "--grep", selectedGrep];
  if (mode === "--execute") args.push("--workers", "1", "--retries", "0", "--trace", "off", "--no-cache");
  manifest.runnerCommand = [process.execPath, ...args];
  if (interrupted) throw new Error("Local recipe interrupted before SDK start.");
  manifest.result.status = "running";
  await persist();
  console.log(JSON.stringify({ campaign: relative(campaign), mode, selection, collectorOrigin: collector.origin, externalDelivery: false }));
  exitCode = await new Promise((resolve, reject) => {
    runnerChild = spawn(process.execPath, args, { cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [runnerChild.stdout, runnerChild.stderr]) stream.on("data", (chunk) => { output += chunk.toString(); });
    runnerChild.once("error", reject);
    runnerChild.once("close", (code) => resolve(interrupted ? 130 : code ?? 1));
  });
  manifest.result.exitCode = exitCode;
  manifest.result.status = interrupted ? "interrupted-unqualified" : exitCode === 0 ? (mode === "--list" ? "collected-not-executed" : "runner-passed-unqualified") : "runner-failed";
} catch (error) {
  manifest.result.status = "setup-or-run-failed";
  manifest.result.exitCode = exitCode = interrupted ? 130 : 1;
  manifest.result.error = redact(error instanceof Error ? error.message : String(error));
} finally {
  clearTimeout(stopTimer);
  process.removeListener("SIGINT", stopOwnedRunner);
  process.removeListener("SIGTERM", stopOwnedRunner);
  await collector?.close();
  const after = await inputs();
  await writeFile(path.join(publicDirectory, "source-after.json"), `${JSON.stringify(after, null, 2)}\n`);
  manifest.sourceAfter = { path: relative(path.join(publicDirectory, "source-after.json")), sha256: sha(await readFile(path.join(publicDirectory, "source-after.json"))), digest: after.digest };
  manifest.sourceChanged = before.digest !== after.digest || before.revision !== after.revision || before.diffSha256 !== after.diffSha256;
  if (manifest.sourceChanged) { manifest.result.status = "source-changed-unqualified"; exitCode = 1; }
  await writeFile(path.join(publicDirectory, "runner.log"), redact(output));
  // The existing helper writes ancillary creation artifacts. Copy only new owned prefixes.
  let prefixes = [];
  // e2e >= 0.20 keeps SDK attempt evidence under sdk/results; it never writes sdk/artifacts.
  for (const artifactRoot of [path.join(campaign, "sdk/results"), path.join(publicDirectory, "business")]) {
    try {
      for (const file of await walk(artifactRoot)) if (file.endsWith(".json")) {
        const value = JSON.parse(await readFile(file, "utf8"));
        if (typeof value.fixturePrefix === "string" && value.fixturePrefix.startsWith("ARMY-")) prefixes.push(value.fixturePrefix);
      }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (prefixes.length) {
    const ancillary = path.resolve(".e2e/army/critical/artifacts/business");
    const target = path.join(campaign, "sdk/artifacts/ancillary-creation");
    await mkdir(target, { recursive: true });
    for (const name of await readdir(ancillary)) if ([...new Set(prefixes)].some((prefix) => name.startsWith(`${prefix}-`))) await copyFile(path.join(ancillary, name), path.join(target, name));
  }
  for (const directory of [publicDirectory, path.join(campaign, "sdk")]) {
    try { await sanitizeCoverageEvidence(directory); } catch (error) { if (error.code !== "ENOENT") throw error; }
    let files = [];
    try { files = await walk(directory); } catch (error) { if (error.code !== "ENOENT") throw error; }
    // Includes results/<test>/trace.md, the only trace format since e2e 0.20.
    for (const file of files) if (/\.(json|jsonl|log|txt|html|md)$/.test(file)) {
      const content = redact(await readFile(file, "utf8"));
      if (file.endsWith(".json")) JSON.parse(content);
      await writeFile(file, content);
    }
  }
  manifest.collectorStopped = true;
  manifest.artifacts = [];
  for (const file of await walk(campaign)) {
    if (file === path.join(publicDirectory, "manifest.json")) continue;
    const bytes = await readFile(file);
    manifest.artifacts.push({ path: relative(file), bytes: bytes.length, sha256: sha(bytes) });
  }
  manifest.finishedAt = new Date().toISOString();
  await persist();
  console.log(JSON.stringify({ manifest: relative(path.join(publicDirectory, "manifest.json")), status: manifest.result.status, exitCode, sourceChanged: manifest.sourceChanged, externalDelivery: false }));
  console.log(redact(output).slice(-5000));
  process.exitCode = exitCode;
}

}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await main();
}
