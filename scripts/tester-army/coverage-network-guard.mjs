import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import { AsyncLocalStorage } from "node:async_hooks";
const origins = [process.env.E2E_COVERAGE_BACKEND_ORIGIN, process.env.E2E_ARMY_BASE_URL];
for (const origin of origins) {
  const url = new URL(origin);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.origin !== origin) {
    throw new Error("Coverage server requires explicit loopback origins.");
  }
}
const mailCollector = process.env.E2E_TAKEOFF_MAIL_COLLECTOR_ORIGIN;
if (mailCollector) {
  const target = new URL(mailCollector);
  if (process.env.E2E_ARMY_TAKEOFF_WORKER !== "1" || process.env.E2E_ARMY_BLOCK_WORKERS !== "1" ||
      target.origin !== mailCollector || target.protocol !== "http:" || target.hostname !== "127.0.0.1" ||
      !target.port || origins.includes(target.origin) || process.env.RESEND_BASE_URL !== target.origin ||
      process.env.RESEND_API_KEY !== "LOCAL_ONLY_INVALID_RESEND_SENTINEL") {
    throw new Error("Takeoff mail collection requires the owned worker and a separate loopback collector.");
  }
}
const log = path.resolve(process.env.E2E_COVERAGE_NETWORK_LOG ?? "");
if (!log.startsWith(path.resolve(".e2e/army/coverage") + path.sep)) throw new Error("Coverage network evidence must stay in its owned directory.");
// Attribute just the test's analysis-progress reads, even when two Army workers
// use PostgreSQL's shared statistics and the same Next server at once.
const progressPolls = new AsyncLocalStorage();
const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function(event, ...args) {
  if (event === "request") {
    const [request] = args;
    const poll = request.headers["x-army-analysis-progress-poll"];
    if (request.method === "GET" && request.url?.split("?", 1)[0] === "/api/affaires/analysis-progress" &&
        typeof poll === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(poll)) {
      return progressPolls.run(poll, () => emit.call(this, event, ...args));
    }
  }
  return emit.call(this, event, ...args);
};
function inspect(kind, input, method) {
  let url;
  try {
    if (typeof input === "string" || input instanceof URL) url = new URL(input);
    else if (input?.url) url = new URL(input.url);
    else url = new URL(`${input?.protocol ?? "https:"}//${input?.hostname ?? input?.host ?? "invalid"}${input?.port ? ":" + input.port : ""}${input?.path ?? "/"}`);
  } catch { throw new Error("Coverage outbound target could not be verified."); }
  // Business journeys qualify request persistence and cancellation, not workers.
  // A separate local Edge process could otherwise contact a real provider.
  const worker = process.env.E2E_ARMY_BLOCK_WORKERS === "1" && url.pathname.startsWith("/functions/v1/");
  const allowed = (origins.includes(url.origin) && !worker) ||
    (kind === "fetch" && method === "POST" && url.origin === mailCollector && url.pathname === "/emails" && !url.search);
  const poll = url.origin === origins[0] && url.pathname.startsWith("/rest/v1/") ? progressPolls.getStore() : undefined;
  fs.appendFileSync(log, JSON.stringify({ time: new Date().toISOString(), kind, origin: url.origin, pathname: url.pathname, allowed, poll }) + "\n");
  if (!allowed) throw new Error("Coverage campaign blocked outbound server request.");
  return url;
}
const originalFetch = globalThis.fetch;
globalThis.fetch = function(input, init) {
  const target = inspect("fetch", input, String(init?.method ?? input?.method ?? "GET").toUpperCase());
  const options = target.origin === mailCollector ? { ...init, redirect: "error" } : init;
  return originalFetch.call(this, input, options);
};
for (const [name, transport] of [["node:http", http], ["node:https", https]]) {
  for (const operation of ["request", "get"]) {
    const original = transport[operation];
    transport[operation] = function(input, ...rest) {
      inspect(`${name}:${operation}`, typeof input === "object" && !(input instanceof URL) ? { protocol: name === "node:http" ? "http:" : "https:", ...input } : input);
      return original.call(this, input, ...rest);
    };
  }
}
fs.appendFileSync(log, JSON.stringify({ time: new Date().toISOString(), kind: "guard-installed", allowedOrigins: origins, pid: process.pid }) + "\n");
