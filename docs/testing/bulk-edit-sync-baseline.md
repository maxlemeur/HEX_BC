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
Expert seulement : chaque parcours s'exécute sous un propriétaire jetable,
créé en mode Expert sur la pile possédée (depuis le 18/10/2026, voir plus bas).

| Défaillance observable | Scénario et oracle |
| --- | --- |
| S1. Après des suggestions appliquées, ramener la valeur d'avant est ignoré | Règle ARMY « K FO 1,3 » dont le mot-clé est le titre exact d'une ligne neutre (K FO 1, K MO 1, sans unité ni catégorie). « Examiner 1 suggestion » > « Appliquer » → API `k_fo` 1,3. Cellule K FO « 1 », Tab, Ctrl+S → API 1, « Sauvegardé » ou « À jour » ; rechargement → « 1 ». Rouge attendu avant correction. |
| S2. Après « Annuler les suggestions », saisir la valeur suggérée est ignoré | Même règle, application puis « Annuler les suggestions » → API 1. Cellule « 1,3 », Tab, Ctrl+S → API 1,3 ; rechargement → « 1,3 » (la cellule K FO affiche une virgule, celle du prix un point). Vert attendu avant correction (référence périmée égale à ×1 par hasard) ; rouge pour une correction qui oublierait l'annulation. |
| P1. Après une présélection, revenir à l'article au prix de référence est ignoré | Article ARMY (référence 10,00 €, unité « u ») avec une seule offre active à 12,34 € ; ligne liée à l'article, titre = désignation, unité « u », 10,00 €, sans offre. « Présélectionner les fournisseurs » > « Appliquer la sélection » → API 1234 et offre retenue. L'offre est ensuite désactivée dans le catalogue (`POST /api/prices`, `update-offer`), puis « Associer ou remplacer l'article » sur le même article : la feuille propose son prix de référence. Ctrl+S → API 1000 et `selected_supplier_price_id` vide ; rechargement → « 10.00 ». Rouge attendu avant correction : la ligne redevient identique à son état d'avant la présélection. |
| P2. Après une présélection, ressaisir l'ancien prix dans la cellule est ignoré | Non reproductible par l'interface : la saisie du prix conserve l'offre retenue, donc la charge diffère de la référence périmée (offre vide) et part au serveur. Aucune action n'efface seule l'offre retenue ; la présélection n'a pas d'annulation. Pas de parcours. |

Chaque parcours crée ses propres article, fournisseur, offre et règle sous le
préfixe ARMY du run (`e2e/army/critical/bulk-edit-sync-sources.e2e.ts`). Le mode
d'interface est enregistré sur le profil du compte, et les règles de suggestion
sont communes au tenant. Jusqu'au 18/10/2026, les parcours passaient le compte
partagé en Expert par le commutateur, puis le rétablissaient, et désactivaient leur
règle en fin de parcours. Avec deux workers, ce mode partagé fuyait vers les autres
parcours ([cause et preuves](version-totals-after-bulk-actions.md#mode-expert-du-compte-partagé-ci-39084774584)).
Depuis, chaque parcours inscrit son propre compte jetable sur la pile possédée
(`e2e/army/local/dedicated-owner.ts`, comme V3P01). Son tenant s'appelle
`ARMY BES <run>` et son profil est mis en Expert en SQL à la création. Rien n'est
rétabli ni désactivé : le compte partagé n'est jamais modifié, et la règle reste
dans le tenant du parcours. La preuve `bulk-sync-<s1|s2|p1>-owner.json` relève
l'identité du compte, le mode enregistré et le mode lu dans le menu. Chaque
parcours vérifie en SQL que son devis appartient à ce compte. Ces parcours exigent
donc la pile possédée (`e2e:army:local`, `e2e:army:ci`), comme P1 l'exigeait déjà
pour ses lectures catalogue.

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

## Annulation perdue (S2 instable, 18/10/2026)

### Symptôme et run d'origine

S2 (« … to the suggested value after their undo ») a échoué une fois dans la
suite critique à 2 workers : clone WSL `~/miaouffrage-v1-selection-verify`,
`E2E_ARMY_WORKERS=2 npm run e2e:army:ci -- critical --app-port 3174`, révision
`ef0b8289` (branche `ci/v1-totals-journeys-in-pr-selection`, qui ne touche pas
ce parcours ; `main` `c4c1e854` était passé une fois). Preuves :
`.e2e/army/ci/2026-10-18T12-49-48-645Z-critical/`, `critical/report.json`
SHA-256 `cb68401b9b22e987af3613cd2217730cf51c2e2cb8345d684b157bda9a5eba9d`,
écran `critical/results/bulk-edit-sync-sources-bulk-edit-sync-suggestions-save-75d51a29ca977c20/attempt-1/screen-at-failure.txt`.
Après le Ctrl+S de `reconcileStoredTotals` (12:52:26.837) et le statut
« Sauvegardé/À jour » (12:52:27.060), le clic sur « Annuler les suggestions »
(12:52:27.064, 32 ms) n'a rien écrit : `expect.poll(persistedKFo).toBe(1)`
expire à 30 s, `k_fo` reste 1,3. À l'écran : bouton toujours proposé et
**focalisé**, alerte « Des anomalies bloquantes… » au-dessus, aucun message
d'erreur, « À jour ». Le journal réseau serveur (partagé par les deux workers)
ne montre aucune écriture de S2 après l'application.

### Diagnostic

L'hypothèse d'un Ctrl+S encore en vol est écartée : l'application enregistre
déjà les totaux (BT4), donc ce Ctrl+S ne trouve rien à réconcilier. Une trace
temporaire dans le clone `~/miaouffrage-bes-flake` (jamais commitée), sur 30
répétitions de S2 à 2 workers (vertes), relève à chaque fois
`executeSave:result noop`. (« Dernière sauvegarde » de l'écran vient de
`updated_at`, pas d'une sauvegarde.) Le clic n'atteint pas `undoLastApply`.
Deux fenêtres font perdre un clic sur un bouton proposé et actif, sans message :

1. **Fin de l'application.** `applySelected` affiche l'annulation dès les
   lignes écrites, puis attend le retour d'usage de la règle
   (`POST …/suggestion-rules/<id>/feedback`) ; `undoLastApply` refuse en
   silence tant que `isApplyingRef` est vrai. Le bouton ne dépendait que de
   `isSaveBlocked`.
2. **Rechargement des conditions d'envoi.** Chaque écriture change
   `updated_at`, donc la clé de préchargement de `useEstimateEditorStatusController`.
   Le résultat précédent était masqué jusqu'à la nouvelle réponse : l'alerte
   « anomalies bloquantes » se démontait puis se remontait, et décalait de
   70 px tout ce qui la suit (relevé : bouton à y 306 puis 376, 165 ms après
   l'accusé de l'application hors charge). Sous charge, la réponse tombe pendant
   le clic : mousedown sur le bouton (d'où le focus), mouseup sur la mise en page
   déplacée, `click` sur l'ancêtre commun, `onClick` jamais appelé. C'est
   exactement l'écran du run d'origine.

### Défaillances observables et scénario

| Défaillance observable | Scénario et oracle (S2 renforcé) |
| --- | --- |
| U1. « Annuler les suggestions » cliqué pendant la fin de l'application est ignoré | Le retour d'usage de la règle est retenu par le parcours ; le bouton doit être **désactivé** tant qu'il est retenu. |
| U2. Le rechargement des conditions d'envoi déplace l'annulation sous le pointeur | La lecture `GET …/gating` provoquée par le nouveau jeton de l'application est retenue ; l'alerte « anomalies bloquantes » reste visible, ne se démonte jamais (observateur dans la page) et le centre du bouton ne bouge pas entre avant et après la réponse. |
| U3. La réponse des conditions retire (ou ajoute) l'alerte pendant un appui | Relevé de la revue Codex de #64 : un passage de « bloqué » à « envoyable » démonte l'alerte au moment exact de la réponse. Le retour d'usage relâché et sa réponse reçue, la lecture des conditions reste retenue ; une sonde dans la page relève à chaque image si le bouton est actif. Il doit rester **désactivé** jusqu'à la réponse, puis devenir actif ; le clic écrit alors `k_fo` 1. |

Le parcours retient ces deux requêtes (`holdNextRequest`, puis `fallback()`
vers la route de la campagne) : il force la pire chronologie au lieu d'attendre
qu'elle survienne. U3 ne dépend pas du sens du changement : tant que la lecture
est en cours, aucun appui ne peut viser le bouton, que l'alerte reste, parte ou
arrive. Preuve : `bulk-sync-s2-undo-press.json` (centres avant et après la
réponse, bouton actif pendant la lecture, démontage de l'alerte, `k_fo`).

### Correction

- `useEstimateEditorState.impl.tsx` : `isUndoBulkSuggestDisabled` vaut
  `isSaveBlocked || isApplyingBulkSuggest || isSendGatingRefreshing` (U3,
  après la revue Codex de #64).
- `useEstimateEditorStatusController.ts` : `meta.isSendGatingRefreshing` est
  vrai tant que le préchargement d'un brouillon n'a pas répondu (succès ou
  échec) pour sa clé courante, hors conditions déjà relues par l'envoi.
- U2 (alerte gardée pendant la lecture) : `main` l'a corrigé entre-temps par
  `7fa27468` (V3E05, `displayedSendGating`) : l'alerte lit le dernier contrôle
  abouti du brouillon, tandis que `state.sendGating` reste masqué jusqu'à la
  réponse du nouveau jeton. La fusion de `main` dans cette branche garde cette
  version et abandonne la nôtre (préchargement apparié par version, contrat
  isolé « keeps the draft's last gating shown… ») ; « masks stale gating while a
  new version token is being checked » reste tel que sur `main`.
- `beginOperation` n'abandonne plus la lecture en cours (relevé de la revue) :
  sa réponse reste vérifiée contre la version et son jeton. L'abandonner
  laissait le jeton courant sans contrôle (conditions masquées, annulation
  retenue) jusqu'à l'écriture suivante.

### Preuves (clone `~/miaouffrage-bes-flake`, base `c4c1e854`, WSL Ubuntu 24.04, Node 24.14.0, e2e 0.21.0)

Boucle `E2E_ARMY_WORKERS=2 npm run e2e:army:dev-loop -- run --grep …` (itérations
non qualifiantes), sous `.e2e/army/ci/2026-10-18T14-51-41-428Z-dev-loop/iterations/` :

| Itération | Sources | Résultat | Manifeste SHA-256 |
| --- | --- | --- | --- |
| `007` | parcours seul | **rouge U1** : bouton actif pendant le retour d'usage retenu | `7c6ded2f…4500d0d` |
| `008` | + correction U1 | U1 vert, **rouge U2** : alerte absente pendant la lecture retenue | `ddf1239b…eca` |
| `009` | idem, sans l'attente de l'alerte | **rouge du run d'origine** : centre y 324 → 394 pendant l'appui, `k_fo` 1,3, bouton focalisé | `feaddf6c…6115` |
| `011` | U1 + U2 | S2 vert, centre (1149, 394) inchangé, alerte jamais démontée, `k_fo` 1 | `9b3c46ae…2809` |
| `012`–`014` | U1 + U2 | `--grep 'bulk edit sync'` 8/8 trois fois | `4c03863b…dbdf`, `16531917…d102`, `a6ce785f…5ce6` |

Suite critique complète, `E2E_ARMY_WORKERS=2 npm run e2e:army:ci -- critical --app-port 3190`
(pgTAP et matrice RLS réussis à chaque run) :

- avant la revue, `.e2e/army/ci/2026-10-18T15-20-40-638Z-critical` (manifeste
  `e5c02c66…a684b`, `report.json` `c2cbe551…2f8e9`) : **106/106**, ni instable ni ignoré ;
- sources finales (suites de la revue : lecture des conditions conservée par
  `beginOperation`, mesure du centre après deux images, appui relâché en
  `finally`), `.e2e/army/ci/2026-10-18T15-33-30-955Z-critical` (manifeste
  `0995e711…a143`, `report.json` `4156fc08…f34c`) : **106/106**, ni instable ni
  ignoré ; S2 : centre (1149, 394) inchangé, alerte jamais démontée, `k_fo` 1.

Empreintes des fichiers finaux exécutés : parcours `e9d88fda…4332`, état de
l'éditeur `2c905a18…4857`, contrôleur de statut `7da3f6ff…2979`, son test
`344e5e47…a8e5`. Vitest des contrôleurs de statut et de suggestions 37/37 ;
`tsc --noEmit`, ESLint `--max-warnings=0` des fichiers touchés et
`git diff --check` sans erreur. `npm run verify:pr` sur ces sources : exit 0.

Suite de la revue Codex de #64 (U3), même clone, `npm run e2e:army:local --
--grep '<motif>' --app-port 3127` :

| Run | Sources | Résultat | `report.json` SHA-256 |
| --- | --- | --- | --- |
| `.e2e/army/ci/2026-10-18T17-10-20-368Z-critical` | parcours U3, code de `11534e34` | **rouge U3** : « undo enabled while the gating of the apply's token was loading: expected true to be false » | `a72539ad…6fe0` |
| `.e2e/army/ci/2026-10-18T17-15-56-872Z-critical` (`--grep 'bulk edit sync'`, 2 workers) | parcours U3 + correction U3 | **8/8** ; S2 : bouton jamais actif pendant la lecture retenue, centre (1149, 394) inchangé, alerte jamais démontée, `k_fo` 1 ; pgTAP et matrice RLS verts | `99c456ac…3f4b` |

Limites : la trace et la sonde de répétition (S2 ×6, horodatages des montages
et des évènements pointeur) ne sont pas commitées. L'attribution des requêtes du
run d'origine reste partielle, car son journal serveur mêle les deux workers ;
la cause est établie par la reproduction déterministe de son écran, pas par ce
journal.
