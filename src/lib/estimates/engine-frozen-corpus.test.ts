// Corpus figé des moteurs de calcul 1 et 2 — lot 2, sous-lot 2.0, invariant I1 (b).
// Conception : docs/audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md §2 (I1), §10.3.
//
// Pourquoi un test isolé : 600 devis comparés au centime, sur toutes les branches des moteurs 1
// et 2, ne se rejouent pas en E2E. Les parcours E2E du lot 2 prouvent les chemins applicatifs ;
// ce corpus prouve qu'aucun montant v1/v2 ne bouge pendant que le moteur 3 s'installe à côté.
// Vert par construction à sa génération (`scripts/engine-v3/frozen-corpus.ts`, avant toute
// modification du lot 2) ; il doit le rester, sans régénération, à chaque sous-lot.
//
// Défaillances que ce test doit révéler (écrites avant le code) :
//  M1  Un arrondi change dans le moteur 1 ou 2 (bankersRound <-> Math.round, demi-centime,
//      ordre « somme puis arrondi ») : ±1 c sur coût, vente, PU, TVA, remise ou répartition.
//  M2  L'ordre des opérations change : coefficient global avant/après remise, TVA par ligne ou
//      sur le pied, TVA de la remise, plancher de l'arrondi commercial au HT.
//  M3  Une v1 ou une v2 est aiguillée vers un autre chemin dans les moteurs (`=== 2` remplacé
//      par `>= 2`, un `calcEngineVersion` oublié) : les montants changent. Le corpus passe
//      `calcEngineVersion` explicitement : le résolveur `resolveCalcEngineVersion` n'est pas
//      exercé ici, mais par les empreintes documentaires.
//  M4  Remise : assiette (avant/après coefficient), plafonnement du montant fixe, remise
//      historique en %, palier unique en mode simple, cascade (y compris un palier nul).
//  M5  Autoliquidation : TVA fantôme réintroduite, ou arrondi TTC appliqué sans TVA.
//  M6  Multi-taux : taux de ligne ignoré en v2, ou plus imposé par le taux de version en v1
//      (`normalizeDraftItems`).
//  M7  Ventilation atelier/chantier : détection du payload, repli des taux dédiés sur le taux
//      par défaut puis sur 0, part MO/FO, payload ignoré quand le drapeau est coupé.
//  M8  Paliers de marge : seuils, tri, barème par défaut quand la liste est vide.
//  M9  Arrondi commercial : modes, pas nul ou non, ajustement reporté en TVA ajustée.
//  M10 Écrêtage au plafond int32 : `isCapped` perdu ou montant écrêté différemment.
//  M11 Relecture figée : la relecture v1 (`computeStoredDiscountCents`, `computeReadOnlyTotals`)
//      ou v2 (`buildStoredEstimateBreakdown`, sections relues) lit autre chose que les colonnes
//      figées, ou reventile autrement la TVA quand un arrondi commercial existe.
//  M12 Gel v2 (`buildEstimateV2SnapshotProjection`) : PU figé, TVA répartie. Aucun cas du
//      corpus n'atteint le chemin d'erreur de la projection : il n'est pas couvert ici.
//  M13 Arbre : ordre des sections, lignes racine, agrégation des sections imbriquées.
// Défaillances du harnais lui-même :
//  H1  Générateur non déterministe (hasard, date, ordre d'itération) : `--check` régénère et
//      compare l'octet ; ici, chaque ligne de cas est recalculée et comparée telle quelle.
//  H2  Fixture régénérée après un changement de moteur (vert, mais faux) : le générateur refuse
//      d'écraser et refuse un moteur modifié ; empreinte et provenance relues en revue.
//  H3  Fixture tronquée ou retouchée à la main : comptes 300/300, empreinte SHA-256, couverture
//      minimale contractuelle vérifiés ci-dessous.
//  H4  Comparaison trop lâche (`toEqual` ignore les propriétés `undefined`) :
//      on compare des chaînes JSON canoniques ; un champ ajouté ou retiré d'une ligne ou d'une
//      section du breakdown fait échouer la sérialisation.
//  H5  Comparaison trop stricte (simple réordonnancement des clés d'un littéral) : clés triées.
// Hors de portée (prouvé ailleurs) : le SQL du gel et de la publication (pgTAP, test de montée
// de version §10.2), le choix des entrées par l'application (E2E), le document client
// (empreintes documentaires, `scripts/engine-v3/document-fingerprints.ts`).

import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  computeFrozenCorpusOutput,
  describeFrozenCorpusCoverage,
  extractFrozenCorpusCaseLines,
  fingerprintFrozenCorpusLines,
  FROZEN_CORPUS_CASES_PER_ENGINE,
  FROZEN_CORPUS_COLUMNS,
  FROZEN_CORPUS_FORMAT,
  FROZEN_CORPUS_PATH,
  serializeFrozenCorpusCase,
  type FrozenCorpusCoverage,
  type FrozenCorpusFile,
} from "../../../scripts/engine-v3/frozen-corpus";

// Couverture contractuelle minimale, par moteur. Elle décrit ce que le corpus doit continuer à
// exercer ; une fixture qui ne la tient plus n'est plus une preuve de I1.
const MINIMUM_COVERAGE_PER_ENGINE: FrozenCorpusCoverage = {
  "amount:capped": 2,
  "coefficient:global": 50,
  "discount:cascade": 50,
  "discount:fixed": 50,
  "discount:fixedCapped": 5,
  "discount:none": 50,
  "discount:percent": 50,
  "discount:simpleStep": 50,
  "labor:split": 50,
  "labor:splitPayloadIgnored": 10,
  "margin:tierAboveFirst": 10,
  "margin:tieredDefault": 15,
  "margin:tieredTenant": 30,
  "quantity:decimal": 150,
  "rounding:adjusted": 50,
  "rounding:down": 50,
  "rounding:nearest": 50,
  "rounding:up": 50,
  "structure:empty": 1,
  "structure:nested": 30,
  "structure:rootLines": 30,
  "vat:multiRate": 50,
  "vat:reverseCharge": 30,
};

const fixtureText = readFileSync(path.resolve(process.cwd(), FROZEN_CORPUS_PATH), "utf8");
const corpus = JSON.parse(fixtureText) as FrozenCorpusFile;
const storedLines = extractFrozenCorpusCaseLines(fixtureText);

describe("corpus figé des moteurs 1 et 2 (lot 2, I1 b)", () => {
  it("recalcule les 600 devis au centime près, à l'octet près", () => {
    expect(corpus.format).toBe(FROZEN_CORPUS_FORMAT);
    expect(corpus.columns).toEqual(FROZEN_CORPUS_COLUMNS);
    expect(storedLines).toHaveLength(corpus.cases.length);

    const mismatches: Array<{ id: string; stored: unknown; recomputed: unknown }> = [];
    const recomputedLines = corpus.cases.map((storedCase, index) => {
      const line = serializeFrozenCorpusCase({
        id: storedCase.id,
        engine: storedCase.engine,
        input: storedCase.input,
        output: computeFrozenCorpusOutput(storedCase.engine, storedCase.input),
      });
      if (line !== storedLines[index]) {
        mismatches.push({
          id: storedCase.id,
          stored: JSON.parse(storedLines[index]).output,
          recomputed: JSON.parse(line).output,
        });
      }
      return line;
    });

    // Le premier écart est déplié pour que le diff de Vitest montre le champ fautif.
    expect(mismatches[0]?.recomputed).toEqual(mismatches[0]?.stored);
    expect(mismatches.map((mismatch) => mismatch.id)).toEqual([]);
    expect(fingerprintFrozenCorpusLines(recomputedLines)).toBe(corpus.fingerprint);
  });

  it("garde 300 devis par moteur et la couverture contractuelle", () => {
    const engines = corpus.cases.map((storedCase) => storedCase.engine);
    expect(engines.filter((engine) => engine === 1)).toHaveLength(
      FROZEN_CORPUS_CASES_PER_ENGINE
    );
    expect(engines.filter((engine) => engine === 2)).toHaveLength(
      FROZEN_CORPUS_CASES_PER_ENGINE
    );
    expect(new Set(corpus.cases.map((storedCase) => storedCase.id)).size).toBe(
      corpus.cases.length
    );

    const coverage = describeFrozenCorpusCoverage(corpus.cases);
    expect(coverage).toEqual(corpus.coverage);
    const belowMinimum = (["v1", "v2"] as const).flatMap((engine) =>
      Object.entries(MINIMUM_COVERAGE_PER_ENGINE)
        .filter(([feature, minimum]) => (coverage[engine][feature] ?? 0) < minimum)
        .map(([feature, minimum]) =>
          `${engine} ${feature}: ${coverage[engine][feature] ?? 0} < ${minimum}`
        )
    );
    expect(belowMinimum).toEqual([]);
  });
});
