# Moteur 3, sous-lot 2.6b : limites restantes de l'éditeur v3 et G1

Plan vers la bascule 2.10 (18/10/2026), sous-lot 2.6b ; décision D-c (branche v3 complète de l'éditeur mobile).
Aucune migration. Les chemins v1/v2 ne changent pas : chaque correction est conditionnée au moteur 3
(`pricing_status` ≠ `priced`, qui n'existe que sur une v3, ou contexte v3 de l'éditeur).

## 1. Défaillances à empêcher

| # | Défaillance | Effet |
|---|---|---|
| G1 | Une ligne v3 non chiffrée (incluse, pour mémoire, hors lot…) à 0 € lève `missing_price` (`estimate-quality.ts`), bloquant à l'envoi (`gating.ts`) | Toute v3 importée d'OPTIMA avec des lignes HL/inc/PM est refusée (`ESTIMATE_GATING_BLOCKED`) ou forcée avec de faux drapeaux ; pastilles « Prix manquant » et « Temps MO manquant » à tort dans l'éditeur |
| G1-v2 | La correction touche une v1/v2 | Une ligne v2 « HL » à 0 € ne bloquerait plus |
| A13 | Éditeur mobile (375 px) sans branche v3 | Unité écrite dans `description`, `unit_code` vide, gel refusé (`ESTIMATE_V3_UNIT_REQUIRED`) ; heures totales ignorées en silence, heures par unité impossibles à saisir ; la liste mobile affiche `description` |
| A14 | Restauration d'un brouillon en conflit par la charge v2 | Saisies v3 (unité, h/u) perdues, réglages de marge v2 réappliqués (400 à l'enregistrement) |
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

## 3. Correction

- G1 : `computeEstimateQualityFlagsForItem` ne lève `missing_price` ni `missing_labor_time` que sur une ligne
  `priced` (une ligne v1/v2 l'est toujours, déclencheur M4). Gravités de `gating.ts` et critère « Prix » de
  `checklist.ts` inchangés : ils lisent les mêmes drapeaux.
- A13 : `MobileEstimateLineEditor` lit le contexte v3 de la grille. Sur une v3 : statut et TVA de la ligne
  (`V3LineStateControls`), unité du référentiel (`V3UnitField`, même résolution que la cellule « U », refus visible
  par son nom, jamais `description`), heures par unité (`h_mo_per_unit`, ou atelier/chantier par unité) et heures
  totales du moteur en lecture seule. La liste mobile affiche `unit_code` sur une v3.
- A14 : sur une v3, `applyRestoredDraft` ne reprend pas les réglages du brouillon (forme v2) et donne à
  `restoreConflictDraft` la charge v3 (`buildEstimateV3ItemUpdatePayload`, saisies seulement) des lignes restaurées.
- A15 : en lot, `buildBulkSuggestPreview({ unitTarget: "unit_code" })` garde les lignes éligibles de 2.6 et propose
  l'unité dans `unit_code`, seulement sur une ligne qui n'en a pas ; le contrôleur la résout dans le référentiel
  avant toute écriture et refuse la sélection entière, par le nom de l'unité, si l'une est inconnue. Sur une ligne,
  même résolution ; refus nommé par un avis, rien de la règle n'est écrit.
- Régression vue à la première qualification (`.e2e/army/ci/2026-10-18T15-03-53-439Z-critical`, `b1769c1a`) :
  la première version d'A15 jugeait l'éligibilité sur `unit_code` ; une ligne v3 qui a déjà son unité n'était plus
  proposée (V3E12, V3E14 : « Examiner 1 suggestion » attendu). Corrigé par `f7d5fde5` : éligibilité inchangée,
  l'unité d'une règle ne remplace jamais une unité choisie.
- `verify:pr` a ensuite refusé la taille de `EstimateEditorTable.tsx` (2 612 > 2 600) et de
  `useEstimateEditorSyncController.ts` (1 212 > 1 200) : `366dfebd` déplace la résolution de l'unité d'une règle dans
  `resolveEstimateV3RuleUnit` (`v3-editor.ts`) et le choix de la charge restaurée dans `applyRestoredDraft`, sans
  changer le comportement.

## 4. Preuves

| Preuve | Commande | Révision | Résultat | Trace |
|---|---|---|---|---|
| Verts en itération | `npm run e2e:army:dev-loop -- run --grep 'V3E1[6-9]'` puis `'V3E18'` | `41533b62`, `b1769c1a` | V3E16, V3E17, V3E19 verts ; V3E18 vert après `b1769c1a` | itérations `005-2026-10-18T14-58-04-291Z`, `006-2026-10-18T15-01-12-344Z` |
| Qualification ciblée | `E2E_ARMY_WORKERS=2 npm run e2e:army:local -- --app-port 3182 --grep 'V3E\|V3P01\|V3FC\|bulk edit sync'` | `366dfebd`, arbre propre | sortie 0 ; inventaire des migrations conforme, pgTAP `Files=23, Tests=1891`, matrice RLS passée ; 29/29 (configuration + V3E01-V3E14, V3E16-V3E19, V3P01, V3FC01-02, sept parcours v2 « bulk edit sync »), parcours 4 min 41 s | `.e2e/army/ci/2026-10-18T15-27-28-694Z-critical`, manifeste `38f23372…1e18b` |
| Garde v1 | `E2E_ARMY_WORKERS=2 npm run e2e:army:ci -- full --app-port 3182 --files e2e/army/critical/auth.setup.e2e.ts,e2e/army/local/bulk-actions-v1-totals.e2e.ts` | `366dfebd` | sortie 0 ; V1BT01-V1BT03 (majoration en lot et suggestions d'une v1 historique) 3/3 + configuration | `.e2e/army/ci/2026-10-18T15-36-11-514Z-full`, manifeste `b43f073b…ad777` |
| Qualité | `npm run verify:pr` | `366dfebd`, arbre propre | sortie 0 en 2 min 42 s : budgets d'architecture, OpenAPI, types, lint ; Vitest node 2 939 tests, jsdom 831 tests | journal local du clone WSL |

La qualification précédente sur `b1769c1a` (`.e2e/army/ci/2026-10-18T15-03-53-439Z-critical`) avait 27/29 : V3E12 et
V3E14 rouges, la régression du §3 ; celle de `f7d5fde5` (`2026-10-18T15-12-54-594Z`) était verte avant le
refactor de `366dfebd`, qui a donc été requalifié.

## 5. Limites

- G1 ne couvre que le prix et le temps MO : une ligne de statut à quantité nulle lève toujours `missing_quantity`
  (bloquant), comme le prévoit le périmètre du plan. Si les lignes PM d'OPTIMA arrivent sans quantité, ce drapeau
  bloquera encore l'envoi : à trancher avant l'usage client réel.
- La garde v2 de V3E16 porte sur `missing_price` d'une ligne à 0 € ; les autres drapeaux v1/v2 sont tenus par
  construction (aucune ligne v1/v2 n'a un autre statut que `priced`) et par les parcours v1/v2 existants.
- Pied de l'éditeur mobile (PU, total) : montants relus de la ligne, comme la grille, rafraîchis après
  l'enregistrement.
- Suggestion de ligne : l'unité refusée l'est par un avis éphémère (toast), sans trace dans la ligne.
