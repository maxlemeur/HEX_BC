import { randomUUID } from "node:crypto";

import { expect } from "e2e";

import { apiRequest, createEstimateViaWizard, ownEstimate, type ArmyState } from "./fixtures";

type Ui = Parameters<typeof createEstimateViaWizard>[0];

export type Envelope<T> = { ok: boolean; data: T; error?: { code: string; message: string } };
type Line = { id: string; status: string; unit_price_ht_cents: number | null; price_per: number };
type Created = { orders: Array<{ id: string; reference: string; total_ht_cents: number }>; replayed: boolean };

/**
 * A draft order of an affaire, arranged through the API: an affaire of its own, a request of 10 elbows and 125 screws
 * quoted by one invented supplier (11,50 € each, 3,42 € the hundred), retained, and its draft order. The journeys of
 * the confirmation (TI-691) and of the send by e-mail start from it; `supplierEmail` gives the supplier an address.
 */
export async function draftOrderOfAnAffaire(ui: Ui, army: ArmyState, label: string, supplierEmail?: string) {
  const { browser } = ui;
  const ids = await createEstimateViaWizard(ui, { projectName: army.projectName, title: `${army.runPrefix} ${label}` }, army);
  ownEstimate(army, ids);
  const base = `/api/affaires/${ids.projectId}/material-requests`;
  const supplierName = `${army.runPrefix} Négoce ${label}`;
  const supplier = await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", "/api/suppliers", {
    action: "create", item: { name: supplierName, is_active: true, ...(supplierEmail ? { email: supplierEmail } : {}) },
  });
  expect(supplier.status, JSON.stringify(supplier.body.error ?? null)).toBe(201);
  const created = await apiRequest<Envelope<{ request: { id: string } }>>(browser, "POST", base, {
    source_text: "Demande inventée", delivery_place: "site",
  });
  expect(created.status, JSON.stringify(created.body.error ?? null)).toBe(201);
  const requestId = created.body.data.request.id;
  const one = `${base}/${requestId}`;
  const added = await apiRequest<Envelope<{ lines: Line[] }>>(browser, "POST", `${one}/lines`, {
    lines: [
      { original_text: "10 coudes inox 50", quantity: 10, unit: "u", product_type: "Coude 90°", dimension: "DN 50", material: "Inox 316L" },
      { original_text: "125 vis M10", quantity: 125, unit: "u", product_type: "Vis tête hexagonale", dimension: "M10", material: "Acier zingué" },
    ],
  });
  expect(added.status, JSON.stringify(added.body.error ?? null)).toBe(201);
  const [elbows, screws] = added.body.data.lines.map((line) => line.id);
  const validated = await apiRequest<Envelope<{ lines: Line[] }>>(browser, "POST", `${one}/lines/validate`, { ids: [elbows, screws] });
  expect(validated.status, JSON.stringify(validated.body.error ?? null)).toBe(200);
  const asked = await apiRequest<Envelope<{ item: { id: string } }>>(browser, "POST", `${one}/quotes`, {
    supplier_id: supplier.body.data.item.id, line_ids: [elbows, screws], with_references: false, message: "Demande de prix inventée",
  });
  expect(asked.status, JSON.stringify(asked.body.error ?? null)).toBe(201);
  const quoteId = asked.body.data.item.id;
  const priced = await apiRequest<Envelope<unknown>>(browser, "PATCH", `${one}/quotes/${quoteId}`, {
    received: true, lines: [
      { line_id: elbows, unit_price_ht_cents: 1150, price_per: 1 },
      { line_id: screws, unit_price_ht_cents: 342, price_per: 100 },
    ],
  });
  expect(priced.status, JSON.stringify(priced.body.error ?? null)).toBe(200);
  const retained = await apiRequest<Envelope<unknown>>(browser, "POST", `${one}/quotes/${quoteId}/retain`);
  expect(retained.status, JSON.stringify(retained.body.error ?? null)).toBe(200);
  const ordered = await apiRequest<Envelope<Created>>(browser, "POST", `${one}/orders`, { idempotency_key: randomUUID() });
  expect(ordered.status, JSON.stringify(ordered.body.error ?? null)).toBe(201);
  const [order] = ordered.body.data.orders;
  // 10 × 11,50 € + 125 × 3,42 € ÷ 100 = 115,00 € + 4,275 € → 4,28 €.
  expect(order.total_ht_cents).toBe(11500 + 428);
  (army.ownedPurchaseOrders ??= []).push({ orderId: order.id, projectId: ids.projectId, versionId: ids.versionId });
  return { ids, requestId, one, elbows, screws, order, supplierName };
}
