import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type {
  DatabaseFingerprint,
  DatabaseSnapshot,
  DatabaseSnapshotManifest,
  DatabaseSnapshotOperations,
} from "@/test/database-snapshot";
import {
  assertNativeRuntimeHost,
  describeSafeFailure,
  enableNativeStack,
  findAvailablePort,
  parseLocalSupabaseCiArguments,
  parseLocalSupabaseStatus,
  runChildProcess,
  runLocalSupabaseCi,
  SafeDiagnosticError,
  validatePgTapReport,
  validateRlsMatrixReport,
} from "@/test/local-supabase-ci";
import { NativeStackLimitError } from "@/test/native-stack-guard";
import {
  assertLocalOnlySupabaseArgs,
  assertNoRemoteSupabaseEnvironment,
  createLocalCiEnvironment,
  PINNED_SUPABASE_CLI_VERSION,
} from "@/test/supabase-cli";

function localJwt(role: "anon" | "service_role") {
  return [
    Buffer.from('{"alg":"none"}').toString("base64url"),
    Buffer.from(JSON.stringify({ role })).toString("base64url"),
    "signature",
  ].join(".");
}

function createDependencies(options: {
  cliVersionOutput?: string;
  failDestroy?: boolean;
  failStart?: boolean;
  failReset?: boolean;
  failStop?: boolean;
  migrationOutput?: string;
  pgTapOutput?: string;
} = {}) {
  const calls: string[] = [];
  const log = vi.fn();
  const supabase = vi.fn((args: string[], capture = false) => {
    const command = args.join(" ");
    calls.push(command);
    if (command === "--version") {
      return options.cliVersionOutput ?? PINNED_SUPABASE_CLI_VERSION;
    }
    if (options.failStart && command.startsWith("start ")) {
      throw new Error("Cannot bind inspector: address already in use");
    }
    if (options.failReset && command.startsWith("db reset --local")) {
      throw new Error("reset failed");
    }
    if (options.failStop && command.startsWith("stop ")) {
      throw new Error("stop failed");
    }
    if (options.failDestroy && command.startsWith("stack destroy ")) {
      throw new Error("destroy failed");
    }
    if (command.startsWith("migration list --local")) {
      return options.migrationOutput ?? "migration-output";
    }
    if (command.startsWith("test db --local")) {
      const selected = args.filter((arg) => arg.endsWith(".sql")).length;
      const fileCount = selected || fs.readdirSync(path.join(process.cwd(), "supabase", "tests", "database"))
        .filter((file) => file.endsWith(".sql")).length;
      return options.pgTapOutput ?? `Files=${fileCount}, Tests=205,  1 wallclock secs\nResult: PASS\n`;
    }
    if (command.startsWith("status ") && capture) {
      return [
        'API_URL="http://127.0.0.1:54321"',
        'DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"',
        `ANON_KEY="${localJwt("anon")}"`,
        `SERVICE_ROLE_KEY="${localJwt("service_role")}"`,
      ].join("\r\n");
    }
    return "";
  });

  const release = vi.fn();
  return {
    calls,
    release,
    dependencies: {
      acquireStackSlot: vi.fn(async () => ({ recordStack: vi.fn(), release })),
      ensureRuntime: vi.fn(),
      environment: {},
      log,
      prepareProject: vi.fn(async () => ({
        projectId: "miaouffrage-ci-test",
        rootDirectory: "C:/temp/miaouffrage-supabase-ci-test",
      })),
      provisionUsers: vi.fn(async () => ({
        environment: {
          RLS_E2E_ADMIN_EMAIL: "admin@example.test",
          RLS_E2E_ADMIN_PASSWORD: "admin-password",
          RLS_E2E_ENGINEER_EMAIL: "engineer@example.test",
          RLS_E2E_ENGINEER_PASSWORD: "engineer-password",
          RLS_E2E_VIEWER_EMAIL: "viewer@example.test",
          RLS_E2E_VIEWER_PASSWORD: "viewer-password",
        },
        userIds: ["admin-id", "engineer-id", "viewer-id"],
      })),
      runRls: vi.fn(),
      resolvePsql: vi.fn(() => "/native/postgres/bin/psql"),
      removeProject: vi.fn(),
      supabase,
      validateProject: vi.fn(() => []),
      verifyMigrations: vi.fn(() => []),
    },
  };
}

describe("local Supabase CI", () => {
  it("allocates eight distinct real listening ports outside the ephemeral client range", async () => {
    const reserved = new Set<number>();
    for (let index = 0; index < 8; index += 1) {
      const port = await findAvailablePort(reserved, [[32768, 65535]]);
      expect(port).toBeGreaterThanOrEqual(1024);
      expect(port).toBeLessThan(32768);
      expect(reserved.has(port)).toBe(false);
      reserved.add(port);
      const listener = net.createServer();
      try {
        await new Promise<void>((resolve, reject) => {
          listener.once("error", reject);
          listener.listen({ port, host: "127.0.0.1", exclusive: true }, resolve);
        });
        expect((listener.address() as net.AddressInfo).port).toBe(port);
      } finally {
        if (listener.listening) await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
      }
    }
    expect(reserved.size).toBe(8);
  });

  it("excludes a real occupied listener and refuses exhausted candidates", async () => {
    const occupied = net.createServer();
    const available = net.createServer();
    const listen = (server: net.Server) => new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      await listen(occupied);
      await listen(available);
      const occupiedPort = (occupied.address() as net.AddressInfo).port;
      const availablePort = (available.address() as net.AddressInfo).port;
      await new Promise<void>((resolve, reject) => available.close((error) => error ? reject(error) : resolve()));
      const reserved = new Set(Array.from({ length: 65536 - 1024 }, (_, index) => index + 1024));
      reserved.delete(occupiedPort);
      reserved.delete(availablePort);
      expect(await findAvailablePort(reserved, [[1024, 1024]])).toBe(availablePort);
      reserved.add(availablePort);
      await expect(findAvailablePort(reserved, [[1024, 1024]])).rejects.toThrow("No non-ephemeral Supabase port");
      expect(occupied.listening).toBe(true);
    } finally {
      for (const server of [occupied, available]) {
        if (server.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    }
  });

  it("fails closed on a startup bind collision without retrying or provisioning", async () => {
    const { dependencies, calls } = createDependencies({ failStart: true });
    await expect(runLocalSupabaseCi(dependencies)).rejects.toThrow("Phase failed: start local stack: Cannot bind inspector");
    expect(calls.filter((command) => command.startsWith("start "))).toHaveLength(1);
    expect(calls.slice(-2)).toEqual([
      "stop --workdir C:/temp/miaouffrage-supabase-ci-test",
      "stack destroy --yes --workdir C:/temp/miaouffrage-supabase-ci-test",
    ]);
    expect(dependencies.provisionUsers).not.toHaveBeenCalled();
    expect(dependencies.runRls).not.toHaveBeenCalled();
    expect(dependencies.removeProject).toHaveBeenCalledOnce();
  });

  it("refuses missing or invalid ephemeral ranges instead of falling back to port zero", async () => {
    for (const ranges of [[], [[0, 65535]], [[60999, 32768]], [[1024, 65536]], [[Number.NaN, 60999]]]) {
      await expect(findAvailablePort(new Set(), ranges)).rejects.toThrow("Invalid host ephemeral port range");
    }
  });

  it("keeps caller-owned future listeners out of the real isolated service configuration", async () => {
    const allowed = new Set(Array.from({ length: 64 }, (_, index) => 16384 + index));
    const reservedPorts = new Set(Array.from({ length: 65536 - 1024 }, (_, index) => index + 1024)
      .filter((port) => !allowed.has(port)));
    const dependencies: Parameters<typeof runLocalSupabaseCi>[0] = { ...createDependencies().dependencies };
    delete dependencies.prepareProject;
    delete dependencies.removeProject;
    let allocated: number[] = [];
    dependencies.supabase = vi.fn((args: string[]) => {
      if (args[0] === "--version") return PINNED_SUPABASE_CLI_VERSION;
      if (args[0] === "start") {
        const directory = args[args.indexOf("--workdir") + 1];
        const config = fs.readFileSync(path.join(directory, "supabase/config.toml"), "utf8");
        allocated = [...config.matchAll(/^\s*(?:port|shadow_port|inspector_port)\s*=\s*(\d+)/gm)].map((match) => Number(match[1]));
        throw new Error("Fixture stops before launching any service");
      }
      return "";
    });
    // Only host metadata is supplied; config copying and port probes stay real.
    const nativeProcess = process;
    const readFile = fs.readFileSync;
    const reader = vi.spyOn(fs, "readFileSync").mockImplementation((file, ...args) => {
      if (file === "/proc/sys/net/ipv4/ip_local_port_range") return "32768 65535\n";
      return readFile(file, ...args);
    });
    vi.stubGlobal("process", new Proxy(nativeProcess, {
      get: (target, key) => key === "platform" ? "linux" : Reflect.get(target, key),
    }));
    // The dev loop records these ports in its state file before the stack starts.
    let reportedPorts: number[] = [];
    try {
      await expect(runLocalSupabaseCi({
        ...dependencies, reservedPorts, onProjectPrepared: (project) => { reportedPorts = [...(project.ports ?? [])]; },
      })).rejects.toThrow("Fixture stops before launching any service");
      expect(new Set(allocated).size).toBe(8);
      expect(allocated.every((port) => allowed.has(port))).toBe(true);
      expect([...reportedPorts].sort()).toEqual([...allocated].sort());
    } finally {
      vi.stubGlobal("process", nativeProcess);
      reader.mockRestore();
    }
  });

  it("reports its isolated project before starting the stack and cleans up when that report fails", async () => {
    // The dev loop's stale cleanup needs the workdir of a stack whose
    // supervisor died during `supabase start`: it must be known beforehand.
    const reported = createDependencies();
    const identities: string[] = [];
    await runLocalSupabaseCi({
      ...reported.dependencies,
      onProjectPrepared: (project) => {
        expect(reported.calls).toEqual(["--version"]);
        identities.push(`${project.projectId} ${project.rootDirectory}`);
      },
    });
    expect(identities).toEqual(["miaouffrage-ci-test C:/temp/miaouffrage-supabase-ci-test"]);

    const failing = createDependencies();
    await expect(runLocalSupabaseCi({
      ...failing.dependencies,
      onProjectPrepared: () => { throw new Error("dev-loop state is not writable"); },
    })).rejects.toThrow("Phase failed: prepare isolated project: dev-loop state is not writable");
    expect(failing.calls).toEqual(["--version"]);
    expect(failing.dependencies.provisionUsers).not.toHaveBeenCalled();
    expect(failing.dependencies.removeProject).toHaveBeenCalledOnce();
  });

  it("refuses browser-blocked ports even when they are the only unreserved candidates", async () => {
    for (const port of [6000, 6667, 10080]) {
      const reserved = new Set(Array.from({ length: 65536 - 1024 }, (_, index) => index + 1024));
      reserved.delete(port);
      await expect(findAvailablePort(reserved, [[32768, 65535]])).rejects.toThrow("No non-ephemeral Supabase port");
    }
  });

  it("rejects a zero-exit NOTESTS report before provisioning users and still cleans up", async () => {
    const { dependencies } = createDependencies({
      pgTapOutput: "Files=0, Tests=0,  0 wallclock secs\nResult: NOTESTS\n",
    });
    await expect(runLocalSupabaseCi(dependencies)).rejects.toThrow("Phase failed: run pgTAP");
    expect(dependencies.provisionUsers).not.toHaveBeenCalled();
    expect(dependencies.runRls).not.toHaveBeenCalled();
    expect(dependencies.removeProject).toHaveBeenCalledOnce();
    expect(dependencies.supabase).toHaveBeenLastCalledWith(
      ["stack", "destroy", "--yes", "--workdir", "C:/temp/miaouffrage-supabase-ci-test"], true
    );
  });

  it("requires a complete passing pgTAP report with executed assertions", () => {
    expect(() => validatePgTapReport("Files=13, Tests=205,  1 wallclock secs\nResult: PASS\n", 13)).not.toThrow();
    for (const output of [
      "Files=0, Tests=0,  0 wallclock secs\nResult: NOTESTS\n",
      "Files=12, Tests=205,  1 wallclock secs\nResult: PASS\n",
      "Files=13, Tests=0,  1 wallclock secs\nResult: PASS\n",
      "Files=13, Tests=205,  1 wallclock secs\nResult: FAIL\n",
      "Files=13, Tests=205,  1 wallclock secs\n",
      "Result: PASS\n",
      "",
    ]) {
      expect(() => validatePgTapReport(output, 13)).toThrow("pgTAP");
    }
    expect(() => validatePgTapReport("Files=0, Tests=1,  1 wallclock secs\nResult: PASS\n", 0)).toThrow("pgTAP");
  });
  it("runs every local phase in order and never logs captured keys", async () => {
    const { calls, dependencies } = createDependencies({
      cliVersionOutput: `${PINNED_SUPABASE_CLI_VERSION}\n\nA new version of Supabase CLI is available: v2.121.0`,
    });
    const runApplication = vi.fn(async () => {
      expect(dependencies.runRls).toHaveBeenCalledOnce();
      expect(dependencies.removeProject).not.toHaveBeenCalled();
      await Promise.resolve();
      calls.push("run application");
    });
    // Without ARMY_DB_SNAPSHOT_DIR the run keeps db reset and touches no snapshot.
    await expect(runLocalSupabaseCi({ ...dependencies, runApplication })).resolves.toEqual({
      database: { source: "reset", snapshot: "disabled" },
    });
    const projectRoot = "C:/temp/miaouffrage-supabase-ci-test";
    const databaseTests = path.join(
      projectRoot,
      "supabase",
      "tests",
      "database"
    );

    expect(calls).toEqual([
      "--version",
      `start --runtime native --workdir ${projectRoot}`,
      `db reset --local --workdir ${projectRoot}`,
      `migration list --local --output-format json --workdir ${projectRoot}`,
      `test db --local ${databaseTests} --workdir ${projectRoot}`,
      `status --env --workdir ${projectRoot}`,
      "run application",
      `stop --workdir ${projectRoot}`,
      `stack destroy --yes --workdir ${projectRoot}`,
    ]);
    expect(dependencies.ensureRuntime).toHaveBeenCalledOnce();
    const logs = dependencies.log.mock.calls.flat().join("\n");
    expect(logs).not.toContain(localJwt("anon"));
    expect(logs).not.toContain(localJwt("service_role"));
    expect(dependencies.runRls).toHaveBeenCalledOnce();
    expect(dependencies.runRls).toHaveBeenCalledWith(
      expect.objectContaining({
        RLS_E2E: "1",
        RLS_E2E_EPHEMERAL: "1",
        RLS_E2E_LOCAL: "1",
      })
    );
    expect(dependencies.removeProject).toHaveBeenCalledOnce();
    expect(runApplication).toHaveBeenCalledWith(expect.objectContaining({
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: localJwt("anon"),
      SUPABASE_SERVICE_ROLE_KEY: localJwt("service_role"),
      E2E_ARMY_LOCAL_DB_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      E2E_ARMY_LOCAL_PSQL: "/native/postgres/bin/psql",
    }));
    expect(dependencies.runRls.mock.calls[0][0]).not.toHaveProperty("E2E_ARMY_LOCAL_DB_URL");
    expect(logs).not.toContain("postgresql://");
  });

  it("parses --files into validated pgTAP files and refuses anything outside the database tests", () => {
    const databaseTests = path.join(process.cwd(), "supabase", "tests", "database");
    const [first, second] = fs.readdirSync(databaseTests).filter((file) => file.endsWith(".sql")).sort();
    expect(parseLocalSupabaseCiArguments([])).toEqual({});
    expect(parseLocalSupabaseCiArguments(["--files", `${first}, supabase/tests/database/${second}`])).toEqual({
      pgTapFiles: [first, second],
    });
    expect(parseLocalSupabaseCiArguments([`--files=${first}`, "--skip-rls"])).toEqual({
      pgTapFiles: [first], skipRlsMatrix: true,
    });
    for (const [argv, message] of [
      [["--files"], "--files requires"],
      [["--files", ""], "--files requires"],
      [["--files", `${first},${first}`], "listed twice"],
      [["--files", "../migrations/x.sql"], "not a pgTAP file"],
      [["--files", `${databaseTests}/${first}`], "not a pgTAP file"],
      [["--files", "supabase/tests/other.test.sql"], "not a pgTAP file"],
      [["--files", "README.md"], "not a pgTAP file"],
      [["--files", "missing.test.sql"], "does not exist"],
      [["--files", first, "--files", second], "only once"],
      [["--rls-only"], "Unknown argument"],
    ] as const) {
      expect(() => parseLocalSupabaseCiArguments([...argv]), argv.join(" ")).toThrow(message);
    }
  });

  it("runs only the selected pgTAP files, counts them, keeps RLS unless skipped and says the run is partial", async () => {
    const projectRoot = "C:/temp/miaouffrage-supabase-ci-test";
    const databaseTests = path.join(projectRoot, "supabase", "tests", "database");
    const filtered = createDependencies();
    await runLocalSupabaseCi({ ...filtered.dependencies, pgTapFiles: ["a.test.sql", "b.test.sql"] });
    expect(filtered.calls).toContain(
      `test db --local ${path.join(databaseTests, "a.test.sql")} ${path.join(databaseTests, "b.test.sql")} --workdir ${projectRoot}`
    );
    expect(filtered.dependencies.runRls).toHaveBeenCalledOnce();
    expect(filtered.dependencies.log.mock.calls.flat().join("\n")).toContain("Partial run");

    const skipped = createDependencies();
    await runLocalSupabaseCi({ ...skipped.dependencies, pgTapFiles: ["a.test.sql"], skipRlsMatrix: true });
    expect(skipped.dependencies.provisionUsers).not.toHaveBeenCalled();
    expect(skipped.dependencies.runRls).not.toHaveBeenCalled();
    expect(skipped.calls.slice(-2)).toEqual([`stop --workdir ${projectRoot}`, `stack destroy --yes --workdir ${projectRoot}`]);

    const miscounted = createDependencies({ pgTapOutput: "Files=22, Tests=205,  1 wallclock secs\nResult: PASS\n" });
    await expect(runLocalSupabaseCi({ ...miscounted.dependencies, pgTapFiles: ["a.test.sql"] }))
      .rejects.toThrow("did not execute all 1 SQL files");
  });

  it("destroys the stack once when a termination signal arrives during a phase", async () => {
    const projectRoot = "C:/temp/miaouffrage-supabase-ci-test";
    const run = createDependencies();
    // The re-raised signal would end the test process: it is only recorded.
    const raise = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      run.dependencies.runRls = vi.fn(async () => {
        process.emit("SIGTERM", "SIGTERM");
        expect(run.calls.slice(-2)).toEqual([`stop --workdir ${projectRoot}`, `stack destroy --yes --workdir ${projectRoot}`]);
        expect(run.release).toHaveBeenCalledOnce();
        expect(run.dependencies.removeProject).toHaveBeenCalledOnce();
      });
      await expect(runLocalSupabaseCi(run.dependencies)).rejects.toThrow("Interrupted by SIGTERM");
      expect(raise).toHaveBeenCalledExactlyOnceWith(process.pid, "SIGTERM");
    } finally {
      raise.mockRestore();
    }
    expect(run.calls.filter((command) => command.startsWith("stop "))).toHaveLength(1);
    expect(run.calls.filter((command) => command.startsWith("stack destroy "))).toHaveLength(1);
    expect(run.dependencies.removeProject).toHaveBeenCalledOnce();
    expect(run.release).toHaveBeenCalledOnce();
    expect(process.listenerCount("SIGTERM")).toBe(0);
    expect(process.listenerCount("SIGINT")).toBe(0);
  });

  it("reports a cleanup failure on the signal path before the process ends", async () => {
    const run = createDependencies({ failDestroy: true });
    const raise = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      run.dependencies.runRls = vi.fn(async () => {
        process.emit("SIGINT", "SIGINT");
        expect(run.dependencies.log).toHaveBeenCalledWith("Cleanup failed after SIGINT: destroy failed");
      });
      await expect(runLocalSupabaseCi(run.dependencies)).rejects.toThrow("Interrupted by SIGINT");
      expect(run.dependencies.runRls).toHaveBeenCalledOnce();
    } finally {
      raise.mockRestore();
    }
  });

  it("refuses to start a fifth native run before preparing anything", async () => {
    const run = createDependencies();
    run.dependencies.acquireStackSlot = vi.fn(async () => {
      throw new NativeStackLimitError("Native Supabase run limit reached: 4 of 4 slots are held");
    });
    await expect(runLocalSupabaseCi(run.dependencies)).rejects.toThrow(
      "Phase failed: reserve native stack slot: Native Supabase run limit reached"
    );
    expect(run.calls).toEqual(["--version"]);
    expect(run.dependencies.prepareProject).not.toHaveBeenCalled();
  });

  it("stops after a reset failure and treats cleanup failure as fatal", async () => {
    const versionFailure = createDependencies({ cliVersionOutput: "2.121.0\nupdate notification" });
    await expect(runLocalSupabaseCi(versionFailure.dependencies)).rejects.toThrow("must be exactly 2.120.0");
    expect(versionFailure.dependencies.prepareProject).not.toHaveBeenCalled();

    const resetFailure = createDependencies({ failReset: true });
    await expect(runLocalSupabaseCi(resetFailure.dependencies)).rejects.toThrow(
      "Phase failed: reset local database"
    );
    expect(resetFailure.calls.slice(-2)).toEqual([
      "stop --workdir C:/temp/miaouffrage-supabase-ci-test",
      "stack destroy --yes --workdir C:/temp/miaouffrage-supabase-ci-test",
    ]);

    // `stop` alone keeps the stack data: a failed stop must still attempt the
    // destroy, and either failure fails the run.
    const stopFailure = createDependencies({ failStop: true });
    await expect(runLocalSupabaseCi(stopFailure.dependencies)).rejects.toThrow(
      "Local Supabase CI cleanup failed"
    );
    expect(stopFailure.calls.at(-1)).toBe(
      "stack destroy --yes --workdir C:/temp/miaouffrage-supabase-ci-test"
    );
    expect(stopFailure.dependencies.removeProject).toHaveBeenCalledOnce();

    const destroyFailure = createDependencies({ failDestroy: true });
    await expect(runLocalSupabaseCi(destroyFailure.dependencies)).rejects.toThrow(
      "Local Supabase CI cleanup failed"
    );

    // An arbitrary application error can quote fixture identities: it stays
    // hidden. Only a SafeDiagnosticError reaches the phase message.
    const applicationFailure = createDependencies();
    const runApplication = vi.fn().mockRejectedValue(new Error("application failed for army-ci@example.test"));
    await expect(runLocalSupabaseCi({
      ...applicationFailure.dependencies,
      runApplication,
    })).rejects.toThrow(/^Phase failed: run application validation$/);
    expect(applicationFailure.calls.slice(-2)).toEqual([
      "stop --workdir C:/temp/miaouffrage-supabase-ci-test",
      "stack destroy --yes --workdir C:/temp/miaouffrage-supabase-ci-test",
    ]);
    expect(applicationFailure.dependencies.removeProject).toHaveBeenCalledOnce();

    const diagnosedFailure = createDependencies();
    await expect(runLocalSupabaseCi({
      ...diagnosedFailure.dependencies,
      runApplication: vi.fn().mockRejectedValue(
        new SafeDiagnosticError("Could not create the local ARMY account [step create account: AuthRetryableFetchError status=0]")
      ),
    })).rejects.toThrow(
      /^Phase failed: run application validation: Could not create the local ARMY account \[step create account: AuthRetryableFetchError status=0\]$/
    );
    expect(diagnosedFailure.dependencies.removeProject).toHaveBeenCalledOnce();
  });

  it("keeps its event loop running during a child so stale keep-alive sockets are not reused", async () => {
    // TesterArmy CI 17/10/2026: the runner held keep-alive sockets to the
    // native gateway (Keep-Alive: timeout=5, closed after 6 s) while the RLS
    // matrix ran under spawnSync. When that child outlived the close, the
    // hook's first createUser went out on the closed socket: UND_ERR_SOCKET.
    const server = http.createServer((request, response) => {
      request.resume();
      request.on("end", () => response.end("ok"));
    });
    // Advertises timeout=3, which undici keeps; the socket closes at 3 s.
    server.keepAliveTimeout = 3_000;
    server.keepAliveTimeoutBuffer = 0;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/`;
    const post = async () => (await fetch(url, { method: "POST", body: "{}" })).text();
    try {
      // The three RLS users are created on one pooled connection.
      for (let index = 0; index < 3; index += 1) await post();
      const child = await runChildProcess(process.execPath, ["-e", "setTimeout(() => process.stdout.write('done'), 3500)"], {
        cwd: process.cwd(), env: process.env, maxBuffer: 1024,
      });
      expect(child).toEqual({ status: 0, stdout: "done", stderr: "" });
      await expect(post()).resolves.toBe("ok");
      const flood = await runChildProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(4096))"], {
        cwd: process.cwd(), env: process.env, maxBuffer: 1024,
      });
      expect(flood.error?.message).toBe("Child output exceeded 1024 bytes");
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15_000);

  it("describes Supabase and network failures by allowlisted identifiers only", () => {
    const email = "army-ci-0f3a@example.test";
    const authError = Object.assign(new Error(`Email address "${email}" is invalid`), {
      name: "AuthApiError", status: 400, code: "email_address_invalid",
    });
    expect(describeSafeFailure(authError)).toBe("AuthApiError status=400 code=email_address_invalid");
    // auth-js reports a dropped connection without HTTP status or cause.
    expect(describeSafeFailure(Object.assign(new Error("fetch failed"), { name: "AuthRetryableFetchError", status: 0 })))
      .toBe("AuthRetryableFetchError status=0");
    const network = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error(`other side closed - local: 127.0.0.1:41000, remote: 127.0.0.1:54321 ${email}`), {
        name: "SocketError", code: "UND_ERR_SOCKET",
      }),
    });
    expect(describeSafeFailure(network)).toBe("TypeError cause=SocketError:UND_ERR_SOCKET");
    // A PostgREST error carries row values in message/details; its HTTP
    // status comes from the response.
    const rowError = { message: `duplicate ${email}`, details: `Key (work_email)=(${email}) exists.`, hint: "", code: "23505" };
    expect(describeSafeFailure(rowError, 409)).toBe("status=409 code=23505");
    const hostile = {
      name: "postgresql://postgres:secret@127.0.0.1:54322/postgres",
      code: `Bearer ${localJwt("service_role")}`,
      status: "500",
      cause: { name: email, code: "sb_secret_0123456789" },
    };
    expect(describeSafeFailure(hostile, 1.5)).toBe("unidentified failure");
    expect(describeSafeFailure(undefined)).toBe("unidentified failure");
  });

  it("refuses hosts the Supabase native runtime does not support", () => {
    const linux = { platform: "linux" as const, arch: "x64", release: "6.6.87", glibcVersion: "2.39", uid: 1000 };
    expect(() => assertNativeRuntimeHost(linux)).not.toThrow();
    expect(() =>
      assertNativeRuntimeHost({ platform: "darwin", arch: "arm64", release: "23.4.0", uid: 501 })
    ).not.toThrow();
    expect(() =>
      assertNativeRuntimeHost({ platform: "win32", arch: "x64", release: "10.0.26200" })
    ).toThrow("WSL");
    expect(() => assertNativeRuntimeHost({ ...linux, glibcVersion: "2.31" })).toThrow("glibc 2.35");
    expect(() => assertNativeRuntimeHost({ ...linux, glibcVersion: undefined })).toThrow("glibc 2.35");
    expect(() =>
      assertNativeRuntimeHost({ platform: "darwin", arch: "x64", release: "23.4.0", uid: 501 })
    ).toThrow("Apple silicon");
    expect(() =>
      assertNativeRuntimeHost({ platform: "darwin", arch: "arm64", release: "22.6.0", uid: 501 })
    ).toThrow("macOS 14");
    expect(() => assertNativeRuntimeHost({ ...linux, uid: 0 })).toThrow("root");
  });

  it("enables the stack runtime inside the single experimental table", () => {
    const crlf = "[db]\r\nport = 1\r\n\r\n[experimental]\r\norioledb_version = \"\"\r\n";
    expect(enableNativeStack(crlf)).toBe(
      "[db]\r\nport = 1\r\n\r\n[experimental]\r\nstack = true\r\norioledb_version = \"\"\r\n"
    );
    expect(enableNativeStack("[db]\nport = 1\n")).toBe(
      "[db]\nport = 1\n\n[experimental]\nstack = true\n"
    );
    expect(() => enableNativeStack("[experimental]\na = 1\n[experimental]\nb = 2\n")).toThrow(
      "[experimental]"
    );
  });

  it("rejects remote configuration, unsafe flags and non-loopback status", () => {
    expect(() =>
      assertNoRemoteSupabaseEnvironment({ SUPABASE_ACCESS_TOKEN: "configured" })
    ).toThrow("SUPABASE_ACCESS_TOKEN");
    expect(() =>
      assertNoRemoteSupabaseEnvironment({ supabase_url: "https://remote.test" })
    ).toThrow("supabase_url");
    expect(() =>
      assertNoRemoteSupabaseEnvironment({ Supabase_Go_Binary: "substitute" })
    ).toThrow("Supabase_Go_Binary");
    expect(() =>
      assertNoRemoteSupabaseEnvironment({
        SUPABASE_INTERNAL_IMAGE_REGISTRY: "remote.registry.test",
      })
    ).toThrow("SUPABASE_INTERNAL_IMAGE_REGISTRY");
    // Destroying a stack deletes its data: only the disposable CI workdir may be targeted.
    expect(() =>
      assertLocalOnlySupabaseArgs(["stack", "destroy", "--yes", "--workdir", "C:/projects/miaouffrage"])
    ).toThrow("not allowlisted");
    expect(() => assertLocalOnlySupabaseArgs(["stack", "destroy", "--all", "--yes"])).toThrow(
      "not allowlisted"
    );
    expect(() =>
      assertLocalOnlySupabaseArgs(["start", "--runtime", "docker", "--workdir", "C:/temp/miaouffrage-supabase-ci-test"])
    ).toThrow("not allowlisted");
    expect(() =>
      assertLocalOnlySupabaseArgs(["stack", "destroy", "--yes", "--workdir", "C:/temp/miaouffrage-supabase-ci-test"])
    ).not.toThrow();
    expect(
      createLocalCiEnvironment({
        OPENAI_API_KEY: "must-not-reach-child",
        PATH: "system-path",
        S3_SECRET_KEY: "must-not-reach-child",
        SUPABASE_TELEMETRY_DISABLED: "1",
      })
    ).toEqual({ PATH: "system-path", SUPABASE_TELEMETRY_DISABLED: "1" });
    expect(() => assertLocalOnlySupabaseArgs(["db", "reset", "--linked"])).toThrow(
      "not allowlisted"
    );
    expect(() => assertLocalOnlySupabaseArgs(["migration", "list"])).toThrow(
      "not allowlisted"
    );
    expect(() =>
      assertLocalOnlySupabaseArgs(["functions", "deploy", "unsafe"])
    ).toThrow("not allowlisted");
    expect(() =>
      assertLocalOnlySupabaseArgs([
        "db",
        "reset",
        "--local",
        "--workdir",
        "C:/projects/production",
      ])
    ).toThrow("not allowlisted");
    expect(() =>
      assertLocalOnlySupabaseArgs([
        "test",
        "db",
        "--local",
        "C:/outside/tests",
        "--workdir",
        "C:/temp/miaouffrage-supabase-ci-test",
      ])
    ).toThrow("not allowlisted");
    // --files: several pgTAP paths, every one inside the isolated workdir.
    const tests = path.join(os.tmpdir(), "miaouffrage-supabase-ci-test", "supabase", "tests", "database");
    const workdir = path.join(os.tmpdir(), "miaouffrage-supabase-ci-test");
    expect(() => assertLocalOnlySupabaseArgs([
      "test", "db", "--local", path.join(tests, "a.test.sql"), path.join(tests, "b.test.sql"), "--workdir", workdir,
    ])).not.toThrow();
    for (const outside of ["/outside/b.test.sql", "--linked", ""]) {
      expect(() => assertLocalOnlySupabaseArgs([
        "test", "db", "--local", path.join(tests, "a.test.sql"), outside, "--workdir", workdir,
      ])).toThrow("not allowlisted");
    }
    expect(() =>
      parseLocalSupabaseStatus(
        [
          'API_URL="https://remote.supabase.co"',
          'ANON_KEY="anon"',
          'SERVICE_ROLE_KEY="service"',
        ].join("\n")
      )
    ).toThrow("non-loopback");
    expect(() =>
      parseLocalSupabaseStatus(
        [
          'API_URL="http://127.0.0.1:54321"',
          `ANON_KEY="${localJwt("service_role")}"`,
          `SERVICE_ROLE_KEY="${localJwt("anon")}"`,
        ].join("\n")
      )
    ).toThrow("role anon");
    expect(() => parseLocalSupabaseStatus('API_URL="http://127.0.0.1:54321"')).toThrow(
      "all required values"
    );
    for (const databaseUrl of [
      "postgresql://postgres:secret@remote.test:54322/postgres",
      "postgresql://postgres:secret@localhost:54322/postgres",
      "postgresql://postgres:secret@127.0.0.1:54322/postgres?host=remote.test",
      "postgresql://postgres:secret@127.0.0.1:54322/other",
      "not-a-url-secret",
    ]) {
      expect(() => parseLocalSupabaseStatus([
        'API_URL="http://127.0.0.1:54321"',
        `ANON_KEY="${localJwt("anon")}"`,
        `SERVICE_ROLE_KEY="${localJwt("service_role")}"`,
        `DB_URL="${databaseUrl}"`,
      ].join("\n"))).toThrow("Local PostgreSQL status");
    }
  });

  it("keeps the RLS workflow local-only and fail-closed", () => {
    const workflow = fs.readFileSync(
      path.join(process.cwd(), ".github", "workflows", "e2e-rls-matrix.yml"),
      "utf8"
    );

    expect(workflow).toContain("run: npm run db:ci:local");
    expect(workflow).toContain("run: npm run supabase:migrations:git-guard");
    expect(workflow).toContain("fetch-depth: 0");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("github.event.pull_request.base.sha");
    // Hors pull request (passe nocturne), aucune base de diff n'est imposee :
    // le garde resout lui-meme origin/main en mode local.
    expect(workflow).toContain("github.event.pull_request.base.sha || ''");
    expect(workflow).toContain(
      "github.event_name == 'pull_request' && 'pull_request' || 'local'"
    );
    expect(workflow).not.toContain("github.event.before");
    expect(workflow).toContain("github.ref || github.run_id");
    expect(workflow).toContain(
      "cancel-in-progress: ${{ github.event_name == 'pull_request' }}"
    );
    expect(workflow).not.toContain("cancel-in-progress: true");
    expect(workflow.indexOf("supabase:migrations:git-guard")).toBeLessThan(
      workflow.indexOf("db:ci:local")
    );
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("continue-on-error");
    expect(workflow).not.toContain("exit 0");

    const rlsMatrix = fs.readFileSync(
      path.join(process.cwd(), "src", "lib", "estimates", "rls.e2e.test.ts"),
      "utf8"
    );
    expect(rlsMatrix).not.toContain("E2E_LOGIN_");
    for (const variableName of [
      "RLS_E2E_ADMIN_EMAIL",
      "RLS_E2E_ADMIN_PASSWORD",
      "RLS_E2E_ENGINEER_EMAIL",
      "RLS_E2E_ENGINEER_PASSWORD",
      "RLS_E2E_VIEWER_EMAIL",
      "RLS_E2E_VIEWER_PASSWORD",
    ]) {
      expect(rlsMatrix).toContain(`envValueOrThrow(\"${variableName}\")`);
    }
  });

  it("requires exactly two completed RLS tests", () => {
    expect(() =>
      validateRlsMatrixReport(
        JSON.stringify({
          numFailedTests: 0,
          numPassedTests: 2,
          numPendingTests: 0,
          numTodoTests: 0,
          numTotalTests: 2,
          success: true,
        })
      )
    ).not.toThrow();
    expect(() => validateRlsMatrixReport("not-json")).toThrow("invalid JSON");
    expect(() =>
      validateRlsMatrixReport(
        JSON.stringify({
          numFailedTests: 0,
          numPassedTests: 1,
          numPendingTests: 1,
          numTodoTests: 0,
          numTotalTests: 2,
          success: false,
        })
      )
    ).toThrow("exactly two");
    expect(() =>
      validateRlsMatrixReport(
        JSON.stringify({
          numFailedTests: 0,
          numPassedTests: 2,
          numPendingTests: 0,
          numTodoTests: 1,
          numTotalTests: 3,
          success: false,
        })
      )
    ).toThrow("exactly two");
  });
});

function snapshotFingerprint(overrides: { policies?: string; stack?: string } = {}): DatabaseFingerprint {
  const components = {
    columns: "10:aa",
    data: "5:bb",
    policies: overrides.policies ?? "2:cc",
    stack_state: overrides.stack ?? "2:dd",
  };
  return {
    schema: `${components.columns}|${components.policies}`.padEnd(64, "0"),
    data: components.data.padEnd(64, "0"),
    stack: components.stack_state.padEnd(64, "0"),
    components,
  };
}

function createSnapshotOperations(options: {
  afterRestore?: DatabaseFingerprint;
  failRecord?: boolean;
  failRestore?: boolean;
  hit?: boolean;
  migrations?: string[];
} = {}) {
  const events: string[] = [];
  const snapshot: DatabaseSnapshot = {
    directory: "/snapshots/army",
    dumpPath: "/snapshots/army/postgres.dump",
    manifest: {
      fingerprint: snapshotFingerprint(),
      migrations: options.migrations ?? ["001", "002"],
    } as DatabaseSnapshotManifest,
  };
  let restored = false;
  const operations: DatabaseSnapshotOperations = {
    computeKey: vi.fn((postgresBundle: string) => {
      events.push(`key ${postgresBundle}`);
      return { key: "k".repeat(64), supabaseCli: PINNED_SUPABASE_CLI_VERSION, postgresBundle, configTemplateSha256: "c".repeat(64), files: [] };
    }),
    fingerprint: vi.fn(() => {
      events.push("fingerprint");
      return restored ? options.afterRestore ?? snapshotFingerprint() : snapshotFingerprint();
    }),
    lookUp: vi.fn(() => {
      events.push("look up");
      return options.hit ? { hit: true as const, snapshot } : { hit: false as const, reason: "no snapshot recorded" };
    }),
    record: vi.fn(() => {
      events.push("record");
      if (options.failRecord) throw new Error("pg_dump failed with exit code 1");
      return { dump: { bytes: 3_500_000 } } as DatabaseSnapshotManifest;
    }),
    resolveTools: vi.fn(() => ({ bundle: "17.11.0.004-r1", pgDump: "/pg/pg_dump", pgRestore: "/pg/pg_restore", psql: "/pg/psql" })),
    restore: vi.fn(() => {
      events.push("restore");
      if (options.failRestore) throw new Error("pg_restore failed with exit code 1");
      restored = true;
    }),
  };
  return { events, operations };
}

describe("local Supabase CI database snapshot", () => {
  const projectRoot = "C:/temp/miaouffrage-supabase-ci-test";
  const snapshotEnvironment = { ARMY_DB_SNAPSHOT_DIR: path.join(os.tmpdir(), "army-db-snapshot-unit") };
  const migrationOutput = JSON.stringify({ migrations: [{ local: "002", remote: "002" }, { local: "001", remote: "001" }] });

  function snapshotRun(options: Parameters<typeof createSnapshotOperations>[0] = {}) {
    const run = createDependencies({ migrationOutput });
    const snapshot = createSnapshotOperations(options);
    return {
      ...run,
      ...snapshot,
      dependencies: { ...run.dependencies, environment: snapshotEnvironment, databaseSnapshot: snapshot.operations },
      logs: () => run.dependencies.log.mock.calls.flat().join("\n"),
    };
  }

  it("records the reset database on a miss, before pgTAP touches it", async () => {
    const run = snapshotRun();
    await expect(runLocalSupabaseCi(run.dependencies)).resolves.toEqual({
      database: { source: "reset", snapshot: "recorded", key: "k".repeat(64) },
    });
    expect(run.calls.slice(0, 6)).toEqual([
      "--version",
      `start --runtime native --workdir ${projectRoot}`,
      `status --env --workdir ${projectRoot}`,
      `db reset --local --workdir ${projectRoot}`,
      `migration list --local --output-format json --workdir ${projectRoot}`,
      expect.stringMatching(/^test db --local /),
    ]);
    expect(run.events).toEqual(["key 17.11.0.004-r1", "look up", "fingerprint", "record"]);
    expect(run.operations.record).toHaveBeenCalledWith(expect.objectContaining({
      directory: snapshotEnvironment.ARMY_DB_SNAPSHOT_DIR,
      databaseUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      migrations: ["001", "002"],
    }));
    expect(run.logs()).toContain("Database snapshot miss (no snapshot recorded); running db reset.");
    expect(run.logs()).not.toContain("postgresql://");
    expect(run.dependencies.runRls).toHaveBeenCalledOnce();
  });

  it("restores a verified snapshot instead of db reset and still runs pgTAP and RLS", async () => {
    const run = snapshotRun({ hit: true });
    await expect(runLocalSupabaseCi(run.dependencies)).resolves.toEqual({
      database: { source: "snapshot", snapshot: "restored", key: "k".repeat(64) },
    });
    expect(run.calls.some((command) => command.startsWith("db reset"))).toBe(false);
    expect(run.calls.some((command) => command.startsWith("migration list --local"))).toBe(true);
    expect(run.calls.some((command) => command.startsWith("test db --local"))).toBe(true);
    expect(run.events).toEqual(["key 17.11.0.004-r1", "look up", "fingerprint", "restore", "fingerprint"]);
    expect(run.operations.record).not.toHaveBeenCalled();
    expect(run.dependencies.runRls).toHaveBeenCalledOnce();
    expect(run.logs()).toContain("Database snapshot verified");
  });

  it("falls back to db reset and records again when the restored catalog differs", async () => {
    const run = snapshotRun({ hit: true, afterRestore: snapshotFingerprint({ policies: "3:cc" }) });
    await expect(runLocalSupabaseCi(run.dependencies)).resolves.toEqual({
      database: {
        source: "reset",
        snapshot: "rejected",
        key: "k".repeat(64),
        reason: "fingerprint policies differs",
      },
    });
    const reset = run.calls.indexOf(`db reset --local --workdir ${projectRoot}`);
    expect(reset).toBeGreaterThan(run.calls.indexOf(`migration list --local --output-format json --workdir ${projectRoot}`));
    expect(run.calls.filter((command) => command.startsWith("migration list --local"))).toHaveLength(2);
    expect(run.events).toEqual(["key 17.11.0.004-r1", "look up", "fingerprint", "restore", "fingerprint", "fingerprint", "record"]);
    expect(run.logs()).toContain("falling back to db reset");
    expect(run.dependencies.runRls).toHaveBeenCalledOnce();
  });

  it("rejects a restore that loses this stack's own state or applied migrations", async () => {
    const lostStack = snapshotRun({ hit: true, afterRestore: snapshotFingerprint({ stack: "2:ee" }) });
    await expect(runLocalSupabaseCi(lostStack.dependencies)).resolves.toMatchObject({
      database: { source: "reset", snapshot: "rejected", reason: "this stack's own state did not survive the restore" },
    });
    expect(lostStack.calls.some((command) => command.startsWith("db reset"))).toBe(true);

    const otherMigrations = snapshotRun({ hit: true, migrations: ["001"] });
    await expect(runLocalSupabaseCi(otherMigrations.dependencies)).resolves.toMatchObject({
      database: { source: "reset", snapshot: "rejected", reason: "applied migrations differ from the snapshot" },
    });
  });

  it("falls back to db reset when the restore itself fails", async () => {
    const run = snapshotRun({ hit: true, failRestore: true });
    await expect(runLocalSupabaseCi(run.dependencies)).resolves.toMatchObject({
      database: { source: "reset", snapshot: "rejected", reason: "restore failed: pg_restore failed with exit code 1" },
    });
    expect(run.calls.some((command) => command.startsWith("db reset"))).toBe(true);
    expect(run.events.at(-1)).toBe("record");
  });

  it("reports the provenance before pgTAP, so a run that fails afterwards still records it", async () => {
    // The failed runs are the ones where a restored snapshot must be ruled out.
    const run = snapshotRun({ hit: true });
    const reported: unknown[] = [];
    const onDatabaseProvenance = vi.fn((provenance: unknown) => {
      reported.push(provenance);
      run.calls.push("provenance reported");
    });
    const runApplication = vi.fn(async () => {
      throw new Error("journey failed");
    });
    await expect(runLocalSupabaseCi({ ...run.dependencies, onDatabaseProvenance, runApplication }))
      .rejects.toThrow("Phase failed: run application validation");
    expect(reported).toEqual([{ source: "snapshot", snapshot: "restored", key: "k".repeat(64) }]);
    const reportedAt = run.calls.indexOf("provenance reported");
    expect(reportedAt).toBeGreaterThan(-1);
    expect(reportedAt).toBeLessThan(run.calls.findIndex((command) => command.startsWith("test db --local")));

    const failedPgTap = snapshotRun();
    const pgTapProvenance = vi.fn();
    await expect(runLocalSupabaseCi({
      ...failedPgTap.dependencies,
      onDatabaseProvenance: pgTapProvenance,
      supabase: vi.fn((args: string[], capture?: boolean) => {
        if (args.join(" ").startsWith("test db --local")) throw new Error("pgTAP failed");
        return failedPgTap.dependencies.supabase(args, capture);
      }),
    })).rejects.toThrow("Phase failed: run pgTAP");
    expect(pgTapProvenance).toHaveBeenCalledExactlyOnceWith({ source: "reset", snapshot: "recorded", key: "k".repeat(64) });
  });

  it("keeps the run's evidence when recording fails, and refuses an invalid directory before starting", async () => {
    const run = snapshotRun({ failRecord: true });
    await expect(runLocalSupabaseCi(run.dependencies)).resolves.toMatchObject({
      database: { source: "reset", snapshot: "not-recorded" },
    });
    expect(run.logs()).toContain("Database snapshot not recorded: pg_dump failed with exit code 1");
    expect(run.dependencies.runRls).toHaveBeenCalledOnce();

    const invalid = snapshotRun();
    await expect(runLocalSupabaseCi({
      ...invalid.dependencies,
      environment: { ARMY_DB_SNAPSHOT_DIR: "relative/snapshot" },
    })).rejects.toThrow("ARMY_DB_SNAPSHOT_DIR must be an absolute path");
    expect(invalid.dependencies.prepareProject).not.toHaveBeenCalled();
  });
});
