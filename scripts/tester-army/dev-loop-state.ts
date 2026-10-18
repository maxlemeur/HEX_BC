import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { BROWSER_RESTRICTED_LOCAL_PORTS } from "../../src/test/local-supabase-ci";
import { CALC_V3_FORBIDDEN_PORTS } from "./calc-v3-phases";
import { sqlInventory } from "./local-recipe-common.mjs";

// Bookkeeping of the opt-in iteration loop (`npm run e2e:army:dev-loop`).
// Contract and failure modes: docs/testing/tester-army-local-development.md
// and src/test/army-dev-loop.test.ts. Nothing here is a qualification run.

export const DEV_LOOP_STATE_SCHEMA = "army-dev-loop-state-1";
export const DEV_LOOP_STATE_FILE = ".e2e/army/dev-loop/state.json";
export const DEV_LOOP_SUPERVISOR_ENTRY = "scripts/run-tester-army-ci.ts";
export const DEV_LOOP_SESSION_SCOPE = "dev-loop session (reused stack, not a qualification run)";
export const DEV_LOOP_ITERATION_SCOPE = "iteration (reused stack, not a qualification run)";
export const DEV_LOOP_SOCKET_PREFIX = "miaouffrage-army-loop-";
export const SUPABASE_PROJECT_PREFIX = "miaouffrage-supabase-ci-";
export const DEFAULT_DEV_LOOP_TTL_MINUTES = 60;
export const DEV_LOOP_TTL_RANGE = [5, 720] as const;

const LOOP_STATUSES = ["starting", "ready", "running", "stopping", "cleanup-failed"] as const;
export type LoopStatus = (typeof LOOP_STATUSES)[number];

export interface LoopBuild {
  appSourceSha256: string;
  buildId: string;
  builtAt: string;
  count: number;
}

export interface LoopState {
  schemaVersion: typeof DEV_LOOP_STATE_SCHEMA;
  loopId: string;
  status: LoopStatus;
  checkout: string;
  supervisor: { pid: number };
  appOrigin: string;
  ttlMinutes: number;
  startedAt: string;
  lastActivityAt: string;
  /** Idle deadline; null while starting or while an iteration runs. */
  expiresAt: string | null;
  /** Session evidence directory, relative to the checkout. */
  evidence: string;
  stack?: { projectId: string; rootDirectory: string; ports: number[] };
  stackInputsSha256?: string;
  socket?: string;
  readyAt?: string;
  build?: LoopBuild;
  iterations: number;
  lastIteration?: { index: number; status: string; evidence: string; seconds: number; rebuilt: boolean };
  error?: string;
}

const SECRET_KEY = /password|secret|token|cookie|authorization|service.?role|anon.?key|api.?key|credential/i;
const SECRET_VALUE = [
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  /sb_(?:secret|publishable)_/,
  /postgres(?:ql)?:\/\//i,
  /Bearer\s+\S/i,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/,
];

/** The state file and the loop manifests hold identities and digests only. */
export function assertNoSecrets(value: unknown) {
  const visit = (node: unknown) => {
    if (typeof node === "string") {
      if (SECRET_VALUE.some((pattern) => pattern.test(node))) throw new Error("Dev-loop state refuses a secret-like value.");
      return;
    }
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (SECRET_KEY.test(key)) throw new Error(`Dev-loop state refuses a secret-like key (${key.slice(0, 32)}).`);
        visit(child);
      }
    }
  };
  visit(value);
}

function validateLoopState(value: unknown): LoopState {
  const state = value as Partial<LoopState> | null;
  if (!state || state.schemaVersion !== DEV_LOOP_STATE_SCHEMA || typeof state.loopId !== "string" ||
    !LOOP_STATUSES.includes(state.status as LoopStatus) || typeof state.checkout !== "string" ||
    !Number.isSafeInteger(state.supervisor?.pid) || (state.supervisor?.pid ?? 0) <= 0 ||
    typeof state.evidence !== "string" || typeof state.startedAt !== "string") {
    throw new Error("Unrecognised dev-loop state; inspect it before removing it by hand.");
  }
  return state as LoopState;
}

function serialize(state: LoopState) {
  validateLoopState(state);
  assertNoSecrets(state);
  return `${JSON.stringify(state, null, 2)}\n`;
}

/** Exclusive claim: a second supervisor on the same checkout fails here. */
export function createLoopState(file: string, state: LoopState) {
  const bytes = serialize(state);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`A dev-loop state already exists (${DEV_LOOP_STATE_FILE}); run \`npm run e2e:army:dev-loop -- status\` or \`-- stop\`.`);
    }
    throw error;
  }
}

/** Atomic replacement, validated before any byte reaches the file. */
export function writeLoopState(file: string, state: LoopState) {
  const bytes = serialize(state);
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, bytes, { mode: 0o600 });
  fs.renameSync(temporary, file);
}

export function readLoopState(file: string): LoopState | null {
  let text: string;
  try { text = fs.readFileSync(file, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new Error("Unreadable dev-loop state; inspect it before removing it by hand."); }
  return validateLoopState(parsed);
}

export class LoopStateStore {
  private constructor(readonly file: string, private state: LoopState) {}

  static claim(file: string, state: LoopState) {
    createLoopState(file, state);
    return new LoopStateStore(file, state);
  }

  get current() { return this.state; }

  update(patch: Partial<LoopState>) {
    const next = { ...this.state, ...patch };
    writeLoopState(this.file, next);
    this.state = next;
  }

  release() { fs.rmSync(this.file, { force: true }); }
}

export type SupervisorProbe = "owned" | "dead" | "foreign";

/**
 * Whether `pid` is this checkout's loop supervisor. A recycled pid, a zombie
 * or the same command in another checkout is not.
 */
export function probeSupervisor(pid: number, checkout: string): SupervisorProbe {
  try { process.kill(pid, 0); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH") return "dead";
    if (code === "EPERM") return "foreign";
    throw error;
  }
  let argv: string[];
  let cwd: string | undefined;
  if (process.platform === "linux") {
    try {
      argv = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
      cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
    } catch { return "dead"; }
  } else if (process.platform === "darwin") {
    const ps = spawnSync("/bin/ps", ["-o", "command=", "-p", String(pid)], { encoding: "utf8", timeout: 5_000 });
    argv = ps.status === 0 ? ps.stdout.trim().split(/\s+/).filter(Boolean) : [];
    const lsof = spawnSync("/usr/sbin/lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], { encoding: "utf8", timeout: 5_000 });
    cwd = lsof.status === 0 ? lsof.stdout.split("\n").find((line) => line.startsWith("n"))?.slice(1) : undefined;
  } else {
    throw new Error("The dev loop runs only where the Supabase native runtime runs (Linux or macOS).");
  }
  if (argv.length === 0) return "dead";
  const entry = argv.findIndex((word) => word === DEV_LOOP_SUPERVISOR_ENTRY || word.endsWith(`/${DEV_LOOP_SUPERVISOR_ENTRY}`));
  const sameCheckout = cwd !== undefined && path.resolve(cwd) === path.resolve(checkout);
  return entry >= 0 && argv[entry + 1] === "dev-loop" && sameCheckout ? "owned" : "foreign";
}

export type LoopClassification =
  | { kind: "absent" }
  | { kind: "live"; expired: boolean }
  | { kind: "stale"; reason: string };

/** Only an owned, running supervisor makes a loop live; its TTL is only reported. */
export function classifyLoopState(state: LoopState | null, probe: SupervisorProbe | null, now: number): LoopClassification {
  if (!state) return { kind: "absent" };
  if (probe === "owned") {
    const deadline = state.expiresAt ? Date.parse(state.expiresAt) : Number.NaN;
    return { kind: "live", expired: state.status === "ready" && Number.isFinite(deadline) && now > deadline + 60_000 };
  }
  return {
    kind: "stale",
    reason: probe === "foreign"
      ? `pid ${state.supervisor.pid} now runs another process`
      : `supervisor ${state.supervisor.pid} is no longer running`,
  };
}

type SourceInput = { path: string; sha256?: string; missing?: boolean };

/**
 * Digest of the production build inputs exactly as build-local.mjs records
 * them (buildSourceEvidence().inputs): sources only, never the revision or
 * the diff, so a journey-only commit or edit leaves it unchanged.
 */
export function applicationSourceDigest(inputs: ReadonlyArray<SourceInput>) {
  const normalized = inputs.map((input) => input.missing ? { path: input.path, missing: true } : { path: input.path, sha256: input.sha256 })
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function decideRebuild(input: {
  built: Pick<LoopBuild, "appSourceSha256" | "buildId"> | undefined;
  appSourceSha256: string;
  buildIdOnDisk: string | null;
}): { rebuild: boolean; reason: string } {
  if (!input.built) return { rebuild: true, reason: "no production build yet" };
  if (input.buildIdOnDisk === null) return { rebuild: true, reason: "the production build output is missing" };
  if (input.buildIdOnDisk !== input.built.buildId) {
    return { rebuild: true, reason: "the production build was replaced by another run in this checkout" };
  }
  if (input.appSourceSha256 !== input.built.appSourceSha256) {
    return { rebuild: true, reason: "application sources changed since the last build" };
  }
  return { rebuild: false, reason: `application sources unchanged since build ${input.built.buildId}` };
}

export function readBuildId(root: string) {
  try { return fs.readFileSync(path.join(root, ".e2e/army/next/BUILD_ID"), "utf8").trim() || null; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

/** What the owned stack was built from: migrations and config.toml, applied once at start. */
export async function stackInputsDigest(root: string) {
  const migrations = await sqlInventory(path.join(root, "supabase/migrations"));
  const config = createHash("sha256").update(fs.readFileSync(path.join(root, "supabase/config.toml"))).digest("hex");
  return createHash("sha256").update(JSON.stringify({ migrations, config })).digest("hex");
}

/** Removes a directory this loop created under the temporary directory, nothing else. */
export function removeOwnedTemporaryDirectory(directory: string, prefix: string) {
  const resolved = path.resolve(directory);
  const temporary = path.resolve(os.tmpdir());
  if (path.dirname(resolved) !== temporary || !path.basename(resolved).startsWith(prefix) || path.basename(resolved) === prefix) {
    throw new Error(`Refusing to remove ${resolved}: not an owned ${prefix}* temporary directory.`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

/** Ports among `ports` that still accept a loopback connection. */
export async function listeningPorts(ports: readonly number[]) {
  const results = await Promise.all(ports.map((port) => new Promise<number | null>((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (listening: boolean) => { socket.destroy(); resolve(listening ? port : null); };
    socket.setTimeout(2_000, () => done(true));
    socket.once("connect", () => done(true));
    // Anything but a refusal leaves the port unproven: report it.
    socket.once("error", (error: NodeJS.ErrnoException) => done(error.code !== "ECONNREFUSED"));
  })));
  return results.filter((port): port is number => port !== null);
}

export type DevLoopCommand =
  | { action: "start"; appPort: number; ttlMinutes: number }
  | { action: "run"; grep?: string; files: string[] }
  | { action: "stop" }
  | { action: "status" };

const JOURNEY_FILE = /^e2e\/army\/(?:critical|local)\/[A-Za-z0-9][A-Za-z0-9._-]*\.e2e\.ts$/;

/** Same selection rules as `run-tester-army-ci.ts critical`, and one is required. */
export function assertJourneySelection(selection: { grep?: unknown; files?: unknown }, fileExists: (file: string) => boolean) {
  const grep = selection.grep;
  const files = selection.files ?? [];
  if (!Array.isArray(files) || files.some((file) => typeof file !== "string")) throw new Error("--files lists journey paths.");
  if ((grep === undefined) === (files.length === 0)) throw new Error("A loop run selects journeys with exactly one --grep or --files.");
  if (grep !== undefined) {
    if (typeof grep !== "string" || !grep.trim()) throw new Error("--grep requires a test-title pattern.");
    new RegExp(grep);
    return { grep, files: [] as string[] };
  }
  if (new Set(files).size !== files.length || files.some((file) => !JOURNEY_FILE.test(file) || !fileExists(file))) {
    throw new Error("--files lists distinct existing e2e/army/critical or e2e/army/local *.e2e.ts paths, comma-separated.");
  }
  return { files: files as string[] };
}

export function parseDevLoopArguments(argv: readonly string[], fileExists: (file: string) => boolean = fs.existsSync): DevLoopCommand {
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  const action = args[0];
  const allowed: Record<string, string[]> = { start: ["--app-port", "--ttl-minutes"], run: ["--grep", "--files"], stop: [], status: [] };
  if (!action || !(action in allowed)) {
    throw new Error("Usage: npm run e2e:army:dev-loop -- start [--app-port PORT] [--ttl-minutes N] | run --grep PATTERN | run --files A.e2e.ts,B.e2e.ts | stop | status");
  }
  const options = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (!allowed[action].includes(option) || options.has(option) || value === undefined || value.startsWith("--")) {
      throw new Error(`${action} accepts ${allowed[action].join(", ") || "no option"}, each once with an explicit value.`);
    }
    options.set(option, value);
  }
  if (action === "stop" || action === "status") return { action };
  if (action === "run") {
    const files = options.has("--files") ? options.get("--files")!.split(",") : [];
    return { action, ...assertJourneySelection({ grep: options.get("--grep"), files }, fileExists) };
  }
  const port = options.get("--app-port") ?? "3107";
  const ttl = options.get("--ttl-minutes") ?? String(DEFAULT_DEV_LOOP_TTL_MINUTES);
  if (!/^[0-9]+$/.test(port) || Number(port) < 1024 || Number(port) > 65535 ||
    BROWSER_RESTRICTED_LOCAL_PORTS.has(Number(port)) || CALC_V3_FORBIDDEN_PORTS.has(port)) {
    throw new Error("--app-port must be an unrestricted local port from 1024 to 65535, never a shared-stack port.");
  }
  if (!/^[0-9]+$/.test(ttl) || Number(ttl) < DEV_LOOP_TTL_RANGE[0] || Number(ttl) > DEV_LOOP_TTL_RANGE[1]) {
    throw new Error(`--ttl-minutes must be an integer from ${DEV_LOOP_TTL_RANGE[0]} to ${DEV_LOOP_TTL_RANGE[1]}.`);
  }
  return { action: "start", appPort: Number(port), ttlMinutes: Number(ttl) };
}
