# Saisie et import (sous-lot 2.3) : défaillances avant correction

Statut : **défaillances et tests rouges** (16/10/2026, branche `lot2/2.3-saisie-import`). Les tests
d'exigence sont écrits rouges avant l'implémentation, y compris ceux de la revue de 2.3 (R1 à R10) ;
l'implémentation par zone, les corrections de la revue et les preuves d'intégration suivent dans les
commits suivants et dans les sections ajoutées à ce document. Sources : conception du lot 2
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
