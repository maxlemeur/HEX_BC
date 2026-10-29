import { describe, expect, it, vi } from "vitest";

import {
  createLocalOnlyEnvironment,
  resolveNpmInvocation,
  runProductionBuildSmoke,
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
          '<html>Vos affaires, du dossier au devis.<script src="/_next/static/chunks/app-build.js"></script></html>',
          {
          headers: { "content-type": "text/html; charset=utf-8" },
          status: 200,
          }
        );
      }
      const legalPages: Record<string, string> = {
        "/confidentialite": "Politique de confidentialité",
        "/conditions": "Conditions d’utilisation",
        "/suppression-des-donnees": "Supprimer vos données ou déconnecter Drive",
      };
      if (legalPages[path]) {
        return new Response(`<html>${legalPages[path]}</html>`, {
          headers: { "content-type": "text/html; charset=utf-8" },
          status: 200,
        });
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
  it("runs the canonical build, starts on loopback, probes the bundle and cleans up", async () => {
    const harness = createHarness();

    await runProductionBuildSmoke(harness.dependencies);

    expect(harness.commands).toHaveLength(2);
    expect(harness.commands[0]).toMatchObject({
      command: "npm",
      args: ["run", "build"],
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
      "/confidentialite",
      "/conditions",
      "/suppression-des-donnees",
      "/dashboard",
      "/_next/static/chunks/app-build.js",
    ]);
    expect(harness.terminate).toHaveBeenCalledOnce();
    expect(harness.closeAuthStub).toHaveBeenCalledOnce();
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
