import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";

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

// Runs in its own Node process: Vitest fails the suite on an uncaught error in
// its worker, and only a real process shows whether the hook ends the server.
// The installed hook is the real one, with an exit that also records its code.
const HOOKED_PROCESS = `
import { writeSync } from "node:fs";
import http from "node:http";

const [reporterUrl, scenario] = process.argv.slice(1);
// Synchronous: the hook may end the process right after a record.
const record = (value) => writeSync(1, JSON.stringify(value) + "\\n");
const { installProcessErrorHooks } = await import(reporterUrl);
const { getCloneableBody } = await import("next/dist/server/body-streams.js");

process.on("uncaughtExceptionMonitor", (error) => record({ uncaught: { code: error?.code, message: error?.message } }));
installProcessErrorHooks({ exit: (code) => { record({ exit: code }); process.exit(code); } });
// Never outlive the test: a stopped or killed Vitest worker closes this pipe.
process.stdin.on("end", () => process.exit(0)).resume();

const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));

if (scenario === "client-left") {
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET") { res.end("alive"); return; }
    // Next's router server attaches this listener to every request.
    req.on("error", () => {});
    // Next's in-process proxy reads a clone of a non-GET body, then finalize()
    // hands the route its buffered copy through replaceRequestBody.
    const body = getCloneableBody(req);
    for await (const _chunk of body.cloneBodyStream()) {}
    await body.finalize();
    record({ bodyReplaced: true });
    // The route is still compiling or working: the response stays pending.
  });
  record({ port: await listen(server) });
} else if (scenario === "server-fault") {
  // An application bug raised by Node's HTTP server code itself.
  const server = http.createServer((req, res) => {
    res.end("done");
    setTimeout(() => res.writeHead(200), 10);
  });
  http.get({ host: "127.0.0.1", port: await listen(server) }, (response) => response.resume());
} else {
  // An upstream server that cuts its response in the middle of the body.
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { "content-length": "100" });
    res.write("partial", () => setTimeout(() => res.socket.destroy(), 20));
  });
  const port = await listen(upstream);
  const collect = (stream, callback) => {
    stream.on("data", () => {});
    stream.on("error", callback);
    stream.on("end", () => callback(null));
  };
  http.get({ host: "127.0.0.1", port }, (response) => {
    // The classic callback idiom leaves the upstream failure unhandled.
    collect(response, (error) => { if (error) throw error; });
  });
}
`;

type HookedRecord = {
  port?: number;
  bodyReplaced?: boolean;
  uncaught?: { code: unknown; message: unknown };
  exit?: number;
};

function startHookedProcess(scenario: "client-left" | "server-fault" | "upstream-cut") {
  const reporter = new URL("./error-reporter.ts", import.meta.url).href;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", HOOKED_PROCESS, "--", reporter, scenario], {
    // No reporting DSN: the hook logs its report and never reaches the network.
    env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "", NODE_ENV: "test" },
    shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  const records: HookedRecord[] = [];
  const changes = new EventEmitter();
  let partial = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    const lines = (partial + chunk).split("\n");
    partial = lines.pop() ?? "";
    for (const line of lines) records.push(JSON.parse(line) as HookedRecord);
    changes.emit("change");
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
  // "close" follows the drained output; "exit" may precede the last records.
  let isClosed = false;
  const closed = new Promise<number | null>((resolve) => child.once("close", (code) => {
    isClosed = true;
    changes.emit("change");
    resolve(code);
  }));

  function waitFor<K extends keyof HookedRecord>(key: K): Promise<NonNullable<HookedRecord[K]>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => settle(new Error(`No "${key}" record within its deadline.\n${stderr}`)), 10_000);
      const check = () => {
        const found = records.find((entry) => entry[key] !== undefined)?.[key];
        if (found !== undefined) settle(undefined, found);
        else if (isClosed) settle(new Error(`Process ended before "${key}".\n${stderr}`));
      };
      function settle(error?: Error, value?: NonNullable<HookedRecord[K]>) {
        clearTimeout(timer);
        changes.off("change", check);
        if (error) reject(error);
        else resolve(value!);
      }
      changes.on("change", check);
      check();
    });
  }

  return {
    waitFor,
    /** The exit code, or "still running" when the process outlives the deadline. */
    async ended(milliseconds = 5_000): Promise<number | null | "still running"> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([closed, new Promise<"still running">((resolve) => {
          timer = setTimeout(() => resolve("still running"), milliseconds);
        })]);
      } finally {
        clearTimeout(timer);
      }
    },
    exits: () => records.filter((entry) => entry.exit !== undefined),
    async stop() {
      if (!isClosed) child.kill();
      await closed;
    },
  };
}

describe("installProcessErrorHooks in a Node HTTP server process", () => {
  it("keeps serving when a client leaves before the route reads its proxied request body", async () => {
    const hooked = startHookedProcess("client-left");
    try {
      const port = await hooked.waitFor("port");
      const post = request({ host: "127.0.0.1", port, method: "POST", path: "/api/takeoff/jobs",
        headers: { "content-type": "application/json", "content-length": "2" } });
      post.on("error", () => {});
      post.end("{}");
      await hooked.waitFor("bodyReplaced");
      // The browser commits another page while this request is still pending.
      post.destroy();

      // The disconnect reaches the process hook as Node's ConnResetException.
      expect(await hooked.waitFor("uncaught")).toEqual({ code: "ECONNRESET", message: "aborted" });
      const second = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(5_000) })
        .then((response) => response.text(), (error: Error & { cause?: { code?: string } }) =>
          `unreachable (${error.cause?.code ?? error.message})`);
      expect({ second, exits: hooked.exits() }).toEqual({ second: "alive", exits: [] });
    } finally {
      await hooked.stop();
    }
  }, 20_000);

  it("still exits when an upstream server cuts a response the application left unhandled", async () => {
    const hooked = startHookedProcess("upstream-cut");
    try {
      // Same code and message as a client disconnect, but a failure of this server's own call.
      expect(await hooked.waitFor("uncaught")).toEqual({ code: "ECONNRESET", message: "aborted" });
      expect(await hooked.ended()).toBe(1);
      expect(hooked.exits()).toEqual([{ exit: 1 }]);
    } finally {
      await hooked.stop();
    }
  }, 20_000);

  it("still exits on an application fault raised inside Node's HTTP server code", async () => {
    const hooked = startHookedProcess("server-fault");
    try {
      // Its first stack frame is in node:_http_server too: only its code and message differ.
      expect(await hooked.waitFor("uncaught")).toEqual({
        code: "ERR_HTTP_HEADERS_SENT", message: "Cannot write headers after they are sent to the client" });
      expect(await hooked.ended()).toBe(1);
      expect(hooked.exits()).toEqual([{ exit: 1 }]);
    } finally {
      await hooked.stop();
    }
  }, 20_000);
});
