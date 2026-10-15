import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

import { describe, expect, it } from "vitest";

const command = path.resolve("scripts/check-durable-recovery.mjs");
const fakeSecret = "recovery-fixture-token-do-not-log";
const privatePayload = "fixture-person@example.invalid/private-document-id";

function healthyResult() {
  return {
    recoveredUnknownTakeoffJobs: 0,
    dueCount: 0,
    dispatchedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    deadCount: 0,
    failures: [] as Array<{ workId: string; message: string }>,
    procurementStorageCleanup: {
      claimed: 0, removed: 0, failed: 0, skipped: false, errors: [] as string[],
    },
    emailOutbox: {
      claimed: 0, sent: 0, failed: 0, dead: 0, skipped: true, errors: [] as string[],
    },
  };
}

type RecoveryBody = ReturnType<typeof healthyResult>;

async function runProcess(executable: string, args: string[], environment: NodeJS.ProcessEnv) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(executable, args, {
      env: environment, shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    const watchdog = setTimeout(() => {
      child.kill();
      reject(new Error("Recovery fixture subprocess exceeded its deadline."));
    }, 5_000);
    child.on("error", (error) => { clearTimeout(watchdog); reject(error); });
    child.on("close", (code) => { clearTimeout(watchdog); resolve({ code, output }); });
  });
}

async function withFixture(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  exercise: (origin: string) => Promise<void>
) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing loopback listener.");
  try {
    await exercise(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

function runGate(origin: string, overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return runProcess(process.execPath, [command], {
    PATH: process.env.PATH,
    SystemRoot: process.env.SystemRoot,
    CRON_SECRET: fakeSecret,
    HEX_APP_URL: origin,
    RECOVERY_TIMEOUT_MS: "1500",
    ...overrides,
    NODE_ENV: "test",
  });
}

function expectSafeOutput(output: string) {
  expect(output).not.toContain(fakeSecret);
  expect(output).not.toContain(privatePayload);
  expect(output).not.toContain("Bearer");
  expect(output).not.toContain("127.0.0.1");
  expect(output).not.toContain("::error::injected");
}

async function expectBody(body: unknown, code: number, signal: string) {
  await withFixture((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(body));
  }, async (origin) => {
    const result = await runGate(origin);
    expect(result.code).toBe(code);
    expect(result.output).toContain(signal);
    expectSafeOutput(result.output);
  });
}

describe("durable recovery workflow command (local HTTP boundary)", () => {
  it("calls the exact endpoint once with its bearer and accepts a healthy empty drain", async () => {
    const requests: Array<{ url?: string; method?: string; authorization?: string }> = [];
    await withFixture((request, response) => {
      requests.push({ url: request.url, method: request.method, authorization: request.headers.authorization });
      response.end(JSON.stringify(healthyResult()));
    }, async (origin) => {
      const result = await runGate(origin);
      expect(result.code).toBe(0);
      expect(result.output).toContain("Recovery healthy");
      expect(result.output).toContain('"emailSkipped":true');
      expectSafeOutput(result.output);
    });
    expect(requests).toEqual([{
      url: "/api/internal/workflows/recover", method: "GET", authorization: `Bearer ${fakeSecret}`,
    }]);
  });

  it("reproduces curl's green 200 on a global drain failure and rejects it", async () => {
    const body = healthyResult();
    body.procurementStorageCleanup.errors = [privatePayload];
    await withFixture((_request, response) => response.end(JSON.stringify(body)), async (origin) => {
      const baseline = await runProcess(process.platform === "win32" ? "curl.exe" : "curl",
        ["-fsS", `${origin}/api/internal/workflows/recover`], { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, NODE_ENV: "test" });
      expect(baseline.code).toBe(0);
      const result = await runGate(origin);
      expect(result.code).toBe(1);
      expect(result.output).toContain("::error::Recovery failed: drain-unavailable");
      expectSafeOutput(result.output);
    });
  });

  it.each<[(body: RecoveryBody) => void]>([
    [(body) => { body.emailOutbox.errors = [privatePayload]; }],
    [(body) => { body.procurementStorageCleanup.skipped = true; }],
    [(body) => { body.emailOutbox.skipped = false; body.emailOutbox.failed = 1; body.emailOutbox.errors = [privatePayload]; }],
    [(body) => { body.emailOutbox.claimed = 1; body.emailOutbox.errors = [privatePayload]; body.emailOutbox.skipped = false; }],
  ])("rejects a globally unavailable or skipped drain (%#)", async (mutate) => {
    const body = healthyResult();
    mutate(body);
    await expectBody(body, 1, "::error::Recovery failed: drain-unavailable");
  });

  it.each<[(body: RecoveryBody) => void]>([
    [(body) => {
      body.dueCount = 1; body.failedCount = 1;
      body.failures = [{ workId: privatePayload, message: `${fakeSecret}\n::error::injected` }];
    }],
    [(body) => {
      body.emailOutbox = { claimed: 1, sent: 0, failed: 1, dead: 0, skipped: false, errors: [privatePayload] };
    }],
    [(body) => {
      body.procurementStorageCleanup = { claimed: 1, removed: 0, failed: 1, skipped: false, errors: [privatePayload] };
    }],
  ])("warns on counted individual failures without declaring terminal failure (%#)", async (mutate) => {
    const body = healthyResult();
    mutate(body);
    await expectBody(body, 0, "::warning::Recovery degraded");
  });

  it.each<[(body: RecoveryBody) => void]>([
    [(body) => { body.dueCount = 1; body.deadCount = 1; }],
    [(body) => { body.emailOutbox = { claimed: 1, sent: 0, failed: 1, dead: 1, skipped: false, errors: [] }; }],
  ])("fails when a retry budget is exhausted (%#)", async (mutate) => {
    const body = healthyResult();
    mutate(body);
    await expectBody(body, 1, "::error::Recovery failed: retry-budget-exhausted");
  });

  it("keeps capacity skips visible without a spurious error", async () => {
    const body = healthyResult();
    body.dueCount = 3; body.dispatchedCount = 2; body.skippedCount = 1;
    await expectBody(body, 0, '"skippedCount":1');
  });

  it.each([
    null,
    {},
    { ...healthyResult(), emailOutbox: undefined },
    { ...healthyResult(), deadCount: "0" },
    { ...healthyResult(), failedCount: -1 },
    { ...healthyResult(), failedCount: 0.5 },
    { ...healthyResult(), failures: [privatePayload] },
    { ...healthyResult(), failedCount: 1 },
    { ...healthyResult(), emailOutbox: { ...healthyResult().emailOutbox, errors: [1] } },
  ])("fails closed on an incomplete or malformed contract (%#)", async (body) => {
    await expectBody(body, 1, "::error::Recovery failed: invalid-response");
  });

  it.each(["not json", `${privatePayload}\n::error::injected`, "x".repeat(262_145)])(
    "rejects invalid or oversized bodies without echoing them (%#)", async (body) => {
      await withFixture((_request, response) => response.end(body), async (origin) => {
        const result = await runGate(origin);
        expect(result.code).toBe(1);
        expect(result.output).toMatch(/::error::Recovery failed: (invalid-response|response-too-large)/);
        expectSafeOutput(result.output);
      });
    }
  );

  it.each([401, 503, 302])("rejects HTTP %s without following redirects or leaking bodies", async (status) => {
    let count = 0;
    await withFixture((_request, response) => {
      count += 1;
      response.statusCode = status;
      response.setHeader("Location", "/redirect-target");
      response.end(privatePayload);
    }, async (origin) => {
      const result = await runGate(origin);
      expect(result.code).toBe(1);
      expect(result.output).toContain("::error::Recovery failed: http-error");
      expectSafeOutput(result.output);
    });
    expect(count).toBe(1);
  });

  it("bounds the entire request including a body that never finishes", async () => {
    await withFixture((_request, response) => {
      response.writeHead(200); response.write("{");
    }, async (origin) => {
      const result = await runGate(origin, { RECOVERY_TIMEOUT_MS: "100" });
      expect(result.code).toBe(1);
      expect(result.output).toContain("::error::Recovery failed: request-timeout");
      expectSafeOutput(result.output);
    });
  });

  it("does not leak network errors or retry after a dropped connection", async () => {
    let count = 0;
    await withFixture((request) => { count += 1; request.socket.destroy(); }, async (origin) => {
      const result = await runGate(origin);
      expect(result.code).toBe(1);
      expect(result.output).toContain("::error::Recovery failed: request-failed");
      expectSafeOutput(result.output);
    });
    expect(count).toBe(1);
  });

  it.each([
    { CRON_SECRET: "" },
    { HEX_APP_URL: "", APP_URL: "" },
    { HEX_APP_URL: `http://example.invalid/${privatePayload}` },
    { HEX_APP_URL: "https://user:password@example.invalid" },
    { RECOVERY_TIMEOUT_MS: "0" },
    { RECOVERY_TIMEOUT_MS: "280001" },
  ])("refuses invalid configuration before making a request (%#)", async (overrides) => {
    let count = 0;
    await withFixture((_request, response) => { count += 1; response.end("unexpected"); }, async (origin) => {
      const result = await runGate(origin, overrides);
      expect(result.code).toBe(1);
      expect(result.output).toContain("::error::Recovery failed: invalid-configuration");
      expectSafeOutput(result.output);
    });
    expect(count).toBe(0);
  });

  it("supports APP_URL fallback without logging the selected origin", async () => {
    await withFixture((_request, response) => response.end(JSON.stringify(healthyResult())), async (origin) => {
      const result = await runGate("", { APP_URL: origin });
      expect(result.code).toBe(0);
      expect(result.output).toContain("Recovery healthy");
      expectSafeOutput(result.output);
    });
  });
});
