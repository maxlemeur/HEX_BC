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

| Parcours | Commit | Itération | Échec observé |
|---|---|---|---|
| V3E16 | `f8cfd013` | `001-2026-10-18T14-38-52-332Z` | porte d'envoi : `blocking: ["missing_price","no_pdf_generated"]`, les trois lignes de statut dans `missing_price` |
| V3E17 | `7d1b1c6e` | `002-2026-10-18T14-42-55-148Z` | champ h/u absent (`hoursPerUnit: false`, `lineHours: true`), ligne relue `unit: null`, `hPerUnit: 0`, totaux 2 600 / 520 / 3 120 c |
| V3E18 | `f8cfd013` | `001-…` | ligne restaurée inchangée : `unit: "u"`, `hPerUnit: 1`, totaux 12 200 / 2 440 / 14 640 c |
| V3E19 | `f8cfd013` | `001-…` | aucun refus ; lignes relues `description: "ML"` et `"boite"`, `unit_code` nul |

Le premier passage de V3E17 (`001-…`) s'arrêtait avant le défaut : à 375 px la grille cède la place à la liste
mobile, le bouton de la grille est masqué. `7d1b1c6e` ouvre la ligne depuis la liste mobile (et attend « 2 × ml »
dans la liste), puis V3E17 a été relancé rouge sur le défaut (`002-…`).

## 3. Correction

- G1 : `computeEstimateQualityFlagsForItem` ne lève `missing_price` ni `missing_labor_time` que sur une ligne
  `priced` (une ligne v1/v2 l'est toujours, déclencheur M4). Gravités de `gating.ts` et critère « Prix » de
  `checklist.ts` inchangés : ils lisent les mêmes drapeaux.
- A13 : `MobileEstimateLineEditor` lit le contexte v3 de la grille. Sur une v3 : statut et TVA de la ligne
  (`V3LineStateControls`), unité du référentiel (`V3UnitField`, même résolution que la cellule « U », refus visible
  par son nom, jamais `description`), heures par unité (`h_mo_per_unit`, ou atelier/chantier par unité) et heures
  totales du moteur en lecture seule. La liste mobile affiche `unit_code` sur une v3.
- A14 : `restoreConflictDraft` met en file la charge v3 (`buildEstimateV3ItemUpdatePayload`, saisies seulement)
  sur une v3 ; `applyRestoredDraft` n'y reprend pas les réglages du brouillon (forme v2).
- A15 : en lot, `buildBulkSuggestPreview({ unitTarget: "unit_code" })` juge la ligne neutre et propose l'unité dans
  `unit_code` ; le contrôleur la résout dans le référentiel avant toute écriture et refuse la sélection entière,
  par le nom de l'unité, si l'une est inconnue. Sur une ligne, même résolution ; refus nommé par un avis, rien de
  la règle n'est écrit.

## 4. Preuves

Voir §4.1 (rempli à la qualification) et la description de la PR.

## 5. Limites

- G1 ne couvre que le prix et le temps MO : une ligne de statut à quantité nulle lève toujours `missing_quantity`
  (bloquant), comme le prévoit le périmètre du plan. Si les lignes PM d'OPTIMA arrivent sans quantité, ce drapeau
  bloquera encore l'envoi : à trancher avant l'usage client réel.
- La garde v2 de V3E16 porte sur `missing_price` d'une ligne à 0 € ; les autres drapeaux v1/v2 sont tenus par
  construction (aucune ligne v1/v2 n'a un autre statut que `priced`) et par les parcours v1/v2 existants.
- Pied de l'éditeur mobile (PU, total) : montants relus de la ligne, comme la grille, rafraîchis après
  l'enregistrement.
- Suggestion de ligne : l'unité refusée l'est par un avis éphémère (toast), sans trace dans la ligne.
