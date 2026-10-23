// Shared by the local runners that own a disposable Supabase native stack:
// runLocalSupabaseCi (db:ci:local, the Army runner, document fingerprints),
// scripts/engine-v3/owned-native-stack.ts and scripts/engine-v3/upgrade-check.ts.
// See docs/testing/tester-army-local-development.md.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { isLocalProductionBuild } from "../../scripts/next-build-env.mjs";

/**
 * Native runs one user may own at once on one host, by default: a native
 * stack and a production build each take one. `NATIVE_STACK_MAX_RUNS`
 * overrides it (owner decision of 18/10/2026: 3, memory pressure under WSL).
 */
export const MAX_ACTIVE_NATIVE_STACKS = 3;

export class NativeStackLimitError extends Error {
  override name = "NativeStackLimitError";

  /** Set when a signal cancelled the wait: the caller raises it again. */
  readonly signal?: NodeJS.Signals;

  constructor(message: string, signal?: NodeJS.Signals) {
    super(message);
    this.signal = signal;
  }
}

export interface NativeStackSlot {
  /** Records the isolated workdir, so its stack host is not counted twice. */
  recordStack: (rootDirectory: string) => void;
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
  /** This user's processes, one `<pid> <ppid> <command line>` per line. */
  listProcesses?: () => string[];
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

/** `NATIVE_STACK_MAX_RUNS`: whole number from 1 to 32, default 3. */
export function nativeStackLimit(environment: Readonly<Record<string, string | undefined>> = process.env) {
  const value = environment.NATIVE_STACK_MAX_RUNS?.trim();
  if (!value) return MAX_ACTIVE_NATIVE_STACKS;
  if (!/^\d{1,2}$/.test(value) || Number(value) < 1 || Number(value) > 32) {
    throw new Error("NATIVE_STACK_MAX_RUNS must be a whole number from 1 to 32");
  }
  return Number(value);
}

function listUserProcesses() {
  const result = spawnSync("ps", ["-U", String(process.getuid?.() ?? os.userInfo().uid), "-o", "pid=,ppid=,command="], {
    encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 10_000,
  });
  if (result.error || result.status !== 0) throw new Error("Could not list this user's processes to count native runs");
  return result.stdout.split("\n").filter(Boolean);
}

function processEntries(lines: readonly string[]) {
  return lines.map((line) => {
    const withParent = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (withParent) return { pid: Number(withParent[1]), ppid: Number(withParent[2]), command: withParent[3] };
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    return match ? { pid: Number(match[1]), ppid: undefined, command: match[2] } : { pid: undefined, ppid: undefined, command: line };
  });
}

const LAUNCHER = /^(?:\S*\/)?node\s+scripts\/next-build\.mjs(?:\s|$)/;
// The Next CLI's build as the executable: `node [node flags] …/next/dist/bin/next
// build`, or the CLI file run directly. A shell or pgrep line that only names
// it does not match, so a wrapper and its Node child count once.
const NEXT_BUILD = /^(?:(?:\S*\/)?node(?:\s+-\S+)*\s+)?\S*next[\\/]dist[\\/]bin[\\/]next\s+build(?:\s|$)/;

/**
 * `next build` processes no place accounts for: neither a slot holder (an
 * Army run, a local launcher) nor a launcher counted below is among their
 * ancestors, e.g. a build that outlived a launcher killed by SIGKILL or OOM.
 */
function nextBuildsWithoutPlace(entries: ReturnType<typeof processEntries>, slotPids: ReadonlySet<number>) {
  const parents = new Map(entries.flatMap(({ pid, ppid }) => pid === undefined || ppid === undefined ? [] : [[pid, ppid] as const]));
  const launchers = new Set(entries.flatMap(({ pid, command }) => pid !== undefined && LAUNCHER.test(command) ? [pid] : []));
  return entries.filter(({ ppid, command }) => {
    if (!NEXT_BUILD.test(command)) return false;
    for (let ancestor = ppid, depth = 0; ancestor !== undefined && depth < 64; ancestor = parents.get(ancestor), depth += 1) {
      if (slotPids.has(ancestor) || launchers.has(ancestor)) return false;
    }
    return true;
  }).map(({ command }) => command);
}

function absolutePath(value: unknown): value is string {
  return typeof value === "string" && path.isAbsolute(value) && !/[\r\n\0]/.test(value);
}

function executableFile(file: string) {
  try {
    const stat = fs.statSync(file);
    return stat.isFile() && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

function identityRoot(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return;
  const identity = (value as { identity?: { projectRoot?: unknown } }).identity;
  return absolutePath(identity?.projectRoot) ? identity.projectRoot : undefined;
}

/** Only the user's native registry is readable from a process command line. */
function currentStackHostRoot(args: string): string | undefined {
  const match = /^(.+) ([a-f0-9]{64}) (.+[/\\]startup-[a-f0-9]{32}\.json)$/.exec(args);
  if (!match) return;
  const [, roots, stackId, startup] = match;
  if (!absolutePath(startup) || path.normalize(startup) !== startup) return;
  const stackDirectory = path.dirname(startup);
  const stateRoot = path.dirname(stackDirectory);
  if (path.basename(stackDirectory) !== stackId || !roots.startsWith(`${stateRoot} `)) return;
  const cacheRoot = roots.slice(stateRoot.length + 1);
  const registry = path.join(os.homedir(), ".supabase", "stacks");
  const cache = path.join(os.homedir(), ".supabase", "cache", "stack");
  // Custom or unknown layouts still occupy a place; never follow an arbitrary
  // metadata path from ps, including a symlink out of the known registry.
  if (!absolutePath(cacheRoot) || canonical(stateRoot) !== canonical(registry) || canonical(cacheRoot) !== canonical(cache)) return;
  try {
    const realDirectory = fs.realpathSync(stackDirectory);
    if (path.dirname(realDirectory) !== fs.realpathSync(registry) || path.basename(realDirectory) !== stackId) return;
  } catch {
    return;
  }
  const readIdentity = (file: string, startupFile: boolean): string | null | undefined => {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.size > 1024 * 1024) return null;
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      const saved = startupFile && parsed && typeof parsed === "object"
        ? (parsed as { register?: unknown }).register : parsed;
      if (!saved || typeof saved !== "object" || (saved as { id?: unknown }).id !== stackId) return null;
      return identityRoot(saved) ?? null;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? undefined : null;
    }
  };
  // Startup metadata is transient; state.json remains after the CLI removes it.
  // During registration only startup.register may exist. Conflicts or malformed
  // metadata never establish ownership and their private payload is discarded.
  const saved = readIdentity(path.join(stackDirectory, "state.json"), false);
  const starting = readIdentity(startup, true);
  if (saved === null || starting === null || (saved && starting && canonical(saved) !== canonical(starting))) return;
  return saved ?? starting;
}

/** Workdirs of native stack hosts, with an opaque fallback for unknown formats. */
function stackHosts(entries: ReturnType<typeof processEntries>) {
  return entries.flatMap(({ pid, command }) => {
    // Match the executable, not a shell or grep command mentioning an owner.
    const host = /^(.+?) __supabase_stack_host__ (.*)$/.exec(command);
    if (!host || path.basename(host[1]) !== "supabase") return [];
    const executable = host[1];
    const unknown = { root: undefined, detail: `PID ${pid ?? "unknown"} (identity unavailable)` };
    if (/\s/.test(executable)) {
      // ps does not quote executable paths containing spaces. Check the whole
      // prefix first, including directories named `env projet` or `sh projet`.
      // A removed CLI still occupies a place without establishing ownership.
      if (!absolutePath(executable)) return [];
      if (!executableFile(executable)) {
        const firstCommand = executable.split(/\s+/, 1)[0];
        // Exclude a wrapper only when the actual first token is executable;
        // the basename of a truncated directory path is not enough evidence.
        if (["sh", "bash", "zsh", "dash", "ksh", "fish", "ash", "csh", "tcsh", "env", "grep", "pgrep", "rg"].includes(path.basename(firstCommand)) && executableFile(firstCommand)) return [];
        return [unknown];
      }
    }
    const args = host[2];
    const inline = /^(.+?) (\{.*)$/.exec(args);
    let root: string | undefined;
    if (inline && absolutePath(inline[1])) {
      try {
        root = identityRoot(JSON.parse(inline[2]));
      } catch {
        // Legacy descriptors may include credentials: never echo them.
      }
    } else {
      root = currentStackHostRoot(args);
    }
    return [{ root, detail: root ?? unknown.detail }];
  });
}

/** Production builds (`npm run build`) that hold no slot of their own. */
function productionBuilds(entries: ReturnType<typeof processEntries>, slotPids: ReadonlySet<number>) {
  return entries.filter(({ pid, command }) => (pid === undefined || !slotPids.has(pid)) && LAUNCHER.test(command))
    .map(({ command }) => command);
}

function canonical(directory: string) {
  try {
    return fs.realpathSync(directory);
  } catch {
    return path.resolve(directory);
  }
}

// The wait's own signal listener: never mistaken for a caller's handler.
const INTERNAL_LISTENERS = new WeakSet<(...args: never[]) => unknown>();

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
  const live: Array<{ file: string; pid: number; detail: string; stackRoot?: string }> = [];
  for (const name of fs.readdirSync(directory)) {
    const match = SLOT_FILE.exec(name);
    if (!match) continue;
    const file = path.join(directory, name);
    const pid = Number(match[1]);
    if (!isAlive(pid)) {
      fs.rmSync(file, { force: true });
      continue;
    }
    let detail = "starting";
    let stackRoot: string | undefined;
    try {
      const record = JSON.parse(fs.readFileSync(file, "utf8")) as { label?: string; cwd?: string; startedAt?: string; stackRoot?: string };
      detail = `${record.label} in ${record.cwd} since ${record.startedAt}`;
      stackRoot = record.stackRoot;
    } catch {
      // Still being written by its live owner.
    }
    live.push({ file, pid, detail, stackRoot });
  }
  return live;
}

/**
 * Reserves one of the user's native-run slots, or refuses (or waits) with a
 * NativeStackLimitError naming the holders. Each run creates its own file
 * before counting the live files, so of two racing runs the later counter sees
 * both: never more than `limit` are admitted, though both may back off. Stack
 * hosts no live slot owns (a crashed or unguarded run, a manual stack) and
 * production builds (`node scripts/next-build.mjs`) take places too; those
 * are counted best effort, from a process listing.
 */
export async function acquireNativeStackSlot(options: AcquireNativeStackSlotOptions): Promise<NativeStackSlot> {
  const directory = options.directory ?? defaultNativeStackSlotDirectory();
  const limit = options.limit ?? nativeStackLimit();
  const listProcesses = options.listProcesses ?? listUserProcesses;
  const pid = options.pid ?? process.pid;
  const isAlive = options.isAlive ?? isProcessAlive;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + (options.waitMs ?? 0);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${pid}-${randomUUID()}.json`);
  // SIGINT/SIGTERM cancel a wait, even when a caller's own handler (Army
  // dev modes) makes the cleanup guard stand aside.
  let cancelled: NodeJS.Signals | undefined;
  let wake = () => {};
  const onSignal = (signal: NodeJS.Signals) => {
    cancelled = signal;
    wake();
  };
  INTERNAL_LISTENERS.add(onSignal);
  const record = { pid, label: options.label, cwd: process.cwd(), startedAt: new Date().toISOString() };
  try {
    for (;;) {
      fs.writeFileSync(file, `${JSON.stringify(record)}\n`, { flag: "wx", mode: 0o600 });
      let holders: string[];
      try {
        const slots = liveSlots(directory, isAlive);
        const owned = new Set(slots.flatMap((slot) => slot.stackRoot ? [canonical(slot.stackRoot)] : []));
        const commands = processEntries(listProcesses());
        holders = [
          ...slots.filter((slot) => slot.file !== file).map((slot) => `run PID ${slot.pid}: ${slot.detail}`),
          ...stackHosts(commands).filter(({ root }) => !root || !owned.has(canonical(root)))
            .map(({ detail }) => `native stack not owned by a guarded run: ${detail}`),
          ...productionBuilds(commands, new Set(slots.map((slot) => slot.pid)))
            .map((command) => `production build: ${command.slice(0, 120)}`),
          ...nextBuildsWithoutPlace(commands, new Set(slots.map((slot) => slot.pid)))
            .map((command) => `Next build without a place: ${command.slice(0, 120)}`),
        ];
      } catch (error) {
        fs.rmSync(file, { force: true });
        throw error;
      }
      if (holders.length < limit) {
        const release = () => {
          process.off("exit", release);
          fs.rmSync(file, { force: true });
        };
        process.on("exit", release);
        const recordStack = (rootDirectory: string) => {
          fs.writeFileSync(file, `${JSON.stringify({ ...record, stackRoot: canonical(rootDirectory) })}\n`, { mode: 0o600 });
        };
        return { recordStack, release };
      }
      fs.rmSync(file, { force: true });
      if (Date.now() >= deadline) {
        throw new NativeStackLimitError(
          `Native Supabase run limit reached: ${holders.length} of ${limit} places are taken (slots in ${directory}):\n` +
          `${holders.map((holder) => `- ${holder}`).join("\n")}\n` +
          "Wait for one to finish, stop it, set NATIVE_STACK_WAIT_SECONDS to wait, or NATIVE_STACK_MAX_RUNS to change the limit."
        );
      }
      if (!process.listeners("SIGINT").includes(onSignal)) {
        process.on("SIGINT", onSignal);
        process.on("SIGTERM", onSignal);
      }
      await Promise.race([
        sleep((options.pollMs ?? 2_000) + Math.floor(Math.random() * 250)),
        new Promise<void>((resolve) => { wake = resolve; }),
      ]);
      if (cancelled) throw new NativeStackLimitError(`Waiting for a native place was cancelled by ${cancelled}`, cancelled);
    }
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
  }
}

type SignalTarget = Pick<NodeJS.Process, "on" | "off" | "listeners" | "kill" | "pid">;

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
  target: SignalTarget = process,
  /** Told when the caller owns the shutdown, so its run can stop at a safe point. */
  onCallerOwned?: (signal: NodeJS.Signals) => void
) {
  const signals = ["SIGINT", "SIGTERM"] as const;
  const remove = () => {
    for (const signal of signals) target.off(signal, handler);
  };
  let cleaning = false;
  const handler = (signal: NodeJS.Signals) => {
    // A repeated signal must not reach the default action mid-cleanup.
    if (cleaning) return;
    // Assumes no library registers a passive SIGINT/SIGTERM listener: any
    // other listener is taken to own the shutdown.
    if (target.listeners(signal).filter((listener) => !INTERNAL_LISTENERS.has(listener)).length > 1) {
      onCallerOwned?.(signal);
      return;
    }
    cleaning = true;
    try {
      cleanup(signal);
    } catch (error) {
      console.error(`Cleanup after ${signal} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    remove();
    // A pending wait's listener would make Node treat the re-raised signal as handled.
    for (const listener of target.listeners(signal)) {
      if (INTERNAL_LISTENERS.has(listener)) target.off(signal, listener as (signal: NodeJS.Signals) => void);
    }
    target.kill(target.pid, signal);
  };
  for (const signal of signals) target.on(signal, handler);
  return remove;
}

/**
 * The place of a local production build (scripts/next-build.mjs), or none.
 * CI, Vercel and `--help` never take one. Fail-open: only a full house
 * (NativeStackLimitError) stops the build; any other failure (no `ps`, an
 * unwritable lock folder, an invalid setting) warns and lets it run.
 */
export async function acquireBuildPlace(
  environment: Readonly<Record<string, string | undefined>>,
  args: readonly string[],
  overrides: Partial<AcquireNativeStackSlotOptions> = {}
): Promise<NativeStackSlot | undefined> {
  if (!isLocalProductionBuild(environment as NodeJS.ProcessEnv, [...args])) return undefined;
  try {
    return await acquireNativeStackSlot({
      label: "production build (next-build.mjs)",
      limit: nativeStackLimit(environment),
      waitMs: nativeStackWaitMs(environment),
      ...overrides,
    });
  } catch (error) {
    if (error instanceof NativeStackLimitError) throw error;
    console.warn(`[next-build] native place not reserved (${error instanceof Error ? error.message : String(error)}); building anyway`);
    return undefined;
  }
}
