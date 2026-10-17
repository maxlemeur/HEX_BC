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
présélection les laisse en l'état. Décision prise : la correction reste limitée
à la présélection (consigne « aucun montant d'un autre chemin ne change ») ; ces
actions gardent le défaut et relèvent d'un lot séparé.

## Correction (`0bc35c46`)

Correction dans l'éditeur, limitée à la présélection, par le chemin existant :

- `useEstimateEditorCalculation` expose `computePersistedTotals(items)` ;
  `persistedTotals` en est désormais le mémo. C'est le même calcul
  (`computeDraftBreakdown` sur le paramétrage enregistré), appliqué aux lignes
  sur le point d'être écrites.
- `apply()` (`useEstimateEditorSupplierController.ts`) calcule, avant
  l'écriture optimiste, les totaux de la version avec les lignes
  présélectionnées et les envoie comme `versionPatch` du même
  `bulkUpdateEstimateItems`. Si ces totaux ne sont pas calculables, l'action est
  refusée (« Impossible de calculer les totaux du devis. ») au lieu d'écrire des
  lignes sans leur en-tête.
- Serveur inchangé. En v2, la présence du patch fait passer par
  `projectDraftMutation` : le serveur recalcule tout le brouillon et écrit ses
  propres totaux, les valeurs du client étant ignorées (comme pour une marge
  `tiered`). En v1, `assertEstimateTotalsInvariantForPatch` contrôle le patch,
  puis la RPC l'écrit, comme les autres écritures de totaux de l'éditeur v1
  (`flushBufferedItemUpdates`). Lignes et totaux partent dans le même appel
  `bulk_update_estimate_items`, donc dans la même transaction.
- Les totaux confirmés (réponse du serveur en v2, patch envoyé en v1) sont
  appliqués à la version de l'éditeur (`applyVersionFlushResult`), qui ne
  garde donc plus d'en-tête différent de ses lignes. Le libellé « Totaux à
  synchroniser » n'est pas vérifié par un parcours.

Aucune migration, aucune modification SQL ni OpenAPI : rien à appliquer à la
base partagée. `src/lib/estimate-calculations.ts` et
`src/lib/estimate-v2-snapshot.ts` sont sans diff contre `main` 9c426368.

Écarté : passer la présélection par `batchEstimateOperations`. Ce chemin est
limité à 100 opérations par défaut (au plus 1 000 avec la variable
`ESTIMATE_BATCH_MAX_OPERATIONS`), alors que
la présélection écrit toutes ses lignes en une seule écriture atomique ; la
découper ferait perdre cette atomicité.

Limite connue : en v1, les totaux écrits sont ceux du calcul de l'éditeur, que
le serveur contrôle (cohérence HT + TVA = TTC) sans les recalculer. C'est le
contrat existant des écritures de totaux v1 ; la sauvegarde ordinaire suivante
(`batchEstimateOperations`) les recalcule côté serveur.

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

## Preuves rouges (17/10/2026, avant correction)

WSL Ubuntu 24.04, Node 24.14.0, Supabase CLI natif 2.120.0, clone Linux
`~/miaouffrage-totals`, révision `1479970b` (branche
`fix/version-totals-after-preselection`), aucune modification locale
(`diffSha256` vide). Chaque run démarre sa propre pile éphémère : pgTAP
17 fichiers / 1 714 assertions et matrice RLS passés, build possédé, puis le
parcours. Journaux : `~/totals-logs/red-critical.log`,
`~/totals-logs/red-offers-v1.log`.

| Run | Commande | Résultat | Preuves (sous `~/miaouffrage-totals`) |
| --- | --- | --- | --- |
| T1, v2 | `npm run e2e:army:local -- --grep "supplier preselection saves a return" --app-port 3141` | setup vert, P1 rouge : `stored version totals right after the write, without any other save: expected [1000,200,1200] to equal [1234,247,1481]` | `.e2e/army/ci/2026-10-17T18-24-45-029Z-critical` (`manifest.json` sha256 `67dc849d…2354`) ; `critical/artifacts/business/ARMY-1792261589089-739ad35e-bulk-sync-p1-preselection-stored-totals.json` (sha256 `8c0f4c59…55ec`) |
| T2, v1 | `npm run e2e:army:calc-v3 -- --phase offers --grep "^OZ04\s" --app-port 3142` | setup vert, OZ04 rouge : `expected [0,0,0] to equal [2480,496,2976]` | `.e2e/army/ci/2026-10-17T18-27-08-015Z-calc-v3` (`manifest.json` sha256 `6c426ba0…ddd9`) ; `offers/business/ARMY-1792261692024-6d1a5850-oz04-stored-totals.json` (sha256 `919ff7df…261f`) |

Valeurs relues dans la même lecture, avant toute autre sauvegarde :

| Run | Lignes (HT, TVA, TTC) | Version enregistrée | Hub « HT version courante » | Liste des affaires |
| --- | --- | --- | --- | --- |
| T1, v2 (`791abb01…`, marge `fixed`) | `[1234, 247, 1481]` | `[1000, 200, 1200]` | 10,00 € | 10,00 € |
| T2, v1 (`4c990711…`, marge `fixed`) | `[2480, 496, 2976]` | `[0, 0, 0]` | 0,00 € | 0,00 € |

Les lignes sont justes et égales aux valeurs attendues : seul l'en-tête de
version est périmé, et le hub comme la liste affichent l'ancien HT. Le parcours
s'arrête à la première assertion fausse (version) ; le hub et la liste sont
lus et enregistrés avant elle.

## Preuves vertes (17/10/2026, après correction)

Révision `0bc35c46` (correction), aucune modification locale (`diffSha256`
vide), clone WSL `~/miaouffrage-totals`, Supabase CLI natif 2.120.0, Node
24.14.0 (comme les preuves rouges) sauf le premier run T1, en 24.19.0. Chaque
run démarre sa propre pile éphémère : pgTAP et matrice RLS passés, build
possédé, puis les parcours. Runs successifs, jamais plus de deux piles natives
en même temps sur la machine. Journaux : `~/totals-logs/green-*.log`.

| Run | Commande | Résultat | Preuves (sous `~/miaouffrage-totals/.e2e/army/ci`) |
| --- | --- | --- | --- |
| T1, v2 | `npm run e2e:army:local -- --grep "supplier preselection saves a return" --app-port 3141` (Node 24.19.0) | exit 0 ; setup + P1 : 2/2 | `2026-10-17T18-40-40-264Z-critical` (`manifest.json` sha256 `4ecba586…7cfa`) ; `critical/artifacts/business/ARMY-1792262514510-597912ee-bulk-sync-p1-preselection-stored-totals.json` (sha256 `14ab3047…df0f`) |
| T2, v1 | `npm run e2e:army:calc-v3 -- --phase offers --grep "^OZ04\s" --app-port 3142` | exit 0 ; setup + OZ04 : 2/2 | `2026-10-17T18-42-58-992Z-calc-v3` (`manifest.json` sha256 `279b8bea…413c`) ; `offers/business/ARMY-1792262645021-01af01a4-oz04-stored-totals.json` (sha256 `ee455005…75a0`) |
| T3, phase `offers` complète | `npm run e2e:army:calc-v3 -- --phase offers --app-port 3142` | exit 0 ; setup + OZ01–OZ04 : 5/5, compte attendu de la phase | `2026-10-17T18-45-10-418Z-calc-v3` (`manifest.json` sha256 `ded8c331…9646`) |
| T3, suite critical complète | `npm run e2e:army:local -- --app-port 3141` | exit 0 ; 24 fichiers, 81 tests passés, aucun ignoré (dont `bulk-edit-sync-sources` 3/3, `bulk-edit-sync` 3/3, `commercial-rounding` 2/2, `estimate-integrity` 5/5, `stale-save`, `engine-v3-fail-closed`, `tech-debt-lock-boundaries`) | `2026-10-17T18-51-27-067Z-critical` (`manifest.json` sha256 `0430182e…2119`) ; P1 : `critical/artifacts/business/ARMY-1792263194512-ba8d4321-bulk-sync-p1-preselection-stored-totals.json` (sha256 `4d3ddb21…8b5e`) |
| T3, phase `journeys` complète | `npm run e2e:army:calc-v3 -- --phase journeys --app-port 3142` | exit 0 ; 6 fichiers, 11 tests passés, comptes attendus de la phase (`commercial-rounding` 2, `dpgf-import` 3, `estimate-totals-order` 1, `estimate-create-atomic` 3, `estimate-batch-atomic` 1, setup 1) | `2026-10-17T19-00-49-181Z-calc-v3` (`manifest.json` sha256 `46a3c0e6…cb76`) |

Valeurs relues dans la même lecture, juste après la présélection et sans autre
sauvegarde :

| Run | Lignes (HT, TVA, TTC) | Version enregistrée | Hub « HT version courante » | Liste des affaires |
| --- | --- | --- | --- | --- |
| T1, v2 (`bfccae0b…`, marge `fixed`) | `[1234, 247, 1481]` | `[1234, 247, 1481]` | 12,34 € | 12,34 € |
| T1, v2, suite complète (`1967cf7a…`) | `[1234, 247, 1481]` | `[1234, 247, 1481]` | 12,34 € | 12,34 € |
| T2, v1 (`1121bec8…`, marge `fixed`) | `[2480, 496, 2976]` | `[2480, 496, 2976]` | 24,80 € | 24,80 € |

Les assertions des parcours n'ont pas changé entre le rouge et le vert : seul
le code de l'éditeur a changé (`565e213d..0bc35c46`). Dans la phase `offers`
complète, OZ01 enregistre maintenant la version à `[2480, 496, 2976]` juste
après la présélection (`oz01-preselection-persisted`, au lieu de `[0, 0, 0]`
relevé par la session Mac), puis `[7440, 1488, 8928]` après les sauvegardes
suivantes, comme avant. Le commentaire de `waitForPersisted`
(`supplier-offer-zero-price.e2e.ts`), qui décrivait le défaut comme connu, a
été mis à jour après ces runs : modification de commentaire seulement.

Non exécuté : US-4.4 (`e2e/army/takeoff/team-b-user-stories.e2e.ts`) applique
aussi la présélection (puis prépare les bons de commande, sans lire les totaux
de version). Il ne tourne que dans la suite `full`, que le runner refuse de
filtrer ; il relève de la campagne nocturne.

Contrôles statiques et isolés (worktree Windows, contenu de `0bc35c46` ; pour
la chaîne `verify:pr`, seule modification locale : ce document) :

- `npx eslint --max-warnings=0` sur les quatre fichiers touchés, `npm run
  typecheck`, `npm run check:architecture` (1 116 modules, 0 cycle),
  `npm run validate-openapi`, `npm run lint` : exit 0 ;
- `npx vitest run src/hooks/useEstimateEditorSupplierController.test.ts
  src/lib/estimates/engine-frozen-corpus.test.ts
  src/lib/estimate-calculations.golden/v1.test.ts` : 3 fichiers, 35 tests
  passés ; `npx vitest run src/hooks` : 35 fichiers, 292 tests passés ;
- `npm run test:ci:node` (294 fichiers passés, 1 ignoré ; 2 770 tests passés,
  3 ignorés), `npm run test:ci:jsdom` (162 fichiers, 821 tests),
  `npm run test:critical-coverage` (3 fichiers, 12 tests) : exit 0 ;
- `npm run verify:pr` s'arrête sous Windows à `audit:signatures` sur une
  erreur `ENOENT` du cache npm local (`_cacache`), sans lien avec ce lot ;
  `audit:dependencies` passe sous Windows et `npm run audit:signatures` passe
  dans le clone WSL (762 signatures, 219 attestations vérifiées). Les autres
  étapes de la chaîne ont été lancées une par une, ci-dessus ;
- `git diff 9c426368 -- src/lib/estimate-calculations.ts
  src/lib/estimate-v2-snapshot.ts` : vide.
