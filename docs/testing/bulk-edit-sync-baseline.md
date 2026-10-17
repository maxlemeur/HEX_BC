# Saisie ignorée après une action en lot (référence de synchronisation)

Défaut préexistant relevé le 16/10/2026 pendant l'intégration du sous-lot 2.3
(branche `lot2/2.3-saisie-import`, parcours `numeric-entry-v3`, étape 6 dans sa
première forme) : après « Modifier les attributs » > « Majoration MO (%) » à
150 % sur une ligne sélectionnée, la cellule de grille de cette ligne ramenée à
la valeur d'avant le lot n'est jamais enregistrée. La grille affiche la nouvelle
valeur, le statut indique « À jour », le serveur garde le coefficient du lot ;
au rechargement, l'utilisateur retrouve 150 %. Archive d'origine (clone WSL
`~/miaouffrage-2-3`) : `.e2e/army/ci/2026-10-16T15-27-43-620Z-critical`,
`h_mo_majoration` resté à 1,5 pendant 15 s après la saisie.

## Cause lue dans le code (avant correction)

`useEstimateEditorSyncController` conserve, par ligne, le dernier état connu du
serveur (`syncedItemPayloadsRef`). `enqueueItemUpdate()` abandonne toute saisie
identique à cette référence : elle est réputée déjà enregistrée. La référence
n'est remise à jour qu'au chargement des lignes et après une sauvegarde
ordinaire. `applyBulkLineState()` (`useEstimateEditorBulkController`) écrit les
lignes par `bulkUpdateEstimateItems()` sans la mettre à jour : elle garde l'état
d'avant le lot, et une saisie qui y revient est ignorée. La majoration, la
catégorie et le rôle de main-d'œuvre en lot, ainsi que l'annulation et le
rétablissement de ces actions, passent tous par cette fonction.

## Défaillances observables et scénarios

| Défaillance observable | Scénario et oracle |
| --- | --- |
| D1. Après un lot, la saisie de la valeur d'avant le lot est ignorée | Ligne ARMY à ×1. Lot « Majoration MO (%) » 150 → API `h_mo_majoration` 1,5, cellule « 150 ». Cellule « 100 », Tab, Ctrl+S → API 1, statut « Sauvegardé » ou « À jour » ; après rechargement, cellule « 100 » et API 1. Rouge avant correction. |
| D2. Même perte après annulation puis rétablissement du lot | Lot 150 → 1,5 ; « Annuler » → 1 ; « Rétablir » → 1,5, cellule « 150 ». Cellule « 100 », Tab, Ctrl+S → API 1 ; rechargement → « 100 ». Rouge avant correction : la référence est restée à ×1. |
| D3. Après annulation du lot, la saisie de la valeur du lot est ignorée | Lot 150 → 1,5 ; « Annuler » → 1, cellule « 100 ». Cellule « 150 », Tab, Ctrl+S → API 1,5 ; rechargement → « 150 ». Vert avant correction (la référence périmée vaut ×1 par hasard) ; rouge pour une correction qui ne rafraîchirait la référence qu'à l'application du lot. |
| D4. Catégorie et rôle de main-d'œuvre en lot : retour à la valeur antérieure ignoré | Même fonction `applyBulkLineState()` que D1–D3. Pas de parcours dédié : la correction porte sur la fonction partagée, et non sur la majoration. Limite assumée. |
| D5. La correction efface à tort une saisie en attente | Seules les lignes que le lot a effectivement enregistrées reçoivent la nouvelle référence. Une saisie en attente n'est retirée que si elle est identique, champ par champ, à ce que le serveur vient d'accepter (règle existante `pruneSyncedBufferedUpdates`). Garanti par construction ; aucun test isolé ajouté. |
| D6. Un lot refusé (conflit, erreur, changement de version ou de portée) modifie la référence | La référence n'est mise à jour qu'après une réponse réussie et dans la portée courante ; sinon l'état serveur est inchangé et l'ancienne référence reste juste. Garanti par construction. |

Les parcours D1 à D3 sont dans `e2e/army/critical/bulk-edit-sync.e2e.ts`. La
colonne « Majoration MO (%) » est masquée par tous les préréglages : chaque
parcours l'active (« Affichage & contrôle » > affichage > « Personnalisé ») puis
réinitialise les colonnes. L'enregistrement automatique des lignes est différé
de 60 s : Ctrl+S le déclenche, comme dans `commercial-rounding.e2e.ts`.

Le calcul n'est pas concerné : `src/lib/estimate-calculations.ts` et
`src/lib/estimate-v2-snapshot.ts` restent sans modification.

## Correction

`useEstimateEditorSyncController` expose `markItemsSynced()` : les lignes
données deviennent la référence (`mergeSyncedItemPayload`, comme après une
sauvegarde ordinaire), puis une saisie en attente identique est retirée
(`pruneSyncedBufferedUpdates`). `applyBulkLineState()` l'appelle avec les
charges qu'il vient d'envoyer, après une réponse réussie et dans la portée
courante, donc aussi pour l'annulation et le rétablissement. Le harnais existant
`useEstimateEditorBulkController.test.ts` reçoit seulement cette dépendance
(`vi.fn()`), sans nouvelle assertion : 8/8 avant et après.

## Preuves (WSL Ubuntu 24.04, Node 24.19.0, Supabase CLI natif 2.120.0)

Clone Linux `~/miaouffrage-bulk-sync-20261016`, révision `de54931d`, modifications
locales recopiées depuis le worktree (empreintes dans les journaux
`~/bulk-sync-logs/{red,green}.log`). Commande, après contrôle qu'aucun
`run-tester-army-ci`, `run-local-supabase-ci`, `upgrade-check` ou
`__supabase_stack_host__` ne tourne :

```sh
export NODE_OPTIONS=--max-old-space-size=4096
npm run e2e:army:local -- --grep 'bulk edit sync' --app-port 3127
```

**Rouge, sans correction** (seuls le parcours et ce document ajoutés) :
`.e2e/army/ci/2026-10-16T17-27-25-531Z-critical`, manifeste SHA-256
`9521e16aff731ff9086561dae56807f45a3934b3c937b7b5afda4e3bdbadec5e`. pgTAP
13 fichiers / 1253 assertions, matrice RLS et build réussis ; parcours : 2 échecs,
2 réussites (connexion, D3).

| Parcours | Saisie | Attendu | Serveur | Cellule | Statut |
| --- | --- | --- | --- | --- | --- |
| D1 | « 100 » après lot 150 % | 1 | 1,5 | « 100 » | « À jour » |
| D2 | « 100 » après lot, annuler, rétablir | 1 | 1,5 | « 100 » | « À jour » |
| D3 | « 150 » après lot, annuler | 1,5 | 1,5 | « 150 » | « Sauvegardé » |

D1 et D2 échouent après l'attente de 90 s de `waitForAutoSave`, avec
« État de synchronisation : À jour » dans `screen-at-failure.txt`.

**Vert, avec correction** : `.e2e/army/ci/2026-10-16T17-45-18-425Z-critical`,
manifeste SHA-256
`8df0a861f2859e5f6c51c5f06b6cbe16ebf33a95f76488a4636a441761f7ae2b`, statut
`passed`. pgTAP 1253 assertions, RLS, build neuf (`rVuV4X23C7Jzlfkjb_Iuf`,
entrée `useEstimateEditorBulkController.ts` SHA-256 `6721d123…`, contre
`c6f13493…` à HEAD pour le build rouge `sxzkcHCwiL_DiyDJ_UPbW`) ; parcours
4/4 (connexion, D1, D2, D3), aucun ignoré. D1 et D2 : serveur 1, cellule
« 100 », « Sauvegardé » ; D3 : serveur 1,5, cellule « 150 », « Sauvegardé ».
Chaque parcours relit ensuite la page : cellule et API conformes.

Contrôles du même clone corrigé : ESLint `--max-warnings=0` sur les six
fichiers TypeScript touchés, `npm run typecheck` (avec la même
`NODE_OPTIONS` : sans elle, `tsc` dépasse son tas par défaut), `git diff --check`,
Vitest `useEstimateEditorBulkController` 8/8 et `useEstimateEditorSyncController`
35/35. Le build Army est un build de production Next ; `npm run build`
(validation OpenAPI comprise, sans objet ici) et la suite critique complète
n'ont pas été rejoués pour ce correctif.

## Même famille : suggestions en lot et présélection fournisseurs

La présélection fournisseurs (`useEstimateEditorSupplierController.apply`) et
l'application ou l'annulation des suggestions en lot
(`useEstimateEditorSuggestionsController.applySelected` / `undoLastApply`)
écrivent aussi des lignes existantes par `bulkUpdateEstimateItems()` sans
rafraîchir la référence. Une saisie n'est ignorée que si la charge complète de
la ligne redevient identique à la référence périmée ; chaque scénario ci-dessous
précise comment l'interface y parvient. Les deux actions sont dans
« Affichage & contrôle » > affichage > « Contrôles avancés », visibles en mode
Expert seulement : les parcours passent le compte en Expert par le commutateur
du menu principal, puis rétablissent son mode initial.

| Défaillance observable | Scénario et oracle |
| --- | --- |
| S1. Après des suggestions appliquées, ramener la valeur d'avant est ignoré | Règle ARMY « K FO 1,3 » dont le mot-clé est le titre exact d'une ligne neutre (K FO 1, K MO 1, sans unité ni catégorie). « Examiner 1 suggestion » > « Appliquer » → API `k_fo` 1,3. Cellule K FO « 1 », Tab, Ctrl+S → API 1, « Sauvegardé » ou « À jour » ; rechargement → « 1 ». Rouge attendu avant correction. |
| S2. Après « Annuler les suggestions », saisir la valeur suggérée est ignoré | Même règle, application puis « Annuler les suggestions » → API 1. Cellule « 1,3 », Tab, Ctrl+S → API 1,3 ; rechargement → « 1,3 » (la cellule K FO affiche une virgule, celle du prix un point). Vert attendu avant correction (référence périmée égale à ×1 par hasard) ; rouge pour une correction qui oublierait l'annulation. |
| P1. Après une présélection, revenir à l'article au prix de référence est ignoré | Article ARMY (référence 10,00 €, unité « u ») avec une seule offre active à 12,34 € ; ligne liée à l'article, titre = désignation, unité « u », 10,00 €, sans offre. « Présélectionner les fournisseurs » > « Appliquer la sélection » → API 1234 et offre retenue. L'offre est ensuite désactivée dans le catalogue (`POST /api/prices`, `update-offer`), puis « Associer ou remplacer l'article » sur le même article : la feuille propose son prix de référence. Ctrl+S → API 1000 et `selected_supplier_price_id` vide ; rechargement → « 10.00 ». Rouge attendu avant correction : la ligne redevient identique à son état d'avant la présélection. |
| P2. Après une présélection, ressaisir l'ancien prix dans la cellule est ignoré | Non reproductible par l'interface : la saisie du prix conserve l'offre retenue, donc la charge diffère de la référence périmée (offre vide) et part au serveur. Aucune action n'efface seule l'offre retenue ; la présélection n'a pas d'annulation. Pas de parcours. |

Chaque parcours crée ses propres article, fournisseur, offre et règle sous le
préfixe ARMY du run (`e2e/army/critical/bulk-edit-sync-sources.e2e.ts`). Les
règles de suggestion sont communes au tenant et leur correspondance floue
pourrait toucher d'autres lignes ARMY : il n'existe pas de route de suppression,
la règle est donc désactivée (`PATCH`, `is_active: false`) en fin de parcours,
depuis l'éditeur, car l'écriture exige son verrou de brouillon. Le mode Expert,
enregistré sur le profil du compte partagé, est rétabli en fin de parcours, y
compris après un échec ; les preuves `*-restored.json` le vérifient.

### Correction

Après une réponse réussie et dans la portée courante, la présélection
fournisseurs et l'application puis l'annulation des suggestions appellent
`markItemsSynced()` avec les charges qu'elles viennent d'envoyer, comme
`applyBulkLineState()`. Les harnais existants
`useEstimateEditorSuggestionsController.test.ts` et
`useEstimateEditorSupplierController.test.ts` reçoivent seulement la dépendance
(`vi.fn()`), sans nouvelle assertion.

### Preuves rouges (17/10/2026, même clone, correctif du lot présent, sans celui-ci)

- `.e2e/army/ci/2026-10-17T09-12-29-684Z-critical` (manifeste SHA-256
  `8be813c46cd147029afebacc4b3688e38c7df1eea1bfec48926e438873afb921`,
  `--grep 'bulk edit sync (suggestions|supplier)'`) : **P1 rouge**, cellule
  « 10.00 », statut « À jour », serveur 1234 avec l'offre retenue. S1 et S2 y
  échouent avant l'oracle métier sur l'affichage « 1,3 » de la cellule K FO
  (oracle corrigé, la suggestion était bien enregistrée à 1,3).
- `.e2e/army/ci/2026-10-17T09-18-37-849Z-critical` (manifeste SHA-256
  `dc59ca51ec8368700feb070e9363fe49f339e77f4663c4891df22c5d0be08d65`,
  `--grep 'bulk edit sync suggestions|bulk move'`) : **S1 rouge** (saisie « 1 »,
  cellule « 1 », « À jour », serveur `k_fo` 1,3), **S2 vert** comme prévu. Le
  même run porte la preuve rouge du [déplacement en lot](bulk-move-placement.md).

pgTAP 13 fichiers / 1253 assertions et matrice RLS réussis à chaque run.

### Preuve verte finale (17/10/2026, tous les correctifs)

`.e2e/army/ci/2026-10-17T09-24-39-195Z-critical`, manifeste SHA-256
`c309995e388a48bd44a49a1e5b077e043a185a577d826be6530fc3240312de4f`, statut
`passed`, commande
`npm run e2e:army:local -- --grep 'bulk edit sync|bulk move' --app-port 3127`.
Build neuf `zShSU5JoM1CVgJIZftsH2` dont les entrées correspondent aux fichiers
corrigés du worktree (contrôleurs lot `6f2cd759…`, suggestions `016eed10…`,
fournisseurs `d6df70e3…`), sources inchangées pendant le build. Parcours **8/8**
(connexion, D1–D3, S1, S2, P1, déplacement), aucun ignoré :

| Parcours | Serveur | Cellule | Statut |
| --- | --- | --- | --- |
| S1 | `k_fo` 1 | « 1 » | « Sauvegardé » |
| S2 | `k_fo` 1,3 | « 1,3 » | « Sauvegardé » |
| P1 | 1000, aucune offre | « 10.00 » | « Sauvegardé » |
| D1 / D2 | `h_mo_majoration` 1 | « 100 » | « Sauvegardé » |
| D3 | `h_mo_majoration` 1,5 | « 150 » | « Sauvegardé » |

Mode initial « Simplifié » rétabli après S1, S2 et P1 ; règles S1 et S2
désactivées. Contrôles du même clone : Vitest (lot 8, suggestions 12,
fournisseurs 7, synchronisation 35) 62/62 avant et après, ESLint
`--max-warnings=0` sur les fichiers TypeScript touchés, `npm run typecheck`
(avec `NODE_OPTIONS`), `git diff --check`, fichiers de calcul sans diff.
`npm run build` et la suite critique complète n'ont pas été rejoués.
