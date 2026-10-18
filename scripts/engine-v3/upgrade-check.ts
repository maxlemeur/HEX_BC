// Lot 2 upgrade check on a populated database (design §10.2), run in WSL like
// `npm run db:ci:local`: `npm run db:upgrade-check -- <label>`.
//
// It owns a disposable native Supabase stack modeled on runLocalSupabaseCi:
// isolated temporary project, free ports outside the host ephemeral range,
// `supabase start --runtime native`, `stop` then `stack destroy` in finally.
// 1. reset to the frozen published baseline (migrations up to the cutoff);
// 2. load supabase/tests/upgrade/lot2-fixture.sql as `postgres`;
// 3. capture every fixture row (to_jsonb), the column inventory and the SQL
//    validity checks with supabase/tests/upgrade/lot2-compare.sql;
// 4. apply each later migration with the native psql, one transaction per
//    file, and record it in the CLI migration history (`migration up` is not
//    in the local CLI allowlist; this fallback keeps that allowlist unchanged);
// 5. compare: zero difference is required;
// 6. negative control: one value changed outside any migration must appear
//    as exactly one more difference.
// `--negative-control` adds supabase/tests/upgrade/lot2-negative-control.sql
// as a synthetic last migration that changes one stored value: the run must
// then FAIL at the verdict and name that row (exit 1). It also drives the
// later-migration apply path, which sub-lot 2.0 has no real migration for.
// Secrets never reach the console or the evidence; the evidence directory is
// .e2e/engine-v3/upgrade-check/<timestamp>-<label>/ (report.json, psql.log).

import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import {
  assertNativeRuntimeHost,
  enableNativeStack,
  findAvailablePort,
  parseLocalSupabaseStatus,
  type NativeRuntimeHost,
} from "../../src/test/local-supabase-ci";
import {
  acquireNativeStackSlot,
  cleanUpOnTerminationSignals,
  type NativeStackSlot,
  nativeStackWaitMs,
} from "../../src/test/native-stack-guard";
import {
  assertNoRemoteSupabaseEnvironment,
  createLocalCiEnvironment,
  PINNED_SUPABASE_CLI_VERSION,
  runSupabaseCli,
  SupabaseCliCommandError,
} from "../../src/test/supabase-cli";
import {
  computeSupabaseMigrationHashes,
  inspectSupabaseMigrations,
  parseSupabaseMigrationList,
  validateAppliedMigrationRows,
} from "../../src/test/supabase-migrations";
import {
  LOT2_UPGRADE_BASELINE,
  partitionUpgradeMigrations,
  type MigrationDigest,
  type UpgradeMigrationPartition,
} from "../../src/test/upgrade-check";
import {
  assertRecipeHost,
  buildSourceEvidence,
  newEvidenceDirectory,
  redactOutput,
} from "../tester-army/local-recipe-common.mjs";

const LABEL_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WORKDIR_PREFIX = "miaouffrage-supabase-ci-upgrade-";
const FIXTURE_FILE = "supabase/tests/upgrade/lot2-fixture.sql";
const COMPARE_FILE = "supabase/tests/upgrade/lot2-compare.sql";
const NEGATIVE_CONTROL_FILE = "supabase/tests/upgrade/lot2-negative-control.sql";
// Sorts after every real migration; never a file of supabase/migrations.
const NEGATIVE_CONTROL_MIGRATION = "29991231235959_upgrade_check_negative_control.sql";
const NEGATIVE_CONTROL_FLAG = "--negative-control";
// Same defaults as src/test/local-supabase-ci.ts: every one is replaced.
const CONFIGURED_PORTS = [54320, 54321, 54322, 54323, 54324, 54327, 54329, 8083];
// The developers' long-running stack (API, database) and the default Army app.
const NEVER_ALLOCATED_PORTS = [45585, 33485, 3107];
const PSQL_TIMEOUT_MS = 10 * 60_000;

interface UpgradeProject {
  projectId: string;
  rootDirectory: string;
  laterDirectory: string;
  harnessDirectory: string;
  ports: Record<string, number>;
}

interface PsqlTransport {
  executable: string;
  environment: NodeJS.ProcessEnv;
  password: string;
}

interface ComparisonReport {
  before: string;
  after: string;
  differenceCount: number;
  differences: unknown[];
}

type UpgradeMode = "normal" | "negative-control";

interface Difference {
  kind?: string;
  table?: string;
  row?: string;
  column?: string;
  check?: string;
  before?: unknown;
  after?: unknown;
}

interface UpgradeReport {
  schemaVersion: "engine-v3-upgrade-check-1";
  label: string;
  mode: UpgradeMode;
  expectedOutcome: "passed" | "failed at the verdict, naming the injected row";
  status: "running" | "passed" | "failed";
  startedAt: string;
  finishedAt?: string;
  command: string[];
  node: string;
  platform: string;
  arch: string;
  phase: string;
  source?: { revision: string; diffSha256: string; inputsSha256: string; inputs: number };
  supabaseCli?: string;
  psql?: string;
  harnessFiles?: Record<string, { sha256: string }>;
  migrations?: {
    cutoff: string;
    baseline: { count: number; sha256: string };
    later: Array<MigrationDigest & { durationMs?: number; synthetic?: true }>;
    applyMode: string;
    inventoryAfterReset?: string;
    inventoryAfterUpgrade?: string;
  };
  stack?: { projectId: string; ports: Record<string, number>; neverAllocated: number[] };
  fixture?: { loaded: boolean; durationMs: number };
  captures?: Record<string, unknown>;
  comparison?: ComparisonReport & { verdict: "identical" | "different" };
  negativeControl?: {
    source: "outside any migration, after the comparison" | "synthetic last migration";
    mutation: unknown;
    comparison: ComparisonReport;
    verdict: "detected" | "missed";
  };
  cleanup?: { stop: string; destroy: string; workdirRemoved: boolean };
  error?: string;
}

function parseArguments(args: string[]): { label: string; mode: UpgradeMode } {
  const [label, ...rest] = args;
  const negative = rest.length === 1 && rest[0] === NEGATIVE_CONTROL_FLAG;
  if (
    !label ||
    (rest.length > 0 && !negative) ||
    !LABEL_PATTERN.test(label) ||
    label.length > 48
  ) {
    throw new Error(
      `Usage: npm run db:upgrade-check -- <label> [${NEGATIVE_CONTROL_FLAG}], with a label of lowercase letters, digits and hyphens (48 characters at most), for example lot2-2-0.`
    );
  }
  return { label, mode: negative ? "negative-control" : "normal" };
}

const shortJson = (value: unknown) => {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
};

function describeDifference(difference: Difference) {
  const location = [difference.table, difference.row, difference.column ?? difference.check]
    .filter(Boolean)
    .join(" ");
  const change =
    "before" in difference || "after" in difference
      ? `: ${shortJson(difference.before)} -> ${shortJson(difference.after)}`
      : "";
  return `${difference.kind ?? "difference"} ${location}${change}`;
}

function describeDifferences(differences: unknown[], limit = 20) {
  const lines = differences.slice(0, limit).map((difference) => `  - ${describeDifference(difference as Difference)}`);
  if (differences.length > limit) lines.push(`  - ... ${differences.length - limit} more in report.json`);
  return lines.join("\n");
}

function currentNativeRuntimeHost(): NativeRuntimeHost {
  const report = process.report?.getReport() as
    | { header?: { glibcVersionRuntime?: string } }
    | undefined;
  return {
    arch: process.arch,
    glibcVersion: report?.header?.glibcVersionRuntime,
    platform: process.platform,
    release: os.release(),
    uid: process.getuid?.(),
  };
}

function hostEphemeralPortRanges(): number[][] {
  if (process.platform === "linux") {
    const value = fs.readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8").trim();
    if (!/^\d+\s+\d+$/.test(value)) throw new Error("Invalid host ephemeral port range");
    return [value.split(/\s+/).map(Number)];
  }
  if (process.platform === "darwin") {
    const result = spawnSync("/usr/sbin/sysctl", ["-n",
      "net.inet.ip.portrange.first", "net.inet.ip.portrange.last",
      "net.inet.ip.portrange.hifirst", "net.inet.ip.portrange.hilast",
      "net.inet.ip.portrange.lowfirst", "net.inet.ip.portrange.lowlast",
    ], { encoding: "utf8", timeout: 5_000, maxBuffer: 4096 });
    const values = result.stdout?.trim().split(/\s+/) ?? [];
    if (result.error || result.status !== 0 || values.length !== 6 || values.some((value) => !/^\d+$/.test(value))) {
      throw new Error("Could not read host ephemeral port ranges");
    }
    return [0, 2, 4].map((index) => values.slice(index, index + 2).map(Number).sort((left, right) => left - right));
  }
  throw new Error("Host ephemeral port ranges require the supported native runtime host");
}

function normalizedSha256(file: string) {
  const contents = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  return createHash("sha256").update(contents).digest("hex");
}

function removeUpgradeProject(rootDirectory: string) {
  const resolvedRoot = path.resolve(rootDirectory);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (
    !resolvedRoot.startsWith(`${resolvedTemp}${path.sep}`) ||
    !path.basename(resolvedRoot).startsWith(WORKDIR_PREFIX)
  ) {
    throw new Error("Refusing to remove a non-isolated Supabase workdir");
  }
  fs.rmSync(resolvedRoot, { force: true, recursive: true });
}

async function prepareUpgradeProject(
  partition: UpgradeMigrationPartition,
  synthetic: MigrationDigest | undefined
): Promise<UpgradeProject> {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), WORKDIR_PREFIX));
  const projectId = `miaouffrage-upgrade-${process.pid}-${randomUUID().slice(0, 8)}`;
  try {
    const sourceDirectory = path.join(process.cwd(), "supabase");
    const migrationsDirectory = path.join(rootDirectory, "supabase", "migrations");
    const laterDirectory = path.join(rootDirectory, "upgrade", "later");
    const harnessDirectory = path.join(rootDirectory, "upgrade", "harness");
    for (const directory of [migrationsDirectory, laterDirectory, harnessDirectory]) {
      fs.mkdirSync(directory, { recursive: true });
    }
    // Only the baseline sits where `db reset` reads; later files wait aside.
    // Copies are re-hashed: a file edited after the split is never applied.
    for (const [files, directory] of [
      [partition.baseline, migrationsDirectory],
      [partition.later, laterDirectory],
    ] as const) {
      for (const file of files) {
        const target = path.join(directory, file.name);
        fs.copyFileSync(path.join(sourceDirectory, "migrations", file.name), target);
        if (normalizedSha256(target) !== file.sha256) {
          throw new Error(`Migration changed while the upgrade check copied it: ${file.name}`);
        }
      }
    }
    for (const file of [FIXTURE_FILE, COMPARE_FILE]) {
      fs.copyFileSync(path.join(process.cwd(), file), path.join(harnessDirectory, path.basename(file)));
    }
    if (synthetic) {
      const target = path.join(laterDirectory, synthetic.name);
      fs.copyFileSync(path.join(process.cwd(), NEGATIVE_CONTROL_FILE), target);
      if (normalizedSha256(target) !== synthetic.sha256) {
        throw new Error("The negative-control migration changed while the upgrade check copied it");
      }
    }

    const reservedPorts = new Set([...CONFIGURED_PORTS, ...NEVER_ALLOCATED_PORTS]);
    const ephemeralRanges = hostEphemeralPortRanges();
    const ports: Record<string, number> = {};
    let config = fs.readFileSync(path.join(sourceDirectory, "config.toml"), "utf8");
    config = config.replace(/^project_id\s*=.*$/m, `project_id = "${projectId}"`);
    for (const configuredPort of CONFIGURED_PORTS) {
      const isolatedPort = await findAvailablePort(reservedPorts, ephemeralRanges);
      reservedPorts.add(isolatedPort);
      ports[String(configuredPort)] = isolatedPort;
      config = config.replace(new RegExp(`\\b${configuredPort}\\b`, "g"), String(isolatedPort));
    }
    config = enableNativeStack(config);
    if (!new RegExp(`^project_id\\s*=\\s*"${projectId}"\\r?$`, "m").test(config)) {
      throw new Error("Could not isolate the Supabase project ID");
    }
    for (const [configuredPort, isolatedPort] of Object.entries(ports)) {
      if (
        new RegExp(`\\b${configuredPort}\\b`).test(config) ||
        !new RegExp(`\\b${isolatedPort}\\b`).test(config)
      ) {
        throw new Error(`Could not isolate Supabase port configured at ${configuredPort}`);
      }
    }
    fs.writeFileSync(path.join(rootDirectory, "supabase", "config.toml"), config, "utf8");
    return { projectId, rootDirectory, laterDirectory, harnessDirectory, ports };
  } catch (error) {
    removeUpgradeProject(rootDirectory);
    throw error;
  }
}

function resolveNativePsql() {
  const cache = path.join(os.homedir(), ".supabase", "cache", "stack", "slim-services", "postgres");
  const platform = `${process.platform === "darwin" ? "darwin" : "linux"}-${process.arch === "x64" ? "amd64" : "arm64"}`;
  const candidates = fs.readdirSync(cache, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(cache, entry.name, platform, "bin", "psql"))
    .filter((file) => fs.existsSync(file));
  if (candidates.length !== 1) throw new Error("The native runtime must provide exactly one PostgreSQL client");
  fs.accessSync(candidates[0], fs.constants.X_OK);
  return candidates[0];
}

function createPsqlTransport(databaseUrl: string, executable: string): PsqlTransport {
  // parseLocalSupabaseStatus already required the owned loopback backend,
  // user `postgres`, database `/postgres` and no routing parameters.
  const url = new URL(databaseUrl);
  const password = decodeURIComponent(url.password);
  return {
    executable,
    password,
    environment: {
      ...createLocalCiEnvironment(process.env),
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PGAPPNAME: "miaouffrage-upgrade-check",
      PGCONNECT_TIMEOUT: "10",
      PGDATABASE: "postgres",
      PGHOST: url.hostname === "[::1]" ? "::1" : url.hostname,
      // Fixed time zone: captured timestamps are rendered identically.
      PGOPTIONS: "-c TimeZone=UTC -c lock_timeout=30000",
      PGPASSWORD: password,
      PGPORT: url.port,
      PGSSLMODE: "disable",
      PGUSER: "postgres",
    },
  };
}

function createRedactor(getPassword: () => string | undefined) {
  return (value: string) => {
    const password = getPassword();
    // CLI failures may echo the disposable stack's API and storage keys.
    return redactOutput(value, { NODE_ENV: "test", UPGRADE_CHECK_PGPASSWORD: password ?? "" })
      .replace(/(?<![A-Za-z0-9])sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[REDACTED-KEY]")
      .replace(/((?:secret|access)[ _-]?key\W*)[A-Za-z0-9+/=_-]{16,}/gi, "$1[REDACTED]");
  };
}

async function main() {
  const { label, mode } = parseArguments(process.argv.slice(2));
  if (process.platform === "win32") {
    throw new Error(
      "The upgrade check uses the Supabase native runtime, which does not run on Windows: run `npm run db:upgrade-check -- <label>` inside WSL (Ubuntu 22.04 or later) from a Linux checkout, one native-stack run at a time."
    );
  }
  assertRecipeHost();
  assertNoRemoteSupabaseEnvironment(process.env);

  const startedAt = new Date();
  const evidence = await newEvidenceDirectory(
    "engine-v3/upgrade-check",
    `${startedAt.toISOString().replace(/[:.]/g, "-")}-${label}${mode === "negative-control" ? "-negative-control" : ""}`
  );
  const psqlLog = path.join(evidence, "psql.log");
  let transport: PsqlTransport | undefined;
  const redact = createRedactor(() => transport?.password);
  const report: UpgradeReport = {
    schemaVersion: "engine-v3-upgrade-check-1",
    label,
    mode,
    expectedOutcome: mode === "normal" ? "passed" : "failed at the verdict, naming the injected row",
    status: "running",
    startedAt: startedAt.toISOString(),
    command: [process.execPath, ...process.argv.slice(1)],
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    phase: "preflight",
  };
  const writeReport = () =>
    fs.writeFileSync(path.join(evidence, "report.json"), `${redact(JSON.stringify(report, null, 2))}\n`);
  const log = (message: string) => console.log(`Upgrade check: ${message}`);
  const supabase = (args: string[]) => runSupabaseCli(args, { capture: true, environment: process.env });

  const runPsql = (args: string[], step: string, sessionOptions = true) => {
    if (!transport) throw new Error("The owned PostgreSQL transport is not ready");
    const result = spawnSync(
      transport.executable,
      sessionOptions ? ["-X", "--no-password", "-v", "ON_ERROR_STOP=1", ...args] : args,
      {
        encoding: "utf8",
        env: transport.environment,
        maxBuffer: 64 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: PSQL_TIMEOUT_MS,
      }
    );
    const output = redact([result.stdout, result.stderr].filter(Boolean).join("\n"));
    fs.appendFileSync(psqlLog, `### ${step} (exit ${result.status ?? "none"})\n${output}\n`);
    if (result.error || result.status !== 0) {
      throw new Error(
        `psql failed during ${step} (exit ${result.status ?? "none"}${result.signal ? `, ${result.signal}` : ""}):\n${output.slice(-4_000)}`
      );
    }
    return result.stdout ?? "";
  };
  const queryJson = <T>(sql: string, step: string): T => {
    const lines = runPsql(["-A", "-t", "-q", "-c", sql], step).split(/\r?\n/).filter((line) => line.trim());
    if (lines.length !== 1) throw new Error(`psql returned ${lines.length} lines instead of one JSON value during ${step}`);
    return JSON.parse(lines[0]) as T;
  };

  let project: UpgradeProject | undefined;
  let startAttempted = false;
  let primaryError: unknown;
  const cleanupErrors: string[] = [];
  const withWorkdir = (args: string[]) => [...args, "--workdir", project?.rootDirectory ?? ""];
  let slot: NativeStackSlot | undefined;
  let cleanedUp = false;
  // Runs once: from `finally` or from SIGINT/SIGTERM (see native-stack-guard).
  const destroyStack = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    report.cleanup = { stop: "not started", destroy: "not started", workdirRemoved: false };
    if (startAttempted && project) {
      // A native `stop` keeps the stack's data: the destroy always follows.
      for (const [key, args] of [["stop", ["stop"]], ["destroy", ["stack", "destroy", "--yes"]]] as const) {
        try {
          supabase(withWorkdir([...args]));
          report.cleanup[key] = "ok";
        } catch (error) {
          report.cleanup[key] = "failed";
          cleanupErrors.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    if (project) {
      try {
        removeUpgradeProject(project.rootDirectory);
        report.cleanup.workdirRemoved = true;
      } catch (error) {
        cleanupErrors.push(`workdir: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    slot?.release();
  };
  const removeSignalHandlers = cleanUpOnTerminationSignals((signal) => {
    log(`${signal} received: destroying the disposable native stack.`);
    destroyStack();
    report.status = "failed";
    report.error = redact(`Interrupted by ${signal} during ${report.phase}\n${cleanupErrors.join("\n")}`);
    writeReport();
  });
  const verifyInventory = (expected: MigrationDigest[], name: string) => {
    const rows = parseSupabaseMigrationList(
      supabase(withWorkdir(["migration", "list", "--local", "--output-format", "json"]))
    );
    const errors = [
      ...(rows.length === 0 ? ["migration list output was not recognized"] : []),
      ...validateAppliedMigrationRows(expected.map((file) => file.name.split("_", 1)[0]), rows),
    ];
    if (errors.length > 0) throw new Error(`${name} inventory differs:\n${errors.join("\n")}`);
    return `${rows.length} applied, matching ${name}`;
  };

  try {
    const source = await buildSourceEvidence();
    report.source = {
      revision: source.revision,
      diffSha256: source.diffSha256,
      inputsSha256: createHash("sha256").update(JSON.stringify(source.inputs)).digest("hex"),
      inputs: source.inputs.length,
    };
    const harnessFiles = mode === "negative-control"
      ? [FIXTURE_FILE, COMPARE_FILE, NEGATIVE_CONTROL_FILE]
      : [FIXTURE_FILE, COMPARE_FILE];
    report.harnessFiles = Object.fromEntries(
      harnessFiles.map((file) => [file, { sha256: normalizedSha256(path.join(process.cwd(), file)) }])
    );
    const synthetic: MigrationDigest | undefined = mode === "negative-control"
      ? { name: NEGATIVE_CONTROL_MIGRATION, sha256: report.harnessFiles[NEGATIVE_CONTROL_FILE].sha256 }
      : undefined;

    const inventory = inspectSupabaseMigrations();
    if (inventory.errors.length > 0) throw new Error(inventory.errors.join("\n"));
    const partition = partitionUpgradeMigrations(
      Object.entries(computeSupabaseMigrationHashes()).map(([name, sha256]) => ({ name, sha256 }))
    );
    report.migrations = {
      cutoff: LOT2_UPGRADE_BASELINE.cutoff,
      baseline: { count: partition.baseline.length, sha256: LOT2_UPGRADE_BASELINE.sha256 },
      later: [
        ...partition.later.map((file) => ({ ...file })),
        ...(synthetic ? [{ ...synthetic, synthetic: true as const }] : []),
      ],
      applyMode:
        "native psql --single-transaction -v ON_ERROR_STOP=1 per file, then INSERT INTO supabase_migrations.schema_migrations (version, name) in the same transaction",
    };

    assertNativeRuntimeHost(currentNativeRuntimeHost());
    const cliVersion = supabase(["--version"]).trim().split(/\r?\n/, 1)[0];
    if (cliVersion !== PINNED_SUPABASE_CLI_VERSION) {
      throw new Error(`Supabase CLI must be exactly ${PINNED_SUPABASE_CLI_VERSION}; received ${cliVersion}`);
    }
    report.supabaseCli = cliVersion;

    report.phase = "reserve native stack slot";
    slot = await acquireNativeStackSlot({ label: `engine-v3 upgrade check (${label})`, waitMs: nativeStackWaitMs() });
    report.phase = "prepare isolated project";
    project = await prepareUpgradeProject(partition, synthetic);
    report.stack = { projectId: project.projectId, ports: project.ports, neverAllocated: NEVER_ALLOCATED_PORTS };

    report.phase = "start local stack";
    startAttempted = true;
    supabase(withWorkdir(["start", "--runtime", "native"]));
    log("disposable native stack started.");

    report.phase = "reset to the published baseline";
    supabase(withWorkdir(["db", "reset", "--local"]));
    report.migrations.inventoryAfterReset = verifyInventory(partition.baseline, "published baseline");
    log(`database reset to ${partition.baseline.length} baseline migrations (cutoff ${LOT2_UPGRADE_BASELINE.cutoff}).`);

    report.phase = "open the owned PostgreSQL transport";
    const status = parseLocalSupabaseStatus(supabase(withWorkdir(["status", "--env"])));
    if (!status.databaseUrl) throw new Error("Local PostgreSQL status is missing for the upgrade fixture");
    transport = createPsqlTransport(status.databaseUrl, resolveNativePsql());
    report.psql = runPsql(["--version"], "psql version", false).trim();

    report.phase = "load fixture";
    const fixtureStarted = Date.now();
    runPsql(["-q", "-f", path.join(project.harnessDirectory, path.basename(FIXTURE_FILE))], "load fixture");
    report.fixture = { loaded: true, durationMs: Date.now() - fixtureStarted };
    log("fixture loaded and validated by the repository SQL checks.");

    report.phase = "capture before";
    runPsql(["-q", "-f", path.join(project.harnessDirectory, path.basename(COMPARE_FILE))], "install comparison");
    report.captures = {
      before: queryJson("select upgrade_check.capture('before')::text", "capture before"),
    };

    report.phase = "apply later migrations";
    for (const migration of report.migrations.later) {
      const match = /^(\d{14})_([a-z0-9][a-z0-9_]*)\.sql$/.exec(migration.name);
      if (!match) throw new Error(`Unexpected later migration name: ${migration.name}`);
      const started = Date.now();
      runPsql([
        "--single-transaction",
        "-q",
        "-f", path.join(project.laterDirectory, migration.name),
        "-c", `insert into supabase_migrations.schema_migrations (version, name) values ('${match[1]}', '${match[2]}')`,
      ], `apply ${migration.name}`);
      migration.durationMs = Date.now() - started;
      // Like `migration up`: the applied file joins the project's local inventory.
      fs.copyFileSync(
        path.join(project.laterDirectory, migration.name),
        path.join(project.rootDirectory, "supabase", "migrations", migration.name)
      );
      log(`applied ${migration.name}.`);
    }
    report.migrations.inventoryAfterUpgrade = verifyInventory(
      [...partition.baseline, ...partition.later, ...(synthetic ? [synthetic] : [])],
      synthetic ? "repository inventory plus the negative-control migration" : "repository inventory"
    );
    log(`${partition.later.length} later migration(s) applied${synthetic ? ", then the negative-control migration" : ""}.`);

    report.phase = "compare";
    report.captures.after = queryJson("select upgrade_check.capture('after')::text", "capture after");
    const comparison = queryJson<ComparisonReport>(
      "select upgrade_check.compare('before', 'after')::text",
      "compare before and after"
    );
    report.comparison = { ...comparison, verdict: comparison.differenceCount === 0 ? "identical" : "different" };
    log(`comparison found ${comparison.differenceCount} difference(s).`);

    report.phase = "negative control";
    let detected: boolean;
    if (synthetic) {
      // The synthetic migration is the control: the comparison must report
      // its change, and nothing else, then the verdict below fails the run.
      const mutation = queryJson<unknown>(
        "select difference::text from upgrade_check.injected_change",
        "read the injected change"
      );
      detected =
        comparison.differenceCount === 1 &&
        comparison.differences.length === 1 &&
        isDeepStrictEqual(comparison.differences[0], mutation);
      report.negativeControl = {
        source: "synthetic last migration",
        mutation,
        comparison,
        verdict: detected ? "detected" : "missed",
      };
    } else {
      const mutation = queryJson<unknown>(
        "select upgrade_check.apply_negative_control()::text",
        "apply negative control"
      );
      report.captures.negative = queryJson("select upgrade_check.capture('negative')::text", "capture negative");
      const negative = queryJson<ComparisonReport>(
        "select upgrade_check.compare('before', 'negative')::text",
        "compare before and negative"
      );
      detected =
        negative.differenceCount === comparison.differenceCount + 1 &&
        negative.differences.length === negative.differenceCount &&
        negative.differences.some((difference) => isDeepStrictEqual(difference, mutation));
      report.negativeControl = {
        source: "outside any migration, after the comparison",
        mutation,
        comparison: negative,
        verdict: detected ? "detected" : "missed",
      };
    }
    log(`negative control (${report.negativeControl.source}) ${detected ? "detected" : "MISSED"}.`);

    report.phase = "verdict";
    if (comparison.differenceCount !== 0) {
      throw new Error(
        `The upgrade changed ${comparison.differenceCount} stored value(s) or check(s):\n${describeDifferences(comparison.differences)}${
          synthetic
            ? detected
              ? "\nNegative-control mode: this failure is required; it is exactly the change of the synthetic migration."
              : "\nNegative-control mode: these differences are NOT exactly the change of the synthetic migration."
            : ""
        }`
      );
    }
    if (!detected) {
      throw new Error(
        synthetic
          ? "Negative-control mode: the synthetic migration's change was not reported; the comparison is not sensitive."
          : "The negative control was not detected as exactly one more difference; the comparison is not proven sensitive."
      );
    }
  } catch (error) {
    primaryError = error;
  } finally {
    destroyStack();
    removeSignalHandlers();
  }

  report.finishedAt = new Date().toISOString();
  if (primaryError || cleanupErrors.length > 0) {
    const details = [
      primaryError instanceof SupabaseCliCommandError
        ? `${primaryError.message}\n${primaryError.capturedOutput.slice(-6_000)}`
        : primaryError instanceof Error
          ? primaryError.message
          : primaryError
            ? String(primaryError)
            : undefined,
      ...cleanupErrors,
    ].filter(Boolean);
    report.status = "failed";
    report.error = redact(`Phase failed: ${report.phase}\n${details.join("\n")}`);
    writeReport();
    throw new Error(`${report.error}\nEvidence: ${evidence}`);
  }
  report.status = "passed";
  writeReport();
  log(`passed. Evidence: ${evidence}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
