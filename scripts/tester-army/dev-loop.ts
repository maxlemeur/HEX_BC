import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runSupabaseCli } from "../../src/test/supabase-cli";
import {
  applicationSourceDigest, assertJourneySelection, classifyLoopState, decideRebuild, DEV_LOOP_ITERATION_SCOPE,
  DEV_LOOP_SOCKET_PREFIX, DEV_LOOP_STATE_FILE, DEV_LOOP_SUPERVISOR_ENTRY, type DevLoopCommand, listeningPorts,
  type LoopBuild, type LoopState, type LoopStateStore, parseDevLoopArguments, probeSupervisor, readBuildId,
  readLoopState, removeOwnedTemporaryDirectory, stackInputsDigest, SUPABASE_PROJECT_PREFIX, writeLoopState,
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
  const ready = () => {
    const now = Date.now();
    input.store.update({
      status: "ready", lastActivityAt: new Date(now).toISOString(),
      expiresAt: new Date(now + input.ttlMinutes * 60_000).toISOString(),
    });
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => stop.abort("ttl-expired"), input.ttlMinutes * 60_000);
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
      try { await input.journeys(context); } finally { timings.journeysSeconds = secondsSince(journeysStarted); }
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

  async function respond(socket: net.Socket, line: string) {
    const send = (message: Message) => { if (!socket.destroyed && socket.writable) socket.write(`${JSON.stringify(message)}\n`); };
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
      if (stop.signal.aborted) { send({ type: "result", status: "stopping" }); return; }
      if (busy) { send({ type: "result", status: "busy", iteration: input.store.current.iterations + 1 }); return; }
      busy = true;
      clearTimeout(idleTimer);
      input.store.update({ status: "running", expiresAt: null, lastActivityAt: new Date().toISOString() });
      try {
        send({ type: "result", ...await iterate(selection, command, (text) => { console.log(text); send({ type: "log", line: text }); }) });
      } finally {
        busy = false;
        if (!stop.signal.aborted) ready();
      }
    } catch (error) {
      send({ type: "result", status: "refused", error: input.redact(error instanceof Error ? error.message : String(error)) });
    } finally {
      socket.end();
    }
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
    input.store.update({ socket: socketPath, readyAt: new Date().toISOString() });
    ready();
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

async function waitForClosedPorts(ports: readonly number[]) {
  let listening = await listeningPorts(ports);
  for (let attempt = 0; listening.length && attempt < 10; attempt += 1) {
    await sleep(1_000);
    listening = await listeningPorts(ports);
  }
  return listening;
}

/** Destroys the exact stack a dead supervisor recorded, then releases its state. */
async function cleanUpAbandonedLoop(statePath: string, state: LoopState) {
  const errors: string[] = [];
  const notes: string[] = [];
  const directory = state.stack?.rootDirectory;
  if (directory && fs.existsSync(directory)) {
    try { runSupabaseCli(["stop", "--workdir", directory], { capture: true }); }
    catch { notes.push("supabase stop failed (a stack that never started has nothing to stop)"); }
    try {
      runSupabaseCli(["stack", "destroy", "--yes", "--workdir", directory], { capture: true });
      removeOwnedTemporaryDirectory(directory, SUPABASE_PROJECT_PREFIX);
    } catch (error) {
      errors.push(`destroy failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (state.socket && fs.existsSync(path.dirname(state.socket))) {
    try { removeOwnedTemporaryDirectory(path.dirname(state.socket), DEV_LOOP_SOCKET_PREFIX); }
    catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
  }
  const listening = await waitForClosedPorts(state.stack?.ports ?? []);
  if (listening.length) errors.push(`ports still listening: ${listening.join(", ")}`);
  if (errors.length) writeLoopState(statePath, { ...state, status: "cleanup-failed", expiresAt: null, error: errors.join("; ") });
  else fs.rmSync(statePath, { force: true });
  return { errors, notes };
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
  const cleanup = leftover ? await cleanUpAbandonedLoop(statePath, leftover) : { errors: [], notes: [] };
  const stack = (leftover ?? state).stack;
  const listening = await waitForClosedPorts(stack?.ports ?? []);
  const report = {
    stopped: true,
    cleanedBy: leftover ? `this command (${classification.kind === "stale" ? classification.reason : `supervisor left ${leftover.status}`})` : "the supervisor",
    project: stack?.projectId ?? null,
    projectDirectoryRemoved: !stack || !fs.existsSync(stack.rootDirectory),
    portsClosed: listening.length === 0,
    stateRemoved: !fs.existsSync(statePath),
    evidence: state.evidence,
    ...cleanup,
  };
  console.log(JSON.stringify(report, null, 2));
  return report.projectDirectoryRemoved && report.portsClosed && report.stateRemoved && cleanup.errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (error: unknown) => {
    console.error(`Dev loop error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
