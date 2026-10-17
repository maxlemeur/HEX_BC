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
commencent par ramener la version aux lignes : `reconcileStoredTotals()` presse Ctrl+S depuis le
prix d'achat de la ligne, sans saisie en attente. Sur une v2, cette sauvegarde manuelle écrit les
totaux des lignes quand ils diffèrent (`allowManualTotalsReconciliation`,
`useEstimateEditorState.impl.tsx:540-542` ; `reconcileTotals`,
`useEstimateEditorSyncController.ts:729-735`) par `bulkUpdateEstimateItems([], patch)`, que le
serveur recalcule ; elle n'écrit aucune ligne, ne vide pas l'historique (`clearHistory()` ne
suit qu'un lot de lignes, `:853`) ni l'annulation des suggestions. Après correction, ce Ctrl+S
ne fait rien. L'annulation est alors la seule écriture jugée. En v1, ce rapprochement n'existe
pas : l'annulation v1 n'a pas de parcours (même fonction `applyBulkLineState` que la v2).

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
