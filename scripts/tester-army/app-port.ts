// The application port of an Army campaign (docs/testing/tester-army-local-development.md).
// Several agents launch campaigns on one Mac: a campaign binds `--app-port` only
// for its journeys, minutes after its launch, so a bind probe at launch cannot
// see a neighbour still in its database checks (TI-672). Each launcher of
// scripts/run-tester-army-ci.ts therefore holds a lease on its port for its
// whole life, and every refusal names the port, the cause and its holder.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/** Who listens on a loopback TCP port, best effort: `node (PID 4242)`; empty without `lsof`. */
export function describePortListeners(port: number) {
  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"], { encoding: "utf8", timeout: 5_000 });
  if (result.error || typeof result.stdout !== "string") return [];
  const listeners = new Map<number, string>();
  let pid: number | undefined;
  for (const line of result.stdout.split("\n")) {
    if (/^p\d+$/.test(line)) { pid = Number(line.slice(1)); listeners.set(pid, "process"); }
    // Only a plain command name reaches the message; lsof gives no arguments.
    else if (pid !== undefined && /^c[A-Za-z0-9._+-]{1,32}$/.test(line)) listeners.set(pid, line.slice(1));
  }
  return [...listeners].map(([holder, command]) => `${command} (PID ${holder})`);
}

export class LocalAppPortUnavailableError extends Error {
  override name = "LocalAppPortUnavailableError";
}

/**
 * Refuses a port another process listens on, on either loopback. The error
 * keeps the system code (EADDRINUSE, EACCES…) and the listener when known.
 */
export async function assertLocalAppPortAvailable(port: number, listeners: (port: number) => string[] = describePortListeners) {
  for (const host of ["127.0.0.1", "::1"]) {
    const failure = await new Promise<NodeJS.ErrnoException | undefined>((resolve) => {
      const server = net.createServer();
      server.once("error", resolve);
      server.listen({ port, host, exclusive: true }, () => server.close((error) => resolve(error)));
    });
    if (!failure || (host === "::1" && ["EADDRNOTAVAIL", "EAFNOSUPPORT"].includes(failure.code ?? ""))) continue;
    const code = /^E[A-Z0-9_]{1,31}$/.test(failure.code ?? "") ? failure.code : "unknown error";
    const holders = code === "EADDRINUSE" ? listeners(port) : [];
    throw new LocalAppPortUnavailableError(
      `Local application port ${port} is unavailable on ${host} (${code}${holders.length ? `, listening: ${holders.join(", ")}` : ""}). ` +
      "Choose another --app-port, or stop that process if it is left over from an earlier campaign.",
      { cause: failure },
    );
  }
}

export class AppPortReservedError extends Error {
  override name = "AppPortReservedError";
}

export interface AppPortLease {
  file: string;
  /** Idempotent; also runs on process exit. */
  release: () => void;
}

export interface ReserveAppPortOptions {
  port: number;
  /** The campaign named to the launchers this one refuses. */
  label: string;
  directory?: string;
  pid?: number;
  isAlive?: (pid: number) => boolean;
}

/** This user's leases, shared by every checkout of the machine. */
export function defaultAppPortLeaseDirectory() {
  return path.join(os.homedir(), ".supabase", "army-app-ports");
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

const LEASE_FILE = /^(\d+)-(\d+)-[0-9a-f-]{36}\.json$/;

/**
 * Leases the application port for this launcher's life, or refuses at once
 * with an AppPortReservedError naming the live holder. Each launcher writes
 * its own file before reading the others, so of two racing launchers the
 * later reader sees both: never two on one port, though both may back off.
 * A lease whose process is gone (SIGKILL, crash) is stale and removed.
 */
export function reserveAppPort(options: ReserveAppPortOptions): AppPortLease {
  const directory = options.directory ?? defaultAppPortLeaseDirectory();
  const pid = options.pid ?? process.pid;
  const isAlive = options.isAlive ?? isProcessAlive;
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${options.port}-${pid}-${randomUUID()}.json`);
  const record = { port: options.port, pid, label: options.label, cwd: process.cwd(), startedAt: new Date().toISOString() };
  fs.writeFileSync(file, `${JSON.stringify(record)}\n`, { flag: "wx", mode: 0o600 });
  const holders: string[] = [];
  try {
    for (const name of fs.readdirSync(directory)) {
      const match = LEASE_FILE.exec(name);
      const other = path.join(directory, name);
      if (!match || other === file || Number(match[1]) !== options.port) continue;
      const holder = Number(match[2]);
      if (!isAlive(holder)) {
        fs.rmSync(other, { force: true });
        continue;
      }
      let detail = "starting";
      try {
        const lease = JSON.parse(fs.readFileSync(other, "utf8")) as { label?: string; cwd?: string; startedAt?: string };
        detail = `${lease.label} in ${lease.cwd} since ${lease.startedAt}`;
      } catch {
        // Still being written by its live owner.
      }
      holders.push(`PID ${holder}, ${detail} (lease ${other})`);
    }
  } catch (error) {
    fs.rmSync(file, { force: true });
    throw error;
  }
  if (holders.length > 0) {
    fs.rmSync(file, { force: true });
    throw new AppPortReservedError(
      `Local application port ${options.port} is reserved by another TesterArmy campaign: ${holders.join("; ")}. ` +
      "Both would serve their journeys on it: choose another --app-port, or wait for that campaign to end.",
    );
  }
  const release = () => {
    process.off("exit", release);
    fs.rmSync(file, { force: true });
  };
  process.on("exit", release);
  return { file, release };
}

function clip(text: string) {
  const lines = text.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim());
  const kept = lines.slice(0, 12).map((line) => line.length > 300 ? `${line.slice(0, 300)}…` : line);
  if (lines.length > kept.length) kept.push(`… ${lines.length - kept.length} more lines`);
  return kept.join("\n    ");
}

/**
 * What the army CLI (scripts/run-tester-army.mjs) recorded in its manifest
 * about a run that failed before or around its journeys: the e2e run-level
 * errors (an app that could not start: APP_ALREADY_RUNNING, APP_UNREACHABLE
 * with its log tail) and its own setup error. Journey failures are results,
 * not run-level errors, and stay in the report.
 */
export function describeArmyRunFailure(manifest: unknown) {
  const result = manifest && typeof manifest === "object" ? (manifest as { result?: { errors?: unknown; error?: unknown } }).result : undefined;
  const errors = Array.isArray(result?.errors) ? result.errors as Array<{ code?: unknown; message?: unknown }> : [];
  const lines = errors.slice(0, 3).map((error) => {
    const code = typeof error?.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : "UNKNOWN";
    return `${code}: ${typeof error?.message === "string" ? clip(error.message) : "no message"}`;
  });
  if (errors.length > 3) lines.push(`${errors.length - 3} more run-level errors in the retained manifest`);
  if (typeof result?.error === "string" && result.error.trim()) lines.push(clip(result.error));
  return lines;
}

/** The last non-empty lines of a child's output, for a failure without a structured cause. */
export function outputTail(output: string, count = 10) {
  const lines = output.replace(/\x1b\[[0-9;]*m/g, "").split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim());
  return lines.slice(-count).map((line) => line.length > 300 ? `${line.slice(0, 300)}…` : line).join("\n    ");
}
