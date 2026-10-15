import { expect, type Screen } from "e2e";
import { armyTest, recordEvidence } from "./fixtures";
import { mountComponentFixture } from "../extended/component-fixture";

type Ui = Parameters<typeof mountComponentFixture>[0] & { screen: Screen };
type CapturedEvent = { action: string; ids?: string[]; input?: Record<string, unknown>; reviewedIds?: string[]; markedIds?: string[]; excludedIds?: string[] };
const options = { session: "army", tags: ["critical", "deslop-specialist"], trace: "off" as const, timeout: 120_000 };
const TUBE_ID = "11111111-1111-4111-8111-111111111111";
const VIS_ID = "22222222-2222-4222-8222-222222222222";
const COUDE_ID = "33333333-3333-4333-8333-333333333333";

const items = [
  {
    project_id: "11111111-1111-4111-8111-111111111111",
    project_name: "Atelier Alpha",
    project_reference: "DESLOP-ALPHA",
    project_client_name: "Client Canonique Alpha",
    version_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    version_number: 2,
    status: "draft",
    title: "Offre Alpha",
    updated_at: "2026-10-02T09:00:00.000Z",
    total_ht_cents: 120000,
    date_devis: "2026-10-02",
    currency: " usd ",
    validite_jours: 30,
  },
  {
    project_id: "22222222-2222-4222-8222-222222222222",
    project_name: "Atelier Beta",
    project_reference: "DESLOP-BETA",
    project_client_name: "Client Canonique Beta",
    version_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    version_number: 1,
    status: "draft",
    title: null,
    updated_at: "2026-10-01T09:00:00.000Z",
    total_ht_cents: 32000,
    date_devis: null,
    currency: " gbp ",
    validite_jours: null,
  },
  {
    project_id: "33333333-3333-4333-8333-333333333333",
    project_name: "Atelier Gamma",
    project_reference: null,
    project_client_name: null,
    version_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    version_number: 1,
    status: "draft",
    title: null,
    updated_at: "2026-09-30T09:00:00.000Z",
    total_ht_cents: 64000,
    date_devis: null,
    currency: "INVALID",
    validite_jours: null,
  },
  {
    project_id: "44444444-4444-4444-8444-444444444444",
    project_name: "Atelier Delta",
    project_reference: null,
    project_client_name: null,
    version_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    version_number: 1,
    status: "draft",
    title: null,
    updated_at: "2026-09-29T09:00:00.000Z",
    total_ht_cents: 25000,
    date_devis: null,
    validite_jours: null,
  },
];
const canonicalResponse = { ok: true, data: { items } };

async function mount(ui: Ui, scenario: "client" | "assembly" | "review") {
  const state = { scenario, apiRequests: [] as string[], events: [] as CapturedEvent[], blockedUrls: [] as string[] };
  await ui.browser.addInitScript(() => {
    const errors: string[] = [];
    (window as typeof window & { __armyFixtureErrors: string[] }).__armyFixtureErrors = errors;
    window.addEventListener("error", (event) => errors.push(event.message));
    window.addEventListener("unhandledrejection", (event) => errors.push(String(event.reason)));
  });
  const origin = new URL(ui.app.baseUrl!).origin;
  await ui.browser.route("**/*", async (route) => {
    const url = new URL(route.request.url);
    if (url.origin !== origin) state.blockedUrls.push(url.origin + url.pathname);
    await route.fallback();
  });
  await mountComponentFixture(ui, {
    entry: scenario === "client" ? "deslop-client-list" : "deslop-live-replacements",
    query: scenario === "client" ? "" : "?scenario=" + scenario,
    handle: async (route, url) => {
      if (url.pathname.startsWith("/api/")) state.apiRequests.push(route.request.method + " " + url.pathname);
      if (scenario === "client" && url.pathname === "/api/estimates" && route.request.method === "GET") {
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(canonicalResponse) });
      } else if (scenario !== "client" && url.pathname === "/api/catalogue" && route.request.method === "GET") {
        await route.fulfill({ json: { ok: true, data: { items: [] } } });
      } else if (scenario !== "client" && url.pathname === "/fixture-events" && route.request.method === "POST") {
        state.events.push(JSON.parse(route.request.postData ?? "{}") as CapturedEvent);
        await route.fulfill({ json: { ok: true } });
      } else return false;
      return true;
    },
  });
  if (scenario === "client") await expect(ui.browser.locator("tbody tr")).toHaveCount(4);
  return state;
}

async function finish(ui: Ui, state: Awaited<ReturnType<typeof mount>>) {
  const browserErrors = await ui.browser.evaluate(() =>
    (window as typeof window & { __armyFixtureErrors: string[] }).__armyFixtureErrors ?? []);
  await recordEvidence(ui.army, "deslop-" + state.scenario, {
    ...state, browserErrors,
    fixtureIdentities: state.scenario === "client" ? items.map((item) => ({ projectId: item.project_id, versionId: item.version_id })) : [TUBE_ID, VIS_ID, COUDE_ID],
    canonicalResponse: state.scenario === "client" ? canonicalResponse : null,
    boundary: "Real React components; synthetic transport and parent callbacks; no SQL, RLS, SSR or deployed-route proof.",
  });
  expect(browserErrors).toEqual([]);
  expect(state.blockedUrls).toEqual([]);
}

async function expectNotStruckThrough(ui: Ui, text: string) {
  await expect(ui.screen.getByText(text, { exact: true })).toBeVisible();
  const decoration = await ui.browser.evaluate((label) => {
    const element = Array.from(document.querySelectorAll("*")).find((node) =>
      node.textContent === label && !Array.from(node.children).some((child) => child.textContent === label));
    if (!element) throw new Error("Expected visible designation is absent.");
    return getComputedStyle(element).textDecorationLine;
  }, text);
  expect(decoration).not.toBe("line-through");
}

armyTest("DES01 canonical client name is displayed and the real search keeps only its estimate", options, async (ui) => {
  const { screen, browser } = ui;
  const state = await mount(ui, "client");
  const { apiRequests } = state;
  try {
    const table = screen.getByRole("table");
    await expect(table.getByRole("cell", { name: "Client Canonique Alpha", exact: true })).toBeVisible();
    await expect(table.getByRole("cell", { name: "Client Canonique Beta", exact: true })).toBeVisible();
    const search = screen.getByRole("searchbox", { name: "Rechercher par projet ou client..." });
    await search.fill("Canonique Alpha");
    await expect(browser.locator("tbody tr")).toHaveCount(1);
    await expect(table.getByRole("link", { name: "Atelier Alpha", exact: true })).toBeVisible();
    await expect(table.getByRole("link", { name: "Atelier Beta", exact: true })).toHaveCount(0);
    await screen.getByRole("button", { name: "Effacer la recherche", exact: true }).click();
    await expect(browser.locator("tbody tr")).toHaveCount(4);
    expect(apiRequests).toContain("GET /api/estimates");
    expect(apiRequests.every((request) => request === "GET /api/estimates")).toBe(true);
  } finally {
    await finish(ui, state);
  }
});

armyTest("DES02 supported currencies normalize and invalid or absent currency falls back to EUR", options, async (ui) => {
  const { browser } = ui;
  const state = await mount(ui, "client");
  try {
    const rows = browser.locator("tbody tr");
    await expect(rows.filter({ hasText: "Atelier Alpha" }).getByRole("cell", { name: "USD", exact: true })).toBeVisible();
    await expect(rows.filter({ hasText: "Atelier Beta" }).getByRole("cell", { name: "GBP", exact: true })).toBeVisible();
    await expect(rows.filter({ hasText: "Atelier Gamma" }).getByRole("cell", { name: "EUR", exact: true })).toBeVisible();
    await expect(rows.filter({ hasText: "Atelier Delta" }).getByRole("cell", { name: "EUR", exact: true })).toBeVisible();
    await expect(rows.filter({ hasText: "Atelier Alpha" })).toContainText("$1,200.00");
    await expect(rows.filter({ hasText: "Atelier Beta" })).toContainText("£320.00");
    await expect(rows.filter({ hasText: "Atelier Gamma" })).toContainText("640,00");
    await expect(rows.filter({ hasText: "Atelier Gamma" }).getByRole("cell", { name: "—", exact: true })).toBeVisible();
    await expect(rows.filter({ hasText: "Atelier Delta" }).getByRole("cell", { name: "—", exact: true })).toBeVisible();
  } finally {
    await finish(ui, state);
  }
});

armyTest("DES03 le dialogue vivant refuse une ligne vide puis transmet nom, quantité et coût à la sauvegarde", options, async (ui) => {
  const { screen } = ui;
  const state = await mount(ui, "assembly");
  const { events } = state;
  try {
    await expect(screen.getByRole("heading", { name: "Ouvrage — fixture locale", exact: true })).toBeVisible();
    await screen.getByRole("button", { name: "Créer un ouvrage", exact: true }).click();
    const dialog = screen.getByRole("dialog", { name: "Nouvel ouvrage", exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Nom de l'ouvrage *", { exact: true }).fill("Tube de démonstration");
    await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText("La désignation de la ligne 1 est obligatoire.");
    expect(events).toHaveLength(0);

    await dialog.getByLabel("Code / référence", { exact: true }).fill("DEMO-TUBE");
    await dialog.getByLabel("Unité de l'ouvrage", { exact: true }).fill("ml");
    await dialog.getByLabel("Désignation *", { exact: true }).fill("Tube PVC");
    await dialog.getByLabel("Unité", { exact: true }).fill("ml");
    await dialog.getByLabel("Quantité par défaut", { exact: true }).fill("2.5");
    await dialog.getByLabel("Prix de revient FO (€)", { exact: true }).fill("12.34");
    await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(screen.getByRole("status", { name: "", exact: true }).filter({ hasText: "Ouvrage enregistré localement" })).toBeVisible();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "assembly-submit",
      input: {
        name: "Tube de démonstration", referenceCode: "DEMO-TUBE", unit: "ml", members: [],
        items: [{ title: "Tube PVC", unit: "ml", defaultQuantity: 2.5, unitCostHtCents: 1234, position: 1, costType: "material" }],
      },
    });
  } finally {
    await finish(ui, state);
  }
});

armyTest("DES04 la revue assistée vivante confirme acceptation et rejet puis déclenche appliquer", options, async (ui) => {
  const { screen } = ui;
  const state = await mount(ui, "review");
  const { events } = state;
  try {
    await expect(screen.getByRole("heading", { name: "Revue assistée — fixture locale", exact: true })).toBeVisible();
    const applyButton = screen.getByRole("button", { name: "Appliquer au chiffrage", exact: true });
    await expect(applyButton).toBeDisabled();
    await screen.getByRole("button", { name: "Accepter", exact: true }).nth(0).click();
    await expect(screen.getByRole("button", { name: "Accepté", exact: true })).toHaveCount(1);
    await screen.getByRole("button", { name: "Rejeter", exact: true }).nth(2).click();
    await expect(screen.getByRole("button", { name: "Rejeté", exact: true })).toHaveCount(1);
    await expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2");
    await expect(applyButton).toBeEnabled();
    await applyButton.click();
    await expect(screen.getByRole("status", { name: "", exact: true }).filter({ hasText: "Application demandée localement" })).toBeVisible();
    expect(events).toEqual([
      { action: "include", ids: [TUBE_ID] },
      { action: "exclude", ids: [COUDE_ID] },
      { action: "apply-click", reviewedIds: [TUBE_ID, COUDE_ID], markedIds: [], excludedIds: [VIS_ID, COUDE_ID] },
    ]);
  } finally {
    await finish(ui, state);
  }
});

armyTest("DES05 tout accepter réintègre la ligne exclue et conserve le marquage à revoir", options, async (ui) => {
  const { screen } = ui;
  const state = await mount(ui, "review");
  const { events } = state;
  try {
    await expect(screen.getByRole("heading", { name: "Revue assistée — fixture locale", exact: true })).toBeVisible();
    await screen.getByRole("button", { name: "À revoir", exact: true }).nth(0).click();
    await expect(screen.getByRole("button", { name: "Marqué à revoir", exact: true })).toHaveCount(1);
    await expectNotStruckThrough(ui, "Tube PVC");
    await expect(screen.getByRole("button", { name: "Rejeté", exact: true })).toHaveCount(0);
    await screen.getByRole("button", { name: "Tout accepter (2 items)", exact: true }).click();
    await expect(ui.browser.locator('[data-slot="toast"]').filter({ hasText: "2 items acceptés" })).toBeVisible();
    await expect(screen.getByRole("button", { name: "Accepté", exact: true })).toHaveCount(2);
    await expect(screen.getByRole("button", { name: "Marqué à revoir", exact: true })).toHaveCount(1);
    await expectNotStruckThrough(ui, "Tube PVC");
    await expect(screen.getByRole("button", { name: "Rejeté", exact: true })).toHaveCount(0);
    await expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "3");
    await screen.getByRole("button", { name: "Appliquer au chiffrage", exact: true }).click();
    await expect(screen.getByRole("status", { name: "", exact: true }).filter({ hasText: "Application demandée localement" })).toBeVisible();
    expect(events).toEqual([
      { action: "include", ids: [VIS_ID] },
      { action: "apply-click", reviewedIds: [TUBE_ID, VIS_ID, COUDE_ID], markedIds: [TUBE_ID], excludedIds: [] },
    ]);
  } finally {
    await finish(ui, state);
  }
});
