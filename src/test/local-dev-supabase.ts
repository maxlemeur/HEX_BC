import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseArgs, parseEnv } from "node:util";

import { createClient } from "@supabase/supabase-js";

import { reserveAppPort, type AppPortLease } from "../../scripts/tester-army/app-port";
import type { Database } from "@/types/database";
import {
  entry, localDevStackDirectory, localDevStackRegistryId, privateDirectory, readFile, readOwner, readPrivateJson,
  registryIdPattern, sha256, type OwnerRecord,
} from "./local-dev-supabase-owner";
import {
  assertNativeRuntimeHost, currentNativeRuntimeHost, describeSafeFailure, parseLocalSupabaseStatus, prepareNativeStackConfig,
  type LocalSupabaseStatus,
} from "./local-supabase-ci";
import { acquireNativeStackSlot } from "./native-stack-guard";
import { assertNoRemoteSupabaseEnvironment, createLocalCiEnvironment, resolveSupabaseCli, type SupabaseEnvironment } from "./supabase-cli";
import { hashSupabaseMigrationContents, parseSupabaseMigrationList, validateAppliedMigrationRows } from "./supabase-migrations";

const envFile = ".env.supabase.local";
const usage = "Usage: npm run supabase:local -- start [--checkout PATH] | status | stop | destroy --yes";
const rebuild = "Back up any data you need before rebuilding with `npm run supabase:local -- destroy --yes` and then `npm run supabase:local -- start`.";
const migrationNamePattern = /^(?:\d{3}|\d{8}|\d{14})_[a-z0-9_]+\.sql$/;

interface Login { email: string; password: string; }

interface Dependencies {
  checkout: string;
  homeDirectory: string;
  environment: SupabaseEnvironment;
  log: (message: string) => void;
  assertIgnored: (directory: string) => void;
  prepareConfig: (checkout: string, projectId: string) => ReturnType<typeof prepareNativeStackConfig>;
  acquireStart: (ports: number[]) => Promise<() => void>;
  ensureAccount: (status: LocalSupabaseStatus, login: Login) => Promise<void>;
  cli: (command: string[], workdir: string) => string | null;
}

function writePrivateFile(file: string, text: string) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.fchmodSync(fd, 0o600);
      fs.writeFileSync(fd, text);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

const writeJson = (file: string, value: unknown) => writePrivateFile(file, `${JSON.stringify(value, null, 2)}\n`);

function checkoutDestination(checkout: string, assertIgnored: Dependencies["assertIgnored"]) {
  assertIgnored(checkout);
  const file = path.join(checkout, envFile);
  if (entry(file)) {
    const url = parseEnv(readFile(file)).NEXT_PUBLIC_SUPABASE_URL;
    if (url && !["127.0.0.1", "localhost", "[::1]"].includes(URL.parse(url)?.hostname ?? "")) {
      throw new Error(`${file} must use a loopback Supabase URL.`);
    }
  }
  return file;
}

function nativeRegistryId(registry: string, project: string, expectedId?: string) {
  if (entry(registry) && !entry(registry)?.isDirectory()) {
    throw new Error("The native Supabase registry identity cannot be verified.");
  }
  if (!entry(registry)) return undefined;
  const results = fs.readdirSync(registry).filter((name) => registryIdPattern.test(name)).filter((id) => {
    const dir = path.join(registry, id);
    const file = path.join(dir, "state.json");
    try {
      if (!entry(dir)?.isDirectory()) throw new Error("Invalid registry directory");
      const state = JSON.parse(readFile(file)) as {
        id?: string; identity?: { projectRoot?: string; stackName?: string; branchContext?: string };
      };
      if (state.identity?.projectRoot !== project && id !== expectedId) return false;
      if (state.id === id && state.identity?.projectRoot === project &&
        state.identity.stackName === "default" && state.identity.branchContext === "ordinary-workspace") return true;
    } catch {
      if (id !== expectedId) return false;
    }
    throw new Error("The native Supabase registry identity does not match the owned project.");
  });
  if (results.length > 1 || (results.length === 1 && expectedId && expectedId !== results[0])) {
    throw new Error("The native Supabase registry identity is ambiguous for the owned project.");
  }
  return results[0];
}

async function prepareProject(base: string, active: string, dependencies: Dependencies) {
  const projectId = `mergeone-dev-${randomUUID()}`;
  const { config, ports } = await dependencies.prepareConfig(dependencies.checkout, projectId);
  const staged = fs.mkdtempSync(path.join(base, ".prepare-"));
  try {
    const supabase = path.join(staged, projectId, "supabase");
    fs.mkdirSync(path.join(supabase, "migrations"), { recursive: true, mode: 0o700 });
    writePrivateFile(path.join(supabase, "config.toml"), config);
    writeJson(path.join(staged, "owner.json"), { projectId, ports, configHash: sha256(config) });
    writeJson(path.join(staged, "login.json"), {
      email: `mergeone-dev-${randomUUID()}@example.test`,
      password: `Dev-${randomUUID()}-A1!`,
    } satisfies Login);
    fs.renameSync(staged, active);
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
}

function applyMigrations(workdir: string, migrations: Map<string, string>, previous: OwnerRecord["applied"], cli: Dependencies["cli"]) {
  for (const [file, digest] of Object.entries(previous ?? {})) {
    const content = migrations.get(file);
    if (content === undefined || (hashSupabaseMigrationContents(content) !== digest && sha256(content) !== digest)) {
      throw new Error(`The checkout is missing or changed applied migration ${file}. Use a checkout with the applied history. ${rebuild}`);
    }
  }
  const destination = path.join(workdir, "supabase", "migrations");
  privateDirectory(destination);
  for (const file of fs.readdirSync(destination)) {
    if (!migrations.has(file) && migrationNamePattern.test(file)) fs.unlinkSync(path.join(destination, file));
  }
  for (const [file, content] of migrations) writePrivateFile(path.join(destination, file), content);
  try {
    cli(["migration", "up"], workdir);
    const output = cli(["migration", "list", "--local", "--output-format", "json"], workdir) ?? "";
    const versions = [...migrations.keys()].map((file) => file.split("_", 1)[0]);
    const errors = validateAppliedMigrationRows(versions, parseSupabaseMigrationList(output));
    if (errors.length) throw new Error(errors[0]);
  } catch (error) {
    throw new Error(`Could not bring the local database to the checkout's migrations. ${(error as Error).message} ${rebuild}`);
  }
  return Object.fromEntries([...migrations].map(([file, content]) => [file, hashSupabaseMigrationContents(content)]));
}

async function ensureAccount(status: LocalSupabaseStatus, login: Login) {
  type OperationFailure = { error: unknown; status?: number };
  const fail = (operation: string, failure: OperationFailure) => {
    throw new Error(`Could not ${operation} for the local account (${describeSafeFailure(failure.error, failure.status)}).`);
  };
  const options = {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => fetch(input, { ...init, redirect: "error" }) },
  };
  const admin = createClient<Database>(status.url, status.serviceRoleKey, options);
  const created = await admin.auth.admin.createUser({ ...login, email_confirm: true });
  let user = created.data.user;
  if (created.error?.code === "email_exists") {
    // Recover when Auth committed the account but the command did not record completion.
    const client = createClient(status.url, status.anonKey, options);
    const signedIn = await client.auth.signInWithPassword(login);
    if (signedIn.error) fail("recover the existing account", signedIn);
    user = signedIn.data.user;
    await client.auth.signOut({ scope: "local" });
  }
  if (!user) return fail("create the account", created);

  // Like TesterArmy, rely on the Auth trigger and verify its default admin tenant.
  const membership = await admin.from("tenant_memberships").select("tenant_id, role, is_default").eq("user_id", user.id);
  const rows = membership.data;
  if (!rows || rows.length !== 1 || rows[0].role !== "admin" || !rows[0].is_default) {
    return fail("verify the default admin membership", membership);
  }
  const tenant = await admin.from("tenants").select("id")
    .eq("id", rows[0].tenant_id).eq("created_by", user.id).eq("is_active", true).single();
  if (!tenant.data) return fail("verify the active personal company", tenant);
}

function defaultDependencies(): Dependencies {
  const checkout = process.cwd();
  return {
    checkout, homeDirectory: os.homedir(), environment: process.env, log: console.log,
    assertIgnored: (directory) => {
      const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: directory, encoding: "utf8" });
      const ignored = spawnSync("git", ["check-ignore", "-q", "--", envFile], { cwd: directory });
      if (top.status !== 0 || fs.realpathSync(top.stdout.trim()) !== directory || ignored.status !== 0) {
        throw new Error(`Expected a Git checkout with ${envFile} ignored at ${directory}.`);
      }
    },
    prepareConfig: (root, id) => prepareNativeStackConfig(path.join(root, "supabase"), id, new Set([3000, 3001, 3107])),
    acquireStart: async (ports) => {
      assertNativeRuntimeHost(currentNativeRuntimeHost());
      const leases: AppPortLease[] = [];
      const release = () => {
        for (const lease of leases) lease.release();
      };
      try {
        for (const port of ports) leases.push(reserveAppPort({ port, label: "persistent local Supabase startup" }));
        return release;
      } catch (error) {
        release();
        throw error;
      }
    },
    ensureAccount,
    cli: (command, workdir) => {
      // The closed set of calls below contains only native/local commands.
      // Do not use the checkout as cwd: the CLI loads dotenv files.
      const result = spawnSync(resolveSupabaseCli(checkout), [...command, "--workdir", workdir], {
        cwd: workdir,
        env: { ...createLocalCiEnvironment(process.env), DO_NOT_TRACK: "1", SUPABASE_TELEMETRY_DISABLED: "1" },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 32 * 1024 * 1024,
      });
      if (result.status === 0) return result.stdout;
      // CLI 3.0 keeps the registry after stop, but refuses the environment export.
      if (command[0] === "status" && /^The stack owner or primary database is unavailable for environment export\.$/m.test(result.stderr)) {
        return null;
      }
      // Start, status and migration failure streams can contain credentials or SQL.
      const reason = (result.error as NodeJS.ErrnoException | undefined)?.code ?? result.signal ?? result.status;
      throw new Error(`Supabase CLI ${command.slice(0, 2).join(" ")} failed (${reason}).`);
    },
  };
}

export async function runLocalDevSupabase(args: string[], dependencies = defaultDependencies()) {
  const { positionals: [action, ...extra], values } = parseArgs({
    args, allowPositionals: true,
    options: { checkout: { type: "string" }, yes: { type: "boolean" }, help: { type: "boolean" } },
  });
  assertNoRemoteSupabaseEnvironment(dependencies.environment);
  if (values.help) return dependencies.log(usage);
  if (extra.length || !["start", "status", "stop", "destroy"].includes(action) ||
    (values.checkout !== undefined && (action !== "start" || !values.checkout)) || (values.yes && action !== "destroy")) {
    throw new Error(usage);
  }
  if (action === "destroy" && !values.yes) throw new Error("Destroy requires --yes. It removes the local stack and its data.");

  const { cli, log } = dependencies;
  const checkout = fs.realpathSync(dependencies.checkout);
  const home = fs.realpathSync(dependencies.homeDirectory);
  const base = localDevStackDirectory(home);
  const active = path.join(base, "active");
  const registry = path.join(home, ".supabase", "stacks");
  const loginFile = path.join(active, "login.json");
  const ownerFile = path.join(active, "owner.json");
  const destinations = action === "start" ? [...new Set([
    checkout, ...(values.checkout ? [fs.realpathSync(values.checkout)] : []),
  ])].map((directory) => checkoutDestination(directory, dependencies.assertIgnored)) : [];
  if (action !== "start" && !entry(base)) return log("No persistent local Supabase stack.");
  fs.mkdirSync(base, { recursive: true, mode: 0o700 });
  if (fs.realpathSync(base) !== base) throw new Error("The persistent Supabase path must not traverse symlinks.");
  privateDirectory(base);
  const operations = path.join(base, "operations");
  fs.mkdirSync(operations, { recursive: true, mode: 0o700 });
  privateDirectory(operations);
  const operation = await acquireNativeStackSlot({
    directory: operations, label: `supabase:local ${action}`, limit: 1, listProcesses: () => [],
  });
  try {
    if (!entry(active)) {
      if (action !== "start") return log("No persistent local Supabase stack.");
      await prepareProject(base, active, dependencies);
    }
    privateDirectory(active);
    const owner = readOwner(ownerFile);
    const project = path.join(active, owner.projectId);
    const supabase = path.join(project, "supabase");
    privateDirectory(project);
    privateDirectory(supabase);
    if (sha256(readFile(path.join(supabase, "config.toml"), true)) !== owner.configHash) {
      throw new Error("The persistent Supabase config does not match the owned project identity.");
    }
    for (const folder of [project, supabase]) {
      if (fs.readdirSync(folder).some((file) => /^\.env(?:\.|$)/.test(file) || file === ".branches") ||
        entry(path.join(folder, ".temp", "project-ref"))) {
        throw new Error("The persistent Supabase workdir refuses dotenv files and linked project configuration.");
      }
    }

    let registered = nativeRegistryId(registry, project, owner.registryId);
    if (!registered && owner.registryId && action !== "destroy") {
      throw new Error(`The owned native registry entry is missing. ${rebuild}`);
    }
    if (action === "stop" || action === "destroy") {
      if (registered && !owner.registryId) throw new Error("Run start to finish recording the native stack identity before stopping or destroying it.");
      if (registered) cli(["stop", "--stack-id", registered], project);
      if (action === "stop") return log("Local Supabase stopped. Data and login kept.");
      if (registered) cli(["stack", "destroy", "--yes", "--stack-id", registered], project);
      if (nativeRegistryId(registry, project, owner.registryId)) throw new Error("The owned native registry entry still exists after destroy.");
      fs.rmSync(active, { recursive: true });
      return log("Destroyed the owned local Supabase stack and its login.");
    }

    let output = registered ? cli(["status", "--env", "--stack-id", registered], project) : null;
    if (action === "status") {
      if (output) checkedStatus(output, owner);
      log(`${output ? "Running" : "Stopped or unavailable"}: ${project}\nPrivate login file: ${loginFile}`);
      return;
    }
    const source = path.join(checkout, "supabase", "migrations");
    const migrations = new Map(fs.readdirSync(source).filter((file) => file.endsWith(".sql")).map((file) => {
      if (!migrationNamePattern.test(file)) throw new Error("Invalid migration filename in checkout.");
      return [file, readFile(path.join(source, file))];
    }));
    if (!migrations.size) throw new Error("No Supabase migrations found in the checkout.");

    const login = readPrivateJson<Login>(loginFile);
    if (!login || typeof login.email !== "string" || typeof login.password !== "string") throw new Error("Invalid private login file.");
    if (!output) {
      const release = await dependencies.acquireStart(Object.values(owner.ports));
      try {
        if (!owner.registryId) {
          // The host can appear before start returns its confirmed registry ID.
          owner.pendingRegistryId = localDevStackRegistryId(project);
          writeJson(ownerFile, owner);
        }
        cli(["start", "--runtime", "native"], project);
      } finally {
        try {
          registered = nativeRegistryId(registry, project, owner.registryId);
          if (registered && !owner.registryId) {
            owner.registryId = registered;
            delete owner.pendingRegistryId;
            writeJson(ownerFile, owner);
          }
        } finally {
          release();
        }
      }
      if (registered) output = cli(["status", "--env", "--stack-id", registered], project);
    }
    if (!output || !registered) throw new Error("Supabase did not report an active owned native stack.");
    owner.registryId = registered;
    delete owner.pendingRegistryId;
    writeJson(ownerFile, owner);
    const status = checkedStatus(output, owner);
    const needsAccount = !entry(path.join(active, "account-ready"));
    owner.applied = applyMigrations(project, migrations, owner.applied, cli);
    writeJson(ownerFile, owner);
    if (needsAccount) {
      await dependencies.ensureAccount(status, login);
      writePrivateFile(path.join(active, "account-ready"), "ready\n");
    }

    const dotenv = `NEXT_PUBLIC_SUPABASE_URL=${status.url}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${status.anonKey}\nSUPABASE_SERVICE_ROLE_KEY=${status.serviceRoleKey}\n`;
    for (const file of destinations) writePrivateFile(file, dotenv);
    log(`Local Supabase ready at ${status.url} (${migrations.size} migrations).\nPrivate login file: ${loginFile}\nWrote ${destinations.join(", ")}.`);
  } finally {
    operation.release();
  }
}

function checkedStatus(output: string, owner: OwnerRecord) {
  let status: LocalSupabaseStatus;
  try {
    status = parseLocalSupabaseStatus(output);
  } catch {
    throw new Error("Supabase status did not return valid credentials for a loopback API and database.");
  }
  const url = new URL(status.url);
  const loopback = ["127.0.0.1", "localhost", "[::1]"];
  if (url.protocol !== "http:" || !loopback.includes(url.hostname) || Number(url.port) !== owner.ports[54321] ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
    ![status.anonKey, status.serviceRoleKey].every((key) => /^[a-zA-Z0-9_.-]+$/.test(key))) {
    throw new Error("Supabase status does not match the owned loopback API.");
  }
  if (status.databaseUrl && Number(new URL(status.databaseUrl).port) !== owner.ports[54322]) {
    throw new Error("Supabase status does not match the owned loopback database.");
  }
  return { ...status, url: url.origin };
}
