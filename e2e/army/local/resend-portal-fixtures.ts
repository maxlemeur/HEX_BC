import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { test, type Browser } from "@e2e-dev/web";
import type { App } from "e2e";

import { COLLECTOR_SENTINEL } from "../../../scripts/tester-army/offer-collector.mjs";
import type { ArmyState } from "../critical/fixtures";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const address = (value: unknown): value is string => typeof value === "string" && /^[^\s<>@]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.invalid$/i.test(value);
function collectorMode() {
  const url = new URL(process.env.E2E_OFFER_COLLECTOR_ORIGIN ?? "");
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.origin !== process.env.E2E_OFFER_COLLECTOR_ORIGIN || process.env.RESEND_BASE_URL !== url.origin || process.env.RESEND_API_KEY !== COLLECTOR_SENTINEL || process.env.EMAIL_FROM !== "ARMY Local <offer@army.invalid>") throw new Error("Offer fixture requires validated local collector mode.");
  return url.origin;
}
function campaignDirectory() {
  const root = path.resolve(".e2e/army/offer/runs");
  const configured = process.env.E2E_OFFER_RUN_DIRECTORY;
  const directory = path.resolve(configured ?? "");
  if (!configured || !directory.startsWith(`${root}${path.sep}`)) throw new Error("Explicit offer fixture campaign directory required.");
  return directory;
}

const lifecycleAdmissions = new WeakMap<ArmyState, Map<string, "accepted" | "archived">>();

/** One exact, owned manual lifecycle request; never admits portal decisions. */
export function allowOfferLifecycleTransition(army: ArmyState, versionId: string, status: "accepted" | "archived") {
  if (!/^ARMY-OFFER-[a-z0-9-]+$/i.test(army.runPrefix)
    || !army.ownedEstimates.some((owned) => owned.versionId === versionId)) {
    throw new Error("Manual lifecycle admission requires a retained owned offer fixture.");
  }
  const admissions = lifecycleAdmissions.get(army) ?? new Map<string, "accepted" | "archived">();
  if (admissions.has(versionId)) throw new Error("Previous manual lifecycle admission was not consumed.");
  admissions.set(versionId, status);
  lifecycleAdmissions.set(army, admissions);
}

type ResendDecision = "accept" | "reject";
const portalAdmissions = new WeakMap<ArmyState, Map<string, { decision: ResendDecision; reason: string | null; versionId: string; providerId: string }>>();

/** One exact form POST from the SECOND real local receipt for this owned version. */
export async function admitCollectedResendDecision(army: ArmyState, input: {
  projectId: string; versionId: string; receiptDirectory: string; providerId: string;
  initialProviderId: string; portalUrl: string; initialPortalUrl: string;
  decision: ResendDecision; reason: string | null;
}) {
  if (!army.ownedEstimates.some((owned) => owned.projectId === input.projectId && owned.versionId === input.versionId)
    || input.providerId === input.initialProviderId || input.portalUrl === input.initialPortalUrl) {
    throw new Error("Portal admission requires the distinct collected resend for the exact owned fixture.");
  }
  const root = path.join(campaignDirectory(), "collector", "receipts");
  const directory = path.resolve(input.receiptDirectory);
  if (path.dirname(directory) !== root || !/^[a-f0-9]{64}$/.test(path.basename(directory))) throw new Error("Collected resend source escaped private campaign.");
  const receipt = JSON.parse(await readFile(path.join(directory, "public", "receipt.json"), "utf8"));
  const packet = JSON.parse(await readFile(path.join(directory, "private", "payload.json"), "utf8"));
  if (receipt.id !== input.providerId || packet.id !== input.providerId || receipt.delivery !== "local-collection-only"
    || !receipt.pdf?.sha256 || !packet.payload?.html?.includes(army.runPrefix)) throw new Error("Resend source receipt/fixture mismatch.");
  const links = [...packet.payload.html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .filter((link: RegExpMatchArray) => link[2].replace(/<[^>]*>/g, "").trim() === "Consulter le devis");
  if (links.length !== 1 || links[0][1].replace(/&amp;/g, "&") !== input.portalUrl) throw new Error("Admission URL does not come from collected resend CTA.");
  const url = new URL(input.portalUrl);
  const token = url.pathname.match(/^\/portal\/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/i)?.[1];
  if (url.origin !== process.env.E2E_OFFER_APP_ORIGIN || !token || url.username || url.password || url.search || url.hash
    || (input.decision === "accept" && input.reason !== null)
    || (input.decision === "reject" && (!input.reason || !input.reason.startsWith(army.runPrefix)))) throw new Error("Exact owned portal admission invalid.");
  const map = portalAdmissions.get(army) ?? new Map();
  if (map.size || map.has(token)) throw new Error("Previous portal admission is unconsumed.");
  map.set(token, { decision: input.decision, reason: input.reason, versionId: input.versionId, providerId: input.providerId });
  portalAdmissions.set(army, map);
}

export function redactOfferEvidence(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/https?:\/\/[^\s<>"']+/g, (raw) => {
        try { const url = new URL(raw); return `[url ${url.origin}${url.pathname.replace(/\/portal\/[^/]+/g, "/portal/[redacted]")} sha256:${digest(raw)}]`; }
        catch { return `[url sha256:${digest(raw)}]`; }
      })
      .replace(/\/portal\/[^/?#\s"'<>\]]+(?:\?[^\s"'<>\]]*)?/g, "/portal/[redacted]")
      .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[jwt-redacted]")
      .replace(/(?:password|token|access_token|refresh_token|api_key|code)=([^&\s]+)/gi, "secret=[redacted]");
  }
  if (Array.isArray(value)) return value.map(redactOfferEvidence);
  if (value && typeof value === "object") {
    if (Buffer.isBuffer(value)) return { bytes: value.length, sha256: createHash("sha256").update(value).digest("hex"), raw: "private-only" };
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /^(?:headers?|authorization|cookies?|set-cookie|password|.*token.*|portalurl|.*api[_-]?key|html(?:_body)?|text_body)$/i.test(key) ? { redacted: true, ...(typeof item === "string" ? { sha256: digest(item) } : {}) } : redactOfferEvidence(item)]));
  }
  return value;
}

export async function recordOfferEvidence(army: ArmyState, label: string, data: unknown) {
  if (!/^[a-z0-9-]+$/i.test(label) || !/^ARMY-OFFER-[a-z0-9-]+$/i.test(army.runPrefix)) throw new Error("Offer evidence needs an owned simple fixture label.");
  const directory = path.join(campaignDirectory(), "public", "business");
  await mkdir(directory, { recursive: true });
  const body = `${JSON.stringify(redactOfferEvidence({ schemaVersion: "miaouffrage-army-offer-1", recordedAt: new Date().toISOString(), fixturePrefix: army.runPrefix, projectName: army.projectName, ownedEstimates: army.ownedEstimates, data }), null, 2)}\n`;
  const file = path.join(directory, `${army.runPrefix}-${label}.json`);
  await writeFile(file, body, { flag: "wx" });
  return { path: file, sha256: digest(body) };
}

export async function restrictOfferBrowser(browser: Browser, app: App, army?: ArmyState) {
  const origin = new URL(app.baseUrl!).origin;
  const native = new URL(process.env.E2E_OFFER_BACKEND_ORIGIN ?? "").origin;
  if (origin !== process.env.E2E_OFFER_APP_ORIGIN || native !== process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error("Offer browser exact origins mismatch.");
  collectorMode();
  await browser.route("**/*", async (route) => {
    const url = new URL(route.request.url);
    const method = route.request.method.toUpperCase();
    if (url.hostname === "api.fontshare.com" && url.pathname === "/v2/css" && method === "GET") { await route.fulfill({ headers: { "content-type": "text/css" }, body: "" }); return; }
    const read = ["GET", "HEAD", "OPTIONS"].includes(method);
    const auth = url.origin === native && ((url.pathname === "/auth/v1/token" && ["POST", "OPTIONS"].includes(method) && url.searchParams.get("grant_type") === "password") || (url.pathname === "/auth/v1/logout" && ["POST", "OPTIONS"].includes(method)) || (url.pathname === "/auth/v1/user" && read));
    const lookup = url.origin === native && url.pathname === "/rest/v1/delivery_sites" && read;
    const signedPdf = url.pathname.match(/^\/storage\/v1\/object\/sign\/estimate-documents\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/[0-9a-f]{64}\.pdf$/i);
    const ownPdfRead = url.origin === native && read && !!signedPdf && !!army &&
      army.ownedEstimates.some((owned) => owned.projectId === signedPdf[2] && owned.versionId === signedPdf[3]);
    let allowed = auth || lookup || ownPdfRead || (url.origin === origin && read);
    if (url.origin === origin && !read && army) {
      let payload: Record<string, unknown> | undefined;
      try { const parsed: unknown = JSON.parse(route.request.postData ?? "null"); if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) payload = parsed as Record<string, unknown>; } catch { /* A non-JSON ServerAction has its own exact-owned path below. */ }
      const portalMatch = url.pathname.match(/^\/api\/portal\/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})\/(accept|reject)$/i);
      if (portalMatch) {
        const admitted = portalAdmissions.get(army)?.get(portalMatch[1]);
        const exactBody = admitted?.decision === "accept"
          ? payload?.accepted_terms === true && Object.keys(payload ?? {}).length === 1
          : admitted?.decision === "reject" && payload?.reason === admitted.reason && Object.keys(payload ?? {}).length === 1;
        allowed = method === "POST" && !url.search && !url.hash && !!admitted
          && portalMatch[2] === admitted.decision && exactBody === true
          && army.ownedEstimates.some((owned) => owned.versionId === admitted.versionId);
        if (allowed) portalAdmissions.get(army)?.delete(portalMatch[1]);
      }
      const versionMatch = url.pathname.match(/^\/api\/estimates\/([0-9a-f-]{36})(?:\/(.*))?$/i);
      const versionOwned = !!versionMatch && army.ownedEstimates.some((item) => item.versionId === versionMatch[1]);
      const prohibited = /\/(?:approve|reject|reconcile|email-dispatch|portal-tokens?|invite|invitations)(?:\/|$)/i.test(url.pathname) || url.pathname.startsWith("/portal/");
      if (!prohibited && versionOwned) {
        const operation = versionMatch![2] ?? "";
        if (operation === "send") {
          collectorMode();
          const cc = payload?.cc;
          allowed = method === "POST" && address(payload?.to) && (cc === undefined || (Array.isArray(cc) && cc.length <= 49 && cc.every(address))) && Object.keys(payload ?? {}).every((key) => ["to", "cc", "subject", "message"].includes(key));
        } else if (operation === "status") {
          collectorMode();
          const admitted = lifecycleAdmissions.get(army)?.get(versionMatch![1]);
          const lifecycle = admitted !== undefined && payload?.status === admitted
            && Object.keys(payload ?? {}).length === 1 && Object.keys(payload ?? {})[0] === "status";
          allowed = method === "PATCH" && (["draft", "sent"].includes(String(payload?.status)) || lifecycle);
          if (allowed && lifecycle) lifecycleAdmissions.get(army)?.delete(versionMatch![1]);
        } else {
          allowed = ["POST", "PATCH", "PUT"].includes(method) || (method === "DELETE" && operation === "lock");
        }
      }
      if (url.pathname === "/api/estimates" && method === "POST") {
        const project = payload?.project;
        const name = project && typeof project === "object" && !Array.isArray(project) ? (project as Record<string, unknown>).name : undefined;
        allowed = typeof name === "string" && name.startsWith(`${army.runPrefix}-`) && payload?.project_id === undefined && payload?.projectId === undefined;
      }
      const projectMatch = url.pathname.match(/^\/(?:api\/affaires|dashboard\/affaires)\/([0-9a-f-]{36})$/i);
      if (projectMatch && army.ownedEstimates.some((item) => item.projectId === projectMatch[1])) allowed = url.pathname.startsWith("/api/") ? method === "PATCH" : method === "POST";
    }
    if (!allowed || url.username || url.password) {
      await route.abort();
      throw new Error(`Offer browser blocked ${method} ${url.origin === origin ? "app" : url.origin === native ? "native" : "external"} request; unsafe scope or mutation.`);
    }
    await route.continue();
  });
}

export const offerTest = test.extend<{ army: ArmyState }>({
  army: async ({ app, browser }, provideFixture) => {
    const runPrefix = `ARMY-OFFER-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const army: ArmyState = { runPrefix, projectName: runPrefix, ownedEstimates: [] };
    campaignDirectory();
    const health = await fetch(`${collectorMode()}/health`, { redirect: "error", signal: AbortSignal.timeout(5000) });
    const ready = await health.json() as { ready?: boolean; collector?: string };
    if (health.status !== 200 || ready.ready !== true || ready.collector !== "local-offer-transport") throw new Error("Offer collector setup missing proof.");
    await restrictOfferBrowser(browser, app, army);
    try { await provideFixture(army); }
    finally { await recordOfferEvidence(army, "fixture-retained", { retained: true, cleanup: "none", issuance: "only actual app and local collector, as asserted by each test", ancillaryCreationEvidence: "unchanged critical helper path; root must copy/index this fixture only" }); }
  },
});
