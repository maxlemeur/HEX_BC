import { expect } from "e2e";

import { armyTest, recordEvidence } from "../critical/fixtures";
import { mountComponentFixture } from "./component-fixture";

const options = { session: "army", tags: ["critical", "extended", "catalogue-specialist"], trace: "off" as const, timeout: 90_000 };

for (const role of ["admin", "engineer"] as const) {
  armyTest(`CAT-S01 ${role} saves one offer with exact cents and role-bound transport`, options, async (ui) => {
    const writes: Array<{ action: string; id: string; item: Record<string, unknown> }> = [];
    await mountComponentFixture(ui, {
      entry: "catalogue-offer", query: `?role=${role}`,
      handle: async (route, url) => {
        if (url.pathname !== "/api/prices" || route.request.method !== "POST") return false;
        const body = JSON.parse(route.request.postData ?? "{}") as (typeof writes)[number];
        writes.push(body);
        await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, data: { item: { id: body.id, ...body.item } } }) });
        return true;
      },
    });
    const dialog = ui.screen.getByRole("dialog", "Modifier l’offre fournisseur", { exact: true });
    const transport = dialog.getByLabel("Transport", { exact: true });
    await expect(transport).toHaveValue("included");
    if (role === "admin") {
      await transport.selectOption({ value: "excluded" });
      await dialog.getByLabel("Référence fournisseur", { exact: true }).fill("AL-019");
    } else await expect(transport).toBeDisabled();
    await dialog.getByLabel("Prix unitaire HT *", { exact: true }).fill(role === "admin" ? "11,50" : "12,50");
    await dialog.getByRole("button", "Enregistrer l’offre", { exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(ui.screen.getByRole("status").filter({ hasText: "Offre enregistrée" })).toBeVisible();
    await recordEvidence(ui.army, `catalogue-offer-${role}`, { role, writes, databaseWrites: 0 });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ action: "update-offer", id: "44444444-4444-4444-8444-444444444444", item: {
      unit_price_cents: role === "admin" ? 1150 : 1250,
      ...(role === "admin" ? { supplier_sku: "AL-019" } : {}),
    } });
    if (role === "admin") expect(writes[0].item.transport_mode).toBe("excluded");
    else {
      expect(writes[0].item).not.toHaveProperty("transport_mode");
      expect(writes[0].item).not.toHaveProperty("supplier_sku");
    }
  });
}
