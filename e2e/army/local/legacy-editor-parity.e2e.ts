import { expect, type Locator } from "e2e";

import {
  apiRequest, armyTest, createEstimateViaWizard, createLineViaApi, readEstimate, recordEvidence, saveLineEditsWithShortcut, waitForAutoSave,
  type ArmyEstimate, type ArmyItem, type ArmyState, type OwnedEstimate,
} from "../critical/fixtures";
import { signUpDedicatedOwner } from "./dedicated-owner";

type Ui = Parameters<typeof createEstimateViaWizard>[0];
type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const options = { session: "army", tags: ["critical", "legacy-editor-parity"], timeout: 240_000 };

// Parity gaps before implementation:
// EST-101: actual Tab/Shift+Tab/Enter/arrows/caret movement and Enter-only creation.
// EST-103: actual Shift range, exact selected IDs, requested category/role UUIDs,
// bulk move and confirmed deletion of only those IDs, retained after reload.
// EST-105: automatic title persistence, saved badge, leave/reopen, without Ctrl+S.
// EST-102: read-only PU/total navigation and nonmutation, keyboard replacement,
// local edit undo, and Enter commit persisted on the same line ID.
// EST-106: actual keyboard drag, exact sibling positions, undo/redo and reload.
// TI-142: real section/line creation without console.error or uncaught errors.
// Existing bulk-move and bulk-edit-sync journeys retain their undo/totals oracles.
// These new cases do not replace any legacy journey before executed proof exists.
async function prepare(ui: Ui, army: ArmyState, tag: string, count: number) {
  await ui.app.open("/dashboard/affaires");
  const owner = await signUpDedicatedOwner(ui.browser, ui.app.baseUrl!, army.runPrefix, { tag, uiMode: "expert" });
  await ui.browser.emulateMedia({ reducedMotion: "reduce" });
  const ids = await createEstimateViaWizard(ui, {
    projectName: army.projectName, title: `${army.runPrefix} ${tag}`,
  }, army);
  const lines: ArmyItem[] = [];
  for (let index = 0; index < count; index++) {
    lines.push(await createLineViaApi(ui.browser, ids.versionId, `${army.runPrefix} ${tag} ${index + 1}`, {
      line_nature: "supply_and_labor", h_mo: 1,
    }));
  }
  expect((await readEstimate(ui.browser, ids.versionId)).version.calc_engine_version).toBe(2);
  expect(lines.every((line) => UUID.test(line.id))).toBe(true);
  await recordEvidence(army, `${tag.toLowerCase()}-fixture`, {
    ...ids, owner: { tenantId: owner.tenantId, userId: owner.userId },
    engine: 2, lineIds: lines.map((line) => line.id), sourceSectionId: lines[0].parent_id,
  });
  return { ids, lines, owner };
}

const grid = (ui: Ui) => ui.screen.getByRole("grid", "Lignes de devis", { exact: true });
const row = (ui: Ui, id: string) => ui.browser.locator(`[data-estimate-item-id="${id}"]`);
const cell = (ui: Ui, id: string, column: string) => ui.browser.locator(`[data-cell-id="${id}::${column}"]`);
const select = (ui: Ui, line: ArmyItem) => ui.screen.getByLabel(`Sélectionner la ligne ${line.title}`, { exact: true });

async function openSeededEditor(ui: Ui, ids: OwnedEstimate) {
  const release = await apiRequest(ui.browser, "DELETE", `/api/estimates/${ids.versionId}/lock`);
  expect(release.status).toBe(200);
  await ui.browser.reload();
  await expect(grid(ui)).toBeVisible();
  await expect(ui.screen.getByTestId("estimate-page-toolbar-autosave-status"))
    .not.toHaveText("Connexion…", { timeout: 30_000 });
}

async function reloadAcknowledgedEditor(ui: Ui, army: ArmyState, ids: OwnedEstimate, label: string) {
  const status = ui.screen.getByTestId("estimate-page-toolbar-autosave-status");
  const beforeAck = await readEstimate(ui.browser, ids.versionId);
  let afterAck: ArmyEstimate | null = null;
  const startedAt = Date.now();
  // A v2 structural response without totals deliberately leaves the footer
  // pending (useEstimateEditorSyncController: structural mutation observer).
  // Its automatic save uses the same 60_000 ms debounce/max-wait as LEP03.
  // Wait for that actual cadence without Ctrl+S, then require a consistent API
  // snapshot and no remaining native leave warning. The test timeout is unchanged.
  try {
    await expect(status).toHaveText(/^(À jour|Sauvegardé)$/, { timeout: 90_000 });
    afterAck = await readEstimate(ui.browser, ids.versionId);
  } finally {
    await recordEvidence(army, `${label}-reload-ack`, {
      ...ids, badge: await status.textContent(), elapsedMs: Date.now() - startedAt,
      trigger: "automatic save only; no ControlOrMeta+S", beforeAck, afterAck,
    });
  }
  let nativeDialogs = 0;
  const stopDialogObservation = await ui.browser.onDialog(async (dialog) => {
    nativeDialogs++;
    // Complete this requested reload for diagnosis; zero is still required.
    await dialog.accept();
  });
  try {
    await ui.browser.reload();
  } finally {
    await stopDialogObservation();
    await recordEvidence(army, `${label}-reload-dialogs`, { ...ids, nativeDialogs });
  }
  expect(nativeDialogs, "An acknowledged editor must not trigger a native dialog on reload").toBe(0);
  await expect(grid(ui)).toBeVisible();
}

async function selectedIds(ui: Ui) {
  return ui.browser.evaluate(() => Array.from(document.querySelectorAll<HTMLInputElement>(
    '[data-testid="estimate-line-checkbox"]:checked',
  )).map((checkbox) => checkbox.closest("[data-estimate-item-id]")?.getAttribute("data-estimate-item-id"))
    .filter((id): id is string => Boolean(id)).sort());
}

async function expectSelection(ui: Ui, ids: string[]) {
  await expect.poll(() => selectedIds(ui)).toEqual([...ids].sort());
}

async function activeCellId(ui: Ui) {
  return ui.browser.evaluate(() => document.activeElement?.closest("[data-cell-id]")?.getAttribute("data-cell-id") ?? null);
}

async function caret(ui: Ui) {
  return ui.browser.evaluate(() => document.activeElement instanceof HTMLInputElement ? document.activeElement.selectionStart : null);
}

async function observeKeyboardDrag(ui: Ui, army: ArmyState, ids: OwnedEstimate) {
  // KeyboardSensor defers its native listener after drag activation. Observe
  // that registration while forwarding all native calls and keys unchanged.
  await ui.browser.evaluate(() => {
    const registrations: Array<{ action: string; listener: string; at: number }> = [];
    const events: Array<{ code: string; at: number; defaultPrevented: boolean }> = [];
    const installed = new Set<EventListenerOrEventListenerObject>();
    const originalAdd = document.addEventListener;
    const originalRemove = document.removeEventListener;
    document.addEventListener = function (this: Document, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
      const result = Reflect.apply(originalAdd, this, [type, listener, options]);
      if (type === "keydown") {
        const name = typeof listener === "function" ? listener.name : "object";
        registrations.push({ action: "add", listener: name, at: performance.now() });
        if (listener && name === "bound handleKeyDown") installed.add(listener);
      }
      return result;
    } as Document["addEventListener"];
    document.removeEventListener = function (this: Document, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
      const result = Reflect.apply(originalRemove, this, [type, listener, options]);
      if (type === "keydown") {
        registrations.push({ action: "remove", listener: typeof listener === "function" ? listener.name : "object", at: performance.now() });
        if (listener) installed.delete(listener);
      }
      return result;
    } as Document["removeEventListener"];
    const onKey = (event: KeyboardEvent) => {
      if (["Space", "ArrowDown"].includes(event.code)) events.push({ code: event.code, at: performance.now(), defaultPrevented: event.defaultPrevented });
    };
    window.addEventListener("keydown", onKey);
    (window as unknown as { __armyLegacyDndAudit: { ready: () => boolean; read: () => string; restore: () => void } }).__armyLegacyDndAudit = {
      ready: () => installed.size > 0,
      read: () => JSON.stringify({ registrations, events }),
      restore: () => {
        document.addEventListener = originalAdd;
        document.removeEventListener = originalRemove;
        window.removeEventListener("keydown", onKey);
      },
    };
    return null;
  });
  return {
    waitForReady: async () => {
      await expect.poll(() => ui.browser.evaluate(() =>
        (window as unknown as { __armyLegacyDndAudit?: { ready: () => boolean } }).__armyLegacyDndAudit?.ready() ?? false),
      { message: "KeyboardSensor must install its real keydown listener before the one ArrowDown is sent" }).toBe(true);
    },
    finish: async () => {
      const raw = await ui.browser.evaluate(() => {
        const observed = window as unknown as { __armyLegacyDndAudit?: { read: () => string; restore: () => void } };
        const audit = observed.__armyLegacyDndAudit;
        if (!audit) return null;
        try { return audit.read(); } finally { audit.restore(); delete observed.__armyLegacyDndAudit; }
      });
      await recordEvidence(army, "lep05-keyboard-native-diagnostics", { ...ids, observed: raw ? JSON.parse(raw) : null });
    },
  };
}

armyTest("LEP01 keyboard navigation and Enter create exactly one persisted line with add undo and redo", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const errorKey = `${army.runPrefix}-LEP01-errors`;
    await browser.addInitScript((key) => {
      if (!/^https?:$/.test(location.protocol)) return;
      const counts = () => JSON.parse(sessionStorage.getItem(key) ?? "{}") as Record<string, number>;
      const count = (kind: string) => {
        const current = counts();
        current[kind] = (current[kind] ?? 0) + 1;
        sessionStorage.setItem(key, JSON.stringify(current));
      };
      const originalError = console.error.bind(console);
      console.error = (...args: unknown[]) => { count("console.error"); originalError(...args); };
      window.addEventListener("error", () => count("error"));
      window.addEventListener("unhandledrejection", () => count("unhandledrejection"));
    }, errorKey);
    const { ids, lines } = await prepare(ui, army, "LEP01", 2);
    await openSeededEditor(ui, ids);
    const firstTitle = row(ui, lines[0].id).getByTestId("estimate-line-title-input");
    const sectionTitle = row(ui, lines[0].parent_id!).getByTestId("estimate-section-title-input");
    await sectionTitle.focus();
    await sectionTitle.press("Tab");
    await expect.poll(() => activeCellId(ui)).toBe(`${lines[0].id}::title`);
    await firstTitle.click();
    await firstTitle.press("Tab");
    await expect.poll(() => activeCellId(ui)).toBe(`${lines[0].id}::quantity`);
    await browser.keyboard.press("Shift+Tab");
    await expect.poll(() => activeCellId(ui)).toBe(`${lines[0].id}::title`);
    await browser.keyboard.press("Enter");
    await expect.poll(() => activeCellId(ui)).toBe(`${lines[1].id}::title`);
    await browser.keyboard.press("Escape");
    await expect.poll(() => activeCellId(ui)).toBe(`${lines[1].id}::title`);

    await cell(ui, lines[0].id, "quantity").focus();
    await browser.keyboard.press("ArrowDown");
    await expect.poll(() => activeCellId(ui)).toBe(`${lines[1].id}::quantity`);
    await browser.keyboard.press("ArrowUp");
    await expect.poll(() => activeCellId(ui)).toBe(`${lines[0].id}::quantity`);
    for (const line of lines) await expect(screen.getByLabel(`Quantité pour ${line.title}`, { exact: true })).toHaveValue("1");

    await firstTitle.focus();
    await firstTitle.press("End");
    await expect.poll(() => caret(ui)).toBe(lines[0].title.length);
    await firstTitle.press("ArrowLeft");
    await expect.poll(() => caret(ui)).toBe(lines[0].title.length - 1);
    await firstTitle.press("ArrowRight");
    await expect.poll(() => caret(ui)).toBe(lines[0].title.length);

    const before = await readEstimate(browser, ids.versionId);
    const beforeIds = before.items.filter((item) => item.item_type === "line").map((item) => item.id).sort();
    const source = before.items.find((item) => item.id === lines[0].parent_id)!;
    expect(source.parent_id).toMatch(UUID);
    const sectionIds = before.items.filter((item) => item.item_type === "section").map((item) => item.id);
    const sectionTrigger = row(ui, source.parent_id!).getByTestId("estimate-section-quick-actions-trigger");
    await sectionTrigger.focus();
    await expect(sectionTrigger).toBeFocused();
    await sectionTrigger.press("Enter");
    const addSection = screen.getByTestId("estimate-section-add-section-button", { visible: true });
    await expect(addSection).toBeVisible();
    await addSection.focus();
    await addSection.press("Enter");
    await expect.poll(async () => (await readEstimate(browser, ids.versionId)).items
      .filter((item) => item.item_type === "section").length).toBe(sectionIds.length + 1);
    const addedSections = (await readEstimate(browser, ids.versionId)).items
      .filter((item) => item.item_type === "section" && !sectionIds.includes(item.id));
    expect(addedSections).toHaveLength(1);
    const addedSection = addedSections[0];
    expect(addedSection.id).toMatch(UUID);
    expect(addedSection.parent_id).toBe(source.parent_id);
    // Keyboard activation leaves the first popover open. Close it before
    // opening another section's portalled menu, so its still-visible line
    // action cannot be mistaken for the new section's action during render.
    await browser.keyboard.press("Escape");
    await expect(addSection).toBeHidden();
    const trigger = row(ui, addedSection.id).getByTestId("estimate-section-quick-actions-trigger");
    await trigger.focus();
    await expect(trigger).toBeFocused();
    await trigger.press("Enter");
    const addLine = screen.getByRole("button", "+ Ligne Sous-chapitre", { exact: true, visible: true });
    await expect(addLine).toBeVisible();
    await addLine.focus();
    await addLine.press("Enter");
    await expect(screen.getByTestId("estimate-line-row")).toHaveCount(lines.length + 1);
    await expect.poll(async () => (await readEstimate(browser, ids.versionId)).items
      .filter((item) => item.item_type === "line").length).toBe(lines.length + 1);
    const after = await readEstimate(browser, ids.versionId);
    const added = after.items.filter((item) => item.item_type === "line" && !beforeIds.includes(item.id));
    expect(added).toHaveLength(1);
    expect(added[0].id).toMatch(UUID);
    expect(added[0].parent_id).toBe(addedSection.id);
    for (const line of lines) expect(after.items.find((item) => item.id === line.id)?.quantity).toBe(1);
    const undoAdd = screen.getByTestId("estimate-editor-undo-button", { visible: true });
    await expect(undoAdd).toBeEnabled();
    await undoAdd.click();
    await expect.poll(async () => (await readEstimate(browser, ids.versionId)).items
      .filter((item) => item.item_type === "line").map((item) => item.id).sort()).toEqual(beforeIds);
    await expect(screen.getByTestId("estimate-line-row")).toHaveCount(lines.length);
    const redoAdd = screen.getByTestId("estimate-editor-redo-button", { visible: true });
    await expect(redoAdd).toBeEnabled();
    await redoAdd.click();
    await expect.poll(async () => (await readEstimate(browser, ids.versionId)).items
      .filter((item) => item.item_type === "line").length).toBe(lines.length + 1);
    const redone = (await readEstimate(browser, ids.versionId)).items
      .filter((item) => item.item_type === "line" && !beforeIds.includes(item.id));
    expect(redone).toHaveLength(1);
    expect(redone[0].id).toMatch(UUID);
    expect(redone[0]).toMatchObject({ title: added[0].title, parent_id: addedSection.id, position: added[0].position,
      quantity: added[0].quantity, unit_price_ht_cents: added[0].unit_price_ht_cents, h_mo: added[0].h_mo,
      k_fo: added[0].k_fo, k_mo: added[0].k_mo, line_total_ht_cents: added[0].line_total_ht_cents });
    await expect(screen.getByTestId("estimate-line-row")).toHaveCount(lines.length + 1);
    await reloadAcknowledgedEditor(ui, army, ids, "lep01");
    const reloaded = await readEstimate(browser, ids.versionId);
    expect(reloaded.items.find((item) => item.id === addedSection.id)).toMatchObject({ item_type: "section", parent_id: source.parent_id });
    expect(reloaded.items.filter((item) => item.item_type === "line")
      .map((item) => item.id).sort()).toEqual([...beforeIds, redone[0].id].sort());
    expect(reloaded.items.find((item) => item.id === redone[0].id)).toMatchObject({ title: added[0].title,
      parent_id: addedSection.id, position: added[0].position, quantity: added[0].quantity });
    const errors = await browser.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? "{}") as Record<string, number>, errorKey);
    await recordEvidence(army, "lep01-keyboard-persisted", {
      ...ids, inputMethod: "Tab, Shift+Tab, Enter, Escape, ArrowDown/Up, ArrowLeft/Right; Enter on real section trigger and add-line button",
      beforeIds, addedSection, added: { id: added[0].id, parentId: added[0].parent_id }, redone: redone[0], after, reloaded, errors,
    });
    expect(errors, "TI-142: this real section/line creation must not emit console.error or uncaught errors").toEqual({});
  });

async function applyBulk(ui: Ui, control: Locator, value: string, button: string) {
  await control.selectOption({ value });
  await ui.screen.getByTestId(button).click();
}

armyTest("LEP02 Shift range and bulk actions preserve exact row and resource identities after reload", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { ids, lines } = await prepare(ui, army, "LEP02", 4);
    const category = await apiRequest<Envelope<{ category: { id: string; name: string } }>>(browser,
      "POST", `/api/estimates/${ids.versionId}/categories`, { name: `${army.runPrefix} catégorie`, color: "#008080", position: 0 });
    expect(category.status).toBe(201);
    expect(category.body.ok).toBe(true);
    const categoryId = category.body.data.category.id;
    const labor = await apiRequest<Envelope<{ labor_role: { id: string; name: string } }>>(browser,
      "POST", `/api/estimates/${ids.versionId}/labor-roles`, { name: `${army.runPrefix} tuyauteur`, hourly_rate_cents: 4000, is_active: true, position: 0 });
    expect(labor.status).toBe(201);
    expect(labor.body.ok).toBe(true);
    const roleId = labor.body.data.labor_role.id;
    const source = (await readEstimate(browser, ids.versionId)).items.find((item) => item.id === lines[0].parent_id)!;
    const target = await apiRequest<Envelope<{ item: ArmyItem }>>(browser, "POST", `/api/estimates/${ids.versionId}/items`, {
      item_type: "section", parent_id: source.parent_id, title: `${army.runPrefix} cible`,
    });
    expect(target.status).toBe(201);
    expect(target.body.ok).toBe(true);
    const targetId = target.body.data.item.id;
    for (const id of [categoryId, roleId, targetId]) expect(id).toMatch(UUID);
    await openSeededEditor(ui, ids);

    // Control+click opens the native context menu on macOS; the SDK resolves
    // the platform's additive selection modifier (Meta on Mac, Control elsewhere).
    await select(ui, lines[0]).click({ modifiers: ["ControlOrMeta"] });
    await select(ui, lines[2]).click({ modifiers: ["ControlOrMeta"] });
    await expectSelection(ui, [lines[0].id, lines[2].id]);
    await select(ui, lines[2]).press("Escape");
    await expectSelection(ui, []);
    await select(ui, lines[0]).click();
    await select(ui, lines[2]).click({ modifiers: ["Shift"] });
    await expectSelection(ui, lines.slice(0, 3).map((line) => line.id));
    await select(ui, lines[0]).press("ControlOrMeta+a");
    await expectSelection(ui, lines.map((line) => line.id));
    await select(ui, lines[0]).press("Escape");
    await expectSelection(ui, []);

    const selected = lines.slice(0, 2);
    for (const line of selected) await select(ui, line).check();
    const selectedLineIds = selected.map((line) => line.id);
    await expectSelection(ui, selectedLineIds);
    const bar = screen.getByTestId("estimate-editor-bulk-selection-bar");
    await expect(bar).toBeVisible();
    await bar.getByText("Modifier les attributs", { exact: true }).click();
    await screen.getByLabel("Majoration MO en pourcentage", { exact: true }).fill("150");
    await screen.getByTestId("estimate-editor-bulk-majoration-apply-button").click();
    await expect.poll(async () => (await readEstimate(browser, ids.versionId)).items
      .filter((item) => selectedLineIds.includes(item.id)).map((item) => [item.id, item.h_mo_majoration]).sort())
      .toEqual(selectedLineIds.map((id) => [id, 1.5]).sort());
    await applyBulk(ui, bar.getByLabel("Catégorie", { exact: true }), categoryId, "estimate-editor-bulk-category-apply-button");
    await expect.poll(async () => (await readEstimate(browser, ids.versionId)).items
      .filter((item) => selectedLineIds.includes(item.id)).map((item) => [item.id, item.category_id]).sort())
      .toEqual(selectedLineIds.map((id) => [id, categoryId]).sort());
    await applyBulk(ui, bar.getByLabel("Rôle de main-d’œuvre", { exact: true }), roleId, "estimate-editor-bulk-labor-role-apply-button");
    await expect.poll(async () => (await readEstimate(browser, ids.versionId)).items
      .filter((item) => selectedLineIds.includes(item.id)).map((item) => [item.id, item.labor_role_id]).sort())
      .toEqual(selectedLineIds.map((id) => [id, roleId]).sort());
    await expectSelection(ui, selectedLineIds);

    await applyBulk(ui, bar.getByLabel("Déplacer les lignes sélectionnées vers", { exact: true }), targetId,
      "estimate-editor-bulk-move-apply-button");
    await expect.poll(async () => (await readEstimate(browser, ids.versionId)).items
      .filter((item) => selectedLineIds.includes(item.id)).map((item) => [item.id, item.parent_id]).sort())
      .toEqual(selectedLineIds.map((id) => [id, targetId]).sort());
    const changed = await readEstimate(browser, ids.versionId);
    for (const line of selected) expect(changed.items.find((item) => item.id === line.id)).toMatchObject({
      parent_id: targetId, h_mo_majoration: 1.5, category_id: categoryId, labor_role_id: roleId,
    });
    for (const line of lines.slice(2)) expect(changed.items.find((item) => item.id === line.id)).toMatchObject({
      parent_id: line.parent_id, h_mo_majoration: 1, category_id: null, labor_role_id: null,
    });
    await reloadAcknowledgedEditor(ui, army, ids, "lep02-move");
    const reloaded = await readEstimate(browser, ids.versionId);
    for (const line of selected) expect(reloaded.items.find((item) => item.id === line.id)).toMatchObject({
      parent_id: targetId, h_mo_majoration: 1.5, category_id: categoryId, labor_role_id: roleId,
    });
    for (const line of selected) await select(ui, line).check();
    await expectSelection(ui, selectedLineIds);
    await select(ui, selected[0]).focus();
    await browser.keyboard.press("Delete");
    const dialog = screen.getByRole("dialog", "Confirmer la suppression", { exact: true });
    await expect(dialog).toBeVisible();
    // The selected rows must still exist before confirmation.
    expect((await readEstimate(browser, ids.versionId)).items.filter((item) => item.item_type === "line")
      .map((item) => item.id).sort()).toEqual(lines.map((line) => line.id).sort());
    await dialog.getByRole("button", "Supprimer", { exact: true }).click();
    const retainedIds = lines.slice(2).map((line) => line.id).sort();
    await expect.poll(async () => (await readEstimate(browser, ids.versionId)).items
      .filter((item) => item.item_type === "line").map((item) => item.id).sort()).toEqual(retainedIds);
    await expect(dialog).toBeHidden();
    await expectSelection(ui, []);
    await expect(screen.getByTestId("estimate-editor-undo-button", { visible: true })).toBeEnabled();
    await reloadAcknowledgedEditor(ui, army, ids, "lep02-delete");
    const afterDeletion = await readEstimate(browser, ids.versionId);
    expect(afterDeletion.items.filter((item) => item.item_type === "line").map((item) => item.id).sort()).toEqual(retainedIds);
    // The two unselected fixture lines each retain 1 × 10 EUR, no labor role,
    // and 20% VAT. A stale pre-deletion footer must fail even if the badge says saved.
    for (const line of lines.slice(2)) expect(afterDeletion.items.find((item) => item.id === line.id)).toMatchObject({
      parent_id: line.parent_id, quantity: 1, unit_price_ht_cents: 1000, h_mo: 1, h_mo_majoration: 1,
      category_id: null, labor_role_id: null, line_total_ht_cents: 1000, line_tax_cents: 200, line_total_ttc_cents: 1200,
    });
    expect([afterDeletion.version.total_ht_cents, afterDeletion.version.total_tax_cents, afterDeletion.version.total_ttc_cents])
      .toEqual([2000, 400, 2400]);
    await recordEvidence(army, "lep02-selection-bulk-reloaded", {
      ...ids, selectedLineIds, retainedIds, categoryId, roleId, sourceSectionId: source.id, targetSectionId: targetId,
      methods: ["ControlOrMeta click", "Shift range", "ControlOrMeta+A", "Escape", "Delete then explicit confirmation"],
      expectedAfterDeletionTotals: [2000, 400, 2400],
      changed, reloaded, afterDeletion,
    });
  });

armyTest("LEP03 automatic title save reaches the saved badge and survives leave and reopen without a manual save", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { ids, lines } = await prepare(ui, army, "LEP03", 1);
    await openSeededEditor(ui, ids);
    const lineId = lines[0].id;
    const updatedTitle = `${army.runPrefix} autosave sans raccourci`;
    const title = row(ui, lineId).getByTestId("estimate-line-title-input");
    const status = screen.getByTestId("estimate-page-toolbar-autosave-status");
    const startedAt = Date.now();
    await title.fill(updatedTitle);
    await title.press("Tab");
    await expect(status).toHaveText("En attente");
    let observed: ArmyEstimate | null = null;
    let readConflictCount = 0;
    try {
      // Product cadence, not a sleep: AUTOSAVE_DEBOUNCE_MS and MAX_WAIT_MS
      // are 60_000 in useEstimateEditorSyncController.types.ts, used by
      // useEstimateEditorAutoSave. The existing save oracle allows 90 seconds.
      await expect.poll(async () => {
        const response = await apiRequest<Envelope<{ version: ArmyEstimate["version"]; items: ArmyItem[] }>>(
          browser, "GET", `/api/estimates/${ids.versionId}`);
        if (response.status === 409 && response.body.error?.code === "VERSION_CONFLICT") {
          readConflictCount++;
          return null;
        }
        expect(response.status).toBe(200);
        expect(response.body.ok).toBe(true);
        observed = { project: response.body.data.version.estimate_projects, ...response.body.data };
        return observed.items.find((item) => item.id === lineId)?.title ?? null;
      }, { timeout: 90_000, interval: 1000, message: "The automatic save must persist this exact line title without Ctrl+S or a manual save." })
        .toBe(updatedTitle);
      await expect(status).toHaveText("Sauvegardé");
    } finally {
      await recordEvidence(army, "lep03-autosave-observed", {
        ...ids, lineId, expectedTitle: updatedTitle, elapsedMs: Date.now() - startedAt,
        trigger: "title edit and blur only", readConflictCount, actual: observed, badge: await status.textContent(),
      });
    }
    const breadcrumb = browser.locator('[data-testid="estimate-page-toolbar"] a.production-ribbon__breadcrumb-link').last();
    await breadcrumb.click();
    await expect(browser).not.toHaveURL(`/dashboard/estimates/${ids.versionId}/edit`);
    await app.open(`/dashboard/estimates/${ids.versionId}/edit`);
    await expect(grid(ui)).toBeVisible();
    await expect(row(ui, lineId).getByTestId("estimate-line-title-input")).toHaveValue(updatedTitle);
    const reloaded = await readEstimate(browser, ids.versionId);
    expect(reloaded.items.find((item) => item.id === lineId)?.title).toBe(updatedTitle);
    expect(reloaded.items.filter((item) => item.item_type === "line").map((item) => item.id)).toEqual([lineId]);
    await recordEvidence(army, "lep03-autosave-reopened", { ...ids, lineId, expectedTitle: updatedTitle, reloaded });
  });

armyTest("LEP04 computed cells remain read-only and keyboard replacement, local undo and Enter commit preserve the exact line", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { ids, lines } = await prepare(ui, army, "LEP04", 2);
    await openSeededEditor(ui, ids);
    const line = lines[0];
    const before = await readEstimate(browser, ids.versionId);
    const original = before.items.find((item) => item.id === line.id)!;
    const pu = screen.getByLabel(`Prix de vente unitaire HT pour ${line.title}`, { exact: true });
    await expect(pu).toBeEnabled();
    await expect(pu).toHaveAttribute("readonly", "");
    await expect(pu).toHaveAttribute("aria-readonly", "true");
    const puBefore = await pu.inputValue();
    const totalBefore = await cell(ui, line.id, "line_total_ht").textContent();
    expect(puBefore.trim().length).toBeGreaterThan(0);
    expect(totalBefore?.trim().length).toBeGreaterThan(0);

    // Expert mode automatically selects Standard, whose last editable column
    // is K MO, followed by the focusable read-only PU and total gridcells.
    await cell(ui, line.id, "k_mo").focus();
    await browser.keyboard.press("Tab");
    await expect.poll(() => activeCellId(ui)).toBe(`${line.id}::pu_ht`);
    await browser.keyboard.press("9");
    await expect(pu).toHaveValue(puBefore);
    await browser.keyboard.press("Tab");
    await expect.poll(() => activeCellId(ui)).toBe(`${line.id}::line_total_ht`);
    await browser.keyboard.press("9");
    await expect(cell(ui, line.id, "line_total_ht")).toHaveText(totalBefore!);
    await pu.press("9");
    await expect(pu).toHaveValue(puBefore);

    const title = row(ui, line.id).getByTestId("estimate-line-title-input");
    await title.dblclick();
    await expect(title).toBeFocused();
    await expect.poll(() => browser.evaluate(() => {
      const editor = document.activeElement;
      return editor instanceof HTMLInputElement ? [editor.selectionStart, editor.selectionEnd, editor.value.length] : null;
    })).toEqual([0, line.title.length, line.title.length]);
    await title.press("Escape");
    await cell(ui, line.id, "title").focus();
    await browser.keyboard.press("R");
    await expect(title).toBeFocused();
    await expect(title).toHaveValue("R");
    await title.press("Escape");
    await expect(title).toHaveValue(line.title);
    await cell(ui, line.id, "title").focus();
    await browser.keyboard.press("F2");
    await expect(title).toBeFocused();
    await title.press("ControlOrMeta+a");
    await title.press("N");
    await expect(title).toHaveValue("N");
    await title.press("ControlOrMeta+z");
    await expect(title).toHaveValue(line.title);
    const updatedTitle = `${army.runPrefix} LEP04 validée par Entrée`;
    await title.fill(updatedTitle);
    await title.press("Enter");
    await expect.poll(() => activeCellId(ui)).toBe(`${lines[1].id}::title`);
    await expect(title).toHaveValue(updatedTitle);
    // LEP03 owns the automatic cadence oracle. Here the existing manual flush
    // keeps the Enter/inline journey bounded while proving its committed value.
    await saveLineEditsWithShortcut(ui, ids.versionId, updatedTitle, army);
    const saved = await waitForAutoSave(ui, ids.versionId,
      (snapshot) => snapshot.items.find((item) => item.id === line.id)?.title === updatedTitle, army);
    const numericView = (item: ArmyItem) => ({
      quantity: item.quantity, purchase: item.unit_price_ht_cents, hMo: item.h_mo,
      pu: item.pu_ht_cents, ht: item.line_total_ht_cents, tax: item.line_tax_cents, ttc: item.line_total_ttc_cents,
    });
    expect(numericView(saved.items.find((item) => item.id === line.id)!)).toEqual(numericView(original));
    const untouched = saved.items.find((item) => item.id === lines[1].id)!;
    const originalUntouched = before.items.find((item) => item.id === lines[1].id)!;
    expect(untouched).toMatchObject({ id: originalUntouched.id, title: originalUntouched.title,
      parent_id: originalUntouched.parent_id, position: originalUntouched.position });
    expect(numericView(untouched)).toEqual(numericView(originalUntouched));
    await browser.reload();
    await expect(grid(ui)).toBeVisible();
    await expect(row(ui, line.id).getByTestId("estimate-line-title-input")).toHaveValue(updatedTitle);
    const reloaded = await readEstimate(browser, ids.versionId);
    expect(reloaded.items.find((item) => item.id === line.id)?.title).toBe(updatedTitle);
    expect(numericView(reloaded.items.find((item) => item.id === line.id)!)).toEqual(numericView(original));
    expect(reloaded.items.filter((item) => item.item_type === "line").map((item) => item.id).sort())
      .toEqual(lines.map((item) => item.id).sort());
    await recordEvidence(army, "lep04-inline-readonly-reloaded", {
      ...ids, lineId: line.id, expectedTitle: updatedTitle, original,
      readOnly: { puBefore, totalBefore, keys: ["9 on PU cell", "9 on total cell", "9 on read-only PU input"] },
      editKeys: ["double-click selects the entire title", "R replaces from gridcell", "Escape restores", "F2", "ControlOrMeta+A then N", "ControlOrMeta+Z restores edit initial value", "Enter commits and moves down"],
      saved, reloaded,
    });
  });

armyTest("LEP05 keyboard drag, undo and redo persist the exact sibling order and positions after reload", options,
  async ({ app, screen, browser, army }) => {
    const ui = { app, screen, browser };
    const { ids, lines } = await prepare(ui, army, "LEP05", 3);
    await openSeededEditor(ui, ids);
    const parentId = lines[0].parent_id!;
    const originalIds = lines.map((item) => item.id);
    const movedIds = [lines[1].id, lines[0].id, lines[2].id];
    const before = await readEstimate(browser, ids.versionId);
    const slots = before.items.filter((item) => item.parent_id === parentId)
      .sort((left, right) => left.position - right.position).map((item) => item.position);
    expect(slots).toHaveLength(3);
    expect(new Set(slots).size).toBe(3);
    const domOrder = () => browser.evaluate(() => Array.from(document.querySelectorAll(
      '[data-testid="estimate-line-row"][data-estimate-item-id]',
    )).map((element) => element.getAttribute("data-estimate-item-id")));
    const placement = (snapshot: ArmyEstimate) => snapshot.items.filter((item) => item.parent_id === parentId)
      .sort((left, right) => left.position - right.position)
      .map((item) => ({ id: item.id, parentId: item.parent_id, position: item.position }));
    const expectedPlacement = (order: string[]) => order.map((id, index) => ({ id, parentId, position: slots[index] }));
    const observations: Array<{ step: string; expected: unknown; actual: unknown; domOrder: unknown }> = [];
    const assertOrder = async (step: string, expected: string[]) => {
      try {
        await expect.poll(domOrder).toEqual(expected);
        await expect.poll(async () => placement(await readEstimate(browser, ids.versionId)), { timeout: 30_000, interval: 500 })
          .toEqual(expectedPlacement(expected));
      } finally {
        observations.push({ step, expected: expectedPlacement(expected), actual: placement(await readEstimate(browser, ids.versionId)), domOrder: await domOrder() });
        await recordEvidence(army, "lep05-keyboard-reorder-observations", { ...ids, parentId, observations });
      }
    };
    await assertOrder("initial", originalIds);
    const handle = row(ui, lines[0].id).getByRole("button", "Glisser pour réordonner", { exact: true });
    const dragObservation = await observeKeyboardDrag(ui, army, ids);
    try {
      await handle.focus();
      await handle.press("Space");
      await expect(handle).toHaveAttribute("aria-pressed", "true");
      // KeyboardSensor starts before it installs its keydown listener and before
      // DndContext measures droppable rectangles. Its initial collision proves
      // those rectangles are ready; sending ArrowDown at aria-pressed alone can
      // lose that key. This is readiness, not the reorder's business oracle.
      await expect(screen.getByRole("status").filter({ hasText: `was moved over droppable area ${lines[0].id}` })).toBeAttached();
      await dragObservation.waitForReady();
      await browser.keyboard.press("ArrowDown");
      await expect.poll(() => browser.evaluate((id) => {
        const movingRow = document.querySelector(`[data-estimate-item-id="${id}"]`);
        if (!movingRow) return null;
        const transform = getComputedStyle(movingRow).transform;
        return transform === "none" ? 0 : new DOMMatrixReadOnly(transform).m42;
      }, lines[0].id), { message: "ArrowDown must move the actual dragged row before Space drops it" }).toBeGreaterThan(0);
      await browser.keyboard.press("Space");
      await expect(handle).not.toHaveAttribute("aria-pressed", "true");
      await assertOrder("keyboard drag", movedIds);
    } finally {
      await dragObservation.finish();
    }
    const undo = screen.getByTestId("estimate-editor-undo-button", { visible: true });
    await expect(undo).toBeEnabled();
    await undo.click();
    await assertOrder("undo", originalIds);
    const redo = screen.getByTestId("estimate-editor-redo-button", { visible: true });
    await expect(redo).toBeEnabled();
    await redo.click();
    await assertOrder("redo", movedIds);
    await expect(undo).toBeEnabled();
    await reloadAcknowledgedEditor(ui, army, ids, "lep05");
    await assertOrder("reload", movedIds);
    const reloaded = await readEstimate(browser, ids.versionId);
    const inputs = (item: ArmyItem) => [item.title, item.quantity, item.unit_price_ht_cents, item.h_mo,
      item.h_mo_majoration, item.k_fo, item.k_mo, item.line_total_ht_cents, item.line_tax_cents, item.line_total_ttc_cents];
    for (const line of lines) expect(inputs(reloaded.items.find((item) => item.id === line.id)!))
      .toEqual(inputs(before.items.find((item) => item.id === line.id)!));
    expect([reloaded.version.total_ht_cents, reloaded.version.total_tax_cents, reloaded.version.total_ttc_cents])
      .toEqual([before.version.total_ht_cents, before.version.total_tax_cents, before.version.total_ttc_cents]);
    await recordEvidence(army, "lep05-keyboard-reorder-reloaded", {
      ...ids, parentId, inputMethod: "Space, ArrowDown, Space on the real drag handle", originalIds, movedIds, slots, observations, reloaded,
    });
  });
