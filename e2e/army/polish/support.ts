import { randomUUID } from "node:crypto";

import type { Browser } from "@e2e-dev/web";

import { POLISH_ROUTES, routeFixtureKeys, type PolishFixtureKey, type PolishRoute } from "../../polish/routes";
import type { ArmyState } from "../critical/fixtures";
import { localClient } from "../takeoff/native-ui";

export type Fixtures = Partial<Record<PolishFixtureKey, string>>;
export type RecordedWrite = { method: string; path: string; verdict: "allowed" | "blocked"; reason: string };

const variables: Record<PolishFixtureKey, string> = {
  projectId: "E2E_UX_PROJECT_ID", versionId: "E2E_UX_VERSION_ID", orderId: "E2E_UX_ORDER_ID",
  takeoffProjectId: "E2E_UX_TAKEOFF_PROJECT_ID", takeoffVersionId: "E2E_UX_TAKEOFF_VERSION_ID",
  takeoffJobId: "E2E_UX_TAKEOFF_JOB_ID", portalToken: "E2E_UX_PORTAL_TOKEN",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const readMethods = new Set(["GET", "HEAD", "OPTIONS"]);
const mappingActions = new Set(["preview", "structure-preview", "suggestions", "validate", "duplicates"]);

export function selectedRoutes() {
  const ids = process.env.E2E_ARMY_POLISH_ROUTES?.split(",").map(value => value.trim()).filter(Boolean) ?? [];
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !POLISH_ROUTES.some(route => route.id === id))) {
    throw new Error("E2E_ARMY_POLISH_ROUTES must explicitly name distinct existing polish route ids.");
  }
  return ids.map(id => POLISH_ROUTES.find(route => route.id === id)!);
}

export function routeFixtures(route: PolishRoute): Fixtures {
  const fixtures: Fixtures = {};
  for (const key of routeFixtureKeys(route)) {
    const value = process.env[variables[key]]?.trim();
    if (!value || !uuid.test(value)) throw new Error(`Missing or invalid polish fixture: ${variables[key]}.`);
    fixtures[key] = value;
  }
  return fixtures;
}

export function fixtureEvidence(fixtures: Fixtures) {
  return Object.fromEntries(Object.entries(fixtures).map(([key, value]) =>
    [key, key === "portalToken" ? "<provided-portal-token>" : value]));
}

export function polishState(route: PolishRoute): ArmyState {
  const runPrefix = `ARMY-${Date.now()}-${randomUUID().slice(0, 8)}-polish-${route.id}`;
  return { runPrefix, projectName: runPrefix, ownedEstimates: [] };
}

export function localBackend() {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (backend.protocol !== "http:" || backend.username || backend.password || backend.pathname !== "/" || backend.search || backend.hash ||
    !["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname) || backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST) {
    throw new Error("Polish requires the explicitly allowlisted bare local Supabase origin.");
  }
  return backend;
}

// No discovery or privilege escalation: each supplied identity must resolve under
// the existing account's RLS, and opening an editor must never acquire a draft lock.
export async function verifyFixtures(fixtures: Fixtures, army: ArmyState) {
  if (!Object.keys(fixtures).length) return;
  localBackend();
  const { client, userId } = await localClient();
  const checkedProjects = new Set<string>();
  const checkTenant = async (id: string) => {
    const tenant = await client.from("tenants").select("name").eq("id", id).single();
    if (tenant.error || !/^ARMY\b/.test(tenant.data.name)) throw new Error("Polish fixture requires a dedicated ARMY tenant.");
  };
  const checkProject = async (id: string) => {
    if (checkedProjects.has(id)) return;
    const project = await client.from("estimate_projects").select("name, user_id, tenant_id").eq("id", id).single();
    if (project.error || project.data.user_id !== userId || !/^ARMY\b/.test(project.data.name)) {
      throw new Error("Polish project must be an explicitly supplied ARMY project owned by the account.");
    }
    await checkTenant(project.data.tenant_id);
    checkedProjects.add(id);
  };
  const checkVersion = async (id: string, expectedProject?: string) => {
    const version = await client.from("estimate_versions").select("project_id, tenant_id, status").eq("id", id).single();
    if (version.error || version.data.status === "draft" || (expectedProject && version.data.project_id !== expectedProject)) {
      throw new Error("Polish version must be readable, non-draft and match the supplied project.");
    }
    await checkProject(version.data.project_id);
    await checkTenant(version.data.tenant_id);
    if (!army.ownedEstimates.some(item => item.versionId === id)) army.ownedEstimates.push({ projectId: version.data.project_id, versionId: id });
    return version.data;
  };
  for (const projectId of [fixtures.projectId, fixtures.takeoffProjectId]) if (projectId) await checkProject(projectId);
  if (fixtures.versionId) await checkVersion(fixtures.versionId, fixtures.projectId);
  if (fixtures.takeoffVersionId) await checkVersion(fixtures.takeoffVersionId, fixtures.takeoffProjectId);
  if (fixtures.takeoffJobId) {
    const job = await client.from("takeoff_jobs").select("estimate_version_id, tenant_id").eq("id", fixtures.takeoffJobId).single();
    if (job.error || (fixtures.takeoffVersionId && job.data.estimate_version_id !== fixtures.takeoffVersionId)) {
      throw new Error("Polish takeoff job must match its supplied version.");
    }
    const version = await checkVersion(job.data.estimate_version_id, fixtures.takeoffProjectId);
    if (version.tenant_id !== job.data.tenant_id) throw new Error("Polish takeoff tenant differs from its version.");
  }
  if (fixtures.orderId) {
    const order = await client.from("purchase_orders").select("user_id, tenant_id, source_estimate_version_id").eq("id", fixtures.orderId).single();
    if (order.error || order.data.user_id !== userId) throw new Error("Polish order must belong to the current account.");
    await checkTenant(order.data.tenant_id);
    if (order.data.source_estimate_version_id) await checkVersion(order.data.source_estimate_version_id);
  }
  if (fixtures.portalToken) {
    const token = await client.from("portal_tokens").select("version_id, tenant_id").eq("token", fixtures.portalToken).single();
    if (token.error) throw new Error("Polish portal fixture is unavailable to the account.");
    const version = await checkVersion(token.data.version_id);
    if (version.tenant_id !== token.data.tenant_id) throw new Error("Polish portal tenant differs from its version.");
  }
}

export async function installWriteGuard(browser: Browser, appOrigin: string) {
  const backendOrigin = localBackend().origin;
  const writes: RecordedWrite[] = [];
  await browser.route("**/*", async route => {
    const request = route.request;
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    if (url.hostname === "api.fontshare.com" && url.pathname === "/v2/css" && method === "GET") {
      await route.fulfill({ headers: { "content-type": "text/css" }, body: "" });
      return;
    }
    const isApp = url.origin === appOrigin;
    const isBackend = url.origin === backendOrigin;
    let reason = !isApp && !isBackend ? "external host" : "mutation";
    let allowed = (isApp || isBackend) && readMethods.has(method);
    if (!allowed && (isApp || isBackend)) {
      if (isBackend && url.pathname.startsWith("/auth/v1/token")) { allowed = true; reason = "auth refresh"; }
      else if (isBackend && url.pathname.startsWith("/rest/v1/rpc/")) { allowed = true; reason = "RPC recorded"; }
      else if (isApp && url.pathname.startsWith("/__nextjs")) { allowed = true; reason = "development overlay"; }
      else if (isApp && /web-vitals/i.test(url.pathname)) { allowed = true; reason = "web vitals beacon"; }
      else if (isApp && request.headers["next-action"]) { allowed = true; reason = "server action recorded"; }
      else if (isApp && url.pathname === "/api/mappings") {
        let action = "";
        try { action = String((JSON.parse(request.postData ?? "null") as { action?: unknown } | null)?.action ?? ""); } catch { /* Malformed data stays blocked. */ }
        if (mappingActions.has(action)) { allowed = true; reason = "read-only mapping action"; }
      }
    }
    if (!readMethods.has(method) || !allowed) writes.push({
      method, path: url.pathname.replace(/^(\/portal\/)[^/]+/, "$1<portal-token>"),
      verdict: allowed ? "allowed" : "blocked", reason,
    });
    if (allowed) await route.fallback();
    else await route.abort();
  });
  return { drain: () => writes.splice(0, writes.length) };
}
