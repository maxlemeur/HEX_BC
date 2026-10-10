import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

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
}

interface ProvisionedUsers {
  environment: SupabaseEnvironment;
  userIds: string[];
}

interface IsolatedSupabaseProject {
  projectId: string;
  rootDirectory: string;
}

interface LocalSupabaseCiDependencies {
  ensureRuntime: () => void;
  environment: SupabaseEnvironment;
  log: (message: string) => void;
  prepareProject: () => Promise<IsolatedSupabaseProject>;
  provisionUsers: (
    status: LocalSupabaseStatus
  ) => Promise<ProvisionedUsers>;
  runRls: (environment: SupabaseEnvironment) => void;
  removeProject: (project: IsolatedSupabaseProject) => void;
  supabase: (args: string[], capture?: boolean) => string;
  validateProject: () => string[];
  verifyMigrations: (output: string) => string[];
}

function findAvailablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate an isolated Supabase port"));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(address.port);
        }
      });
    });
  });
}

async function prepareIsolatedProject(): Promise<IsolatedSupabaseProject> {
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
    const reservedPorts = new Set(configuredPorts);
    const portReplacements = new Map<number, number>();
    for (const configuredPort of configuredPorts) {
      let isolatedPort = await findAvailablePort();
      while (reservedPorts.has(isolatedPort)) {
        isolatedPort = await findAvailablePort();
      }
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
    return { projectId, rootDirectory };
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
  return { url, anonKey, serviceRoleKey };
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

function runRlsMatrix(environment: SupabaseEnvironment) {
  const result = spawnSync(
    process.execPath,
    [
      resolveVitestEntry(),
      "run",
      "--project=node",
      "src/lib/estimates/rls.e2e.test.ts",
      "--reporter=verbose",
      "--reporter=json",
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: environment as NodeJS.ProcessEnv,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  if (result.error) {
    throw new Error("Could not start the local RLS test process");
  }

  const output = result.stdout ?? "";
  if (result.status !== 0) {
    throw new Error(formatSafeRlsFailure(output, result.stderr ?? "", environment));
  }
  validateRlsMatrixReport(output);
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
    ensureRuntime: () => assertNativeRuntimeHost(currentNativeRuntimeHost()),
    environment: process.env,
    log: console.log,
    prepareProject: prepareIsolatedProject,
    provisionUsers: provisionLocalUsers,
    removeProject: removeIsolatedProject,
    runRls: runRlsMatrix,
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
  "prepare isolated project",
  "start local stack",
  "reset local database",
  "verify migration inventory",
  "run pgTAP",
  "run behavioral RLS matrix",
]);

function createPhaseError(phase: string, error: unknown) {
  const cause = asError(error);
  let detail = SAFE_DIAGNOSTIC_PHASES.has(phase) ? `: ${cause.message}` : "";
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
) {
  const dependencies = { ...defaultDependencies(), ...overrides };
  assertNoRemoteSupabaseEnvironment(dependencies.environment);

  const projectErrors = dependencies.validateProject();
  if (projectErrors.length > 0) {
    throw new Error(projectErrors.join("\n"));
  }
  dependencies.ensureRuntime();

  const cliVersion = dependencies.supabase(["--version"], true).trim();
  if (cliVersion !== PINNED_SUPABASE_CLI_VERSION) {
    throw new Error(
      `Supabase CLI must be exactly ${PINNED_SUPABASE_CLI_VERSION}; received ${cliVersion}`
    );
  }

  let primaryError: Error | undefined;
  let startAttempted = false;
  let project: IsolatedSupabaseProject | undefined;
  let status: LocalSupabaseStatus | undefined;
  let provisioned: ProvisionedUsers | undefined;
  const cleanupErrors: Error[] = [];
  let activePhase = "preflight";
  const withWorkdir = (args: string[]) => [
    ...args,
    "--workdir",
    project?.rootDirectory ?? "",
  ];

  try {
    activePhase = "prepare isolated project";
    project = await dependencies.prepareProject();
    startAttempted = true;
    activePhase = "start local stack";
    // Postgres starts eagerly; Auth and the Data API start on their first request.
    dependencies.supabase(withWorkdir(["start", "--runtime", "native"]), true);
    dependencies.log("Local Supabase stack started.");

    activePhase = "reset local database";
    dependencies.supabase(withWorkdir(["db", "reset", "--local"]), true);
    dependencies.log("Local database reset completed.");

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

    activePhase = "run pgTAP";
    const pgTapOutput = dependencies.supabase(withWorkdir([
      "test",
      "db",
      "--local",
      path.join(project.rootDirectory, "supabase", "tests", "database"),
    ]), true);
    const expectedTestFiles = fs.readdirSync(
      path.join(process.cwd(), "supabase", "tests", "database")
    ).filter((file) => file.endsWith(".sql")).length;
    validatePgTapReport(pgTapOutput, expectedTestFiles);
    dependencies.log(pgTapOutput.trim());
    dependencies.log("Database pgTAP tests passed.");

    activePhase = "read local status";
    status = parseLocalSupabaseStatus(
      dependencies.supabase(withWorkdir(["status", "--env"]), true)
    );
    activePhase = "provision local Auth users";
    provisioned = await dependencies.provisionUsers(status);
    activePhase = "run behavioral RLS matrix";
    dependencies.runRls({
      ...createLocalCiEnvironment(dependencies.environment),
      ...provisioned.environment,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: status.anonKey,
      NEXT_PUBLIC_SUPABASE_URL: status.url,
      RLS_E2E: "1",
      RLS_E2E_EPHEMERAL: "1",
      RLS_E2E_LOCAL: "1",
      SUPABASE_SERVICE_ROLE_KEY: status.serviceRoleKey,
    });
    dependencies.log("Behavioral RLS matrix passed.");
  } catch (error) {
    primaryError = createPhaseError(activePhase, error);
  } finally {
    // Auth users and domain rows live only in this disposable stack. Deleting
    // users through Auth first can invoke application cascades and immutable
    // audit guards; destroying the stack is the authoritative cleanup boundary.
    // A native `stop` keeps the stack's data, so the destroy always follows,
    // even when the stop failed.
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
  }

  if (primaryError || cleanupErrors.length > 0) {
    throw new AggregateError(
      [primaryError, ...cleanupErrors].filter(Boolean),
      primaryError?.message ?? "Local Supabase CI cleanup failed"
    );
  }
}
