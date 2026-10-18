# Moteur 3, sous-lot 2.6b : limites restantes de l'éditeur v3 et G1

Plan vers la bascule 2.10 (18/10/2026), sous-lot 2.6b ; décision D-c (branche v3 complète de l'éditeur mobile).
Aucune migration. Les chemins v1/v2 ne changent pas : chaque correction est conditionnée au moteur 3
(`pricing_status` ≠ `priced`, qui n'existe que sur une v3, ou contexte v3 de l'éditeur).

## 1. Défaillances à empêcher

| # | Défaillance | Effet |
|---|---|---|
| G1 | Une ligne v3 non chiffrée (incluse, pour mémoire, hors lot…) à 0 € lève `missing_price` (`estimate-quality.ts`), bloquant à l'envoi (`gating.ts`) | Toute v3 importée d'OPTIMA avec des lignes HL/inc/PM est refusée (`ESTIMATE_GATING_BLOCKED`) ou forcée avec de faux drapeaux ; pastilles « Prix manquant » et « Temps MO manquant » à tort dans l'éditeur |
| G1-Q | (revue) La même ligne sans quantité lève `missing_quantity`, bloquant : 46 des 79 lignes de statut du classeur OPTIMA hydraulique, 24 des 82 en plomberie | La v3 importée d'OPTIMA reste refusée à l'envoi malgré G1 |
| G1-R | (revue) Le radar de risque du métré lit les lignes sans `pricing_status` (`takeoff/server.ts`) | Une ligne de statut y redevient « chiffrée » : alerte de prix atypique à tort |
| G1-v2 | La correction touche une v1/v2 | Une ligne v2 « HL » à 0 € ne bloquerait plus |
| A13 | Éditeur mobile (375 px) sans branche v3 | Unité écrite dans `description`, `unit_code` vide, gel refusé (`ESTIMATE_V3_UNIT_REQUIRED`) ; heures totales ignorées en silence, heures par unité impossibles à saisir ; la liste mobile affiche `description` |
| A13-L | (revue) La liste mobile garde le repli « u » des v1/v2 | Une ligne v3 sans unité (que le gel refuse) et une ligne de statut s'affichent « × u » |
| A14 | Restauration d'un brouillon en conflit par la charge v2 | Saisies v3 (unité, h/u) perdues, réglages de marge v2 réappliqués : état « Non sauvegardé », Ctrl+S enregistre ce paramétrage (400) au lieu des lignes |
| A15 | Unité d'une règle de suggestion écrite dans `description` | Unité perdue en silence ; une unité inconnue du référentiel n'est pas refusée |
| A15-L | (revue, décision du 18/10) Sur une ligne, la suggestion d'une règle remplace l'unité déjà choisie | Unité de la ligne écrasée en silence par celle de la règle, alors qu'en lot elle est gardée |

## 2. Rouges (avant correction)

Parcours de `e2e/army/local/engine-v3-editor-actions.e2e.ts`, boucle de développement (pile native, port 3182).

Itérations sous `.e2e/army/ci/2026-10-18T14-36-32-429Z-dev-loop/iterations/` (clone WSL, Node 24, 2 workers).

| Parcours | Commit | Itération | Échec observé |
|---|---|---|---|
| V3E16 | `e573f71e` | `004-2026-10-18T14-54-49-624Z` | porte d'envoi : `blocking: ["missing_price","no_pdf_generated"]`, les trois lignes de statut dans `missing_price`, PM et HL (fourniture et pose) dans `missing_labor_time` |
| V3E17 | `e573f71e` | `004-…` | champ h/u absent (`hoursPerUnit: false`, `lineHours: true`) ; après « Sauvegarder maintenant », `unit_code` nul et `description: "ml"`, totaux 2 600 / 520 / 3 120 c |
| V3E18 | `e573f71e` | `004-…` | après restauration et Ctrl+S, ligne inchangée : `unit: "u"`, `hPerUnit: 1`, totaux 12 200 / 2 440 / 14 640 c |
| V3E19 | `f8cfd013` | `001-2026-10-18T14-38-52-332Z` | aucun refus ; lignes relues `description: "ML"` et `"boite"`, `unit_code` nul |

Corrections des parcours avant la correction du code (attendus inchangés) : à 375 px la grille cède la place à la
liste mobile, V3E17 ouvre donc la ligne depuis la liste (`7d1b1c6e`) ; V3E17 et V3E18 enregistrent avant de relire
(l'enregistrement automatique attend 60 s), et la garde v2 de V3E16 s'exécute avant la navigation, sur la session
qui tient le bail de l'ancre (`e573f71e`) ; V3E18 passe en mode Expert pour lire les jetons TVA et TTC du pied
(`b1769c1a`, après le premier vert : l'état enregistré était déjà juste).

### Revue (une ronde, après `7eb6fe01`)

Parcours commités par `9b904649`, rouges sur le code de `7eb6fe01` : itération `002-2026-10-18T16-20-38-810Z` de
`.e2e/army/ci/2026-10-18T16-08-26-455Z-dev-loop` (`--grep 'V3E1[6-9]|V3E20'`, arbre local `7a06a9a4…`).

| Parcours | Échec observé |
|---|---|
| V3E20 (nouveau, `engine-v3-import-optima.e2e.ts`) | import réel du classeur OPTIMA hydraulique : 79 lignes de statut, dont 46 sans quantité ; porte d'envoi `blocking:missing_quantity` sur ces 46 lignes ; radar de risque d'un métré terminé : 27 alertes `atypical_price` sur des lignes de statut |
| V3E17 | liste mobile avant saisie : `"2 × u"` pour la ligne sans unité, `"1 × u"` pour la ligne HL |
| V3E18 | rouge par mutation (garde des réglages d'A14 retirée, charge v3 gardée) : avis « … ; enregistrez le paramétrage pour confirmer les réglages », état « Non sauvegardé » |
| V3E19 (une ligne, unité connue) | vert dès cette itération : couverture d'un chemin existant, pas un rouge |

Le radar levait aussi 27 alertes « preuve absente » (`missing_proof`) sur ces lignes : elles ne dépendent pas des
drapeaux de qualité ni du statut ; V3E20 a été restreint à `atypical_price` avant le vert, d'après cette trace.

### Décision du 18/10 sur A15-L, après la fusion de `main`

V3E19 commité par `caa51eca`, rouge sur le code de `76daf992` (fusion de `main` dans `c8aa0965`) :
`.e2e/army/ci/2026-10-18T16-47-15-046Z-critical` (`--grep V3E19`, manifeste `17a074c8…99cc8e`). La suggestion de la
ligne K, déjà en « u », propose l'unité « M2 » de sa règle (`chosenUnitProposed: true`) ; l'appliquer la remplaçait
(ronde précédente : H de « u » à `m2`, `3eda1215`). Le reste est conforme : lot G, T, H refusé par « boite », puis G
en `ml` ; T refusé sur sa ligne ; H, sans unité, écrit `m2` sur sa ligne ; totaux 3 250 / 650 / 3 900 c.

Revue de `0a67dadf` : ce vert ne prouvait que l'affichage. La règle de K ne portait que son unité ; sa suggestion,
réduite à rien, n'était plus affichée ni appliquée, et la garde d'écriture de `resolveEstimateRuleUnitPatch` (une
ligne v3 qui a son unité n'en reçoit pas) pouvait disparaître sans faire échouer V3E19. `17b9ad47` donne aussi à la
règle de K un K FO (1,25), forme courante d'une règle : en lot, K ne propose que son K FO et est décoché ; sur sa
ligne, sa suggestion est affichée sans « Unité », appliquée puis enregistrée. Rouge par mutation (garde retirée,
`.e2e/army/ci/2026-10-18T17-42-07-832Z-critical`) : le serveur relit K en `m2`, tout le reste conforme
(`chosenUnitProposed: false`, `kFoProposed: true`, `k_fo` 1,25, totaux inchangés). Vert sur `17b9ad47`, arbre
propre : K reste en `u` avec `k_fo` 1,25.

## 3. Correction

- G1 : `computeEstimateQualityFlagsForItem` ne lève aucun drapeau sur une ligne non `priced` : première ronde, prix et
  temps MO ; revue, tous, dont `missing_quantity` (G1-Q). Une telle ligne n'a aucun montant (P-09). Une ligne v1/v2
  est toujours `priced` (déclencheur M4). Gravités de `gating.ts` et critères de `checklist.ts` inchangés : ils
  lisent les mêmes drapeaux. Le radar de risque du métré sélectionne maintenant `pricing_status` (G1-R), comme la
  porte d'envoi (`select *`).
- A13 : `MobileEstimateLineEditor` lit le contexte v3 de la grille. Sur une v3 : statut et TVA de la ligne
  (`V3LineStateControls`), unité du référentiel (`V3UnitField`, même résolution que la cellule « U », refus visible
  par son nom, jamais `description`), heures par unité (`h_mo_per_unit`, ou atelier/chantier par unité) et heures
  totales du moteur en lecture seule. La liste mobile d'une v3 (A13-L) affiche `unit_code`, « sans unité » s'il
  manque et le statut d'une ligne non chiffrée (`resolveEstimateV3MobileLineMeta`) ; en v1/v2, l'expression de `main`.
- A14 : sur une v3, `applyRestoredDraft` ne reprend pas les réglages du brouillon (forme v2) et donne à
  `restoreConflictDraft` la charge v3 (`buildEstimateV3ItemUpdatePayload`, saisies seulement) des lignes restaurées.
- A15 : en lot, `buildBulkSuggestPreview({ unitTarget: "unit_code" })` garde les lignes éligibles de 2.6 et propose
  l'unité dans `unit_code`, seulement sur une ligne qui n'en a pas ; le contrôleur la résout dans le référentiel
  avant toute écriture et refuse la sélection entière, par le nom de l'unité, si l'une est inconnue. Sur une ligne,
  même résolution et, depuis la décision du 18/10 (A15-L), seulement sur une ligne sans unité : la suggestion d'une
  ligne v3 qui a son unité ne propose pas celle de la règle et n'est pas affichée si elle se réduit à rien, comme en
  lot (`useEstimateEditorSuggestions`, `resolveEstimateRuleUnitPatch`) ; une unité inconnue est refusée par un avis,
  rien de la règle n'est écrit. En v1/v2, l'unité d'une règle va toujours dans `description`.
- Régression vue à la première qualification (`.e2e/army/ci/2026-10-18T15-03-53-439Z-critical`, `b1769c1a`) :
  la première version d'A15 jugeait l'éligibilité sur `unit_code` ; une ligne v3 qui a déjà son unité n'était plus
  proposée (V3E12, V3E14 : « Examiner 1 suggestion » attendu). Corrigé par `f7d5fde5` : éligibilité inchangée ; en
  lot, l'unité d'une règle ne remplace pas une unité choisie.
- `verify:pr` a ensuite refusé la taille de `EstimateEditorTable.tsx` (2 612 > 2 600) et de
  `useEstimateEditorSyncController.ts` (1 212 > 1 200) : `366dfebd` déplace la résolution de l'unité d'une règle dans
  `resolveEstimateV3RuleUnit` (`v3-editor.ts`) et le choix de la charge restaurée dans `applyRestoredDraft`, sans
  changer le comportement.
- La fusion de `main` (`76daf992`, avec 2.7 #45 et les quatre lignes de 2.10a #57 dans la table) a porté
  `EstimateEditorTable.tsx` à 2 604 lignes non vides (CI `Statique` rouge, run 39145855324) : `706cc62f` déplace
  l'unité d'une règle (`resolveEstimateRuleUnitPatch`) et l'unité de la fiche article
  (`resolveEstimateArticleSheetUnit`) dans `v3-editor.ts` ; 2 598 lignes, budget inchangé.

## 4. Preuves

Première ronde :

| Preuve | Commande | Révision | Résultat | Trace |
|---|---|---|---|---|
| Verts en itération | `npm run e2e:army:dev-loop -- run --grep 'V3E1[6-9]'` puis `'V3E18'` | `41533b62`, `b1769c1a` | V3E16, V3E17, V3E19 verts ; V3E18 vert après `b1769c1a` | itérations `005-2026-10-18T14-58-04-291Z`, `006-2026-10-18T15-01-12-344Z` |
| Qualification ciblée | `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --app-port 3182 --grep 'V3E\|V3P01\|V3FC\|bulk edit sync'` | `366dfebd`, arbre propre | sortie 0 ; inventaire des migrations conforme, pgTAP `Files=23, Tests=1891`, matrice RLS passée ; 29/29 (configuration + V3E01-V3E14, V3E16-V3E19, V3P01, V3FC01-02, sept parcours v2 « bulk edit sync »), parcours 4 min 41 s | `.e2e/army/ci/2026-10-18T15-27-28-694Z-critical`, manifeste `38f23372…1e18b` |
| Garde v1 | `E2E_ARMY_WORKERS=2 npm run e2e:army:ci -- full --app-port 3182 --files e2e/army/critical/auth.setup.e2e.ts,e2e/army/local/bulk-actions-v1-totals.e2e.ts` | `366dfebd` | sortie 0 ; V1BT01-V1BT03 (majoration en lot et suggestions d'une v1 historique) 3/3 + configuration | `.e2e/army/ci/2026-10-18T15-36-11-514Z-full`, manifeste `b43f073b…ad777` |
| Qualité | `npm run verify:pr` | `366dfebd`, arbre propre | sortie 0 en 2 min 42 s : budgets d'architecture, OpenAPI, types, lint ; Vitest node 2 939 tests, jsdom 831 tests | journal local du clone WSL |

La qualification précédente sur `b1769c1a` (`.e2e/army/ci/2026-10-18T15-03-53-439Z-critical`) avait 27/29 : V3E12 et
V3E14 rouges, la régression du §3 ; celle de `f7d5fde5` (`2026-10-18T15-12-54-594Z`) était verte avant le
refactor de `366dfebd`, qui a donc été requalifié.

Revue (clone WSL, Node 24, 2 workers, port 3182) :

| Preuve | Commande | Révision | Résultat | Trace |
|---|---|---|---|---|
| Rouges | `npm run e2e:army:dev-loop -- run --grep 'V3E1[6-9]\|V3E20'` | `7eb6fe01` + parcours de `9b904649` (+ mutation A14), arbre `7a06a9a4…` | V3E17, V3E18, V3E20 rouges (§2) ; V3E16, V3E19 verts | itération `002-2026-10-18T16-20-38-810Z` de `.e2e/army/ci/2026-10-18T16-08-26-455Z-dev-loop` |
| Verts | idem | contenu de `3eda1215`, arbre `ecebbd15…` | 6/6 (configuration + V3E16-V3E20) | itération `003-2026-10-18T16-23-40-755Z` |
| Qualification ciblée | `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --app-port 3182 --grep 'V3E\|V3P01\|V3FC\|bulk edit sync'` | `3eda1215`, arbre propre | sortie 0 ; inventaire des migrations conforme, pgTAP `Files=23, Tests=1891`, matrice RLS passée ; 30/30 (configuration + V3E01-V3E14, V3E16-V3E20, V3P01, V3FC01-02, sept parcours v2 « bulk edit sync »), parcours 4 min 30 s | `.e2e/army/ci/2026-10-18T16-27-14-743Z-critical`, manifeste `25b81e71…a142b6` |
| Qualité | `npm run verify:pr` | `3eda1215`, arbre propre | sortie 0 en 1 min 20 s (caches chauds) ; Vitest node 2 939 tests (2 ignorés), jsdom 831, couverture critique 12 | journal local du clone WSL |

L'arbre des verts ne diffère de `3eda1215` que par la fin de ligne d'une ligne de `EstimateEditorTable.tsx` (LF au
lieu de CRLF, pour `git diff --check`).

Décision A15-L et fusion de `main` (clone WSL, Node 24, 2 workers, port 3182 ; seuls les parcours touchés, la CI de
la PR qualifie le reste) :

| Preuve | Commande | Révision | Résultat | Trace |
|---|---|---|---|---|
| Rouge | `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --app-port 3182 --grep V3E19` | `caa51eca` (parcours sur le code de `76daf992`) | sortie 1 : V3E19 rouge, `chosenUnitProposed: true` (§2) | `.e2e/army/ci/2026-10-18T16-47-15-046Z-critical`, manifeste `17a074c8…99cc8e` |
| Vert | idem, `--grep 'V3E03\|V3E09\|V3E16\|V3E19\|local article association'` | `706cc62f`, arbre propre | sortie 0 ; pgTAP `Files=24, Tests=1941`, matrice RLS passée ; 5/5 (configuration, V3E03, V3E09, V3E16 relancé après la fusion de #45, V3E19 avec `chosenUnitProposed: false` ; la suggestion de K n'y était pas appliquée, voir les deux lignes suivantes) | `.e2e/army/ci/2026-10-18T17-16-31-453Z-critical`, manifeste `1be729e0…6c89` |
| Rouge (revue de `0a67dadf`, garde d'écriture) | `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --app-port 3182 --grep V3E19` | `17b9ad47` + mutation (ligne `if (line.unit_code) return …` de `resolveEstimateRuleUnitPatch` retirée, diff `0dea8604…f5f`) | sortie 1 : V3E19 rouge, K relu en `m2` au lieu de `u`, le reste conforme ; pgTAP `Files=24, Tests=1941` | `.e2e/army/ci/2026-10-18T17-42-07-832Z-critical`, manifeste `398c7ff4…f7a9` |
| Vert (revue de `0a67dadf`) | idem | `17b9ad47`, arbre propre | sortie 0 ; 2/2 (configuration, V3E19 : K en `u`, `k_fo` 1,25, totaux 3 250 / 650 / 3 900 c) | `.e2e/army/ci/2026-10-18T17-44-00-709Z-critical`, manifeste `7885c1d9…b651` |
| Garde v2 de la fiche article | `E2E_ARMY_WORKERS=2 npm run e2e:army:ci -- calc-v3 --phase offers --grep PU0 --app-port 3182` | `706cc62f`, arbre propre | sortie 0 ; 6/6 (configuration, PU01-PU05 : PU04 associe un article sur une ligne v2 en barres, PU05 sur une v3) | `.e2e/army/ci/2026-10-18T17-24-42-209Z-calc-v3`, manifeste `78bc5619…02e06e3` |
| Qualité | `npm run verify:pr` | `706cc62f`, arbre propre | sortie 0 en 1 min 45 s ; Vitest node 3 281 tests (2 ignorés), jsdom 831, couverture critique 12 | journal local du clone WSL |

`article-association.e2e.ts` (« local article association », chemin v1/v2 de la fiche article) n'est dans aucun
ensemble de parcours : le `--grep` du vert ne l'a pas retenu et `full --files` le refuse (`NO_TESTS`,
`.e2e/army/ci/2026-10-18T17-19-45-335Z-full`). PU04 couvre ce chemin à sa place ; seul, il échoue avant la fiche
(`expected 26245 to be 8748`, `.e2e/army/ci/2026-10-18T17-22-22-352Z-calc-v3`) parce qu'il dépend de la conversion
d'offre que PU01 enregistre : la garde lance donc PU01-PU05. Le commit suivant `706cc62f` ne touche que cette fiche.

## 5. Limites

- Décision de la revue : aucun contrôle de qualité sur une ligne non chiffrée, quantité comprise (le plan ne citait
  que prix et temps). Confirmée par le coordinateur le 18/10/2026 (délégation du porteur) pour le prix, le temps et
  la quantité ; les autres drapeaux d'une telle ligne (rôle MO, nature, offre périmée, répartition MO, valeurs
  atypiques) tombent avec eux, puisqu'elle ne porte aucun montant. Une ligne v3 chiffrée sans quantité reste
  `missing_quantity` (V3E20).
- G1 rend les lignes de statut neutres, pas le lot OPTIMA tel qu'importé : V3E20 relit encore 1 036 lignes chiffrées
  sans quantité et 1 018 sans prix (titres et articles non quantifiés : le classeur hydraulique a 1 344 lignes sans
  quantité hors statut), plus une violation de règle (`rule_violation`), qui bloquent l'envoi. Hors de G1 : à traiter à
  l'import (section ou statut) ou à l'édition.
- La garde v2 de V3E16 porte sur `missing_price` d'une ligne à 0 € ; les autres drapeaux v1/v2 sont tenus par
  construction (aucune ligne v1/v2 n'a un autre statut que `priced`) et par les parcours v1/v2 existants.
- A14 : V3E18 prouve qu'aucun réglage v2 n'est en attente (avis, état d'enregistrement) ; l'enregistrement refusé
  (400) d'une marge v2 sur une v3 n'est pas rejoué.
- Liste mobile v1/v2 : aucun parcours ne la couvre ; inchangée par construction (expression de `main`).
- La garde v1 (V1BT) n'est pas relancée : aucun chemin de lot n'a changé depuis `366dfebd`. Sur une ligne v1/v2,
  l'unité d'une règle va toujours dans `description` (`resolveEstimateRuleUnitPatch`, branche v1/v2) ; aucun parcours
  n'applique une suggestion de ligne sur une v1/v2.
- Pied de l'éditeur mobile (PU, total) : montants relus de la ligne, comme la grille, rafraîchis après
  l'enregistrement.
- Suggestion de ligne : l'unité refusée l'est par un avis éphémère (toast), sans trace dans la ligne.
