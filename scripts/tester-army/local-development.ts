import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { prepareArmyTypeScriptConfig } from "./local-recipe-common.mjs";

export async function assertLocalAppPortAvailable(port: number) {
  for (const host of ["127.0.0.1", "::1"]) {
    await new Promise<void>((resolve, reject) => {
      const server = net.createServer();
      server.once("error", (error: NodeJS.ErrnoException) => {
        if (host === "::1" && ["EADDRNOTAVAIL", "EAFNOSUPPORT"].includes(error.code ?? "")) resolve();
        else reject(new Error(`Local application port ${port} is unavailable on ${host}.`));
      });
      server.listen({ port, host, exclusive: true }, () => server.close((error) => error ? reject(error) : resolve()));
    });
  }
}

export async function runLocalDevelopmentSession(input: {
  root: string;
  evidence: string;
  port: number;
  environment: NodeJS.ProcessEnv;
  email: string;
  password: string;
  networkLog: string;
  signal: AbortSignal;
  redact: (value: string) => string;
}) {
  if (input.signal.aborted) return { status: "not-started", reason: input.signal.reason };
  await assertLocalAppPortAvailable(input.port);
  await prepareArmyTypeScriptConfig(input.root);
  if (input.signal.aborted) return { status: "not-started", reason: input.signal.reason };
  const privateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "miaouffrage-army-dev-"));
  const credentials = path.join(privateDirectory, "login.json");
  const origin = `http://localhost:${input.port}`;
  const startedAt = new Date().toISOString();
  let readyAt: string | null = null;
  let forcedStop = false;
  const chunks: Buffer[] = [];
  let bytes = 0;
  let overflow = false;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    fs.chmodSync(privateDirectory, 0o700);
    fs.writeFileSync(credentials, `${JSON.stringify({ origin, email: input.email, password: input.password }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    if ((fs.statSync(credentials).mode & 0o777) !== 0o600 || (fs.statSync(privateDirectory).mode & 0o777) !== 0o700) {
      throw new Error("Development login file must be private (directory 0700, file 0600).");
    }
    const environment = { ...input.environment };
    delete environment.E2E_LOGIN_EMAIL;
    delete environment.E2E_LOGIN_PASSWORD;
    const child = spawn(process.execPath, [
      path.join(input.root, "node_modules/next/dist/bin/next"),
      "dev", "--webpack", "--hostname", "localhost", "--port", String(input.port),
    ], {
      cwd: input.root, detached: true, stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...environment, E2E_ARMY: "1", E2E_ARMY_SERVER_MODE: "development",
        E2E_ARMY_BLOCK_WORKERS: "1", E2E_COVERAGE_NETWORK_LOG: input.networkLog,
        NODE_OPTIONS: `--import=${pathToFileURL(path.join(input.root, "scripts/tester-army/coverage-network-guard.mjs")).href}`,
      },
    });
    let closed = false;
    let launchError: Error | undefined;
    const signalOwnedGroup = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    };
    const ownedGroupExists = () => {
      if (!child.pid) return false;
      try { process.kill(-child.pid, 0); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
    };
    const stop = () => {
      signalOwnedGroup(input.signal.reason === "SIGINT" ? "SIGINT" : "SIGTERM");
      stopTimer ??= setTimeout(() => { forcedStop = true; signalOwnedGroup("SIGKILL"); }, 15_000);
    };
    const completion = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("error", (error) => { launchError = error; });
      child.once("close", (exitCode, signal) => { closed = true; resolve({ exitCode, signal }); });
    });
    const capture = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes <= 64 * 1024 * 1024) chunks.push(chunk);
      else if (!overflow) { overflow = true; stop(); }
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    input.signal.addEventListener("abort", stop);
    try {
      if (input.signal.aborted) stop();
      const deadline = Date.now() + 180_000;
      while (!closed && !input.signal.aborted && Date.now() < deadline) {
        try {
          const response = await fetch(`${origin}/login`, { signal: AbortSignal.timeout(2_000), redirect: "manual" });
          await response.body?.cancel();
          if (response.status === 200) { readyAt = new Date().toISOString(); break; }
        } catch { /* Next may still be starting or compiling the login page. */ }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!readyAt && !closed && !input.signal.aborted) {
        stop();
        await completion;
        throw new Error("The owned Next development server did not become ready within 180 seconds.");
      }
      if (readyAt) console.log(`Local development ready: ${origin}\nPrivate login file: ${credentials}\nCtrl+C stops this session and destroys its local data. No E2E result is claimed.`);
      const result = await completion;
      const expectedExit = result.signal === "SIGINT" || result.signal === "SIGTERM" ||
        result.signal === null && [0, 130, 143].includes(result.exitCode ?? -1);
      if (launchError || overflow || forcedStop || !input.signal.aborted || !expectedExit) {
        throw new Error(`Owned development server failed (exit ${result.exitCode ?? result.signal ?? "unknown"}); see development.log.`);
      }
      await assertLocalAppPortAvailable(input.port);
      return { status: "stopped", startedAt, readyAt, ...result, stopRequested: input.signal.reason,
        credentials: { fileMode: "0600", directoryMode: "0700", retained: false }, serverPortReleased: true };
    } finally {
      input.signal.removeEventListener("abort", stop);
      if (!closed) { stop(); await completion; }
      if (stopTimer) clearTimeout(stopTimer);
      // Next forks its server. Retain ownership of the dedicated process group
      // until every member has stopped, including after an early CLI exit.
      if (ownedGroupExists()) {
        signalOwnedGroup("SIGTERM");
        const deadline = Date.now() + 15_000;
        while (ownedGroupExists() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
        if (ownedGroupExists()) {
          signalOwnedGroup("SIGKILL");
          throw new Error("The owned development process group required forced cleanup.");
        }
      }
    }
  } finally {
    try {
      fs.writeFileSync(path.join(input.evidence, "development.log"), input.redact(Buffer.concat(chunks).toString("utf8")));
    } finally {
      // This exact directory was created by this invocation; never use a configured path.
      fs.rmSync(privateDirectory, { recursive: true, force: true });
    }
  }
}
