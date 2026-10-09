import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const root = fileURLToPath(new URL("../", import.meta.url));
const mode = process.argv[2] ?? "smoke";
if (!["smoke", "agent", "list", "critical", "critical-list"].includes(mode)) {
  throw new Error("Usage: node scripts/run-tester-army.mjs [smoke|agent|list|critical|critical-list] [runner flags]");
}
const critical = mode.startsWith("critical");
const discoveryOnly = mode === "list" || mode === "critical-list";
const output = path.join(root, ".e2e", "army", ...(critical ? ["critical"] : []));
const reportPath = path.join(output, "report.json");

const extraArgs = process.argv.slice(3).filter((arg) => arg !== "--");
for (let index = 0; index < extraArgs.length; index += 1) {
  const arg = extraArgs[index];
  if (arg === "--target" || arg.startsWith("--target=")) {
    const value = arg === "--target" ? extraArgs[++index] : arg.slice("--target=".length);
    if (!value || value.split(",").some((target) => !["chromium-desktop", "chromium-mobile"].includes(target))) {
      throw new Error("Choose chromium-desktop or chromium-mobile with --target.");
    }
  } else if (critical && (arg === "--grep" || arg.startsWith("--grep="))) {
    const value = arg === "--grep" ? extraArgs[++index] : arg.slice("--grep=".length);
    if (!value) throw new Error("--grep requires a test-title pattern.");
  } else if (!["--headed", "--no-cache", "--debug"].includes(arg) || discoveryOnly) {
    throw new Error("Pilot flags are limited to --target, --headed, --no-cache and --debug; list accepts --target only.");
  }
}
const hasTarget = extraArgs.some((arg) => arg === "--target" || arg.startsWith("--target="));
const args = [
  path.join(root, "node_modules", "e2e", "dist", "cli", "bin.js"),
  discoveryOnly ? "list" : "run",
  "--config",
  "e2e.config.ts",
  "--tag",
  critical ? "critical" : mode === "agent" ? "agent" : "smoke",
  "--exclude-tag",
  mode === "agent" ? "smoke" : "agent",
  ...((mode === "agent" || critical) && !hasTarget ? ["--target", "chromium-desktop"] : []),
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

await mkdir(output, { recursive: true });
const untrackedRuntimeFiles = () => git(["ls-files", "--others", "--exclude-standard", "-z"])
  .toString().split("\0")
  .filter((file) => file.startsWith("src/") || file.startsWith("public/"))
  .map((file) => path.join(root, file));
let inputs = [];
const startedAt = new Date();
const manifest = {
  schemaVersion: "miaouffrage-tester-army-1",
  startedAt: startedAt.toISOString(),
  mode,
  command: { executable: process.execPath, args, cwd: root },
  runtime: { node: process.version, platform: process.platform, arch: process.arch },
  source: {},
  fixtures: {
    account: critical ? "configured E2E account, ordinary login UI" : "anonymous fresh browser context",
    paths: critical ? ["/login", "/dashboard/estimates/new", "new ARMY estimates and imports only"] : mode === "agent" ? ["/login", "/signup", "/login"] : ["/dashboard/affaires", "/login"],
    submittedForms: critical,
    credentials: critical ? "opaque password; no JWT extraction or service role" : "none",
    appOrigin: null,
    ...(critical ? { mutationScope: "new ARMY drafts/imports only; retain evidence; no email or existing business mutations" } : {}),
  },
  telemetry: "disabled in child environment",
  tracePolicy: critical ? "anonymous access only; authenticated traces off because generated tokens are not SDK secrets" : "all anonymous attempts",
  result: { status: "running", exitCode: null },
};
const manifestPath = path.join(output, "manifest.json");
const save = () => writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
await save();

let collectedOutput = "";
let childExitCode;
try {
  if (critical) {
    nextEnv.loadEnvConfig(root, true, { info() {}, error() {} });
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
    }
  }
  // Capture failures must replace an earlier manifest before any runner starts.
  const normalizedOrigin = new URL(process.env.E2E_ARMY_BASE_URL ?? "http://localhost:3107");
  if (["localhost", "127.0.0.1", "[::1]"].includes(normalizedOrigin.hostname)) {
    normalizedOrigin.hostname = "localhost";
  }
  manifest.fixtures.appOrigin = normalizedOrigin.origin;
  // Keep Next's generated config updates separate from another active dev server.
  await writeFile(path.join(root, ".e2e", "army", "tsconfig.json"), `${JSON.stringify({
    extends: "../../tsconfig.json",
    compilerOptions: { paths: { "@/*": ["../../src/*"] } },
    include: ["../../next-env.d.ts", "../../src/**/*.ts", "../../src/**/*.tsx", "next/types/**/*.ts", "next/dev/types/**/*.ts"],
    exclude: ["../../node_modules"],
  }, null, 2)}\n`);
  inputs = [
    path.join(root, "e2e.config.ts"),
    path.join(root, "scripts", "run-tester-army.mjs"),
    path.join(root, "package-lock.json"),
    path.join(root, "package.json"),
    path.join(root, "next.config.ts"),
    path.join(root, "tsconfig.json"),
    ...await filesIn(path.join(root, "e2e", "army")),
  ];
  manifest.source = {
    revision: git(["rev-parse", "HEAD"]).toString().trim(),
    workingDiffSha256: digest(git(["diff", "HEAD", "--binary"])),
    pilotInputs: await fingerprint(inputs),
    untrackedRuntimeInputs: await fingerprint(untrackedRuntimeFiles()),
  };
  await save();
  childExitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      shell: false,
      windowsHide: true,
      stdio: discoveryOnly ? ["inherit", "pipe", "inherit"] : "inherit",
      env: {
        ...process.env,
        E2E_TELEMETRY_DISABLED: "1",
        DO_NOT_TRACK: "1",
        NEXT_TELEMETRY_DISABLED: "1",
        E2E_ARMY_SUITE: critical ? "critical" : "anonymous",
      },
    });
    child.stdout?.on("data", (chunk) => {
      collectedOutput += chunk.toString();
      process.stdout.write(chunk);
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
    child.once("exit", (code, signal) => {
      removeHandlers();
      resolve(code ?? (signal ? 130 : 3));
    });
  });

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
    if (critical) {
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
      tests: results.map((result) => ({ file: result.file, titlePath: result.titlePath, targetId: result.targetId, status: result.status })),
    };
    manifest.report = { path: relative(reportPath), sha256: digest(bytes) };
    manifest.artifacts = await fingerprint(await filesIn(path.join(output, "artifacts")));
    manifest.tracePaths = manifest.artifacts.filter((file) => file.path.endsWith(".zip")).map((file) => file.path);
    const expectedTraces = critical
      ? successful.filter((result) => result.file.endsWith("access-boundaries.e2e.ts")).length
      : successful.length;
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
    error: error instanceof Error ? error.message : String(error),
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
  }
} catch (error) {
  manifest.result.status = "evidence_unavailable";
  manifest.result.error = error instanceof Error ? error.message : String(error);
  childExitCode ||= 3;
  manifest.result.exitCode = childExitCode;
}
await save();
const appLog = path.join(output, "logs", "app.log");
try {
  // The SDK appends this owned log. Redact old query secrets after account changes.
  let log = await readFile(appLog, "utf8");
  const password = process.env.E2E_LOGIN_PASSWORD;
  if (password) {
    for (const value of [password, encodeURIComponent(password), new URLSearchParams({ value: password }).toString().slice(6)]) {
      log = log.replaceAll(value, "<redacted-army-password>");
    }
  }
  log = log
    .replace(/([?&](?:password|access_token|refresh_token|token|code|apikey|api_key)=)[^&\s"']*/gi, "$1<redacted>")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1<redacted>")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "<redacted-jwt>")
    .replace(/("(?:password|access_token|refresh_token)"\s*:\s*")[^"]*(")/gi, "$1<redacted>$2");
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
  // The SDK clears artifacts on the next run; keep a separate evidence snapshot.
  const archive = path.join(output, "runs", startedAt.toISOString().replace(/[:.]/g, "-"));
  try {
    await mkdir(archive, { recursive: true });
    await cp(path.join(output, "artifacts"), path.join(archive, "artifacts"), { recursive: true });
    await cp(reportPath, path.join(archive, "report.json"));
    if (manifest.appLog) {
      await mkdir(path.join(archive, "logs"), { recursive: true });
      await cp(appLog, path.join(archive, "logs", "app.log"));
    }
    const archivedManifest = JSON.parse(JSON.stringify(manifest));
    const archivedPath = (file) => relative(path.join(archive, path.relative(output, path.join(root, file))));
    archivedManifest.report.path = archivedPath(archivedManifest.report.path);
    archivedManifest.artifacts = archivedManifest.artifacts.map((file) => ({ ...file, path: archivedPath(file.path) }));
    archivedManifest.tracePaths = archivedManifest.tracePaths.map(archivedPath);
    if (archivedManifest.appLog) archivedManifest.appLog.path = archivedPath(archivedManifest.appLog.path);
    await writeFile(path.join(archive, "manifest.json"), `${JSON.stringify(archivedManifest, null, 2)}\n`);
    manifest.archive = { path: relative(archive), manifestSha256: digest(await readFile(path.join(archive, "manifest.json"))) };
    await save();
  } catch (error) {
    manifest.result.status = "evidence_unavailable";
    manifest.result.error = `Cannot preserve this run's artifacts: ${error instanceof Error ? error.message : String(error)}`;
    childExitCode ||= 3;
    manifest.result.exitCode = childExitCode;
    await save();
  }
}
console.log(`Tester Army evidence: ${relative(manifestPath)}`);
process.exitCode = childExitCode;
