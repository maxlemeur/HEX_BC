import { describe, expect, it } from "vitest";

import { parseEstimateEditorData } from "@/lib/estimates/editor-read-contracts";
import { EstimateEditorDocument } from "@/lib/estimates/editor-document-state";
import { prepareEstimateEditorRead } from "@/lib/estimates/editor-read-snapshot";
import { mergeReloadedEditorSettings } from "@/lib/estimates/editor-settings-state";
import { createEstimateEditorResponseFixture } from "@/test/fixtures/estimate-editor-response";

function read() {
  const fixture = createEstimateEditorResponseFixture();
  return parseEstimateEditorData(fixture, fixture.version.id);
}

function discountedV2Read() {
  const data = read();
  data.version = { ...data.version, calc_engine_version: 2, discount_bp: 1667,
    margin_multiplier: 1, total_ht_cents: 5, total_tax_cents: 0, total_ttc_cents: 5 };
  const base = { ...data.items[0], quantity: 1, unit_price_ht_cents: 3, k_fo: 1, h_mo: 0, k_mo: 1 };
  data.items = [
    { ...base, title: "A", position: 1, tax_rate_bp: 2000, pu_ht_cents: 2,
      line_total_ht_cents: 2, line_tax_cents: 0, line_total_ttc_cents: 2 },
    { ...base, id: "55555555-5555-4555-8555-555555555555", title: "B", position: 2,
      tax_rate_bp: 0, pu_ht_cents: 3, line_total_ht_cents: 3, line_tax_cents: 0, line_total_ttc_cents: 3 },
  ];
  return data;
}

describe("preparing a confirmed editor read", () => {
  it.each([false, true])("keeps allocated V2 net amounts confirmed without persisting its gross preview (labor split %s)", (split) => {
    // WFC01: 6 gross cents, 1667 bp discount => 1 cent allocated to A; VAT rounds to zero.
    const data = discountedV2Read();
    const before = structuredClone(data);
    const prepared = prepareEstimateEditorRead(data, split);
    expect(prepared.draft.items.map((item) => [item.pu_ht_cents, item.line_total_ht_cents, item.line_tax_cents, item.line_total_ttc_cents]))
      .toEqual([[3, 3, 1, 4], [3, 3, 0, 3]]);
    expect(prepared.normalizationUpdates).toEqual([]);
    const document = new EstimateEditorDocument({ actorId: null, tenantId: data.version.tenant_id, versionId: data.version.id });
    document.acceptRead(prepared);
    prepared.normalizationUpdates.forEach(({ id, updates }) => document.enqueueItem(id, updates));
    expect(document.getSnapshot().pendingCount).toBe(0);
    expect(document.getSnapshot().confirmedItems.map((item) => [item.line_total_ht_cents, item.line_tax_cents, item.line_total_ttc_cents]))
      .toEqual([[2, 0, 2], [3, 0, 3]]);
    expect(document.getSnapshot().version).toMatchObject({ total_ht_cents: 5, total_tax_cents: 0, total_ttc_cents: 5 });
    expect(data).toEqual(before);
  });

  it("retains real V2 input normalization without adding derived amounts to its write", () => {
    const data = discountedV2Read();
    data.items[0].k_fo = null;
    const prepared = prepareEstimateEditorRead(data, false);
    expect(prepared.normalizationUpdates).toEqual([{ id: data.items[0].id, updates: { k_fo: 1 } }]);
    expect(prepared.confirmed.items[0]).toMatchObject({ k_fo: null, pu_ht_cents: 2, line_total_ht_cents: 2, line_tax_cents: 0, line_total_ttc_cents: 2 });
    expect(prepared.draft.items[0]).toMatchObject({ k_fo: 1, pu_ht_cents: 3, line_total_ht_cents: 3 });
  });

  it("preserves the historical V1 normalization of stored derived amounts", () => {
    const data = discountedV2Read();
    data.version.calc_engine_version = 1;
    const prepared = prepareEstimateEditorRead(data, false);
    expect(prepared.normalizationUpdates[0]).toMatchObject({ id: data.items[0].id,
      updates: { pu_ht_cents: 3, line_total_ht_cents: 3, line_tax_cents: 1, line_total_ttc_cents: 4 } });
  });

  it.each([1, 2, 3] as const)("does not recalculate issued engine %s lines", (engine) => {
    const data = read();
    data.version.calc_engine_version = engine;
    data.version.status = "sent";
    const prepared = prepareEstimateEditorRead(data, true);
    expect(prepared.draft.items).toEqual(data.items);
    expect(prepared.normalizationUpdates).toEqual([]);
  });
});

describe("reconciling confirmed settings with a local draft", () => {
  it("keeps edited fields while accepting concurrent server changes elsewhere", () => {
    const confirmed = prepareEstimateEditorRead(read(), false).draft.settings;
    const local = { ...confirmed, title: "Titre saisi localement", discount_bp: 125 };
    const incoming = { ...confirmed, title: "Titre serveur", validite_jours: 60, discount_bp: 250 };
    const result = mergeReloadedEditorSettings(local, confirmed, incoming);
    expect(result).toMatchObject({ title: "Titre saisi localement", validite_jours: 60, discount_bp: 125 });
    expect(confirmed.validite_jours).toBe(30);
    expect(incoming.title).toBe("Titre serveur");
  });

  it("uses the new version settings when no local baseline belongs to it", () => {
    const incoming = prepareEstimateEditorRead(read(), false).draft.settings;
    expect(mergeReloadedEditorSettings({ ...incoming, title: "Ancien devis" }, null, incoming)).toBe(incoming);
  });

  it("does not treat default-equivalent settings as local changes", () => {
    const confirmed = prepareEstimateEditorRead(read(), false).draft.settings;
    const local = { ...confirmed, discount_steps: undefined };
    const incoming = { ...confirmed, discount_steps: [125] };
    expect(mergeReloadedEditorSettings(local, confirmed, incoming).discount_steps).toEqual([125]);
  });
});
