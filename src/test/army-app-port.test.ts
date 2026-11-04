// The application port of an Army campaign (scripts/tester-army/app-port.ts,
// TI-672). Several agents launch campaigns on one Mac; a journey cannot see
// how its launcher refuses a port, nor two launchers racing. Ways it failed or
// could fail, each pinned below:
// 1. a second campaign on the same port passes the launch probe, because the
//    first binds the port only for its journeys, and both spend a stack and
//    minutes of database checks before one fails;
// 2. the lease of a launcher killed by SIGKILL blocks its port forever, or a
//    launcher that ends normally leaves its lease behind;
// 3. a refused launcher leaves a lease that refuses the next one;
// 4. a busy port is reported without its system code or its listener, so a
//    neighbour, a zombie `next start` and a startup crash read the same;
// 5. a journeys child that could not start its app (APP_ALREADY_RUNNING,
//    APP_UNREACHABLE) is reported by its exit code only, its cause left in a
//    retained file.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AppPortReservedError, assertLocalAppPortAvailable, describeArmyRunFailure, describePortListeners,
  LocalAppPortUnavailableError, outputTail, reserveAppPort,
} from "../../scripts/tester-army/app-port";

const MODULE = path.resolve("scripts/tester-army/app-port.ts");
const children: ChildProcess[] = [];
const directories: string[] = [];

afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function leaseDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "army-app-port-"));
  directories.push(directory);
  return directory;
}

async function freePort() {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen({ port: 0, host: "127.0.0.1" }, resolve));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

/** Another process, started with `args`, until it prints `marker`. */
async function startProcess(args: string[], marker: string) {
  const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  let output = "";
  await new Promise<void>((resolve, reject) => {
    child.stdout!.on("data", (chunk: Buffer) => { output += chunk.toString(); if (output.includes(marker)) resolve(); });
    child.stderr!.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    child.once("exit", (code) => reject(new Error(`process exited (${code}) before "${marker}": ${output}`)));
  });
  return child;
}

/** A launcher of another checkout: it leases `port` in `directory`, then lives until killed. */
function startLeaseHolder(port: number, directory: string) {
  return startProcess(["--import", "tsx", "--input-type=module", "-e", `
    const { reserveAppPort } = await import(${JSON.stringify(MODULE)});
    reserveAppPort({ port: ${port}, label: "run-tester-army-ci.ts critical", directory: ${JSON.stringify(directory)} });
    console.log("leased");
    setInterval(() => {}, 60_000);
  `], "leased");
}

function exited(child: ChildProcess) {
  return child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

describe("Army application port lease", () => {
  it("refuses a second campaign on a leased port at once, naming the live holder, and leaves nothing behind", async () => {
    const directory = leaseDirectory();
    const holder = await startLeaseHolder(4107, directory);
    const [held] = fs.readdirSync(directory);

    let refusal: unknown;
    try { reserveAppPort({ port: 4107, label: "run-tester-army-ci.ts critical", directory }); } catch (error) { refusal = error; }
    expect(refusal).toBeInstanceOf(AppPortReservedError);
    expect((refusal as Error).message).toContain("Local application port 4107 is reserved by another TesterArmy campaign");
    expect((refusal as Error).message).toContain(`PID ${holder.pid}, run-tester-army-ci.ts critical in ${process.cwd()}`);
    expect((refusal as Error).message).toContain(path.join(directory, held));
    expect((refusal as Error).message).toContain("choose another --app-port");
    // The refused launcher's own file is gone: it cannot refuse the next one.
    expect(fs.readdirSync(directory)).toEqual([held]);

    // Another port is unaffected.
    const other = reserveAppPort({ port: 4108, label: "run-tester-army-ci.ts critical", directory });
    other.release();
    other.release();
    expect(fs.readdirSync(directory)).toEqual([held]);
  });

  it("treats the lease of a launcher killed by SIGKILL as stale and removes it", async () => {
    const directory = leaseDirectory();
    const holder = await startLeaseHolder(4109, directory);
    const [stale] = fs.readdirSync(directory);
    holder.kill("SIGKILL");
    await exited(holder);
    // No exit handler ran: its file is still there, its process is not.
    expect(fs.readdirSync(directory)).toEqual([stale]);

    const lease = reserveAppPort({ port: 4109, label: "run-tester-army-ci.ts critical", directory });
    expect(fs.readdirSync(directory)).toEqual([path.basename(lease.file)]);
    lease.release();
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it("releases the lease when its launcher exits, failed or not", () => {
    const directory = leaseDirectory();
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      const { reserveAppPort } = await import(${JSON.stringify(MODULE)});
      reserveAppPort({ port: 4110, label: "run-tester-army-ci.ts critical", directory: ${JSON.stringify(directory)} });
      process.exitCode = 1;
    `], { encoding: "utf8", timeout: 30_000 });
    expect(child.status, child.stderr).toBe(1);
    expect(fs.readdirSync(directory)).toEqual([]);
  });

  it("keeps a lease whose process is alive but unreadable as held (still being written)", () => {
    const directory = leaseDirectory();
    const pending = path.join(directory, `4111-${process.ppid}-00000000-0000-4000-8000-000000000000.json`);
    fs.writeFileSync(pending, "");
    expect(() => reserveAppPort({ port: 4111, label: "second", directory }))
      .toThrow(`PID ${process.ppid}, starting (lease ${pending})`);
    expect(fs.readdirSync(directory)).toEqual([path.basename(pending)]);
  });
});

describe("Army application port probe", () => {
  it("accepts a free port", async () => {
    await expect(assertLocalAppPortAvailable(await freePort(), () => [])).resolves.toBeUndefined();
  });

  it("names the port, the loopback, the system code and the listening process of a busy port", async () => {
    const port = await freePort();
    const neighbour = await startProcess(["-e", `
      const net = require("node:net");
      net.createServer().listen({ port: ${port}, host: "127.0.0.1", exclusive: true }, () => console.log("listening"));
      setInterval(() => {}, 60_000);
    `], "listening");

    const failure = await assertLocalAppPortAvailable(port, () => ["node (PID 4242)"]).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(LocalAppPortUnavailableError);
    expect((failure as Error).message).toBe(
      `Local application port ${port} is unavailable on 127.0.0.1 (EADDRINUSE, listening: node (PID 4242)). ` +
      "Choose another --app-port, or stop that process if it is left over from an earlier campaign.",
    );
    expect(((failure as Error).cause as NodeJS.ErrnoException).code).toBe("EADDRINUSE");

    // The real listing, where the host has lsof (macOS, the CI runners).
    if (!spawnSync("lsof", ["-v"]).error) {
      expect(describePortListeners(port)).toEqual([`node (PID ${neighbour.pid})`]);
      await expect(assertLocalAppPortAvailable(port)).rejects.toThrow(`(EADDRINUSE, listening: node (PID ${neighbour.pid}))`);
    }
  });

  // macOS lets the loopback bind succeed next to a wildcard listener (Linux
  // refuses it with EADDRINUSE); http://localhost:<port> reaches that listener.
  it("refuses a listener on every interface, which a loopback bind may not see", async () => {
    const port = await freePort();
    await startProcess(["-e", `
      require("node:http").createServer((request, response) => response.end("neighbour"))
        .listen({ port: ${port}, exclusive: true }, () => console.log("listening"));
      setInterval(() => {}, 60_000);
    `], "listening");
    await expect(assertLocalAppPortAvailable(port, () => ["node (PID 4242)"])).rejects.toThrow(
      new RegExp(`^Local application port ${port} is unavailable on (?:127\\.0\\.0\\.1|::1) ` +
        "\\((?:EADDRINUSE|it already accepts connections there: a listener on every interface), listening: node \\(PID 4242\\)\\)"),
    );
  });
});

describe("Army journeys failure cause", () => {
  it("reads the app startup errors the army CLI recorded, with their code and log tail", () => {
    const manifest = {
      result: {
        status: "failed",
        errors: [{
          category: "infrastructure", code: "APP_UNREACHABLE",
          message: "app exited with code 1 before becoming ready\noutput in .e2e/army/critical/logs/app.log since app started:\n" +
            "  Error: listen EADDRINUSE: address already in use ::1:3172\n" +
            Array.from({ length: 20 }, (_, index) => `  at frame ${index}`).join("\n"),
        }],
      },
    };
    const [cause] = describeArmyRunFailure(manifest);
    expect(cause).toMatch(/^APP_UNREACHABLE: app exited with code 1 before becoming ready\n {4}output in/);
    expect(cause).toContain("Error: listen EADDRINUSE: address already in use ::1:3172");
    expect(cause).toContain("… 11 more lines");

    expect(describeArmyRunFailure({ result: { errors: [{ code: "APP_ALREADY_RUNNING", message: "http://localhost:3172/login already answered before app started" }] } }))
      .toEqual(["APP_ALREADY_RUNNING: http://localhost:3172/login already answered before app started"]);
    expect(describeArmyRunFailure({ result: { status: "evidence_unavailable", error: "Runner did not produce a fresh report for this invocation." } }))
      .toEqual(["Runner did not produce a fresh report for this invocation."]);
    // An unexpected code is not echoed; a run whose journeys failed has no run-level cause.
    expect(describeArmyRunFailure({ result: { errors: [{ code: "sb_secret_x", message: "m" }] } })).toEqual(["UNKNOWN: m"]);
    expect(describeArmyRunFailure({ result: { errors: [] } })).toEqual([]);
    expect(describeArmyRunFailure(null)).toEqual([]);
  });

  it("keeps the last output lines of a step without a recorded cause", () => {
    expect(outputTail(`a\n\n\u001b[31mb\u001b[39m\n${"x".repeat(400)}\n`, 2)).toBe(`b\n    ${"x".repeat(300)}…`);
  });
});
