import { describe, expect, it } from "vitest";

import { resolveRenderMarginMode } from "@/lib/estimates/margin-tiers-loader";

describe("resolveRenderMarginMode", () => {
  // Regle produit : un devis signe ne se modifie pas. Pour repartir d'un devis
  // signe, on cree une VARIANTE — l'original reste tel qu'il a ete transmis.
  //
  // Le piege que ceci ferme : en mode `tiered`, le moteur re-resout le palier
  // depuis le bareme COURANT du tenant a chaque rendu. Le pied et les lignes
  // etant lus des colonnes stockees, seuls les sous-totaux de chapitre
  // bougeaient — un devis envoye pouvait donc afficher un chapitre qui ne somme
  // ni ses propres lignes ni son total.

  it("garde le bareme vivant sur un brouillon", () => {
    expect(resolveRenderMarginMode("draft", "tiered")).toBe("tiered");
    expect(resolveRenderMarginMode("draft", "fixed")).toBe("fixed");
  });

  it("fige la marge des que le devis a quitte le brouillon", () => {
    for (const status of ["sent", "accepted", "canceled"]) {
      expect(resolveRenderMarginMode(status, "tiered")).toBe("fixed");
    }
  });

  it("fige aussi quand le statut est inconnu ou absent", () => {
    // Repli sur du fige : mieux vaut afficher la marge persistee que de
    // recalculer avec le contexte du jour sur une version qu'on n'identifie pas.
    expect(resolveRenderMarginMode(null, "tiered")).toBe("fixed");
    expect(resolveRenderMarginMode(undefined, "tiered")).toBe("fixed");
  });

  it("retombe sur fixed quand le mode est absent sur un brouillon", () => {
    expect(resolveRenderMarginMode("draft", null)).toBe("fixed");
    expect(resolveRenderMarginMode("draft", undefined)).toBe("fixed");
  });
});
