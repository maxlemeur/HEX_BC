import { describe, expect, it } from "vitest";

import {
  DEFAULT_FO_PROVISION,
  automaticKfoRefreshPatches,
  projectUnifiedKfo,
  unifiedKfoValue,
  deriveFoProvision,
  foProvisionsBySupplyType,
  supplyTypeChanged,
  withBufferedFoProvision,
  withRederivedFoProvision,
  withServerFoProvisions,
} from "@/lib/estimates/fo-provision";

import { computeEstimateV3Breakdown } from "@/lib/estimates/engine-v3";
import { supplyLineInput } from "@/lib/estimates/engine-v3/oracle.fixtures";

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

  // Réponse de Maxime du 11/11/2026 : une POSE SEULE ne prend ni pertes ni transport, même avec une petite
  // fourniture (supportage). Sa provision vaut 1 tant qu'elle garde cette nature, et se redérive quand elle la quitte.
  it("gives a POSE SEULE line a provision of 1, whatever its type, and re-derives it when the nature leaves", () => {
    expect(deriveFoProvision(TUBE, PROVISIONS, undefined, "pose_only")).toBe(1);
    expect(deriveFoProvision(null, PROVISIONS, undefined, "pose_only")).toBe(1);
    expect(deriveFoProvision(TUBE, PROVISIONS, undefined, "labor_only")).toBe(1.03);
    const tube = { supply_type_id: TUBE, fo_provision: 1.03, line_nature: "supply_and_labor" as const };
    const pose = withRederivedFoProvision(tube, { ...tube, line_nature: "pose_only" as const }, PROVISIONS);
    expect(pose.fo_provision).toBe(1);
    // A type change on a POSE SEULE line keeps 1; leaving the nature takes the type's provision again.
    expect(withRederivedFoProvision(pose, { ...pose, supply_type_id: RACCORD }, PROVISIONS).fo_provision).toBe(1);
    expect(withRederivedFoProvision(pose, { ...pose, line_nature: "supply_and_labor" as const }, PROVISIONS).fo_provision).toBe(1.03);
    // Another edit of a POSE SEULE line keeps 1, as for any line.
    expect(withRederivedFoProvision(pose, { ...pose, unit_price_ht_cents: 500 }, PROVISIONS).fo_provision).toBe(1);
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

// POSE SEULE storage/UI is supplied by TI-539/TI-541. Exercise its pricing
// projection now without inventing that missing enum in the current database.
describe("Maxime 11/11 — configurable K FO and POSE SEULE", () => {
  const bases = foProvisionsBySupplyType([
    { id: TUBE, code: "tube", name: "Tube", default_fo_provision: 1.13 },
    { id: RACCORD, code: "robinet", name: "Robinet", default_fo_provision: 1.02 },
  ]);
  it.each([
    ["Tube fonte Ø100", TUBE, "supply_and_labor", 14243, 1.13, 16095],
    ["Robinet DN 25", RACCORD, "supply_only", 5843, 1.02, 5960],
    ["Pose seule WC avec supportage", TUBE, "pose_only", 17550, 1, 17550],
  ] as const)("applies the validated pre-margin amount for %s", (_label, typeId, nature, purchase, coefficient, expected) => {
    const projected = projectUnifiedKfo({ supply_type_id: typeId, line_nature: nature, k_fo: 1, k_fo_manual: false }, bases);
    expect(projected.k_fo).toBe(coefficient);
    const input = supplyLineInput(1, purchase, 1);
    Object.assign(input.items[0], { k_fo: projected.k_fo, fo_provision: projected.fo_provision });
    expect(computeEstimateV3Breakdown(input).lines[0].pu_ht_cents).toBe(expected);
  });
  it("uses a changed tube setting while POSE SEULE remains neutral despite its supply family", () => {
    const settings = foProvisionsBySupplyType([{ id: TUBE, code: "tube", name: "Tube", default_fo_provision: 1.2, user_fo_coefficient: 1.25 }]);
    const automatic = { id: "tube", item_type: "line", supply_type_id: TUBE, line_nature: "supply_and_labor", k_fo: 1.13, k_fo_manual: false, fo_provision: 1 };
    const pose = { ...automatic, id: "pose", line_nature: "pose_only" };
    expect(automaticKfoRefreshPatches([automatic, pose, { ...pose, id: "manual", k_fo: 1.05, k_fo_manual: true }], settings))
      .toEqual([{ id: "tube", patch: { k_fo: 1.25, k_fo_manual: false } }, { id: "pose", patch: { k_fo: 1, k_fo_manual: false } }]);
    const changed = projectUnifiedKfo(pose, settings, automatic);
    expect(changed).toMatchObject({ k_fo: 1, k_fo_manual: false });
    expect(projectUnifiedKfo({ ...changed, line_nature: "supply_and_labor" }, settings, changed)).toMatchObject({ k_fo: 1.25 });
    expect(projectUnifiedKfo({ ...pose, k_fo: 1.05, k_fo_manual: true }, settings)).toMatchObject({ k_fo: 1.05 });
    const company = foProvisionsBySupplyType([{ id: TUBE, code: "tube", name: "Tube", default_fo_provision: 1.2 }]);
    expect(unifiedKfoValue(TUBE, company)).toBe(1.2);
  });
});

it("leaves WC labour unchanged when its small supply coefficient is overridden", () => {
  const settings = foProvisionsBySupplyType([{ id: TUBE, code: "tube", name: "Tube", default_fo_provision: 1.13 }]);
  const row = { supply_type_id: TUBE, line_nature: "pose_only", k_fo: 1, k_fo_manual: false };
  const input = supplyLineInput(1, 350, 1, { sale_coefficient_mo: 1 });
  Object.assign(input.items[0], projectUnifiedKfo(row, settings), { h_mo_per_unit: 1, labor_rate_cents: 17200 });
  expect(computeEstimateV3Breakdown(input).lines[0].pu_ht_cents).toBe(17550);
  Object.assign(input.items[0], projectUnifiedKfo({ ...row, k_fo: 1.1, k_fo_manual: true }, settings));
  expect(computeEstimateV3Breakdown(input).lines[0].pu_ht_cents).toBe(17585);
});
