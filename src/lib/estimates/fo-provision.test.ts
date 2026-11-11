import { describe, expect, it } from "vitest";

import {
  DEFAULT_FO_PROVISION,
  projectUnifiedKfo,
  unifiedKfoValue,
  deriveFoProvision,
  foProvisionsBySupplyType,
  supplyTypeChanged,
  withBufferedFoProvision,
  withRederivedFoProvision,
  withServerFoProvisions,
} from "@/lib/estimates/fo-provision";

const TUBE = "8f9a1b2c-0000-4000-8000-000000000041";
const RACCORD = "8f9a1b2c-0000-4000-8000-000000000042";
const PROVISIONS = new Map([[TUBE, 1.03], [RACCORD, 1.01]]);

describe("TI-534 FO provision mirror", () => {
  it("derives the provision from the supply type, 1.010 without a known type", () => {
    expect(deriveFoProvision(TUBE, PROVISIONS)).toBe(1.03);
    expect(deriveFoProvision(TUBE.toUpperCase(), PROVISIONS)).toBe(1.03);
    expect(deriveFoProvision(null, PROVISIONS)).toBe(DEFAULT_FO_PROVISION);
    expect(deriveFoProvision("8f9a1b2c-0000-4000-8000-000000000099", PROVISIONS)).toBe(1.01);
  });

  it("compares supply types as the trigger does, without case", () => {
    expect(supplyTypeChanged(TUBE, TUBE.toUpperCase())).toBe(false);
    expect(supplyTypeChanged(null, undefined)).toBe(false);
    expect(supplyTypeChanged(null, TUBE)).toBe(true);
    expect(supplyTypeChanged(TUBE, RACCORD)).toBe(true);
  });

  it("re-derives only on a supply type change, so a stored provision never compounds", () => {
    const legacy = { supply_type_id: TUBE, fo_provision: 1, k_fo: 1.2 };
    // Another edit keeps the stored provision, even a legacy 1.000 on a tube.
    const edited = withRederivedFoProvision(legacy, { ...legacy, k_fo: 1.5 }, PROVISIONS);
    expect(edited.fo_provision).toBe(1);
    // A type change takes the new type's provision; going back takes the tube's.
    const raccord = withRederivedFoProvision(legacy, { ...legacy, supply_type_id: RACCORD }, PROVISIONS);
    expect(raccord.fo_provision).toBe(1.01);
    expect(withRederivedFoProvision(raccord, { ...raccord, supply_type_id: TUBE }, PROVISIONS).fo_provision).toBe(1.03);
    // A restored state (undo, redo) that keeps the type keeps the live provision, not the one it carried.
    const tube = { ...legacy, fo_provision: 1.03 };
    expect(withRederivedFoProvision(tube, legacy, PROVISIONS)).toEqual({ ...legacy, fo_provision: 1.03 });
    expect(withRederivedFoProvision(tube, tube, PROVISIONS)).toBe(tube);
    // An unknown line (no previous state) keeps what it carries.
    expect(withRederivedFoProvision(undefined, legacy, PROVISIONS)).toBe(legacy);
  });

  it("gives a v3 line recovered with a pending supply type the provision of that type, nothing else", () => {
    const server = { item_type: "line", supply_type_id: RACCORD, fo_provision: 1.01 };
    const recovered = { ...server, supply_type_id: TUBE };
    expect(withBufferedFoProvision(server, recovered, PROVISIONS, true).fo_provision).toBe(1.03);
    // Pending edits that keep the type keep the stored provision; a v1/v2 line or a section keeps 1.000.
    expect(withBufferedFoProvision(server, { ...server, fo_provision: 1.01 }, PROVISIONS, true).fo_provision).toBe(1.01);
    expect(withBufferedFoProvision({ ...server, fo_provision: 1 }, { ...recovered, fo_provision: 1 }, PROVISIONS, false))
      .toEqual({ ...recovered, fo_provision: 1 });
    const section = { item_type: "section", supply_type_id: null, fo_provision: 1 };
    expect(withBufferedFoProvision(section, section, PROVISIONS, true)).toBe(section);
  });

  it("takes the provision the server stored for a line whose type has not changed since the batch", () => {
    // Tube -> Raccord -> Tube coalesced in the queue: the server saw no type change and kept the legacy 1.000.
    const roundTrip = { id: "line-1", item_type: "line", supply_type_id: TUBE, fo_provision: 1.03 };
    const retyped = { id: "line-2", item_type: "line", supply_type_id: RACCORD, fo_provision: 1.01 };
    const section = { id: "section-1", item_type: "section", supply_type_id: null, fo_provision: 1 };
    const items = [roundTrip, retyped, section];
    const stored = (index: number, item: unknown) => ({ index, op: "update" as const, status: "ok" as const, data: { item } });
    const results = [
      stored(0, { id: "line-1", supply_type_id: TUBE.toUpperCase(), fo_provision: "1.000" }),
      // Retyped locally while the batch was in flight: its next write re-derives it, the editor keeps its own.
      stored(1, { id: "line-2", supply_type_id: TUBE, fo_provision: 1 }),
      stored(2, { id: "section-1", supply_type_id: null, fo_provision: 1.01 }),
    ];
    expect(withServerFoProvisions(items, results)).toEqual([{ ...roundTrip, fo_provision: 1 }, retyped, section]);
    // Nothing to change, or nothing stored (an error, a deleted line, another operation): the same array.
    const settled = [{ ...roundTrip, fo_provision: 1 }];
    expect(withServerFoProvisions(settled, results.slice(0, 1))).toBe(settled);
    expect(withServerFoProvisions(items, [
      { index: 0, op: "update", status: "error", code: "X", message: "refused" },
      { index: 1, op: "update", status: "ok", data: { item: null, deleted_in_batch: true } },
      { index: 2, op: "delete", status: "ok", data: { deleted_id: "line-1" } },
    ])).toBe(items);
  });

  it("acknowledges a server-corrected type even when provision and origin are unchanged", () => {
    // The catalogue type can change between suggestion and write while transport stays included.
    const origin = { selection_id: "53400000-0000-4000-8000-000000000001", kind: "reference", source_id: TUBE, transport_mode: "included" };
    const item = { id: "line-1", item_type: "line", supply_type_id: RACCORD, fo_provision: 1.01, fo_price_origin: origin };
    const results = [{ index: 0, op: "update" as const, status: "ok" as const,
      data: { item: { ...item, supply_type_id: TUBE } } }];
    expect(withServerFoProvisions([item], results, true)[0].supply_type_id).toBe(TUBE);
    // The optimistic path still protects a newer local type awaiting its own write.
    expect(withServerFoProvisions([item], results)[0]).toBe(item);
  });

  it("indexes the loaded supply types by lower-case id", () => {
    expect(foProvisionsBySupplyType([{ id: TUBE.toUpperCase(), default_fo_provision: "1.030" }]))
      .toEqual(new Map([[TUBE, 1.03]]));
  });
});

describe("unified K FO and changed preferences", () => {
  const current = foProvisionsBySupplyType([{ id: TUBE, code: "tube", name: "Tube", default_fo_provision: 1.13, user_fo_coefficient: 1.15 }]);
  it("preserves a stored automatic coefficient on quantity-only edits until explicit refresh", () => {
    const before = { supply_type_id: TUBE, k_fo: 1.13, k_fo_manual: false, fo_provision: 1, quantity: 2 };
    expect(projectUnifiedKfo({ ...before, quantity: 3 }, current, before)).toMatchObject({ k_fo: 1.13, quantity: 3 });
    expect(projectUnifiedKfo({ ...before, k_fo: 1.15 }, current, before)).toMatchObject({ k_fo: 1.15, k_fo_manual: false });
  });
  it("preserves unknown legacy neutrality and folds legacy provision only on a pricing edit", () => {
    const before = { supply_type_id: TUBE, k_fo: 1, k_fo_manual: null, fo_provision: 1.03, unit_price_ht_cents: 100 };
    expect(projectUnifiedKfo({ ...before }, current, before)).toMatchObject({ k_fo: 1, k_fo_manual: null, fo_provision: 1.03 });
    expect(projectUnifiedKfo({ ...before, unit_price_ht_cents: 200 }, current, before)).toMatchObject({ k_fo: 1.03, k_fo_manual: true, fo_provision: 1 });
    expect(projectUnifiedKfo({ ...before, k_fo: 1, k_fo_manual: true }, current, before)).toMatchObject({ k_fo: 1, k_fo_manual: true, fo_provision: 1 });
  });
});

it("reconciles an automatic server K FO without overwriting a pending manual input", () => {
  const automatic = { id: "line", item_type: "line", supply_type_id: TUBE, k_fo: 1.13, k_fo_manual: false, fo_provision: 1 };
  const result = [{ op: "update", index: 0, status: "ok", data: { item: { ...automatic, k_fo: 1.15 } } }] as Parameters<typeof withServerFoProvisions>[1];
  expect(withServerFoProvisions([automatic], result)[0].k_fo).toBe(1.15);
  const pending = { ...automatic, k_fo: 1.0735, k_fo_manual: true };
  expect(withServerFoProvisions([pending], result)[0]).toMatchObject({ k_fo: 1.0735, k_fo_manual: true });
});

it("keeps custom and personal unified coefficients authoritative for included transport", () => {
  const included = { selection_id: "53400000-0000-4000-8000-000000000001", kind: "reference", source_id: TUBE, transport_mode: "included" };
  const map = new Map([[TUBE, { value: 1.0735, transportSensitive: true, unified: true, tube: true }]]);
  expect(unifiedKfoValue(TUBE, map, included)).toBe(1.0735);
  expect(unifiedKfoValue(null, map, included)).toBe(1.02);
  map.set(TUBE, { value: 0.95, transportSensitive: true, unified: true, tube: true });
  expect(unifiedKfoValue(TUBE, map, included)).toBe(0.95);
  expect(unifiedKfoValue(TUBE, new Map([[TUBE, { value: 1.13, transportSensitive: true, unified: true, tube: true, user: 0 }]]), included)).toBe(0);
});

it("reconciles an automatic K FO from a compact neutral-provision receipt", () => {
  const item = { id: "line-1", item_type: "line", supply_type_id: TUBE, k_fo: 1.1, k_fo_manual: false, fo_provision: 1 };
  const results = [{ index: 0, op: "update" as const, status: "ok" as const,
    data: { item: { id: item.id, supply_type_id: TUBE, k_fo: 1.13, k_fo_manual: false } } }];
  expect(withServerFoProvisions([item], results, true)[0]).toMatchObject({ k_fo: 1.13, fo_provision: 1 });
});
