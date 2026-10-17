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
sont exactes, en centimes. Les contrôles communs sont dans
`e2e/army/critical/version-totals-support.ts` :

- `expectStoredTotals()` : somme des lignes et totaux de la version, par une
  lecture API, sans navigation. L'éditeur reste monté et le parcours peut
  continuer dans la même session ;
- `expectStoredTotalsMatchLines()` : la même lecture, puis le texte du hub
  (`#financial`, libellé en capitales) et la ligne de la liste des affaires
  filtrée par le nom du projet (mode Expert, tableau dense en 1 280 px). Il
  quitte l'éditeur : seulement en dernière étape d'un parcours.

Les valeurs relues sont enregistrées dans
`<préfixe>-<étape>-stored-totals.json` avant toute assertion.

| Défaillance observable | Scénario et oracle |
| --- | --- |
| T1. v2 (marge fixe) : totaux enregistrés périmés après la présélection | Parcours critical P1 « bulk edit sync supplier preselection saves a return to the article reference price » (`e2e/army/critical/bulk-edit-sync-sources.e2e.ts`) : brouillon créé par l'assistant (marge 0 %, TVA 20 %, sans arrondi), une ligne 1 u à 10,00 € liée à un article, offre à 12,34 €. Après « Appliquer la sélection » et la ligne relue à 1 234 c sur l'offre : lignes = version = `[1234, 247, 1481]`, par `expectStoredTotals()`. Le parcours continue ensuite dans la même session de l'éditeur, comme avant : quitter puis rouvrir l'éditeur reconstruirait sa référence de synchronisation depuis le serveur et masquerait l'absence de `markItemsSynced()`, que P1 garde (`cd73c05a`, voir « Revue indépendante »). Première forme (`1479970b` à `7710946e`) : hub et liste à 12,34 €, puis réouverture de l'éditeur. |
| T2. v1 historique : même défaut | OZ04, phase calc-v3 `offers` (`e2e/army/local/supplier-offer-zero-price.e2e.ts`) : brouillon v1 semé (`oz04`, marge 1, TVA 20 %, sans remise, totaux 0), une ligne « tube cuivre » de 2 ML à 0 €, propriétaire dédié en mode Expert. Après présélection (offre à 12,40 €, l'offre à 0 € non marquée exclue) : lignes = version = `[2480, 496, 2976]` ; hub et liste : 24,80 €. L'assistant ne crée que des v2 : ce chemin exige le brouillon semé. |
| T2 bis. v1 historique, dans une suite qu'un workflow lance | V1PT01 (`e2e/army/local/supplier-preselection-v1-totals.e2e.ts`, sélection `full`) : projet créé par `POST /api/estimates` (sa v2 reste la version 1), brouillon v1 inséré en version 2 par le propriétaire natif (`postgres`) de la pile possédée, comme `engine-v3-fail-closed` (marge fixe ×1, TVA 20 %, sans remise ni arrondi), une ligne de 3 u à 10,00 € liée à un article, totaux semés cohérents `[3000, 600, 3600]` ; offre à 12,34 €. Après présélection : lignes = version = `[3702, 740, 4442]` (TVA 740,4 c arrondie à 740) ; hub et liste : 37,02 €. Le profil du compte partagé passe en mode Expert par SQL, puis reprend son mode initial. |
| T3. La correction change un autre montant | `src/lib/estimate-calculations.ts` et `src/lib/estimate-v2-snapshot.ts` restent sans modification ; les parcours existants qui figent des montants (`commercial-rounding`, OZ01–OZ03, `bulk-edit-sync`, `estimate-batch-atomic`, `estimate-totals-order`) restent verts. |

Non couvert : v2 en marge `tiered` (déjà projetée par le serveur), majoration
et suggestions en lot (voir plus haut), approbations, Direction et documents
(ils lisent les mêmes colonnes `estimate_versions.total_*`, non parcourus ici).

Commandes (clone WSL `~/miaouffrage-totals`, pile Supabase native possédée) :

```bash
npm run e2e:army:local -- --grep "supplier preselection saves a return" --app-port <port>
npm run e2e:army:calc-v3 -- --phase offers --grep "^OZ04\s" --app-port <port>
# V1PT01 n'appartient qu'à la sélection full, que le runner ne filtre pas :
npm run e2e:army:ci -- full --app-port <port>
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

Non exécuté à ce stade : US-4.4 (`e2e/army/takeoff/team-b-user-stories.e2e.ts`)
applique aussi la présélection (puis prépare les bons de commande, sans lire
les totaux de version). Il ne tourne que dans la suite `full`, que le runner
refuse de filtrer. Il a été exécuté, vert, pendant la revue (G2 et G3, plus bas).

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

## Revue indépendante (17/10/2026)

Deux constats, vérifiés puis corrigés (`f2b297dc`, commentaire `ebcbb74d`).
`origin/main` (`2c2fa286`, documentation seulement) a été fusionné avant
(`0285a745`).

1. **Majeur, confirmé par lecture du code.** Le contrôle des totaux ajouté à P1 par `1479970b`
   ouvrait le hub puis la liste, et P1 rouvrait ensuite l'éditeur. P1 est le
   seul parcours qui garde `cd73c05a` : après la présélection,
   `markItemsSynced(updates)` doit rafraîchir la référence de synchronisation
   en mémoire (`syncedItemPayloadsRef`, `useEstimateEditorSyncController.ts`),
   sinon la réassociation à `{1000, null}` est jugée déjà synchronisée par
   `enqueueItemUpdate()` et ignorée. Au chargement, `overlayPendingUpdates()`
   reconstruit cette référence depuis le serveur : avec la réouverture, la
   suite de P1 passait même sans `markItemsSynced(updates)`. Correction : P1
   lit les totaux par `expectStoredTotals()`, sans navigation, et ne rouvre
   plus l'éditeur. Son diff contre `main` se limite à cette lecture. Sans
   `markItemsSynced(updates)`, cette forme est rouge (R2). Le hub et
   la liste restent vérifiés sur le chemin v1 (OZ04, V1PT01) : ils lisent la
   même colonne `total_ht_cents` quel que soit le moteur.
2. **Mineur, confirmé** (`e2e.config.ts`, workflows). OZ04, seul garde du chemin v1, n'est que dans la
   phase calc-v3 `offers`, qu'aucun workflow ne lance. Correction : V1PT01
   (T2 bis), même chemin v1, ajouté à la sélection `full` de `e2e.config.ts`,
   lancée chaque nuit par `e2e-army-full.yml`. V1PT01 n'est pas dans la
   sélection critical : il bascule le profil du compte partagé en mode Expert,
   comme `bulk-edit-sync-sources`. La CI critical lance 2 workers, donc des
   fichiers en parallèle : la restauration du mode par l'un ferait échouer
   l'autre. La suite `full` nocturne tourne à 1 worker. La carte d'impact ne
   change pas (elle ne liste que la sélection critical) ; la modification de
   `e2e.config.ts` sélectionne la suite critical complète sur la PR.

### Couverture CI du correctif

| Chemin | Garde | Exécution |
| --- | --- | --- |
| v2, marge fixe | P1 (`critical/bulk-edit-sync-sources`), lecture API | CI critical (PR selon la carte d'impact, push sur `main`) et suite `full` nocturne |
| v1 historique | V1PT01 (`local/supplier-preselection-v1-totals`), API, hub et liste | suite `full` nocturne seulement : une régression v1 n'arrête pas une PR, elle apparaît la nuit suivante |
| v1 historique | OZ04 (`local/supplier-offer-zero-price`), API, hub et liste | phase calc-v3 `offers`, à la main (`npm run e2e:army:calc-v3 -- --phase offers`) ; aucun workflow |

### Preuves (rouge puis vert)

WSL Ubuntu 24.04, Node 24.14.0, Supabase CLI natif 2.120.0. Chaque run démarre
sa propre pile éphémère (pgTAP et matrice RLS passés), build possédé, puis les
parcours. Jamais plus de deux piles natives à la fois sur la machine.
Journaux : `~/totals-logs/review-*.log`.

| Run | État (clone, révision, modifications locales) | Commande | Résultat | Preuves |
| --- | --- | --- | --- | --- |
| R1, rouge sans la correction | `~/miaouffrage-totals`, `f2b297dc` ; les quatre fichiers `src/hooks` de la correction ramenés à `565e213d` (identiques à `main` 9c426368) et V1PT01 ajouté pour ce run à la liste critical `localBusiness` de `e2e.config.ts`, pour le filtrer (`diffSha256` `690653d2…80d0`) | `npm run e2e:army:local -- --grep "supplier preselection saves a return\|^V1PT01\s" --app-port 3141` | exit 1 ; setup vert ; P1 rouge : `stored version totals right after the write, without any other save: expected [1000,200,1200] to equal [1234,247,1481]` ; V1PT01 rouge : `expected [3000,600,3600] to equal [3702,740,4442]` | `.e2e/army/ci/2026-10-17T19-35-19-992Z-critical` (`manifest.json` sha256 `dfd1366a…46be`) ; `ARMY-1792265791508-6c7e0d63-bulk-sync-p1-preselection-stored-totals.json` (sha256 `ba28cce2…5950`) ; `ARMY-1792265799172-f7070bdc-v1-preselection-stored-totals.json` (sha256 `fb3fb817…0ed5`) |
| R2, rouge sans `markItemsSynced(updates)` | `~/miaouffrage-totals`, `f2b297dc` ; seule modification : la ligne `markItemsSynced(updates);` retirée d'`apply()` (`useEstimateEditorSupplierController.ts`, `diffSha256` `9fcdcf3f…d891`) | `npm run e2e:army:local -- --grep "supplier preselection saves a return" --app-port 3141` | exit 1 ; setup vert ; P1 : totaux justes `[1234, 247, 1481]`, puis rouge à la réassociation (`waitForAutoSave`, `expected false to be true`) : le serveur garde `1234` et l'offre, la cellule affiche `10.00`, la barre « Totaux à synchroniser » | `.e2e/army/ci/2026-10-17T19-37-55-088Z-critical` (`manifest.json` sha256 `147f4624…396e`) ; `…-bulk-sync-p1-preselection-stored-totals.json` (sha256 `3c5d7722…321e`) ; `ARMY-1792265942153-9ca562c7-bulk-sync-p1-reassociate-reference.json` (sha256 `4ce96eb2…bb78`) |
| G1, vert P1 | `~/miaouffrage-totals`, `ebcbb74d`, aucune modification locale (`diffSha256` `e3b0c442…b855`, empreinte du diff vide) | `npm run e2e:army:local -- --grep "supplier preselection saves a return" --app-port 3141` | exit 0 ; setup + P1 : 2/2 ; lignes = version = `[1234, 247, 1481]` ; réassociation enregistrée `{1000, null}`, cellule `10.00`, statut « Sauvegardé » | `.e2e/army/ci/2026-10-17T19-44-01-435Z-critical` (`manifest.json` sha256 `282e5d90…1df5`) ; `ARMY-1792266316039-1ff87388-bulk-sync-p1-preselection-stored-totals.json` (sha256 `b216a2ca…1515`) ; `…-bulk-sync-p1-reassociate-reference.json` (sha256 `f76afac5…f6d2`) |
| G2, suite `full` (1er run) | `~/miaouffrage-totals-full` (clone Linux propre de la branche, `npm ci`), `ebcbb74d`, aucune modification locale | `npm run e2e:army:ci -- full --app-port 3143` (1 worker, 13 min 51 s) | exit 1 ; phase `full` 139/140 : V1PT01 vert (lignes = version = `[3702, 740, 4442]`, hub et liste 37,02 €, mode initial `simplified` restauré), `bulk-edit-sync-sources` 3/3 (P1 `[1234, 247, 1481]`), US-4.4 vert ; US-4.1 rouge (ci-dessous) ; phase `development` 4/4 | `~/miaouffrage-totals-full/.e2e/army/ci/2026-10-17T19-41-21-886Z-full` (`manifest.json` sha256 `242e4ae0…d611`) ; `full/artifacts/business/ARMY-1792266719072-2aa40bde-v1-preselection-stored-totals.json` (sha256 `6ff1c3b3…8c56`) ; P1 `ARMY-1792266209917-bdfe70e8-bulk-sync-p1-preselection-stored-totals.json` (sha256 `23df05d4…d7f1`) |
| G3, suite `full` (2e run) | idem G2 | idem G2 (13 min 24 s) | exit 1 ; mêmes résultats : 139/140, V1PT01 vert (`[3702, 740, 4442]`, hub et liste 37,02 €), `bulk-edit-sync-sources` 3/3, US-4.4 vert, US-4.1 rouge ; phase `development` 4/4 | `~/miaouffrage-totals-full/.e2e/army/ci/2026-10-17T19-57-03-931Z-full` (`manifest.json` sha256 `6ee37a99…a642`) ; `full/artifacts/business/ARMY-1792267639577-2ed38e19-v1-preselection-stored-totals.json` (sha256 `485a309c…2516`) |
| D1, US-4.1 seul sur la branche | `~/miaouffrage-totals`, `ebcbb74d` ; seule modification : `team-b-user-stories` ajouté pour ce run à la liste critical `localBusiness`, pour le filtrer (`diffSha256` `e755179b…e5e5`) | `npm run e2e:army:local -- --grep "US-4.1 keeps supplier CSV" --app-port 3141` | exit 1 ; US-4.1 rouge, sans V1PT01 avant lui | `.e2e/army/ci/2026-10-17T20-12-51-683Z-critical` (`manifest.json` sha256 `a3ca2f03…b62a`) |
| B1, suite `full` sur `main` (référence) | `~/miaouffrage-totals-full`, `origin/main` `2c2fa286`, aucune modification locale | `npm run e2e:army:ci -- full --app-port 3143` (12 min 38 s) | exit 0 ; phase `full` 139/139 (US-4.1 vert), phase `development` 4/4 | `~/miaouffrage-totals-full/.e2e/army/ci/2026-10-17T20-11-40-573Z-full` (`manifest.json` sha256 `a9f2fe4c…e1ff`) |
| D2, US-4.1 seul sur `main` | `~/miaouffrage-totals-full`, `2c2fa286` ; même ajout temporaire de `team-b-user-stories` à la liste critical (`diffSha256` `07761466…7b58`) | `npm run e2e:army:local -- --grep "US-4.1 keeps supplier CSV" --app-port 3143` | exit 1 ; US-4.1 rouge, même erreur | `~/miaouffrage-totals-full/.e2e/army/ci/2026-10-17T20-26-15-376Z-critical` (`manifest.json` sha256 `be1ec32b…71a9`) |
| D3, US-4.1 seul sur la branche sans la correction | `~/miaouffrage-totals`, `ebcbb74d` ; même ajout temporaire, et les quatre fichiers `src/hooks` de la correction ramenés à `9c426368` (`diffSha256` `6c2fe270…895a`) | idem D1 | exit 1 ; US-4.1 rouge, même erreur | `.e2e/army/ci/2026-10-17T20-27-01-064Z-critical` (`manifest.json` sha256 `d3d1e8c3…5f4e`) |

US-4.1 (`e2e/army/takeoff/team-b-user-stories.e2e.ts`, import CSV de prix
fournisseurs sur `/dashboard/affaires/{id}/prices`) a échoué dans les deux
suites `full` de la branche et est passé dans la suite `full` de `main` (B1).
Il échoue pourtant aussi seul sur `main` (D2) et sur la branche sans la
correction (D3) : ce n'est pas un effet de ce lot, dont le diff ne touche ni
cette page ni `PriceBookUploadStep`. Cause probable, lue dans les rapports :
une course à l'hydratation dans le parcours. Il appelle `setInputFiles` dès que le titre
« Prix fournisseurs », rendu par le serveur, est visible. Dans les runs
rouges, ce titre est visible en 24 à 27 ms et « Analyser » n'apparaît côté
client que 109 à 111 ms plus tard : le fichier est posé avant que React ne
branche `onChange`, « Analyser » et « Vider » restent désactivés. Dans le run
vert de B1, le titre met 340 ms et « Analyser » est cliquable aussitôt.
Défaut préexistant du parcours, hors de ce lot : il reste à attendre
l'hydratation de l'étape d'import avant `setInputFiles`. Les assertions de
ce lot (P1, V1PT01, US-4.4) sont vertes dans les deux suites `full`.
