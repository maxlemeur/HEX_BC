import { expect } from "e2e";
import { createChunks } from "@supabase/ssr";

import {
  apiRequest, armyTest, createEstimateViaWizard, createLineViaApi, readEstimate, recordEvidence,
} from "../critical/fixtures";
import { signUpDedicatedOwner } from "./dedicated-owner";
import { querySql } from "./calculation-gate-support";

armyTest("AUTHSEC01 login session renews without public caching and keeps its authenticated tenant", {
  session: "army", tags: ["critical", "local", "auth-security"], timeout: 120_000,
}, async ({ app, browser, army }) => {
  await app.open("/dashboard/memberships");
  const before = await apiRequest<{ data: { current_user_id: string; tenant: { id: string } } }>(browser, "GET", "/api/memberships");
  expect(before.status).toBe(200);
  const cookies = (await browser.cookies()).filter((cookie) => /^sb-.*-auth-token(?:\.\d+)?$/.test(cookie.name));
  expect(cookies.length).toBeGreaterThan(0);
  expect(cookies.every((cookie) => cookie.secure)).toBe(true);
  const key = cookies[0].name.replace(/\.\d+$/, "");
  const encoded = cookies.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((cookie) => cookie.value).join("");
  expect(encoded.startsWith("base64-")).toBe(true);
  const stored = JSON.parse(Buffer.from(encoded.slice(7), "base64url").toString("utf8"));
  // Only the local cookie's scheduling metadata changes. Auth verifies the real
  // refresh token; no forged identity or SDK response is injected into the app.
  stored.expires_at = Math.floor(Date.now() / 1000) - 300;
  const chunks = createChunks(key, `base64-${Buffer.from(JSON.stringify(stored)).toString("base64url")}`);
  const names = new Set(chunks.map((chunk) => chunk.name));
  await browser.setCookies([
    ...cookies.filter((cookie) => !names.has(cookie.name)).map((cookie) => ({ ...cookie, value: "", expires: 1 })),
    ...chunks.map((chunk) => ({ ...chunk, url: app.baseUrl!, secure: true, sameSite: "Lax" as const })),
  ]);
  const renewed = await browser.evaluate(async () => {
    const response = await fetch("/api/docs/swagger-ui/swagger-ui.css", { credentials: "same-origin", cache: "no-store" });
    return { status: response.status, cacheControl: response.headers.get("cache-control") };
  });
  expect(renewed.status).toBe(200);
  expect(renewed.cacheControl).toContain("no-store");
  expect(renewed.cacheControl).not.toMatch(/\bpublic\b/);
  const afterCookies = (await browser.cookies()).filter((cookie) => cookie.name === key || cookie.name.startsWith(`${key}.`));
  const afterEncoded = afterCookies.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map((cookie) => cookie.value).join("");
  const afterSession = JSON.parse(Buffer.from(afterEncoded.slice(7), "base64url").toString("utf8"));
  expect(afterSession.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  expect(afterCookies.every((cookie) => cookie.secure)).toBe(true);
  const after = await apiRequest<{ data: { current_user_id: string; tenant: { id: string } } }>(browser, "GET", "/api/memberships");
  expect(after.status).toBe(200);
  expect(after.body.data.current_user_id).toBe(before.body.data.current_user_id);
  expect(after.body.data.tenant.id).toBe(before.body.data.tenant.id);
  await recordEvidence(army, "auth-session-renewal", { identity: after.body.data.current_user_id, tenantId: after.body.data.tenant.id, refreshed: true, secure: true, ...renewed });
});

armyTest("AUTHSEC02 tenant admin uses exact Auth email without discovering foreign profiles or changing their default tenant", {
  session: "army", tags: ["critical", "local", "auth-security"], timeout: 180_000,
}, async ({ app, screen, browser, army }) => {
  await app.open("/dashboard/memberships");
  const ownerA = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "AUTHA" });
  const ownerACookies = await browser.cookies();
  const ownerB = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "AUTHB" });
  await app.open("/dashboard/memberships");
  const anonymous = await browser.evaluate(async () => {
    const response = await fetch("/api/memberships?search=example.test", { credentials: "omit" });
    return { status: response.status, body: await response.json() };
  });
  expect(anonymous.status).toBe(401);
  expect(anonymous.body.ok).toBe(false);
  type Listing = { data: { tenant: { id: string }; candidates: Array<{ id: string; email: string }>; memberships: Array<{ user_id: string }> } };
  for (const search of ["example.test", ownerA.email.split("@")[0], "%", "**"]) {
    const result = await apiRequest<Listing>(browser, "GET", `/api/memberships?search=${encodeURIComponent(search)}`);
    expect(result.status).toBe(200);
    expect(result.body.data.tenant.id).toBe(ownerB.tenantId);
    expect(result.body.data.candidates).toEqual([]);
    expect(result.body.data.memberships.map((member) => member.user_id)).toEqual([ownerB.userId]);
  }
  const exact = await apiRequest<Listing>(browser, "GET", `/api/memberships?search=${encodeURIComponent(ownerA.email.toUpperCase())}`);
  expect(exact.status).toBe(200);
  expect(exact.body.data.candidates).toEqual([{ id: ownerA.userId, email: ownerA.email }]);
  await screen.getByLabel("Email de connexion", { exact: true }).fill(ownerA.email);
  const picker = screen.getByRole("combobox", "Utilisateur", { exact: true });
  await picker.click();
  await screen.getByRole("option", ownerA.email, { exact: true }).click();
  await screen.getByRole("button", "Ajouter le membre", { exact: true }).click();
  await expect(screen.getByText("Membre ajouté.", { exact: true })).toBeVisible();
  const added = await apiRequest<Listing>(browser, "GET", "/api/memberships");
  expect(added.body.data.memberships.map((member) => member.user_id).sort()).toEqual([ownerA.userId, ownerB.userId].sort());
  await browser.setCookies(ownerACookies);
  await app.open("/dashboard/memberships");
  const restored = await apiRequest<Listing>(browser, "GET", "/api/memberships");
  expect(restored.body.data.tenant.id).toBe(ownerA.tenantId);
  expect(restored.body.data.memberships.map((member) => member.user_id)).toEqual([ownerA.userId]);
  // This fixture is owned by the disposable stack and this journey only.
  await querySql(`update public.tenant_memberships set role='viewer' where user_id='${ownerA.userId}' and tenant_id='${ownerA.tenantId}';`);
  const viewer = await apiRequest<{ ok: boolean }>(browser, "GET", `/api/memberships?search=${encodeURIComponent(ownerB.email)}`);
  expect(viewer.status).toBe(403);
  expect(viewer.body.ok).toBe(false);
  await recordEvidence(army, "auth-membership-isolation", { ownerA, ownerB, partialSearchesEmpty: true, exactCandidateKeys: Object.keys(exact.body.data.candidates[0]), addedWithoutDefaultSwitch: true, anonymousStatus: anonymous.status, viewerStatus: viewer.status });
});

// TI-141 checked the actual list with a second authenticated user. Native RLS
// and API-only coverage cannot establish that the list renders the right tenant.
// Each user here owns a disposable tenant on the runner's loopback backend.
armyTest("LEGACCESS01 a second tenant sees its own estimate and cannot list or open the first owner's version", {
  session: "army", tags: ["critical", "local", "legacy-access"], timeout: 180_000,
}, async ({ app, screen, browser, army }) => {
  const ui = { app, screen, browser };
  const listedProject = (id: string, name: string) => browser.locator(`a[href="/dashboard/affaires/${id}"]`).filter({ hasText: name });
  await app.open("/dashboard/affaires");
  const ownerA = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "LEGA", uiMode: "expert" });
  const projectA = `${army.projectName} propriétaire A`;
  const first = await createEstimateViaWizard(ui, { projectName: projectA, title: `${army.runPrefix} privé A` }, army);
  const line = await createLineViaApi(browser, first.versionId, `${army.runPrefix} ligne privée A`);
  const firstSnapshot = await readEstimate(browser, first.versionId);
  const firstCookies = await browser.cookies();
  // The former estimates list intentionally redirects to the current affaires
  // portfolio. Its old Voir/Dupliquer/Imprimer menu is no longer mounted.
  await app.open("/dashboard/estimates");
  await expect(browser).toHaveURL("/dashboard/affaires");
  await expect(screen.getByRole("heading", "Affaires", { exact: true })).toBeVisible();
  await expect(listedProject(first.projectId, projectA)).toBeVisible();

  const ownerB = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "LEGB", uiMode: "expert" });
  expect(ownerB.tenantId).not.toBe(ownerA.tenantId);
  expect(ownerB.userId).not.toBe(ownerA.userId);
  const projectB = `${army.projectName} propriétaire B`;
  const second = await createEstimateViaWizard(ui, { projectName: projectB, title: `${army.runPrefix} privé B` }, army);
  const projectBExtra = `${army.projectName} deuxième affaire B`;
  const third = await createEstimateViaWizard(ui, { projectName: projectBExtra, title: `${army.runPrefix} privé B bis` }, army);
  await app.open("/dashboard/estimates");
  await expect(browser).toHaveURL("/dashboard/affaires");
  await expect(screen.getByRole("heading", "Affaires", { exact: true })).toBeVisible();
  for (const [ids, name] of [[second, projectB], [third, projectBExtra]] as const) {
    await expect(listedProject(ids.projectId, name)).toBeVisible();
    const edit = screen.getByRole("link", `Éditer le chiffrage de l’affaire ${name}`, { exact: true });
    await expect(edit).toHaveAttribute("href", `/dashboard/estimates/${ids.versionId}/edit`);
    await screen.getByRole("button", `Plus d’actions pour l’affaire ${name}`, { exact: true }).click();
    const open = screen.getByRole("menuitem", "Ouvrir l’affaire", { exact: true });
    await expect(open).toHaveAttribute("href", `/dashboard/affaires/${ids.projectId}`);
    await open.press("Escape");
    await expect(open).toBeHidden();
  }
  await expect(screen.getByText(projectA, { exact: true, visible: true })).toHaveCount(0);
  const listed = await apiRequest<{ ok: boolean; data: { items: Array<{ version_id: string; project_id: string }> } }>(browser, "GET", "/api/estimates");
  expect(listed.status).toBe(200);
  expect(listed.body.ok).toBe(true);
  expect(listed.body.data.items.map((item) => item.version_id).sort()).toEqual([second.versionId, third.versionId].sort());
  expect(listed.body.data.items.map((item) => item.project_id).sort()).toEqual([second.projectId, third.projectId].sort());
  const denied = await apiRequest<{ ok: boolean; error: { code: string }; data?: unknown }>(browser, "GET", `/api/estimates/${first.versionId}`);
  expect(denied.status).toBe(404);
  expect(denied.body.ok).toBe(false);
  expect(denied.body.data).toBeUndefined();
  await app.open(`/dashboard/estimates/${first.versionId}`);
  await expect(screen.getByRole("heading", "Page introuvable", { exact: true })).toBeVisible();
  await expect(screen.getByText(projectA, { exact: true, visible: true })).toHaveCount(0);
  await expect(screen.getByText(line.title, { exact: true, visible: true })).toHaveCount(0);

  await browser.setCookies(firstCookies);
  await app.open("/dashboard/estimates");
  await expect(listedProject(first.projectId, projectA)).toBeVisible();
  await expect(screen.getByText(projectB, { exact: true, visible: true })).toHaveCount(0);
  const restored = await readEstimate(browser, first.versionId);
  expect(restored.items).toEqual(firstSnapshot.items);
  await recordEvidence(army, "legacy-cross-tenant-list", {
    owners: [{ tenantId: ownerA.tenantId, userId: ownerA.userId }, { tenantId: ownerB.tenantId, userId: ownerB.userId }],
    first, second, third, privateLineId: line.id,
    secondTenantListedVersionIds: listed.body.data.items.map((item) => item.version_id),
    foreignRead: { status: denied.status, code: denied.body.error.code },
    foreignPage: "Page introuvable", ownerRestored: true, unchangedItemIds: restored.items.map((item) => item.id),
  });
});
