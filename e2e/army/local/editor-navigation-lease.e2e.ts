import { expect } from "e2e";

import { apiRequest, armyTest, recordEvidence, type ArmyItem, type ArmyVersion } from "../critical/fixtures";
import {
  clonedPopupObservation, documentObservation, editorPath, leaseCheckpoint, leaseEditorReady,
  leaseTotals, observeLeaseRequests, openClonedLeasePopup, prepareLeaseCase, reloadClonedLeasePopup,
  withLeaseEvidence, type LeasePrepared, type LeaseUi,
} from "./editor-navigation-lease-support";

// Failures/oracles recorded first in docs/testing/editor-navigation-lease.md.
// NAV02/03/04/06 have transport contracts only; they are not skipped tests.
const options = { session: "army", tags: ["source-coverage", "navigation-lease"], trace: "off" as const, timeout: 180_000 };
type Envelope = { ok: boolean; data: { version: ArmyVersion; items: ArmyItem[] } };

function assertOrdinaryRls(observation: Awaited<ReturnType<typeof leaseCheckpoint>>) {
  expect(observation.apiStatus).toBe(200); expect(observation.financial).not.toBeNull();
  if ("failed" in observation.rls) throw new Error("Ordinary navigation lease and financial observation unavailable.");
  expect(observation.rls.errors).toEqual({ lease: null, version: null, items: null });
  const versionFields = ["id", "project_id", "status", "updated_at", "total_ht_cents", "total_tax_cents", "total_ttc_cents"];
  const itemFields = ["id", "item_type", "parent_id", "position", "title", "quantity", "unit_price_ht_cents", "tax_rate_bp",
    "line_total_ht_cents", "line_tax_cents", "line_total_ttc_cents", "source_provider"];
  expect(observation.rls.versions).toEqual([Object.fromEntries(versionFields.map((field) => [field, observation.financial!.version[field]]))]);
  expect(observation.rls.items).toEqual([...observation.financial!.items].sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => Object.fromEntries(itemFields.map((field) => [field, item[field]]))));
  expect(observation.rls.leases).toHaveLength(1);
  expect([observation.rls.leases[0].expectedActor, observation.rls.leases[0].expectedTenant,
    observation.rls.leases[0].expectedVersion, observation.rls.leases[0].expired]).toEqual([true, true, true, false]);
}

async function saveThreeThroughUi(ui: LeaseUi, p: LeasePrepared, label: string) {
  await ui.screen.getByLabel(`Quantité pour ${p.title}`, { exact: true }).fill("3");
  await ui.screen.getByLabel(`Quantité pour ${p.title}`, { exact: true }).press("Tab");
  await ui.browser.keyboard.press("Control+s");
  const samples: Array<{ observedAt: string; status: number; ok: boolean; quantity: number | null; totals: number[] | null }> = [];
  try {
    await expect.poll(async () => {
      const response = await apiRequest<Envelope>(ui.browser, "GET", `/api/estimates/${p.versionId}`);
      const sample = { observedAt: new Date().toISOString(), status: response.status, ok: response.body?.ok === true,
        quantity: response.body?.data?.items?.find((item) => item.id === p.lineId)?.quantity ?? null,
        totals: response.body?.data?.version ? leaseTotals(response.body.data.version) : null };
      samples.push(sample);
      return [sample.status, sample.ok, sample.quantity, sample.totals];
    }, { timeout: 20_000 }).toEqual([200, true, 3, [3000, 600, 3600]]);
  } finally {
    await recordEvidence(ui.army, `${label}-save-samples`, { samples, enteredQuantity: "3", expectedTotals: [3000, 600, 3600] });
  }
  await leaseEditorReady(ui, p);
}

async function waitForReadOnlyPopup(ui: LeaseUi, p: LeasePrepared, label: string) {
  const samples: Array<Awaited<ReturnType<typeof clonedPopupObservation>>> = [];
  try {
    await expect.poll(async () => {
      const sample = await clonedPopupObservation(ui, p); samples.push(sample);
      return [sample.accessible, sample.pathname === editorPath(p), sample.quantityFound,
        sample.quantityEnabled === false, sample.distinctFromOriginal, sample.sameAsFirstPopupSession,
        sample.originalSessionUnchanged, sample.lockMessage?.includes("autre onglet ou appareil") === true];
    }, { timeout: 20_000 }).toEqual([true, true, true, true, true, true, true, true]);
  } finally {
    await recordEvidence(ui.army, `${label}-popup-samples`, { samples, nativeDuplicateTabQualified: false });
  }
  return samples.at(-1)!;
}

async function waitForPopupReload(ui: LeaseUi, p: LeasePrepared, previousTimeOrigin: number, label: string) {
  const samples: Array<Awaited<ReturnType<typeof clonedPopupObservation>>> = [];
  try {
    await expect.poll(async () => {
      const sample = await clonedPopupObservation(ui, p); samples.push(sample);
      return sample.timeOrigin ?? 0;
    }, { timeout: 15_000 }).toBeGreaterThan(previousTimeOrigin);
  } finally {
    await recordEvidence(ui.army, `${label}-reload-boundary-samples`, {
      previousTimeOrigin, samples, boundaryReached: (samples.at(-1)?.timeOrigin ?? 0) > previousTimeOrigin,
    });
  }
}

armyTest("NAV01 real reload then immediate requirements departure and return keeps ordinary editor usable", options, async (ui) => {
  const p = await prepareLeaseCase(ui, "NAV01");
  const observer = await observeLeaseRequests(ui, p);
  await withLeaseEvidence(ui, p, observer, "NAV01", async () => {
    await ui.app.open(editorPath(p));
    await leaseCheckpoint(ui, p, observer, "NAV01-initial-render");
    await leaseEditorReady(ui, p);
    const baseline = await leaseCheckpoint(ui, p, observer, "NAV01-ready-baseline");
    assertOrdinaryRls(baseline);
    expect(baseline.apiStatus).toBe(200); expect(baseline.financial).not.toBeNull();
    expect(leaseTotals(baseline.financial!.version)).toEqual([2000, 400, 2400]);
    expect(baseline.financial!.items.map((item) => item.id).sort()).toEqual([p.sectionId, p.lineId].sort());
    if ("failed" in baseline.rls) throw new Error("NAV01 ordinary lease baseline unavailable.");
    expect(baseline.rls.errors).toEqual({ lease: null, version: null, items: null });
    expect(baseline.rls.leases).toHaveLength(1);
    expect(baseline.rls.leases[0].expired).toBe(false);

    // No lease polling, repair or readiness wait between reload and departure.
    // These are full document navigations through the documented Army APIs.
    const startedMs = Date.now();
    const startedAt = new Date(startedMs).toISOString();
    const firstExpiresAt = baseline.rls.leases[0].expiresAt;
    const firstExpiryMs = Date.parse(firstExpiresAt);
    await ui.browser.reload({ timeout: 15_000 });
    const reloadFinishedAt = new Date().toISOString();
    const reloaded = await documentObservation(ui.browser, p.title, p.versionId);
    const departureStartedAt = new Date().toISOString();
    await ui.app.open(`/dashboard/estimates/${p.versionId}/source-review/requirements`);
    const departureFinishedAt = new Date().toISOString();
    const away = await documentObservation(ui.browser, p.title, p.versionId);
    const returnStartedAt = new Date().toISOString();
    await ui.app.open(editorPath(p));
    const returnedAt = Date.now();
    const returned = await leaseCheckpoint(ui, p, observer, "NAV01-immediate-return", {
      startedAt, reloadFinishedAt, departureStartedAt, departureFinishedAt, returnStartedAt,
      returnFinishedAt: new Date(returnedAt).toISOString(), reloaded, away,
      cycleToReturnMs: returnedAt - startedMs, firstExpiresAt, firstExpiryValid: Number.isFinite(firstExpiryMs),
      returnBeforeFirstExpiryMarginMs: Number.isFinite(firstExpiryMs) ? firstExpiryMs - returnedAt : null,
      deterministicCommitOrderForced: false,
    });
    // Retain the observed return state before asserting that it is usable.
    expect(reloaded.navigationType).toBe("reload");
    if ("failed" in baseline.document || "failed" in returned.document) throw new Error("NAV01 document boundary observation unavailable.");
    expect(reloaded.timeOrigin > baseline.document.timeOrigin).toBe(true);
    expect(away.pathname).toBe(`/dashboard/estimates/${p.versionId}/source-review/requirements`);
    expect(away.h1).toContain("Exigences du CCTP");
    expect(away.timeOrigin > reloaded.timeOrigin).toBe(true);
    expect(returned.document.timeOrigin > away.timeOrigin).toBe(true);
    expect(returned.financial).toEqual(baseline.financial);
    await leaseEditorReady(ui, p);
    const readyAt = Date.now();
    const editableAfterMs = readyAt - returnedAt;
    const cycleToReadyMs = readyAt - startedMs;
    const expiryMarginMs = Number.isFinite(firstExpiryMs) ? firstExpiryMs - readyAt : null;
    const ready = await leaseCheckpoint(ui, p, observer, "NAV01-return-ready", {
      startedAt, returnFinishedAt: new Date(returnedAt).toISOString(), readyAt: new Date(readyAt).toISOString(),
      editableAfterMs, maximumMs: 10_000, cycleToReturnMs: returnedAt - startedMs, cycleToReadyMs, maximumCycleMs: 20_000,
      firstExpiresAt, firstExpiryValid: Number.isFinite(firstExpiryMs), expiryMarginMs, minimumExpiryMarginMs: 20_000,
      returnBeforeFirstExpiryMarginMs: Number.isFinite(firstExpiryMs) ? firstExpiryMs - returnedAt : null, serverTtlMs: 120_000,
    });
    assertOrdinaryRls(ready);
    expect(editableAfterMs <= 10_000).toBe(true);
    expect(cycleToReadyMs <= 20_000).toBe(true);
    expect(Number.isFinite(firstExpiryMs)).toBe(true);
    expect(firstExpiryMs - returnedAt >= 20_000).toBe(true);
    expect(expiryMarginMs !== null && expiryMarginMs >= 20_000).toBe(true);
    if ("failed" in ready.rls) throw new Error("NAV01 ordinary return lease unavailable.");
    expect(ready.rls.errors).toEqual({ lease: null, version: null, items: null });
    expect(ready.rls.leases).toHaveLength(1);
    expect([ready.rls.leases[0].expectedActor, ready.rls.leases[0].expectedTenant, ready.rls.leases[0].expectedVersion, ready.rls.leases[0].expired]).toEqual([true, true, true, false]);
    expect(ready.financial).toEqual(baseline.financial);
    expect(ready.forcedRequests).toBe(0);

    await saveThreeThroughUi(ui, p, "NAV01");
    const saved = await leaseCheckpoint(ui, p, observer, "NAV01-saved-through-ui");
    assertOrdinaryRls(saved);
    expect(leaseTotals(saved.financial!.version)).toEqual([3000, 600, 3600]);
    await ui.browser.reload({ timeout: 15_000 });
    await leaseCheckpoint(ui, p, observer, "NAV01-saved-reload-render");
    await leaseEditorReady(ui, p);
    const persisted = await leaseCheckpoint(ui, p, observer, "NAV01-persisted-after-reload");
    assertOrdinaryRls(persisted);
    expect(persisted.financial).toEqual(saved.financial);
    await expect(ui.screen.getByLabel(`Quantité pour ${p.title}`, { exact: true })).toHaveValue("3");
    expect(persisted.forcedRequests).toBe(0);
  });
});

armyTest("NAV05 actual cloned sessionStorage popup remains read-only while the first document saves", options, async (ui) => {
  const p = await prepareLeaseCase(ui, "NAV05");
  const observer = await observeLeaseRequests(ui, p);
  await withLeaseEvidence(ui, p, observer, "NAV05", async () => {
    await ui.app.open(editorPath(p));
    await leaseCheckpoint(ui, p, observer, "NAV05-initial-render");
    await leaseEditorReady(ui, p);
    const baseline = await leaseCheckpoint(ui, p, observer, "NAV05-first-document-ready");
    assertOrdinaryRls(baseline);
    expect(baseline.apiStatus).toBe(200); expect(baseline.financial).not.toBeNull();
    expect(leaseTotals(baseline.financial!.version)).toEqual([2000, 400, 2400]);
    if ("failed" in baseline.rls) throw new Error("NAV05 ordinary lease baseline unavailable.");
    expect(baseline.rls.errors).toEqual({ lease: null, version: null, items: null });
    expect(baseline.rls.leases).toHaveLength(1);
    const firstLease = baseline.rls.leases[0];
    const opened = await openClonedLeasePopup(ui, p);
    expect(opened.opened).toBe(true); expect(opened.reason).toBeNull();
    expect(opened.clonedBeforeNavigation).toBe(true);
    const popup = await waitForReadOnlyPopup(ui, p, "NAV05-before-reload");
    const beforeReload = await leaseCheckpoint(ui, p, observer, "NAV05-cloned-document-read-only", { popup });
    assertOrdinaryRls(beforeReload);
    expect(beforeReload.financial).toEqual(baseline.financial);
    if ("failed" in beforeReload.rls) throw new Error("NAV05 ordinary popup lease observation unavailable.");
    expect(beforeReload.rls.leases).toHaveLength(1);
    expect([beforeReload.rls.leases[0].rowAlias, beforeReload.rls.leases[0].sessionAlias]).toEqual([firstLease.rowAlias, firstLease.sessionAlias]);
    const reloaded = await reloadClonedLeasePopup(ui);
    await recordEvidence(ui.army, "NAV05-popup-reload-trigger", reloaded);
    expect(reloaded.attempted).toBe(true);
    await waitForPopupReload(ui, p, popup.timeOrigin ?? 0, "NAV05-first");
    const popupReload = await waitForReadOnlyPopup(ui, p, "NAV05-after-reload");
    await leaseCheckpoint(ui, p, observer, "NAV05-second-document-reloaded", { popupReload });
    expect(popupReload.navigationType).toBe("reload");
    expect(popupReload.sameAsFirstPopupSession).toBe(true);

    await saveThreeThroughUi(ui, p, "NAV05");
    const saved = await leaseCheckpoint(ui, p, observer, "NAV05-first-document-saved");
    assertOrdinaryRls(saved);
    if ("failed" in saved.rls) throw new Error("NAV05 ordinary saved lease unavailable.");
    expect(saved.rls.errors).toEqual({ lease: null, version: null, items: null });
    expect(saved.rls.leases).toHaveLength(1);
    expect([saved.rls.leases[0].rowAlias, saved.rls.leases[0].sessionAlias]).toEqual([firstLease.rowAlias, firstLease.sessionAlias]);
    expect(leaseTotals(saved.financial!.version)).toEqual([3000, 600, 3600]);
    const mutation = observer.requests.filter((entry) => !entry.pathname.endsWith("/lock"));
    expect(mutation.length > 0).toBe(true);
    expect(mutation.every((entry) => entry.sessionAlias === firstLease.sessionAlias)).toBe(true);
    const popupSessions = new Set(observer.requests.filter((entry) => entry.pathname.endsWith("/lock") && entry.method === "POST" && entry.sessionAlias !== firstLease.sessionAlias).map((entry) => entry.sessionAlias));
    expect(popupSessions.size).toBe(1); expect(popupSessions.has(null)).toBe(false);

    const refresh = await reloadClonedLeasePopup(ui);
    await recordEvidence(ui.army, "NAV05-popup-refresh-trigger", refresh);
    expect(refresh.attempted).toBe(true);
    await waitForPopupReload(ui, p, popupReload.timeOrigin ?? 0, "NAV05-after-save");
    const refreshed = await waitForReadOnlyPopup(ui, p, "NAV05-refreshed-after-save");
    const final = await leaseCheckpoint(ui, p, observer, "NAV05-two-documents-final", { refreshed, nativeDuplicateTabQualified: false });
    assertOrdinaryRls(final);
    expect(refreshed.quantity).toBe("3");
    expect(final.financial).toEqual(saved.financial);
    if ("failed" in final.rls) throw new Error("NAV05 ordinary final lease unavailable.");
    expect(final.rls.leases).toHaveLength(1);
    expect([final.rls.leases[0].rowAlias, final.rls.leases[0].sessionAlias]).toEqual([firstLease.rowAlias, firstLease.sessionAlias]);
    await expect(ui.screen.getByLabel(`Quantité pour ${p.title}`, { exact: true })).toBeEnabled();
    expect(final.forcedRequests).toBe(0);
  });
});
