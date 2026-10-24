import { describe, expect, it } from "vitest";

import {
  DEFAULT_FO_PROVISION,
  deriveFoProvision,
  foProvisionsBySupplyType,
  supplyTypeChanged,
  withBufferedFoProvision,
  withRederivedFoProvision,
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

  it("indexes the loaded supply types by lower-case id", () => {
    expect(foProvisionsBySupplyType([{ id: TUBE.toUpperCase(), default_fo_provision: "1.030" }]))
      .toEqual(new Map([[TUBE, 1.03]]));
  });
});
