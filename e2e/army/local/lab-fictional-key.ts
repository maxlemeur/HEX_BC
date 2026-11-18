import { createHmac } from "node:crypto";

/**
 * LAB05's fictional OpenAI key (takeoff-lab.e2e.ts), derived from the run's random login password: the runner's
 * config registers it as the secret « lab-api-key » (e2e.config.ts), so the runner's own reports redact it, and
 * the journey recomputes it to give the provider fixture its SHA-256 and to look for it where it must not be.
 * Never a real key.
 */
export function labFictionalApiKey(password: string) {
  return `sk-proj-army${createHmac("sha256", password).update("takeoff-lab LAB05 fictional key").digest("base64url")}`;
}
