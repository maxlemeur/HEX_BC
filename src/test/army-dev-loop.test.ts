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
// 7. stop removes a directory it does not own, or reports a destroyed stack
//    while one of its ports still listens;
// 8. the command line accepts an ambiguous or unfiltered selection, an
//    invalid pattern, a repeated option, an out-of-range TTL or a forbidden
//    port.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  applicationSourceDigest,
  classifyLoopState,
  createLoopState,
  decideRebuild,
  DEV_LOOP_STATE_SCHEMA,
  DEV_LOOP_SUPERVISOR_ENTRY,
  listeningPorts,
  type LoopState,
  parseDevLoopArguments,
  probeSupervisor,
  readLoopState,
  removeOwnedTemporaryDirectory,
  stackInputsDigest,
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
      ["start", "--app-port", "45585"], ["start", "--app-port", "33485"], ["start", "--app-port", "3118x"],
      ["start", "--ttl-minutes", "4"], ["start", "--ttl-minutes", "721"], ["start", "--ttl-minutes", "1.5"],
      ["start", "--app-port", "3118", "--app-port", "3119"], ["stop", "--app-port", "3118"], ["status", "extra"],
    ]) {
      expect(() => parseDevLoopArguments(argv, exists), argv.join(" ")).toThrow();
    }
  });
});
