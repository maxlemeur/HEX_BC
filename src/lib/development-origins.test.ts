import { createRequire } from "node:module";
import type { networkInterfaces } from "node:os";
import { afterEach, expect, it, vi } from "vitest";

import { resolveDevelopmentOrigins } from "@/lib/development-origins";

const interfaces = {
  en0: [{ address: "192.168.1.20" }, { address: "fe80::1234" }],
} as unknown as ReturnType<typeof networkInterfaces>;

afterEach(() => vi.restoreAllMocks());

it("includes loopback and exact addresses of the server interfaces", () => {
  expect(resolveDevelopmentOrigins(interfaces, "")).toEqual(["127.0.0.1", "192.168.1.20", "[::1]", "[fe80::1234]"].sort());
});

it("adds explicit custom hosts without protocols, ports or wildcard patterns", () => {
  expect(resolveDevelopmentOrigins({}, " MergeOne.Dev.Test,127.0.0.1,mergeone.dev.test "))
    .toEqual(["127.0.0.1", "[::1]", "mergeone.dev.test"].sort());
  for (const host of ["*", "**.example.test", "https://dev.test", "dev.test:3000", "user@dev.test", "dev.test/path", "dev test", "dev..test"]) {
    expect(() => resolveDevelopmentOrigins({}, host)).toThrow(/MERGEONE_DEV_HOSTS/);
  }
});

it("allows local and configured browser HMR origins in installed Next while blocking unrelated sites", () => {
  // Check the real installed guard: raw API GETs without Origin cannot expose HMR failures.
  const { blockCrossSiteDEV } = createRequire(import.meta.url)("next/dist/server/lib/router-utils/block-cross-site-dev.js");
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const allowed = resolveDevelopmentOrigins(interfaces, "mergeone.dev.test");
  for (const origin of ["http://127.0.0.1:3000", "http://[::1]:3000", "http://192.168.1.20:3000", "https://mergeone.dev.test"]) {
    const response = { statusCode: 200, end: vi.fn() };
    expect(blockCrossSiteDEV({ url: "/_next/hmr", headers: { origin } }, response, allowed, "0.0.0.0")).toBe(false);
    expect(response.end).not.toHaveBeenCalled();
  }
  const response = { statusCode: 200, end: vi.fn() };
  expect(blockCrossSiteDEV({ url: "/_next/hmr", headers: { origin: "https://unrelated.example.test" } }, response, allowed, "0.0.0.0")).toBe(true);
  expect(response.statusCode).toBe(403);
});
