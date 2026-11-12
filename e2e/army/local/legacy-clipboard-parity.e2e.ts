import { randomUUID } from "node:crypto";
import type { Browser } from "@e2e-dev/web";
import { expect, type App, type Screen } from "e2e";

import {
  apiRequest, armyTest, createLineViaApi, readEstimate, recordEvidence, saveLineEditsWithShortcut,
  type ArmyEstimate, type ArmyItem, type ArmyState,
} from "../critical/fixtures";
import { waitForDraftLease } from "./engine-v3-editor-support";
import { connectedEstimate } from "../extended/connected-support";
import { signUpDedicatedOwner } from "./dedicated-owner";
import { querySql } from "./calculation-gate-support";

type Ui = { app: App; browser: Browser; screen: Screen };
const options = { session: "army", tags: ["critical", "local", "legacy-clipboard"], timeout: 240_000 } as const;
const headers = ["Désignation", "Quantité", "Unité", "Prix unitaire HT", "Type FO", "K FO", "h/u", "K MO", "Majoration MO (%)"];
const gridName = "Lignes de devis";
const previewName = "Aperçu du collage";

// Gaps beyond numeric-entry's invalid-price paste and V3E13's insertion/undo:
// actual Ctrl+C -> Ctrl+V must retain the complete TSV, duplicate mappings must
// prevent writes, and excluding an invalid row must persist exactly one valid
// row and close the dialog without help. No application function or clipboard
// implementation is replaced. Only the second input uses a real DOM paste event,
// as the existing Army paste journeys do; CLIP01 uses the browser clipboard.
async function prepare(ui: Ui, army: ArmyState, suffix: string, manualKfo?: number) {
  await ui.app.open("/dashboard/affaires");
  const owner = await signUpDedicatedOwner(ui.browser, ui.app.baseUrl!, army.runPrefix,
    { tag: suffix === "copie TSV" ? "LGCLIP1" : suffix === "grand collage" ? "LGCLIP5" : "LGCLIP2", uiMode: "expert", calcPolicy: "absent" });
  const observation = ui.browser.waitForResponse("**/api/estimates").then(async (response) => {
    const body = await response.json<{ ok: boolean; data?: ArmyEstimate; error?: { code: string; message: string } }>();
    await recordEvidence(army, "clipboard-v3-creation-response", { status: response.status, ok: body.ok, error: body.error ?? null,
      projectId: body.data?.project.id ?? null, versionId: body.data?.version.id ?? null,
      engine: body.data?.version.calc_engine_version ?? null, expectedEngine: 3, stage: "before any draft lock is acquired" });
    expect(response.status).toBe(201);
    expect(body.ok).toBe(true);
  });
  const [creation, observed] = await Promise.allSettled([
    connectedEstimate({ ...ui, army }, suffix, { expected_calc_engine_version: 3, margin_multiplier: 1, tax_rate_bp: 2000 }), observation,
  ]);
  if (observed.status === "rejected") throw observed.reason;
  if (creation.status === "rejected") throw creation.reason;
  const created = creation.value;
  expect(created.version.calc_engine_version).toBe(3);
  const ids = { projectId: created.project.id, versionId: created.version.id };
  const title = `${army.runPrefix} ${suffix} origine`;
  const seed = await createLineViaApi(ui.browser, ids.versionId, title, {
    quantity: 2.5, unit_price_ht_cents: 1250, unit_code: "u", pricing_status: "priced",
    description: null, h_mo_per_unit: null, h_mo: 0, k_fo: 1, k_mo: 1, h_mo_majoration: 1,
    ...(manualKfo === undefined ? {} : { k_fo: manualKfo, k_fo_manual: true }),
  });
  const released = await apiRequest(ui.browser, "DELETE", `/api/estimates/${ids.versionId}/lock`);
  expect(released.status).toBe(200);
  await ui.app.open(`/dashboard/estimates/${ids.versionId}/edit`);
  await expect(ui.screen.getByRole("grid", gridName, { exact: true })).toBeVisible();
  await waitForDraftLease(ui);
  const before = await readEstimate(ui.browser, ids.versionId);
  expect(before.version.calc_engine_version).toBe(3);
  // The nine-column TSV has no VAT column: a paste inherits the version rate.
  // Equal source/version rates make the copied monetary values comparable
  // without claiming that a line-specific VAT rate is copied.
  expect(before.version.tax_rate_bp).toBe(2000);
  expect(before.items.find((item) => item.id === seed.id)?.tax_rate_bp).toBe(2000);
  expect(before.items.filter((item) => item.item_type === "line").map((item) => item.id)).toEqual([seed.id]);
  return { ...ids, owner, seed, before };
}

async function focusGridCell(ui: Ui, id: string) {
  await ui.browser.locator(`[data-cell-id="${id}::title"]`).focus();
  await expect.poll(() => ui.browser.evaluate((cellId) => {
    const active = document.activeElement;
    return active instanceof HTMLElement && active.getAttribute("data-cell-id") === `${cellId}::title` &&
      !active.matches("input, textarea, [contenteditable=true]");
  }, id)).toBe(true);
}

// A real DOM paste event on the grid, as LEGCLIP02 and the other Army paste
// journeys dispatch it; the application's parser, preview and writes run as is.
async function dispatchGridPaste(browser: Browser, tsv: string) {
  await browser.evaluate((text) => {
    const grid = document.querySelector('[role="grid"][aria-label="Lignes de devis"]');
    if (!(grid instanceof HTMLElement)) throw new Error("Estimate paste target missing.");
    const data = new DataTransfer();
    data.setData("text/plain", text);
    grid.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
    return true;
  }, tsv);
}

async function observeNativeCopy(browser: Browser) {
  await browser.evaluate(() => {
    const scope = window as typeof window & { __legacyClipboardAck?: {
      asyncFulfilled: number; fallbackSucceeded: number; text: string | null; errors: string[];
    } };
    const observed = { asyncFulfilled: 0, fallbackSucceeded: 0, text: null as string | null, errors: [] as string[] };
    scope.__legacyClipboardAck = observed;
    if (navigator.clipboard?.writeText) {
      const writeText = navigator.clipboard.writeText.bind(navigator.clipboard);
      Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async (text: string) => {
        try {
          // Forward the actual native write; this wrapper only acknowledges its
          // completion. Ctrl+V below still consumes the operating-system data.
          await writeText(text);
          observed.text = text;
          observed.asyncFulfilled++;
        } catch (error) {
          observed.errors.push(error instanceof Error ? error.name : "UnknownError");
          throw error;
        }
      } });
    }
    const execCommand = document.execCommand.bind(document);
    document.execCommand = (command, showUi, value) => {
      const source = document.activeElement;
      const text = source instanceof HTMLTextAreaElement ? source.value : String(window.getSelection() ?? "");
      const result = execCommand(command, showUi, value);
      if (command.toLowerCase() === "copy" && result) {
        observed.text = text;
        observed.fallbackSucceeded++;
      }
      return result;
    };
    return true;
  });
  return () => browser.evaluate(() => {
    const state = (window as typeof window & { __legacyClipboardAck?: {
      asyncFulfilled: number; fallbackSucceeded: number; text: string | null; errors: string[];
    } }).__legacyClipboardAck;
    if (!state) throw new Error("Native clipboard observation is missing.");
    return state;
  });
}

function inputs(item: ArmyItem) {
  return Object.fromEntries([
    "quantity", "unit_code", "pricing_status", "unit_price_ht_cents", "k_fo", "k_mo", "h_mo_per_unit",
    "h_mo_majoration", "tax_rate_bp",
  ].map((field) => [field, item[field]]));
}

function amounts(item: ArmyItem) {
  return [item.line_total_ht_cents, item.line_tax_cents, item.line_total_ttc_cents];
}

async function previewTable(browser: Browser) {
  return browser.evaluate(() => {
    const dialog = document.querySelector('[data-testid="paste-preview-dialog"]');
    if (!dialog) throw new Error("Clipboard preview missing.");
    const columns = Array.from(dialog.querySelectorAll('[data-testid="paste-preview-mapping-table"] tbody tr'))
      .map((row) => row.querySelector("td")?.textContent?.trim() ?? "");
    const rows = Array.from(dialog.querySelectorAll('[data-testid="paste-preview-rows-table"] tbody tr'))
      .map((row) => Array.from(row.querySelectorAll("td")).slice(2, 2 + columns.length)
        .map((cell) => cell.textContent?.trim() ?? ""));
    return { columns, rows };
  });
}

armyTest("LEGCLIP01 real clipboard Ctrl+C and Ctrl+V preserve all v3 TSV fields and the persisted copy", options,
  async ({ app, browser, screen, army }) => {
    const ui = { app, browser, screen };
    // Pin the manual K FO to retain the odd-cent VAT allocation counterexample below.
    const draft = await prepare(ui, army, "copie TSV", 1.01);
    const copyObservation = await observeNativeCopy(browser);
    const checkbox = screen.getByLabel(`Sélectionner la ligne ${draft.seed.title}`, { exact: true });
    await checkbox.check();
    await expect(checkbox).toBeChecked();
    await expect(screen.getByTestId("estimate-editor-bulk-selection-bar")).toBeVisible();
    await expect(screen.getByText("1 ligne sélectionnée", { exact: true })).toBeVisible();
    await browser.keyboard.press("ControlOrMeta+c");
    await expect.poll(async () => {
      const state = await copyObservation();
      return state.asyncFulfilled + state.fallbackSucceeded;
    }, { message: "The real async clipboard write or native copy fallback must finish before Ctrl+V" }).toBe(1);
    const copied = await copyObservation();
    expect(copied.text).toBe([headers.join("\t"), [draft.seed.title, "2,5", "u", "12,5", "", "1,01", "", "1", "100"].join("\t")].join("\n"));
    await recordEvidence(army, "legacy-native-copy-ack", { versionId: draft.versionId, sourceLineId: draft.seed.id, copied });
    await browser.keyboard.press("Escape");
    await focusGridCell(ui, draft.seed.id);
    // Ctrl+V consumes the clipboard the application's Ctrl+C wrote. A missing
    // native clipboard fails this journey rather than replacing it with a stub.
    await browser.keyboard.press("ControlOrMeta+v");
    const dialog = screen.getByRole("dialog", previewName, { exact: true });
    await expect(dialog).toBeVisible();
    const table = await previewTable(browser);
    expect(table).toEqual({
      columns: headers,
      rows: [[draft.seed.title, "2,5", "u", "12,5", "", "1,01", "", "1", "100"]],
    });
    await expect(dialog.getByLabel("Inclure la ligne 2", { exact: true })).toBeChecked();
    await expect(dialog.getByTestId("paste-preview-dialog-confirm-button")).toBeEnabled();
    const unchanged = await readEstimate(browser, draft.versionId);
    expect(unchanged.items).toEqual(draft.before.items);
    await dialog.getByTestId("paste-preview-dialog-confirm-button").click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await readEstimate(browser, draft.versionId)).items.filter((item) => item.item_type === "line").length).toBe(2);
    await browser.reload();
    await expect(screen.getByRole("grid", gridName, { exact: true })).toBeVisible();
    const after = await readEstimate(browser, draft.versionId);
    const lines = after.items.filter((item) => item.item_type === "line");
    expect(lines).toHaveLength(2);
    expect(lines.map((item) => item.title)).toEqual([draft.seed.title, draft.seed.title]);
    const original = lines.find((item) => item.id === draft.seed.id)!;
    const copiedLine = lines.find((item) => item.id !== draft.seed.id)!;
    expect(inputs(original)).toEqual(inputs(draft.before.items.find((item) => item.id === draft.seed.id)!));
    expect(inputs(copiedLine)).toEqual(inputs(original));
    expect(amounts(draft.before.items.find((item) => item.id === draft.seed.id)!)).toEqual([4103, 821, 4924]);
    // V3 rounds VAT once for the full rate group, then allocates its remainder
    // by ascending UUID. A copied row preserves inputs, not the old allocation:
    // 20% of 8206 rounds to 1641, so two independently rounded 821s are wrong.
    // Both rows carry the explicit unified K FO 1.01 (TI-534).
    const byUuid = [...lines].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    expect(byUuid.map(amounts)).toEqual([[4103, 821, 4924], [4103, 820, 4923]]);
    expect(after.version).toMatchObject({ total_ht_cents: 8206, total_tax_cents: 1641, total_ttc_cents: 9847,
      discount_bp: 0, rounding_mode: "none", rounding_adjustment_cents: 0, sale_coefficient_fo: 1.3 });
    expect(lines.reduce((sum, item) => sum + item.line_tax_cents!, 0)).toBe(after.version.total_tax_cents);
    await recordEvidence(army, "legacy-clipboard-real-copy", {
      ids: { projectId: draft.projectId, versionId: draft.versionId }, owner: draft.owner, clipboard: "real ControlOrMeta+c then ControlOrMeta+v",
      observedCopy: copied, observedPreview: table, before: draft.before, after, originalId: original.id, copiedId: copiedLine.id,
      expectedByAscendingUuid: { ids: byUuid.map((item) => item.id), amounts: [[4103, 821, 4924], [4103, 820, 4923]], document: [8206, 1641, 9847] },
    });
  });

armyTest("LEGCLIP02 duplicate mapping and included invalid rows block paste; exclusion inserts exactly one valid row and closes", options,
  async ({ app, browser, screen, army }) => {
    const ui = { app, browser, screen };
    const draft = await prepare(ui, army, "mapping TSV");
    const valid = `${army.runPrefix} porte coupe-feu`;
    const invalid = `${army.runPrefix} quantité invalide`;
    const tsv = [headers.join("\t"),
      [valid, "2", "u", "125,50", "", "1", "", "1", "100"].join("\t"),
      [invalid, "abc", "u", "80", "", "1", "", "1", "100"].join("\t"),
    ].join("\n");
    await focusGridCell(ui, draft.seed.id);
    await browser.evaluate((text) => {
      const grid = document.querySelector('[role="grid"][aria-label="Lignes de devis"]');
      if (!(grid instanceof HTMLElement)) throw new Error("Estimate paste target missing.");
      const data = new DataTransfer();
      data.setData("text/plain", text);
      grid.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: data }));
      return true;
    }, tsv);
    const dialog = screen.getByRole("dialog", previewName, { exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("BDC", { exact: true })).toBeVisible();
    await expect(dialog.getByTestId("paste-preview-row-invalid-reason")).toContainText("Nombre invalide");
    const confirm = dialog.getByTestId("paste-preview-dialog-confirm-button");
    const invalidRow = dialog.getByLabel("Inclure la ligne 3", { exact: true });
    await invalidRow.check();
    await expect(confirm).toBeDisabled();
    expect((await readEstimate(browser, draft.versionId)).items).toEqual(draft.before.items);
    await invalidRow.uncheck();
    await expect(confirm).toBeEnabled();

    const quantityMapping = dialog.getByLabel("Champ cible de la colonne Quantité", { exact: true });
    await quantityMapping.selectOption({ value: "designation" });
    await expect(dialog.getByTestId("paste-preview-dialog-duplicate-mapping-error")).toBeVisible();
    await expect(confirm).toBeDisabled();
    expect((await readEstimate(browser, draft.versionId)).items).toEqual(draft.before.items);
    await quantityMapping.selectOption({ value: "quantity" });
    await expect(dialog.getByTestId("paste-preview-dialog-duplicate-mapping-error")).toHaveCount(0);
    await expect(dialog.getByText("1/2 ligne(s) incluse(s)", { exact: true })).toBeVisible();
    await expect(confirm).toBeEnabled();
    const preview = await previewTable(browser);
    await confirm.click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await readEstimate(browser, draft.versionId)).items.filter((item) => item.item_type === "line").length).toBe(2);
    await browser.reload();
    await expect(screen.getByRole("grid", gridName, { exact: true })).toBeVisible();
    const after = await readEstimate(browser, draft.versionId);
    const lines = after.items.filter((item) => item.item_type === "line");
    expect(lines).toHaveLength(2);
    expect(lines.filter((item) => item.title === valid)).toHaveLength(1);
    expect(lines.some((item) => item.title === invalid)).toBe(false);
    expect(inputs(lines.find((item) => item.id === draft.seed.id)!)).toEqual(inputs(draft.before.items.find((item) => item.id === draft.seed.id)!));
    expect(amounts(lines.find((item) => item.id === draft.seed.id)!)).toEqual(amounts(draft.before.items.find((item) => item.id === draft.seed.id)!));
    const pasted = lines.find((item) => item.title === valid)!;
    expect([pasted.quantity, pasted.unit_code, pasted.pricing_status, pasted.unit_price_ht_cents]).toEqual([2, "u", "priced", 12550]);
    expect(pasted).toMatchObject({ k_fo: 1, k_fo_manual: true, fo_provision: 1 });
    await recordEvidence(army, "legacy-clipboard-mapping-exclusion", {
      ids: { projectId: draft.projectId, versionId: draft.versionId }, input: tsv, preview, before: draft.before, after,
      expected: { inserted: 1, quantity: 2, unit: "u", priceCents: 12550, excludedTitle: invalid, originalId: draft.seed.id },
    });
  });


armyTest("LEGCLIP03 real clipboard preserves the six-decimal precision of a manual K FO", options,
  async ({ app, browser, screen, army }) => {
    const ui = { app, browser, screen };
    const draft = await prepare(ui, army, "précision K FO", 1.073501);
    const observeCopy = await observeNativeCopy(browser);
    await screen.getByLabel(`Sélectionner la ligne ${draft.seed.title}`, { exact: true }).check();
    await browser.keyboard.press("ControlOrMeta+c");
    await expect.poll(async () => {
      const copied = await observeCopy();
      return copied.asyncFulfilled + copied.fallbackSucceeded;
    }).toBe(1);
    expect((await observeCopy()).text).toContain("\t1,073501\t");
    await browser.keyboard.press("Escape");
    await focusGridCell(ui, draft.seed.id);
    await browser.keyboard.press("ControlOrMeta+v");
    const dialog = screen.getByRole("dialog", previewName, { exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Inclure la ligne 2", { exact: true })).toBeChecked();
    await expect(dialog.getByTestId("paste-preview-dialog-confirm-button")).toBeEnabled();
    await dialog.getByTestId("paste-preview-dialog-confirm-button").click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await readEstimate(browser, draft.versionId)).items
      .filter((item) => item.item_type === "line").length).toBe(2);
    await browser.reload();
    await expect(screen.getByRole("grid", gridName, { exact: true })).toBeVisible();
    const after = await readEstimate(browser, draft.versionId);
    const lines = after.items.filter((item) => item.item_type === "line");
    expect(lines).toHaveLength(2);
    expect(lines.map((item) => ({ k_fo: item.k_fo, k_fo_manual: item.k_fo_manual, fo_provision: item.fo_provision })))
      .toEqual([{ k_fo: 1.073501, k_fo_manual: true, fo_provision: 1 }, { k_fo: 1.073501, k_fo_manual: true, fo_provision: 1 }]);
    expect(inputs(lines.find((item) => item.id !== draft.seed.id)!)).toEqual(inputs(draft.before.items.find((item) => item.id === draft.seed.id)!));
    await recordEvidence(army, "clipboard-six-decimal-kfo", { before: draft.before, after });
  });


armyTest("LEGCLIP04 copying a historical effective K FO and a manual one preserves their prices", options,
  async ({ app, browser, screen, army }) => {
    const ui = { app, browser, screen };
    const draft = await prepare(ui, army, "historique K FO", 1);
    const legacyId = randomUUID();
    const legacyTitle = `${army.runPrefix} historical supply`;
    // Owned legacy fixture: the old factors must stay unchanged on the source.
    await querySql(`select set_config('miaouffrage.estimate_v3_writer','${draft.versionId}',false);
      insert into public.estimate_items(id,version_id,parent_id,item_type,position,title,quantity,unit_price_ht_cents,k_fo,fo_provision,unit_code,pricing_status,tax_rate_bp,k_mo,h_mo_per_unit,pu_ht_cents,line_total_ht_cents,line_tax_cents,line_total_ttc_cents)
      values('${legacyId}','${draft.versionId}','${draft.seed.parent_id}','line',2,'${legacyTitle}',2.5,1250,1.003,1.03,'u','priced',2000,1,0,0,0,0,0);`);
    const manualTitle = draft.seed.title;
    await browser.reload();
    await expect(screen.getByRole("grid", gridName, { exact: true })).toBeVisible();
    await waitForDraftLease(ui);
    // Reprice through the ordinary writer; a title-only save intentionally leaves cached money unchanged.
    const quantity = screen.getByLabel(`Quantité pour ${legacyTitle}`, { exact: true });
    for (const value of ["2,6", "2,5"]) {
      await quantity.fill(value);
      await quantity.press("Tab");
      await saveLineEditsWithShortcut(ui, draft.versionId, legacyTitle, army);
      await expect.poll(async () => {
        const line = (await readEstimate(browser, draft.versionId)).items.find(row => row.id === legacyId)!;
        return [line.quantity, line.pu_ht_cents, line.line_total_ht_cents];
      }).toEqual(value === "2,6" ? [2.6, 1679, 4365] : [2.5, 1679, 4198]);
    }
    const before = await readEstimate(browser, draft.versionId);
    expect(before.items.find(row => row.id === legacyId)).toMatchObject({ pu_ht_cents: 1679, line_total_ht_cents: 4198 });
    expect(before.version).toMatchObject({ total_ht_cents: 8261, total_tax_cents: 1652, total_ttc_cents: 9913 });
    const observeCopy = await observeNativeCopy(browser);
    for (const title of [manualTitle, legacyTitle]) await screen.getByLabel(`Sélectionner la ligne ${title}`, { exact: true }).check();
    await browser.keyboard.press("ControlOrMeta+c");
    await expect.poll(async () => {
      const copied = await observeCopy(); return copied.asyncFulfilled + copied.fallbackSucceeded;
    }).toBe(1);
    const tsv = (await observeCopy()).text!;
    expect(tsv.split("\n").find(row => row.startsWith(`${legacyTitle}\t`))?.split("\t")[5]).toBe("1,03309");
    expect(tsv.split("\n").find(row => row.startsWith(`${manualTitle}\t`))?.split("\t")[5]).toBe("1");
    await browser.keyboard.press("Escape");
    await focusGridCell(ui, draft.seed.id);
    await browser.keyboard.press("ControlOrMeta+v");
    const dialog = screen.getByRole("dialog", previewName, { exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("paste-preview-dialog-confirm-button")).toBeEnabled();
    await dialog.getByTestId("paste-preview-dialog-confirm-button").click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await readEstimate(browser, draft.versionId)).items.filter(row => row.item_type === "line").length).toBe(4);
    await browser.reload();
    await expect(screen.getByRole("grid", gridName, { exact: true })).toBeVisible();
    const after = await readEstimate(browser, draft.versionId);
    expect(after.items.find(row => row.id === legacyId)).toMatchObject({ k_fo: 1.003, fo_provision: 1.03, k_fo_manual: null });
    for (const [title, id, kfo] of [[manualTitle, draft.seed.id, 1], [legacyTitle, legacyId, 1.03309]] as const) {
      const source = before.items.find(row => row.id === id)!;
      const copied = after.items.find(row => row.item_type === "line" && row.title === title && row.id !== id)!;
      expect(copied).toMatchObject({ k_fo: kfo, fo_provision: 1, k_fo_manual: true,
        quantity: source.quantity, unit_price_ht_cents: source.unit_price_ht_cents,
        pu_ht_cents: source.pu_ht_cents, line_total_ht_cents: source.line_total_ht_cents });
    }
    expect(after.version.total_ht_cents).toBe(before.version.total_ht_cents * 2);
    await recordEvidence(army, "clipboard-historical-and-neutral-kfo", { before, after, tsv });
  });


// From 50 rows the preview mounts a window of rows (PastePreviewRowsTable).
// A 200-row paste proves the structural bound, the full-row counts and Confirm
// gating, keyboard access across the initial window, a far row reached by
// scrolling, the focused row kept mounted when scrolled away, and that the
// persisted rows are exactly the included ones. No time threshold here: the
// timings are measured on demand (docs/testing/tester-army-performance.md).
armyTest("LEGCLIP05 a 200-row paste mounts a bounded accessible window and persists exactly the included rows", options,
  async ({ app, browser, screen, army }) => {
    const ui = { app, browser, screen };
    const draft = await prepare(ui, army, "grand collage");
    const lineNumbers = Array.from({ length: 200 }, (_, index) => index + 2);
    const invalidLine = 201;
    const title = (line: number) => `${army.runPrefix} L${line}`;
    const tsv = [headers.join("\t"), ...lineNumbers.map((line) =>
      [title(line), line === invalidLine ? "abc" : String(line), "u", "10", "", "1", "", "1", "100"].join("\t"))].join("\n");
    const included = (excluded: number) => `${lineNumbers.length - excluded}/${lineNumbers.length} ligne(s) incluse(s)`;
    await focusGridCell(ui, draft.seed.id);
    await dispatchGridPaste(browser, tsv);
    const dialog = screen.getByRole("dialog", previewName, { exact: true });
    await expect(dialog).toBeVisible();
    // The invalid line is excluded by default, from data, although it is not mounted.
    await expect(dialog.getByText(included(1), { exact: true })).toBeVisible();
    await expect(dialog.getByTestId("paste-preview-dialog-close-button")).toBeFocused();

    const structure = await browser.evaluate(() => {
      const region = document.querySelector('[data-testid="paste-preview-rows-table"]');
      if (!(region instanceof HTMLElement)) throw new Error("Paste preview rows missing.");
      return {
        mountedRows: region.querySelectorAll('tbody tr:not([aria-hidden="true"])').length,
        rowCount: region.querySelector("table")?.getAttribute("aria-rowcount") ?? null,
      };
    });
    expect(structure.mountedRows).toBeGreaterThan(0);
    expect(structure.mountedRows).toBeLessThanOrEqual(40);
    expect(structure.rowCount).toBe(String(lineNumbers.length + 1));

    const confirm = dialog.getByTestId("paste-preview-dialog-confirm-button");
    const firstRow = dialog.getByLabel("Inclure la ligne 2", { exact: true });
    await firstRow.focus();
    await browser.keyboard.press("Space");
    await expect(firstRow).not.toBeChecked();
    await expect(dialog.getByText(included(2), { exact: true })).toBeVisible();
    // One tabbable per row: Tab walks the rows past the initial window.
    for (let press = 0; press < 20; press += 1) await browser.keyboard.press("Tab");
    await expect(dialog.getByLabel("Inclure la ligne 22", { exact: true })).toBeFocused();

    // The last row exists only once the region is scrolled to it; the scroll is
    // repeated while measured rows grow the table under the estimate.
    await expect.poll(() => browser.evaluate((label) => {
      const region = document.querySelector('[data-testid="paste-preview-rows-table"]');
      if (!(region instanceof HTMLElement)) throw new Error("Paste preview rows missing.");
      region.scrollTop = region.scrollHeight;
      return region.querySelector(`[aria-label="${label}"]`) !== null;
    }, `Inclure la ligne ${invalidLine}`)).toBe(true);
    const lastRow = dialog.getByLabel(`Inclure la ligne ${invalidLine}`, { exact: true });
    await expect(lastRow).toBeVisible();
    await lastRow.check();
    await expect(lastRow).toBeChecked();
    await expect(confirm).toBeDisabled();
    await expect(dialog.getByText("1 ligne(s) invalide(s) sont encore incluses.", { exact: true })).toBeVisible();

    // Scrolled back to the top, the focused last row stays mounted and focused.
    await browser.evaluate(() => {
      const region = document.querySelector('[data-testid="paste-preview-rows-table"]');
      if (!(region instanceof HTMLElement)) throw new Error("Paste preview rows missing.");
      region.scrollTop = 0;
      return true;
    });
    await expect(dialog.getByLabel("Inclure la ligne 3", { exact: true })).toBeVisible();
    await expect(lastRow).toBeFocused();
    await browser.keyboard.press("Space");
    await expect(lastRow).not.toBeChecked();
    await expect(confirm).toBeEnabled();
    await expect(dialog.getByText(included(2), { exact: true })).toBeVisible();
    expect((await readEstimate(browser, draft.versionId)).items).toEqual(draft.before.items);

    await confirm.click();
    await expect(dialog).toBeHidden();
    const expectedLines = 1 + lineNumbers.length - 2;
    await expect.poll(async () => (await readEstimate(browser, draft.versionId)).items
      .filter((item) => item.item_type === "line").length, { timeout: 60_000 }).toBe(expectedLines);
    const after = await readEstimate(browser, draft.versionId);
    const lines = after.items.filter((item) => item.item_type === "line");
    const titles = new Set(lines.map((item) => item.title));
    expect(titles.has(title(2))).toBe(false);
    expect(titles.has(title(invalidLine))).toBe(false);
    expect(titles.has(title(3))).toBe(true);
    expect(lines.find((item) => item.title === title(200))?.quantity).toBe(200);
    expect(lines.filter((item) => item.title.startsWith(`${army.runPrefix} L`))).toHaveLength(lineNumbers.length - 2);
    await recordEvidence(army, "legclip05-window", {
      ids: { projectId: draft.projectId, versionId: draft.versionId }, owner: draft.owner,
      mountedRows: structure.mountedRows, rowCount: lineNumbers.length, ariaRowCount: structure.rowCount,
      persistedLines: lines.length, excluded: [title(2), title(invalidLine)],
    });
  });
