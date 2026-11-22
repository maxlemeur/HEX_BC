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
    // A draft saved then discarded leaves nothing: the editor starts again from the published version, and the next
    // draft is saved without a reload, never refused as a stale one.
    await screen.getByRole("textbox", "Désignation du poste lavabo", { exact: true }).fill("Lavabo provisoire");
    await screen.getByRole("button", "Enregistrer le brouillon", { exact: true }).click();
    await expect(screen.getByText("Brouillon enregistré (révision 1).", { exact: false })).toBeVisible();
    await screen.getByRole("button", "Abandonner le brouillon", { exact: true }).click();
    await expect(screen.getByText("Aucun brouillon enregistré.", { exact: false })).toBeVisible();
    await expect(screen.getByRole("textbox", "Désignation du poste lavabo", { exact: true })).toHaveValue("Lavabo");
    expect(await rows(`select revision from public.takeoff_item_template_drafts where tenant_id = '${owner.tenantId}'`)).toEqual([]);
    await screen.getByRole("textbox", "Désignation du poste lavabo", { exact: true }).fill("Lavabo sur colonne");
    await expect(screen.getByText("Modifié : Lavabo → Lavabo sur colonne", { exact: true })).toBeVisible();
    // A second line changes its unit only, from metres to units.
    await screen.getByRole("textbox", "Unité du poste eu-pvc-40", { exact: true }).fill("u");
    await expect(screen.getByRole("button", "Publier la version 2", { exact: true })).toBeDisabled();
    await screen.getByRole("button", "Enregistrer le brouillon", { exact: true }).click();
    await expect(screen.getByText("Brouillon enregistré (révision 1).", { exact: false })).toBeVisible();
    expect(await rows(`select revision, definition::text like '%Lavabo sur colonne%' as corrected
      from public.takeoff_item_template_drafts where tenant_id = '${owner.tenantId}'`)).toEqual([{ revision: 1, corrected: true }]);
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
    await expect(proposal).toContainText("Révision proposée : 0 ajouté, 0 retiré, 2 modifiés");
    await expect(proposal.getByText("Modifié : Lavabo → Lavabo sur colonne", { exact: true })).toBeVisible();
    // A change of unit alone is told before it is accepted, its value before and after.
    await expect(proposal.getByText("Modifié : Évacuation eaux usées PVC Ø 40 mm", { exact: true })).toBeVisible();
    await expect(proposal.getByText("Unité : m → u", { exact: true })).toBeVisible();
    // Without an answer from the server, the form is released with a French message and the choice kept; the next
    // click sends the same gesture.
    const revisionsRoute = `**/api/affaires/${existing}/takeoff/item-list/revisions`;
    await browser.route(revisionsRoute, (route) => route.abort());
    await proposal.getByRole("button", "Accepter la révision proposée", { exact: true }).click();
    await expect(proposal.getByText("La réponse du serveur n’est pas arrivée. Vérifiez votre connexion puis réessayez : la "
      + "révision ne sera pas enregistrée deux fois.", { exact: true })).toBeVisible();
    await expect(proposal.getByRole("button", "Accepter la révision proposée", { exact: true })).toBeEnabled();
    await browser.unroute(revisionsRoute);
    expect(await rows(`select revision from public.takeoff_list_revisions where project_id = '${existing}'`)).toEqual([{ revision: 1 }]);
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

    // Retired, `lavabo` is never given again: « Lavabo » added to another family gets an identifier of its own.
    await app.open("/dashboard/admin/takeoff/item-template");
    await waitForHydration(browser);
    await screen.getByRole("button", "Retirer le poste lavabo", { exact: true }).click();
    await screen.getByRole("textbox", "Nouveau poste de Robinetterie", { exact: true }).fill("Lavabo");
    await screen.getByRole("button", "Ajouter à Robinetterie", { exact: true }).click();
    await expect(screen.getByRole("textbox", "Désignation du poste lavabo", { exact: true })).toHaveCount(0);
    await screen.getByRole("textbox", "Désignation du poste lavabo-2", { exact: true }).fill("Lavabo sur colonne");
    await screen.getByRole("textbox", "Unité du poste lavabo-2", { exact: true }).fill("u");
    await screen.getByRole("textbox", "Base de mesure du poste lavabo-2", { exact: true }).fill("Comptage des éléments distincts");
    await screen.getByRole("button", "Enregistrer le brouillon", { exact: true }).click();
    await expect(screen.getByText("Brouillon enregistré (révision 1).", { exact: false })).toBeVisible();

    // Another tab discards this draft and saves its own: « Publier » in this one is refused, nothing is published.
    const [draft] = await rows(`select token, definition from public.takeoff_item_template_drafts
      where tenant_id = '${owner.tenantId}' and template_key = 'plomberie'`);
    const base = "/api/takeoff/item-templates/plomberie/draft";
    expect((await ui.request.delete(base, { data: { expected_token: draft.token } })).status()).toBe(200);
    expect((await ui.request.put(base, { data: { expected_token: null, base_version: 2, definition: draft.definition } }))
      .status()).toBe(200);
    await screen.getByRole("button", "Publier la version 3", { exact: true }).click();
    await expect(screen.getByText("Le gabarit a changé depuis votre lecture : rechargez la page avant d’enregistrer.",
      { exact: true })).toBeVisible();
    expect(await rows(`select max(version) as version from public.takeoff_item_template_versions
      where tenant_id = '${owner.tenantId}'`)).toEqual([{ version: 2 }]);
    await browser.reload();
    await waitForHydration(browser);
    await screen.getByRole("button", "Publier la version 3", { exact: true }).click();
    await expect(screen.getByText("Version publiée : 3.", { exact: false })).toBeVisible();

    // The affaire is asked whether the new line is the item it had, with what tells the two apart, never told.
    table = await openList(ui, existing);
    const pairing = "« Lavabo sur colonne » (Plomberie / Appareils sanitaires · Gabarit, version 2) devient « Lavabo sur "
      + "colonne » (Plomberie / Robinetterie · Gabarit, version 3)";
    await expect(screen.getByRole("checkbox", pairing, { exact: true })).not.toBeChecked();
    const listed = await ui.request.get(`/api/affaires/${existing}/takeoff/item-list`);
    const { proposal: offered } = (await listed.json() as { data: { proposal: {
      digest: string; continuities: Array<{ previousItemId: string; nextItemId: string }> } } }).data;
    expect(offered.continuities).toEqual([{ previousItemId: lavaboId!.replace(/^poste-/, ""), nextItemId: expect.any(String),
      ambiguous: false }]);
    const pair = { previous_item_id: offered.continuities[0].previousItemId, next_item_id: offered.continuities[0].nextItemId };
    const acceptance = randomUUID();
    const accept = (continuities: unknown[]) => ui.request.post(`/api/affaires/${existing}/takeoff/item-list/revisions`, {
      data: { expected_revision: 2, proposal_digest: offered.digest, intent_key: acceptance, continuities },
      failOnStatusCode: false });
    const accepted = await accept([pair]);
    expect(accepted.status()).toBe(200);
    // The same key with another selection is another gesture: refused, never the first one's receipt.
    const otherSelection = await accept([]);
    expect(otherSelection.status()).toBe(409);
    expect((await otherSelection.json() as { error: { code: string } }).error.code).toBe("TAKEOFF_ITEM_LIST_INTENT_CONFLICT");
    const replayed = await accept([pair]);
    expect((await replayed.json() as { data: unknown }).data)
      .toEqual({ ...(await accepted.json() as { data: object }).data, replayed: true });
    table = await openList(ui, existing);
    await expect(screen.getByText("Liste enregistrée · révision 3 · 23 postes", { exact: false })).toBeVisible();
    expect(await table.getByRole("row", /^Lavabo sur colonne Plomberie \/ Robinetterie/).getAttribute("id")).toBe(lavaboId);

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

  test("AJOUT un poste s’ajoute à la main avant, pendant et après une analyse, puis après un premier envoi", options, async ({ ui }) => {
    const { app, browser, screen, army } = ui;
    await app.open("/dashboard/affaires");
    const owner = await signUpDedicatedOwner(browser, app.baseUrl!, army.runPrefix, { tag: "AJOUT" });
    const projectId = await affaire(owner.tenantId, owner.userId, `${army.runPrefix} ajouts`);
    const add = async (label: string, recorded: string) => {
      await app.open(`/dashboard/affaires/${projectId}/takeoff?postes=liste`);
      await waitForHydration(browser);
      await screen.getByText("Ajouter un poste", { exact: true }).click();
      const form = screen.getByRole("form", "Ajouter un poste", { exact: true });
      await form.getByRole("textbox", "Désignation", { exact: true }).fill(label);
      await form.getByRole("textbox", "Unité (vide : à préciser)", { exact: true }).fill("u");
      await form.getByRole("button", "Ajouter le poste", { exact: true }).click();
      await expect(screen.getByText(recorded, { exact: false })).toBeVisible();
    };

    // Before any analysis: the first list is recorded with the item. Its first click gets no answer from the server: the
    // form is released with a French message and what was typed stays; the next click adds it, once.
    await app.open(`/dashboard/affaires/${projectId}/takeoff?postes=liste`);
    await waitForHydration(browser);
    await screen.getByText("Ajouter un poste", { exact: true }).click();
    const form = screen.getByRole("form", "Ajouter un poste", { exact: true });
    await form.getByRole("textbox", "Désignation", { exact: true }).fill("Robinet de puisage");
    await form.getByRole("textbox", "Unité (vide : à préciser)", { exact: true }).fill("u");
    const additions = `**/api/affaires/${projectId}/takeoff/item-list/items`;
    await browser.route(additions, (route) => route.abort());
    await form.getByRole("button", "Ajouter le poste", { exact: true }).click();
    await expect(form.getByText("La réponse du serveur n’est pas arrivée. Vérifiez votre connexion puis réessayez : le poste ne "
      + "sera pas ajouté deux fois.", { exact: true })).toBeVisible();
    await expect(form.getByRole("button", "Ajouter le poste", { exact: true })).toBeEnabled();
    await expect(form.getByRole("textbox", "Désignation", { exact: true })).toHaveValue("Robinet de puisage");
    await browser.unroute(additions);
    expect(await rows(`select revision from public.takeoff_list_revisions where project_id = '${projectId}'`)).toEqual([]);
    await form.getByRole("button", "Ajouter le poste", { exact: true }).click();
    await expect(screen.getByText("Liste enregistrée · révision 2 · 24 postes", { exact: false })).toBeVisible();
    // During an analysis: a job of the affaire's estimate is running (fixture rows, no worker, no model).
    const versionId = randomUUID();
    const jobId = randomUUID();
    await querySql(`insert into public.estimate_versions (id, project_id, version_number) values ('${versionId}', '${projectId}', 1);
      insert into public.takeoff_jobs (id, estimate_version_id, tenant_id, created_by, level, status, source_file_name)
      values ('${jobId}', '${versionId}', '${owner.tenantId}', '${owner.userId}', 'B', 'processing', 'plan-fictif-AJOUT.pdf');`);
    await add("Clapet anti-retour", "Liste enregistrée · révision 3 · 25 postes");
    // After it: the job completed.
    await querySql(`update public.takeoff_jobs set status = 'completed', completed_at = now() where id = '${jobId}';`);
    await add("Purgeur automatique", "Liste enregistrée · révision 4 · 26 postes");
    // After a first send: the job's send receipt exists (written as a fixture, without the send's own checks).
    const digest = "0".repeat(64);
    await querySql(`set session_replication_role = replica;
      insert into public.takeoff_send_receipts (tenant_id, project_id, job_id, request_id, format_version, actor_id,
        payload_hash, preview_fingerprint, destination, target_version_id, write_plan, result)
      values ('${owner.tenantId}', '${projectId}', '${jobId}', '${randomUUID()}', 1, '${owner.userId}', '${digest}',
        '${digest}', '{}', '${versionId}', '{}', '{}');`);
    await add("Disconnecteur", "Liste enregistrée · révision 5 · 27 postes");

    expect(await rows(`select revision, cause, item_count from public.takeoff_list_revisions
      where project_id = '${projectId}' order by revision`)).toEqual([
      { revision: 1, cause: "initial", item_count: 23 }, { revision: 2, cause: "item_added", item_count: 24 },
      { revision: 3, cause: "item_added", item_count: 25 }, { revision: 4, cause: "item_added", item_count: 26 },
      { revision: 5, cause: "item_added", item_count: 27 },
    ]);
    // Each item is the member's, without quantity, filed under « Postes ajoutés ».
    expect(await rows(`select e.label, e.reference_quantity, e.origin ->> 'addedBy' as added_by, e.sections -> 0 ->> 'title' as section
      from public.takeoff_list_revision_entries e join public.takeoff_list_revisions r on r.id = e.revision_id
      where r.project_id = '${projectId}' and r.revision = 5 and e.origin ->> 'kind' = 'manual' order by e.position`)).toEqual(
      ["Robinet de puisage", "Clapet anti-retour", "Purgeur automatique", "Disconnecteur"].map((label) =>
        ({ label, reference_quantity: null, added_by: owner.userId, section: "Postes ajoutés" })));
    // The job and its receipt are as they were; no launch request, and the second measuring order stays inactive.
    expect(await rows(`select j.status, (select count(*)::int from public.takeoff_send_receipts r where r.job_id = j.id) as receipts
      from public.takeoff_jobs j where j.id = '${jobId}'`)).toEqual([{ status: "completed", receipts: 1 }]);
    expect(await rows(`select (select count(*)::int from public.takeoff_launch_requests where project_id = '${projectId}') as launches,
      (select count(*)::int from private.takeoff_item_list_order_activation) as activations`))
      .toEqual([{ launches: 0, activations: 0 }]);
    await recordEvidence(army, "AJOUT", { tenantId: owner.tenantId, projectId, jobId, versionId });
  });
});
