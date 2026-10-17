import { expect } from "e2e";

import { apiRequest, armyTest, ownEstimate, readEstimate, recordEvidence } from "./fixtures";

armyTest("HUB02 a fresh affaire keeps its manual path without requiring a DPGF", {
  session: "army", trace: "off", tags: ["critical", "hub-manual"], timeout: 120_000,
}, async ({ app, browser, screen, army }) => {
  await app.open("/dashboard/affaires");
  const projectName = `${army.runPrefix}-HUB02`;
  const created = await apiRequest<{ ok: boolean; data: { project: { id: string }; version: { id: string } } }>(browser, "POST", "/api/estimates", {
    project: { name: projectName }, version: { title: "ARMY manual first", date_devis: "2026-10-15", validite_jours: 30 },
  });
  expect([created.status, created.body.ok]).toEqual([201, true]);
  const estimate = { projectId: created.body.data.project.id, versionId: created.body.data.version.id };
  ownEstimate(army, estimate);
  const before = await readEstimate(browser, estimate.versionId);
  expect(before.items).toEqual([]);
  expect(before.project.name).toBe(projectName);
  await app.open(`/dashboard/affaires/${estimate.projectId}`);
  await expect(screen.getByText("Déposez vos pièces ici", { exact: true })).toBeVisible();
  const manualLink = screen.getByRole("link", "Continuer en manuel", { exact: true });
  const editorPath = `/dashboard/estimates/${estimate.versionId}/edit?entry=manual`;
  await expect(manualLink).toHaveAttribute("href", editorPath);
  await expect(screen.getByText("Le mode manuel reste disponible", { exact: true })).toBeVisible();
  await expect(screen.getByText("Vous pouvez ouvrir le devis sans DPGF et compléter la structure plus tard.", { exact: true })).toBeVisible();
  await manualLink.click();
  await expect(browser).toHaveURL(editorPath);
  await expect(screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible();
  expect((await readEstimate(browser, estimate.versionId)).items).toEqual([]);
  await recordEvidence(army, "HUB02-manual-path", { estimate, projectName, editorPath, emptyBefore: true, emptyAfter: true });
});

const UPLOAD_CARD_TEXT = "Déposez vos pièces ici";
type RevealProbe = {
  heldReveals: number;
  hydratedAtMs: number | null;
  releasedAtMs: number | null;
  maxCopies: number;
  maxLiveCopies: number;
  heldAndLive: boolean;
  serverCardKept: boolean | null;
};

// React streams the hub after the shell, then batches the reveal (`$RC` queues it,
// `$RV` waits until ~300 ms after the shell's first paint or the previous reveal).
// When hydration commits first, a
// provider value changing above the still-hidden boundary makes React client-render
// it while the streamed copy waits in `div[hidden][id^="S:"]`: HUB02 then saw two
// upload cards (16/10, two workers). Holding `$RV` until the shell has hydrated
// replays that order deterministically; every DOM state is sampled meanwhile.
function holdStreamedRevealUntilHydrated(text: string) {
  const probe: RevealProbe = {
    heldReveals: 0, hydratedAtMs: null, releasedAtMs: null,
    maxCopies: 0, maxLiveCopies: 0, heldAndLive: false, serverCardKept: null,
  };
  (window as unknown as { __hubRevealProbe: RevealProbe }).__hubRevealProbe = probe;
  let firstCard: Element | null = null;
  const sample = () => {
    const snapshot = document.evaluate(
      `//text()[normalize-space(.) = ${JSON.stringify(text)}]`,
      document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null,
    );
    const cards: Element[] = [];
    for (let index = 0; index < snapshot.snapshotLength; index += 1) {
      const parent = snapshot.snapshotItem(index)?.parentElement;
      if (parent && parent.closest("script") === null) cards.push(parent);
    }
    firstCard ??= cards[0] ?? null;
    const live = cards.filter((card) => card.closest("[hidden]") === null);
    probe.maxCopies = Math.max(probe.maxCopies, cards.length);
    probe.maxLiveCopies = Math.max(probe.maxLiveCopies, live.length);
    if (live.length > 0 && live.length < cards.length) probe.heldAndLive = true;
    probe.serverCardKept = firstCard === null ? null : cards.length === 1 && live[0] === firstCard;
  };
  new MutationObserver(sample).observe(document, { childList: true, subtree: true });

  let reveal: ((batch: unknown) => void) | undefined;
  let heldBatch: unknown;
  const release = () => {
    if (probe.releasedAtMs !== null) return;
    probe.releasedAtMs = performance.now();
    if (reveal && heldBatch !== undefined) reveal(heldBatch);
    sample();
  };
  Object.defineProperty(window, "$RV", {
    configurable: true,
    get: () => (batch: unknown) => {
      if (probe.releasedAtMs !== null) return reveal?.(batch);
      probe.heldReveals += 1;
      heldBatch = batch;
    },
    set: (value: (batch: unknown) => void) => { reveal = value; },
  });
  // React tags each hydrated host node with `__reactFiber$…`; layout effects and
  // the first data fetches settle well within the margin before the release.
  const startedAt = performance.now();
  const watch = window.setInterval(() => {
    const main = document.getElementById("dashboard-main-content");
    if (main !== null && Object.keys(main).some((key) => key.startsWith("__reactFiber$"))) {
      window.clearInterval(watch);
      probe.hydratedAtMs = performance.now();
      window.setTimeout(release, 1_500);
    } else if (performance.now() - startedAt > 20_000) {
      window.clearInterval(watch);
      release();
    }
  }, 25);
}

armyTest("HUB11 the affaire hub hydrates its streamed panel once when the reveal lands after hydration", {
  session: "army", trace: "off", tags: ["critical", "hub-manual", "hub-hydration"], timeout: 120_000,
}, async ({ app, browser, screen, army }) => {
  await app.open("/dashboard/affaires");
  const projectName = `${army.runPrefix}-HUB11`;
  const created = await apiRequest<{ ok: boolean; data: { project: { id: string }; version: { id: string } } }>(browser, "POST", "/api/estimates", {
    project: { name: projectName }, version: { title: "ARMY hub hydration", date_devis: "2026-10-16", validite_jours: 30 },
  });
  expect([created.status, created.body.ok]).toEqual([201, true]);
  const estimate = { projectId: created.body.data.project.id, versionId: created.body.data.version.id };
  ownEstimate(army, estimate);
  await browser.addInitScript(holdStreamedRevealUntilHydrated, UPLOAD_CARD_TEXT);
  await app.open(`/dashboard/affaires/${estimate.projectId}`);
  await expect.poll(() => browser.evaluate(() =>
    (window as unknown as { __hubRevealProbe?: RevealProbe }).__hubRevealProbe?.releasedAtMs ?? null,
  ), { timeout: 30_000, interval: 100 }).not.toBeNull();
  const probe = await browser.evaluate(() =>
    (window as unknown as { __hubRevealProbe: RevealProbe }).__hubRevealProbe);
  const expected = { maxCopies: 1, maxLiveCopies: 1, heldAndLive: false, serverCardKept: true };
  const editorPath = `/dashboard/estimates/${estimate.versionId}/edit?entry=manual`;
  await recordEvidence(army, "HUB11-hydrated-once", { estimate, projectName, editorPath, expected, probe });
  expect(probe.heldReveals, "the hub must stream behind the held reveal").toBeGreaterThan(0);
  expect(probe.hydratedAtMs, "the shell must hydrate before the reveal is released").not.toBeNull();
  expect({
    maxCopies: probe.maxCopies, maxLiveCopies: probe.maxLiveCopies,
    heldAndLive: probe.heldAndLive, serverCardKept: probe.serverCardKept,
  }).toEqual(expected);
  await expect(screen.getByText(UPLOAD_CARD_TEXT, { exact: true })).toBeVisible();
  await expect(screen.getByRole("link", "Continuer en manuel", { exact: true })).toHaveAttribute("href", editorPath);
  await expect(screen.getByRole("menubar", "Espaces de travail", { exact: true })).toBeVisible();
});
