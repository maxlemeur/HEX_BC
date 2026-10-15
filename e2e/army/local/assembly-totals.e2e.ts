import { expect } from "e2e";
import { armyTest, createEstimateViaWizard, readEstimate, recordEvidence, setLineCoreValues, type ArmyItem } from "../critical/fixtures";
import { amounts, componentExports, openComponents, prepareComponents } from "./generated-ouvrage-components-support";
import { numericField, persistNumeric, retainNumeric, type NumericContext, type NumericOracle } from "./numeric-entry-support";

// Defined before the harness: docs/testing/assembly-insertion-financial-e2e.md.
if (process.env.E2E_GENERATED_COMPONENTS_SELECTION !== "assembly-totals") throw new Error("Explicit assembly-totals selection required.");
const options = { session: "army", trace: "off" as const, tags: ["source-coverage", "generated-components", "assembly-totals"], timeout: 420000 };
const sourceOracle: NumericOracle = { retainedIndices: [0], components: [{ index: 0, costType: "material", quantity: 1, unit: "u", unitCostHtCents: 1250,
  lossCoeffBp: 0, yieldValue: null, yieldUnit: null, derivedHours: 0, dsCents: 1250 }], parent: { quantity: 1, dsCents: 1250, effectiveUnitPriceHtCents: 1250, totalHours: 0 }, totals: [1250, 250, 1500] };
const business = (row: ArmyItem) => Object.fromEntries(["id", "parent_id", "position", "title", "description", "quantity", "unit_price_ht_cents", "tax_rate_bp",
  "k_fo", "h_mo", "h_mo_majoration", "k_mo", "labor_role_id", "source_provider", "source_metadata"].map((key) => [key, row[key]]));
const lineTotals = (row: ArmyItem) => [row.line_total_ht_cents, row.line_tax_cents, row.line_total_ttc_cents];

for (const specification of [
  { caseId: "AT01", fixture: "GC01", title: "AT01 assembly insertion persists nonempty fixed footer before any save", discountBp: 0,
    old: [2000, 400, 2400], added: [1250, 250, 1500], totals: [3250, 650, 3900], footer: /32[,.]50\s*€/ },
  { caseId: "AT02", fixture: "GC02", title: "AT02 assembly insertion persists V2 global discount allocation before any save", discountBp: 1000,
    old: [1800, 360, 2160], added: [1125, 225, 1350], totals: [2925, 585, 3510], footer: /29[,.]25\s*€/ },
]) armyTest(specification.title, options, async (ui) => {
  const p = await prepareComponents(ui, specification.fixture), c: NumericContext = { ui, p, caseId: specification.caseId, oracle: sourceOracle };
  let targetVersionId: string | undefined;
  try {
    await openComponents(ui, p); await retainNumeric(c);
    const cost = await numericField(c, 0, "Coût unitaire HT (€)"); await cost.fill("12.50"); await cost.press("Tab");
    await persistNumeric(c); // Real review/apply + two exact primary XLSX; no prepared library.
    const objects = await p.objects(); expect(objects.assemblies).toHaveLength(1); expect(objects.libraryComponents).toHaveLength(1);
    const assembly = objects.assemblies[0], library = objects.libraryComponents[0]; expect(objects.snapshots[0].assembly_id).toBe(assembly.id);
    const target = await createEstimateViaWizard(ui, { projectName: `${ui.army.runPrefix}-${specification.caseId}-TARGET`, title: `${specification.caseId} assembly footer` }, ui.army);
    targetVersionId = target.versionId;
    const itemsUrl = new URL(`/api/estimates/${target.versionId}/items`, ui.app.baseUrl!);
    let releaseParent!: () => void;
    const parentGate = new Promise<void>((resolve) => { releaseParent = resolve; });
    let parentHeld = false, creationRequests = 0;
    await ui.browser.route(itemsUrl.href, async (route) => {
      if (route.request.method === "POST" && ++creationRequests === 1) {
        parentHeld = true;
        await parentGate;
      }
      await route.fallback();
    });
    const parentResponse = ui.browser.waitForResponse(itemsUrl.href, { timeout: 60000 });
    const addChild = ui.screen.getByRole("button", "Ajouter dans Nouveau lot", { exact: true });
    let parentAck: Awaited<typeof parentResponse>;
    let pendingButtonEnabled: boolean;
    try {
      await ui.screen.getByTestId("estimate-editor-add-root-section-button").click();
      await expect.poll(() => parentHeld).toBe(true);
      await expect(ui.screen.getByTestId("estimate-section-title-input")).toHaveCount(1);
      pendingButtonEnabled = await addChild.isEnabled();
      await recordEvidence(ui.army, `${specification.caseId}-parent-pending`, { target, parentHeld, pendingButtonEnabled, creationRequests });
      await expect(addChild).toBeDisabled();
      await expect(ui.screen.getByTestId("estimate-line-title-input")).toHaveCount(0);
      expect(creationRequests).toBe(1);
    } finally {
      releaseParent();
      parentAck = await parentResponse;
    }
    const parentReply = await parentAck.json<{ ok: boolean; data: { item: ArmyItem } }>();
    expect(parentAck.status).toBe(201); expect(parentReply.ok).toBe(true);
    const parentId = parentReply.data.item.id;
    await expect(ui.browser.locator(`[data-estimate-item-id="${parentId}"]`)).toHaveCount(1);
    await expect(addChild).toBeEnabled();
    await addChild.click();
    const [lineAck] = await Promise.all([ui.browser.waitForResponse(itemsUrl.href, { timeout: 60000 }), ui.screen.getByTestId("estimate-section-add-line-button").click()]);
    const lineReply = await lineAck.json<{ ok: boolean; data: { item: ArmyItem } }>();
    expect(lineAck.status).toBe(201); expect(lineReply.ok).toBe(true); expect(lineReply.data.item.parent_id).toBe(parentId);
    await expect(ui.browser.locator(`[data-estimate-item-id="${lineReply.data.item.id}"]`)).toHaveCount(1);
    await recordEvidence(ui.army, `${specification.caseId}-creation`, { target, parentHeld, pendingButtonEnabled: pendingButtonEnabled!, creationRequests,
      parentStatus: parentAck.status, parentId, lineStatus: lineAck.status, lineId: lineReply.data.item.id, childParentId: lineReply.data.item.parent_id });
    expect(creationRequests).toBe(2);
    await ui.browser.unroute(itemsUrl.href);
    await expect(ui.screen.getByTestId("estimate-line-title-input")).toHaveCount(1);
    const oldTitle = `${ui.army.runPrefix}-${specification.caseId}-existing`;
    await ui.screen.getByTestId("estimate-line-title-input").fill(oldTitle); await ui.browser.keyboard.press("Tab");
    await ui.screen.getByLabel(`Unité pour ${oldTitle}`, { exact: true }).fill("u"); await ui.browser.keyboard.press("Tab");
    await setLineCoreValues(ui, oldTitle, { quantity: "1", unitPriceHt: "20.00" });
    await ui.browser.keyboard.press("Control+s");
    await expect.poll(async () => amounts((await readEstimate(ui.browser, target.versionId)).version), { timeout: 45000 }).toEqual([2000, 400, 2400]);
    if (specification.discountBp) {
      await ui.screen.getByRole("button", "Ouvrir les paramètres", { exact: true }).click();
      await ui.screen.getByLabel("Remise (EUR HT)", { exact: true }).fill("2"); await ui.browser.keyboard.press("Tab");
      await ui.screen.getByRole("button", "Enregistrer le paramétrage", { exact: true }).click();
      await expect.poll(async () => (await readEstimate(ui.browser, target.versionId)).version.discount_bp, { timeout: 45000 }).toBe(1000);
      await expect.poll(async () => amounts((await readEstimate(ui.browser, target.versionId)).version), { timeout: 45000 }).toEqual(specification.old);
      await ui.screen.getByTestId("estimate-editor-drawer-close-button").click();
    }
    const before = await readEstimate(ui.browser, target.versionId), old = before.items.filter((row) => row.item_type === "line"); expect(old).toHaveLength(1);
    if (!specification.discountBp) expect(lineTotals(old[0])).toEqual(specification.old);
    expect(amounts(before.version)).toEqual(specification.old); expect(before.version.calc_engine_version).toBe(2); expect(before.version.discount_bp).toBe(specification.discountBp);
    expect([old[0].quantity, old[0].unit_price_ht_cents, old[0].tax_rate_bp]).toEqual([1, 2000, 2000]);
    const ordinaryBefore = { items: await p.versionRows(target.versionId), version: await p.versionRow(target.versionId) };
    const baselineRow = ordinaryBefore.items.find((row) => row.id === old[0].id)!;
    expect(business(baselineRow as ArmyItem)).toEqual(business(old[0])); expect(lineTotals(baselineRow as ArmyItem)).toEqual(lineTotals(old[0]));
    expect(amounts(ordinaryBefore.version)).toEqual(specification.old);
    const requests: string[] = [], insertUrl = new URL(`/api/estimates/assemblies/${assembly.id}/insert`, ui.app.baseUrl!); insertUrl.searchParams.set("versionId", target.versionId);
    await ui.browser.route(insertUrl.href, async (route) => { requests.push(route.request.method); await route.fallback(); });
    const financialWrites: Array<{ method: string; path: string }> = [];
    let insertionReturned = false;
    const financialRoute = "**/api/estimates/" + target.versionId + "**";
    await ui.browser.route(financialRoute, async (route) => {
      const pathname = new URL(route.request.url).pathname, method = route.request.method;
      if (insertionReturned && ["PATCH", "POST"].includes(method) &&
        ["/api/estimates/" + target.versionId, "/api/estimates/" + target.versionId + "/items/bulk", "/api/estimates/" + target.versionId + "/batch"].includes(pathname)) {
        financialWrites.push({ method, path: pathname });
      }
      await route.fallback();
    });
    const observe = async (phase: string, actual: unknown) => recordEvidence(ui.army, `${specification.caseId}-${phase}`, { schemaVersion: "army-assembly-totals-witness-1",
      caseId: specification.caseId, phase, source: p.s, target, assemblyId: assembly.id, libraryItem: library, expected: specification, actual });
    await observe("baseline", { api: before, ordinary: ordinaryBefore, requests: [...requests] });
    const opener = ui.screen.getByTestId("estimate-editor-assemblies-button");
    if (!await opener.isVisible()) { const tab = ui.screen.getByRole("tab", "Insérer", { exact: true }); if (await tab.isVisible()) await tab.click(); await ui.screen.getByRole("button", "Insérer", { exact: true }).click(); }
    await opener.click(); const dialog = ui.screen.getByRole("dialog", "Ajouter un ouvrage", { exact: true });
    await dialog.getByLabel("Rechercher", { exact: true }).fill(assembly.name as string); await dialog.getByRole("button", assembly.name as string, { exact: false }).click();
    const cta = dialog.getByRole("button", `Ajouter « ${assembly.name} »`, { exact: false }); await expect(cta).toBeEnabled();
    const [response] = await Promise.all([ui.browser.waitForResponse(insertUrl.href, { timeout: 60000 }), cta.click()]);
    insertionReturned = true;
    const reply = await response.json<{ ok: boolean; data: { items: ArmyItem[]; totals: Record<string, number>; version: { id: string; updated_at: string } } }>();
    // First observations after POST. Never save/poll/reconcile an incorrect footer.
    const immediate = await readEstimate(ui.browser, target.versionId), ordinary = { items: await p.versionRows(target.versionId), version: await p.versionRow(target.versionId) };
    await observe("immediate", { status: response.status, reply, api: immediate, ordinary, requests: [...requests] });
    expect(response.status).toBe(200); expect(reply.ok).toBe(true); expect(amounts(immediate.version)).toEqual(specification.totals);
    expect(amounts(ordinary.version)).toEqual(specification.totals); expect(reply.data.version.id).toBe(target.versionId); expect(amounts(reply.data.totals)).toEqual(specification.totals);
    const lines = immediate.items.filter((row) => row.item_type === "line"); expect(lines).toHaveLength(2);
    const previous = lines.find((row) => row.id === old[0].id)!; expect(business(previous)).toEqual(business(old[0])); expect(lineTotals(previous)).toEqual(specification.old);
    const inserted = lines.find((row) => row.id !== old[0].id)!; expect(lineTotals(inserted)).toEqual(specification.added);
    expect(inserted.source_provider).toBe("assembly_library"); expect(inserted.source_metadata).toEqual({ kind: "assembly_library",
      library_origin: { assembly_id: assembly.id, assembly_item_id: library.id, source_metadata: library.source_metadata } });
    expect([inserted.quantity, inserted.unit_price_ht_cents, inserted.h_mo]).toEqual([1, 1250, 0]); expect(reply.data.items.filter((row) => row.item_type === "line").map((row) => row.id)).toEqual([inserted.id]);
    for (const line of lines) { const row = ordinary.items.find((item) => item.id === line.id)!; expect(lineTotals(row as ArmyItem)).toEqual(lineTotals(line)); expect(business(row as ArmyItem)).toEqual(business(line)); }
    const footer = ui.browser.locator('[data-testid="estimate-editor-table-footer"] [data-estimate-column="total_price"]'); await expect(footer).toHaveText(specification.footer);
    if (specification.discountBp) {
      await ui.screen.getByRole("button", "Ouvrir les paramètres", { exact: true }).click();
      const discount = ui.screen.getByLabel("Remise (EUR HT)", { exact: true });
      await expect(discount).toHaveValue("3.25");
      await observe("discount-synchronized", { equivalentInput: await discount.inputValue(), expectedBp: specification.discountBp });
      await ui.screen.getByTestId("estimate-editor-drawer-close-button").click();
    }
    const oldUi = ui.browser.locator(`[data-estimate-item-id="${old[0].id}"] [data-estimate-column="total_price"]`); await expect(oldUi).toHaveText(specification.discountBp ? /18[,.]00\s*€/ : /20[,.]00\s*€/);
    const immediateStatus = ui.screen.getByTestId("estimate-page-toolbar-autosave-status");
    await expect(immediateStatus).toHaveText(/^(À jour|Sauvegardé)$/);
    await observe("ui", { footerText: await footer.textContent(), oldRowText: await oldUi.textContent(), statusText: await immediateStatus.textContent(), requests: [...requests] });
    await ui.browser.reload({ timeout: 15000 }); await expect(ui.screen.getByRole("grid", "Lignes de devis", { exact: true })).toBeVisible();
    const reload = await readEstimate(ui.browser, target.versionId), reloadedOrdinary = { items: await p.versionRows(target.versionId), version: await p.versionRow(target.versionId) };
    await observe("reload", { api: reload, ordinary: reloadedOrdinary, requests: [...requests] });
    expect(amounts(reload.version)).toEqual(specification.totals); expect(amounts(reloadedOrdinary.version)).toEqual(specification.totals);
    expect(reload.items).toEqual(immediate.items); expect(reloadedOrdinary.items).toEqual(ordinary.items); expect(requests).toEqual(["POST"]);
    await expect(footer).toHaveText(specification.footer);
    await expect(oldUi).toHaveText(specification.discountBp ? /18[,.]00\s*€/ : /20[,.]00\s*€/);
    let reloadedDiscount: string | null = null;
    if (specification.discountBp) {
      await ui.screen.getByRole("button", "Ouvrir les paramètres", { exact: true }).click();
      const discount = ui.screen.getByLabel("Remise (EUR HT)", { exact: true });
      await expect(discount).toHaveValue("3.25"); reloadedDiscount = await discount.inputValue();
      await ui.screen.getByTestId("estimate-editor-drawer-close-button").click();
    }
    await observe("ui-reload", { footerText: await footer.textContent(), oldRowText: await oldUi.textContent(), reloadedDiscount, requests: [...requests] });
    await componentExports(ui, p, specification.totals, { versionId: target.versionId, label: "assembly-total-exports", retainedIndices: [0] });
    const autosave = ui.screen.getByTestId("estimate-page-toolbar-autosave-status");
    await expect(autosave).not.toContainText("Totaux à synchroniser");
    await observe("synchronized", { financialWrites: [...financialWrites], statusText: await autosave.textContent(), requests: [...requests] });
    expect(financialWrites).toEqual([]); expect(requests).toEqual(["POST"]);
    await ui.browser.unroute(financialRoute);
    await ui.browser.unroute(insertUrl.href);
  } finally {
    if (targetVersionId) await ui.browser.evaluate(async (versionId) => {
      const session = sessionStorage.getItem(`__miaouffrageEstimateDraftLockSession:${versionId}`); if (!session) return false;
      const response = await fetch(`/api/estimates/${versionId}/lock`, { method: "DELETE", credentials: "same-origin", headers: { "content-type": "application/json", "x-estimate-draft-lock-session-id": session }, body: "{}" });
      return response.ok;
    }, targetVersionId);
    await p.close();
  }
});
