# Moteur v3 — décisions et origine des oracles

Cette fiche conserve la provenance des nombres et des arbitrages cités par les
migrations et les tests. Le moteur v3 est implémenté ; les règles courantes sont
[décrites ici](../../metier/regles-de-calcul.md). Les états de livraison, plans
par sous-lot et recettes de l'audit d'octobre 2026 ne décrivent plus le code courant.

La conception complète validée le 16 octobre 2026 reste consultable dans Git :

```sh
git show 3df9bc1a797a3a902a20ca47ddc328b263f1226a:docs/audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md
```

Les anciennes références `D1` à `D18`, `P-01` à `P-20` et les numéros de sections
absents de cette fiche désignent cette version historique. Une référence dans
une migration appliquée est une trace de conception, pas une consigne de déploiement.

## Décisions durables et implémentation

| Décision | Motif et source actuelle |
| --- | --- |
| Moteur épinglé à chaque version ; v1/v2 historiques, v3 par défaut sauf politique 2 explicite | Préserver les montants existants. [Résolution](../../../src/lib/estimates/calc-engine-version.ts) et [politique de création](../../../supabase/migrations/20261018183629_estimate_engine_v3_default.sql). |
| Heures par unité distinctes des heures totales | La main-d'œuvre varie avec la quantité sans réinterpréter les colonnes historiques. [Calcul de ligne](../../../src/lib/estimates/engine-v3/line.ts). |
| Coefficients de vente FO/MO et intention unique de remise | Les coefficients portent la vente, la remise garde son montant ou son taux d'origine. [Types](../../../src/lib/estimates/engine-v3/types.ts), [remise](../../../src/lib/estimates/engine-v3/discount.ts). |
| PU au centime puis montant brut quantité × PU ; répartition exacte de la remise et TVA par taux | Réconcilier les valeurs affichées, les lignes nettes et le pied. [Arithmétique](../../../src/lib/estimates/engine-v3/decimal.ts), [répartition](../../../src/lib/estimates/engine-v3/allocate.ts), [TVA](../../../src/lib/estimates/engine-v3/tax.ts). |
| Gel recalculé et contrat client v2 distinct | Refuser les écarts au moment contractuel et conserver l'offre émise. [Projection](../../../src/lib/estimates/engine-v3/projection.ts), [contrat SQL](../../../supabase/migrations/20261018102840_estimate_offer_client_contract_v2.sql). |
| Offres à zéro qualifiées et conversion d'achat explicite | Un zéro non qualifié n'est pas un prix gratuit ; un conditionnement ne se déduit pas du libellé. [Éligibilité](../../../src/lib/estimates/supplier-offer-eligibility.ts), [conversion](../../../src/lib/estimates/supplier-offer-purchase-unit.ts). |

## 5. Oracle, scénarios et tolérances

Les tableaux suivants sont les attendus historiques de conception, conservés sans
recalcul. Ils sont transcrits dans les [fixtures numériques](../../../src/lib/estimates/engine-v3/oracle.fixtures.ts),
que lisent [les cas d'exigence](../../../src/lib/estimates/engine-v3/requirements.test.ts)
et [les propriétés](../../../src/lib/estimates/engine-v3/properties.test.ts) ; aucun
contrôle ne compare plus les totaux de scénario de ces tableaux.
La source numérique [D4-extraits.json](../reproductions/d4/D4-extraits.json) est
conservée pour la traçabilité. Ces valeurs ne prouvent aucune exécution récente.

### 5.1 Lignes-oracle (D4 §2.4)

Taux 40 €/h, `k_fo = k_mo = maj = 1`, PR FO au centime, c_FO = 1,30 et c_MO = 1,20. Valeurs recalculées.

| Id | Q / U | PR FO (c) | h/u | **PU v3** | PU de l'offre | **Total v3** | Total de l'offre | Écart | Déboursé |
|---|---|---|---|---|---|---|---|---|---|
| O1 | 20 ml | 5 466 | 1,991 | **16 663** | 166,63 | **333 260** | 333 252 | +8 | 268 600 |
| O2 | 3 u | 9 563 | 1,75 | **20 832** | 208,32 | **62 496** | 62 496 | 0 | 49 689 |
| O3 | 21 m2 | 5 850 | 0 | **7 605** | 76,05 | **159 705** | 159 705 | 0 | 122 850 |
| O4 | 1 139 ml | 302 | 0,2 | **1 353** | 13,53 | **1 541 067** | 1 540 611 | +456 | 1 255 178 |
| O5 | 1 u | 2 000 | 6 | **31 400** | 314,00 | **31 400** | 31 400 | 0 | 26 000 |
| O6 | 282 ml | 9 186 | 0,998 | **16 732** | 167,32 | **4 718 424** | 4 718 480 | −56 | 3 716 196 |
| O7 | 8 ml | 883 | 1,30 | **7 388** | 73,88 | **59 104** | 59 103 | +1 | 48 664 |
| Σ | | | | | | **6 905 456** | 6 905 047 | +409 | 5 487 177 |

- Avec 1,3 / 1,3, les PU valent 17 459, 21 532, 7 605, 1 433, 33 800, 17 131 et 7 908 c : ce sont les PU
  affichés par le classeur.
- Le PU de l'offre est reproduit sur **7 lignes sur 7**. L'écart de total vient uniquement de la règle A4
  (Q × PU affiché) et a été accepté par le porteur le 16/10/2026 (P-03).
- O2 : la saisie est fixée à 9 563 c avec `k_fo = 1`. Un PR exact de 95,625 € donnerait 208,31 € (P-10).

### 5.2 Scénarios chiffrés (TVA 20 % sauf mention)

| Scénario | HT brut | Remise | Arrondi | HT net | TVA | TTC |
|---|---|---|---|---|---|---|
| S1 sans remise | 6 905 456 | 0 | 0 | 6 905 456 | 1 381 091 | 8 286 547 |
| S2 remise 1,01 € (EU01 transposé) | 6 905 456 | 101 | 0 | 6 905 355 | 1 381 071 | 8 286 426 |
| S3 remise 10 % | 6 905 456 | 690 546 | 0 | 6 214 910 | 1 242 982 | 7 457 892 |
| S4 = S2, arrondi HT au pas de 100 € inférieur | 6 905 456 | 101 | 5 355 | 6 900 000 | 1 380 000 | 8 280 000 |
| S5 = S2, O1–O3 à 10 % et O4–O7 à 20 % | 6 905 456 | 101 | 0 | 6 905 355 | 55 545 + 1 269 980 = 1 325 525 | 8 230 880 |

S5 : les 101 c sont répartis `[5, 1, 2, 23, 0, 69, 1]`. Les bases valent 555 453 c à 10 % et 6 349 902 c à 20 %.
Une TVA calculée ligne à ligne donnerait 1 325 527 c : c'est l'écart que supprime A5.

### 5.3 Cas d'exigence

| Cas | Entrée | Attendu v3 |
|---|---|---|
| T-HMO | Q 10, PR 1 000 c, 0,5 h/u, 4 500 c/h, coefficients 1 | PU 3 250, total 32 500, MO 22 500 (v2 : 12 250) |
| T-HMO-Q | même ligne, Q de 10 à 20 | 65 000 : la MO suit la quantité |
| T-Q0 | même ligne, Q 0 | total 0, PU 3 250 affiché, MO 0 |
| T-PU | Q 3, PR 1 001 c, c_FO 1,6 | PU 1 602, total 4 806 |
| T-HALF3 | Q 1,005, PU 100 c | 101 |
| A-05 | PR 999 c × 7, c_FO 1,6 | PU 1 598, total 11 186 |
| EU01 | brut 1 995 450 c, montant 101 | appliqué 101 ; HT 1 995 349 ; TVA 399 070 ; TTC 2 394 419 ; `discount_bp` 0 |
| EU01-b | même brut, montant 99 | appliqué 99 ; HT 1 995 351 ; TVA 399 070 ; TTC 2 394 421 |
| EUHIST | PR 200 c, 10 %, c_FO de 1 à 2 | brut 400, remise 40, HT 360, TVA 72, TTC 432 ; `discount_bp` reste 1 000 |
| CAP | remise demandée 500 € sur une assiette de 400 € | appliquée 400 € ; « demandé / appliqué » |
| A-06 | 1 004 lignes, remise de 200 c | ΔTVA = 40 c exactement |
| T-TVA1 | 10 000 c à 20 % + 10 000 c à 5,5 % | TVA 2 550, récapitulatif sur 2 lignes |
| T-TVA-ARR | 3 lignes de 33 c à 20 % | TVA 20 c (v2 : 21 c) |
| T-TAXSNAP | 76 063 c, arrondi au pas de 1 € inférieur | arrondi 63 ; HT 76 000 ; TVA 15 200 ; TTC 91 200 ; ajustement 0 |
| R1-ARR | net avant arrondi 1 234 567 c, pas de 100 c | A = 67 ; HT 1 234 500 ; TVA 246 900 ; TTC 1 481 400 |
| T-CAP | PR 2 000 000 000 c, c_FO 1,6 | `ESTIMATE_AMOUNT_OVERFLOW`, sans écrêtage |
| T-MONO | déboursé 9 999 999 c puis 10 000 000 c, c 1,6 | HT 15 999 998 puis 16 000 000, sans palier |
| T-MARG | c 1,25 / 1,25, remise 20 % | marque nette 0 % ; une règle « marge minimum 15 % » est violée |
| T-STAT | ligne « hors lot » chiffrable à 500 € | 0 € au total ; libellé « Hors lot » |
| T-Z | offre à 0 € non marquée | inéligible partout ; marquée « inclus », elle est éligible et libellée |

## 10.3 Corpus figé et empreintes

- [Corpus v1/v2](../../../src/test/fixtures/engine-frozen-corpus.json) :
  300 devis par moteur, avec les sorties de référence antérieures à v3 ;
  [test de non-régression](../../../src/lib/estimates/engine-frozen-corpus.test.ts).
- [Empreintes documentaires](../../../src/test/fixtures/engine-document-fingerprints.before.json) :
  références v1/v2 ; [outil de comparaison](../../../scripts/engine-v3/document-fingerprints.ts).
- [Parité TypeScript/PostgreSQL](../../../scripts/engine-v3/parity.ts) :
  comparaison des deux moteurs v3 sur les mêmes entrées.

Un attendu ne se régénère pas pour rendre un échec vert. Une évolution voulue
exige l'explication de l'écart et une preuve de préservation des versions émises.
Les commandes de qualification et leurs environnements sont maintenus dans
[le guide de tests](../../testing/tester-army-ci.md).
