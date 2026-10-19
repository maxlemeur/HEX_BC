// Test-only server measurements. No headers, bodies, credentials or search text are recorded.
import fs from "node:fs";
import path from "node:path";

const backend = new URL(process.env.E2E_COVERAGE_BACKEND_ORIGIN ?? "");
const filename = path.resolve(process.env.E2E_DOGFOOD_FETCH_LOG ?? "");
const directory = path.resolve(".e2e/army/performance/server-network");
if (process.env.E2E_DOGFOOD_OWNED_STACK !== "1" || backend.protocol !== "http:" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname) || backend.href !== `${backend.origin}/` ||
    !filename.startsWith(`${directory}${path.sep}`)) {
  throw new Error("Performance probe requires its owned loopback backend and evidence directory.");
}
fs.mkdirSync(directory, { recursive: true });
const originalFetch = globalThis.fetch;
globalThis.fetch = async function (input, init) {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.origin !== backend.origin) return originalFetch.call(this, input, init);
  const startedAt = Date.now();
  const query = {};
  for (const key of ["select", "project_id", "version_id", "id", "tenant_id", "limit", "offset", "order"]) {
    const value = url.searchParams.get(key);
    if (value !== null) query[key] = value;
  }
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  try {
    const response = await originalFetch.call(this, input, init);
    fs.appendFileSync(filename, `${JSON.stringify({ startedAt, endedAt: Date.now(), method,
      path: url.pathname, query, status: response.status })}\n`);
    return response;
  } catch (error) {
    fs.appendFileSync(filename, `${JSON.stringify({ startedAt, endedAt: Date.now(), method,
      path: url.pathname, query, status: null, error: error instanceof Error ? error.name : "unknown" })}\n`);
    throw error;
  }
};
