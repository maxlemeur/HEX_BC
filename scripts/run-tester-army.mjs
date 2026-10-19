import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import { loadCoverageProfile } from "./tester-army/coverage-profile.mjs";
import { sanitizeCoverageEvidence } from "./tester-army/coverage-evidence.mjs";
import { archiveSetupFailure, assertSetupPath, readSetupLogBaseline, readSetupLogDelta, redactSetupError } from "./tester-army/setup-failure-archive.mjs";
import { CRITICAL_JOURNEY_FILE, FULL_JOURNEY_FILE } from "./tester-army/journey-files.mjs";
import { localJourneyCoverageProblems } from "./tester-army/journey-preflight.mjs";
import { prepareArmyTypeScriptConfig } from "./tester-army/local-recipe-common.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const requestedMode = process.argv[2] ?? "smoke";
const full = requestedMode === "full" || requestedMode === "full-list";
const development = requestedMode === "development" || requestedMode === "development-list";
const polish = requestedMode === "polish" || requestedMode === "polish-list";
const mode = full ? requestedMode.replace("full", "critical") : development ? requestedMode.replace("development", "critical") : polish ? requestedMode.replace("polish", "critical") : requestedMode;
if (polish) process.env.E2E_ARMY_CRITICAL_SELECTION = "polish";
if (full) process.env.E2E_ARMY_CRITICAL_SELECTION = "full";
if (development) {
  process.env.E2E_ARMY_CRITICAL_SELECTION = "development";
  process.env.E2E_ARMY_SERVER_MODE = "development";
}
if (!["smoke", "agent", "list", "critical", "critical-list", "coverage", "coverage-list", "performance", "performance-list", "performance-grid", "performance-navigation", "performance-navigation-live", "performance-affaire"].includes(mode)) {
  throw new Error("Usage: node scripts/run-tester-army.mjs [smoke|agent|list|critical|critical-list|full|full-list|development|development-list|polish|polish-list|coverage|coverage-list|performance|performance-list|performance-grid|performance-navigation|performance-navigation-live|performance-affaire] [runner flags]");
}
const critical = mode.startsWith("critical");
const coverage = mode.startsWith("coverage");
const performance = mode.startsWith("performance");
const navigation = mode.startsWith("performance-navigation");
const affaire = mode === "performance-affaire";
const live = mode === "performance-navigation-live";
const authenticated = critical || performance || coverage;
const discoveryOnly = mode === "list" || mode.endsWith("-list");
const output = path.join(root, ".e2e", "army", ...(coverage ? ["coverage"] : critical ? ["critical"] : performance ? ["performance"] : []));
const reportPath = path.join(output, "report.json");

const extraArgs = process.argv.slice(3).filter((arg) => arg !== "--");
for (let index = 0; index < extraArgs.length; index += 1) {
  const arg = extraArgs[index];
  if (arg === "--target" || arg.startsWith("--target=")) {
    const value = arg === "--target" ? extraArgs[++index] : arg.slice("--target=".length);
    if (!value || value.split(",").some((target) => !["chromium-desktop", "chromium-mobile"].includes(target))) {
      throw new Error("Choose chromium-desktop or chromium-mobile with --target.");
    }
    if ((navigation || affaire || coverage) && value !== "chromium-desktop") throw new Error("This journey requires chromium-desktop.");
  } else if (authenticated && !coverage && (arg === "--grep" || arg.startsWith("--grep="))) {
    const value = arg === "--grep" ? extraArgs[++index] : arg.slice("--grep=".length);
    if (!value) throw new Error("--grep requires a test-title pattern.");
  } else if (requestedMode === "critical" && CRITICAL_JOURNEY_FILE.test(arg)) {
    // Impact selection and its shards: the e2e CLI narrows the config tests glob to these files.
  } else if (requestedMode === "full" && FULL_JOURNEY_FILE.test(arg)) {
    // Full-only (takeoff) journeys a pull request reaches, or a shard of the full suite, with their login setup.
  } else if (!discoveryOnly && (arg === "--max-duration" || arg.startsWith("--max-duration="))) {
    const value = arg === "--max-duration" ? extraArgs[++index] : arg.slice("--max-duration=".length);
    if (!value || !/^[1-9]\d*$/.test(value) || Number(value) > 2_147_483_647) {
      throw new Error("--max-duration requires a positive integer in milliseconds, at most 2147483647.");
    }
  } else if (!["--headed", "--no-cache", "--debug"].includes(arg) || discoveryOnly) {
    throw new Error("Pilot flags are limited to --target, --headed, --no-cache, --debug and --max-duration; authenticated runs also accept --grep, critical runs e2e/army/{critical,local} journey files, full runs e2e/army/{critical,extended,local,takeoff} journey files; list accepts selection flags only.");
  }
}
// A local journey no selection collects would never run, and nothing would say so.
if (critical && !discoveryOnly) {
  const problems = localJourneyCoverageProblems(root);
  if (problems.length) throw new Error(problems.join(" "));
}
const hasTarget = extraArgs.some((arg) => arg === "--target" || arg.startsWith("--target="));
const args = [
  path.join(root, "node_modules", "e2e", "dist", "cli", "bin.js"),
  discoveryOnly ? "list" : "run",
  "--config",
  "e2e.config.ts",
  "--tag",
  coverage ? "source-coverage" : critical ? "critical" : affaire ? "affaire-performance" : navigation ? "navigation-performance" : mode === "performance-grid" ? "grid-performance" : performance ? "performance" : mode === "agent" ? "agent" : "smoke",
  "--exclude-tag",
  mode === "agent" ? "smoke" : "agent",
  ...((mode === "agent" || critical || navigation || affaire || coverage) && !hasTarget ? ["--target", "chromium-desktop"] : []),
  ...(mode === "coverage" ? ["--max-failures", "1"] : []),
  ...(discoveryOnly ? ["--reporter", "json"] : []),
  ...extraArgs,
];

const digest = (buffer) => createHash("sha256").update(buffer).digest("hex");
function git(args) {
  const result = spawnSync("git", ["-c", `safe.directory=${root}`, ...args], {
    cwd: root,
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(`Cannot capture git evidence: git ${args.join(" ")}`);
  }
  return result.stdout;
}

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files = [];
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(file));
    else if (entry.isFile()) files.push(file);
  }
  return files.sort();
}

const relative = (file) => path.relative(root, file).split(path.sep).join("/");
async function fingerprint(files) {
  return Promise.all(files.map(async (file) => ({
    path: relative(file),
    sha256: digest(await readFile(file)),
  })));
}

// e2e >= 0.20 owns <output>/results (one directory per test, attempt-<n>/
// inside, trace.md beside them) and clears it when a run's tests start. The
// journeys' own business evidence stays under <output>/artifacts.
const sdkEvidence = path.join(output, "results");
const businessEvidence = path.join(output, "artifacts");
const isTracePage = (file) => {
  const parts = path.relative(sdkEvidence, file).split(path.sep);
  return parts.length === 2 && parts[0] !== ".." && parts[1] === "trace.md";
};

// Shared by the owned app log, report.json and textual evidence. The SDK redacts
// only configured credentials; generated Supabase tokens are not among them.
// A truncated app-log line (300 characters) can keep a JWT without its
// signature, and a session cookie is one unsigned base64url segment.
function redactArmyText(text) {
  let value = text;
  const localDatabaseUrl = process.env.E2E_ARMY_LOCAL_DB_URL;
  let localDatabasePassword;
  try { localDatabasePassword = localDatabaseUrl ? decodeURIComponent(new URL(localDatabaseUrl).password) : undefined; } catch { /* Invalid fixture URLs are rejected by the fixture guard. */ }
  for (const [label, secret] of Object.entries({ password: process.env.E2E_LOGIN_PASSWORD, email: process.env.E2E_LOGIN_EMAIL,
    "anon-key": process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, "service-role-key": process.env.SUPABASE_SERVICE_ROLE_KEY,
    "portal-token": process.env.E2E_UX_PORTAL_TOKEN, "fixture-database-url": localDatabaseUrl,
    "fixture-database-password": localDatabasePassword })) {
    if (!secret) continue;
    for (const form of new Set([secret, encodeURIComponent(secret), new URLSearchParams({ value: secret }).toString().slice(6), JSON.stringify(secret).slice(1, -1)])) {
      value = value.replaceAll(form, `<redacted-army-${label}>`);
    }
  }
  return value
    .replace(/([?&#](?:password|access_token|refresh_token|token|code|apikey|api_key)=)[^&\s"']*/gi, "$1<redacted>")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1<redacted>")
    .replace(/eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]*){0,2}/g, "<redacted-jwt>")
    .replace(/("(?:password|access_token|refresh_token)"\s*:\s*")[^"]*(")/gi, "$1<redacted>$2");
}

// Since e2e 0.20, report.json keeps every attempt's browser app log (console,
// uncaught errors, failed or >= 400 requests with their full URL) and the
// navigation URLs whatever the trace mode, and trace.md renders them again.
// Scrub string values only, so the report stays the SDK's JSON document.
async function scrubBrowserEvidence() {
  let values = 0;
  const scrub = (value) => {
    if (typeof value === "string") {
      const clean = redactArmyText(value);
      if (clean !== value) values += 1;
      return clean;
    }
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, scrub(entry)]));
    return value;
  };
  await assertSetupPath(root, reportPath);
  const report = scrub(JSON.parse(await readFile(reportPath, "utf8")));
  if (values) {
    // Same serialization as the SDK writes; re-parse before replacing it.
    const bytes = `${JSON.stringify(report, null, 2)}\n`;
    JSON.parse(bytes);
    await writeFile(reportPath, bytes);
  }
  // Failure screens exist even with traces off. Business JSON may contain a
  // signed download URL; scrub owned text before fingerprinting either tree.
  const textFiles = [...await filesIn(sdkEvidence), ...await filesIn(businessEvidence)]
    .filter((file) => /\.(?:json|jsonl|txt|md|log|html|csv|xml)$/i.test(file));
  let tracePagesRewritten = 0;
  let failureScreensRewritten = 0;
  let evidenceTextFilesRewritten = 0;
  for (const file of textFiles) {
    await assertSetupPath(root, file);
    const text = await readFile(file, "utf8");
    const clean = file.endsWith(".json") ? `${JSON.stringify(scrub(JSON.parse(text)), null, 2)}\n` : redactArmyText(text);
    if (clean !== text) {
      await writeFile(file, clean);
      evidenceTextFilesRewritten += 1;
      if (isTracePage(file)) tracePagesRewritten += 1;
      if (path.basename(file) === "screen-at-failure.txt") failureScreensRewritten += 1;
    }
  }
  return { scope: "report.json and owned SDK/business text evidence; binary evidence unchanged", textFiles: 1 + textFiles.length, reportValuesRedacted: values, tracePagesRewritten, failureScreensRewritten, evidenceTextFilesRewritten, valuesRetained: false, appliedBeforeArtifactHashes: true };
}

await assertSetupPath(root, output, { allowMissing: true });
await mkdir(output, { recursive: true });
const untrackedRuntimeFiles = () => git(["ls-files", "--others", "--exclude-standard", "-z"])
  .toString().split("\0")
  .filter((file) => file.startsWith("src/") || file.startsWith("public/"))
  .map((file) => path.join(root, file));
let inputs = [];
const startedAt = new Date();
const coverageInputs = path.join(output, `profile-${startedAt.toISOString().replace(/[:.]/g, "-")}`);
const coverageNetworkLog = path.join(output, `network-${startedAt.toISOString().replace(/[:.]/g, "-")}.jsonl`);
let criticalNetworkLog = null;
const manifest = {
  schemaVersion: "miaouffrage-tester-army-1",
  startedAt: startedAt.toISOString(),
  mode,
  command: { executable: process.execPath, args, cwd: root },
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  source: {},
  fixtures: {
    ...(critical ? { selection: extraArgs.some((arg) => arg.endsWith(".e2e.ts")) ? "files" : process.env.E2E_ARMY_CRITICAL_SELECTION ?? "all" } : {}),
    account: authenticated ? "configured E2E account, ordinary login UI" : "anonymous fresh browser context",
    paths: affaire ? ["/login", "/dashboard/affaires", "new owned ARMY affaire; retained fixture receipt"] : navigation ? ["/login", "/dashboard/affaires", "/dashboard/orders", "/dashboard/referentiel", "/dashboard/products"] : mode === "performance-grid" ? ["/login", "/dashboard/affaires", "existing ARMY editor; browser-only synthetic read-only payload"] : performance ? ["/login", "/signup", "/dashboard/affaires", "/dashboard/products", "/dashboard/orders"] : critical ? ["/login", "/dashboard/estimates/new", "new ARMY estimates and imports only"] : mode === "agent" ? ["/login", "/signup", "/login"] : ["/dashboard/affaires", "/login"],
    submittedForms: authenticated,
    credentials: authenticated ? "opaque password; no JWT extraction; local worker prerequisites may use a Node-only key after ARMY ownership checks" : "none",
    appOrigin: null,
    ...(affaire ? { mutationScope: "one new owned ARMY draft and two priced lines; owned approval-read projections/audit allowed; retain fixture; no emails or existing business changes" } : performance ? { mutationScope: "ordinary login; read-only page visits and local input/scroll interactions" } : critical ? { mutationScope: "new ARMY drafts/imports only; retain evidence; no email or existing business mutations" } : {}),
  },
  telemetry: "disabled in child environment",
  tracePolicy: coverage ? "off: no trace.md page; report.json still keeps the SDK app log and navigation URLs, scrubbed with the whole coverage output and pattern-scrubbed by this wrapper like the critical report before hashing; explicit business facts only, no credentials or session values" : performance ? "off: no trace.md page; report.json still keeps the SDK app log (console, uncaught errors, failed or >= 400 requests with full URLs) and navigation URLs, redacted by the SDK for configured credentials only and pattern-scrubbed by this wrapper before hashing; authenticated metrics contain no cookies, headers or response bodies" : critical ? "markdown trace.md pages for anonymous access-boundaries results only; authenticated traces off because generated tokens are not SDK secrets; report.json and trace pages keep the SDK app log and navigation URLs, redacted by the SDK for configured credentials only and pattern-scrubbed by this wrapper before hashing; no Playwright trace zip" : "markdown trace.md page (results/<test>/trace.md, rendered from report.json) for every anonymous result that ran; no Playwright trace zip",
  result: { status: "running", exitCode: null },
};
const manifestPath = path.join(output, "manifest.json");
const save = () => writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await save();

let collectedOutput = "";
let childExitCode;
let runnerOutput;
let appLogBefore;
let setupAppLog = { reason: "runner-not-started" };
let reportBeforeSha256;
const appLog = path.join(output, "logs", "app.log");
try {
  if (coverage) {
    const profile = await loadCoverageProfile(root, { discoveryOnly });
    Object.assign(process.env, profile.env);
    if (mode === "coverage" && profile.metadata.scenarioSet === "create-atomic") args[args.indexOf("--max-failures") + 1] = "3";
    if (mode === "coverage" && profile.metadata.scenarioSet === "generated-atomic") args[args.indexOf("--max-failures") + 1] = "2";
    manifest.coverage = profile.metadata;
    manifest.fixtures = { ...manifest.fixtures, paths: discoveryOnly ? [] : ["/login", "new owned ARMY coverage fixture only"], mutationScope: discoveryOnly ? "none; collection only" : "explicit fixture only; no model, email or external mutation", identities: profile.metadata.fixture, ...(discoveryOnly ? { account: "no account used", submittedForms: false, credentials: "none" } : {}) };
    const evidenceDirectory = coverageInputs;
    await mkdir(evidenceDirectory, { recursive: true });
    manifest.coverage.evidence = [];
    for (const entry of profile.evidence) {
      const target = path.join(evidenceDirectory, entry.name);
      await cp(entry.file, target);
      manifest.coverage.evidence.push({ path: relative(target), sha256: entry.sha256 });
    }
  }
  if (authenticated) {
    if (!coverage) nextEnv.loadEnvConfig(root, true, { info() {}, error() {} });
    if (!discoveryOnly) {
      const required = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "E2E_LOGIN_EMAIL", "E2E_LOGIN_PASSWORD", "E2E_ALLOWED_SUPABASE_HOST"];
      const missing = required.filter((name) => !process.env[name]?.trim());
      if (missing.length) throw new Error(`Critical journeys require: ${missing.join(", ")}`);
      const supabase = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL);
      const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(supabase.hostname);
      if (supabase.hostname.toLowerCase() !== process.env.E2E_ALLOWED_SUPABASE_HOST.trim().toLowerCase() ||
        (!loopback && supabase.protocol !== "https:") || supabase.username || supabase.password ||
        supabase.search || supabase.hash || supabase.pathname !== "/" || (!loopback && supabase.port)) {
        throw new Error("Critical Supabase origin must exactly match E2E_ALLOWED_SUPABASE_HOST.");
      }
      manifest.fixtures.supabaseHost = supabase.hostname;
      if (critical && loopback) {
        const networkDirectory = path.join(root, ".e2e", "army", "coverage");
        await mkdir(networkDirectory, { recursive: true });
        process.env.E2E_COVERAGE_BACKEND_ORIGIN = supabase.origin;
        criticalNetworkLog = path.join(networkDirectory, `business-network-${startedAt.toISOString().replace(/[:.]/g, "-")}.jsonl`);
        process.env.E2E_COVERAGE_NETWORK_LOG = criticalNetworkLog;
        process.env.E2E_ARMY_BLOCK_WORKERS = "1";
      }
    }
  }
  // Capture failures must replace an earlier manifest before any runner starts.
  const normalizedOrigin = new URL(process.env.E2E_ARMY_BASE_URL ?? (live ? "http://localhost:3000" : "http://localhost:3107"));
  if (["localhost", "127.0.0.1", "[::1]"].includes(normalizedOrigin.hostname)) {
    normalizedOrigin.hostname = "localhost";
  }
  manifest.fixtures.appOrigin = normalizedOrigin.origin;
  manifest.environment = live ? "existing loopback development server; attached without process ownership" : performance || coverage ? "owned isolated production server" : "owned loopback server";
  await prepareArmyTypeScriptConfig(root);
  inputs = [
    path.join(root, "e2e.config.ts"),
    path.join(root, "scripts", "run-tester-army.mjs"),
    path.join(root, "package-lock.json"),
    path.join(root, "package.json"),
    path.join(root, "next.config.ts"),
    path.join(root, "tsconfig.json"),
    ...await filesIn(path.join(root, "e2e", "army")),
    ...await filesIn(path.join(root, "e2e", "fixtures", "business")),
    ...(coverage ? [] : [path.join(root, "scripts", "tester-army", "business-corpus-selection.ts")]),
    ...(coverage ? await filesIn(path.join(root, "scripts", "tester-army")) : []),
    ...(coverage ? git(["ls-files", "--others", "--exclude-standard", "-z", "--", "supabase/migrations"]).toString().split("\0").filter(Boolean).map((file) => path.join(root, file)) : []),
  ];
  manifest.source = {
    revision: git(["rev-parse", "HEAD"]).toString().trim(),
    workingDiffSha256: digest(git(["diff", "HEAD", "--binary"])),
    pilotInputs: await fingerprint(inputs),
    untrackedRuntimeInputs: await fingerprint(untrackedRuntimeFiles()),
  };
  if (coverage) {
    await writeFile(path.join(coverageInputs, "source.diff"), git(["diff", "HEAD", "--binary"]));
    await writeFile(path.join(coverageInputs, "source-status.txt"), git(["status", "--short", "--branch"]));
    for (const file of ["e2e.config.ts", "scripts/run-tester-army.mjs", ...git(["ls-files", "--others", "--exclude-standard", "-z", "--", "src", "e2e/army", "scripts/tester-army", "supabase/migrations"]).toString().split("\0").filter(Boolean)]) {
      const target = path.join(coverageInputs, "source", file);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.join(root, file), target);
    }
  }
  if ((performance || coverage || process.env.E2E_ARMY_SERVER_MODE === "production") && !live && !discoveryOnly) {
    const buildDirectory = path.join(root, ".e2e", "army", "next");
    const buildIdPath = path.join(buildDirectory, "BUILD_ID");
    manifest.productionBuild = {
      directory: relative(buildDirectory),
      id: (await readFile(buildIdPath, "utf8")).trim(),
      inputs: await fingerprint([
        buildIdPath,
        path.join(buildDirectory, "required-server-files.json"),
        path.join(buildDirectory, "build-manifest.json"),
      ]),
    };
  }
  await save();
  if (!discoveryOnly) {
    await assertSetupPath(root, reportPath, { allowMissing: true });
    const before = await readFile(reportPath).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    reportBeforeSha256 = before ? digest(before) : null;
    // e2e < 0.20 emptied <output>/artifacts for each run; it is now ours to
    // clear. The previous run's copy is kept under runs/<stamp>/.
    await assertSetupPath(root, businessEvidence, { allowMissing: true });
    await rm(businessEvidence, { recursive: true, force: true });
  }
  appLogBefore = await readSetupLogBaseline(root, appLog);
  runnerOutput = { stdout: [], stderr: [], bytes: 0, truncated: false };
  const captureOutput = (stream, chunk) => {
    const remaining = 8 * 1024 * 1024 - runnerOutput.bytes;
    if (remaining <= 0) {
      runnerOutput.truncated = true;
      return;
    }
    if (chunk.length > remaining) runnerOutput.truncated = true;
    const retained = chunk.subarray(0, Math.max(0, remaining));
    runnerOutput[stream].push(retained);
    runnerOutput.bytes += retained.length;
  };
  childExitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      shell: false,
      windowsHide: true,
      stdio: ["inherit", "pipe", "pipe"],
      env: {
        ...process.env,
        E2E_TELEMETRY_DISABLED: "1",
        DO_NOT_TRACK: "1",
        NEXT_TELEMETRY_DISABLED: "1",
        E2E_ARMY_SUITE: coverage ? "coverage" : critical ? "critical" : performance ? "performance" : mode === "agent" ? "agent" : "anonymous",
        // Journeys search this root for SDK downloads only (attempt-relative
        // paths); e2e >= 0.20 files them under results/, cleared at test start.
        ...(coverage || critical ? { E2E_ARMY_ARTIFACT_ROOT: sdkEvidence } : {}),
        ...(coverage ? { E2E_COVERAGE_NETWORK_LOG: coverageNetworkLog } : {}),
        ...(performance ? { E2E_ARMY_SERVER_MODE: live ? "live" : "production", E2E_ARMY_BASE_URL: normalizedOrigin.origin } : {}),
      },
    });
    child.stdout?.on("data", (chunk) => {
      if (discoveryOnly) collectedOutput += chunk.toString();
      captureOutput("stdout", chunk);
      process.stdout.write(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      captureOutput("stderr", chunk);
      process.stderr.write(chunk);
    });
    const interrupt = () => child.kill("SIGINT");
    const terminate = () => child.kill("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    const removeHandlers = () => {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    };
    child.once("error", (error) => { removeHandlers(); reject(error); });
    child.once("close", (code, signal) => {
      removeHandlers();
      resolve(code ?? (signal ? 130 : 3));
    });
  });

  setupAppLog = await readSetupLogDelta(root, appLog, appLogBefore);
  if (criticalNetworkLog && !discoveryOnly) {
    await assertSetupPath(root, criticalNetworkLog);
    const log = await readFile(criticalNetworkLog, "utf8");
    if (!log.split(/\r?\n/).filter(Boolean).some(line => JSON.parse(line).kind === "guard-installed")) {
      throw new Error("Local business run did not retain its server network guard receipt.");
    }
    await assertSetupPath(root, businessEvidence, { allowMissing: true });
    await mkdir(businessEvidence, { recursive: true });
    await writeFile(path.join(businessEvidence, "server-network.jsonl"), log);
  }
  if (!discoveryOnly) {
    await assertSetupPath(root, reportPath, { allowMissing: true });
    const after = await readFile(reportPath).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (after && digest(after) === reportBeforeSha256) throw new Error("Runner did not replace the previous report for this invocation.");
  }
  if (coverage) {
    // The coverage sanitizer walks every text file but predates the 0.20 app
    // log (signature cut at 300 characters, #fragments, JSON-encoded console
    // values); the browser scrub covers those in report.json and trace pages.
    manifest.confidentiality = await sanitizeCoverageEvidence(output);
    if (!discoveryOnly) manifest.confidentiality.browserEvidence = await scrubBrowserEvidence();
  } else if (authenticated && !discoveryOnly) manifest.confidentiality = await scrubBrowserEvidence();

  if (discoveryOnly) {
    const discovery = JSON.parse(collectedOutput);
    const discoveryPath = path.join(output, "discovery.json");
    await writeFile(discoveryPath, `${JSON.stringify(discovery, null, 2)}\n`);
    manifest.result = { status: childExitCode === 0 ? "collected" : "collection_failed", exitCode: childExitCode };
    manifest.discovery = { path: relative(discoveryPath), sha256: digest(await readFile(discoveryPath)) };
  } else {
    const bytes = await readFile(reportPath);
    const report = JSON.parse(bytes.toString());
    const reportStartedAt = Date.parse(report.run?.startedAt ?? "");
    const reportStat = await stat(reportPath);
    if (
      !Number.isFinite(reportStartedAt) ||
      reportStartedAt < startedAt.getTime() - 1000 ||
      reportStat.mtimeMs < startedAt.getTime() - 1000
    ) {
      throw new Error("Runner did not produce a fresh report for this invocation.");
    }
    const results = report.run.results ?? [];
    const successful = results.filter((result) => result.status === "passed");
    if (coverage && childExitCode === 0 && (
      results.length < 2 || results.some((result) => result.status !== "passed") ||
      ["discovered", "selected", "executed", "passed"].some((key) => report.run.summary[key] !== results.length) ||
      ["failed", "skipped", "flaky"].some((key) => report.run.summary[key] !== 0)
    )) throw new Error("Coverage requires every discovered scenario to execute and pass without filtering.");
    if (authenticated) {
      const auth = results.find((result) => result.file.endsWith("auth.setup.e2e.ts") && result.status !== "skipped");
      manifest.fixtures.authentication = { attempted: Boolean(auth), result: auth?.status ?? "not-selected" };
      if (!auth) {
        manifest.fixtures.account = "anonymous fresh contexts; synthetic non-account pre-hydration fixture when selected";
        manifest.fixtures.credentials = "no existing account credentials used";
      }
    }
    if (mode !== "agent" && (report.run.usage.modelTokens !== 0 || report.run.usage.maxModelCallsInStep !== 0)) {
      throw new Error("Model-free smoke unexpectedly invoked a model.");
    }
    const evidenceExitCode = childExitCode === 0 && successful.length === 0 ? 3 : childExitCode;
    manifest.result = {
      status: report.run.status,
      exitCode: evidenceExitCode,
      runnerExitCode: childExitCode,
      summary: report.run.summary,
      usage: report.run.usage,
      limits: report.run.limits,
      errors: report.run.errors ?? [],
      tests: results.map((result) => ({ file: result.file, titlePath: result.titlePath, targetId: result.targetId, selected: result.selected, status: result.status, ...(result.skip ? { skip: result.skip } : {}) })),
    };
    manifest.report = { path: relative(reportPath), sha256: digest(bytes) };
    // One list, SDK evidence first; each entry's prefix names its owner.
    const sdkFiles = await filesIn(sdkEvidence);
    manifest.evidenceRoots = { sdk: relative(sdkEvidence), business: relative(businessEvidence) };
    manifest.artifacts = await fingerprint([...sdkFiles, ...await filesIn(businessEvidence)]);
    manifest.tracePaths = sdkFiles.filter(isTracePage).map(relative);
    // e2e >= 0.20 keeps one trace.md per result, not per attempt: under "on",
    // for every result that ran, failed ones included, never a skipped one.
    const traced = (result) => result.status !== "skipped";
    const expectedTraces = performance || coverage ? 0 : critical
      ? results.filter((result) => result.file.endsWith("access-boundaries.e2e.ts") && traced(result)).length
      : results.filter(traced).length;
    if (evidenceExitCode === 0 && manifest.tracePaths.length < expectedTraces) {
      throw new Error("Passing browser attempts did not retain their traces.");
    }
    if (mode === "smoke" && (report.run.usage?.maxModelCallsInStep ?? 0) > 0) {
      throw new Error("Anonymous smoke unexpectedly made model calls.");
    }
    childExitCode = evidenceExitCode;
  }
} catch (error) {
  manifest.result = {
    status: "evidence_unavailable",
    exitCode: childExitCode && childExitCode !== 0 ? childExitCode : 3,
    error: redactSetupError(error instanceof Error ? error.message : String(error)),
  };
  childExitCode = manifest.result.exitCode;
}

manifest.finishedAt = new Date().toISOString();
try {
  if (manifest.source.revision) {
    manifest.source.workingDiffAfterSha256 = digest(git(["diff", "HEAD", "--binary"]));
    manifest.source.pilotInputsAfter = await fingerprint(inputs);
    manifest.source.untrackedRuntimeInputsAfter = await fingerprint(untrackedRuntimeFiles());
    manifest.source.changedDuringRun =
      manifest.source.workingDiffAfterSha256 !== manifest.source.workingDiffSha256 ||
      JSON.stringify(manifest.source.pilotInputsAfter) !== JSON.stringify(manifest.source.pilotInputs) ||
      JSON.stringify(manifest.source.untrackedRuntimeInputsAfter) !== JSON.stringify(manifest.source.untrackedRuntimeInputs);
    if (coverage && manifest.source.changedDuringRun) throw new Error("Coverage sources changed during the run.");
    if (manifest.productionBuild) {
      const after = await fingerprint(manifest.productionBuild.inputs.map((file) => path.join(root, file.path)));
      manifest.productionBuild.changedDuringRun = JSON.stringify(after) !== JSON.stringify(manifest.productionBuild.inputs);
      if (manifest.productionBuild.changedDuringRun) throw new Error("Production build changed during performance measurement.");
    }
  }
} catch (error) {
  manifest.result.status = "evidence_unavailable";
  manifest.result.error = redactSetupError(error instanceof Error ? error.message : String(error));
  childExitCode ||= 3;
  manifest.result.exitCode = childExitCode;
}
await save();
if (!live) try {
  // The SDK appends this owned log. Redact old query secrets after account changes.
  await assertSetupPath(root, appLog);
  const log = redactArmyText(await readFile(appLog, "utf8"));
  await writeFile(appLog, log);
  manifest.appLog = {
    path: relative(appLog), sha256: digest(log),
    scope: "runner-owned cumulative log; secrets redacted",
  };
  await save();
} catch (error) {
  if (error.code !== "ENOENT") {
    manifest.result.status = "evidence_unavailable";
    manifest.result.error = "Could not redact and retain the owned application log.";
    childExitCode ||= 3;
    manifest.result.exitCode = childExitCode;
    await save();
  }
}
if (!discoveryOnly && manifest.report) {
  // The SDK clears results/ when the next run's tests start and this script
  // clears artifacts/ before it spawns one; keep a separate evidence snapshot.
  const archive = path.join(output, "runs", startedAt.toISOString().replace(/[:.]/g, "-"));
  try {
    await mkdir(archive, { recursive: true });
    for (const directory of [sdkEvidence, businessEvidence]) {
      // A run may leave either one absent, e.g. smoke on a fresh checkout.
      await assertSetupPath(root, directory, { allowMissing: true });
      const present = await stat(directory).then(() => true, (error) => { if (error.code === "ENOENT") return false; throw error; });
      if (present) await cp(directory, path.join(archive, path.basename(directory)), { recursive: true });
    }
    await cp(reportPath, path.join(archive, "report.json"));
    if (manifest.appLog) {
      await mkdir(path.join(archive, "logs"), { recursive: true });
      await cp(appLog, path.join(archive, "logs", "app.log"));
    }
    if (coverage) {
      await cp(coverageInputs, path.join(archive, path.basename(coverageInputs)), { recursive: true });
      await cp(coverageNetworkLog, path.join(archive, "server-network.jsonl"));
    }
    const archivedManifest = JSON.parse(JSON.stringify(manifest));
    const archivedPath = (file) => relative(path.join(archive, path.relative(output, path.join(root, file))));
    archivedManifest.report.path = archivedPath(archivedManifest.report.path);
    archivedManifest.evidenceRoots = { sdk: archivedPath(archivedManifest.evidenceRoots.sdk), business: archivedPath(archivedManifest.evidenceRoots.business) };
    archivedManifest.artifacts = archivedManifest.artifacts.map((file) => ({ ...file, path: archivedPath(file.path) }));
    archivedManifest.tracePaths = archivedManifest.tracePaths.map(archivedPath);
    if (archivedManifest.appLog) archivedManifest.appLog.path = archivedPath(archivedManifest.appLog.path);
    if (coverage) {
      archivedManifest.coverage.evidence = archivedManifest.coverage.evidence.map((entry) => ({ ...entry, path: archivedPath(entry.path) }));
      archivedManifest.coverage.retainedEvidence = await fingerprint([
        ...await filesIn(path.join(archive, path.basename(coverageInputs))), path.join(archive, "server-network.jsonl"),
      ]);
    }
    await writeFile(path.join(archive, "manifest.json"), `${JSON.stringify(archivedManifest, null, 2)}\n`);
    manifest.archive = { path: relative(archive), manifestSha256: digest(await readFile(path.join(archive, "manifest.json"))) };
    await save();
  } catch (error) {
    manifest.result.status = "evidence_unavailable";
    manifest.result.error = redactSetupError(`Cannot preserve this run's artifacts: ${error instanceof Error ? error.message : String(error)}`);
    childExitCode ||= 3;
    manifest.result.exitCode = childExitCode;
    await save();
  }
} else if (!discoveryOnly) {
  try {
    manifest.failureArchive = await archiveSetupFailure({ root, output, manifest, runnerOutput, appLog: setupAppLog, networkFile: coverage ? coverageNetworkLog : criticalNetworkLog, inputsDirectory: coverage ? coverageInputs : null });
  } catch {
    manifest.failureArchive = { status: "unavailable", error: "Could not preserve the setup failure in an exclusive confined archive." };
    childExitCode ||= 3;
    manifest.result.exitCode = childExitCode;
  }
  await save();
}
console.log(`Tester Army evidence: ${relative(manifestPath)}`);
process.exitCode = childExitCode;
