import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { isLocalProductionBuild } from "../../scripts/next-build-env.mjs";
import {
  acquireBuildPlace,
  acquireNativeStackSlot,
  cleanUpOnTerminationSignals,
  MAX_ACTIVE_NATIVE_STACKS,
  nativeStackLimit,
  nativeStackWaitMs,
  NativeStackLimitError,
} from "@/test/native-stack-guard";

// The real process listing would count this machine's other stacks.
const noProcesses = () => [];

const guardModule = path.join(process.cwd(), "src/test/native-stack-guard.ts");

function slotDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "native-stack-guard-"));
}

function currentHostFixture(prefix = "native guard home ") {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const stateRoot = path.join(home, ".supabase", "stacks");
  const cacheRoot = path.join(home, ".supabase", "cache", "stack");
  const stackId = "a".repeat(64);
  const stackDirectory = path.join(stateRoot, stackId);
  const startup = path.join(stackDirectory, `startup-${"b".repeat(32)}.json`);
  const root = path.join(home, "project with spaces");
  fs.mkdirSync(stackDirectory, { recursive: true });
  fs.mkdirSync(root);
  return {
    home, root, stateRoot, cacheRoot, stackId, stackDirectory, startup,
    state: path.join(stackDirectory, "state.json"),
    command: `/x/node_modules/@supabase/cli-darwin-arm64/bin/supabase __supabase_stack_host__ ${stateRoot} ${cacheRoot} ${stackId} ${startup}`,
    saved: { id: stackId, identity: { projectRoot: root }, credentials: { serviceRoleKey: "private-fixture-credential" } },
  };
}

function runChild(source: string) {
  return spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });
}

describe("native stack slots", () => {
  it("refuses the fifth live run by name, reclaims dead holders and frees released slots", async () => {
    const directory = slotDirectory();
    const alive = new Set([101, 102, 103, 104, 105]);
    const isAlive = (pid: number) => alive.has(pid);
    const held = [];
    for (const pid of [101, 102, 103, 104]) {
      held.push(await acquireNativeStackSlot({ label: `run ${pid}`, directory, pid, isAlive, limit: 4, listProcesses: noProcesses }));
    }
    const refusal = acquireNativeStackSlot({ label: "fifth", directory, pid: 105, isAlive, limit: 4, listProcesses: noProcesses });
    await expect(refusal).rejects.toBeInstanceOf(NativeStackLimitError);
    await expect(refusal).rejects.toThrow(/limit reached: 4 of 4 places[\s\S]*run PID 101: run 101 in /);
    // The refused run leaves nothing behind.
    expect(fs.readdirSync(directory).filter((name) => name.startsWith("105-"))).toEqual([]);

    // A holder killed without cleanup (SIGKILL) is stale: its slot is reclaimed.
    alive.delete(102);
    const reclaimed = await acquireNativeStackSlot({ label: "after crash", directory, pid: 105, isAlive, limit: 4, listProcesses: noProcesses });
    expect(fs.readdirSync(directory).some((name) => name.startsWith("102-"))).toBe(false);

    reclaimed.release();
    reclaimed.release();
    held[0].release();
    expect(fs.readdirSync(directory)).toHaveLength(2);
    await expect(acquireNativeStackSlot({ label: "free again", directory, pid: 106, isAlive: () => true, limit: 4, listProcesses: noProcesses }))
      .resolves.toHaveProperty("release");
  });

  it("waits for a slot when asked to, and refuses an invalid wait", async () => {
    const directory = slotDirectory();
    const holders = await Promise.all([1, 2].map((pid) =>
      acquireNativeStackSlot({ label: "holder", directory, pid, limit: 2, isAlive: () => true, listProcesses: noProcesses })));
    const sleep = vi.fn(async () => { holders[0].release(); });
    await expect(acquireNativeStackSlot({
      label: "waiter", directory, pid: 3, limit: 2, waitMs: 60_000, isAlive: () => true, sleep, listProcesses: noProcesses,
    })).resolves.toHaveProperty("release");
    expect(sleep).toHaveBeenCalledOnce();

    expect(nativeStackWaitMs({})).toBe(0);
    expect(nativeStackWaitMs({ NATIVE_STACK_WAIT_SECONDS: "90" })).toBe(90_000);
    for (const value of ["-1", "1.5", "soon"]) {
      expect(() => nativeStackWaitMs({ NATIVE_STACK_WAIT_SECONDS: value })).toThrow("whole number of seconds");
    }
  });

  it("counts stack hosts no live run owns and production builds, never a guarded run's own host twice", async () => {
    const directory = slotDirectory();
    const ownRoot = fs.mkdtempSync(path.join(os.tmpdir(), "miaouffrage-supabase-ci-"));
    const host = (root: string) =>
      `/x/node_modules/@supabase/cli-darwin-arm64/bin/supabase __supabase_stack_host__ /h/.supabase/stacks {"identity":{"projectRoot":"${root}"}}`;
    const commands = [
      host(fs.realpathSync(ownRoot)),
      host("/tmp/miaouffrage-supabase-ci-crashed"),
      "/usr/local/bin/node scripts/next-build.mjs --webpack",
      "zsh -c pgrep -f __supabase_stack_host__",
      "node scripts/next-build.mjs.bak",
    ];
    const listProcesses = () => commands;
    const guarded = await acquireNativeStackSlot({ label: "guarded", directory, pid: 1, isAlive: () => true, listProcesses: () => [] });
    guarded.recordStack(ownRoot);
    // Taken: the guarded run (its host is not counted again), one orphan host, one build.
    const refusal = acquireNativeStackSlot({ label: "fourth", directory, pid: 2, isAlive: () => true, limit: 3, listProcesses });
    await expect(refusal).rejects.toThrow(/3 of 3 places[\s\S]*run PID 1: guarded[\s\S]*not owned by a guarded run: \/tmp\/miaouffrage-supabase-ci-crashed[\s\S]*production build: \/usr\/local\/bin\/node scripts\/next-build\.mjs/);
    await expect(refusal).rejects.not.toThrow(/zsh|\.bak/);
    await expect(acquireNativeStackSlot({ label: "fourth", directory, pid: 2, isAlive: () => true, limit: 4, listProcesses }))
      .resolves.toHaveProperty("release");

    expect(MAX_ACTIVE_NATIVE_STACKS).toBe(3);
    expect(nativeStackLimit({})).toBe(3);
    expect(nativeStackLimit({ NATIVE_STACK_MAX_RUNS: "2" })).toBe(2);
    for (const value of ["0", "33", "two"]) {
      expect(() => nativeStackLimit({ NATIVE_STACK_MAX_RUNS: value })).toThrow("from 1 to 32");
    }
  });

  it.each(["saved", "startup", "both"])("counts a CLI 2.121 host once with %s metadata and a symlink project root", async (metadata) => {
    const fixture = currentHostFixture();
    const home = vi.spyOn(os, "homedir").mockReturnValue(fixture.home);
    const alias = path.join(fixture.home, "project alias");
    fs.symlinkSync(fixture.root, alias);
    const directory = path.join(fixture.home, "slots");
    const held = await acquireNativeStackSlot({ label: "guarded", directory, pid: 101, isAlive: () => true, listProcesses: noProcesses });
    held.recordStack(alias);
    const admitted: Array<{ release: () => void }> = [];
    try {
      if (metadata !== "startup") fs.writeFileSync(fixture.state, JSON.stringify(fixture.saved));
      if (metadata !== "saved") fs.writeFileSync(fixture.startup, JSON.stringify({ register: fixture.saved }));
      admitted.push(await acquireNativeStackSlot({
        label: "second", directory, pid: 102, limit: 2, isAlive: () => true,
        listProcesses: () => [`  501  1 ${fixture.command}`],
      }));
      expect(fs.readdirSync(directory)).toHaveLength(2);
    } finally {
      for (const slot of admitted) slot.release();
      held.release();
      home.mockRestore();
      fs.rmSync(fixture.home, { recursive: true, force: true });
    }
  });

  it("still counts a CLI 2.121 host with a known identity when no live slot owns it", async () => {
    const fixture = currentHostFixture();
    const home = vi.spyOn(os, "homedir").mockReturnValue(fixture.home);
    try {
      fs.writeFileSync(fixture.state, JSON.stringify(fixture.saved));
      await expect(acquireNativeStackSlot({
        label: "next", directory: path.join(fixture.home, "slots"), pid: 102, limit: 1,
        isAlive: () => true, listProcesses: () => [fixture.command],
      })).rejects.toThrow(`native stack not owned by a guarded run: ${fixture.root}`);
    } finally {
      home.mockRestore();
      fs.rmSync(fixture.home, { recursive: true, force: true });
    }
  });

  it.each(["file", "symlink"])("counts native hosts under an executable path with spaces (%s), including an unknown identity", async (kind) => {
    const fixture = currentHostFixture();
    const home = vi.spyOn(os, "homedir").mockReturnValue(fixture.home);
    const executable = path.join(fixture.home, "Mon Projet", "node_modules", "@supabase", "cli-darwin-arm64", "bin", "supabase");
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    const target = kind === "symlink" ? path.join(fixture.home, "supabase-binary") : executable;
    fs.writeFileSync(target, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    if (kind === "symlink") fs.symlinkSync(target, executable);
    const command = fixture.command.replace("/x/node_modules/@supabase/cli-darwin-arm64/bin/supabase", executable);
    const directory = path.join(fixture.home, "slots");
    let held: { release: () => void } | undefined;
    try {
      // Missing metadata may prevent attribution, never remove a live host
      // from the capacity calculation merely because its executable has spaces.
      await expect(acquireNativeStackSlot({
        label: "first", directory, pid: 102, limit: 1, isAlive: () => true,
        listProcesses: () => [`  501  1 ${command}`],
      })).rejects.toThrow(/native stack not owned by a guarded run: PID 501 \(identity unavailable\)/);
      fs.writeFileSync(fixture.state, JSON.stringify(fixture.saved));
      await expect(acquireNativeStackSlot({
        label: "first", directory, pid: 102, limit: 1, isAlive: () => true, listProcesses: () => [command],
      })).rejects.toThrow(`native stack not owned by a guarded run: ${fixture.root}`);
      // Shell/grep mentions of that same real binary do not occupy places.
      held = await acquireNativeStackSlot({
        label: "first", directory, pid: 102, limit: 1, isAlive: () => true,
        listProcesses: () => [`/bin/sh -c ${command}`, `/usr/bin/grep ${command}`],
      });
    } finally {
      held?.release();
      home.mockRestore();
      fs.rmSync(fixture.home, { recursive: true, force: true });
    }
  });

  it("keeps a host with a deleted spaced executable counted without trusting its metadata", async () => {
    const fixture = currentHostFixture();
    const home = vi.spyOn(os, "homedir").mockReturnValue(fixture.home);
    const executable = path.join(fixture.home, "Mon Projet", "node_modules", "@supabase", "cli-darwin-arm64", "bin", "supabase");
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const command = fixture.command.replace("/x/node_modules/@supabase/cli-darwin-arm64/bin/supabase", executable);
    fs.unlinkSync(executable);
    fs.writeFileSync(fixture.state, JSON.stringify(fixture.saved));
    const directory = path.join(fixture.home, "slots");
    const held = await acquireNativeStackSlot({ label: "guarded", directory, pid: 101, isAlive: () => true, listProcesses: noProcesses });
    held.recordStack(fixture.root);
    const read = vi.spyOn(fs, "readFileSync");
    let admitted: { release: () => void } | undefined;
    try {
      const refusal = acquireNativeStackSlot({
        label: "second", directory, pid: 102, limit: 2, isAlive: () => true,
        listProcesses: () => [`  501  1 ${command}`],
      });
      await expect(refusal).rejects.toThrow(/2 of 2 places[\s\S]*native stack not owned by a guarded run: PID 501 \(identity unavailable\)/);
      expect(read.mock.calls.some(([file]) => String(file) === fixture.state)).toBe(false);
      // An unavailable executable does not turn known shell/grep/env prefixes
      // into hosts, even when they mention the same unquoted native command.
      admitted = await acquireNativeStackSlot({
        label: "second", directory, pid: 102, limit: 2, isAlive: () => true,
        listProcesses: () => [`/bin/sh -c ${command}`, `/usr/bin/grep ${command}`, `/usr/bin/env bash -c ${command}`],
      });
    } finally {
      read.mockRestore();
      admitted?.release();
      held.release();
      home.mockRestore();
      fs.rmSync(fixture.home, { recursive: true, force: true });
    }
  });

  it.each(["env", "sh", "rg"])("recognizes a native executable under %s projet before and after its removal", async (name) => {
    // No earlier space in the fixture home: the first whitespace-delimited
    // segment ends in env/sh/rg, but that segment is not a wrapper executable.
    const fixture = currentHostFixture("native-guard-");
    const home = vi.spyOn(os, "homedir").mockReturnValue(fixture.home);
    const executable = path.join(fixture.home, `${name} projet`, "node_modules", "@supabase", "cli-darwin-arm64", "bin", "supabase");
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    fs.writeFileSync(fixture.state, JSON.stringify(fixture.saved));
    const command = fixture.command.replace("/x/node_modules/@supabase/cli-darwin-arm64/bin/supabase", executable);
    const directory = path.join(fixture.home, "slots");
    const reserve = () => acquireNativeStackSlot({
      label: "first", directory, pid: 102, limit: 1, isAlive: () => true,
      listProcesses: () => [`  501  1 ${command}`],
    });
    const read = vi.spyOn(fs, "readFileSync");
    let admitted: { release: () => void } | undefined;
    try {
      const existingFailure = await reserve().then((slot) => { slot.release(); }, (error: unknown) => error);
      expect(existingFailure).toBeInstanceOf(NativeStackLimitError);
      expect(String(existingFailure)).toContain(`native stack not owned by a guarded run: ${fixture.root}`);
      fs.unlinkSync(executable);
      read.mockClear();
      const removedFailure = await reserve().then((slot) => { slot.release(); }, (error: unknown) => error);
      expect(removedFailure).toBeInstanceOf(NativeStackLimitError);
      expect(String(removedFailure)).toContain("native stack not owned by a guarded run: PID 501 (identity unavailable)");
      expect(read.mock.calls.some(([file]) => String(file) === fixture.state)).toBe(false);
      admitted = await acquireNativeStackSlot({
        label: "first", directory, pid: 102, limit: 1, isAlive: () => true,
        listProcesses: () => [`/bin/sh -c ${command}`, `/usr/bin/grep ${command}`, `/usr/bin/env bash -c ${command}`, `sh -c ${command}`, `grep ${command}`, `env bash -c ${command}`],
      });
    } finally {
      read.mockRestore();
      admitted?.release();
      home.mockRestore();
      fs.rmSync(fixture.home, { recursive: true, force: true });
    }
  });

  it.each(["missing", "invalid", "wrong-id", "relative-root", "disagree"])("keeps an unknown CLI host counted when metadata is %s without printing its private descriptor", async (scenario) => {
    const fixture = currentHostFixture();
    const home = vi.spyOn(os, "homedir").mockReturnValue(fixture.home);
    const directory = path.join(fixture.home, "slots");
    const held = await acquireNativeStackSlot({ label: "guarded", directory, pid: 101, isAlive: () => true, listProcesses: noProcesses });
    held.recordStack(fixture.root);
    try {
      if (scenario === "invalid") fs.writeFileSync(fixture.state, "private-fixture-credential{invalid JSON");
      if (scenario === "wrong-id") fs.writeFileSync(fixture.state, JSON.stringify({ ...fixture.saved, id: "c".repeat(64) }));
      if (scenario === "relative-root") fs.writeFileSync(fixture.state, JSON.stringify({ ...fixture.saved, identity: { projectRoot: "relative/path" } }));
      if (scenario === "disagree") {
        fs.writeFileSync(fixture.state, JSON.stringify(fixture.saved));
        fs.writeFileSync(fixture.startup, JSON.stringify({ register: { ...fixture.saved, identity: { projectRoot: path.join(fixture.home, "other project") } } }));
      }
      const refusal = acquireNativeStackSlot({
        label: "second", directory, pid: 102, limit: 2, isAlive: () => true,
        listProcesses: () => [`  501  1 ${fixture.command}`],
      });
      await expect(refusal).rejects.toThrow(/2 of 2 places[\s\S]*native stack not owned by a guarded run:/);
      await expect(refusal).rejects.not.toThrow(/private-fixture-credential|startup-|__supabase_stack_host__/);
    } finally {
      held.release();
      home.mockRestore();
      fs.rmSync(fixture.home, { recursive: true, force: true });
    }
  });

  it("does not read metadata outside the native registry or through a symlink", async () => {
    const fixture = currentHostFixture();
    const home = vi.spyOn(os, "homedir").mockReturnValue(fixture.home);
    const outside = path.join(fixture.home, "private", fixture.stackId);
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "state.json"), JSON.stringify(fixture.saved));
    const read = vi.spyOn(fs, "readFileSync");
    const directory = path.join(fixture.home, "slots");
    const held = await acquireNativeStackSlot({ label: "guarded", directory, pid: 101, isAlive: () => true, listProcesses: noProcesses });
    held.recordStack(fixture.root);
    try {
      const outsideStartup = path.join(outside, path.basename(fixture.startup));
      const commands = [
        fixture.command.replace(`${fixture.stateRoot} ${fixture.cacheRoot}`, `${path.dirname(outside)} ${fixture.cacheRoot}`).replace(fixture.startup, outsideStartup),
        fixture.command.replace(` ${fixture.stackId} `, ` ${"c".repeat(64)} `),
      ];
      fs.symlinkSync(path.join(outside, "state.json"), fixture.state);
      for (const command of [...commands, fixture.command]) {
        const refusal = acquireNativeStackSlot({ label: "second", directory, pid: 102, limit: 2, isAlive: () => true, listProcesses: () => [command] });
        await expect(refusal).rejects.toBeInstanceOf(NativeStackLimitError);
      }
      expect(read.mock.calls.some(([file]) => [fixture.state, path.join(outside, "state.json")].includes(String(file)))).toBe(false);
    } finally {
      read.mockRestore();
      held.release();
      home.mockRestore();
      fs.rmSync(fixture.home, { recursive: true, force: true });
    }
  });

  it("ignores shell and grep lines that only mention a native host", async () => {
    const fixture = currentHostFixture();
    const home = vi.spyOn(os, "homedir").mockReturnValue(fixture.home);
    let slot: { release: () => void } | undefined;
    try {
      fs.writeFileSync(fixture.state, JSON.stringify(fixture.saved));
      slot = await acquireNativeStackSlot({
        label: "first", directory: path.join(fixture.home, "slots"), pid: 102, limit: 1, isAlive: () => true,
        listProcesses: () => [`zsh -c ${fixture.command}`, `/bin/sh -c ${fixture.command}`, `/usr/bin/grep ${fixture.command}`],
      });
      expect(slot).toHaveProperty("release");
    } finally {
      slot?.release();
      home.mockRestore();
      fs.rmSync(fixture.home, { recursive: true, force: true });
    }
  });

  it("parses escaped legacy JSON roots and conceals malformed private descriptors", async () => {
    const fixture = currentHostFixture();
    const quotedRoot = path.join(fixture.home, 'project "quoted"');
    fs.mkdirSync(quotedRoot);
    const directory = path.join(fixture.home, "slots");
    const held = await acquireNativeStackSlot({ label: "guarded", directory, pid: 101, isAlive: () => true, listProcesses: noProcesses });
    held.recordStack(quotedRoot);
    let slot: { release: () => void } | undefined;
    try {
      const descriptor = JSON.stringify({ identity: { projectRoot: quotedRoot }, credentials: { token: "private-fixture-credential" } });
      const command = `/x/bin/supabase __supabase_stack_host__ ${fixture.stateRoot} ${descriptor}`;
      slot = await acquireNativeStackSlot({ label: "second", directory, pid: 102, limit: 2, isAlive: () => true, listProcesses: () => [command] });
      slot.release();
      const refusal = acquireNativeStackSlot({ label: "second", directory, pid: 102, limit: 2, isAlive: () => true, listProcesses: () => [command.slice(0, -1)] });
      await expect(refusal).rejects.toBeInstanceOf(NativeStackLimitError);
      await expect(refusal).rejects.not.toThrow(/private-fixture-credential|credentials|__supabase_stack_host__/);
    } finally {
      slot?.release();
      held.release();
      fs.rmSync(fixture.home, { recursive: true, force: true });
    }
  });

  it("lets Ctrl+C cancel a wait even when the caller owns the shutdown", async () => {
    const directory = slotDirectory();
    await acquireNativeStackSlot({ label: "holder", directory, pid: 1, limit: 1, isAlive: () => true, listProcesses: noProcesses });
    // The Army dev modes register their own handler, so the cleanup guard stands aside.
    const caller = vi.fn();
    process.on("SIGINT", caller);
    try {
      const waiting = acquireNativeStackSlot({
        label: "waiter", directory, pid: 2, limit: 1, waitMs: 3_600_000, isAlive: () => true,
        listProcesses: noProcesses, sleep: () => new Promise(() => {}),
      });
      await new Promise((resolve) => setImmediate(resolve));
      process.emit("SIGINT", "SIGINT");
      await expect(waiting).rejects.toThrow("Waiting for a native place was cancelled by SIGINT");
      // The build launcher raises it again, so `npm run build` ends by the signal.
      await expect(waiting).rejects.toMatchObject({ name: "NativeStackLimitError", signal: "SIGINT" });
    } finally {
      process.off("SIGINT", caller);
    }
    expect(process.listenerCount("SIGINT") + process.listenerCount("SIGTERM")).toBe(0);
    expect(fs.readdirSync(directory).filter((name) => name.startsWith("2-"))).toEqual([]);
  });

  it("gives a local production build a place, never in CI, on Vercel or for --help, and never fails it otherwise", async () => {
    expect(isLocalProductionBuild({} as NodeJS.ProcessEnv, ["--webpack"])).toBe(true);
    for (const env of [{ CI: "false" }, { CI: "0" }, { CI: " " }]) {
      expect(isLocalProductionBuild(env as never, []), JSON.stringify(env)).toBe(true);
    }
    for (const [env, args] of [[{ CI: "true" }, []], [{ CI: "1" }, []], [{ VERCEL: "1" }, []], [{}, ["--help"]]] as const) {
      expect(isLocalProductionBuild(env as never, [...args]), JSON.stringify([env, args])).toBe(false);
    }

    const directory = slotDirectory();
    const listProcesses = vi.fn(noProcesses);
    for (const env of [{ CI: "true" }, { VERCEL: "1" }]) {
      await expect(acquireBuildPlace(env, ["--webpack"], { directory, listProcesses })).resolves.toBeUndefined();
    }
    await expect(acquireBuildPlace({}, ["--help"], { directory, listProcesses })).resolves.toBeUndefined();
    expect(listProcesses).not.toHaveBeenCalled();

    // Fail-open: no process listing, an unusable lock folder or an invalid setting only warn.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(acquireBuildPlace({}, [], { directory, listProcesses: () => { throw new Error("ps: not found"); } }))
        .resolves.toBeUndefined();
      const notADirectory = path.join(directory, "file");
      fs.writeFileSync(notADirectory, "");
      await expect(acquireBuildPlace({}, [], { directory: notADirectory, listProcesses })).resolves.toBeUndefined();
      await expect(acquireBuildPlace({ NATIVE_STACK_MAX_RUNS: "many" }, [], { directory, listProcesses })).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(3);
      expect(warn.mock.calls.flat().join("\n")).toContain("building anyway");
    } finally {
      warn.mockRestore();
    }
    expect(fs.readdirSync(directory)).toEqual(["file"]);

    // A full house stops it, naming the holders.
    const held = await Promise.all([1, 2, 3].map((pid) =>
      acquireNativeStackSlot({ label: `run ${pid}`, directory, pid, isAlive: () => true, listProcesses: noProcesses })));
    await expect(acquireBuildPlace({}, [], { directory, pid: 9, isAlive: () => true, listProcesses }))
      .rejects.toThrow(/3 of 3 places[\s\S]*run PID 3: run 3/);

    // A build's own process line is not counted next to its slot.
    held[2].release();
    const own = await acquireBuildPlace({}, ["--webpack"], {
      directory, pid: 9, isAlive: () => true, listProcesses: () => ["    9 node scripts/next-build.mjs --webpack"],
    });
    expect(own).toBeDefined();
    held[1].release();
    await expect(acquireNativeStackSlot({
      label: "next", directory, pid: 10, isAlive: () => true, listProcesses: () => ["9 node scripts/next-build.mjs --webpack"],
    })).resolves.toHaveProperty("release");
  });

  it("ends by the signal when Ctrl+C cancels a wait no caller owns", async () => {
    const directory = slotDirectory();
    await acquireNativeStackSlot({ label: "holder", directory, pid: 1, limit: 1, isAlive: () => true, listProcesses: noProcesses });
    const raise = vi.spyOn(process, "kill").mockImplementation(() => true);
    const cleanup = vi.fn();
    const remove = cleanUpOnTerminationSignals(cleanup);
    try {
      const waiting = acquireNativeStackSlot({
        label: "waiter", directory, pid: 2, limit: 1, waitMs: 3_600_000, isAlive: () => true,
        listProcesses: noProcesses, sleep: () => new Promise(() => {}),
      });
      await new Promise((resolve) => setImmediate(resolve));
      process.emit("SIGINT", "SIGINT");
      // No listener may survive the re-raise, or Node would treat the signal as handled.
      expect(process.listenerCount("SIGINT")).toBe(0);
      await expect(waiting).rejects.toThrow("cancelled by SIGINT");
      // The waiter's own listener is not a caller: the guard cleans up and re-raises.
      expect(cleanup).toHaveBeenCalledExactlyOnceWith("SIGINT");
      expect(raise).toHaveBeenCalledExactlyOnceWith(process.pid, "SIGINT");
    } finally {
      remove();
      raise.mockRestore();
    }
    expect(process.listenerCount("SIGINT") + process.listenerCount("SIGTERM")).toBe(0);
  });

  it("counts a Next build left by a dead launcher, never a build under a place or a launcher's own child", async () => {
    const directory = slotDirectory();
    const run = await acquireNativeStackSlot({ label: "army", directory, pid: 9, isAlive: () => true, listProcesses: noProcesses });
    const listProcesses = () => [
      "  500     1 /usr/bin/node /r/node_modules/next/dist/bin/next build --webpack",
      "  610     9 node scripts/tester-army/build-local.mjs --execute",
      "  611   610 /usr/bin/node --max-old-space-size=4096 node_modules/next/dist/bin/next build --webpack",
      "  650     1 node scripts/next-build.mjs --webpack",
      "  651   650 /usr/bin/node /r/node_modules/next/dist/bin/next build --webpack",
      "  700     1 node /r/node_modules/next/dist/bin/next dev",
      // Lines that only mention a build, and a shell wrapper around the orphan 500.
      "  710     1 bash -c pgrep -f /r/node_modules/next/dist/bin/next build",
      "  720     1 sh -c node /r/node_modules/next/dist/bin/next build --webpack",
      "  730     1 /usr/bin/grep next/dist/bin/next build",
    ];
    // Taken: the Army run, the orphan build 500 and the launcher 650 (its child 651 once).
    await expect(acquireNativeStackSlot({ label: "next", directory, pid: 2, limit: 3, isAlive: () => true, listProcesses }))
      .rejects.toThrow(/3 of 3 places[\s\S]*run PID 9[\s\S]*production build: node scripts\/next-build\.mjs[\s\S]*Next build without a place: \/usr\/bin\/node \/r\/node_modules\/next\/dist\/bin\/next build/);
    await expect(acquireNativeStackSlot({ label: "next", directory, pid: 2, limit: 4, isAlive: () => true, listProcesses }))
      .resolves.toHaveProperty("release");
    run.release();
  });

  it("never admits more than the limit among racing processes", async () => {
    const directory = slotDirectory();
    const start = path.join(directory, "..", `${path.basename(directory)}.start`);
    const source = `
      import fs from "node:fs";
      const { acquireNativeStackSlot } = await import(${JSON.stringify(guardModule)});
      while (!fs.existsSync(${JSON.stringify(start)})) await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        await acquireNativeStackSlot({ label: "race", directory: ${JSON.stringify(directory)}, limit: 4, listProcesses: () => [] });
        console.log("admitted");
      } catch (error) {
        console.log(error.name);
      }
      process.stdin.resume();
      process.stdin.on("end", () => process.exit(0));
    `;
    const children = Array.from({ length: 8 }, () => runChild(source));
    const outcomes = children.map((child) => new Promise<string>((resolve, reject) => {
      child.stdout.setEncoding("utf8");
      child.stdout.once("data", (text: string) => resolve(text.trim()));
      child.once("exit", (code) => reject(new Error(`child exited early with ${code}`)));
    }));
    fs.writeFileSync(start, "");
    try {
      const results = await Promise.all(outcomes);
      expect(results.every((result) => ["admitted", "NativeStackLimitError"].includes(result))).toBe(true);
      expect(results.filter((result) => result === "admitted").length).toBeLessThanOrEqual(4);
    } finally {
      await Promise.all(children.map((child) => new Promise((resolve) => {
        child.removeAllListeners("exit");
        child.once("exit", resolve);
        child.stdin.end();
      })));
      fs.rmSync(start, { force: true });
    }
    // Every holder released its slot on exit.
    expect(fs.readdirSync(directory)).toEqual([]);
  }, 60_000);
});

describe("termination signal cleanup", () => {
  it("cleans up once on SIGTERM, then still ends the process by that signal", async () => {
    const directory = slotDirectory();
    const marker = path.join(directory, "cleanup.log");
    const child = runChild(`
      import fs from "node:fs";
      const { acquireNativeStackSlot, cleanUpOnTerminationSignals } = await import(${JSON.stringify(guardModule)});
      const slot = await acquireNativeStackSlot({ label: "signal", directory: ${JSON.stringify(directory)}, listProcesses: () => [] });
      cleanUpOnTerminationSignals((signal) => {
        fs.appendFileSync(${JSON.stringify(marker)}, signal + "\\n");
        slot.release();
      });
      setInterval(() => {}, 1000);
      console.log("ready");
    `);
    await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));
    const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      child.once("exit", (code, signal) => resolve({ code, signal })));
    child.kill("SIGTERM");
    await expect(exit).resolves.toEqual({ code: null, signal: "SIGTERM" });
    expect(fs.readFileSync(marker, "utf8")).toBe("SIGTERM\n");
    expect(fs.readdirSync(directory)).toEqual(["cleanup.log"]);
  }, 30_000);

  it("keeps its handler during cleanup, so a repeated signal cannot interrupt it", () => {
    const target = Object.assign(new EventEmitter(), { pid: 42, kill: vi.fn() });
    let handlersDuringCleanup = 0;
    const cleanup = vi.fn(() => {
      // Ctrl+C pressed again while `stack destroy` runs.
      handlersDuringCleanup = target.listenerCount("SIGINT");
      target.emit("SIGINT", "SIGINT");
      target.emit("SIGTERM", "SIGTERM");
    });
    cleanUpOnTerminationSignals(cleanup, target as never);
    target.emit("SIGINT", "SIGINT");
    expect(handlersDuringCleanup).toBe(1);
    expect(cleanup).toHaveBeenCalledExactlyOnceWith("SIGINT");
    expect(target.kill).toHaveBeenCalledExactlyOnceWith(42, "SIGINT");
    expect(target.listenerCount("SIGINT") + target.listenerCount("SIGTERM")).toBe(0);
  });

  it("leaves the shutdown to a caller that handles the signal itself", () => {
    const target = Object.assign(new EventEmitter(), { pid: 42, kill: vi.fn() });
    const cleanup = vi.fn();
    const caller = vi.fn();
    target.on("SIGINT", caller);
    cleanUpOnTerminationSignals(cleanup, target as never);
    target.emit("SIGINT", "SIGINT");
    target.emit("SIGINT", "SIGINT");
    expect(cleanup).not.toHaveBeenCalled();
    expect(caller).toHaveBeenCalledTimes(2);
    expect(target.kill).not.toHaveBeenCalled();
    expect(target.listenerCount("SIGTERM")).toBe(1);
  });
});
