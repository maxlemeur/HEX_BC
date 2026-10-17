# Totaux de version après la présélection fournisseurs

Défaut préexistant signalé le 17/10/2026 par la session Mac (parcours OZ01 de la
phase calc-v3 `offers`, `e2e/army/local/supplier-offer-zero-price.e2e.ts`) :
appliquer la présélection fournisseurs dans l'éditeur écrit les lignes (prix de
l'offre retenue, PR FO, `selected_supplier_price_id`) mais laisse
`estimate_versions.total_ht_cents`, `total_tax_cents` et `total_ttc_cents`
périmés en base jusqu'à une sauvegarde ultérieure. OZ01 lisait la version à
`[0, 0, 0]` juste après la présélection, puis `[7440, 1488, 8928]` après les
sauvegardes suivantes. La PR #25 ne l'a pas corrigé.

Périmètre : moteurs v1 et v2. Le chemin v3 relève du sous-lot 2.6.

## Défaillance observable

Les totaux enregistrés de la version alimentent la liste des affaires, le hub
de l'affaire (« HT version courante »), les approbations, Direction et les
documents. À chaque état validé, ils doivent être égaux aux lignes. Après
« Appliquer la sélection » dans « Présélection fournisseurs », et sans aucune
autre sauvegarde :

- l'API `GET /api/estimates/{id}` renvoie des lignes au nouveau prix et une
  version aux totaux d'avant ;
- le hub et la liste des affaires affichent l'ancien HT ;
- en v2, la barre de l'éditeur indique « Totaux à synchroniser » sans rien
  écrire (seul Ctrl+S réconcilie) ; en v1, rien ne le signale.

## Cause (lue sur `main` 9c426368)

1. `src/hooks/useEstimateEditorSupplierController.ts:648` : `apply()` appelle
   `bulkUpdateEstimateItems(targetVersionId, versionSnapshot.updated_at, updates)`
   sans quatrième argument `versionPatch`. Aucun total ne part avec les lignes.
   Ensuite, ligne 662, `setTotalsOutOfSync(false)` déclare les totaux
   synchronisés ; les `totals` éventuels de la réponse ne sont pas appliqués à
   la version de l'éditeur.
2. `src/lib/estimates/server.ts:6664-6665` : `shouldProjectDraft` ne vaut vrai
   que pour un moteur v2 en marge `tiered` ou avec un `versionPatch`. Sans
   patch, une v2 en marge non `tiered` et toute v1 ne passent pas par
   `projectDraftMutation` (server.ts:6027, réservé à la v2).
3. `src/lib/estimates/server.ts:6746-6752` : la RPC `bulk_update_estimate_items`
   reçoit alors `version_patch: null`. La fonction SQL n'écrit les totaux que si
   un patch est fourni ; aucun déclencheur ne les recalcule. Les lignes
   changent, l'en-tête de version non.

La sauvegarde ordinaire, elle, passe par `batchEstimateOperations` : le serveur
recalcule v1 et v2 (`src/lib/estimates/batch-preparation.ts:294`,
`calculateEstimateSnapshotForItems`) et écrit les totaux dans la même
transaction. C'est pourquoi la sauvegarde suivante « répare » les totaux.

### Même forme ailleurs (hors périmètre, non vérifié par un parcours)

Le même appel sans `versionPatch`, suivi de `setTotalsOutOfSync(false)`, se
trouve dans `useEstimateEditorBulkController.ts:116` (`applyBulkLineState` :
majoration, catégorie et rôle de main-d'œuvre en lot, annulation et
rétablissement) et dans `useEstimateEditorSuggestionsController.ts:985` et
`:1193` (application et annulation des suggestions en lot). Une correction
portée par le serveur les toucherait aussi ; une correction limitée à la
présélection les laisse en l'état. Décision à prendre avant la correction.

## Scénarios (rouges avant correction)

L'oracle est une lecture API unique, sans attente, juste après que la ligne
présélectionnée est relue en base : une attente laisserait une sauvegarde
ultérieure réconcilier les totaux et masquer le défaut. Les valeurs attendues
sont exactes, en centimes. Le contrôle commun est
`expectStoredTotalsMatchLines()` (`e2e/army/critical/version-totals-support.ts`) :
somme des lignes, totaux de la version, texte du hub (`#financial`, libellé en
capitales) et ligne de la liste des affaires filtrée par le nom du projet (mode
Expert, tableau dense en 1 280 px). Les valeurs relues sont enregistrées dans
`<préfixe>-<étape>-stored-totals.json` avant toute assertion.

| Défaillance observable | Scénario et oracle |
| --- | --- |
| T1. v2 (marge fixe) : totaux enregistrés périmés après la présélection | Parcours critical P1 « bulk edit sync supplier preselection saves a return to the article reference price » (`e2e/army/critical/bulk-edit-sync-sources.e2e.ts`) : brouillon créé par l'assistant (marge 0 %, TVA 20 %, sans arrondi), une ligne 1 u à 10,00 € liée à un article, offre à 12,34 €. Après « Appliquer la sélection » et la ligne relue à 1 234 c sur l'offre : lignes = version = `[1234, 247, 1481]` ; hub et liste : 12,34 €. Le parcours reprend ensuite l'éditeur comme avant. |
| T2. v1 historique : même défaut | OZ04, phase calc-v3 `offers` (`e2e/army/local/supplier-offer-zero-price.e2e.ts`) : brouillon v1 semé (`oz04`, marge 1, TVA 20 %, sans remise, totaux 0), une ligne « tube cuivre » de 2 ML à 0 €, propriétaire dédié en mode Expert. Après présélection (offre à 12,40 €, l'offre à 0 € non marquée exclue) : lignes = version = `[2480, 496, 2976]` ; hub et liste : 24,80 €. L'assistant ne crée que des v2 : ce chemin exige le brouillon semé. |
| T3. La correction change un autre montant | `src/lib/estimate-calculations.ts` et `src/lib/estimate-v2-snapshot.ts` restent sans modification ; les parcours existants qui figent des montants (`commercial-rounding`, OZ01–OZ03, `bulk-edit-sync`, `estimate-batch-atomic`, `estimate-totals-order`) restent verts. |

Non couvert : v2 en marge `tiered` (déjà projetée par le serveur), majoration
et suggestions en lot (voir plus haut), approbations, Direction et documents
(ils lisent les mêmes colonnes `estimate_versions.total_*`, non parcourus ici).

Commandes (clone WSL `~/miaouffrage-totals`, pile Supabase native possédée) :

```bash
npm run e2e:army:local -- --grep "supplier preselection saves a return" --app-port <port>
npm run e2e:army:calc-v3 -- --phase offers --grep "^OZ04\s" --app-port <port>
```
