import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";

const LOOPBACK_HOST = "127.0.0.1";
const LOCAL_ANON_KEY = "production-smoke-local-anon-key";
const BUILD_TIMEOUT_MS = 20 * 60_000;
const STARTUP_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 4_000;
const CLEANUP_TIMEOUT_MS = 15_000;
const STARTUP_POLL_INTERVAL_MS = 250;
const require = createRequire(import.meta.url);

type FetchLike = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

type Environment = Readonly<Record<string, string | undefined>>;

export interface CommandSpec {
  command: string;
  args: readonly string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
}

export interface ProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

export interface ManagedProcess {
  exit: Promise<ProcessExit>;
  terminate: () => Promise<void>;
}

interface TerminableProcess {
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  pid?: number;
  kill: (signal?: NodeJS.Signals | number) => boolean;
}

export interface ProcessTreeTerminationDependencies {
  requestGracefulTermination: (child: TerminableProcess) => Promise<void>;
  requestForcedTermination: (child: TerminableProcess) => Promise<void>;
  waitForExit: (exit: Promise<ProcessExit>, timeoutMs: number) => Promise<boolean>;
}

export interface LocalHttpStub {
  url: string;
  close: () => Promise<void>;
}

export interface NpmInvocation {
  command: string;
  argsPrefix: readonly string[];
}

export interface ProductionBuildSmokeOptions {
  buildTimeoutMs: number;
  cleanupTimeoutMs: number;
  startupTimeoutMs: number;
  requestTimeoutMs: number;
  startupPollIntervalMs: number;
}

export interface ProductionBuildSmokeDependencies {
  cwd: string;
  environment: Environment;
  nextCliPath: string;
  nodeExecutable: string;
  platform: NodeJS.Platform;
  allocatePort: () => Promise<number>;
  startLocalAuthStub: () => Promise<LocalHttpStub>;
  runCommand: (spec: CommandSpec, timeoutMs: number) => Promise<void>;
  startCommand: (spec: CommandSpec) => ManagedProcess;
  fetch: FetchLike;
  sleep: (durationMs: number) => Promise<void>;
  now: () => number;
  log: (message: string) => void;
}

const DEFAULT_OPTIONS: ProductionBuildSmokeOptions = {
  buildTimeoutMs: BUILD_TIMEOUT_MS,
  cleanupTimeoutMs: CLEANUP_TIMEOUT_MS,
  startupTimeoutMs: STARTUP_TIMEOUT_MS,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
  startupPollIntervalMs: STARTUP_POLL_INTERVAL_MS,
};

const LOCAL_ONLY_ENVIRONMENT_OVERRIDES: Readonly<Record<string, string>> = {
  DATABASE_URL: "",
  E2E_LOGIN_EMAIL: "",
  E2E_LOGIN_PASSWORD: "",
  E2E_SUPABASE_SERVICE_ROLE_KEY: "",
  GEMINI_API_KEY: "",
  OPENAI_API_KEY: "",
  RESEND_API_KEY: "",
  RLS_E2E: "",
  RLS_E2E_ADMIN_EMAIL: "",
  RLS_E2E_ADMIN_PASSWORD: "",
  RLS_E2E_ENGINEER_EMAIL: "",
  RLS_E2E_ENGINEER_PASSWORD: "",
  RLS_E2E_VIEWER_EMAIL: "",
  RLS_E2E_VIEWER_PASSWORD: "",
  SOFINTHER_EMAIL: "",
  SOFINTHER_PASSWORD: "",
  SUPABASE_DB_URL: "",
  SUPABASE_SERVICE_ROLE_KEY: "",
  TAKEOFF_WORKER_SECRET: "",
};

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

function formatExit(result: ProcessExit) {
  if (result.error) {
    return result.error.message;
  }
  if (result.signal) {
    return `signal ${result.signal}`;
  }
  return `exit code ${String(result.code)}`;
}

function delay(durationMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, durationMs));
}

async function settlesWithin(
  promise: Promise<unknown>,
  timeoutMs: number
): Promise<boolean> {
  let timeout: NodeJS.Timeout | undefined;
  const settled = await Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => {
      timeout = setTimeout(() => resolve(false), timeoutMs);
    }),
  ]);
  if (timeout) {
    clearTimeout(timeout);
  }
  return settled;
}

async function runCleanupWithTimeout(
  cleanup: () => Promise<void>,
  label: string,
  timeoutMs: number
) {
  let timeout: NodeJS.Timeout | undefined;
  const outcome = await Promise.race([
    Promise.resolve()
      .then(cleanup)
      .then(
        () => ({ kind: "closed" as const }),
        (error: unknown) => ({ kind: "error" as const, error: asError(error) })
      ),
    new Promise<{ kind: "timeout" }>((resolve) => {
      timeout = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    }),
  ]);
  if (timeout) {
    clearTimeout(timeout);
  }
  if (outcome.kind === "timeout") {
    throw new Error(`${label} cleanup timed out after ${String(timeoutMs)} ms.`);
  }
  if (outcome.kind === "error") {
    throw outcome.error;
  }
}

async function waitForChild(child: ChildProcess) {
  return new Promise<void>((resolve) => {
    child.once("error", () => resolve());
    child.once("exit", () => resolve());
  });
}

function defaultProcessTreeTerminationDependencies(): ProcessTreeTerminationDependencies {
  return {
    requestGracefulTermination: async (child) => {
      if (!child.pid) {
        return;
      }
      if (process.platform === "win32") {
        const taskkill = spawn(
          "taskkill",
          ["/pid", String(child.pid), "/T", "/F"],
          {
            stdio: "ignore",
            windowsHide: true,
          }
        );
        await Promise.race([waitForChild(taskkill), delay(SHUTDOWN_TIMEOUT_MS)]);
        return;
      }
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    },
    requestForcedTermination: async (child) => {
      if (!child.pid) {
        return;
      }
      if (process.platform === "win32") {
        child.kill("SIGKILL");
        return;
      }
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    },
    waitForExit: settlesWithin,
  };
}

export async function terminateProcessTree(
  child: TerminableProcess,
  exit: Promise<ProcessExit>,
  dependencyOverrides: Partial<ProcessTreeTerminationDependencies> = {}
) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) {
    return;
  }
  const dependencies = {
    ...defaultProcessTreeTerminationDependencies(),
    ...dependencyOverrides,
  };

  await dependencies.requestGracefulTermination(child);
  if (await dependencies.waitForExit(exit, SHUTDOWN_TIMEOUT_MS)) {
    return;
  }

  await dependencies.requestForcedTermination(child);
  if (!(await dependencies.waitForExit(exit, SHUTDOWN_TIMEOUT_MS))) {
    throw new Error(
      `Process tree ${String(child.pid)} did not exit after forced termination.`
    );
  }
}

function spawnManagedProcess(spec: CommandSpec): ManagedProcess {
  const child = spawn(spec.command, [...spec.args], {
    cwd: spec.cwd,
    detached: process.platform !== "win32",
    env: spec.environment,
    shell: false,
    stdio: "inherit",
    windowsHide: true,
  });

  const exit = new Promise<ProcessExit>((resolve) => {
    child.once("error", (error) => {
      resolve({ code: null, signal: null, error });
    });
    child.once("exit", (code, signal) => {
      resolve({ code, signal });
    });
  });

  return {
    exit,
    terminate: () => terminateProcessTree(child, exit),
  };
}

async function runCommand(spec: CommandSpec, timeoutMs: number) {
  const managed = spawnManagedProcess(spec);
  let timeout: NodeJS.Timeout | undefined;
  const outcome = await Promise.race([
    managed.exit.then((result) => ({ kind: "exit" as const, result })),
    new Promise<{ kind: "timeout" }>((resolve) => {
      timeout = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
    }),
  ]);
  if (timeout) {
    clearTimeout(timeout);
  }

  if (outcome.kind === "timeout") {
    await managed.terminate();
    throw new Error(
      `Production build timed out after ${String(timeoutMs)} ms.`
    );
  }
  if (outcome.result.error || outcome.result.code !== 0) {
    throw new Error(`Production build failed: ${formatExit(outcome.result)}.`);
  }
}

export function resolveNpmInvocation(
  platform: NodeJS.Platform,
  environment: Environment,
  nodeExecutable = process.execPath
): NpmInvocation {
  if (platform !== "win32") {
    return { command: "npm", argsPrefix: [] };
  }

  const configuredNpmCli = environment.npm_execpath?.trim();
  const npmCli =
    configuredNpmCli ||
    path.win32.join(
      path.win32.dirname(nodeExecutable),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js"
    );
  return { command: nodeExecutable, argsPrefix: [npmCli] };
}

export function createLocalOnlyEnvironment(
  source: Environment,
  localAuthUrl: string
) {
  return {
    ...source,
    ...LOCAL_ONLY_ENVIRONMENT_OVERRIDES,
    DO_NOT_TRACK: "1",
    NEXT_TELEMETRY_DISABLED: "1",
    NODE_ENV: "production",
    NEXT_PUBLIC_ESTIMATE_PORTAL_BASE_URL: "http://127.0.0.1",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_URL: localAuthUrl,
    TAKEOFF_WORKER_URL: "http://127.0.0.1",
  } satisfies NodeJS.ProcessEnv;
}

export function allocateLoopbackPort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, LOOPBACK_HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate a loopback port for next start."));
        return;
      }
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(address.port);
        }
      });
    });
  });
}

function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
    server.closeIdleConnections();
    server.closeAllConnections();
  });
}

export async function startLocalAuthStub(): Promise<LocalHttpStub> {
  const server = createServer((_request, response) => {
    response.writeHead(401, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({ message: "Local production smoke has no session." }));
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(0, LOOPBACK_HOST, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Could not start the loopback Supabase auth stub.");
  }

  return {
    url: `http://${LOOPBACK_HOST}:${String(address.port)}`,
    close: () => closeServer(server),
  };
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  url: string,
  requestTimeoutMs: number
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
  try {
    return await fetchImpl(url, {
      cache: "no-store",
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`HTTP probe timed out for ${url}.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function assertTextResponse(input: {
  fetch: FetchLike;
  baseUrl: string;
  path: string;
  bodyMarker: string;
  contentType: string;
  requestTimeoutMs: number;
}) {
  const url = new URL(input.path, input.baseUrl).toString();
  const response = await fetchWithTimeout(input.fetch, url, input.requestTimeoutMs);
  if (response.status !== 200) {
    throw new Error(`${input.path} returned HTTP ${String(response.status)}, expected 200.`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes(input.contentType.toLowerCase())) {
    throw new Error(`${input.path} returned unexpected content type ${contentType || "missing"}.`);
  }
  const body = await response.text();
  if (!body.includes(input.bodyMarker)) {
    throw new Error(`${input.path} did not contain marker ${input.bodyMarker}.`);
  }
  return body;
}

export function extractNextStaticAssetPath(html: string) {
  const scriptMatch = html.match(
    /<script[^>]+src=["']([^"']*\/_next\/static\/[^"']+)["']/i
  );
  const anyAssetMatch = html.match(
    /(?:src|href)=["']([^"']*\/_next\/static\/[^"']+)["']/i
  );
  const rawPath = scriptMatch?.[1] ?? anyAssetMatch?.[1];
  if (!rawPath) {
    throw new Error("Home page did not reference a /_next/static build asset.");
  }
  const normalizedPath = rawPath.replaceAll("&amp;", "&");
  const parsed = new URL(normalizedPath, "http://127.0.0.1");
  if (!parsed.pathname.startsWith("/_next/static/")) {
    throw new Error(`Home page referenced unexpected build asset ${normalizedPath}.`);
  }
  return `${parsed.pathname}${parsed.search}`;
}

async function assertNextStaticAsset(input: {
  fetch: FetchLike;
  baseUrl: string;
  path: string;
  requestTimeoutMs: number;
}) {
  const response = await fetchWithTimeout(
    input.fetch,
    new URL(input.path, input.baseUrl).toString(),
    input.requestTimeoutMs
  );
  if (response.status !== 200) {
    throw new Error(
      `${input.path} returned HTTP ${String(response.status)}, expected 200.`
    );
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/html")) {
    throw new Error(`${input.path} unexpectedly returned an HTML fallback.`);
  }
  const body = await response.arrayBuffer();
  if (body.byteLength === 0) {
    throw new Error(`${input.path} returned an empty build asset.`);
  }
}

async function assertDashboardRedirect(input: {
  fetch: FetchLike;
  baseUrl: string;
  requestTimeoutMs: number;
}) {
  const response = await fetchWithTimeout(
    input.fetch,
    new URL("/dashboard", input.baseUrl).toString(),
    input.requestTimeoutMs
  );
  if (![301, 302, 303, 307, 308].includes(response.status)) {
    throw new Error(
      `/dashboard returned HTTP ${String(response.status)}, expected a redirect.`
    );
  }
  const location = response.headers.get("location");
  if (!location) {
    throw new Error("/dashboard redirect did not include a Location header.");
  }
  const baseUrl = new URL(input.baseUrl);
  const redirectUrl = new URL(location, baseUrl);
  if (redirectUrl.origin !== baseUrl.origin || redirectUrl.pathname !== "/login") {
    throw new Error(`/dashboard redirected to unexpected location ${redirectUrl.toString()}.`);
  }
}

async function waitForHomePage(input: {
  server: ManagedProcess;
  dependencies: ProductionBuildSmokeDependencies;
  options: ProductionBuildSmokeOptions;
  baseUrl: string;
}) {
  const deadline = input.dependencies.now() + input.options.startupTimeoutMs;
  let lastError = new Error("No HTTP response received.");

  while (input.dependencies.now() <= deadline) {
    const attempt = await Promise.race([
      assertTextResponse({
        fetch: input.dependencies.fetch,
        baseUrl: input.baseUrl,
        path: "/",
        bodyMarker: "Vos devis",
        contentType: "text/html",
        requestTimeoutMs: input.options.requestTimeoutMs,
      })
        .then((body) => ({ kind: "ready" as const, body }))
        .catch((error: unknown) => ({ kind: "retry" as const, error: asError(error) })),
      input.server.exit.then((result) => ({ kind: "exit" as const, result })),
    ]);

    if (attempt.kind === "ready") {
      return attempt.body;
    }
    if (attempt.kind === "exit") {
      throw new Error(`next start exited before readiness: ${formatExit(attempt.result)}.`);
    }
    lastError = attempt.error;

    const remainingMs = deadline - input.dependencies.now();
    if (remainingMs <= 0) {
      break;
    }
    await input.dependencies.sleep(
      Math.min(input.options.startupPollIntervalMs, remainingMs)
    );
  }

  throw new Error(
    `next start was not ready after ${String(input.options.startupTimeoutMs)} ms: ${lastError.message}`
  );
}

function defaultDependencies(): ProductionBuildSmokeDependencies {
  return {
    cwd: process.cwd(),
    environment: process.env,
    nextCliPath: require.resolve("next/dist/bin/next"),
    nodeExecutable: process.execPath,
    platform: process.platform,
    allocatePort: allocateLoopbackPort,
    startLocalAuthStub,
    runCommand,
    startCommand: spawnManagedProcess,
    fetch,
    sleep: delay,
    now: Date.now,
    log: console.log,
  };
}

export async function runProductionBuildSmoke(
  dependencyOverrides: Partial<ProductionBuildSmokeDependencies> = {},
  optionOverrides: Partial<ProductionBuildSmokeOptions> = {}
) {
  const dependencies = { ...defaultDependencies(), ...dependencyOverrides };
  const options = { ...DEFAULT_OPTIONS, ...optionOverrides };
  const npm = resolveNpmInvocation(
    dependencies.platform,
    dependencies.environment,
    dependencies.nodeExecutable
  );
  let authStub: LocalHttpStub | null = null;
  let application: ManagedProcess | null = null;
  let runError: Error | null = null;
  const cleanupErrors: Error[] = [];

  try {
    authStub = await dependencies.startLocalAuthStub();
    const environment = createLocalOnlyEnvironment(
      dependencies.environment,
      authStub.url
    );

    dependencies.log("Building the production bundle with Webpack...");
    await dependencies.runCommand(
      {
        command: npm.command,
        args: [...npm.argsPrefix, "run", "build", "--", "--webpack"],
        cwd: dependencies.cwd,
        environment,
      },
      options.buildTimeoutMs
    );

    const port = await dependencies.allocatePort();
    const baseUrl = `http://${LOOPBACK_HOST}:${String(port)}`;
    dependencies.log(`Starting the production server on ${baseUrl}...`);
    application = dependencies.startCommand({
      command: dependencies.nodeExecutable,
      args: [
        dependencies.nextCliPath,
        "start",
        "--hostname",
        LOOPBACK_HOST,
        "--port",
        String(port),
      ],
      cwd: dependencies.cwd,
      environment,
    });

    const homeHtml = await waitForHomePage({
      server: application,
      dependencies,
      options,
      baseUrl,
    });
    await assertTextResponse({
      fetch: dependencies.fetch,
      baseUrl,
      path: "/login",
      bodyMarker: "Connexion",
      contentType: "text/html",
      requestTimeoutMs: options.requestTimeoutMs,
    });
    await assertDashboardRedirect({
      fetch: dependencies.fetch,
      baseUrl,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    const nextAssetPath = extractNextStaticAssetPath(homeHtml);
    await assertNextStaticAsset({
      fetch: dependencies.fetch,
      baseUrl,
      path: nextAssetPath,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    dependencies.log("Production Webpack build and HTTP smoke passed.");
  } catch (error) {
    runError = asError(error);
  } finally {
    if (application) {
      try {
        await runCleanupWithTimeout(
          application.terminate,
          "next start",
          options.cleanupTimeoutMs
        );
      } catch (error) {
        cleanupErrors.push(
          new Error(`Could not terminate next start: ${asError(error).message}`)
        );
      }
    }
    if (authStub) {
      try {
        await runCleanupWithTimeout(
          authStub.close,
          "local auth stub",
          options.cleanupTimeoutMs
        );
      } catch (error) {
        cleanupErrors.push(
          new Error(`Could not close local auth stub: ${asError(error).message}`)
        );
      }
    }
  }

  const failures = runError ? [runError, ...cleanupErrors] : cleanupErrors;
  if (failures.length === 1) {
    throw failures[0];
  }
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      "Production build smoke and cleanup reported multiple failures."
    );
  }
}
