import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import { syncBuiltinESMExports } from "node:module";
import { COLLECTOR_SENTINEL } from "./offer-collector.mjs";

// Refusal cases were defined first in docs/testing/offer-emission-local.md.
export function installOfferNetworkGuard(env = process.env) {
  const roleOrigins = { app: env.E2E_OFFER_APP_ORIGIN, native: env.E2E_OFFER_BACKEND_ORIGIN, collector: env.E2E_OFFER_COLLECTOR_ORIGIN };
  const urls = new Map();
  for (const [role, origin] of Object.entries(roleOrigins)) {
    const url = new URL(origin ?? "");
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.port || url.origin !== origin || url.username || url.password || url.search || url.hash || url.pathname !== "/" || (role === "collector" && url.hostname !== "127.0.0.1")) throw new Error("Offer guard requires three exact explicit loopback origins.");
    urls.set(role, url);
  }
  if (new Set(Object.values(roleOrigins)).size !== 3 || env.RESEND_BASE_URL !== roleOrigins.collector || env.RESEND_API_KEY !== COLLECTOR_SENTINEL || env.NEXT_PUBLIC_SUPABASE_URL !== roleOrigins.native || env.E2E_ARMY_BASE_URL !== roleOrigins.app || env.EMAIL_FROM !== "ARMY Local <offer@army.invalid>") throw new Error("Offer guard transport/native environment mismatch.");
  const logRoot = path.resolve(".e2e/army/offer");
  const log = path.resolve(env.E2E_OFFER_NETWORK_LOG ?? "");
  if (!log.startsWith(`${logRoot}${path.sep}`)) throw new Error("Offer network evidence must stay in its owned output.");
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const stats = { allowed: 0, denied: 0 };
  const originals = { fetch: globalThis.fetch, httpRequest: http.request, httpGet: http.get, httpsRequest: https.request, httpsGet: https.get, netConnect: net.connect, netCreateConnection: net.createConnection, socketConnect: net.Socket.prototype.connect, tlsConnect: tls.connect, udpSocket: dgram.createSocket };
  function evidence(kind, allowed, role = "forbidden", routeClass = "none") {
    fs.appendFileSync(log, `${JSON.stringify({ schemaVersion: "offer-network-1", time: new Date().toISOString(), pid: process.pid, kind, allowed, role, routeClass })}\n`);
  }
  function deny(kind) {
    stats.denied++;
    evidence(kind, false);
    const error = new Error("Offer campaign blocked outbound transport.");
    error.code = "OFFER_EGRESS_BLOCKED";
    throw error;
  }
  function inspect(kind, input) {
    let url;
    try { url = new URL(typeof input === "string" || input instanceof URL ? input : input.url); } catch { return deny(kind); }
    const role = Object.entries(roleOrigins).find(([, origin]) => origin === url.origin)?.[0];
    if (!role || url.username || url.password) return deny(kind);
    const routeClass = url.pathname.startsWith("/portal/") ? "portal" : url.pathname.startsWith("/auth/v1/") ? "auth" : url.pathname.startsWith("/storage/v1/") ? "storage" : url.pathname.startsWith("/api/") ? "api" : "other";
    stats.allowed++;
    evidence(kind, true, role, routeClass);
  }
  globalThis.fetch = async function (input, init = {}) {
    inspect("fetch", input);
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const existingSignal = init.signal ?? (typeof input === "object" ? input.signal : undefined);
    const collector = url.origin === roleOrigins.collector;
    return originals.fetch.call(this, input, { ...init, redirect: "error", ...(collector ? { signal: existingSignal ? AbortSignal.any([existingSignal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) } : {}) });
  };
  function target(args) {
    const first = args[0];
    const extra = typeof args[1] === "object" && args[1] !== null ? args[1] : {};
    const options = typeof first === "object" && !(first instanceof URL) ? { ...first, ...extra } : extra;
    if (options.socketPath || options.lookup || options.createConnection || options.agent || options.auth) return null;
    try {
      const url = typeof first === "string" || first instanceof URL ? new URL(first) : new URL(`http://${options.hostname ?? options.host ?? "localhost"}:${options.port ?? 80}${options.path ?? "/"}`);
      if (options.protocol) url.protocol = options.protocol;
      if (options.hostname || options.host) url.hostname = options.hostname ?? options.host;
      if (options.port !== undefined) url.port = String(options.port);
      return url;
    } catch { return null; }
  }
  const wrapHttp = (original) => function (...args) { const url = target(args); if (!url) return deny("http"); inspect("http", url); return Reflect.apply(original, this, args); };
  http.request = wrapHttp(originals.httpRequest); http.get = wrapHttp(originals.httpGet);
  https.request = function () { return deny("https"); }; https.get = function () { return deny("https"); };
  function inspectSocket(args) {
    const values = Array.isArray(args[0]) ? args[0] : args;
    const first = values[0];
    const options = typeof first === "object" && first !== null ? first : { port: first, host: typeof values[1] === "string" ? values[1] : "localhost" };
    const hostname = options.host === "::1" ? "[::1]" : options.host;
    const match = [...urls.entries()].find(([role, url]) => (url.hostname === hostname || (role === "app" && url.hostname === "localhost" && ["127.0.0.1", "[::1]"].includes(hostname))) && Number(url.port) === Number(options.port));
    if (options.path || options.lookup || options.createConnection || !match) return deny("socket");
    stats.allowed++;
    evidence("socket", true, match[0]);
  }
  const wrapSocket = (original) => function (...args) { inspectSocket(args); return Reflect.apply(original, this, args); };
  net.connect = wrapSocket(originals.netConnect); net.createConnection = wrapSocket(originals.netCreateConnection); net.Socket.prototype.connect = wrapSocket(originals.socketConnect);
  tls.connect = function () { return deny("tls"); }; dgram.createSocket = function () { return deny("udp"); };
  syncBuiltinESMExports();
  evidence("guard-installed", true);
  let restored = false;
  return { stats, restore() {
    if (restored) return;
    restored = true;
    globalThis.fetch = originals.fetch;
    http.request = originals.httpRequest; http.get = originals.httpGet; https.request = originals.httpsRequest; https.get = originals.httpsGet;
    net.connect = originals.netConnect; net.createConnection = originals.netCreateConnection; net.Socket.prototype.connect = originals.socketConnect;
    tls.connect = originals.tlsConnect; dgram.createSocket = originals.udpSocket;
    syncBuiltinESMExports();
  } };
}

if (process.env.E2E_OFFER_SERVER_GUARD === "1") installOfferNetworkGuard();
