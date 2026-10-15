import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Browser } from "@e2e-dev/web";
import { createClient } from "@supabase/supabase-js";
import { describe, expect, type JsonValue } from "e2e";

import { apiRequest, armyTest, createEstimateViaWizard as createWizard, ownEstimate, recordEvidence, type ArmyState } from "../critical/fixtures";

type RequestOptions = { data?: unknown; headers?: Record<string, string>; failOnStatusCode?: boolean;
  multipart?: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> };

function businessEvidence(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(businessEvidence);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) =>
    [key, key === "download_url" ? "<signed-download-omitted>" : businessEvidence(entry)]));
  return value;
}

export async function localClient() {
  const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (origin.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
      origin.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST) throw new Error("Native Army seeds require the allowlisted local backend.");
  const client = createClient(origin.href, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const login = await client.auth.signInWithPassword({ email: process.env.E2E_LOGIN_EMAIL!, password: process.env.E2E_LOGIN_PASSWORD! });
  if (login.error) throw new Error("Local Army seed login failed.");
  return { client, userId: login.data.user!.id };
}

// Shared naming and request plumbing for the existing specialist journeys.
// Every browser action below is the public Army SDK, so it stays in report.json.
export const nativeTest = armyTest.extend<{ ui: NativeUi }>({
  ui: async ({ app, screen, browser, army }, provideUi) => {
    const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname)) throw new Error("Specialist journeys require local Supabase.");
    const request = async (method: string, pathname: string, options: RequestOptions = {}) => {
      if (!pathname.startsWith("/api/")) throw new Error("Army business requests must stay on the application API.");
      let result: { status: number; body: JsonValue };
      if (options.multipart) {
        const parts = Object.entries(options.multipart).map(([key, value]) => typeof value === "string" ?
          { key, value, name: "", mimeType: "", base64: "", file: false } :
          { key, name: value.name, mimeType: value.mimeType, base64: value.buffer.toString("base64"), value: "", file: true });
        result = await browser.evaluate(async input => {
          const form = new FormData();
          for (const part of input.parts) {
            if (!part.file) form.append(part.key, part.value);
            else form.append(part.key, new Blob([Uint8Array.from(atob(part.base64), char => char.charCodeAt(0))], { type: part.mimeType }), part.name);
          }
          const response = await fetch(input.pathname, { method: input.method, headers: input.headers, body: form, credentials: "same-origin" });
          return { status: response.status, body: await response.json() as JsonValue };
        }, { method, pathname, headers: options.headers ?? {}, parts });
      } else {
        result = await apiRequest<JsonValue>(browser, method as "GET" | "POST" | "PATCH" | "DELETE", pathname, options.data, options.headers);
      }
      if (method === "POST" && pathname === "/api/estimates" && result.status === 201) {
        const data = result.body as { data: { project: { id: string }; version: { id: string } } };
        ownEstimate(army, { projectId: data.data.project.id, versionId: data.data.version.id });
      }
      await recordEvidence(army, `api-${randomUUID()}`, { method, pathname, result: { status: result.status, body: businessEvidence(result.body) } });
      return { status: () => result.status, ok: () => result.status >= 200 && result.status < 300,
        json: async () => result.body, text: async () => JSON.stringify(result.body) };
    };
    const ui = {
      app, screen, browser, army,
      goto: browser.goto.bind(browser), reload: browser.reload.bind(browser), waitForURL: browser.waitForURL.bind(browser),
      locator: browser.locator.bind(browser), getByRole: screen.getByRole.bind(screen), getByText: screen.getByText.bind(screen),
      getByLabel: screen.getByLabel.bind(screen), getByTestId: screen.getByTestId.bind(screen), keyboard: browser.keyboard, mouse: browser.mouse,
      request: {
        get: (pathname: string, options?: RequestOptions) => request("GET", pathname, options),
        post: (pathname: string, options?: RequestOptions) => request("POST", pathname, options),
        patch: (pathname: string, options?: RequestOptions) => request("PATCH", pathname, options),
        delete: (pathname: string, options?: RequestOptions) => request("DELETE", pathname, options),
      },
    };
    await provideUi(ui);
  },
});

export type NativeUi = {
  app: Parameters<typeof createWizard>[0]["app"];
  screen: Parameters<typeof createWizard>[0]["screen"];
  browser: Browser;
  army: ArmyState;
  goto: Browser["goto"]; reload: Browser["reload"]; waitForURL: Browser["waitForURL"]; locator: Browser["locator"];
  getByRole: Parameters<typeof createWizard>[0]["screen"]["getByRole"];
  getByText: Parameters<typeof createWizard>[0]["screen"]["getByText"];
  getByLabel: Parameters<typeof createWizard>[0]["screen"]["getByLabel"];
  getByTestId: Parameters<typeof createWizard>[0]["screen"]["getByTestId"];
  keyboard: Browser["keyboard"]; mouse: Browser["mouse"];
  request: Record<"get" | "post" | "patch" | "delete", (pathname: string, options?: RequestOptions) => Promise<{
    status: () => number; ok: () => boolean; json: () => Promise<JsonValue>; text: () => Promise<string>;
  }>>;
};

export { describe, expect };
export const buildEstimateName = (prefix: string) => `ARMY-${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
export const createEstimateViaWizard = (ui: NativeUi, options: { projectName: string; title: string }) => createWizard(ui, options, ui.army);
export async function loginWithUi(ui: NativeUi) {
  await ui.app.open("/dashboard/affaires");
  await expect(ui.browser).toHaveURL(/\/dashboard\/affaires(?:[?#].*)?$/);
}
export async function duplicateEstimateViaApi(ui: NativeUi, versionId: string) {
  const source = ui.army.ownedEstimates.find(item => item.versionId === versionId);
  if (!source) throw new Error("Only a newly owned ARMY estimate may be duplicated.");
  const response = await apiRequest<{ data: { version_id: string } }>(ui.browser, "POST", `/api/estimates/${versionId}/duplicate`);
  expect(response.status).toBe(201);
  ownEstimate(ui.army, { projectId: source.projectId, versionId: response.body.data.version_id });
  return response.body.data.version_id;
}
export function outputPath(ui: NativeUi, name: string) {
  const directory = path.resolve("e2e/fixtures/army-generated", ui.army.runPrefix);
  mkdirSync(directory, { recursive: true });
  return path.join(directory, name);
}
export function fixtureFile(ui: NativeUi, name: string, bytes: Uint8Array) {
  const file = outputPath(ui, name);
  writeFileSync(file, bytes);
  return file;
}
export async function expectSummaryValue(ui: NativeUi, label: string, value: string) {
  await expect.poll(() => ui.browser.evaluate(text => {
    const label = Array.from(document.querySelectorAll("*"))
      .find(node => node.textContent?.trim() === text && !Array.from(node.children).some(child => child.textContent?.trim() === text));
    return label?.parentElement?.textContent ?? "";
  }, label)).toContain(value);
}
export async function ensureMapping(ui: NativeUi, sourceColumn: string, targetField: string) {
  const rows = ui.locator("table.data-table tbody tr");
  let row = rows.filter({ hasText: sourceColumn }).first();
  for (let index = 0; index < await rows.count(); index += 1) {
    const candidate = rows.nth(index);
    if ((await candidate.getByRole("cell").first().textContent())?.trim().endsWith(sourceColumn)) { row = candidate; break; }
  }
  await expect(row).toBeVisible();
  await row.getByRole("combobox").selectOption({ value: targetField });
}

export async function ensureEstimatePdfReady(ui: NativeUi, versionId: string) {
  const lock = await ui.request.post(`/api/estimates/${versionId}/lock`);
  expect(lock.status()).toBe(201);
  const trigger = await ui.request.post(`/api/estimates/${versionId}/pdf?force=true`);
  expect([200, 202]).toContain(trigger.status());
  await expect.poll(async () => {
    const response = await ui.request.get(`/api/estimates/${versionId}/pdf?format=json`);
    const payload = await response.json() as { data?: { status?: string } };
    return payload.data?.status ?? `http-${response.status()}`;
  }, { timeout: 60_000, interval: 1_000 }).toBe("ready");
}
