import { spawn } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";

import { describe, expect, it } from "vitest";

const command = path.resolve("scripts/purge-test-data.mjs");
const fakeSecret = "purge-fixture-token-do-not-log";

async function runCommand(origin: string, overrides: Partial<NodeJS.ProcessEnv> = {}) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, [command], {
      env: {
        PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, CRON_SECRET: fakeSecret, HEX_APP_URL: origin,
        ...overrides, NODE_ENV: "test",
      },
      shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    const watchdog = setTimeout(() => { child.kill(); reject(new Error("Purge fixture subprocess exceeded its deadline.")); }, 5_000);
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
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function answer(body: unknown, seen: string[] = [], status = 200) {
  return (request: IncomingMessage, response: ServerResponse) => {
    seen.push(`${request.url} ${request.headers.authorization === `Bearer ${fakeSecret}` ? "authorized" : "anonymous"}`);
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
}

describe("weekly test data purge command", () => {
  it("deletes through the internal route and logs only counters", async () => {
    const seen: string[] = [];
    const body = { dryRun: false, eligible: 0, deleted: 4, failed: 0, remaining: false, extra: "a8d1292a" };
    await withFixture(answer(body, seen), async (origin) => {
      const result = await runCommand(origin);
      expect(result.code, result.output).toBe(0);
      expect(result.output).toContain('"deleted":4');
      expect(result.output).not.toContain("a8d1292a");
      expect(result.output).not.toContain(fakeSecret);
    });
    expect(seen).toEqual(["/api/internal/test-data/purge authorized"]);
  });

  it("asks a dry run only when told to and refuses a response that deleted", async () => {
    const seen: string[] = [];
    await withFixture(answer({ dryRun: true, eligible: 2, deleted: 0, failed: 0, remaining: false }, seen), async (origin) => {
      expect((await runCommand(origin, { PURGE_DRY_RUN: "1" })).code).toBe(0);
    });
    expect(seen).toEqual(["/api/internal/test-data/purge?dryRun=1 authorized"]);
    await withFixture(answer({ dryRun: true, eligible: 0, deleted: 2, failed: 0, remaining: false }), async (origin) => {
      const result = await runCommand(origin, { PURGE_DRY_RUN: "1" });
      expect(result.code).toBe(1);
      expect(result.output).toContain("invalid-response");
    });
  });

  it("fails on failed deletions, HTTP errors and missing configuration", async () => {
    await withFixture(answer({ dryRun: false, eligible: 0, deleted: 1, failed: 1, remaining: false }), async (origin) => {
      const result = await runCommand(origin);
      expect(result.code).toBe(1);
      expect(result.output).toContain("deletions-failed");
    });
    await withFixture(answer({ error: "Test data purge failed" }, [], 500), async (origin) => {
      expect((await runCommand(origin)).output).toContain("http-error");
    });
    for (const overrides of [{ CRON_SECRET: "" }, { HEX_APP_URL: "http://example.test" }, { PURGE_DRY_RUN: "yes" }]) {
      const result = await runCommand("http://127.0.0.1:9", overrides);
      expect(result.code).toBe(1);
      expect(result.output).toContain("invalid-configuration");
    }
  });
});
