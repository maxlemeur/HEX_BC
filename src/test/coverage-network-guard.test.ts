import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("takeoff mail collector network boundary", () => {
  it("only forwards fetch POST /emails to the configured loopback collector", () => {
    const directory = ".e2e/army/coverage";
    const log = `${directory}/guard-test-${randomUUID()}.jsonl`;
    mkdirSync(directory, { recursive: true });
    try {
      const test = `
        import assert from 'node:assert/strict';
        import http from 'node:http';
        const target = new URL('/emails', process.env.E2E_TAKEOFF_MAIL_COLLECTOR_ORIGIN);
        let forwarded = 0;
        globalThis.fetch = async () => { forwarded += 1; };
        http.get = http.request = () => { forwarded += 1; };
        await import('./scripts/tester-army/coverage-network-guard.mjs');
        await fetch(target, { method: 'POST' });
        assert.throws(() => fetch(target));
        assert.throws(() => fetch(new Request(target, { method: 'POST' }), { method: 'GET' }));
        assert.throws(() => http.get(target));
        assert.throws(() => http.request(target, { method: 'POST' }));
        assert.equal(forwarded, 1);
      `;
      expect(() => execFileSync(process.execPath, ["--input-type=module", "-e", test], {
        stdio: "pipe",
        env: { ...process.env, E2E_COVERAGE_BACKEND_ORIGIN: "http://127.0.0.1:9001",
          E2E_ARMY_BASE_URL: "http://127.0.0.1:9002", E2E_TAKEOFF_MAIL_COLLECTOR_ORIGIN: "http://127.0.0.1:9003",
          E2E_ARMY_TAKEOFF_WORKER: "1", E2E_ARMY_BLOCK_WORKERS: "1", RESEND_BASE_URL: "http://127.0.0.1:9003",
          RESEND_API_KEY: "LOCAL_ONLY_INVALID_RESEND_SENTINEL", E2E_COVERAGE_NETWORK_LOG: log },
      })).not.toThrow();
    } finally {
      rmSync(log, { force: true });
    }
  });
});
