import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  acquireNativeStackSlot,
  cleanUpOnTerminationSignals,
  MAX_ACTIVE_NATIVE_STACKS,
  nativeStackLimit,
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
});
