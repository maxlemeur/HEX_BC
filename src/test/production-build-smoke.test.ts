import { describe, expect, it, vi } from "vitest";

import {
  createLocalOnlyEnvironment,
  extractNextStaticAssetPath,
  resolveNpmInvocation,
  runProductionBuildSmoke,
  terminateProcessTree,
  type CommandSpec,
  type ManagedProcess,
  type ProductionBuildSmokeDependencies,
} from "@/test/production-build-smoke";

function neverExits(): Promise<never> {
  return new Promise(() => undefined);
}

function createHarness(
  overrides: Partial<ProductionBuildSmokeDependencies> = {}
) {
  const commands: CommandSpec[] = [];
  const requests: string[] = [];
  const terminate = vi.fn(async () => undefined);
  const closeAuthStub = vi.fn(async () => undefined);
  const process: ManagedProcess = {
    exit: neverExits(),
    terminate,
  };

  const dependencies: ProductionBuildSmokeDependencies = {
    cwd: "C:/workspace/miaouffrage",
    environment: {
      GEMINI_API_KEY: "remote-gemini-secret",
      NEXT_PUBLIC_SUPABASE_URL: "https://remote.supabase.co",
      PATH: "test-path",
      SUPABASE_SERVICE_ROLE_KEY: "remote-service-role-secret",
    },
    nextCliPath: "C:/workspace/miaouffrage/node_modules/next/dist/bin/next",
    nodeExecutable: "C:/Program Files/nodejs/node.exe",
    platform: "linux",
    allocatePort: vi.fn(async () => 43127),
    startLocalAuthStub: vi.fn(async () => ({
      url: "http://127.0.0.1:43126",
      close: closeAuthStub,
    })),
    runCommand: vi.fn(async (spec) => {
      commands.push(spec);
    }),
    startCommand: vi.fn((spec) => {
      commands.push(spec);
      return process;
    }),
    fetch: vi.fn(async (input) => {
      const url = String(input);
      requests.push(new URL(url).pathname);
      const path = new URL(url).pathname;
      if (path === "/") {
        return new Response(
          '<html>Vos devis<script src="/_next/static/chunks/app-build.js"></script></html>',
          {
          headers: { "content-type": "text/html; charset=utf-8" },
          status: 200,
          }
        );
      }
      if (path === "/login") {
        return new Response("<html>Connexion</html>", {
          headers: { "content-type": "text/html; charset=utf-8" },
          status: 200,
        });
      }
      if (path === "/dashboard") {
        return new Response(null, {
          headers: { location: "http://127.0.0.1:43127/login" },
          status: 307,
        });
      }
      if (path === "/_next/static/chunks/app-build.js") {
        return new Response("self.__next_f = self.__next_f || [];", {
          headers: { "content-type": "application/javascript" },
          status: 200,
        });
      }
      throw new Error(`Unexpected request ${url}`);
    }),
    sleep: vi.fn(async () => undefined),
    now: vi.fn(() => 0),
    log: vi.fn(),
    ...overrides,
  };

  return {
    closeAuthStub,
    commands,
    dependencies,
    requests,
    terminate,
  };
}

describe("production build smoke", () => {
  it("builds with Webpack, starts on loopback, probes the bundle and cleans up", async () => {
    const harness = createHarness();

    await runProductionBuildSmoke(harness.dependencies);

    expect(harness.commands).toHaveLength(2);
    expect(harness.commands[0]).toMatchObject({
      command: "npm",
      args: ["run", "build", "--", "--webpack"],
      cwd: "C:/workspace/miaouffrage",
    });
    expect(harness.commands[1]).toMatchObject({
      command: "C:/Program Files/nodejs/node.exe",
      args: [
        "C:/workspace/miaouffrage/node_modules/next/dist/bin/next",
        "start",
        "--hostname",
        "127.0.0.1",
        "--port",
        "43127",
      ],
    });
    expect(harness.commands[0].environment).toMatchObject({
      GEMINI_API_KEY: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "production-smoke-local-anon-key",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:43126",
      PATH: "test-path",
      SUPABASE_SERVICE_ROLE_KEY: "",
    });
    expect(harness.requests).toEqual([
      "/",
      "/login",
      "/dashboard",
      "/_next/static/chunks/app-build.js",
    ]);
    expect(harness.terminate).toHaveBeenCalledOnce();
    expect(harness.closeAuthStub).toHaveBeenCalledOnce();
  });

  it("closes the local auth stub when the build fails", async () => {
    const runCommand = vi.fn(async () => {
      throw new Error("webpack failed");
    });
    const startCommand = vi.fn();
    const harness = createHarness({ runCommand, startCommand });

    await expect(runProductionBuildSmoke(harness.dependencies)).rejects.toThrow(
      "webpack failed"
    );

    expect(startCommand).not.toHaveBeenCalled();
    expect(harness.terminate).not.toHaveBeenCalled();
    expect(harness.closeAuthStub).toHaveBeenCalledOnce();
  });

  it("terminates the server and closes the stub when an HTTP assertion fails", async () => {
    const harness = createHarness({
      fetch: vi.fn(async (input) => {
        const path = new URL(String(input)).pathname;
        if (path === "/") {
          return new Response(
            '<html>Vos devis<script src="/_next/static/chunks/app-build.js"></script></html>',
            {
            headers: { "content-type": "text/html" },
            status: 200,
            }
          );
        }
        if (path === "/login") {
          return new Response("broken", {
            headers: { "content-type": "text/html" },
            status: 500,
          });
        }
        throw new Error(`Unexpected request ${path}`);
      }),
    });

    await expect(runProductionBuildSmoke(harness.dependencies)).rejects.toThrow(
      "/login returned HTTP 500"
    );

    expect(harness.terminate).toHaveBeenCalledOnce();
    expect(harness.closeAuthStub).toHaveBeenCalledOnce();
  });

  it("fails fast and cleans up when next start exits before readiness", async () => {
    const terminate = vi.fn(async () => undefined);
    const harness = createHarness({
      fetch: vi.fn(() => neverExits()),
      startCommand: vi.fn(() => ({
        exit: Promise.resolve({ code: 1, signal: null }),
        terminate,
      })),
    });

    await expect(runProductionBuildSmoke(harness.dependencies)).rejects.toThrow(
      "next start exited before readiness: exit code 1"
    );

    expect(terminate).toHaveBeenCalledOnce();
    expect(harness.closeAuthStub).toHaveBeenCalledOnce();
  });

  it("times out readiness and cleans up the server and local stub", async () => {
    let currentTime = 0;
    const harness = createHarness({
      fetch: vi.fn(async () => {
        throw new Error("connection refused");
      }),
      now: vi.fn(() => currentTime),
      sleep: vi.fn(async (durationMs) => {
        currentTime += durationMs;
      }),
    });

    await expect(
      runProductionBuildSmoke(harness.dependencies, {
        startupPollIntervalMs: 5,
        startupTimeoutMs: 10,
      })
    ).rejects.toThrow(
      "next start was not ready after 10 ms: connection refused"
    );

    expect(harness.terminate).toHaveBeenCalledOnce();
    expect(harness.closeAuthStub).toHaveBeenCalledOnce();
  });

  it("closes the auth stub and fails when server cleanup fails", async () => {
    const terminate = vi.fn(async () => {
      throw new Error("taskkill failed");
    });
    const harness = createHarness({
      startCommand: vi.fn(() => ({
        exit: neverExits(),
        terminate,
      })),
    });

    await expect(runProductionBuildSmoke(harness.dependencies)).rejects.toThrow(
      "Could not terminate next start: taskkill failed"
    );

    expect(terminate).toHaveBeenCalledOnce();
    expect(harness.closeAuthStub).toHaveBeenCalledOnce();
  });

  it("fails closed when local stub cleanup exceeds its timeout", async () => {
    const close = vi.fn(() => neverExits());
    const harness = createHarness({
      startLocalAuthStub: vi.fn(async () => ({
        url: "http://127.0.0.1:43126",
        close,
      })),
    });

    await expect(
      runProductionBuildSmoke(harness.dependencies, { cleanupTimeoutMs: 5 })
    ).rejects.toThrow("local auth stub cleanup timed out after 5 ms");

    expect(harness.terminate).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("fails when a stubborn process never reports exit after forced termination", async () => {
    const requestGracefulTermination = vi.fn(async () => undefined);
    const requestForcedTermination = vi.fn(async () => undefined);
    const waitForExit = vi.fn(async () => false);

    await expect(
      terminateProcessTree(
        {
          exitCode: null,
          signalCode: null,
          pid: 43210,
          kill: vi.fn(() => true),
        },
        neverExits(),
        {
          requestGracefulTermination,
          requestForcedTermination,
          waitForExit,
        }
      )
    ).rejects.toThrow(
      "Process tree 43210 did not exit after forced termination"
    );

    expect(requestGracefulTermination).toHaveBeenCalledOnce();
    expect(requestForcedTermination).toHaveBeenCalledOnce();
    expect(waitForExit).toHaveBeenCalledTimes(2);
  });

  it("extracts a build-owned Next static asset from rendered HTML", () => {
    expect(
      extractNextStaticAssetPath(
        '<link href="/_next/static/css/app.css?x=1&amp;y=2"><script src="/_next/static/chunks/app.js"></script>'
      )
    ).toBe("/_next/static/chunks/app.js");
    expect(() => extractNextStaticAssetPath("<html></html>")).toThrow(
      "did not reference a /_next/static build asset"
    );
  });

  it("uses npm without a Windows shell and masks known remote credentials", () => {
    expect(
      resolveNpmInvocation("win32", {}, "C:/Program Files/nodejs/node.exe")
    ).toEqual({
      command: "C:/Program Files/nodejs/node.exe",
      argsPrefix: ["C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js"],
    });
    expect(resolveNpmInvocation("linux", {})).toEqual({
      command: "npm",
      argsPrefix: [],
    });

    expect(
      createLocalOnlyEnvironment(
        {
          E2E_LOGIN_PASSWORD: "remote-password",
          RESEND_API_KEY: "remote-resend-key",
          SUPABASE_DB_URL: "postgresql://remote",
        },
        "http://127.0.0.1:5555"
      )
    ).toMatchObject({
      E2E_LOGIN_PASSWORD: "",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:5555",
      RESEND_API_KEY: "",
      SUPABASE_DB_URL: "",
    });
  });
});
