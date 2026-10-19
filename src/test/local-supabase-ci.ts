import { spawn, spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import {
  compareDatabaseFingerprints,
  compareStackState,
  createDatabaseSnapshotOperations,
  type DatabaseFingerprint,
  type DatabaseSnapshot,
  type DatabaseSnapshotKey,
  type DatabaseSnapshotOperations,
  type NativePostgresTools,
  resolveDatabaseSnapshotDirectory,
} from "@/test/database-snapshot";
import {
  acquireNativeStackSlot,
  cleanUpOnTerminationSignals,
  type NativeStackSlot,
  nativeStackWaitMs,
} from "@/test/native-stack-guard";
import {
  assertNoRemoteSupabaseEnvironment,
  createLocalCiEnvironment,
  PINNED_SUPABASE_CLI_VERSION,
  runSupabaseCli,
  SupabaseCliCommandError,
  type SupabaseEnvironment,
} from "@/test/supabase-cli";
import {
  inspectSupabaseMigrations,
  parseSupabaseMigrationList,
  validateAppliedMigrationRows,
} from "@/test/supabase-migrations";

type RoleKey = "admin" | "engineer" | "viewer";

// Chromium's restricted HTTP ports above 1023; lower ports are never candidates.
// https://chromium.googlesource.com/chromium/src/+/refs/heads/main/net/base/port_util.cc
export const BROWSER_RESTRICTED_LOCAL_PORTS: ReadonlySet<number> = new Set([
  1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566,
  6665, 6666, 6667, 6668, 6669, 6697, 10080,
]);

export interface NativeRuntimeHost {
  arch: string;
  glibcVersion?: string;
  platform: NodeJS.Platform;
  release: string;
  uid?: number;
}

function isAtLeast(version: string, minimum: [number, number]) {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > minimum[0] || (major === minimum[0] && minor >= minimum[1]);
}

/**
 * The Supabase native runtime runs each service as a local process, without a
 * container engine. Supabase supports it on Linux with glibc 2.35+ and on
 * macOS 14+ on Apple silicon, never as root. Fail before starting anything.
 */
export function assertNativeRuntimeHost(host: NativeRuntimeHost) {
  if (host.platform === "win32") {
    throw new Error(
      "The Supabase native runtime does not run on Windows: run `npm run db:ci:local` inside WSL (Ubuntu 22.04 or later) from a Linux checkout."
    );
  }
  if (host.platform === "linux") {
    if (!host.glibcVersion || !isAtLeast(host.glibcVersion, [2, 35])) {
      throw new Error(
        `The Supabase native runtime requires glibc 2.35 or later; this host has ${host.glibcVersion ?? "no glibc"}.`
      );
    }
  } else if (host.platform === "darwin") {
    if (host.arch !== "arm64") {
      throw new Error("The Supabase native runtime requires Apple silicon on macOS.");
    }
    // Darwin 23 is macOS 14.
    if (!isAtLeast(host.release, [23, 0])) {
      throw new Error("The Supabase native runtime requires macOS 14 or later.");
    }
  } else {
    throw new Error(`The Supabase native runtime does not support ${host.platform}.`);
  }
  if (host.uid === 0) {
    throw new Error("The Supabase native runtime refuses to run as root; use an ordinary account.");
  }
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

/**
 * The runtime choice exists only once `[experimental] stack` is on. Insert it
 * into the existing table: a second `[experimental]` table makes config.toml
 * invalid. Line endings of the checkout are preserved.
 */
export function enableNativeStack(config: string) {
  const headers = config.match(/^\[experimental\]\r?$/gm) ?? [];
  if (headers.length > 1) {
    throw new Error("config.toml declares [experimental] more than once");
  }
  if (headers.length === 0) {
    const separator = config.endsWith("\n") ? "" : "\n";
    return `${config}${separator}\n[experimental]\nstack = true\n`;
  }
  return config.replace(
    /^\[experimental\](\r?)$/m,
    (_header, carriageReturn: string) =>
      `[experimental]${carriageReturn}\nstack = true${carriageReturn}`
  );
}

export interface LocalSupabaseStatus {
  url: string;
  anonKey: string;
  serviceRoleKey: string;
  databaseUrl?: string;
}

interface ProvisionedUsers {
  environment: SupabaseEnvironment;
  userIds: string[];
}

interface IsolatedSupabaseProject {
  projectId: string;
  rootDirectory: string;
  /** The isolated ports written into its config.toml. */
  ports?: number[];
}

interface LocalSupabaseCiDependencies {
  /** Reserves one of the user's native-run slots before the project exists. */
  acquireStackSlot: () => Promise<NativeStackSlot>;
  /** Snapshot steps, used only when ARMY_DB_SNAPSHOT_DIR is set. */
  databaseSnapshot?: DatabaseSnapshotOperations;
  ensureRuntime: () => void;
  environment: SupabaseEnvironment;
  reservedPorts: ReadonlySet<number>;
  log: (message: string) => void;
  /**
   * Called once the migrated database is ready, before pgTAP: a run that fails
   * afterwards still knows whether its database was reset or restored.
   */
  onDatabaseProvenance?: (provenance: LocalDatabaseProvenance) => void;
  /**
   * Called with the isolated project before its stack starts: a supervisor
   * that dies afterwards leaves enough to stop and destroy that exact stack.
   */
  onProjectPrepared?: (project: Readonly<IsolatedSupabaseProject>) => void;
  /**
   * Called with the started stack's status, before its database is reset or
   * restored: work that needs only its URL and keys (the Army production
   * build) can run while the database checks run. The application itself
   * still starts only after pgTAP and the RLS matrix pass.
   */
  onStackStarted?: (status: Readonly<LocalSupabaseStatus>) => void;
  prepareProject: (reservedPorts: ReadonlySet<number>) => Promise<IsolatedSupabaseProject>;
  provisionUsers: (
    status: LocalSupabaseStatus
  ) => Promise<ProvisionedUsers>;
  runRls: (environment: SupabaseEnvironment) => Promise<void>;
  runApplication?: (environment: SupabaseEnvironment) => Promise<void>;
  resolvePsql: () => string;
  removeProject: (project: IsolatedSupabaseProject) => void;
  supabase: (args: string[], capture?: boolean) => string;
  validateProject: () => string[];
  verifyMigrations: (output: string) => string[];
  /** File names under supabase/tests/database; the whole folder when absent. */
  pgTapFiles?: readonly string[];
  skipRlsMatrix?: boolean;
}

const PGTAP_DIRECTORY = path.join("supabase", "tests", "database");

/**
 * `db:ci:local [--files a.test.sql,b.test.sql] [--skip-rls]`. Each file is
 * named directly in supabase/tests/database (bare or with that prefix) and
 * must exist there: nothing else reaches `supabase test db`.
 */
export function parseLocalSupabaseCiArguments(argv: readonly string[], rootDirectory = process.cwd()) {
  const options: { pgTapFiles?: string[]; skipRlsMatrix?: boolean } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--skip-rls") {
      options.skipRlsMatrix = true;
      continue;
    }
    if (argument !== "--files" && !argument.startsWith("--files=")) {
      throw new Error(`Unknown argument ${argument}: use --files a.test.sql,b.test.sql and --skip-rls`);
    }
    if (options.pgTapFiles) throw new Error("--files may be given only once");
    const value = argument === "--files" ? argv[++index] : argument.slice("--files=".length);
    const names = (value ?? "").split(",").map((name) => name.trim()).filter(Boolean);
    if (names.length === 0) throw new Error("--files requires a comma-separated list of pgTAP files");
    options.pgTapFiles = names.map((name) => {
      const file = name.startsWith("supabase/tests/database/") ? name.slice("supabase/tests/database/".length) : name;
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.sql$/.test(file)) {
        throw new Error(`${name} is not a pgTAP file directly under supabase/tests/database`);
      }
      // lstat: a symlink could point outside the folder; the copied tree keeps it.
      const entry = fs.lstatSync(path.join(rootDirectory, PGTAP_DIRECTORY, file), { throwIfNoEntry: false });
      if (entry?.isSymbolicLink()) throw new Error(`${name} is a symbolic link, not a pgTAP file`);
      if (!entry?.isFile()) throw new Error(`${name} does not exist under supabase/tests/database`);
      return { file, identity: `${entry.dev}:${entry.ino}` };
    }).map(({ file, identity }, index, selected) => {
      // By file identity: FOO.test.sql and foo.test.sql are one file on a
      // case-insensitive filesystem (macOS default).
      if (selected.findIndex((other) => other.identity === identity) !== index) {
        throw new Error("A pgTAP file is listed twice in --files");
      }
      return file;
    });
  }
  return options;
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
    // Darwin permits descending ranges, including the default low-port range.
    return [0, 2, 4].map((index) => values.slice(index, index + 2).map(Number).sort((left, right) => left - right));
  }
  throw new Error("Host ephemeral port ranges require the supported native runtime host");
}

export async function findAvailablePort(
  reserved: ReadonlySet<number>,
  ephemeralRanges: ReadonlyArray<ReadonlyArray<number>>
) {
  if (ephemeralRanges.length === 0 || ephemeralRanges.some((range) => range.length !== 2 ||
    range.some((port) => !Number.isInteger(port) || port < 1 || port > 65535) || range[0] > range[1])) {
    throw new Error("Invalid host ephemeral port range");
  }
  const candidates = Array.from({ length: 65536 - 1024 }, (_, index) => index + 1024)
    .filter((port) => !reserved.has(port) && !BROWSER_RESTRICTED_LOCAL_PORTS.has(port) &&
      !ephemeralRanges.some(([first, last]) => port >= first && port <= last));
  const offset = candidates.length ? randomInt(candidates.length) : 0;
  for (let index = 0; index < candidates.length; index += 1) {
    const port = candidates[(offset + index) % candidates.length];
    const available = await new Promise<boolean>((resolve, reject) => {
      const server = net.createServer();
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "EADDRINUSE") resolve(false);
        else reject(error);
      });
      server.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
        server.close((error) => error ? reject(error) : resolve(true));
      });
    });
    if (available) return port;
  }
  throw new Error("No non-ephemeral Supabase port is available");
}

async function prepareIsolatedProject(additionalReservedPorts: ReadonlySet<number>): Promise<IsolatedSupabaseProject> {
  const rootDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "miaouffrage-supabase-ci-")
  );
  const projectId = `miaouffrage-ci-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;

  try {
    const sourceDirectory = path.join(process.cwd(), "supabase");
    const targetDirectory = path.join(rootDirectory, "supabase");
    fs.mkdirSync(targetDirectory, { recursive: true });
    fs.cpSync(
      path.join(sourceDirectory, "migrations"),
      path.join(targetDirectory, "migrations"),
      { recursive: true }
    );
    fs.cpSync(
      path.join(sourceDirectory, "tests"),
      path.join(targetDirectory, "tests"),
      { recursive: true }
    );

    const configuredPorts = [
      54320,
      54321,
      54322,
      54323,
      54324,
      54327,
      54329,
      8083,
    ];
    const reservedPorts = new Set([...configuredPorts, ...additionalReservedPorts]);
    const ephemeralRanges = hostEphemeralPortRanges();
    const portReplacements = new Map<number, number>();
    for (const configuredPort of configuredPorts) {
      const isolatedPort = await findAvailablePort(reservedPorts, ephemeralRanges);
      reservedPorts.add(isolatedPort);
      portReplacements.set(configuredPort, isolatedPort);
    }

    let config = fs.readFileSync(
      path.join(sourceDirectory, "config.toml"),
      "utf8"
    );
    config = config.replace(/^project_id\s*=.*$/m, `project_id = "${projectId}"`);
    for (const [configuredPort, isolatedPort] of portReplacements) {
      config = config.replace(
        new RegExp(`\\b${configuredPort}\\b`, "g"),
        String(isolatedPort)
      );
    }
    config = enableNativeStack(config);
    if (!new RegExp(`^project_id\\s*=\\s*"${projectId}"\\r?$`, "m").test(config)) {
      throw new Error("Could not isolate the Supabase project ID");
    }
    for (const [configuredPort, isolatedPort] of portReplacements) {
      if (
        new RegExp(`\\b${configuredPort}\\b`).test(config) ||
        !new RegExp(`\\b${isolatedPort}\\b`).test(config)
      ) {
        throw new Error(
          `Could not isolate Supabase port configured at ${configuredPort}`
        );
      }
    }
    fs.writeFileSync(path.join(targetDirectory, "config.toml"), config, "utf8");
    return { projectId, rootDirectory, ports: [...portReplacements.values()] };
  } catch (error) {
    removeIsolatedProject({ projectId, rootDirectory });
    throw error;
  }
}

function removeIsolatedProject(project: IsolatedSupabaseProject) {
  const resolvedRoot = path.resolve(project.rootDirectory);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (
    !resolvedRoot.startsWith(`${resolvedTemp}${path.sep}`) ||
    !path.basename(resolvedRoot).startsWith("miaouffrage-supabase-ci-")
  ) {
    throw new Error("Refusing to remove a non-isolated Supabase workdir");
  }
  fs.rmSync(resolvedRoot, { force: true, recursive: true });
}

function unquoteEnvironmentValue(value: string) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return JSON.parse(trimmed) as string;
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function parseLocalSupabaseStatus(output: string): LocalSupabaseStatus {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) {
      values.set(match[1], unquoteEnvironmentValue(match[2]));
    }
  }

  // `supabase status --env` names of the native runtime stack.
  const url = values.get("API_URL")?.trim();
  const anonKey = values.get("ANON_KEY")?.trim();
  const serviceRoleKey = values.get("SERVICE_ROLE_KEY")?.trim();
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("Local Supabase status did not return all required values");
  }

  assertLoopbackSupabaseUrl(url);
  assertLocalApiKeyRole(anonKey, "anon", "sb_publishable_");
  assertLocalApiKeyRole(serviceRoleKey, "service_role", "sb_secret_");
  const databaseUrl = values.get("DB_URL")?.trim();
  if (databaseUrl) {
    try {
      const database = new URL(databaseUrl);
      if (!["postgres:", "postgresql:"].includes(database.protocol) ||
        database.hostname !== new URL(url).hostname || !database.port ||
        database.username !== "postgres" || !database.password ||
        database.pathname !== "/postgres" || database.search || database.hash) {
        throw new Error("invalid database route");
      }
    } catch {
      throw new Error("Local PostgreSQL status must target the owned loopback backend without routing parameters");
    }
  }
  return { url, anonKey, serviceRoleKey, ...(databaseUrl ? { databaseUrl } : {}) };
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

function assertLocalApiKeyRole(
  apiKey: string,
  expectedRole: "anon" | "service_role",
  opaquePrefix: string
) {
  if (apiKey.startsWith(opaquePrefix)) {
    return;
  }

  const parts = apiKey.split(".");
  if (parts.length !== 3) {
    throw new Error(`Local Supabase ${expectedRole} key has an unknown format`);
  }
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    ) as { role?: string };
    if (payload.role !== expectedRole) {
      throw new Error("role mismatch");
    }
  } catch {
    throw new Error(`Local Supabase key does not carry role ${expectedRole}`);
  }
}

export function assertLoopbackSupabaseUrl(value: string) {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
    throw new Error("Local RLS tests refuse a non-loopback Supabase URL");
  }
}

function createAdminClient(status: LocalSupabaseStatus) {
  return createClient(status.url, status.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function deleteLocalUsers(
  status: LocalSupabaseStatus,
  userIds: string[]
) {
  const client = createAdminClient(status);
  const failures: string[] = [];
  for (const userId of userIds) {
    const { error } = await client.auth.admin.deleteUser(userId);
    if (error) {
      failures.push(userId);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Could not delete ${failures.length} local Auth users`);
  }
}

async function provisionLocalUsers(
  status: LocalSupabaseStatus
): Promise<ProvisionedUsers> {
  const client = createAdminClient(status);
  const userIds: string[] = [];
  const environment: Record<string, string | undefined> = {};
  const roles: RoleKey[] = ["admin", "engineer", "viewer"];

  try {
    for (const role of roles) {
      const suffix = crypto.randomUUID();
      const email = `rls-${role}-${suffix}@example.test`;
      const password = `Rls-${crypto.randomUUID()}-A1!`;
      const { data, error } = await client.auth.admin.createUser({
        email,
        email_confirm: true,
        password,
      });
      if (error || !data.user?.id) {
        throw new Error(`Could not create local ${role} Auth user`);
      }
      userIds.push(data.user.id);
      const prefix = `RLS_E2E_${role.toUpperCase()}`;
      environment[`${prefix}_EMAIL`] = email;
      environment[`${prefix}_PASSWORD`] = password;
    }
  } catch (error) {
    await deleteLocalUsers(status, userIds);
    throw error;
  }

  return { environment, userIds };
}

function resolveVitestEntry(rootDirectory = process.cwd()) {
  const manifestPath = path.join(rootDirectory, "node_modules", "vitest", "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
    bin?: { vitest?: string };
  };
  if (!manifest.bin?.vitest) {
    throw new Error("Installed Vitest package does not expose its CLI binary");
  }
  return path.resolve(path.dirname(manifestPath), manifest.bin.vitest);
}

interface RlsMatrixReport {
  numFailedTests?: number;
  numPassedTests?: number;
  numPendingTests?: number;
  numTodoTests?: number;
  numTotalTests?: number;
  success?: boolean;
  testResults?: Array<{
    assertionResults?: Array<{
      failureMessages?: string[];
      fullName?: string;
      status?: string;
      title?: string;
    }>;
    message?: string;
  }>;
}

function parseRlsMatrixReport(output: string) {
  for (const line of output.split(/\r?\n/).reverse()) {
    const trimmedLine = line.trim();
    if (!trimmedLine.startsWith("{")) {
      continue;
    }
    try {
      return JSON.parse(trimmedLine) as RlsMatrixReport;
    } catch {
      // Continue until the final valid JSON reporter line is found.
    }
  }
  throw new Error("Local RLS matrix returned invalid JSON");
}

export function validateRlsMatrixReport(output: string) {
  const report = parseRlsMatrixReport(output);

  if (
    report.success !== true ||
    report.numTotalTests !== 2 ||
    report.numPassedTests !== 2 ||
    (report.numFailedTests ?? 0) !== 0 ||
    (report.numPendingTests ?? 0) !== 0 ||
    (report.numTodoTests ?? 0) !== 0
  ) {
    throw new Error("Local RLS matrix did not execute exactly two passing tests");
  }
}

export function validatePgTapReport(output: string, expectedFiles: number) {
  const counts = output.match(/^Files=(\d+), Tests=(\d+),/m);
  if (
    !Number.isSafeInteger(expectedFiles) ||
    expectedFiles <= 0 ||
    !counts ||
    Number(counts[1]) !== expectedFiles ||
    Number(counts[2]) <= 0 ||
    !/^Result: PASS\s*$/m.test(output)
  ) {
    throw new Error(
      `Local pgTAP did not execute all ${expectedFiles} SQL files with passing assertions`
    );
  }
}

export interface ChildProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

/**
 * Runs a child without blocking this event loop. While a synchronous child
 * runs, pooled keep-alive sockets outlive the server's idle timeout unseen:
 * the next request goes out on a closed connection (UND_ERR_SOCKET).
 */
export function runChildProcess(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; maxBuffer: number }
) {
  return new Promise<ChildProcessResult>((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    const output = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    let bytes = 0;
    let error: Error | undefined;
    for (const stream of ["stdout", "stderr"] as const) {
      child[stream].on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes <= options.maxBuffer) {
          output[stream].push(chunk);
        } else if (!error) {
          error = new Error(`Child output exceeded ${options.maxBuffer} bytes`);
          child.kill("SIGTERM");
        }
      });
    }
    const settle = (status: number | null) => resolve({
      status,
      stdout: Buffer.concat(output.stdout).toString("utf8"),
      stderr: Buffer.concat(output.stderr).toString("utf8"),
      ...(error ? { error } : {}),
    });
    child.once("error", (spawnError) => {
      error ??= spawnError;
      if (child.pid === undefined) settle(null);
    });
    child.once("close", settle);
  });
}

async function runRlsMatrix(environment: SupabaseEnvironment) {
  // Vitest 5 writes the JSON reporter to a file, not to stdout: name one per
  // run so the report read is this run's, never a stale `.vitest/` file.
  const reportDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "miaouffrage-rls-matrix-")
  );
  const reportFile = path.join(reportDirectory, "report.json");
  try {
    const result = await runChildProcess(
      process.execPath,
      [
        resolveVitestEntry(),
        "run",
        "--project=node",
        "src/lib/estimates/rls.e2e.test.ts",
        "--reporter=verbose",
        "--reporter=json",
        `--outputFile.json=${reportFile}`,
      ],
      {
        cwd: process.cwd(),
        env: environment as NodeJS.ProcessEnv,
        maxBuffer: 10 * 1024 * 1024,
      }
    );
    if (result.error) {
      throw new Error("Could not start the local RLS test process");
    }

    const report = fs.existsSync(reportFile)
      ? fs.readFileSync(reportFile, "utf8")
      : "";
    if (result.status !== 0) {
      throw new Error(formatSafeRlsFailure(report, result.stderr, environment));
    }
    validateRlsMatrixReport(report);
  } finally {
    fs.rmSync(reportDirectory, { recursive: true, force: true });
  }
}

function redactRlsEnvironmentValues(
  value: string,
  environment: SupabaseEnvironment
) {
  let redacted = value;
  for (const [name, secret] of Object.entries(environment)) {
    if (
      secret &&
      /(EMAIL|KEY|PASSWORD|SECRET|TOKEN|URL)/i.test(name)
    ) {
      redacted = redacted.replaceAll(secret, `[redacted:${name}]`);
    }
  }
  return redacted
    .replace(/eyJ[A-Za-z0-9._-]+/g, "[redacted:jwt]")
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function formatSafeRlsFailure(
  output: string,
  stderr: string,
  environment: SupabaseEnvironment
) {
  const details: string[] = [];
  try {
    const report = parseRlsMatrixReport(output);
    details.push(
      `total=${report.numTotalTests ?? 0} passed=${report.numPassedTests ?? 0} failed=${report.numFailedTests ?? 0} pending=${report.numPendingTests ?? 0} todo=${report.numTodoTests ?? 0}`
    );
    for (const testFile of report.testResults ?? []) {
      if (testFile.message) {
        details.push(testFile.message);
      }
      for (const assertion of testFile.assertionResults ?? []) {
        if (assertion.status !== "failed") {
          continue;
        }
        details.push(assertion.fullName ?? assertion.title ?? "failed assertion");
        details.push(...(assertion.failureMessages ?? []));
      }
    }
    if (stderr.trim()) {
      details.push(stderr);
    }
  } catch {
    details.push("Vitest JSON report was unavailable");
    if (stderr.trim()) {
      details.push(stderr);
    }
  }

  return redactRlsEnvironmentValues(details.join("\n"), environment).slice(
    0,
    4_000
  );
}

function defaultDependencies(): LocalSupabaseCiDependencies {
  return {
    acquireStackSlot: () => acquireNativeStackSlot({
      label: `local Supabase CI (${path.basename(process.argv[1] ?? "node")})`,
      waitMs: nativeStackWaitMs(),
    }),
    ensureRuntime: () => assertNativeRuntimeHost(currentNativeRuntimeHost()),
    environment: process.env,
    reservedPorts: new Set(),
    log: console.log,
    prepareProject: prepareIsolatedProject,
    provisionUsers: provisionLocalUsers,
    removeProject: removeIsolatedProject,
    runRls: runRlsMatrix,
    resolvePsql: resolveNativePsql,
    supabase: (args, capture = false) =>
      runSupabaseCli(args, { capture, environment: process.env }),
    validateProject: () => inspectSupabaseMigrations().errors,
    verifyMigrations: (output) => {
      const inventory = inspectSupabaseMigrations();
      const rows = parseSupabaseMigrationList(output);
      return [
        ...inventory.errors,
        ...(rows.length === 0
          ? ["migration list output was not recognized"]
          : []),
        ...validateAppliedMigrationRows(inventory.versions, rows),
      ];
    },
  };
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

const SAFE_DIAGNOSTIC_PHASES = new Set([
  "reserve native stack slot",
  "prepare isolated project",
  "start local stack",
  "restore database snapshot",
  "reset local database",
  "verify migration inventory",
  "verify database snapshot",
  "run statement budgets",
  "run pgTAP",
  "run behavioral RLS matrix",
]);

/** How the run obtained its migrated database; recorded in the run log. */
export interface LocalDatabaseProvenance {
  source: "reset" | "snapshot";
  snapshot: "disabled" | "recorded" | "not-recorded" | "restored" | "rejected";
  key?: string;
  reason?: string;
}

/**
 * The template every isolated config.toml derives from, before the project ID
 * and the ports are replaced: part of the database snapshot key.
 */
export function readIsolatedConfigTemplate(rootDirectory = process.cwd()) {
  return enableNativeStack(fs.readFileSync(path.join(rootDirectory, "supabase", "config.toml"), "utf8"));
}

function elapsedSeconds(startedAt: number) {
  return ((Date.now() - startedAt) / 1000).toFixed(1);
}

function appliedMigrationVersions(output: string) {
  return parseSupabaseMigrationList(output)
    .map((row) => row.remote)
    .filter((version): version is string => Boolean(version))
    .sort();
}

/**
 * An error whose author guarantees a message free of credentials, account
 * identities and URLs. It is the only message a phase outside
 * SAFE_DIAGNOSTIC_PHASES surfaces; any other cause stays hidden.
 */
export class SafeDiagnosticError extends Error {
  override name = "SafeDiagnosticError";
}

// Error class names; machine codes in one case (Auth `email_exists`, undici
// `UND_ERR_SOCKET`, PostgREST `PGRST116`) or a SQLSTATE such as `22P02`.
// Supabase API keys (`sb_…`), JWTs, emails and URLs never match.
const SAFE_FAILURE_NAME = /^[A-Za-z][A-Za-z0-9]{0,47}$/;
const SAFE_FAILURE_CODE = /^(?!sb_)(?:[a-z][a-z0-9]*(?:_[a-z0-9]+)*|[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*|[0-9][0-9A-Z]{4})$/;

function safeFailureField(source: unknown, key: "name" | "code", pattern: RegExp) {
  const value = source && typeof source === "object" ? (source as Record<string, unknown>)[key] : undefined;
  return typeof value === "string" && value.length <= 48 && pattern.test(value) ? value : undefined;
}

/**
 * Identifies a Supabase client or fetch failure by its error name, HTTP
 * status, machine code and network cause. Messages, details and hints can
 * quote emails, row values or URLs, so they are never read.
 */
export function describeSafeFailure(error: unknown, status?: number) {
  const name = safeFailureField(error, "name", SAFE_FAILURE_NAME);
  const ownStatus = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  const httpStatus = [status, ownStatus].find((value): value is number =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 599);
  const code = safeFailureField(error, "code", SAFE_FAILURE_CODE);
  const cause = error && typeof error === "object" ? (error as { cause?: unknown }).cause : undefined;
  const causeName = safeFailureField(cause, "name", SAFE_FAILURE_NAME);
  const causeCode = safeFailureField(cause, "code", SAFE_FAILURE_CODE);
  const parts = [
    name,
    httpStatus === undefined ? undefined : `status=${httpStatus}`,
    code && `code=${code}`,
    causeName || causeCode ? `cause=${[causeName, causeCode].filter(Boolean).join(":")}` : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "unidentified failure";
}

function createPhaseError(phase: string, error: unknown) {
  const cause = asError(error);
  let detail = SAFE_DIAGNOSTIC_PHASES.has(phase) || cause instanceof SafeDiagnosticError ? `: ${cause.message}` : "";
  if (
    SAFE_DIAGNOSTIC_PHASES.has(phase) &&
    error instanceof SupabaseCliCommandError
  ) {
    detail += `\n${redactRlsEnvironmentValues(error.capturedOutput, {}).slice(-6_000)}`;
  }
  return new Error(`Phase failed: ${phase}${detail}`, { cause });
}

export async function runLocalSupabaseCi(
  overrides: Partial<LocalSupabaseCiDependencies> = {}
): Promise<{ database: LocalDatabaseProvenance }> {
  const dependencies = { ...defaultDependencies(), ...overrides };
  assertNoRemoteSupabaseEnvironment(dependencies.environment);
  if (dependencies.skipRlsMatrix && dependencies.runApplication) {
    throw new Error("--skip-rls applies to db:ci:local only, never to an application validation");
  }

  const projectErrors = dependencies.validateProject();
  if (projectErrors.length > 0) {
    throw new Error(projectErrors.join("\n"));
  }
  // Opt-in: without ARMY_DB_SNAPSHOT_DIR every run keeps `db reset`.
  const snapshotDirectory = resolveDatabaseSnapshotDirectory(dependencies.environment);
  dependencies.ensureRuntime();

  // The captured CLI output appends stderr update notices after stdout.
  const cliVersion = dependencies.supabase(["--version"], true).trim().split(/\r?\n/, 1)[0];
  if (cliVersion !== PINNED_SUPABASE_CLI_VERSION) {
    throw new Error(
      `Supabase CLI must be exactly ${PINNED_SUPABASE_CLI_VERSION}; received ${cliVersion}`
    );
  }

  let primaryError: Error | undefined;
  let slot: NativeStackSlot | undefined;
  let interrupted: NodeJS.Signals | undefined;
  let cleanedUp = false;
  let startAttempted = false;
  let project: IsolatedSupabaseProject | undefined;
  let status: LocalSupabaseStatus | undefined;
  let provisioned: ProvisionedUsers | undefined;
  const cleanupErrors: Error[] = [];
  let activePhase = "preflight";
  // A signal the caller owns (Army dev modes) stops the run at the next phase.
  let cancelRequested: NodeJS.Signals | undefined;
  const checkpoint = (phase: string) => {
    if (cancelRequested) throw new SafeDiagnosticError(`Interrupted by ${cancelRequested} before ${phase}`);
    activePhase = phase;
  };
  const provenance: LocalDatabaseProvenance = { source: "reset", snapshot: "disabled" };
  const withWorkdir = (args: string[]) => [
    ...args,
    "--workdir",
    project?.rootDirectory ?? "",
  ];
  const resetDatabase = () => {
    activePhase = "reset local database";
    const startedAt = Date.now();
    dependencies.supabase(withWorkdir(["db", "reset", "--local"]), true);
    dependencies.log(`Local database reset completed in ${elapsedSeconds(startedAt)} s.`);
  };
  const verifyMigrationInventory = () => {
    activePhase = "verify migration inventory";
    const migrationOutput = dependencies.supabase(
      withWorkdir([
        "migration",
        "list",
        "--local",
        "--output-format",
        "json",
      ]),
      true
    );
    const migrationErrors = dependencies.verifyMigrations(migrationOutput);
    if (migrationErrors.length > 0) {
      throw new Error(migrationErrors.join("\n"));
    }
    dependencies.log("Local migration inventory matches the repository.");
    return appliedMigrationVersions(migrationOutput);
  };

  // Auth users and domain rows live only in this disposable stack. Deleting
  // users through Auth first can invoke application cascades and immutable
  // audit guards; destroying the stack is the authoritative cleanup boundary.
  // A native `stop` keeps the stack's data, so the destroy always follows,
  // even when the stop failed. Runs once: from `finally` or from a signal.
  const destroyStack = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (startAttempted && project) {
      for (const cleanupArgs of [["stop"], ["stack", "destroy", "--yes"]]) {
        try {
          dependencies.supabase(withWorkdir(cleanupArgs), true);
        } catch (error) {
          cleanupErrors.push(asError(error));
        }
      }
    }
    if (project) {
      try {
        dependencies.removeProject(project);
      } catch (error) {
        cleanupErrors.push(asError(error));
      }
    }
    slot?.release();
  };
  const removeSignalHandlers = cleanUpOnTerminationSignals((signal) => {
    interrupted = signal;
    dependencies.log(`${signal} received: destroying the local Supabase stack.`);
    destroyStack();
    // The process ends right after: report what could not be cleaned now.
    for (const error of cleanupErrors) dependencies.log(`Cleanup failed after ${signal}: ${error.message}`);
  }, process, (signal) => {
    cancelRequested ??= signal;
  });
  const pgTapFiles = dependencies.pgTapFiles;
  if (pgTapFiles || dependencies.skipRlsMatrix) {
    dependencies.log(
      `Partial run (${pgTapFiles ? `pgTAP: ${pgTapFiles.join(", ")}` : "every pgTAP file"}; ` +
      `RLS matrix ${dependencies.skipRlsMatrix ? "skipped" : "kept"}): not a full db:ci:local proof.`
    );
  }

  try {
    checkpoint("reserve native stack slot");
    slot = await dependencies.acquireStackSlot();
    checkpoint("prepare isolated project");
    project = await dependencies.prepareProject(dependencies.reservedPorts);
    slot.recordStack(project.rootDirectory);
    dependencies.onProjectPrepared?.({ ...project });
    if (interrupted) throw new Error(`Interrupted by ${interrupted} before the stack started`);
    startAttempted = true;
    checkpoint("start local stack");
    // Postgres starts eagerly; Auth and the Data API start on their first request.
    dependencies.supabase(withWorkdir(["start", "--runtime", "native"]), true);
    dependencies.log("Local Supabase stack started.");
    if (dependencies.onStackStarted) {
      checkpoint("read local status");
      dependencies.onStackStarted({ ...parseLocalSupabaseStatus(
        dependencies.supabase(withWorkdir(["status", "--env"]), true)
      ) });
    }

    let snapshotContext: {
      databaseUrl: string;
      directory: string;
      key: DatabaseSnapshotKey;
      operations: DatabaseSnapshotOperations;
      tools: NativePostgresTools;
    } | undefined;
    let restored: DatabaseSnapshot | undefined;
    let stackBeforeRestore: DatabaseFingerprint | undefined;
    if (snapshotDirectory) {
      checkpoint("restore database snapshot");
      const operations = dependencies.databaseSnapshot ?? createDatabaseSnapshotOperations({
        configTemplate: () => readIsolatedConfigTemplate(),
        environment: dependencies.environment,
        rootDirectory: process.cwd(),
        supabaseCli: cliVersion,
      });
      const { databaseUrl } = parseLocalSupabaseStatus(
        dependencies.supabase(withWorkdir(["status", "--env"]), true)
      );
      if (!databaseUrl) throw new Error("Local PostgreSQL status is missing for the database snapshot");
      const tools = operations.resolveTools();
      const key = operations.computeKey(tools.bundle);
      snapshotContext = { databaseUrl, directory: snapshotDirectory, key, operations, tools };
      provenance.key = key.key;
      const lookup = operations.lookUp(snapshotDirectory, key.key);
      if (lookup.hit) {
        const startedAt = Date.now();
        try {
          // This stack's own state (stack-owned schemas, database settings),
          // which the restore must carry over unchanged.
          stackBeforeRestore = operations.fingerprint(tools, databaseUrl);
          operations.restore({ databaseUrl, snapshot: lookup.snapshot, tools });
          restored = lookup.snapshot;
          dependencies.log(`Database snapshot ${key.key.slice(0, 12)} restored in ${elapsedSeconds(startedAt)} s instead of db reset.`);
        } catch (error) {
          provenance.snapshot = "rejected";
          provenance.reason = `restore failed: ${asError(error).message}`;
          dependencies.log(`Database snapshot ${key.key.slice(0, 12)} could not be restored (${asError(error).message}); falling back to db reset.`);
        }
      } else {
        dependencies.log(`Database snapshot miss (${lookup.reason}); running db reset.`);
      }
    }

    let appliedVersions: string[] = [];
    if (restored && snapshotContext) {
      // Cheap equivalence proof: the restored database must carry the very
      // migrations and catalog fingerprint recorded right after a reset, and
      // this stack's own state unchanged. Any doubt falls back to db reset.
      const { databaseUrl, operations, tools } = snapshotContext;
      let problems: string[];
      try {
        appliedVersions = verifyMigrationInventory();
        activePhase = "verify database snapshot";
        const fingerprint = operations.fingerprint(tools, databaseUrl);
        problems = [
          ...(JSON.stringify(appliedVersions) === JSON.stringify([...restored.manifest.migrations].sort())
            ? []
            : ["applied migrations differ from the snapshot"]),
          ...compareDatabaseFingerprints(restored.manifest.fingerprint, fingerprint)
            .map((component) => `fingerprint ${component} differs`),
          ...(stackBeforeRestore && compareStackState(stackBeforeRestore, fingerprint)
            ? []
            : ["this stack's own state did not survive the restore"]),
        ];
      } catch (error) {
        problems = [`verification failed: ${asError(error).message}`];
      }
      if (problems.length === 0) {
        provenance.source = "snapshot";
        provenance.snapshot = "restored";
        dependencies.log("Database snapshot verified: applied migrations and catalog fingerprint match the recorded reset.");
      } else {
        provenance.snapshot = "rejected";
        provenance.reason = problems.join("; ");
        dependencies.log(`Database snapshot rejected after restore (${provenance.reason}); falling back to db reset.`);
        restored = undefined;
      }
    }

    if (!restored) {
      resetDatabase();
      appliedVersions = verifyMigrationInventory();
      if (snapshotContext) {
        // Recorded right after the reset and its inventory check, before
        // pgTAP, Auth users or fixtures touch the database. A failed recording
        // costs the next run its speed, never this run's evidence.
        const { databaseUrl, directory, key, operations, tools } = snapshotContext;
        activePhase = "record database snapshot";
        const startedAt = Date.now();
        try {
          const fingerprint = operations.fingerprint(tools, databaseUrl);
          const manifest = operations.record({ databaseUrl, directory, fingerprint, key, migrations: appliedVersions, tools });
          if (provenance.snapshot === "disabled") provenance.snapshot = "recorded";
          dependencies.log(`Database snapshot ${key.key.slice(0, 12)} recorded in ${elapsedSeconds(startedAt)} s (${manifest.dump.bytes} bytes).`);
        } catch (error) {
          if (provenance.snapshot === "disabled") provenance.snapshot = "not-recorded";
          dependencies.log(`Database snapshot not recorded: ${asError(error).message}`);
        }
      }
    }
    dependencies.onDatabaseProvenance?.({ ...provenance });

    checkpoint("run pgTAP");
    const pgTapDirectory = path.join(project.rootDirectory, PGTAP_DIRECTORY);
    const pgTapOutput = dependencies.supabase(withWorkdir([
      "test",
      "db",
      "--local",
      ...(pgTapFiles ? pgTapFiles.map((file) => path.join(pgTapDirectory, file)) : [pgTapDirectory]),
    ]), true);
    const expectedTestFiles = pgTapFiles?.length ?? fs.readdirSync(
      path.join(process.cwd(), PGTAP_DIRECTORY)
    ).filter((file) => file.endsWith(".sql")).length;
    validatePgTapReport(pgTapOutput, expectedTestFiles);
    dependencies.log(pgTapOutput.trim());
    dependencies.log("Database pgTAP tests passed.");
    // Wall-clock budgets are opt-in and never run in CI: they are calibrated in
    // WSL, and a single-run CI timing depends on the runner class drawn
    // (docs/testing/large-estimate-statement-budget.md).
    if (dependencies.environment.DB_CI_STATEMENT_BUDGET === "enforce") {
      activePhase = "run statement budgets";
      const budgetOutput = dependencies.supabase(withWorkdir([
        "test",
        "db",
        "--local",
        path.join(project.rootDirectory, "supabase", "tests", "budget"),
      ]), true);
      validatePgTapReport(budgetOutput, fs.readdirSync(
        path.join(process.cwd(), "supabase", "tests", "budget")
      ).filter((file) => file.endsWith(".sql")).length);
      dependencies.log(budgetOutput.trim());
      dependencies.log("Statement budgets passed.");
    }

    if (dependencies.skipRlsMatrix) {
      dependencies.log("Behavioral RLS matrix skipped (--skip-rls).");
    } else {
      checkpoint("read local status");
      status = parseLocalSupabaseStatus(
        dependencies.supabase(withWorkdir(["status", "--env"]), true)
      );
      checkpoint("provision local Auth users");
      provisioned = await dependencies.provisionUsers(status);
      checkpoint("run behavioral RLS matrix");
      const localEnvironment = {
        ...createLocalCiEnvironment(dependencies.environment),
        ...provisioned.environment,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: status.anonKey,
        NEXT_PUBLIC_SUPABASE_URL: status.url,
        RLS_E2E: "1",
        RLS_E2E_EPHEMERAL: "1",
        RLS_E2E_LOCAL: "1",
        SUPABASE_SERVICE_ROLE_KEY: status.serviceRoleKey,
      };
      await dependencies.runRls(localEnvironment);
      dependencies.log("Behavioral RLS matrix passed.");
      if (dependencies.runApplication) {
        checkpoint("run application validation");
        if (!status.databaseUrl) throw new Error("Local PostgreSQL status is missing for the application fixtures");
        await dependencies.runApplication({
          ...localEnvironment,
          E2E_ARMY_LOCAL_DB_URL: status.databaseUrl,
          E2E_ARMY_LOCAL_PSQL: dependencies.resolvePsql(),
        });
        dependencies.log("Application validation passed.");
      }
    }
  } catch (error) {
    primaryError = createPhaseError(activePhase, error);
  } finally {
    destroyStack();
    removeSignalHandlers();
  }

  if (interrupted && !primaryError) primaryError = new Error(`Interrupted by ${interrupted}; the local stack was destroyed`);
  if (primaryError || cleanupErrors.length > 0) {
    throw new AggregateError(
      [primaryError, ...cleanupErrors].filter(Boolean),
      primaryError?.message ?? "Local Supabase CI cleanup failed"
    );
  }
  return { database: provenance };
}
