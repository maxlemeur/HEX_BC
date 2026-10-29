import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Browser } from "@e2e-dev/web";
import { expect, type App } from "e2e";

import { signUpDedicatedOwner } from "../local/dedicated-owner";
import { apiRequest, armyTest, recordEvidence, type ArmyState } from "./fixtures";

const options = { session: "army", tags: ["critical", "affaires"], timeout: 90_000 };
const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

// Observable failures: an existing PostgreSQL UUID can fail RFC version/variant
// validation before archive/delete. A malformed ID must still reject the entire
// request, while tenant, role and draft eligibility checks must remain effective.
async function localContext(browser: Browser, app: App, army: ArmyState) {
  const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" ||
      origin.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST || !origin.port ||
      ["45585", "33485"].includes(origin.port)) {
    throw new Error("Legacy identifier fixtures require the owned native loopback stack.");
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Owned fixture provisioning key required.");
  const admin = createClient(origin.href, key, clientOptions);
  // Each test owns its account: a temporary role change cannot affect a parallel journey.
  const { tenantId, userId } = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix,
    { tag: "LEGACY", uiMode: "expert" });
  const membership = await admin.from("tenant_memberships").select("id,role")
    .eq("tenant_id", tenantId).eq("user_id", userId).eq("is_default", true).single();
  if (membership.error || membership.data.role !== "admin") throw new Error("Dedicated admin membership required.");
  return { admin, tenantId, userId, membershipId: String(membership.data.id) };
}

type Context = Awaited<ReturnType<typeof localContext>>;
function historicalIds() {
  return ["version", "variant", "both"].map((kind) => {
    const parts = randomUUID().split("-");
    if (kind !== "variant") parts[2] = `0${parts[2].slice(1)}`;
    if (kind !== "version") parts[3] = `0${parts[3].slice(1)}`;
    return parts.join("-");
  });
}

async function seedProjects(context: Context, army: ArmyState, ids: string[], label: string) {
  const projects = ids.map((id, index) => ({ id, name: `${army.runPrefix}-${label}-${index}`, versionId: randomUUID() }));
  const created = await context.admin.from("estimate_projects").insert(projects.map(({ id, name }) => ({
    id, name, tenant_id: context.tenantId, user_id: context.userId,
  }))).select("id");
  if (created.error) throw new Error(`Owned project seed failed: ${created.error.code}`);
  const versions = await context.admin.from("estimate_versions").insert(projects.map((project) => ({
    id: project.versionId, project_id: project.id, tenant_id: context.tenantId,
    version_number: 1, status: "draft", calc_engine_version: 2,
  })));
  if (versions.error) throw new Error(`Owned draft seed failed: ${versions.error.code}`);
  army.ownedEstimates.push(...projects.map((project) => ({ projectId: project.id, versionId: project.versionId })));
  expect(created.data?.map((row) => row.id).sort()).toEqual([...ids].sort());
  await recordEvidence(army, `legacy-${label}-prerequisites`, { projects, tenantId: context.tenantId,
    boundary: "Privileged local identifier/draft prerequisites only; all actions under test use the browser's ordinary account." });
  return projects;
}

async function storedProjects(client: SupabaseClient, ids: string[]) {
  const result = await client.from("estimate_projects").select("id,is_archived").in("id", ids).order("id");
  if (result.error) throw new Error(`Project readback failed: ${result.error.code}`);
  return result.data;
}

for (const action of ["archive", "delete"] as const) {
  armyTest(`LEGACY-ID ${action} accepts stored historical identifiers from the affaires list`, options,
    async ({ app, browser, screen, army }) => {
      const context = await localContext(browser, app, army);
      const control = await seedProjects(context, army, [randomUUID()], "regular");
      const legacy = await seedProjects(context, army, historicalIds(), "historical");
      const verb = action === "archive" ? "Archiver" : "Supprimer";
      for (const [label, projects] of [["regular", control], ["historical", legacy]] as const) {
        // Open the settled filter: a later search navigation intentionally clears selection.
        await app.open(`/dashboard/affaires?q=${encodeURIComponent(`${army.runPrefix}-${label}`)}`);
        for (const project of projects) {
          await screen.getByRole("checkbox", `Sélectionner l'affaire ${project.name}`, { exact: true }).check();
        }
        await screen.getByRole("toolbar", "Actions groupées sur les brouillons", { exact: true })
          .getByRole("button", verb, { exact: true }).tap();
        const confirmation = `${verb} ${projects.length} affaire${projects.length > 1 ? "s" : ""}`;
        const dialog = screen.getByRole("alertdialog", confirmation, { exact: true });
        await expect(dialog).toBeVisible();
        const pending = browser.waitForResponse(`**/api/affaires/bulk-${action}`);
        await dialog.getByRole("button", confirmation, { exact: true }).tap();
        const response = await pending;
        const body = await response.json();
        const ids = projects.map((project) => project.id);
        const stored = await storedProjects(context.admin, ids);
        await recordEvidence(army, `legacy-${action}-${label}`, { response: { status: response.status, body }, projects, stored });
        expect(response.status).toBe(200);
        expect(body).toEqual({ ok: true, data: { requestedCount: ids.length,
          [action === "archive" ? "archivedIds" : "deletedIds"]: ids, failures: [] } });
        expect(stored).toEqual(action === "archive" ? [...ids].sort().map((id) => ({ id, is_archived: true })) : []);
        await expect(dialog).toBeHidden();
        await browser.reload();
        for (const project of projects) {
          await expect(screen.getByRole("checkbox", `Sélectionner l'affaire ${project.name}`, { exact: true })).toHaveCount(0);
        }
        if (action === "delete") {
          const versions = await context.admin.from("estimate_versions").select("id").in("id", projects.map((project) => project.versionId));
          expect(versions.error).toBeNull();
          expect(versions.data).toEqual([]);
        }
      }
    });
}

armyTest("LEGACY-ID malformed IDs, foreign tenants and read-only roles cannot mutate affaires", options,
  async ({ app, browser, army }) => {
    const context = await localContext(browser, app, army);
    const [project] = await seedProjects(context, army, [historicalIds()[0]], "guards");
    const foreignTenantId = randomUUID(), foreignProjectId = historicalIds()[1];
    const foreignTenant = await context.admin.from("tenants").insert({ id: foreignTenantId, name: `${army.runPrefix}-foreign`, slug: `army-${randomUUID()}` });
    if (foreignTenant.error) throw new Error(`Foreign local tenant seed failed: ${foreignTenant.error.code}`);
    const foreign = await context.admin.from("estimate_projects").insert({ id: foreignProjectId,
      tenant_id: foreignTenantId, user_id: context.userId, name: `${army.runPrefix}-foreign` });
    if (foreign.error) throw new Error(`Foreign local project seed failed: ${foreign.error.code}`);
    await app.open("/dashboard/affaires");
    const observed: unknown[] = [];
    for (const action of ["archive", "delete"] as const) {
      const route = `/api/affaires/bulk-${action}`;
      for (const invalid of ["not-an-id", `${project.id} `, project.id.replace(/-/g, ""), 42, null]) {
        const result = await apiRequest<{ ok: boolean; error?: { code: string } }>(browser, "POST", route, { projectIds: [project.id, invalid] });
        observed.push({ action, invalid, result });
        expect(result.status).toBe(400);
        expect(result.body.error?.code).toBe("VALIDATION_ERROR");
      }
      const denied = await apiRequest(browser, "POST", route, { projectIds: [foreignProjectId] });
      observed.push({ action, foreign: denied });
      expect(denied).toMatchObject({ status: 200, body: { ok: true, data: { requestedCount: 1,
        [action === "archive" ? "archivedIds" : "deletedIds"]: [], failures: [{ projectId: foreignProjectId, reason: "not_found" }] } } });
    }
    const changed = await context.admin.from("tenant_memberships").update({ role: "viewer" }).eq("id", context.membershipId).select("role").single();
    expect(changed.error).toBeNull();
    expect(changed.data?.role).toBe("viewer");
    try {
      for (const action of ["archive", "delete"]) {
        const denied = await apiRequest(browser, "POST", `/api/affaires/bulk-${action}`, { projectIds: [project.id] });
        observed.push({ action, viewer: denied });
        expect(denied).toMatchObject({ status: 403, body: { ok: false, error: { code: "ESTIMATE_WRITE_ROLE_REQUIRED" } } });
      }
    } finally {
      const restored = await context.admin.from("tenant_memberships").update({ role: "admin" }).eq("id", context.membershipId);
      if (restored.error) throw new Error("Owned fixture membership restoration failed.");
    }
    const ids = [project.id, foreignProjectId];
    const unchanged = await storedProjects(context.admin, ids);
    expect(unchanged).toEqual([...ids].sort().map((id) => ({ id, is_archived: false })));
    await recordEvidence(army, "legacy-access-guards", { observed, unchanged });
  });
