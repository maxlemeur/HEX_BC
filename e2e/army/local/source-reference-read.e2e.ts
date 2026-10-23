import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, type Browser } from "@e2e-dev/web";
import { expect } from "e2e";

import { isOwnedLoopback } from "./owned-business-inputs";

import { readEstimate, recordEvidence, restrictCriticalBrowser } from "../critical/fixtures";

type Fixture = {
  schemaVersion: string; status: string; apiUrl: string; prefix: string;
  tenantId: string; ownerId: string; projectId: string; versionId: string;
  documents: { A: string; B: string };
};
type Response = { status: number; cacheControl: string | null; contentType: string | null; body: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// This transport can only GET this route. It neither acquires an editor lock
// nor calls source-copy/activation endpoints. Anonymous means no cookies.
async function readReview(browser: Browser, pathname: string, anonymous = false): Promise<Response> {
  if (!/^\/api\/estimates\/(?:[0-9a-f-]{36}|not-a-uuid)\/source-review(?:\?|$)/i.test(pathname)) throw new Error("Only the planned source-review GET is allowed");
  return JSON.parse(await browser.evaluate(async (request) => {
    const response = await fetch(request.pathname, {
      method: "GET", credentials: request.anonymous ? "omit" : "same-origin",
      redirect: "error", cache: "no-store",
    });
    const text = await response.text();
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = { invalidJson: true }; }
    return JSON.stringify({ status: response.status, cacheControl: response.headers.get("cache-control"), contentType: response.headers.get("content-type"), body });
  }, { pathname, anonymous })) as Response;
}

function assertResponse(response: Response, status: number, body: unknown) {
  expect(response.status).toBe(status);
  expect(response.cacheControl).toBe("private, no-store");
  expect(response.contentType).toContain("application/json");
  // Equality rejects extra fields, including private row details and locators.
  expect(response.body).toEqual(body);
}

test("source reference GET reads pristine review without creation and rejects invalid or inaccessible reads", {
  session: "army", tags: ["critical", "local", "source-reference-read"], trace: "off", timeout: 180_000,
}, async ({ app, browser }) => {
  const file = process.env.E2E_SOURCE_REFERENCE_READ_FIXTURE_PATH;
  if (!file || !isOwnedLoopback(process.env.NEXT_PUBLIC_SUPABASE_URL)) throw new Error("Explicit local source-reference fixture required");
  const fixture = JSON.parse(await readFile(file, "utf8")) as Fixture;
  expect([fixture.schemaVersion, fixture.status, fixture.apiUrl]).toEqual(["source-reference-http-fixture-1", "ready", process.env.NEXT_PUBLIC_SUPABASE_URL]);
  expect(fixture.prefix.startsWith("ARMY-REFERENCE-")).toBe(true);
  expect([fixture.tenantId, fixture.ownerId, fixture.projectId, fixture.versionId, fixture.documents.A, fixture.documents.B].every((id) => UUID.test(id))).toBe(true);
  const army = { runPrefix: `${fixture.prefix}-read-${randomUUID()}`, projectName: fixture.prefix, ownedEstimates: [{ projectId: fixture.projectId, versionId: fixture.versionId }] };
  await restrictCriticalBrowser(browser, app);
  // The list establishes the ordinary context without opening the affaire's
  // approval synchronizer or delivery lookup, nor acquiring an editor lock.
  await app.open("/dashboard/estimates");
  const before = await readEstimate(browser, fixture.versionId);
  await recordEvidence(army, "source-read-before", before);
  expect([before.version.id, before.version.project_id, before.version.status]).toEqual([fixture.versionId, fixture.projectId, "draft"]);
  expect([before.version.total_ht_cents, before.version.total_tax_cents, before.version.total_ttc_cents]).toEqual([0, 0, 0]);
  expect(before.items).toEqual([]);

  const base = `/api/estimates/${fixture.versionId}/source-review`;
  const initial = { ok: true, data: { versionId: fixture.versionId, projectId: fixture.projectId, revision: 0, activeReference: null, selectedCopy: null, history: [], nextBeforeRevision: null, confirmationReceipt: null } };
  const observed: Array<{ label: string; pathname: string; anonymous: boolean; response: Response }> = [];
  async function probe(label: string, pathname: string, anonymous = false) {
    const response = await readReview(browser, pathname, anonymous);
    observed.push({ label, pathname, anonymous, response });
    await recordEvidence(army, `source-read-${String(observed.length).padStart(2, "0")}-${label}`, observed.at(-1));
    return response;
  }
  const valid = [
    ["initial", base], ["limit-1", `${base}?limit=1`], ["limit-20", `${base}?limit=20`],
    ["limit-100", `${base}?limit=100`], ["cursor-1", `${base}?cursor=1`],
    ["cursor-beyond-history", `${base}?cursor=9007199254740991&limit=100`],
    ["uppercase-version", `/api/estimates/${fixture.versionId.toUpperCase()}/source-review`],
    ["absent-confirmation", `${base}?confirmationKey=${randomUUID().toUpperCase()}`],
  ];
  for (const [label, pathname] of valid) assertResponse(await probe(label, pathname), 200, initial);

  const id = randomUUID();
  const invalid = [
    ["unknown", "unknown=1"], ["untrusted-actor", `actorId=${fixture.ownerId}`],
    ["duplicate-limit", "limit=1&limit=1"], ["duplicate-cursor", "cursor=1&cursor=2"],
    ["duplicate-copy", `copyId=${id}&copyId=${id}`], ["duplicate-confirmation", `confirmationKey=${id}&confirmationKey=${id}`],
    ["limit-zero", "limit=0"], ["limit-negative", "limit=-1"], ["limit-fraction", "limit=1.5"],
    ["limit-too-large", "limit=101"], ["limit-overflow", "limit=9007199254740992"],
    ["limit-empty", "limit="], ["limit-space", "limit=%20"], ["limit-exponent", "limit=1e2"],
    ["cursor-zero", "cursor=0"], ["cursor-negative", "cursor=-1"], ["cursor-fraction", "cursor=1.5"],
    ["cursor-overflow", "cursor=9007199254740992"], ["cursor-too-long", "cursor=10000000000000000"],
    ["cursor-empty", "cursor="], ["cursor-nan", "cursor=NaN"], ["cursor-infinity", "cursor=Infinity"],
    ["invalid-copy", "copyId=not-a-uuid"], ["invalid-confirmation", "confirmationKey=not-a-uuid"],
  ];
  const invalidBody = { ok: false, error: { code: "SOURCE_REVIEW_INVALID_INPUT", message: "Paramètres de revue documentaire invalides." } };
  for (const [label, query] of invalid) assertResponse(await probe(label, `${base}?${query}`), 400, invalidBody);
  assertResponse(await probe("invalid-version", "/api/estimates/not-a-uuid/source-review"), 400, invalidBody);
  const deniedBody = { ok: false, error: { code: "SOURCE_REVIEW_ACCESS_DENIED", message: "Revue documentaire inaccessible." } };
  assertResponse(await probe("missing-version", `/api/estimates/${randomUUID()}/source-review`), 404, deniedBody);
  assertResponse(await probe("missing-copy", `${base}?copyId=${randomUUID()}`), 404, deniedBody);
  assertResponse(await probe("anonymous", base, true), 401, { ok: false, error: { code: "UNAUTHORIZED", message: "Authentification requise." } });
  assertResponse(await probe("repeat-final", base), 200, initial);

  const after = await readEstimate(browser, fixture.versionId);
  await recordEvidence(army, "source-read-after", after);
  expect(after).toEqual(before);
  await recordEvidence(army, "source-read-complete", {
    observed, estimateUnchanged: true, expectedNativeCounts: { reviews: 0, copies: 0, events: 0 },
    coverage: { SR01: "initial GET only", SR02: "anonymous and absent-resource reads only", sourcePostExecuted: false, populatedHistory: false, fullRoleMatrix: false, sourceReviewUi: false },
  });
});
