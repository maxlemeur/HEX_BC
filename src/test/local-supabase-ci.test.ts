import fs from "node:fs";
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
  describeSafeFailure,
  parseLocalSupabaseStatus,
  runLocalSupabaseCi,
  SafeDiagnosticError,
  validatePgTapReport,
  validateRlsMatrixReport,
} from "@/test/local-supabase-ci";
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
      // A whole pgTAP pass names its directory (database, ceiling or budget).
      const directory = path.basename(args.find((arg) => /[\\/]supabase[\\/]tests[\\/]\w+$/.test(arg)) ?? "database");
      const fileCount = selected || fs.readdirSync(path.join(process.cwd(), "supabase", "tests", directory))
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
      verifyDatabaseTypes: vi.fn(),
    },
  };
}

describe("local Supabase CI", () => {
  it("refuses generated-type drift before database/application qualification and destroys its owned stack", async () => {
    const { dependencies, calls, release } = createDependencies();
    dependencies.verifyDatabaseTypes.mockImplementation(() => { throw new Error("Generated database types differ"); });
    const runApplication = vi.fn();
    await expect(runLocalSupabaseCi({ ...dependencies, runApplication })).rejects.toThrow("Phase failed: verify generated database types");
    expect(calls.some((command) => command.startsWith("test db"))).toBe(false);
    expect(dependencies.provisionUsers).not.toHaveBeenCalled();
    expect(runApplication).not.toHaveBeenCalled();
    expect(calls.slice(-2)).toEqual([
      "stop --workdir C:/temp/miaouffrage-supabase-ci-test",
      "stack destroy --yes --workdir C:/temp/miaouffrage-supabase-ci-test",
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it("permits type generation only from its owned local public schema, never a URL or linked project", () => {
    const args = ["gen", "types", "--local", "--lang", "typescript", "--schema", "public", "--workdir", path.join(os.tmpdir(), "miaouffrage-supabase-ci-types")];
    expect(() => assertLocalOnlySupabaseArgs(args)).not.toThrow();
    for (const bad of [
      args.map((value) => value === "--local" ? "--linked" : value),
      [...args, "--db-url", "postgresql://remote.test/postgres"],
      args.map((value) => value === "public" ? "private" : value),
      [...args.slice(0, -1), process.cwd()],
    ]) expect(() => assertLocalOnlySupabaseArgs(bad)).toThrow("not allowlisted");
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
      `test db --local ${path.join(projectRoot, "supabase", "tests", "ceiling")} --workdir ${projectRoot}`,
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

  // Lot 3.1: a single-run wall-clock ceiling measured beside the Army production build failed correct code (the copy
  // probe reached 5,6 s there against 2,3 s where the database checks ran alone): the pass runs only alone.
  it("asserts the CI statement ceilings only where the database checks run alone, and fails the run on them", async () => {
    const projectRoot = "C:/temp/miaouffrage-supabase-ci-test";
    const ceiling = `test db --local ${path.join(projectRoot, "supabase", "tests", "ceiling")} --workdir ${projectRoot}`;
    const alongside = createDependencies();
    const onStackStarted = vi.fn();
    await runLocalSupabaseCi({ ...alongside.dependencies, onStackStarted });
    expect(onStackStarted).toHaveBeenCalledOnce();
    expect(alongside.calls).not.toContain(ceiling);
    expect(alongside.dependencies.log.mock.calls.flat().join("\n")).toContain("CI statement ceilings skipped");

    const over = createDependencies();
    await expect(runLocalSupabaseCi({
      ...over.dependencies,
      supabase: vi.fn((args: string[], capture?: boolean) => {
        if (args.join(" ") === ceiling) throw new Error("ceiling failed");
        return over.dependencies.supabase(args, capture);
      }),
    })).rejects.toThrow("Phase failed: run CI statement ceilings");
    expect(over.dependencies.runRls).not.toHaveBeenCalled();
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

  it("stops after a reset failure and treats cleanup failure as fatal", async () => {
    const versionFailure = createDependencies({ cliVersionOutput: "2.120.0\nupdate notification" });
    await expect(runLocalSupabaseCi(versionFailure.dependencies)).rejects.toThrow(`must be exactly ${PINNED_SUPABASE_CLI_VERSION}`);
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
      return { dump: { bytes: 3_500_000 } } as DatabaseSnapshotManifest;
    }),
    resolveTools: vi.fn(() => ({ bundle: "17.11.0.004-r1", pgDump: "/pg/pg_dump", pgRestore: "/pg/pg_restore", psql: "/pg/psql" })),
    restore: vi.fn(() => {
      events.push("restore");
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
});
