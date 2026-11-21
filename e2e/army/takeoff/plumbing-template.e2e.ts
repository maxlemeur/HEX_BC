import { randomUUID } from "node:crypto";

import { recordEvidence } from "../critical/fixtures";
import { waitForHydration } from "../critical/hydration-support";
import { querySql } from "../local/calculation-gate-support";
import { signUpDedicatedOwner } from "../local/dedicated-owner";
import { describe, expect, nativeTest as test, type NativeUi } from "./native-ui";

// A publication changes the template of its tenant for every later list: this journey owns its account and tenant,
// never the campaign's (the POSTE journeys read the shipped version there).
const options = { session: "army", trace: "off" as const, tags: ["critical", "local", "takeoff-template"], timeout: 180_000 };

async function affaire(tenantId: string, userId: string, name: string) {
  const id = randomUUID();
  await querySql(`insert into public.estimate_projects (id, tenant_id, user_id, name)
    values ('${id}', '${tenantId}', '${userId}', '${name.replaceAll("'", "''")}');`);
  return id;
}

async function rows(sql: string) {
  const output = await querySql(`select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (${sql}) t;`);
  return JSON.parse(output.at(-1) ?? "[]") as Array<Record<string, unknown>>;
}

async function openList(ui: NativeUi, projectId: string) {
  await ui.app.open(`/dashboard/affaires/${projectId}/takeoff`);
  await waitForHydration(ui.browser);
  return ui.screen.getByRole("table", "Postes à mesurer", { exact: true });
}

describe("Gabarit de postes de l’entreprise", () => {
  test("GABARIT une correction publiée par l’administrateur sert la prochaine affaire et se propose à l’affaire existante", options, async ({ ui }) => {
    const { app, browser, screen, army } = ui;
    await app.open("/dashboard/affaires");
    const owner = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "GABARIT" });
    const existing = await affaire(owner.tenantId, owner.userId, `${army.runPrefix} affaire existante`);

    // The existing affaire records its list from the shipped template.
    let table = await openList(ui, existing);
    await expect(screen.getByText("Gabarit Plomberie · version 1 livrée avec l’application", { exact: true })).toBeVisible();
    await screen.getByRole("button", "Enregistrer la liste proposée", { exact: true }).click();
    await expect(screen.getByText("Liste enregistrée · révision 1 · 23 postes", { exact: false })).toBeVisible();
    const lavabo = table.getByRole("row", /^Lavabo Plomberie/);
    const lavaboId = await lavabo.getAttribute("id");

    // The administrator corrects one line, sees what publishing changes, and publishes version 2.
    await app.open("/dashboard/admin/takeoff/item-template");
    await waitForHydration(browser);
    await expect(screen.getByText("Version publiée : 1 (livrée avec l’application).", { exact: false })).toBeVisible();
    await screen.getByRole("textbox", "Désignation du poste lavabo", { exact: true }).fill("Lavabo sur colonne");
    await expect(screen.getByText("Modifié : Lavabo → Lavabo sur colonne", { exact: true })).toBeVisible();
    await expect(screen.getByRole("button", "Publier la version 2", { exact: true })).toBeDisabled();
    await screen.getByRole("button", "Enregistrer le brouillon", { exact: true }).click();
    await expect(screen.getByText("Brouillon enregistré (révision 1).", { exact: false })).toBeVisible();
    await screen.getByRole("button", "Publier la version 2", { exact: true }).click();
    await expect(screen.getByText("Version publiée : 2.", { exact: false })).toBeVisible();
    expect(await rows(`select version, based_on_version, line_count from public.takeoff_item_template_versions
      where tenant_id = '${owner.tenantId}'`)).toEqual([{ version: 2, based_on_version: 1, line_count: 23 }]);

    // The next affaire reads version 2.
    const next = await affaire(owner.tenantId, owner.userId, `${army.runPrefix} prochaine affaire`);
    table = await openList(ui, next);
    await expect(screen.getByText("Gabarit Plomberie · version 2 publiée le", { exact: false })).toBeVisible();
    await expect(table.getByRole("rowheader", "Lavabo sur colonne", { exact: true })).toBeVisible();
    await expect(table.getByRole("rowheader", "Lavabo", { exact: true })).toHaveCount(0);

    // The existing affaire keeps revision 1 until its operator accepts the proposed one; the item keeps its identity.
    table = await openList(ui, existing);
    await expect(screen.getByText("Liste enregistrée · révision 1 · 23 postes", { exact: false })).toBeVisible();
    await expect(table.getByRole("rowheader", "Lavabo", { exact: true })).toBeVisible();
    const proposal = screen.getByRole("region", "Révision proposée", { exact: true });
    await expect(proposal).toContainText("Révision proposée : 0 ajouté, 0 retiré, 1 modifié");
    await expect(proposal.getByText("Modifié : Lavabo → Lavabo sur colonne", { exact: true })).toBeVisible();
    await proposal.getByRole("button", "Accepter la révision proposée", { exact: true }).click();
    await expect(screen.getByText("Liste enregistrée · révision 2 · 23 postes", { exact: false })).toBeVisible();
    const corrected = table.getByRole("row", /^Lavabo sur colonne Plomberie/);
    expect(await corrected.getAttribute("id")).toBe(lavaboId);
    expect(await rows(`select r.revision, r.cause, r.item_count from public.takeoff_list_revisions r
      where r.project_id = '${existing}' order by r.revision`)).toEqual([
      { revision: 1, cause: "initial", item_count: 23 }, { revision: 2, cause: "proposal", item_count: 23 },
    ]);
    expect(await rows(`select id from public.takeoff_list_revisions where project_id = '${next}'`)).toEqual([]);
    expect(await rows(`select id from public.estimate_versions where project_id in ('${existing}', '${next}')`)).toEqual([]);

    // A member who is not an administrator neither opens the form nor reads the draft through the API.
    await querySql(`update public.tenant_memberships set role = 'engineer'
      where user_id = '${owner.userId}' and tenant_id = '${owner.tenantId}';`);
    try {
      const refused = await ui.request.get("/api/takeoff/item-templates/plomberie");
      expect(refused.status()).toBe(403);
      await app.open("/dashboard/admin/takeoff/item-template");
      await expect.poll(async () => new URL(await browser.url()).pathname).toBe("/dashboard/profile");
    } finally {
      await querySql(`update public.tenant_memberships set role = 'admin'
        where user_id = '${owner.userId}' and tenant_id = '${owner.tenantId}';`);
    }
    await recordEvidence(army, "GABARIT", { tenantId: owner.tenantId, existing, next, lavaboId });
  });
});
