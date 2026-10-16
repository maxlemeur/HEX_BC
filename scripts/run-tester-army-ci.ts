import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import { assertLoopbackSupabaseUrl, BROWSER_RESTRICTED_LOCAL_PORTS, runLocalSupabaseCi } from "../src/test/local-supabase-ci";
import { createLocalCiEnvironment, type SupabaseEnvironment } from "../src/test/supabase-cli";
import type { Database } from "../src/types/database";
import { buildSourceEvidence, redactOutput, sqlInventory } from "./tester-army/local-recipe-common.mjs";
import { assertLocalAppPortAvailable, runLocalDevelopmentSession } from "./tester-army/local-development";

const suite = process.argv[2];
if (!["critical", "full", "dev"].includes(suite)) {
  throw new Error("Usage: run-tester-army-ci.ts critical|full|dev [--app-port PORT] [critical only: --grep PATTERN]");
}
let grep: string | undefined;
let appPort = 3107;
const suppliedOptions = new Set<string>();
for (let index = 3; index < process.argv.length; index += 2) {
  const option = process.argv[index];
  const value = process.argv[index + 1];
  if (!["--grep", "--app-port"].includes(option) || suppliedOptions.has(option) || !value?.trim()) {
    throw new Error("Only one --app-port and one critical --grep with explicit values are allowed.");
  }
  suppliedOptions.add(option);
  if (option === "--grep") {
    if (suite !== "critical") throw new Error("--grep is restricted to critical; full and dev cannot be filtered.");
    new RegExp(value);
    grep = value;
  } else {
    if (!/^[0-9]+$/.test(value) || Number(value) < 1024 || Number(value) > 65535) {
      throw new Error("--app-port must be an integer from 1024 to 65535; the host is always loopback.");
    }
    if (BROWSER_RESTRICTED_LOCAL_PORTS.has(Number(value))) {
      throw new Error("--app-port is blocked by the browser for HTTP; choose an unrestricted local port.");
    }
    appPort = Number(value);
  }
}
// The journey environment below is an allowlist: forward the e2e.config.ts
// worker knob explicitly, and refuse an invalid value before any SQL step.
const workers = process.env.E2E_ARMY_WORKERS ?? "";
if (workers !== "" && !/^[1-4]$/.test(workers)) {
  throw new Error(`E2E_ARMY_WORKERS must be an integer from 1 to 4 (default 1); received "${workers}".`);
}
const root = process.cwd();
const evidence = path.join(root, ".e2e/army/ci", `${new Date().toISOString().replace(/[:.]/g, "-")}-${suite}`);
fs.mkdirSync(evidence, { recursive: true });
const knownSecrets: string[] = [];
const developmentStop = new AbortController();
const interruptDevelopment = () => developmentStop.abort("SIGINT");
const terminateDevelopment = () => developmentStop.abort("SIGTERM");
const developmentNetworkLog = path.join(root, ".e2e/army/coverage", `${path.basename(evidence)}-network.jsonl`);
const manifest: Record<string, unknown> = {
  schemaVersion: "army-native-ci-1",
  suite,
  startedAt: new Date().toISOString(),
  command: [process.execPath, ...process.argv.slice(1)],
  node: process.version,
  platform: process.platform,
  appOrigin: `http://localhost:${appPort}`,
  scope: suite === "dev" ? "interactive-development" : grep ? "filtered-critical" : suite,
  ...(grep ? { grep } : {}),
  ...(suite === "dev" ? { e2e: "not-run" } : { workers: workers === "" ? 1 : Number(workers) }),
  status: "preparing",
  steps: [],
};

function redact(value: string) {
  return redactOutput(value, { NODE_ENV: "test", ...Object.fromEntries(knownSecrets.map((secret, index) => [`SECRET_${index}`, secret])) });
}

async function runNode(args: string[], environment: NodeJS.ProcessEnv, name: string) {
  console.log(`TesterArmy CI: ${name}`);
  const chunks: Buffer[] = [];
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let bytes = 0;
    const capture = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 64 * 1024 * 1024) child.kill("SIGTERM");
      else chunks.push(chunk);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const interrupt = () => child.kill("SIGINT");
    const terminate = () => child.kill("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    const removeHandlers = () => { process.off("SIGINT", interrupt); process.off("SIGTERM", terminate); };
    child.once("error", (error) => { removeHandlers(); reject(error); });
    child.once("close", (code, signal) => { removeHandlers(); resolve(code ?? (signal ? 130 : 3)); });
  });
  fs.writeFileSync(path.join(evidence, `${name}.log`), redact(Buffer.concat(chunks).toString("utf8")));
  (manifest.steps as unknown[]).push({ name, command: [process.execPath, ...args], exitCode });
  if (exitCode !== 0) throw new Error(`${name} failed with exit code ${exitCode}; see its retained log.`);
}

async function runApplication(local: SupabaseEnvironment) {
  if (suite === "dev" && developmentStop.signal.aborted) return;
  if (local.RLS_E2E_EPHEMERAL !== "1" || local.RLS_E2E_LOCAL !== "1") throw new Error("An owned ephemeral stack is required.");
  const backend = new URL(local.NEXT_PUBLIC_SUPABASE_URL!);
  assertLoopbackSupabaseUrl(backend.href);
  if (backend.protocol !== "http:" || backend.username || backend.password || backend.pathname !== "/" || backend.search || backend.hash) {
    throw new Error("Only a bare loopback HTTP backend is allowed.");
  }
  knownSecrets.push(local.NEXT_PUBLIC_SUPABASE_ANON_KEY!, local.SUPABASE_SERVICE_ROLE_KEY!);
  if (!local.E2E_ARMY_LOCAL_DB_URL || !local.E2E_ARMY_LOCAL_PSQL) throw new Error("The owned local SQL fixture transport is required.");
  knownSecrets.push(local.E2E_ARMY_LOCAL_DB_URL, decodeURIComponent(new URL(local.E2E_ARMY_LOCAL_DB_URL).password));
  const admin = createClient<Database>(backend.origin, local.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const email = `army-ci-${randomUUID()}@example.test`;
  const password = `Army-${randomUUID()}-A1!`;
  knownSecrets.push(email, password);
  const { data: user, error: userError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (userError || !user.user) throw new Error("Could not create the local ARMY account.");
  if (suite === "dev" && developmentStop.signal.aborted) return;
  const { data: memberships, error: membershipError } = await admin.from("tenant_memberships")
    .select("tenant_id, role, is_default").eq("user_id", user.user.id);
  if (membershipError || memberships?.length !== 1 || memberships[0].role !== "admin" || !memberships[0].is_default) {
    throw new Error("New ARMY account must own exactly one default personal admin tenant.");
  }
  const tenantId = memberships[0].tenant_id;
  if (suite === "dev" && developmentStop.signal.aborted) return;
  const { data: tenant, error: tenantError } = await admin.from("tenants")
    .update({ name: `ARMY CI ${suite}` }).eq("id", tenantId).eq("created_by", user.user.id)
    .eq("is_active", true).select("id").single();
  if (tenantError || tenant?.id !== tenantId) throw new Error("Could not verify the newly owned ARMY tenant.");
  if (suite === "dev" && developmentStop.signal.aborted) return;
  // GEN's reviewed one-hour component costs exactly 4,000 cents. Create its
  // basis only for this newly provisioned CI owner, never alter existing roles.
  const { data: laborRole, error: laborRoleError } = await admin.from("labor_roles").insert({
    tenant_id: tenantId, user_id: user.user.id, name: "ARMY CI generated-work basis",
    hourly_rate_cents: 4000, position: 0, is_active: true,
  }).select("id, tenant_id, user_id, hourly_rate_cents, position, is_active").single();
  if (laborRoleError || !laborRole) throw new Error("Could not create the owned GEN labor-rate basis.");
  if (suite === "dev" && developmentStop.signal.aborted) return;
  const { data: preferredRole, error: preferredRoleError } = await admin.from("labor_roles")
    .select("id, hourly_rate_cents, position").eq("tenant_id", tenantId).eq("user_id", user.user.id)
    .eq("is_active", true).order("position", { ascending: true }).order("id", { ascending: true }).limit(1).single();
  if (preferredRoleError || preferredRole?.id !== laborRole.id || preferredRole.hourly_rate_cents !== 4000 || preferredRole.position !== 0) {
    throw new Error("The owned GEN basis must be the first active labor role at exactly 4,000 cents.");
  }
  if (suite === "dev" && developmentStop.signal.aborted) return;
  const { data: article, error: articleError } = await admin.from("products").insert({
    tenant_id: tenantId, reference: "ARMY-CU22-ML", designation: "ARMY cuivre plomberie 22 mm",
    unit: "ml", unit_price_cents: 1234, is_active: true,
  }).select("id").single();
  if (articleError || !article) throw new Error("Could not create the local ARMY catalogue fixture.");
  manifest.fixtures = { userId: user.user.id, tenantId, articleId: article.id, laborRole, backend: backend.origin, lifecycle: "destroyed with the owned stack" };

  fs.mkdirSync(path.join(root, ".e2e/army/coverage"), { recursive: true });
  const environment: NodeJS.ProcessEnv = {
    ...createLocalCiEnvironment(process.env),
    CI: "1", E2E_TELEMETRY_DISABLED: "1", NEXT_TELEMETRY_DISABLED: "1", DO_NOT_TRACK: "1",
    NEXT_PUBLIC_SUPABASE_URL: backend.origin,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: local.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: local.SUPABASE_SERVICE_ROLE_KEY,
    E2E_LOGIN_EMAIL: email, E2E_LOGIN_PASSWORD: password, E2E_ALLOWED_SUPABASE_HOST: backend.hostname,
    E2E_ARMY_BASE_URL: `http://localhost:${appPort}`, E2E_ARMY_SERVER_MODE: "production",
    E2E_COVERAGE_BACKEND_ORIGIN: backend.origin,
    E2E_COVERAGE_NETWORK_LOG: path.join(root, ".e2e/army/coverage/ci-server-network.jsonl"),
    TAKEOFF_MODULE_ENABLED_BY_DEFAULT: "1",
    RESEND_API_KEY: "", EMAIL_FROM: "", GEMINI_API_KEY: "", GOOGLE_GENERATIVE_AI_API_KEY: "",
  };
  if (suite === "dev") {
    manifest.development = await runLocalDevelopmentSession({
      root, evidence, port: appPort, environment, email, password,
      networkLog: developmentNetworkLog, signal: developmentStop.signal, redact,
    });
    return;
  }
  await runNode(["scripts/tester-army/build-local.mjs", "--execute"], environment, "build");
  // Only the Node journey process receives this transport. The app uses the
  // e2e.config.ts inheritEnv allowlist; the production build never receives it.
  const journeyEnvironment = {
    ...environment,
    E2E_ARMY_LOCAL_DB_URL: local.E2E_ARMY_LOCAL_DB_URL,
    E2E_ARMY_LOCAL_PSQL: local.E2E_ARMY_LOCAL_PSQL,
    ...(workers === "" ? {} : { E2E_ARMY_WORKERS: workers }),
  };
  const failures: string[] = [];
  for (const phase of suite === "full" ? ["full", "development"] : [suite!]) {
    try {
      await runJourneys(phase, phase === "development"
        ? { ...journeyEnvironment, E2E_ARMY_SERVER_MODE: "development" }
        : journeyEnvironment);
    } catch (error) {
      retainCurrentJourney(true);
      const message = redact(error instanceof Error ? error.message : String(error));
      const phases = (manifest.phases ??= []) as unknown[];
      phases.push({ phase, status: "failed", error: message });
      failures.push(`${phase}: ${message}`);
    }
  }
  if (failures.length) throw new Error(failures.join("; "));
}

async function runJourneys(phase: string, environment: NodeJS.ProcessEnv) {
  await assertLocalAppPortAvailable(appPort);
  manifest.phase = phase;
  manifest.campaignStartedAt = new Date().toISOString();
  await runNode(["scripts/run-tester-army.mjs", phase, ...(grep ? ["--grep", grep] : [])], environment, `journeys-${phase}`);
  const report = JSON.parse(fs.readFileSync(path.join(root, ".e2e/army/critical/report.json"), "utf8"));
  const run = report.run;
  type JourneyResult = { selected: boolean; status: string; kind: string; file: string;
    titlePath: string[]; tags: string[]; targetId: string };
  const results: JourneyResult[] = run?.results?.filter((result: JourneyResult) => result.selected) ?? [];
  const authenticatedTargets = new Set(results.filter((result) => result.kind === "setup" &&
    result.file === "e2e/army/critical/auth.setup.e2e.ts" && result.status === "passed" &&
    result.titlePath?.length === 1 &&
    result.titlePath[0] === "authenticate the existing E2E account without provisioning memberships"
  ).map((result) => result.targetId));
  const businessResults = results.filter((result) => result.kind === "test" &&
    result.tags?.includes("critical") && !result.tags.includes("anonymous"));
  if (authenticatedTargets.size === 0 || businessResults.length === 0 ||
    businessResults.some((result) => !authenticatedTargets.has(result.targetId))) {
    throw new Error("Business validation requires the exact passing ARMY login setup and a non-anonymous business test on each selected business target.");
  }
  if (run?.exitCode !== 0 || run.errors?.length || results.length < 2 ||
    results.some((result: { status: string }) => result.status !== "passed") ||
    ["failed", "skipped", "flaky", "interrupted"].some((key) => (run.summary?.[key] ?? 0) !== 0) ||
    ["selected", "executed", "passed"].some((key) => run.summary?.[key] !== results.length)) {
    throw new Error("TesterArmy must execute every selected business journey without skip, retry success or interruption.");
  }
  const armyManifest = JSON.parse(fs.readFileSync(path.join(root, ".e2e/army/critical/manifest.json"), "utf8"));
  if (armyManifest.source?.changedDuringRun !== false ||
    (phase !== "development" && armyManifest.productionBuild?.changedDuringRun !== false)) {
    throw new Error("The source and production build must stay unchanged throughout the campaign.");
  }
  const phases = (manifest.phases ??= []) as unknown[];
  phases.push({ phase, status: "passed", result: run.summary });
  retainCurrentJourney(true);
}

function retainCurrentJourney(required = false) {
  const source = path.join(root, ".e2e/army/critical");
  const currentManifest = path.join(source, "manifest.json");
  if (!manifest.campaignStartedAt || !fs.existsSync(currentManifest) ||
    fs.statSync(currentManifest).mtimeMs < Date.parse(String(manifest.campaignStartedAt))) {
    if (required) throw new Error("The current phase must retain a fresh manifest before another phase can run.");
    return;
  }
  const current = JSON.parse(fs.readFileSync(currentManifest, "utf8"));
  const setupFailure = current.failureArchive?.status === "retained";
  const archive = setupFailure ? current.failureArchive : current.archive;
  if (!archive?.path || !archive.manifestSha256) throw new Error("The current phase must retain its own verifiable archive.");
  const archiveSource = path.resolve(root, archive.path);
  const archiveRelative = path.relative(source, archiveSource);
  if (!archiveRelative.startsWith(`runs${path.sep}`) || archiveRelative.split(path.sep).includes("..")) {
    throw new Error("The phase archive must remain inside the owned runs directory.");
  }
  const archiveBytes = fs.readFileSync(path.join(archiveSource, "manifest.json"));
  if (createHash("sha256").update(archiveBytes).digest("hex") !== archive.manifestSha256) {
    throw new Error("The phase archive manifest does not match its retained fingerprint.");
  }
  const phaseEvidence = path.join(evidence, String(manifest.phase));
  fs.cpSync(archiveSource, path.join(phaseEvidence, archiveRelative), { recursive: true });
  for (const name of setupFailure ? ["manifest.json"] : ["manifest.json", "report.json", "results", "artifacts"]) {
    const input = path.join(source, name);
    if (fs.existsSync(input)) fs.cpSync(input, path.join(phaseEvidence, name), { recursive: true });
  }
}

function retainEvidence() {
  retainCurrentJourney();
  const builds = path.join(root, ".e2e/army/recipes/builds");
  if (fs.existsSync(builds)) for (const build of fs.readdirSync(builds)) {
    const input = path.join(builds, build, "manifest.json");
    if (fs.existsSync(input) && fs.statSync(input).mtimeMs >= Date.parse(String(manifest.startedAt))) {
      fs.mkdirSync(path.join(evidence, "builds", build), { recursive: true });
      fs.copyFileSync(input, path.join(evidence, "builds", build, "manifest.json"));
      const log = path.join(builds, build, "build.log");
      if (fs.existsSync(log)) fs.copyFileSync(log, path.join(evidence, "builds", build, "build.log"));
    }
  }
  const files: Array<{ path: string; sha256: string }> = [];
  function inspect(directory: string) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("CI evidence must not contain symlinks.");
      if (entry.isDirectory()) { if (entry.name === "sessions") throw new Error("Browser sessions cannot be published."); inspect(file); continue; }
      const bytes = fs.readFileSync(file);
      const text = bytes.toString("utf8");
      if (knownSecrets.some((secret) => secret && (text.includes(secret) || text.includes(encodeURIComponent(secret)))) ||
        /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(text) ||
        /Bearer\s+[A-Za-z0-9._~+/-]+=*/i.test(text)) throw new Error("CI evidence failed the privacy check; upload is forbidden.");
      files.push({ path: path.relative(evidence, file).replaceAll("\\", "/"), sha256: createHash("sha256").update(bytes).digest("hex") });
    }
  }
  inspect(evidence);
  manifest.files = files;
  manifest.privacy = "passed";
}

async function main() {
  if (suite === "dev") {
    process.on("SIGINT", interruptDevelopment);
    process.on("SIGTERM", terminateDevelopment);
  }
  try {
    createLocalCiEnvironment(process.env);
    if (fs.readdirSync(root).some((name) => /^\.env(?:\.(?:local|production|development|test)(?:\.local)?)?$/.test(name))) {
      throw new Error("CI refuses ambient .env files; use a clean checkout without shared backend credentials.");
    }
    await assertLocalAppPortAvailable(appPort);
    manifest.source = await buildSourceEvidence();
    manifest.database = {
      migrations: await sqlInventory(path.join(root, "supabase/migrations")),
      tests: await sqlInventory(path.join(root, "supabase/tests/database")),
    };
    await runLocalSupabaseCi({
      reservedPorts: new Set([appPort]),
      runApplication,
      log: (message) => {
        const line = redact(suite === "dev" && message === "Application validation passed."
          ? "Development session stopped; no E2E validation was run."
          : message);
        fs.appendFileSync(path.join(evidence, "database.log"), `${line}\n`);
        console.log(line);
      },
    });
    manifest.status = suite === "dev" ? "stopped" : "passed";
  } catch (error) {
    manifest.status = "failed";
    manifest.error = redact(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    manifest.finishedAt = new Date().toISOString();
    if (suite === "dev") {
      process.off("SIGINT", interruptDevelopment);
      process.off("SIGTERM", terminateDevelopment);
      manifest.stopRequested = developmentStop.signal.aborted ? developmentStop.signal.reason : null;
      try {
        manifest.sourceAfter = await buildSourceEvidence();
        manifest.sourceChanged = JSON.stringify(manifest.source) !== JSON.stringify(manifest.sourceAfter);
        manifest.databaseAfter = { migrations: await sqlInventory(path.join(root, "supabase/migrations")) };
        if (fs.existsSync(developmentNetworkLog)) {
          fs.writeFileSync(path.join(evidence, "server-network.jsonl"), redact(fs.readFileSync(developmentNetworkLog, "utf8")));
        }
      } catch {
        manifest.status = "failed";
        manifest.error = "Development source or network evidence could not be retained.";
        process.exitCode = 1;
      }
    }
    try { retainEvidence(); } catch (error) {
      manifest.privacy = "failed";
      manifest.status = "failed";
      manifest.error = redact(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
    fs.writeFileSync(path.join(evidence, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    if (process.env.GITHUB_OUTPUT && manifest.privacy === "passed") fs.appendFileSync(process.env.GITHUB_OUTPUT, `evidence=${path.relative(root, evidence)}\n`);
    console.log(`TesterArmy CI ${manifest.status}; evidence: ${path.relative(root, evidence)}`);
  }
}

void main();
