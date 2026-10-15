import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  assertNativeRuntimeHost,
  enableNativeStack,
  parseLocalSupabaseStatus,
  runLocalSupabaseCi,
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
      return "migration-output";
    }
    if (command.startsWith("test db --local")) {
      const fileCount = fs.readdirSync(path.join(process.cwd(), "supabase", "tests", "database"))
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

  return {
    calls,
    dependencies: {
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
    await runLocalSupabaseCi({ ...dependencies, runApplication });
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

    const applicationFailure = createDependencies();
    const runApplication = vi.fn().mockRejectedValue(new Error("application failed"));
    await expect(runLocalSupabaseCi({
      ...applicationFailure.dependencies,
      runApplication,
    })).rejects.toThrow("Phase failed: run application validation");
    expect(applicationFailure.calls.slice(-2)).toEqual([
      "stop --workdir C:/temp/miaouffrage-supabase-ci-test",
      "stack destroy --yes --workdir C:/temp/miaouffrage-supabase-ci-test",
    ]);
    expect(applicationFailure.dependencies.removeProject).toHaveBeenCalledOnce();
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
