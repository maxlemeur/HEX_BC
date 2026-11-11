import { expect } from "e2e";

import { apiRequest, armyTest, createLineViaApi, ownEstimate, readEstimate, recordEvidence, saveLineEditsWithShortcut, waitForAutoSave } from "./fixtures";
import { nativeTest, loginWithUi, localClient } from "../takeoff/native-ui";

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
  await expect(screen.getByRole("heading", "Ajoutez le dossier de consultation", { exact: true })).toBeVisible();
  await expect(screen.getByText("Étape 1 sur 6 · Dossier", { exact: true })).toBeVisible();
  // Both sources sit side by side in the next step: no separate Drive block, no export of the empty V1 in the header.
  await expect(screen.getByRole("button", "Sélectionner les fichiers depuis l'ordinateur", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Choisir dans Drive", { exact: true })).toBeVisible();
  await expect(screen.getByRole("button", "Ajouter depuis Google Drive", { exact: true })).toHaveCount(0);
  await expect(screen.getByRole("link", "Exporter", { exact: true })).toHaveCount(0);
  const manualLink = screen.getByRole("link", "Continuer en manuel", { exact: true });
  const editorPath = `/dashboard/estimates/${estimate.versionId}/edit?entry=manual`;
  await expect(manualLink).toHaveAttribute("href", editorPath);
  await expect(screen.getByText("Sans documents ? Ouvrez un devis vierge et complétez-le à votre rythme.", { exact: true })).toBeVisible();
  await manualLink.click();
  await expect(browser).toHaveURL(editorPath);
  await expect(screen.getByRole("heading", "Éditer le chiffrage", { exact: true })).toBeVisible();
  expect((await readEstimate(browser, estimate.versionId)).items).toEqual([]);
  await recordEvidence(army, "HUB02-manual-path", { estimate, projectName, editorPath, emptyBefore: true, emptyAfter: true });
});

const UPLOAD_CARD_TEXT = "Ajoutez le dossier de consultation";
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

// Blank and sparse dossiers must both allow manual work; document absence alone
// must never create a critical submission blocker. A user can still require a piece.
nativeTest("optional dossier documents allow a blank or sparse manual estimate", {
  session: "army", trace: "off", tags: ["critical", "local"], timeout: 180_000,
}, async ({ ui: page }) => {
  await loginWithUi(page);
  const response = await page.request.post("/api/estimates", { data: {
    project: { name: `${page.army.runPrefix}-Blank-dossier` }, version: { title: "Devis sans pièces" },
  } });
  expect(response.status()).toBe(201);
  const payload = await response.json() as { data: { project: { id: string }; version: { id: string } } };
  const projectId = payload.data.project.id;
  const versionId = payload.data.version.id;
  const { client } = await localClient();
  const activeGaps = async () => {
    const result = await client.from("affaire_register_entries").select("id,code,severity,metadata")
      .eq("project_id", projectId).eq("kind", "missing_piece").eq("is_active", true);
    expect(result.error).toBeNull();
    return result.data!;
  };
  await page.app.open(`/dashboard/affaires/${projectId}`);
  await expect(page.getByText("Aucune pièce n’est obligatoire. Démarrez sur une page blanche ou ajoutez les documents disponibles pour préparer le brief.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Continuer en manuel", exact: true }).click();
  await expect(page.browser).toHaveURL(new RegExp(`/dashboard/estimates/${versionId}/edit`));
  expect((await readEstimate(page.browser, versionId)).items).toEqual([]);
  expect(await activeGaps()).toEqual([]);

  // A single correspondence document must not turn absent DPGF/plans into blockers.
  const upload = await page.request.post(`/api/affaires/${projectId}/intake/files`, { multipart: {
    files: { name: "courrier-client.txt", mimeType: "text/plain", buffer: Buffer.from("Courrier : devis manuel pour une intervention fictive.") },
  } });
  expect(upload.status()).toBe(201);
  await expect.poll(async () => (await activeGaps()).map((entry) => entry.code)).toContain("missing_dpgf");
  await expect.poll(async () => (await activeGaps()).map((entry) => entry.code)).toContain("missing_plans");
  expect((await activeGaps()).filter((entry) => entry.severity === "critical")).toEqual([]);
  await page.app.open(`/dashboard/affaires/${projectId}?view=dossier`);
  await expect(page.getByText("À arbitrer avant remise", { exact: true })).toHaveCount(0);

  // The main flow must also offer manual work before a line or brief exists.
  await page.app.open(`/dashboard/affaires/${projectId}?view=overview`);
  await page.getByRole("button", { name: /Étude.*Structure, métrés et prix/ }).click();
  await page.getByText("Choisir la base du devis et les métrés", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Démarrer sur une page blanche", exact: true })).toBeVisible();
  await expect(page.getByText("Le dossier reste incomplet. Ajoutez les pièces manquantes avant de poursuivre le chiffrage.", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Démarrer sur une page blanche", exact: true }).click();
  // Seed one real line, then edit through the editor and prove the saved value.
  const title = "Prestation saisie sans DPGF";
  await createLineViaApi(page.browser, versionId, title);
  await page.reload();
  const quantity = page.getByLabel(`Quantité pour ${title}`, { exact: true });
  await quantity.fill("3");
  await quantity.press("Tab");
  await saveLineEditsWithShortcut(page, versionId, title, page.army);
  await waitForAutoSave(page, versionId, (estimate) => estimate.items.some((item) => item.title === title && item.quantity === 3));
  await page.reload();
  await expect(quantity).toHaveValue("3");

  // Preserve a deliberate requirement through the real audited product action.
  await page.app.open(`/dashboard/affaires/${projectId}#register`);
  await page.getByRole("button", { name: /Ajouter un point$/ }).click();
  await page.getByLabel("Type", { exact: true }).selectOption({ value: "missing_piece" });
  await page.getByLabel("Sévérité", { exact: true }).selectOption({ value: "critical" });
  await page.getByLabel("Texte", { exact: true }).fill("Accord écrit explicitement requis par le chargé d’étude");
  await page.getByRole("button", { name: "Ajouter au registre", exact: true }).click();
  await expect.poll(async () => (await activeGaps()).filter((entry) => entry.severity === "critical").length).toBe(1);
  await page.app.open(`/dashboard/affaires/${projectId}?view=dossier`);
  await expect(page.getByText("À arbitrer avant remise", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Dossier de l'affaire", exact: true }).getByText("Accord écrit explicitement requis par le chargé d’étude", { exact: true })).toBeVisible();
});
