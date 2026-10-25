import { describe, expect, it } from "vitest";

import {
  formatTenantCalcDefaults,
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
  it("reads typed coefficients, percent rates and a trimmed reason", () => {
    expect(parseTenantCalcDefaultsForm(VALID_FORM)).toEqual({
      ok: true,
      values: {
        defaultSaleCoefficientFo: 1.35,
        defaultSaleCoefficientMo: 1.25,
        allowedTaxRatesBp: [2000, 1000, 550],
        changeReason: "Nouveaux coefficients 2027",
      },
    });
  });

  it("accepts rates without spaces, a trailing separator and a percent sign", () => {
    const parsed = parseTenantCalcDefaultsForm({ ...VALID_FORM, allowedTaxRates: "20%;2,1;" });
    expect(parsed).toMatchObject({ ok: true, values: { allowedTaxRatesBp: [2000, 210] } });
  });

  it("refuses each invalid field with its own message and corrects nothing", () => {
    const parsed = parseTenantCalcDefaultsForm({
      saleCoefficientFo: "12",
      saleCoefficientMo: "",
      allowedTaxRates: "20 ; 120",
      changeReason: "abc",
    });
    expect(parsed).toEqual({
      ok: false,
      errors: {
        saleCoefficientFo: "Coefficient de vente FO invalide : nombre supérieur à 0 et au plus 10, 4 décimales au plus.",
        saleCoefficientMo: "Coefficient de vente MO obligatoire : saisissez un nombre supérieur à 0 et au plus 10.",
        allowedTaxRates:
          "Taux de TVA invalide : « 120 ». Pourcentages entre 0 et 100, 2 décimales au plus, séparés par « ; ».",
        changeReason: "Motif obligatoire : 5 à 500 caractères, gardés dans le journal des réglages.",
      },
    });
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

  it("refuses a reason over 500 characters", () => {
    const parsed = parseTenantCalcDefaultsForm({ ...VALID_FORM, changeReason: "x".repeat(501) });
    expect(parsed).toMatchObject({ ok: false, errors: { changeReason: expect.any(String) } });
  });

  it("counts the reason in characters, as the database does, not in UTF-16 units", () => {
    // Trois emojis font six unités UTF-16 mais trois caractères : refusés, comme `char_length` < 5.
    expect(parseTenantCalcDefaultsForm({ ...VALID_FORM, changeReason: "😀😀😀" })).toMatchObject({
      ok: false,
      errors: { changeReason: expect.any(String) },
    });
    expect(parseTenantCalcDefaultsForm({ ...VALID_FORM, changeReason: "😀".repeat(500) })).toMatchObject({ ok: true });
  });

  it("formats a policy back into the fields, an absent coefficient as an empty field", () => {
    expect(
      formatTenantCalcDefaults({
        defaultSaleCoefficientFo: 1.3,
        defaultSaleCoefficientMo: null,
        allowedTaxRatesBp: [2000, 1000, 550, 210],
      }),
    ).toEqual({ saleCoefficientFo: "1,30", saleCoefficientMo: "", allowedTaxRates: "20 ; 10 ; 5,5 ; 2,1" });
  });

  it("round-trips formatted values through the parser", () => {
    const fields = formatTenantCalcDefaults({
      defaultSaleCoefficientFo: 1.3456,
      defaultSaleCoefficientMo: 2,
      allowedTaxRatesBp: [2000, 850],
    });
    expect(parseTenantCalcDefaultsForm({ ...fields, changeReason: "Relecture" })).toEqual({
      ok: true,
      values: {
        defaultSaleCoefficientFo: 1.3456,
        defaultSaleCoefficientMo: 2,
        allowedTaxRatesBp: [2000, 850],
        changeReason: "Relecture",
      },
    });
  });
});
