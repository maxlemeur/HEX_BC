import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
const origins = [process.env.E2E_COVERAGE_BACKEND_ORIGIN, process.env.E2E_ARMY_BASE_URL];
for (const origin of origins) {
  const url = new URL(origin);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.origin !== origin) {
    throw new Error("Coverage server requires explicit loopback origins.");
  }
}
const log = path.resolve(process.env.E2E_COVERAGE_NETWORK_LOG ?? "");
if (!log.startsWith(path.resolve(".e2e/army/coverage") + path.sep)) throw new Error("Coverage network evidence must stay in its owned directory.");
function inspect(kind, input) {
  let url;
  try {
    if (typeof input === "string" || input instanceof URL) url = new URL(input);
    else if (input?.url) url = new URL(input.url);
    else url = new URL(`${input?.protocol ?? "https:"}//${input?.hostname ?? input?.host ?? "invalid"}${input?.port ? ":" + input.port : ""}${input?.path ?? "/"}`);
  } catch { throw new Error("Coverage outbound target could not be verified."); }
  const allowed = origins.includes(url.origin);
  fs.appendFileSync(log, JSON.stringify({ time: new Date().toISOString(), kind, origin: url.origin, pathname: url.pathname, allowed }) + "\n");
  if (!allowed) throw new Error("Coverage campaign blocked outbound server request.");
}
const originalFetch = globalThis.fetch;
globalThis.fetch = function(input, ...rest) { inspect("fetch", input); return originalFetch.call(this, input, ...rest); };
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
