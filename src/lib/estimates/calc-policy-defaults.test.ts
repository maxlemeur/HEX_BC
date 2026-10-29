import { describe, expect, it } from "vitest";

import {
  parseTenantCalcDefaultsForm,
  type TenantCalcDefaultsForm,
} from "@/lib/estimates/calc-policy-defaults";

const VALID_FORM: TenantCalcDefaultsForm = {
  saleCoefficientFo: "1,35",
  saleCoefficientMo: "1,25",
  allowedTaxRates: "20 ; 10 ; 5,5",
  changeReason: "  Nouveaux coefficients 2027  ",
};

describe("tenant calc defaults (lot 3.2, entrée 5)", () => {
  it("accepts rates without spaces, a trailing separator and a percent sign", () => {
    const parsed = parseTenantCalcDefaultsForm({ ...VALID_FORM, allowedTaxRates: "20%;2,1;" });
    expect(parsed).toMatchObject({ ok: true, values: { allowedTaxRatesBp: [2000, 210] } });
  });

  it.each([
    ["0", "zero"],
    ["1,23456", "five decimals"],
    ["-1", "negative"],
    ["abc", "text"],
  ])("refuses the coefficient %s (%s)", (saleCoefficientFo) => {
    const parsed = parseTenantCalcDefaultsForm({ ...VALID_FORM, saleCoefficientFo });
    expect(parsed).toMatchObject({ ok: false, errors: { saleCoefficientFo: expect.stringContaining("invalide") } });
  });

  it("accepts the upper bound 10 and four decimals", () => {
    const parsed = parseTenantCalcDefaultsForm({ ...VALID_FORM, saleCoefficientFo: "10", saleCoefficientMo: "1,2345" });
    expect(parsed).toMatchObject({ ok: true, values: { defaultSaleCoefficientFo: 10, defaultSaleCoefficientMo: 1.2345 } });
  });

  it("refuses an empty rate list and a duplicated rate", () => {
    expect(parseTenantCalcDefaultsForm({ ...VALID_FORM, allowedTaxRates: " ; " })).toMatchObject({
      ok: false,
      errors: { allowedTaxRates: "Taux de TVA obligatoires : au moins un pourcentage entre 0 et 100." },
    });
    expect(parseTenantCalcDefaultsForm({ ...VALID_FORM, allowedTaxRates: "20 ; 5,5 ; 5,50" })).toMatchObject({
      ok: false,
      errors: { allowedTaxRates: "Taux de TVA en double : 5,5 %." },
    });
  });

  it("counts the reason in characters, as the database does, not in UTF-16 units", () => {
    // Trois emojis font six unités UTF-16 mais trois caractères : refusés, comme `char_length` < 5.
    expect(parseTenantCalcDefaultsForm({ ...VALID_FORM, changeReason: "😀😀😀" })).toMatchObject({
      ok: false,
      errors: { changeReason: expect.any(String) },
    });
    expect(parseTenantCalcDefaultsForm({ ...VALID_FORM, changeReason: "😀".repeat(500) })).toMatchObject({ ok: true });
  });
});
