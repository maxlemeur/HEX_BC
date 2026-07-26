import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Garde anti-régression sur l'accentuation FR des libellés visibles à l'écran.
 *
 * L'audit relève l'absence d'accents chez les 6 personas (UX10, UX23, UX34,
 * UX52). Sur un outil professionnel français, et surtout sur un document
 * contractuel, ça décrédibilise. Le client-facing a été traité (`5503cd7`,
 * `9de6a46`) ; l'interne est une campagne en cours.
 *
 * POURQUOI UNE LISTE DE FICHIERS ET PAS UN BALAYAGE GLOBAL.
 *
 * Une substitution automatique mot à mot a été essayée puis abandonnée : sur
 * 1170 chaînes, elle francisait des noms de tests anglais (« source details »
 * → « source détails ») et produisait des phrases à moitié corrigées
 * (« déjà verrouillee »), parce qu'aucune table de mots ne couvre le
 * vocabulaire. Ça a l'air fait et ça ne l'est pas.
 *
 * La campagne avance donc fichier par fichier, chacun relu en entier. Un
 * fichier n'entre dans `FICHIERS_PROPRES` qu'une fois réellement traité, et le
 * garde empêche qu'il régresse. C'est ce qui fait converger une campagne
 * mécanique au lieu de la laisser à moitié faite.
 */
const FICHIERS_PROPRES = [
  "src/components/takeoff/TakeoffReviewPage.tsx",
  "src/components/takeoff/TakeoffReviewTable.tsx",
  "src/lib/estimates/client.ts",
  "src/lib/estimates/server.ts",
  "src/components/affaires/AffaireFileDropSurface.tsx",
  "src/components/affaires/AffaireFlowHierarchyPanel.tsx",
  "src/components/affaires/AffaireOrderDraftsPanel.tsx",
  "src/components/affaires/AffairePilotagePanel.tsx",
  "src/components/affaires/IntakeDocumentCard.tsx",
  "src/components/affaires/IntakeDropzone.tsx",
  "src/components/affaires/IntakeWorkspace.tsx",
  "src/components/imports/importWizardHistory.ts",
  "src/lib/affaires/register-server.ts",
  "src/lib/affaires/server.ts",
  "src/lib/cockpit/suggestions.ts",
  "src/components/SupplierCreateModal.tsx",
  "src/components/catalogue/price-book-csv-import/UnknownResolutionPanel.tsx",
  "src/components/catalogue/price-book-csv-import/usePriceBookCsvWorkflow.ts",
  "src/components/estimates/SupplierComparisonPanel.tsx",
  "src/lib/catalogue/server.ts",
  "src/lib/estimates/purchase-order-drafts.ts",
];

/**
 * Formes fautives dont l'équivalent accentué est certain, et qui ne sont ni un
 * mot anglais ni un identifiant courant. Volontairement conservatrice : mieux
 * vaut manquer une faute que bloquer une PR sur un faux positif.
 */
const FORMES_FAUTIVES = [
  "Creer", "creer",
  "Parametre", "parametre",
  "Categorie", "categorie",
  "Deja", "deja",
  "Verifie", "verifie", "Verifiez", "verifiez",
  "Termine", "termine",
  "Quantite", "quantite",
  "Unite", "unite",
  "Qualite", "qualite",
  "Numerotation",
  "Echeance", "echeance",
  "Apercu", "apercu",
  "metre applique", "deja ete",
  "controle termine",
  "activite metres",
];

function litterauxSuspects(source: string) {
  const suspects: string[] = [];
  source.split("\n").forEach((line, index) => {
    if (/^\s*import |from ["']|data-testid/.test(line)) return;
    const literals = line.match(/"[^"]{3,140}"|'[^']{3,140}'/g) ?? [];
    for (const literal of literals) {
      const text = literal.slice(1, -1);
      // Cle technique, chemin, identifiant : hors sujet.
      if (/^[a-z0-9_\-.:/]+$/.test(text)) continue;
      const faute = FORMES_FAUTIVES.find((mot) =>
        new RegExp(`\\b${mot}\\b`).test(text)
      );
      if (faute) suspects.push(`ligne ${index + 1} — « ${text} »`);
    }
  });
  return suspects;
}

describe("accentuation FR des libellés — fichiers déjà traités", () => {
  it.each(FICHIERS_PROPRES)("%s ne réintroduit pas de libellé sans accent", (file) => {
    const source = readFileSync(join(process.cwd(), file), "utf8");
    expect(litterauxSuspects(source)).toEqual([]);
  });

  it("détecte réellement une faute, sinon le garde ne garde rien", () => {
    const faux = 'const label = "Quantite nulle";';
    expect(litterauxSuspects(faux)).toHaveLength(1);
  });

  /**
   * La table ci-dessus est de la donnée, pas un libellé — mais elle ressemble
   * à s'y méprendre à ce qu'une campagne d'accentuation vient corriger. Un
   * balayage l'a déjà réécrite une fois (`"Termine"` → `"Terminé"`), ce qui
   * désarme le garde en silence : il se met à chercher la forme correcte.
   * Cette assertion rend l'accident bruyant.
   */
  it("garde sa propre table de fautes intacte", () => {
    const accentuees = FORMES_FAUTIVES.filter((mot) =>
      /[éèêëàâäçùûüôöîïœÉÈÊËÀÂÄÇÙÛÜÔÖÎÏŒ]/.test(mot)
    );
    expect(accentuees).toEqual([]);
  });

  it("ne signale ni les clés techniques ni l'anglais", () => {
    const sain = [
      'const key = "zero_quantity";',
      'it("returns source details for an affaire", () => {});',
      'const label = "Quantité nulle";',
    ].join("\n");
    expect(litterauxSuspects(sain)).toEqual([]);
  });
});
