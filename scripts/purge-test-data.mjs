// The weekly purge's HTTP boundary (.github/workflows/purge-test-data.yml).
// Only validated counters are logged. Policy: supabase/README.md, "Données de test";
// regression: src/test/test-data-purge-command.test.ts.
const MAX_RESPONSE_BYTES = 16 * 1024;
const TIMEOUT_MS = 280_000;

class PurgeCheckError extends Error {}

function reject(reason) {
  throw new PurgeCheckError(reason);
}

function readConfiguration() {
  const secret = process.env.CRON_SECRET ?? "";
  const origin = process.env.HEX_APP_URL || process.env.APP_URL || "";
  const dryRun = process.env.PURGE_DRY_RUN ?? "0";
  if (!secret.trim() || /[\r\n]/.test(secret) || !["0", "1"].includes(dryRun)) reject("invalid-configuration");
  let url;
  try {
    url = new URL(origin);
  } catch {
    reject("invalid-configuration");
  }
  const localHttp = url.protocol === "http:" && ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    reject("invalid-configuration");
  }
  url.pathname = "/api/internal/test-data/purge";
  if (dryRun === "1") url.searchParams.set("dryRun", "1");
  return { url, secret, dryRun: dryRun === "1" };
}

async function requestPurge({ url, secret }) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${secret}` }, redirect: "manual", signal });
    if (!response.ok) {
      await response.body?.cancel();
      reject("http-error");
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength;
      if (size > MAX_RESPONSE_BYTES) reject("response-too-large");
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      reject("invalid-response");
    }
  } catch (error) {
    if (error instanceof PurgeCheckError) throw error;
    reject(signal.aborted ? "request-timeout" : "request-failed");
  }
}

function checkResult(body, dryRun) {
  const counters = ["eligible", "deleted", "failed"];
  if (body === null || typeof body !== "object" || Array.isArray(body) || body.dryRun !== dryRun ||
      typeof body.remaining !== "boolean" ||
      !counters.every((key) => Number.isSafeInteger(body[key]) && body[key] >= 0) ||
      (dryRun ? body.deleted !== 0 : body.eligible !== 0)) {
    reject("invalid-response");
  }
  console.log(`Test data purge counters ${JSON.stringify({
    dryRun: body.dryRun, eligible: body.eligible, deleted: body.deleted, failed: body.failed, remaining: body.remaining,
  })}`);
  if (body.failed > 0) reject("deletions-failed");
  if (body.remaining) console.log("::warning::Test data purge stopped on its batch budget; the next run continues.");
}

try {
  const configuration = readConfiguration();
  checkResult(await requestPurge(configuration), configuration.dryRun);
} catch (error) {
  const reason = error instanceof PurgeCheckError ? error.message : "check-failed";
  console.error(`::error::Test data purge failed: ${reason}`);
  process.exitCode = 1;
}
