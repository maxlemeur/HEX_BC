import { test } from "@e2e-dev/web";
import { expect } from "e2e";

// A lazy dialog can regress on its first open, lose its fields, or fail to release focus on close.
// Exercise every deferred import without submitting forms or changing catalogue data.
test(
  "production performance: product dialogs load on their first open",
  { tags: ["performance"], session: "army", requires: ["browser"] },
  async ({ app, browser, screen }) => {
    await app.open("/dashboard/products");
    const add = screen.getByRole("button", "Ajouter", { exact: true });
    await add.tap();
    await expect(screen.getByRole("heading", "Ajouter un produit", { exact: true })).toBeVisible();
    await expect(screen.getByLabel("Désignation *", { exact: true })).toBeVisible();
    await browser.keyboard.press("Escape");
    await expect(screen.getByRole("dialog")).toBeHidden();
    await expect(add).toBeFocused();

    for (const entry of [
      { action: "Importer un CSV produits", heading: "Importer des produits" },
      { action: "Importer produits et tarifs", heading: "Importer des produits et tarifs" },
    ]) {
      const menu = screen.getByRole("button", "Ouvrir les actions du catalogue", { exact: true });
      await menu.tap();
      await screen.getByRole("menuitem", entry.action, { exact: true }).tap();
      await expect(screen.getByRole("heading", entry.heading, { exact: true })).toBeVisible();
      await browser.keyboard.press("Escape");
      await expect(screen.getByRole("dialog")).toBeHidden();
      await expect(menu).toBeFocused();
    }
  }
);
