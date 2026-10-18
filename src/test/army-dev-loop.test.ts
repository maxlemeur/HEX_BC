// Isolation guard for the opt-in TesterArmy iteration loop
// (scripts/tester-army/dev-loop.ts, docs/testing/tester-army-local-development.md).
//
// The loop keeps one owned native stack and one production build between
// journey runs. No journey can observe its bookkeeping: a journey passes just
// as well on a stale build, an orphaned stack or a leaked key. Ways the loop
// could fail, each pinned below:
// 1. two supervisors claim one checkout and share its .e2e/army build;
// 2. a dead supervisor, or a recycled pid now running something else, is
//    taken for a live loop (stop then skips the orphaned stack), or a live
//    loop is taken for a stale one (stop destroys a stack in use);
// 3. a key, a database URL or the account address reaches the state file;
// 4. a journey-only change triggers a rebuild, or an application change, a
//    deleted source or a build replaced by another run in this checkout does
//    not: the iteration then exercises other code than the checkout;
// 5. the Army production build type-checks a file outside the rebuild hash,
//    so a skipped rebuild would skip a check a qualification run performs;
// 6. migrations or supabase/config.toml change under a running loop and the
//    iterations keep running against the schema of the start;
// 7. stop removes a directory it does not own, destroys a stack another
//    session prepared (a corrupted or foreign state), or reports a destroyed
//    stack while one of its ports still listens;
// 8. the command line accepts an ambiguous or unfiltered selection, an
//    invalid pattern, a repeated option, an out-of-range TTL or a forbidden
//    port;
// 9. a dead supervisor's workdir is gone (a WSL restart empties /tmp) while
//    its native registry entry and data remain: stop reports the stack
//    destroyed and deletes the only record of it, or a supervisor releases
//    its state although `stack destroy` failed;
// 10. a failed state write during a run leaves the supervisor busy forever,
//    disarms its idle TTL or replaces the iteration's result;
// 11. an iteration's raw SDK archive under .e2e/army/critical/runs/ reads as
//    a qualifying critical run, or a qualifying run starts in a checkout
//    whose loop shares its .e2e/army output;
// 12. the supervisor entry (`e2e:army:ci -- dev-loop`) binds a shared-stack
//    port that only the `start` client refuses;
// 13. the supervisor's own modules change under a running loop: an iteration
//    then records the current checkout but applies the checks loaded at start.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { cleanUpAbandonedLoop, runDevLoopSession } from "../../scripts/tester-army/dev-loop";
import {
  applicationSourceDigest,
  classifyLoopState,
  createLoopState,
  decideRebuild,
  DEV_LOOP_ITERATION_SCOPE,
  DEV_LOOP_STATE_FILE,
  DEV_LOOP_STATE_SCHEMA,
  DEV_LOOP_SUPERVISOR_ENTRY,
  findRegisteredStack,
  listeningPorts,
  type LoopState,
  type LoopStateStore,
  markIterationArchive,
  ownsRecordedProject,
  parseDevLoopArguments,
  probeSupervisor,
  proveStackDestroyed,
  readLoopState,
  removeOwnedTemporaryDirectory,
  stackInputsDigest,
  supervisorModules,
  supervisorModulesDigest,
  writeLoopState,
} from "../../scripts/tester-army/dev-loop-state";
import { buildSourceEvidence, prepareArmyTypeScriptConfig } from "../../scripts/tester-army/local-recipe-common.mjs";

const root = process.cwd();
const temporary: string[] = [];

function temporaryDirectory(prefix = "army-dev-loop-unit-") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporary.push(directory);
  return directory;
}

afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function loopState(overrides: Partial<LoopState> = {}): LoopState {
  const now = Date.now();
  return {
    schemaVersion: DEV_LOOP_STATE_SCHEMA,
    loopId: "5f0c7a52-0d4e-4d39-9d2c-4a1f7f6c2b10",
    status: "ready",
    checkout: root,
    supervisor: { pid: process.pid },
    appOrigin: "http://localhost:3118",
    ttlMinutes: 60,
    startedAt: new Date(now - 60_000).toISOString(),
    lastActivityAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 3_600_000).toISOString(),
    evidence: ".e2e/army/ci/2026-10-18T00-00-00-000Z-dev-loop",
    stack: { projectId: "miaouffrage-ci-1-abcd1234", rootDirectory: "/tmp/miaouffrage-supabase-ci-abc", ports: [16001, 16002] },
    iterations: 0,
    ...overrides,
  };
}

function waitForExit(child: ReturnType<typeof spawn>) {
  return new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once("exit", () => resolve());
  });
}

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function within<T>(promise: Promise<T>, milliseconds: number, what: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} within ${milliseconds} ms`)), milliseconds); }),
  ]);
}

async function closedPort() {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

/** Every message the supervisor sends for one request, until it closes the connection. */
function request(socketPath: string, body: Record<string, unknown>) {
  return new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
    const socket = net.connect(socketPath);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify(body)}\n`));
    socket.on("data", (chunk: string) => { buffer += chunk; });
    socket.once("error", reject);
    socket.once("close", () => resolve(buffer.split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)));
  });
}

/**
 * A supervisor session on a disposable checkout: fake supervisor modules,
 * one migration, a build stub and journeys that only record their call.
 */
async function openSession(options: { ttlMinutes?: number; failUpdate?: (patch: Partial<LoopState>, current: LoopState) => boolean } = {}) {
  const checkout = temporaryDirectory("army-dev-loop-session-");
  fs.mkdirSync(path.join(checkout, "supabase/migrations"), { recursive: true });
  fs.writeFileSync(path.join(checkout, "supabase/migrations/001_base.sql"), "create table a ();\n");
  fs.writeFileSync(path.join(checkout, "supabase/config.toml"), "project_id = \"miaouffrage\"\n");
  fs.mkdirSync(path.join(checkout, "scripts/tester-army"), { recursive: true });
  fs.writeFileSync(path.join(checkout, DEV_LOOP_SUPERVISOR_ENTRY), "import { session } from \"./tester-army/dev-loop\";\nvoid session;\n");
  fs.writeFileSync(path.join(checkout, "scripts/tester-army/dev-loop.ts"), "export const session = 1;\n");
  fs.mkdirSync(path.join(checkout, ".e2e/army/next"), { recursive: true });
  fs.writeFileSync(path.join(checkout, ".e2e/army/next/BUILD_ID"), "build-unit\n");
  let current = loopState({
    checkout, status: "starting", expiresAt: null,
    stackInputsSha256: await stackInputsDigest(checkout), supervisorModulesSha256: supervisorModulesDigest(checkout),
  });
  const store = {
    get current() { return current; },
    update(patch: Partial<LoopState>) {
      if (options.failUpdate?.(patch, current)) throw new Error("ENOSPC: no space left on device, write '.e2e/army/dev-loop/state.json'");
      current = { ...current, ...patch };
    },
    release() { /* the caller removes the state */ },
  } as unknown as LoopStateStore;
  const controller = new AbortController();
  const journeys: string[] = [];
  const session = runDevLoopSession({
    root: checkout, store, signal: controller.signal, ttlMinutes: options.ttlMinutes ?? 60,
    sessionEvidence: temporaryDirectory(),
    sessionManifest: { command: ["unit"], startedAt: new Date().toISOString(), appOrigin: "http://localhost:3118", workers: 1, fixtures: {}, database: {} },
    redact: (value) => value,
    build: async () => {
      const builds = path.join(checkout, ".e2e/army/recipes/builds/unit");
      fs.mkdirSync(builds, { recursive: true });
      fs.writeFileSync(path.join(builds, "manifest.json"), JSON.stringify({ buildId: "build-unit", sourceChangedDuringBuild: false, inputs: [] }));
    },
    journeys: async (context) => { journeys.push(context.grep ?? context.files.join(",")); },
    finalize: (context) => { fs.writeFileSync(path.join(context.evidence, "manifest.json"), JSON.stringify(context.manifest)); },
  });
  session.catch(() => { /* asserted by the caller */ });
  for (let attempt = 0; !(current.status === "ready" && current.socket) && attempt < 500; attempt += 1) await sleep(20);
  expect(current).toMatchObject({ status: "ready", socket: expect.any(String) });
  const results = async (grep: string) =>
    (await request(current.socket!, { action: "run", loopId: current.loopId, grep })).filter((message) => message.type === "result");
  return { checkout, controller, session, journeys, results };
}

/** The supervisor entry, from another checkout and without any inherited backend, CI output or secret. */
function runSupervisorEntry(checkout: string, args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, TSX_TSCONFIG_PATH: path.join(root, "tsconfig.json") };
  for (const key of Object.keys(env)) {
    if (/SUPABASE|^E2E_|^RLS_|^NEXT_PUBLIC_|^GITHUB_|DATABASE_URL|^PG/i.test(key)) delete env[key];
  }
  return spawnSync(process.execPath, [
    "--import", pathToFileURL(path.join(root, "node_modules/tsx/dist/loader.mjs")).href,
    path.join(root, DEV_LOOP_SUPERVISOR_ENTRY), ...args,
  ], { cwd: checkout, encoding: "utf8", timeout: 90_000, windowsHide: true, env });
}

describe("TesterArmy dev loop", () => {
  it("claims a checkout exclusively and never writes a secret into its state", () => {
    const file = path.join(temporaryDirectory(), "dev-loop", "state.json");
    expect(readLoopState(file)).toBeNull();
    createLoopState(file, loopState());
    expect(() => createLoopState(file, loopState({ loopId: "another" }))).toThrow(/already exists/);
    expect(readLoopState(file)?.loopId).toBe(loopState().loopId);

    const before = fs.readFileSync(file, "utf8");
    const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJyb2xlIjoic2VydmljZV9yb2xlIn0", "c2lnbmF0dXJl"].join(".");
    for (const leak of [
      { error: `service key ${jwt}` },
      { error: "key sb_secret_abcdefghijklmnop" },
      { error: "fixture postgresql://postgres:postgres@127.0.0.1:16003/postgres" },
      { error: "login army-ci-0f3a@example.test" },
      { lastIteration: { index: 1, status: "passed", evidence: "x", seconds: 1, password: "Army-1" } } as unknown as Partial<LoopState>,
    ]) {
      expect(() => writeLoopState(file, loopState(leak))).toThrow(/secret/);
      expect(fs.readFileSync(file, "utf8")).toBe(before);
    }
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);

    fs.writeFileSync(file, JSON.stringify({ schemaVersion: "army-dev-loop-state-0" }));
    expect(() => readLoopState(file)).toThrow(/state/);
  });

  it.skipIf(process.platform === "win32")("takes only its own live supervisor for a live loop", async () => {
    const keepAlive = "setInterval(() => {}, 1000)";
    const supervisor = spawn(process.execPath, ["-e", keepAlive, DEV_LOOP_SUPERVISOR_ENTRY, "dev-loop"], { cwd: root, stdio: "ignore" });
    const otherCheckout = spawn(process.execPath, ["-e", keepAlive, DEV_LOOP_SUPERVISOR_ENTRY, "dev-loop"], { cwd: os.tmpdir(), stdio: "ignore" });
    const recycled = spawn(process.execPath, ["-e", keepAlive, "unrelated"], { cwd: root, stdio: "ignore" });
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const now = Date.now();
      expect(probeSupervisor(supervisor.pid!, root)).toBe("owned");
      expect(classifyLoopState(loopState({ supervisor: { pid: supervisor.pid! } }), "owned", now)).toEqual({ kind: "live", expired: false });
      // A recycled pid, or the same command in another checkout, is not this loop.
      expect(probeSupervisor(recycled.pid!, root)).toBe("foreign");
      expect(probeSupervisor(otherCheckout.pid!, root)).toBe("foreign");
      expect(classifyLoopState(loopState(), "foreign", now)).toMatchObject({ kind: "stale" });
      // A live supervisor past its idle TTL is reported, never treated as stale.
      const expired = loopState({ expiresAt: new Date(now - 300_000).toISOString() });
      expect(classifyLoopState(expired, "owned", now)).toEqual({ kind: "live", expired: true });
      expect(classifyLoopState({ ...expired, status: "running", expiresAt: null }, "owned", now)).toEqual({ kind: "live", expired: false });
      supervisor.kill("SIGKILL");
      await waitForExit(supervisor);
      expect(probeSupervisor(supervisor.pid!, root)).toBe("dead");
      expect(classifyLoopState(loopState(), "dead", now)).toMatchObject({ kind: "stale" });
      expect(classifyLoopState(null, null, now)).toEqual({ kind: "absent" });
    } finally {
      for (const child of [supervisor, otherCheckout, recycled]) {
        child.kill("SIGKILL");
        await waitForExit(child);
      }
    }
  });

  it("rebuilds for application changes and a replaced build, never for journey-only changes", async () => {
    const source = await buildSourceEvidence();
    const paths = source.inputs.map((input: { path: string }) => input.path);
    expect(paths.some((file: string) => file.startsWith("e2e/"))).toBe(false);
    for (const required of ["next.config.ts", "package-lock.json", "package.json", "tsconfig.json"]) expect(paths).toContain(required);
    expect(paths.some((file: string) => file.startsWith("src/app/"))).toBe(true);

    const digest = applicationSourceDigest(source.inputs);
    const sourceIndex = paths.findIndex((file: string) => file.startsWith("src/lib/"));
    const edited = source.inputs.map((input: { path: string; sha256?: string }, index: number) =>
      index === sourceIndex ? { ...input, sha256: "0".repeat(64) } : input);
    const deleted = source.inputs.map((input: { path: string }, index: number) =>
      index === sourceIndex ? { path: input.path, missing: true } : input);
    expect(applicationSourceDigest([...source.inputs].reverse())).toBe(digest);
    expect(applicationSourceDigest(edited)).not.toBe(digest);
    expect(applicationSourceDigest(deleted)).not.toBe(digest);

    const built = { appSourceSha256: digest, buildId: "build-1" };
    expect(decideRebuild({ built, appSourceSha256: digest, buildIdOnDisk: "build-1" })).toMatchObject({ rebuild: false });
    expect(decideRebuild({ built: undefined, appSourceSha256: digest, buildIdOnDisk: "build-1" })).toMatchObject({ rebuild: true });
    expect(decideRebuild({ built, appSourceSha256: applicationSourceDigest(edited), buildIdOnDisk: "build-1" }))
      .toMatchObject({ rebuild: true, reason: expect.stringMatching(/application sources changed/) });
    expect(decideRebuild({ built, appSourceSha256: digest, buildIdOnDisk: "build-2" }))
      .toMatchObject({ rebuild: true, reason: expect.stringMatching(/replaced/) });
    expect(decideRebuild({ built, appSourceSha256: digest, buildIdOnDisk: null }))
      .toMatchObject({ rebuild: true, reason: expect.stringMatching(/missing/) });
  });

  it("keeps every source the Army build type-checks inside the rebuild hash", async () => {
    const checkout = temporaryDirectory();
    await prepareArmyTypeScriptConfig(checkout);
    const config = JSON.parse(fs.readFileSync(path.join(checkout, ".e2e/army/tsconfig.json"), "utf8")) as { include: string[] };
    const inputs = (await buildSourceEvidence()).inputs.map((input: { path: string }) => input.path);
    // Generated by Next at build time, not repository sources.
    const generated = new Set(["../../next-env.d.ts", "next/types/**/*.ts", "next/dev/types/**/*.ts"]);
    for (const include of config.include.filter((pattern) => !generated.has(pattern))) {
      expect(include.startsWith("../../"), include).toBe(true);
      const prefix = include.slice("../../".length).split("*")[0];
      expect(prefix.startsWith("e2e/"), include).toBe(false);
      expect(inputs.some((file: string) => file.startsWith(prefix)), include).toBe(true);
    }
  });

  it("detects migration and Supabase configuration changes under a running loop", async () => {
    const checkout = temporaryDirectory();
    fs.mkdirSync(path.join(checkout, "supabase/migrations"), { recursive: true });
    fs.mkdirSync(path.join(checkout, "supabase/tests/database"), { recursive: true });
    fs.writeFileSync(path.join(checkout, "supabase/migrations/001_base.sql"), "create table a ();\n");
    fs.writeFileSync(path.join(checkout, "supabase/config.toml"), "project_id = \"miaouffrage\"\n");
    fs.writeFileSync(path.join(checkout, "supabase/tests/database/a.sql"), "select 1;\n");
    const recorded = await stackInputsDigest(checkout);
    fs.writeFileSync(path.join(checkout, "supabase/tests/database/a.sql"), "select 2;\n");
    expect(await stackInputsDigest(checkout)).toBe(recorded);
    fs.writeFileSync(path.join(checkout, "supabase/migrations/002_next.sql"), "create table b ();\n");
    const added = await stackInputsDigest(checkout);
    expect(added).not.toBe(recorded);
    fs.writeFileSync(path.join(checkout, "supabase/migrations/001_base.sql"), "create table a (id int);\n");
    expect(await stackInputsDigest(checkout)).not.toBe(added);
    const migrated = await stackInputsDigest(checkout);
    fs.writeFileSync(path.join(checkout, "supabase/config.toml"), "project_id = \"miaouffrage\"\n[auth]\n");
    expect(await stackInputsDigest(checkout)).not.toBe(migrated);
  });

  it("removes only its own temporary directories and proves ports closed", async () => {
    const owned = temporaryDirectory("miaouffrage-army-loop-");
    const foreignPrefix = temporaryDirectory("miaouffrage-other-");
    expect(() => removeOwnedTemporaryDirectory(foreignPrefix, "miaouffrage-army-loop-")).toThrow(/Refusing/);
    expect(() => removeOwnedTemporaryDirectory(path.join(root, "miaouffrage-army-loop-x"), "miaouffrage-army-loop-")).toThrow(/Refusing/);
    expect(() => removeOwnedTemporaryDirectory(path.join(os.tmpdir(), "miaouffrage-army-loop-x", ".."), "miaouffrage-army-loop-")).toThrow(/Refusing/);
    expect(fs.existsSync(foreignPrefix)).toBe(true);
    removeOwnedTemporaryDirectory(owned, "miaouffrage-army-loop-");
    expect(fs.existsSync(owned)).toBe(false);

    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as net.AddressInfo).port;
    expect(await listeningPorts([port])).toEqual([port]);
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    expect(await listeningPorts([port])).toEqual([]);
  });

  it("destroys an abandoned stack only when its workdir carries the recorded project", () => {
    const workdir = temporaryDirectory("miaouffrage-supabase-ci-");
    fs.mkdirSync(path.join(workdir, "supabase"));
    const projectId = "miaouffrage-ci-4242-abcd1234";
    const config = (id: string) => fs.writeFileSync(path.join(workdir, "supabase/config.toml"), `# isolated\nproject_id = "${id}"\n[api]\nport = 16001\n`);
    const state = loopState({ supervisor: { pid: 4242 }, stack: { projectId, rootDirectory: workdir, ports: [16001] } });
    config(projectId);
    expect(ownsRecordedProject(state)).toBe(true);
    // Another session's stack, a project of another supervisor, or no config at all.
    config("miaouffrage-ci-7777-ffff0000");
    expect(ownsRecordedProject(state)).toBe(false);
    config(projectId);
    expect(ownsRecordedProject(loopState({ supervisor: { pid: 5151 }, stack: state.stack }))).toBe(false);
    fs.rmSync(path.join(workdir, "supabase/config.toml"));
    expect(ownsRecordedProject(state)).toBe(false);
    expect(ownsRecordedProject(loopState({ stack: undefined }))).toBe(false);
  });

  it("accepts only explicit, filtered loop commands", () => {
    const exists = (file: string) => file === "e2e/army/critical/hub-plans-card.e2e.ts";
    expect(parseDevLoopArguments(["start"], exists)).toEqual({ action: "start", appPort: 3107, ttlMinutes: 60 });
    expect(parseDevLoopArguments(["--", "start", "--app-port", "3118", "--ttl-minutes", "30"], exists))
      .toEqual({ action: "start", appPort: 3118, ttlMinutes: 30 });
    expect(parseDevLoopArguments(["run", "--grep", "HUB03|HUB04"], exists)).toEqual({ action: "run", grep: "HUB03|HUB04", files: [] });
    expect(parseDevLoopArguments(["run", "--files", "e2e/army/critical/hub-plans-card.e2e.ts"], exists))
      .toEqual({ action: "run", files: ["e2e/army/critical/hub-plans-card.e2e.ts"] });
    expect(parseDevLoopArguments(["stop"], exists)).toEqual({ action: "stop" });
    expect(parseDevLoopArguments(["status"], exists)).toEqual({ action: "status" });
    for (const argv of [
      [], ["restart"], ["run"], ["run", "--grep"], ["run", "--grep", " "], ["run", "--grep", "("],
      ["run", "--grep", "a", "--grep", "b"], ["run", "--grep", "a", "--files", "e2e/army/critical/hub-plans-card.e2e.ts"],
      ["run", "--files", "e2e/army/critical/missing.e2e.ts"], ["run", "--files", "../secret.e2e.ts"],
      ["run", "--app-port", "3118"], ["start", "--grep", "a"], ["start", "--app-port", "80"], ["start", "--app-port", "6000"],
      ["start", "--app-port", "45585"], ["start", "--app-port", "33485"], ["start", "--app-port", "045585"], ["start", "--app-port", "3118x"],
      ["start", "--ttl-minutes", "4"], ["start", "--ttl-minutes", "721"], ["start", "--ttl-minutes", "1.5"],
      ["start", "--app-port", "3118", "--app-port", "3119"], ["stop", "--app-port", "3118"], ["status", "extra"],
    ]) {
      expect(() => parseDevLoopArguments(argv, exists), argv.join(" ")).toThrow();
    }
  });

  it("finds an abandoned stack through the native registry once its workdir is gone, and keeps the state until it is destroyed", async () => {
    // A WSL restart empties /tmp but keeps ~/.supabase/stacks/<id>/ (data,
    // state.json): the 16/10 recovery needed `stop` then `stack destroy`
    // with the vanished workdir. The registry entry is read through its
    // identity only; its credentials must never come out.
    const registry = temporaryDirectory("army-dev-loop-registry-");
    fs.writeFileSync(path.join(registry, ".registry-lock.sqlite"), "");
    const workdir = temporaryDirectory("miaouffrage-supabase-ci-");
    const port = await closedPort();
    const projectId = "miaouffrage-ci-4242-abcd1234";
    const register = (id: string, projectRoot: string, apiPort: number) => {
      const entry = path.join(registry, id.repeat(64 / id.length));
      fs.mkdirSync(path.join(entry, "data"), { recursive: true });
      fs.writeFileSync(path.join(entry, "state.json"), JSON.stringify({
        id: path.basename(entry), lifetime: "detached", runtime: "native",
        identity: { projectRoot, branchContext: "ordinary-workspace", stackName: "default" },
        credentials: { serviceRoleKey: "registry-credential-must-not-leak" },
        ports: [{ key: "00000000-0000-4000-8000-000000000000:sql", host: "127.0.0.1", port: apiPort + 1 }, { key: "api", host: "127.0.0.1", port: apiPort }],
      }));
      return entry;
    };
    register("ab", path.join(os.tmpdir(), "miaouffrage-supabase-ci-other"), port);
    fs.rmSync(workdir, { recursive: true, force: true });
    const entry = register("de", workdir, port);
    expect(findRegisteredStack(workdir, registry)).toEqual({ id: path.basename(entry), directory: entry, apiPort: port });
    expect(JSON.stringify(findRegisteredStack(workdir, registry))).not.toContain("must-not-leak");
    // The supervisor's own release sees the leftover entry and keeps its state.
    const stack = { projectId, rootDirectory: workdir, ports: [port] };
    expect(await proveStackDestroyed(stack, registry)).toMatchObject({
      projectDirectoryRemoved: true, registryEntryRemoved: false, portsClosed: true, problems: [expect.stringMatching(/registry/)],
    });

    const statePath = path.join(temporaryDirectory(), "state.json");
    const state = loopState({ status: "stopping", supervisor: { pid: 4242 }, stack });
    writeLoopState(statePath, state);
    const calls: string[] = [];
    let destroyRemovesEntry = false;
    // Like CLI 2.120, which rejects a --workdir that does not exist (18/10 WSL run).
    const supabase = (args: string[]) => {
      calls.push(args.join(" "));
      const config = path.join(args[args.indexOf("--workdir") + 1], "supabase/config.toml");
      if (!fs.existsSync(config)) throw new Error("--workdir must be an existing directory");
      expect(fs.readFileSync(config, "utf8")).toMatch(new RegExp(`^project_id = "${projectId}"\\n\\[experimental\\]\\nstack = true\\n`));
      if (destroyRemovesEntry && args[0] === "stack") fs.rmSync(entry, { recursive: true, force: true });
    };
    const expectedCalls = [`stop --workdir ${workdir}`, `stack destroy --yes --workdir ${workdir}`];
    // A destroy that leaves the entry: the state stays, in cleanup-failed.
    const kept = await cleanUpAbandonedLoop(statePath, state, { supabase, registry });
    expect(calls).toEqual(expectedCalls);
    expect(kept.proof.registryEntryRemoved).toBe(false);
    expect(readLoopState(statePath)).toMatchObject({ status: "cleanup-failed", error: expect.stringMatching(/registry/) });
    // The next stop destroys it and only then releases the state.
    calls.length = 0;
    destroyRemovesEntry = true;
    const done = await cleanUpAbandonedLoop(statePath, readLoopState(statePath)!, { supabase, registry });
    expect(calls).toEqual(expectedCalls);
    expect(done.errors).toEqual([]);
    // The workdir recreated for the CLI is removed again.
    expect(done.proof).toMatchObject({ projectDirectoryRemoved: true, registryEntryRemoved: true, portsClosed: true });
    expect(fs.existsSync(workdir)).toBe(false);
    expect(readLoopState(statePath)).toBeNull();
    expect(fs.existsSync(path.join(registry, "ab".repeat(32)))).toBe(true);

    // A registration whose API port the loop never allocated is not this loop's stack.
    const foreign = register("fe", workdir, port + 7);
    writeLoopState(statePath, state);
    calls.length = 0;
    const refused = await cleanUpAbandonedLoop(statePath, state, { supabase, registry });
    expect(calls).toEqual([]);
    expect(refused.errors.join("; ")).toMatch(/refusing/);
    expect(readLoopState(statePath)).toMatchObject({ status: "cleanup-failed" });
    expect(fs.existsSync(foreign)).toBe(true);
  });

  it("marks an iteration's raw SDK archive as a non-qualification run", () => {
    const checkout = temporaryDirectory();
    const output = path.join(checkout, ".e2e/army/critical");
    const archive = path.join(output, "runs", "2026-10-18T02-00-00-000Z");
    fs.mkdirSync(archive, { recursive: true });
    const sdkManifest = path.join(output, "manifest.json");
    fs.writeFileSync(sdkManifest, JSON.stringify({ archive: { path: path.relative(checkout, archive), manifestSha256: "0".repeat(64) } }));
    const iteration = { campaignStartedAt: new Date(Date.now() - 5_000).toISOString(), loopId: "loop-unit", index: 3, manifest: ".e2e/army/ci/x-dev-loop/iterations/003/manifest.json" };
    const marker = markIterationArchive(checkout, iteration);
    expect(marker).toBe(".e2e/army/critical/runs/2026-10-18T02-00-00-000Z/dev-loop-iteration.json");
    expect(JSON.parse(fs.readFileSync(path.join(checkout, marker!), "utf8"))).toMatchObject({
      scope: DEV_LOOP_ITERATION_SCOPE, qualification: false, loopId: "loop-unit", iteration: 3, iterationManifest: iteration.manifest,
    });
    // No fresh SDK run since the iteration's campaign started: nothing to mark.
    expect(markIterationArchive(checkout, { ...iteration, campaignStartedAt: new Date(Date.now() + 60_000).toISOString() })).toBeNull();
    // An archive outside the owned runs directory is refused.
    fs.writeFileSync(sdkManifest, JSON.stringify({ archive: { path: ".e2e/army/elsewhere", manifestSha256: "0".repeat(64) } }));
    expect(() => markIterationArchive(checkout, iteration)).toThrow(/runs/);
  });

  it("digests the supervisor's own modules, never the application or the journeys", () => {
    const modules = supervisorModules(root);
    for (const file of [
      DEV_LOOP_SUPERVISOR_ENTRY, "scripts/tester-army/dev-loop.ts", "scripts/tester-army/dev-loop-state.ts",
      "scripts/tester-army/local-recipe-common.mjs", "scripts/tester-army/local-development.ts", "src/test/local-supabase-ci.ts",
    ]) expect(modules).toContain(file);
    expect(modules.filter((file) => /^(?:e2e|src\/(?:app|lib|components|hooks))\//.test(file))).toEqual([]);
    // A type-only import is erased at run time.
    expect(modules).not.toContain("src/types/database.ts");
    expect(modules.every((file) => fs.existsSync(path.join(root, file)))).toBe(true);
  });

  it("refuses a shared-stack port in the supervisor entry, and any other suite while a loop state exists", () => {
    // Each checkout carries a .env file: should a refusal regress, the run
    // still stops at the ambient .env check, before any port, state or stack.
    for (const port of ["45585", "033485"]) {
      const checkout = temporaryDirectory();
      fs.writeFileSync(path.join(checkout, ".env"), "# refusal fence\n");
      const result = runSupervisorEntry(checkout, ["dev-loop", "--app-port", port]);
      expect(result.status, `${result.stdout}${result.stderr}`).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toMatch(/45585 and 33485/);
      expect(fs.existsSync(path.join(checkout, ".e2e")), port).toBe(false);
    }
    const checkout = temporaryDirectory();
    fs.writeFileSync(path.join(checkout, ".env"), "# refusal fence\n");
    const statePath = path.join(checkout, DEV_LOOP_STATE_FILE);
    createLoopState(statePath, loopState({ checkout }));
    const before = fs.readFileSync(statePath, "utf8");
    const result = runSupervisorEntry(checkout, ["critical", "--grep", "HUB03", "--app-port", "3118"]);
    expect(result.status, `${result.stdout}${result.stderr}`).toBe(1);
    expect(result.stdout).toMatch(/A dev loop is open in this checkout/);
    expect(fs.readFileSync(statePath, "utf8")).toBe(before);
  }, 240_000);

  describe.skipIf(process.platform === "win32")("supervisor session", () => {
    it("keeps the supervisor stoppable when a state write fails as a run starts", async () => {
      const loop = await openSession({ failUpdate: (patch) => patch.status === "running" });
      try {
        expect(await loop.results("HUB03")).toEqual([expect.objectContaining({ status: "refused", error: expect.stringMatching(/ENOSPC/) })]);
        expect(loop.journeys).toEqual([]);
        loop.controller.abort("SIGTERM");
        await expect(within(loop.session, 5_000, "the session returns after SIGTERM")).resolves.toMatchObject({ stopReason: "SIGTERM" });
      } finally {
        loop.controller.abort("cleanup");
      }
    }, 20_000);

    it("keeps the iteration's result and the idle TTL when the state write after a run fails", async () => {
      const loop = await openSession({ ttlMinutes: 0.02, failUpdate: (patch, current) => patch.status === "ready" && current.iterations > 0 });
      try {
        // The iteration fails fast on its stack-input check, before any build or journey.
        fs.writeFileSync(path.join(loop.checkout, "supabase/migrations/002_next.sql"), "create table b ();\n");
        expect(await loop.results("HUB03")).toEqual([expect.objectContaining({ status: "failed", error: expect.stringMatching(/Migrations/) })]);
        await expect(within(loop.session, 10_000, "the idle TTL stops the session")).resolves.toMatchObject({ stopReason: "ttl-expired" });
      } finally {
        loop.controller.abort("cleanup");
      }
    }, 20_000);

    it("refuses an iteration once the supervisor's own modules changed", async () => {
      const loop = await openSession();
      try {
        fs.appendFileSync(path.join(loop.checkout, "scripts/tester-army/dev-loop.ts"), "export const tightened = true;\n");
        expect(await loop.results("HUB03")).toEqual([expect.objectContaining({ status: "failed", error: expect.stringMatching(/supervisor/) })]);
        expect(loop.journeys).toEqual([]);
        loop.controller.abort("SIGTERM");
        await expect(within(loop.session, 5_000, "the session returns after SIGTERM")).resolves.toMatchObject({ stopReason: "SIGTERM" });
      } finally {
        loop.controller.abort("cleanup");
      }
    }, 30_000);
  });
});
