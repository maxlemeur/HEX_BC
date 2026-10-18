import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSupabaseCli } from "../../src/test/supabase-cli";
import {
  applicationSourceDigest, assertJourneySelection, classifyLoopState, decideRebuild, DEV_LOOP_ITERATION_SCOPE,
  DEV_LOOP_SOCKET_PREFIX, DEV_LOOP_STATE_FILE, DEV_LOOP_SUPERVISOR_ENTRY, type DevLoopCommand, findRegisteredStack,
  type LoopBuild, type LoopState, type LoopStateStore, markIterationArchive, ownsRecordedProject, ownsRegisteredStack,
  parseDevLoopArguments, probeSupervisor, proveStackDestroyed, readBuildId, readLoopState, removeOwnedTemporaryDirectory,
  stackInputsDigest, SUPABASE_PROJECT_PREFIX, SUPABASE_STACK_REGISTRY, supervisorModulesDigest, writeLoopState,
} from "./dev-loop-state";
import { buildSourceEvidence } from "./local-recipe-common.mjs";

// Opt-in iteration loop for TesterArmy journeys (docs/testing/tester-army-local-development.md).
// `start` launches `run-tester-army-ci.ts dev-loop` detached: one owned native
// stack, migrations, pgTAP and the RLS matrix once, one ARMY account and one
// production build. Each `run` asks that supervisor, over a private socket, to
// run the selected critical journeys with the checks of a critical run,
// rebuilding first only when the build inputs changed. Secrets never leave the
// supervisor's memory. An iteration is never a qualification run.

export interface DevLoopRunContext {
  evidence: string;
  manifest: Record<string, unknown>;
  grep?: string;
  files: string[];
}

export interface DevLoopSessionInput {
  root: string;
  store: LoopStateStore;
  signal: AbortSignal;
  ttlMinutes: number;
  sessionEvidence: string;
  sessionManifest: Record<string, unknown>;
  redact: (value: string) => string;
  /** build-local.mjs --execute, its log and step recorded in the context. */
  build: (context: DevLoopRunContext) => Promise<void>;
  /** The critical journeys with every check of `run-tester-army-ci.ts critical`. */
  journeys: (context: DevLoopRunContext) => Promise<void>;
  /** Privacy check, file inventory and manifest of the context's evidence. */
  finalize: (context: DevLoopRunContext) => void;
}

type Message = { type: "log"; line: string } | ({ type: "result" } & Record<string, unknown>);

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const secondsSince = (start: number) => Math.round((Date.now() - start) / 100) / 10;
const relativeTo = (root: string, file: string) => path.relative(root, file).replaceAll("\\", "/");

/** Builds once and identifies the result by build-local's own recorded inputs. */
async function buildApplication(input: DevLoopSessionInput, context: DevLoopRunContext, previous?: LoopBuild) {
  const startedAt = Date.now();
  await input.build(context);
  const builds = path.join(input.root, ".e2e/army/recipes/builds");
  const manifests = (fs.existsSync(builds) ? fs.readdirSync(builds) : [])
    .map((name) => path.join(builds, name, "manifest.json"))
    .filter((file) => fs.existsSync(file) && fs.statSync(file).mtimeMs >= startedAt - 1_000)
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);
  const manifest = manifests[0] ? JSON.parse(fs.readFileSync(manifests[0], "utf8")) as Record<string, unknown> : undefined;
  const buildId = readBuildId(input.root);
  if (!manifest || !buildId || manifest.buildId !== buildId || manifest.sourceChangedDuringBuild !== false || !Array.isArray(manifest.inputs)) {
    throw new Error("The Army production build does not match a manifest of its own inputs.");
  }
  const build: LoopBuild = {
    appSourceSha256: applicationSourceDigest(manifest.inputs as Array<{ path: string; sha256?: string; missing?: boolean }>),
    buildId, builtAt: new Date().toISOString(), count: (previous?.count ?? 0) + 1,
  };
  input.store.update({ build });
  return { build, manifest: relativeTo(input.root, manifests[0]), seconds: secondsSince(startedAt) };
}

/**
 * Runs inside the supervisor's application hook, after SQL, pgTAP, RLS and the
 * ARMY provisioning: returns when stopped, so the caller destroys the stack.
 */
export async function runDevLoopSession(input: DevLoopSessionInput) {
  const sessionContext: DevLoopRunContext = { evidence: input.sessionEvidence, manifest: input.sessionManifest, files: [] };
  const summary: Record<string, unknown> & { iterations: unknown[] } = { ttlMinutes: input.ttlMinutes, iterations: [] };
  if (input.signal.aborted) return { ...summary, stopReason: String(input.signal.reason) };
  const initial = await buildApplication(input, sessionContext);
  let build = initial.build;
  summary.initialBuild = { buildId: build.buildId, seconds: initial.seconds, manifest: initial.manifest };
  if (input.signal.aborted) return { ...summary, stopReason: String(input.signal.reason) };

  const stop = new AbortController();
  const onSignal = () => stop.abort(String(input.signal.reason ?? "signal"));
  input.signal.addEventListener("abort", onSignal, { once: true });
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let busy = false;
  const readyPatch = (): Partial<LoopState> => {
    const now = Date.now();
    return {
      status: "ready", lastActivityAt: new Date(now).toISOString(),
      expiresAt: new Date(now + input.ttlMinutes * 60_000).toISOString(),
    };
  };
  const armIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stop.abort("ttl-expired"), input.ttlMinutes * 60_000);
  };
  // After a run: the TTL is armed before the bookkeeping write, which never
  // throws from here, so a failed write cannot disarm the TTL or replace the
  // iteration's result.
  const ready = () => {
    armIdleTimer();
    try { input.store.update(readyPatch()); }
    catch (error) {
      console.error(`Dev loop: could not record its ready state (${input.redact(error instanceof Error ? error.message : String(error))}); the idle TTL still applies.`);
    }
  };

  async function iterate(selection: { grep?: string; files: string[] }, command: string[] | null, notify: (line: string) => void) {
    const index = input.store.current.iterations + 1;
    const started = Date.now();
    const evidence = path.join(input.sessionEvidence, "iterations",
      `${String(index).padStart(3, "0")}-${new Date(started).toISOString().replace(/[:.]/g, "-")}`);
    fs.mkdirSync(evidence, { recursive: true });
    const session = input.sessionManifest;
    const manifest: Record<string, unknown> = {
      schemaVersion: "army-native-ci-1",
      suite: "dev-loop",
      scope: DEV_LOOP_ITERATION_SCOPE,
      qualification: false,
      startedAt: new Date(started).toISOString(),
      command,
      supervisorCommand: session.command,
      node: process.version,
      platform: process.platform,
      appOrigin: session.appOrigin,
      workers: session.workers,
      ...(selection.grep ? { grep: selection.grep } : { journeyFiles: selection.files }),
      loop: {
        loopId: input.store.current.loopId, iteration: index, session: relativeTo(input.root, input.sessionEvidence),
        stackStartedAt: session.startedAt, readyAt: input.store.current.readyAt, project: input.store.current.stack?.projectId,
        supervisorModulesSha256: input.store.current.supervisorModulesSha256,
      },
      fixtures: session.fixtures,
      database: {
        provenance: (session.database as { provenance?: unknown } | undefined)?.provenance ?? null,
        checks: "migrations, pgTAP and the RLS matrix ran once, at loop start",
        stackInputsSha256: input.store.current.stackInputsSha256,
      },
      status: "preparing",
      steps: [],
    };
    const context: DevLoopRunContext = { evidence, manifest, grep: selection.grep, files: selection.files };
    const timings: Record<string, number> = {};
    let rebuilt = false;
    try {
      if (await stackInputsDigest(input.root) !== input.store.current.stackInputsSha256) {
        throw new Error("Migrations or supabase/config.toml changed since the loop started: stop the loop and start it again.");
      }
      // The checks below are the modules this supervisor loaded at start.
      if (supervisorModulesDigest(input.root) !== input.store.current.supervisorModulesSha256) {
        throw new Error(`The dev-loop supervisor's own modules (${DEV_LOOP_SUPERVISOR_ENTRY} and its local imports) changed since the loop started, so its checks are those of the start: stop the loop and start it again.`);
      }
      const source = await buildSourceEvidence();
      const appSourceSha256 = applicationSourceDigest(source.inputs);
      const decision = decideRebuild({ built: build, appSourceSha256, buildIdOnDisk: readBuildId(input.root) });
      manifest.source = { revision: source.revision, diffSha256: source.diffSha256, appSourceSha256 };
      manifest.build = { rebuilt: decision.rebuild, reason: decision.reason, previousBuildId: build.buildId };
      timings.sourceCheckSeconds = secondsSince(started);
      notify(`Iteration ${index}: ${decision.rebuild ? "rebuilding" : "no rebuild"}, ${decision.reason}.`);
      if (decision.rebuild) {
        const rebuild = await buildApplication(input, context, build);
        build = rebuild.build;
        rebuilt = true;
        timings.buildSeconds = rebuild.seconds;
        Object.assign(manifest.build as Record<string, unknown>, { buildManifest: rebuild.manifest });
      } else {
        timings.buildSeconds = 0;
      }
      Object.assign(manifest.build as Record<string, unknown>, { buildId: build.buildId, appSourceSha256: build.appSourceSha256 });
      notify(`Iteration ${index}: running the selected critical journeys (${selection.grep ? `--grep ${selection.grep}` : `--files ${selection.files.join(",")}`}).`);
      const journeysStarted = Date.now();
      let journeyError: unknown;
      try { await input.journeys(context); } catch (error) { journeyError = error; }
      timings.journeysSeconds = secondsSince(journeysStarted);
      // The SDK archive of this run sits next to qualifying ones: mark it.
      try {
        manifest.sdkArchiveMarker = markIterationArchive(input.root, {
          campaignStartedAt: manifest.campaignStartedAt, loopId: input.store.current.loopId, index,
          manifest: relativeTo(input.root, path.join(evidence, "manifest.json")),
        });
      } catch (error) {
        if (!journeyError) throw error;
        manifest.sdkArchiveMarkerError = input.redact(error instanceof Error ? error.message : String(error));
      }
      if (journeyError) throw journeyError;
      manifest.status = "passed";
    } catch (error) {
      manifest.status = "failed";
      manifest.error = input.redact(error instanceof Error ? error.message : String(error));
    } finally {
      manifest.finishedAt = new Date().toISOString();
      timings.totalSeconds = secondsSince(started);
      manifest.timings = timings;
      input.finalize(context);
    }
    const manifestPath = relativeTo(input.root, path.join(evidence, "manifest.json"));
    input.store.update({
      iterations: index,
      lastIteration: { index, status: String(manifest.status), evidence: manifestPath, seconds: timings.totalSeconds, rebuilt },
    });
    summary.iterations.push({ index, status: manifest.status, rebuilt, seconds: timings.totalSeconds, evidence: manifestPath });
    console.log(`Dev loop iteration ${index} ${manifest.status} in ${timings.totalSeconds} s; evidence: ${manifestPath}`);
    const phase = (manifest.phases as Array<{ result?: unknown }> | undefined)?.find((entry) => entry.result);
    return {
      status: manifest.status, iteration: index, rebuilt, buildId: build.buildId,
      reason: (manifest.build as { reason?: string } | undefined)?.reason, timings,
      summary: phase?.result ?? null, evidence: manifestPath, scope: DEV_LOOP_ITERATION_SCOPE,
      ...(manifest.error ? { error: manifest.error } : {}),
    };
  }

  // Exactly one result per request; busy is reset and the TTL re-armed on every path.
  async function respond(socket: net.Socket, line: string) {
    const send = (message: Message) => { if (!socket.destroyed && socket.writable) socket.write(`${JSON.stringify(message)}\n`); };
    let result: Record<string, unknown>;
    try {
      let request: { action?: unknown; loopId?: unknown; grep?: unknown; files?: unknown; command?: unknown };
      try { request = JSON.parse(line); } catch { throw new Error("Malformed dev-loop request."); }
      if (request?.action !== "run" || request.loopId !== input.store.current.loopId) {
        throw new Error("The request does not target this dev loop.");
      }
      const selection = assertJourneySelection({ grep: request.grep, files: request.files },
        (file) => fs.existsSync(path.join(input.root, file)));
      const command = Array.isArray(request.command) && request.command.length <= 64 &&
        request.command.every((word) => typeof word === "string" && word.length <= 4_096) ? request.command as string[] : null;
      if (stop.signal.aborted) result = { status: "stopping" };
      else if (busy) result = { status: "busy", iteration: input.store.current.iterations + 1 };
      else {
        busy = true;
        clearTimeout(idleTimer);
        try {
          input.store.update({ status: "running", expiresAt: null, lastActivityAt: new Date().toISOString() });
          result = await iterate(selection, command, (text) => { console.log(text); send({ type: "log", line: text }); });
        } finally {
          busy = false;
          if (!stop.signal.aborted) ready();
        }
      }
    } catch (error) {
      result = { status: "refused", error: input.redact(error instanceof Error ? error.message : String(error)) };
    }
    send({ type: "result", ...result });
    socket.end();
  }

  const server = net.createServer((socket) => {
    let buffer = "";
    let handled = false;
    socket.setEncoding("utf8");
    socket.on("error", () => { /* The client left; the iteration keeps its own evidence. */ });
    socket.on("data", (chunk: string) => {
      if (handled) return;
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0 && buffer.length <= 65_536) return;
      handled = true;
      if (newline < 0) socket.destroy();
      else void respond(socket, buffer.slice(0, newline));
    });
  });
  // A private directory: only this account can reach the socket.
  const socketDirectory = fs.mkdtempSync(path.join(os.tmpdir(), DEV_LOOP_SOCKET_PREFIX));
  try {
    fs.chmodSync(socketDirectory, 0o700);
    const socketPath = path.join(socketDirectory, "loop.sock");
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => { server.off("error", reject); resolve(); });
    });
    fs.chmodSync(socketPath, 0o600);
    // At start a failed write fails the session, and its caller destroys the stack.
    armIdleTimer();
    input.store.update({ socket: socketPath, readyAt: new Date().toISOString(), ...readyPatch() });
    summary.readyAt = input.store.current.readyAt;
    console.log(`Dev loop ready: ${input.store.current.appOrigin}, build ${build.buildId}, idle TTL ${input.ttlMinutes} min. Iterations are not qualification runs.`);
    await new Promise<void>((resolve) => {
      if (stop.signal.aborted) resolve();
      else stop.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    while (busy) await sleep(200);
    summary.stopReason = String(stop.signal.reason);
    console.log(`Dev loop stopping (${summary.stopReason}).`);
  } finally {
    clearTimeout(idleTimer);
    input.signal.removeEventListener("abort", onSignal);
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    removeOwnedTemporaryDirectory(socketDirectory, DEV_LOOP_SOCKET_PREFIX);
    input.store.update({ status: "stopping", expiresAt: null, socket: undefined });
  }
  summary.builds = build.count;
  summary.stoppedAt = new Date().toISOString();
  return summary;
}

function sendRequest(socketPath: string, request: Record<string, unknown>, onLog: (line: string) => void) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const socket = net.connect(socketPath);
    let buffer = "";
    let result: Record<string, unknown> | undefined;
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
        const message = JSON.parse(buffer.slice(0, newline)) as Message;
        buffer = buffer.slice(newline + 1);
        if (message.type === "log") onLog(message.line);
        else result = message;
      }
    });
    socket.once("error", reject);
    socket.once("close", () => result
      ? resolve(result)
      : reject(new Error("The dev loop closed the connection without a result; see its supervisor log.")));
  });
}

export interface CleanupDependencies {
  /** A local Supabase CLI call; throws on failure. */
  supabase?: (args: string[]) => void;
  /** The native runtime's stack registry. */
  registry?: string;
}

/**
 * Destroys the exact stack a dead supervisor recorded, then releases its
 * state. The stack is found through its workdir or, once that is gone (a WSL
 * restart empties /tmp), through its native registry entry, which keeps the
 * stack's data until `stack destroy`. The state goes only once workdir,
 * registry entry and ports are all gone.
 */
export async function cleanUpAbandonedLoop(statePath: string, state: LoopState, dependencies: CleanupDependencies = {}) {
  const supabase = dependencies.supabase ?? ((args: string[]) => { runSupabaseCli(args, { capture: true }); });
  const registry = dependencies.registry ?? SUPABASE_STACK_REGISTRY;
  const errors: string[] = [];
  const notes: string[] = [];
  const stack = state.stack;
  const present = Boolean(stack && fs.existsSync(stack.rootDirectory));
  const registered = stack ? findRegisteredStack(stack.rootDirectory, registry) : null;
  if (stack && present && !ownsRecordedProject(state)) {
    errors.push(`refusing to destroy ${stack.rootDirectory}: its configuration does not carry the recorded project ${stack.projectId}`);
  } else if (stack && !present && registered && !ownsRegisteredStack(state, registered)) {
    errors.push(`refusing to destroy native stack ${registered.id}: its registration does not match the recorded project ${stack.projectId}`);
  } else if (stack && (present || registered)) {
    let workdir = present;
    if (!present) {
      notes.push(`workdir already gone; native stack ${registered!.id} found by its registered project root and API port, workdir recreated for the CLI`);
      // CLI 2.120 rejects a --workdir that does not exist: recreate the owned
      // temporary project, empty but for its recorded identity, as the 16/10
      // recovery did. A failed destroy leaves it for the next stop to retry.
      try {
        fs.mkdirSync(stack.rootDirectory, { mode: 0o700 });
        fs.mkdirSync(path.join(stack.rootDirectory, "supabase"));
        fs.writeFileSync(path.join(stack.rootDirectory, "supabase", "config.toml"),
          `project_id = "${stack.projectId}"\n[experimental]\nstack = true\n`, { flag: "wx" });
        workdir = true;
      } catch (error) {
        errors.push(`could not recreate the workdir: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (workdir) {
      try { supabase(["stop", "--workdir", stack.rootDirectory]); }
      catch { notes.push("supabase stop failed (a stack that never started has nothing to stop)"); }
      try {
        supabase(["stack", "destroy", "--yes", "--workdir", stack.rootDirectory]);
        removeOwnedTemporaryDirectory(stack.rootDirectory, SUPABASE_PROJECT_PREFIX);
      } catch (error) {
        errors.push(`destroy failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (state.socket && fs.existsSync(path.dirname(state.socket))) {
    try { removeOwnedTemporaryDirectory(path.dirname(state.socket), DEV_LOOP_SOCKET_PREFIX); }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  const proof = await proveStackDestroyed(stack, registry);
  errors.push(...proof.problems);
  if (errors.length) writeLoopState(statePath, { ...state, status: "cleanup-failed", expiresAt: null, error: errors.join("; ") });
  else fs.rmSync(statePath, { force: true });
  return { errors, notes, proof };
}

/** The state is replaced atomically; an unreadable read is retried by the caller. */
function readStateQuietly(statePath: string): LoopState | null {
  try { return readLoopState(statePath); } catch { return null; }
}

async function main() {
  const root = process.cwd();
  const command: DevLoopCommand = parseDevLoopArguments(process.argv.slice(2), (file) => fs.existsSync(path.join(root, file)));
  if (!fs.existsSync(path.join(root, DEV_LOOP_SUPERVISOR_ENTRY))) throw new Error("Run the dev loop from the repository root.");
  if (process.platform === "win32") {
    throw new Error("The Supabase native runtime does not run on Windows: run the dev loop inside WSL from a Linux checkout.");
  }
  const statePath = path.join(root, DEV_LOOP_STATE_FILE);
  const state = readLoopState(statePath);
  const classification = classifyLoopState(state, state ? probeSupervisor(state.supervisor.pid, state.checkout) : null, Date.now());

  if (command.action === "status") {
    console.log(JSON.stringify({ classification, state }, null, 2));
    return 0;
  }

  if (command.action === "start") {
    if (state) {
      throw new Error(classification.kind === "live"
        ? `A dev loop is already open (${state.appOrigin}, supervisor ${state.supervisor.pid}); use run, status or stop.`
        : `Stale dev-loop state (${classification.kind === "stale" ? classification.reason : "unknown"}); run \`npm run e2e:army:dev-loop -- stop\` first.`);
    }
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const logFile = path.join(path.dirname(statePath), `supervisor-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
    const descriptor = fs.openSync(logFile, "a", 0o600);
    const child = spawn(process.execPath, [
      "--import", "tsx", DEV_LOOP_SUPERVISOR_ENTRY, "dev-loop",
      "--app-port", String(command.appPort), "--ttl-minutes", String(command.ttlMinutes),
    ], { cwd: root, detached: true, stdio: ["ignore", descriptor, descriptor], env: process.env });
    fs.closeSync(descriptor);
    let exit: string | undefined;
    child.once("exit", (code, signal) => { exit = String(code ?? signal); });
    console.log(`Dev loop: supervisor ${child.pid} starting; log ${relativeTo(root, logFile)}`);
    let printed = 0;
    const flush = () => {
      const text = fs.readFileSync(logFile, "utf8");
      if (text.length > printed) { process.stdout.write(text.slice(printed)); printed = text.length; }
    };
    const started = Date.now();
    for (;;) {
      await sleep(1_000);
      flush();
      const current = readStateQuietly(statePath);
      if (current && current.supervisor.pid === child.pid && current.status === "ready") {
        child.unref();
        console.log(JSON.stringify({
          status: "ready", seconds: secondsSince(started), appOrigin: current.appOrigin, project: current.stack?.projectId,
          buildId: current.build?.buildId, ttlMinutes: current.ttlMinutes, expiresAt: current.expiresAt, evidence: current.evidence,
          next: "npm run e2e:army:dev-loop -- run --grep '<pattern>' | run --files <list> | stop",
        }, null, 2));
        return 0;
      }
      if (exit !== undefined) {
        flush();
        console.error(`Dev loop supervisor exited (${exit}) before it was ready; see ${relativeTo(root, logFile)}.`);
        return 1;
      }
      if (Date.now() - started > 45 * 60_000) {
        console.error("The dev loop was not ready within 45 minutes; stopping its supervisor.");
        child.kill("SIGTERM");
        return 1;
      }
    }
  }

  if (command.action === "run") {
    if (!state) throw new Error("No dev loop is open; start one with `npm run e2e:army:dev-loop -- start --app-port <port>`.");
    if (classification.kind !== "live") {
      throw new Error(`Stale dev-loop state (${classification.kind === "stale" ? classification.reason : "unknown"}); run \`npm run e2e:army:dev-loop -- stop\`.`);
    }
    if (!state.socket || state.status === "starting") throw new Error("The dev loop is still starting; wait for `start` to report ready.");
    const result = await sendRequest(state.socket, {
      action: "run", loopId: state.loopId, ...(command.grep ? { grep: command.grep } : { files: command.files }),
      command: [process.execPath, ...process.argv.slice(1)],
    }, (line) => console.log(line));
    console.log(JSON.stringify(result, null, 2));
    return result.status === "passed" ? 0 : result.status === "busy" ? 2 : 1;
  }

  if (!state) {
    console.log("No dev-loop state: nothing to stop.");
    return 0;
  }
  const pid = state.supervisor.pid;
  if (classification.kind === "live") {
    console.log(`Dev loop: stopping supervisor ${pid}; it destroys its own stack.`);
    process.kill(pid, "SIGTERM");
    const deadline = Date.now() + 10 * 60_000;
    while (probeSupervisor(pid, state.checkout) === "owned" && Date.now() < deadline) await sleep(1_000);
    if (probeSupervisor(pid, state.checkout) === "owned") {
      console.error("The supervisor did not stop within 10 minutes; nothing was removed.");
      return 1;
    }
  }
  const leftover = readLoopState(statePath);
  const stack = (leftover ?? state).stack;
  const cleanup = leftover
    ? await cleanUpAbandonedLoop(statePath, leftover)
    : { errors: [] as string[], notes: [] as string[], proof: await proveStackDestroyed(stack) };
  const stateRemoved = !fs.existsSync(statePath);
  const report = {
    stopped: stateRemoved && cleanup.errors.length === 0 && cleanup.proof.problems.length === 0,
    cleanedBy: leftover ? `this command (${classification.kind === "stale" ? classification.reason : `supervisor left ${leftover.status}`})` : "the supervisor",
    project: stack?.projectId ?? null,
    projectDirectoryRemoved: cleanup.proof.projectDirectoryRemoved,
    registryEntryRemoved: cleanup.proof.registryEntryRemoved,
    portsClosed: cleanup.proof.portsClosed,
    stateRemoved,
    evidence: state.evidence,
    errors: cleanup.errors,
    notes: cleanup.notes,
  };
  console.log(JSON.stringify(report, null, 2));
  return report.stopped ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (error: unknown) => {
    console.error(`Dev loop error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
