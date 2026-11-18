import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, type JsonValue } from "e2e";
import type { Browser } from "@e2e-dev/web";

import { recordEvidence, type ArmyState, type createEstimateViaWizard, type OwnedEstimate } from "../critical/fixtures";

export type TakeoffSeedItem = {
  designation: string;
  quantity: number;
  unit: string;
  confidence: number;
  is_excluded?: boolean;
  is_verified?: boolean;
  /** Page 1 when absent; null for a line that reads no page. */
  source_page?: number | null;
  /** What the worker wrote beside the measure, such as quantity_nature « estimated » (TI-682); empty by default. */
  metadata?: Record<string, JsonValue>;
};

// Fixture preparation stays outside the browser and uses the account's RLS.
// No session token or response containing one enters Army evidence.
export async function localTakeoffFixture(army: ArmyState, ids: OwnedEstimate, email = process.env.E2E_LOGIN_EMAIL!,
  password = process.env.E2E_LOGIN_PASSWORD!) {
  const backend = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  if (backend.protocol !== "http:" || backend.username || backend.password || backend.pathname !== "/" || backend.search || backend.hash ||
      !["localhost", "127.0.0.1", "[::1]"].includes(backend.hostname) ||
      backend.hostname !== process.env.E2E_ALLOWED_SUPABASE_HOST ||
      !army.ownedEstimates.some(item => item.versionId === ids.versionId && item.projectId === ids.projectId)) {
    throw new Error("Takeoff seeds require an owned ARMY estimate on allowlisted local Supabase.");
  }
  const client = createClient(backend.href, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw new Error("Local ARMY fixture login failed.");
  const version = await client.from("estimate_versions").select("tenant_id, project_id").eq("id", ids.versionId).single();
  if (version.error || version.data.project_id !== ids.projectId) throw new Error("Owned fixture version unavailable.");
  const project = await client.from("estimate_projects").select("name").eq("id", ids.projectId).single();
  if (project.error || !project.data.name.startsWith(army.runPrefix)) throw new Error("Fixture project ownership differs.");
  const tenantId = String(version.data.tenant_id);
  const tenant = await client.from("tenants").select("name").eq("id", tenantId).single();
  if (tenant.error || !/^ARMY\b/.test(tenant.data.name)) throw new Error("A dedicated ARMY tenant is required.");
  return {
    client,
    tenantId,
    async seed(level: "A" | "B" | "C", items: TakeoffSeedItem[], source = "ARMY-revision.pdf") {
      const { client: worker } = await localTakeoffWorkerClient(army, ids.versionId, email, password);
      const jobId = randomUUID();
      const resultId = randomUUID();
      const itemIds = items.map(() => randomUUID());
      const now = new Date().toISOString();
      await recordEvidence(army, `takeoff-prerequisite-${jobId}`, { ids, tenantId, jobId, resultId, itemIds, level, source });
      const job = await worker.from("takeoff_jobs").insert({ id: jobId, tenant_id: tenantId, estimate_version_id: ids.versionId,
        level, status: "completed", source_file_name: source, source_file_type: level === "A" ? "text/csv" : "application/pdf",
        source_file_size_bytes: 512, schema_version: "v1", started_at: now, completed_at: now });
      if (job.error) throw new Error(`Owned takeoff job seed failed: ${job.error.code}`);
      const result = await worker.from("takeoff_results").insert({ id: resultId, tenant_id: tenantId, job_id: jobId, extracted_json: {}, warnings: [], tables: [] });
      if (result.error) throw new Error(`Owned takeoff result seed failed: ${result.error.code}`);
      const rows = items.map((item, index) => ({ id: itemIds[index], tenant_id: tenantId, job_id: jobId, result_id: resultId,
        ...item, evidence: `ARMY localized fixture: ${item.designation}`, source_file_name: source, source_page: item.source_page === undefined ? 1 : item.source_page, metadata: item.metadata ?? {},
        is_excluded: item.is_excluded ?? false, exclusion_reason: item.is_excluded ? "ARMY excluded fixture" : null,
        is_verified: item.is_verified ?? false, verified_at: item.is_verified ? now : null, verified_by: item.is_verified ? login.data.user!.id : null }));
      const inserted = await worker.from("takeoff_items").insert(rows);
      if (inserted.error) throw new Error(`Owned takeoff item seed failed: ${inserted.error.code}`);
      expect(rows).toHaveLength(items.length);
      return { jobId, resultId, items: rows };
    },
  };
}

// Completed/failed worker states cannot be forged by an authenticated operator.
// Prepare those prerequisites only on the explicitly allowlisted local backend,
// after proving ownership with the ordinary account. Never pass this client to
// browser.evaluate or evidence; all actions under test keep the user's session.
export async function localTakeoffWorkerClient(army: ArmyState, versionId: string, email = process.env.E2E_LOGIN_EMAIL!,
  password = process.env.E2E_LOGIN_PASSWORD!) {
  const ids = army.ownedEstimates.find(item => item.versionId === versionId);
  if (!ids) throw new Error("Worker prerequisites require a newly owned ARMY version.");
  const fixture = await localTakeoffFixture(army, ids, email, password);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("Local worker prerequisite key is missing.");
  await recordEvidence(army, `local-worker-prerequisite-${versionId}`, {
    ...ids, tenantId: fixture.tenantId, backend: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin,
    boundary: "Local worker-state prerequisite only; UI and API assertions use the ordinary authenticated account.",
  });
  return { tenantId: fixture.tenantId, client: createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }) };
}

export async function seedOwnedSupplyType(army: ArmyState, versionId: string) {
  const ids = army.ownedEstimates.find(item => item.versionId === versionId);
  if (!ids) throw new Error("Supply-type prerequisites require an owned ARMY version.");
  const fixture = await localTakeoffFixture(army, ids);
  const { data, error } = await fixture.client.from("supply_types").insert({
    tenant_id: fixture.tenantId, code: `${army.runPrefix}-SUPPLY`, name: `${army.runPrefix} supplies`,
  }).select("id").single();
  if (error || !data?.id) throw new Error(`Cannot prepare owned supply type: ${error?.code ?? "missing row"}`);
  await recordEvidence(army, "supply-type-prerequisite", { ids, supplyTypeId: data.id, tenantId: fixture.tenantId });
  return data.id as string;
}

export async function applyOwnedTakeoff(browser: Browser, versionId: string, jobId: string, body: unknown, foreignSession = false) {
  return browser.evaluate(async input => {
    const scope = globalThis as typeof globalThis & { __miaouffrageEstimateDraftLockSessions?: Map<string, string> };
    const sessionId = scope.__miaouffrageEstimateDraftLockSessions?.get(input.versionId) ??
      sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${input.versionId}`);
    if (!sessionId) throw new Error("The owned page lease is missing.");
    const response = await fetch(`/api/takeoff/jobs/${input.jobId}/apply`, {
      method: "POST", credentials: "same-origin", body: input.body,
      headers: { "content-type": "application/json", "x-estimate-draft-lock-session-id": input.foreignSession ? crypto.randomUUID() : sessionId },
    });
    return { status: response.status, body: await response.json() as JsonValue };
  }, { versionId, jobId, body: JSON.stringify(body), foreignSession });
}

type SendUi = Parameters<typeof createEstimateViaWizard>[0];

/** The one screen that sends a reviewed takeoff to the estimate (2026-11-18), and the button that opens it. */
export const TAKEOFF_SEND = "Envoyer au tableau de chiffrage";
export const TAKEOFF_SEND_CONFIRM = "Confirmer l'envoi";
export const TAKEOFF_SENT_TOAST = "Métré envoyé au tableau de chiffrage";

/**
 * Opens « Envoyer au tableau de chiffrage » from a review or the job page, chooses the section (or checks it is the one
 * preselected, the first), and waits for the impact preview of that section: computed without a click, its lines listed
 * (read-only), `designation` among them. No step, no strategy to pick: the version decides (merge with DPGF lines,
 * append otherwise).
 */
export async function openTakeoffSend(ui: SendUi, sectionId: string, designation: string, options: { preselected?: boolean } = {}) {
  await ui.screen.getByRole("button", TAKEOFF_SEND, { exact: true }).click();
  const dialog = ui.screen.getByRole("dialog", TAKEOFF_SEND, { exact: true });
  const section = dialog.getByLabel("Section cible", { exact: true });
  if (options.preselected) await expect(section).toHaveValue(sectionId);
  else await section.selectOption({ value: sectionId });
  await expect(dialog.getByRole("list", "Lignes envoyées", { exact: true })).toContainText(designation, { timeout: 30_000 });
  // The strategies the four-step wizard offered are gone (« Pages déjà au devis » keeps its own radios).
  await expect(dialog.getByRole("button", "Suivant", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("radio", /^(Ajouter sans effacer|Remplacer uniquement la section choisie|Fusionner avec l'existant)/)).toHaveCount(0);
  return dialog;
}

type SentSummary = { created_count: number; updated_count: number; ignored_count: number; created_ids: string[];
  item_links: Array<{ estimate_item_id: string }> };

const counted = (count: number, singular: string, plural: string) => `${count} ${count > 1 ? plural : singular}`;

/**
 * After « Confirmer l'envoi » from a review: the French toast with the counts the application returned, then the
 * version's editor placed on the takeoff's line, the first it created, else the first it fed or updated (`focusItemId`),
 * highlighted and in view. With `offscreen`, the line also lay below the fold of its scroll container before the editor
 * scrolled to it (the journey put enough lines before it). Returns its id.
 */
export async function expectLandedOnTakeoffLine(ui: SendUi, versionId: string, summary: SentSummary,
  options: { offscreen?: boolean } = {}) {
  const counts = `${counted(summary.created_count, "ligne créée", "lignes créées")}, `
    + `${counted(summary.updated_count, "mise à jour", "mises à jour")}, ${counted(summary.ignored_count, "ignorée", "ignorées")}.`;
  await expect(ui.browser.locator('[data-slot="toast"]').filter({ hasText: TAKEOFF_SENT_TOAST }).filter({ hasText: counts })).toBeVisible();
  const lineId = summary.created_ids[0] ?? summary.item_links[0]?.estimate_item_id;
  expect(lineId, "the application names a line of the estimate").toBeTruthy();
  await expect(ui.browser).toHaveURL(new RegExp(`/dashboard/estimates/${versionId}/edit\\?focusItemId=${lineId}$`), { timeout: 60_000 });
  const row = ui.browser.locator(`[data-estimate-item-id="${lineId}"]`);
  await expect(row).toBeVisible({ timeout: 60_000 });
  // The editor highlights the line for a few seconds once it has scrolled to it (useEstimateEditorState, focusItemId).
  await expect(row).toHaveAttribute("data-highlighted", "true");
  await expect.poll(() => ui.browser.evaluate((id) => {
    const element = document.querySelector(`[data-estimate-item-id="${id}"]`);
    const box = element?.getBoundingClientRect();
    if (!element || !box) return { inView: false, belowFoldBefore: false };
    // How far the line's scroll containers moved: where the line stood before, in the viewport, is that much lower.
    let scrolled = 0;
    for (let node = element.parentElement; node; node = node.parentElement) scrolled += node.scrollTop;
    return { inView: box.height > 0 && box.bottom > 0 && box.top < window.innerHeight, belowFoldBefore: box.top + scrolled >= window.innerHeight };
  }, lineId!), { timeout: 30_000 }).toEqual(expect.objectContaining({ inView: true, ...(options.offscreen ? { belowFoldBefore: true } : {}) }));
  return lineId!;
}
