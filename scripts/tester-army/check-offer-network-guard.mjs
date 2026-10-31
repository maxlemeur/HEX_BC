import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Resend } from "resend";
import { COLLECTOR_SENTINEL, startCollector } from "./offer-collector.mjs";
import { installOfferNetworkGuard } from "./offer-network-guard.mjs";
import { assertInstalledDependencies } from "./installed-dependencies.mjs";

// Cases fixed before this probe: ignored transport/.../three-origin-probe-cases.md
// and docs/testing/offer-emission-local.md. This never calls product or native APIs.
const sha = (value) => createHash("sha256").update(value).digest("hex");
const check = (condition, code) => { if (!condition) throw new Error(`oracle:${code}`); };
const git = (...args) => execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
const sources = ["scripts/tester-army/check-offer-network-guard.mjs", "scripts/tester-army/offer-network-guard.mjs", "scripts/tester-army/offer-collector.mjs", "scripts/tester-army/installed-dependencies.mjs", "package-lock.json", "node_modules/resend/dist/index.mjs", "node_modules/resend/package.json"];

export async function probeOfferGuard({ directory, appOrigin, backendOrigin }) {
  const permittedRoot = path.resolve(".e2e/army/offer");
  const parent = path.resolve(directory);
  if (!path.isAbsolute(directory) || !parent.startsWith(`${permittedRoot}${path.sep}`)) throw new Error("New owned offer gate directory required.");
  const app = new URL(appOrigin);
  const backend = new URL(backendOrigin);
  for (const url of [app, backend]) if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Exact explicit local gate origins required.");
  if (app.origin !== appOrigin || backend.origin !== backendOrigin || appOrigin === backendOrigin) throw new Error("Distinct canonical app/native origins required.");
  const run = path.join(parent, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`);
  const publicDir = path.join(run, "public");
  await mkdir(publicDir, { recursive: true });
  const report = { schemaVersion: "offer-three-origin-guard-1", scope: "new guard real local SDK/socket qualification; no Next/native API/DB/UI", command: { executable: process.execPath, args: ["scripts/tester-army/check-offer-network-guard.mjs", parent, appOrigin, backendOrigin] }, startedAt: new Date().toISOString(), revision: git("rev-parse", "HEAD").trim(), statusBefore: git("status", "--short", "--branch").trim().split(/\r?\n/), diffBeforeSha256: sha(git("diff", "--binary")), nodeVersion: process.version, sdkVersion: JSON.parse(await readFile("node_modules/resend/package.json", "utf8")).version, sourceSha256: {}, origins: { app: appOrigin, native: backendOrigin }, nativeRequests: 0, cases: [], status: "missing-proof" };
  for (const file of sources) report.sourceSha256[file] = sha(await readFile(file));
  await writeFile(path.join(publicDir, "manifest.json"), `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  const originalFetch = globalThis.fetch;
  const originalHttp = http.request;
  const originalNet = net.Socket.prototype.connect;
  const previousBase = process.env.RESEND_BASE_URL;
  const servers = [];
  let collector;
  let guard;
  let outcome;
  let lastCase = "setup";
  async function step(id, expected, fn) {
    lastCase = id;
    const startedAt = new Date().toISOString();
    const actual = await fn();
    report.cases.push({ id, expected, actual, status: "pass", startedAt, completedAt: new Date().toISOString() });
  }
  try {
    report.toolchain = assertInstalledDependencies();
    const lockedSdkVersion = JSON.parse(await readFile("package-lock.json", "utf8")).packages?.["node_modules/resend"]?.version;
    check(["26"].includes(process.versions.node.split(".")[0]) && typeof lockedSdkVersion === "string" && report.sdkVersion === lockedSdkVersion, "runtime-version");
    const collectorDirectory = path.join(run, "collector");
    await mkdir(collectorDirectory);
    collector = await startCollector({ directory: collectorDirectory });
    report.origins.collector = collector.origin;
    report.bind = collector.server.address();
    // Dummy app transport witnesses; no real app or native backend request.
    for (const host of app.hostname === "localhost" ? ["127.0.0.1", "::1"] : [app.hostname.replace(/^\[|\]$/g, "")]) {
      const server = http.createServer((request, response) => { response.writeHead(request.url === "/health" ? 200 : 404, { "content-type": "application/json" }); response.end(JSON.stringify({ transportWitness: "dummy-app-health-only" })); });
      servers.push(server);
      await new Promise((resolve, reject) => { server.once("error", reject); server.listen({ host, port: Number(app.port), ipv6Only: host === "::1" }, resolve); });
    }
    const log = path.join(publicDir, "server-network.jsonl");
    guard = installOfferNetworkGuard({ E2E_OFFER_APP_ORIGIN: appOrigin, E2E_ARMY_BASE_URL: appOrigin, E2E_OFFER_BACKEND_ORIGIN: backendOrigin, NEXT_PUBLIC_SUPABASE_URL: backendOrigin, E2E_OFFER_COLLECTOR_ORIGIN: collector.origin, RESEND_BASE_URL: collector.origin, RESEND_API_KEY: COLLECTOR_SENTINEL, EMAIL_FROM: "ARMY Local <offer@army.invalid>", E2E_OFFER_NETWORK_LOG: log });
    process.env.RESEND_BASE_URL = collector.origin;
    const sdk = new Resend(COLLECTOR_SENTINEL);
    const bytes = Buffer.from("%PDF-1.4\n% LOCAL GUARD PACKET ONLY\n%%EOF\n");
    const payload = { from: "ARMY Local <offer@army.invalid>", to: "client@army.invalid", cc: ["copy@army.invalid"], subject: "LOCAL GUARD PACKET", html: "<p>Local transport only</p>", text: "Local transport only", attachments: [{ filename: "packet.pdf", content: bytes.toString("base64") }] };
    const key = `guard-probe/${randomUUID()}`;
    const receiptRoot = path.join(collectorDirectory, "receipts");
    let acceptedId;
    await step("G1", "real SDK environment base and committed local receipt", async () => {
      check(sdk.baseUrl === collector.origin, "sdk-base-url");
      const result = await sdk.emails.send(payload, { idempotencyKey: key });
      check(result.error === null && typeof result.data?.id === "string", "sdk-base64-success");
      acceptedId = result.data.id;
      const receipt = JSON.parse(await readFile(path.join(receiptRoot, sha(key), "public", "receipt.json"), "utf8"));
      const pdf = await readFile(path.join(receiptRoot, sha(key), "private", "attachment.pdf"));
      check(receipt.id === acceptedId && receipt.pdf.sha256 === sha(bytes) && sha(pdf) === sha(bytes), "receipt-before-ack");
      return { dataId: acceptedId, receiptCount: (await readdir(receiptRoot)).length, pdfSha256: sha(pdf) };
    });
    await step("G2", "same-ID replay;409 conflict;Buffer PDF accepted byte-for-byte;invalid PDF rejected", async () => {
      const replay = await sdk.emails.send(payload, { idempotencyKey: key });
      const conflict = await sdk.emails.send({ ...payload, subject: "DIFFERENT LOCAL SUBJECT" }, { idempotencyKey: key });
      const bufferKey = `buffer/${randomUUID()}`;
      // Resend 6.37 encodes Buffer contents to base64 before sending. Keep a
      // malformed binary counterexample to prove the collector still rejects it.
      const buffer = await sdk.emails.send({ ...payload, attachments: [{ filename: "packet.pdf", content: bytes }] }, { idempotencyKey: bufferKey });
      const invalid = await sdk.emails.send({ ...payload, attachments: [{ filename: "packet.pdf", content: Buffer.from("not a PDF") }] }, { idempotencyKey: `invalid/${randomUUID()}` });
      const bufferPdf = await readFile(path.join(receiptRoot, sha(bufferKey), "private", "attachment.pdf"));
      check(replay.error === null && replay.data?.id === acceptedId && conflict.data === null && conflict.error?.name === "invalid_idempotent_request" && conflict.error?.statusCode === 409 && buffer.error === null && typeof buffer.data?.id === "string" && sha(bufferPdf) === sha(bytes) && invalid.data === null && invalid.error?.statusCode === 422 && (await readdir(receiptRoot)).length === 2, "idempotency-buffer");
      return { replaySameId: true, conflictStatus: 409, bufferStatus: "accepted", bufferPdfSha256: sha(bufferPdf), invalidStatus: 422, receiptCount: 2 };
    });
    await step("G3", "dummy app actual loopback HTTP and exact-port socket aliases only", async () => {
      const response = await fetch(`${appOrigin}/health`);
      check(response.status === 200 && (await response.json()).transportWitness === "dummy-app-health-only", "dummy-app-http");
      const aliases = app.hostname === "localhost" ? ["127.0.0.1", "::1"] : [app.hostname.replace(/^\[|\]$/g, "")];
      for (const host of aliases) await new Promise((resolve, reject) => { const socket = net.connect({ host, port: Number(app.port) }, () => { socket.end(); resolve(); }); socket.on("error", reject); });
      const forbidden = [() => net.connect({ host: "127.0.0.1", port: Number(app.port) === 65535 ? 65534 : Number(app.port) + 1 }), () => net.connect({ host: "localhost", port: Number(app.port), lookup() {} }), () => net.connect({ host: "localhost", port: Number(app.port), createConnection() {} }), () => http.request(`${appOrigin}/health`, { hostname: "forbidden.invalid" })];
      let denied = 0;
      for (const attempt of forbidden) { try { attempt(); } catch (error) { check(error.code === "OFFER_EGRESS_BLOCKED", "socket-wrong-denial"); denied++; } }
      check(denied === forbidden.length, "socket-alias-boundary");
      return { appHttpStatus: 200, aliasesConnected: aliases, otherPortsAndHooksRefused: denied };
    });
    await step("G4", "SDK forbidden provider plus listed APIs intercepted before remote call", async () => {
      process.env.RESEND_BASE_URL = "https://api.resend.com";
      const forbiddenSdk = new Resend(COLLECTOR_SENTINEL);
      const blockedSdk = await forbiddenSdk.emails.send(payload, { idempotencyKey: `forbidden/${randomUUID()}` });
      process.env.RESEND_BASE_URL = collector.origin;
      check(blockedSdk.data === null && blockedSdk.error?.name === "application_error", "forbidden-sdk");
      const calls = [() => fetch("https://forbidden.invalid/emails?token=synthetic-not-recorded"), () => http.request("http://forbidden.invalid/emails"), () => http.get("http://forbidden.invalid/health"), () => https.request("https://forbidden.invalid/emails"), () => https.get("https://forbidden.invalid/health"), () => net.connect({ host: "forbidden.invalid", port: 443 }), () => net.createConnection({ host: "forbidden.invalid", port: 443 }), () => new net.Socket().connect({ host: "forbidden.invalid", port: 443 }), () => tls.connect({ host: "forbidden.invalid", port: 443 }), () => dgram.createSocket("udp4")];
      let denied = 0;
      for (const attempt of calls) { try { await attempt(); } catch (error) { check(error.code === "OFFER_EGRESS_BLOCKED", "forbidden-wrong-denial"); denied++; } }
      check(denied === calls.length, "forbidden-count");
      const logText = await readFile(log, "utf8");
      const entries = logText.trim().split("\n").map((line) => JSON.parse(line));
      check(!/forbidden\.invalid|synthetic-not-recorded|api\.resend\.com|Authorization|LOCAL_ONLY_INVALID_RESEND_SENTINEL|\?/.test(logText) && entries.every((entry) => Object.keys(entry).sort().join(",") === "allowed,kind,pid,role,routeClass,schemaVersion,time"), "safe-network-log");
      return { blockedSdk: true, forbiddenApiCalls: calls.length, allIntercepted: true, publicLogFixedFields: true, remoteRequestExecuted: false };
    });
    await step("G5", "closed real collector returns SDK network failure without provider fallback", async () => {
      await collector.close();
      const before = guard.stats.denied;
      const result = await sdk.emails.send(payload, { idempotencyKey: `stopped/${randomUUID()}` });
      check(result.data === null && result.error?.name === "application_error" && result.error?.statusCode === null && guard.stats.denied === before && (await readdir(receiptRoot)).length === 2, "stopped-sdk");
      return { listenerClosed: true, sdkError: result.error.name, statusCode: result.error.statusCode, externalFallbackAttempts: 0, receiptCount: 2 };
    });
    report.status = "pass";
  } catch (error) {
    report.status = "failed";
    report.cases.push({ id: lastCase, status: "failed", failure: error.message?.startsWith("oracle:") ? error.message : "execution failed; no sensitive error retained", errorCode: typeof error.code === "string" && /^[A-Z_0-9]+$/.test(error.code) ? error.code : undefined });
  } finally {
    if (collector) await collector.close();
    for (const server of servers) if (server.listening) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
    if (guard) { report.guardCounters = { ...guard.stats }; guard.restore(); }
    if (previousBase === undefined) delete process.env.RESEND_BASE_URL; else process.env.RESEND_BASE_URL = previousBase;
    let collectorClosed = false;
    if (collector) { try { await originalFetch(`${collector.origin}/health`, { signal: AbortSignal.timeout(1000) }); } catch { collectorClosed = true; } }
    report.cleanup = { collectorClosed, dummyAppListenersClosed: servers.every((server) => !server.listening), fetchRestored: globalThis.fetch === originalFetch, httpRestored: http.request === originalHttp, netRestored: net.Socket.prototype.connect === originalNet, baseEnvironmentRestored: process.env.RESEND_BASE_URL === previousBase };
    if (Object.values(report.cleanup).some((value) => value !== true)) report.status = "failed";
    report.completedAt = new Date().toISOString();
    report.statusAfter = git("status", "--short", "--branch").trim().split(/\r?\n/);
    report.diffAfterSha256 = sha(git("diff", "--binary"));
    report.sourceUnchanged = true;
    for (const file of sources) if (report.sourceSha256[file] !== sha(await readFile(file))) report.sourceUnchanged = false;
    if (!report.sourceUnchanged) report.status = "failed";
    const reportPath = path.join(publicDir, "report.json");
    const contents = `${JSON.stringify(report, null, 2)}\n`;
    await writeFile(reportPath, contents, { flag: "wx" });
    outcome = { status: report.status, reportPath, reportSha256: sha(contents), sourceSha256: report.sourceSha256, startedAt: report.startedAt, completedAt: report.completedAt, cases: report.cases, cleanup: report.cleanup };
  }
  return outcome;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await probeOfferGuard({ directory: process.argv[2], appOrigin: process.argv[3], backendOrigin: process.argv[4] });
  console.log(JSON.stringify(result));
  if (result.status !== "pass") process.exitCode = 1;
}
