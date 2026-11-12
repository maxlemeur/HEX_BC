import { describe, expect, it } from "vitest";

import {
  compareEstimates, estimateLineDetail, estimateLines, estimateOutline, type EstimateReading, type EstimateReadingNode,
} from "@/lib/assistant/estimate-reading";

function section(id: string, parentId: string | null, title: string, position: number): EstimateReadingNode {
  return { id, parentId, type: "section", title, position, line: null };
}
/** A priced line whose net equals its shown total unless `netHtCents` says a discount was spread on it. */
function line(id: string, parentId: string | null, title: string, position: number, totalHtCents: number | null,
  overrides: Partial<NonNullable<EstimateReadingNode["line"]>> & { netHtCents?: number } = {}): EstimateReadingNode {
  const { netHtCents, ...rest } = overrides;
  return {
    id, parentId, type: "line", title, position,
    line: {
      quantity: 2, unit: "ml", pricingStatus: "priced", description: null, source: null,
      inputs: { unitPriceHtCents: 1000, kFo: 1.2, hMoPerUnit: 0.5, hMo: null, kMo: 1, taxRateBp: 2000 },
      amounts: totalHtCents === null ? null : {
        puHtCents: totalHtCents / 2, totalHtCents, netHtCents: netHtCents ?? totalHtCents, costHtCents: 2400,
        foHtCents: 3000, moHtCents: totalHtCents - 3000, hours: "1.000",
      },
      foCostText: "Prix catalogue 10,00 € × K FO 1,2 = 12,00 € de coût FO",
      ...rest,
    },
  };
}

const reading: EstimateReading = {
  version: { id: "v-1", label: "V1", title: "Chaufferie", status: "draft", engine: 3, amountsBasis: "draft_calculation" },
  params: { coefficient_vente_fo: "1.2500" },
  totals: {
    grossHtCents: 17_000, discountCents: 0, roundingCents: 0, totalHtCents: 17_000, totalTaxCents: 3_400,
    totalTtcCents: 20_400, costHtCents: 9_600,
  },
  warnings: ["1 ligne non chiffrée : elle ne compte pas dans le total."],
  nodes: [
    section("s-plomberie", null, "Plomberie", 1),
    section("s-reseaux", "s-plomberie", "Réseaux", 1),
    line("l-cuivre", "s-reseaux", "Tube cuivre Ø22", 1, 5_000),
    line("l-per", "s-reseaux", "Tube PER Ø16", 2, 4_000),
    line("l-vanne", "s-plomberie", "Vanne d’arrêt", 2, 6_000),
    section("s-cvc", null, "CVC", 2),
    line("l-chaudiere", "s-cvc", "Chaudière", 1, null, { pricingStatus: "not_priced" }),
    line("l-notice", "s-cvc", "Notice de mise en service", 2, null, { pricingStatus: "included" }),
    line("l-divers", null, "Divers hors lot", 3, 2_000),
  ],
};

describe("estimate reading for the assistant", () => {
  it("outlines sections with the total and the count of all the lines below them", () => {
    const outline = estimateOutline(reading);
    expect(outline.sections).toEqual([
      { id: "s-plomberie", chemin: "Plomberie", lignes: 3, lignes_non_chiffrees: 0, total_ht: "150,00 €" },
      { id: "s-reseaux", chemin: "Plomberie > Réseaux", lignes: 2, lignes_non_chiffrees: 0, total_ht: "90,00 €" },
      { id: "s-cvc", chemin: "CVC", lignes: 2, lignes_non_chiffrees: 1, total_ht: "0,00 €" },
    ]);
    expect(outline.lignes_hors_section).toBe(1);
    expect(outline.totaux).toMatchObject({ total_ht: "170,00 €", total_ttc: "204,00 €", total_brut_ht: "170,00 €" });
    expect(outline.avertissements).toEqual(["1 ligne non chiffrée : elle ne compte pas dans le total."]);
    expect(outline.devis).toMatchObject({ id: "v-1", montants: "calcul du brouillon en cours" });
    expect(outline).not.toHaveProperty("note");
  });

  it("counts as not priced only the lines left « Non chiffrée », not the ones included or for memory", () => {
    expect(estimateOutline(reading).lignes_non_chiffrees).toBe(1);
    const unpriced = estimateLines(reading, { unpricedOnly: true });
    expect(unpriced.lignes).toEqual([expect.objectContaining({ id: "l-chaudiere", statut: "Non chiffrée", pu_ht: null, total_ht: null })]);
    expect(estimateLines(reading, { search: "notice" }).lignes[0]).toMatchObject({ statut: "Inclus", total_ht: null });
  });

  it("says when a discount is spread: a line shows its total before it, sections and footer after it", () => {
    const discounted: EstimateReading = {
      ...reading,
      totals: { ...reading.totals, grossHtCents: 100_000, discountCents: 5_000, totalHtCents: 95_000 },
      nodes: [section("s-lot", null, "Lot", 1), line("l-remise", "s-lot", "Radiateur", 1, 100_000, { netHtCents: 95_000 })],
    };
    const outline = estimateOutline(discounted);
    expect(outline.totaux).toMatchObject({ total_brut_ht: "1 000,00 €", remise: "50,00 €", total_ht: "950,00 €" });
    expect(outline.sections[0]).toMatchObject({ total_ht: "950,00 €" });
    expect(outline.note).toContain("remise");
    // The list and the detail show what the editor shows; the net is named apart.
    expect(estimateLines(discounted, {}).lignes[0]).toMatchObject({ total_ht: "1 000,00 €" });
    expect(estimateLineDetail(discounted, "l-remise").calcul).toMatchObject({
      total_ht: "1 000,00 €", total_net_ht_apres_remise: "950,00 €",
    });
  });

  it("lists the lines of a section and of its sub-sections, in the estimate's order", () => {
    const result = estimateLines(reading, { sectionId: "s-plomberie" });
    expect(result.lignes.map((entry) => entry.id)).toEqual(["l-cuivre", "l-per", "l-vanne"]);
    expect(result.lignes[0]).toEqual({
      id: "l-cuivre", section: "Plomberie > Réseaux", designation: "Tube cuivre Ø22", quantite: 2, unite: "ml",
      statut: "Chiffrée", pu_ht: "25,00 €", total_ht: "50,00 €",
    });
    expect(result.lignes_restantes).toBe(0);
  });

  it("finds lines by their designation whatever the accents and the case", () => {
    expect(estimateLines(reading, { search: "chaudiere" }).lignes.map((entry) => entry.id)).toEqual(["l-chaudiere"]);
  });

  it("pages long lists and says how many lines are left", () => {
    const many: EstimateReading = {
      ...reading,
      nodes: Array.from({ length: 205 }, (_, index) => line(`l-${index}`, null, `Ligne ${index}`, index, 100)),
    };
    const first = estimateLines(many, {});
    expect(first.lignes).toHaveLength(80);
    expect(first.lignes_restantes).toBe(125);
    const last = estimateLines(many, { offset: 160 });
    expect(last.lignes.map((entry) => entry.id)).toEqual(Array.from({ length: 45 }, (_, index) => `l-${160 + index}`));
    expect(last.lignes_restantes).toBe(0);
  });

  it("keeps the footer readable on an estimate of many sections", () => {
    const wide: EstimateReading = {
      ...reading, nodes: Array.from({ length: 230 }, (_, index) => section(`s-${index}`, null, `Section ${index}`, index)),
    };
    const outline = estimateOutline(wide);
    expect(outline.sections).toHaveLength(200);
    expect(outline.sections_non_listees).toBe(30);
    expect(outline.totaux.total_ht).toBe("170,00 €");
  });

  it("refuses a section that is not in the estimate", () => {
    expect(() => estimateLines(reading, { sectionId: "s-absente" })).toThrow("Section introuvable");
    expect(() => estimateLines(reading, { sectionId: "l-cuivre" })).toThrow("Section introuvable");
  });

  it("details one line: what was entered, what the engine computed, and where it sits", () => {
    expect(estimateLineDetail(reading, "l-cuivre")).toEqual({
      devis: expect.objectContaining({ id: "v-1" }),
      id: "l-cuivre", section: "Plomberie > Réseaux", designation: "Tube cuivre Ø22", description: null,
      quantite: 2, unite: "ml", statut: "Chiffrée", source: null,
      // No raw K FO beside the sentence that already gives the single visible one.
      saisie: { prix_base_fo_ht: "10,00 €", heures_mo_par_unite: 0.5, heures_mo: null, k_mo: 1, taux_tva: "20 %" },
      calcul: {
        pu_ht: "25,00 €", total_ht: "50,00 €", debourse_ht: "24,00 €", part_fo_ht: "30,00 €", part_mo_ht: "20,00 €",
        heures_mo: "1.000", detail_cout_fo: "Prix catalogue 10,00 € × K FO 1,2 = 12,00 € de coût FO",
      },
    });
    expect(estimateLineDetail(reading, "l-chaudiere").calcul).toBeNull();
    expect(estimateLineDetail({ ...reading, nodes: [line("l-v2", null, "Ligne moteur 2", 1, 1_000, { foCostText: null })] }, "l-v2").saisie)
      .toMatchObject({ k_fo: 1.2 });
    expect(() => estimateLineDetail(reading, "s-cvc")).toThrow("Ligne introuvable");
  });

  it("compares two versions section by section and gives the differences already computed", () => {
    const next: EstimateReading = {
      ...reading,
      version: { ...reading.version, id: "v-2", label: "V2" },
      totals: { ...reading.totals, totalHtCents: 20_500 },
      warnings: [],
      nodes: [
        section("s2-plomberie", null, "Plomberie", 1),
        section("s2-reseaux", "s2-plomberie", "Réseaux", 1),
        line("l2-cuivre", "s2-reseaux", "Tube cuivre Ø22", 1, 5_000),
        line("l2-per", "s2-reseaux", "Tube PER Ø16", 2, 4_000),
        line("l2-vanne", "s2-plomberie", "Vanne d’arrêt", 2, 8_000),
        section("s2-sanitaire", null, "Sanitaire", 2),
        line("l2-lavabo", "s2-sanitaire", "Lavabo", 1, 1_500),
        line("l2-divers", null, "Divers hors lot", 3, 2_000),
      ],
    };
    const comparison = compareEstimates(reading, next);
    expect(comparison.ecart_total_ht).toBe("+35,00 €");
    expect(comparison.total_ht_a).toBe("170,00 €");
    expect(comparison.total_ht_b).toBe("205,00 €");
    // Unchanged sections (Réseaux) are left out: only what explains the difference is listed.
    expect(comparison.sections_differentes).toEqual([
      { chemin: "Plomberie", total_ht_a: "150,00 €", total_ht_b: "170,00 €", ecart: "+20,00 €" },
      { chemin: "CVC", total_ht_a: "0,00 €", total_ht_b: null, ecart: null },
      { chemin: "Sanitaire", total_ht_a: null, total_ht_b: "15,00 €", ecart: null },
    ]);
    expect(comparison.avertissements_a).toEqual(reading.warnings);
    expect(compareEstimates(next, reading).ecart_total_ht).toBe("-35,00 €");
  });

  it("gives no difference, and says why, when one of the two drafts cannot be computed", () => {
    const refused: EstimateReading = {
      ...reading, version: { ...reading.version, id: "v-3" },
      totals: { ...reading.totals, totalHtCents: null }, warnings: ["Le brouillon ne peut pas être calculé en l’état : unité manquante."],
    };
    const comparison = compareEstimates(reading, refused);
    expect(comparison.ecart_total_ht).toBeNull();
    expect(comparison.sections_differentes).toEqual([]);
    expect(comparison.avertissements_b).toEqual(["Le brouillon ne peut pas être calculé en l’état : unité manquante."]);
    expect(estimateOutline(refused).sections[0]?.total_ht).toBeNull();
  });

  it("adds up sections that share a path instead of comparing only the last one", () => {
    const twice = (id: string, amounts: [number, number]): EstimateReading => ({
      ...reading, version: { ...reading.version, id },
      nodes: [
        section(`${id}-a`, null, "Divers", 1), line(`${id}-la`, `${id}-a`, "A", 1, amounts[0]),
        section(`${id}-b`, null, "Divers", 2), line(`${id}-lb`, `${id}-b`, "B", 1, amounts[1]),
      ],
    });
    expect(compareEstimates(twice("v-a", [1_000, 2_000]), twice("v-b", [1_000, 2_500])).sections_differentes)
      .toEqual([{ chemin: "Divers", total_ht_a: "30,00 €", total_ht_b: "35,00 €", ecart: "+5,00 €" }]);
  });
});
