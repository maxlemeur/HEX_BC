import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Server } from "node:http";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../src/types/database";
import { prepareCalcV3Fixtures, type CalcV3FixtureContext, type CalcV3Owner, type CalcV3PhaseFixtures } from "./calc-v3-fixtures";
import {
  CALC_V3_EMAIL_FROM, CALC_V3_FORBIDDEN_PORTS, CALC_V3_PHASE_DEFINITIONS, CALC_V3_PHASES, type CalcV3Phase,
} from "./calc-v3-phases";
import { assertLocalAppPortAvailable } from "./local-development";
import { buildSourceEvidence, prepareArmyTypeScriptConfig } from "./local-recipe-common.mjs";
import { extractCollectedPdfTexts } from "./pdf-text";

type Collector = { server: Server; origin: string; directory: string; close: () => Promise<void> };

// Lot 2 baseline campaign on the owned ephemeral stack, started by
// `scripts/run-tester-army-ci.ts calc-v3` once pgTAP and RLS have passed.
// Contract and failure modes: docs/testing/tester-army-calc-v3.md. Each phase
// is its own TesterArmy invocation of e2e.calc-v3.config.ts with fresh
// fixtures; every phase serves the same owned production build (`next start`),
// the emission phases last, with the sentinel collector. A phase passes only when
// every selected result passed, nothing was skipped, retried, interrupted or
// silently deselected, its server guard reported, the sources and build stayed
// frozen and its evidence survived redaction.

export type CalcV3CampaignInput = {
  root: string;
  /** Runner evidence directory (.e2e/army/ci/<stamp>-calc-v3), privacy-checked after the campaign. */
  evidence: string;
  appPort: number;
  /** The runner's journey environment: owned backend, fresh ARMY login, no PostgreSQL route. */
  environment: NodeJS.ProcessEnv;
  backend: string;
  anonKey: string;
  databaseUrl: string;
  psql: string;
  admin: SupabaseClient<Database>;
  owner: CalcV3Owner;
  phase?: CalcV3Phase;
  grep?: string;
  remember: (secret: string) => void;
  redact: (value: string) => string;
  /** Owned production build (scripts/tester-army/build-local.mjs), run once before production phases. */
  build: () => Promise<void>;
};

type PhaseSummary = Record<string, unknown> & { phase: CalcV3Phase; status: "passed" | "failed" };
type ReportResult = { selected: boolean; status: string; kind: string; file: string; titlePath: string[]; targetId: string };

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const TEXT_EVIDENCE = /\.(?:json|jsonl|txt|md|log|html|csv|xml)$/i;

export function scrubber(redact: (value: string) => string) {
  return (text: string) => redact(text)
    .replace(/([?&#](?:password|access_token|refresh_token|token|code|apikey|api_key)=)[^&\s"']*/gi, "$1<redacted>")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1<redacted>")
    .replace(/eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]*){0,2}/g, "<redacted-jwt>")
    .replace(/\/portal\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/gi, "/portal/<redacted>")
    .replace(/("(?:password|access_token|refresh_token|session_id|sessionId|draftLockSessionId)"\s*:\s*")[^"]*(")/gi, "$1<redacted>$2");
}

function scrubJson(value: unknown, scrub: (text: string) => string): unknown {
  if (typeof value === "string") return scrub(value);
  if (Array.isArray(value)) return value.map((entry) => scrubJson(entry, scrub));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, scrubJson(entry, scrub)]));
  return value;
}

/** Copies owned evidence, never sessions or private material, scrubbing every text file. */
export function copyScrubbed(source: string, target: string, scrub: (text: string) => string, files: string[] = []) {
  if (!fs.existsSync(source)) return files;
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) throw new Error("calc-v3 evidence must not contain symlinks.");
  if (stat.isDirectory()) {
    if (["sessions", "private"].includes(path.basename(source))) return files;
    for (const entry of fs.readdirSync(source)) copyScrubbed(path.join(source, entry), path.join(target, entry), scrub, files);
    return files;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (TEXT_EVIDENCE.test(source)) {
    const text = fs.readFileSync(source, "utf8");
    let clean: string;
    if (source.endsWith(".json")) {
      try { clean = `${JSON.stringify(scrubJson(JSON.parse(text), scrub), null, 2)}\n`; }
      catch { clean = scrub(text); }
    } else clean = scrub(text);
    fs.writeFileSync(target, clean);
  } else fs.copyFileSync(source, target);
  files.push(target);
  return files;
}

function fingerprint(files: string[], root: string) {
  return files.filter((file) => fs.existsSync(file)).map((file) => ({ path: path.relative(root, file).replaceAll("\\", "/"), sha256: sha256(fs.readFileSync(file)) }));
}

function filesIn(directory: string): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : entry.isFile() ? [file] : [];
  }).sort();
}

async function campaignSources(root: string) {
  const source = await buildSourceEvidence();
  const journeys = fingerprint([...filesIn(path.join(root, "e2e", "army")), path.join(root, "e2e.calc-v3.config.ts"), path.join(root, "e2e.config.ts")], root);
  return { revision: source.revision, diffSha256: source.diffSha256, inputsSha256: sha256(JSON.stringify(source.inputs)), journeysSha256: sha256(JSON.stringify(journeys)) };
}

function buildIdentity(root: string) {
  const directory = path.join(root, ".e2e", "army", "next");
  return fingerprint(["BUILD_ID", "required-server-files.json", "build-manifest.json"].map((name) => path.join(directory, name)), root);
}

function businessSnapshot(root: string) {
  const directory = path.join(root, ".e2e", "army", "critical", "artifacts", "business");
  return new Map(filesIn(directory).map((file) => { const stat = fs.statSync(file); return [file, `${stat.mtimeMs}:${stat.size}`]; }));
}

async function runTesterArmy(root: string, args: string[], env: NodeJS.ProcessEnv, logFile: string, scrub: (text: string) => string, deadlineMs: number) {
  const chunks: Buffer[] = [];
  let bytes = 0;
  const exitCode = await new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    const capture = (chunk: Buffer) => { bytes += chunk.length; if (bytes <= 64 * 1024 * 1024) chunks.push(chunk); };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const interrupt = () => child.kill("SIGINT");
    const terminate = () => child.kill("SIGTERM");
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = setTimeout(() => { child.kill("SIGTERM"); killTimer = setTimeout(() => child.kill("SIGKILL"), 30_000); }, deadlineMs);
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    const done = () => { clearTimeout(deadline); if (killTimer) clearTimeout(killTimer); process.off("SIGINT", interrupt); process.off("SIGTERM", terminate); };
    child.once("error", (error) => { done(); reject(error); });
    child.once("close", (code, signal) => { done(); resolve(code ?? (signal ? 130 : 3)); });
  });
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, scrub(Buffer.concat(chunks).toString("utf8")));
  return exitCode;
}

/** Exact result accounting of one phase report; a filtered run only proves what it selected. */
function validateReport(phase: CalcV3Phase, output: string, startedAt: Date, filtered: boolean) {
  const definition = CALC_V3_PHASE_DEFINITIONS[phase];
  const reportPath = path.join(output, "report.json");
  if (!fs.existsSync(reportPath)) throw new Error(`${phase}: TesterArmy produced no report.`);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const run = report.run;
  if (!Number.isFinite(Date.parse(run?.startedAt ?? "")) || Date.parse(run.startedAt) < startedAt.getTime() - 1000) {
    throw new Error(`${phase}: the report is not fresh for this invocation.`);
  }
  const results = ((run.results ?? []) as ReportResult[]).filter((result) => result.selected);
  const setup = results.filter((result) => result.kind === "setup" && result.file === definition.tests[0] &&
    result.titlePath?.length === 1 && result.titlePath[0] === definition.setupTitle && result.status === "passed");
  const business = results.filter((result) => result.kind === "test" && result.status === "passed");
  const passedByFile: Record<string, number> = {};
  for (const result of results) if (result.status === "passed") passedByFile[result.file] = (passedByFile[result.file] ?? 0) + 1;
  const summary = run.summary ?? {};
  const problems: string[] = [];
  if (run.exitCode !== 0 || (run.errors ?? []).length) problems.push("runner exit code or global errors");
  if (results.some((result) => result.status !== "passed")) problems.push("a selected result did not pass");
  if (["failed", "skipped", "flaky", "interrupted"].some((key) => (summary[key] ?? 0) !== 0)) problems.push("failed, skipped, flaky or interrupted results");
  if (["selected", "executed", "passed"].some((key) => summary[key] !== results.length)) problems.push("selected, executed and passed counts differ");
  if (setup.length !== 1 || business.length === 0) problems.push("the exact phase login setup and a business journey must both pass");
  if ((run.usage?.modelTokens ?? 0) !== 0 || (run.usage?.maxModelCallsInStep ?? 0) !== 0) problems.push("a model was invoked");
  if (!filtered) {
    const expectedFiles = Object.keys(definition.expected).sort();
    if (JSON.stringify(Object.keys(passedByFile).sort()) !== JSON.stringify(expectedFiles) ||
      expectedFiles.some((file) => passedByFile[file] !== definition.expected[file])) problems.push("passed results differ from the phase's expected selection");
  }
  return {
    report: { sha256: sha256(fs.readFileSync(reportPath)), runner: run.runner ?? null, summary, usage: run.usage ?? null },
    expected: filtered ? "filtered: only the selected results are proven" : definition.expected,
    actual: passedByFile,
    results: results.map((result) => ({ file: result.file, kind: result.kind, titlePath: result.titlePath, status: result.status })),
    problems,
  };
}

function networkReceipt(file: string, kind: "coverage" | "offer") {
  if (!fs.existsSync(file)) return { present: false, guardInstalled: false, allowed: 0, denied: 0 };
  const entries = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { kind?: string; allowed?: boolean; pid?: number; role?: string });
  return {
    present: true, schema: kind,
    guardInstalled: entries.some((entry) => entry.kind === "guard-installed" && entry.pid !== process.pid),
    allowed: entries.filter((entry) => entry.kind !== "guard-installed" && entry.allowed === true).length,
    denied: entries.filter((entry) => entry.allowed === false).length,
    ...(kind === "offer" ? { collectorCalls: entries.filter((entry) => entry.role === "collector").length } : {}),
  };
}

async function runPhase(input: CalcV3CampaignInput, phase: CalcV3Phase, runStamp: string, scrub: (text: string) => string): Promise<PhaseSummary> {
  const definition = CALC_V3_PHASE_DEFINITIONS[phase];
  const root = input.root;
  const phaseEvidence = path.join(input.evidence, phase);
  fs.mkdirSync(phaseEvidence, { recursive: true });
  const summary: PhaseSummary = { phase, status: "failed", serverMode: definition.serverMode, startedAt: new Date().toISOString(),
    knownRedAtBase: definition.knownRedAtBase ?? null };
  const filtered = Boolean(input.grep);
  const grep = input.grep ?? definition.defaultGrep;
  let output = "";
  let runDirectory = "";
  let collector: Collector | undefined;
  const businessBefore = businessSnapshot(root);
  try {
    await assertLocalAppPortAvailable(input.appPort);
    await prepareArmyTypeScriptConfig(root);
    let fixtures: CalcV3PhaseFixtures;
    const fixtureContext: CalcV3FixtureContext = {
      directory: path.join(input.evidence, "fixtures", phase), backend: input.backend, anonKey: input.anonKey, admin: input.admin,
      databaseUrl: input.databaseUrl, psql: input.psql, owner: input.owner, remember: input.remember,
    };
    try {
      fixtures = await prepareCalcV3Fixtures(phase, fixtureContext);
    } catch (error) {
      throw new Error(`fixture preparation: ${error instanceof Error ? error.message : String(error)}`);
    }
    for (const value of [...Object.values(fixtures.secretEnv), fixtures.login?.email, fixtures.login?.password]) if (value) input.remember(value);
    summary.fixtures = { env: Object.keys(fixtures.env), identities: fixtures.identities, dedicatedLogin: Boolean(fixtures.login) };
    const environment: NodeJS.ProcessEnv = {
      ...input.environment,
      E2E_ARMY_SUITE: "calc-v3", E2E_CALC_V3_OWNED_STACK: "1", E2E_CALC_V3_PHASE: phase,
      E2E_ARMY_SERVER_MODE: definition.serverMode, E2E_COVERAGE_BACKEND_ORIGIN: input.backend,
      ...fixtures.env, ...fixtures.secretEnv,
      // Only the owned portal clock fixture needs SQL from a journey process.
      // The app's explicit inheritEnv list never forwards this transport.
      ...(phase === "resend-portal" ? { E2E_ARMY_LOCAL_DB_URL: input.databaseUrl, E2E_ARMY_LOCAL_PSQL: input.psql } : {}),
      ...(fixtures.login ? { E2E_LOGIN_EMAIL: fixtures.login.email, E2E_LOGIN_PASSWORD: fixtures.login.password } : {}),
    };
    let networkLog: string;
    if (definition.sentinelCollector) {
      // Dynamic import: the collector module has a top-level-await CLI block that
      // tsx cannot compile to the CommonJS form this runner is loaded in.
      const { COLLECTOR_SENTINEL, startCollector } = await import("./offer-collector.mjs");
      runDirectory = path.join(root, ".e2e", "army", "offer", "runs", `${runStamp}-calc-v3-${randomUUID()}`);
      fs.mkdirSync(path.join(runDirectory, "public"), { recursive: true });
      fs.mkdirSync(path.join(runDirectory, "private"), { mode: 0o700 });
      // offer-emission fixtures require exactly <run>/collector, with receipts/ inside.
      const collectorDirectory = path.join(runDirectory, "collector");
      fs.mkdirSync(collectorDirectory);
      const faultPlanPath = path.join(runDirectory, "private", "collector-faults.json");
      const attemptLogPath = path.join(runDirectory, "public", "collector-attempts.jsonl");
      for (let attempt = 0; attempt < 3 && !collector; attempt += 1) {
        const started = await startCollector({ directory: collectorDirectory, faultPlanPath, attemptLogPath });
        if (!CALC_V3_FORBIDDEN_PORTS.has(new URL(started.origin).port)) { collector = started; break; }
        await started.close();
        fs.rmdirSync(path.join(collectorDirectory, "receipts")); // created by this attempt and still empty
      }
      if (!collector) throw new Error("the sentinel collector could not obtain a port outside the developers' stack.");
      const httpLog = path.join(runDirectory, "public", "collector-http.jsonl");
      fs.writeFileSync(httpLog, "", { flag: "wx" });
      collector.server.on("request", (request, response) => {
        response.once("finish", () => fs.appendFileSync(httpLog, `${JSON.stringify({
          schemaVersion: 1, time: new Date().toISOString(), method: request.method,
          route: request.url === "/emails" ? "emails" : "other", status: response.statusCode,
        })}\n`));
      });
      output = path.join(runDirectory, "sdk");
      networkLog = path.join(runDirectory, "public", "server-network.jsonl");
      Object.assign(environment, {
        E2E_OFFER_APP_ORIGIN: environment.E2E_ARMY_BASE_URL, E2E_OFFER_BACKEND_ORIGIN: input.backend,
        E2E_OFFER_COLLECTOR_ORIGIN: collector.origin, E2E_OFFER_RUN_DIRECTORY: runDirectory,
        E2E_OFFER_COLLECTOR_DIRECTORY: collector.directory, E2E_OFFER_SECRET_POINTER: path.join(runDirectory, "private", "portal-pointer.json"),
        E2E_OFFER_COLLECTOR_HTTP_LOG: httpLog, E2E_OFFER_FAULT_PLAN: faultPlanPath, E2E_OFFER_ATTEMPT_LOG: attemptLogPath,
        E2E_OFFER_NETWORK_LOG: networkLog, E2E_OFFER_SERVER_MODE: definition.serverMode === "production" ? "production" : "dev",
        RESEND_BASE_URL: collector.origin, RESEND_API_KEY: COLLECTOR_SENTINEL, EMAIL_FROM: CALC_V3_EMAIL_FROM,
      });
      summary.collector = { origin: collector.origin, delivery: "local-collection-only" };
    } else {
      output = path.join(root, ".e2e", "army", "calc-v3", "runs", runStamp, phase);
      fs.mkdirSync(output, { recursive: true });
      networkLog = path.join(root, ".e2e", "army", "coverage", `${runStamp}-calc-v3-${phase}-network.jsonl`);
      environment.E2E_COVERAGE_NETWORK_LOG = networkLog;
    }
    environment.E2E_CALC_V3_OUTPUT = output;
    environment.E2E_ARMY_ARTIFACT_ROOT = path.join(output, "results");
    const args = [path.join(root, "node_modules", "e2e", "dist", "cli", "bin.js"), "run", "--config", "e2e.calc-v3.config.ts",
      "--target", definition.target ?? "chromium-desktop", "--workers", "1", "--retries", "0", "--trace", "off", "--no-cache", ...(grep ? ["--grep", grep] : [])];
    const buildBefore = definition.serverMode === "production" ? buildIdentity(root) : null;
    const startedAt = new Date();
    summary.command = [process.execPath, ...args.map((arg) => path.isAbsolute(arg) ? path.relative(root, arg).replaceAll("\\", "/") : arg)];
    summary.environmentNames = Object.keys(environment).filter((name) => name.startsWith("E2E_") || name.startsWith("NEXT_PUBLIC_")).sort();
    summary.grep = grep ?? null;
    summary.filtered = filtered;
    let exitCode: number;
    let fixtureEffectError: string | undefined;
    try {
      exitCode = await runTesterArmy(root, args, environment, path.join(phaseEvidence, "runner.log"), scrub, definition.maxDuration + 600_000);
    } finally {
      // A failed UI assertion still needs an independent witness that the
      // intended late native fault was reached, with no transactional writes.
      try {
        const { verifyCoverageFixtureEffects } = await import("./coverage-fixtures");
        summary.fixtureEffects = await verifyCoverageFixtureEffects(phase, fixtureContext, fixtures, filtered);
      } catch (error) {
        fixtureEffectError = scrub(error instanceof Error ? error.message : String(error));
        summary.fixtureEffects = { status: "failed", error: fixtureEffectError };
      }
    }
    summary.exitCode = exitCode;
    if (collector) { await collector.close(); summary.collectorStopped = true; }
    const pointer = path.join(runDirectory, "private", "portal-pointer.json");
    if (runDirectory && fs.existsSync(pointer)) {
      const value = JSON.parse(fs.readFileSync(pointer, "utf8")) as { portalUrl?: unknown; portalToken?: unknown };
      for (const secret of [value.portalUrl, value.portalToken]) if (typeof secret === "string" && secret) input.remember(secret);
    }
    const validation = validateReport(phase, output, startedAt, filtered);
    summary.validation = validation;
    const problems = [...validation.problems];
    if (fixtureEffectError) problems.push(`fixture effects: ${fixtureEffectError}`);
    if (exitCode !== 0) problems.push(`TesterArmy exited ${exitCode}`);
    const network = networkReceipt(networkLog, definition.sentinelCollector ? "offer" : "coverage");
    summary.serverNetwork = network;
    if (!network.guardInstalled) problems.push("the server network guard did not report its installation");
    if (buildBefore) {
      const buildAfter = buildIdentity(root);
      summary.productionBuild = { identity: buildBefore, changedDuringRun: JSON.stringify(buildAfter) !== JSON.stringify(buildBefore) };
      if (buildBefore.length !== 3 || JSON.stringify(buildAfter) !== JSON.stringify(buildBefore)) problems.push("the production build is missing or changed during the phase");
    }
    if (definition.sentinelCollector && collector) {
      const texts = await extractCollectedPdfTexts(collector.directory, { root });
      summary.collectedPdfs = texts.map((text) => ({ receiptId: text.receiptId, receivedAt: text.receivedAt, sha256: text.sha256, bytes: text.bytes,
        pageCount: text.pageCount, characters: text.characters, mentionsArmyOffer: text.pages.some((page) => page.includes("ARMY-OFFER-")) }));
      for (const text of texts) {
        const file = path.join(phaseEvidence, "pdf-text", `${text.receiptDirectory}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify(scrubJson({ schemaVersion: "calc-v3-collected-pdf-text-1", ...text }, scrub), null, 2)}\n`);
      }
      if (!filtered && texts.length === 0) problems.push("no emitted PDF reached the sentinel collector");
      if (!filtered) {
        for (const text of texts) {
          const content = text.pages.join("\n");
          const missing = (definition.collectedPdfMustContain ?? []).filter((pattern) => !pattern.test(content));
          if (missing.length) problems.push(`emitted PDF ${text.receiptId} lacks ${missing.map(String).join(", ")}`);
        }
      }
    }
    if (problems.length) throw new Error(problems.join("; "));
    summary.status = "passed";
  } catch (error) {
    summary.error = scrub(error instanceof Error ? error.message : String(error));
  } finally {
    if (collector) await collector.close().catch(() => undefined);
    const copied: string[] = [];
    try {
      if (output) {
        for (const name of ["report.json", "results", "logs", "summary.md"]) copyScrubbed(path.join(output, name), path.join(phaseEvidence, "sdk", name), scrub, copied);
      }
      if (runDirectory) {
        copyScrubbed(path.join(runDirectory, "public"), path.join(phaseEvidence, "offer-public"), scrub, copied);
        for (const receipt of filesIn(path.join(runDirectory, "collector")).filter((file) => file.endsWith(`${path.sep}public${path.sep}receipt.json`))) {
          copyScrubbed(receipt, path.join(phaseEvidence, "collector", path.relative(path.join(runDirectory, "collector"), receipt)), scrub, copied);
        }
      } else {
        const log = path.join(root, ".e2e", "army", "coverage", `${runStamp}-calc-v3-${phase}-network.jsonl`);
        copyScrubbed(log, path.join(phaseEvidence, "server-network.jsonl"), scrub, copied);
      }
      const businessDirectory = path.join(root, ".e2e", "army", "critical", "artifacts", "business");
      for (const [file, signature] of businessSnapshot(root)) {
        if (businessBefore.get(file) !== signature) copyScrubbed(file, path.join(phaseEvidence, "business", path.relative(businessDirectory, file)), scrub, copied);
      }
      summary.evidence = { directory: path.relative(input.evidence, phaseEvidence).replaceAll("\\", "/"), files: copied.length,
        sdkOutput: output ? path.relative(root, output).replaceAll("\\", "/") : null, offerCampaign: runDirectory ? path.relative(root, runDirectory).replaceAll("\\", "/") : null };
    } catch (error) {
      summary.status = "failed";
      summary.evidenceError = scrub(error instanceof Error ? error.message : String(error));
    }
    summary.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(phaseEvidence, "phase.json"), `${JSON.stringify(summary, null, 2)}\n`);
  }
  return summary;
}

/** Runs the selected calc-v3 phases on the owned stack; throws when any phase lacks proof. */
export async function runCalcV3Campaign(input: CalcV3CampaignInput) {
  for (const origin of [input.backend, String(input.environment.E2E_ARMY_BASE_URL ?? "")]) {
    const url = new URL(origin);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost"].includes(url.hostname) || CALC_V3_FORBIDDEN_PORTS.has(url.port)) {
      throw new Error("calc-v3 refuses a non-owned or developers' long-running stack origin.");
    }
  }
  const scrub = scrubber(input.redact);
  const phases = input.phase ? [input.phase] : [...CALC_V3_PHASES];
  const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
  // A stop request ends the campaign after the current step; the runner's
  // finally still destroys the owned stack. Children receive the terminal's
  // SIGINT directly and TesterArmy children are also signalled by runTesterArmy.
  let interrupted: NodeJS.Signals | null = null;
  const onSigint = () => { interrupted ??= "SIGINT"; };
  const onSigterm = () => { interrupted ??= "SIGTERM"; };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  try {
    const sourcesBefore = await campaignSources(input.root);
    const campaign: Record<string, unknown> = { schemaVersion: "calc-v3-campaign-1", phases: [], selection: { phase: input.phase ?? "all", grep: input.grep ?? null }, sourcesBefore };
    if (phases.some((phase) => CALC_V3_PHASE_DEFINITIONS[phase].serverMode === "production")) await input.build();
    const failures: string[] = [];
    for (const phase of phases) {
      if (interrupted) { failures.push(`campaign stopped by ${interrupted} before ${phase}`); break; }
      const summary = await runPhase(input, phase, runStamp, scrub);
      (campaign.phases as unknown[]).push({ phase, status: summary.status, evidence: `${phase}/phase.json`, ...(summary.error ? { error: summary.error } : {}) });
      if (summary.status !== "passed") failures.push(`${phase}: ${summary.error ?? summary.evidenceError ?? "missing proof"}`);
    }
    const sourcesAfter = await campaignSources(input.root);
    campaign.sourcesAfter = sourcesAfter;
    campaign.sourcesChanged = JSON.stringify(sourcesAfter) !== JSON.stringify(sourcesBefore);
    if (campaign.sourcesChanged) failures.push("sources changed during the campaign");
    campaign.stopRequested = interrupted;
    fs.writeFileSync(path.join(input.evidence, "calc-v3.json"), `${JSON.stringify(campaign, null, 2)}\n`);
    if (failures.length) throw new Error(failures.join("; "));
    return campaign;
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
}
