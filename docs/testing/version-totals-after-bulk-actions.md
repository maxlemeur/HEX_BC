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

La revue indépendante (constat 3, plus bas) confirme ce mécanisme par lecture du code et l'étend.
Les autres écritures de l'éditeur v1/v2 qui changent un montant passent par la même route
`DELETE` et n'écrivent donc pas de totaux. Elles ne sont vérifiées par aucun parcours et restent
hors de ce lot. Lignes relevées sur la tête de branche :

| Chemin | Appel (fichier:ligne) |
| --- | --- |
| Suppression d'une ligne ou d'une section (`deleteItem`) | `useEstimateEditorItemsController.ts:697`, rétablissement `:750` |
| Annulation de la création d'une ligne ou d'une section | `useEstimateEditorItemsController.ts:319`, `:357`, `:537`, `:571` |
| Annulation d'une insertion de structure | `useEstimateEditorStructureController.ts:354`, `:520` |
| Annulation d'un collage | `useEstimateEditorPasteController.ts:356` |
| Suppression en lot et son rétablissement | `useEstimateEditorBulkController.ts:311`, `:365` (`setTotalsOutOfSync(false)` en `:315`, `:348`, `:368`) |

`deleteEstimateItem` (`server.ts`) ne fait qu'un `.delete()` ; son propre commentaire le dit
(« cette suppression directe ne recalcule rien ») et renvoie la v3 au lot. `client.ts` classe `/items` comme
structurel : `onCommit` n'arme qu'un enregistrement différé des totaux, écrit par la sauvegarde
automatique suivante (`AUTOSAVE_DEBOUNCE_MS` = 60 s) ou par une sauvegarde manuelle. Deux
corrections possibles, pour un lot séparé :

- passer ces suppressions par `batchEstimateOperations` (`op: "delete"`, qui écrit les totaux
  côté serveur, comme le fait déjà la v3) ;
- faire suivre chaque suppression d'un `bulkUpdateEstimateItems([], patch)` sans ligne.

Dans les deux cas, retirer les `setTotalsOutOfSync(false)` de `bulkDeleteLines`. Le déplacement
en lot reste exempté à bon droit. Selon la revue (non revérifié ici), réordonner, déplacer et
créer par collage passent par des chemins de structure ou par lots : soit ils ne changent aucun
montant, soit le serveur y écrit les totaux.

## Correction (`4f670996`, `db968ffe`)

Même forme que la PR #36, par le calcul existant, sans changement serveur :

- `applyBulkLineState` (`useEstimateEditorBulkController.ts`) écrit la majoration, le rôle MO et
  la catégorie en lot, avec leurs annulations et rétablissements. Il calcule avant l'écriture
  optimiste les totaux de la version sur les lignes de l'éditeur telles qu'elles seront après
  l'écriture. Il passe par `computeVersionTotalsPatch`,
  créé par #36 : `computePersistedTotals` de `useEstimateEditorCalculation`, soit
  `computeDraftBreakdown` sur le paramétrage enregistré. Ces totaux partent comme quatrième
  argument (`versionPatch`) du même `bulkUpdateEstimateItems`.
- `applySelected` et `undoLastApply` (`useEstimateEditorSuggestionsController.ts`) font de même,
  sur les lignes suggérées puis sur les lignes restaurées.
- Les totaux confirmés (réponse du serveur en v2, patch envoyé en v1) sont appliqués à la
  version de l'éditeur (`applyVersionTokenAndTotals` → `applyVersionFlushResult`, créés par #36).
- Totaux non calculables (paramétrage enregistré absent) : l'action est refusée avant toute
  écriture, avec « Impossible de calculer les totaux du devis. » (dans la boîte de dialogue pour
  l'application des suggestions, dans la barre d'erreur sinon), au lieu d'écrire des lignes sans
  leur en-tête.
- `useEstimateEditorState.impl.tsx` : 4 lignes, le câblage des deux contrôleurs sur
  `computeVersionTotalsPatch` et `applyVersionTokenAndTotals`. Ce fichier est réécrit par le
  sous-lot 2.6 : le conflit attendu se limite à ces lignes. `useEstimateEditorCalculation.ts` et
  `useEstimateEditorSupplierController.ts` : aucun diff.
- Serveur inchangé. En v2, la présence du patch fait passer par `projectDraftMutation`
  (`server.ts:6678-6679`) : le serveur recalcule tout le brouillon depuis les lignes enregistrées
  et écrit ses propres totaux, les valeurs du client étant ignorées. En v1,
  `assertEstimateTotalsInvariantForPatch` contrôle le patch (HT + TVA = TTC), puis la RPC
  l'écrit. Lignes et totaux partent dans la même transaction `bulk_update_estimate_items`.
- Tests isolés existants (`useEstimateEditorBulkController.test.ts`,
  `useEstimateEditorSuggestionsController.test.ts`) : harnais complété de
  `computeVersionTotalsPatch` comme celui de la présélection (#36), et assertions d'arguments
  exacts complétées du patch. Aucun nouveau test isolé : le comportement est jugé par les
  parcours. La revue a montré que ce harnais à valeur constante ne pouvait rien détecter
  (constat 2, plus bas) : il est remplacé par `1eb299e0`.

Aucune migration, aucune modification SQL ni OpenAPI : rien à appliquer à la base partagée.
`src/lib/estimate-calculations.ts` et `src/lib/estimate-v2-snapshot.ts` : diff vide contre
`fc2ba2dc`. Aucun code v3 touché ; l'éditeur refuse une v3 avant tout chargement
(`src/app/dashboard/estimates/[versionId]/edit/page.tsx`).

La catégorie envoie désormais elle aussi ses totaux, inchangés : en v2, elle passe donc par
`projectDraftMutation`, comme toute écriture en lot d'une v2 `tiered`. Aucun parcours ne
l'exerce.

Le déplacement en lot garde son écriture sans totaux (`db968ffe`). Il ne change aucun montant :
le calcul v1/v2 ne lit ni `parent_id` ni `position`. La première forme (`4f670996`) lui envoyait
aussi ses totaux, et la suite `full` l'a refusée (run F1, plus bas) : `bulk-move` échoue à
l'annulation, `POST …/items/bulk` répond 409. Cause, lue dans le code : avec un patch, une v2
passe par `projectDraftMutation`, qui réécrit toutes les lignes du brouillon. La RPC
`bulk_update_estimate_items` place d'abord chaque ligne écrite à sa position négative, dans son
parent actuel. À l'annulation, la ligne déplacée, encore dans la section cible, prend donc la
position −1, comme la ligne déjà présente à la position 1 de cette section. L'index unique
`estimate_items_child_position_unique` (`parent_id`, `position`), non différable, refuse cette
écriture ; `mapSupabaseError` traduit `23505` en 409 « Conflit de données. ». La même collision
existe déjà pour un déplacement en lot sur une v2 `tiered`, toujours projetée : défaut préexistant,
non vérifié par un parcours, hors de ce lot.

Limites connues :

- en v1, les totaux écrits sont ceux du calcul de l'éditeur, que le serveur contrôle sans les
  recalculer : c'est le contrat existant des écritures de totaux v1 (#36). La sauvegarde
  ordinaire suivante (`batchEstimateOperations`) les recalcule côté serveur ;
- l'annulation et le rétablissement de l'historique ne passent pas par
  `ensureGroupedActionCanProceed`. Le calcul porte sur les lignes de l'éditeur. Une saisie de
  ligne empile sa propre étape d'annulation au-dessus du lot. En v2, le serveur recalcule depuis
  la base. En v1, l'annulation et le rétablissement sont couverts depuis la revue par V1BT02 et
  V1BT03 (BT8) ;
- un enregistrement du paramétrage vide l'historique et l'annulation des suggestions, en v1 comme
  en v2 (`88854fcb`, BT9 plus bas) ;
- suppression en lot : autre mécanisme, hors de ce lot (voir l'inventaire).

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
jugée. En v1, ce rapprochement n'existe pas. Depuis la revue, V1BT02 et V1BT03 (BT8) jugent
d'abord le lot ou l'application, puis l'annulation : chaque écriture y est jugée sur ses propres
totaux.

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
| BT8. v1 historique : annulation, rétablissement, suggestions (ajouté par la revue) | Même brouillon v1 semé que BT6, `[6000, 1200, 7200]`. V1BT02 : majoration 150 % `[8000, 1600, 9600]`, « Annuler » `[6000, 1200, 7200]`, « Rétablir » `[8000, 1600, 9600]`. V1BT03, règle K FO 1,3 sur le titre exact : application `[6600, 1320, 7920]`, annulation `[6000, 1200, 7200]`, nouvelle application `[6600, 1320, 7920]`. Valeurs du moteur v1 (`computeEstimateBreakdown`, `calc_engine_version` 1). |
| BT9. Enregistrement du paramétrage après une action en lot (constat 1 de la revue) | Suite de V1BT02 et V1BT03 : marge ×1,2 choisie et enregistrée dans la boîte « Paramétrage du devis » de l'éditeur monté (ouverte par la barre de résumé ; une navigation remonterait l'éditeur et viderait l'état jugé). Le serveur reprend les lignes : `[9600, 1920, 11520]` (80,00 € × 1,2) et `[7920, 1584, 9504]` (66,00 € × 1,2). Ensuite, l'annulation de l'historique (V1BT02) ou des suggestions (V1BT03), si elle est encore offerte, est exécutée pour que l'étape échoue sur ses valeurs. Attendu : version = lignes = valeurs ci-dessus, « Annuler » désactivé, alerte des suggestions masquée, puis hub et liste à 96,00 € et 79,20 €. |

Les parcours D1 à D3 gardent leur rôle (référence de synchronisation,
[bulk-edit-sync-baseline.md](bulk-edit-sync-baseline.md)) : leur ligne porte désormais 1 h au
rôle à 40 €/h pour que la majoration change un montant, et chacun vérifie l'état créé. Le
contrôle de BT1 suit le lot de D1 ; celui de BT4 suit l'application de S1 : pas dans
`suggestionJourney`, partagé avec S2, où il masquerait BT5.

Non couvert : v2 en marge `tiered` (déjà recalculée par le serveur), catégorie et rôle MO en v1
(même fonction `applyBulkLineState` que la majoration, jugée par BT8 et par les tests isolés),
déplacement (sans effet sur les montants), approbations, Direction et documents (ils lisent les
mêmes colonnes, non parcourus ici).

Commandes (clone WSL `~/miaouffrage-totals-bulk`, pile Supabase native possédée). V1BT01 à
V1BT03 et V1PT01 n'appartiennent qu'à la sélection `full`, que le runner ne filtre pas : pour les
filtrer, un run ajoute temporairement les deux fichiers à la liste critical `localBusiness` de
`e2e.config.ts` (comme R1 de la PR #36), modification non commitée et relevée par son
`diffSha256`.

```bash
npm run e2e:army:local -- --grep "bulk edit sync|^V1BT01\s|^V1PT01\s" --app-port <port>
npm run e2e:army:local -- --grep "bulk edit sync|bulk move persists|commercial rounding|^V1BT0[123]\s|^V1PT01\s" --app-port <port>
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

## Preuves vertes (18/10/2026, après correction)

Même environnement que les preuves rouges : WSL Ubuntu 24.04, Node 24.14.0, Supabase CLI natif
2.120.0, clone Linux `~/miaouffrage-totals-bulk`, synchronisé sur la branche Windows par
`git -c safe.directory='*' fetch /mnt/c/Users/maxim/Projects/miaouffrage
fix/version-totals-after-bulk-actions` puis `git reset --hard FETCH_HEAD`. Chaque run démarre
sa propre pile éphémère : pgTAP (19 fichiers, 1 837 assertions) et matrice RLS passés, build
possédé, puis les parcours (1 worker). Le verrou des piles natives est relu avant chaque run
(attente tant que deux processus de pile ou plus tournent) ; une seule pile possédée par ce lot
à la fois. Les runs filtrés (G1, G2) ajoutent temporairement V1BT01 et V1PT01 à la liste critical
`localBusiness`, comme les runs rouges (`diffSha256` `7fbcd375…9bae`), retiré ensuite ; les
suites `full` (F1, F2) tournent sans modification locale (`diffSha256` `e3b0c442…b855`,
empreinte du diff vide). Journaux : `~/totals-bulk-logs/green-{critical,full}-run{1,2}.log`.

| Run | Révision | Commande | Résultat | Preuves (sous `~/miaouffrage-totals-bulk/.e2e/army/ci`) |
| --- | --- | --- | --- | --- |
| G1 | `4f670996` | `npm run e2e:army:local -- --grep "bulk edit sync\|^V1BT01\s\|^V1PT01\s" --app-port 3151` | exit 0 ; 10/10 (setup, S1, S2, P1, D1–D4, V1BT01, V1PT01) | `2026-10-17T22-20-58-090Z-critical` (`manifest.json` sha256 `3220df11…b198`) |
| F1 | `4f670996` | `npm run e2e:army:ci -- full --app-port 3151` | exit 1 ; phase `full` 141/143. Rouges : `bulk-move` à l'annulation (`POST …/items/bulk` 409, alerte « Impossible d'annuler la dernière action. », placement resté dans la section cible ; voir « Correction ») et US-4.1 (préexistant, plus bas). Verts : `bulk-edit-sync` 4/4, `bulk-edit-sync-sources` 3/3, V1BT01, V1PT01. Phase `development` 4/4 | `2026-10-17T22-24-21-776Z-full` (`manifest.json` sha256 `74150c49…4c41`) ; `ARMY-1792275991404-881532f7-bulk-move-placements.json` (sha256 `e0f03c02…f856`) |
| G2 | `db968ffe` | `npm run e2e:army:local -- --grep "bulk edit sync\|bulk move persists\|^V1BT01\s\|^V1PT01\s" --app-port 3151` | exit 0 ; 11/11 (G1 plus `bulk-move` : déplacé, annulé, rétabli, rechargé, tous au placement attendu) | `2026-10-17T22-55-38-857Z-critical` (`manifest.json` sha256 `7df6d149…0062`) ; `…-bulk-move-placements.json` (sha256 `e3fe5b8d…ce1e`) |
| F2 | `db968ffe` | `npm run e2e:army:ci -- full --app-port 3151` (12 min 42 s de parcours) | exit 1 ; phase `full` 142/143 : seul US-4.1 rouge (préexistant). Verts, entre autres : `bulk-edit-sync` 4/4, `bulk-edit-sync-sources` 3/3, `bulk-move`, `commercial-rounding` 2/2, `estimate-integrity` 5/5, V1BT01, V1PT01. Phase `development` 4/4 | `2026-10-17T22-59-28-079Z-full` (`manifest.json` sha256 `36c8a8fc…6cec`) |

Valeurs relues en F2 (révision finale, sélection `full` réelle, sans modification locale), dans
la même lecture juste après l'action jugée et sans autre sauvegarde (`full/artifacts/business/`) :

| Scénario | Étape | Lignes = version (`[HT, TVA, TTC]`) | Fichier (sha256) |
| --- | --- | --- | --- |
| BT1, D1 | majoration | `[7000, 1400, 8400]` | `ARMY-1792278071391-c6b74838-bulk-sync-d1-majoration-stored-totals.json` (`90983345…5ad3`) |
| BT2, D2 | Ctrl+S après la majoration (sans effet) | `[7000, 1400, 8400]` | `ARMY-1792278078317-2f1b4c82-bulk-sync-d2-majoration-reconciled-totals.json` (`a37e19f7…f37c`) |
| BT2, D2 | annulation | `[5000, 1000, 6000]` | `…-2f1b4c82-bulk-sync-d2-undo-stored-totals.json` (`be1664a5…d4f4`) |
| BT2, D2 | rétablissement | `[7000, 1400, 8400]` | `…-2f1b4c82-bulk-sync-d2-redo-stored-totals.json` (`27707641…c715`) |
| BT3, D4 | rôle MO en lot | `[5000, 1000, 6000]` | `ARMY-1792278094178-dff7ce65-bulk-sync-d4-labor-role-stored-totals.json` (`26288d7f…6e56`) |
| BT3, D4 | annulation | `[1000, 200, 1200]` | `…-dff7ce65-bulk-sync-d4-undo-stored-totals.json` (`e56c9583…29f7`) |
| BT3, D4 | rétablissement | `[5000, 1000, 6000]` | `…-dff7ce65-bulk-sync-d4-redo-stored-totals.json` (`4e7db704…c292`) |
| BT4, S1 | application des suggestions | `[1300, 260, 1560]` | `ARMY-1792278036637-237c5cb8-bulk-sync-s1-apply-stored-totals.json` (`6164dd94…0a0d`) |
| BT5, S2 | Ctrl+S après l'application (sans effet) | `[1300, 260, 1560]` | `ARMY-1792278048732-91887aec-bulk-sync-s2-apply-reconciled-totals.json` (`b091ae7d…9e3b`) |
| BT5, S2 | annulation des suggestions | `[1000, 200, 1200]` | `…-91887aec-bulk-sync-s2-undo-stored-totals.json` (`577ad057…3f13`) |
| BT6, V1BT01 | majoration v1 | `[8000, 1600, 9600]` ; hub et liste 80,00 € | `ARMY-1792278603385-f27df058-v1-bulk-majoration-stored-totals.json` (`eaa6b712…8f31`) |
| BT7, P1 | présélection (#36) | `[1234, 247, 1481]` | `ARMY-1792278059980-14548456-bulk-sync-p1-preselection-stored-totals.json` (`77be350c…10b4`) |
| BT7, V1PT01 | présélection v1 (#36) | `[3702, 740, 4442]` ; hub et liste 37,02 € | `ARMY-1792278627767-1089aece-v1-preselection-stored-totals.json` (`19248e2f…a12f`) |
| BT7, `bulk-move` | déplacé, annulé, rétabli, rechargé | placements attendus, montants de la ligne inchangés | `ARMY-1792278100403-4818529b-bulk-move-placements.json` (`a3042d1d…0e80`) |

Les assertions des parcours n'ont pas changé entre le rouge et le vert : seul le code de
l'éditeur a changé (`4f6f5c26..db968ffe`). Les six contrôles rouges (D1, annulation de D2, D4,
S1, annulation de S2, V1BT01) sont verts aux valeurs exactes attendues ; les rétablissements de
D2 et D4, non atteints au rouge, le sont aussi. Les états créés de D1 à D4 restent cohérents
(`…-seeded-stored-totals.json`) ; les deux parcours v1 ont restauré le mode initial
`simplified`. G1 et G2 relèvent les mêmes valeurs.

Pas de run de mutation séparé. Au rouge, chaque annulation était déjà jugée seule : Ctrl+S
avait ramené la version aux lignes avant l'annulation, et S2 et D2 y étaient rouges. Annulation
et rétablissement de la majoration et du rôle MO passent par la même fonction que le lot.

US-4.1 (`e2e/army/takeoff/team-b-user-stories.e2e.ts`, import CSV de prix fournisseurs) échoue
en F1 et F2 avec la même erreur que dans la PR #36 (« Analyser » jamais activé, course à
l'hydratation du parcours, rouge aussi sur `main` seul : runs D2 et D3 de
[version-totals-after-preselection.md](version-totals-after-preselection.md)). Ce lot ne touche
ni cette page ni `PriceBookUploadStep`. Défaut préexistant du parcours, hors de ce lot.

Contrôles statiques et isolés (worktree Windows `C:/Users/maxim/Projects/miaouffrage-totals-bulk`,
contenu de `db968ffe`, seule modification locale : ce document) :

- `npx eslint --max-warnings=0` sur les cinq fichiers `src/hooks` touchés, `npm run typecheck`,
  `npm run check:architecture` (1 123 modules, 0 cycle) : exit 0 ;
- `npx vitest run src/hooks/useEstimateEditorBulkController.test.ts
  src/hooks/useEstimateEditorSuggestionsController.test.ts` : 2 fichiers, 20 tests passés ;
  `npx vitest run src/lib/estimates/engine-frozen-corpus.test.ts
  src/lib/estimate-calculations.golden/v1.test.ts src/hooks` : 36 fichiers, 318 tests passés ;
  `npx vitest run src/lib/estimates/engine-frozen-corpus.test.ts` : 2 tests passés ;
- `git diff fc2ba2dc -- src/lib/estimate-calculations.ts src/lib/estimate-v2-snapshot.ts` : vide ;
- `git diff --check`, `git diff --cached --check` : propres.
- `npm run verify:pr` sous Windows s'arrête à `audit:signatures` sur l'erreur `ENOENT` connue du
  cache npm local (`_cacache`, comme dans la PR #36), après `audit:dependencies` passé. Lancé
  dans le clone WSL sur `db968ffe` sans modification locale (`diffSha256` `e3b0c442…b855`) :
  exit 0, chaîne complète (`audit:dependencies`, `audit:signatures` 762 signatures et 219
  attestations vérifiées, `check:architecture`, `validate-openapi`, `typecheck`, `lint`,
  `test:ci:node` 295 fichiers passés et 1 ignoré, 2 783 tests passés et 2 ignorés,
  `test:ci:jsdom` 162 fichiers et 821 tests, `test:critical-coverage` 3 fichiers et 12 tests).
  Journal : `~/totals-bulk-logs/verify-pr.log`.

Non exécuté à ce stade : parcours de la catégorie en lot (aucun n'existe), annulation v1, v2
`tiered`, approbations, Direction et documents. La revue indépendante a suivi (section suivante).

## Revue indépendante et préparation à la publication (18/10/2026)

Une revue en lecture seule a porté sur le diff stable `4f6f5c26..958d4c75`. Chaque constat a été
revérifié dans le code avant d'être corrigé.

### Constat 1, majeur, confirmé : un enregistrement du paramétrage laisse des annulations périmées

Déclencheur, sur un brouillon v1 : une action en lot, puis un enregistrement du paramétrage qui
change un montant (ici la marge), puis « Annuler ».

- Le serveur reprend chaque ligne au nouveau paramétrage (`prepareHistoricalSettings`,
  `src/lib/estimates/settings-atomic.ts`), et l'éditeur remplace ses lignes par celles qui lui
  sont confirmées. Rien ne vidait pourtant l'historique : sa portée est la version
  (`EstimateEditorPage.tsx`), et `clearHistory()` ne suit qu'un lot de lignes.
- Les commandes de l'historique gardent les lignes saisies avant l'action (`selectedLines`,
  `updatedLines`). Elles gardent aussi, par fermeture, le `computeVersionTotalsPatch` du rendu où
  l'action a eu lieu, donc l'ancien `savedSettings`.
- En v1, le serveur écrit le patch tel qu'il est envoyé. Il ne contrôle que HT + TVA = TTC
  (`assertEstimateTotalsInvariantForPatch`).

L'annulation des suggestions (`undoLastApply`) a la même forme. Elle relit le calcul courant,
mais remet des lignes chiffrées à l'ancien paramétrage, et son alerte survit à l'enregistrement.
Avant ce lot, les lignes restaurées étaient déjà périmées (défaut préexistant) ; ce lot y ajoutait
des totaux périmés.

Correction (`88854fcb`) : un enregistrement réussi du paramétrage vide l'historique
(`clearUndoRedoHistory`) et l'annulation des suggestions (nouvelle action `discardUndo` du
contrôleur). C'est la suite de la règle existante, qui vide déjà l'historique après un lot de
lignes. Le diff de `useEstimateEditorState.impl.tsx` se limite à 5 lignes : 2 appels, 2 lignes de
commentaire et 1 déstructuration. Les quatre lignes CRLF du fichier sont conservées.

Une autre correction a été écartée : relire le calcul courant par une référence, puis recalculer
les lignes au moment de l'annulation. `normalizeLine` lit le paramétrage en cours de saisie
(`settings`), et l'annulation de l'historique ne passe par aucune garde qui refuserait un
paramétrage non enregistré. Une annulation faite pendant une saisie de marge aurait écrit, en v1,
des lignes à la marge saisie et des totaux à la marge enregistrée. La forme retenue garde le
calcul enregistré pour les lignes comme pour les totaux.

Conséquence visible, en v1 comme en v2 : après un enregistrement du paramétrage, « Annuler » et
« Annuler les suggestions » ne sont plus offerts pour les actions antérieures. Aucun parcours
existant n'annule après un enregistrement du paramétrage. Le raccourci Ctrl+S de
`reconcileStoredTotals()` n'enregistre le paramétrage que s'il a des modifications en attente :
il n'en a aucune dans D2 ni dans S2.

Reste préexistant, non corrigé, aucun parcours ne l'atteint. Les fermetures périmées subsistent
dans deux cas :

- un rechargement de la même version, après qu'une autre session a changé son paramétrage ;
- une modification du taux d'un rôle, avant la sauvegarde qui vide l'historique.

### Constat 2, mineur, confirmé : le harnais isolé ne pouvait détecter aucun mauvais total

Les deux harnais remplaçaient `computeVersionTotalsPatch` par une constante. Contre les anciens
tests, deux mutations passaient :

- l'annulation des suggestions calculée sur les lignes courantes au lieu des lignes restaurées :
  20/20 verts ;
- les totaux du lot calculés sur les lignes d'avant l'écriture : 20/20 verts.

En v1, ces totaux sont les seuls que le serveur enregistre. Aucun parcours ne couvrait alors la
catégorie, le rôle MO, ni l'annulation et le rétablissement en v1.

Correction (`1eb299e0`). Le substitut additionne les lignes qu'il reçoit (`totalsOf`). Les
assertions portent sur :

- les lignes reçues, pour l'action, l'annulation et le rétablissement de la majoration, et pour
  ceux de la catégorie ;
- le patch exact, quatrième argument ;
- la préférence pour les totaux du serveur (`bulkResult.totals`) ;
- l'absence de totaux pour un déplacement.

Côté suggestions, elles portent sur les lignes de l'application, avec une ligne non sélectionnée,
et sur celles de l'annulation.

Ces tests ont été écrits après le code. Leur pouvoir de détection est donc établi par mutation,
chaque mutation étant retirée après son run. Cinq mutations rougissent les nouveaux tests :

- totaux du lot sur les lignes d'avant l'écriture : 3 rouges ;
- totaux du serveur ignorés : 1 rouge ;
- déplacement avec totaux : 1 rouge ;
- annulation des suggestions sur les lignes courantes : 1 rouge ;
- application des suggestions sur les lignes d'avant l'écriture : 4 rouges.

La lacune E2E v1 est aussi réduite par BT8.

### Constat 3, mineur, confirmé, préexistant, hors de ce lot

Les suppressions et les annulations de création passent par la route `DELETE`, qui n'écrit pas de
totaux. Voir l'inventaire, complété plus haut. Ce constat n'appelle aucune correction dans ce lot.

### Rapprochement avec `main`

`origin/main` avait avancé de `fc2ba2dc` à `91068850`. Il apporte les PR #34 (sous-lot 2.9,
unité d'achat, migration `20261017172127_supplier_offer_purchase_unit.sql`), #37 (`e190161a`) et
#38. La branche l'intègre par fusion, sans rebase (`85d684d7`), sans conflit. Les runs R4, R5, G3
et F3 portent sur cette tête fusionnée, et leur pile éphémère applique donc cette migration. Ce lot
n'ajoute aucune migration.

Pendant F3, `origin/main` a encore avancé, jusqu'à `89627add`. Il apporte `870e4d62`, `7393d941`
et `89627add` : l'import CSV du catalogue et l'attente du parcours US-4.1. Ces commits ne touchent
aucun fichier de ce lot : ni `src/hooks`, ni `e2e/army/critical`, ni `e2e/army/local`, ni
`e2e.config.ts`. Ils sont intégrés par une seconde fusion, sans conflit (`ad2f2c4e`).

### Preuves rouges (avant `88854fcb`)

Même environnement que plus haut. Les deux runs ajoutent temporairement les fichiers v1 à la liste
critical (`diffSha256` `7fbcd375…9bae`), retirée ensuite. Avant chaque run, le verrou des piles
natives est relu, en comptant les arbres de travail distincts : un autre run possédé au plus.
Commande :
`npm run e2e:army:local -- --grep "^V1BT0[123]\s|^V1PT01\s" --app-port 3151`.

| Run | Révision | Résultat | Preuves (sous `~/miaouffrage-totals-bulk/.e2e/army/ci`) |
| --- | --- | --- | --- |
| R4 | `a249a92b` | exit 1 ; V1BT01, V1PT01 verts. V1BT02 et V1BT03 rouges sur un défaut du parcours : le bouton de paramétrage du menu d'affichage est hors de la fenêtre en mode Expert. Leurs étapes d'avant l'enregistrement sont vertes. | `2026-10-18T00-05-56-659Z-critical` (`manifest.json` sha256 `3b5b47ad…d4dc`) |
| R5 | `09ac7776` (paramétrage ouvert par la barre de résumé) | exit 1 ; V1BT01, V1PT01 verts ; V1BT02 et V1BT03 rouges à l'oracle, à l'étape `after-margin` | `2026-10-18T00-11-39-100Z-critical` (`manifest.json` sha256 `ec68a4ad…1473`) |

R5, valeurs relues (`critical/artifacts/business/`) :

| Scénario | Étape | Attendu | Lignes | Version | Fichier (sha256) |
| --- | --- | --- | --- | --- | --- |
| BT8, V1BT02 | majoration, annulation, rétablissement | `[8000, 1600, 9600]`, `[6000, 1200, 7200]`, `[8000, 1600, 9600]` | égales | égales | `…-084d7dc5-v1-history-{majoration,undo,redo}-stored-totals.json` |
| BT9, V1BT02 | marge ×1,2 enregistrée | `[9600, 1920, 11520]` | `[9600, 1920, 11520]` | `[9600, 1920, 11520]` | `…-084d7dc5-v1-history-margin-saved-stored-totals.json` (`d2e6f28a…b8dd`) |
| BT9, V1BT02 | « Annuler » encore offert, exécuté | `[9600, 1920, 11520]` | `[6000, 1200, 7200]` | `[6000, 1200, 7200]` | `ARMY-1792282369791-084d7dc5-v1-history-after-margin-stored-totals.json` (`d8ab0bb1…f2f1`) |
| BT8, V1BT03 | application, annulation, nouvelle application | `[6600, 1320, 7920]`, `[6000, 1200, 7200]`, `[6600, 1320, 7920]` | égales | égales | `…-f1c3c37c-v1-suggestions-{apply,undo,reapply}-stored-totals.json` |
| BT9, V1BT03 | marge ×1,2 enregistrée | `[7920, 1584, 9504]` | `[7920, 1584, 9504]` | `[7920, 1584, 9504]` | `…-f1c3c37c-v1-suggestions-margin-saved-stored-totals.json` (`ade16265…f048`) |
| BT9, V1BT03 | « Annuler les suggestions » encore offert, exécuté | `[7920, 1584, 9504]` | `[6000, 1200, 7200]` | `[7200, 1440, 8640]` | `ARMY-1792282375539-f1c3c37c-v1-suggestions-after-margin-stored-totals.json` (`5adeda4b…8092`) |

Lecture du rouge :

- V1BT02 : la version reste à la marge ×1,2, mais l'annulation y écrit la ligne et les totaux
  d'avant la majoration à la marge ×1. Lignes = version, toutes deux fausses.
- V1BT03 : l'annulation remet la ligne chiffrée à ×1 et des totaux recalculés à ×1,2. Version ≠
  lignes.

### Preuves vertes (après `88854fcb`)

| Run | Révision | Commande | Résultat | Preuves (sous `~/miaouffrage-totals-bulk/.e2e/army/ci`) |
| --- | --- | --- | --- | --- |
| G3 | `88854fcb` (filtre temporaire `7fbcd375…9bae`) | `npm run e2e:army:local -- --grep "bulk edit sync\|bulk move persists\|commercial rounding\|^V1BT0[123]\s\|^V1PT01\s" --app-port 3151` | exit 0 ; 15/15 : setup, S1, S2, P1, D1 à D4, `bulk-move`, `commercial-rounding` 2/2, V1BT01 à V1BT03, V1PT01 (1 min 54 s de parcours) | `2026-10-18T00-16-58-935Z-critical` (`manifest.json` sha256 `94a4a236…a504`) |

G3, valeurs relues. Les étapes BT8 donnent les mêmes valeurs qu'en R5. Les autres :

| Scénario | Étape | Lignes = version | Fichier (sha256) |
| --- | --- | --- | --- |
| BT9, V1BT02 | marge ×1,2 enregistrée | `[9600, 1920, 11520]` | `ARMY-1792282790987-fed8d2c7-v1-history-margin-saved-stored-totals.json` (`c95244d3…c4e0`) |
| BT9, V1BT02 | après l'enregistrement (« Annuler » désactivé) | `[9600, 1920, 11520]` | `…-fed8d2c7-v1-history-after-margin-stored-totals.json` (`50048b1e…584e`) |
| BT9, V1BT02 | hub et liste : 96,00 € | `[9600, 1920, 11520]` | `…-fed8d2c7-v1-history-final-stored-totals.json` (`7e799c33…6024`) |
| BT9, V1BT03 | marge ×1,2 enregistrée | `[7920, 1584, 9504]` | `ARMY-1792282797140-7fed9718-v1-suggestions-margin-saved-stored-totals.json` (`664acf54…fd96`) |
| BT9, V1BT03 | après l'enregistrement (alerte masquée) | `[7920, 1584, 9504]` | `…-7fed9718-v1-suggestions-after-margin-stored-totals.json` (`df05f199…d781`) |
| BT9, V1BT03 | hub et liste : 79,20 € | `[7920, 1584, 9504]` | `…-7fed9718-v1-suggestions-final-stored-totals.json` (`31f31764…40bc`) |
| Témoins | D2 annulation, S2 annulation, P1, V1BT01, V1PT01 | `[5000, 1000, 6000]`, `[1000, 200, 1200]`, `[1234, 247, 1481]`, `[8000, 1600, 9600]`, `[3702, 740, 4442]` | inchangés depuis F2 |

Les assertions des parcours n'ont pas changé entre R5 et G3 : seul le code de l'éditeur a changé
(`09ac7776..88854fcb`, plus le test isolé `1eb299e0`). La branche de diagnostic, qui exécute
l'annulation encore offerte, n'est pas parcourue en G3, puisque l'annulation n'est plus offerte.
Les deux parcours v1 restaurent le mode initial `simplified`. V1BT03 désactive sa règle.

| Run | Révision | Commande | Résultat | Preuves (sous `~/miaouffrage-totals-bulk/.e2e/army/ci`) |
| --- | --- | --- | --- | --- |
| F3 | `88854fcb`, sans modification locale (`diffSha256` `e3b0c442…b855`) | `npm run e2e:army:ci -- full --app-port 3151` | exit 1 ; phase `full` 144/145 (11 min 45 s de parcours) : seul US-4.1 rouge (« Analyser » jamais activé, préexistant, corrigé sur `main` par `870e4d62` et `7393d941`). Verts : `bulk-edit-sync` 4/4, `bulk-edit-sync-sources` 3/3, `bulk-move`, `commercial-rounding` 2/2, `estimate-integrity` 5/5, `numeric-entry` 2/2, `numeric-entry-v3`, `settings-contracts` 2/2, V1BT01 à V1BT03, V1PT01. Phase `development` 4/4 | `2026-10-18T00-20-36-093Z-full` (`manifest.json` sha256 `9896bdb4…a2e9`) |
| G4 | `ad2f2c4e`, tête fusionnée avec `origin/main` `89627add` (filtre temporaire `7fbcd375…9bae`) | même commande que G3 | exit 0 ; 15/15 (1 min 54 s de parcours) | `2026-10-18T00-35-14-335Z-critical` (`manifest.json` sha256 `a9b134fc…7aba`) |

En F3 et en G4, chaque étape relue donne lignes = version aux valeurs exactes de G3. Pour V1BT02 :
`[8000, 1600, 9600]`, `[6000, 1200, 7200]`, `[8000, 1600, 9600]`, puis `[9600, 1920, 11520]` trois
fois. Pour V1BT03 : `[6600, 1320, 7920]`, `[6000, 1200, 7200]`, `[6600, 1320, 7920]`, puis
`[7920, 1584, 9504]` trois fois. Les témoins sont D1 `[7000, 1400, 8400]`, D2 et D4 aux valeurs de
F2, S1 `[1300, 260, 1560]`, S2 `[1000, 200, 1200]`, P1 `[1234, 247, 1481]`, V1BT01
`[8000, 1600, 9600]` et V1PT01 `[3702, 740, 4442]`. Exemples de fichiers :

- F3 : `ARMY-1792283428387-a0a3a0b1-v1-history-after-margin-stored-totals.json` (`16243db8…5432`) ;
- F3 : `ARMY-1792283434303-67835385-v1-suggestions-after-margin-stored-totals.json` (`f549709d…9d1e`) ;
- G4 : `ARMY-1792283883622-d113d17c-v1-history-after-margin-stored-totals.json` (`e720184a…97a4`) ;
- G4 : `ARMY-1792283889753-ba258f25-v1-suggestions-after-margin-stored-totals.json` (`28803caf…20c2`).

Journaux : `~/totals-bulk-logs/red-shipprep-run{1,2}.log`, `green-shipprep-critical.log` (G3),
`green-shipprep-full.log` (F3) et `green-shipprep-merged.log` (G4).

Contrôles statiques et isolés (worktree Windows, sur `88854fcb` puis sur la tête fusionnée
`ad2f2c4e`, mêmes résultats ; seule modification locale : ce document) :

- `npm run typecheck`, puis `npx eslint --max-warnings=0` sur les 12 fichiers `src/hooks`,
  `e2e` et `e2e.config.ts` du diff : exit 0 ;
- `npx vitest run src/hooks/useEstimateEditorBulkController.test.ts
  src/hooks/useEstimateEditorSuggestionsController.test.ts src/test/army-impact-map.test.ts
  src/test/ci-guardrails.test.ts` : 4 fichiers, 44 tests passés ;
- `npx vitest run src/lib/estimates/engine-frozen-corpus.test.ts
  src/lib/estimate-calculations.golden/v1.test.ts src/hooks` : 36 fichiers, 319 tests passés ;
- `npm run check:architecture` : 1 125 modules, 0 cycle ;
- `git diff fc2ba2dc` et `git diff origin/main` sur `src/lib/estimate-calculations.ts` et
  `src/lib/estimate-v2-snapshot.ts` : vides ;
- `git -c core.whitespace=cr-at-eol diff --check origin/main...HEAD` : propre ;
- `npm run verify:pr`, lancé dans le clone WSL sur `ad2f2c4e` sans modification locale
  (`diffSha256` `e3b0c442…b855`), sort en exit 0, chaîne complète :
  - `audit:dependencies` ;
  - `audit:signatures` : 762 signatures et 219 attestations vérifiées ;
  - `check:architecture` : 1 125 modules ;
  - `validate-openapi` : 144 routes, 192 opérations ;
  - `typecheck`, `lint` ;
  - `test:ci:node` : 296 fichiers passés et 1 ignoré, 2 808 tests passés et 2 ignorés ;
  - `test:ci:jsdom` : 164 fichiers et 824 tests ;
  - `test:critical-coverage` : 3 fichiers et 12 tests.

  Journal : `~/totals-bulk-logs/verify-pr-shipprep.log`.

Aucun nouveau parcours critical : les trois parcours v1 sont dans
`e2e/army/local/bulk-actions-v1-totals.e2e.ts`, de la sélection `full` (`e2e.config.ts`), comme
V1BT01. La carte d'impact (`scripts/tester-army/army-impact-map.json`) ne recense que les parcours
critical : elle est inchangée. La sélection de PR calculée contre `origin/main` est `full`, à cause
de `e2e.config.ts` (`select-journeys.ts`, « shared core »).

## Mode Expert du compte partagé (CI 39084774584)

### Défaillance observée

Run `army-critical` 39084774584 de la PR #41. Révision `5b30dae3`, fusion de PR de `f4ed8c3e`, sans
modification locale. Sélection complète, 2 workers. Résultat : 80/83, 3 échecs (rapport sha256
`3b352587…1eb8`) :

- S2 (`bulk-edit-sync-sources.e2e.ts`, « after their undo ») : l'`expect.poll` de `setUiMode`,
  ligne 61, attend « Simplifié » et lit « Expert » pendant 30 s ;
- `numeric-entry.e2e.ts:64` (« persists grouped settings ») : `estimate-editor-settings-button` reste
  « outside of the viewport » pendant 30 s ;
- `numeric-entry-v3.e2e.ts:38` : même symptôme, sur le même bouton.

Les écrans des deux échecs `numeric-entry` montrent la section « Contrôles avancés » dans le menu
d'affichage. Cette section n'existe qu'en mode Expert (`EstimateEditorCommandBar.tsx`,
`!isSimplifiedMode`). En Expert, à 1280×800, le bouton de paramétrage de ce menu sort de la fenêtre :
le run R4 l'avait déjà constaté. Ce n'est donc pas une régression de #41, ni de la barre d'outils, ni
de l'enregistrement du paramétrage : l'éditeur a été chargé en Expert.

### Chaîne causale

Sources : `report.json`, `artifacts/server-network.jsonl` et preuves `*-restored.json`. Le journal
réseau est celui du serveur Next, commun aux deux workers.

1. S2 tourne sur un worker de 49 à 116 s. Son corps passe. Au rétablissement, le parcours clique sur
   le commutateur à 01:04:13.45. Le libellé passe aussitôt à « Simplifié », mais c'est l'état
   optimiste de `useUiMode`. Le parcours recharge la page à 01:04:14.25, 0,8 s plus tard. Entre les
   deux, le serveur n'émet aucune requête `/rest/v1/profiles`. La suivante (01:04:14.390) part en même
   temps que `tenant_memberships` : c'est la lecture du layout rechargé (`getUserProfile`). L'action
   serveur `updateProfileUiMode` n'a donc jamais écrit. Dix rechargements en 30 s lisent « Expert »,
   et S2 échoue sans écrire `bulk-sync-s2-restored.json`. Au premier basculement du même parcours, à
   l'aller, la seule requête `profiles` isolée entre le clic (01:03:39.55) et le rechargement
   (01:03:40.45) part à 01:03:40.317. C'est vraisemblablement l'écriture, 0,13 s avant le
   rechargement : sous la charge de deux workers, la marge est faible. Le `poll` ne peut pas rattraper
   une écriture perdue : il recharge, mais ne reclique pas.
2. P1 (116–147 s) relève `initialMode: "Expert"` (`bulk-sync-p1-restored.json`). Il n'a donc rien à
   rétablir, et le compte partagé reste en Expert jusqu'à la fin du run.
3. `numeric-entry-v3` (461–510 s) et `numeric-entry` « paramétrage » (515–561 s) ouvrent le
   paramétrage par le menu d'affichage, en Expert : le bouton est hors de la fenêtre.
   `numeric-entry` « grid drafts » (502–515 s) n'ouvre pas ce menu et passe.

Aucun autre parcours du run n'écrit le mode. Le seul écrivain est le commutateur de `DashboardShell`,
et l'autre worker exécutait `bulk-edit-sync.e2e.ts`, qui n'y touche pas.

Le même état partagé fuit aussi sans écriture perdue, par simple concurrence. Ce second mécanisme se
reproduit en local, avant correction (tableau ci-dessous) : un parcours de l'autre worker charge
l'éditeur pendant que S1, S2 ou P1 tient le compte partagé en Expert. Les trois `*-restored.json` y
sont corrects.

### Cause

S1, S2 et P1 modifiaient un état du compte de campagne, partagé par les deux workers, alors que le
runner exécute les fichiers en parallèle (`e2e` 0.21 : « a file's tests run in order on one worker,
files run in parallel »). Le mode d'interface est enregistré sur `profiles.ui_mode`. Les parcours V1
qui basculent ce mode (V1PT01, V1BT01 à V1BT03) sont, pour cette raison, dans la sélection `full`,
exécutée par un seul worker. `bulk-edit-sync-sources`, lui, est dans la sélection critical à deux
workers.

### Correction (`7d1f9687`, `e2e/` seulement)

- Chaque parcours S1, S2 et P1 s'exécute sous son propre compte jetable, inscrit sur la pile possédée
  (`e2e/army/local/dedicated-owner.ts`, `signUpDedicatedOwner`). C'est le procédé de V3P01 pour sa
  politique de tenant : inscription par la clé anonyme, tenant renommé `ARMY BES <run>`, cookies de
  session remplacés dans ce seul contexte. Le profil est mis en Expert en SQL, dans la même
  transaction, par le propriétaire natif. Le parcours relit ensuite « Expert » dans le menu avant de
  commencer (`bulk-sync-<s1|s2|p1>-owner.json`). Le compte partagé n'est jamais modifié, et rien
  n'est rétabli.
- Chaque parcours vérifie en SQL que son devis appartient au compte et au tenant dédiés
  (`ownedEstimateContext`).
- La règle de suggestion naît dans le tenant du parcours. Sa désactivation de fin de parcours,
  devenue sans objet, est retirée, avec sa relance sur le verrou de brouillon.
- V3P01 réutilise la même inscription (`useDedicatedV3Owner` délègue, avec la même adresse et le même
  tenant `ARMY V3P <run>`). Seul ajout : la vérification que son profil reste au mode par défaut,
  `simplified`.

Aucune assertion métier, attente ou relance n'est ajoutée, et aucun parcours ne quitte la sélection.
Un groupe `describe({ serial: true })` ne suffisait pas : il ordonne ses membres sur un worker, mais
les autres fichiers continuent de tourner en parallèle, et `numeric-entry` y aurait encore vu le mode
Expert. Le runner n'a pas été modifié.

Limite : S1, S2 et P1 exigent désormais la pile possédée (`e2e:army:local`, `e2e:army:ci`). Sur une
pile non possédée, ils échouent fermés au lieu de basculer le compte partagé. P1 l'exigeait déjà pour
ses lectures du catalogue. La carte d'impact est inchangée : `bulk-edit-sync-sources` y est déjà un
parcours, et le graphe d'imports suit `dedicated-owner.ts`. Sur le seul diff `f4ed8c3e..7d1f9687`,
`select-journeys.ts` retient la connexion, `bulk-edit-sync-sources` et V3P01 ; la PR entière reste
`full` à cause d'`e2e.config.ts`. V1PT01 et V1BT01 à V1BT03 basculent
toujours le compte partagé en SQL, mais sous un seul worker, dans la sélection `full`.

### Preuves

Clone WSL `~/miaouffrage-totals-bulk`, Ubuntu 24.04, Node 24.19.0, `NODE_OPTIONS=--max-old-space-size=4096`,
`E2E_ARMY_WORKERS=2`, sans modification locale (`diffSha256` `e3b0c442…b855`). Commande :
`npm run e2e:army:local -- --grep "<filtre>" --app-port 3147`. Chaque run passe pgTAP et la matrice
RLS. Preuves sous `~/miaouffrage-totals-bulk/.e2e/army/ci/`, journaux sous `~/army-logs-totals-bulk/`.

| Run | Révision | Filtre | Résultat | Preuves (`manifest.json` sha256) |
| --- | --- | --- | --- | --- |
| E1, rouge | `f4ed8c3e` | `bulk edit sync\|numeric entry` | exit 1, 10/11. `numeric-entry-v3` démarre à 30,3 s, pendant que P1 (25,0–35,5 s) tient le compte partagé en Expert. Son écran porte « Contrôles avancés », et il échoue sur le bouton hors de la fenêtre. `numeric-entry`, lancé après le rétablissement de P1, passe. | `2026-10-18T01-24-11-195Z-critical` (`8b3c94ac…f3ab`) |
| E2, rouge | `f4ed8c3e` | `bulk edit sync (suggestions\|supplier)\|numeric entry` | exit 1, 6/7. `numeric-entry-v3` (1,5–35,4 s) recouvre S1, S2 et P1 et échoue de même. `numeric-entry` (33,4–47,2 s) arrive après le rétablissement et passe. | `2026-10-18T01-41-57-297Z-critical` (`918355fb…8ac2`) |
| G5 | `7d1f9687` | `bulk edit sync\|numeric entry` | exit 0, 11/11 | `2026-10-18T01-32-44-811Z-critical` (`47f2d458…c685`) |
| G6 | `7d1f9687` | idem | exit 0, 11/11 | `2026-10-18T01-35-29-987Z-critical` (`1760b172…44d8`) |
| G7 | `7d1f9687` | idem | exit 0, 11/11 | `2026-10-18T01-37-36-264Z-critical` (`d6b1f57d…6447`) |
| G8 | `7d1f9687` | filtre d'E2 | exit 0, 7/7. `numeric-entry-v3` (1,4–18,0 s) recouvre S1 et S2, et `numeric-entry` (18,0–31,8 s) recouvre P1. | `2026-10-18T01-39-52-560Z-critical` (`02ae204e…523a`) |
| G9 | `7d1f9687` | `^V3P01` | exit 0, 2/2 (connexion, V3P01) | `2026-10-18T01-44-02-441Z-critical` (`72593888…b387`) |
| G10 | `7d1f9687` | aucun (sélection critical complète, comme la CI) | exit 0, 83/83 (3 min 1 s de parcours) | `2026-10-18T01-45-35-053Z-critical` (`f760f229…7e7a`) |

En G5 à G8, chaque `bulk-sync-<s1|s2|p1>-owner.json` relève un compte et un tenant distincts, avec
`storedMode: "expert"` et `uiMode: "Expert"`. Les oracles métier de S1, S2 et P1 sont inchangés et
verts, en G10 aussi. Le filtre de G5 à G7 laisse les fichiers s'ordonner comme en E1 : `bulk-edit-sync-sources`,
plus court sans les rétablissements, se termine avant `numeric-entry-v3`. G8 est donc la preuve du
recouvrement.

Contrôles du worktree Windows sur `7d1f9687` : `npm run typecheck` ;
`npx eslint --max-warnings=0` sur les trois fichiers `e2e` touchés ;
`npx vitest run --project=node src/test/army-impact-map.test.ts src/test/ci-guardrails.test.ts`
(2 fichiers, 23 tests) ; `git diff --check`. Tous en exit 0.

### Revue de la correction (18/10/2026)

Relecture de `7d1f9687` et `285d7188` : quatre constats mineurs, vérifiés dans le code, tous confirmés.

1. **Pile hébergée.** `npm run e2e:army:critical` contre le Supabase hébergé reste un mode documenté.
   Sa sélection (`e2e/army/critical/**`) contient `bulk-edit-sync-sources` : S1 et S2, qui y passaient
   à un worker, y échouent désormais fermés, et le runbook ne le disait pas. Correction : un
   paragraphe dans [tester-army-critical.md](tester-army-critical.md) (« Execution and evidence »),
   et le message d'échec de `signUpDedicatedOwner` nomme les commandes de la pile possédée. Retirer
   le fichier de la sélection hébergée n'a pas été retenu : un parcours absent ne laisse aucune trace,
   alors qu'un échec fermé reste visible comme preuve manquante.
2. **Précondition implicite.** `numeric-entry` « paramétrage » et `numeric-entry-v3` supposaient le
   mode Simplifié sans le vérifier : une nouvelle fuite du mode Expert aurait de nouveau donné 30 s de
   « outside of the viewport » sur le bouton. Correction (`82277799`) : une fois le menu d'affichage
   ouvert, chaque parcours compte les régions « Contrôles avancés » et échoue sur le message
   « Precondition: the shared campaign account must be in Simplifié mode… ». C'est une lecture seule,
   sans requête, sans SQL (le parcours reste exécutable sur la pile hébergée) et sans
   redimensionnement de la fenêtre. Pas de garde statique dans `ci-guardrails.test.ts` : la politique
   de tests exclut les tests sur le texte des sources, et la précondition détecte la fuite à
   l'exécution.
3. **Document périmé.** [version-totals-after-preselection.md](version-totals-after-preselection.md)
   disait encore que `bulk-edit-sync-sources` bascule le compte partagé. Le paragraphe est corrigé.
4. **Défaut produit, hors de cette PR.** `useUiMode` affiche le nouveau mode avant la confirmation du
   serveur et ignore l'échec de `updateProfileUiMode` (`.catch(() => {})`). C'est ce qui a perdu le
   rétablissement de S2 dans la CI 39084774584. La PR reste limitée à `e2e/` : le défaut fait l'objet
   d'une tâche séparée (afficher le mode enregistré, ou annuler le mode optimiste avec un retour à
   l'utilisateur).

Preuves, même clone WSL et mêmes réglages que ci-dessus (2 workers, pgTAP et matrice RLS verts à
chaque run, aucune modification locale) :

| Run | Révision | Filtre | Résultat | Preuves (`manifest.json` sha256) |
| --- | --- | --- | --- | --- |
| P0, rouge | `8a58eb18`, commit local jetable : `f4ed8c3e` (anciens rétablissements) plus les deux fichiers `numeric-entry` de `82277799` | filtre d'E2 | exit 1, 5/7. `numeric-entry-v3` (1,5–6,2 s, pendant S1) et `numeric-entry` « paramétrage » (13,3–18,2 s, pendant S2) échouent en 5 s sur la précondition (`expected 1 to be 0`). Leurs écrans portent « Contrôles avancés ». Les trois `*-restored.json` sont corrects : la fuite vient de la seule concurrence. | `2026-10-18T02-14-33-261Z-critical` (`19dbd0be…8286`) |
| R1 | `82277799` | `bulk edit sync\|numeric entry` | exit 0, 11/11 | `2026-10-18T02-17-14-030Z-critical` (`b52d960d…743d`) |
| R2 | `82277799` | idem | exit 0, 11/11 | `2026-10-18T02-19-08-565Z-critical` (`55fd5dcd…a4c5`) |
| R3 | `82277799` | idem | exit 0, 11/11 | `2026-10-18T02-20-58-203Z-critical` (`c7c8b7f8…06d5`) |
| R4 | `82277799` | filtre d'E2 | exit 0, 7/7. `numeric-entry-v3` (1,3–17,4 s) recouvre S1 et S2, `numeric-entry` « paramétrage » (23,4–30,6 s) recouvre P1. | `2026-10-18T02-22-48-651Z-critical` (`e6e4ad94…753a`) |
| R5 | `82277799` | `^V3P01` | exit 0, 2/2 | `2026-10-18T02-24-24-998Z-critical` (`8ea05582…bc5d`) |
| R6 | `82277799` | aucun (sélection critical complète) | exit 0, 83/83 | `2026-10-18T02-25-42-040Z-critical` (`552931be…2d9c`) |

De R1 à R4 et en R6, chaque `bulk-sync-<s1|s2|p1>-owner.json` relève un compte et un tenant
distincts, avec `storedMode: "expert"` et `uiMode: "Expert"`. Le commit local P0 n'a jamais quitté
le clone WSL, et il a été supprimé après le run. Sur `285d7188..82277799`, `select-journeys.ts` retient
la connexion, `bulk-edit-sync-sources`, `numeric-entry`, `numeric-entry-v3` et V3P01. Contrôles du
worktree Windows : `npm run typecheck`, `npx eslint --max-warnings=0` sur les trois fichiers `e2e`
touchés, les tests `army-impact-map` et `ci-guardrails` (23 tests) et `git diff --check`, tous en
exit 0.
