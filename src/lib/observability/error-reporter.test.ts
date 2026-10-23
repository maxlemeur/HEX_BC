import { EventEmitter } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installProcessErrorHooks, reportErrorAndWait } from "@/lib/observability/error-reporter";

async function withCollector(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  exercise: (origin: string) => Promise<void>
) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Collector did not bind loopback.");
  try {
    await exercise(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function within<T>(task: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([task, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Collector connection was not released within its deadline.")), milliseconds);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

describe("error reporting network boundary", () => {
  beforeEach(() => {
    for (const name of ["ERROR_REPORTING_DSN", "SENTRY_DSN", "NEXT_PUBLIC_ERROR_REPORTING_DSN", "NEXT_PUBLIC_SENTRY_DSN"]) {
      vi.stubEnv(name, "");
    }
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it.each(["generic", "sentry"])("cancels a %s collector that never returns headers, and settles the reporting hook", async (kind) => {
    let closed: Promise<void> = Promise.resolve();
    await withCollector((request, response) => {
      request.resume();
      closed = new Promise<void>((resolve) => response.on("close", resolve));
    }, async (origin) => {
      vi.stubEnv("ERROR_REPORTING_DSN", kind === "sentry" ? origin.replace("://", "://public@") + "/42" : origin);
      await within(reportErrorAndWait({ error: new Error("original application failure"), source: "fixture" }), 3_500);
      await within(closed, 500);
      expect(console.error).toHaveBeenCalledWith("[error-reporter]", "delivery failed", expect.anything(),
        expect.objectContaining({ message: "original application failure" }));
    });
  }, 5_000);

  it.each([200, 503])("releases an unfinished HTTP %i response body", async (status) => {
    let closed: Promise<void> = Promise.resolve();
    let requested = "";
    await withCollector((request, response) => {
      requested = `${request.method} ${request.url}`;
      request.resume();
      closed = new Promise<void>((resolve) => response.on("close", resolve));
      response.writeHead(status, { "Content-Type": "application/json" });
      response.write("{");
    }, async (origin) => {
      vi.stubEnv("ERROR_REPORTING_DSN", origin + "/events");
      await within(reportErrorAndWait({ error: new Error("fixture"), source: "fixture" }), 3_500);
      await within(closed, 500);
      expect(requested).toBe("POST /events");
      expect(console.error).toHaveBeenCalledTimes(status === 200 ? 0 : 1);
    });
  });

  it("delivers the original event to a healthy collector", async () => {
    let event: unknown;
    await withCollector((request, response) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk.toString(); });
      request.on("end", () => { event = JSON.parse(body); response.end("ok"); });
    }, async (origin) => {
      vi.stubEnv("ERROR_REPORTING_DSN", origin);
      await reportErrorAndWait({ error: new Error("fixture"), source: "fixture", context: { route: "/fixture" } });
      expect(event).toMatchObject({ name: "Error", message: "fixture", source: "fixture", context: { route: "/fixture" } });
      expect(console.error).not.toHaveBeenCalled();
    });
  });
});

describe("installProcessErrorHooks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("reports then exits the process on uncaughtException instead of swallowing it", async () => {
    const target = new EventEmitter();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("ERROR_REPORTING_DSN", "");
    const exit = vi.fn();

    installProcessErrorHooks({ target: target as unknown as NodeJS.Process, exit });
    target.emit("uncaughtException", new Error("boom"));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(exit).toHaveBeenCalledWith(1);
  });

  it("does not register its hooks twice on the same target", () => {
    const target = new EventEmitter();

    installProcessErrorHooks({ target: target as unknown as NodeJS.Process, exit: vi.fn() });
    installProcessErrorHooks({ target: target as unknown as NodeJS.Process, exit: vi.fn() });

    expect(target.listenerCount("uncaughtException")).toBe(1);
    expect(target.listenerCount("unhandledRejection")).toBe(1);
  });
});
