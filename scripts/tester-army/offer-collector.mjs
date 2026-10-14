import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Intentionally not a Resend-format key; only this local collector accepts it.
export const COLLECTOR_SENTINEL = "LOCAL_ONLY_INVALID_RESEND_SENTINEL";
export const LIMITS = Object.freeze({ bodyBytes: 12 * 1024 * 1024, pdfBytes: 8 * 1024 * 1024, bodyTextBytes: 1024 * 1024, recipients: 50, requestMs: 5000, idempotencyKeyChars: 256 });
const sha = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item);
class PacketError extends Error {
  constructor(statusCode, name, message) { super(message); this.statusCode = statusCode; this.name = name; }
}
const invalid = (message) => { throw new PacketError(422, "validation_error", message); };
const addresses = (value, required) => {
  const list = typeof value === "string" ? [value] : value;
  if (list === undefined && !required) return [];
  if (!Array.isArray(list) || (required && list.length === 0) || list.length > LIMITS.recipients) invalid("Expected bounded fixture addresses.");
  for (const address of list) {
    if (typeof address !== "string" || address.length > 320 || !/^[^\s<>@]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.invalid$/i.test(address)) invalid("Every fixture address must use .invalid.");
  }
  return list;
};
function validate(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) invalid("Expected JSON object.");
  const allowed = new Set(["from", "to", "cc", "subject", "html", "text", "attachments"]);
  if (Object.keys(payload).some((key) => !allowed.has(key))) invalid("Unsupported email field.");
  if (typeof payload.from !== "string" || /[\r\n]/.test(payload.from) || payload.from.length > 512) invalid("Expected local sender.");
  const sender = payload.from.match(/^[^<>\r\n]*<([^<>]+)>$/)?.[1] ?? payload.from;
  addresses(sender, true);
  const to = addresses(payload.to, true);
  const cc = addresses(payload.cc, false);
  if (to.length + cc.length > LIMITS.recipients) invalid("Too many fixture recipients.");
  for (const field of ["subject", "html", "text"]) {
    if (typeof payload[field] !== "string" || !payload[field].trim()) invalid("Subject, HTML and text are required.");
    if (Buffer.byteLength(payload[field]) > (field === "subject" ? 4096 : LIMITS.bodyTextBytes)) throw new PacketError(413, "validation_error", "Email body exceeds local limit.");
  }
  if (!Array.isArray(payload.attachments) || payload.attachments.length !== 1) invalid("One PDF attachment required.");
  const attachment = payload.attachments[0];
  if (!attachment || typeof attachment !== "object" || Array.isArray(attachment) || Object.keys(attachment).some((key) => !["filename", "content"].includes(key))) invalid("Only inline PDF content is supported.");
  if (typeof attachment.filename !== "string" || attachment.filename.length > 256 || /[\/\\\r\n]/.test(attachment.filename) || !attachment.filename.toLowerCase().endsWith(".pdf")) invalid("Expected PDF filename.");
  if (typeof attachment.content !== "string" || !attachment.content || attachment.content.length % 4 !== 0) invalid("Expected canonical PDF base64.");
  if (attachment.content.length > Math.ceil(LIMITS.pdfBytes / 3) * 4) throw new PacketError(413, "validation_error", "PDF exceeds local limit.");
  // A repeated four-character capture can exhaust the regexp stack on large PDFs.
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(attachment.content)) invalid("Expected canonical PDF base64.");
  const pdf = Buffer.from(attachment.content, "base64");
  if (pdf.length > LIMITS.pdfBytes) throw new PacketError(413, "validation_error", "PDF exceeds local limit.");
  if (pdf.toString("base64") !== attachment.content || !pdf.subarray(0, 5).equals(Buffer.from("%PDF-")) || !/%%EOF\s*$/.test(pdf.subarray(-1024).toString("ascii"))) invalid("Expected PDF envelope and canonical base64.");
  return { pdf, to, cc, filename: attachment.filename };
}
async function flushedWrite(file, contents) {
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(contents); await handle.sync(); } finally { await handle.close(); }
}
function publicUrls(payload) {
  const urls = new Set(`${payload.html}\n${payload.text}`.match(/https?:\/\/[^\s<>"']+/g) ?? []);
  return [...urls].map((url) => ({ kind: /\/portal\//.test(url) ? "portal" : "other", sha256: sha(url) }));
}
async function readBody(request) {
  if (Number(request.headers["content-length"]) > LIMITS.bodyBytes) { request.resume(); throw new PacketError(413, "validation_error", "Payload exceeds local limit."); }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > LIMITS.bodyBytes) { request.resume(); throw new PacketError(413, "validation_error", "Payload exceeds local limit."); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
function reply(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

export async function startCollector({ directory, port = 0 }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535 || !path.isAbsolute(directory)) throw new Error("Absolute fresh run directory and valid port required.");
  const receiptRoot = path.join(path.resolve(directory), "receipts");
  await mkdir(receiptRoot); // Fresh ownership; never reuse a previous run.
  const recorded = new Map();
  let queue = Promise.resolve();
  let closed = false;
  const server = http.createServer(async (request, response) => {
    try {
      if (request.method === "GET" && request.url === "/health") { reply(response, 200, { ready: true, collector: "local-offer-transport", limits: LIMITS }); return; }
      if (request.method !== "POST" || request.url !== "/emails") { request.resume(); reply(response, 404, { name: "not_found", statusCode: 404, message: "Unsupported local route." }); return; }
      if (request.headers.authorization !== `Bearer ${COLLECTOR_SENTINEL}`) { request.resume(); throw new PacketError(401, "authentication_error", "Local sentinel required."); }
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string" || key.length === 0 || key.length > LIMITS.idempotencyKeyChars || !/^[\x21-\x7e]+$/.test(key)) { request.resume(); throw new PacketError(400, "invalid_idempotency_key", "Bounded printable idempotency key required."); }
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers["content-type"] ?? "")) { request.resume(); throw new PacketError(400, "validation_error", "JSON content required."); }
      let payload;
      try { payload = JSON.parse(await readBody(request)); }
      catch (error) { if (error instanceof PacketError) throw error; throw new PacketError(400, "validation_error", "Invalid JSON packet."); }
      const valid = validate(payload);
      const keyHash = sha(key);
      const payloadHash = sha(canonical(payload));
      const work = queue.then(async () => {
        const prior = recorded.get(keyHash);
        if (prior) {
          if (prior.payloadSha256 !== payloadHash) throw new PacketError(409, "invalid_idempotent_request", "Idempotency key already used with different payload.");
          return prior.id;
        }
        const id = randomUUID();
        const timestamp = new Date().toISOString();
        const publicReceipt = { schemaVersion: 1, id, receivedAt: timestamp, method: "POST", path: "/emails", idempotencyKeySha256: keyHash, payloadSha256: payloadHash, senderDomain: ".invalid", toCount: valid.to.length, ccCount: valid.cc.length, pdf: { filename: "attachment.pdf", originalFilenameSha256: sha(valid.filename), sha256: sha(valid.pdf), bytes: valid.pdf.length }, urls: publicUrls(payload), delivery: "local-collection-only" };
        const pending = path.join(receiptRoot, `.pending-${randomUUID()}`);
        try {
          await mkdir(path.join(pending, "private"), { recursive: true, mode: 0o700 });
          await mkdir(path.join(pending, "public"), { mode: 0o700 });
          await flushedWrite(path.join(pending, "private", "payload.json"), `${JSON.stringify({ id, receivedAt: timestamp, idempotencyKey: key, payloadSha256: payloadHash, payload }, null, 2)}\n`);
          await flushedWrite(path.join(pending, "private", "attachment.pdf"), valid.pdf);
          await flushedWrite(path.join(pending, "public", "receipt.json"), `${JSON.stringify(publicReceipt, null, 2)}\n`);
          await rename(pending, path.join(receiptRoot, keyHash));
        } catch {
          const resolvedPending = path.resolve(pending);
          if (resolvedPending.startsWith(`${path.resolve(receiptRoot)}${path.sep}.pending-`)) await rm(resolvedPending, { recursive: true, force: true });
          throw new PacketError(500, "api_error", "Local receipt could not be committed.");
        }
        recorded.set(keyHash, { id, payloadSha256: payloadHash });
        return id;
      });
      queue = work.catch(() => undefined);
      const id = await work;
      reply(response, 200, { id });
    } catch (error) {
      if (!response.headersSent && !response.destroyed) reply(response, error instanceof PacketError ? error.statusCode : 500, { name: error instanceof PacketError ? error.name : "api_error", statusCode: error instanceof PacketError ? error.statusCode : 500, message: error instanceof PacketError ? error.message : "Local transport failure." });
    }
  });
  server.requestTimeout = LIMITS.requestMs;
  server.headersTimeout = LIMITS.requestMs;
  server.timeout = LIMITS.requestMs;
  server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"));
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return {
    server,
    directory: path.resolve(directory),
    origin: `http://127.0.0.1:${server.address().port}`,
    async close() {
      if (closed) return;
      closed = true;
      await new Promise((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); });
      await queue;
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2];
  const port = Number(process.argv[3] ?? 0);
  const collector = await startCollector({ directory, port });
  // Safe metadata only. No packet/headers/key/capability logging.
  console.log(JSON.stringify({ collector: "local-offer-transport", origin: collector.origin, receiptDirectory: collector.directory }));
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, async () => { await collector.close(); process.exit(0); });
}
