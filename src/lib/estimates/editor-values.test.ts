import { describe, expect, it } from "vitest";

import { parseNullableNumberInput, parseNullableNumericValue, parseNumberInput, toFiniteNumber, toNullableFiniteNumber } from "@/lib/estimates/editor-values";

describe("estimate editor value normalization", () => {

  it("normalizes finite numbers without accepting invalid values", () => {
    expect(toFiniteNumber(12.5, 0)).toBe(12.5);
    expect(toFiniteNumber(Number.NaN, 3)).toBe(3);
    expect(toFiniteNumber(Number.POSITIVE_INFINITY, 3)).toBe(3);
    expect(toFiniteNumber("12", 3)).toBe(3);
    expect(toNullableFiniteNumber("12.5")).toBe(12.5);
    expect(toNullableFiniteNumber(0)).toBe(0);
    expect(toNullableFiniteNumber("")).toBe(0);
    expect(toNullableFiniteNumber(Number.NEGATIVE_INFINITY)).toBeNull();
    expect(toNullableFiniteNumber("not-a-number")).toBeNull();
  });

  it("parses localized nullable numeric values", () => {
    expect(parseNullableNumericValue("12,5")).toBe(12.5);
    expect(parseNullableNumericValue("12,5 kg")).toBeNull();
    expect(parseNullableNumericValue(7.25)).toBe(7.25);
    expect(parseNullableNumericValue("  ")).toBeNull();
    expect(parseNullableNumericValue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseNullableNumericValue("invalid")).toBeNull();
  });
});

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

  it("refuse les unites et symboles dans une quantite", () => {
    expect(parseNumberInput("12,5 m²")).toBeNull();
    expect(parseNumberInput("1 234,56 €")).toBeNull();
  });

  it("retombe sur 0 pour une saisie vide ou non numerique", () => {
    expect(parseNumberInput("")).toBe(0);
    expect(parseNumberInput("   ")).toBe(0);
    expect(parseNumberInput("abc")).toBeNull();
  });

  it("gere le signe negatif, y compris le moins typographique", () => {
    expect(parseNumberInput("-12,5")).toBe(-12.5);
    expect(parseNumberInput("\u221212,5")).toBe(-12.5);
  });

  // T16 — NON TRANCHE. Avec un seul type de separateur, « 2.500 » et « 2,500 »
  // valent 2,5 (comportement historique conserve), alors que
  // `parseClipboardNumber` les lit comme 2500 pour le collage en masse.
  // L'ambiguite est une decision produit (HANDOFF-audit-backlog.md §1.6).
  // Ce test FIGE l'etat actuel : le jour ou T16 est tranche, c'est ici qu'on
  // voit ce qui bascule.
  it("T16 : un seul separateur reste decimal (a trancher, ne pas aligner a l'aveugle)", () => {
    expect(parseNumberInput("2,500")).toBe(2.5);
    expect(parseNumberInput("2.500")).toBeNull();
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
