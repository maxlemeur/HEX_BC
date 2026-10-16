# Saisie et import (sous-lot 2.3) : défaillances avant correction

Statut : **implémenté, revu, corrigé et commité** sur `lot2/2.3-saisie-import` (16/10/2026, jamais
poussée ; base `de54931d`, issue de `main`). Les tests d'exigence ont d'abord été écrits rouges (sections
« Défaillances » à « Exécution rouge »), y compris ceux de la revue (R1 à R10) ; l'implémentation par zone,
la preuve d'intégration, puis les corrections de la revue et leurs preuves suivent. Sources : conception du lot 2
(`docs/audit-independant-2026-10-14/lot2/conception-lot2-moteur-v3.md`, §1 F16–F17, D11, §5, §14 « 2.3 »),
décisions P-11 et P-16 validées le 16/10/2026, constats d'audit C-01, C-11, U-03 et registre Q07
(`annexe-technique.md`, `registre-audit.csv`), données `reproductions/d4/D4-extraits.json`.

Invariants du sous-lot : `src/lib/estimate-calculations.ts` et `src/lib/estimate-v2-snapshot.ts` restent à
zéro ligne de diff ; aucune migration ; le chemin `dpgf_rows_raw` → correspondances →
`confirmUnifiedImportFlow` est conservé, avec `sourceDocumentId` et `_timax_provenance`. Les montants v1/v2
ne changent pas : le parcours OPTIMA ci-dessous est rejoué avec le moteur actuel (calcul hors navigateur :
HT 7 133 330 c, TVA 1 426 666 c, TTC 8 559 996 c sur les 7 lignes, moteurs 1 et 2 identiques).

## Conciliation avec `tech-debt-numeric-entry.md`

Le contrat des développeurs (`d484c5a1`) est conservé : grammaire unique, « 1.250 » refusé, nombres natifs
non réinterprétés, sentinelles d'import lues comme absences, vide géré par chaque champ et distinct d'une
erreur. Le test existant `parseNumberInput("") → 0` reste inchangé.

L'exigence de la conception « vide → non renseigné, jamais 0 » est lue ainsi : aux points d'entrée
(adaptateurs et parseurs), un vide vaut « non renseigné » (`null`), ce que les cinq points d'entrée font
déjà ; le champ applique ensuite son défaut documenté (quantité et heures 0, coefficients usuels 1). Une
seule exception est corrigée, la majoration MO : la cellule de grille et l'action groupée transforment
aujourd'hui un vide en ×0 et effacent la main-d'œuvre, alors que la majoration est un coefficient usuel.
Ce changement et ceux qu'impose D11 sont consignés dans `tech-debt-numeric-entry.md` (section 2.3).

## Défaillances observables et preuves qui doivent échouer avant correction

| # | Défaillance observable (origine) | Preuve rouge (ou non-régression) |
|---|---|---|
| E1 | « 1.250 » accepté comme 1 250 ou 1,25 (C-11, D11) | **Non-régression verte** : E2E `numeric-entry-v3` (cellule PR FO, panneau, collage) ; table de grammaire, 34 cas × 5 points d'entrée |
| E2 | Refus de « 1.250 » avec trois messages différents : `NUMERIC_INPUT_ERROR` en grille et dans le panneau, « Nombre invalide pour Prix unitaire HT. » au collage (D11) | E2E `numeric-entry-v3`, étape 4 (assertion conservée, rouge) |
| E3 | « 1 000 » vaut 1 dans la remise ou la marge (C-11) | **Non-régression verte** : E2E `numeric-entry-v3`, étape 2 (100 000 c après rechargement) |
| E4 | « 12,5 % », « 20 % » refusés dans un taux ; l'import rejette la ligne (`invalid_tax_rate`) (A8) | Vitest `entry-contract`, table « taux » (import rouge) |
| E5 | Décimales en trop arrondies en silence : quantité importée « 1,2345 » → 1,235 ; TVA « 12,555 » → 1 256 pb ; K FO « 1,23456 » accepté (D11, D13) | Vitest `entry-contract`, tables « quantité », « taux », « coefficient » |
| E6 | Pas de parseur par grandeur : chaque champ réinterprète la grammaire (D11 : `parseAmountCents`, `parseQuantity`, `parseHoursPerUnit`, `parseRateBp`, `parseCoefficient`, `parseMajorationPercent`) | Vitest `entry-contract`, 50 cas par grandeur |
| E7 | Majoration vidée = ×0 : la grille lit « » comme 0 % ; l'action groupée applique 0 à toutes les lignes sélectionnées (C-11) | Vitest `entry-contract` (grille : « » → 0) ; E2E `numeric-entry-v3`, étape 5 (« Appliquer » actif sur champ vide) |
| E8 | Action groupée « Majoration MO (%) » sans coefficient visible : « 8 » applique ×0,08 sans que l'utilisateur le voie (P-11, C-11) | E2E `numeric-entry-v3`, étape 5 (« ×1,5 » attendu avant application) |
| E9 | Grille : « 112,5 % » refusé, « 1 001 » accepté (×10,01 > 10) (P-11, D11) | Vitest `entry-contract`, table « majoration » |
| E10 | Collage : majoration sans unité devinée (« 10 » → ×10, « 150 » → ×1,5), coefficient déclaré « 12 » → ×0,12, « 1 100 % » → ×11 (F16) | Vitest `clipboard.test.ts`, convention de majoration |
| E11 | Import : majoration non déclarée prise brute (« 100 » → ×100, « 10 » → ×10) ; aucune cible déclarée (%, coefficient, additive OPTIMA « 0,15 » → ×1,15) (C-11, P-11) | Vitest `import-flow.test.ts`, convention de majoration |
| E12 | Export → réimport : « Majoration MO (%) » perd son unité dans la clé d'upload (serveur et worker navigateur), la réimportation multiplie la MO par 100 (C-11) | Vitest `mappings/server.test.ts`, deux parseurs d'upload |
| E13 | Copie de la grille → collage : « 1.234 », « 1.125 », « 0.125 » écrits avec un point sont refusés (quantité, K FO, h MO, majoration) ; la majoration est copiée brute sous un en-tête sans unité (D11) | Vitest `clipboard.test.ts`, aller-retour |
| E14 | En-têtes (F17, U-03) : « Prix Unitaire », « PR Fourniture unitaire », « Tps pose unitaire (majoré) », « Prix unitaire HT » → unité ; « Uté » ignoré ; « Prix Total » et « Tps pose total » → montant ; « Coeff FO/MO », « Taux horaire » ignorés ; « Qté Atelier/Chantier » muets ; « PU » générique et « PU MO Atelier/Chantier » → prix d'achat | Vitest `mappings/server.test.ts`, 15 en-têtes OPTIMA et 16 du client B, bruts et en clé d'upload ; E2E `import-optima-v2` (suggestions) |
| E15 | Collage OPTIMA : « Prix Unitaire » → unité, « Uté » ignoré (U-03) | Vitest `clipboard.test.ts`, en-têtes OPTIMA |
| E16 | Import OPTIMA dans une v1/v2 : heures par unité perdues ou lues comme heures de ligne ; aucun aperçu « h/u × Q » (C-01, P-16) | E2E `import-optima-v2` |
| E17 | Heures importées sans rôle MO : `labor_role_id` nul, taux 0, MO perdue sans alerte (constaté pendant cette préparation : le moteur v1/v2 lit le taux du rôle, sinon 0) | E2E `import-optima-v2` (rôle à 40 €/h et totaux exacts) |
| E18 | Colonne de contrôle prise comme valeur : « Prix Total » (vente) devient `total_ht`, qui sert de prix d'achat quand le PR FO manque, d'où une marge appliquée deux fois (D11) | Vitest `mappings/server.test.ts` ; E2E `import-optima-v2` |
| E19 | Aide des colonnes v1/v2 : « h MO » annoncé « par unité » alors que le moteur lit les heures de la ligne (C-01, D11) | E2E `numeric-entry-v3`, étape 3 (assertion conservée, rouge) |

Non-régressions de fin de sous-lot (campagne critique complète, pas avant) : `dpgf-import` (CSV) et
l'import XLSX de `takeoff/import-flow-carry-over.e2e.ts` inchangés ; corpus figé et empreintes (2.0).

## Revue de 2.3 : défaillances confirmées et preuves rouges

Une revue indépendante a relevé onze constats sur l'implémentation intégrée. Chacun a été revérifié
(lecture du code, sonde hors navigateur sur l'arbre de travail) avant correction : les onze sont
confirmés, avec une nuance pour R1 (ci-dessous). Les preuves rouges ont été écrites avant toute
correction, puis exécutées sur l'implémentation d'origine.

| # | Défaillance confirmée (constat) | Preuve rouge |
|---|---|---|
| R1 | Imports sans aperçu (P-16 « avec aperçu », E17) : l'import de la DPGF liée dans une version existante (`importLinkedDpgfSourceIntoVersion`, route `import-linked-dpgf`), le mode « DPGF source » de l'assistant de création et l'action de création rapide normalisent sans aperçu ni rôle. Les heures par unité y sont converties h/u × Q et valorisées à 0 €/h. Rejeu hors navigateur des 7 lignes-oracle : Σ 4 165 659 c à marge 1,30 sans rôle, 3 204 353 c à marge 1, contre 7 133 330 c avec le rôle à 40 €/h. Nuance : `QuickCreateAffaireDialog` n'est monté par aucune page depuis la création « hub-first » (`774ffa25`) ; l'action `quickCreateAffaire` reste exportée et le chemin de la DPGF liée est, lui, accessible. | Vitest `import-flow.test.ts`, « import paths without the preview » ; E2E `import-optima-v2`, étape `linked-dpgf-without-preview` (refus 400, version 1 toujours vide) |
| R2 | Cellule Excel au format pourcentage : « 115 % » est stocké 1,15 par les deux parseurs d'upload, donc lu ×0,0115 sous « Majoration MO (%) » sans alerte (une TVA « 20 % » devient 0,2 %). Le collage du même tableau lit « 115 % ». | Vitest `mappings/server.test.ts` (deux parseurs d'upload) et `import-flow.test.ts` ; E2E `import-optima-v2`, « percent-formatted… » |
| R3 | Un modèle de correspondance enregistré qui couvre exactement les colonnes d'un classeur OPTIMA l'emporte sur le profil déclaré : un modèle d'avant 2.3 lit « Tps pose unitaire » en heures de ligne et « Majoration MO » sans unité (C-01 continue en silence). | Vitest `mappings/server.test.ts`, « declared profile against a saved template » |
| R4 | Collage : « Prix Unitaire » (prix de vente OPTIMA), « PU », « PU HT », « Unit price », « Prix HT » proposés comme PR FO, d'où une marge appliquée deux fois (D11) ; l'import les propose en contrôle. | Vitest `clipboard.test.ts`, « pasted sale prices » ; E2E `numeric-entry-v3`, étape 7 |
| R5 | Export DPGF (`/api/estimates/[versionId]/export`) : majoration écrite en coefficient brut sous « Majoration MO », seconde convention humaine (P-11) ; sa réimportation refuse chaque ligne (`undeclared_majoration_unit`) et lit « Prix unitaire HT EUR » en prix de contrôle. | Vitest `dpgf-export.test.ts` (en-tête, valeur 115, aller-retour, ancien en-tête) |
| R6 | Précision divergente entre les points d'entrée (« 0 divergence », « 0 valeur ambiguë acceptée en silence ») : la grille et le collage gardent une quantité 1,2345, un K FO ou K MO 1,2345, des heures 2,1234, que PostgreSQL arrondit à l'écriture (`numeric(12,3)`) ; l'import accepte un K FO 1,2345 ; les réglages enregistrent « 12,555 » en 1 256 pb, « -5 » en 0 et refusent « 20 % ». Les tables par grandeur ne lisaient ni la grille, ni le collage, ni les réglages, et la table commune comptait 34 cas (40 exigés). | Vitest `entry-contract.test.ts` : table commune portée à 43 cas ; tables par grandeur étendues à la grille, au collage et aux réglages (quantité, heures de ligne, taux, coefficient stocké, majoration) ; E2E `numeric-entry-v3`, étapes 7 à 9 |
| R7 | Collage : une majoration sans unité déclarée « doit être choisie explicitement » (D11), mais la correspondance n'offre que « Majoration MO » ; seule issue : renommer l'en-tête dans la source. | Vitest `clipboard.test.ts`, « pasted majoration unit chosen in the mapping » |
| R8 | Rôle MO de l'aperçu (E17) : avec un « Taux horaire » sans rôle actif correspondant, l'option vide envoie `null`, qui redonne « choix obligatoire » ; un propriétaire sans rôle actif ne peut plus importer. | Vitest `import-flow.test.ts`, « labour role of imported hours » ; E2E `import-optima-v2`, « …matches no role… » |
| R9 | « Prix d'achat unitaire », « Prix de revient unitaire », « PR unitaire » pris pour un prix de contrôle (D11 réserve le PR FO aux prix d'achat explicites). | Vitest `mappings/server.test.ts`, « explicit purchase prices » |
| R10 | Les preuves E2E de 2.3 reposaient sur le correctif de tas `10da1caf` appliqué dans le clone WSL seulement : la branche ne reproduisait pas ses preuves. | Branche avancée sur `main` (`f8229144`, lanceur de build partagé) ; campagne critique finale sur l'arbre commité |

## Contrat de test retenu

Ces choix sont fixés par les tests rouges ; un écart à l'implémentation se discute avant de modifier un test.

- `src/lib/numeric-input/parsers.ts` exporte les six parseurs nommés par D11, de signature
  `(input: unknown) => number | null`, construits sur `parseDecimalInput` : montant en centimes
  (2 décimales, devise admise), quantité (3 décimales), heures par unité (4), taux en points de base
  (2 décimales de %, « % » final admis), coefficient (4), majoration en % rendue en coefficient stocké
  dans [0 ; 10]. Les décimales en trop sont refusées, jamais arrondies ; « % » n'est admis que pour un taux
  ou une majoration.
- Cibles de correspondance : `labor_hours_per_unit` ; majoration à unité déclarée
  `h_mo_majoration_percent` (100 = neutre), `h_mo_majoration_coefficient` (1 = neutre),
  `h_mo_majoration_additive` (profil OPTIMA, coefficient = 1 + N). L'ancienne cible `h_mo_majoration`
  signifie « unité non déclarée » : une valeur non vide est refusée, un vide garde ×1. Les rôles se
  reconnaissent au préfixe : `control_*` (colonne de contrôle), `param_*` (paramètre du classeur),
  `unsupported_*` (reconnue, signalée non prise en charge) ; les noms exacts restent libres.
- Collage : l'en-tête déclare l'unité par « (%) » ou « (coef) » ; sinon la ligne est refusée avec une
  raison qui nomme « Majoration MO ». Les deux en-têtes acceptés convertissent vers [0 ; 10].
- La copie de la grille relit à l'identique par le collage (décimales avec virgule, unité de majoration
  déclarée).
- Action groupée : un élément `data-testid="estimate-editor-bulk-majoration-coefficient"` affiche le
  coefficient (« ×1,5 » pour 150) avant « Appliquer », désactivé tant que le champ est vide.
- Aide des colonnes v1/v2 : « h MO » contient « heures totales de la ligne ».
- Import OPTIMA vers une v1/v2 : suggestions exactes pour Désignation, Uté, Qté, PR Fourniture
  unitaire, Tps pose unitaire (`labor_hours_per_unit`) et Majoration MO (`h_mo_majoration_additive`),
  colonnes calculées en contrôle et Coeff FO/MO, Taux horaire en paramètres ; aperçu « h/u × Q » ;
  heures de ligne stockées = arrondi(Q × h/u, 3) ; K FO, K MO et majoration à 1 (les coefficients 1,3 du
  classeur correspondent ici à la marge fixe 1,30 de la version) ; lignes avec heures rattachées au rôle MO
  actif de l'entreprise dont le taux égale « Taux horaire » (4 000 c). **Point à confirmer à
  l'implémentation** : sans rôle à ce taux, ou avec plusieurs, l'aperçu doit exiger un choix explicite
  plutôt qu'importer des heures à 0 €/h (E17).
- À mettre à jour avec l'implémentation, pas avant : `import-flow.test.ts`, cas « normalizes mapped rows
  into valid and invalid estimate lines », qui fixe `h_mo_majoration` « 1,1 » non déclaré → ×1,1.
- À surveiller : `parser.ts` (upload serveur) garde sa propre copie de `normalizeHeaderValue`, distincte
  de `tabular-normalization.ts` (worker) ; le test E12 lit les deux chemins. L'export de l'éditeur titre
  « Prix unitaire HT (EUR) » le PR FO : la règle « prix unitaire générique → contrôle » ne doit pas casser
  sa réimportation (non couvert par ces tests).

## Tests isolés et frontière gardée (AGENTS.md)

- `entry-contract.test.ts` (grammaire et grandeurs) : frontière de données commune aux réglages, à la
  grille, à l'import, au collage et aux montants. Séparateurs Unicode, précision par grandeur, ambiguïté
  et vide forment des dizaines de combinaisons qu'aucun parcours ne peut balayer ; les E2E en vérifient un
  échantillon par champ.
- `clipboard.test.ts` et `import-flow.test.ts` (convention de majoration) : intégrité des données
  (facteur 100 sans alerte) sur toutes les combinaisons en-tête × unité ; l'E2E couvre l'action groupée et
  la majoration OPTIMA nulle seulement.
- `clipboard.test.ts` (aller-retour copie → collage) : la copie écrit dans le presse-papier du système,
  qu'aucun parcours navigateur ne relit (limite déjà notée par les développeurs).
- `mappings/server.test.ts` (heuristique d'en-têtes, clés d'upload) : l'heuristique est commune à CSV, XLS,
  XLSX et PDF, et l'upload a deux parseurs ; seul l'XLSX OPTIMA a un parcours Army (XLS et PDF n'en ont pas).
- Revue (R1 à R9) : mêmes frontières. `import-flow.test.ts` couvre la normalisation partagée par les quatre
  chemins d'import (aperçu, DPGF liée, assistant, création rapide), dont trois n'ont pas d'écran d'aperçu à
  parcourir, et la résolution du rôle sur ses huit combinaisons ; l'E2E prouve un chemin sans aperçu (DPGF
  liée) et le refus explicite du rôle. `mappings/server.test.ts` lit les cellules au format pourcentage
  par les deux parseurs d'upload, dont le navigateur, qu'aucun parcours n'emprunte, et les conflits
  modèle/profil, qui exigent un modèle enregistré avant 2.3. `dpgf-export.test.ts` rejoue l'export →
  réimport sans fichier intermédiaire (l'export Army télécharge, l'import ne relit pas ce fichier).

## Parcours E2E écrits rouges

- `e2e/army/critical/numeric-entry-v3.e2e.ts` (« numeric entry v3 … ») : devis neuf, ligne ARMY, puis
  (1) « 1.250 » dans la cellule PR FO : refus, prix 1 000 c inchangé après rechargement ;
  (2) panneau : « 1.250 » refusé avec le même message, « 1 000 » → 100 000 c après rechargement ;
  (3) aide des colonnes ; (4) collage DOM d'un prix « 1.250 » : même message, aucune ligne créée ;
  (5) action groupée « Majoration MO (%) » : coefficient visible, 150 % → 1,5 persisté, champ vide refusé.
  Les assertions des défaillances E2, E7, E8 et E19 sont conservées (`expect.soft`) pour que toutes les
  causes figurent dans le rapport ; les valeurs persistées sont lues par l'API.
- `e2e/army/critical/import-optima-v2.e2e.ts` (« OPTIMA workbook … ») : classeur XLSX généré aux en-têtes
  OPTIMA réels (retours à la ligne compris), ligne de paramètres 1,3 / 1,3 / 0 / 40 et les 7 lignes-oracle
  sans désignation client ; devis v2 à marge fixe 30 % (×1,30) ; import par l'affaire ; suggestions lues
  par l'API puis dans le tableau de correspondance ; aperçu « h/u × Q » ; création de la version 2 ; valeurs
  persistées et rechargées.
  - Heures de ligne : 39,82 / 5,25 / 0 / 227,8 / 6 / 281,436 / 10,4.
  - Totaux : 3 491,80 / 645,96 / 1 597,05 / 16 317,31 / 338,00 / 48 310,55 / 632,63 ; Σ 71 333,30 €.
  - Preuves métier : `optima-input`, `optima-suggestions`, `optima-persisted-result`,
    `optima-reloaded-result`, `optima-owned-identities` sous `artifacts/business` de l'archive du run.
- `createEstimateViaWizard` accepte `marginPercent` (défaut « 0 », sans effet sur les parcours existants).
- Revue, écrits rouges avant correction :
  - `import-optima-v2`, étape `linked-dpgf-without-preview` (R1) : après la version 2, l'import de la DPGF
    liée dans la version 1 (`POST /api/estimates/{id}/import-linked-dpgf`) doit répondre 400 avec un message
    qui renvoie à l'aperçu, et la version 1 rester vide ;
  - `import-optima-v2`, « …hourly rate matches no role… » (R8) : classeur à 45 €/h, aucun rôle à ce taux ;
    l'aperçu exige un choix, « Aucun rôle (MO à 0 €/h) » le lève, la version 2 garde les heures h/u × Q
    sans rôle ;
  - `import-optima-v2`, « percent-formatted… » (R2) : cellule « Majoration MO (%) » saisie 115 % dans Excel
    (1,15 au format `0%`), stockée ×1,15 ;
  - `numeric-entry-v3`, étapes 7 à 9 (R4, R6) : collage « Quantité 1,2345 » refusé avec le message de la
    grille et « Prix Unitaire » laissé sur « Ignorer » ; cellule quantité « 1,2345 » refusée ; TVA des
    réglages « 5,5 % » → 550 pb, « 12,555 » refusé.

## Exécution rouge du 16/10/2026

Vitest (Windows, worktree, aucun code produit modifié) :
`npx vitest run --project=node src/lib/numeric-input/entry-contract.test.ts src/lib/estimates/clipboard.test.ts src/lib/affaires/import-flow.test.ts src/lib/mappings/server.test.ts`
→ 4 fichiers, **204 tests : 110 succès, 94 échecs**. Les 52 tests existants de ces fichiers restent
verts ; 58 nouveaux cas sont des non-régressions déjà vertes (34 de grammaire, 5 de collage, 3 d'import,
16 d'en-têtes).

- `entry-contract.test.ts` : 50 rouges sur 50 cas par grandeur (parseurs D11 absents). Écarts des points
  d'entrée existants dans ces tables : import quantité « 1,2345 » → 1,235 ; import TVA « 12,5 % »,
  « 20 % », « 2,1 % » refusés et « 12,555 » → 1 256 pb ; import K FO « 1,23456 » accepté ; grille
  majoration « 112,5 % » refusé, « 1 001 » → ×10,01, « » → ×0.
- `clipboard.test.ts` : 6 rouges (« 10 » → ×10, « 150 » → ×1,5, coefficient « 12 » → ×0,12,
  « 1 100 % » → ×11 ; aller-retour refusé sur quantité, K FO, h MO et majoration ; « Prix Unitaire » seule
  colonne mappée en unité) ; 5 cas de convention valides verts.
- `import-flow.test.ts` : 8 rouges (cibles déclarées ignorées, « 100 » et « 10 » non déclarés acceptés) ;
  3 verts (« 100 % », additive « 0 » et vide valent déjà ×1 par défaut).
- `mappings/server.test.ts` : 30 rouges (17 en-têtes réels, 6 « jamais l'unité », 3 « Uté », 3 « PU »
  génériques, export → réimport) ; 16 verts (14 en-têtes déjà conformes, « PR FO », « PR. FO »).

E2E (WSL Ubuntu-24.04, clone Linux du worktree, Node 24.14.0, pile native jetable, après contrôle du
verrou des piles natives) : `export NODE_OPTIONS=--max-old-space-size=4096 && npm run e2e:army:local --
--grep "numeric entry v3|OPTIMA workbook"`.

- Premier essai : pgTAP 13 fichiers / 1 253 assertions et matrice RLS réussis, puis **build en échec**
  (tas épuisé à ~2 Go dans le contrôle TypeScript de Next). `createLocalCiEnvironment` ne transmet pas
  `NODE_OPTIONS` ; le correctif `10da1caf` (branche `lot2/2.0-ligne-de-base`, `build-local.mjs`) n'est pas
  sur cette branche. Échec d'infrastructure, aucune preuve.
- Second essai, ce correctif appliqué **dans le clone WSL seulement** (absent du worktree, retiré après le
  run, inclus dans l'empreinte des changements locaux du manifeste) : archive
  `.e2e/army/ci/2026-10-16T14-27-02-185Z-critical/` du clone, run TesterArmy
  `01a1451d-4ac9-74cd-97c6-eef46c3e27c5`, révision `a75e4ca3` + changements locaux
  (`workingDiffSha256` `863e5909…`). pgTAP 1 253 / 1 253, RLS, build et budgets réussis ; **3 tests
  sélectionnés et exécutés : authentification réussie, 2 échecs pour les raisons attendues**, aucun ignoré.
  - `import-optima-v2` : préconditions vertes (v2, moteur 2, marge ×1,30, rôle unique à 4 000 c, upload
    XLSX `completed`, 8 lignes brutes, 15 colonnes). Arrêt à l'étape `map-columns` : la colonne `Ute` est
    proposée vide au lieu de `unit`. Assertions conservées : suggestions réelles `PR_Fourniture_unitaire`
    → `unit`, `PR_Total_fourniture` → `total_ht`, `Majoration_MO` → `h_mo_majoration`, `Tps_pose_unitaire`
    et `Ute` sans cible, aucune colonne de contrôle ni paramètre (E14, E16, E18). Aucune version importée.
  - `numeric-entry-v3` : étapes vertes conformes (refus de « 1.250 » en grille et dans le panneau avec le
    même message, prix 1 000 c inchangé, remise 100 000 c après rechargement, ligne collée absente,
    majoration groupée 150 % → 1,5 persistée). Quatre assertions conservées rouges : aide « h MO » « par
    unité » (E19), raison du collage « Nombre invalide pour Prix unitaire HT. » (E2), coefficient groupé
    absent (E8), « Appliquer » actif sur champ vide (E7).
  - Preuves métier : `critical/artifacts/business/ARMY-1792160914288-92f76002-optima-*.json` et
    `ARMY-1792160932984-8a7c1bd0-numeric-entry-v3.json` ; rapport `critical/runs/2026-10-16T14-28-29-021Z/`.
    Journal : `~/e2e-2-3-logs/20261016T142701Z-red2.log` (WSL).

## Implémentation, zone import (E11, E12, E14, E16 à E19)

Le chemin `dpgf_rows_raw` → correspondances → `confirmUnifiedImportFlow` est inchangé, avec
`sourceDocumentId` et `_timax_provenance`. Aucune migration ; `estimate-calculations.ts` et
`estimate-v2-snapshot.ts` à zéro ligne de diff. Les tests rouges de la zone passent sans modification,
sauf le cas « 1,1 » non déclaré annoncé ci-dessus, désormais déclaré en coefficient.

- Cibles (`mappings/schemas.ts`) : celles du contrat de test, plus des noms fixes pour les rôles :
  `control_unit_price`, `control_total_price`, `control_supply_unit_price`, `control_supply_total`,
  `control_marked_up_hours_per_unit`, `control_total_hours` ; `param_coeff_fo`, `param_coeff_mo`,
  `param_hourly_rate` ; `unsupported_quantity_*`, `unsupported_labor_price_*`, `unsupported_labor_total_*`
  (`workshop`, `site`). Chaque nom est distinct, la règle « une cible par colonne » reste valable. Le
  tableau de correspondance les groupe (« Colonnes de contrôle (jamais importées) », « Paramètres du
  classeur », « Reconnues, non prises en charge ») et ne compte que les valeurs dans sa progression.
- Heuristique (`mappings/server.ts`) : mots entiers ; colonnes atelier et chantier, durées, majoration,
  paramètres puis prix testés avant l'unité ; « Uté » et « Ute » sont l'unité. Un « Prix unitaire », « PU »
  ou « P.U. » générique est un prix de contrôle ; « PR FO » et « PR Fourniture unitaire » restent le prix
  d'achat ; « Montant HT » et « TOTAL HT » restent `total_ht` (comportement existant, accepté par le test).
- Profils déclarés (`imports/optima-profile.ts`) : OPTIMA (signature « PR Fourniture unitaire », « Tps pose
  unitaire », « Majoration MO », « Coeff MO ») et export de l'éditeur (« Prix unitaire HT (EUR) », « PU HT
  (EUR) », « Total HT (EUR) »). Un profil reconnu fixe ses colonnes (origine « Profil déclaré », score 0,9)
  au-dessus de la mémoire et de l'heuristique, jamais au-dessus d'un modèle enregistré (revu : un modèle qui
  contredit le profil n'est plus appliqué, R3). L'export de l'éditeur garde ainsi son « Prix unitaire HT
  (EUR) » en prix d'achat à la réimportation, point « À surveiller » levé.
- Clés d'upload : `parser.ts` réutilise la normalisation de `tabular-normalization.ts` (une seule copie pour
  le serveur et le worker). Une majoration garde son unité dans la clé (`Majoration_MO_pct`,
  `Majoration_MO_coef`) ; « Temps pose … majoré » n'est plus pris pour une majoration.
- Import (`affaires/import-flow.ts`) : parseurs par grandeur de la zone N (texte refusé au-delà de la
  précision, nombre natif arrondi à cette précision). Heures par unité → heures de ligne
  = arrondi demi supérieur (Q × h/u, 0,001 h), calcul entier exact. Les heures de ligne et les heures par
  unité renseignées ensemble sont refusées. La première ligne sans désignation qui porte un paramètre est
  la ligne de paramètres : ignorée (motif `parameters`), elle fournit le taux horaire et la majoration des
  lignes dont la cellule est vide. Motifs de refus précis : `invalid_coefficient`, `invalid_labor_hours`,
  `conflicting_labor_hours`, `invalid_majoration`, `undeclared_majoration_unit`.
- Rôle MO (E17, point à confirmer tranché) : un seul rôle actif du propriétaire au « Taux horaire » du
  classeur est rattaché aux lignes qui portent des heures ; aucun ou plusieurs exigent un choix explicite
  (aperçu bloqué, et `confirmUnifiedImportFlow` refuse sans choix). Sans taux dans le fichier, le
  comportement existant est conservé (aucun rôle) et l'aperçu signale des heures à 0 €/h ; l'utilisateur
  peut choisir un rôle. Le rôle part dans `labor_role_id` des lignes importées. (Revu : « Aucun rôle (MO à
  0 €/h) » est un choix explicite accepté, R8.)
- Aperçu (`previewUnifiedImportFlowLines`, action serveur sans écriture, hors OpenAPI) : affiché quand la
  correspondance porte des heures, une majoration, un paramètre ou un prix de contrôle. Il montre
  « h/u × Q » ligne par ligne, les paramètres du classeur face à la marge de la version, le choix du rôle,
  le contrôle « Prix unitaire de vente » (PU recalculé = total / Q, écart > 0,5 c listé) et les refus.
- Aides de colonnes v1/v2 : « h MO », atelier et chantier sont les heures totales de la ligne ; formules
  du PU, du prix total et du déboursé sec corrigées ; la majoration suit P-11. Les aides v3 restent à 2.6.
- Contrôle hors navigateur : classeur généré comme le parcours, analysé par `parseImportFile`, suggéré,
  normalisé à marge 1,30 avec un rôle à 4 000 c : 7 lignes sur 7 conformes (heures et totaux), Σ 7 133 330 c,
  écarts de contrôle ≤ 0,1 c. Avec une majoration OPTIMA de 0,15 sur la ligne de paramètres, les lignes
  reçoivent ×1,15 et les PU recalculés restent à 0,1 c au plus du « Prix Unitaire » du classeur.
- E2E (WSL, clone `~/miaouffrage-2-3-area-i` propre à la zone, révision `a75e4ca3` + changements locaux de
  toutes les zones, correctif de tas `10da1caf` appliqué dans le clone seulement, après contrôle du verrou
  des piles natives) : `export NODE_OPTIONS=--max-old-space-size=4096 && npm run e2e:army:local --
  --grep "<motif>"`.
  - `"OPTIMA workbook|numeric entry v3"` : run `01a14543-38f9-7085-b3ed-b6b8241c765f`, archive
    `.e2e/army/ci/2026-10-16T15-08-04-199Z-critical/`, `workingDiffSha256` `99ad6a62…` ; pgTAP 1 253,
    RLS, build réussis ; **3 sélectionnés, 3 exécutés, 3 réussis**, aucun ignoré. Version importée : HT
    7 133 330 c, TVA 1 426 666 c, TTC 8 559 996 c, 7 lignes conformes, rôle à 40 €/h sur les 6 lignes avec
    heures.
  - `"OPTIMA workbook|CSV DPGF"` (non-régression `dpgf-import`) : run
    `01a14545-902b-73ae-9571-8a8d0ec10f56`, archive `.e2e/army/ci/2026-10-16T15-11-27-057Z-critical/`,
    `workingDiffSha256` `a5e83270…` ; **4 sélectionnés, 4 exécutés, 4 réussis**, aucun ignoré.

## Intégration et preuves (16/10/2026)

État d'avant la revue (base `a75e4ca3`, worktree non commité ; c'est l'implémentation des commits `feat`
de la branche). Les trois zones (saisie numérique, majoration, import) sont intégrées dans le worktree
`C:/Users/maxim/Projects/miaouffrage-lot2-2-3`. Aucun code produit n'a changé à l'intégration ; les écarts
corrigés sont ceux-ci :

- `parsers.ts` et `entry-contract.test.ts` : l'outil d'édition d'une zone avait remplacé les échappements
  des espaces insécable (U+00A0) et fine (U+202F) par les caractères eux-mêmes, invisibles à la relecture.
  Échappements rétablis : même comportement, et les deux lignes de la grammaire de `parsers.ts` retrouvent
  leur texte d'origine. Les 40 fichiers modifiés ou nouveaux ont été contrôlés pour ce motif (échappements
  disparus, caractères invisibles ajoutés) : aucun autre cas.
- `numeric-entry-v3.e2e.ts`, **étape 6 ajoutée après l'implémentation** (preuve dans la vraie grille, pas un
  test rouge d'origine) : la colonne « Majoration MO (%) », masquée par tous les préréglages, est activée
  (« Personnalisé ») ; « 112,5 % » enregistre 1,125, le champ vidé enregistre 1 (jamais 0), « 1 001 » est
  refusé et rien n'est enregistré ; après rechargement la cellule affiche « 100 » ; les colonnes
  personnelles sont réinitialisées. La sauvegarde des lignes est différée de 60 s : l'étape la déclenche
  par Ctrl+S, comme `commercial-rounding.e2e.ts`.
- `import-optima-v2.e2e.ts` : l'aperçu est vérifié par ses valeurs, plus seulement par son titre :
  « 7 lignes prêtes · 1 ligne de paramètres lue, non importée », « Total : 570,706 h sur 6 lignes. », les
  7 lignes (Q, h/u, heures de ligne), le rôle à 40 €/h présélectionné et « 7 lignes vérifiées, 0 écart
  supérieur à 0,5 c. » ; preuve métier `optima-preview`.

**Défaut préexistant trouvé, hors 2.3, non corrigé ici.** Après une action groupée (ici « Majoration MO
(%) » à 150 %), une saisie de cellule qui ramène la ligne à sa valeur d'avant l'action groupée n'est pas
enregistrée : la cellule affiche la nouvelle valeur, l'état indique « À jour », le serveur garde la valeur
groupée, et le rechargement la réaffiche. Preuve : premier essai ci-dessous (cellule « 100 », état « À
jour », API 1,5 pendant 15 s). Cause probable (lecture du code, pas encore prouvée par une correction) :
`useEstimateEditorBulkController.applyBulkLineState` enregistre par l'API groupée sans mettre à jour la
référence « dernier état connu du serveur » (`syncedItemPayloadsRef`) de
`useEstimateEditorSyncController`, dont `enqueueItemUpdate` ignore toute modification égale à cette
référence. Toutes les actions groupées qui passent par `applyBulkLineState` sont probablement concernées.
Le défaut existait avant 2.3 (saisir « 100 » produisait la même perte) ; 2.3 le rend plus probable, car un
champ vidé vaut désormais ×1 au lieu de ×0. L'étape 6 saisit donc « 112,5 % » avant de vider le champ. Une
tâche séparée est proposée : E2E rouge, puis correction de la référence après une action groupée.

### Contrôles statiques et Vitest (Windows, worktree)

| Commande | Résultat |
|---|---|
| `npx tsc -p tsconfig.json --noEmit --incremental false` | réussi, 23 s (e2e compris) |
| `npx eslint . --max-warnings=0` | réussi, 34 s |
| `npx vitest run` (projets node et jsdom, rapport JSON) | 443 fichiers (442 réussis, 1 ignoré), **3 223 tests réussis, 2 ignorés, 0 échec**, 88 s |
| `npm run validate-openapi` | « spec valide et synchronisée », 144 routes, 192 opérations ; `openapi.json` inchangé |
| `npm run check:architecture` | 1 095 modules, 0 cycle |
| `git diff --stat` sur `estimate-calculations.ts`, `estimate-v2-snapshot.ts`, `supabase/migrations` | vide |
| `git diff --check` | propre ; `money.ts` est CRLF dans l'index et le worktree (`core.whitespace=cr-at-eol` propre) |

Comparaison Vitest test par test avec la base : arbre `a75e4ca3` extrait par `git archive` dans le
répertoire de travail de la session, mêmes `node_modules` (jonction), `npx vitest run` → 443 fichiers,
**3 071 tests réussis, 2 ignorés** (node : 281 fichiers, 2 252 tests ; jsdom : 162 fichiers, 821 tests).
Après intégration : node 281 fichiers, 2 404 tests ; jsdom 162 fichiers, 821 tests. Par clé « fichier +
nom complet » (3 067 clés de base, 3 219 après ; les titres répétés d'un même fichier comptent une fois) :
**0 régression, 0 test disparu, 152 nouveaux tests, tous réussis** (les tests d'exigence rouges sont
verts). Un premier passage complet a perdu un processus Vitest (« Worker exited unexpectedly ») pendant
`offer-commercial-render.test.tsx` (rendu HTML/PDF réel, hors 2.3) : ce fichier seul passe 4/4, puis la
campagne complète relancée passe ; seule cette seconde exécution est comptée.

### Parcours Army (WSL)

Clone Linux `~/miaouffrage-2-3` synchronisé depuis le worktree (empreintes SHA-256 identiques des 40
fichiers non commités), Node 24.14.0, `export NODE_OPTIONS=--max-old-space-size=4096`, après le verrou
des piles natives (deux attentes dues à une campagne `calc-v3` d'un autre flux). Chaque exécution crée et
détruit sa pile Supabase native, passe pgTAP (13 fichiers, 1 253 assertions), la matrice RLS, le build et
les budgets, puis les parcours sur `chromium-desktop`. Révision `a75e4ca3` + changements locaux ; le
correctif de tas `10da1caf` (`scripts/tester-army/build-local.mjs`, branche `lot2/2.0-ligne-de-base`) est
appliqué **dans le clone seulement** et entre dans l'empreinte des changements locaux du manifeste.
Archives sous `~/miaouffrage-2-3/.e2e/army/ci/`, journaux sous `~/e2e-2-3-logs/` ; durée = démarrage de
la pile jusqu'à la fin des parcours.

| # | `npm run e2e:army:local --` | Run TesterArmy | Archive | Durée | Résultat |
|---|---|---|---|---|---|
| 1 | `--grep "numeric entry v3\|OPTIMA workbook"` | `01a14554-c9dd-7138-bfb5-906aede54034` | `2026-10-16T15-27-43-620Z-critical` | 120 s | 2/3 : étape 6 première forme, défaut préexistant ci-dessus |
| 2 | idem | `01a1455a-3cc9-76d5-b883-b80f42176ad7` | `2026-10-16T15-34-01-235Z-critical` | 97 s | 2/3 : recette, sauvegarde différée de 60 s attendue 15 s |
| 3 | idem | `01a1455d-9f6f-7566-a4be-9fd1e987eb3c` | `2026-10-16T15-37-41-334Z-critical` | 89 s | **3/3 réussis** (authentification, OPTIMA, saisie v3), aucun ignoré |
| 4 | `--grep "numeric entry retains\|numeric entry persists\|CSV DPGF\|DPGF03"` | `01a14566-9c80-7b66-8b15-5ca55efcf1ff` | `2026-10-16T15-47-35-157Z-critical` | 206 s | **6/6 réussis** (`numeric-entry` ×2, `dpgf-import` ×3, authentification), aucun ignoré |
| 5 | (campagne critique complète, sans filtre) | `01a14569-ed72-75fa-b231-a8cf15cfe37f` | `2026-10-16T15-51-15-513Z-critical` | 639 s (parcours 579 s) | **66/66 réussis**, 19 fichiers, aucun ignoré, aucun instable |

Les exécutions 3 à 5 portent la même empreinte de changements locaux (`diffSha256` `9fa1fe10…`). La
campagne complète rejoue les deux nouveaux parcours avec les mêmes valeurs (version 2 : HT 7 133 330 c,
TVA 1 426 666 c, TTC 8 559 996 c ; heures et totaux des 7 lignes identiques au tableau ci-dessous ;
majoration de grille 1 après rechargement), ainsi que `numeric-entry`, `dpgf-import`,
`commercial-rounding`, `estimate-integrity` et les autres parcours critiques, plus
`local/tech-debt-lock-boundaries`.

Import OPTIMA (exécution 3, preuves `optima-*` de l'archive) : suggestions exactes (`Designation`,
`Ute` → unité, `Qte`, `PR_Fourniture_unitaire` → prix d'achat, `Tps_pose_unitaire` →
`labor_hours_per_unit`, `Majoration_MO` → `h_mo_majoration_additive` ; quatre colonnes calculées et
`PR_Total_fourniture` en contrôle ; `Coeff_FO`, `Coeff_MO`, `Taux_horaire` en paramètres). Version 2,
moteur 2, marge fixe ×1,30, TVA 2 000 pb ; K FO, K MO et majoration à 1 sur les 7 lignes ; rôle à 40 €/h
sur les 6 lignes qui portent des heures ; valeurs identiques après rechargement.

| Ligne | Q | h/u | Heures stockées | PR FO (c) | Total HT (c) |
|---|---|---|---|---|---|
| O1 | 20 | 1,991 | 39,82 | 5 466 | 349 180 |
| O2 | 3 | 1,75 | 5,25 | 9 563 | 64 596 |
| O3 | 21 | 0 | 0 | 5 850 | 159 705 |
| O4 | 1 139 | 0,2 | 227,8 | 302 | 1 631 731 |
| O5 | 1 | 6 | 6 | 2 000 | 33 800 |
| O6 | 282 | 0,998 | 281,436 | 9 186 | 4 831 055 |
| O7 | 8 | 1,3 | 10,4 | 883 | 63 263 |
| **Σ** | | | 570,706 | | **7 133 330 (71 333,30 €)** |

7/7 lignes au centime de la conception (§14, 2.3) ; TVA 1 426 666 c, TTC 8 559 996 c.

Saisie v3 (exécution 3, preuve `numeric-entry-v3`) : « 1.250 » refusé avec le même message en grille,
dans le panneau et au collage (« Prix unitaire HT : Nombre invalide : utilisez une virgule décimale et des
espaces pour les milliers. »), prix 1 000 c inchangé, remise « 1 000 » → 100 000 c après rechargement,
ligne collée absente, coefficient « ×1,5 » affiché avant « Appliquer » et 1,5 enregistré, « Appliquer »
désactivé sur champ vide, majoration de grille 1,125 puis 1, « 1 001 » refusé, 1 après rechargement.

## Corrections de la revue (16/10/2026)

Ordre des commits sur `lot2/2.3-saisie-import` (jamais poussée) : défaillances et tests rouges, puis
l'implémentation d'origine par zone, puis une correction par constat, puis cette documentation. La branche
a d'abord été avancée sur `main` (`de54931d`), qui porte le lanceur de build partagé (`f8229144`) : R10 est
levé et les preuves E2E ci-dessous viennent de l'arbre commité, sans correctif propre au clone.

| # | Correction | Fichiers |
|---|---|---|
| R1 | `normalizeMappedRowsForEstimateCreation` prend une entrée : `"preview"` pour le flux d'import unifié, `"direct"` par défaut. Sans aperçu, une ligne qui porte des heures par unité, et toute ligne d'un classeur à ligne de paramètres, est refusée (`preview_required`). La DPGF liée (route `import-linked-dpgf` et mode « DPGF source » de l'assistant) répond 400 avec un message qui renvoie à l'import par l'affaire ; la création rapide revient à « affaire vide + import lié ». Des heures de ligne sans paramètres gardent le comportement existant. | `affaires/import-flow.ts`, `estimates/server.ts`, `_actions/quick-create-affaire.ts`, `_actions/import-flow.ts` |
| R2 | Les deux parseurs d'upload lisent les formats (`cellNF`) et stockent une cellule au format pourcentage en texte, tel qu'Excel l'affiche (« 115 % »), depuis ses chiffres les plus courts, sans multiplication flottante ; un « % » littéral (`0"%"`) garde le nombre. La majoration additive OPTIMA lit « 15 % » comme +15 %. | `imports/percent-cells.ts` (nouveau), `imports/parser.ts`, `workers/xlsx-parser.worker.ts`, `numeric-input/parsers.ts` |
| R3 | Un modèle enregistré qui contredit le profil déclaré sur une de ses colonnes n'est plus appliqué ; les suggestions du profil s'affichent. Un modèle conforme au profil l'emporte toujours. L'aperçu nomme toute colonne « durée par unité » lue comme heures de ligne. | `mappings/server.ts`, `_actions/import-flow.ts`, `ImportLinesPreview.tsx` |
| R4 | Collage : le PR FO exige son nom complet (« PR FO », « PR Fourniture », « Prix fourniture », « Prix d'achat », « Prix de revient ») ; « Prix unitaire HT » reste le PR FO (libellé du champ de collage, contrat `d484c5a1`), « Prix unitaire HT (EUR) » celui du format BDC. Les prix de vente génériques restent sans cible. | `estimates/clipboard.ts` |
| R5 | L'export DPGF écrit « Majoration MO (%) » (100 = neutre) ; il devient un profil d'import déclaré (« Prix unitaire HT EUR » = PR FO ; l'ancien « Majoration MO » de ses fichiers = coefficient). | `estimates/dpgf-export.ts`, `imports/optima-profile.ts` |
| R6 | Précision de stockage v1/v2 à tous les points d'entrée : `parseStoredCoefficient` (trois décimales) pour K FO et K MO à l'import, au collage et en grille ; quantité et heures de ligne par `parseQuantity` au collage, en grille et sur mobile ; prix du mobile par la grammaire des montants ; TVA des réglages et de l'assistant par `parseRateBp`. | `numeric-input/parsers.ts`, `estimates/editor-values.ts`, `estimates/clipboard.ts`, `affaires/import-flow.ts`, cellules de grille, éditeur mobile, `EstimateSettingsPanel.tsx`, `PricingStep.tsx` |
| R7 | Collage : cibles « Majoration MO (%), 100 = neutre » et « Majoration MO (coefficient), 1 = neutre » ; l'unité choisie l'emporte sur l'en-tête ; deux colonnes de majoration sont refusées. | `estimates/clipboard.ts`, `useEstimateClipboard.ts` |
| R8 | `resolveImportLaborRole` lit un `null` explicite comme « refusé » (`declined`) : heures sans rôle, valorisées à 0 €/h, avertissement dans l'aperçu ; le sélecteur garde « Choisir un rôle… » tant qu'un choix est exigé et propose toujours « Aucun rôle (MO à 0 €/h) ». | `affaires/import-flow.ts`, `ImportLinesPreview.tsx` |
| R9 | Heuristique : « prix d'achat », « prix de revient », « PR » désignent le PR FO avant la règle « prix unitaire générique → contrôle » ; leur total est une colonne de contrôle. | `mappings/server.ts` |
| R10 | Branche avancée sur `main` (`de54931d`, lanceur `scripts/next-build.mjs`). | — |

Deux commits complètent la série : `1f4f1d7a` retire la déstructuration du convertisseur de R2, dont le
parseur serveur exécute la source dans un fil d'exécution (aucune aide de compilation hors de la fonction) ;
`82267cb8` corrige la recette d'upload des parcours OPTIMA après l'exécution 2 ci-dessous.

Décisions consignées :

- R1 : la boîte de création rapide (`QuickCreateAffaireDialog`) n'est montée par aucune page ; son action
  serveur est corrigée par défense, sans parcours Army possible. Le chemin sans aperçu prouvé en E2E est la
  DPGF liée.
- R4 : la conception (D11) vise les en-têtes d'un DPGF générique ; au collage, « Prix unitaire HT » est le
  libellé du champ PR FO et le contrat des développeurs (`numeric-entry.e2e.ts`, `estimate-batch-client.e2e.ts`
  le collent comme PR FO). Il est conservé, et la copie de la grille garde cet en-tête plutôt que « PR FO
  (€ HT) » proposé par la revue : collage et import divergent sur ce seul en-tête, volontairement.
- R6 : la saisie au-delà de la précision de stockage est refusée, conformément à l'acceptation de 2.3 ; le
  contrat des développeurs le permettait (« sans changer les précisions de stockage » restait vrai, la base
  arrondissait) : changement et raison consignés dans `tech-debt-numeric-entry.md`.

### Exécution rouge de la revue

Vitest (Windows, worktree, après les commits de tests, avant les corrections) :

| Fichier | Rouges | Cause |
|---|---|---|
| `entry-contract.test.ts` | 33 sur 132 | adaptateurs de grille et de réglages absents, `parseStoredCoefficient` absent ; collage 1,2345 accepté |
| `clipboard.test.ts` | 22 sur 55 | prix de vente proposés en PR FO, précision du collage, cibles d'unité absentes |
| `import-flow.test.ts` | 9 sur 37 | chemins sans aperçu, `null` explicite, additive « 15 % » |
| `mappings/server.test.ts` | 8 sur 70 | prix d'achat explicites, modèle contre profil, cellules au format % |
| `dpgf-export.test.ts` | 3 sur 5 | en-tête et valeur de la majoration, aller-retour |

Le cas « prix du mobile » de la table des montants a été ajouté rouge avant sa correction, dans le commit de
R6 (écart trouvé en corrigeant R6 : le prix du mobile acceptait trois décimales).

E2E rouge :

WSL Ubuntu-24.04, clone `~/miaouffrage-2-3` ramené au commit `2c39a412` (tests rouges et implémentation
d'origine), Node 24.14.0, `export NODE_OPTIONS=--max-old-space-size=4096`, après le verrou des piles
natives : `npm run e2e:army:local -- --grep "OPTIMA workbook|percent-formatted|numeric entry v3"`.

- Premier essai interrompu : la VM WSL a perdu son disque (erreurs d'entrée-sortie, disque hôte C: plein à
  99 %) pendant l'attente du verrou ; distribution relancée par `wsl --shutdown`, aucun parcours exécuté.
- Deuxième essai (archive `2026-10-16T16-56-48-174Z-critical`) : pgTAP 1 253 et RLS réussis, **build en
  échec** au contrôle TypeScript de Next, qui lit aussi les fichiers Vitest : les tests rouges importent des
  fonctions encore absentes. Aucune preuve.
- Troisième essai, les cinq fichiers Vitest de la revue remplacés dans le clone par leur version de
  `de54931d` (contrôle de types seulement, le parcours ne les exécute pas ; écart visible dans
  `git status` et l'empreinte du manifeste) : run `01a145af-4634-7735-8d34-6fd9155bd30a`, archive
  `.e2e/army/ci/2026-10-16T17-06-54-575Z-critical/`, `diffSha256` `4cda6796…`, 138 s ; pgTAP 1 253, RLS
  et build réussis ; **5 tests sélectionnés et exécutés : authentification réussie, 4 échecs aux étapes
  attendues**, aucun ignoré.
  - `import-optima-v2` : toutes les étapes d'origine vertes (7 lignes au centime) ; étape
    `linked-dpgf-without-preview` : 201 au lieu de 400, 7 lignes importées dans la version 1 sans aperçu ni
    rôle, HT 4 165 659 c, le chiffre du rejeu hors navigateur de la revue (R1).
  - « …matches no role… » : aperçu conforme (570,706 h, choix exigé, « Suivant » désactivé), puis échec : le
    sélecteur n'offre pas « Aucun rôle » (R8).
  - « percent-formatted… » : majoration enregistrée ×0,0115 au lieu de ×1,15 (R2).
  - `numeric-entry-v3` : étapes 1 à 6 vertes ; étape 7 : « Prix Unitaire » proposé en `unit_price_ht`
    (R4). Les étapes 8 et 9 (R6) ne sont pas atteintes : leur preuve rouge est Vitest seulement.

### Preuves après correction

Contrôles statiques et Vitest (Windows, worktree, code des commits de correction) :

| Commande | Résultat |
|---|---|
| `npx tsc -p tsconfig.json --noEmit --incremental false` | réussi (e2e compris) |
| `npm run lint` (`eslint . --max-warnings=0`) | réussi |
| `npx vitest run` | 443 fichiers (442 réussis, 1 ignoré), **3 320 tests réussis, 2 ignorés, 0 échec** |
| `npm run validate-openapi` | « spec valide et synchronisée », 144 routes, 192 opérations ; `openapi.json` inchangé |
| `npm run check:architecture` | 1 096 modules, 0 cycle |
| `git diff --stat de54931d HEAD -- src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts supabase/migrations openapi.json` | vide |

Les tests rouges de la revue sont tous verts, sans modification après leur commit, sauf le cas « prix du
mobile » ajouté rouge avec R6.

Parcours Army (WSL, clone synchronisé sur l'arbre commité, empreintes SHA-256 contrôlées, Node 24.14.0,
`export NODE_OPTIONS=--max-old-space-size=4096`, après le verrou des piles natives, sans correctif propre au
clone) ; chaque exécution passe pgTAP (13 fichiers, 1 253 assertions), la matrice RLS et le build :

| # | `npm run e2e:army:local --` | Révision | Run TesterArmy | Archive | Durée | Résultat |
|---|---|---|---|---|---|---|
| 1 | `--grep "OPTIMA workbook\|percent-formatted\|numeric entry\|CSV DPGF\|DPGF03"` | `1f4f1d7a` | `01a145b2-906f-79ef-9be5-3888c0e2ab25` | `2026-10-16T17-10-15-442Z-critical` | 252 s | **10/10 réussis** (`import-optima-v2` ×3, `numeric-entry-v3`, `numeric-entry` ×2, `dpgf-import` ×3, authentification) |
| 2 | (campagne critique complète) | `1f4f1d7a` | `01a145b6-8004-7885-a07a-c4d1433dff45` | `2026-10-16T17-14-52-452Z-critical` | 677 s | 67/68 : « …matches no role… » arrêté avant toute étape métier (fichier choisi avant que l'étape d'upload soit prête, « Lancer l'import » absent) ; recette corrigée (`82267cb8`) |
| 3 | (campagne critique complète) | `82267cb8` | `01a145c7-69f9-702f-92e5-e1eb2c9bacff` | `2026-10-16T17-33-00-244Z-critical` | 674 s | **68/68 réussis**, 19 fichiers, aucun ignoré, aucun instable |

Les trois exécutions n'ont pour changements locaux que les deux documents de ce sous-lot (`diffSha256`
`4462930d…` pour l'exécution 3). Valeurs de l'exécution 3 (preuves métier sous
`critical/artifacts/business` de l'archive) :

- `import-optima-v2` : version 2, moteur 2, marge ×1,30, HT 7 133 330 c, TVA 1 426 666 c, TTC 8 559 996 c,
  7 lignes au centime, rôle à 40 €/h sur les 6 lignes avec heures ; import de la DPGF liée dans la
  version 1 : **400**, message « …importez-le depuis l’affaire (« Importer la DPGF ») pour vérifier l’aperçu
  h/u × Q et choisir le rôle MO. », version 1 toujours vide (R1).
- « …matches no role… » (45 €/h) : aperçu « choix exigé », puis « Aucun rôle (MO à 0 €/h) » accepté ;
  version 2 aux heures h/u × Q, `labor_role_id` nul sur toutes les lignes, HT 4 165 659 c : la MO à 0 €/h
  est le choix explicite, signalé dans l'aperçu (R8).
- « percent-formatted… » : cellule 115 % (1,15 au format `0%`) enregistrée ×1,15, quantité 2, PR FO
  1 000 c, 3 h (R2).
- `numeric-entry-v3` : étapes 1 à 6 inchangées ; collage « Quantité 1,2345 » refusé (« Quantité : Nombre
  invalide : utilisez une virgule décimale et des espaces pour les milliers. »), « Prix Unitaire » sur
  « Ignorer », aucune ligne créée (R4, R6) ; cellule quantité « 1,2345 » refusée, quantité 1 après
  rechargement ; TVA des réglages « 5,5 % » → 550 pb, « 12,555 » refusé, 550 après rechargement (R6).

## Limites et points ouverts

- Défaut préexistant des actions groupées (section « Intégration et preuves ») : non corrigé dans 2.3, tâche
  séparée proposée.
- Heures de ligne sans paramètres de classeur importées sans aperçu (DPGF liée, assistant « DPGF source »,
  création rapide) : comportement d'avant 2.3 conservé, sans rôle, MO valorisée à 0 €/h. L'import par
  l'affaire le signale et propose le rôle. Les refuser changerait des parcours existants.
- `QuickCreateAffaireDialog` n'est monté par aucune page : la correction de l'action de création rapide (R1)
  n'a pas de parcours Army.
- Collage et import divergent volontairement sur « Prix unitaire HT » : PR FO au collage (libellé du champ,
  contrat `d484c5a1`), prix de contrôle à l'import d'un DPGF (D11).
- Réimport des exports (éditeur, DPGF) : K FO, K MO et les rôles MO ne sont pas des cibles de correspondance ;
  une réimportation les remet à 1 et sans rôle (existant avant 2.3).
- La marge en % (réglages, assistant) garde la grammaire commune sans précision de grandeur : aucun autre point
  d'entrée ne la lit.
- Messages : une majoration de grille hors bornes et une décimale de trop en grille ou au collage affichent le
  message générique `NUMERIC_INPUT_ERROR`, sans dire « trois décimales au plus » ; une ancienne ligne à ×100
  (C-11) s'affiche invalide à l'édition.
- Le profil déclaré est dans `src/lib/imports/optima-profile.ts`, et non `src/lib/mappings/` comme le tableau
  des fichiers de la conception.
- Le collage DOM ne qualifie pas le presse-papier du système. XLS et PDF n'ont pas de parcours Army ; les
  cellules au format pourcentage sont prouvées en XLSX par le parcours Army (parseur du navigateur, chemin
  des petits fichiers) et dans les deux parseurs d'upload par Vitest ; le parseur serveur (gros fichiers,
  repli) n'est prouvé qu'en Vitest, où son fil d'exécution reçoit la source compilée par esbuild, pas par
  le build Next. La majoration OPTIMA non nulle (« 0,15 », « 15 % ») n'est prouvée qu'en isolation.
  L'import XLSX de `takeoff/import-flow-carry-over.e2e.ts` n'appartient qu'à la sélection `full`, non rejouée.
- Corpus figé et empreintes (2.0) : à vérifier à l'intégration avec la ligne de base de 2.0, absente de cette
  branche.
