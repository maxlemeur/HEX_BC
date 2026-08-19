import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  assertLocalDockerEndpoint,
  assertNoDockerRoutingEnvironment,
  parseLocalSupabaseStatus,
  runLocalSupabaseCi,
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

function createDependencies(options: { failReset?: boolean; failStop?: boolean } = {}) {
  const calls: string[] = [];
  const log = vi.fn();
  const supabase = vi.fn((args: string[], capture = false) => {
    const command = args.join(" ");
    calls.push(command);
    if (command === "--version") {
      return PINNED_SUPABASE_CLI_VERSION;
    }
    if (options.failReset && command.startsWith("db reset --local")) {
      throw new Error("reset failed");
    }
    if (options.failStop && command.startsWith("stop ")) {
      throw new Error("stop failed");
    }
    if (command.startsWith("migration list --local")) {
      return "migration-output";
    }
    if (command.startsWith("status ") && capture) {
      return [
        'NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"',
        `NEXT_PUBLIC_SUPABASE_ANON_KEY="${localJwt("anon")}"`,
        `SUPABASE_SERVICE_ROLE_KEY="${localJwt("service_role")}"`,
      ].join("\r\n");
    }
    return "";
  });

  return {
    calls,
    dependencies: {
      ensureDocker: vi.fn(),
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
      removeProject: vi.fn(),
      supabase,
      validateProject: vi.fn(() => []),
      verifyMigrations: vi.fn(() => []),
    },
  };
}

describe("local Supabase CI", () => {
  it("runs every local phase in order and never logs captured keys", async () => {
    const { calls, dependencies } = createDependencies();
    await runLocalSupabaseCi(dependencies);
    const projectRoot = "C:/temp/miaouffrage-supabase-ci-test";
    const databaseTests = path.join(
      projectRoot,
      "supabase",
      "tests",
      "database"
    );

    expect(calls).toEqual([
      "--version",
      `start --exclude edge-runtime,imgproxy,logflare,mailpit,postgres-meta,realtime,storage-api,studio,supavisor,vector --workdir ${projectRoot}`,
      `db reset --local --workdir ${projectRoot}`,
      `migration list --local --output-format json --workdir ${projectRoot}`,
      `test db --local ${databaseTests} --workdir ${projectRoot}`,
      `status -o env --override-name api.url=NEXT_PUBLIC_SUPABASE_URL --override-name auth.anon_key=NEXT_PUBLIC_SUPABASE_ANON_KEY --override-name auth.service_role_key=SUPABASE_SERVICE_ROLE_KEY --workdir ${projectRoot}`,
      "stop --project-id miaouffrage-ci-test --no-backup",
    ]);
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
  });

  it("stops after a reset failure and treats cleanup failure as fatal", async () => {
    const resetFailure = createDependencies({ failReset: true });
    await expect(runLocalSupabaseCi(resetFailure.dependencies)).rejects.toThrow(
      "Phase failed: reset local database"
    );
    expect(resetFailure.calls.at(-1)).toBe(
      "stop --project-id miaouffrage-ci-test --no-backup"
    );

    const stopFailure = createDependencies({ failStop: true });
    await expect(runLocalSupabaseCi(stopFailure.dependencies)).rejects.toThrow(
      "Local Supabase CI cleanup failed"
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
    expect(() =>
      assertNoDockerRoutingEnvironment({ DOCKER_HOST: "tcp://remote.test:2376" })
    ).toThrow("DOCKER_HOST");
    expect(() =>
      assertNoDockerRoutingEnvironment({ docker_context: "remote-builder" })
    ).toThrow("docker_context");
    expect(() => assertLocalDockerEndpoint("tcp://remote.test:2376")).toThrow(
      "non-local Docker endpoint"
    );
    expect(() => assertLocalDockerEndpoint('"ssh://builder.example.test"')).toThrow(
      "non-local Docker endpoint"
    );
    expect(() =>
      assertLocalDockerEndpoint("npipe:////remote-host/pipe/docker_engine")
    ).toThrow("non-local Docker endpoint");
    expect(() => assertLocalDockerEndpoint("unix:///var/run/docker.sock")).not.toThrow();
    expect(() =>
      assertLocalDockerEndpoint('"npipe:////./pipe/dockerDesktopLinuxEngine"')
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
          'NEXT_PUBLIC_SUPABASE_URL="https://remote.supabase.co"',
          'NEXT_PUBLIC_SUPABASE_ANON_KEY="anon"',
          'SUPABASE_SERVICE_ROLE_KEY="service"',
        ].join("\n")
      )
    ).toThrow("non-loopback");
    expect(() =>
      parseLocalSupabaseStatus(
        [
          'NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"',
          `NEXT_PUBLIC_SUPABASE_ANON_KEY="${localJwt("service_role")}"`,
          `SUPABASE_SERVICE_ROLE_KEY="${localJwt("anon")}"`,
        ].join("\n")
      )
    ).toThrow("role anon");
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
