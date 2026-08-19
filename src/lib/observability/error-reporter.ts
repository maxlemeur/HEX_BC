export const ERROR_REPORTER_LOG_PREFIX = "[error-reporter]";

export type ReportedErrorEvent = {
  source: string;
  name: string;
  message: string;
  stack?: string;
  digest?: string;
  context?: Record<string, unknown>;
  timestamp: string;
};

type ReportErrorInput = {
  error: unknown;
  source: string;
  context?: Record<string, unknown>;
};

function readEnv(name: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env[name];
}

export function getErrorReportingDsn(): string | null {
  const value =
    readEnv("ERROR_REPORTING_DSN")?.trim() ||
    readEnv("SENTRY_DSN")?.trim() ||
    readEnv("NEXT_PUBLIC_ERROR_REPORTING_DSN")?.trim() ||
    readEnv("NEXT_PUBLIC_SENTRY_DSN")?.trim() ||
    "";
  return value || null;
}

export function normalizeReportedError(error: unknown): {
  name: string;
  message: string;
  stack?: string;
  digest?: string;
} {
  if (error instanceof Error) {
    const digest =
      "digest" in error && typeof error.digest === "string"
        ? error.digest
        : undefined;
    return {
      name: error.name || "Error",
      message: error.message,
      stack: error.stack,
      digest,
    };
  }

  return {
    name: "Error",
    message: String(error),
  };
}

function buildEvent(input: ReportErrorInput): ReportedErrorEvent {
  return {
    source: input.source,
    ...normalizeReportedError(input.error),
    context: input.context,
    timestamp: new Date().toISOString(),
  };
}

function parseSentryDsn(dsn: string) {
  try {
    const url = new URL(dsn);
    const publicKey = url.username;
    const projectId = url.pathname.replace(/^\/+/, "").split("/")[0];
    if (!publicKey || !projectId || !/^\d+$/.test(projectId)) return null;
    return {
      storeUrl: `${url.protocol}//${url.host}/api/${projectId}/store/`,
      publicKey,
    };
  } catch {
    return null;
  }
}

async function deliverErrorEvent(dsn: string, event: ReportedErrorEvent) {
  const sentry = parseSentryDsn(dsn);
  if (sentry) {
    const response = await fetch(sentry.storeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Sentry sentry_version=7, sentry_client=hex-bc-error-reporter/1.0, sentry_key=${sentry.publicKey}`,
      },
      body: JSON.stringify({
        message: event.message,
        level: "error",
        logger: event.source,
        timestamp: event.timestamp,
        extra: event.context ?? {},
        exception: {
          values: [
            {
              type: event.name,
              value: event.message,
              stacktrace: event.stack
                ? { frames: [{ filename: event.source, context_line: event.stack }] }
                : undefined,
            },
          ],
        },
        tags: event.digest ? { digest: event.digest } : undefined,
      }),
    });
    if (!response.ok) {
      throw new Error(`Sentry store rejected the event (${response.status}).`);
    }
    return;
  }

  const response = await fetch(dsn, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!response.ok) {
    throw new Error(`Error reporting endpoint rejected the event (${response.status}).`);
  }
}

export async function reportErrorAndWait(input: ReportErrorInput): Promise<void> {
  const event = buildEvent(input);
  const dsn = getErrorReportingDsn();
  if (!dsn) {
    console.error(ERROR_REPORTER_LOG_PREFIX, event);
    return;
  }

  try {
    await deliverErrorEvent(dsn, event);
  } catch (deliveryError) {
    console.error(ERROR_REPORTER_LOG_PREFIX, "delivery failed", deliveryError, event);
  }
}

export function reportError(input: ReportErrorInput): void {
  void reportErrorAndWait(input);
}

const UNCAUGHT_EXCEPTION_REPORT_TIMEOUT_MS = 2_000;

type ProcessErrorTarget = Pick<NodeJS.Process, "on">;

const installedTargets = new WeakSet<object>();

/**
 * Installs process-level reporters once per target (idempotent under HMR).
 *
 * An `uncaughtException` handler replaces Node's default "log and crash";
 * a server kept alive after one is in an undefined state. We report (bounded
 * by a timeout so a dead DSN cannot hang the crash) and then exit non-zero so
 * the platform restarts the worker.
 */
export function installProcessErrorHooks(
  options: {
    target?: ProcessErrorTarget;
    exit?: (code: number) => void;
  } = {}
) {
  const target: ProcessErrorTarget | undefined =
    options.target ??
    (typeof process !== "undefined" && typeof process.on === "function"
      ? process
      : undefined);
  if (!target || installedTargets.has(target)) {
    return;
  }
  installedTargets.add(target);

  // `process.exit` est indisponible dans l'Edge Runtime et une reference
  // statique casse le bundle Edge d'instrumentation.ts : on y accede via
  // globalThis, et le hook n'est de toute facon installe que cote Node.
  const exit =
    options.exit ??
    ((code: number) => {
      const runtime = globalThis as {
        process?: { exit?: (code: number) => void };
      };
      runtime.process?.exit?.(code);
    });

  target.on("uncaughtException", (error) => {
    console.error(ERROR_REPORTER_LOG_PREFIX, "uncaughtException", error);
    const report = reportErrorAndWait({
      error,
      source: "process.uncaughtException",
    });
    const timeout = new Promise<void>((resolve) => {
      setTimeout(resolve, UNCAUGHT_EXCEPTION_REPORT_TIMEOUT_MS).unref?.();
    });
    void Promise.race([report, timeout]).finally(() => exit(1));
  });
  target.on("unhandledRejection", (reason) => {
    reportError({
      error: reason,
      source: "process.unhandledRejection",
    });
  });
}
