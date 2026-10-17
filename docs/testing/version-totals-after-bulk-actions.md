# Totaux de version après les actions en lot de l'éditeur

Suite de la PR #36 (`fc2ba2dc`, [présélection fournisseurs](version-totals-after-preselection.md)).
La PR #36 a corrigé la présélection fournisseurs seulement. Le même appel sans totaux reste
dans les autres actions en lot de l'éditeur : majoration, catégorie et rôle de main-d'œuvre en
lot, avec leurs annulations et rétablissements, puis application et annulation des
suggestions en lot. Ces chemins sont signalés, non vérifiés, dans la section « Même forme
ailleurs » de la PR #36.

Périmètre : moteurs v1 et v2. Le chemin v3 relève du sous-lot 2.6 (autre branche) ; aucun code
v3 n'est touché ici.

## Défaillance observable

Les totaux enregistrés de la version (`estimate_versions.total_ht_cents`, `total_tax_cents`,
`total_ttc_cents`) alimentent la liste des affaires, le hub de l'affaire (« HT version
courante »), les approbations, Direction et les documents. À chaque état validé, ils doivent
être égaux aux lignes. Après une action en lot qui change un montant, et sans aucune autre
sauvegarde :

- l'API `GET /api/estimates/{id}` renvoie des lignes aux nouveaux montants et une version aux
  totaux d'avant l'action ;
- le hub et la liste des affaires affichent l'ancien HT ;
- en v2, la barre de l'éditeur indique « Totaux à synchroniser » (seul Ctrl+S réconcilie) ; en
  v1, rien ne le signale.

Les totaux ne rejoignent les lignes qu'à une sauvegarde ultérieure : une saisie de ligne
(`batchEstimateOperations`, recalcul serveur v1 et v2) ou, en v2, Ctrl+S.

## Cause (lue sur `main` `fc2ba2dc`)

1. Les appelants envoient les lignes par `bulkUpdateEstimateItems(versionId, jeton, lignes)`
   sans quatrième argument `versionPatch`, puis appellent `setTotalsOutOfSync(false)` et
   n'appliquent que le jeton de version (`applyVersionToken`) : la version de l'éditeur garde
   ses anciens totaux.
2. `src/lib/estimates/server.ts:6678-6679` : `shouldProjectDraft` ne vaut vrai que pour une v2
   en marge `tiered` ou avec un `versionPatch`. Sans patch, une v2 en marge non `tiered` et
   toute v1 ne passent pas par `projectDraftMutation`.
3. `src/lib/estimates/server.ts:6760-6768` : la RPC `bulk_update_estimate_items` reçoit alors
   `version_patch: null` et n'écrit que les lignes. Aucun déclencheur ne recalcule l'en-tête.
4. `src/lib/estimates/client.ts:2201-2203` : la file des mutations de l'éditeur classe
   `/items/bulk` comme non structurelle. Son `onCommit`
   (`src/hooks/useEstimateEditorSyncController.ts:266-271`) ne programme donc pas
   d'enregistrement différé des totaux, comme il le fait pour une création ou une suppression
   par les routes d'élément.

## Inventaire des écritures de lignes sans totaux (éditeur v1/v2)

Tous les appels de `bulkUpdateEstimateItems` dans `src/hooks` et `src/lib`, hors tests :

| Chemin | Appel (fichier:ligne) | Change un montant ? | Scénario |
| --- | --- | --- | --- |
| Majoration MO en lot (`applyBulkMajoration`) | `useEstimateEditorBulkController.ts:208` → `applyBulkLineState`, `:116` | Oui, si la ligne a des heures à un taux non nul | BT1 (v2), BT6 (v1) |
| Annulation et rétablissement de la majoration | `useEstimateEditorBulkController.ts:218` et `:225` → `:116` | Oui, idem | BT2 (v2) |
| Rôle MO en lot (`bulkSetLaborRole`) | `useEstimateEditorBulkController.ts:559` → `:116` | Oui, si la ligne a des heures | BT3 (v2) |
| Annulation et rétablissement du rôle MO | `useEstimateEditorBulkController.ts:569` et `:576` → `:116` | Oui, idem | BT3 (v2) |
| Catégorie en lot (`bulkSetCategory`), annulation, rétablissement | `useEstimateEditorBulkController.ts:491`, `:501`, `:508` → `:116` | Non (voir plus bas) | aucun |
| Déplacement en lot (`bulkMoveLines`), annulation, rétablissement | `useEstimateEditorBulkController.ts:428`, `:440`, `:448` → `:116` | Non (voir plus bas) | aucun |
| Application des suggestions en lot (`applySelected`) | `useEstimateEditorSuggestionsController.ts:985` | Oui (coefficients du patch de la règle, ici K FO) | BT4 (v2) |
| Annulation des suggestions en lot (`undoLastApply`) | `useEstimateEditorSuggestionsController.ts:1193` | Oui | BT5 (v2) |
| Présélection fournisseurs (`apply`) | `useEstimateEditorSupplierController.ts:674` | Oui | corrigé par #36 (P1, V1PT01, OZ04) |
| Totaux seuls de la sauvegarde | `useEstimateEditorSyncController.ts:807` | — | conforme : aucune ligne, `versionPatch` fourni |
| Rafraîchissement du jeton après le métré | `src/lib/takeoff/server.ts:6830` | — | hors éditeur : liste vide, n'écrit aucune ligne |

Catégorie et déplacement n'ont pas de défaillance observable sur les totaux. Le calcul v1/v2
(`src/lib/estimate-calculations.ts`) ne lit ni `category_id`, ni `parent_id`, ni `position`.
Avant toute action groupée, `ensureGroupedActionCanProceed`
(`useEstimateEditorSyncController.ts:1091-1110`) enregistre les saisies en attente : la charge du
lot n'emporte donc aucun autre changement de montant. Ces chemins passent par la même fonction
`applyBulkLineState` et recevront les totaux avec elle ; `bulk-move.e2e.ts` couvre déjà le
déplacement.

Hors périmètre, non vérifié par un parcours : la suppression en lot (`bulkDeleteLines`,
`useEstimateEditorBulkController.ts:280`, rétablissement `:334`) passe par la route d'élément
`DELETE`, qui ne recalcule rien (`server.ts:6873-6874`). La file des mutations la classe
structurelle et programme un enregistrement différé des totaux (`hasPendingTotalsSave`), écrit
par la sauvegarde automatique suivante ; `bulkDeleteLines` remet pourtant
`setTotalsOutOfSync(false)` (`:284`, `:317`, `:337`). C'est un autre mécanisme (écart borné par
le délai de la sauvegarde automatique), à traiter dans un lot séparé s'il est confirmé.

## Scénarios (rouges avant correction)

L'oracle est celui de la PR #36 : une lecture API unique, sans attente, juste après que la ligne
modifiée est relue en base (`expectStoredTotals()`, `e2e/army/critical/version-totals-support.ts`).
Les valeurs sont exactes, en centimes, et enregistrées dans
`<préfixe>-<étape>-stored-totals.json` avant toute assertion.

**Annulations.** Un lot qui n'écrit pas ses totaux laisse la version aux totaux d'avant le lot ;
une annulation remet exactement les lignes d'avant le lot. Enchaînés sans autre sauvegarde, un
lot périmé masquerait donc une annulation périmée. Les parcours d'annulation (BT2, BT5)
commencent par ramener la version aux lignes : `reconcileStoredTotals()` presse Ctrl+S, sans
saisie en attente. Sur une v2, cette sauvegarde manuelle écrit les totaux des lignes quand ils
diffèrent (`allowManualTotalsReconciliation`, `useEstimateEditorState.impl.tsx:540-542` ;
`reconcileTotals`, `useEstimateEditorSyncController.ts:729-735`) par
`bulkUpdateEstimateItems([], patch)`, que le serveur recalcule ; elle n'écrit aucune ligne, ne
vide pas l'historique (`clearHistory()` ne suit qu'un lot de lignes, `:853`) ni l'annulation des
suggestions. Après correction, ce Ctrl+S ne fait rien. L'annulation est alors la seule écriture
jugée. En v1, ce rapprochement n'existe pas : l'annulation v1 n'a pas de parcours (même fonction
`applyBulkLineState` que la v2).

Deux conditions du rapprochement, établies par les runs 1 et 2 (plus bas) :

- le raccourci part du corps de la page, aucun champ de grille actif. Un champ de grille valide
  sa valeur à la perte du focus, même inchangée (`handleInputBlur`,
  `src/components/estimates/EditableCell.tsx:145-162` ; `onCommit` du prix, `LineRow.tsx:928-939`
  → `patchItem`, `useEstimateEditorItemsController.ts:842-845`), et cette validation empile une
  étape d'annulation `patch-item` : « Annuler » reprend alors cette étape vide au lieu du lot.
  Défaut d'ergonomie préexistant, hors de ce lot (une annulation sans effet visible), non
  corrigé ici ;
- l'action suivante attend que la barre affiche « Sauvegardé » ou « À jour » : l'API voit
  l'écriture avant que l'éditeur n'en reçoive l'accusé (même règle que `waitForAutoSave`).

Brouillon v2 créé par l'assistant : marge fixe 0 %, TVA 20 %, sans arrondi. Rôle : le seul rôle
actif à 40 €/h du compte CI possédé (`run-tester-army-ci.ts`), relu par `basisLaborRole()`.

| Défaillance observable | Scénario et oracle |
| --- | --- |
| BT1. v2 : majoration MO en lot | D1 « bulk edit sync saves a grid edit back to the pre-bulk majoration » (`e2e/army/critical/bulk-edit-sync.e2e.ts`). Ligne 1 u à 10,00 € plus 1 h au rôle à 40 €/h ; état créé : lignes = version = `[5000, 1000, 6000]`. Majoration 150 %, ligne relue à 1,5 : lignes = version = `[7000, 1400, 8400]` (10,00 € + 1 h × 1,5 × 40,00 €). |
| BT2. v2 : annulation et rétablissement de la majoration | D2 « … after undo and redo ». Même ligne. Majoration 150 %, puis Ctrl+S : version `[7000, 1400, 8400]`. « Annuler », ligne relue à 1 : `[5000, 1000, 6000]`. « Rétablir », ligne relue à 1,5 : `[7000, 1400, 8400]`. |
| BT3. v2 : rôle MO en lot, annulation, rétablissement | D4 « bulk edit sync stores the version totals with a bulk labour role, its undo and redo » (nouveau, même fichier). Ligne 1 u à 10,00 € plus 1 h sans rôle (heure sans taux) : `[1000, 200, 1200]`. Rôle à 40 €/h en lot, ligne relue avec ce rôle : `[5000, 1000, 6000]`. « Annuler » (rôle vide) : `[1000, 200, 1200]`. « Rétablir » : `[5000, 1000, 6000]`. |
| BT4. v2 : application des suggestions en lot | S1 « bulk edit sync suggestions save a K FO edit back to the value before they were applied » (`e2e/army/critical/bulk-edit-sync-sources.e2e.ts`). Ligne 1 u à 10,00 €, K FO 1 (`[1000, 200, 1200]`) ; règle K FO 1,3 appliquée, ligne relue à 1,3 : `[1300, 260, 1560]`. |
| BT5. v2 : annulation des suggestions en lot | S2 « … to the suggested value after their undo ». Après application, Ctrl+S : version `[1300, 260, 1560]`. Annulation, ligne relue à K FO 1 : `[1000, 200, 1200]`. |
| BT6. v1 historique : majoration MO en lot | V1BT01 (`e2e/army/local/bulk-actions-v1-totals.e2e.ts`, sélection `full` comme V1PT01). Projet créé par `POST /api/estimates`, brouillon v1 inséré en version 2 par le propriétaire natif de la pile possédée (`e2e/army/local/legacy-v1-draft-support.ts`, extrait de V1PT01 sans changement de valeurs) : marge ×1, TVA 20 %, sans remise ni arrondi ; 2 u à 10,00 € plus 1 h au rôle à 40 €/h, totaux semés cohérents `[6000, 1200, 7200]`. Majoration 150 %, ligne relue à 1,5 : lignes = version = `[8000, 1600, 9600]` ; hub et liste : 80,00 € (`expectStoredTotalsMatchLines()`, mode Expert par SQL, puis mode initial restauré). |
| BT7. La correction change un autre montant | `src/lib/estimate-calculations.ts` et `src/lib/estimate-v2-snapshot.ts` restent sans modification ; P1, V1PT01, D3, `bulk-move`, `commercial-rounding`, `estimate-integrity` restent verts. |

Les parcours D1 à D3 gardent leur rôle (référence de synchronisation,
[bulk-edit-sync-baseline.md](bulk-edit-sync-baseline.md)) : leur ligne porte désormais 1 h au
rôle à 40 €/h pour que la majoration change un montant, et chacun vérifie l'état créé. Le
contrôle de BT1 suit le lot de D1 ; celui de BT4 suit l'application de S1 : pas dans
`suggestionJourney`, partagé avec S2, où il masquerait BT5.

Non couvert : v2 en marge `tiered` (déjà recalculée par le serveur), annulation v1, catégorie et
déplacement (sans effet sur les montants), approbations, Direction et documents (ils lisent les
mêmes colonnes, non parcourus ici).

Commandes (clone WSL `~/miaouffrage-totals-bulk`, pile Supabase native possédée). V1BT01 et
V1PT01 n'appartiennent qu'à la sélection `full`, que le runner ne filtre pas : pour les filtrer,
un run ajoute temporairement les deux fichiers à la liste critical `localBusiness` de
`e2e.config.ts` (comme R1 de la PR #36), modification non commitée et relevée par son
`diffSha256`.

```bash
npm run e2e:army:local -- --grep "bulk edit sync|^V1BT01\s|^V1PT01\s" --app-port <port>
npm run e2e:army:ci -- full --app-port <port>
```

## Preuves rouges (18/10/2026, avant correction)

WSL Ubuntu 24.04, Node 24.14.0, Supabase CLI natif 2.120.0, clone Linux
`~/miaouffrage-totals-bulk`, branche `fix/version-totals-after-bulk-actions` (code produit de
`main` `fc2ba2dc`, seuls les parcours changent). Seule modification locale : V1BT01 et V1PT01
ajoutés à la liste critical `localBusiness` de `e2e.config.ts` pour les filtrer
(`diffSha256` `7fbcd375…bae`), retirée après les runs. Chaque run démarre sa propre pile
éphémère : pgTAP (19 fichiers, 1 837 assertions) et matrice RLS passés, build possédé, puis les
parcours (1 worker). Une seule pile native possédée à la fois. Journaux :
`~/totals-bulk-logs/red-critical-run{1,2,3}.log`.

Commande des trois runs :
`npm run e2e:army:local -- --grep "bulk edit sync|^V1BT01\s|^V1PT01\s" --app-port 3151`.

| Run | Révision | Résultat | Preuves (sous `~/miaouffrage-totals-bulk/.e2e/army/ci`) |
| --- | --- | --- | --- |
| 1 | `a5bc3ec1` | exit 1 ; 4 verts, 6 rouges. D1, S1, V1BT01 rouges à l'oracle. Défauts du parcours : D4 ne trouve pas l'onglet (libellé « Affichage & contrôle » suivi du nombre d'alertes) ; D2 et S2 cliquent l'annulation avant l'accusé du Ctrl+S, et aucune requête d'annulation ne part | `2026-10-17T21-52-31-089Z-critical` (`manifest.json` sha256 `47e4501f…9c26`) |
| 2 | `c6ce5563` (attente de l'accusé, onglet sans compte fixe) | exit 1 ; S2 et D4 rouges à l'oracle ; D2 annule encore sans effet : l'étape `patch-item` vide du prix quitté (voir « Annulations ») | `2026-10-17T22-03-59-474Z-critical` (`manifest.json` sha256 `8d85d45e…3a8b`) |
| 3 | `0f1f0a15` (raccourci depuis le corps de la page) | exit 1 ; setup, P1, D3, V1PT01 verts ; D1, D2, D4, S1, S2, V1BT01 rouges, chacun à sa première lecture de totaux après l'action jugée | `2026-10-17T22-07-46-818Z-critical` (`manifest.json` sha256 `85b1d8b5…57b3`) |

Run 3, valeurs relues dans la même lecture (`critical/artifacts/business/`) :

| Scénario | Version (`id`) | État avant l'action (lignes = version) | Lignes après l'action | Version enregistrée | Fichier (sha256) |
| --- | --- | --- | --- | --- | --- |
| BT1, D1 majoration | `f7962672…` v2 `fixed` | `[5000, 1000, 6000]` | `[7000, 1400, 8400]` | `[5000, 1000, 6000]` | `ARMY-1792274962598-1c6ce8e9-bulk-sync-d1-majoration-stored-totals.json` (`89ca9bac…c69c`) |
| BT2, D2 annulation | `0b80769b…` v2 `fixed` | `[7000, 1400, 8400]` (après Ctrl+S, `…-d2-majoration-reconciled-totals.json`, `4aebf9d2…6c78`) | `[5000, 1000, 6000]` | `[7000, 1400, 8400]` | `ARMY-1792274966913-11f0b1f5-bulk-sync-d2-undo-stored-totals.json` (`ce38bbbe…33a4`) |
| BT3, D4 rôle MO | `ec5a449e…` v2 `fixed` | `[1000, 200, 1200]` | `[5000, 1000, 6000]` | `[1000, 200, 1200]` | `ARMY-1792274979530-fb438ae5-bulk-sync-d4-labor-role-stored-totals.json` (`a8b48d7d…e76e`) |
| BT4, S1 suggestions | `4728738b…` v2 `fixed` | `[1000, 200, 1200]` | `[1300, 260, 1560]` | `[1000, 200, 1200]` | `ARMY-1792274934109-abf19f9a-bulk-sync-s1-apply-stored-totals.json` (`8178377a…547a`) |
| BT5, S2 annulation des suggestions | `d03f3979…` v2 `fixed` | `[1300, 260, 1560]` (après Ctrl+S, `…-s2-apply-reconciled-totals.json`, `18af3b30…df57`) | `[1000, 200, 1200]` | `[1300, 260, 1560]` | `ARMY-1792274942409-c9a07e1a-bulk-sync-s2-undo-stored-totals.json` (`6076b3e5…ae2f`) |
| BT6, V1BT01 majoration v1 | `19116945…` v1 `fixed` | `[6000, 1200, 7200]` (semé) | `[8000, 1600, 9600]` | `[6000, 1200, 7200]` ; hub et liste 60,00 € | `ARMY-1792274984423-4c6dcf5f-v1-bulk-majoration-stored-totals.json` (`bb587b18…4d3c`) |

Les lignes sont égales aux valeurs attendues ; seul l'en-tête de version est périmé, à la valeur
d'avant l'action. Chaque parcours s'arrête à cette première assertion fausse : les rétablissements
de D2 et D4 ne sont pas encore atteints. Les états créés de D1 à D4 sont cohérents
(`…-seeded-stored-totals.json`). Témoins verts dans le même run : P1 `[1234, 247, 1481]`
(correction #36), V1PT01 `[3702, 740, 4442]`, hub et liste 37,02 €, sur le module de semis
extrait ; les deux parcours v1 ont restauré le mode initial `simplified`.
