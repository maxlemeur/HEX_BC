import { describe, expect, it } from "vitest";

import { parseNumberInput } from "@/components/estimates/components/estimate-editor-row/shared";

describe("parseNumberInput", () => {
  it("lit une decimale francaise", () => {
    expect(parseNumberInput("12,5")).toBe(12.5);
    expect(parseNumberInput("12.5")).toBe(12.5);
    expect(parseNumberInput("42")).toBe(42);
  });

  // Le defaut corrige : `replace(",", ".")` ne remplacait que la PREMIERE
  // virgule et ne retirait pas les separateurs de milliers. `parseFloat`
  // s'arretait donc a l'espace et renvoyait 1 — une quantite fausse, persistee
  // sans le moindre signal.
  it("accepte les separateurs de milliers d'Excel FR", () => {
    expect(parseNumberInput("1 234,56")).toBe(1234.56);
    expect(parseNumberInput("1 234,56")).toBe(1234.56); // insecable
    expect(parseNumberInput("1 234,56")).toBe(1234.56); // insecable etroite
    expect(parseNumberInput("1'234,56")).toBe(1234.56); // style suisse
  });

  it("tranche le double separateur par le dernier rencontre", () => {
    expect(parseNumberInput("1.234,56")).toBe(1234.56); // FR
    expect(parseNumberInput("1,234.56")).toBe(1234.56); // EN
    expect(parseNumberInput("1.234.567,89")).toBe(1234567.89);
  });

  it("ignore unites et symboles colles a la valeur", () => {
    expect(parseNumberInput("12,5 m²")).toBe(12.5);
    expect(parseNumberInput("1 234,56 €")).toBe(1234.56);
  });

  it("retombe sur 0 pour une saisie vide ou non numerique", () => {
    expect(parseNumberInput("")).toBe(0);
    expect(parseNumberInput("   ")).toBe(0);
    expect(parseNumberInput("abc")).toBe(0);
  });

  it("gere le signe negatif, y compris le moins typographique", () => {
    expect(parseNumberInput("-12,5")).toBe(-12.5);
    expect(parseNumberInput("−12,5")).toBe(-12.5);
  });

  // T16 — NON TRANCHE. Avec un seul type de separateur, « 2.500 » et « 2,500 »
  // valent 2,5 (comportement historique conserve), alors que
  // `parseClipboardNumber` les lit comme 2500 pour le collage en masse.
  // L'ambiguite est une decision produit (HANDOFF-audit-backlog.md §1.6).
  // Ce test FIGE l'etat actuel : le jour ou T16 est tranche, c'est ici qu'on
  // voit ce qui bascule.
  it("T16 : un seul separateur reste decimal (a trancher, ne pas aligner a l'aveugle)", () => {
    expect(parseNumberInput("2,500")).toBe(2.5);
    expect(parseNumberInput("2.500")).toBe(2.5);
  });
});
