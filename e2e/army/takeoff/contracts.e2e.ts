import { expect, type JsonValue } from "e2e";
import type { Browser } from "@e2e-dev/web";

import { apiRequest, armyTest, createEstimateViaWizard, createLineViaApi, readEstimate, recordEvidence } from "../critical/fixtures";
import { localTakeoffFixture } from "./fixtures";
import { nativeTest } from "./native-ui";
import { launchWorkerCsv } from "./worker-support";

type Envelope<T> = { ok: boolean; data: T; error?: { code: string; details?: {
  blocked_items?: Array<{ item_id: string; designation: string }>; medium_items?: Array<{ designation: string }>; threshold?: number;
} } };
type Item = { id: string; designation: string; confidence: number; is_excluded: boolean; is_verified: boolean; updated_at: string;
  source_page: number; source_file_name: string; exclusion_reason: string | null };
const options = { session: "army", tags: ["critical", "takeoff", "local"], timeout: 180_000 };

async function applyOwnedTakeoff(browser: Browser, versionId: string, jobId: string, body: unknown, foreignSession = false) {
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
const definitions = [
  { designation: "Cloison BA13 ep.72", quantity: 42, unit: "m2", confidence: 0.23 },
  { designation: "Faux-plafond 60x60", quantity: 15, unit: "m2", confidence: 0.41 },
  { designation: "Enduit platre int.", quantity: 80, unit: "m2", confidence: 0.65 },
  { designation: "Peinture acrylique", quantity: 120, unit: "m2", confidence: 0.92 },
  { designation: "Excluded low conf", quantity: 5, unit: "u", confidence: 0.1, is_excluded: true },
];

nativeTest("TKF05 a stored historical level-A job remains present and can be canceled", options, async ({ ui }) => {
  const { ids, jobId } = await launchWorkerCsv(ui, "TKF05");
  expect(jobId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
  await expect.poll(async () => {
    const list = await apiRequest<Envelope<{ jobs: { id: string }[] }>>(ui.browser, "GET", `/api/takeoff/jobs?estimate_version_id=${ids.versionId}&limit=20&offset=0`);
    expect(list.status).toBe(200);
    return list.body.data.jobs.some(job => job.id === jobId);
  }).toBe(true);
  const canceled = await apiRequest<Envelope<{ job: { id: string; status: string } }>>(ui.browser, "POST", `/api/takeoff/jobs/${jobId}/cancel`);
  expect(canceled.status).toBe(200);
  expect(canceled.body.data.job).toMatchObject({ id: jobId, status: "canceled" });
  await recordEvidence(ui.army, "takeoff-level-a-upload", { ids, jobId, canceled: canceled.body.data.job });
});

armyTest("TKF01 low-confidence measures require explicit verification before actual apply", options, async ({ app, screen, browser, army }) => {
  const ids = await createEstimateViaWizard({ app, screen, browser }, { projectName: army.projectName, title: "ARMY confidence guard" }, army);
  const line = await createLineViaApi(browser, ids.versionId, `${army.runPrefix} target`);
  const fixture = await localTakeoffFixture(army, ids);
  const seed = await fixture.seed("C", definitions);
  const body = { strategy: "append", target_section_id: line.parent_id };
  const before = await readEstimate(browser, ids.versionId);
  const blocked = await applyOwnedTakeoff(browser, ids.versionId, seed.jobId, body) as { status: number; body: Envelope<unknown> };
  await recordEvidence(army, "takeoff-guard-blocked", { ids, seed, response: blocked });
  expect(blocked.status).toBe(422);
  expect(blocked.body.error?.code).toBe("TAKEOFF_APPLY_GUARD_FAILED");
  expect(blocked.body.error?.details?.blocked_items?.map(item => item.designation).sort()).toEqual(["Cloison BA13 ep.72", "Faux-plafond 60x60"]);
  expect(blocked.body.error?.details?.medium_items?.map(item => item.designation)).toEqual(["Enduit platre int."]);
  expect(blocked.body.error?.details?.threshold).toBeGreaterThan(0);
  expect((await readEstimate(browser, ids.versionId)).items).toEqual(before.items);
  const detail = await apiRequest<Envelope<{ items: { data: Item[] } }>>(browser, "GET", `/api/takeoff/jobs/${seed.jobId}`);
  expect(detail.status).toBe(200);
  const low = detail.body.data.items.data.filter(item => !item.is_excluded && item.confidence < 0.5);
  expect(low).toHaveLength(2);
  const patched = await apiRequest(browser, "PATCH", `/api/takeoff/jobs/${seed.jobId}/items`, {
    items: low.map(item => ({ item_id: item.id, updated_at: item.updated_at, fields: { is_verified: true } })),
  });
  expect(patched.status).toBe(200);
  const applied = await applyOwnedTakeoff(browser, ids.versionId, seed.jobId, body);
  await recordEvidence(army, "takeoff-verified-apply", { seed, response: applied });
  expect(applied.status).toBe(200);
  const after = await readEstimate(browser, ids.versionId);
  for (const item of definitions.filter(item => !item.is_excluded)) {
    expect(after.items.find(row => row.title === item.designation)?.quantity).toBe(item.quantity);
  }
  expect(after.items.some(item => item.title === "Excluded low conf")).toBe(false);
});

for (const scenario of ["level-a", "admin-override", "excluded"] as const) {
  armyTest(`TKF02 ${scenario} applies only admitted measures and retains exact quantities`, options, async ({ app, screen, browser, army }) => {
    const ids = await createEstimateViaWizard({ app, screen, browser }, { projectName: army.projectName, title: `ARMY ${scenario}` }, army);
    const target = await createLineViaApi(browser, ids.versionId, `${army.runPrefix} target`);
    const fixture = await localTakeoffFixture(army, ids);
    const items = scenario === "excluded" ? definitions.map(item => ({ ...item, is_excluded: item.confidence < 0.8 })) : definitions;
    const seed = await fixture.seed(scenario === "level-a" ? "A" : "C", items);
    const request = { strategy: "append", target_section_id: target.parent_id };
    if (scenario === "admin-override") {
      const invalid = await applyOwnedTakeoff(browser, ids.versionId, seed.jobId, { ...request, override: true });
      await recordEvidence(army, "takeoff-missing-justification", { ids, seed, response: invalid });
      expect(invalid.status).toBe(422);
      expect(invalid.body).toMatchObject({ ok: false });
    }
    const body = {
      ...request, ...(scenario === "admin-override" ? { override: true, override_justification: "ARMY explicit administrator validation for fixture" } : {}),
    };
    const before = await readEstimate(browser, ids.versionId);
    const foreign = await applyOwnedTakeoff(browser, ids.versionId, seed.jobId, body, true);
    await recordEvidence(army, "takeoff-foreign-page-refused", { ids, seed, response: foreign });
    expect(foreign.status).toBe(409);
    expect(foreign.body).toMatchObject({ ok: false });
    expect((await readEstimate(browser, ids.versionId)).items).toEqual(before.items);
    const response = await applyOwnedTakeoff(browser, ids.versionId, seed.jobId, body);
    await recordEvidence(army, `takeoff-${scenario}`, { ids, seed, response });
    expect(response.status).toBe(200);
    const after = await readEstimate(browser, ids.versionId);
    for (const item of items.filter(item => !item.is_excluded)) expect(after.items.find(row => row.title === item.designation)?.quantity).toBe(item.quantity);
    for (const item of items.filter(item => item.is_excluded)) expect(after.items.some(row => row.title === item.designation)).toBe(false);
  });
}

armyTest("TKF06 final wizard confirmation applies through the owning page session and persists exact quantities", options, async ui => {
  const { app, screen, browser, army } = ui;
  await browser.emulateMedia({ reducedMotion: "reduce" });
  const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title: "ARMY UI apply session" }, army);
  const target = await createLineViaApi(browser, ids.versionId, `${army.runPrefix} existing target`);
  expect(target.parent_id).toMatch(/^[0-9a-f-]{36}$/i);
  const fixture = await localTakeoffFixture(army, ids);
  const measures = [
    { designation: `${army.runPrefix} UI admitted A`, quantity: 12.5, unit: "m2", confidence: 0.9 },
    { designation: `${army.runPrefix} UI admitted B`, quantity: 3, unit: "u", confidence: 0.9 },
    { designation: `${army.runPrefix} UI excluded`, quantity: 7, unit: "u", confidence: 0.9, is_excluded: true },
  ];
  const seed = await fixture.seed("A", measures);
  const before = await readEstimate(browser, ids.versionId);
  await app.open(`/dashboard/estimates/${ids.versionId}/takeoff/${seed.jobId}`);
  await screen.getByRole("button", "Appliquer au devis", { exact: true }).click();
  const dialog = screen.getByRole("dialog", "Appliquer au devis", { exact: true });
  await dialog.getByLabel("Section cible", { exact: true }).selectOption({ value: target.parent_id! });
  await dialog.getByRole("button", "Suivant", { exact: true }).click();
  await dialog.getByRole("radio", /^Ajouter sans effacer/).check();
  await dialog.getByRole("button", "Suivant", { exact: true }).click();
  await expect(dialog).toContainText(measures[0].designation);
  await dialog.getByRole("button", "Suivant", { exact: true }).click();
  await expect(dialog).toContainText(/Confirmation finale/i);
  const finalApply = browser.waitForResponse(`**/api/takeoff/jobs/${seed.jobId}/apply`);
  await dialog.getByRole("button", "Confirmer l'application", { exact: true }).click();
  const response = await finalApply;
  const result = await response.json<Envelope<{ job: { id: string; status: string }; summary: { created_count: number; updated_count: number } }>>();
  await recordEvidence(army, "takeoff-ui-apply-response", { ids, seed, status: response.status, ok: result.ok,
    job: { id: result.data?.job?.id ?? null, status: result.data?.job?.status ?? null }, summary: result.data?.summary ?? null,
    errorCode: result.error?.code ?? null });
  expect(response.status).toBe(200);
  expect(result.ok).toBe(true);
  expect(result.data.job).toMatchObject({ id: seed.jobId, status: "applied" });
  expect(result.data.summary).toMatchObject({ created_count: 2, updated_count: 0 });
  await expect(dialog).not.toBeVisible();
  await browser.reload();
  const after = await readEstimate(browser, ids.versionId);
  for (const item of measures.filter(item => !item.is_excluded)) {
    expect(after.items.find(row => row.title === item.designation)).toMatchObject({ quantity: item.quantity, parent_id: target.parent_id });
  }
  expect(after.items.some(row => row.title === measures[2].designation)).toBe(false);
  for (const item of before.items) expect(after.items.find(row => row.id === item.id)).toMatchObject({ title: item.title, quantity: item.quantity, unit_price_ht_cents: item.unit_price_ht_cents });
  await recordEvidence(army, "takeoff-ui-apply-persisted", { ids, seed, expected: measures, items: after.items.map(({ id, title, quantity, parent_id }) => ({ id, title, quantity, parent_id })) });
});

armyTest("TKF03 foundations, provenance edit and pagination limits remain observable", options, async ({ app, screen, browser, army }) => {
  const ids = await createEstimateViaWizard({ app, screen, browser }, { projectName: army.projectName, title: "ARMY provenance" }, army);
  const fixture = await localTakeoffFixture(army, ids);
  const health = await apiRequest<Envelope<{ enabled: boolean; tenant_id: string }>>(browser, "GET", "/api/takeoff/health");
  expect([health.status, health.body.data.enabled, health.body.data.tenant_id]).toEqual([200, true, fixture.tenantId]);
  const seed = await fixture.seed("B", [{ designation: "Mur porteur", quantity: 32, unit: "m2", confidence: 0.86, source_page: 3 }], "ARMY-provenance.pdf");
  const detail = await apiRequest<Envelope<{ items: { data: Item[] } }>>(browser, "GET", `/api/takeoff/jobs/${seed.jobId}`);
  expect(detail.status).toBe(200);
  const item = detail.body.data.items.data[0];
  expect([item.source_page, item.source_file_name]).toEqual([3, "ARMY-provenance.pdf"]);
  const patch = await apiRequest<Envelope<{ succeeded: number; failed: number }>>(browser, "PATCH", `/api/takeoff/jobs/${seed.jobId}/items`, {
    items: [{ item_id: item.id, updated_at: item.updated_at, fields: { is_excluded: true, exclusion_reason: "ARMY explicit provenance exclusion" } }],
  });
  expect([patch.status, patch.body.data.succeeded, patch.body.data.failed]).toEqual([200, 1, 0]);
  const after = await apiRequest<Envelope<{ items: { data: Item[] } }>>(browser, "GET", `/api/takeoff/jobs/${seed.jobId}`);
  expect(after.body.data.items.data[0]).toMatchObject({ source_page: 3, source_file_name: "ARMY-provenance.pdf", is_excluded: true, exclusion_reason: "ARMY explicit provenance exclusion" });
  const limit = await apiRequest<Envelope<unknown>>(browser, "GET", `/api/takeoff/jobs?estimate_version_id=${ids.versionId}&limit=20&offset=10001`);
  expect([400, 422]).toContain(limit.status);
  expect(["VALIDATION_ERROR", "BAD_REQUEST"]).toContain(limit.body.error?.code);
  await recordEvidence(army, "takeoff-provenance", { ids, seed, after, limit });
});

armyTest("TKF04 revision comparison exposes actual additions removals and changed quantities", options, async ({ app, screen, browser, army }) => {
  const ids = await createEstimateViaWizard({ app, screen, browser }, { projectName: army.projectName, title: "ARMY revision delta" }, army);
  const fixture = await localTakeoffFixture(army, ids);
  const base = await fixture.seed("C", [
    { designation: "Mur BA13", quantity: 10, unit: "m2", confidence: 0.9 },
    { designation: "Porte bois", quantity: 2, unit: "u", confidence: 0.88, source_page: 2 },
  ]);
  const other = await fixture.seed("C", [
    { designation: "Mur BA13", quantity: 12, unit: "m2", confidence: 0.93 },
    { designation: "Fenetre PVC", quantity: 1, unit: "u", confidence: 0.81, source_page: 3 },
  ]);
  const response = await apiRequest<Envelope<{ base_job_id: string; other_job_id: string; summary: { added: number; removed: number; changed: number } }>>(browser, "GET", `/api/takeoff/jobs/${base.jobId}/compare?with=${other.jobId}`);
  await recordEvidence(army, "takeoff-revision-comparison", { ids, base, other, response });
  expect(response.status).toBe(200);
  expect(response.body.data).toMatchObject({ base_job_id: base.jobId, other_job_id: other.jobId });
  expect(response.body.data.summary).toMatchObject({ added: 1, removed: 1, changed: 1 });
});
