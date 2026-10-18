// Shared by the local runners that own a disposable Supabase native stack:
// runLocalSupabaseCi (db:ci:local, the Army runner, document fingerprints),
// scripts/engine-v3/owned-native-stack.ts and scripts/engine-v3/upgrade-check.ts.
// See docs/testing/local-native-stack-tooling.md.
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Native runs one user may own at once on one host. */
export const MAX_ACTIVE_NATIVE_STACKS = 4;

export class NativeStackLimitError extends Error {
  override name = "NativeStackLimitError";
}

export interface NativeStackSlot {
  /** Idempotent; also runs on process exit. */
  release: () => void;
}

export interface AcquireNativeStackSlotOptions {
  /** Entry point named to the runs this one blocks. */
  label: string;
  directory?: string;
  limit?: number;
  waitMs?: number;
  pollMs?: number;
  pid?: number;
  isAlive?: (pid: number) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

export function defaultNativeStackSlotDirectory() {
  return path.join(os.homedir(), ".supabase", "native-runs");
}

/** `NATIVE_STACK_WAIT_SECONDS`: 0 (default) refuses at once. */
export function nativeStackWaitMs(environment: Readonly<Record<string, string | undefined>> = process.env) {
  const value = environment.NATIVE_STACK_WAIT_SECONDS?.trim();
  if (!value) return 0;
  if (!/^\d{1,6}$/.test(value)) throw new Error("NATIVE_STACK_WAIT_SECONDS must be a whole number of seconds");
  return Number(value) * 1000;
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: alive, owned by another user.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

const SLOT_FILE = /^(\d+)-[0-9a-f-]{36}\.json$/;

/**
 * Live slot files; files of dead processes are stale and removed. The PID is
 * read from the file name, so a file still being written counts as well.
 */
function liveSlots(directory: string, isAlive: (pid: number) => boolean) {
  const live: Array<{ file: string; pid: number; detail: string }> = [];
  for (const name of fs.readdirSync(directory)) {
    const match = SLOT_FILE.exec(name);
    if (!match) continue;
    const file = path.join(directory, name);
    const pid = Number(match[1]);
    if (!isAlive(pid)) {
      fs.rmSync(file, { force: true });
      continue;
    }
    let detail = "";
    try {
      const record = JSON.parse(fs.readFileSync(file, "utf8")) as { label?: string; cwd?: string; startedAt?: string };
      detail = `${record.label} in ${record.cwd} since ${record.startedAt}`;
    } catch {
      detail = "starting";
    }
    live.push({ file, pid, detail });
  }
  return live;
}

/**
 * Reserves one of the user's native-run slots, or refuses (or waits) with a
 * NativeStackLimitError naming the holders. Each run creates its own file
 * before counting the live files, so of two racing runs the later counter sees
 * both: never more than `limit` are admitted, though both may back off.
 */
export async function acquireNativeStackSlot(options: AcquireNativeStackSlotOptions): Promise<NativeStackSlot> {
  const directory = options.directory ?? defaultNativeStackSlotDirectory();
  const limit = options.limit ?? MAX_ACTIVE_NATIVE_STACKS;
  const pid = options.pid ?? process.pid;
  const isAlive = options.isAlive ?? isProcessAlive;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (options.waitMs ?? 0);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${pid}-${randomUUID()}.json`);
  const record = `${JSON.stringify({ pid, label: options.label, cwd: process.cwd(), startedAt: new Date().toISOString() })}\n`;
  for (;;) {
    fs.writeFileSync(file, record, { flag: "wx", mode: 0o600 });
    let others: ReturnType<typeof liveSlots>;
    try {
      others = liveSlots(directory, isAlive).filter((slot) => slot.file !== file);
    } catch (error) {
      fs.rmSync(file, { force: true });
      throw error;
    }
    if (others.length < limit) {
      const release = () => {
        process.off("exit", release);
        fs.rmSync(file, { force: true });
      };
      process.on("exit", release);
      return { release };
    }
    fs.rmSync(file, { force: true });
    if (Date.now() >= deadline) {
      throw new NativeStackLimitError(
        `Native Supabase run limit reached: ${others.length} of ${limit} slots are held in ${directory}:\n` +
        `${others.map((slot) => `- PID ${slot.pid}: ${slot.detail}`).join("\n")}\n` +
        "Wait for one to finish, stop it, or set NATIVE_STACK_WAIT_SECONDS to wait."
      );
    }
    await sleep((options.pollMs ?? 2_000) + Math.floor(Math.random() * 250));
  }
}

type SignalTarget = Pick<NodeJS.Process, "on" | "off" | "listenerCount" | "kill" | "pid">;

/**
 * Runs `cleanup` on SIGINT or SIGTERM, then raises the signal again so the
 * process still ends by it. Without a handler, Node dies on these signals even
 * inside a synchronous CLI call and no `finally` runs. A caller with its own
 * handler for that signal (the Army dev modes, a child relay) keeps control:
 * its shutdown reaches the caller's `finally`, so nothing is done here.
 * Returns the function that removes the handlers.
 */
export function cleanUpOnTerminationSignals(
  cleanup: (signal: NodeJS.Signals) => void,
  target: SignalTarget = process
) {
  const signals = ["SIGINT", "SIGTERM"] as const;
  const remove = () => {
    for (const signal of signals) target.off(signal, handler);
  };
  const handler = (signal: NodeJS.Signals) => {
    // Assumes no library registers a passive SIGINT/SIGTERM listener: any
    // other listener is taken to own the shutdown.
    if (target.listenerCount(signal) > 1) return;
    remove();
    try {
      cleanup(signal);
    } catch (error) {
      console.error(`Cleanup after ${signal} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    target.kill(target.pid, signal);
  };
  for (const signal of signals) target.on(signal, handler);
  return remove;
}
