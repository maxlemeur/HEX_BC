import { describe, expect, it } from "vitest";

import { COLUMN_HEADER_TOOLTIPS } from "@/components/estimates/components/ColumnHeaderHelp";

describe("estimate column header help", () => {
  it("documents the complete unit sale price formula", () => {
    expect(COLUMN_HEADER_TOOLTIPS["PU"]).toBe(
      "PU = (PR FO × K FO + h MO × K MO × prix horaire MO) × coefficient de marge. Si le taux horaire du rôle vaut 0 €/h, la MO contribue 0 € au PU.",
    );
  });

  it("documents the line total formula", () => {
    expect(COLUMN_HEADER_TOOLTIPS["Prix total"]).toBe(
      "Prix total HT = PU × Qté",
    );
  });

  it("states that K FO does not affect labor", () => {
    expect(COLUMN_HEADER_TOOLTIPS["K FO"]).toBe(
      "Coefficient fourniture — multiplie uniquement le prix de revient FO et ne modifie jamais la MO. Ex : K = 1.20 → +20% sur le prix FO",
    );
  });

  it("presents K MO as an execution-difficulty coefficient, not a margin", () => {
    // La sémantique métier (EST-E15) : k_mo est un coefficient de RENDEMENT
    // (difficulté d'exécution, ex. travail en hauteur), pas une marge sur le
    // taux horaire.
    expect(COLUMN_HEADER_TOOLTIPS["K MO"]).toContain("rendement");
    expect(COLUMN_HEADER_TOOLTIPS["K MO"]).toContain("travail en hauteur");
    expect(COLUMN_HEADER_TOOLTIPS["K MO"]).not.toContain("marge");
    expect(COLUMN_HEADER_TOOLTIPS["K MO atelier"]).toContain("rendement");
    expect(COLUMN_HEADER_TOOLTIPS["K MO chantier"]).toContain("rendement");
  });

  it("marks Majoration MO as reserved for OPTIMA import/export compatibility", () => {
    expect(COLUMN_HEADER_TOOLTIPS["Majoration MO (%)"]).toContain("OPTIMA");
    expect(COLUMN_HEADER_TOOLTIPS["Majoration MO (%)"]).toContain(
      "100% (neutre)",
    );
  });
});
