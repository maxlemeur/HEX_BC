// The workflow's HTTP boundary. Only fixed labels and validated counters may be logged.
// Policy and local HTTP regression: docs/testing/tech-debt-recovery-detection.md.
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_TIMEOUT_MS = 280_000;

class RecoveryCheckError extends Error {}

function reject(reason) {
  throw new RecoveryCheckError(reason);
}

function readConfiguration() {
  const secret = process.env.CRON_SECRET ?? "";
  const origin = process.env.HEX_APP_URL || process.env.APP_URL || "";
  const rawTimeout = process.env.RECOVERY_TIMEOUT_MS ?? String(MAX_TIMEOUT_MS);
  const timeout = Number(rawTimeout);
  if (!secret.trim() || /[\r\n]/.test(secret) || !/^\d+$/.test(rawTimeout) ||
      !Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_MS) {
    reject("invalid-configuration");
  }
  let url;
  try {
    url = new URL(origin);
  } catch {
    reject("invalid-configuration");
  }
  const localHttp = url.protocol === "http:" &&
    ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
  if ((url.protocol !== "https:" && !localHttp) || url.username || url.password ||
      url.pathname !== "/" || url.search || url.hash) {
    reject("invalid-configuration");
  }
  url.pathname = "/api/internal/workflows/recover";
  return { url, secret, timeout };
}

async function requestRecovery({ url, secret, timeout }) {
  const signal = AbortSignal.timeout(timeout);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      redirect: "manual",
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      reject("http-error");
    }
    const chunks = [];
    let size = 0;
    if (response.body) {
      for await (const chunk of response.body) {
        size += chunk.byteLength;
        if (size > MAX_RESPONSE_BYTES) reject("response-too-large");
        chunks.push(chunk);
      }
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      reject("invalid-response");
    }
  } catch (error) {
    if (error instanceof RecoveryCheckError) throw error;
    reject(signal.aborted ? "request-timeout" : "request-failed");
  }
}

function hasCounters(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    keys.every((key) => Number.isSafeInteger(value[key]) && value[key] >= 0);
}

function isDrain(value, keys) {
  return hasCounters(value, keys) && typeof value.skipped === "boolean" &&
    Array.isArray(value.errors) && value.errors.every((error) => typeof error === "string");
}

function checkResult(body) {
  if (!hasCounters(body, ["recoveredUnknownTakeoffJobs", "dueCount", "dispatchedCount",
    "failedCount", "skippedCount", "deadCount"]) ||
    !Array.isArray(body.failures) || body.failures.length !== body.failedCount ||
    !body.failures.every((failure) => failure !== null && typeof failure === "object" &&
      typeof failure.workId === "string" && typeof failure.message === "string") ||
    !isDrain(body.procurementStorageCleanup, ["claimed", "removed", "failed"]) ||
    !isDrain(body.emailOutbox, ["claimed", "sent", "failed", "dead"])) {
    reject("invalid-response");
  }
  const storage = body.procurementStorageCleanup;
  const email = body.emailOutbox;
  // Never stringify the response: error messages and work IDs may contain user data.
  console.log(`Recovery counters ${JSON.stringify({
    recoveredUnknownTakeoffJobs: body.recoveredUnknownTakeoffJobs,
    dueCount: body.dueCount,
    dispatchedCount: body.dispatchedCount,
    failedCount: body.failedCount,
    skippedCount: body.skippedCount,
    deadCount: body.deadCount,
    storageClaimed: storage.claimed,
    storageRemoved: storage.removed,
    storageFailed: storage.failed,
    storageSkipped: storage.skipped,
    storageErrors: storage.errors.length,
    emailClaimed: email.claimed,
    emailSent: email.sent,
    emailFailed: email.failed,
    emailDead: email.dead,
    emailSkipped: email.skipped,
    emailErrors: email.errors.length,
  })}`);
  if (body.deadCount > 0 || email.dead > 0) reject("retry-budget-exhausted");
  if (storage.skipped || storage.failed > storage.claimed ||
      (storage.errors.length > 0 && storage.failed === 0) ||
      email.failed > email.claimed || (email.errors.length > 0 && email.failed === 0) ||
      (email.skipped && (email.claimed > 0 || email.sent > 0 || email.failed > 0 || email.errors.length > 0))) {
    reject("drain-unavailable");
  }
  if (body.failedCount > 0 || storage.failed > 0 || email.failed > 0) {
    console.log("::warning::Recovery degraded: individual failures remain; inspect the queues. Retryability is not established by this response.");
  } else {
    console.log("Recovery healthy");
  }
}

try {
  checkResult(await requestRecovery(readConfiguration()));
} catch (error) {
  const reason = error instanceof RecoveryCheckError ? error.message : "check-failed";
  console.error(`::error::Recovery failed: ${reason}`);
  process.exitCode = 1;
}
