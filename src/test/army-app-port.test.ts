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
//    retained file;
// 6. a lease whose PID now belongs to another process (a launcher stopped by
//    a signal skips its exit handler; PIDs wrap) refuses its port for good;
// 7. a phase's own error is replaced by the failure to retain its evidence
//    (the TI-663 symptom: "The current phase must retain a fresh manifest"
//    instead of "port unavailable"), or a phase stopped before its journeys
//    blocks the next one;
// 8. a native stack of another run takes a leased port for one of its
//    services while the lease holder is still in its database checks.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AppPortReservedError, assertLocalAppPortAvailable, describeArmyRunFailure,
  leasedAppPorts, LocalAppPortUnavailableError, outputTail, reserveAppPort,
} from "../../scripts/tester-army/app-port";
import { EvidenceRetentionError, failedPhase, keepRunError } from "../../scripts/tester-army/phase-failure";

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
    expect(leasedAppPorts(directory)).toEqual([4107]);
  }, 30_000);

  it("treats the lease of a launcher killed by SIGKILL as stale and removes it, whatever port is reserved next", async () => {
    const directory = leaseDirectory();
    const holder = await startLeaseHolder(4109, directory);
    const [stale] = fs.readdirSync(directory);
    holder.kill("SIGKILL");
    await exited(holder);
    // No exit handler ran: its file is still there, its process is not.
    expect(fs.readdirSync(directory)).toEqual([stale]);
    expect(leasedAppPorts(directory)).toEqual([]);

    const lease = reserveAppPort({ port: 4120, label: "run-tester-army-ci.ts critical", directory });
    expect(fs.readdirSync(directory)).toEqual([path.basename(lease.file)]);
    lease.release();
    expect(fs.readdirSync(directory)).toEqual([]);
  }, 30_000);

  it("releases the lease when its launcher exits, failed or not", () => {
    const directory = leaseDirectory();
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      const { reserveAppPort } = await import(${JSON.stringify(MODULE)});
      reserveAppPort({ port: 4110, label: "run-tester-army-ci.ts critical", directory: ${JSON.stringify(directory)} });
      process.exitCode = 1;
    `], { encoding: "utf8", timeout: 30_000 });
    expect(child.status, child.stderr).toBe(1);
    expect(fs.readdirSync(directory)).toEqual([]);
  }, 30_000);

  it("treats a lease whose PID now runs another process, or another user's, as stale", () => {
    const directory = leaseDirectory();
    const lease = (port: number, pid: number) => {
      const file = path.join(directory, `${port}-${pid}-00000000-0000-4000-8000-00000000000${port % 10}.json`);
      fs.writeFileSync(file, `${JSON.stringify({ port, pid, label: "run-tester-army-ci.ts critical", cwd: "/elsewhere",
        startedAt: "2026-01-01T00:00:00.000Z", processStartedAt: "Thu Jan  1 00:00:00 1970" })}\n`);
      return file;
    };
    // The vitest parent is alive, but not the process that wrote the lease.
    lease(4112, process.ppid);
    // PID 1 belongs to root: never a launcher of this user's lease directory.
    lease(4113, 1);
    expect(leasedAppPorts(directory)).toEqual([]);
    reserveAppPort({ port: 4112, label: "next", directory }).release();
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

    // The real listing, where the host has lsof (macOS, the CI runners). Its
    // command name is the process's on macOS (`node`) and its main thread's
    // on Linux (`node-MainThread`): the PID identifies the listener.
    if (!spawnSync("lsof", ["-v"]).error) {
      await expect(assertLocalAppPortAvailable(port)).rejects.toThrow(
        new RegExp(`\\(EADDRINUSE, listening: [A-Za-z0-9._+-]+ \\(PID ${neighbour.pid}\\)\\)\\. `),
      );
    }
  }, 30_000);

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
  }, 30_000);
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

  it("redacts a cause before clipping it, so a secret across the clip boundary cannot escape", () => {
    const secret = "army-secret-0123456789";
    const [cause] = describeArmyRunFailure({ result: { errors: [{ code: "APP_UNREACHABLE", message: `${"x".repeat(290)}${secret}` }] } },
      (text) => text.replaceAll(secret, "[redacted]"));
    expect(cause).toBe(`APP_UNREACHABLE: ${"x".repeat(290)}[redacted]`);
  });

  it("keeps the last output lines of a step without a recorded cause", () => {
    expect(outputTail(`a\n\n\u001b[31mb\u001b[39m\n${"x".repeat(400)}\n`, 2)).toBe(`b\n    ${"x".repeat(300)}…`);
  });
});

describe("Army phase failure", () => {
  const redact = (text: string) => text.replaceAll("s3cret", "[redacted]");
  const port = new Error("Local application port 3172 is unavailable on 127.0.0.1 (EADDRINUSE). Choose another --app-port.");

  it("keeps a phase's own error first when its evidence cannot be retained, and stops the next phase", () => {
    const failure = failedPhase({ error: new Error("journeys-critical failed (s3cret)"), launched: true, redact,
      retain: () => { throw new Error("The phase archive manifest does not match its retained fingerprint."); } });
    expect(failure).toEqual({ stop: true, message: "journeys-critical failed ([redacted]); its evidence was not retained: " +
      "The phase archive manifest does not match its retained fingerprint." });
  });

  it("neither retains nor blocks after a phase stopped before its journeys started", () => {
    let retained = 0;
    expect(failedPhase({ error: port, launched: false, redact, retain: () => { retained += 1; throw new Error("The current phase must retain a fresh manifest before another phase can run."); } }))
      .toEqual({ stop: false, message: port.message });
    expect(retained).toBe(0);
  });

  it("retains a launched phase once and lets the next phase run", () => {
    let retained = 0;
    expect(failedPhase({ error: new Error("journeys failed"), launched: true, redact, retain: () => { retained += 1; } }))
      .toEqual({ stop: false, message: "journeys failed" });
    expect(retained).toBe(1);
  });

  it("does not retry a retention that already failed after passing journeys", () => {
    let retained = 0;
    expect(failedPhase({ error: new EvidenceRetentionError("its evidence was not retained: x"), launched: true, redact, retain: () => { retained += 1; } }))
      .toEqual({ stop: true, message: "its evidence was not retained: x" });
    expect(retained).toBe(0);
  });

  it("keeps the run's error first when the final evidence retention fails too", () => {
    expect(keepRunError({ status: "failed", error: port.message }, "CI evidence failed the privacy check; upload is forbidden."))
      .toBe(`${port.message}; its evidence was not retained: CI evidence failed the privacy check; upload is forbidden.`);
    expect(keepRunError({ status: "passed" }, "The phase archive must remain inside the owned runs directory."))
      .toBe("The phase archive must remain inside the owned runs directory.");
  });
});
