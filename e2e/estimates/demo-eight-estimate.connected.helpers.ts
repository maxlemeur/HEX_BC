import { expect, type Page } from "@playwright/test";
import { apiJson, assertOwned, ownFixture, type ConnectedRun } from "./demo-eight-connected.helpers";

export type ConnectedEstimate = {
  project: { id: string; name: string };
  version: { id: string; status: string; margin_multiplier: number; total_ht_cents: number;
    total_tax_cents: number; total_ttc_cents: number; updated_at: string; discount_mode: string; discount_steps: number[];
    global_coefficient: number; calc_engine_version: 1 | 2 };
  items: Array<{ id: string; item_type: string; title: string; quantity: number;
    unit_price_ht_cents: number; line_total_ht_cents: number; h_mo_atelier: number | null;
    k_mo_atelier: number | null; labor_role_atelier_id: string | null; h_mo_chantier: number | null;
    k_mo_chantier: number | null; labor_role_chantier_id: string | null }>;
};

export async function createConnectedEstimate(page: Page, run: ConnectedRun, label: string,
  settings: Record<string, unknown> = {}) {
  assertOwned(run);
  const name = `${run.prefix} ${label}`;
  const estimate = await apiJson<ConnectedEstimate>(page, "/api/estimates", { method: "POST", data: {
    creation_mode: "blank", project: { name }, version: {
      title: name, margin_mode: "fixed", margin_multiplier: 1.5, global_coefficient: 1,
      discount_bp: 0, tax_rate_bp: 0, currency: "EUR", rounding_mode: "none", ...settings,
    },
  } });
  await ownFixture(run, "project", estimate.project.id, name);
  await ownFixture(run, "estimate-version", estimate.version.id, name);
  return estimate;
}

export async function openConnectedEstimate(page: Page, versionId: string) {
  const lockResponse = page.waitForResponse((response) => new URL(response.url()).pathname ===
    `/api/estimates/${versionId}/lock` && response.request().method() === "POST");
  await page.goto(`/dashboard/estimates/${versionId}/edit`);
  expect((await lockResponse).ok(), "The editor must acquire its ordinary page lease").toBe(true);
  await expect(page.getByTestId("estimate-editor-table")).toBeVisible();
}

export async function addConnectedSupplyLine(page: Page, run: ConnectedRun, versionId: string,
  values: { quantity?: number; unit_price_ht_cents?: number; label?: string } = {}) {
  assertOwned(run, versionId);
  const sessionId = await page.evaluate((id) => sessionStorage.getItem(
    `__miaouffrageEstimateDraftLockSession:${id}`), versionId);
  expect(sessionId, "Use the normal editor lease, without forcing ownership").toMatch(/^[0-9a-f-]{36}$/i);
  const initial = await apiJson<ConnectedEstimate>(page, `/api/estimates/${versionId}`);
  let section = initial.items.find((item) => item.item_type === "section");
  if (!section) {
    section = (await apiJson<{ item: ConnectedEstimate["items"][number] }>(page,
      `/api/estimates/${versionId}/items`, { method: "POST",
        headers: { "x-estimate-draft-lock-session-id": sessionId! },
        data: { item_type: "section", parent_id: null, title: `${run.prefix} Section fournitures` },
      })).item;
  }
  await ownFixture(run, "estimate-section", section.id, `${run.prefix} Section fournitures`);
  assertOwned(run, versionId, section.id);
  const quantity = values.quantity ?? 3;
  const { label, ...financialValues } = values;
  const line = (await apiJson<{ item: ConnectedEstimate["items"][number] }>(page,
    `/api/estimates/${versionId}/items`, { method: "POST",
      headers: { "x-estimate-draft-lock-session-id": sessionId! }, data: {
        item_type: "line", parent_id: section.id, title: `${run.prefix} ${label ?? "Ligne fournitures"}`, description: "u",
        unit_price_ht_cents: 1000, tax_rate_bp: 0,
        k_fo: 1, h_mo: 0, k_mo: 1, line_nature: "supply_only", ...financialValues, quantity: quantity + 1,
      },
    })).item;
  await ownFixture(run, "estimate-line", line.id, line.title);
  const reloadLease = page.waitForResponse((response) => new URL(response.url()).pathname ===
    `/api/estimates/${versionId}/lock` && response.request().method() === "POST");
  await page.reload();
  expect((await reloadLease).ok(), "Reload must reacquire the ordinary editor lease before input").toBe(true);
  await expect(page.getByTestId("estimate-line-row")).toHaveCount(initial.items.filter((item) => item.item_type === "line").length + 1);
  // API fixture creation does not persist the editor's totals. A real line edit
  // and explicit UI save prepare this fixture; this is not autosave proof.
  const quantityInput = page.getByLabel(`Quantité pour ${line.title}`, { exact: true });
  await expect(quantityInput).toBeEnabled();
  const quantityCell = quantityInput.locator('xpath=ancestor::*[@role="gridcell"][1]');
  run.manifest.quantityFixtureCell = await quantityInput.evaluate((input) => ({
    parentTag: input.parentElement?.tagName, parentRole: input.parentElement?.getAttribute("role"),
    cellTag: input.closest('[role="gridcell"]')?.tagName,
    cellClass: input.closest('[role="gridcell"]')?.className,
    inertAncestor: input.closest("[inert]")?.tagName ?? null,
    disabled: (input as HTMLInputElement).disabled,
  }));
  await quantityInput.evaluate((input) => {
    const cell = input.closest('[role="gridcell"]')!;
    const cellId = cell.getAttribute("data-cell-id")!;
    const diagnostic = { active: true, events: [] as Array<Record<string, unknown>> };
    (window as Window & { quantityFixtureDiagnostic?: typeof diagnostic }).quantityFixtureDiagnostic = diagnostic;
    const describe = (element: Element | null) => element ? {
      tag: element.tagName, role: element.getAttribute("role"), label: element.getAttribute("aria-label"),
      cellId: element.closest("[data-cell-id]")?.getAttribute("data-cell-id"),
    } : null;
    const snapshot = (event: Event | null, phase: string) => {
      const current = document.querySelector(`[data-cell-id="${CSS.escape(cellId)}"]`);
      const rect = current?.getBoundingClientRect();
      const mouse = event instanceof MouseEvent ? event : null;
      return {
        type: event?.type ?? "before", phase, target: describe(event?.target instanceof Element ? event.target : null),
        active: describe(document.activeElement),
        cell: rect ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height } : null,
        tableTop: document.querySelector('[data-testid="estimate-editor-table-scroll"]')?.getBoundingClientRect().top,
        point: mouse ? { x: mouse.clientX, y: mouse.clientY, button: mouse.button,
          hit: describe(document.elementFromPoint(mouse.clientX, mouse.clientY)) } : null,
        inputConnected: input.isConnected, focused: document.activeElement === input,
        opacity: getComputedStyle(input).opacity, defaultPrevented: event?.defaultPrevented,
      };
    };
    diagnostic.events.push(snapshot(null, "before"));
    for (const type of ["pointerdown", "mousedown", "mouseup", "click", "dblclick", "focusin", "focusout"]) {
      document.addEventListener(type, (event) => {
        if (!diagnostic.active || diagnostic.events.length > 80) return;
        diagnostic.events.push(snapshot(event, "capture"));
        if (type === "mousedown") {
          window.requestAnimationFrame(() => {
            if (diagnostic.active) diagnostic.events.push(snapshot(event, "frame-after-mousedown"));
          });
        }
      }, { capture: true });
    }
  });
  // The first ordinary click must enter editing without a layout shift or
  // a fallback interaction. This baseline edit is not autosave proof.
  await quantityCell.click();
  run.manifest.quantityFixturePointerDiagnosis = await page.evaluate(() => {
    const diagnostic = (window as Window & { quantityFixtureDiagnostic?: { active: boolean; events: unknown[] } }).quantityFixtureDiagnostic;
    if (!diagnostic) return [];
    diagnostic.active = false;
    return diagnostic.events;
  });
  run.manifest.quantityFixtureAfterClick = await quantityInput.evaluate((input) => ({
    activeTag: document.activeElement?.tagName,
    activeLabel: document.activeElement?.getAttribute("aria-label"),
    activeCellKey: document.activeElement?.getAttribute("data-cell-column-key"),
    focused: document.activeElement === input,
    opacity: getComputedStyle(input).opacity,
  }));
  if (!(await quantityInput.evaluate((input) => document.activeElement === input))) {
    await page.screenshot({ path: run.manifestPath.replace("business-manifest.json", "quantity-fixture.png") });
  }
  await expect(quantityInput).toBeFocused();
  await expect.poll(() => quantityInput.evaluate((input) => getComputedStyle(input).opacity)).toBe("1");
  await quantityInput.fill(String(quantity));
  await expect(quantityInput).toHaveValue(String(quantity));
  await quantityInput.press("Tab");
  await page.keyboard.press("Control+s");
  await expect.poll(async () => (await apiJson<ConnectedEstimate>(page,
    `/api/estimates/${versionId}`)).items.find((item) => item.id === line.id)?.quantity,
  { timeout: 45_000, message: "Fixture quantity must actually be committed before financial assertions" }).toBe(quantity);
  return line;
}

export async function openConnectedSettings(page: Page) {
  await page.getByRole("button", { name: "Ouvrir les paramètres", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "Paramétrage du devis", exact: true });
  await expect(drawer).toBeVisible();
  return drawer;
}
