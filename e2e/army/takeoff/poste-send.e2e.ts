import { apiRequest, readEstimate, recordEvidence } from "../critical/fixtures";
import { waitForHydration } from "../critical/hydration-support";
import { querySql } from "../local/calculation-gate-support";
import { signUpDedicatedOwner } from "../local/dedicated-owner";
import {
  acceptOnPlan, countOwnedReceipts, fictionalSendPlanPdf, holdDraftElsewhere, readOwnedLines, readOwnedParts, readOwnedVersions, releaseDraftElsewhere,
  seedItemSendAffaire, deferEditorDepartureReleases, deliverEditorDepartureReleases,
} from "./poste-send-support";
import { describe, expect, nativeTest as test } from "./native-ui";

// Lot 4, the send of one plan's retained items to an engine 3 draft (« Envoyer ce plan au devis »), on the owned stack:
// affaires whose list was read on several plans and published (poste-send-support.ts), the measured items accepted by
// the table's own command. No model is called, no e-mail is sent. Fictional values only.
//
// What these journeys cannot reach on the test application: the reading of a plan against the list (no model runtime,
// nothing activated), so the answers are seeded as the worker publishes them; a DPGF line as a target (it needs a
// confirmed import with its raw-row lineage; the planner's and the writer's tests cover it), so the DPGF case is the one
// of a list whose import has no line in the destination; « Par bâtiment », « Non réparti », the mapping rules and
// « Remplacer », which the planner's and the writer's tests cover with the same screen.

const options = { session: "army", trace: "off" as const, tags: ["critical", "local"], timeout: 360_000 };
const sha256 = async (bytes: Buffer) => (await import("node:crypto")).createHash("sha256").update(bytes).digest("hex");

describe("Envoi d’un plan au devis, poste par poste", () => {
  test("POSTE-ENVOI01 annule sans rien écrire, envoie A puis B sur une ligne de cinq, protège une saisie, une page et le bail", options,
    async ({ ui }) => {
      const { app, screen, army } = ui;
      // Another member of the tenant, who will hold the draft in the editor; then the member who sends (the session kept).
      const other = await signUpDedicatedOwner(ui.browser, app.baseUrl!, army.runPrefix, { tag: "PSENDB", calcPolicy: "absent" });
      const owner = await signUpDedicatedOwner(ui.browser, app.baseUrl!, army.runPrefix, { tag: "PSEND", calcPolicy: "absent" });
      await querySql(`insert into public.tenant_memberships (tenant_id, user_id, role, is_default)
        values ('${owner.tenantId}', '${other.userId}', 'engineer', false);
        update public.profiles set full_name = 'Membre Fictif B' where id = '${other.userId}';`);
      // A: 3 washbasins on page 2; B: 2 more; C, a copy of A, a WC on the same page 2; D, another copy of A, its washbasins.
      const seeded = await seedItemSendAffaire(owner, { name: `${army.runPrefix}-POSTE-ENVOI`, labels: ["Lavabo", "WC"], plans: [
        { name: "plan-a.pdf", measures: { Lavabo: { quantity: 3, page: 2 } } },
        { name: "plan-b.pdf", measures: { Lavabo: { quantity: 2, page: 2 } } },
        { name: "plan-c.pdf", measures: { WC: { quantity: 1, page: 2 } }, copyOf: "plan-a.pdf" },
        { name: "plan-d.pdf", measures: { Lavabo: { quantity: 3, page: 2 } }, copyOf: "plan-a.pdf" },
      ] });
      const [planA, planB, planC, planD] = seeded.plans;
      for (const [plan, label] of [[planA, "Lavabo"], [planB, "Lavabo"], [planC, "WC"], [planD, "Lavabo"]] as const) {
        await acceptOnPlan(owner, seeded.projectId, plan, [seeded.items[label]]);
      }
      const dialog = () => screen.getByRole("dialog");
      const entry = (name: string) => screen.getByRole("button", `Envoyer ce plan au devis : « ${name} »`, { exact: true });

      // 1. The preview of plan A, without an estimate: the first draft it would create, the line, the WC not found. Annuler.
      await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff`);
      await waitForHydration(ui.browser);
      await entry("plan-a.pdf").click();
      await expect(dialog()).toContainText("Envoyer le plan « plan-a.pdf » au devis");
      await expect(dialog().getByTestId("item-send-destination")).toContainText("la confirmation crée son premier brouillon (V1)");
      const lineA = dialog().getByTestId(`item-send-line-${seeded.items.Lavabo}-together`);
      await expect(lineA).toContainText("À créer");
      await expect(lineA).toContainText("3 u");
      await expect(dialog().getByTestId(`item-send-not-sent-${seeded.items.WC}`)).toContainText("Non trouvé sur ce plan");
      const shots: string[] = [await ui.app.screenshot("poste-envoi-apercu-sans-devis")];
      await dialog().getByRole("button", "Annuler", { exact: true }).click();
      await expect(screen.getByRole("dialog")).toHaveCount(0);
      expect([await readOwnedVersions(seeded.projectId), await readOwnedLines(seeded.projectId), await countOwnedReceipts(seeded.projectId)])
        .toEqual([[], [], 0]);

      // 2. Confirmed with a double click: one draft, one section, one line of 3, one receipt; the editor on that line.
      await entry("plan-a.pdf").click();
      const createAndSend = dialog().getByRole("button", "Créer le devis et y envoyer « plan-a.pdf »", { exact: true });
      await expect(createAndSend).toBeEnabled();
      // Every confirmation the screen posts is counted in the page: a double click posts one.
      await ui.browser.evaluate(() => {
        const scope = window as typeof window & { __itemSendConfirms?: number };
        scope.__itemSendConfirms = 0;
        const original = window.fetch.bind(window);
        window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.includes("/item-send/confirm")) scope.__itemSendConfirms = (scope.__itemSendConfirms ?? 0) + 1;
          return original(input, init);
        };
        return true;
      });
      await createAndSend.dblclick();
      await expect(ui.browser).toHaveURL(/\/dashboard\/estimates\/[0-9a-f-]{36}\/edit\?focusItemId=[0-9a-f-]{36}$/, { timeout: 60_000 });
      expect(await ui.browser.evaluate(() => (window as typeof window & { __itemSendConfirms?: number }).__itemSendConfirms ?? null)).toBe(1);
      const [v1] = await readOwnedVersions(seeded.projectId);
      expect([v1.version_number, v1.status, v1.calc_engine_version]).toEqual([1, "draft", 3]);
      const afterA = await readOwnedLines(seeded.projectId);
      const lavabo = afterA.find((line) => line.item_type === "line")!;
      // The section of the list, and under it the line (positions count within a parent).
      expect(afterA.map((line) => [line.item_type, line.title, line.item_type === "line" ? line.quantity : null]).sort())
        .toEqual([["line", "Lavabo", 3], ["section", "Appareils sanitaires", null]]);
      expect(lavabo.parent_id).toBe(afterA.find((line) => line.item_type === "section")!.id);
      expect(await countOwnedReceipts(seeded.projectId)).toBe(1);
      // The focus is on the real line: the address names it, the editor shows it highlighted.
      await expect(ui.browser).toHaveURL(new RegExp(`focusItemId=${lavabo.id}$`));
      const focused = ui.browser.locator(`[data-estimate-item-id="${lavabo.id}"]`);
      await expect(focused).toBeVisible({ timeout: 60_000 });
      await expect(focused).toHaveAttribute("data-highlighted", "true");
      shots.push(await ui.app.screenshot("poste-envoi-succes-editeur"));

      // The estimator prices the line through the editor's save (its own lease): a send never changes these entries. The
      // editor page releases its lease when it is left.
      await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff`);
      await waitForHydration(ui.browser);
      await expect.poll(async () => Number((await querySql(`select count(*) from public.draft_locks where version_id = '${v1.id}';`)).at(-1)),
        { timeout: 30_000 }).toBe(0);
      const editorLock = `/api/estimates/${v1.id}/lock`;
      const editorSave = async (fields: Record<string, unknown>) => {
        const lock = await apiRequest(ui.browser, "POST", editorLock);
        expect([200, 201], JSON.stringify(lock.body)).toContain(lock.status);
        // An engine 3 line is saved as the editor saves it: one batch, on the version it read.
        const read = await readEstimate(ui.browser, v1.id);
        const saved = await apiRequest(ui.browser, "POST", `/api/estimates/${v1.id}/batch`, { operation_key: crypto.randomUUID(),
          operations: [{ op: "update", id: lavabo.id, data: fields }] }, { "if-match": read.version.updated_at });
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
        const released = await apiRequest(ui.browser, "DELETE", editorLock);
        expect(released.status, JSON.stringify(released.body)).toBe(200);
      };
      await editorSave({ unit_price_ht_cents: 4200, tax_rate_bp: 1000, k_fo: 1.15, h_mo_per_unit: 0.75, k_mo: 1.1, pricing_status: "priced" });
      const inputsBefore = (await readOwnedLines(seeded.projectId)).find((line) => line.id === lavabo.id)!.inputs;

      // 3. The takeoff page shows plan A sent; its table is closed to the bulk gestures.
      await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff?postePlan=${planA.fileId}`);
      await waitForHydration(ui.browser);
      await expect(ui.locator('[data-testid="poste-plan-sent"]')).toContainText("Plan « plan-a.pdf » envoyé au devis");
      await expect(entry("plan-a.pdf")).toHaveCount(0);

      // 4. Plan B, from the table in its scope: the line of 3 becomes 5. Another member holds the draft: nothing written.
      await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff?postePlan=${planB.fileId}`);
      await waitForHydration(ui.browser);
      await ui.locator('[data-testid="poste-plan-send"]').getByRole("button", "Envoyer ce plan au devis", { exact: true }).click();
      const lineB = dialog().getByTestId(`item-send-line-${seeded.items.Lavabo}-together`);
      await expect(lineB).toContainText("3 u");
      await expect(lineB).toContainText("5 u");
      const sendB = dialog().getByRole("button", "Envoyer « plan-b.pdf » dans V1 · brouillon", { exact: true });
      await holdDraftElsewhere({ tenantId: owner.tenantId, versionId: v1.id, userId: other.userId });
      await sendB.click();
      await expect(dialog().getByTestId("item-send-error")).toContainText("La version cible est verrouillée par Membre Fictif B.");
      await expect(dialog().getByTestId("item-send-error")).toContainText("Rien n’a été écrit.");
      shots.push(await ui.app.screenshot("poste-envoi-bail-tenu"));
      expect([(await readOwnedLines(seeded.projectId)).find((line) => line.id === lavabo.id)!.quantity, await countOwnedReceipts(seeded.projectId)])
        .toEqual([3, 1]);
      await releaseDraftElsewhere(v1.id, other.userId);

      // The same account has the editor open in another tab. The send must leave its lease and the estimate intact.
      const takeoffTab = ui.browser.tabs().find((tab) => tab.isActive())!;
      const editorTab = await ui.browser.newTab();
      const ownerLease = () => querySql(`select id from public.draft_locks where version_id = '${v1.id}' and user_id = '${owner.userId}';`);
      try {
        await app.open(`/dashboard/estimates/${v1.id}/edit`);
        await expect.poll(async () => (await ownerLease()).length).toBe(1);
        const held = await ownerLease();
        await takeoffTab.activate();
        await sendB.click();
        await expect(dialog().getByTestId("item-send-error")).toContainText("La version cible est verrouillée dans un autre de vos onglets.");
        expect(await ownerLease()).toEqual(held);
        expect(await countOwnedReceipts(seeded.projectId)).toBe(1);
      } finally {
        await editorTab.activate();
        await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff`);
        await editorTab.close();
      }
      await expect.poll(async () => (await ownerLease()).length).toBe(0);

      // The line changed in the editor between the preview and the confirmation, its quantity unchanged (a description):
      // the plan shown is no longer the plan the server computes. Refused (409), nothing written, the preview read again,
      // and the screen left no lease behind.
      const leases = async () => Number((await querySql(`select count(*) from public.draft_locks where version_id = '${v1.id}';`)).at(-1));
      await editorSave({ description: "Repère fictif" });
      await sendB.click();
      await expect(dialog().getByTestId("item-send-notice")).toContainText("ont changé depuis l’aperçu");
      await expect(dialog().getByTestId("item-send-notice")).toContainText("Rien n’a été écrit.");
      await expect(sendB).toBeEnabled({ timeout: 30_000 });
      shots.push(await ui.app.screenshot("poste-envoi-apercu-perime-409"));
      expect([(await readOwnedLines(seeded.projectId)).find((line) => line.id === lavabo.id)!.quantity, await countOwnedReceipts(seeded.projectId),
        await leases()]).toEqual([3, 1, 0]);

      // 5. The line typed by hand in the editor between the preview and the confirmation: refused, the preview read again,
      // a choice asked, none preselected, nothing written until it is made.
      await editorSave({ quantity: 4 });
      await sendB.click();
      await expect(dialog().getByTestId("item-send-notice")).toContainText("Rien n’a été écrit.");
      await expect(dialog().getByTestId("item-send-notice")).toContainText("un choix est à faire");
      const point = dialog().getByTestId("item-send-point-entered_quantity");
      await expect(point).toContainText("La quantité de cette ligne a été saisie à la main");
      await expect(point.getByRole("radio", { checked: true })).toHaveCount(0);
      await expect(sendB).toBeDisabled();
      shots.push(await ui.app.screenshot("poste-envoi-apercu-perime-choix"));
      expect([await countOwnedReceipts(seeded.projectId), await leases()]).toEqual([1, 0]);
      await point.getByRole("radio", /^Retenir le métré/).check();
      await expect(lineB).toContainText("4 u");
      await expect(lineB).toContainText("5 u");
      await sendB.click();
      await expect(ui.browser).toHaveURL(new RegExp(`/dashboard/estimates/${v1.id}/edit\\?focusItemId=${lavabo.id}$`), { timeout: 60_000 });
      const afterB = (await readOwnedLines(seeded.projectId)).find((line) => line.id === lavabo.id)!;
      expect(afterB.quantity).toBe(5);
      // Supplier price, entered unit price, hours per unit, VAT, coefficients, status: as the estimator left them.
      const moved = Object.keys({ ...inputsBefore, ...afterB.inputs })
        .filter((key) => JSON.stringify(afterB.inputs[key]) !== JSON.stringify(inputsBefore[key]));
      expect(moved, JSON.stringify({ before: inputsBefore, after: afterB.inputs })).toEqual([]);
      await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff`);
      await waitForHydration(ui.browser);
      await screen.getByRole("button", "Redistribuer les apports de « plan-b.pdf »", { exact: true }).click();
      await dialog().getByLabel("Nouveau découpage").selectOption({ value: "by_level" });
      await dialog().getByRole("button", "Prévisualiser la redistribution").click();
      await expect(dialog().getByRole("region", "Déplacements des apports")).toContainText("Lavabo");
      await expect(dialog()).toContainText("ligne modifiée");
      await expect(dialog().getByRole("button", "Confirmer la redistribution")).toBeDisabled();
      shots.push(await ui.app.screenshot("poste-redistribution-prix-protege"));
      await dialog().getByRole("button", "Annuler", { exact: true }).click();
      expect((await readOwnedLines(seeded.projectId)).find((line) => line.id === lavabo.id)?.inputs).toEqual(inputsBefore);
      expect(inputsBefore).toMatchObject({ unit_price_ht_cents: 4200, tax_rate_bp: 1000, k_fo: 1.15, h_mo_per_unit: 0.75, k_mo: 1.1 });
      // One item, five, from A and B, each part live with its plan.
      const parts = await readOwnedParts(seeded.projectId);
      expect(parts.filter(({ state }) => state === "live").map(({ job_id, quantity, estimate_item_id }) => [job_id, quantity, estimate_item_id])
        .sort()).toEqual([[planA.jobId, 3, lavabo.id], [planB.jobId, 2, lavabo.id]].sort());

      // 6. Plan C, a copy of A: its page 2 is already in the estimate. « Garder les deux » waits for its reason, then sends.
      await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff`);
      await waitForHydration(ui.browser);
      await entry("plan-c.pdf").click();
      const page2 = dialog().getByTestId("item-send-page-2");
      await expect(page2).toContainText("Page 2 : déjà au devis par une autre analyse");
      await expect(page2).toContainText("« Lavabo » (5)");
      const sendC = dialog().getByRole("button", "Envoyer « plan-c.pdf » dans V1 · brouillon", { exact: true });
      await expect(sendC).toBeDisabled();
      await page2.getByRole("radio", /^Garder les deux/).check();
      await expect(page2.getByTestId("item-send-keep-both-reason-missing")).toBeVisible();
      await expect(sendC).toBeDisabled();
      await page2.getByRole("radio", "Périmètre complémentaire", { exact: true }).check();
      await expect(sendC).toBeDisabled();
      await page2.getByLabel("Ce que ce plan ajoute (obligatoire)", { exact: true }).fill("Sanitaires du local technique, hors lot A");
      await expect(sendC).toBeEnabled({ timeout: 30_000 });
      shots.push(await ui.app.screenshot("poste-envoi-garder-les-deux"));
      await sendC.click();
      await expect(ui.browser).toHaveURL(new RegExp(`/dashboard/estimates/${v1.id}/edit\\?focusItemId=`), { timeout: 60_000 });
      const afterC = await readOwnedLines(seeded.projectId);
      expect(afterC.filter((line) => line.item_type === "line").map((line) => [line.title, line.quantity]))
        .toEqual([["Lavabo", 5], ["WC", 1]]);

      // 7. Plan D, another copy of A: « Garder les deux » would count page 2 twice on the washbasins' line. Refused on screen
      // and by the route; nothing written.
      await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff`);
      await waitForHydration(ui.browser);
      await entry("plan-d.pdf").click();
      const pageD = dialog().getByTestId("item-send-page-2");
      await pageD.getByRole("radio", /^Garder les deux/).check();
      await pageD.getByRole("radio", "Autre zone de la même feuille", { exact: true }).check();
      await expect(pageD).toContainText("elle compterait deux fois", { timeout: 30_000 });
      await expect(dialog().getByRole("button", "Envoyer « plan-d.pdf » dans V1 · brouillon", { exact: true })).toBeDisabled();
      shots.push(await ui.app.screenshot("poste-envoi-double-apport"));
      const doubled = await apiRequest<{ error: { message: string } }>(ui.browser, "POST", `/api/takeoff/jobs/${planD.jobId}/item-send/confirm`, {
        request_id: crypto.randomUUID(), plan_digest: "0".repeat(64), destination: { kind: "existing_draft", version_id: v1.id },
        page_decisions: [{ page: 2, decision: "keep_both", reason_code: "other_zone", note: null }] });
      // The plan the member would confirm is no longer confirmable: refused as a stale preview, nothing written.
      expect(doubled.status).toBe(409);
      expect(doubled.body.error.message).toContain("elle compterait deux fois");
      expect(doubled.body.error.message).toContain("Rien n’a été écrit.");
      expect([(await readOwnedLines(seeded.projectId)).find((line) => line.id === lavabo.id)!.quantity, await countOwnedReceipts(seeded.projectId)])
        .toEqual([5, 3]);
      await dialog().getByRole("button", "Annuler", { exact: true }).click();

      // 8. A member who does not write the affaire any more sees no entry, and the routes refuse.
      await querySql(`update public.tenant_memberships set role = 'viewer' where user_id = '${owner.userId}' and tenant_id = '${owner.tenantId}';`);
      await ui.browser.reload();
      await waitForHydration(ui.browser);
      await expect(screen.getByRole("table", "Postes du métré", { exact: true })).toBeVisible();
      await expect(entry("plan-d.pdf")).toHaveCount(0);
      // Nor in plan D's table, where a member who writes the affaire has it.
      await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff?postePlan=${planD.fileId}`);
      await waitForHydration(ui.browser);
      await expect(ui.locator(`[data-testid="poste-${seeded.items.Lavabo}"]`)).toBeVisible();
      await expect(screen.getByRole("button", "Envoyer ce plan au devis", { exact: true })).toHaveCount(0);
      const readOnly = await apiRequest<{ data: { plan: unknown; blocked: { reason: string } } }>(ui.browser, "POST",
        `/api/takeoff/jobs/${planD.jobId}/item-send/preview`, {});
      expect([readOnly.status, readOnly.body.data.plan, readOnly.body.data.blocked.reason]).toEqual([200, null, "read_only"]);
      const refused = await apiRequest<{ error: { message: string } }>(ui.browser, "POST", `/api/takeoff/jobs/${planD.jobId}/item-send/confirm`, {
        request_id: crypto.randomUUID(), plan_digest: "0".repeat(64) });
      expect(refused.status).toBe(403);
      expect(refused.body.error.message).toContain("Rien n’a été écrit.");
      expect(await countOwnedReceipts(seeded.projectId)).toBe(3);
      await recordEvidence(army, "POSTE-ENVOI01", { projectId: seeded.projectId, parts: await readOwnedParts(seeded.projectId), screenshots: shots });
    });

  test("POSTE-ENVOI02 « Par niveau » donne une ligne de 3 au rez-de-chaussée et une de 2 à l’étage", options, async ({ ui }) => {
    const { app, screen, army } = ui;
    const owner = await signUpDedicatedOwner(ui.browser, app.baseUrl!, army.runPrefix, { tag: "PSENDN", calcPolicy: "absent" });
    const pdfs = { a: await fictionalSendPlanPdf(`${army.runPrefix} plan A`), b: await fictionalSendPlanPdf(`${army.runPrefix} plan B`) };
    const seeded = await seedItemSendAffaire(owner, { name: `${army.runPrefix}-POSTE-NIVEAU`, labels: ["Lavabo"], plans: [
      { name: "plan-a.pdf", measures: { Lavabo: { quantity: 3, page: 2 } }, pdf: pdfs.a },
      { name: "plan-b.pdf", measures: { Lavabo: { quantity: 2, page: 2 } }, pdf: pdfs.b },
    ] });
    const [planA, planB] = seeded.plans;
    for (const plan of [planA, planB]) await acceptOnPlan(owner, seeded.projectId, plan, [seeded.items.Lavabo]);
    await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff`);
    await waitForHydration(ui.browser);
    // Each plan's level, set by the member on its bytes, as « Bâtiment et niveau » saves it.
    for (const [plan, bytes, level] of [[planA, pdfs.a, "RDC"], [planB, pdfs.b, "R+1"]] as const) {
      const saved = await apiRequest(ui.browser, "PUT", `/api/takeoff/plan-sets/${seeded.planSetId}/files/${plan.fileId}/location`, {
        content_hash: await sha256(bytes), expected_revision: 0, building: { choice: "value", value: "A" }, level: { choice: "value", value: level } });
      expect(saved.status).toBe(200);
    }
    const dialog = () => screen.getByRole("dialog");
    const entry = (name: string) => screen.getByRole("button", `Envoyer ce plan au devis : « ${name} »`, { exact: true });

    await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff`);
    await waitForHydration(ui.browser);
    await entry("plan-a.pdf").click();
    await dialog().getByRole("radio", "Par niveau", { exact: true }).check();
    await expect(dialog().getByRole("table", "Lignes du devis après l’envoi", { exact: true })).toContainText("RDC", { timeout: 30_000 });
    const shot = await ui.app.screenshot("poste-envoi-par-niveau");
    await dialog().getByRole("button", "Créer le devis et y envoyer « plan-a.pdf »", { exact: true }).click();
    await expect(ui.browser).toHaveURL(/\/dashboard\/estimates\/[0-9a-f-]{36}\/edit\?focusItemId=/, { timeout: 60_000 });

    await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff`);
    await waitForHydration(ui.browser);
    await entry("plan-b.pdf").click();
    // The draft already holds this item by level: the same breakdown is proposed, never mixed.
    await expect(dialog().getByRole("radio", "Par niveau", { exact: true })).toBeChecked();
    await expect(dialog().getByRole("table", "Lignes du devis après l’envoi", { exact: true })).toContainText("R+1");
    // Hold the editor's real acquisition until after full navigation. A release sent by
    // the departing document then finds no lease; the delayed POST still carries its identity.
    const lockUrl = `/api/estimates/${(await readOwnedVersions(seeded.projectId))[0].id}/lock`;
    const lockPath = `**${lockUrl}`;
    const forwardEditorPost = Promise.withResolvers<void>();
    let editorSession: string | undefined;
    let takeoffSession: string | undefined;
    const handover: string[] = [];
    let editorPostStatus = 0;
    await ui.browser.route(lockPath, async (route) => {
      const session = route.request.headers["x-estimate-draft-lock-session-id"];
      if (editorPostStatus === 201) {
        if (route.request.method === "PATCH") takeoffSession = session;
        const page = session === editorSession ? "editor" : session && session === takeoffSession ? "takeoff" : "unknown";
        handover.push(`${route.request.method} ${page}`);
      }
      if (route.request.method !== "POST" || !route.request.headers.referer?.includes("/edit?")) {
        await route.fallback();
        return;
      }
      editorSession = session;
      await forwardEditorPost.promise;
      const response = await route.fetch();
      editorPostStatus = response.status;
      await route.abort();
    });
    await dialog().getByRole("button", /^Envoyer « plan-b\.pdf » dans /).click();
    await expect(ui.browser).toHaveURL(/\/dashboard\/estimates\/[0-9a-f-]{36}\/edit\?focusItemId=/, { timeout: 60_000 });
    // Each level has its section (positions count within a parent): 3 under the ground floor's, 2 under the first floor's.
    const rows = await readOwnedLines(seeded.projectId);
    const lines = rows.filter((line) => line.item_type === "line");
    const levelOf = (line: (typeof rows)[number]) => {
      const section = rows.find((candidate) => candidate.id === line.parent_id)?.title ?? "";
      return section.includes("R+1") ? "R+1" : section.includes("RDC") ? "RDC" : section;
    };
    expect(lines.map((line) => [levelOf(line), line.title, line.quantity]).sort())
      .toEqual([["R+1", "Lavabo", 2], ["RDC", "Lavabo", 3]]);
    const parts = await readOwnedParts(seeded.projectId);
    expect(parts.map(({ job_id, quantity, state }) => [job_id, quantity, state]).sort())
      .toEqual([[planA.jobId, 3, "live"], [planB.jobId, 2, "live"]].sort());
    await expect.poll(() => Boolean(editorSession)).toBe(true);
    await deferEditorDepartureReleases(ui.browser, lockUrl);
    await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff`);
    await waitForHydration(ui.browser);
    await screen.getByRole("button", "Redistribuer les apports de « plan-b.pdf »", { exact: true }).click();
    await dialog().getByRole("button", "Prévisualiser la redistribution").click();
    await expect(dialog().getByRole("region", "Déplacements des apports")).toContainText("Ensemble · 5 u");
    const releases = await deliverEditorDepartureReleases(ui.browser, lockUrl, editorSession!);
    expect(releases.length).toBeGreaterThan(0);
    for (const release of releases) expect(release).toEqual({ status: 200, released: false });
    forwardEditorPost.resolve();
    await expect.poll(() => editorPostStatus).toBe(201);
    await dialog().getByRole("button", "Confirmer la redistribution").click();
    await expect(dialog()).toContainText("Redistribution enregistrée.");
    await expect.poll(() => handover).toEqual(["PATCH takeoff", "DELETE editor", "POST takeoff", "DELETE takeoff"]);
    await ui.browser.unroute(lockPath);
    // A correction after the send is authoritative. Neither PDF proposes a building.
    for (const [plan, bytes, level] of [[planA, pdfs.a, "RDC"], [planB, pdfs.b, "Combles"]] as const) {
      const saved = await apiRequest(ui.browser, "PUT", `/api/takeoff/plan-sets/${seeded.planSetId}/files/${plan.fileId}/location`, {
        content_hash: await sha256(bytes), expected_revision: 1, building: { choice: "reading", value: null }, level: { choice: "value", value: level } });
      expect(saved.status).toBe(200);
    }
    await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff`);
    await waitForHydration(ui.browser);
    await screen.getByRole("button", "Redistribuer les apports de « plan-b.pdf »", { exact: true }).click();
    await dialog().getByLabel("Nouveau découpage").selectOption({ value: "by_level" });
    await dialog().getByRole("button", "Prévisualiser la redistribution").click();
    await expect(dialog().getByRole("region", "Déplacements des apports")).toContainText("Lavabo · Ensemble · 5 u");
    await expect(dialog().getByRole("region", "Déplacements des apports")).toContainText("Combles · 2 u · ligne à créer");
    await expect(dialog().getByRole("region", "Déplacements des apports")).toContainText("RDC · 3 u · ligne à créer");
    const afterReload = await ui.app.screenshot("poste-redistribution-apres-rechargement");
    const combined = (await readOwnedLines(seeded.projectId)).filter((line) => line.item_type === "line");
    expect(combined.map((line) => [line.title, line.quantity])).toEqual([["Lavabo", 5]]);
    expect(combined[0].inputs.unit_price_ht_cents).toBe(lines[0].inputs.unit_price_ht_cents);
    await recordEvidence(army, "POSTE-ENVOI02", { projectId: seeded.projectId, lines, combined, handover, screenshots: [shot, afterReload] });
  });

  test("POSTE-ENVOI03 une liste tirée du DPGF sans ligne du DPGF au devis renvoie à l’import confirmé et n’importe rien", options,
    async ({ ui }) => {
      const { app, screen, army } = ui;
      const owner = await signUpDedicatedOwner(ui.browser, app.baseUrl!, army.runPrefix, { tag: "PSENDD", calcPolicy: "absent" });
      const seeded = await seedItemSendAffaire(owner, { name: `${army.runPrefix}-POSTE-DPGF`, labels: ["Lavabo"], dpgfLabels: ["Lavabo"],
        plans: [{ name: "plan-a.pdf", measures: { Lavabo: { quantity: 3, page: 2 } } }] });
      await acceptOnPlan(owner, seeded.projectId, seeded.plans[0], [seeded.items.Lavabo]);
      await app.open(`/dashboard/affaires/${seeded.projectId}/takeoff`);
      await waitForHydration(ui.browser);
      await screen.getByRole("button", "Envoyer ce plan au devis : « plan-a.pdf »", { exact: true }).click();
      const dialog = screen.getByRole("dialog");
      await expect(dialog).toContainText("La liste des postes vient du DPGF, mais ce devis n’en contient aucune ligne");
      await expect(dialog.getByRole("link", "Confirmer l’import du DPGF", { exact: true }))
        .toHaveAttribute("href", `/dashboard/affaires/${seeded.projectId}#intake`);
      await expect(dialog.getByRole("button", "Créer le devis et y envoyer « plan-a.pdf »", { exact: true })).toBeDisabled();
      const shot = await ui.app.screenshot("poste-envoi-dpgf-sans-ligne");
      await dialog.getByRole("button", "Annuler", { exact: true }).click();
      expect([await readOwnedVersions(seeded.projectId), await countOwnedReceipts(seeded.projectId)]).toEqual([[], 0]);

      // The review of this plan does not offer today's send, which refuses a plan read against the list: it offers this one.
      // Its address leads to the table of items filtered on the plan (lot 4, the entries: review-link.ts), which offers
      // it; the targeted review, which stays, offers it above its lines.
      const takeoff = `/dashboard/affaires/${seeded.projectId}/takeoff`;
      await app.open(`${takeoff}/${seeded.plans[0].jobId}/review`);
      await expect(ui.browser).toHaveURL(`${takeoff}?postePlan=${seeded.plans[0].fileId}&lien=analyse&lienAnalyse=${seeded.plans[0].jobId}`);
      await waitForHydration(ui.browser);
      await expect(ui.locator('[data-testid="poste-plan-send"]').getByRole("button", "Envoyer ce plan au devis", { exact: true }))
        .toBeVisible({ timeout: 30_000 });
      await app.open(`${takeoff}/${seeded.plans[0].jobId}/review/targeted`);
      await waitForHydration(ui.browser);
      const notice = ui.locator('[data-testid="item-send-review-notice"]');
      await expect(notice).toContainText("Ce plan a été lu contre la liste des postes", { timeout: 30_000 });
      await notice.getByRole("button", "Envoyer ce plan au devis", { exact: true }).click();
      await expect(screen.getByRole("dialog")).toContainText("Envoyer le plan « plan-a.pdf » au devis");
      await expect(screen.getByRole("dialog")).toContainText("La liste des postes vient du DPGF");
      await screen.getByRole("dialog").getByRole("button", "Annuler", { exact: true }).click();
      await recordEvidence(army, "POSTE-ENVOI03", { projectId: seeded.projectId, screenshots: [shot] });
    });
});
