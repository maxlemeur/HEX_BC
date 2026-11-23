import { expect } from "e2e";

import { armyTest, recordEvidence, type ArmyEstimate } from "../critical/fixtures";
import {
  openV3Editor, pause, prepareV3Draft, readConsistent, seedLines, waitForDraftLease, type Ui,
} from "./engine-v3-editor-support";

// Editor row shortcuts (owner request of 2026-11-22, on a Mac): ⌘/Ctrl+Entrée adds a line below the active one,
// ⌘/Ctrl+Maj+D duplicates it with all its inputs, ⌘/Ctrl+Maj+Entrée adds a section after the active section and
// ⌥/Alt+Maj+↑/↓ moves the line. Failure modes: the row lands at the end of the section instead of below the active
// line, the copy loses an input (K FO typed by hand, unit, price), a field being typed is lost when the shortcut
// fires from it, the order is not stored (back after a reload), and the insertion cannot be undone in one step.
// Meta (⌘ on a Mac) and Control are both pressed: the editor must answer to either.

const options = (timeout: number) => ({ session: "army", tags: ["critical", "local", "engine-v3", "editor-shortcuts"], timeout }) as const;

const supply = (title: string, quantity: number, prCents: number, extra: Record<string, unknown> = {}) => ({
  line_nature: "supply_only", title, unit_code: "u", pricing_status: "priced", quantity, unit_price_ht_cents: prCents, tax_rate_bp: 2000,
  k_fo: 1, h_mo_per_unit: 0, h_mo_majoration: 1, k_mo: 1, source_provider: "manual", ...extra,
});

const cell = (ui: Ui, id: string, column: string) => ui.browser.locator(`[data-cell-id="${id}::${column}"]`);
const childrenOf = (state: ArmyEstimate, parentId: string | null) => state.items
  .filter((item) => (item.parent_id ?? null) === parentId)
  .sort((left, right) => left.position - right.position);
const titlesOf = (state: ArmyEstimate, parentId: string | null) => childrenOf(state, parentId).map((item) => item.title);
const activeCellId = (ui: Ui) => ui.browser.evaluate(() =>
  document.activeElement?.closest("[data-cell-id]")?.getAttribute("data-cell-id") ?? null);
const COPIED_INPUTS = [
  "line_nature", "quantity", "unit_code", "pricing_status", "unit_price_ht_cents", "k_fo", "k_fo_manual", "fo_provision",
  "h_mo_per_unit", "h_mo_majoration", "k_mo", "tax_rate_bp", "line_total_ht_cents",
] as const;
const inputsOf = (item: Record<string, unknown> | undefined) =>
  Object.fromEntries(COPIED_INPUTS.map((key) => [key, item?.[key] ?? null]));

async function waitState(ui: Ui, versionId: string, ready: (state: ArmyEstimate) => boolean, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let state = await readConsistent(ui, versionId);
  while (!ready(state) && Date.now() < deadline) {
    await pause(500);
    state = await readConsistent(ui, versionId);
  }
  return state;
}

function waitForStoredTitles(ui: Ui, versionId: string, parentId: string, expected: string[]) {
  // The create can already be visible to a GET while the shortcut's separate reorder is still in flight.
  return waitState(ui, versionId, (state) => {
    const actual = titlesOf(state, parentId);
    return actual.length === expected.length && actual.every((title, index) => title === expected[index]);
  });
}

armyTest("ROWKEYS01 keyboard shortcuts add a line below, duplicate a line, move it and add a section: stored in place, kept after a reload, undone in one step",
  options(420_000), async ({ app, screen, browser, army }) => {
    const ui: Ui = { app, screen, browser };
    await browser.onDialog(async (dialog) => { await dialog.accept(); });
    const draft = await prepareV3Draft(ui, army, "ROWKEYS01");
    const title = (ref: string) => `${army.runPrefix} ${ref}`;
    const section = draft.sectionId;
    // A carries a K FO typed by hand (1,15): a copy that took the company base back would show 1,02.
    const [lineA, lineB] = await seedLines(ui, army, draft, "rowkeys01", [
      supply(title("A"), 2, 10000, { k_fo: 1.15, k_fo_manual: true }), supply(title("B"), 1, 5000)]);
    await openV3Editor(ui, army, draft, "rowkeys01");
    await waitForDraftLease(ui);

    // 1. Ctrl+Entrée from A's quantity cell: a blank line right below A, its designation ready to be typed.
    await cell(ui, lineA.id, "quantity").focus();
    await browser.keyboard.press("Control+Enter");
    const insertedTitles = [title("A"), "Nouvelle ligne", title("B")];
    const inserted = await waitForStoredTitles(ui, draft.versionId, section, insertedTitles);
    expect(titlesOf(inserted, section), "Ctrl+Entrée inserts below the active line").toEqual(insertedTitles);
    const lineN = childrenOf(inserted, section)[1];
    await expect.poll(() => activeCellId(ui)).toBe(`${lineN.id}::title`);
    await browser.keyboard.type(title("N"));

    // 2. ⌘+Entrée while the designation is still being typed: the designation is stored, then a line comes below N.
    await browser.keyboard.press("Meta+Enter");
    const typedThenInsertedTitles = [title("A"), title("N"), "Nouvelle ligne", title("B")];
    const typedThenInserted = await waitForStoredTitles(ui, draft.versionId, section, typedThenInsertedTitles);
    expect(titlesOf(typedThenInserted, section), "⌘+Entrée commits the field being typed, then inserts below it")
      .toEqual(typedThenInsertedTitles);
    const lineX = childrenOf(typedThenInserted, section)[2];
    await expect.poll(() => activeCellId(ui)).toBe(`${lineX.id}::title`);
    await browser.keyboard.press("Escape");

    // 3. ⌘+Maj+D from A's price cell: a copy of A right below it, with all its inputs; the price cell of the copy is active.
    await cell(ui, lineA.id, "unit_price").focus();
    await browser.keyboard.press("Meta+Shift+D");
    const duplicatedTitles = [title("A"), ...typedThenInsertedTitles];
    const duplicated = await waitForStoredTitles(ui, draft.versionId, section, duplicatedTitles);
    const copy = childrenOf(duplicated, section)[1];
    const original = duplicated.items.find((item) => item.id === lineA.id);
    const duplicateView = {
      titles: titlesOf(duplicated, section),
      newRow: copy.id !== lineA.id,
      copyInputs: inputsOf(copy as unknown as Record<string, unknown>),
    };
    await recordEvidence(army, "rowkeys01-duplicate", { versionId: draft.versionId, actual: duplicateView });
    expect(duplicateView, "⌘+Maj+D duplicates the line below it with its inputs").toEqual({
      titles: duplicatedTitles,
      newRow: true,
      copyInputs: inputsOf(original as unknown as Record<string, unknown>),
    });
    expect(Number(copy.k_fo), "the K FO typed by hand travels with the copy").toBe(1.15);
    await expect.poll(() => activeCellId(ui)).toBe(`${copy.id}::unit_price`);

    // 4. One undo removes the copy and nothing else.
    await screen.getByTestId("estimate-editor-undo-button", { visible: true }).click();
    const undone = await waitState(ui, draft.versionId, (state) => childrenOf(state, section).length === 4);
    expect(titlesOf(undone, section), "the duplication is undone in one step")
      .toEqual([title("A"), title("N"), "Nouvelle ligne", title("B")]);
    await expect(screen.getByTestId("estimate-editor-redo-button", { visible: true })).toBeEnabled();

    // 5. Alt+Maj+↑ from B: B goes above the blank line, and only B moves.
    await cell(ui, lineB.id, "quantity").focus();
    await browser.keyboard.press("Alt+Shift+ArrowUp");
    const moved = await waitState(ui, draft.versionId, (state) => titlesOf(state, section)[2] === title("B"));
    expect(titlesOf(moved, section), "Alt+Maj+↑ moves the active line up one row")
      .toEqual([title("A"), title("N"), title("B"), "Nouvelle ligne"]);
    await expect.poll(() => activeCellId(ui)).toBe(`${lineB.id}::quantity`);

    // 6. Ctrl+Maj+Entrée from B: a section of the same level right after B's section, its title ready to be typed.
    await browser.keyboard.press("Control+Shift+Enter");
    const withSection = await waitState(ui, draft.versionId, (state) => childrenOf(state, null).length === 2);
    const roots = childrenOf(withSection, null);
    expect([roots.map((item) => item.id)[0], roots[1].item_type, roots[1].title], "Ctrl+Maj+Entrée adds a section after the active one")
      .toEqual([section, "section", "Nouveau lot"]);
    await expect.poll(() => activeCellId(ui)).toBe(`${roots[1].id}::title`);
    await browser.keyboard.press("Escape");

    // 7. After a reload, the grid shows the stored order.
    await browser.reload();
    await waitForDraftLease(ui);
    const gridOrder = () => browser.evaluate(() => Array.from(document.querySelectorAll("[data-estimate-item-id]"))
      .map((row) => row.getAttribute("data-estimate-item-id")));
    const expectedOrder = [section, lineA.id, lineN.id, lineB.id, lineX.id, roots[1].id];
    await expect.poll(gridOrder, { timeout: 30_000 }).toEqual(expectedOrder);
    await recordEvidence(army, "rowkeys01-after-reload", {
      versionId: draft.versionId, expectedOrder, screenshot: await app.screenshot("rowkeys01-after-reload"),
    });
  });
