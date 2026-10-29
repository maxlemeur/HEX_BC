import { describe, expect, it } from "vitest";

import { parseNullableNumberInput, parseNumberInput } from "@/lib/estimates/editor-values";

describe("parseNumberInput", () => {

  // Le defaut corrige : `replace(",", ".")` ne remplacait que la PREMIERE
  // virgule et ne retirait pas les separateurs de milliers. `parseFloat`
  // s'arretait donc a l'espace et renvoyait 1 — une quantite fausse, persistee
  // sans le moindre signal.
  it("accepte les separateurs de milliers d'Excel FR", () => {
    expect(parseNumberInput("1 234,56")).toBe(1234.56);
    expect(parseNumberInput("1\u00A0234,56")).toBe(1234.56); // insecable
    expect(parseNumberInput("1\u202F234,56")).toBe(1234.56); // insecable etroite
    expect(parseNumberInput("1'234,56")).toBe(1234.56); // style suisse
  });

  it("tranche le double separateur par le dernier rencontre", () => {
    expect(parseNumberInput("1.234,56")).toBe(1234.56); // FR
    expect(parseNumberInput("1,234.56")).toBe(1234.56); // EN
    expect(parseNumberInput("1.234.567,89")).toBe(1234567.89);
  });

  it("gere le signe negatif, y compris le moins typographique", () => {
    expect(parseNumberInput("-12,5")).toBe(-12.5);
    expect(parseNumberInput("\u221212,5")).toBe(-12.5);
  });
});

describe("parseNullableNumberInput", () => {
  it("distingue un vrai zero d'un champ vide", () => {
    expect(parseNullableNumberInput("0")).toBe(0);
    expect(parseNullableNumberInput("")).toBeNull();
    expect(parseNullableNumberInput("   ")).toBeNull();
    expect(parseNullableNumberInput("abc")).toBeNull();
  });
});
