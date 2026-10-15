import { expect } from "e2e";

import { armyTest, recordEvidence } from "../critical/fixtures";
import { mountComponentFixture } from "./component-fixture";

const options = { session: "army", tags: ["critical", "extended", "navigation-specialist"], trace: "off" as const, timeout: 90_000 };
type Ui = Parameters<typeof mountComponentFixture>[0];

async function navigation(ui: Ui) {
  const state = { saved: "", writes: [] as string[], reject: false, pending: null as Promise<void> | null };
  const fixturePath = await mountComponentFixture(ui, {
    entry: "autosave-navigation",
    handle: async (route, url) => {
      if (url.pathname === "/fixture-save") {
        const body = JSON.parse(route.request.postData ?? "{}") as { value: string };
        state.writes.push(body.value);
        if (state.pending) await state.pending;
        if (state.reject) await route.fulfill({ status: 503, json: {} });
        else { state.saved = body.value; await route.fulfill({ json: {} }); }
        return true;
      }
      if (url.pathname === "/destination") {
        const escaped = state.saved.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
        await route.fulfill({ contentType: "text/html; charset=utf-8", body: `<main><h1>Destination</h1><p>Désignation enregistrée : ${escaped}</p></main>` });
        return true;
      }
      return false;
    },
  });
  return { state, fixturePath };
}

armyTest("NAV-S01 one click saves and reaches the requested destination", options, async (ui) => {
  const { state } = await navigation(ui);
  await ui.screen.getByLabel("Désignation").fill("Tube cuivre 18 mm");
  await ui.screen.getByRole("link", "Quitter le chiffrage").click();
  await expect(ui.screen.getByRole("heading", "Destination")).toBeVisible();
  await expect(ui.screen.getByText("Désignation enregistrée : Tube cuivre 18 mm")).toBeVisible();
  expect(state.writes).toEqual(["Tube cuivre 18 mm"]);
  await recordEvidence(ui.army, "navigation-click", { writes: state.writes, saved: state.saved });
});

armyTest("NAV-S02 slow save keeps input then resumes without a second click", options, async (ui) => {
  const { state } = await navigation(ui);
  let release!: () => void;
  state.pending = new Promise<void>((resolve) => { release = resolve; });
  try {
    await ui.screen.getByLabel("Désignation").fill("Vanne 15/21");
    await ui.screen.getByRole("link", "Quitter le chiffrage").click();
    await expect(ui.screen.getByRole("status")).toHaveText("Sauvegarde en cours");
    await expect(ui.screen.getByLabel("Désignation")).toHaveValue("Vanne 15/21");
    expect(state.saved).toBe("");
    release();
    await expect(ui.screen.getByRole("heading", "Destination")).toBeVisible();
    await expect(ui.screen.getByText("Désignation enregistrée : Vanne 15/21")).toBeVisible();
    expect(state.writes).toEqual(["Vanne 15/21"]);
    await recordEvidence(ui.army, "navigation-slow", { writes: state.writes, saved: state.saved });
  } finally { release(); }
});

armyTest("NAV-S03 failed save preserves input and explicit retry resumes navigation", options, async (ui) => {
  const { state } = await navigation(ui);
  state.reject = true;
  await ui.screen.getByLabel("Désignation").fill("Flexible sanitaire");
  await ui.screen.getByRole("link", "Quitter le chiffrage").click();
  await expect(ui.screen.getByRole("alert")).toContainText("saisie conservée");
  await expect(ui.screen.getByLabel("Désignation")).toHaveValue("Flexible sanitaire");
  expect(state.saved).toBe("");
  expect(state.writes).toEqual(["Flexible sanitaire"]);
  state.reject = false;
  await ui.screen.getByRole("link", "Quitter le chiffrage").click();
  await expect(ui.screen.getByText("Désignation enregistrée : Flexible sanitaire")).toBeVisible();
  expect(state.writes).toEqual(["Flexible sanitaire", "Flexible sanitaire"]);
  await recordEvidence(ui.army, "navigation-retry", { writes: state.writes, saved: state.saved });
});

armyTest("NAV-S04 Back and Forward save before resuming without extra history entries", options, async (ui) => {
  const { state, fixturePath } = await navigation(ui);
  await ui.screen.getByRole("button", "Ouvrir le chiffrage suivant").click();
  await expect(ui.browser).toHaveURL(/\/editor\?visit=1$/);
  await ui.screen.getByLabel("Désignation").fill("Retour conservé");
  const historyLength = await ui.browser.evaluate(() => history.length);
  let release!: () => void;
  state.pending = new Promise<void>((resolve) => { release = resolve; });
  try {
    await ui.browser.evaluate(() => { history.back(); return true; });
    await expect(ui.screen.getByRole("status")).toHaveText("Sauvegarde en cours");
    await expect(ui.browser).toHaveURL(/\/editor\?visit=1$/);
    release();
    await expect(ui.browser).toHaveURL(fixturePath);
    expect(await ui.browser.evaluate(() => history.length)).toBe(historyLength);
    expect(state.saved).toBe("Retour conservé");
    state.pending = null;
    await ui.screen.getByLabel("Désignation").fill("Avance conservée");
    await ui.browser.evaluate(() => { history.forward(); return true; });
    await expect(ui.browser).toHaveURL(/\/editor\?visit=1$/);
    expect(await ui.browser.evaluate(() => history.length)).toBe(historyLength);
    expect(state.saved).toBe("Avance conservée");
    expect(state.writes).toEqual(["Retour conservé", "Avance conservée"]);
    await recordEvidence(ui.army, "navigation-history", { historyLength, writes: state.writes, saved: state.saved });
  } finally { release(); }
});
