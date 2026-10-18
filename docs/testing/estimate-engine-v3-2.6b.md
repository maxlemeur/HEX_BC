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
  même résolution, puis l'unité choisie va dans `unit_code` et remplace celle de la ligne, comme elle remplace
  `description` en v1/v2 (choix explicite sur cette ligne) ; une unité inconnue est refusée par un avis, rien de la
  règle n'est écrit.
- Régression vue à la première qualification (`.e2e/army/ci/2026-10-18T15-03-53-439Z-critical`, `b1769c1a`) :
  la première version d'A15 jugeait l'éligibilité sur `unit_code` ; une ligne v3 qui a déjà son unité n'était plus
  proposée (V3E12, V3E14 : « Examiner 1 suggestion » attendu). Corrigé par `f7d5fde5` : éligibilité inchangée ; en
  lot, l'unité d'une règle ne remplace pas une unité choisie.
- `verify:pr` a ensuite refusé la taille de `EstimateEditorTable.tsx` (2 612 > 2 600) et de
  `useEstimateEditorSyncController.ts` (1 212 > 1 200) : `366dfebd` déplace la résolution de l'unité d'une règle dans
  `resolveEstimateV3RuleUnit` (`v3-editor.ts`) et le choix de la charge restaurée dans `applyRestoredDraft`, sans
  changer le comportement.

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

## 5. Limites

- Décision de la revue : aucun contrôle de qualité sur une ligne non chiffrée, quantité comprise (le plan ne citait
  que prix et temps). Prise sous la délégation du 18/10/2026 ; à confirmer par le porteur avant l'usage client réel.
- G1 rend les lignes de statut neutres, pas le lot OPTIMA tel qu'importé : V3E20 relit encore 1 036 lignes chiffrées
  sans quantité et 1 018 sans prix (titres et articles non quantifiés : le classeur hydraulique a 1 344 lignes sans
  quantité hors statut), plus une violation de règle (`rule_violation`), qui bloquent l'envoi. Hors de G1 : à traiter à
  l'import (section ou statut) ou à l'édition.
- La garde v2 de V3E16 porte sur `missing_price` d'une ligne à 0 € ; les autres drapeaux v1/v2 sont tenus par
  construction (aucune ligne v1/v2 n'a un autre statut que `priced`) et par les parcours v1/v2 existants.
- A14 : V3E18 prouve qu'aucun réglage v2 n'est en attente (avis, état d'enregistrement) ; l'enregistrement refusé
  (400) d'une marge v2 sur une v3 n'est pas rejoué.
- Liste mobile v1/v2 : aucun parcours ne la couvre ; inchangée par construction (expression de `main`).
- La garde v1 (V1BT) n'est pas relancée à la revue : aucun chemin de lot ni de suggestion n'a changé depuis
  `366dfebd`.
- Pied de l'éditeur mobile (PU, total) : montants relus de la ligne, comme la grille, rafraîchis après
  l'enregistrement.
- Suggestion de ligne : l'unité refusée l'est par un avis éphémère (toast), sans trace dans la ligne.
