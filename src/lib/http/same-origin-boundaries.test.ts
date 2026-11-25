import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { POST as importDpgf } from "@/app/api/affaires/[projectId]/intake/files/[documentId]/route";
import { POST as affaireDrive } from "@/app/api/affaires/[projectId]/intake/google-drive/route";
import { POST as driveConnection } from "@/app/api/google-drive/connection/route";
import { readCoverageJson } from "@/lib/estimates/source-coverage-http";
import { createSourceReferenceDeadline, readSourceReferenceJson } from "@/lib/estimates/source-reference-http";

const projectId = "11111111-1111-4111-8111-111111111111";
const documentId = "22222222-2222-4222-8222-222222222222";
const params = Promise.resolve({ projectId, documentId });
const refusal = "Origine de requête refusée.";
const pastOriginCheck = "Payload JSON requis.";
const payload = { value: "fixture" };
const schema = z.object({ value: z.string() });

async function readIntakeResponse(response: Promise<Response>) {
  const result = await response;
  expect(result.status).toBe(400);
  return (await result.json()).error.message;
}

const boundaries = [
  { name: "dossier DPGF", check: (request: Request) => readIntakeResponse(importDpgf(request, { params })), allow: pastOriginCheck, deny: refusal },
  { name: "affaire Drive", check: (request: Request) => readIntakeResponse(affaireDrive(request, { params })), allow: pastOriginCheck, deny: refusal },
  { name: "Drive connection", check: (request: Request) => readIntakeResponse(driveConnection(request)), allow: pastOriginCheck, deny: refusal },
  { name: "source coverage", check: readCoverageJson, allow: payload, deny: "SOURCE_COVERAGE_WRITE_FORBIDDEN" },
  { name: "source reference", check: readSourceReferenceJson, allow: payload, deny: "SOURCE_REVIEW_WRITE_FORBIDDEN" },
];

const localhost = "localhost:3000";
const loopback = "127.0.0.1:3000";
const publicHost = "mergeone.example.test";
const foreignHost = "foreign.example.test";
const direct = { host: loopback, origin: `http://${loopback}` };
const forwarded = { host: publicHost, "x-forwarded-host": publicHost, "x-forwarded-proto": "https", origin: `https://${publicHost}` };
type HeaderCase = { name: string; headers: Record<string, string> };

describe.each(boundaries)("$name same-origin boundary", ({ check, allow, deny }) => {
  beforeEach(() => {
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("VERCEL_ENV", undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  const request = (headers: Record<string, string>, url = `http://${localhost}/api/write`) => new Request(url, {
    method: "POST",
    headers: { "Content-Type": typeof allow === "string" ? "text/plain" : "application/json", ...headers },
    body: JSON.stringify(payload),
  });

  async function checkRequest(input: Request, outcome: "allow" | "deny") {
    const budget = createSourceReferenceDeadline(input, 1000);
    try {
      const result = check(input, schema, budget);
      if (outcome === "deny" && typeof allow !== "string") {
        await expect(result).rejects.toMatchObject({ status: 403, code: deny });
      } else {
        await expect(result).resolves.toEqual(outcome === "allow" ? allow : deny);
      }
    } finally {
      budget.dispose();
    }
  }

  it.each([loopback, localhost])("accepts a page on the addressed HTTP host %s", async (host) => {
    await checkRequest(request({ host, origin: `http://${host}`, "sec-fetch-site": "same-origin" }), "allow");
  });

  it.each([false, true])("accepts the public HTTPS origin with Vercel variables exposed: %s", async (exposed) => {
    if (exposed) {
      vi.stubEnv("VERCEL", "1");
      vi.stubEnv("VERCEL_ENV", "production");
    }
    await checkRequest(request(forwarded, `https://${publicHost}/api/write`), "allow");
    await checkRequest(request(forwarded, "https://localhost:3000/api/write"), "allow");
  });

  it("accepts an HTTPS request without forwarding headers", async () => {
    await checkRequest(request({ host: publicHost, origin: `https://${publicHost}` }, `https://${publicHost}/api/write`), "allow");
  });

  it.each<HeaderCase>([
    { name: "foreign site", headers: { ...direct, origin: `http://${foreignHost}` } },
    { name: "missing Origin", headers: { host: loopback } },
    { name: "opaque Origin", headers: { ...direct, origin: "null" } },
    { name: "missing Host", headers: { origin: `http://${localhost}` } },
    { name: "another loopback hostname", headers: { ...direct, origin: `http://${localhost}` } },
    { name: "another port", headers: { ...direct, origin: "http://127.0.0.1:3001" } },
    { name: "another scheme", headers: { ...direct, origin: `https://${loopback}` } },
    { name: "malformed authority", headers: { ...direct, host: `${loopback}/` } },
    { name: "foreign Host and Origin on a cross-site browser request", headers: { host: foreignHost, origin: `http://${foreignHost}`, "sec-fetch-site": "cross-site" } },
    { name: "untrusted forwarded authority", headers: { host: loopback, origin: `http://${foreignHost}`, "x-forwarded-host": foreignHost, "x-forwarded-proto": "http" } },
  ])("refuses $name", async ({ headers }) => {
    await checkRequest(request(headers), "deny");
  });

  it.each([loopback, localhost, "127.0.0.1:443"])("keeps HTTP for %s even when Next used a forwarded scheme", async (host) => {
    const url = "https://localhost:3000/api/write";
    const headers = { host, origin: `http://${host}`, "x-forwarded-host": host, "x-forwarded-proto": "https" };
    await checkRequest(request(headers, url), "allow");
    await checkRequest(request({ ...headers, origin: new URL(`https://${host}`).origin }, url), "deny");
  });

  it.each<HeaderCase>([
    { name: "unmatched forwarded host even when the Origin matches Host", headers: { ...forwarded, "x-forwarded-host": foreignHost } },
    { name: "unmatched scheme", headers: { ...forwarded, origin: `http://${publicHost}` } },
    { name: "HTTP forwarded as the public scheme", headers: { ...forwarded, "x-forwarded-proto": "http", origin: `http://${publicHost}` } },
    { name: "contradictory forwarded scheme", headers: { ...forwarded, "x-forwarded-proto": "http" } },
    { name: "forwarded scheme list", headers: { ...forwarded, "x-forwarded-proto": "https, http" } },
    { name: "cross-site even with matching host and origin", headers: { ...forwarded, "sec-fetch-site": "cross-site" } },
    { name: "same-site even with matching host and origin", headers: { ...forwarded, "sec-fetch-site": "same-site" } },
  ])("refuses $name on Vercel", async ({ headers }) => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    await checkRequest(request(headers, `https://${publicHost}/api/write`), "deny");
  });
});
