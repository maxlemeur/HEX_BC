// Lot 2, sub-lot 2.4: a disposable native Supabase stack owned by one engine-v3 proof script
// (TS/SQL parity). Same model as scripts/engine-v3/upgrade-check.ts and runLocalSupabaseCi
// (src/test/local-supabase-ci.ts): isolated temporary project with every repository migration,
// free ports outside the host ephemeral range and never the developers' long-running stack
// (45585, 33485) nor the Army app (3107), `supabase start --runtime native`, `db reset`, the
// migration inventory checked, then `stop` and `stack destroy` in finally. The owned database is
// reached as `postgres` through the native psql of the runtime. Linux (WSL) only.
//
// upgrade-check.ts keeps its own copy of these steps: it is a 2.0 proof whose bytes the lot
// replays unchanged; factoring both onto this module is left to a later sub-lot.

import { resolveNativePostgresTools } from "../../src/test/database-snapshot";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
  inspectSupabaseMigrations,
  parseSupabaseMigrationList,
  validateAppliedMigrationRows,
} from "../../src/test/supabase-migrations";
import { redactOutput } from "../tester-army/local-recipe-common.mjs";

// Same defaults as src/test/local-supabase-ci.ts: every one is replaced.
const CONFIGURED_PORTS = [54320, 54321, 54322, 54323, 54324, 54327, 54329, 8083];
// The developers' long-running stack (API, database) and the default Army app.
export const NEVER_ALLOCATED_PORTS = [45585, 33485, 3107];
const PSQL_TIMEOUT_MS = 10 * 60_000;

export type OwnedStack = {
  projectId: string;
  rootDirectory: string;
  ports: Record<string, number>;
  psqlVersion: string;
  /** Runs the owned native psql as `postgres`; output is appended, redacted, to the log. */
  psql: (args: string[], step: string) => string;
};

export type OwnedStackCleanup = { stop: string; destroy: string; workdirRemoved: boolean };

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
  if (process.platform !== "linux") {
    throw new Error("Host ephemeral port ranges require the supported native runtime host (Linux, WSL)");
  }
  const value = fs.readFileSync("/proc/sys/net/ipv4/ip_local_port_range", "utf8").trim();
  if (!/^\d+\s+\d+$/.test(value)) throw new Error("Invalid host ephemeral port range");
  return [value.split(/\s+/).map(Number)];
}

function removeOwnedProject(rootDirectory: string, prefix: string) {
  const resolvedRoot = path.resolve(rootDirectory);
  const resolvedTemp = path.resolve(os.tmpdir());
  if (!resolvedRoot.startsWith(`${resolvedTemp}${path.sep}`) || !path.basename(resolvedRoot).startsWith(prefix)) {
    throw new Error("Refusing to remove a non-isolated Supabase workdir");
  }
  fs.rmSync(resolvedRoot, { force: true, recursive: true });
}

async function prepareOwnedProject(prefix: string) {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const projectId = `miaouffrage-parity-${process.pid}-${randomUUID().slice(0, 8)}`;
  try {
    const sourceDirectory = path.join(process.cwd(), "supabase");
    fs.mkdirSync(path.join(rootDirectory, "supabase"), { recursive: true });
    fs.cpSync(path.join(sourceDirectory, "migrations"), path.join(rootDirectory, "supabase", "migrations"), {
      recursive: true,
    });
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
      if (new RegExp(`\\b${configuredPort}\\b`).test(config) || !new RegExp(`\\b${isolatedPort}\\b`).test(config)) {
        throw new Error(`Could not isolate Supabase port configured at ${configuredPort}`);
      }
    }
    fs.writeFileSync(path.join(rootDirectory, "supabase", "config.toml"), config, "utf8");
    return { projectId, rootDirectory, ports };
  } catch (error) {
    removeOwnedProject(rootDirectory, prefix);
    throw error;
  }
}

function resolveNativePsql() {
  return resolveNativePostgresTools().psql;
}

export function createSecretRedactor(getPassword: () => string | undefined) {
  return (value: string) =>
    // CLI failures may echo the disposable stack's API and storage keys.
    redactOutput(value, { NODE_ENV: "test", OWNED_STACK_PGPASSWORD: getPassword() ?? "" })
      .replace(/(?<![A-Za-z0-9])sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[REDACTED-KEY]")
      .replace(/((?:secret|access)[ _-]?key\W*)[A-Za-z0-9+/=_-]{16,}/gi, "$1[REDACTED]");
}

export function describeFailure(error: unknown) {
  if (error instanceof SupabaseCliCommandError) return `${error.message}\n${error.capturedOutput.slice(-6_000)}`;
  return error instanceof Error ? error.message : String(error);
}

/**
 * Owns one disposable native stack for `run`, then always stops and destroys it and removes the
 * isolated workdir. `log` receives progress lines; `psqlLog` receives every redacted psql output.
 */
export async function withOwnedNativeStack<T>(
  options: { prefix: string; psqlLog: string; log: (message: string) => void },
  run: (stack: OwnedStack) => Promise<T> | T
): Promise<{ result?: T; error?: unknown; cleanup: OwnedStackCleanup; cleanupErrors: string[] }> {
  if (process.platform !== "linux") {
    throw new Error(
      "The owned stack uses the Supabase native runtime, which does not run on Windows: run it inside WSL (Ubuntu 22.04 or later) from a Linux checkout, one native-stack run at a time."
    );
  }
  assertNoRemoteSupabaseEnvironment(process.env);
  const inventory = inspectSupabaseMigrations();
  if (inventory.errors.length > 0) throw new Error(inventory.errors.join("\n"));
  assertNativeRuntimeHost(currentNativeRuntimeHost());
  const supabase = (args: string[]) => runSupabaseCli(args, { capture: true, environment: process.env });
  const cliVersion = supabase(["--version"]).trim().split(/\r?\n/, 1)[0];
  if (cliVersion !== PINNED_SUPABASE_CLI_VERSION) {
    throw new Error(`Supabase CLI must be exactly ${PINNED_SUPABASE_CLI_VERSION}; received ${cliVersion}`);
  }

  let password: string | undefined;
  const redact = createSecretRedactor(() => password);
  let project: Awaited<ReturnType<typeof prepareOwnedProject>> | undefined;
  let startAttempted = false;
  const cleanup: OwnedStackCleanup = { stop: "not started", destroy: "not started", workdirRemoved: false };
  const cleanupErrors: string[] = [];
  const withWorkdir = (args: string[]) => [...args, "--workdir", project?.rootDirectory ?? ""];
  let result: T | undefined;
  let primaryError: unknown;
  let slot: NativeStackSlot | undefined;
  let cleanedUp = false;
  // Runs once: from `finally` or from SIGINT/SIGTERM (see native-stack-guard).
  const destroyStack = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (startAttempted && project) {
      // A native `stop` keeps the stack's data: the destroy always follows.
      for (const [key, args] of [["stop", ["stop"]], ["destroy", ["stack", "destroy", "--yes"]]] as const) {
        try {
          supabase(withWorkdir([...args]));
          cleanup[key] = "ok";
        } catch (error) {
          cleanup[key] = "failed";
          cleanupErrors.push(`${key}: ${redact(describeFailure(error))}`);
        }
      }
    }
    if (project) {
      try {
        removeOwnedProject(project.rootDirectory, options.prefix);
        cleanup.workdirRemoved = true;
      } catch (error) {
        cleanupErrors.push(`workdir: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    slot?.release();
  };
  const removeSignalHandlers = cleanUpOnTerminationSignals((signal) => {
    options.log(`${signal} received: destroying the disposable native stack.`);
    destroyStack();
    // The process ends right after: report what could not be cleaned now.
    for (const error of cleanupErrors) options.log(`Cleanup failed after ${signal}: ${error}`);
  });
  try {
    slot = await acquireNativeStackSlot({ label: `engine-v3 owned stack (${options.prefix})`, waitMs: nativeStackWaitMs() });
    project = await prepareOwnedProject(options.prefix);
    slot.recordStack(project.rootDirectory);
    startAttempted = true;
    supabase(withWorkdir(["start", "--runtime", "native"]));
    options.log("disposable native stack started.");
    supabase(withWorkdir(["db", "reset", "--local"]));
    const rows = parseSupabaseMigrationList(
      supabase(withWorkdir(["migration", "list", "--local", "--output-format", "json"]))
    );
    const migrationErrors = [
      ...(rows.length === 0 ? ["migration list output was not recognized"] : []),
      ...validateAppliedMigrationRows(inventory.versions, rows),
    ];
    if (migrationErrors.length > 0) throw new Error(`Migration inventory differs:\n${migrationErrors.join("\n")}`);
    options.log(`database reset with ${rows.length} migrations, matching the repository inventory.`);

    const status = parseLocalSupabaseStatus(supabase(withWorkdir(["status", "--env"])));
    if (!status.databaseUrl) throw new Error("Local PostgreSQL status is missing");
    // parseLocalSupabaseStatus already required the owned loopback backend, user `postgres`,
    // database `/postgres` and no routing parameters.
    const url = new URL(status.databaseUrl);
    password = decodeURIComponent(url.password);
    const executable = resolveNativePsql();
    const environment: NodeJS.ProcessEnv = {
      ...createLocalCiEnvironment(process.env),
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PGAPPNAME: "miaouffrage-engine-v3-parity",
      PGCONNECT_TIMEOUT: "10",
      PGDATABASE: "postgres",
      PGHOST: url.hostname === "[::1]" ? "::1" : url.hostname,
      PGOPTIONS: "-c TimeZone=UTC -c lock_timeout=30000",
      PGPASSWORD: password,
      PGPORT: url.port,
      PGSSLMODE: "disable",
      PGUSER: "postgres",
    };
    const psql = (args: string[], step: string) => {
      const child = spawnSync(executable, ["-X", "--no-password", "-v", "ON_ERROR_STOP=1", ...args], {
        encoding: "utf8",
        env: environment,
        maxBuffer: 256 * 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: PSQL_TIMEOUT_MS,
      });
      const output = redact([child.stdout, child.stderr].filter(Boolean).join("\n"));
      fs.appendFileSync(options.psqlLog, `### ${step} (exit ${child.status ?? "none"})\n${output.slice(-20_000)}\n`);
      if (child.error || child.status !== 0) {
        throw new Error(`psql failed during ${step} (exit ${child.status ?? "none"}):\n${output.slice(-4_000)}`);
      }
      return child.stdout ?? "";
    };
    const psqlVersion = psql(["--version"], "psql version").trim();
    result = await run({
      projectId: project.projectId,
      rootDirectory: project.rootDirectory,
      ports: project.ports,
      psqlVersion,
      psql,
    });
  } catch (error) {
    primaryError = error;
  } finally {
    destroyStack();
    removeSignalHandlers();
  }
  return {
    result,
    error: primaryError === undefined ? undefined : new Error(redact(describeFailure(primaryError))),
    cleanup,
    cleanupErrors,
  };
}
