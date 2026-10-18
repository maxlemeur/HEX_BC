import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  acquireNativeStackSlot,
  cleanUpOnTerminationSignals,
  nativeStackWaitMs,
  NativeStackLimitError,
} from "@/test/native-stack-guard";

const guardModule = path.join(process.cwd(), "src/test/native-stack-guard.ts");

function slotDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "native-stack-guard-"));
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
      held.push(await acquireNativeStackSlot({ label: `run ${pid}`, directory, pid, isAlive }));
    }
    const refusal = acquireNativeStackSlot({ label: "fifth", directory, pid: 105, isAlive });
    await expect(refusal).rejects.toBeInstanceOf(NativeStackLimitError);
    await expect(refusal).rejects.toThrow(/limit reached: 4 of 4 slots[\s\S]*PID 101: run 101 in /);
    // The refused run leaves nothing behind.
    expect(fs.readdirSync(directory).filter((name) => name.startsWith("105-"))).toEqual([]);

    // A holder killed without cleanup (SIGKILL) is stale: its slot is reclaimed.
    alive.delete(102);
    const reclaimed = await acquireNativeStackSlot({ label: "after crash", directory, pid: 105, isAlive });
    expect(fs.readdirSync(directory).some((name) => name.startsWith("102-"))).toBe(false);

    reclaimed.release();
    reclaimed.release();
    held[0].release();
    expect(fs.readdirSync(directory)).toHaveLength(2);
    await expect(acquireNativeStackSlot({ label: "free again", directory, pid: 106, isAlive: () => true }))
      .resolves.toHaveProperty("release");
  });

  it("waits for a slot when asked to, and refuses an invalid wait", async () => {
    const directory = slotDirectory();
    const holders = await Promise.all([1, 2].map((pid) =>
      acquireNativeStackSlot({ label: "holder", directory, pid, limit: 2, isAlive: () => true })));
    const sleep = vi.fn(async () => { holders[0].release(); });
    await expect(acquireNativeStackSlot({
      label: "waiter", directory, pid: 3, limit: 2, waitMs: 60_000, isAlive: () => true, sleep,
    })).resolves.toHaveProperty("release");
    expect(sleep).toHaveBeenCalledOnce();

    expect(nativeStackWaitMs({})).toBe(0);
    expect(nativeStackWaitMs({ NATIVE_STACK_WAIT_SECONDS: "90" })).toBe(90_000);
    for (const value of ["-1", "1.5", "soon"]) {
      expect(() => nativeStackWaitMs({ NATIVE_STACK_WAIT_SECONDS: value })).toThrow("whole number of seconds");
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
        await acquireNativeStackSlot({ label: "race", directory: ${JSON.stringify(directory)}, limit: 4 });
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
      const slot = await acquireNativeStackSlot({ label: "signal", directory: ${JSON.stringify(directory)} });
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
