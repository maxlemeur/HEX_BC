import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { expect } from "e2e";

import { armyTest, recordEvidence } from "../critical/fixtures";
import { mountComponentFixture } from "./component-fixture";

const options = { session: "army", tags: ["critical", "extended", "ui-polish"], trace: "off" as const, timeout: 120_000 };
type Ui = Parameters<typeof mountComponentFixture>[0];
const itemId = "11111111-1111-4111-8111-111111111111";

async function polished(ui: Ui) {
  const state = { threshold: 45 as number | null, thresholdsRequested: [] as Array<number | null> };
  await mountComponentFixture(ui, {
    entry: "ui-polish",
    handle: async (route, url) => {
      if (!url.pathname.endsWith("/supplier-comparisons")) return false;
      state.thresholdsRequested.push(state.threshold);
      await route.fulfill({ json: { data: {
        ...(state.threshold === null ? {} : { stale_price_days: state.threshold }),
        comparisons: [{ item_id: itemId, best_supplier_price_id: "33333333-3333-4333-8333-333333333333", selected_supplier_price_id: null,
          alternatives: [{ kind: "best_price", supplier_price_id: "33333333-3333-4333-8333-333333333333",
            supplier_name: "Fournisseur Alpha", adjusted_unit_price_cents: 900, currency: "EUR", unit: "u",
            updated_at: "2025-01-01T00:00:00Z", is_stale: true, is_active: true, is_selected: false }],
        }],
      } } });
      return true;
    },
  });
  return state;
}

async function axe(ui: Ui, selectors: string[], contrastOnly = false) {
  const require = createRequire(path.resolve("package.json"));
  const source = await readFile(require.resolve("axe-core/axe.min.js"), "utf8");
  await ui.browser.evaluate(`(() => { ${source}\n; return true; })()`);
  return ui.browser.evaluate(async ({ include, contrast }) => {
    const runtime = (globalThis as typeof globalThis & { axe: { run: (context: { include: string[] }, options: object) => Promise<{
      violations: Array<{ id: string; impact: string | null; nodes: Array<{ target: string[] }> }>;
    }> } }).axe;
    const result = await runtime.run({ include }, contrast ? { runOnly: { type: "rule", values: ["color-contrast"] } } : {});
    return result.violations.map(({ id, impact, nodes }) => ({ id, impact, targets: nodes.map((node) => node.target) }));
  }, { include: selectors, contrast: contrastOnly });
}

// This wait asserts the temporal contract itself (queued/hovered toast lifetime).
async function afterLifetime(ui: Ui, milliseconds: number) {
  const started = await ui.browser.evaluate(() => performance.now());
  await expect.poll(() => ui.browser.evaluate(() => performance.now()), { timeout: milliseconds + 5000, interval: 100 }).toBeGreaterThanOrEqual(started + milliseconds);
}

armyTest("UI01 notifications keep FIFO and a queued toast receives its full visible lifetime", options, async (ui) => {
  await polished(ui);
  await expect(ui.screen.getByTestId("estimate-editor-table")).toBeVisible();
  await ui.screen.getByRole("button", "Rafale", { exact: true }).click();
  const notifications = ui.browser.locator("[data-toast-id]");
  await expect(notifications).toHaveCount(3);
  await expect(notifications).toContainText(["Notification 1", "Notification 2", "Notification 3"]);
  await ui.screen.getByRole("button", "Retirer en attente").click();
  await afterLifetime(ui, 1700);
  await expect(notifications).toHaveCount(3);
  await ui.screen.getByRole("button", "Retirer première").click();
  await expect(notifications).toContainText(["Notification 2", "Notification 3", "Notification 4"]);
  await expect(ui.screen.getByText("Notification 5", { exact: true })).toHaveCount(0);
  await expect(ui.screen.getByText("Notification 4", { exact: true })).toBeVisible();
  await expect(ui.screen.getByText("Notification 4", { exact: true })).toHaveCount(0, { timeout: 5000 });
  await recordEvidence(ui.army, "toast-fifo", { queuedWaitMs: 1700, promoted: "Notification 4", dismissedQueued: "Notification 5", remaining: await notifications.allTextContents() });
});

armyTest("UI02 hover pauses toast lifetime and F6 plus keyboard dismissal remain accessible", options, async (ui) => {
  await polished(ui);
  await expect(ui.screen.getByTestId("estimate-editor-table")).toBeVisible();
  await ui.screen.getByRole("button", "Erreur", { exact: true }).click();
  const notification = ui.browser.locator('[data-slot="toast"]');
  await expect(notification).toContainText("Échec de sauvegarde");
  await notification.hover();
  await afterLifetime(ui, 2200);
  await expect(notification).toBeVisible();
  await ui.browser.keyboard.press("F6");
  await expect(ui.browser.locator('[data-slot="toast-viewport"]')).toBeFocused();
  const violations = await axe(ui, ['[data-slot="toast"]']);
  expect(violations).toEqual([]);
  await notification.getByRole("button", "Fermer la notification").focus();
  await ui.browser.keyboard.press("Enter");
  await expect(notification).toHaveCount(0);
  await ui.screen.getByRole("button", "Succès bref").click();
  await expect(ui.screen.getByText("Devis enregistré", { exact: true })).toBeVisible();
  await expect(ui.screen.getByText("Devis enregistré", { exact: true })).toHaveCount(0, { timeout: 5000 });
  await recordEvidence(ui.army, "toast-keyboard", { hoveredMs: 2200, violations, keyboardDismissed: true, briefExpired: true });
});

armyTest("UI03 supplier comparison uses API freshness threshold and historical fallback", options, async (ui) => {
  const state = await polished(ui);
  await expect(ui.screen.getByTestId("estimate-editor-table")).toBeVisible();
  for (const days of [45, 120, null]) {
    state.threshold = days;
    await ui.screen.getByTestId("estimate-line-row").first().secondaryTap();
    await ui.screen.getByRole("menuitem", "Comparer les fournisseurs", { exact: true }).click();
    const dialog = ui.screen.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Fournisseur Alpha");
    await expect(dialog).toContainText(days === null ? "au-delà du seuil de fraîcheur" : `seuil de fraîcheur : ${days} j`);
    await expect(dialog).not.toContainText("seuil de fraîcheur : 90 j");
    if (days === 45) {
      await ui.browser.evaluate(() => { window.dispatchEvent(new Event("fixture-notification")); return true; });
      await expect(ui.browser.locator('[data-slot="toast"]')).toContainText("Notification pendant la comparaison");
      await ui.browser.locator('[data-slot="toast-close"]').click();
      await expect(ui.browser.locator('[data-slot="toast"]')).toHaveCount(0);
    }
    await ui.browser.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  expect(state.thresholdsRequested).toEqual([45, 120, null]);
  await recordEvidence(ui.army, "supplier-freshness-ui", { thresholdsRequested: state.thresholdsRequested });
});

armyTest("UI04 legacy utility styling and frozen FO MO header contrast remain accessible", options, async (ui) => {
  await polished(ui);
  await expect(ui.screen.getByTestId("estimate-editor-table")).toBeVisible();
  await expect.poll(() => ui.browser.evaluate(() => {
    const node = document.querySelector('[data-testid="cascade-button"]');
    return node ? getComputedStyle(node).backgroundColor : null;
  })).toBe("oklch(0.505 0.213 27.518)");
  const samples = [];
  for (const width of [1600, 1280]) {
    await ui.browser.setViewport({ width, height: 1000 });
    await expect(ui.browser.locator(".estimate-super-head__group--fo, .estimate-super-head__group--mo")).toHaveCount(2);
    await expect.poll(() => ui.browser.evaluate(() => {
      const node = document.querySelector(".estimate-super-head__group--fo");
      return node ? getComputedStyle(node).fontSize : null;
    })).toBe("10px");
    const violations = await axe(ui, [".estimate-super-head__group--fo", ".estimate-super-head__group--mo"], true);
    expect(violations).toEqual([]);
    samples.push({ width, violations });
  }
  await recordEvidence(ui.army, "frozen-header-contrast", { samples, expectedBackground: "oklch(0.505 0.213 27.518)", expectedFontSize: "10px" });
});
