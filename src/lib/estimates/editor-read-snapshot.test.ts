import { describe, expect, it } from "vitest";

import { parseEstimateEditorData } from "@/lib/estimates/editor-read-contracts";
import { prepareEstimateEditorRead } from "@/lib/estimates/editor-read-snapshot";
import { mergeReloadedEditorSettings } from "@/lib/estimates/editor-settings-state";
import { createEstimateEditorResponseFixture } from "@/test/fixtures/estimate-editor-response";

function read() {
  const fixture = createEstimateEditorResponseFixture();
  return parseEstimateEditorData(fixture, fixture.version.id);
}

describe("preparing a confirmed editor read", () => {
  it("preserves stored v3 amounts without proposing corrective historical writes", () => {
    const data = read();
    const before = structuredClone(data);
    const prepared = prepareEstimateEditorRead(data, false);
    expect(prepared.draft.items[0]).toMatchObject({
      quantity: 2, pu_ht_cents: 1300, line_total_ht_cents: 2600,
      line_tax_cents: 520, line_total_ttc_cents: 3120,
    });
    expect(prepared.normalizationUpdates).toEqual([]);
    expect(data).toEqual(before);
  });

  it.each([1, 2, 3] as const)("does not recalculate issued engine %s lines", (engine) => {
    const data = read();
    data.version.calc_engine_version = engine;
    data.version.status = "sent";
    const prepared = prepareEstimateEditorRead(data, true);
    expect(prepared.draft.items).toEqual(data.items);
    expect(prepared.normalizationUpdates).toEqual([]);
  });

  it("preserves a non-priced v3 line with no sale unit price", () => {
    const data = read();
    data.items[0] = { ...data.items[0], pricing_status: "out_of_scope", pu_ht_cents: null,
      line_total_ht_cents: 0, line_tax_cents: 0, line_total_ttc_cents: 0 };
    const prepared = prepareEstimateEditorRead(data, true);
    expect(prepared.draft.items[0].pu_ht_cents).toBeNull();
    expect(prepared.draft.items[0].line_total_ttc_cents).toBe(0);
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
