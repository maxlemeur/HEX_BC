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
  /** build-local.mjs's manifest of this build's inputs, relative to the checkout. */
  manifest: string;
  manifestSha256: string;
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
  supervisorModulesSha256?: string;
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
  | { kind: "stale"; reason: string }
  | { kind: "foreign-checkout"; reason: string };

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

/**
 * Why `state` is not this checkout's own, or null when it is. A state copied
 * or restored from another checkout names that checkout's supervisor, socket
 * and stack: its recorded checkout must resolve to `root` itself.
 */
export function foreignCheckoutReason(state: LoopState, root: string) {
  const real = (directory: string) => { try { return fs.realpathSync.native(directory); } catch { return null; } };
  const recorded = path.isAbsolute(state.checkout) ? real(state.checkout) : null;
  return recorded !== null && recorded === real(root) ? null
    : `the dev-loop state records checkout ${state.checkout}, not this checkout (${root}); it was copied or restored from another checkout`;
}

/** The classification `start`, `run`, `stop` and `status` act on: nothing of a foreign state is probed. */
export function inspectLoopState(state: LoopState | null, root: string, now: number): LoopClassification {
  if (!state) return { kind: "absent" };
  const reason = foreignCheckoutReason(state, root);
  if (reason) return { kind: "foreign-checkout", reason };
  return classifyLoopState(state, probeSupervisor(state.supervisor.pid, root), now);
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
  /** The build's recorded manifest still exists with its recorded digest. */
  buildManifestIntact: boolean;
}): { rebuild: boolean; reason: string } {
  if (!input.built) return { rebuild: true, reason: "no production build yet" };
  if (input.buildIdOnDisk === null) return { rebuild: true, reason: "the production build output is missing" };
  if (input.buildIdOnDisk !== input.built.buildId) {
    return { rebuild: true, reason: "the production build was replaced by another run in this checkout" };
  }
  // Every iteration retains the manifest of the build it runs on (its inputs).
  if (!input.buildManifestIntact) {
    return { rebuild: true, reason: `the manifest of build ${input.built.buildId} is missing or changed` };
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

export const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** The bytes of `build`'s recorded manifest, or null once it is missing or no longer matches its digest. */
export function readBuildManifest(root: string, build: Pick<LoopBuild, "manifest" | "manifestSha256">) {
  let bytes: Buffer;
  try { bytes = fs.readFileSync(path.join(root, build.manifest)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  return sha256(bytes) === build.manifestSha256 ? bytes : null;
}

/** What the owned stack was built from: migrations and config.toml, applied once at start. */
export async function stackInputsDigest(root: string) {
  const migrations = await sqlInventory(path.join(root, "supabase/migrations"));
  const config = createHash("sha256").update(fs.readFileSync(path.join(root, "supabase/config.toml"))).digest("hex");
  return createHash("sha256").update(JSON.stringify({ migrations, config })).digest("hex");
}

/**
 * Whether the recorded workdir is the stack this loop prepared: its isolated
 * config carries the recorded project ID, which names the recorded supervisor.
 * Anything else (a corrupted or foreign state) is never destroyed.
 */
export function ownsRecordedProject(state: LoopState) {
  if (!state.stack || !state.stack.projectId.startsWith(`miaouffrage-ci-${state.supervisor.pid}-`)) return false;
  try {
    return fs.readFileSync(path.join(state.stack.rootDirectory, "supabase", "config.toml"), "utf8")
      .split(/\r?\n/).includes(`project_id = "${state.stack.projectId}"`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
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

// A host without IPv6 loopback cannot listen on ::1 either.
const NO_IPV6_LOOPBACK = new Set(["EADDRNOTAVAIL", "EAFNOSUPPORT", "ENETUNREACH"]);

/** Ports among `ports` that still accept a connection on the loopback `host`. */
export async function listeningPorts(ports: readonly number[], host = "127.0.0.1") {
  const results = await Promise.all(ports.map((port) => new Promise<number | null>((resolve) => {
    const socket = net.connect({ host, port });
    const done = (listening: boolean) => { socket.destroy(); resolve(listening ? port : null); };
    socket.setTimeout(2_000, () => done(true));
    socket.once("connect", () => done(true));
    // Anything but a refusal leaves the port unproven: report it.
    socket.once("error", (error: NodeJS.ErrnoException) =>
      done(error.code !== "ECONNREFUSED" && !(host === "::1" && NO_IPV6_LOOPBACK.has(error.code ?? ""))));
  })));
  return results.filter((port): port is number => port !== null);
}

/** Ports still listening on any of `hosts` after up to ten one-second retries. */
export async function waitForClosedPorts(ports: readonly number[], hosts: readonly string[] = ["127.0.0.1"]) {
  const probe = async () => [...new Set((await Promise.all(hosts.map((host) => listeningPorts(ports, host)))).flat())].sort((a, b) => a - b);
  let listening = await probe();
  for (let attempt = 0; listening.length && attempt < 10; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    listening = await probe();
  }
  return listening;
}

/** Where the native runtime registers its stacks (`__supabase_stack_host__ ~/.supabase/stacks`). */
export const SUPABASE_STACK_REGISTRY = path.join(os.homedir(), ".supabase", "stacks");

export interface RegisteredStack {
  /** The registry directory name, which is the native stack id. */
  id: string;
  directory: string;
  /** The API port the stack registered, or null when it registered none. */
  apiPort: number | null;
}

const errorCode = (error: unknown) => (error as NodeJS.ErrnoException).code ?? (error instanceof SyntaxError ? "malformed JSON" : "unknown error");

/**
 * The native registry entry of the stack started with `--workdir rootDirectory`,
 * and every entry whose identity could not be read. The entry outlives its
 * workdir (a WSL restart empties /tmp) and holds the stack's data. Only
 * `identity.projectRoot` and the `api` port are read; the entry's credentials
 * never leave its state.json. An entry directory whose state.json is missing,
 * unreadable, malformed or without a project root may be that stack: it is
 * reported, never skipped. Plain files (the registry lock) are not entries.
 */
export function inspectRegistry(rootDirectory: string, registry = SUPABASE_STACK_REGISTRY) {
  const unreadable: string[] = [];
  let names: string[];
  try { names = fs.readdirSync(registry); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { registered: null, unreadable };
    return { registered: null, unreadable: [`${registry} (${errorCode(error)})`] };
  }
  const wanted = path.resolve(rootDirectory);
  for (const name of names.sort()) {
    const directory = path.join(registry, name);
    let isDirectory: boolean;
    try { isDirectory = fs.statSync(directory).isDirectory(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; // removed meanwhile
      unreadable.push(`${name} (${errorCode(error)})`);
      continue;
    }
    if (!isDirectory) continue;
    let entry: { identity?: { projectRoot?: unknown }; ports?: unknown } | null;
    try { entry = JSON.parse(fs.readFileSync(path.join(directory, "state.json"), "utf8")); }
    catch (error) {
      // Removed by its own `stack destroy` meanwhile: no longer an entry.
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !fs.existsSync(directory)) continue;
      unreadable.push(`${name} (state.json: ${errorCode(error)})`);
      continue;
    }
    const projectRoot = entry?.identity?.projectRoot;
    if (typeof projectRoot !== "string") {
      unreadable.push(`${name} (state.json: no identity.projectRoot)`);
      continue;
    }
    if (path.resolve(projectRoot) !== wanted) continue;
    const api = Array.isArray(entry?.ports)
      ? (entry.ports as Array<{ key?: unknown; port?: unknown } | null>).find((port) => port?.key === "api")
      : undefined;
    return { registered: { id: name, directory, apiPort: Number.isSafeInteger(api?.port) ? api!.port as number : null }, unreadable };
  }
  return { registered: null, unreadable };
}

/** The readable native registry entry of the stack started with `--workdir rootDirectory`. */
export function findRegisteredStack(rootDirectory: string, registry = SUPABASE_STACK_REGISTRY): RegisteredStack | null {
  return inspectRegistry(rootDirectory, registry).registered;
}

/**
 * Whether a registry entry is the stack this loop recorded once its workdir
 * is gone: the recorded workdir is an owned temporary project named for the
 * recorded supervisor, and the API port the stack registered is one of the
 * ports this loop allocated to it. Anything else is never destroyed.
 */
export function ownsRegisteredStack(state: LoopState, registered: RegisteredStack) {
  const stack = state.stack;
  if (!stack || !stack.projectId.startsWith(`miaouffrage-ci-${state.supervisor.pid}-`)) return false;
  const resolved = path.resolve(stack.rootDirectory);
  const name = path.basename(resolved);
  return path.dirname(resolved) === path.resolve(os.tmpdir()) && name.startsWith(SUPABASE_PROJECT_PREFIX) &&
    name !== SUPABASE_PROJECT_PREFIX && registered.apiPort !== null && stack.ports.includes(registered.apiPort);
}

export interface StackProof { projectDirectoryRemoved: boolean; registryEntryRemoved: boolean; portsClosed: boolean; problems: string[] }

/**
 * A stack is destroyed only once its workdir, its native registry entry and
 * every recorded port are gone. A registry entry that cannot be read may be
 * that stack, so it leaves the destruction unproven; it is read once more
 * after a second, in case another session's CLI was writing it.
 */
export async function proveStackDestroyed(stack: LoopState["stack"], registry = SUPABASE_STACK_REGISTRY): Promise<StackProof> {
  const listening = await waitForClosedPorts(stack?.ports ?? []);
  const projectDirectoryRemoved = !stack || !fs.existsSync(stack.rootDirectory);
  let scan = stack ? inspectRegistry(stack.rootDirectory, registry) : { registered: null, unreadable: [] as string[] };
  if (stack && !scan.registered && scan.unreadable.length) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    scan = inspectRegistry(stack.rootDirectory, registry);
  }
  const { registered, unreadable } = scan;
  const problems = [
    ...(projectDirectoryRemoved ? [] : ["project directory remains"]),
    ...(registered ? [`native registry entry ${registered.id} remains (stack data kept)`] : []),
    ...unreadable.map((entry) => `native registry entry ${entry} is unreadable, so it may be this stack: cleanup unproven`),
    ...(listening.length ? [`ports still listening: ${listening.join(", ")}`] : []),
  ];
  return { projectDirectoryRemoved, registryEntryRemoved: !registered && unreadable.length === 0, portsClosed: listening.length === 0, problems };
}

export interface LoopClosureProof extends StackProof { appPortClosed: boolean }

/** The `next start` port of the loop, from its recorded origin; null when unreadable. */
export function loopAppPort(appOrigin: unknown) {
  try {
    const url = new URL(String(appOrigin));
    const port = Number(url.port);
    return url.hostname === "localhost" && Number.isSafeInteger(port) && port >= 1024 && port <= 65535 ? port : null;
  } catch { return null; }
}

/**
 * A loop is closed once its stack is destroyed and its application port is
 * closed on both loopbacks: after a SIGKILL during an iteration, the journey
 * process and its `next start` can outlive the supervisor there.
 */
export async function proveLoopClosed(state: Pick<LoopState, "stack" | "appOrigin">, registry = SUPABASE_STACK_REGISTRY): Promise<LoopClosureProof> {
  const appPort = loopAppPort(state.appOrigin);
  const [stack, appListening] = await Promise.all([
    proveStackDestroyed(state.stack, registry),
    appPort === null ? Promise.resolve(null) : waitForClosedPorts([appPort], ["127.0.0.1", "::1"]),
  ]);
  const appPortClosed = appListening !== null && appListening.length === 0;
  const problem = appPort === null
    ? `application port unknown (appOrigin ${String(state.appOrigin).slice(0, 64)}): its closure is unproven`
    : `application port ${appPort} still listening: a journey or the \`next start\` of an interrupted iteration may survive; stop again once it has closed`;
  return { ...stack, appPortClosed, problems: [...stack.problems, ...(appPortClosed ? [] : [problem])] };
}

export const DEV_LOOP_ARCHIVE_MARKER = "dev-loop-iteration.json";

/**
 * Marks the raw SDK archive of an iteration's critical run
 * (.e2e/army/critical/runs/<stamp>/, shared with qualifying runs) as a
 * non-qualification run. Null when no fresh SDK run exists since the
 * iteration's campaign started; returns the marker path relative to `root`.
 */
export function markIterationArchive(root: string, iteration: { campaignStartedAt: unknown; loopId: string; index: number; manifest: string }) {
  const output = path.join(root, ".e2e/army/critical");
  const current = path.join(output, "manifest.json");
  const started = Date.parse(String(iteration.campaignStartedAt));
  if (!Number.isFinite(started) || !fs.existsSync(current) || fs.statSync(current).mtimeMs < started) return null;
  const sdk = JSON.parse(fs.readFileSync(current, "utf8")) as { archive?: { path?: unknown }; failureArchive?: { status?: unknown; path?: unknown } };
  const archive = sdk.failureArchive?.status === "retained" ? sdk.failureArchive : sdk.archive;
  if (typeof archive?.path !== "string") return null;
  const directory = path.resolve(root, archive.path);
  const relative = path.relative(output, directory);
  if (!relative.startsWith(`runs${path.sep}`) || relative.split(path.sep).includes("..") || !fs.statSync(directory).isDirectory()) {
    throw new Error("An iteration's SDK archive must remain inside .e2e/army/critical/runs.");
  }
  const marker = path.join(directory, DEV_LOOP_ARCHIVE_MARKER);
  fs.writeFileSync(marker, `${JSON.stringify({
    schemaVersion: "army-dev-loop-iteration-marker-1", scope: DEV_LOOP_ITERATION_SCOPE, qualification: false,
    loopId: iteration.loopId, iteration: iteration.index, iterationManifest: iteration.manifest,
  }, null, 2)}\n`, { flag: "wx" });
  return path.relative(root, marker).replaceAll("\\", "/");
}

// Static and dynamic module references; group 1 marks a type-only import, erased at run time.
const MODULE_REFERENCE = /(?:^|[\n;])\s*(?:import|export)\s+(type\s+)?(?:[^;"'`]*?\sfrom\s*)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

/**
 * The supervisor's entry and every local module it imports, transitively, as
 * checkout-relative paths: the code whose checks an iteration applies, loaded
 * once when the supervisor started. Package imports are not followed.
 */
export function supervisorModules(root: string) {
  const seen = new Set<string>();
  const pending = [DEV_LOOP_SUPERVISOR_ENTRY];
  while (pending.length) {
    const file = pending.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of fs.readFileSync(path.join(root, file), "utf8").matchAll(MODULE_REFERENCE)) {
      if (match[1]) continue;
      const specifier = match[2] ?? match[3];
      const base = specifier.startsWith("@/") ? `src/${specifier.slice(2)}`
        : specifier.startsWith(".") ? path.posix.join(path.posix.dirname(file), specifier) : null;
      if (base === null) continue;
      const resolved = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", "/index.ts"].map((suffix) => path.posix.normalize(`${base}${suffix}`))
        .find((candidate) => fs.statSync(path.join(root, candidate), { throwIfNoEntry: false })?.isFile());
      if (!resolved) throw new Error(`The dev-loop supervisor's ${file} imports ${specifier}, which does not resolve.`);
      pending.push(resolved);
    }
  }
  return [...seen].sort();
}

/** Content digest of supervisorModules(root). */
export function supervisorModulesDigest(root: string) {
  const hash = createHash("sha256");
  for (const file of supervisorModules(root)) {
    hash.update(`${file}\0`).update(fs.readFileSync(path.join(root, file))).update("\0");
  }
  return hash.digest("hex");
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
    BROWSER_RESTRICTED_LOCAL_PORTS.has(Number(port)) || CALC_V3_FORBIDDEN_PORTS.has(String(Number(port)))) {
    throw new Error("--app-port must be an unrestricted local port from 1024 to 65535, never a shared-stack port.");
  }
  if (!/^[0-9]+$/.test(ttl) || Number(ttl) < DEV_LOOP_TTL_RANGE[0] || Number(ttl) > DEV_LOOP_TTL_RANGE[1]) {
    throw new Error(`--ttl-minutes must be an integer from ${DEV_LOOP_TTL_RANGE[0]} to ${DEV_LOOP_TTL_RANGE[1]}.`);
  }
  return { action: "start", appPort: Number(port), ttlMinutes: Number(ttl) };
}
