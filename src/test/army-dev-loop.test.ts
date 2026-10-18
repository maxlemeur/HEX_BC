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
//    loop is taken for a stale one (stop destroys a stack in use), also when
//    the checkout is reached through a symbolic link;
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
//    destroyed and deletes the only record of it (also when the registry
//    holds the resolved path, as macOS /private/var), or a supervisor
//    releases its state although `stack destroy` failed;
// 10. a failed state write during a run leaves the supervisor busy forever,
//    disarms its idle TTL or replaces the iteration's result;
// 11. an iteration's raw SDK archive under .e2e/army/critical/runs/ reads as
//    a qualifying critical run, or a qualifying run starts in a checkout
//    whose loop shares its .e2e/army output;
// 12. the supervisor entry (`e2e:army:ci -- dev-loop`) binds a shared-stack
//    port that only the `start` client refuses;
// 13. the supervisor's own modules change under a running loop: an iteration
//    then records the current checkout but applies the checks loaded at start.
// 14. a state copied or restored into another checkout while its loop runs
//    is taken for this checkout's: stop signals the other checkout's
//    supervisor, run drives its socket, cleanup removes its socket or stack;
// 15. a migration or config.toml edit made after an iteration's preflight
//    reaches the journeys, which run against the schema of the start. While
//    it builds, build-local.mjs refuses only an edit to a tracked file,
//    through `git diff HEAD`; supabase/ is outside its untracked scopes, so a
//    migration added during the build, like any edit before its first or
//    after its last snapshot, is refused only by the pre-journey recheck;
// 16. after a SIGKILL during an iteration, the journey process and its
//    `next start` survive on the application port while stop reports the
//    loop closed and deletes its state;
// 17. a no-rebuild iteration's evidence names a build whose manifest and
//    inputs only the in-memory session summary held, lost with a killed
//    supervisor;
// 18. an unreadable, malformed or unpermitted registry entry is skipped, so
//    the proof reports the registry clear and deletes the only recovery state;
// 19. the closure proof requires the application port closed while the loop
//    owns no listener there: a `start` on a port another process holds, or an
//    idle loop next to an unrelated listener, then leaves a cleanup-failed
//    state that blocks every Army suite of the checkout and hides the real
//    cause, while a loop killed during its journeys must still keep its state
//    until the port closes;
// 20. a state whose recorded checkout no longer exists (moved or renamed) is
//    called a copy, which steers the operator into deleting the only record
//    of a native stack instead of recovering it.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  inspectLoopState,
  listeningPorts,
  type LoopState,
  type LoopStateStore,
  markIterationArchive,
  ownsRecordedProject,
  parseDevLoopArguments,
  probeSupervisor,
  proveLoopClosed,
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

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/**
 * A supervisor session on a disposable checkout: fake supervisor modules,
 * one migration, a build stub and journeys that only record their call.
 * The stub records `buildInputs` (none by default, so every iteration
 * rebuilds) and calls `afterBuild` with its call count, 1 being the start.
 * `onJourneys` sees the state as the journeys run; the application port is
 * closed when the session opens.
 */
async function openSession(options: {
  ttlMinutes?: number;
  failUpdate?: (patch: Partial<LoopState>, current: LoopState) => boolean;
  buildInputs?: unknown[];
  afterBuild?: (count: number, checkout: string) => void;
  onJourneys?: (current: LoopState) => void | Promise<void>;
} = {}) {
  const checkout = temporaryDirectory("army-dev-loop-session-");
  fs.mkdirSync(path.join(checkout, "supabase/migrations"), { recursive: true });
  fs.writeFileSync(path.join(checkout, "supabase/migrations/001_base.sql"), "create table a ();\n");
  fs.writeFileSync(path.join(checkout, "supabase/config.toml"), "project_id = \"miaouffrage\"\n");
  fs.mkdirSync(path.join(checkout, "scripts/tester-army"), { recursive: true });
  fs.writeFileSync(path.join(checkout, DEV_LOOP_SUPERVISOR_ENTRY), "import { session } from \"./tester-army/dev-loop\";\nvoid session;\n");
  fs.writeFileSync(path.join(checkout, "scripts/tester-army/dev-loop.ts"), "export const session = 1;\n");
  fs.mkdirSync(path.join(checkout, ".e2e/army/next"), { recursive: true });
  fs.writeFileSync(path.join(checkout, ".e2e/army/next/BUILD_ID"), "build-unit\n");
  const appOrigin = `http://localhost:${await closedPort()}`;
  let current = loopState({
    checkout, status: "starting", expiresAt: null, appOrigin,
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
  let buildCount = 0;
  const session = runDevLoopSession({
    root: checkout, store, signal: controller.signal, ttlMinutes: options.ttlMinutes ?? 60,
    sessionEvidence: temporaryDirectory(),
    sessionManifest: { command: ["unit"], startedAt: new Date().toISOString(), appOrigin, workers: 1, fixtures: {}, database: {} },
    redact: (value) => value,
    build: async () => {
      const builds = path.join(checkout, ".e2e/army/recipes/builds/unit");
      fs.mkdirSync(builds, { recursive: true });
      fs.writeFileSync(path.join(builds, "manifest.json"), JSON.stringify({
        buildId: "build-unit", sourceChangedDuringBuild: false, inputs: options.buildInputs ?? [],
      }));
      buildCount += 1;
      options.afterBuild?.(buildCount, checkout);
    },
    journeys: async (context) => {
      journeys.push(context.grep ?? context.files.join(","));
      await options.onJourneys?.(current);
    },
    finalize: (context) => { fs.writeFileSync(path.join(context.evidence, "manifest.json"), JSON.stringify(context.manifest)); },
  });
  session.catch(() => { /* asserted by the caller */ });
  for (let attempt = 0; !(current.status === "ready" && current.socket) && attempt < 500; attempt += 1) await sleep(20);
  expect(current).toMatchObject({ status: "ready", socket: expect.any(String) });
  const results = async (grep: string) =>
    (await request(current.socket!, { action: "run", loopId: current.loopId, grep })).filter((message) => message.type === "result");
  return { checkout, controller, session, journeys, results, state: () => current };
}

/** The current environment without any inherited backend, CI output or secret. */
function isolatedEnvironment() {
  const env: NodeJS.ProcessEnv = { ...process.env, TSX_TSCONFIG_PATH: path.join(root, "tsconfig.json") };
  for (const key of Object.keys(env)) {
    if (/SUPABASE|^E2E_|^RLS_|^NEXT_PUBLIC_|^GITHUB_|DATABASE_URL|^PG/i.test(key)) delete env[key];
  }
  return env;
}

const tsxLoader = pathToFileURL(path.join(root, "node_modules/tsx/dist/loader.mjs")).href;

/** The supervisor entry, from another checkout. */
function runSupervisorEntry(checkout: string, args: string[]) {
  return spawnSync(process.execPath, ["--import", tsxLoader, path.join(root, DEV_LOOP_SUPERVISOR_ENTRY), ...args],
    { cwd: checkout, encoding: "utf8", timeout: 90_000, windowsHide: true, env: isolatedEnvironment() });
}

/** The loop client (`npm run e2e:army:dev-loop -- ...`) in `checkout`; asynchronous, so this process can serve a socket meanwhile. */
function runDevLoopCli(checkout: string, args: string[]) {
  return new Promise<{ code: number | null; stdout: string; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", tsxLoader, path.join(root, "scripts/tester-army/dev-loop.ts"), ...args],
      { cwd: checkout, env: isolatedEnvironment(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; output += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { output += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.once("error", reject);
    child.once("close", (code) => { clearTimeout(timer); resolve({ code, stdout, output }); });
  });
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

  it.skipIf(process.platform === "win32")("takes its own supervisor when the checkout is reached through a symbolic link", async () => {
    // The OS reports the supervisor's resolved cwd; macOS's os.tmpdir() (/var -> /private/var) is one such link.
    const checkout = temporaryDirectory("army-dev-loop-real-");
    const linkParent = temporaryDirectory("army-dev-loop-link-");
    const link = path.join(linkParent, "checkout");
    fs.symlinkSync(checkout, link);
    const supervisor = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", DEV_LOOP_SUPERVISOR_ENTRY, "dev-loop"], { cwd: link, stdio: "ignore" });
    try {
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect({ throughLink: probeSupervisor(supervisor.pid!, link), real: probeSupervisor(supervisor.pid!, checkout) })
        .toEqual({ throughLink: "owned", real: "owned" });
    } finally {
      supervisor.kill("SIGKILL");
      await waitForExit(supervisor);
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
    const intact = { buildManifestIntact: true };
    expect(decideRebuild({ built, appSourceSha256: digest, buildIdOnDisk: "build-1", ...intact })).toMatchObject({ rebuild: false });
    expect(decideRebuild({ built: undefined, appSourceSha256: digest, buildIdOnDisk: "build-1", ...intact })).toMatchObject({ rebuild: true });
    expect(decideRebuild({ built, appSourceSha256: applicationSourceDigest(edited), buildIdOnDisk: "build-1", ...intact }))
      .toMatchObject({ rebuild: true, reason: expect.stringMatching(/application sources changed/) });
    expect(decideRebuild({ built, appSourceSha256: digest, buildIdOnDisk: "build-2", ...intact }))
      .toMatchObject({ rebuild: true, reason: expect.stringMatching(/replaced/) });
    expect(decideRebuild({ built, appSourceSha256: digest, buildIdOnDisk: null, ...intact }))
      .toMatchObject({ rebuild: true, reason: expect.stringMatching(/missing/) });
    // The build an iteration runs on must still have the manifest of its inputs (17).
    expect(decideRebuild({ built, appSourceSha256: digest, buildIdOnDisk: "build-1", buildManifestIntact: false }))
      .toMatchObject({ rebuild: true, reason: expect.stringMatching(/manifest of build build-1/) });
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

  it.skipIf(process.platform === "win32")("finds the registry entry the CLI recorded under the resolved workdir, whether it exists or is gone", () => {
    // macOS: the loop creates /var/folders/…/miaouffrage-supabase-ci-* but the CLI records /private/var/folders/… (18/10).
    const registry = temporaryDirectory("army-dev-loop-registry-");
    const realParent = temporaryDirectory("army-dev-loop-real-");
    const link = path.join(temporaryDirectory("army-dev-loop-link-"), "tmp");
    fs.symlinkSync(realParent, link);
    const record = (id: string, name: string) => {
      const entry = path.join(registry, id.repeat(64 / id.length));
      fs.mkdirSync(entry, { recursive: true });
      fs.writeFileSync(path.join(entry, "state.json"), JSON.stringify({
        identity: { projectRoot: path.join(fs.realpathSync(realParent), name), stackName: "default" }, ports: [{ key: "api", host: "127.0.0.1", port: 54321 }],
      }));
      return path.basename(entry);
    };
    fs.mkdirSync(path.join(realParent, "miaouffrage-supabase-ci-live"));
    const live = record("ab", "miaouffrage-supabase-ci-live");
    const gone = record("cd", "miaouffrage-supabase-ci-gone");
    expect({
      live: findRegisteredStack(path.join(link, "miaouffrage-supabase-ci-live"), registry)?.id ?? null,
      gone: findRegisteredStack(path.join(link, "miaouffrage-supabase-ci-gone"), registry)?.id ?? null,
      other: findRegisteredStack(path.join(link, "miaouffrage-supabase-ci-other"), registry),
    }).toEqual({ live, gone, other: null });
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
    const state = loopState({ status: "stopping", supervisor: { pid: 4242 }, stack, appOrigin: `http://localhost:${await closedPort()}` });
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

  it("keeps the state of a loop killed during its journeys while its application port still listens, and only then", async () => {
    // A SIGKILL during an iteration's journeys leaves the journey process and
    // its `next start` running on the loop's application port (16). Outside
    // the journeys the loop owns no listener there: another process may use
    // that port, and the loop is still closed (19).
    const application = net.createServer();
    await new Promise<void>((resolve) => application.listen(0, "127.0.0.1", resolve));
    const appPort = (application.address() as net.AddressInfo).port;
    const registry = temporaryDirectory("army-dev-loop-registry-");
    const statePath = path.join(temporaryDirectory(), "state.json");
    const stack = {
      projectId: "miaouffrage-ci-4242-abcd1234", ports: [await closedPort()],
      rootDirectory: path.join(os.tmpdir(), `miaouffrage-supabase-ci-gone-${process.pid}`),
    };
    const supabase = () => { throw new Error("no CLI call expected: the stack is already gone"); };
    const killedDuringJourneys = loopState({
      status: "running", expiresAt: null, supervisor: { pid: 4242 }, appOrigin: `http://localhost:${appPort}`, stack,
      journeysStartedAt: new Date().toISOString(),
    });
    const idle = loopState({ supervisor: { pid: 4242 }, appOrigin: `http://localhost:${appPort}`, stack });
    try {
      writeLoopState(statePath, killedDuringJourneys);
      const kept = await cleanUpAbandonedLoop(statePath, killedDuringJourneys, { supabase, registry });
      expect(kept.proof).toMatchObject({ projectDirectoryRemoved: true, registryEntryRemoved: true, portsClosed: true, appPortClosed: false });
      expect(kept.errors.join("; ")).toMatch(new RegExp(`application port ${appPort} still listening`));
      expect(readLoopState(statePath)).toMatchObject({ status: "cleanup-failed", error: expect.stringMatching(/application port/) });

      // The same unrelated listener next to an idle (or never iterated) loop.
      const elsewhere = path.join(temporaryDirectory(), "state.json");
      writeLoopState(elsewhere, idle);
      const released = await cleanUpAbandonedLoop(elsewhere, idle, { supabase, registry });
      expect(released.errors).toEqual([]);
      expect(released.proof).toMatchObject({ portsClosed: true, appPortClosed: null, problems: [] });
      expect(readLoopState(elsewhere)).toBeNull();
      expect(await proveLoopClosed(idle, registry)).toMatchObject({ appPortClosed: null, problems: [] });
    } finally {
      await new Promise<void>((resolve) => application.close(() => resolve()));
    }
    const done = await cleanUpAbandonedLoop(statePath, readLoopState(statePath)!, { supabase, registry });
    expect(done.errors).toEqual([]);
    expect(done.proof).toMatchObject({ portsClosed: true, appPortClosed: true });
    expect(readLoopState(statePath)).toBeNull();
    // During the journeys, an origin whose port cannot be read is never proven closed.
    expect(await proveLoopClosed({ stack: undefined, appOrigin: "http://localhost", journeysStartedAt: new Date().toISOString() }, registry))
      .toMatchObject({ appPortClosed: false, problems: [expect.stringMatching(/application port/)] });
    expect(await proveLoopClosed({ stack: undefined, appOrigin: "http://localhost" }, registry))
      .toMatchObject({ appPortClosed: null, problems: [] });
  }, 60_000);

  it("refuses a busy application port before claiming the checkout, and keeps that cause (19)", async () => {
    // claimLoopState digests the supervisor's own modules: the checkout holds
    // copies of them. It has no supabase/ directory, so should the refusal
    // regress, the run still stops at the stack-input digest, before any stack.
    const checkout = temporaryDirectory();
    for (const file of supervisorModules(root)) {
      fs.mkdirSync(path.dirname(path.join(checkout, file)), { recursive: true });
      fs.copyFileSync(path.join(root, file), path.join(checkout, file));
    }
    const holder = net.createServer();
    let port = 0;
    while (!port || [45585, 33485].includes(port)) {
      if (port) await new Promise<void>((resolve) => holder.close(() => resolve()));
      await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
      port = (holder.address() as net.AddressInfo).port;
    }
    try {
      const result = runSupervisorEntry(checkout, ["dev-loop", "--app-port", String(port)]);
      const output = `${result.stdout}${result.stderr}`;
      const sessions = fs.readdirSync(path.join(checkout, ".e2e/army/ci")).filter((name) => name.endsWith("-dev-loop"));
      const manifest = JSON.parse(fs.readFileSync(path.join(checkout, ".e2e/army/ci", sessions[0], "manifest.json"), "utf8")) as Record<string, unknown>;
      expect({
        status: result.status, sessions: sessions.length, stateWritten: fs.existsSync(path.join(checkout, DEV_LOOP_STATE_FILE)),
        error: manifest.error, devLoopCleanup: manifest.devLoopCleanup,
      }, output.slice(-800)).toEqual({
        status: 1, sessions: 1, stateWritten: false,
        error: expect.stringMatching(new RegExp(`Local application port ${port} is unavailable`)), devLoopCleanup: undefined,
      });
    } finally {
      await new Promise<void>((resolve) => holder.close(() => resolve()));
    }
  }, 120_000);

  it("treats an unreadable, malformed or unpermitted registry entry as unproven cleanup", async () => {
    // Such an entry may be this loop's stack: skipping it would report the
    // registry clear and delete the only record of that stack (18).
    const registry = temporaryDirectory("army-dev-loop-registry-");
    fs.writeFileSync(path.join(registry, ".registry-lock.sqlite"), "");
    const stack = {
      projectId: "miaouffrage-ci-4242-abcd1234", ports: [await closedPort()],
      rootDirectory: path.join(os.tmpdir(), `miaouffrage-supabase-ci-gone-${process.pid}`),
    };
    const state = loopState({ status: "stopping", supervisor: { pid: 4242 }, appOrigin: `http://localhost:${await closedPort()}`, stack });
    const statePath = path.join(temporaryDirectory(), "state.json");
    const entry = path.join(registry, "ab".repeat(32));
    fs.mkdirSync(path.join(entry, "data"), { recursive: true });
    const entryState = path.join(entry, "state.json");
    const supabase = () => { throw new Error("no CLI call expected on an entry that cannot be read"); };
    const cases: Array<[string, () => void]> = [
      ["truncated", () => fs.writeFileSync(entryState, "{\"identity\": {\"projectRoot\": ")],
      ["without identity", () => fs.writeFileSync(entryState, JSON.stringify({ id: path.basename(entry), ports: [] }))],
      ["without state.json", () => fs.rmSync(entryState, { force: true })],
    ];
    if (process.platform !== "win32" && process.getuid?.() !== 0) {
      cases.push(["permission denied", () => {
        fs.writeFileSync(entryState, JSON.stringify({ identity: { projectRoot: stack.rootDirectory }, ports: [{ key: "api", port: stack.ports[0] }] }));
        fs.chmodSync(entryState, 0o000);
      }]);
    }
    try {
      for (const [name, make] of cases) {
        make();
        expect(await proveStackDestroyed(stack, registry), name).toMatchObject({
          registryEntryRemoved: false, problems: [expect.stringMatching(new RegExp(`registry entry ${path.basename(entry)} .*unreadable`))],
        });
        writeLoopState(statePath, state);
        const kept = await cleanUpAbandonedLoop(statePath, state, { supabase, registry });
        expect(kept.proof.registryEntryRemoved, name).toBe(false);
        expect(readLoopState(statePath), name).toMatchObject({ status: "cleanup-failed", error: expect.stringMatching(/unreadable/) });
      }
    } finally {
      if (fs.existsSync(entryState)) fs.chmodSync(entryState, 0o600);
    }
    // Only once the entry is gone is the cleanup proven and the state released.
    fs.rmSync(entry, { recursive: true, force: true });
    const done = await cleanUpAbandonedLoop(statePath, readLoopState(statePath)!, { supabase, registry });
    expect(done.errors).toEqual([]);
    expect(readLoopState(statePath)).toBeNull();
  }, 60_000);

  it("never probes or classifies a state recorded by another checkout as this checkout's loop", () => {
    // A copied or restored state names another checkout's supervisor, socket
    // and stack: none of them may be used from here (14).
    const original = temporaryDirectory("army-dev-loop-original-");
    const copy = temporaryDirectory("army-dev-loop-copy-");
    const now = Date.now();
    for (const checkout of [original, path.join(original, "missing"), path.relative(process.cwd(), copy) || "."]) {
      expect(inspectLoopState(loopState({ checkout }), copy, now), checkout).toEqual({
        kind: "foreign-checkout", reason: expect.stringContaining(checkout),
      });
    }
    expect(inspectLoopState(loopState({ checkout: original }), copy, now))
      .toMatchObject({ reason: expect.stringMatching(/copied or restored from another checkout/) });
    // A checkout moved or renamed with its .e2e/ is no copy: its stack may still exist (20).
    const moved = inspectLoopState(loopState({ checkout: path.join(original, "missing") }), copy, now);
    expect(moved).toMatchObject({ kind: "foreign-checkout", reason: expect.stringMatching(/no longer exists \(moved or renamed\?\)/) });
    expect(moved.kind === "foreign-checkout" && moved.reason).not.toMatch(/copied or restored|is a copy/);
    expect(inspectLoopState(null, copy, now)).toEqual({ kind: "absent" });
    if (process.platform !== "win32") {
      // The same checkout spelled through a symbolic link is this checkout:
      // its pid is then probed (this test process is no supervisor).
      const link = path.join(temporaryDirectory(), "checkout-link");
      fs.symlinkSync(copy, link);
      expect(inspectLoopState(loopState({ checkout: link }), copy, now)).toMatchObject({ kind: "stale" });
    }
  });

  it.skipIf(process.platform === "win32")("refuses a copied state before using its supervisor, socket or cleanup metadata", async () => {
    // Checkout `original` runs its loop; its state.json was copied into `copy`.
    const original = temporaryDirectory("army-dev-loop-original-");
    const copy = temporaryDirectory("army-dev-loop-copy-");
    fs.mkdirSync(path.join(copy, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(copy, DEV_LOOP_SUPERVISOR_ENTRY), "// the loop client only checks that the entry exists\n");
    const supervisor = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", DEV_LOOP_SUPERVISOR_ENTRY, "dev-loop"], { cwd: original, stdio: "ignore" });
    const socketDirectory = temporaryDirectory("miaouffrage-army-loop-");
    const socketPath = path.join(socketDirectory, "loop.sock");
    const requests: string[] = [];
    const server = net.createServer((socket) => {
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => { requests.push(chunk); socket.end(); });
      socket.on("error", () => { /* the client left */ });
    });
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));
    const statePath = path.join(copy, DEV_LOOP_STATE_FILE);
    createLoopState(statePath, loopState({
      checkout: original, supervisor: { pid: supervisor.pid! }, socket: socketPath, stack: undefined,
      appOrigin: `http://localhost:${await closedPort()}`,
    }));
    const before = fs.readFileSync(statePath, "utf8");
    try {
      await sleep(300);
      expect(probeSupervisor(supervisor.pid!, original)).toBe("owned");
      const outcome = async (args: string[]) => {
        const result = await runDevLoopCli(copy, args);
        return { code: result.code, refused: /another checkout/.test(result.output), output: result.output.slice(-400) };
      };
      const run = await outcome(["run", "--grep", "HUB03"]);
      const start = await outcome(["start", "--app-port", "3118"]);
      const status = await runDevLoopCli(copy, ["status"]);
      const stop = await outcome(["stop"]);
      expect({
        run: { code: run.code, refused: run.refused }, start: { code: start.code, refused: start.refused },
        status: (JSON.parse(status.stdout) as { classification: { kind: string } }).classification.kind,
        stop: { code: stop.code, refused: stop.refused },
        requestsReceived: requests.length, supervisor: probeSupervisor(supervisor.pid!, original),
        socketDirectoryKept: fs.existsSync(socketDirectory), stateUnchanged: fs.existsSync(statePath) && fs.readFileSync(statePath, "utf8") === before,
      }, JSON.stringify({ run, start, stop })).toEqual({
        run: { code: 1, refused: true }, start: { code: 1, refused: true }, status: "foreign-checkout", stop: { code: 1, refused: true },
        requestsReceived: 0, supervisor: "owned", socketDirectoryKept: true, stateUnchanged: true,
      });

      // A recorded checkout that no longer exists (moved or renamed) is refused
      // too, with the recovery of its stack instead of the removal of a copy (20).
      writeLoopState(statePath, loopState({
        checkout: path.join(original, "moved-away"), supervisor: { pid: supervisor.pid! }, socket: socketPath, stack: undefined,
      }));
      const movedBefore = fs.readFileSync(statePath, "utf8");
      const moved = await runDevLoopCli(copy, ["stop"]);
      expect({
        code: moved.code, noLongerExists: /no longer exists \(moved or renamed\?\)/.test(moved.output),
        nothingDone: /Nothing was signalled, stopped or removed/.test(moved.output), copyAdvice: /is a copy/.test(moved.output),
        stateUnchanged: fs.readFileSync(statePath, "utf8") === movedBefore, supervisor: probeSupervisor(supervisor.pid!, original),
      }, moved.output.slice(-400)).toEqual({ code: 1, noLongerExists: true, nothingDone: true, copyAdvice: false, stateUnchanged: true, supervisor: "owned" });
    } finally {
      supervisor.kill("SIGKILL");
      await waitForExit(supervisor);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 120_000);

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

    it("rechecks migrations and config.toml after a rebuild, immediately before the journeys", async () => {
      // The stub's empty inputs make the iteration rebuild; a new migration
      // lands as it returns. build-local.mjs would not see that untracked file
      // either (supabase/ is outside its scopes): only the recheck refuses it (15).
      const loop = await openSession({
        afterBuild: (count, checkout) => {
          if (count === 2) fs.writeFileSync(path.join(checkout, "supabase/migrations/002_during_build.sql"), "create table b ();\n");
        },
      });
      try {
        expect(await loop.results("HUB03")).toEqual([expect.objectContaining({
          status: "failed", rebuilt: true, error: expect.stringMatching(/Migrations or supabase\/config.toml changed/),
        })]);
        expect(loop.journeys).toEqual([]);
      } finally {
        loop.controller.abort("SIGTERM");
        await within(loop.session, 5_000, "the session returns after SIGTERM");
      }
    }, 60_000);

    it("retains in every iteration the manifest of the build it ran on, and rebuilds once that manifest is gone", async () => {
      // The stub records the checkout's real build inputs: the first iteration does not rebuild (17).
      const loop = await openSession({ buildInputs: (await buildSourceEvidence()).inputs });
      const buildManifest = ".e2e/army/recipes/builds/unit/manifest.json";
      const evidenceOf = (result: Record<string, unknown>) => JSON.parse(fs.readFileSync(path.join(loop.checkout, String(result.evidence)), "utf8")) as
        { build?: Record<string, unknown> };
      try {
        const [first] = await loop.results("HUB03");
        expect(first).toMatchObject({ status: "passed", rebuilt: false, buildId: "build-unit" });
        const bytes = fs.readFileSync(path.join(loop.checkout, buildManifest));
        expect(evidenceOf(first).build).toMatchObject({ rebuilt: false, buildId: "build-unit", buildManifest, buildManifestSha256: sha256(bytes) });
        const retained = path.join(loop.checkout, path.dirname(String(first.evidence)), "builds/unit/manifest.json");
        expect(fs.existsSync(retained) && fs.readFileSync(retained).equals(bytes)).toBe(true);

        // Its manifest gone, the build no longer proves its inputs: rebuild before any journey.
        fs.rmSync(path.join(loop.checkout, buildManifest));
        const [second] = await loop.results("HUB03");
        expect(second).toMatchObject({ status: "passed", rebuilt: true, reason: expect.stringMatching(/manifest of build build-unit/) });
        expect(evidenceOf(second).build).toMatchObject({ rebuilt: true, buildManifest, buildManifestSha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
        expect(loop.journeys).toEqual(["HUB03", "HUB03"]);
      } finally {
        loop.controller.abort("SIGTERM");
        await within(loop.session, 5_000, "the session returns after SIGTERM");
      }
    }, 90_000);

    it("records in the state that its journeys run, and clears it only once the application port is closed again", async () => {
      // A supervisor killed meanwhile leaves the mark for `stop`, which then
      // proves the application port closed too; outside it, the port is not
      // the loop's (16, 19).
      const seen: Array<string | undefined> = [];
      const registry = temporaryDirectory("army-dev-loop-registry-");
      let leftOpen: net.Server | undefined;
      const loop = await openSession({
        buildInputs: (await buildSourceEvidence()).inputs,
        onJourneys: async (current) => {
          seen.push(current.journeysStartedAt);
          if (seen.length === 2) {
            // The second iteration's `next start` outlives its journeys.
            leftOpen = net.createServer();
            const port = Number(new URL(current.appOrigin).port);
            await new Promise<void>((resolve) => leftOpen!.listen(port, "127.0.0.1", resolve));
          }
        },
      });
      try {
        expect(loop.state().journeysStartedAt).toBeUndefined();
        const [first] = await loop.results("HUB03");
        expect(first).toMatchObject({ status: "passed" });
        expect(seen[0]).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
        expect(loop.state().journeysStartedAt).toBeUndefined();
        expect(await proveLoopClosed({ ...loop.state(), stack: undefined }, registry)).toMatchObject({ appPortClosed: null });

        const [second] = await loop.results("HUB03");
        expect(second).toMatchObject({ status: "passed" });
        expect(JSON.parse(fs.readFileSync(path.join(loop.checkout, String(second.evidence)), "utf8")))
          .toMatchObject({ appPortAfterJourneys: expect.stringMatching(/still listening/) });
        expect(loop.state().journeysStartedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
        expect(await proveLoopClosed({ ...loop.state(), stack: undefined }, registry)).toMatchObject({ appPortClosed: false });
      } finally {
        loop.controller.abort("SIGTERM");
        await within(loop.session, 5_000, "the session returns after SIGTERM");
        if (leftOpen) await new Promise<void>((resolve) => leftOpen!.close(() => resolve()));
      }
    }, 90_000);
  });
});
