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
//    port, or takes a journey filter it then ignores, that only the `start`
//    client refuses;
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
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runDevLoopSession } from "../../scripts/tester-army/dev-loop";
import {
  applicationSourceDigest,
  createLoopState,
  decideRebuild,
  DEV_LOOP_ITERATION_SCOPE,
  DEV_LOOP_STATE_SCHEMA,
  DEV_LOOP_SUPERVISOR_ENTRY,
  listeningPorts,
  type LoopState,
  type LoopStateStore,
  markIterationArchive,
  ownsRecordedProject,
  readLoopState,
  removeOwnedTemporaryDirectory,
  stackInputsDigest,
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
 * The stub records no build inputs, so every iteration rebuilds, and calls
 * `afterBuild` with its call count, 1 being the start. The application port
 * is closed when the session opens.
 */
async function openSession(options: {
  afterBuild?: (count: number, checkout: string) => void;
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
      current = { ...current, ...patch };
    },
    release() { /* the caller removes the state */ },
  } as unknown as LoopStateStore;
  const controller = new AbortController();
  const journeys: string[] = [];
  let buildCount = 0;
  const session = runDevLoopSession({
    root: checkout, store, signal: controller.signal, ttlMinutes: 60,
    sessionEvidence: temporaryDirectory(),
    sessionManifest: { command: ["unit"], startedAt: new Date().toISOString(), appOrigin, workers: 1, fixtures: {}, database: {} },
    redact: (value) => value,
    build: async () => {
      const builds = path.join(checkout, ".e2e/army/recipes/builds/unit");
      fs.mkdirSync(builds, { recursive: true });
      fs.writeFileSync(path.join(builds, "manifest.json"), JSON.stringify({
        buildId: "build-unit", sourceChangedDuringBuild: false, inputs: [],
      }));
      buildCount += 1;
      options.afterBuild?.(buildCount, checkout);
    },
    journeys: async (context) => {
      journeys.push(context.grep ?? context.files.join(","));
    },
    finalize: (context) => { fs.writeFileSync(path.join(context.evidence, "manifest.json"), JSON.stringify(context.manifest)); },
  });
  session.catch(() => { /* asserted by the caller */ });
  for (let attempt = 0; !(current.status === "ready" && current.socket) && attempt < 500; attempt += 1) await sleep(20);
  expect(current).toMatchObject({ status: "ready", socket: expect.any(String) });
  const results = async (grep: string) =>
    (await request(current.socket!, { action: "run", loopId: current.loopId, grep })).filter((message) => message.type === "result");
  return { controller, session, journeys, results };
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

  describe.skipIf(process.platform === "win32")("supervisor session", () => {
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
  });
});
