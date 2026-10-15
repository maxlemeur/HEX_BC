import { expect } from "e2e";

import { apiRequest, ownEstimate, readEstimate, recordEvidence, type ArmyItem, type ArmyState, type ArmyEstimate } from "../critical/fixtures";
import type { NativeUi } from "../takeoff/native-ui";

export type ConnectedUi = Pick<NativeUi, "app" | "screen" | "browser" | "army">;
export type Envelope<T> = { ok: boolean; data: T; error?: { code: string } };

export function requireConnectedLocal() {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (backend.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname) ||
      backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST) {
    throw new Error("Connected catalogue and tenant-tier writes require the allowlisted local runtime.");
  }
}

export async function connectedApi<T>(ui: ConnectedUi, method: "GET" | "POST" | "PATCH", pathname: string, body?: unknown, headers?: Record<string, string>) {
  requireConnectedLocal();
  const response = await apiRequest<Envelope<T>>(ui.browser, method, pathname, body, headers);
  expect([200, 201, 202]).toContain(response.status);
  expect(response.body.ok).toBe(true);
  return response.body.data;
}

export async function retainFixture(army: ArmyState, kind: string, id: string, name: string) {
  expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(name.startsWith(army.runPrefix)).toBe(true);
  await recordEvidence(army, `${kind}-${id}`, { kind, id, name, retained: true });
}

export async function connectedEstimate(ui: ConnectedUi, label: string, settings: Record<string, unknown> = {}) {
  await ui.app.open("/dashboard/affaires");
  const name = `${ui.army.runPrefix} ${label}`;
  const created = await connectedApi<ArmyEstimate>(ui, "POST", "/api/estimates", {
    creation_mode: "blank", project: { name }, version: {
      title: name, margin_mode: "fixed", margin_multiplier: 1.5, global_coefficient: 1,
      discount_bp: 0, tax_rate_bp: 0, currency: "EUR", rounding_mode: "none", ...settings,
    },
  });
  ownEstimate(ui.army, { projectId: created.project.id, versionId: created.version.id });
  await recordEvidence(ui.army, "connected-created", { projectId: created.project.id, versionId: created.version.id, settings });
  return created;
}

type LeaseObservation = { versionId: string; status: number; ok: boolean; ownedBySession: boolean; expired: boolean | null; errorCode: string | null };
const observedBrowsers = new WeakSet<ConnectedUi["browser"]>();

export async function connectedOpen(ui: ConnectedUi, versionId: string, reload = false) {
  if (!observedBrowsers.has(ui.browser)) {
    // The SDK waits by URL only. Observe the editor's POST, never its unload
    // DELETE or heartbeat PATCH, without reading credentials or acquiring a lock.
    await ui.browser.addInitScript(() => {
      const scope = window as typeof window & { __armyLeaseResponses: LeaseObservation[] };
      scope.__armyLeaseResponses = [];
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        const version = url.origin === location.origin && method === "POST"
          ? url.pathname.match(/^\/api\/estimates\/([0-9a-f-]{36})\/lock$/i)?.[1]
          : undefined;
        const response = await originalFetch(input, init);
        if (version) {
          const observation: LeaseObservation = { versionId: version, status: response.status, ok: false, ownedBySession: false, expired: null, errorCode: null };
          try {
            const body = await response.clone().json();
            observation.ok = body.ok === true;
            observation.ownedBySession = body.data?.lock?.is_current_session === true;
            observation.expired = typeof body.data?.lock?.is_expired === "boolean" ? body.data.lock.is_expired : null;
            observation.errorCode = typeof body.error?.code === "string" ? body.error.code : null;
          } catch {
            observation.errorCode = "INVALID_JSON";
          }
          scope.__armyLeaseResponses.push(observation);
        }
        return response;
      };
    });
    observedBrowsers.add(ui.browser);
  }
  if (reload) await ui.browser.reload();
  else await ui.app.open(`/dashboard/estimates/${versionId}/edit`);
  const observations = () => ui.browser.evaluate(id =>
    ((window as typeof window & { __armyLeaseResponses?: LeaseObservation[] }).__armyLeaseResponses ?? []).filter(item => item.versionId === id), versionId);
  await expect.poll(observations).not.toEqual([]);
  const leases = await observations();
  await recordEvidence(ui.army, `editor-lease-${versionId}-${Date.now()}`, { method: "POST", observations: leases });
  expect(leases[0]).toMatchObject({ status: 201, ok: true, ownedBySession: true, expired: false, errorCode: null });
  await expect(ui.screen.getByTestId("estimate-editor-table")).toBeVisible();
}

export async function connectedSession(ui: ConnectedUi, versionId: string) {
  const session = await ui.browser.evaluate(id => sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${id}`), versionId);
  expect(session, "Use the ordinary editor lease").toMatch(/^[0-9a-f-]{36}$/i);
  return { "x-estimate-draft-lock-session-id": session! };
}

export async function connectedLine(ui: ConnectedUi, versionId: string, values: Record<string, unknown> = {}) {
  const headers = await connectedSession(ui, versionId);
  const initial = await readEstimate(ui.browser, versionId);
  let section = initial.items.find(item => item.item_type === "section");
  if (!section) section = (await connectedApi<{ item: ArmyItem }>(ui, "POST", `/api/estimates/${versionId}/items`, {
    item_type: "section", title: `${ui.army.runPrefix} Section fournitures`,
  }, headers)).item;
  const title = `${ui.army.runPrefix} ${String(values.label ?? "Ligne fournitures")}`;
  const { label: _label, ...financials } = values;
  void _label;
  const quantity = Number(values.quantity ?? 3);
  const line = (await connectedApi<{ item: ArmyItem }>(ui, "POST", `/api/estimates/${versionId}/items`, {
    item_type: "line", parent_id: section.id, title, description: "u", unit_price_ht_cents: 1000, tax_rate_bp: 0,
    k_fo: 1, h_mo: 0, k_mo: 1, line_nature: "supply_only", ...financials, quantity: quantity + 1,
  }, headers)).item;
  await retainFixture(ui.army, "estimate-line", line.id, title);
  await connectedOpen(ui, versionId, true);
  const cell = ui.browser.locator(`[data-cell-id="${line.id}::quantity"]`);
  const input = ui.screen.getByLabel(`Quantité pour ${title}`, { exact: true });
  // Preserve the legacy first ordinary click and focused-input oracle.
  await cell.click();
  await expect(input).toBeFocused();
  await expect.poll(() => ui.browser.evaluate(id => {
    const element = document.querySelector(`[data-cell-id="${id}::quantity"] input`);
    return element ? getComputedStyle(element).opacity : null;
  }, line.id)).toBe("1");
  await input.fill(String(quantity));
  await input.press("Tab");
  await ui.browser.keyboard.press("Control+s");
  await expect.poll(async () => (await readEstimate(ui.browser, versionId)).items.find(item => item.id === line.id)?.quantity,
    { timeout: 45_000 }).toBe(quantity);
  return line;
}

export async function connectedSettings(ui: ConnectedUi) {
  await ui.screen.getByRole("button", "Ouvrir les paramètres", { exact: true }).click();
  const drawer = ui.screen.getByRole("dialog", "Paramétrage du devis", { exact: true });
  await expect(drawer).toBeVisible();
  return drawer;
}
